//! Keeps the window usable when the page renderer process dies.
//!
//! On Linux the page runs in a separate WebKit process. If that process
//! crashes (for example after the installed package is replaced while the app
//! is running) the window stays open but is blank, and the single-instance
//! guard forwards every later launch to this unusable instance. Reloading the
//! page restarts the renderer; repeated crashes end the app so the next launch
//! starts fresh.

use std::time::{Duration, Instant};

const CRASH_WINDOW: Duration = Duration::from_secs(60);
const MAX_RELOADS_IN_WINDOW: usize = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RendererStop {
    Crashed,
    OutOfMemory,
    Requested,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RecoveryAction {
    Reload,
    Quit,
    Ignore,
}

#[derive(Debug, Default)]
pub(crate) struct RecoveryPolicy {
    recent_reloads: Vec<Instant>,
}

impl RecoveryPolicy {
    pub(crate) fn decide(&mut self, stop: RendererStop, now: Instant) -> RecoveryAction {
        if stop == RendererStop::Requested {
            return RecoveryAction::Ignore;
        }
        self.recent_reloads
            .retain(|&at| now.saturating_duration_since(at) < CRASH_WINDOW);
        if self.recent_reloads.len() >= MAX_RELOADS_IN_WINDOW {
            return RecoveryAction::Quit;
        }
        self.recent_reloads.push(now);
        RecoveryAction::Reload
    }
}

#[cfg(target_os = "linux")]
pub(crate) fn install(app: &tauri::AppHandle) {
    use std::sync::Mutex;
    use tauri::Manager;
    use webkit2gtk::{WebProcessTerminationReason, WebViewExt};

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let handle = app.clone();
    let _ = window.with_webview(move |platform| {
        let policy = Mutex::new(RecoveryPolicy::default());
        platform
            .inner()
            .connect_web_process_terminated(move |view, reason| {
                let stop = match reason {
                    WebProcessTerminationReason::ExceededMemoryLimit => RendererStop::OutOfMemory,
                    WebProcessTerminationReason::TerminatedByApi => RendererStop::Requested,
                    _ => RendererStop::Crashed,
                };
                let action = policy
                    .lock()
                    .map(|mut policy| policy.decide(stop, Instant::now()))
                    .unwrap_or(RecoveryAction::Quit);
                match action {
                    RecoveryAction::Reload => {
                        eprintln!("Git Khronos: the page renderer stopped ({stop:?}); reloading.");
                        view.reload();
                    }
                    RecoveryAction::Quit => {
                        eprintln!(
                            "Git Khronos: the page renderer keeps stopping; closing so the next launch starts fresh."
                        );
                        handle.exit(1);
                    }
                    RecoveryAction::Ignore => {}
                }
            });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_crash_reloads_the_page() {
        let mut policy = RecoveryPolicy::default();
        assert_eq!(
            policy.decide(RendererStop::Crashed, Instant::now()),
            RecoveryAction::Reload
        );
        assert_eq!(
            policy.decide(RendererStop::OutOfMemory, Instant::now()),
            RecoveryAction::Reload
        );
    }

    #[test]
    fn a_requested_stop_is_left_alone() {
        let mut policy = RecoveryPolicy::default();
        assert_eq!(
            policy.decide(RendererStop::Requested, Instant::now()),
            RecoveryAction::Ignore
        );
    }

    #[test]
    fn repeated_crashes_quit_instead_of_looping() {
        let mut policy = RecoveryPolicy::default();
        let start = Instant::now();
        for offset in 0..MAX_RELOADS_IN_WINDOW as u64 {
            assert_eq!(
                policy.decide(RendererStop::Crashed, start + Duration::from_secs(offset)),
                RecoveryAction::Reload
            );
        }
        assert_eq!(
            policy.decide(RendererStop::Crashed, start + Duration::from_secs(10)),
            RecoveryAction::Quit
        );
    }

    #[test]
    fn crashes_spread_over_time_keep_reloading() {
        let mut policy = RecoveryPolicy::default();
        let start = Instant::now();
        for round in 0..10u64 {
            assert_eq!(
                policy.decide(RendererStop::Crashed, start + CRASH_WINDOW * round as u32),
                RecoveryAction::Reload
            );
        }
    }
}
