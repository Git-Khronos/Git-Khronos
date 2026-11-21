use super::*;
use crate::reference_actions::single_push_destination;

/// Remote side of a tag rename: the remote name and the tag object it is
/// expected to hold, as read by `remote_tag_object`.
pub struct RemoteTagLease<'a> {
    pub remote: &'a str,
    pub expected_object: &'a str,
}

/// Renames a local tag without changing the object it points to, so annotated
/// and signed tags keep their message and signature. When `remote` is set the
/// remote tag is renamed first in one atomic push; the local rename follows.
pub fn rename_tag(
    path: &Path,
    name: &str,
    new_name: &str,
    expected_target: &str,
    remote: Option<RemoteTagLease<'_>>,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    validate_tag_name(path, name)?;
    validate_tag_name(path, new_name)?;
    refuse_same_name(name, new_name)?;
    validate_commit_oid(expected_target)?;
    let reference = format!("refs/tags/{name}");
    let new_reference = format!("refs/tags/{new_name}");
    let object = reference_tip(path, &reference).ok_or_else(|| {
        AppError::new(
            "tagNotFound",
            format!("The tag '{name}' no longer exists."),
            Some("Refresh the repository and choose the tag again."),
        )
    })?;
    let target = reference_tip(path, &format!("{object}^{{commit}}"));
    if target.as_deref() != Some(expected_target) {
        return Err(AppError::new(
            "staleReference",
            "That tag moved since it was selected.",
            Some("Refresh and review its new target before renaming."),
        ));
    }
    if reference_tip(path, &new_reference).is_some() {
        return Err(AppError::new(
            "referenceExists",
            format!("A tag named '{new_name}' already exists."),
            Some("Choose a different tag name."),
        ));
    }
    if let Some(lease) = &remote {
        validate_remote_name(path, lease.remote)?;
        require_remote(path, lease.remote)?;
        single_push_destination(path, lease.remote)?;
        validate_commit_oid(lease.expected_object)?;
        if lease.expected_object != object {
            return Err(AppError::new(
                "remoteTagDiffers",
                format!(
                    "The tag '{name}' on {} points to a different object than the local tag.",
                    lease.remote
                ),
                Some("Fetch tags or push the local tag first, then rename it again."),
            ));
        }
        push_atomic_rename(
            path,
            lease.remote,
            &object,
            &reference,
            &new_reference,
            "rename the tag on the remote",
            cancellation,
        )?;
    }
    let transaction = format!("create {new_reference} {object}\ndelete {reference} {object}\n");
    let local = run_git_with_input(
        path,
        &["update-ref", "-m", "Rename tag", "--stdin"],
        transaction.as_bytes(),
        "rename the local tag",
    );
    match (local, remote) {
        (Err(error), Some(lease)) => Err(AppError::new(
            "tagRenamePartiallyApplied",
            format!(
                "The tag was renamed from '{name}' to '{new_name}' on {}, but the local tag could not be renamed: {}",
                lease.remote, error.message
            ),
            Some("Fetch tags to pick up the new name, then delete the old local tag."),
        )),
        (result, _) => result,
    }
}

/// Renames a branch on a remote: the new name is created at the remote-tracking
/// tip and the old name is deleted in one atomic push guarded by leases. Local
/// branches that tracked the old name are moved to track the new one.
pub fn rename_remote_branch(
    path: &Path,
    remote: &str,
    name: &str,
    new_name: &str,
    expected_oid: &str,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    validate_remote_name(path, remote)?;
    require_remote(path, remote)?;
    single_push_destination(path, remote)?;
    validate_branch_name(path, name)?;
    validate_branch_name(path, new_name)?;
    refuse_same_name(name, new_name)?;
    validate_commit_oid(expected_oid)?;
    crate::remote_checkout::require_direct_remote_branch_mapping(path, remote, name)?;
    crate::remote_checkout::require_direct_remote_branch_mapping(path, remote, new_name)?;
    let tracking = format!("refs/remotes/{remote}/{name}");
    let new_tracking = format!("refs/remotes/{remote}/{new_name}");
    if reference_tip(path, &tracking).as_deref() != Some(expected_oid) {
        return Err(AppError::new(
            "staleReference",
            format!("{remote}/{name} moved or no longer exists."),
            Some("Fetch the remote and review the branch before renaming it."),
        ));
    }
    if reference_tip(path, &new_tracking).is_some() {
        return Err(AppError::new(
            "referenceExists",
            format!("A branch named '{new_name}' already exists on {remote}."),
            Some("Choose a different branch name."),
        ));
    }
    push_atomic_rename(
        path,
        remote,
        expected_oid,
        &format!("refs/heads/{name}"),
        &format!("refs/heads/{new_name}"),
        "rename the branch on the remote",
        cancellation,
    )?;
    let followed = sync_tracking_refs(path, &tracking, &new_tracking, expected_oid)
        .and_then(|()| retarget_upstreams(path, remote, name, new_name));
    followed.map_err(|error| {
        AppError::new(
            "remoteBranchRenamePartiallyApplied",
            format!(
                "{remote}/{name} was renamed to {remote}/{new_name}, but local tracking could not be updated: {}",
                error.message
            ),
            Some("Fetch the remote and set the upstream of affected local branches again."),
        )
    })
}

fn refuse_same_name(name: &str, new_name: &str) -> Result<(), AppError> {
    if name == new_name {
        return Err(AppError::new(
            "sameReferenceName",
            "Enter a different name.",
            None,
        ));
    }
    Ok(())
}

fn push_atomic_rename(
    path: &Path,
    remote: &str,
    object: &str,
    reference: &str,
    new_reference: &str,
    operation: &str,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    // Leases make Git refuse the push when the old name moved or the new name
    // appeared on the remote; --atomic keeps both updates together.
    let old_lease = format!("--force-with-lease={reference}:{object}");
    let new_lease = format!("--force-with-lease={new_reference}:");
    let create = format!("{object}:{new_reference}");
    let delete = format!(":{reference}");
    run_mutation_with_cancellation(
        path,
        &[
            "push",
            "--atomic",
            "--no-follow-tags",
            "--no-mirror",
            "--recurse-submodules=no",
            &old_lease,
            &new_lease,
            "--",
            remote,
            &create,
            &delete,
        ],
        operation,
        Some(cancellation),
    )
}

fn sync_tracking_refs(
    path: &Path,
    tracking: &str,
    new_tracking: &str,
    oid: &str,
) -> Result<(), AppError> {
    let mut transaction = String::new();
    if reference_tip(path, new_tracking).is_none() {
        transaction.push_str(&format!("create {new_tracking} {oid}\n"));
    }
    if reference_tip(path, tracking).is_some() {
        transaction.push_str(&format!("delete {tracking}\n"));
    }
    if transaction.is_empty() {
        return Ok(());
    }
    run_git_with_input(
        path,
        &["update-ref", "--stdin"],
        transaction.as_bytes(),
        "update the remote-tracking branch",
    )
}

fn retarget_upstreams(
    path: &Path,
    remote: &str,
    name: &str,
    new_name: &str,
) -> Result<(), AppError> {
    let output = run_git(
        path,
        &[
            "for-each-ref",
            "--format=%(refname)%00%(upstream:remotename)%00%(upstream:remoteref)",
            "refs/heads",
        ],
    )?;
    ensure_success("read local branch upstreams", &output)?;
    let old_merge = format!("refs/heads/{name}");
    let new_merge = format!("refs/heads/{new_name}");
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let mut fields = line.split('\0');
        let (Some(branch), Some(upstream_remote), Some(merge)) =
            (fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        let Some(branch) = branch.strip_prefix("refs/heads/") else {
            continue;
        };
        if upstream_remote == remote && merge == old_merge {
            run_mutation(
                path,
                &["config", &format!("branch.{branch}.merge"), &new_merge],
                "update the branch upstream",
            )?;
        }
    }
    Ok(())
}
