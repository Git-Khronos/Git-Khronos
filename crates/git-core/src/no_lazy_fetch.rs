//! Thread-bound Git policy for composed, fetch-free repository inspection.
use std::cell::Cell;
thread_local! { static DISABLED: Cell<bool> = const { Cell::new(false) }; }

pub(super) fn enabled() -> bool {
    DISABLED.with(Cell::get)
}

/// Disable implicit promisor fetching for Git commands on this worker.
/// Nested scopes restore their predecessor, including during unwinding. No process
/// environment is mutated. Repository snapshots use serial readers in this scope;
/// callers must not expect it to propagate into an independently spawned worker.
/// Explicit user-requested fetches are still permitted by Git.
pub fn without_lazy_fetch<T>(action: impl FnOnce() -> T) -> T {
    struct Restore(bool);
    impl Drop for Restore {
        fn drop(&mut self) {
            DISABLED.with(|slot| slot.set(self.0));
        }
    }
    let _restore = Restore(DISABLED.with(|slot| slot.replace(true)));
    action()
}

/// Compose cancellable inspection on the current worker with implicit fetch disabled.
/// Keep this scope inside the background closure, never across an await.
pub fn without_lazy_fetch_cancellable<T>(
    cancellation: &super::CancellationToken,
    action: impl FnOnce() -> Result<T, super::AppError>,
) -> Result<T, super::AppError> {
    if cancellation.is_cancelled() {
        return Err(super::operation_cancelled());
    }
    super::git_cancellation::with(Some(cancellation), || {
        without_lazy_fetch(|| {
            let result = action();
            if cancellation.is_cancelled() {
                Err(super::operation_cancelled())
            } else {
                result
            }
        })
    })
}
