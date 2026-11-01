//! Read-only verification of one explicitly known repository. No directory discovery.
use super::file_content::{content_git, worktree_root};
use super::repository_links::valid_reference;
use super::*;

const METADATA_LIMIT: usize = 64 * 1024;
const MAX_REMOTE_NAMES: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RepositoryLinkTargetState {
    NotMatched,
    Repository,
    Commit { oid: String },
    Unavailable { message: String },
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryLinkInspection {
    pub link: RepositoryLink,
    pub path: String,
    pub bare: bool,
    pub matched_remotes: Vec<String>,
    pub target: RepositoryLinkTargetState,
}

fn refused() -> AppError {
    AppError::new(
        "repositoryLinkInspectionFailed",
        "The known repository could not be inspected completely.",
        Some(
            "Check its location and Git configuration, then retry. No fetch or checkout was requested.",
        ),
    )
}

fn read(path: &Path, args: &[&str], limit: usize) -> Result<Output, AppError> {
    let (output, truncated) = content_git(path, args, limit)?;
    if truncated {
        return Err(refused());
    }
    Ok(output)
}

fn metadata(path: &Path, args: &[&str]) -> Result<Vec<u8>, AppError> {
    let output = read(path, args, METADATA_LIMIT)?;
    if !output.status.success() {
        // Remote configuration and Git stderr can contain private URLs.
        return Err(refused());
    }
    Ok(output.stdout)
}

fn remote_matches(path: &Path, expected: &str) -> Result<Vec<String>, AppError> {
    let output = read(
        path,
        &["config", "--null", "--get-regexp", r"^remote\..*\.url$"],
        METADATA_LIMIT,
    )?;
    if output.status.code() == Some(1) && output.stdout.is_empty() {
        return Ok(vec![]);
    }
    if !output.status.success() || !output.stdout.ends_with(b"\0") {
        return Err(refused());
    }
    let mut names = std::collections::BTreeSet::new();
    for entry in output.stdout[..output.stdout.len() - 1].split(|b| *b == 0) {
        let split = entry.iter().position(|b| *b == b'\n').ok_or_else(refused)?;
        let key = std::str::from_utf8(&entry[..split]).map_err(|_| refused())?;
        let raw_url = std::str::from_utf8(&entry[split + 1..]).map_err(|_| refused())?;
        if raw_url.chars().any(char::is_control) {
            return Err(refused());
        }
        let name = key
            .strip_prefix("remote.")
            .and_then(|key| key.strip_suffix(".url"))
            .ok_or_else(refused)?;
        if name.is_empty()
            || name.starts_with('-')
            || name.trim() != name
            || !valid_reference(&format!("refs/remotes/{name}/placeholder"))
        {
            return Err(refused());
        }
        names.insert(name.to_owned());
        if names.len() > MAX_REMOTE_NAMES {
            return Err(refused());
        }
    }
    let mut matched = vec![];
    for name in names {
        let bytes = metadata(path, &["remote", "get-url", "--", &name])?;
        let urls = std::str::from_utf8(&bytes).map_err(|_| refused())?;
        let url = urls.strip_suffix('\n').ok_or_else(refused)?;
        if url.chars().any(char::is_control) {
            return Err(refused());
        }
        // Git's default get-url is the first fetch URL, including insteadOf rewrites.
        if repository_link_remote_identity(url).is_ok_and(|identity| identity == expected) {
            matched.push(name);
        }
    }
    Ok(matched)
}

fn unavailable(message: &str) -> RepositoryLinkTargetState {
    RepositoryLinkTargetState::Unavailable {
        message: message.into(),
    }
}

fn target_state(
    path: &Path,
    target: &RepositoryLinkTarget,
) -> Result<RepositoryLinkTargetState, AppError> {
    let oid = match target {
        RepositoryLinkTarget::Repository => return Ok(RepositoryLinkTargetState::Repository),
        RepositoryLinkTarget::Commit { oid } => oid.clone(),
        RepositoryLinkTarget::Reference { reference } => {
            let expression = format!("{reference}^{{commit}}");
            let output = read(
                path,
                &["rev-parse", "--verify", "--end-of-options", &expression],
                128,
            )?;
            if !output.status.success() {
                return Ok(unavailable(
                    "The requested reference cannot be resolved to a local commit.",
                ));
            }
            let text = std::str::from_utf8(&output.stdout).map_err(|_| refused())?;
            let oid = text.strip_suffix('\n').ok_or_else(refused)?;
            validate_commit_oid(oid).map_err(|_| refused())?;
            oid.into()
        }
    };
    let output = read(path, &["cat-file", "-t", &oid], 32)?;
    if !output.status.success() {
        return Ok(unavailable(
            "The requested Git object is unavailable locally.",
        ));
    }
    if output.stdout != b"commit\n" {
        return Ok(unavailable("The selected Git object is not a commit."));
    }
    Ok(RepositoryLinkTargetState::Commit { oid })
}

pub fn inspect_repository_link(
    path: &Path,
    raw_link: &str,
    cancellation: &CancellationToken,
) -> Result<RepositoryLinkInspection, AppError> {
    let link = parse_repository_link(raw_link)?;
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    git_cancellation::with(Some(cancellation), || {
        if !path.is_absolute() {
            return Err(refused());
        }
        let canonical = path.canonicalize().map_err(|_| refused())?;
        let bare = match metadata(&canonical, &["rev-parse", "--is-bare-repository"])?.as_slice() {
            b"true\n" => true,
            b"false\n" => false,
            _ => return Err(refused()),
        };
        if bare {
            let bytes = metadata(&canonical, &["rev-parse", "--absolute-git-dir"])?;
            let text = std::str::from_utf8(&bytes).map_err(|_| refused())?;
            let git_dir = text.strip_suffix('\n').ok_or_else(refused)?;
            if Path::new(git_dir).canonicalize().map_err(|_| refused())? != canonical {
                return Err(refused());
            }
        } else if worktree_root(&canonical)? != canonical {
            return Err(refused());
        }
        let matched_remotes = remote_matches(&canonical, link.remote())?;
        let target = if matched_remotes.is_empty() {
            RepositoryLinkTargetState::NotMatched
        } else {
            target_state(&canonical, link.target())?
        };
        // A changed matching remote set during inspection must not yield a stale match.
        if remote_matches(&canonical, link.remote())? != matched_remotes {
            return Err(refused());
        }
        if cancellation.is_cancelled() {
            return Err(operation_cancelled());
        }
        Ok(RepositoryLinkInspection {
            link,
            path: canonical.to_str().ok_or_else(refused)?.into(),
            bare,
            matched_remotes,
            target,
        })
    })
}

#[cfg(test)]
#[path = "repository_link_inspection_tests.rs"]
mod tests;
