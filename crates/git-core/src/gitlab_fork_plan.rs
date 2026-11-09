//! Native-retained fork reviews. A plan is data, not permission to submit.
//! The native one-use registry and explicit write connection own that authority.
use crate::{
    AppError, CancellationToken, GitLabAccount, GitLabForkDispatch, GitLabForkIntent,
    GitLabInstance, GitLabNamespace, GitLabNamespaceSelection, GitLabProject, GitLabReadTransport,
    inspect_gitlab_namespace_with, load_gitlab_account_with,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitLabForkPrepareRequest {
    pub source_id: String,
    pub source_full_path: String,
    pub namespace: GitLabNamespaceSelection,
    pub project_path: String,
    pub project_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitLabForkPreview {
    pub account: GitLabAccount,
    pub source: GitLabProject,
    pub source_empty: Option<bool>,
    pub namespace: GitLabNamespace,
    pub project_path: String,
    pub project_name: Option<String>,
    pub target_full_path: String,
}

/// No Deserialize, credential, endpoint, operation token or public constructor.
/// Native execution must use its retained instance, not renderer preview fields.
pub struct GitLabForkPlan {
    intent: GitLabForkIntent,
    preview: GitLabForkPreview,
}
impl GitLabForkPlan {
    pub fn preview(&self) -> &GitLabForkPreview {
        &self.preview
    }
    pub fn intent(&self) -> &GitLabForkIntent {
        &self.intent
    }
}
fn refused(message: &str) -> AppError {
    AppError::new(
        "gitlabForkPlanChanged",
        message,
        Some("Inspect the selected account, source and destination in a fresh fork review."),
    )
}
fn check(cancellation: &CancellationToken) -> Result<(), AppError> {
    if cancellation.is_cancelled() {
        return Err(crate::operation_cancelled());
    }
    Ok(())
}
fn account(
    transport: &mut (impl GitLabReadTransport + ?Sized),
    instance: &GitLabInstance,
    expected: &GitLabAccount,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    check(cancellation)?;
    if load_gitlab_account_with(transport, instance, cancellation)? != *expected {
        return Err(refused("The account changed during the fork review."));
    }
    check(cancellation)
}
fn source(
    transport: &mut (impl GitLabReadTransport + ?Sized),
    instance: &GitLabInstance,
    intent: &GitLabForkIntent,
    cancellation: &CancellationToken,
) -> Result<(GitLabProject, Option<bool>), AppError> {
    check(cancellation)?;
    let value = transport.get(
        instance,
        &format!("projects/{}", intent.source_id),
        cancellation,
    )?;
    check(cancellation)?;
    let project = crate::gitlab_projects::project(instance, &value)?;
    if project.id != intent.source_id || project.full_path != intent.source_full_path {
        return Err(refused("The source project changed its identity or path."));
    }
    let empty = match value.get("empty_repo") {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::Bool(empty)) => Some(*empty),
        _ => return Err(refused("The source repository state was not confirmed.")),
    };
    Ok((project, empty))
}
fn selection(intent: &GitLabForkIntent) -> GitLabNamespaceSelection {
    GitLabNamespaceSelection {
        id: intent.namespace_id.clone(),
        full_path: intent.namespace_full_path.clone(),
        kind: intent.namespace_kind,
    }
}
pub fn prepare_gitlab_fork_with(
    transport: &mut (impl GitLabReadTransport + ?Sized),
    instance: &GitLabInstance,
    expected: &GitLabAccount,
    request: GitLabForkPrepareRequest,
    cancellation: &CancellationToken,
) -> Result<GitLabForkPlan, AppError> {
    let mut intent = GitLabForkIntent {
        origin: instance.origin().into(),
        account_id: expected.id.clone(),
        account_login: expected.login.clone(),
        source_id: request.source_id,
        source_full_path: request.source_full_path,
        source_empty: None,
        namespace_id: request.namespace.id,
        namespace_full_path: request.namespace.full_path,
        namespace_kind: request.namespace.kind,
        project_path: request.project_path,
        project_name: request.project_name,
    };
    intent.validate()?;
    if expected.origin != intent.origin {
        return Err(refused(
            "The account does not belong to the selected instance.",
        ));
    }
    account(transport, instance, expected, cancellation)?;
    let (source, source_empty) = source(transport, instance, &intent, cancellation)?;
    let inspected = inspect_gitlab_namespace_with(
        transport,
        instance,
        expected,
        &selection(&intent),
        cancellation,
    )?;
    account(transport, instance, expected, cancellation)?;
    intent.source_empty = source_empty;
    let preview = GitLabForkPreview {
        account: expected.clone(),
        source,
        source_empty,
        namespace: inspected.namespace,
        project_path: intent.project_path.clone(),
        project_name: intent.project_name.clone(),
        target_full_path: intent.target_full_path(),
    };
    Ok(GitLabForkPlan { intent, preview })
}

/// Read-only preflight for an already consumed native review token. The caller
/// must retain the same live native session through the separate write callback.
pub fn revalidate_gitlab_fork_with(
    transport: &mut (impl GitLabReadTransport + ?Sized),
    instance: &GitLabInstance,
    expected: &GitLabAccount,
    plan: &GitLabForkPlan,
    cancellation: &CancellationToken,
) -> Result<GitLabForkDispatch, AppError> {
    plan.intent.validate()?;
    if instance.origin() != plan.intent.origin
        || expected != &plan.preview.account
        || expected.origin != instance.origin()
    {
        return Err(refused(
            "This fork review belongs to another account or instance.",
        ));
    }
    account(transport, instance, expected, cancellation)?;
    let (_, empty) = source(transport, instance, &plan.intent, cancellation)?;
    if empty != plan.intent.source_empty {
        return Err(refused("The source repository state changed since review."));
    }
    inspect_gitlab_namespace_with(
        transport,
        instance,
        expected,
        &selection(&plan.intent),
        cancellation,
    )?;
    account(transport, instance, expected, cancellation)?;
    GitLabForkDispatch::new(
        &plan.intent.source_id,
        &plan.intent.namespace_id,
        &plan.intent.project_path,
        plan.intent.project_name.as_deref(),
    )
}

#[cfg(test)]
#[path = "gitlab_fork_plan_tests.rs"]
mod tests;
