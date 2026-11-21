//! A failed watch must not discard notifications from other paths.
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};

pub(super) struct RepositoryWatcher {
    backend: RecommendedWatcher,
    coverage: WatchCoverage,
}

#[derive(Default)]
struct WatchCoverage {
    registered: Vec<(PathBuf, RecursiveMode)>,
    complete: bool,
}

impl WatchCoverage {
    fn attach(
        &mut self,
        paths: impl IntoIterator<Item = (PathBuf, RecursiveMode)>,
        metadata_discovered: bool,
        mut watch: impl FnMut(&Path, RecursiveMode) -> notify::Result<()>,
    ) {
        let mut complete = metadata_discovered;
        for (path, mode) in paths {
            if self
                .registered
                .iter()
                .any(|entry| entry.0 == path && entry.1 == mode)
            {
                continue;
            }
            if watch(&path, mode).is_ok() {
                self.registered.push((path, mode));
            } else {
                // Keep earlier paths alive and still try the later ones.
                complete = false;
            }
        }
        self.complete = complete;
    }
}

impl RepositoryWatcher {
    pub(super) fn new(backend: RecommendedWatcher) -> Self {
        Self {
            backend,
            coverage: WatchCoverage::default(),
        }
    }

    pub(super) fn is_complete(&self) -> bool {
        self.coverage.complete
    }

    pub(super) fn attach(
        &mut self,
        paths: impl IntoIterator<Item = (PathBuf, RecursiveMode)>,
        metadata_discovered: bool,
    ) {
        self.coverage
            .attach(paths, metadata_discovered, |path, mode| {
                self.backend.watch(path, mode)
            });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::EventKind;
    use std::fs;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    #[test]
    fn partial_coverage_keeps_notifying_and_retries_only_the_missing_path() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path().join("working");
        let missing = fixture.path().join("temporarily-unavailable");
        let metadata = fixture.path().join("other-metadata");
        for path in [&root, &metadata] {
            fs::create_dir(path).unwrap();
        }
        let paths = [
            (root.clone(), RecursiveMode::NonRecursive),
            (missing.clone(), RecursiveMode::Recursive),
            (metadata.clone(), RecursiveMode::NonRecursive),
        ];
        let (send, receive) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(send).unwrap();
        let mut coverage = WatchCoverage::default();
        coverage.attach(paths.clone(), true, |path, mode| watcher.watch(path, mode));
        assert!(!coverage.complete);
        assert_eq!(coverage.registered, [paths[0].clone(), paths[2].clone()]);

        let identifiers = [
            root.join("working-change"),
            metadata.join("metadata-change"),
        ];
        for path in &identifiers {
            fs::write(path, "changed").unwrap();
        }
        let mut notified = [false; 2];
        let deadline = Instant::now() + Duration::from_secs(5);
        while !notified.iter().all(|present| *present) && Instant::now() < deadline {
            match receive.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                Ok(Ok(event)) if !matches!(event.kind, EventKind::Access(_)) => {
                    for (index, path) in identifiers.iter().enumerate() {
                        notified[index] |= event.paths.contains(path);
                    }
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        assert_eq!(
            notified,
            [true, true],
            "a failed path retired a healthy watch"
        );

        fs::create_dir(&missing).unwrap();
        let mut attempts = Vec::new();
        coverage.attach(paths, true, |path, mode| {
            attempts.push(path.to_owned());
            watcher.watch(path, mode)
        });
        assert_eq!(attempts, [missing]);
        assert!(coverage.complete);
    }

    #[test]
    fn metadata_lookup_failure_marks_coverage_incomplete_without_losing_the_root() {
        let mut coverage = WatchCoverage::default();
        let root = PathBuf::from("worktree");
        let paths = [(root, RecursiveMode::NonRecursive)];
        coverage.attach(paths.clone(), false, |_, _| Ok(()));
        assert_eq!(coverage.registered, paths);
        assert!(!coverage.complete);
        coverage.attach(paths, true, |_, _| {
            panic!("a working root must not be registered twice")
        });
        assert!(coverage.complete);
    }
}
