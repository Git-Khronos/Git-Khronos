use super::*;
use std::collections::BTreeSet;

#[derive(Clone, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FetchOptions {
    pub remote: Option<String>,
    pub prune: bool,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub history: Option<FetchHistory>,
}

/// Optional history extension for shallow repositories.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", tag = "mode", deny_unknown_fields)]
pub enum FetchHistory {
    Deepen { commits: u32 },
    Complete,
}

pub const MAX_DEEPEN_COMMITS: u32 = 1_000_000;
const MAX_SHALLOW_BOUNDARY_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ShallowHistoryState {
    pub shallow: bool,
    pub boundary_commits: usize,
}

pub fn shallow_history_state(path: &Path) -> Result<ShallowHistoryState, AppError> {
    let boundaries = shallow_boundaries(path)?;
    Ok(ShallowHistoryState {
        shallow: boundaries.is_some(),
        boundary_commits: boundaries.map_or(0, |commits| commits.len()),
    })
}

fn shallow_boundaries(path: &Path) -> Result<Option<BTreeSet<Vec<u8>>>, AppError> {
    let output = run_git(path, &["rev-parse", "--is-shallow-repository"])?;
    ensure_success("check whether history is shallow", &output)?;
    if output.stdout != b"true\n" {
        return Ok(None);
    }
    let location = run_git(
        path,
        &[
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            "shallow",
        ],
    )?;
    ensure_success("locate shallow history boundaries", &location)?;
    let file = git_absolute_path(&location.stdout)?;
    let metadata = fs::metadata(file).map_err(shallow_boundary_error)?;
    if !metadata.is_file() || metadata.len() > MAX_SHALLOW_BOUNDARY_BYTES {
        return Err(shallow_boundary_error(
            "The shallow boundary list cannot be inspected within its limits.",
        ));
    }
    let mut bytes = Vec::new();
    fs::File::open(file)
        .map_err(shallow_boundary_error)?
        .take(MAX_SHALLOW_BOUNDARY_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(shallow_boundary_error)?;
    if bytes.len() as u64 > MAX_SHALLOW_BOUNDARY_BYTES {
        return Err(shallow_boundary_error(
            "The shallow boundary list exceeds its inspection limit.",
        ));
    }
    let mut boundaries = BTreeSet::new();
    for line in bytes
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
    {
        if !matches!(line.len(), 40 | 64) || !line.iter().all(u8::is_ascii_hexdigit) {
            return Err(shallow_boundary_error(
                "Git reported an invalid boundary commit.",
            ));
        }
        boundaries.insert(line.to_vec());
    }
    if boundaries.is_empty() {
        return Err(shallow_boundary_error(
            "Git reported shallow history without any boundary commits.",
        ));
    }
    Ok(Some(boundaries))
}

fn shallow_boundary_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "shallowBoundaryUnavailable",
        format!("Could not verify the shallow history boundary: {error}"),
        Some("Refresh repository history to see its actual state before retrying."),
    )
}

fn validate_history(options: &FetchOptions) -> Result<Option<String>, AppError> {
    let Some(history) = options.history else {
        return Ok(None);
    };
    let refused =
        |message: &str, hint: &str| Err(AppError::new("historyDepthRefused", message, Some(hint)));
    if options.remote.is_none() {
        return refused(
            "Extending shallow history requires one selected remote.",
            "Choose the remote that provides the missing history; the shallow boundary is shared by the whole repository.",
        );
    }
    match history {
        FetchHistory::Deepen { commits } if commits == 0 || commits > MAX_DEEPEN_COMMITS => {
            refused(
                "Deepen by at least 1 and at most 1,000,000 commits.",
                "Choose a smaller number, or download complete history.",
            )
        }
        FetchHistory::Deepen { commits } => Ok(Some(format!("--deepen={commits}"))),
        FetchHistory::Complete => Ok(Some("--unshallow".to_owned())),
    }
}

/// Explicit branch-only fetch, independent of custom tag/mirror refspecs.
pub fn fetch_with_options(
    path: &Path,
    options: &FetchOptions,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    if let Some(branch) = options.branch.as_deref() {
        if options.remote.is_none() || options.prune || options.history.is_some() {
            return Err(AppError::new(
                "singleBranchFetchScope",
                "Fetching one branch requires one remote, with pruning off and no depth change.",
                None,
            ));
        }
        // Validate the literal name, not Git's checkout shorthand or a supplied refspec.
        if branch == "HEAD"
            || branch.starts_with("refs/")
            || branch.trim() != branch
            || branch.is_empty()
            || branch.starts_with('-')
            || branch.contains('\0')
            || !run_git(path, &["check-ref-format", &format!("refs/heads/{branch}")])?
                .status
                .success()
        {
            return Err(AppError::new(
                "invalidBranchName",
                "Enter the exact remote branch name, without a refs/ prefix.",
                Some("For example: main or release/1.0. HEAD is reserved."),
            ));
        }
    }
    let history = validate_history(options)?;
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
        let before_depth = if history.is_some() {
            Some(shallow_boundaries(path)?.ok_or_else(|| {
                AppError::new(
                    "historyDepthRefused",
                    "This repository already has complete history.",
                    Some("Fetch without a history option."),
                )
            })?)
        } else {
            None
        };
        let branch = options.branch.as_deref().unwrap_or("*");
        let destination = format!("refs/remotes/{remote}/{branch}");
        if options.branch.is_some() {
            let symbolic = run_git(
                path,
                &["symbolic-ref", "--quiet", "--no-recurse", &destination],
            )?;
            if symbolic.status.success() {
                return Err(AppError::new(
                    "symbolicFetchDestination",
                    "That remote-tracking branch is an alias. No fetch was started.",
                    Some("Select the actual branch instead of an alias."),
                ));
            }
            if symbolic.status.code() != Some(1) {
                ensure_success("inspect the selected tracking reference", &symbolic)?;
            }
        }
        let refspec = format!("+refs/heads/{branch}:{destination}");
        let mut args = vec![
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
        ];
        if let Some(history) = history.as_deref() {
            args.push(history);
        }
        args.extend(["--", remote, &refspec]);
        let fetch = || {
            run_git_with_cancellation(path, &args, Some(cancellation)).and_then(|output| {
                ensure_success("fetch branches from the selected remote", &output)
            })
        };
        let fetch_error = |error: AppError| {
            AppError::new(
                &error.kind,
                format!("Fetch failed at remote '{remote}': {}", error.message),
                Some(&format!(
                    "{} {index} earlier remote(s) may already be updated. Refresh to inspect actual state; local branches, tags and working files were not requested.",
                    error
                        .hint
                        .as_deref()
                        .unwrap_or("Review the destination and retry.")
                )),
            )
        };
        fetch().map_err(fetch_error)?;
        let Some(before) = before_depth else { continue };
        if cancellation.is_cancelled() {
            return Err(operation_cancelled());
        }
        let mut after = shallow_boundaries(path)?;
        // Some Git versions omit equal tracking tips from the depth
        // negotiation when other tips need updating. Once those tips are
        // fetched, one more pass can include the unchanged branches. Never
        // apply a second relative deepen after Git has changed any boundary.
        if after.as_ref() == Some(&before) {
            check_tracking_aliases(path, &format!("refs/remotes/{remote}/"))?;
            after = shallow_boundaries(path)?;
            if after.as_ref() == Some(&before) {
                fetch().map_err(|error| {
                    AppError::new(
                        &error.kind,
                        format!("The follow-up history fetch from '{remote}' did not finish: {}", error.message),
                        Some("The first fetch may have updated tracking branches. Review the refreshed graph before retrying."),
                    )
                })?;
                after = shallow_boundaries(path)?;
            }
        }
        if let Some(after) = after {
            verify_remaining_depth(options.history, &before, &after)?;
        }
    }
    Ok(())
}

fn verify_remaining_depth(
    history: Option<FetchHistory>,
    before: &BTreeSet<Vec<u8>>,
    after: &BTreeSet<Vec<u8>>,
) -> Result<(), AppError> {
    match history {
        Some(FetchHistory::Complete) => Err(AppError::new(
            "historyStillShallow",
            "Git finished, but the repository still has a shallow history boundary.",
            Some(
                "Tracking branches may have updated. Inspect the history and its source before retrying.",
            ),
        )),
        Some(FetchHistory::Deepen { .. }) if !before.is_disjoint(after) => {
            let (kind, message) = if before.is_subset(after) {
                (
                    "historyDepthUnchanged",
                    "Git did not extend the existing shallow history.",
                )
            } else {
                (
                    "historyDepthPartial",
                    "Git extended only part of the shallow history.",
                )
            };
            Err(AppError::new(
                kind,
                message,
                Some(
                    "Tracking branches may have updated. Review the refreshed graph and whether this remote has the missing history.",
                ),
            ))
        }
        _ => Ok(()),
    }
}

pub(crate) fn check_tracking_aliases(path: &Path, namespace: &str) -> Result<(), AppError> {
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
    fn depth_verification_distinguishes_equal_partial_and_advanced_boundaries() {
        let before = BTreeSet::from([b"a".to_vec(), b"b".to_vec()]);
        let check = |after: BTreeSet<Vec<u8>>| {
            verify_remaining_depth(Some(FetchHistory::Deepen { commits: 1 }), &before, &after)
        };
        assert_eq!(
            check(before.clone()).unwrap_err().kind,
            "historyDepthUnchanged"
        );
        assert_eq!(
            check(BTreeSet::from([b"b".to_vec(), b"c".to_vec()]))
                .unwrap_err()
                .kind,
            "historyDepthPartial"
        );
        check(BTreeSet::from([b"c".to_vec(), b"d".to_vec()])).unwrap();
    }

    #[test]
    fn fetch_options_ipc_requires_pruning_choice_and_rejects_unknown_options() {
        let options: FetchOptions =
            serde_json::from_str(r#"{"remote":null,"prune":false}"#).unwrap();
        assert!(options.remote.is_none());
        assert!(!options.prune);
        assert!(options.branch.is_none());
        let one: FetchOptions =
            serde_json::from_str(r#"{"remote":"origin","prune":false,"branch":"release/1.0"}"#)
                .unwrap();
        assert_eq!(one.branch.as_deref(), Some("release/1.0"));
        assert!(serde_json::from_str::<FetchOptions>(r#"{"remote":"origin"}"#).is_err());
        assert!(
            serde_json::from_str::<FetchOptions>(r#"{"remote":"origin","prune":true,"tags":true}"#)
                .is_err()
        );
        let deepen: FetchOptions = serde_json::from_str(
            r#"{"remote":"origin","prune":false,"history":{"mode":"deepen","commits":5}}"#,
        )
        .unwrap();
        assert_eq!(deepen.history, Some(FetchHistory::Deepen { commits: 5 }));
        assert!(
            serde_json::from_str::<FetchOptions>(
                r#"{"remote":"origin","prune":false,"history":{"mode":"all"}}"#
            )
            .is_err()
        );
    }
}
