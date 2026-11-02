//! Read-only inspection of a saved fork intent. Stored data never restores POST
//! authority, and a project found at a path is not adopted without fresh identity.
use crate::{
    AppError, CancellationToken, GitLabAccount, GitLabForkFailure, GitLabForkImportState,
    GitLabForkRecord, GitLabInstance, GitLabReadTransport, load_gitlab_account_with,
};
use serde_json::Value;

const ACCOUNT_CHANGED: &str = "gitlabForkReconcileAccount";
fn refused() -> AppError {
    AppError::new(
        ACCOUNT_CHANGED,
        "Select a fresh connection to the saved GitLab instance and account before inspecting this outcome.",
        None,
    )
}
fn check(cancellation: &CancellationToken) -> Result<(), AppError> {
    if cancellation.is_cancelled() {
        return Err(crate::operation_cancelled());
    }
    Ok(())
}
fn account(
    reader: &mut (impl GitLabReadTransport + ?Sized),
    instance: &GitLabInstance,
    expected: &GitLabAccount,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    check(cancellation)?;
    if load_gitlab_account_with(reader, instance, cancellation)? != *expected {
        return Err(refused());
    }
    check(cancellation)
}
fn get(
    reader: &mut (impl GitLabReadTransport + ?Sized),
    instance: &GitLabInstance,
    endpoint: &str,
    cancellation: &CancellationToken,
) -> Result<Value, AppError> {
    check(cancellation)?;
    let value = reader.get(instance, endpoint, cancellation)?;
    check(cancellation)?;
    Ok(value)
}
fn failure(error: &AppError) -> GitLabForkFailure {
    match error.kind.as_str() {
        "operationCancelled" | "gitlabConnectionExpired" => GitLabForkFailure::Interrupted,
        "gitlabConnection" | "gitlabTimeout" => GitLabForkFailure::Connection,
        _ => GitLabForkFailure::InvalidReply,
    }
}

/// Returns one data-only successor suitable for the caller's existing journal
/// lease. A missing/inaccessible result never proves that submission was absent.
/// Matching metadata proves neither who created the project nor Git access.
pub fn reconcile_gitlab_fork_with(
    reader: &mut (impl GitLabReadTransport + ?Sized),
    instance: &GitLabInstance,
    expected: &GitLabAccount,
    record: &GitLabForkRecord,
    now_millis: &str,
    cancellation: &CancellationToken,
) -> Result<GitLabForkRecord, AppError> {
    let unconfirmed = record.inspection_unconfirmed(GitLabForkFailure::InvalidReply, now_millis)?;
    if instance.origin() != record.intent.origin
        || expected.origin != record.intent.origin
        || expected.id != record.intent.account_id
    {
        return Err(refused());
    }
    // Only a newly selected connection's current login is compared with the
    // provider. The saved display login cannot retarget its stable account ID.
    account(reader, instance, expected, cancellation)?;
    let observed: Result<_, AppError> = (|| {
        let source = get(
            reader,
            instance,
            &format!("projects/{}", record.intent.source_id),
            cancellation,
        )?;
        let namespace = get(
            reader,
            instance,
            &format!("namespaces/{}", record.intent.namespace_id),
            cancellation,
        )?;
        let endpoint = match &record.project_id {
            Some(id) => format!("projects/{id}"),
            None => crate::gitlab_project_locator::project_path_endpoint(
                &record.intent.target_full_path(),
            )?,
        };
        let project = get(reader, instance, &endpoint, cancellation)?;
        account(reader, instance, expected, cancellation)?;
        Ok((source, namespace, project))
    })();
    let (source, namespace, project) = match observed {
        Ok(value) => value,
        Err(error) if error.kind == ACCOUNT_CHANGED => return Err(error),
        Err(error) => return record.inspection_unconfirmed(failure(&error), now_millis),
    };
    // Parse all metadata independently of the provider's display descriptions.
    let parsed: Result<_, AppError> = (|| {
        Ok((
            crate::gitlab_projects::project(instance, &source)?,
            crate::gitlab_forks::namespace(&namespace)?,
            crate::gitlab_projects::project(instance, &project)?,
            crate::gitlab_forks::namespace(&project["namespace"])?,
        ))
    })();
    let (source, namespace, destination, embedded_namespace) = match parsed {
        Ok(value) => value,
        Err(_error) => return Ok(unconfirmed),
    };
    if source.id != record.intent.source_id
        || source.full_path != record.intent.source_full_path
        || namespace.id != record.intent.namespace_id
        || namespace.full_path != record.intent.namespace_full_path
        || namespace.kind != record.intent.namespace_kind
        || destination.id == source.id
        || destination.full_path != record.intent.target_full_path()
        || record
            .project_id
            .as_ref()
            .is_some_and(|id| id != &destination.id)
        || embedded_namespace.id != namespace.id
        || embedded_namespace.full_path != namespace.full_path
        || embedded_namespace.kind != namespace.kind
    {
        return record.conflict(now_millis);
    }
    let parent = &project["forked_from_project"];
    let parent_id = crate::hosted_repositories::id(&parent["id"]);
    let parent_path = parent.get("path_with_namespace").and_then(Value::as_str);
    let Ok(parent_id) = parent_id else {
        return Ok(unconfirmed);
    };
    if parent_id != source.id {
        // A private or indirect upstream needs a full ancestry inspection. It
        // must not be declared unrelated or adopted from list membership alone.
        return Ok(unconfirmed);
    }
    match parent_path {
        Some(path) if path == source.full_path => (),
        Some(_) => return record.conflict(now_millis),
        None => return Ok(unconfirmed),
    }
    let empty = match project.get("empty_repo") {
        None | Some(Value::Null) => None,
        Some(Value::Bool(empty)) => Some(*empty),
        _ => return Ok(unconfirmed),
    };
    let state = match project.get("import_status").and_then(Value::as_str) {
        Some("none") => GitLabForkImportState::None,
        Some("scheduled") => GitLabForkImportState::Scheduled,
        Some("started") => GitLabForkImportState::Started,
        Some("finished") => GitLabForkImportState::Finished,
        Some("failed") => GitLabForkImportState::Failed,
        _ => GitLabForkImportState::Unknown,
    };
    record.observe_verified(&destination.id, state, empty, now_millis)
}

#[cfg(test)]
#[path = "gitlab_fork_reconcile_tests.rs"]
mod tests;
