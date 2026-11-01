//! Reviewed GitLab cloning from public project metadata and the ordinary Git CLI.
//! API credentials belong to the read port; they are never passed to Git.
use super::{
    AppError, CancellationToken, GitLabAccount, GitLabInstance, GitLabProject, GitLabProjectQuery,
    GitLabReadTransport, HostedCloneTransport, clone_repository_with_submodules, git_cancellation,
    gitlab_projects, load_gitlab_account_with,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitLabProjectInspection {
    pub account: GitLabAccount,
    pub project: GitLabProject,
    pub clone_https: Option<String>,
    pub clone_ssh: Option<String>,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitLabCloneRequest {
    pub project_id: String,
    pub full_path: String,
    pub transport: HostedCloneTransport,
    pub parent_path: String,
    pub folder: String,
    pub branch: Option<String>,
    pub depth: Option<u32>,
    pub recurse_submodules: bool,
}

/// Returned for review, then retained by the native preview registry.
/// Execution must not deserialize a replacement plan from the renderer.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitLabClonePlan {
    pub account: GitLabAccount,
    pub project: GitLabProject,
    pub transport: HostedCloneTransport,
    pub url: String,
    pub parent_path: String,
    pub folder: String,
    pub destination: String,
    pub branch: Option<String>,
    pub depth: Option<u32>,
    pub recurse_submodules: bool,
}

fn refused(message: &str) -> AppError {
    AppError::new(
        "gitlabCloneRefused",
        message,
        Some("Review a fresh GitLab clone preview."),
    )
}

fn check(cancellation: &CancellationToken) -> Result<(), AppError> {
    if cancellation.is_cancelled() {
        return Err(super::operation_cancelled());
    }
    Ok(())
}

fn canonical_id(value: &str) -> bool {
    value
        .parse::<u64>()
        .is_ok_and(|id| id > 0 && id.to_string() == value)
}

fn clone_url(
    value: &Value,
    key: &str,
    full_path: &str,
    ssh: bool,
) -> Result<Option<String>, AppError> {
    let raw = match value.get(key) {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::String(value)) if value.is_empty() => return Ok(None),
        Some(Value::String(value)) => value.as_str(),
        _ => return Err(refused("GitLab returned an invalid clone transport.")),
    };
    if raw.len() > 16384
        || raw.trim() != raw
        || raw.contains('\\')
        || raw.chars().any(char::is_control)
    {
        return Err(refused("GitLab returned an invalid clone transport."));
    }
    // SCP-style SSH is a remote operand only with an explicit safe user/host.
    // Convert solely for validation; retain the provider's reviewed Git operand.
    let parsed = if ssh && !raw.contains("://") {
        let (authority, path) = if let Some(end) = raw.find("]:") {
            (&raw[..end + 1], &raw[end + 2..])
        } else {
            raw.split_once(':')
                .ok_or_else(|| refused("Invalid SSH clone address."))?
        };
        if !authority.contains('@') || path != format!("{full_path}.git") {
            return Err(refused(
                "The SSH clone path does not match the selected project.",
            ));
        }
        url::Url::parse(&format!("ssh://{authority}/{path}"))
    } else {
        url::Url::parse(raw)
    }
    .map_err(|_| refused("GitLab returned an invalid clone address."))?;
    let valid_user = if ssh {
        !parsed.username().is_empty()
            && parsed
                .username()
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
            && !parsed.username().starts_with('-')
    } else {
        parsed.username().is_empty()
    };
    let supported_scheme = if ssh {
        parsed.scheme() == "ssh"
    } else {
        matches!(parsed.scheme(), "https" | "http")
    };
    if !supported_scheme
        || parsed.host_str().is_none()
        || !valid_user
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(refused("Use a credential-free HTTPS or SSH clone address."));
    }
    let mut expected = parsed.clone();
    {
        let mut segments = expected
            .path_segments_mut()
            .map_err(|_| refused("Invalid clone path."))?;
        segments.clear();
        let path = format!("{full_path}.git");
        for part in path.split('/') {
            segments.push(part);
        }
    }
    if parsed != expected {
        return Err(refused(
            "The clone path does not match the selected project.",
        ));
    }
    // An instance may advertise HTTP alongside valid SSH. Do not export an
    // unencrypted transport, or make it prevent review of the available SSH URL.
    if !ssh && parsed.scheme() == "http" {
        return Ok(None);
    }
    // Different Git/API hosts and ports are legitimate in self-hosted instances.
    // They must be displayed in the review, never silently replaced or inferred.
    Ok(Some(raw.into()))
}

pub fn inspect_gitlab_project_with(
    transport: &mut (impl GitLabReadTransport + ?Sized),
    instance: &GitLabInstance,
    expected_account: &GitLabAccount,
    project_id: &str,
    cancellation: &CancellationToken,
) -> Result<GitLabProjectInspection, AppError> {
    if !canonical_id(project_id) {
        return Err(refused("Select a valid GitLab project ID."));
    }
    gitlab_projects::validate_query(
        instance,
        &GitLabProjectQuery {
            expected_account: Some(expected_account.clone()),
            ..Default::default()
        },
    )?;
    check(cancellation)?;
    let account = load_gitlab_account_with(transport, instance, cancellation)?;
    if &account != expected_account {
        return Err(refused(
            "The selected GitLab account changed. Reconnect it.",
        ));
    }
    check(cancellation)?;
    let value = transport.get(instance, &format!("projects/{project_id}"), cancellation)?;
    check(cancellation)?;
    let project = gitlab_projects::project(instance, &value)?;
    if project.id != project_id {
        return Err(refused("GitLab returned a different project."));
    }
    let clone_https = clone_url(&value, "http_url_to_repo", &project.full_path, false)?;
    let clone_ssh = clone_url(&value, "ssh_url_to_repo", &project.full_path, true)?;
    if load_gitlab_account_with(transport, instance, cancellation)? != account {
        return Err(refused(
            "The GitLab account changed while inspecting this project.",
        ));
    }
    check(cancellation)?;
    Ok(GitLabProjectInspection {
        account,
        project,
        clone_https,
        clone_ssh,
    })
}

fn selected_url(
    inspection: &GitLabProjectInspection,
    transport: HostedCloneTransport,
) -> Result<String, AppError> {
    match transport {
        HostedCloneTransport::Https => &inspection.clone_https,
        HostedCloneTransport::Ssh => &inspection.clone_ssh,
    }
    .clone()
    .ok_or_else(|| refused("GitLab did not supply the selected clone transport."))
}

pub fn prepare_gitlab_clone_with(
    transport: &mut (impl GitLabReadTransport + ?Sized),
    instance: &GitLabInstance,
    account: &GitLabAccount,
    request: GitLabCloneRequest,
    cancellation: &CancellationToken,
) -> Result<GitLabClonePlan, AppError> {
    check(cancellation)?;
    let (parent_path, destination) = super::hosted_clone::destination(
        &request.parent_path,
        &request.folder,
        request.branch.as_deref(),
        request.depth,
    )?;
    let inspection = inspect_gitlab_project_with(
        transport,
        instance,
        account,
        &request.project_id,
        cancellation,
    )?;
    if inspection.project.full_path != request.full_path {
        return Err(refused(
            "The selected project's namespace changed. Reload projects.",
        ));
    }
    Ok(GitLabClonePlan {
        url: selected_url(&inspection, request.transport)?,
        account: inspection.account,
        project: inspection.project,
        transport: request.transport,
        parent_path,
        folder: request.folder,
        destination,
        branch: request.branch,
        depth: request.depth,
        recurse_submodules: request.recurse_submodules,
    })
}

pub fn revalidate_gitlab_clone_with(
    transport: &mut (impl GitLabReadTransport + ?Sized),
    plan: &GitLabClonePlan,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    check(cancellation)?;
    let (parent, target) = super::hosted_clone::destination(
        &plan.parent_path,
        &plan.folder,
        plan.branch.as_deref(),
        plan.depth,
    )?;
    if parent != plan.parent_path || target != plan.destination {
        return Err(refused("The clone destination changed."));
    }
    let instance = GitLabInstance::parse(&plan.account.origin)?;
    let inspected = inspect_gitlab_project_with(
        transport,
        &instance,
        &plan.account,
        &plan.project.id,
        cancellation,
    )?;
    if inspected.project.full_path != plan.project.full_path
        || inspected.project.url != plan.project.url
        || selected_url(&inspected, plan.transport)? != plan.url
    {
        return Err(refused("The selected project or clone transport changed."));
    }
    Ok(())
}

pub fn execute_gitlab_clone_with(
    transport: &mut (impl GitLabReadTransport + ?Sized),
    plan: &GitLabClonePlan,
    cancellation: &CancellationToken,
) -> Result<PathBuf, AppError> {
    revalidate_gitlab_clone_with(transport, plan, cancellation)?;
    check(cancellation)?;
    clone_gitlab_plan(plan, cancellation)
}

/// Git-only handoff after native-held preview consumption and fresh API review.
/// The desktop must release the API read lease before invoking this function.
/// This is not an IPC command and must not accept a renderer-supplied plan.
pub fn clone_gitlab_plan(
    plan: &GitLabClonePlan,
    cancellation: &CancellationToken,
) -> Result<PathBuf, AppError> {
    check(cancellation)?;
    let (parent, target) = super::hosted_clone::destination(
        &plan.parent_path,
        &plan.folder,
        plan.branch.as_deref(),
        plan.depth,
    )?;
    if parent != plan.parent_path || target != plan.destination {
        return Err(refused("The clone destination changed."));
    }
    git_cancellation::with(Some(cancellation), || {
        clone_repository_with_submodules(
            &plan.url,
            Path::new(&plan.parent_path),
            &plan.folder,
            plan.branch.as_deref(),
            plan.depth,
            plan.recurse_submodules,
        )
    })
}

#[cfg(test)]
#[path = "gitlab_clone_tests.rs"]
mod tests;
