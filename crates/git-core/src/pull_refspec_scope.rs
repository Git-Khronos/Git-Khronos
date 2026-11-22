//! A Pull authorizes Git's integration phase to move the receiving branch.
//! The fetch that precedes it must not separately update local branches.
use super::*;

const CONFIG_LIMIT: usize = 256 * 1024;
const LOCAL_BRANCHES: &[u8] = b"refs/heads/";

fn unverified() -> AppError {
    AppError::new(
        "pullFetchScopeUnverified",
        "The configured Pull fetch scope could not be verified. Nothing was fetched.",
        Some("Review the repository's upstream and remote fetch mappings in Git, then retry."),
    )
}

fn config(
    path: &Path,
    args: &[&str],
    cancellation: Option<&CancellationToken>,
) -> Result<Vec<u8>, AppError> {
    let (output, truncated) =
        run_git_with_stdout_limit_and_cancellation(path, args, CONFIG_LIMIT, cancellation)?;
    if !truncated && output.status.success() && output.stdout.ends_with(b"\0") {
        return Ok(output.stdout);
    }
    if !truncated && output.status.code() == Some(1) && output.stdout.is_empty() {
        return Ok(Vec::new());
    }
    Err(unverified())
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
    let remote = config(path, &["config", "--null", "--get", &key], cancellation)?;
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

fn require_config_based_remote(
    path: &Path,
    remote: Option<&str>,
    cancellation: Option<&CancellationToken>,
) -> Result<(), AppError> {
    if remote.is_some_and(|name| {
        // Git accepts legacy remote files only for a simple nickname, not a
        // path or the special local repository ".".
        let mut parts = Path::new(name).components();
        !matches!(parts.next(), Some(std::path::Component::Normal(_)))
            || parts.next().is_some()
            || name.chars().any(std::path::is_separator)
    }) {
        return Ok(());
    }
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
        let present = if let Some(remote) = remote {
            match fs::symlink_metadata(directory.join(remote)) {
                Ok(_) => true,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
                Err(_) => return Err(unverified()),
            }
        } else {
            match fs::read_dir(directory) {
                Ok(mut entries) => entries.next().is_some(),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
                Err(_) => return Err(unverified()),
            }
        };
        if present {
            return Err(AppError::new(
                "legacyPullRemoteUnverified",
                "A legacy Git remote file may control this Pull's fetch mappings. Nothing was fetched.",
                Some(
                    "Migrate the remote to normal Git configuration and verify its fetch destinations before retrying.",
                ),
            ));
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
    require_config_based_remote(path, remote, cancellation)?;
    let unsafe_mapping =
        |refspec| fetch_maps_to_local_branch(refspec, explicit_source.map(str::as_bytes));
    let records = if let Some(remote) = remote {
        let key = format!("remote.{remote}.fetch");
        config(path, &["config", "--null", "--get-all", &key], cancellation)?
    } else {
        // Without a recorded upstream, leave Git's default remote choice
        // intact but verify every potential configured fetch mapping.
        config(
            path,
            &["config", "--null", "--get-regexp", r"^remote\..*\.fetch$"],
            cancellation,
        )?
    };
    let Some(records) = records.strip_suffix(b"\0") else {
        return Ok(());
    };
    for record in records.split(|&byte| byte == 0) {
        let refspec = if remote.is_some() {
            record
        } else {
            split_first(record, b'\n').ok_or_else(unverified)?.1
        };
        if unsafe_mapping(refspec) {
            return Err(AppError::new(
                "pullFetchUpdatesLocalBranch",
                "This remote's fetch mapping could update a local branch before Pull integrates anything. Nothing was fetched.",
                Some(
                    "Map incoming branches to remote-tracking refs instead of local branches, then retry Pull.",
                ),
            ));
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
