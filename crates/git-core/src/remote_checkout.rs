use crate::{
    AppError, CancellationToken, ensure_success, fetch_options, operation_cancelled, read_remotes,
    resolve_repository, run_git, run_git_with_cancellation, run_git_with_stdout_limit,
    run_mutation, switch_checkout, validate_branch_name, worktree_diagnostics,
};
use serde::Serialize;
use std::path::Path;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum RemoteCheckoutOutcome {
    Created,
    Updated,
    UpToDate,
    Ahead,
    Diverged,
}

fn pattern_capture<'a>(pattern: &str, value: &'a str) -> Option<&'a str> {
    match pattern.split_once('*') {
        None => (pattern == value).then_some(""),
        Some((prefix, suffix)) if !suffix.contains('*') => {
            value.strip_prefix(prefix)?.strip_suffix(suffix)
        }
        _ => None,
    }
}

fn mapped_source(source: &str, destination: &str, target: &str) -> Option<String> {
    let captured = pattern_capture(destination, target)?;
    if source.matches('*').count() != destination.matches('*').count() {
        return None;
    }
    Some(source.replace('*', captured))
}

fn selected_mapping(path: &Path, name: &str) -> Result<(String, String, String), AppError> {
    validate_branch_name(path, name)?;
    let target = format!("refs/remotes/{name}");
    let mut candidates = Vec::new();
    for remote in read_remotes(path)? {
        let output = run_git(
            path,
            &[
                "config",
                "--get-all",
                &format!("remote.{}.fetch", remote.name),
            ],
        )?;
        if output.status.code() == Some(1) {
            continue;
        }
        ensure_success("inspect remote fetch mappings", &output)?;
        let specs = std::str::from_utf8(&output.stdout).map_err(|_| {
            AppError::new(
                "unsupportedRemoteEncoding",
                "The remote fetch mappings are not UTF-8.",
                None,
            )
        })?;
        let exclusions: Vec<_> = specs
            .lines()
            .filter_map(|line| line.strip_prefix('^'))
            .collect();
        for spec in specs.lines().filter(|line| !line.starts_with('^')) {
            let Some((source, destination)) = spec.trim_start_matches('+').split_once(':') else {
                continue;
            };
            let Some(source) = mapped_source(source, destination, &target) else {
                continue;
            };
            if exclusions
                .iter()
                .any(|pattern| pattern_capture(pattern, &source).is_some())
            {
                continue;
            }
            if let Some(local) = source.strip_prefix("refs/heads/")
                && local != "HEAD"
            {
                validate_branch_name(path, local)?;
                candidates.push((remote.name.clone(), source.clone(), local.to_owned()));
            }
        }
    }
    candidates.sort();
    candidates.dedup();
    if candidates.len() != 1 {
        return Err(AppError::new(
            "ambiguousRemoteBranch",
            format!("Cannot identify a unique remote branch for '{name}'."),
            Some("Review the configured remotes and fetch mappings, then retry."),
        ));
    }
    Ok(candidates.remove(0))
}

/// Rename and delete operate on a named branch, not just an OID. Refuse when
/// the selected tracking ref is an alias for a different source branch or
/// is also claimed by another configured remote.
pub(crate) fn require_direct_remote_branch_mapping(
    path: &Path,
    remote: &str,
    branch: &str,
) -> Result<(), AppError> {
    let name = format!("{remote}/{branch}");
    let (mapped_remote, _, mapped_branch) = selected_mapping(path, &name)?;
    if mapped_remote != remote || mapped_branch != branch {
        return Err(AppError::new(
            "unsupportedRemoteMapping",
            "The selected tracking ref maps to a different remote branch. Nothing was sent.",
            Some("Review the remote fetch mapping in Git before renaming or deleting the branch."),
        ));
    }
    require_direct_tracking_ref(path, &format!("refs/remotes/{name}"))
}

pub(super) fn require_direct_tracking_ref(path: &Path, reference: &str) -> Result<(), AppError> {
    let symbolic = run_git(
        path,
        &["symbolic-ref", "--quiet", "--no-recurse", reference],
    )?;
    if symbolic.status.success() {
        return Err(AppError::new(
            "invalidRemoteBranch",
            "Select a remote branch, not a symbolic alias.",
            None,
        ));
    }
    if symbolic.status.code() != Some(1) {
        ensure_success("check the remote tracking ref", &symbolic)?;
    }
    Ok(())
}

fn ancestor(path: &Path, first: &str, second: &str) -> Result<bool, AppError> {
    let output = run_git(path, &["merge-base", "--is-ancestor", first, second])?;
    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => {
            ensure_success("compare branch histories", &output)?;
            unreachable!()
        }
    }
}

fn check_worktree(path: &Path, branch: &str) -> Result<(), AppError> {
    let (output, truncated) = run_git_with_stdout_limit(
        path,
        &["worktree", "list", "--porcelain", "-z"],
        1024 * 1024,
    )?;
    if truncated {
        return Err(AppError::new(
            "worktreeListIncomplete",
            "The worktree list is too large to check safely.",
            None,
        ));
    }
    ensure_success("check branch worktree occupancy", &output)?;
    let current = resolve_repository(path)?;
    for registration in worktree_diagnostics::parse_registrations(&output.stdout)? {
        if registration.branch.as_deref() == Some(branch)
            && !std::fs::canonicalize(&registration.path)
                .is_ok_and(|candidate| candidate == current)
        {
            return Err(AppError::new(
                "branchInAnotherWorktree",
                format!(
                    "Branch '{branch}' is checked out in another worktree: {}",
                    registration.path
                ),
                Some("Open that worktree to update the branch."),
            ));
        }
    }
    Ok(())
}

fn remote_branch_exists(
    path: &Path,
    remote: &str,
    source: &str,
    cancellation: &CancellationToken,
) -> Result<bool, AppError> {
    let output = run_git_with_cancellation(
        path,
        &["ls-remote", "--refs", "--", remote, source],
        Some(cancellation),
    )?;
    ensure_success("inspect the selected remote branch", &output)?;
    Ok(String::from_utf8_lossy(&output.stdout).lines().any(|line| {
        line.split_once('\t')
            .is_some_and(|(_, reference)| reference == source)
    }))
}

fn deleted_branch(name: &str) -> AppError {
    AppError::new(
        "remoteBranchDeleted",
        format!("Branch '{name}' was deleted on the remote."),
        Some("Refresh the repository and choose another branch."),
    )
}

pub fn sync_checkout_remote_branch(
    path: &Path,
    name: &str,
    cancellation: &CancellationToken,
) -> Result<RemoteCheckoutOutcome, AppError> {
    let (remote, source, local) = selected_mapping(path, name)?;
    let target = format!("refs/remotes/{name}");
    require_direct_tracking_ref(path, &target)?;
    let namespace = format!("refs/remotes/{remote}/");
    if !target.starts_with(&namespace) {
        return Err(AppError::new(
            "unsupportedRemoteMapping",
            "The selected fetch mapping is outside its remote's tracking namespace.",
            Some("Review this custom fetch mapping in local Git."),
        ));
    }
    fetch_options::check_tracking_aliases(path, &namespace)?;
    if !remote_branch_exists(path, &remote, &source, cancellation)? {
        return Err(deleted_branch(name));
    }
    let refspec = format!("+{source}:{target}");
    let fetched = run_git_with_cancellation(
        path,
        &[
            "-c",
            "fetch.parallel=1",
            "-c",
            "pack.threads=1",
            "fetch",
            "--no-all",
            "--atomic",
            "--no-auto-maintenance",
            "--no-recurse-submodules",
            "--no-tags",
            "--no-prune",
            "--no-prune-tags",
            "--refmap=",
            "--",
            &remote,
            &refspec,
        ],
        Some(cancellation),
    );
    let output = match fetched {
        Ok(output) => output,
        Err(error) if error.kind == "gitTransportFailure" => {
            if matches!(
                remote_branch_exists(path, &remote, &source, cancellation),
                Ok(false)
            ) {
                return Err(deleted_branch(name));
            }
            return Err(error);
        }
        Err(error) => return Err(error),
    };
    ensure_success("fetch the selected remote branch", &output)?;
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    let remote_oid = run_git(
        path,
        &["rev-parse", "--verify", &format!("{target}^{{commit}}")],
    )?;
    ensure_success("read the fetched branch", &remote_oid)?;
    let remote_oid = String::from_utf8_lossy(&remote_oid.stdout)
        .trim()
        .to_owned();
    let local_ref = format!("refs/heads/{local}");
    let existing = run_git(path, &["show-ref", "--verify", "--quiet", &local_ref])?;
    if existing.status.code() == Some(1) {
        switch_checkout(
            path,
            &["--track", "-c", &local, "--", &target],
            "create a local tracking branch",
        )?;
        return Ok(RemoteCheckoutOutcome::Created);
    }
    ensure_success("inspect the local branch", &existing)?;
    check_worktree(path, &local)?;
    let before = run_git(
        path,
        &["rev-parse", "--verify", &format!("{local_ref}^{{commit}}")],
    )?;
    ensure_success("read the local branch", &before)?;
    let before = String::from_utf8_lossy(&before.stdout).trim().to_owned();
    let outcome = if before == remote_oid {
        RemoteCheckoutOutcome::UpToDate
    } else if ancestor(path, &before, &remote_oid)? {
        RemoteCheckoutOutcome::Updated
    } else if ancestor(path, &remote_oid, &before)? {
        RemoteCheckoutOutcome::Ahead
    } else {
        RemoteCheckoutOutcome::Diverged
    };
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    switch_checkout(path, &["--", &local], "switch branches")?;
    if outcome == RemoteCheckoutOutcome::Updated {
        if cancellation.is_cancelled() {
            return Err(AppError::new(
                "remoteCheckoutInterrupted",
                "Fetch completed and the local branch was checked out, but the update was cancelled.",
                Some("Inspect the branch before retrying."),
            ));
        }
        let current = run_git(path, &["symbolic-ref", "--quiet", "HEAD"])?;
        ensure_success("verify the checked-out branch", &current)?;
        let current_oid = run_git(path, &["rev-parse", "--verify", "HEAD^{commit}"])?;
        ensure_success("verify the checked-out commit", &current_oid)?;
        if String::from_utf8_lossy(&current.stdout).trim() != local_ref
            || String::from_utf8_lossy(&current_oid.stdout).trim() != before
        {
            return Err(AppError::new(
                "remoteCheckoutChanged",
                "The local branch changed during checkout, so no update was attempted.",
                Some("Refresh and inspect the branch before retrying."),
            ));
        }
        run_mutation(
            path,
            &[
                "-c",
                "merge.autostash=false",
                "-c",
                "submodule.recurse=false",
                "merge",
                "--ff-only",
                "--no-autostash",
                "--no-overwrite-ignore",
                "--",
                &remote_oid,
            ],
            "fast-forward the local branch",
        ).map_err(|mut error| {
            error.kind = "remoteCheckoutUpdateFailed".into();
            error.hint = Some("The local branch was checked out, but the update did not complete. Preserve changes and inspect the branch and working files before retrying.".into());
            error
        })?;
    }
    Ok(outcome)
}
