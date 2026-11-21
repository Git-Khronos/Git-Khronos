//! Check prospective merge paths against ignored data before Git updates the
//! checkout. Some Git versions do not apply --no-overwrite-ignore in ort.
use super::*;
use std::collections::BTreeSet;

const PATH_LIMIT: usize = 4 * 1024 * 1024;

fn unavailable() -> AppError {
    AppError::new(
        "mergeIgnoredPathsUnverified",
        "Could not verify that this merge will preserve ignored local files. No merge was started.",
        Some(
            "Move or back up ignored files before retrying. Nonstandard merge options may need a separate review in Git.",
        ),
    )
}

fn bounded(path: &Path, args: &[&str]) -> Result<Output, AppError> {
    let (result, truncated) = run_git_with_stdout_limit(path, args, PATH_LIMIT)?;
    if truncated {
        return Err(unavailable());
    }
    Ok(result)
}

fn paths(bytes: &[u8]) -> Result<impl Iterator<Item = &[u8]>, AppError> {
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

pub(crate) fn ensure_ignored_files_preserved(path: &Path, source: &str) -> Result<(), AppError> {
    ensure_ignored_files_preserved_with_limit(path, source, PATH_LIMIT)
}

pub(super) fn ensure_ignored_files_preserved_with_limit(
    path: &Path,
    source: &str,
    ignored_limit: usize,
) -> Result<(), AppError> {
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
        )?;
        if !summary.status.success() || summary.stdout.is_empty() {
            return Err(unavailable());
        }
        summary
    } else {
        ignored
    };
    if ignored.stdout.is_empty() {
        return Ok(());
    }

    // A preflight must not run a configured merge driver or fetch missing
    // promisor objects. Strategy-changing options can produce a different tree.
    let custom = bounded(
        path,
        &[
            "config",
            "--get-regexp",
            r"^(extensions\.partialclone|remote\..*\.promisor|merge\..*\.(driver|recursive)|merge\.default|branch\..*\.mergeoptions|pull\.twohead)$",
        ],
    )?;
    if custom.status.code() != Some(1) || !custom.stdout.is_empty() {
        return Err(unavailable());
    }
    let casing = run_git(path, &["config", "--type=bool", "--get", "core.ignorecase"])?;
    let ignore_case = match (casing.status.code(), casing.stdout.trim_ascii()) {
        (Some(0), b"true") => true,
        (Some(0), b"false") | (Some(1), b"") => cfg!(any(windows, target_os = "macos")),
        _ => return Err(unavailable()),
    };
    let normalize = |raw: &[u8]| {
        if ignore_case {
            // Non-UTF-8 filenames still get case protection for their ASCII bytes.
            std::str::from_utf8(raw).map_or_else(
                |_| raw.to_ascii_lowercase(),
                |path| path.to_lowercase().into_bytes(),
            )
        } else {
            raw.to_vec()
        }
    };
    let ignored: BTreeSet<_> = paths(&ignored.stdout)?
        .map(|raw| normalize(raw.strip_suffix(b"/").unwrap_or(raw)))
        .collect();

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
        )?;
        if !matches!(merge.status.code(), Some(0 | 1)) {
            return Err(unavailable());
        }
        // On conflicts Git still returns a tree with the paths it would write.
        let tree = paths(&merge.stdout)?.next().ok_or_else(unavailable)?;
        let tree = std::str::from_utf8(tree).map_err(|_| unavailable())?;
        validate_commit_oid(tree).map_err(|_| unavailable())?;
        let result = bounded(
            path,
            &[
                "diff-tree",
                "-r",
                "-z",
                "--no-commit-id",
                "--no-ext-diff",
                "--name-only",
                "--no-renames",
                "--diff-filter=AMRT",
                &head,
                tree,
                "--",
            ],
        )?;
        if !result.status.success() {
            return Err(unavailable());
        }
        for target in paths(&result.stdout)? {
            if let Some(blocked) = obstructions(&ignored, &normalize(target)) {
                if large_checkout {
                    // A summarized directory can contain unrelated data;
                    // do not claim that an exact collision was proved.
                    return Err(unavailable());
                }
                return Err(AppError::new(
                    "mergeLocalPathObstruction",
                    format!(
                        "The merge would overwrite ignored local contents at '{}'.",
                        String::from_utf8_lossy(blocked)
                    ),
                    Some(
                        "Move the ignored file or directory out of the way, then review the merge again.",
                    ),
                ));
            }
        }
        if reference_tip(path, "HEAD").as_deref() != Some(head.as_str())
            || reference_tip(path, source).as_deref() != Some(tip.as_str())
        {
            return Err(unavailable());
        }
        Ok(())
    })
}
