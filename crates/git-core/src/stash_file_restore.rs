use super::*;
use std::io::{Seek, SeekFrom};

fn refused(message: impl Into<String>) -> AppError {
    AppError::new(
        "stashFileRestoreRefused",
        message,
        Some("The stash was kept. Preserve current files and refresh the stash before retrying."),
    )
}

struct ScratchPatch {
    directory: PathBuf,
    file: Option<fs::File>,
}

impl ScratchPatch {
    fn new() -> Result<Self, AppError> {
        let mut random = [0; 16];
        getrandom::fill(&mut random).map_err(|error| {
            refused(format!("Could not allocate private patch storage: {error}"))
        })?;
        let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let directory = std::env::temp_dir().join(format!("git-khronos-stash-file-{suffix}"));
        #[cfg_attr(not(unix), allow(unused_mut))]
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(&directory)
            .map_err(|error| refused(format!("Could not create private patch storage: {error}")))?;
        let mut result = Self {
            directory,
            file: None,
        };
        let mut options = fs::OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        result.file = Some(
            options
                .open(result.directory.join("patch"))
                .map_err(|error| refused(format!("Could not create a private patch: {error}")))?,
        );
        Ok(result)
    }

    fn append_diff(
        &mut self,
        path: &Path,
        base: &str,
        target: &str,
        files: &[&str],
    ) -> Result<(), AppError> {
        let file = self.file.as_mut().expect("private patch is open");
        file.seek(SeekFrom::End(0))
            .map_err(|error| refused(format!("Could not prepare the selected patch: {error}")))?;
        let output = git_in(path)
            .args([
                "--no-lazy-fetch",
                "--literal-pathspecs",
                "diff",
                "--binary",
                "--full-index",
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                "--no-renames",
                "--no-relative",
                "--src-prefix=a/",
                "--dst-prefix=b/",
                "--ignore-submodules=none",
                base,
                target,
                "--",
            ])
            .args(files)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("LC_ALL", "C")
            .stdin(Stdio::null())
            .stdout(Stdio::from(file.try_clone().map_err(|error| {
                refused(format!("Could not write the selected patch: {error}"))
            })?))
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| refused(format!("Could not start Git: {error}")))?;
        ensure_success("prepare the complete selected stash patch", &output)
    }

    fn apply(&mut self, path: &Path, flags: &[&str]) -> Result<Output, AppError> {
        let file = self.file.as_mut().expect("private patch is open");
        file.seek(SeekFrom::Start(0))
            .map_err(|error| refused(format!("Could not read the selected patch: {error}")))?;
        git_in(path)
            .args([
                "-c",
                "apply.ignoreWhitespace=false",
                "apply",
                "--whitespace=nowarn",
            ])
            .args(flags)
            .arg("-")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("LC_ALL", "C")
            .stdin(Stdio::from(file.try_clone().map_err(|error| {
                refused(format!("Could not read the selected patch: {error}"))
            })?))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| refused(format!("Could not start Git: {error}")))
    }
}

impl Drop for ScratchPatch {
    fn drop(&mut self) {
        drop(self.file.take());
        let _ = fs::remove_file(self.directory.join("patch"));
        let _ = fs::remove_dir(&self.directory);
    }
}

fn stash_parents(path: &Path, oid: &str) -> Result<Vec<String>, AppError> {
    let output = run_git(path, &["rev-list", "--parents", "-n", "1", oid, "--"])?;
    ensure_success("inspect the selected stash parents", &output)?;
    let line = std::str::from_utf8(&output.stdout)
        .map_err(|_| refused("Git returned invalid stash parent IDs."))?;
    let mut ids = line.split_whitespace();
    if ids.next() != Some(oid) {
        return Err(refused("Git returned a different stash object."));
    }
    let parents = ids.map(str::to_owned).collect::<Vec<_>>();
    if !(2..=3).contains(&parents.len()) {
        return Err(refused(
            "The selected object does not have a supported stash shape.",
        ));
    }
    for parent in &parents {
        validate_commit_oid(parent)?;
    }
    Ok(parents)
}

fn validate_paths(path: &Path, files: &[&str], trees: &[&str]) -> Result<(), AppError> {
    for file in files {
        file_content::validate_file(file)?;
        patch_exchange::safe_stash_path(path, file).map_err(|error| refused(error.message))?;
        let unmerged = file_content::metadata_git(
            path,
            &[
                "--literal-pathspecs",
                "ls-files",
                "--unmerged",
                "-z",
                "--",
                file,
            ],
        )?;
        if !unmerged.is_empty() {
            return Err(refused(format!("Resolve the conflict in {file:?} first.")));
        }
        let flags = file_content::metadata_git(
            path,
            &["--literal-pathspecs", "ls-files", "-v", "-z", "--", file],
        )?;
        if !flags.is_empty() && !flags.ends_with(&[0]) {
            return Err(refused("Git returned incomplete index path metadata."));
        }
        for record in flags
            .split(|byte| *byte == 0)
            .filter(|record| !record.is_empty())
        {
            if record.len() < 3 || record[1] != b' ' || &record[2..] != file.as_bytes() {
                return Err(refused("Git returned unexpected index path metadata."));
            }
            if record[0] == b'S' || record[0].is_ascii_lowercase() {
                return Err(refused(format!(
                    "{file:?} has a hidden or sparse index entry. Restore it to the visible working tree first."
                )));
            }
        }
        for tree in trees {
            let entries = file_content::metadata_git(
                path,
                &[
                    "--literal-pathspecs",
                    "ls-tree",
                    "--full-tree",
                    "-z",
                    tree,
                    "--",
                    file,
                ],
            )?;
            if !entries.is_empty() && !entries.ends_with(&[0]) {
                return Err(refused("Git returned incomplete stash file metadata."));
            }
            for record in entries
                .split(|byte| *byte == 0)
                .filter(|record| !record.is_empty())
            {
                let Some(tab) = record.iter().position(|byte| *byte == b'\t') else {
                    return Err(refused("Git returned invalid stash file metadata."));
                };
                if &record[tab + 1..] != file.as_bytes() {
                    return Err(refused("Git returned a different stash file."));
                }
                let mode = record[..tab]
                    .split(|byte| *byte == b' ')
                    .next()
                    .unwrap_or_default();
                if mode == b"160000" {
                    return Err(refused(
                        "A submodule change cannot be applied as a file patch. Update the submodule separately.",
                    ));
                }
                if !matches!(mode, b"100644" | b"100755" | b"120000") {
                    return Err(refused("The selected stash path is not a supported file."));
                }
            }
        }
    }
    Ok(())
}

fn validate_patch_paths(
    path: &Path,
    patch: &mut ScratchPatch,
    files: &[&str],
    require_previous: bool,
) -> Result<(), AppError> {
    let output = patch.apply(path, &["--numstat", "-z"])?;
    ensure_success("inspect the selected stash patch", &output)?;
    if !output.stdout.ends_with(&[0]) {
        return Err(refused("The selected stash has no complete file patch."));
    }
    let mut seen = HashSet::new();
    for record in output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        let fields = record.splitn(3, |byte| *byte == b'\t').collect::<Vec<_>>();
        if fields.len() != 3
            || !files.iter().any(|file| file.as_bytes() == fields[2])
            || !seen.insert(fields[2].to_vec())
        {
            return Err(refused(
                "The selected patch contains unexpected or repeated paths.",
            ));
        }
    }
    if !seen.contains(files[0].as_bytes())
        || (require_previous && (files.len() != 2 || !seen.contains(files[1].as_bytes())))
    {
        return Err(refused(
            "The selected file's complete stash change is unavailable.",
        ));
    }
    Ok(())
}

pub fn apply_stashed_file(
    path: &Path,
    reference: &str,
    expected_oid: &str,
    file: &str,
    previous_file: Option<&str>,
) -> Result<(), AppError> {
    validate_selected_stash(path, reference, expected_oid)?;
    let root = file_content::worktree_root(path)?;
    let details = stash_details_at_oid(path, expected_oid)?;
    let selected = details
        .files
        .iter()
        .find(|candidate| candidate.path == file)
        .ok_or_else(|| refused("The selected file is no longer in the displayed stash."))?;
    if selected.previous_path.as_deref() != previous_file {
        return Err(refused(
            "The selected stash file or its previous name changed.",
        ));
    }
    let mut files = vec![file];
    if let Some(previous) = previous_file.filter(|previous| *previous != file) {
        files.push(previous);
    }
    let parents = stash_parents(path, expected_oid)?;
    let mut trees = vec![parents[0].as_str(), expected_oid];
    if parents.len() == 3 {
        trees.push(&parents[2]);
    }
    validate_paths(&root, &files, &trees)?;

    let mut patch = ScratchPatch::new()?;
    patch.append_diff(&root, &parents[0], expected_oid, &files)?;
    if parents.len() == 3 {
        let empty_tree = if expected_oid.len() == 64 {
            EMPTY_TREE_SHA256_OID
        } else {
            EMPTY_TREE_OID
        };
        patch.append_diff(&root, empty_tree, &parents[2], &files)?;
    }
    validate_patch_paths(&root, &mut patch, &files, selected.status.starts_with('R'))?;
    let check = patch.apply(&root, &["--check"])?;
    ensure_success("check the selected stash change against current files", &check).map_err(
        |mut error| {
            error.hint = Some(
                "No patch was applied. Preserve conflicting changes or choose another destination; the stash remains saved."
                    .to_owned(),
            );
            error
        },
    )?;
    validate_selected_stash(&root, reference, expected_oid)?;
    validate_paths(&root, &files, &trees)?;
    let output = patch.apply(&root, &[])?;
    ensure_success("apply the selected stash change", &output).map_err(|mut error| {
        error.hint =
            Some("The stash remains saved. Inspect the selected files before retrying.".to_owned());
        error
    })
}
