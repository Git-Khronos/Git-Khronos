//! Ordinary transport can update tracking refs, but does not authorize a
//! direct fetch into local branches. Pull can separately integrate its source.
use super::*;

const CONFIG_LIMIT: usize = 256 * 1024;
const LOCAL_BRANCHES: &[u8] = b"refs/heads/";

#[derive(Clone, Copy)]
enum Operation {
    Pull,
    Fetch,
}

impl Operation {
    fn label(self) -> &'static str {
        match self {
            Self::Pull => "Pull",
            Self::Fetch => "Fetch",
        }
    }

    fn unverified(self) -> AppError {
        AppError::new(
            match self {
                Self::Pull => "pullFetchScopeUnverified",
                Self::Fetch => "fetchScopeUnverified",
            },
            format!(
                "The configured {} scope could not be verified. Nothing was fetched.",
                self.label()
            ),
            Some("Review the repository's upstream and remote fetch mappings in Git, then retry."),
        )
    }

    fn legacy(self) -> AppError {
        AppError::new(
            match self {
                Self::Pull => "legacyPullRemoteUnverified",
                Self::Fetch => "legacyFetchRemoteUnverified",
            },
            format!(
                "A legacy Git remote file may control this {}'s fetch mappings. Nothing was fetched.",
                self.label()
            ),
            Some(
                "Migrate the remote to normal Git configuration and verify its fetch destinations before retrying.",
            ),
        )
    }

    fn local_branch(self) -> AppError {
        let (kind, message) = match self {
            Self::Pull => (
                "pullFetchUpdatesLocalBranch",
                "This remote's fetch mapping could update a local branch before Pull integrates anything. Nothing was fetched.",
            ),
            Self::Fetch => (
                "fetchUpdatesLocalBranch",
                "A selected remote's fetch mapping could update a local branch. Nothing was fetched.",
            ),
        };
        let hint = match self {
            Self::Pull => {
                "Map incoming branches to remote-tracking refs instead of local branches, then retry Pull."
            }
            Self::Fetch => {
                "Use branch-only Fetch options, or map incoming branches to remote-tracking refs before retrying ordinary Fetch."
            }
        };
        AppError::new(kind, message, Some(hint))
    }
}

fn config(
    path: &Path,
    args: &[&str],
    cancellation: Option<&CancellationToken>,
    operation: Operation,
) -> Result<Vec<u8>, AppError> {
    let (output, truncated) =
        run_git_with_stdout_limit_and_cancellation(path, args, CONFIG_LIMIT, cancellation)?;
    if !truncated && output.status.success() && output.stdout.ends_with(b"\0") {
        return Ok(output.stdout);
    }
    if !truncated && output.status.code() == Some(1) && output.stdout.is_empty() {
        return Ok(Vec::new());
    }
    Err(operation.unverified())
}

fn split_first(bytes: &[u8], separator: u8) -> Option<(&[u8], &[u8])> {
    let index = bytes.iter().position(|&byte| byte == separator)?;
    Some((&bytes[..index], &bytes[index + 1..]))
}

fn starts_with_ignoring_ascii_case(bytes: &[u8], prefix: &[u8]) -> bool {
    bytes
        .get(..prefix.len())
        .is_some_and(|start| start.eq_ignore_ascii_case(prefix))
}

fn fetch_maps_to_local_branch(refspec: &[u8], source: Option<&[u8]>) -> bool {
    if refspec.starts_with(b"^") {
        return false;
    }
    let refspec = refspec.strip_prefix(b"+").unwrap_or(refspec);
    let Some((from, to)) = split_first(refspec, b':') else {
        return false;
    };
    if to.is_empty() {
        return false;
    }
    if let Some(source) = source
        && from.starts_with(b"refs/")
    {
        let matches = if let Some((prefix, suffix)) = split_first(from, b'*') {
            source
                .strip_prefix(prefix)
                .is_some_and(|remainder| remainder.ends_with(suffix))
        } else {
            source == from
        };
        if !matches {
            return false;
        }
    }
    // Git may resolve a short destination as a branch. Do not assume it is
    // a tracking ref. A wildcard above refs/heads can designate a branch too.
    if !to.starts_with(b"refs/") || to.eq_ignore_ascii_case(b"refs/heads") {
        return true;
    }
    if let Some((prefix, _)) = split_first(to, b'*') {
        return starts_with_ignoring_ascii_case(prefix, LOCAL_BRANCHES)
            || starts_with_ignoring_ascii_case(LOCAL_BRANCHES, prefix);
    }
    starts_with_ignoring_ascii_case(to, LOCAL_BRANCHES)
}

fn configured_remote(
    path: &Path,
    checkout: Option<&PullCheckout>,
    cancellation: Option<&CancellationToken>,
) -> Result<Option<String>, AppError> {
    let unverified = || Operation::Pull.unverified();
    let branch = if let Some(checkout) = checkout {
        checkout.branch.clone()
    } else {
        let head = run_git_with_cancellation(
            path,
            &["symbolic-ref", "--quiet", "--no-recurse", "HEAD"],
            cancellation,
        )?;
        match head.status.code() {
            Some(0) => Some(
                std::str::from_utf8(&head.stdout)
                    .ok()
                    .and_then(|head| head.strip_suffix('\n'))
                    .and_then(|head| head.strip_prefix("refs/heads/"))
                    .ok_or_else(unverified)?
                    .to_owned(),
            ),
            Some(1) if head.stdout.is_empty() => None,
            _ => return Err(unverified()),
        }
    };
    let Some(branch) = branch else {
        return Ok(None);
    };
    let key = format!("branch.{branch}.remote");
    let remote = config(
        path,
        &["config", "--null", "--get", &key],
        cancellation,
        Operation::Pull,
    )?;
    let value = remote.strip_suffix(b"\0").unwrap_or(&remote);
    if value.is_empty() {
        return Ok(None);
    }
    if value.contains(&0) {
        return Err(unverified());
    }
    String::from_utf8(value.to_vec())
        .map(Some)
        .map_err(|_| unverified())
}

fn require_config_based_remotes(
    path: &Path,
    remotes: Option<&[&str]>,
    cancellation: Option<&CancellationToken>,
    operation: Operation,
) -> Result<(), AppError> {
    let legacy_names = remotes.map(|remotes| {
        remotes
            .iter()
            .copied()
            .filter(|name| {
                // Git accepts legacy remote files only for a simple nickname, not a
                // path or the special local repository ".".
                let mut parts = Path::new(name).components();
                matches!(parts.next(), Some(std::path::Component::Normal(_)))
                    && parts.next().is_none()
                    && !name.chars().any(std::path::is_separator)
            })
            .collect::<Vec<_>>()
    });
    if legacy_names.as_ref().is_some_and(Vec::is_empty) {
        return Ok(());
    }
    let unverified = || operation.unverified();
    let locations = run_git_with_cancellation(
        path,
        &[
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            "remotes",
            "--git-path",
            "branches",
        ],
        cancellation,
    )?;
    if !locations.status.success() {
        return Err(unverified());
    }
    let locations = std::str::from_utf8(&locations.stdout).map_err(|_| unverified())?;
    let paths = locations.lines().map(Path::new).collect::<Vec<_>>();
    if paths.len() != 2 || paths.iter().any(|path| !path.is_absolute()) {
        return Err(unverified());
    }
    for directory in paths {
        if let Some(names) = &legacy_names {
            for remote in names {
                match fs::symlink_metadata(directory.join(remote)) {
                    Ok(_) => return Err(operation.legacy()),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(_) => return Err(unverified()),
                }
            }
        } else {
            match fs::read_dir(directory) {
                Ok(mut entries) => {
                    if entries.next().is_some() {
                        return Err(operation.legacy());
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err(unverified()),
            }
        }
    }
    Ok(())
}

pub(super) fn require_no_local_branch_fetch(
    path: &Path,
    explicit_remote: Option<&str>,
    explicit_source: Option<&str>,
    checkout: Option<&PullCheckout>,
    cancellation: Option<&CancellationToken>,
) -> Result<(), AppError> {
    let configured = if explicit_remote.is_none() {
        configured_remote(path, checkout, cancellation)?
    } else {
        None
    };
    let remote = explicit_remote.or(configured.as_deref());
    check_remotes(
        path,
        remote.as_ref().map(std::slice::from_ref),
        explicit_source,
        cancellation,
        Operation::Pull,
    )
}

pub(super) fn require_fetch_without_local_branch_updates(
    path: &Path,
    remotes: &[&str],
    cancellation: Option<&CancellationToken>,
) -> Result<(), AppError> {
    check_remotes(path, Some(remotes), None, cancellation, Operation::Fetch)
}

fn check_remotes(
    path: &Path,
    remotes: Option<&[&str]>,
    explicit_source: Option<&str>,
    cancellation: Option<&CancellationToken>,
    operation: Operation,
) -> Result<(), AppError> {
    if remotes.is_some_and(<[&str]>::is_empty) {
        return Ok(());
    }
    require_config_based_remotes(path, remotes, cancellation, operation)?;
    let unsafe_mapping =
        |refspec| fetch_maps_to_local_branch(refspec, explicit_source.map(str::as_bytes));
    let single = remotes.and_then(|names| match names {
        [remote] => Some(remote),
        _ => None,
    });
    let records = if let Some(remote) = single {
        let key = format!("remote.{remote}.fetch");
        config(
            path,
            &["config", "--null", "--get-all", &key],
            cancellation,
            operation,
        )?
    } else {
        // Read several remotes in one call. Without a recorded Pull upstream,
        // leave Git's default selection intact and verify every mapping.
        config(
            path,
            &["config", "--null", "--get-regexp", r"^remote\..*\.fetch$"],
            cancellation,
            operation,
        )?
    };
    let Some(records) = records.strip_suffix(b"\0") else {
        return Ok(());
    };
    for record in records.split(|&byte| byte == 0) {
        let refspec = if single.is_some() {
            record
        } else {
            let (key, refspec) =
                split_first(record, b'\n').ok_or_else(|| operation.unverified())?;
            let name = key
                .strip_prefix(b"remote.")
                .and_then(|key| key.strip_suffix(b".fetch"))
                .ok_or_else(|| operation.unverified())?;
            if remotes
                .is_some_and(|selected| !selected.iter().any(|remote| remote.as_bytes() == name))
            {
                continue;
            }
            refspec
        };
        if unsafe_mapping(refspec) {
            return Err(operation.local_branch());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distinguishes_tracking_branch_and_ambiguous_fetch_destinations() {
        for spec in [
            "+refs/heads/*:refs/heads/imported/*",
            "+refs/*:refs/*",
            "+refs/heads/*:refs/Heads/imported/*",
            "refs/heads/main:HEAD",
            "refs/heads/main:unqualified",
        ] {
            assert!(
                fetch_maps_to_local_branch(spec.as_bytes(), Some(b"refs/heads/main")),
                "{spec}"
            );
        }
        for spec in [
            "+refs/heads/*:refs/remotes/origin/*",
            "+refs/heads/*:refs/custom/updates/*",
            "+refs/heads/other:refs/heads/unselected",
            "+refs/heads/topic/*:refs/heads/local/*",
            "refs/heads/main:",
            "^refs/heads/main",
        ] {
            assert!(
                !fetch_maps_to_local_branch(spec.as_bytes(), Some(b"refs/heads/main")),
                "{spec}"
            );
        }
        assert!(fetch_maps_to_local_branch(
            b"+refs/heads/other:refs/heads/unselected",
            None
        ));
    }
}
