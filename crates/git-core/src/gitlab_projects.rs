//! Independent normalization of the public GitLab v4 account/projects contract.
//! Uses a read-only transport port; returned metadata grants no Git/file-write authority.
use super::{AppError, CancellationToken};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

const PAGE_SIZE: usize = 20;
const MAX_PAGE: u32 = 1000;

/// A validated HTTPS instance root, without credentials or an API resource path.
/// Subfolder installations require an explicit future instance-base model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitLabInstance(String);

impl GitLabInstance {
    pub fn parse(value: &str) -> Result<Self, AppError> {
        if value.len() > 2048
            || value.trim() != value
            || value.contains('\\')
            || value.chars().any(char::is_control)
        {
            return Err(request_error("Use a GitLab HTTPS instance root."));
        }
        let parsed = url::Url::parse(value)
            .map_err(|_| request_error("Use a GitLab HTTPS instance root."))?;
        if parsed.scheme() != "https"
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || parsed.path() != "/"
        {
            return Err(request_error(
                "Use an HTTPS instance root without credentials, query, fragment or subfolder.",
            ));
        }
        Ok(Self(parsed.origin().ascii_serialization()))
    }

    pub fn origin(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitLabAccount {
    pub origin: String,
    pub id: String,
    pub login: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum GitLabProjectScope {
    #[default]
    Membership,
    Accessible,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct GitLabProjectQuery {
    pub page: u32,
    pub expected_account: Option<GitLabAccount>,
    pub scope: GitLabProjectScope,
    pub search: String,
    pub include_archived: bool,
}

impl Default for GitLabProjectQuery {
    fn default() -> Self {
        Self {
            page: 1,
            expected_account: None,
            scope: Default::default(),
            search: String::new(),
            include_archived: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitLabProject {
    pub id: String,
    pub name: String,
    pub full_path: String,
    pub url: String,
    pub description: Option<String>,
    pub default_branch: Option<String>,
    pub visibility: String,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitLabProjectPage {
    pub account: GitLabAccount,
    pub query: GitLabProjectQuery,
    pub entries: Vec<GitLabProject>,
    /// A full preview page permits another explicit read; it does not prove one exists.
    pub may_have_more: bool,
    pub next_page: Option<u32>,
    pub warnings: Vec<String>,
}

/// A read-only port, not an authentication or credential-storage implementation.
/// Implementations must bind GETs to this exact instance, bound response bytes,
/// honor cancellation and redact credentials/upstream diagnostics from errors.
pub trait GitLabReadTransport {
    fn get(
        &mut self,
        instance: &GitLabInstance,
        endpoint: &str,
        cancellation: &CancellationToken,
    ) -> Result<Value, AppError>;
}

fn request_error(message: &str) -> AppError {
    AppError::new("gitlabDiscoveryRequest", message, None)
}

fn response_error() -> AppError {
    AppError::new(
        "gitlabDiscoveryResponse",
        "GitLab returned incomplete or inconsistent project metadata.",
        Some("Reload the selected account and project page."),
    )
}

fn check(cancellation: &CancellationToken) -> Result<(), AppError> {
    if cancellation.is_cancelled() {
        return Err(AppError::new(
            "operationCancelled",
            "Loading GitLab data was cancelled.",
            None,
        ));
    }
    Ok(())
}

fn text<'a>(value: &'a Value, key: &str, limit: usize) -> Result<&'a str, AppError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= limit)
        .filter(|value| !value.chars().any(char::is_control))
        .ok_or_else(response_error)
}

fn optional_text(value: &Value, key: &str, limit: usize) -> Result<Option<String>, AppError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) if value.len() <= limit && !value.contains('\0') => {
            Ok(Some(value.clone()))
        }
        _ => Err(response_error()),
    }
}

fn id(value: &Value) -> Result<String, AppError> {
    super::hosted_repositories::id(value).map_err(|_| response_error())
}

pub(super) fn validate_query(instance: &GitLabInstance, query: &GitLabProjectQuery) -> Result<(), AppError> {
    if query.page == 0 || query.page > MAX_PAGE {
        return Err(request_error("Choose a project page from 1 through 1000."));
    }
    if query.search.len() > 256 || query.search.chars().any(char::is_control) {
        return Err(request_error(
            "Use a single project search of at most 256 bytes.",
        ));
    }
    if query.page > 1 && query.expected_account.is_none() {
        return Err(request_error(
            "Reload the first page before requesting more projects.",
        ));
    }
    if let Some(account) = &query.expected_account {
        let canonical = GitLabInstance::parse(&account.origin)?;
        let valid_id = !account.id.is_empty()
            && account.id.len() <= 20
            && id(&Value::String(account.id.clone())).is_ok_and(|id| id == account.id);
        if canonical != *instance
            || account.origin != canonical.origin()
            || !valid_id
            || account.login.is_empty()
            || account.login.len() > 255
            || account.login.chars().any(char::is_control)
        {
            return Err(request_error(
                "Select a valid account for this GitLab instance.",
            ));
        }
    }
    Ok(())
}

pub fn load_gitlab_account_with(
    transport: &mut (impl GitLabReadTransport + ?Sized),
    instance: &GitLabInstance,
    cancellation: &CancellationToken,
) -> Result<GitLabAccount, AppError> {
    check(cancellation)?;
    let value = transport.get(instance, "user", cancellation)?;
    check(cancellation)?;
    Ok(GitLabAccount {
        origin: instance.origin().into(),
        id: id(&value["id"])?,
        login: text(&value, "username", 255)?.into(),
    })
}

pub(super) fn project(instance: &GitLabInstance, value: &Value) -> Result<GitLabProject, AppError> {
    let full_path = text(value, "path_with_namespace", 4096)?;
    if !full_path.contains('/')
        || full_path
            .split('/')
            .any(|part| part.is_empty() || matches!(part, "." | "..") || part.contains('\\'))
    {
        return Err(response_error());
    }
    let raw_url = text(value, "web_url", 16384)?;
    if raw_url.trim() != raw_url || raw_url.contains('\\') {
        return Err(response_error());
    }
    let parsed = url::Url::parse(raw_url).map_err(|_| response_error())?;
    let mut expected = url::Url::parse(instance.origin()).map_err(|_| response_error())?;
    {
        let mut segments = expected.path_segments_mut().map_err(|_| response_error())?;
        segments.clear();
        for part in full_path.split('/') {
            segments.push(part);
        }
    }
    if parsed != expected {
        return Err(response_error());
    }
    let default_branch = optional_text(value, "default_branch", 4096)?;
    if default_branch
        .as_ref()
        .is_some_and(|branch| branch.is_empty() || branch.chars().any(char::is_control))
    {
        return Err(response_error());
    }
    Ok(GitLabProject {
        id: id(&value["id"])?,
        name: text(value, "name", 1024)?.into(),
        full_path: full_path.into(),
        url: parsed.to_string(),
        description: optional_text(value, "description", 16384)?,
        default_branch,
        visibility: text(value, "visibility", 32)?.into(),
        archived: value
            .get("archived")
            .and_then(Value::as_bool)
            .ok_or_else(response_error)?,
    })
}

pub fn load_gitlab_project_page_with(
    transport: &mut (impl GitLabReadTransport + ?Sized),
    instance: &GitLabInstance,
    query: GitLabProjectQuery,
    cancellation: &CancellationToken,
) -> Result<GitLabProjectPage, AppError> {
    validate_query(instance, &query)?;
    check(cancellation)?;
    let account = load_gitlab_account_with(transport, instance, cancellation)?;
    if query
        .expected_account
        .as_ref()
        .is_some_and(|expected| expected != &account)
    {
        return Err(request_error(
            "The GitLab account changed. Reconnect the account before loading projects.",
        ));
    }
    let mut parameters = url::form_urlencoded::Serializer::new(String::new());
    parameters
        .append_pair("per_page", &PAGE_SIZE.to_string())
        .append_pair("page", &query.page.to_string())
        .append_pair("order_by", "id")
        .append_pair("sort", "asc");
    if query.scope == GitLabProjectScope::Membership {
        parameters.append_pair("membership", "true");
    }
    if !query.include_archived {
        parameters.append_pair("archived", "false");
    }
    if !query.search.is_empty() {
        parameters.append_pair("search", &query.search);
    }
    let endpoint = format!("projects?{}", parameters.finish());
    let value = transport.get(instance, &endpoint, cancellation)?;
    check(cancellation)?;
    let records = value.as_array().ok_or_else(response_error)?;
    if records.len() > PAGE_SIZE {
        return Err(response_error());
    }
    let entries = records
        .iter()
        .map(|value| project(instance, value))
        .collect::<Result<Vec<_>, _>>()?;
    let mut ids = HashSet::new();
    if entries.iter().any(|entry| !ids.insert(&entry.id)) {
        return Err(response_error());
    }
    if load_gitlab_account_with(transport, instance, cancellation)? != account {
        return Err(request_error(
            "The GitLab account changed while loading projects. Reconnect the account before loading projects.",
        ));
    }
    let may_have_more = entries.len() == PAGE_SIZE;
    let next_page = (may_have_more && query.page < MAX_PAGE).then_some(query.page + 1);
    let warnings = if may_have_more && next_page.is_none() {
        vec!["The catalogue preview reached its page limit. Refine the search to inspect more projects.".into()]
    } else {
        Vec::new()
    };
    Ok(GitLabProjectPage {
        account,
        query,
        entries,
        may_have_more,
        next_page,
        warnings,
    })
}

#[cfg(test)]
#[path = "gitlab_projects_tests.rs"]
mod tests;
