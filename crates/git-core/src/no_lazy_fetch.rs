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
