use crate::{
    AppError, CommitSummary, decode_nul_record, ensure_success, run_git, validate_commit_oid,
};
use gix::refs::Target;
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::Stdio,
    thread,
};

const PREFIX: &str = "refs/original/";

fn refused(message: impl Into<String>) -> AppError {
    AppError::new(
        "originalReferenceRefused",
        message,
        Some("Refresh history and review the full original reference again."),
    )
}

/// Decorations from `%D` are display text, not reference identities. Append
/// these only after parsing it, so even comma-containing names remain intact.
pub(crate) fn decorate(path: &Path, commits: &mut [CommitSummary]) -> Result<(), AppError> {
    let output = run_git(
        path,
        &[
            "for-each-ref",
            "--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)%00%(*objectname)%00%(*objecttype)%00",
            PREFIX,
        ],
    )?;
    ensure_success("read original references", &output)?;
    let mut bytes = output.stdout.as_slice();
    while !bytes.is_empty() {
        let fields = decode_nul_record::<6>(&mut bytes)
            .ok_or_else(|| refused("Git returned an incomplete original-reference record."))?;
        if !fields[0].starts_with(PREFIX.as_bytes()) {
            return Err(refused("Git returned a reference outside refs/original/."));
        }
        let commit_oid = match fields[2] {
            b"commit" => fields[1].to_vec(),
            b"tag" if fields[5] == b"commit" => fields[4].to_vec(),
            b"tag" if fields[5] == b"tag" => {
                let oid = std::str::from_utf8(fields[1]).map_err(|_| {
                    refused("Git returned an invalid original-reference object ID.")
                })?;
                validate_commit_oid(oid)?;
                let peeled = run_git(
                    path,
                    &[
                        "rev-parse",
                        "--verify",
                        "--quiet",
                        "--end-of-options",
                        &format!("{oid}^{{commit}}"),
                    ],
                )?;
                if peeled.status.code() == Some(1) {
                    continue;
                }
                ensure_success("inspect an annotated original reference", &peeled)?;
                peeled.stdout.trim_ascii().to_vec()
            }
            _ => continue,
        };
        let label = if let Ok(reference) = std::str::from_utf8(fields[0]) {
            if fields[2] == b"commit" && fields[3].is_empty() {
                format!("original: {reference}")
            } else {
                format!("Original reference (read-only): {reference}")
            }
        } else {
            "Original reference with non-UTF-8 name (read-only)".into()
        };
        for commit in commits
            .iter_mut()
            .filter(|commit| commit.oid.as_bytes() == commit_oid)
        {
            commit.decorations.push(label.clone());
        }
    }
    Ok(())
}

/// Delete exactly one reviewed direct commit reference, under its ref lock.
/// A symbolic replacement never matches the expected Object target.
pub fn delete_original_reference(
    path: &Path,
    reference: &str,
    expected_oid: &str,
) -> Result<(), AppError> {
    if !reference.starts_with(PREFIX) || reference.len() == PREFIX.len() {
        return Err(refused(
            "Only references under refs/original/ can be deleted here.",
        ));
    }
    gix::refs::FullName::try_from(reference)
        .map_err(|_| refused("That original reference name is invalid."))?;
    validate_commit_oid(expected_oid)?;
    let oid = gix::ObjectId::from_hex(expected_oid.as_bytes())
        .map_err(|_| refused("That original reference object ID is invalid."))?;
    let repository = gix::discover(path)
        .map_err(|error| refused(format!("Could not open the repository: {error}")))?;
    let current = repository
        .find_reference(reference)
        .map_err(|error| refused(format!("Could not read the original reference: {error}")))?;
    if current.target() != Target::Object(oid).to_ref() {
        return Err(refused(
            "The original reference changed, is symbolic, or no longer exists.",
        ));
    }
    let object = repository
        .find_object(oid)
        .map_err(|error| refused(format!("Could not read the reviewed object: {error}")))?;
    if object.kind != gix::object::Kind::Commit {
        return Err(refused(
            "Only original references pointing directly to commits can be deleted here.",
        ));
    }
    compare_delete(path, reference, oid)
}

fn compare_delete(path: &Path, reference: &str, oid: gix::ObjectId) -> Result<(), AppError> {
    let uncertain = |detail: String| {
        AppError::new(
            "originalReferenceDeleteUnconfirmed",
            format!("Original-reference deletion could not be confirmed: {detail}"),
            Some(
                "Refresh history and inspect the reference before deciding whether to retry. No automatic retry was made.",
            ),
        )
    };
    let mut child = crate::git_in(path)
        .args(["update-ref", "--stdin"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| refused(format!("Could not start Git: {error}")))?;
    let mut input = child.stdin.take().expect("piped stdin");
    let mut output = BufReader::new(child.stdout.take().expect("piped stdout"));
    let mut error = child.stderr.take().expect("piped stderr");
    thread::scope(|scope| {
        let errors = scope.spawn(move || {
            let mut bytes = Vec::new();
            error.read_to_end(&mut bytes).map(|_| bytes)
        });
        let result = (|| {
            write!(
                input,
                "start\noption no-deref\ndelete {reference} {oid}\nprepare\n"
            )
            .and_then(|_| input.flush())
            .map_err(|error| uncertain(error.to_string()))?;
            expect_reply(&mut output, "start: ok").map_err(uncertain)?;
            expect_reply(&mut output, "prepare: ok").map_err(uncertain)?;
            // Git now holds the ref lock and has run the prepared hook. Older
            // Git versions compare OIDs through symrefs even with no-deref;
            // inspect the direct target under this lock before permitting commit.
            let repository = gix::discover(path).map_err(|error| {
                refused(format!("Could not inspect the locked reference: {error}"))
            })?;
            let current = repository.find_reference(reference).map_err(|error| {
                refused(format!("Could not inspect the locked reference: {error}"))
            })?;
            if current.target() != Target::Object(oid).to_ref() {
                return Err(refused(
                    "The original reference changed or became symbolic. No deletion was committed.",
                ));
            }
            input
                .write_all(b"commit\n")
                .and_then(|_| input.flush())
                .map_err(|error| uncertain(error.to_string()))?;
            expect_reply(&mut output, "commit: ok").map_err(uncertain)
        })();
        // EOF aborts a prepared but uncommitted transaction, including all
        // refusal/error paths above. Always reap Git and drain hook diagnostics.
        drop(input);
        drop(output);
        let status = child.wait();
        let diagnostics = errors
            .join()
            .map_err(|_| uncertain("Could not read Git diagnostics.".into()))?
            .map_err(|error| uncertain(error.to_string()))?;
        let status = status.map_err(|error| uncertain(error.to_string()))?;
        if !status.success() {
            return Err(uncertain(
                String::from_utf8_lossy(&diagnostics).trim().to_owned(),
            ));
        }
        result
    })
}

fn expect_reply(output: &mut impl BufRead, expected: &str) -> Result<(), String> {
    loop {
        let mut line = String::new();
        if output
            .read_line(&mut line)
            .map_err(|error| error.to_string())?
            == 0
        {
            return Err(format!("Git did not confirm {expected}."));
        }
        if line.trim_end() == expected {
            return Ok(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    struct Fixture(PathBuf);
    impl Fixture {
        fn new(format: &str) -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "git-khronos-original-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            let fixture = Self(path);
            fixture.git(&["init", "-b", "main", &format!("--object-format={format}")]);
            fixture.git(&["config", "user.name", "Fixture"]);
            fixture.git(&["config", "user.email", "fixture@example.invalid"]);
            fixture.git(&["commit", "--allow-empty", "-m", "root"]);
            fixture
        }
        fn git(&self, args: &[&str]) -> String {
            let output = crate::git_in(&self.0).args(args).output().unwrap();
            assert!(
                output.status.success(),
                "{args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8(output.stdout).unwrap().trim().to_owned()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn original_reference_canonical_identity_survives_commas_collisions_and_visibility_modes() {
        let fixture = Fixture::new("sha1");
        let head = fixture.git(&["rev-parse", "HEAD"]);
        let reference = "refs/original/refs/heads/dev,backup";
        fixture.git(&["update-ref", reference, &head]);
        // Both the short spelling and the full-looking spelling can be branches.
        fixture.git(&["branch", "original/refs/heads/dev,backup"]);
        fixture.git(&["branch", reference]);
        fixture.git(&["update-ref", "refs/copilot/checkpoints/fixture", &head]);
        for show in [false, true] {
            let history =
                crate::read_commits_with_checkpoint_visibility(&fixture.0, 10, show).unwrap();
            let original = history[0]
                .decorations
                .iter()
                .filter(|item| item.starts_with("original: "))
                .collect::<Vec<_>>();
            assert_eq!(original, vec![&format!("original: {reference}")]);
            let mut cursor = crate::CommitHistoryCursor::default();
            cursor
                .reset_with_checkpoint_visibility(&fixture.0, &[], show)
                .unwrap();
            let page = cursor.next_page(&fixture.0, 10).unwrap();
            assert!(
                page.commits[0]
                    .decorations
                    .contains(&format!("original: {reference}"))
            );
        }
        delete_original_reference(&fixture.0, reference, &head).unwrap();
        assert_eq!(
            fixture.git(&["rev-parse", &format!("refs/heads/{reference}")]),
            head
        );
        assert_eq!(
            fixture.git(&["rev-parse", "refs/heads/original/refs/heads/dev,backup"]),
            head
        );
    }

    #[test]
    fn original_reference_deletion_is_narrow_and_compare_guarded_in_both_object_formats() {
        for format in ["sha1", "sha256"] {
            for packed in [false, true] {
                let fixture = Fixture::new(format);
                let old = fixture.git(&["rev-parse", "HEAD"]);
                fixture.git(&["commit", "--allow-empty", "-m", "next"]);
                let head = fixture.git(&["rev-parse", "HEAD"]);
                let reference = "refs/original/refs/heads/dev";
                let sibling = "refs/original/refs/heads/keep";
                for name in [
                    reference,
                    sibling,
                    "refs/tags/keep",
                    "refs/remotes/origin/keep",
                    "refs/git-khronos/recovery/keep",
                    "refs/copilot/checkpoints/keep",
                    "refs/custom/keep",
                ] {
                    fixture.git(&["update-ref", name, &old]);
                }
                if packed {
                    fixture.git(&["pack-refs", "--all"]);
                }
                for name in [
                    "refs/heads/main",
                    "refs/tags/keep",
                    "refs/remotes/origin/keep",
                    "refs/git-khronos/recovery/keep",
                    "refs/copilot/checkpoints/keep",
                    "refs/custom/keep",
                    "refs/original",
                    "refs/original/../heads/main",
                    "refs/original/",
                ] {
                    assert!(delete_original_reference(&fixture.0, name, &head).is_err());
                }
                assert!(delete_original_reference(&fixture.0, reference, &head).is_err());
                assert_eq!(fixture.git(&["rev-parse", reference]), old);
                delete_original_reference(&fixture.0, reference, &old).unwrap();
                assert!(delete_original_reference(&fixture.0, reference, &old).is_err());
                assert_eq!(fixture.git(&["rev-parse", sibling]), old);
                assert_eq!(fixture.git(&["rev-parse", "HEAD"]), head);
                assert_eq!(fixture.git(&["cat-file", "-t", &old]), "commit");
                assert!(
                    fixture
                        .git(&[
                            "for-each-ref",
                            "--format=%(refname)",
                            "refs/git-khronos/recovery/"
                        ])
                        .lines()
                        .eq(["refs/git-khronos/recovery/keep"])
                );
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn original_reference_respects_configured_transaction_hook_rejection_and_auditing() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = Fixture::new("sha1");
        let reference = "refs/original/refs/heads/dev";
        let head = fixture.git(&["rev-parse", "HEAD"]);
        fixture.git(&["update-ref", reference, &head]);
        let hooks = fixture.0.join("owned-hooks");
        fs::create_dir(&hooks).unwrap();
        let hook = hooks.join("reference-transaction");
        fs::write(&hook, "#!/bin/sh\nprintf '%s\\n' \"$1\" >> .git/owned-hook-audit\ncat >> .git/owned-hook-audit\nif test \"$1\" = prepared && test -f .git/owned-hook-reject; then exit 1; fi\n").unwrap();
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o700)).unwrap();
        fixture.git(&["config", "core.hooksPath", "owned-hooks"]);
        fs::write(fixture.0.join(".git/owned-hook-reject"), "").unwrap();
        assert!(delete_original_reference(&fixture.0, reference, &head).is_err());
        assert_eq!(fixture.git(&["rev-parse", reference]), head);
        let audit = fs::read_to_string(fixture.0.join(".git/owned-hook-audit")).unwrap();
        assert!(audit.contains("prepared") && audit.contains(reference));
        assert!(!audit.contains("committed"));
        fs::remove_file(fixture.0.join(".git/owned-hook-reject")).unwrap();
        fs::write(fixture.0.join(".git/owned-hook-audit"), "").unwrap();
        delete_original_reference(&fixture.0, reference, &head).unwrap();
        let audit = fs::read_to_string(fixture.0.join(".git/owned-hook-audit")).unwrap();
        assert!(audit.contains("prepared") && audit.contains("committed"));
        assert!(audit.contains(&format!("{head} {} {reference}", "0".repeat(40))));
    }

    #[cfg(unix)]
    #[test]
    fn original_reference_opaque_names_keep_history_readable_without_lossy_deletion_authority() {
        use std::{ffi::OsString, os::unix::ffi::OsStringExt};
        let fixture = Fixture::new("sha1");
        let reference = OsString::from_vec(b"refs/original/refs/heads/opaque-\xff".to_vec());
        let output = crate::git_in(&fixture.0)
            .arg("update-ref")
            .arg(&reference)
            .arg("HEAD")
            .output()
            .unwrap();
        assert!(output.status.success());
        for show in [false, true] {
            let history =
                crate::read_commits_with_checkpoint_visibility(&fixture.0, 10, show).unwrap();
            assert_eq!(history.len(), 1);
            assert!(
                history[0]
                    .decorations
                    .iter()
                    .any(|label| label.contains("non-UTF-8") && label.contains("read-only"))
            );
            assert!(
                !history[0]
                    .decorations
                    .iter()
                    .any(|label| label.starts_with("original: "))
            );
        }
        let head = fixture.git(&["rev-parse", "HEAD"]);
        assert!(
            delete_original_reference(&fixture.0, &reference.to_string_lossy(), &head).is_err()
        );
        let output = crate::git_in(&fixture.0)
            .arg("rev-parse")
            .arg("--verify")
            .arg(&reference)
            .output()
            .unwrap();
        assert!(output.status.success());
    }

    #[test]
    fn original_reference_symbolic_and_annotated_tag_decorations_remain_read_only() {
        let fixture = Fixture::new("sha1");
        let head = fixture.git(&["rev-parse", "HEAD"]);
        fixture.git(&["tag", "-a", "inner", "-m", "inner annotation"]);
        fixture.git(&["tag", "-a", "outer", "inner", "-m", "nested annotation"]);
        let tag = fixture.git(&["rev-parse", "refs/tags/outer"]);
        let tag_ref = "refs/original/refs/tags/outer";
        let simple_tag_ref = "refs/original/refs/tags/inner";
        let symbolic_ref = "refs/original/symbolic";
        fixture.git(&["update-ref", tag_ref, &tag]);
        fixture.git(&["update-ref", simple_tag_ref, "refs/tags/inner"]);
        fixture.git(&["symbolic-ref", symbolic_ref, "refs/heads/main"]);
        // Characterize Git's pre-feature decoration behavior, without the new exclusion.
        let mut before_args = vec!["log"];
        crate::add_history_format_arguments(&mut before_args, true);
        before_args.retain(|argument| *argument != "--decorate-refs-exclude=refs/original/*");
        before_args.push("--all");
        let before = fixture.git(&before_args);
        assert!(
            before.contains(tag_ref) && before.contains(symbolic_ref),
            "{before}"
        );
        for show in [false, true] {
            let history =
                crate::read_commits_with_checkpoint_visibility(&fixture.0, 10, show).unwrap();
            for reference in [tag_ref, simple_tag_ref, symbolic_ref] {
                assert!(
                    history[0]
                        .decorations
                        .iter()
                        .any(|label| label.contains(reference) && label.contains("read-only"))
                );
            }
            assert!(
                !history[0]
                    .decorations
                    .iter()
                    .any(|label| label.starts_with("original: "))
            );
        }
        assert!(delete_original_reference(&fixture.0, tag_ref, &head).is_err());
        assert!(delete_original_reference(&fixture.0, symbolic_ref, &head).is_err());
        assert_eq!(fixture.git(&["rev-parse", tag_ref]), tag);
        assert_eq!(
            fixture.git(&["symbolic-ref", symbolic_ref]),
            "refs/heads/main"
        );
    }

    #[test]
    fn original_reference_rejects_symbolic_and_non_commit_targets_including_atomic_replacements() {
        let fixture = Fixture::new("sha1");
        let head = fixture.git(&["rev-parse", "HEAD"]);
        let reference = "refs/original/refs/heads/dev";
        fixture.git(&["symbolic-ref", reference, "refs/heads/main"]);
        assert!(delete_original_reference(&fixture.0, reference, &head).is_err());
        let oid = gix::ObjectId::from_hex(head.as_bytes()).unwrap();
        // Exercise the locked lease itself after a direct ref was replaced by a symref.
        assert!(compare_delete(&fixture.0, reference, oid).is_err());
        assert_eq!(fixture.git(&["symbolic-ref", reference]), "refs/heads/main");
        fixture.git(&["symbolic-ref", "--delete", reference]);
        fixture.git(&["commit", "--allow-empty", "-m", "new tip"]);
        fixture.git(&["update-ref", reference, "HEAD"]);
        assert!(compare_delete(&fixture.0, reference, oid).is_err());
        assert_eq!(
            fixture.git(&["rev-parse", reference]),
            fixture.git(&["rev-parse", "HEAD"])
        );
        let tree = fixture.git(&["rev-parse", "HEAD^{tree}"]);
        fixture.git(&["update-ref", reference, &tree]);
        assert!(delete_original_reference(&fixture.0, reference, &tree).is_err());
        fixture.git(&["tag", "-a", "fixture", "-m", "annotated"]);
        let tag = fixture.git(&["rev-parse", "refs/tags/fixture"]);
        fixture.git(&["update-ref", reference, &tag]);
        assert!(delete_original_reference(&fixture.0, reference, &tag).is_err());
        fs::write(fixture.0.join("blob"), "fixture\n").unwrap();
        let blob = fixture.git(&["hash-object", "-w", "blob"]);
        fixture.git(&["update-ref", reference, &blob]);
        assert!(delete_original_reference(&fixture.0, reference, &blob).is_err());
        let history =
            crate::read_commits_with_checkpoint_visibility(&fixture.0, 10, false).unwrap();
        assert!(history.iter().all(|commit| {
            !commit
                .decorations
                .iter()
                .any(|item| item.starts_with("original: "))
        }));
    }
}
