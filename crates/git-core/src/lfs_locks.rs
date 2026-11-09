use super::*;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LfsLock {
    pub id: String,
    pub path: String,
    pub owner: String,
    pub locked_at: String,
    pub ours: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LfsLocks {
    pub locks: Vec<LfsLock>,
}

#[derive(Deserialize, specta::Type)]
struct RawOwner {
    #[serde(default)]
    name: String,
}

#[derive(Deserialize, specta::Type)]
struct RawLock {
    id: String,
    path: String,
    #[serde(default)]
    owner: Option<RawOwner>,
    #[serde(default)]
    locked_at: String,
}

#[derive(Deserialize, specta::Type)]
struct RawVerified {
    #[serde(default)]
    ours: Vec<RawLock>,
    #[serde(default)]
    theirs: Vec<RawLock>,
}

#[derive(Deserialize, specta::Type)]
struct RawUnlock {
    #[serde(default)]
    unlocked: bool,
}

const MAX_LOCKS: usize = 2_000;

/// Lists server locks with ownership verified by the LFS server. Git LFS 3.x
/// prints an empty JSON result with exit 0 when the request fails, so a
/// plain-text verification run follows to surface unreachable or unsupported
/// locking endpoints instead of presenting "no locks".
pub fn lfs_locks(path: &Path) -> Result<LfsLocks, AppError> {
    ensure_lfs_available(path)?;
    let (output, truncated) = run_git_with_stdout_limit(
        path,
        &["lfs", "locks", "--verify", "--json"],
        2 * 1024 * 1024,
    )
    .map_err(locks_unavailable)?;
    if truncated {
        return Err(AppError::new(
            "lfsLocksTooLarge",
            "The LFS lock list exceeds the safe inspection limit.",
            Some("Inspect locks with local git lfs locks. No partial list was presented."),
        ));
    }
    ensure_success("list Git LFS locks", &output).map_err(locks_unavailable)?;
    let probe =
        run_git(path, &["lfs", "locks", "--verify", "--limit=1"]).map_err(locks_unavailable)?;
    ensure_success("verify Git LFS locks", &probe).map_err(locks_unavailable)?;
    parse_locks(&output.stdout)
}

pub(super) fn parse_locks(bytes: &[u8]) -> Result<LfsLocks, AppError> {
    let invalid = |message: String| {
        AppError::new(
            "unsupportedLfsLockOutput",
            format!("Git LFS returned an unsupported lock list: {message}"),
            Some("Use a JSON-capable Git LFS version or inspect locks with local Git LFS."),
        )
    };
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|error| invalid(error.to_string()))?;
    if !value.is_object() {
        return Err(invalid("expected an object with ours and theirs".into()));
    }
    let raw: RawVerified =
        serde_json::from_value(value).map_err(|error| invalid(error.to_string()))?;
    if raw.ours.len() + raw.theirs.len() > MAX_LOCKS {
        return Err(invalid(format!(
            "more than {MAX_LOCKS} locks; use local Git LFS"
        )));
    }
    let mut locks = Vec::with_capacity(raw.ours.len() + raw.theirs.len());
    for (entries, ours) in [(raw.ours, true), (raw.theirs, false)] {
        for lock in entries {
            if lock.id.is_empty()
                || lock.id.len() > 256
                || lock.id.contains(['\0', '\n', '\r'])
                || lock.path.is_empty()
                || lock.path.len() > 4096
                || lock.path.contains('\0')
            {
                return Err(invalid("a lock has an invalid identifier or path".into()));
            }
            if locks.iter().any(|known: &LfsLock| known.id == lock.id) {
                return Err(invalid("duplicate lock identifiers".into()));
            }
            locks.push(LfsLock {
                id: lock.id,
                path: lock.path,
                owner: lock.owner.map(|owner| owner.name).unwrap_or_default(),
                locked_at: lock.locked_at,
                ours,
            });
        }
    }
    locks.sort_by(|left, right| left.path.cmp(&right.path).then(left.id.cmp(&right.id)));
    Ok(LfsLocks { locks })
}

pub fn lock_lfs_file(path: &Path, file: &str) -> Result<(), AppError> {
    validate_relative_path(
        file,
        "invalidLfsLockPath",
        "Choose a repository-relative file to lock.",
    )?;
    ensure_lfs_available(path)?;
    let tracked = run_git(
        path,
        &[
            "--literal-pathspecs",
            "ls-files",
            "--error-unmatch",
            "--",
            file,
        ],
    )?;
    if !tracked.status.success() {
        return Err(AppError::new(
            "lfsLockPathNotTracked",
            format!("{file} is not a tracked file in this repository."),
            Some("Lock a committed or staged file. No lock was requested."),
        ));
    }
    if let Some(existing) = lfs_locks(path)?
        .locks
        .into_iter()
        .find(|lock| lock.path == file)
    {
        return Err(if existing.ours {
            AppError::new(
                "lfsLockAlreadyHeld",
                format!("You already hold the lock on {file}."),
                None,
            )
        } else {
            AppError::new(
                "lfsLockOwnedByOther",
                format!(
                    "{file} is already locked by {}.",
                    owner_label(&existing.owner)
                ),
                Some("Coordinate with the owner before editing. No lock was requested."),
            )
        });
    }
    let output = run_git(path, &["lfs", "lock", "--json", "--", file]).map_err(lock_failure)?;
    ensure_success("lock that file", &output).map_err(lock_failure)?;
    let locked: Vec<RawLock> = serde_json::from_slice(&output.stdout).unwrap_or_default();
    if !locked.iter().any(|lock| lock.path == file) {
        return Err(AppError::new(
            "lfsLockUnconfirmed",
            "Git LFS finished without confirming the lock.",
            Some("Refresh the lock list before editing; the lock may not be held."),
        ));
    }
    Ok(())
}

/// Releases a lock reviewed in the latest listing. Locks held by others need an
/// explicit `force`; Git LFS itself refuses to release our lock while the file
/// has uncommitted changes.
pub fn unlock_lfs_file(path: &Path, expected: &LfsLock, force: bool) -> Result<(), AppError> {
    let current = lfs_locks(path)?;
    let Some(lock) = current.locks.iter().find(|lock| lock.id == expected.id) else {
        return Err(AppError::new(
            "lfsLockChanged",
            "That lock is no longer held on the server.",
            Some("Review the refreshed lock list. Nothing was unlocked."),
        ));
    };
    if lock.path != expected.path || lock.ours != expected.ours || lock.owner != expected.owner {
        return Err(AppError::new(
            "lfsLockChanged",
            "That lock changed since it was reviewed.",
            Some("Review the refreshed lock list. Nothing was unlocked."),
        ));
    }
    if !lock.ours && !force {
        return Err(AppError::new(
            "lfsLockOwnedByOther",
            format!("{} is locked by {}.", lock.path, owner_label(&lock.owner)),
            Some("Ask the owner to unlock it, or explicitly force unlock after coordinating."),
        ));
    }
    if !force {
        let status = run_git(
            path,
            &[
                "--literal-pathspecs",
                "status",
                "--porcelain",
                "--untracked-files=no",
                "--",
                &lock.path,
            ],
        )?;
        ensure_success("check the locked file for changes", &status)?;
        if !status.stdout.is_empty() {
            return Err(AppError::new(
                "lfsUnlockDirtyFile",
                format!(
                    "{} has uncommitted changes, so the lock was kept.",
                    lock.path
                ),
                Some("Commit and push the change, or discard it, then unlock."),
            ));
        }
    }
    let id = format!("--id={}", lock.id);
    let mut args = vec!["lfs", "unlock", "--json"];
    if force {
        args.push("--force");
    }
    args.push(&id);
    let output = run_git(path, &args).map_err(lock_failure)?;
    ensure_success("unlock that file", &output).map_err(lock_failure)?;
    let results: Vec<RawUnlock> = serde_json::from_slice(&output.stdout).unwrap_or_default();
    if results.iter().any(|result| result.unlocked) {
        Ok(())
    } else {
        Err(AppError::new(
            "lfsLockUnconfirmed",
            "Git LFS finished without confirming the unlock.",
            Some("Refresh the lock list; the lock may still be held."),
        ))
    }
}

fn owner_label(owner: &str) -> &str {
    if owner.is_empty() {
        "another user"
    } else {
        owner
    }
}

fn lock_failure(mut error: AppError) -> AppError {
    if error.kind == "gitTransportFailure" {
        error.kind = "lfsLockRequestFailed".into();
        error.message = "The LFS server did not complete the lock request.".into();
        error.hint = Some(
            "The server may refuse it, be unreachable, or not support file locking. Refresh locks before retrying."
                .into(),
        );
    }
    error
}

fn locks_unavailable(mut error: AppError) -> AppError {
    if matches!(
        error.kind.as_str(),
        "authenticationRequired"
            | "operationCancelled"
            | "credentialsInUrl"
            | "remoteConfigurationUnavailable"
            | "tlsVerificationFailed"
            | "sshHostTrustRequired"
    ) {
        return error;
    }
    error.kind = "lfsLocksUnavailable".into();
    error.message = "Git LFS could not list file locks from the server.".into();
    error.hint = Some(
        "The LFS server is unreachable, needs credentials, or does not support file locking. No lock state is shown."
            .into(),
    );
    error
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    type Locks = Arc<Mutex<Vec<(String, String, String)>>>;

    #[test]
    fn lock_listing_preserves_actionable_transport_refusals() {
        for kind in [
            "authenticationRequired",
            "operationCancelled",
            "credentialsInUrl",
            "remoteConfigurationUnavailable",
            "tlsVerificationFailed",
            "sshHostTrustRequired",
        ] {
            let error = locks_unavailable(AppError::new(
                kind,
                "Specific refusal",
                Some("Specific recovery"),
            ));
            assert_eq!(error.kind, kind);
            assert_eq!(error.message, "Specific refusal");
            assert_eq!(error.hint.as_deref(), Some("Specific recovery"));
        }
    }

    /// Minimal fixture for the documented Git LFS locking endpoints. Locks owned
    /// by "Tester" are reported as ours; `supported = false` answers 404.
    fn lock_server(supported: bool, locks: Locks) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            let mut next = 100;
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request = String::new();
                if reader.read_line(&mut request).is_err() {
                    continue;
                }
                let mut length = 0;
                loop {
                    let mut header = String::new();
                    reader.read_line(&mut header).unwrap();
                    if header.trim().is_empty() {
                        break;
                    }
                    if let Some(value) = header.to_ascii_lowercase().strip_prefix("content-length:")
                    {
                        length = value.trim().parse().unwrap();
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let body: serde_json::Value = serde_json::from_slice(&body).unwrap_or_default();
                let target = request
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("")
                    .split('?')
                    .next()
                    .unwrap()
                    .to_owned();
                let json = |lock: &(String, String, String)| {
                    serde_json::json!({
                        "id": lock.0, "path": lock.1, "owner": {"name": lock.2}, "locked_at": "2026-10-08T10:00:00Z"
                    })
                };
                let mut held = locks.lock().unwrap();
                let (status, reply) = if !supported {
                    (404, serde_json::json!({"message": "Not found"}))
                } else if request.starts_with("POST") && target.ends_with("/locks/verify") {
                    let (ours, theirs): (Vec<_>, Vec<_>) =
                        held.iter().partition(|lock| lock.2 == "Tester");
                    (
                        200,
                        serde_json::json!({
                            "ours": ours.into_iter().map(json).collect::<Vec<_>>(),
                            "theirs": theirs.into_iter().map(json).collect::<Vec<_>>()
                        }),
                    )
                } else if request.starts_with("POST") && target.ends_with("/locks") {
                    let path = body["path"].as_str().unwrap_or_default().to_owned();
                    if let Some(existing) = held.iter().find(|lock| lock.1 == path) {
                        (
                            409,
                            serde_json::json!({"lock": json(existing), "message": "already created lock"}),
                        )
                    } else {
                        next += 1;
                        held.push((next.to_string(), path, "Tester".into()));
                        (201, serde_json::json!({"lock": json(held.last().unwrap())}))
                    }
                } else if request.starts_with("POST") && target.ends_with("/unlock") {
                    let id = target
                        .trim_end_matches("/unlock")
                        .rsplit('/')
                        .next()
                        .unwrap()
                        .to_owned();
                    match held.iter().position(|lock| lock.0 == id) {
                        Some(index) if held[index].2 == "Tester" || body["force"] == true => {
                            (200, serde_json::json!({"lock": json(&held.remove(index))}))
                        }
                        Some(_) => (
                            403,
                            serde_json::json!({"message": "lock owned by another user"}),
                        ),
                        None => (404, serde_json::json!({"message": "lock not found"})),
                    }
                } else if request.starts_with("GET") && target.ends_with("/locks") {
                    (
                        200,
                        serde_json::json!({"locks": held.iter().map(json).collect::<Vec<_>>()}),
                    )
                } else {
                    (404, serde_json::json!({"message": "Not found"}))
                };
                drop(held);
                let reply = reply.to_string();
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status} X\r\nContent-Type: application/vnd.git-lfs+json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}",
                    reply.len()
                );
            }
        });
        url
    }

    fn lfs_repository(url: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "chronos-lfs-locks-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&path).unwrap();
        for args in [
            &["init", "-q", "-b", "main"][..],
            &["config", "user.name", "Tester"],
            &["config", "user.email", "tester@example.test"],
            &["config", "lfs.url", url],
            &["lfs", "install", "--local"],
            &["lfs", "track", "--lockable", "*.psd"],
        ] {
            run_mutation(&path, args, "prepare LFS lock fixture").unwrap();
        }
        fs::write(path.join("art.psd"), b"art\n").unwrap();
        fs::write(path.join("notes.txt"), b"notes\n").unwrap();
        run_mutation(&path, &["add", "-A"], "stage").unwrap();
        run_mutation(&path, &["commit", "-q", "-m", "Art"], "commit").unwrap();
        path
    }

    #[test]
    #[ignore = "requires Git LFS with locks --json; run with --ignored"]
    fn locks_lock_unlock_and_force_unlock_against_a_locking_server() {
        let held: Locks = Arc::new(Mutex::new(vec![(
            "7".into(),
            "notes.txt".into(),
            "Other".into(),
        )]));
        let repository = lfs_repository(&lock_server(true, held.clone()));

        let listed = lfs_locks(&repository).unwrap();
        assert_eq!(listed.locks.len(), 1);
        assert!(!listed.locks[0].ours);
        assert_eq!(listed.locks[0].owner, "Other");

        assert_eq!(
            lock_lfs_file(&repository, "missing.psd").unwrap_err().kind,
            "lfsLockPathNotTracked"
        );
        assert_eq!(
            lock_lfs_file(&repository, "../out").unwrap_err().kind,
            "invalidLfsLockPath"
        );
        lock_lfs_file(&repository, "art.psd").unwrap();
        assert_eq!(
            lock_lfs_file(&repository, "art.psd").unwrap_err().kind,
            "lfsLockAlreadyHeld"
        );
        assert_eq!(
            lock_lfs_file(&repository, "notes.txt").unwrap_err().kind,
            "lfsLockOwnedByOther"
        );
        let listed = lfs_locks(&repository).unwrap();
        let ours = listed
            .locks
            .iter()
            .find(|lock| lock.path == "art.psd")
            .unwrap()
            .clone();
        let theirs = listed
            .locks
            .iter()
            .find(|lock| lock.path == "notes.txt")
            .unwrap()
            .clone();
        assert!(ours.ours);

        let mut permissions = fs::metadata(repository.join("art.psd"))
            .unwrap()
            .permissions();
        #[allow(clippy::permissions_set_readonly_false)]
        permissions.set_readonly(false);
        fs::set_permissions(repository.join("art.psd"), permissions).unwrap();
        fs::write(repository.join("art.psd"), b"edited\n").unwrap();
        assert_eq!(
            unlock_lfs_file(&repository, &ours, false).unwrap_err().kind,
            "lfsUnlockDirtyFile"
        );
        assert_eq!(held.lock().unwrap().len(), 2);
        run_mutation(&repository, &["checkout", "--", "art.psd"], "restore").unwrap();

        assert_eq!(
            unlock_lfs_file(&repository, &theirs, false)
                .unwrap_err()
                .kind,
            "lfsLockOwnedByOther"
        );
        let mut stale = ours.clone();
        stale.owner = "Someone".into();
        assert_eq!(
            unlock_lfs_file(&repository, &stale, false)
                .unwrap_err()
                .kind,
            "lfsLockChanged"
        );
        unlock_lfs_file(&repository, &ours, false).unwrap();
        assert_eq!(
            unlock_lfs_file(&repository, &ours, false).unwrap_err().kind,
            "lfsLockChanged"
        );
        unlock_lfs_file(&repository, &theirs, true).unwrap();
        assert!(held.lock().unwrap().is_empty());
        assert!(lfs_locks(&repository).unwrap().locks.is_empty());
        fs::remove_dir_all(repository).unwrap();
    }

    #[test]
    #[ignore = "requires Git LFS with locks --json; run with --ignored"]
    fn unsupported_or_unreachable_lock_endpoints_are_errors_not_empty_lists() {
        let repository = lfs_repository(&lock_server(false, Arc::default()));
        assert_eq!(
            lfs_locks(&repository).unwrap_err().kind,
            "lfsLocksUnavailable"
        );
        assert_eq!(
            lock_lfs_file(&repository, "art.psd").unwrap_err().kind,
            "lfsLocksUnavailable"
        );
        let closed = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", closed.local_addr().unwrap());
        drop(closed);
        run_mutation(
            &repository,
            &["config", "lfs.url", &url],
            "point at closed port",
        )
        .unwrap();
        assert_eq!(
            lfs_locks(&repository).unwrap_err().kind,
            "lfsLocksUnavailable"
        );
        fs::remove_dir_all(repository).unwrap();
    }

    #[test]
    fn parses_verified_locks_with_ownership_and_refuses_unsafe_entries() {
        let parsed = parse_locks(br#"{"ours":[{"id":"2","path":"b.psd","owner":{"name":"Ann"},"locked_at":"t"}],"theirs":[{"id":"1","path":"a.psd","locked_at":"t"}]}"#).unwrap();
        assert_eq!(parsed.locks.len(), 2);
        assert_eq!(parsed.locks[0].path, "a.psd");
        assert!(!parsed.locks[0].ours);
        assert_eq!(parsed.locks[0].owner, "");
        assert!(parsed.locks[1].ours);
        for invalid in [
            &br#"{"ours":[{"id":"","path":"a"}]}"#[..],
            br#"{"ours":[{"id":"1","path":"a"}],"theirs":[{"id":"1","path":"b"}]}"#,
            br#"[]"#,
        ] {
            assert_eq!(
                parse_locks(invalid).unwrap_err().kind,
                "unsupportedLfsLockOutput"
            );
        }
    }
}
