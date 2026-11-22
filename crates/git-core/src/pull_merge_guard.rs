//! Git Pull's CLI does not accept --no-overwrite-ignore. Carry it through the
//! receiving branch's invocation-scoped merge options instead. This protects
//! Git's fast-forward checkout, not divergent ort merges or rebase replay.
use super::*;

pub(super) const OPTIONS_ENV: &str = "GIT_KHRONOS_PULL_MERGE_OPTIONS";
const OPTIONS_LIMIT: usize = 32 * 1024;

fn unavailable() -> AppError {
    AppError::new(
        "pullIgnoreProtectionUnavailable",
        "Pull could not enable ignored-file protection for fast-forward checkout. Nothing was fetched or integrated.",
        Some(
            "Move or back up ignored files outside the repository, or use Fetch and review the integration separately.",
        ),
    )
}

fn unsupported_with_ignored(
    path: &Path,
    cancellation: Option<&CancellationToken>,
) -> Result<Option<(String, String)>, AppError> {
    let (output, truncated) = run_git_with_stdout_limit_and_cancellation(
        path,
        &[
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
            "-z",
        ],
        1,
        cancellation,
    )?;
    if !truncated && output.status.success() && output.stdout.is_empty() {
        return Ok(None);
    }
    Err(unavailable())
}

fn accepts_appended_switch(options: &str) -> bool {
    // Do not try to interpret an arbitrary command line. These known switches
    // (including explicitly attached values) cannot consume or hide our next
    // argument. In particular, Git can ignore options after a quoted/bare "--".
    options.split_ascii_whitespace().all(|arg| {
        matches!(
            arg,
            "-n" | "-q"
                | "-v"
                | "--ff"
                | "--no-ff"
                | "--ff-only"
                | "--squash"
                | "--no-squash"
                | "--commit"
                | "--no-commit"
                | "--stat"
                | "--no-stat"
                | "--compact-summary"
                | "--no-compact-summary"
                | "--log"
                | "--no-log"
                | "--edit"
                | "--no-edit"
                | "--signoff"
                | "--no-signoff"
                | "--verify"
                | "--no-verify"
                | "--gpg-sign"
                | "--no-gpg-sign"
                | "--verify-signatures"
                | "--no-verify-signatures"
                | "--autostash"
                | "--no-autostash"
                | "--rerere-autoupdate"
                | "--no-rerere-autoupdate"
                | "--quiet"
                | "--verbose"
                | "--progress"
                | "--no-progress"
                | "--allow-unrelated-histories"
                | "--no-allow-unrelated-histories"
                | "--overwrite-ignore"
                | "--no-overwrite-ignore"
        ) || (["--log=", "--gpg-sign=", "--strategy=", "--strategy-option="]
            .iter()
            .any(|prefix| {
                arg.strip_prefix(prefix).is_some_and(|value| {
                    !value.is_empty()
                        && value.bytes().all(|byte| {
                            byte.is_ascii_alphanumeric() || b".-_/=:+,@".contains(&byte)
                        })
                })
            }))
    })
}

pub(super) fn for_checkout(
    path: &Path,
    cancellation: Option<&CancellationToken>,
) -> Result<Option<(String, String)>, AppError> {
    let head = run_git_with_cancellation(
        path,
        &["symbolic-ref", "--quiet", "--no-recurse", "HEAD"],
        cancellation,
    )?;
    if head.status.code() == Some(1) && head.stdout.is_empty() {
        // Git has no per-receiver merge options for a detached checkout.
        return unsupported_with_ignored(path, cancellation);
    }
    let branch = head
        .status
        .success()
        .then(|| std::str::from_utf8(&head.stdout).ok())
        .flatten()
        .and_then(|head| head.strip_suffix('\n'))
        .and_then(|head| head.strip_prefix("refs/heads/"))
        .filter(|branch| !branch.is_empty())
        .ok_or_else(unavailable)?;
    let key = format!("branch.{branch}.mergeOptions");
    let (configured, truncated) = run_git_with_stdout_limit_and_cancellation(
        path,
        &["config", "--null", "--get", &key],
        OPTIONS_LIMIT,
        cancellation,
    )?;
    let old = match (
        truncated,
        configured.status.code(),
        configured.stdout.as_slice(),
    ) {
        (false, Some(1), []) => Some(""),
        (false, Some(0), raw) => raw
            .strip_suffix(b"\0")
            .and_then(|value| std::str::from_utf8(value).ok())
            .filter(|value| accepts_appended_switch(value)),
        _ => None,
    };
    let Some(old) = old else {
        return unsupported_with_ignored(path, cancellation);
    };
    // --config-env can represent branch names containing '=' and does not
    // need to expose the option value in command-line diagnostics.
    Ok(Some((
        format!("--config-env={key}={OPTIONS_ENV}"),
        format!("{old} --no-overwrite-ignore"),
    )))
}
