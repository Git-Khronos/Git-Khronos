use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn preserve_reference(path: &Path, oid: &str, label: &str) -> Result<String, AppError> {
    validate_commit_oid(oid)?;
    let sequence = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| AppError::new("invalidSystemClock", "The system clock is invalid.", None))?
        .as_nanos();
    let reference = format!(
        "refs/git-chronos/recovery/{sequence}-{}",
        std::process::id()
    );
    run_mutation(
        path,
        &[
            "update-ref",
            "--create-reflog",
            "-m",
            label,
            &reference,
            oid,
            "",
        ],
        "preserve the reference before changing it",
    )?;
    Ok(reference)
}

pub fn delete_local_tag(path: &Path, name: &str, expected_target: &str) -> Result<(), AppError> {
    validate_tag_name(path, name)?;
    validate_commit_oid(expected_target)?;
    let reference = format!("refs/tags/{name}");
    let object = run_git(path, &["rev-parse", "--verify", &reference])?;
    ensure_success("read the tag object", &object)?;
    let oid = String::from_utf8_lossy(&object.stdout).trim().to_owned();
    let resolved = run_git(
        path,
        &["rev-parse", "--verify", &format!("{oid}^{{commit}}")],
    )?;
    ensure_success("verify the tag target", &resolved)?;
    if String::from_utf8_lossy(&resolved.stdout).trim() != expected_target {
        return Err(AppError::new(
            "staleReference",
            "That tag moved since it was selected.",
            Some("Refresh and review its new target before deleting."),
        ));
    }
    preserve_reference(path, &oid, &format!("Delete tag {name}"))?;
    run_mutation(
        path,
        &["update-ref", "-d", &reference, &oid],
        "delete the local tag",
    )
}

pub fn create_signed_tag(
    path: &Path,
    name: &str,
    oid: &str,
    message: &str,
) -> Result<(), AppError> {
    validate_tag_name(path, name)?;
    validate_commit_oid(oid)?;
    if message.trim().is_empty()
        || message.len() > MAX_COMMIT_MESSAGE_BYTES
        || message.contains('\0')
    {
        return Err(AppError::new(
            "invalidTagMessage",
            "Enter a non-empty tag message no larger than 1 MB.",
            None,
        ));
    }
    run_mutation(
        path,
        &["tag", "--sign", "--message", message, name, oid],
        "create the signed annotated tag",
    )?;
    // Some Git versions report success after SSH signing fails and keep an unsigned tag.
    let reference = format!("refs/tags/{name}");
    let inspected = run_git(
        path,
        &["for-each-ref", "--format=%(objectname)%00%(contents:signature)", "--", &reference],
    )?;
    ensure_success("confirm the tag signature", &inspected)?;
    let text = String::from_utf8_lossy(&inspected.stdout);
    let (tag_oid, signature) = text.split_once('\0').unwrap_or((text.trim(), ""));
    if !signature.trim().is_empty() {
        return Ok(());
    }
    let tag_oid = tag_oid.trim();
    let removed = !tag_oid.is_empty()
        && run_mutation(path, &["update-ref", "-d", &reference, tag_oid], "remove the unsigned tag").is_ok();
    Err(AppError::new(
        "tagSigningFailed",
        "Git created the tag without a signature, so it was not kept.",
        Some(if removed {
            "Check the configured signing key and program, then retry. No unsigned tag remains."
        } else {
            "Check the configured signing key and program. Inspect and delete the unsigned tag before retrying."
        }),
    ))
}

pub fn verify_tag(path: &Path, name: &str) -> Result<(), AppError> {
    validate_tag_name(path, name)?;
    run_mutation(path, &["tag", "--verify", name], "verify the tag signature")
}

pub fn transport_reference(
    path: &Path,
    remote: &str,
    name: &str,
    kind: &str,
    delete: bool,
    expected_oid: Option<&str>,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    validate_remote_name(path, remote)?;
    require_remote(path, remote)?;
    single_push_destination(path, remote)?;
    let reference = match kind {
        "tag" => {
            validate_tag_name(path, name)?;
            format!("refs/tags/{name}")
        }
        "branch" if delete => {
            validate_branch_name(path, name)?;
            format!("refs/heads/{name}")
        }
        _ => {
            return Err(AppError::new(
                "invalidReferenceAction",
                "Choose a tag or a remote branch to delete.",
                None,
            ));
        }
    };
    let refspec = if delete {
        format!(":{reference}")
    } else {
        let expected = expected_oid.ok_or_else(|| {
            AppError::new(
                "missingReferenceLease",
                "Pushing a tag requires its selected target.",
                Some("Refresh and select the tag again."),
            )
        })?;
        validate_commit_oid(expected)?;
        let object = run_git(path, &["rev-parse", "--verify", &reference])?;
        ensure_success("read the selected local tag", &object)?;
        let object = String::from_utf8_lossy(&object.stdout).trim().to_owned();
        let target = run_git(
            path,
            &["rev-parse", "--verify", &format!("{object}^{{commit}}")],
        )?;
        ensure_success("check the selected tag target", &target)?;
        if String::from_utf8_lossy(&target.stdout).trim() != expected {
            return Err(AppError::new(
                "staleReference",
                "The local tag moved after it was selected.",
                Some("Refresh and review the new target before pushing."),
            ));
        }
        format!("{object}:{reference}")
    };
    let lease = if delete {
        let oid = expected_oid.ok_or_else(|| {
            AppError::new(
                "missingReferenceLease",
                "Deletion requires the expected remote object ID.",
                Some("Refresh the remote and select the reference again."),
            )
        })?;
        validate_commit_oid(oid)?;
        Some(format!("--force-with-lease={reference}:{oid}"))
    } else {
        None
    };
    let mut args = vec![
        "push",
        "--no-follow-tags",
        "--no-mirror",
        "--recurse-submodules=no",
    ];
    if let Some(lease) = &lease {
        args.push(lease);
    }
    args.extend(["--", remote, &refspec]);
    run_mutation_with_cancellation(
        path,
        &args,
        "update the selected remote reference",
        Some(cancellation),
    )
}

pub fn remote_tag_object(
    path: &Path,
    remote: &str,
    name: &str,
    cancellation: &CancellationToken,
) -> Result<String, AppError> {
    validate_remote_name(path, remote)?;
    require_remote(path, remote)?;
    validate_tag_name(path, name)?;
    let destination = single_push_destination(path, remote)?;
    let reference = format!("refs/tags/{name}");
    let output = run_git_with_cancellation(
        path,
        &["ls-remote", "--refs", "--", &destination, &reference],
        Some(cancellation),
    )?;
    ensure_success("read the selected remote tag", &output)?;
    let oid = String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| {
            line.split_once('\t')
                .filter(|(_, target)| *target == reference)
                .map(|(oid, _)| oid.to_owned())
        })
        .ok_or_else(|| {
            AppError::new(
                "remoteTagNotFound",
                "That tag does not exist on the selected remote.",
                None,
            )
        })?;
    validate_commit_oid(&oid)?;
    Ok(oid)
}

fn single_push_destination(path: &Path, remote: &str) -> Result<String, AppError> {
    let output = run_git(path, &["remote", "get-url", "--push", "--all", remote])?;
    ensure_success("read the push destination", &output)?;
    let text = String::from_utf8_lossy(&output.stdout);
    let destinations = text
        .lines()
        .filter(|url| !url.is_empty())
        .collect::<Vec<_>>();
    if destinations.len() != 1 {
        return Err(AppError::new(
            "ambiguousPushDestination",
            "Reference management requires one push URL for the selected remote.",
            Some("Review this remote's push URLs before changing its references."),
        ));
    }
    Ok(destinations[0].to_owned())
}

pub fn set_remote_push_url(path: &Path, name: &str, url: Option<&str>) -> Result<(), AppError> {
    validate_remote_name(path, name)?;
    require_remote(path, name)?;
    let key = format!("remote.{name}.pushurl");
    if let Some(url) = url {
        validate_remote_url(url)?;
        run_mutation(
            path,
            &["config", "--local", "--replace-all", &key, url],
            "set the remote push URL",
        )
    } else {
        let output = run_git(path, &["config", "--local", "--unset-all", &key])?;
        if output.status.success() || output.status.code() == Some(5) {
            Ok(())
        } else {
            Err(AppError::git_failure("clear the remote push URL", &output))
        }
    }
}
pub fn configure_remote_urls(
    path: &Path,
    name: &str,
    fetch_url: &str,
    push_url: Option<&str>,
    change_push: bool,
    add: bool,
) -> Result<(), AppError> {
    validate_remote_name(path, name)?;
    validate_remote_url(fetch_url)?;
    if let Some(url) = push_url {
        validate_remote_url(url)?;
    }
    if add {
        add_remote(path, name, fetch_url)?;
    } else {
        set_remote_url(path, name, fetch_url)?;
    }
    if change_push {
        set_remote_push_url(path, name, push_url).map_err(|error| AppError::new(
            "pushUrlUpdateFailed", format!("Fetch URL was saved, but the push URL could not be updated. {}", error.message),
            Some("The remote now exists with the saved fetch URL. Review its current URLs before retrying.")))?;
    }
    Ok(())
}
