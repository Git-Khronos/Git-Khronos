//! Check prospective checkout writes against ignored data. Some Git versions
//! do not apply --no-overwrite-ignore in ort, and rebase has no such flag.
use super::*;
use std::collections::BTreeSet;

const PATH_LIMIT: usize = 4 * 1024 * 1024;

fn merge_unavailable() -> AppError {
    AppError::new(
        "mergeIgnoredPathsUnverified",
        "Could not verify that this merge will preserve ignored local files. No merge was started.",
        Some(
            "Move or back up ignored files before retrying. Nonstandard merge options may need a separate review in Git.",
        ),
    )
}

fn rebase_unavailable() -> AppError {
    AppError::new(
        "rebaseIgnoredPathsUnverified",
        "Could not check the initial rebase checkout for ignored local files. No rebase was started.",
        Some("Move or back up ignored files before retrying."),
    )
}

type Unavailable = fn() -> AppError;

fn bounded(path: &Path, args: &[&str], unavailable: Unavailable) -> Result<Output, AppError> {
    let (result, truncated) = run_git_with_stdout_limit(path, args, PATH_LIMIT)?;
    if truncated {
        return Err(unavailable());
    }
    Ok(result)
}

fn paths(bytes: &[u8], unavailable: Unavailable) -> Result<impl Iterator<Item = &[u8]>, AppError> {
    let entries = if bytes.is_empty() {
        bytes
    } else {
        bytes.strip_suffix(b"\0").ok_or_else(unavailable)?
    };
    Ok(entries
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty()))
}

fn obstructions<'a>(ignored: &'a BTreeSet<Vec<u8>>, target: &[u8]) -> Option<&'a [u8]> {
    if let Some(path) = ignored.get(target) {
        return Some(path);
    }
    for (index, _) in target.iter().enumerate().filter(|(_, byte)| **byte == b'/') {
        if let Some(path) = ignored.get(&target[..index]) {
            return Some(path);
        }
    }
    let prefix = [target, b"/"].concat();
    ignored
        .range(prefix.clone()..)
        .next()
        .filter(|candidate| candidate.starts_with(&prefix))
        .map(Vec::as_slice)
}

fn receiving_head(path: &Path, unavailable: Unavailable) -> Result<Option<String>, AppError> {
    let result = run_git(path, &["symbolic-ref", "--quiet", "HEAD"])?;
    match result.status.code() {
        Some(0) => std::str::from_utf8(&result.stdout)
            .ok()
            .and_then(|reference| reference.strip_suffix('\n'))
            .and_then(|reference| reference.strip_prefix("refs/heads/"))
            .filter(|branch| !branch.is_empty())
            .map(|branch| Some(branch.to_owned()))
            .ok_or_else(unavailable),
        Some(1) if result.stdout.is_empty() => Ok(None),
        _ => Err(unavailable()),
    }
}

fn check_branch_options(path: &Path, branch: &str) -> Result<(), AppError> {
    let config = bounded(
        path,
        &[
            "config",
            "--null",
            "--get-all",
            &format!("branch.{branch}.mergeOptions"),
        ],
        merge_unavailable,
    )?;
    if config.status.code() == Some(1) && config.stdout.is_empty() {
        return Ok(());
    }
    if !config.status.success() {
        return Err(merge_unavailable());
    }
    for option in paths(&config.stdout, merge_unavailable)?.flat_map(|entry| {
        entry
            .split(|byte| byte.is_ascii_whitespace())
            .filter(|word| !word.is_empty())
    }) {
        // These toggles affect history shape, committing or reporting, not
        // the paths that a standard merge may write. Do not guess any value.
        // The integration command explicitly selects squash or no-squash.
        if !matches!(
            option,
            b"--ff"
                | b"--no-ff"
                | b"--ff-only"
                | b"--squash"
                | b"--no-squash"
                | b"--stat"
                | b"--no-stat"
                | b"--commit"
                | b"--no-commit"
        ) {
            return Err(merge_unavailable());
        }
    }
    Ok(())
}

struct IgnoredPaths {
    entries: BTreeSet<Vec<u8>>,
    ignore_case: bool,
    summarized: bool,
}

fn normalize(raw: &[u8], ignore_case: bool) -> Vec<u8> {
    if ignore_case {
        // Non-UTF-8 filenames still get case protection for their ASCII bytes.
        std::str::from_utf8(raw).map_or_else(
            |_| raw.to_ascii_lowercase(),
            |path| path.to_lowercase().into_bytes(),
        )
    } else {
        raw.to_vec()
    }
}

fn ignored_paths(
    path: &Path,
    ignored_limit: usize,
    unavailable: Unavailable,
) -> Result<Option<IgnoredPaths>, AppError> {
    let (ignored, large_checkout) = run_git_with_stdout_limit(
        path,
        &[
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "-z",
        ],
        ignored_limit,
    )?;
    if !ignored.status.success() {
        return Err(unavailable());
    }
    // If a dependency or build directory exceeds the detailed listing limit,
    // a broader listing can still prove that no incoming path is nearby.
    let ignored = if large_checkout {
        let summary = bounded(
            path,
            &[
                "ls-files",
                "--others",
                "--ignored",
                "--exclude-standard",
                "--directory",
                "-z",
            ],
            unavailable,
        )?;
        if !summary.status.success() || summary.stdout.is_empty() {
            return Err(unavailable());
        }
        summary
    } else {
        ignored
    };
    if ignored.stdout.is_empty() {
        return Ok(None);
    }

    let casing = run_git(path, &["config", "--type=bool", "--get", "core.ignorecase"])?;
    let ignore_case = match (casing.status.code(), casing.stdout.trim_ascii()) {
        (Some(0), b"true") => true,
        (Some(0), b"false") | (Some(1), b"") => cfg!(any(windows, target_os = "macos")),
        _ => return Err(unavailable()),
    };
    let entries = paths(&ignored.stdout, unavailable)?
        .map(|raw| normalize(raw.strip_suffix(b"/").unwrap_or(raw), ignore_case))
        .collect();
    Ok(Some(IgnoredPaths {
        entries,
        ignore_case,
        summarized: large_checkout,
    }))
}

fn checkout_obstruction(
    path: &Path,
    ignored: &IgnoredPaths,
    head: &str,
    tree: &str,
    unavailable: Unavailable,
) -> Result<Option<String>, AppError> {
    let result = bounded(
        path,
        &[
            "diff-tree",
            "-r",
            "-z",
            "--no-commit-id",
            "--no-ext-diff",
            "--ignore-submodules=none",
            "--no-relative",
            "--name-only",
            "--no-renames",
            "--diff-filter=AMRT",
            head,
            tree,
            "--",
        ],
        unavailable,
    )?;
    if !result.status.success() {
        return Err(unavailable());
    }
    for target in paths(&result.stdout, unavailable)? {
        if let Some(blocked) =
            obstructions(&ignored.entries, &normalize(target, ignored.ignore_case))
        {
            // A summarized directory can contain unrelated data; do not
            // claim that an exact collision was proved.
            if ignored.summarized {
                return Err(unavailable());
            }
            return Ok(Some(String::from_utf8_lossy(blocked).into_owned()));
        }
    }
    Ok(None)
}

pub(crate) fn ensure_ignored_files_preserved(path: &Path, source: &str) -> Result<(), AppError> {
    ensure_ignored_files_preserved_with_limit(path, source, PATH_LIMIT)
}

pub(super) fn ensure_ignored_files_preserved_with_limit(
    path: &Path,
    source: &str,
    ignored_limit: usize,
) -> Result<(), AppError> {
    let unavailable = merge_unavailable;
    let Some(ignored) = ignored_paths(path, ignored_limit, unavailable)? else {
        return Ok(());
    };
    // A preflight must not run a configured merge driver or fetch missing
    // promisor objects. Strategy-changing options can produce a different tree.
    let custom = bounded(
        path,
        &[
            "config",
            "--get-regexp",
            r"^(extensions\.partialclone|remote\..*\.promisor|merge\..*\.(driver|recursive)|merge\.(default|renormalize)|pull\.twohead)$",
        ],
        unavailable,
    )?;
    if custom.status.code() != Some(1) || !custom.stdout.is_empty() {
        return Err(unavailable());
    }
    let receiver = receiving_head(path, unavailable)?;
    if let Some(branch) = receiver.as_deref() {
        check_branch_options(path, branch)?;
    }
    without_lazy_fetch(|| {
        let head = reference_tip(path, "HEAD").ok_or_else(unavailable)?;
        let tip = reference_tip(path, source).ok_or_else(unavailable)?;
        let merge = bounded(
            path,
            &[
                "merge-tree",
                "--write-tree",
                "--name-only",
                "--no-messages",
                "-z",
                &head,
                &tip,
            ],
            unavailable,
        )?;
        if !matches!(merge.status.code(), Some(0 | 1)) {
            return Err(unavailable());
        }
        // On conflicts Git still returns a tree with the paths it would write.
        let tree = paths(&merge.stdout, unavailable)?
            .next()
            .ok_or_else(unavailable)?;
        let tree = std::str::from_utf8(tree).map_err(|_| unavailable())?;
        validate_commit_oid(tree).map_err(|_| unavailable())?;
        if let Some(blocked) = checkout_obstruction(path, &ignored, &head, tree, unavailable)? {
            return Err(AppError::new(
                "mergeLocalPathObstruction",
                format!("The merge would overwrite ignored local contents at '{blocked}'."),
                Some(
                    "Move the ignored file or directory out of the way, then review the merge again.",
                ),
            ));
        }
        if reference_tip(path, "HEAD").as_deref() != Some(head.as_str())
            || reference_tip(path, source).as_deref() != Some(tip.as_str())
            || receiving_head(path, unavailable)? != receiver
        {
            return Err(unavailable());
        }
        Ok(())
    })
}

/// Check the worktree transitions before replay starts, not the result of
/// applying later commits. Git may check out a source branch before the base.
pub(super) fn ensure_rebase_start_preserves_ignored_files(
    path: &Path,
    pre_rebase_source: Option<&str>,
    onto: &str,
) -> Result<(), AppError> {
    let unavailable = rebase_unavailable;
    let Some(ignored) = ignored_paths(path, PATH_LIMIT, unavailable)? else {
        return Ok(());
    };
    // Older supported Git can lazily fetch missing objects even when
    // GIT_NO_LAZY_FETCH is set. No transport belongs in this preflight.
    let promisor = bounded(
        path,
        &[
            "config",
            "--get-regexp",
            r"^(extensions\.partialclone|remote\..*\.promisor)$",
        ],
        unavailable,
    )?;
    if promisor.status.code() != Some(1) || !promisor.stdout.is_empty() {
        return Err(unavailable());
    }
    let receiver = receiving_head(path, unavailable)?;
    without_lazy_fetch(|| {
        let head = reference_tip(path, "HEAD").ok_or_else(unavailable)?;
        let tip = reference_tip(path, onto).ok_or_else(unavailable)?;
        // Diff against the original HEAD: the ignored files belong to this
        // worktree, regardless of any intermediate source checkout.
        let source_tip = pre_rebase_source
            .map(|source| reference_tip(path, source).ok_or_else(unavailable))
            .transpose()?;
        for target in source_tip.iter().chain(std::iter::once(&tip)) {
            if let Some(blocked) = checkout_obstruction(path, &ignored, &head, target, unavailable)?
            {
                return Err(AppError::new(
                    "rebaseLocalPathObstruction",
                    format!(
                        "The initial rebase checkout could overwrite ignored local contents at '{blocked}'."
                    ),
                    Some(
                        "Move the ignored file or directory out of the way, then review the rebase again.",
                    ),
                ));
            }
        }
        if reference_tip(path, "HEAD").as_ref() != Some(&head)
            || reference_tip(path, onto).as_ref() != Some(&tip)
            || pre_rebase_source.is_some_and(|source| reference_tip(path, source) != source_tip)
            || receiving_head(path, unavailable)? != receiver
        {
            return Err(unavailable());
        }
        Ok(())
    })
}
