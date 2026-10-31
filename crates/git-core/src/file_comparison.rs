//! Resolve image/binary comparison sides from public Git object relationships.
use super::file_content::{content_git, metadata_git, validate_file, worktree_root};
use super::*;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum StashContentLayer {
    #[default]
    Combined,
    Index,
    WorkingTree,
    Untracked,
}
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum FileComparisonContext {
    Commit {
        oid: String,
    },
    Revisions {
        base_oid: String,
        target_oid: String,
    },
    RevisionWorktree {
        base_oid: String,
    },
    WorkingTree {
        staged: bool,
    },
    Stash {
        oid: String,
        #[serde(default)]
        layer: StashContentLayer,
    },
}
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileComparisonRequest {
    pub context: FileComparisonContext,
    pub path: String,
    /// Original path from the selected native changed-file row when renamed.
    pub previous_path: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileComparisonUnavailable {
    pub kind: String,
    pub message: String,
    pub hint: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileComparisonValue {
    Available(FileContent),
    Unavailable(FileComparisonUnavailable),
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileComparisonSide {
    pub label: String,
    pub path: String,
    pub location: Option<FileContentLocation>,
    pub content: FileComparisonValue,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileComparisonContent {
    pub before: FileComparisonSide,
    pub after: FileComparisonSide,
}
#[derive(Debug, Clone, PartialEq, Eq)]
struct Selection {
    label: String,
    path: String,
    location: Option<FileContentLocation>,
}
#[derive(Debug, PartialEq, Eq)]
struct Sides {
    before: Selection,
    after: Selection,
}
fn refused(message: &str) -> AppError {
    AppError::new(
        "fileComparisonRefused",
        message,
        Some("Reload the selected comparison. No repository data was changed."),
    )
}
fn inspect(path: &Path, args: &[&str]) -> Result<Output, AppError> {
    let (output, truncated) = content_git(path, args, 64 * 1024)?;
    if truncated {
        return Err(refused(
            "Git comparison metadata exceeds the inspection budget.",
        ));
    }
    Ok(output)
}
fn parents(path: &Path, oid: &str) -> Result<Vec<String>, AppError> {
    validate_commit_oid(oid)?;
    if metadata_git(path, &["cat-file", "-t", oid])? != b"commit\n" {
        return Err(refused("Choose a commit object for this comparison."));
    }
    let (output, truncated) =
        content_git(path, &["cat-file", "commit", oid], MAX_FILE_CONTENT_BYTES)?;
    if truncated {
        return Err(refused(
            "The selected commit exceeds the metadata inspection budget.",
        ));
    }
    ensure_success("read selected commit parent identities", &output)?;
    let end = output
        .stdout
        .windows(2)
        .position(|pair| pair == b"\n\n")
        .ok_or_else(|| refused("The selected commit has an incomplete header."))?;
    let mut parents = Vec::new();
    for line in output.stdout[..end].split(|byte| *byte == b'\n') {
        if let Some(value) = line.strip_prefix(b"parent ") {
            let value = std::str::from_utf8(value)
                .map_err(|_| refused("The selected commit has an invalid parent identity."))?;
            validate_commit_oid(value)?;
            if value.len() != oid.len() {
                return Err(refused(
                    "The selected commit has an inconsistent object format.",
                ));
            }
            parents.push(value.to_owned());
        }
    }
    Ok(parents)
}
fn head(path: &Path) -> Result<Option<String>, AppError> {
    let output = inspect(path, &["rev-parse", "--verify", "--quiet", "HEAD"])?;
    if output.status.success() {
        let oid = std::str::from_utf8(&output.stdout)
            .map_err(|_| refused("HEAD has an invalid object identity."))?
            .trim_end_matches('\n')
            .to_owned();
        parents(path, &oid)?;
        return Ok(Some(oid));
    }
    // Only a symbolic HEAD whose referenced name is absent is an unborn HEAD.
    let symbolic = inspect(path, &["symbolic-ref", "--quiet", "HEAD"])?;
    ensure_success("inspect an unborn comparison base", &symbolic)?;
    let reference = std::str::from_utf8(&symbolic.stdout)
        .map_err(|_| refused("HEAD has an invalid reference."))?
        .trim_end_matches('\n');
    if !reference.starts_with("refs/") {
        return Err(refused("HEAD does not name a repository reference."));
    }
    let exists = inspect(path, &["show-ref", "--verify", "--quiet", reference])?;
    if exists.status.code() == Some(1) {
        return Ok(None);
    }
    Err(refused(
        "HEAD is unavailable or changed while selecting a comparison.",
    ))
}
fn revision(label: &str, oid: Option<String>, file: &str) -> Selection {
    Selection {
        label: label.into(),
        path: file.into(),
        location: oid.map(FileContentLocation::Revision),
    }
}
fn current(label: &str, source: FileContentLocation, file: &str) -> Selection {
    Selection {
        label: label.into(),
        path: file.into(),
        location: Some(source),
    }
}
fn tree_contains(path: &Path, oid: &str, file: &str) -> Result<bool, AppError> {
    let entries = metadata_git(
        path,
        &[
            "--literal-pathspecs",
            "ls-tree",
            "--full-tree",
            "-z",
            oid,
            "--",
            file,
        ],
    )?;
    if entries.is_empty() {
        return Ok(false);
    }
    if !entries.ends_with(&[0]) {
        return Err(refused("Git returned incomplete stash file metadata."));
    }
    let mut rows = entries
        .split(|byte| *byte == 0)
        .filter(|row| !row.is_empty());
    let row = rows
        .next()
        .ok_or_else(|| refused("Git returned invalid stash file metadata."))?;
    let separator = row
        .iter()
        .position(|byte| *byte == b'\t')
        .ok_or_else(|| refused("Git returned invalid stash file metadata."))?;
    if rows.next().is_some() || row[separator + 1..] != *file.as_bytes() {
        return Err(refused(
            "Git returned a different stash file than the selected path.",
        ));
    }
    Ok(true)
}
fn resolve(path: &Path, request: &FileComparisonRequest) -> Result<Sides, AppError> {
    let after = request.path.as_str();
    let before = request.previous_path.as_deref().unwrap_or(after);
    let (before, after) = match &request.context {
        FileComparisonContext::Commit { oid } => {
            let previous = parents(path, oid)?.into_iter().next();
            (
                revision(
                    if previous.is_some() {
                        "First parent"
                    } else {
                        "No parent"
                    },
                    previous,
                    before,
                ),
                revision("Commit", Some(oid.clone()), after),
            )
        }
        FileComparisonContext::Revisions {
            base_oid,
            target_oid,
        } => {
            parents(path, base_oid)?;
            parents(path, target_oid)?;
            (
                revision("Base commit", Some(base_oid.clone()), before),
                revision("Target commit", Some(target_oid.clone()), after),
            )
        }
        FileComparisonContext::RevisionWorktree { base_oid } => {
            worktree_root(path)?;
            parents(path, base_oid)?;
            (
                revision("Base commit", Some(base_oid.clone()), before),
                current("Working copy", FileContentLocation::WorkingTree, after),
            )
        }
        FileComparisonContext::WorkingTree { staged } => {
            worktree_root(path)?;
            if *staged {
                (
                    revision("HEAD", head(path)?, before),
                    current("Index", FileContentLocation::Index, after),
                )
            } else {
                (
                    current("Index", FileContentLocation::Index, before),
                    current("Working copy", FileContentLocation::WorkingTree, after),
                )
            }
        }
        FileComparisonContext::Stash { oid, layer } => {
            let ancestry = parents(path, oid)?;
            if !(2..=3).contains(&ancestry.len()) {
                return Err(refused(
                    "The selected object does not have the required stash parent structure.",
                ));
            }
            match layer {
                StashContentLayer::Index => (
                    revision("Stash base", Some(ancestry[0].clone()), before),
                    revision("Stashed index", Some(ancestry[1].clone()), after),
                ),
                StashContentLayer::WorkingTree => (
                    revision("Stashed index", Some(ancestry[1].clone()), before),
                    revision("Stashed working copy", Some(oid.clone()), after),
                ),
                StashContentLayer::Untracked => (
                    revision("No tracked base", None, before),
                    revision("Stashed untracked file", ancestry.get(2).cloned(), after),
                ),
                StashContentLayer::Combined
                    if ancestry
                        .get(2)
                        .map(|third| tree_contains(path, third, after))
                        .transpose()?
                        .unwrap_or(false) =>
                {
                    (
                        revision("No tracked base", None, before),
                        revision("Stashed untracked file", ancestry.get(2).cloned(), after),
                    )
                }
                StashContentLayer::Combined => (
                    revision("Stash base", Some(ancestry[0].clone()), before),
                    revision("Stashed working copy", Some(oid.clone()), after),
                ),
            }
        }
    };
    Ok(Sides { before, after })
}
fn read_side(
    path: &Path,
    selected: Selection,
    cancellation: &CancellationToken,
) -> Result<FileComparisonSide, AppError> {
    let content = match &selected.location {
        Some(location) => match read_file_content(path, location, &selected.path, cancellation) {
            Ok(content) => FileComparisonValue::Available(content),
            Err(error) if error.kind == "operationCancelled" || cancellation.is_cancelled() => {
                return Err(error);
            }
            Err(error) => FileComparisonValue::Unavailable(FileComparisonUnavailable {
                kind: error.kind,
                message: error.message,
                hint: error.hint,
            }),
        },
        None => FileComparisonValue::Available(file_content::FileContent::empty(
            FileContentKind::Absent,
        )),
    };
    Ok(FileComparisonSide {
        label: selected.label,
        path: selected.path,
        location: selected.location,
        content,
    })
}
pub fn read_file_comparison(
    path: &Path,
    request: &FileComparisonRequest,
    cancellation: &CancellationToken,
) -> Result<FileComparisonContent, AppError> {
    validate_file(&request.path)?;
    if let Some(previous) = &request.previous_path {
        validate_file(previous)?;
    }
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    git_cancellation::with(Some(cancellation), || {
        let selected = resolve(path, request)?;
        let mutable = matches!(
            request.context,
            FileComparisonContext::WorkingTree { .. }
                | FileComparisonContext::RevisionWorktree { .. }
        );
        let before = read_side(path, selected.before.clone(), cancellation)?;
        let after = read_side(path, selected.after.clone(), cancellation)?;
        if mutable {
            if resolve(path, request)? != selected {
                return Err(refused(
                    "The selected comparison base changed while reading.",
                ));
            }
            // A second bounded pass detects changed mutable content without
            // copying file data into general snapshots or assuming an index lease.
            for side in [&before, &after] {
                if let (
                    Some(
                        location @ (FileContentLocation::Index | FileContentLocation::WorkingTree),
                    ),
                    FileComparisonValue::Available(content),
                ) = (&side.location, &side.content)
                    && read_file_content(path, location, &side.path, cancellation)? != *content
                {
                    return Err(refused("The selected file side changed while reading."));
                }
            }
        }
        if cancellation.is_cancelled() {
            return Err(operation_cancelled());
        }
        Ok(FileComparisonContent { before, after })
    })
}

#[cfg(test)]
#[path = "file_comparison_tests.rs"]
mod tests;
