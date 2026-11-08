use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

const REMOTE: &str = "https://example.test/owned/project.git";
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Fixture {
    dir: PathBuf,
    repo: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "khronos-link-inspection-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&dir).unwrap();
        let repo = dir.join("repository");
        fs::create_dir(&repo).unwrap();
        fs::write(dir.join("empty-config"), b"").unwrap();
        let fixture = Self { dir, repo };
        fixture.git(&["-c", "init.templateDir=", "init", "-q", "-b", "main"]);
        for (key, value) in [
            ("user.name", "Owned Link Fixture"),
            ("user.email", "owned@example.test"),
            ("commit.gpgsign", "false"),
        ] {
            fixture.git(&["config", key, value]);
        }
        fixture.git(&[
            "config",
            "core.hooksPath",
            fixture.dir.join("no-hooks").to_str().unwrap(),
        ]);
        fixture.git(&["remote", "add", "origin", REMOTE]);
        fixture
    }
    fn command(&self, path: &Path, args: &[&str]) -> Command {
        let mut command = git_in(path);
        command
            .args(args)
            .env("GIT_CONFIG_GLOBAL", self.dir.join("empty-config"))
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_TERMINAL_PROMPT", "0");
        command
    }
    fn git_at(&self, path: &Path, args: &[&str]) -> String {
        let output = self.command(path, args).output().unwrap();
        assert!(
            output.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().into()
    }
    fn git(&self, args: &[&str]) -> String {
        self.git_at(&self.repo, args)
    }
    fn commit(&self) -> String {
        fs::write(self.repo.join("owned-file"), b"owned\n").unwrap();
        self.git(&["add", "--all"]);
        self.git(&["commit", "-qm", "Owned commit"]);
        self.git(&["rev-parse", "HEAD"])
    }
    fn inspect_at(&self, path: &Path, target: RepositoryLinkTarget) -> RepositoryLinkInspection {
        inspect_repository_link(
            path,
            &create_repository_link(REMOTE, &target).unwrap(),
            &CancellationToken::default(),
        )
        .unwrap()
    }
    fn inspect(&self, target: RepositoryLinkTarget) -> RepositoryLinkInspection {
        self.inspect_at(&self.repo, target)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn repository_link_inspection_supports_empty_and_dirty_repositories_without_writes() {
    let f = Fixture::new();
    assert_eq!(
        f.inspect(RepositoryLinkTarget::Repository {}).target,
        RepositoryLinkTargetState::Repository
    );
    let oid = f.commit();
    fs::write(f.repo.join("owned-file"), b"retained dirty bytes\0").unwrap();
    let index = fs::read(f.repo.join(".git/index")).unwrap();
    let config = fs::read(f.repo.join(".git/config")).unwrap();
    let refs = f.git(&["show-ref"]);
    let result = f.inspect(RepositoryLinkTarget::Commit { oid: oid.clone() });
    assert_eq!(result.matched_remotes, vec!["origin"]);
    assert_eq!(result.target, RepositoryLinkTargetState::Commit { oid });
    assert!(!result.bare);
    assert_eq!(fs::read(f.repo.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(f.repo.join(".git/config")).unwrap(), config);
    assert_eq!(
        fs::read(f.repo.join("owned-file")).unwrap(),
        b"retained dirty bytes\0"
    );
    assert_eq!(f.git(&["show-ref"]), refs);
}

#[test]
fn repository_link_inspection_resolves_branches_and_annotated_tags_to_commits_only() {
    let f = Fixture::new();
    let oid = f.commit();
    f.git(&["tag", "-a", "release", "-m", "Owned tag"]);
    for reference in ["refs/heads/main", "refs/tags/release"] {
        assert_eq!(
            f.inspect(RepositoryLinkTarget::Reference {
                reference: reference.into()
            })
            .target,
            RepositoryLinkTargetState::Commit { oid: oid.clone() }
        );
    }
    let blob = f.git(&["rev-parse", "HEAD:owned-file"]);
    f.git(&["tag", "blob-tag", &blob]);
    for target in [
        RepositoryLinkTarget::Reference {
            reference: "refs/tags/missing".into(),
        },
        RepositoryLinkTarget::Reference {
            reference: "refs/tags/blob-tag".into(),
        },
        RepositoryLinkTarget::Commit { oid: blob },
        RepositoryLinkTarget::Commit {
            oid: "a".repeat(40),
        },
    ] {
        assert!(matches!(
            f.inspect(target).target,
            RepositoryLinkTargetState::Unavailable { .. }
        ));
    }
    assert_eq!(f.git(&["symbolic-ref", "HEAD"]), "refs/heads/main");
    assert_eq!(f.git(&["rev-parse", "HEAD"]), oid);
}

#[test]
fn repository_link_inspection_matches_effective_first_fetch_url_and_owned_includes() {
    let f = Fixture::new();
    f.commit();
    f.git(&["config", "remote.origin.url", "owned-alias:project.git"]);
    f.git(&[
        "config",
        "url.https://example.test/owned/.insteadOf",
        "owned-alias:",
    ]);
    assert_eq!(
        f.inspect(RepositoryLinkTarget::Repository {})
            .matched_remotes,
        vec!["origin"]
    );
    f.git(&[
        "config",
        "--add",
        "remote.origin.url",
        "https://elsewhere.test/other.git",
    ]);
    assert_eq!(
        f.inspect(RepositoryLinkTarget::Repository {})
            .matched_remotes,
        vec!["origin"]
    );
    f.git(&["config", "--unset-all", "remote.origin.url"]);
    let include = f.dir.join("owned-include");
    fs::write(&include, format!("[remote \"included\"]\nurl = {REMOTE}\n")).unwrap();
    f.git(&["config", "include.path", include.to_str().unwrap()]);
    assert_eq!(
        f.inspect(RepositoryLinkTarget::Repository {})
            .matched_remotes,
        vec!["included"]
    );
}

#[test]
fn repository_link_inspection_does_not_match_secondary_urls_or_unrelated_names() {
    let f = Fixture::new();
    f.commit();
    for other in [
        "https://elsewhere.test/owned/project.git",
        "https://example.test/other/project.git",
        "ssh://git@example.test/owned/project.git",
        "https://example.test/Owned/project.git",
    ] {
        f.git(&["config", "remote.origin.url", other]);
        assert_eq!(
            f.inspect(RepositoryLinkTarget::Repository {}).target,
            RepositoryLinkTargetState::NotMatched
        );
    }
    f.git(&["config", "--add", "remote.origin.url", REMOTE]);
    assert_eq!(
        f.inspect(RepositoryLinkTarget::Repository {}).target,
        RepositoryLinkTargetState::NotMatched
    );
    f.git(&["config", "--unset-all", "remote.origin.url"]);
    assert_eq!(
        f.inspect(RepositoryLinkTarget::Repository {}).target,
        RepositoryLinkTargetState::NotMatched
    );
}

#[test]
fn repository_link_inspection_handles_bare_and_linked_roots_but_refuses_nested_paths() {
    let f = Fixture::new();
    let oid = f.commit();
    let linked = f.dir.join("linked");
    f.git(&[
        "worktree",
        "add",
        "--detach",
        linked.to_str().unwrap(),
        &oid,
    ]);
    let result = f.inspect_at(&linked, RepositoryLinkTarget::Commit { oid: oid.clone() });
    assert_eq!(
        result.target,
        RepositoryLinkTargetState::Commit { oid: oid.clone() }
    );
    assert_ne!(result.path, f.repo.to_str().unwrap());
    let bare = f.dir.join("bare.git");
    f.git(&[
        "clone",
        "--bare",
        f.repo.to_str().unwrap(),
        bare.to_str().unwrap(),
    ]);
    f.git_at(
        &bare,
        &[
            "--git-dir",
            bare.to_str().unwrap(),
            "remote",
            "set-url",
            "origin",
            REMOTE,
        ],
    );
    let result = f.inspect_at(&bare, RepositoryLinkTarget::Commit { oid });
    assert!(result.bare);
    assert!(matches!(
        result.target,
        RepositoryLinkTargetState::Commit { .. }
    ));
    let nested = f.repo.join("nested");
    fs::create_dir(&nested).unwrap();
    let link = create_repository_link(REMOTE, &RepositoryLinkTarget::Repository {}).unwrap();
    for path in [&nested, &f.repo.join(".git")] {
        assert!(inspect_repository_link(path, &link, &CancellationToken::default()).is_err());
    }
}

#[test]
fn repository_link_inspection_rejects_incomplete_metadata_and_cancels_before_path_reads() {
    let f = Fixture::new();
    f.commit();
    let link = create_repository_link(REMOTE, &RepositoryLinkTarget::Repository {}).unwrap();
    let cancelled = CancellationToken::default();
    cancelled.cancel();
    assert_eq!(
        inspect_repository_link(&f.dir.join("missing"), &link, &cancelled)
            .unwrap_err()
            .kind,
        "operationCancelled"
    );
    assert_eq!(
        inspect_repository_link(&f.dir.join("missing"), "invalid", &cancelled)
            .unwrap_err()
            .kind,
        "invalidRepositoryLink"
    );
    f.git(&[
        "config",
        "remote.origin.url",
        &format!("https://elsewhere.test/a\n{REMOTE}"),
    ]);
    assert_eq!(
        inspect_repository_link(&f.repo, &link, &CancellationToken::default())
            .unwrap_err()
            .kind,
        "repositoryLinkInspectionFailed"
    );
    f.git(&[
        "config",
        "remote.origin.url",
        &format!("https://example.test/{}", "x".repeat(METADATA_LIMIT)),
    ]);
    assert!(inspect_repository_link(&f.repo, &link, &CancellationToken::default()).is_err());
    f.git(&[
        "config",
        "remote.origin.url",
        "https://user:owned-secret@example.test/owned/project.git",
    ]);
    let result = f.inspect(RepositoryLinkTarget::Repository {});
    assert_eq!(result.target, RepositoryLinkTargetState::NotMatched);
    assert!(!format!("{result:?}").contains("owned-secret"));
    f.git(&["config", "remote.origin.url", REMOTE]);
    for index in 0..MAX_REMOTE_NAMES {
        f.git(&["config", &format!("remote.extra-{index}.url"), REMOTE]);
    }
    assert!(inspect_repository_link(&f.repo, &link, &CancellationToken::default()).is_err());
}

#[cfg(unix)]
struct MissingBlob {
    oid: String,
    loose: PathBuf,
    saved: Vec<u8>,
    marker: PathBuf,
}
#[cfg(unix)]
fn missing_blob(f: &Fixture, tagged: bool) -> MissingBlob {
    use std::os::unix::fs::PermissionsExt;
    let oid = f.git(&["rev-parse", "HEAD:owned-file"]);
    if tagged {
        f.git(&["tag", "owned-missing-object", &oid]);
    }
    let loose = f.repo.join(".git/objects").join(&oid[..2]).join(&oid[2..]);
    let saved = fs::read(&loose).unwrap();
    let remote = f.dir.join("owned-promisor.git");
    f.git(&["init", "--bare", remote.to_str().unwrap()]);
    let marker = f.dir.join("unexpected-fetch");
    let helper = f.dir.join("owned-upload-pack");
    let quoted = marker.to_str().unwrap().replace('\'', "'\\''");
    fs::write(
        &helper,
        format!("#!/bin/sh\nprintf owned > '{quoted}'\nexit 1\n"),
    )
    .unwrap();
    fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
    for (key, value) in [
        ("extensions.partialClone", "owned"),
        ("remote.owned.promisor", "true"),
        ("remote.owned.url", remote.to_str().unwrap()),
        ("remote.owned.uploadpack", helper.to_str().unwrap()),
        ("protocol.file.allow", "always"),
    ] {
        f.git(&["config", key, value]);
    }
    fs::remove_file(&loose).unwrap();
    MissingBlob {
        oid,
        loose,
        saved,
        marker,
    }
}

#[test]
#[cfg(unix)]
fn repository_link_inspection_missing_promised_object_never_fetches_or_changes_index() {
    let f = Fixture::new();
    f.commit();
    let object = missing_blob(&f, false);
    let index = fs::read(f.repo.join(".git/index")).unwrap();
    let config = fs::read(f.repo.join(".git/config")).unwrap();
    let inspected = f.inspect(RepositoryLinkTarget::Commit {
        oid: object.oid.clone(),
    });
    assert!(matches!(
        inspected.target,
        RepositoryLinkTargetState::Unavailable { .. }
    ));
    assert!(!object.marker.exists());
    assert!(!object.loose.exists());
    assert_eq!(fs::read(f.repo.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(f.repo.join(".git/config")).unwrap(), config);
    let control = f
        .command(&f.repo, &["cat-file", "-t", &object.oid])
        .env_remove("GIT_NO_LAZY_FETCH")
        .output()
        .unwrap();
    assert!(!control.status.success());
    assert_eq!(fs::read(&object.marker).unwrap(), b"owned");
    fs::write(object.loose, object.saved).unwrap();
}

#[test]
#[cfg(unix)]
fn no_lazy_fetch_scopes_are_reentrant_and_restore_behavior_after_unwinding() {
    for outer_panic in [false, true] {
        let f = Fixture::new();
        f.commit();
        let object = missing_blob(&f, false);
        let result = std::panic::catch_unwind(|| {
            without_lazy_fetch(|| {
                assert!(
                    !run_git(&f.repo, &["cat-file", "-t", &object.oid])
                        .unwrap()
                        .status
                        .success()
                );
                assert!(!object.marker.exists());
                let nested = std::panic::catch_unwind(|| {
                    without_lazy_fetch(|| panic!("owned nested unwind"))
                });
                assert!(nested.is_err());
                assert!(
                    !run_git(&f.repo, &["cat-file", "-t", &object.oid])
                        .unwrap()
                        .status
                        .success()
                );
                assert!(!object.marker.exists());
                if outer_panic {
                    panic!("owned outer unwind");
                }
            })
        });
        assert_eq!(result.is_err(), outer_panic);
        assert!(
            !run_git(&f.repo, &["cat-file", "-t", &object.oid])
                .unwrap()
                .status
                .success()
        );
        assert_eq!(fs::read(object.marker).unwrap(), b"owned");
    }
}

#[test]
#[cfg(unix)]
fn no_lazy_fetch_scope_does_not_change_another_workers_git_policy() {
    let f = Fixture::new();
    f.commit();
    let object = missing_blob(&f, false);
    without_lazy_fetch(|| {
        assert!(
            !run_git(&f.repo, &["cat-file", "-t", &object.oid])
                .unwrap()
                .status
                .success()
        );
        assert!(!object.marker.exists());
        std::thread::scope(|scope| {
            scope
                .spawn(|| {
                    assert!(
                        !run_git(&f.repo, &["cat-file", "-t", &object.oid])
                            .unwrap()
                            .status
                            .success()
                    );
                })
                .join()
                .unwrap();
        });
        assert_eq!(fs::read(&object.marker).unwrap(), b"owned");
        fs::remove_file(&object.marker).unwrap();
        assert!(
            !run_git(&f.repo, &["cat-file", "-t", &object.oid])
                .unwrap()
                .status
                .success()
        );
        assert!(!object.marker.exists());
    });
}

#[test]
#[cfg(unix)]
fn no_lazy_fetch_snapshot_scope_covers_its_composed_reference_readers() {
    let f = Fixture::new();
    f.commit();
    let object = missing_blob(&f, true);
    let index = fs::read(f.repo.join(".git/index")).unwrap();
    let config = fs::read(f.repo.join(".git/config")).unwrap();
    let _ = without_lazy_fetch(|| snapshot(&f.repo));
    assert!(!object.marker.exists());
    assert!(!object.loose.exists());
    assert_eq!(fs::read(f.repo.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(f.repo.join(".git/config")).unwrap(), config);
    let _ = snapshot(&f.repo);
    assert_eq!(
        fs::read(object.marker).unwrap(),
        b"owned",
        "ordinary snapshot must exercise the fetch sentinel"
    );
}

#[test]
#[cfg(unix)]
fn no_lazy_fetch_scope_still_permits_an_explicit_owned_fetch() {
    let f = Fixture::new();
    f.commit();
    let object = missing_blob(&f, false);
    without_lazy_fetch(|| {
        assert!(
            !run_git(&f.repo, &["cat-file", "-t", &object.oid])
                .unwrap()
                .status
                .success()
        );
        assert!(!object.marker.exists());
        assert!(
            matches!(run_git(&f.repo, &["fetch", "owned"]), Err(error) if error.kind == "gitTransportFailure")
        );
        assert_eq!(fs::read(&object.marker).unwrap(), b"owned");
    });
}

#[test]
#[cfg(unix)]
fn no_lazy_fetch_cancellable_composition_stops_a_blocked_git_reader_without_releasing_input() {
    let f = Fixture::new();
    f.commit();
    let fifo = f.dir.join("owned-held-config");
    rustix::fs::mknodat(
        rustix::fs::CWD,
        &fifo,
        rustix::fs::FileType::Fifo,
        rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
        0,
    )
    .unwrap();
    f.git(&["config", "include.path", fifo.to_str().unwrap()]);
    let cancellation = CancellationToken::default();
    let token = cancellation.clone();
    let path = f.repo.clone();
    let (sent, received) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        let result = without_lazy_fetch_cancellable(&token, || {
            run_git(&path, &["config", "--get", "user.name"])
        });
        sent.send(result).unwrap();
    });
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    let writer = loop {
        match rustix::fs::open(
            &fifo,
            rustix::fs::OFlags::WRONLY | rustix::fs::OFlags::NONBLOCK,
            rustix::fs::Mode::empty(),
        ) {
            Ok(writer) => break Some(writer),
            Err(rustix::io::Errno::NXIO) if std::time::Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(10))
            }
            _ => break None,
        }
    };
    cancellation.cancel();
    // Keep the writer alive: only cancellation can release the active Git read.
    let result = received.recv_timeout(Duration::from_secs(3));
    let observed_reader = writer.is_some();
    drop(writer);
    worker.join().unwrap();
    assert!(
        observed_reader,
        "the owned Git reader never opened its FIFO include"
    );
    assert_eq!(
        result
            .expect("cancellation must stop Git before input is released")
            .unwrap_err()
            .kind,
        "operationCancelled"
    );
}

#[test]
fn repository_link_inspection_matches_scp_addresses_without_contacting_ssh() {
    let f = Fixture::new();
    f.commit();
    f.git(&[
        "config",
        "remote.origin.url",
        "git@EXAMPLE.TEST:Owned/project.git",
    ]);
    let link = create_repository_link(
        "git@example.test:Owned/project.git",
        &RepositoryLinkTarget::Repository {},
    )
    .unwrap();
    let result = inspect_repository_link(&f.repo, &link, &CancellationToken::default()).unwrap();
    assert_eq!(result.matched_remotes, vec!["origin"]);
}
