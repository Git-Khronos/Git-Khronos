//! Synchronous, thread-bound cancellation for composed Git preflights.
//! Never retain this scope across an await or expect it to propagate to a worker.
use super::*;
use std::cell::RefCell;
use std::io::{Seek, SeekFrom};

#[derive(Clone)]
struct Context {
    token: CancellationToken,
    deadline: Option<std::time::Instant>,
}
thread_local! {
    static CURRENT: RefCell<Option<Context>> = const { RefCell::new(None) };
}

pub(super) fn current() -> Option<CancellationToken> {
    CURRENT.with(|slot| slot.borrow().as_ref().map(|context| context.token.clone()))
}

pub(super) fn deadline() -> Option<std::time::Instant> {
    CURRENT.with(|slot| slot.borrow().as_ref().and_then(|context| context.deadline))
}

pub(super) fn with<T>(token: Option<&CancellationToken>, action: impl FnOnce() -> T) -> T {
    scoped(
        token.map(|token| Context {
            token: token.clone(),
            deadline: None,
        }),
        action,
    )
}

pub(super) fn inspect<T>(timeout: Duration, action: impl FnOnce() -> T) -> T {
    scoped(
        Some(Context {
            token: CancellationToken::default(),
            deadline: Some(std::time::Instant::now() + timeout),
        }),
        action,
    )
}

fn scoped<T>(context: Option<Context>, action: impl FnOnce() -> T) -> T {
    struct Restore(Option<Context>);
    impl Drop for Restore {
        fn drop(&mut self) {
            CURRENT.with(|slot| *slot.borrow_mut() = self.0.take());
        }
    }
    let _restore = Restore(CURRENT.with(|slot| slot.replace(context)));
    action()
}

struct Input {
    directory: PathBuf,
    file: Option<fs::File>,
}
impl Drop for Input {
    fn drop(&mut self) {
        drop(self.file.take());
        let _ = fs::remove_file(self.directory.join("stdin"));
        let _ = fs::remove_dir(&self.directory);
    }
}
impl Input {
    fn new(bytes: &[u8]) -> Result<Self, AppError> {
        if bytes.len() > 4 * 1024 * 1024 {
            return Err(AppError::new(
                "gitInputLimit",
                "The cancellable Git input exceeds its supported limit.",
                None,
            ));
        }
        let mut random = [0; 16];
        getrandom::fill(&mut random).map_err(|_| {
            AppError::new(
                "gitInputUnavailable",
                "Could not allocate private Git input storage.",
                None,
            )
        })?;
        let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let directory = std::env::temp_dir().join(format!("git-khronos-input-{suffix}"));
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&directory).map_err(input_error)?;
        let mut input = Self {
            directory,
            file: None,
        };
        let mut options = fs::OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(input.directory.join("stdin"))
            .map_err(input_error)?;
        file.write_all(bytes).map_err(input_error)?;
        file.seek(SeekFrom::Start(0)).map_err(input_error)?;
        input.file = Some(file);
        Ok(input)
    }
}
fn input_error(error: std::io::Error) -> AppError {
    AppError::new(
        "gitInputUnavailable",
        format!("Could not prepare private Git input: {error}"),
        None,
    )
}

pub(super) fn run_input(
    mut command: Command,
    bytes: &[u8],
    cancellation: &CancellationToken,
) -> Result<Output, AppError> {
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    // A file avoids an uninterruptible pipe writer when Git or a hook stops
    // reading stdin. The owned process runner handles the complete child group.
    let input = Input::new(bytes)?;
    let reader = input
        .file
        .as_ref()
        .expect("prepared input file")
        .try_clone()
        .map_err(input_error)?;
    command
        .stdin(Stdio::from(reader))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_tree(&mut command);
    run_cancellable_command(command, cancellation)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nested_scopes_restore_the_previous_thread_context_even_after_panic() {
        let outer = CancellationToken::default();
        outer.cancel();
        assert!(current().is_none());
        with(Some(&outer), || {
            assert!(current().unwrap().is_cancelled());
            let caught = std::panic::catch_unwind(|| {
                with(None, || {
                    assert!(current().is_none());
                    panic!("owned scope unwind");
                })
            });
            assert!(caught.is_err());
            assert!(current().unwrap().is_cancelled());
            std::thread::spawn(|| assert!(current().is_none()))
                .join()
                .unwrap();
        });
        assert!(current().is_none());
    }

    #[test]
    fn private_input_has_exact_bytes_and_is_removed_when_released() {
        let input = Input::new(b"owned\0input\n").unwrap();
        let directory = input.directory.clone();
        assert_eq!(
            fs::read(directory.join("stdin")).unwrap(),
            b"owned\0input\n"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(directory.join("stdin"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        drop(input);
        assert!(!directory.exists());
    }

    #[cfg(unix)]
    #[test]
    fn cancellation_settles_even_when_a_command_never_reads_its_large_stdin() {
        use std::time::Instant;
        let storage = Input::new(b"").unwrap();
        let marker = storage.directory.join("owned-command-started");
        let token = CancellationToken::default();
        let worker_token = token.clone();
        let command_marker = marker.clone();
        let (sender, receiver) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let mut command = Command::new("sh");
            command
                .args(["-c", "printf started > \"$GK_OWNED_MARKER\"; sleep 30"])
                .env("GK_OWNED_MARKER", command_marker);
            let result = run_input(command, &vec![b'x'; 2 * 1024 * 1024], &worker_token);
            let _ = sender.send(result);
        });
        let deadline = Instant::now() + Duration::from_secs(15);
        while !marker.exists() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        let started = marker.exists();
        token.cancel();
        let error = receiver
            .recv_timeout(Duration::from_secs(10))
            .expect("cancellation must not wait for stdin consumption")
            .unwrap_err();
        worker.join().unwrap();
        assert!(started);
        assert_eq!(error.kind, "operationCancelled");
        fs::remove_file(marker).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn reconciliation_inspection_is_bounded_independently_of_the_canceled_action() {
        let token = CancellationToken::default();
        token.cancel();
        let started = std::time::Instant::now();
        let error = with(Some(&token), || {
            inspect(Duration::from_millis(100), || {
                let mut command = Command::new("sh");
                command
                    .args(["-c", "sleep 30"])
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                configure_process_tree(&mut command);
                run_cancellable_command(command, &CancellationToken::default())
            })
        })
        .unwrap_err();
        assert_eq!(error.kind, "gitInspectionTimeout");
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(current().is_none());
    }
}
