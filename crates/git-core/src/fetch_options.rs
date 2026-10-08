use super::*;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FetchOptions {
    pub remote: Option<String>,
    pub prune: bool,
}

/// Explicit branch-only fetch, independent of custom tag/mirror refspecs.
pub fn fetch_with_options(
    path: &Path,
    options: &FetchOptions,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    let output = run_git(path, &["remote"])?;
    ensure_success("list fetch destinations", &output)?;
    let names = String::from_utf8(output.stdout).map_err(|_| {
        AppError::new(
            "unsupportedRemoteEncoding",
            "Remote names must be UTF-8 for scoped fetching.",
            None,
        )
    })?;
    let configured = names.lines().collect::<Vec<_>>();
    let selected = match options.remote.as_deref() {
        Some(remote) => {
            validate_remote_name(path, remote)?;
            require_remote(path, remote)?;
            vec![remote]
        }
        None => configured.clone(),
    };
    if selected.is_empty() {
        return Err(AppError::new(
            "missingRemote",
            "No remotes are configured for this repository.",
            Some("Add a remote before fetching branches."),
        ));
    }
    // Nested remote names can share tracking namespaces; do not prune another remote's refs.
    for remote in &selected {
        validate_remote_name(path, remote)?;
        if configured.iter().any(|other| {
            other != remote
                && (other.starts_with(&format!("{remote}/"))
                    || remote.starts_with(&format!("{other}/")))
        }) {
            return Err(AppError::new(
                "overlappingRemoteNamespaces",
                "Configured remote names share a remote-tracking namespace.",
                Some("Rename overlapping remotes before using scoped fetch/prune."),
            ));
        }
        let namespace = format!("refs/remotes/{remote}/");
        check_tracking_aliases(path, &namespace)?;
        for other in configured.iter().filter(|other| *other != remote) {
            let key = format!("remote.{other}.fetch");
            let mapping = run_git(path, &["config", "--get-all", &key])?;
            if mapping.status.code() == Some(1) {
                continue;
            }
            ensure_success("inspect remote fetch mappings", &mapping)?;
            for refspec in String::from_utf8_lossy(&mapping.stdout).lines() {
                if refspec.starts_with('^') {
                    continue;
                }
                let Some((_, destination)) = refspec.trim_start_matches('+').split_once(':') else {
                    continue;
                };
                let shared = if let Some((prefix, _)) = destination.split_once('*') {
                    namespace.starts_with(prefix) || prefix.starts_with(&namespace)
                } else {
                    destination.starts_with(&namespace)
                };
                if shared {
                    return Err(AppError::new(
                        "sharedRemoteTrackingNamespace",
                        format!(
                            "Remote '{other}' also maps fetched references into '{remote}' tracking branches."
                        ),
                        Some(
                            "Review shared custom refspecs in local Git before using scoped fetch/prune.",
                        ),
                    ));
                }
            }
        }
    }

    for (index, remote) in selected.iter().enumerate() {
        let refspec = format!("+refs/heads/*:refs/remotes/{remote}/*");
        let args = [
            "-c",
            "fetch.parallel=1",
            "-c",
            "pack.threads=1",
            "-c",
            "index.threads=1",
            "-c",
            "fetch.negotiationAlgorithm=skipping",
            "fetch",
            "--no-all",
            "--atomic",
            "--no-auto-maintenance",
            "--no-recurse-submodules",
            "--no-tags",
            "--no-prune-tags",
            if options.prune {
                "--prune"
            } else {
                "--no-prune"
            },
            "--refmap=",
            "--",
            remote,
            &refspec,
        ];
        let result = run_git_with_cancellation(path, &args, Some(cancellation))
            .and_then(|output| ensure_success("fetch branches from the selected remote", &output));
        if let Err(error) = result {
            return Err(AppError::new(
                &error.kind,
                format!("Fetch failed at remote '{remote}': {}", error.message),
                Some(&format!(
                    "{} {index} earlier remote(s) may already be updated. Refresh to inspect actual state; local branches, tags and working files were not requested.",
                    error
                        .hint
                        .as_deref()
                        .unwrap_or("Review the destination and retry.")
                )),
            ));
        }
    }
    Ok(())
}

fn check_tracking_aliases(path: &Path, namespace: &str) -> Result<(), AppError> {
    let storage = run_git(path, &["config", "--get", "extensions.refStorage"])?;
    if storage.status.code() != Some(1) {
        ensure_success("read reference storage format", &storage)?;
        if storage.stdout != b"files\n" {
            return Err(AppError::new(
                "unsupportedFetchReferenceStorage",
                "Scoped fetch currently requires file-based Git references.",
                Some("Use local Git for this repository's reference storage format."),
            ));
        }
    }
    let location = run_git(
        path,
        &[
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            namespace,
        ],
    )?;
    ensure_success("locate tracking references", &location)?;
    let root = PathBuf::from(String::from_utf8_lossy(&location.stdout).trim());
    let metadata = match fs::symlink_metadata(&root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(fetch_scope_io_error(error)),
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(fetch_scope_io_error(
            "Tracking namespace is not an ordinary directory.",
        ));
    }
    // Git enumeration omits dangling aliases. Inspect loose refs; packed refs cannot be symbolic.
    let mut directories = vec![root];
    while let Some(directory) = directories.pop() {
        for entry in fs::read_dir(directory).map_err(fetch_scope_io_error)? {
            let entry = entry.map_err(fetch_scope_io_error)?;
            if entry.file_name().as_encoded_bytes().ends_with(b".lock") {
                continue;
            }
            let kind = entry.file_type().map_err(fetch_scope_io_error)?;
            if kind.is_dir() {
                directories.push(entry.path());
                continue;
            }
            if !kind.is_file() || entry.metadata().map_err(fetch_scope_io_error)?.len() > 4096 {
                return Err(fetch_scope_io_error(
                    "A loose tracking reference cannot be safely inspected.",
                ));
            }
            let bytes = fs::read(entry.path()).map_err(fetch_scope_io_error)?;
            let Some(target) = bytes.strip_prefix(b"ref: ") else {
                continue;
            };
            let target = std::str::from_utf8(target)
                .map_err(fetch_scope_io_error)?
                .trim();
            if !target.starts_with(namespace) {
                return Err(AppError::new(
                    "redirectedRemoteTrackingReference",
                    "A tracking alias redirects outside the selected remote namespace.",
                    Some(
                        "Review symbolic tracking references in local Git before using scoped fetch/prune.",
                    ),
                ));
            }
            let resolved = run_git(path, &["rev-parse", "--verify", "--quiet", target])?;
            if !resolved.status.success() {
                return Err(AppError::new(
                    "invalidRemoteTrackingReferences",
                    "A tracking alias does not resolve. Scoped fetch was not started.",
                    Some(
                        "Repair dangling or malformed tracking references in local Git, then retry.",
                    ),
                ));
            }
        }
    }
    Ok(())
}

fn fetch_scope_io_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "fetchScopeUnavailable",
        format!("Could not inspect tracking references: {error}"),
        Some("Check repository reference storage and permissions before retrying scoped fetch."),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fetch_options_ipc_requires_pruning_choice_and_rejects_unknown_options() {
        let options: FetchOptions =
            serde_json::from_str(r#"{"remote":null,"prune":false}"#).unwrap();
        assert!(options.remote.is_none());
        assert!(!options.prune);
        assert!(serde_json::from_str::<FetchOptions>(r#"{"remote":"origin"}"#).is_err());
        assert!(
            serde_json::from_str::<FetchOptions>(r#"{"remote":"origin","prune":true,"tags":true}"#)
                .is_err()
        );
    }
}
