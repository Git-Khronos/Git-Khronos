//! Endpoint review using Git's config parser and the documented .lfsconfig
//! worktree/index/HEAD precedence. No configuration is rewritten or executed.
use super::*;
use std::collections::HashMap;
use std::path::PathBuf;

const FILE_ENDPOINTS: &str = r"^(lfs\.(url|pushurl)|remote\..*\.lfsurl)$";
const MAX_CONFIGURATION_BYTES: usize = 512 * 1024;

pub(super) fn is_endpoint_key(key: &str) -> bool {
    is_endpoint_key_bytes(key.as_bytes())
}

fn is_endpoint_key_bytes(key: &[u8]) -> bool {
    matches!(key, b"lfs.url" | b"lfs.pushurl")
        || (key.starts_with(b"remote.")
            && (key.ends_with(b".lfsurl") || key.ends_with(b".lfspushurl")))
}

pub(super) fn requires_review(args: &[&str]) -> bool {
    let mut index = 0;
    while let Some(argument) = args.get(index) {
        if matches!(*argument, "-c" | "-C" | "--git-dir" | "--work-tree") {
            index += 2;
        } else if argument.starts_with('-') {
            index += 1;
        } else {
            return match *argument {
                "lfs" => matches!(
                    args.get(index + 1),
                    Some(&"fetch" | &"push" | &"pull" | &"locks" | &"lock" | &"unlock")
                ),
                "submodule" => matches!(args.get(index + 1), Some(&"add" | &"update")),
                "clone" | "fetch" | "pull" | "push" | "ls-remote" => true,
                _ => false,
            };
        }
    }
    false
}

fn unavailable() -> AppError {
    AppError::new(
        "remoteConfigurationUnavailable",
        "Git/LFS endpoint configuration could not be inspected safely.",
        Some(
            "Check Git configuration and .lfsconfig before retrying. No endpoint request was started.",
        ),
    )
}

pub(super) fn query(
    mut command: Command,
    cancellation: &CancellationToken,
) -> Result<Output, AppError> {
    configure(&mut command);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C");
    crate::configure_process_tree(&mut command);
    let (output, truncated) = crate::run_cancellable_command_with_stdout_limit(
        command,
        cancellation,
        Some(MAX_CONFIGURATION_BYTES),
    )?;
    if truncated {
        return Err(AppError::new(
            "remoteConfigurationUnavailable",
            "Git endpoint configuration exceeds the inspection limit.",
            Some(
                "Reduce matching URL configuration to 512 KiB or less before retrying. No endpoint request was started.",
            ),
        ));
    }
    Ok(output)
}

fn git(path: &Path, args: &[&str], cancellation: &CancellationToken) -> Result<Output, AppError> {
    let mut command = crate::git_in(path);
    command.args(args);
    query(command, cancellation)
}

fn successful(output: Output) -> Result<Vec<u8>, AppError> {
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(unavailable())
    }
}

fn endpoints(bytes: &[u8]) -> HashMap<Vec<u8>, String> {
    // Git emits NUL-framed key/newline/value records; later values override
    // earlier ones. In particular, a safe local value can override a file value.
    // Keep names byte-exact: lossy decoding can turn distinct remote names
    // into the same override key and suppress an endpoint's review.
    bytes
        .split(|byte| *byte == 0)
        .filter_map(|record| {
            let separator = record.iter().position(|byte| *byte == b'\n')?;
            let key = &record[..separator];
            let value = &record[separator + 1..];
            is_endpoint_key_bytes(key)
                .then(|| (key.to_vec(), String::from_utf8_lossy(value).into_owned()))
        })
        .collect()
}

fn root_path(bytes: Vec<u8>) -> Result<PathBuf, AppError> {
    #[cfg(unix)]
    let bytes = bytes.strip_suffix(b"\n").unwrap_or(&bytes);
    #[cfg(not(unix))]
    let bytes = bytes
        .strip_suffix(b"\r\n")
        .or_else(|| bytes.strip_suffix(b"\n"))
        .unwrap_or(&bytes);
    if bytes.is_empty() {
        return Err(unavailable());
    }
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStringExt;
        Ok(PathBuf::from(std::ffi::OsString::from_vec(bytes.to_vec())))
    }
    #[cfg(not(unix))]
    {
        String::from_utf8(bytes.to_vec())
            .map(PathBuf::from)
            .map_err(|_| unavailable())
    }
}

fn file_configuration(path: &Path, cancellation: &CancellationToken) -> Result<Vec<u8>, AppError> {
    let bare = successful(git(
        path,
        &["rev-parse", "--is-bare-repository"],
        cancellation,
    )?)?;
    let bare = match bare.as_slice() {
        b"true\n" | b"true\r\n" => true,
        b"false\n" | b"false\r\n" => false,
        _ => return Err(unavailable()),
    };
    let mut command = crate::git_in(path);
    if !bare {
        let root = root_path(successful(git(
            path,
            &["rev-parse", "--show-toplevel"],
            cancellation,
        )?)?)?;
        let file = root.join(".lfsconfig");
        if file.try_exists().map_err(|_| unavailable())? {
            command.args(["config", "--file"]).arg(file);
        } else {
            let index = successful(git(
                path,
                &[
                    "--literal-pathspecs",
                    "ls-files",
                    "--stage",
                    "-z",
                    "--",
                    ".lfsconfig",
                ],
                cancellation,
            )?)?;
            if index.split(|byte| *byte == 0).any(|entry| {
                entry
                    .split(|byte| *byte == b'\t')
                    .next()
                    .is_some_and(|metadata| metadata.ends_with(b" 0"))
            }) {
                command.args(["config", "--blob=:.lfsconfig"]);
            } else {
                return head_configuration(path, cancellation);
            }
        }
    } else {
        return head_configuration(path, cancellation);
    }
    configuration(command, cancellation)
}

fn head_configuration(path: &Path, cancellation: &CancellationToken) -> Result<Vec<u8>, AppError> {
    let head = git(
        path,
        &["rev-parse", "--verify", "--quiet", "HEAD"],
        cancellation,
    )?;
    if head.status.code() == Some(1) {
        return Ok(Vec::new());
    }
    successful(head)?;
    let tree = successful(git(
        path,
        &[
            "--literal-pathspecs",
            "ls-tree",
            "-z",
            "HEAD",
            "--",
            ".lfsconfig",
        ],
        cancellation,
    )?)?;
    if tree.is_empty() {
        return Ok(Vec::new());
    }
    let mut command = crate::git_in(path);
    command.args(["config", "--blob=HEAD:.lfsconfig"]);
    configuration(command, cancellation)
}

fn configuration(
    mut command: Command,
    cancellation: &CancellationToken,
) -> Result<Vec<u8>, AppError> {
    command.args(["--no-includes", "--null", "--get-regexp", FILE_ENDPOINTS]);
    let output = query(command, cancellation)?;
    if output.status.success() || output.status.code() == Some(1) {
        Ok(output.stdout)
    } else {
        Err(unavailable())
    }
}

pub(super) fn validate(
    path: &Path,
    cancellation: &CancellationToken,
    ordinary: &[u8],
) -> Result<(), AppError> {
    let mut effective = endpoints(ordinary);
    for value in effective.values() {
        validate_arguments(&[value])?;
    }
    for (key, value) in endpoints(&file_configuration(path, cancellation)?) {
        effective.entry(key).or_insert(value);
    }
    for value in effective.values() {
        validate_arguments(&[value])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_endpoint_names_do_not_collapse_distinct_non_utf8_keys() {
        let mut effective = endpoints(b"remote.owned-\xff.lfsurl\nhttp://127.0.0.1/repository\0");
        for (key, value) in endpoints(
            b"remote.owned-\xfe.lfsurl\nhttp://user:fixture-secret@127.0.0.1/repository\0",
        ) {
            effective.entry(key).or_insert(value);
        }
        assert_eq!(
            effective.len(),
            2,
            "Distinct raw names are not configuration overrides"
        );
        assert!(effective.values().any(|value| {
            validate_arguments(&[value]).is_err_and(|error| error.kind == "credentialsInUrl")
        }));
    }

    #[test]
    fn endpoint_review_only_applies_at_network_boundaries() {
        for args in [
            vec!["fetch", "origin"],
            vec!["push"],
            vec!["pull"],
            vec!["lfs", "locks", "--verify", "--json"],
            vec![
                "-c",
                "lfs.remote.autodetect=false",
                "lfs",
                "fetch",
                "origin",
            ],
            vec!["submodule", "update", "--init"],
        ] {
            assert!(requires_review(&args), "{args:?}");
        }
        for args in [
            vec!["lfs", "version"],
            vec!["lfs", "env"],
            vec!["lfs", "ls-files"],
            vec!["lfs", "track"],
            vec!["lfs", "install"],
            vec!["submodule", "status"],
            vec!["config", "--list"],
        ] {
            assert!(!requires_review(&args), "{args:?}");
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn configuration_fifo_remains_cancellable_while_writer_stays_open() {
        use std::fs::OpenOptions;
        use std::os::unix::fs::OpenOptionsExt;
        let directory = std::env::temp_dir().join(format!(
            "git-khronos-lfs-config-cancel-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&directory).unwrap();
        assert!(
            Command::new("git")
                .arg("-C")
                .arg(&directory)
                .args(["init", "-q"])
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .status()
                .unwrap()
                .success()
        );
        let fifo = directory.join(".lfsconfig");
        assert!(
            Command::new("mkfifo")
                .arg(&fifo)
                .status()
                .unwrap()
                .success()
        );
        let cancellation = CancellationToken::default();
        let worker_cancellation = cancellation.clone();
        let path = directory.clone();
        let (sender, receiver) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let _ = sender.send(file_configuration(&path, &worker_cancellation));
        });
        // O_NONBLOCK writer open succeeds only once the owned Git query has
        // opened the FIFO for reading. Keep this writer alive through cancellation
        // so EOF cannot accidentally release the blocked configuration read.
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        let writer = loop {
            match OpenOptions::new()
                .write(true)
                .custom_flags(0x800)
                .open(&fifo)
            {
                Ok(writer) => break Some(writer),
                Err(_) if std::time::Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(10))
                }
                Err(_) => break None,
            }
        };
        cancellation.cancel();
        let result = receiver.recv_timeout(Duration::from_secs(2));
        assert!(
            writer.is_some(),
            "Git did not reach the owned configuration FIFO"
        );
        let error = result
            .expect("Cancellation must finish before the writer closes")
            .unwrap_err();
        assert_eq!(error.kind, "operationCancelled");
        drop(writer);
        worker.join().unwrap();
        std::fs::remove_dir_all(directory).unwrap();
    }
}
