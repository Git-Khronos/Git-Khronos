use super::*;
use std::io;
use std::sync::atomic::AtomicBool;

#[derive(Clone, Copy, Debug)]
enum Failure {
    Status,
    Kill,
    Wait,
}

#[derive(Clone, Debug)]
struct FailingChild {
    process: Arc<Mutex<std::process::Child>>,
    fail: Arc<AtomicBool>,
    failure: Failure,
}

impl portable_pty::ChildKiller for FailingChild {
    fn kill(&mut self) -> io::Result<()> {
        if self.fail.load(Ordering::Acquire) && matches!(self.failure, Failure::Kill) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "Owned test kill refused",
            ));
        }
        self.process.lock().unwrap().kill()
    }

    fn clone_killer(&self) -> Box<dyn portable_pty::ChildKiller + Send + Sync> {
        Box::new(self.clone())
    }
}

impl portable_pty::Child for FailingChild {
    fn try_wait(&mut self) -> io::Result<Option<portable_pty::ExitStatus>> {
        if self.fail.load(Ordering::Acquire) && matches!(self.failure, Failure::Status) {
            return Err(io::Error::other("Owned test status unavailable"));
        }
        portable_pty::Child::try_wait(&mut *self.process.lock().unwrap())
    }

    fn wait(&mut self) -> io::Result<portable_pty::ExitStatus> {
        if self.fail.load(Ordering::Acquire) && matches!(self.failure, Failure::Wait) {
            return Err(io::Error::other("Owned test wait unavailable"));
        }
        portable_pty::Child::wait(&mut *self.process.lock().unwrap())
    }

    fn process_id(&self) -> Option<u32> {
        Some(self.process.lock().unwrap().id())
    }

    #[cfg(windows)]
    fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
        use std::os::windows::io::AsRawHandle;
        Some(self.process.lock().unwrap().as_raw_handle())
    }
}

#[test]
fn failed_terminal_close_retains_ownership_until_an_explicit_retry_reaps_the_child() {
    for failure in [Failure::Status, Failure::Kill, Failure::Wait] {
        let state = AppState::default();
        let pair = NativePtySystem::default()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        // Keep an independent owner for test cleanup even when the old buggy
        // registry drops its only handle. No unrelated process is signalled.
        let process = Arc::new(Mutex::new(
            std::process::Command::new("/bin/sh")
                .args(["-c", "exec sleep 30"])
                .spawn()
                .unwrap(),
        ));
        let fail = Arc::new(AtomicBool::new(true));
        let cancelled = Arc::new(AtomicBool::new(false));
        state.terminals.lock().unwrap().insert(
            "retry".into(),
            TerminalSession {
                master: pair.master,
                writer: Arc::new(tauri::async_runtime::Mutex::new(Box::new(io::sink()))),
                cancelled: cancelled.clone(),
                lifecycle: Arc::default(),
                child: Arc::new(Mutex::new(Box::new(FailingChild {
                    process: process.clone(),
                    fail: fail.clone(),
                    failure,
                }))),
            },
        );
        let first = close_terminal_session(&state, "retry");
        let retained = state.terminals.lock().unwrap().contains_key("retry");
        fail.store(false, Ordering::Release);
        let retry = close_terminal_session(&state, "retry");
        let removed = !state.terminals.lock().unwrap().contains_key("retry");
        let reaped = process.lock().unwrap().try_wait().unwrap().is_some();
        // Always release the owned fixture before making regression assertions.
        let mut owned = process.lock().unwrap();
        let _ = owned.kill();
        owned.wait().unwrap();
        drop(owned);
        assert!(
            first.is_err(),
            "{failure:?} did not exercise a cleanup failure"
        );
        assert!(
            retained,
            "{failure:?} failure discarded the retryable process handle"
        );
        assert!(
            cancelled.load(Ordering::Acquire),
            "Failed close left PTY input active"
        );
        assert!(
            retry.unwrap().is_some(),
            "{failure:?} retry did not remove its owned session"
        );
        assert!(
            removed && reaped,
            "{failure:?} retry did not reap the child and clear the registry"
        );
        assert!(close_terminal_session(&state, "retry").unwrap().is_none());
    }
}

#[test]
fn terminal_exit_is_claimed_once_after_output_and_process_cleanup_in_either_order() {
    for reader_first in [true, false] {
        let mut lifecycle = TerminalLifecycle::default();
        assert!(!lifecycle.claim_exit());
        if reader_first {
            lifecycle.reader_finished = true;
        } else {
            lifecycle.reaped = true;
        }
        assert!(!lifecycle.claim_exit(), "Partial cleanup announced exit");
        lifecycle.reader_finished = true;
        lifecycle.reaped = true;
        assert!(lifecycle.claim_exit());
        assert!(
            !lifecycle.claim_exit(),
            "Repeated cleanup announced exit twice"
        );
    }
}

#[test]
fn concurrent_terminal_cleanup_does_not_hold_the_registry_or_announce_exit_twice() {
    use std::time::{Duration, Instant};
    let state = Arc::new(AppState::default());
    let pair = NativePtySystem::default()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    let process = Arc::new(Mutex::new(
        std::process::Command::new("/bin/sh")
            .args(["-c", "exec sleep 30"])
            .spawn()
            .unwrap(),
    ));
    let child: Arc<Mutex<Box<dyn Child + Send + Sync>>> =
        Arc::new(Mutex::new(Box::new(FailingChild {
            process: process.clone(),
            fail: Arc::new(AtomicBool::new(false)),
            failure: Failure::Kill,
        })));
    let cancelled = Arc::new(AtomicBool::new(false));
    let lifecycle = Arc::new(Mutex::new(TerminalLifecycle {
        reader_finished: true,
        ..Default::default()
    }));
    state.terminals.lock().unwrap().insert(
        "race".into(),
        TerminalSession {
            master: pair.master,
            writer: Arc::new(tauri::async_runtime::Mutex::new(Box::new(io::sink()))),
            cancelled: cancelled.clone(),
            child: child.clone(),
            lifecycle: lifecycle.clone(),
        },
    );
    // Hold only the per-child guard to place the first closer at a controlled
    // blocking point. The unrelated-session registry must stay accessible.
    let gate = child.lock().unwrap();
    let first_state = state.clone();
    let first = std::thread::spawn(move || close_terminal_session(&first_state, "race"));
    let deadline = Instant::now() + Duration::from_secs(5);
    while !cancelled.load(Ordering::Acquire) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(1));
    }
    let reached_gate = cancelled.load(Ordering::Acquire);
    let registry_available = state.terminals.try_lock().is_ok();
    let second_state = state.clone();
    let second = std::thread::spawn(move || close_terminal_session(&second_state, "race"));
    drop(gate);
    let first_result = first.join().unwrap();
    let second_result = second.join().unwrap();
    let reaped = process.lock().unwrap().try_wait().unwrap().is_some();
    let removed = state.terminals.lock().unwrap().is_empty();
    // The two notification contenders share the same lifecycle lock. Reaping
    // can succeed twice, but only one event may be claimed.
    let first_announcement = lifecycle.lock().unwrap().claim_exit();
    let second_announcement = lifecycle.lock().unwrap().claim_exit();
    let mut owned = process.lock().unwrap();
    let _ = owned.kill();
    owned.wait().unwrap();
    drop(owned);
    assert!(
        reached_gate && registry_available,
        "Blocked cleanup held the shared registry"
    );
    assert!(first_result.is_ok() && second_result.is_ok());
    assert!(removed && reaped);
    assert!(first_announcement && !second_announcement);
}
