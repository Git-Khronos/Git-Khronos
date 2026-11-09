//! Independent public-API fork discovery and destination namespace projection.
//! These reads grant neither write permission nor local Git remote authority.
use super::{
    AppError, CancellationToken, GitLabAccount, GitLabInstance, GitLabProject, GitLabProjectQuery,
    GitLabReadTransport, gitlab_clone, gitlab_projects, load_gitlab_account_with,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
const PAGE_SIZE: usize = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum GitLabNamespaceKind {
    User,
    Group,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitLabNamespace {
    pub id: String,
    pub name: String,
    pub full_path: String,
    pub kind: GitLabNamespaceKind,
}
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitLabNamespaceSelection {
    pub id: String,
    pub full_path: String,
    pub kind: GitLabNamespaceKind,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitLabNamespaceInspection {
    pub account: GitLabAccount,
    /// Fresh identity only; neither namespace visibility nor ownership grants a write.
    pub namespace: GitLabNamespace,
}
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct GitLabNamespaceQuery {
    pub page: u32,
    pub search: String,
    pub owned_only: bool,
}
impl Default for GitLabNamespaceQuery {
    fn default() -> Self {
        Self {
            page: 1,
            search: String::new(),
            owned_only: false,
        }
    }
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitLabNamespacePage {
    pub account: GitLabAccount,
    pub entries: Vec<GitLabNamespace>,
    pub page: u32,
    pub next_page: Option<u32>,
}
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitLabForkQuery {
    pub source_project_id: String,
    pub source_full_path: String,
    pub page: u32,
    pub search: String,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitLabForkPage {
    pub account: GitLabAccount,
    pub source: GitLabProject,
    /// Candidates only. Fresh relationship inspection is required before reuse.
    pub entries: Vec<GitLabProject>,
    pub page: u32,
    pub next_page: Option<u32>,
}
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitLabForkSelection {
    pub source_project_id: String,
    pub source_full_path: String,
    pub fork_project_id: String,
    pub fork_full_path: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum GitLabForkImportState {
    None,
    Scheduled,
    Started,
    Finished,
    Failed,
    Unknown,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitLabForkInspection {
    pub account: GitLabAccount,
    pub source: GitLabProject,
    pub project: GitLabProject,
    pub namespace: GitLabNamespace,
    /// Import metadata is not proof of a reachable Git transport.
    pub import_state: GitLabForkImportState,
    pub clone_https: Option<String>,
    pub clone_ssh: Option<String>,
}
fn refused(message: &str) -> AppError {
    AppError::new(
        "gitlabForkReadRefused",
        message,
        Some("Reload the selected GitLab account, project and fork."),
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
fn path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 4096
        && value.trim() == value
        && !value.chars().any(char::is_control)
        && value
            .split('/')
            .all(|part| !part.is_empty() && !matches!(part, "." | "..") && !part.contains('\\'))
}
fn text<'a>(value: &'a Value, key: &str, limit: usize) -> Result<&'a str, AppError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && s.len() <= limit && !s.chars().any(char::is_control))
        .ok_or_else(|| refused("GitLab returned incomplete fork or namespace metadata."))
}
fn id(value: &Value) -> Result<String, AppError> {
    super::hosted_repositories::id(value)
        .map_err(|_| refused("GitLab returned an invalid resource ID."))
}
pub(crate) fn namespace(value: &Value) -> Result<GitLabNamespace, AppError> {
    let full_path = text(value, "full_path", 4096)?;
    let segment = text(value, "path", 4096)?;
    if !path(full_path) || full_path.rsplit('/').next() != Some(segment) {
        return Err(refused("GitLab returned inconsistent namespace paths."));
    }
    let kind = match text(value, "kind", 32)? {
        "user" if !full_path.contains('/') => GitLabNamespaceKind::User,
        "group" => GitLabNamespaceKind::Group,
        _ => return Err(refused("GitLab returned an unsupported namespace type.")),
    };
    Ok(GitLabNamespace {
        id: id(&value["id"])?,
        name: text(value, "name", 1024)?.into(),
        full_path: full_path.into(),
        kind,
    })
}
fn arguments(
    instance: &GitLabInstance,
    expected: &GitLabAccount,
    page: u32,
    search: &str,
) -> Result<(), AppError> {
    gitlab_projects::validate_query(
        instance,
        &GitLabProjectQuery {
            page,
            search: search.into(),
            expected_account: Some(expected.clone()),
            ..Default::default()
        },
    )
}
fn account(
    transport: &mut (impl GitLabReadTransport + ?Sized),
    instance: &GitLabInstance,
    expected: &GitLabAccount,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    if &load_gitlab_account_with(transport, instance, cancellation)? != expected {
        return Err(refused(
            "The selected GitLab account changed. Reconnect before continuing.",
        ));
    }
    check(cancellation)
}
fn get(
    transport: &mut (impl GitLabReadTransport + ?Sized),
    instance: &GitLabInstance,
    endpoint: &str,
    cancellation: &CancellationToken,
) -> Result<Value, AppError> {
    check(cancellation)?;
    let value = transport.get(instance, endpoint, cancellation)?;
    check(cancellation)?;
    Ok(value)
}
fn values(value: &Value) -> Result<&Vec<Value>, AppError> {
    value
        .as_array()
        .filter(|v| v.len() <= PAGE_SIZE)
        .ok_or_else(|| refused("GitLab returned an invalid or oversized resource page."))
}
fn next(page: u32, count: usize) -> Option<u32> {
    (page < 1000 && count == PAGE_SIZE).then_some(page + 1)
}
fn selected_project(
    transport: &mut (impl GitLabReadTransport + ?Sized),
    instance: &GitLabInstance,
    project_id: &str,
    full_path: &str,
    cancellation: &CancellationToken,
) -> Result<(GitLabProject, Value), AppError> {
    let raw = get(
        transport,
        instance,
        &format!("projects/{project_id}"),
        cancellation,
    )?;
    let project = gitlab_projects::project(instance, &raw)?;
    if project.id != project_id || project.full_path != full_path {
        return Err(refused(
            "The selected GitLab project changed its identity or path.",
        ));
    }
    Ok((project, raw))
}
pub fn load_gitlab_namespace_page_with(
    transport: &mut (impl GitLabReadTransport + ?Sized),
    instance: &GitLabInstance,
    expected: &GitLabAccount,
    query: GitLabNamespaceQuery,
    cancellation: &CancellationToken,
) -> Result<GitLabNamespacePage, AppError> {
    arguments(instance, expected, query.page, &query.search)?;
    account(transport, instance, expected, cancellation)?;
    let mut encoded = url::form_urlencoded::Serializer::new(String::new());
    encoded
        .append_pair("per_page", "20")
        .append_pair("page", &query.page.to_string());
    if query.owned_only {
        encoded.append_pair("owned_only", "true");
    }
    if !query.search.is_empty() {
        encoded.append_pair("search", &query.search);
    }
    let value = get(
        transport,
        instance,
        &format!("namespaces?{}", encoded.finish()),
        cancellation,
    )?;
    let entries = values(&value)?
        .iter()
        .map(namespace)
        .collect::<Result<Vec<_>, _>>()?;
    let mut ids = HashSet::new();
    let mut paths = HashSet::new();
    if entries
        .iter()
        .any(|item| !ids.insert(&item.id) || !paths.insert(&item.full_path))
    {
        return Err(refused("GitLab returned duplicate namespace identities."));
    }
    account(transport, instance, expected, cancellation)?;
    let next_page = next(query.page, entries.len());
    Ok(GitLabNamespacePage {
        account: expected.clone(),
        entries,
        page: query.page,
        next_page,
    })
}
pub fn inspect_gitlab_namespace_with(
    transport: &mut (impl GitLabReadTransport + ?Sized),
    instance: &GitLabInstance,
    expected: &GitLabAccount,
    selection: &GitLabNamespaceSelection,
    cancellation: &CancellationToken,
) -> Result<GitLabNamespaceInspection, AppError> {
    arguments(instance, expected, 1, "")?;
    if !canonical_id(&selection.id)
        || !path(&selection.full_path)
        || (selection.kind == GitLabNamespaceKind::User && selection.full_path.contains('/'))
    {
        return Err(refused("Select a valid namespace identity, path and type."));
    }
    account(transport, instance, expected, cancellation)?;
    let value = get(
        transport,
        instance,
        &format!("namespaces/{}", selection.id),
        cancellation,
    )?;
    let namespace = namespace(&value)?;
    if namespace.id != selection.id
        || namespace.full_path != selection.full_path
        || namespace.kind != selection.kind
    {
        return Err(refused(
            "The selected namespace changed its identity, path or type.",
        ));
    }
    account(transport, instance, expected, cancellation)?;
    Ok(GitLabNamespaceInspection {
        account: expected.clone(),
        namespace,
    })
}
pub fn load_gitlab_fork_page_with(
    transport: &mut (impl GitLabReadTransport + ?Sized),
    instance: &GitLabInstance,
    expected: &GitLabAccount,
    query: GitLabForkQuery,
    cancellation: &CancellationToken,
) -> Result<GitLabForkPage, AppError> {
    arguments(instance, expected, query.page, &query.search)?;
    if !canonical_id(&query.source_project_id)
        || !path(&query.source_full_path)
        || !query.source_full_path.contains('/')
    {
        return Err(refused(
            "Select a valid source project identity and full path.",
        ));
    }
    account(transport, instance, expected, cancellation)?;
    let (source, _) = selected_project(
        transport,
        instance,
        &query.source_project_id,
        &query.source_full_path,
        cancellation,
    )?;
    let mut encoded = url::form_urlencoded::Serializer::new(String::new());
    encoded
        .append_pair("per_page", "20")
        .append_pair("page", &query.page.to_string())
        .append_pair("order_by", "id")
        .append_pair("sort", "asc");
    if !query.search.is_empty() {
        encoded.append_pair("search", &query.search);
    }
    let value = get(
        transport,
        instance,
        &format!("projects/{}/forks?{}", source.id, encoded.finish()),
        cancellation,
    )?;
    let entries = values(&value)?
        .iter()
        .map(|value| gitlab_projects::project(instance, value))
        .collect::<Result<Vec<_>, _>>()?;
    let mut ids = HashSet::new();
    let mut paths = HashSet::new();
    if entries
        .iter()
        .any(|item| item.id == source.id || !ids.insert(&item.id) || !paths.insert(&item.full_path))
    {
        return Err(refused("GitLab returned inconsistent fork candidates."));
    }
    account(transport, instance, expected, cancellation)?;
    let next_page = next(query.page, entries.len());
    Ok(GitLabForkPage {
        account: expected.clone(),
        source,
        entries,
        page: query.page,
        next_page,
    })
}
pub fn inspect_gitlab_fork_with(
    transport: &mut (impl GitLabReadTransport + ?Sized),
    instance: &GitLabInstance,
    expected: &GitLabAccount,
    selection: &GitLabForkSelection,
    cancellation: &CancellationToken,
) -> Result<GitLabForkInspection, AppError> {
    arguments(instance, expected, 1, "")?;
    if !canonical_id(&selection.source_project_id)
        || !canonical_id(&selection.fork_project_id)
        || selection.source_project_id == selection.fork_project_id
        || !path(&selection.source_full_path)
        || !path(&selection.fork_full_path)
        || !selection.source_full_path.contains('/')
        || !selection.fork_full_path.contains('/')
    {
        return Err(refused("Select distinct valid source and fork identities."));
    }
    account(transport, instance, expected, cancellation)?;
    let (source, _) = selected_project(
        transport,
        instance,
        &selection.source_project_id,
        &selection.source_full_path,
        cancellation,
    )?;
    let (project, value) = selected_project(
        transport,
        instance,
        &selection.fork_project_id,
        &selection.fork_full_path,
        cancellation,
    )?;
    let parent = &value["forked_from_project"];
    if id(&parent["id"])? != source.id
        || text(parent, "path_with_namespace", 4096)? != source.full_path
    {
        return Err(refused(
            "GitLab did not confirm this fork's relationship to the selected source.",
        ));
    }
    let namespace = namespace(&value["namespace"])?;
    if project.full_path.rsplit_once('/').map(|(owner, _)| owner)
        != Some(namespace.full_path.as_str())
    {
        return Err(refused(
            "The fork project and namespace paths do not match.",
        ));
    }
    let import_state = match value.get("import_status").and_then(Value::as_str) {
        Some("none") => GitLabForkImportState::None,
        Some("scheduled") => GitLabForkImportState::Scheduled,
        Some("started") => GitLabForkImportState::Started,
        Some("finished") => GitLabForkImportState::Finished,
        Some("failed") => GitLabForkImportState::Failed,
        _ => GitLabForkImportState::Unknown,
    };
    let clone_https =
        gitlab_clone::clone_url(&value, "http_url_to_repo", &project.full_path, false)?;
    let clone_ssh = gitlab_clone::clone_url(&value, "ssh_url_to_repo", &project.full_path, true)?;
    account(transport, instance, expected, cancellation)?;
    Ok(GitLabForkInspection {
        account: expected.clone(),
        source,
        project,
        namespace,
        import_state,
        clone_https,
        clone_ssh,
    })
}

#[cfg(test)]
#[path = "gitlab_forks_tests.rs"]
mod tests;
