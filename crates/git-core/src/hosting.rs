//! Read-only GitHub data from the documented REST API through the user's gh CLI.
//! No credentials are returned to the renderer or written by this module.
use super::*;
use serde_json::Value;

const LIMIT: usize = 50;
const OUTPUT_LIMIT: usize = 2 * 1024 * 1024;
#[derive(Debug, Clone, Copy, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum HostingSection {
    PullRequests,
    Issues,
    Workflows,
}
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum HostingState {
    #[default]
    Open,
    Closed,
    All,
}
#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct HostingQuery {
    pub page: u32,
    pub state: HostingState,
}
impl Default for HostingQuery {
    fn default() -> Self {
        Self {
            page: 1,
            state: HostingState::Open,
        }
    }
}
#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct HostedReviewQuery {
    pub files_page: u32,
    pub reviews_page: u32,
    pub checks_page: u32,
    pub statuses_page: u32,
}
impl Default for HostedReviewQuery {
    fn default() -> Self {
        Self {
            files_page: 1,
            reviews_page: 1,
            checks_page: 1,
            statuses_page: 1,
        }
    }
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostedReviewDecision {
    pub name: String,
    pub state: String,
    pub commit_oid: String,
    pub submitted_at: String,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostedReviewSections {
    pub files: bool,
    pub reviews: bool,
    pub checks: bool,
    pub statuses: bool,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostedEntry {
    pub number: String,
    pub title: String,
    pub state: String,
    pub author: String,
    pub url: String,
    pub branch: String,
    pub commit_oid: String,
    pub body: String,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostingPage {
    pub repository: String,
    pub entries: Vec<HostedEntry>,
    /// This API page was full; additional records may exist.
    pub may_have_more: bool,
    pub page: u32,
    pub next_page: Option<u32>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostedReviewFile {
    pub path: String,
    pub state: String,
    pub additions: u32,
    pub deletions: u32,
    pub patch: Option<String>,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostedReviewStatus {
    pub name: String,
    pub state: String,
    pub body: String,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostedReview {
    pub head_oid: String,
    pub base_branch: String,
    pub head_branch: String,
    pub files: Vec<HostedReviewFile>,
    pub reviews: Vec<HostedReviewStatus>,
    pub checks: Vec<HostedReviewStatus>,
    pub files_may_have_more: bool,
    pub reviews_may_have_more: bool,
    pub checks_may_have_more: bool,
    pub statuses_may_have_more: bool,
    pub legacy_state: Option<String>,
    pub legacy_statuses: Vec<HostedReviewStatus>,
    pub current_reviews: Vec<HostedReviewDecision>,
    pub query: HostedReviewQuery,
    pub sections: HostedReviewSections,
    pub warnings: Vec<String>,
}
pub(crate) fn repository_for_remote(path: &Path, remote: &str) -> Result<String, AppError> {
    let remotes = read_remotes(path)?;
    let selected = remotes
        .iter()
        .find(|candidate| candidate.name == remote)
        .ok_or_else(unsupported)?;
    github_repository(&selected.fetch_url).ok_or_else(unsupported)
}
fn records(value: &Value) -> Result<&Vec<Value>, AppError> {
    value.as_array().ok_or_else(|| {
        AppError::new(
            "hostingResponse",
            "GitHub returned an unexpected list response.",
            None,
        )
    })
}
fn valid_oid(oid: &str) -> bool {
    (oid.len() == 40 || oid.len() == 64) && oid.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub fn load_hosted_review(
    path: &Path,
    remote: &str,
    pull_number: u32,
    expected_head_oid: &str,
    query: &HostedReviewQuery,
    cancellation: &CancellationToken,
) -> Result<HostedReview, AppError> {
    if pull_number == 0
        || !valid_oid(expected_head_oid)
        || [
            query.files_page,
            query.reviews_page,
            query.checks_page,
            query.statuses_page,
        ]
        .contains(&0)
    {
        return Err(AppError::new(
            "hostingRequest",
            "Select a pull request with a valid commit ID.",
            None,
        ));
    }
    let repository = repository_for_remote(path, remote)?;
    let result = load_review_from(
        &repository,
        pull_number,
        expected_head_oid,
        query,
        |endpoint| request(endpoint, cancellation),
    )?;
    if repository_for_remote(path, remote)? != repository {
        return Err(AppError::new(
            "hostingStale",
            "The selected remote changed while loading. Refresh and reload.",
            None,
        ));
    }
    Ok(result)
}
fn review_section<T>(
    result: Result<T, AppError>,
    name: &str,
    warnings: &mut Vec<String>,
) -> Result<Option<T>, AppError> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind == "operationCancelled" => Err(error),
        Err(_) => {
            warnings.push(format!("{name} could not be loaded. Check provider permissions and rate limits, then reload."));
            Ok(None)
        }
    }
}

fn paged_records(value: Value, key: Option<&str>) -> Result<Vec<Value>, AppError> {
    let value = key
        .map_or(Some(&value), |key| value.get(key))
        .ok_or_else(|| {
            AppError::new("hostingResponse", "GitHub returned no list records.", None)
        })?;
    Ok(records(value)?.clone())
}

fn review_history(
    repository: &str,
    pull_number: u32,
    selected_page: u32,
    fetch: &mut impl FnMut(&str) -> Result<Value, AppError>,
) -> Result<(Vec<Value>, Vec<HostedReviewDecision>), AppError> {
    let mut current = std::collections::BTreeMap::new();
    let mut selected = Vec::new();
    let mut page = 1_u32;
    loop {
        let values = paged_records(
            fetch(&format!(
                "repos/{repository}/pulls/{pull_number}/reviews?per_page={LIMIT}&page={page}"
            ))?,
            None,
        )?;
        for review in &values {
            let name = review
                .get("user")
                .map(|user| text(user, "login"))
                .unwrap_or_default();
            let state = text(review, "state");
            // A comment-only review does not revoke an earlier decision. A
            // dismissed decision must remain distinguishable from approval.
            if !name.is_empty()
                && ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].contains(&state.as_str())
            {
                current.insert(
                    name.to_ascii_lowercase(),
                    HostedReviewDecision {
                        name,
                        state,
                        commit_oid: text(review, "commit_id"),
                        submitted_at: text(review, "submitted_at"),
                    },
                );
            }
        }
        let more = values.len() >= LIMIT;
        if page == selected_page {
            selected = values;
        }
        if !more {
            break;
        }
        page = page.checked_add(1).ok_or_else(|| {
            AppError::new(
                "hostingLimit",
                "The provider review page limit was reached.",
                None,
            )
        })?;
    }
    Ok((selected, current.into_values().collect()))
}

fn load_review_from(
    repository: &str,
    pull_number: u32,
    expected_head_oid: &str,
    query: &HostedReviewQuery,
    mut fetch: impl FnMut(&str) -> Result<Value, AppError>,
) -> Result<HostedReview, AppError> {
    let prefix = format!("repos/{repository}/pulls/{pull_number}");
    let pull = fetch(&prefix)?;
    let head = pull.get("head").ok_or_else(|| {
        AppError::new(
            "hostingResponse",
            "The pull request has no head commit.",
            None,
        )
    })?;
    let head_oid = text(head, "sha");
    if head_oid != expected_head_oid {
        return Err(AppError::new(
            "hostingStale",
            "The pull request changed. Reload its list before reviewing.",
            None,
        ));
    }
    let mut warnings = Vec::new();
    let files = review_section(
        fetch(&format!(
            "{prefix}/files?per_page={LIMIT}&page={}",
            query.files_page
        ))
        .and_then(|value| paged_records(value, None)),
        "Changed files",
        &mut warnings,
    )?;
    let reviews = review_section(
        review_history(repository, pull_number, query.reviews_page, &mut fetch),
        "Review history and latest decisions",
        &mut warnings,
    )?;
    let checks = review_section(fetch(&format!("repos/{repository}/commits/{head_oid}/check-runs?filter=latest&per_page={LIMIT}&page={}",query.checks_page)).and_then(|value| paged_records(value,Some("check_runs"))), "Check runs", &mut warnings)?;
    let statuses = review_section(
        fetch(&format!(
            "repos/{repository}/commits/{head_oid}/status?per_page={LIMIT}&page={}",
            query.statuses_page
        ))
        .and_then(|value| {
            let state = text(&value, "state");
            if !["success", "failure", "pending", "error"].contains(&state.as_str()) {
                return Err(AppError::new(
                    "hostingResponse",
                    "GitHub returned an unknown commit status.",
                    None,
                ));
            }
            Ok((state, paged_records(value, Some("statuses"))?))
        }),
        "Commit status contexts",
        &mut warnings,
    )?;
    let sections = HostedReviewSections {
        files: files.is_some(),
        reviews: reviews.is_some(),
        checks: checks.is_some(),
        statuses: statuses.is_some(),
    };
    let files = files.unwrap_or_default();
    let (reviews, current_reviews) = reviews.unwrap_or_default();
    let checks = checks.unwrap_or_default();
    let (legacy_state, statuses) = statuses
        .map(|(state, items)| (Some(state), items))
        .unwrap_or_default();
    let result = HostedReview {
        head_oid: head_oid.clone(),
        head_branch: text(head, "ref"),
        base_branch: pull
            .get("base")
            .map(|base| text(base, "ref"))
            .unwrap_or_default(),
        query: query.clone(),
        sections,
        warnings,
        current_reviews,
        legacy_state,
        files_may_have_more: pull
            .get("changed_files")
            .and_then(Value::as_u64)
            .map_or(files.len() >= LIMIT, |count| {
                count > u64::from(query.files_page - 1) * LIMIT as u64 + files.len() as u64
            }),
        reviews_may_have_more: reviews.len() >= LIMIT,
        checks_may_have_more: checks.len() >= LIMIT,
        statuses_may_have_more: statuses.len() >= LIMIT,
        files: files
            .iter()
            .take(LIMIT)
            .map(|file| HostedReviewFile {
                path: text(file, "filename"),
                state: text(file, "status"),
                additions: file
                    .get("additions")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    .min(u32::MAX as u64) as u32,
                deletions: file
                    .get("deletions")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    .min(u32::MAX as u64) as u32,
                patch: file.get("patch").and_then(Value::as_str).map(str::to_owned),
            })
            .collect(),
        reviews: reviews
            .iter()
            .take(LIMIT)
            .map(|review| HostedReviewStatus {
                name: review
                    .get("user")
                    .map(|user| text(user, "login"))
                    .unwrap_or_default(),
                state: text(review, "state"),
                body: text(review, "body"),
            })
            .collect(),
        checks: checks
            .iter()
            .take(LIMIT)
            .map(|check| HostedReviewStatus {
                name: text(check, "name"),
                state: {
                    let conclusion = text(check, "conclusion");
                    if conclusion.is_empty() {
                        text(check, "status")
                    } else {
                        format!("{} · {conclusion}", text(check, "status"))
                    }
                },
                body: String::new(),
            })
            .collect(),
        legacy_statuses: statuses
            .iter()
            .take(LIMIT)
            .map(|status| HostedReviewStatus {
                name: text(status, "context"),
                state: text(status, "state"),
                body: text(status, "description"),
            })
            .collect(),
    };
    let latest = fetch(&prefix)?;
    if latest.get("head").map(|head| text(head, "sha")).as_deref() != Some(head_oid.as_str()) {
        return Err(AppError::new(
            "hostingStale",
            "The pull request changed while loading. Reload before reviewing.",
            None,
        ));
    }
    Ok(result)
}

fn unsupported() -> AppError {
    AppError::new(
        "hostingUnsupported",
        "Select a remote hosted on github.com.",
        Some("Other hosts remain available through their browser review links."),
    )
}
fn github_repository(url: &str) -> Option<String> {
    let url = url.trim();
    let path = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("git@github.com:"))
        .or_else(|| url.strip_prefix("ssh://git@github.com/"))?;
    let path = path
        .trim_end_matches('/')
        .strip_suffix(".git")
        .unwrap_or(path.trim_end_matches('/'));
    let parts = path.split('/').collect::<Vec<_>>();
    if parts.len() != 2
        || parts.iter().any(|part| {
            part.is_empty()
                || *part == "."
                || *part == ".."
                || part.len() > 100
                || !part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        })
    {
        return None;
    }
    Some(path.to_owned())
}
fn api_command(endpoint: &str) -> Command {
    api_command_for_method(endpoint, "GET")
}
pub(crate) fn api_command_for_method(endpoint: &str, method: &str) -> Command {
    let mut command = Command::new("gh");
    command
        .args([
            "api",
            "--hostname",
            "github.com",
            "--method",
            method,
            "-H",
            "Accept: application/vnd.github+json",
            endpoint,
        ])
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for variable in GIT_CONTEXT_ENVIRONMENT_VARIABLES {
        command.env_remove(variable);
    }
    for variable in ["GH_DEBUG", "DEBUG", "GH_REPO", "GH_HOST", "GH_FORCE_TTY"] {
        command.env_remove(variable);
    }
    command
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_PAGER", "cat")
        .env("NO_COLOR", "1");
    configure_process_tree(&mut command);
    command
}
fn request(endpoint: &str, cancellation: &CancellationToken) -> Result<Value, AppError> {
    request_command(api_command(endpoint), cancellation)
}
pub(crate) fn request_command(
    command: Command,
    cancellation: &CancellationToken,
) -> Result<Value, AppError> {
    let (output, truncated) = run_cancellable_command_with_stdout_limit(
        command,
        cancellation,
        Some(OUTPUT_LIMIT),
    )
    .map_err(|error| {
        if error.kind == "operationCancelled" {
            error
        } else {
            AppError::new(
                "hostingUnavailable",
                "Could not start the GitHub CLI request.",
                Some("Install gh and authenticate separately with gh auth login, then retry."),
            )
        }
    })?;
    if !output.status.success() {
        // CLI diagnostics may contain URLs or credentials. Do not forward raw stderr.
        return Err(AppError::new(
            "hostingUnavailable",
            "GitHub data could not be loaded.",
            Some(
                "Check gh authentication, repository access, network connectivity and API rate limits, then retry.",
            ),
        ));
    }
    if truncated {
        return Err(AppError::new(
            "hostingLimit",
            "The response exceeded the preview limit.",
            Some("Open the repository on GitHub to inspect the complete result."),
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|_| {
        AppError::new(
            "hostingResponse",
            "GitHub returned an unreadable response.",
            None,
        )
    })
}
fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}
fn number(value: &Value, key: &str) -> Result<String, AppError> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .filter(|number| *number > 0)
        .map(|number| number.to_string())
        .ok_or_else(|| {
            AppError::new(
                "hostingResponse",
                "GitHub returned an invalid item identifier.",
                None,
            )
        })
}
fn parse_page(
    repository: &str,
    section: HostingSection,
    value: Value,
) -> Result<HostingPage, AppError> {
    let records = if matches!(section, HostingSection::Workflows) {
        value.get("workflow_runs")
    } else {
        Some(&value)
    }
    .and_then(Value::as_array)
    .ok_or_else(|| {
        AppError::new(
            "hostingResponse",
            "GitHub returned an unexpected list response.",
            None,
        )
    })?;
    let mut entries = Vec::new();
    for item in records.iter().take(LIMIT) {
        if matches!(section, HostingSection::Issues) && item.get("pull_request").is_some() {
            continue;
        }
        let workflow = matches!(section, HostingSection::Workflows);
        let number = number(item, if workflow { "id" } else { "number" })?;
        let route = match section {
            HostingSection::PullRequests => "pull",
            HostingSection::Issues => "issues",
            HostingSection::Workflows => "actions/runs",
        };
        let title = if workflow {
            let title = text(item, "display_title");
            if title.is_empty() {
                text(item, "name")
            } else {
                title
            }
        } else {
            text(item, "title")
        };
        let status = text(item, if workflow { "status" } else { "state" });
        let conclusion = text(item, "conclusion");
        let draft = item.get("draft").and_then(Value::as_bool).unwrap_or(false);
        entries.push(HostedEntry {
            url: format!("https://github.com/{repository}/{route}/{number}"),
            number,
            title,
            state: if !conclusion.is_empty() {
                format!("{status} · {conclusion}")
            } else if draft {
                format!("{status} · draft")
            } else {
                status
            },
            author: item
                .get(if workflow { "actor" } else { "user" })
                .map(|user| text(user, "login"))
                .unwrap_or_default(),
            branch: if workflow {
                text(item, "head_branch")
            } else {
                item.get("head")
                    .map(|head| text(head, "ref"))
                    .unwrap_or_default()
            },
            commit_oid: if workflow {
                text(item, "head_sha")
            } else {
                item.get("head")
                    .map(|head| text(head, "sha"))
                    .unwrap_or_default()
            },
            body: text(item, "body"),
        });
    }
    Ok(HostingPage {
        repository: repository.to_owned(),
        entries,
        may_have_more: records.len() >= LIMIT,
        page: 1,
        next_page: if records.len() >= LIMIT {
            Some(2)
        } else {
            None
        },
    })
}

fn list_endpoint(
    repository: &str,
    section: HostingSection,
    query: &HostingQuery,
) -> Result<String, AppError> {
    if query.page == 0 {
        return Err(AppError::new(
            "hostingRequest",
            "API page numbers start at one.",
            None,
        ));
    }
    let state = match query.state {
        HostingState::Open => "open",
        HostingState::Closed => "closed",
        HostingState::All => "all",
    };
    Ok(match section {
        HostingSection::PullRequests => format!(
            "repos/{repository}/pulls?state={state}&sort=updated&direction=desc&per_page={LIMIT}&page={}",
            query.page
        ),
        HostingSection::Issues => format!(
            "repos/{repository}/issues?state={state}&sort=updated&direction=desc&per_page={LIMIT}&page={}",
            query.page
        ),
        HostingSection::Workflows => format!(
            "repos/{repository}/actions/runs?per_page={LIMIT}&page={}",
            query.page
        ),
    })
}
pub fn load_hosting_page(
    path: &Path,
    remote: &str,
    section: HostingSection,
    query: &HostingQuery,
    cancellation: &CancellationToken,
) -> Result<HostingPage, AppError> {
    if query.page == 0 {
        return Err(AppError::new(
            "hostingRequest",
            "API page numbers start at one.",
            None,
        ));
    }
    let repository = repository_for_remote(path, remote)?;
    let mut result = parse_page(
        &repository,
        section,
        request(&list_endpoint(&repository, section, query)?, cancellation)?,
    )?;
    if repository_for_remote(path, remote)? != repository {
        return Err(AppError::new(
            "hostingStale",
            "The selected remote changed while loading. Refresh and reload.",
            None,
        ));
    }
    result.page = query.page;
    result.next_page = if result.may_have_more {
        query.page.checked_add(1)
    } else {
        None
    };
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn only_explicit_public_github_remotes_can_select_an_api_repository() {
        for url in [
            "https://github.com/team/repo.git",
            "git@github.com:team/repo.git",
            "ssh://git@github.com/team/repo",
        ] {
            assert_eq!(github_repository(url).as_deref(), Some("team/repo"));
        }
        for url in [
            "https://github.com.evil/team/repo",
            "https://user:token@github.com/team/repo",
            "https://github.com/team/../secrets",
            "https://github.com/team/repo?x=1",
            "-x",
            "https://gitlab.com/team/repo",
            "https://github.com/./repo",
            "https://github.com/team/repo#x",
        ] {
            assert!(github_repository(url).is_none(), "{url}");
        }
    }
    #[test]
    fn public_api_lists_preserve_states_filter_pull_requests_from_issues_and_build_safe_urls() {
        let data = json!([{"number": 12,"title":"Fix <script>","state":"open","draft":true,"head":{"sha":"a".repeat(40),"ref":"feature"},"user":{"login":"author"},"body":"Original description", "html_url":"javascript:bad"}]);
        let page = parse_page("team/repo", HostingSection::PullRequests, data).unwrap();
        assert_eq!(page.entries[0].url, "https://github.com/team/repo/pull/12");
        assert_eq!(page.entries[0].state, "open · draft");
        assert_eq!(page.entries[0].body, "Original description");
        let issues =
            json!([{"number":1,"pull_request":{}},{"number":2,"title":"Issue","state":"open"}]);
        assert_eq!(
            parse_page("team/repo", HostingSection::Issues, issues)
                .unwrap()
                .entries
                .len(),
            1
        );
        let runs = json!({"workflow_runs":[{"id":99,"display_title":"CI","status":"completed","conclusion":"failure","head_sha":"b".repeat(40),"head_branch":"dev"}]});
        let page = parse_page("team/repo", HostingSection::Workflows, runs).unwrap();
        assert_eq!(page.entries[0].state, "completed · failure");
        assert_eq!(page.entries[0].commit_oid, "b".repeat(40));
        assert!(parse_page("team/repo", HostingSection::Issues, json!({})).is_err());
        assert!(
            parse_page(
                "team/repo",
                HostingSection::Issues,
                json!([{"number":"unsafe"}])
            )
            .is_err()
        );
    }
    #[test]
    fn pagination_is_explicit_even_when_issues_filter_out_pull_requests() {
        let items = (1..=50)
            .map(|n| json!({"number":n,"pull_request":{}}))
            .collect::<Vec<_>>();
        let page = parse_page("team/repo", HostingSection::Issues, json!(items)).unwrap();
        assert!(page.may_have_more);
        assert!(page.entries.is_empty());
    }
    #[test]
    fn requests_are_get_only_fixed_host_and_never_run_in_the_repository() {
        let command = api_command("repos/team/repo/pulls?per_page=50");
        let args = command
            .get_args()
            .map(|arg| arg.to_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            args,
            [
                "api",
                "--hostname",
                "github.com",
                "--method",
                "GET",
                "-H",
                "Accept: application/vnd.github+json",
                "repos/team/repo/pulls?per_page=50"
            ]
        );
        assert_eq!(
            command.get_current_dir(),
            Some(std::env::temp_dir().as_path())
        );
        assert!(
            command
                .get_envs()
                .any(|(key, value)| key == "GH_DEBUG" && value.is_none())
        );
    }
    #[test]
    fn review_inspection_captures_commit_scoped_checks_and_marks_incomplete_provider_patches() {
        let oid = "a".repeat(40);
        let mut endpoints = Vec::new();
        let review = load_review_from("team/repo", 12, &oid, &HostedReviewQuery::default(), |endpoint| {
            endpoints.push(endpoint.to_owned());
            Ok(if endpoint.contains("/files?") { json!([{"filename":"unsafe/../name","status":"modified","additions":1,"deletions":2}]) }
            else if endpoint.contains("/reviews?") { json!([{"user":{"login":"reviewer"},"state":"CHANGES_REQUESTED","body":"Please test this"}]) }
            else if endpoint.contains("/check-runs?") { json!({"check_runs":[{"name":"test","status":"completed","conclusion":"failure"}]}) }
            else { json!({"head":{"sha":oid,"ref":"feature"},"base":{"ref":"main"},"changed_files":60}) })
        }).unwrap();
        assert_eq!(review.head_oid, oid);
        assert_eq!(review.head_branch, "feature");
        assert_eq!(review.base_branch, "main");
        assert!(review.files_may_have_more);
        assert!(review.files[0].patch.is_none());
        assert_eq!(review.reviews[0].state, "CHANGES_REQUESTED");
        assert_eq!(review.checks[0].state, "completed · failure");
        assert_eq!(endpoints.len(), 6);
        assert!(endpoints[3].contains(&format!("commits/{oid}/check-runs")));
        assert!(
            load_review_from(
                "team/repo",
                12,
                &oid,
                &HostedReviewQuery::default(),
                |_| Ok(json!({"head":{"sha":"b".repeat(40)}}))
            )
            .is_err()
        );
        let mut calls = 0;
        assert!(
            load_review_from("team/repo", 12, &oid, &HostedReviewQuery::default(), |endpoint| {
                calls += 1;
                Ok(if endpoint.contains("check-runs") {
                    json!({"check_runs":[]})
                } else if endpoint.contains('?') {
                    json!([])
                } else {
                    json!({"head":{"sha":if calls == 6 { "b".repeat(40) } else { oid.clone() }}})
                })
            })
            .is_err()
        );
    }

    #[cfg(unix)]
    #[test]
    fn owned_cli_responses_reject_failures_truncation_and_cancellation_without_leaking_diagnostics()
    {
        fn owned(script: &str) -> Command {
            let mut command = Command::new("/bin/sh");
            command
                .args(["-c", script])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            configure_process_tree(&mut command);
            command
        }
        let token = CancellationToken::default();
        assert_eq!(
            request_command(owned("printf '[]'"), &token).unwrap(),
            json!([])
        );
        let error =
            request_command(owned("printf 'secret-token' >&2; exit 1"), &token).unwrap_err();
        assert_eq!(error.kind, "hostingUnavailable");
        assert!(!error.message.contains("secret-token"));
        assert!(request_command(owned("printf 'invalid-json'"), &token).is_err());
        let large = format!("head -c {} /dev/zero", OUTPUT_LIMIT + 1);
        assert_eq!(
            request_command(owned(&large), &token).unwrap_err().kind,
            "hostingLimit"
        );
        token.cancel();
        assert_eq!(
            request_command(owned("sleep 30"), &token).unwrap_err().kind,
            "operationCancelled"
        );
    }
    #[test]
    fn paging_and_state_are_explicit_and_invalid_pages_refuse_before_repository_or_network_access()
    {
        let query = HostingQuery {
            page: 2,
            state: HostingState::Closed,
        };
        let endpoint = list_endpoint("team/repo", HostingSection::PullRequests, &query).unwrap();
        assert!(endpoint.contains("state=closed") && endpoint.ends_with("page=2"));
        let query = HostingQuery {
            page: 3,
            state: HostingState::All,
        };
        assert!(
            list_endpoint("team/repo", HostingSection::Issues, &query)
                .unwrap()
                .contains("state=all")
        );
        assert!(
            list_endpoint("team/repo", HostingSection::Workflows, &query)
                .unwrap()
                .ends_with("page=3")
        );
        let token = CancellationToken::default();
        let path = Path::new("/not-an-open-repository");
        assert_eq!(
            load_hosting_page(
                path,
                "origin",
                HostingSection::Issues,
                &HostingQuery {
                    page: 0,
                    state: HostingState::Open
                },
                &token
            )
            .unwrap_err()
            .kind,
            "hostingRequest"
        );
        assert_eq!(
            load_hosted_review(
                path,
                "origin",
                1,
                &"a".repeat(40),
                &HostedReviewQuery {
                    files_page: 0,
                    ..HostedReviewQuery::default()
                },
                &token
            )
            .unwrap_err()
            .kind,
            "hostingRequest"
        );
        let defaults: HostingQuery = serde_json::from_value(json!({})).unwrap();
        assert_eq!(defaults.page, 1);
        assert!(serde_json::from_value::<HostingQuery>(json!({"state":"private"})).is_err());
        assert!(
            serde_json::from_value::<HostedReviewQuery>(json!({"execute":"unexpected"})).is_err()
        );
    }

    #[test]
    fn latest_decisions_read_all_pages_without_treating_comments_or_pending_reviews_as_decisions() {
        let oid = "a".repeat(40);
        let mut first = (0..47)
            .map(|n| json!({"user":{"login":format!("commenter-{n}")},"state":"COMMENTED"}))
            .collect::<Vec<_>>();
        first.extend([json!({"user":{"login":"Alice"},"state":"CHANGES_REQUESTED","commit_id":"b".repeat(40)}),json!({"user":{"login":"bob"},"state":"APPROVED","commit_id":oid}),json!({"user":{"login":"carol"},"state":"APPROVED","commit_id":oid})]);
        let second = json!([{"user":{"login":"alice"},"state":"APPROVED","commit_id":oid,"submitted_at":"2026-10-31T00:00:00Z"},{"user":{"login":"bob"},"state":"COMMENTED"},{"user":{"login":"carol"},"state":"DISMISSED"},{"user":{"login":"pending-only"},"state":"PENDING"}]);
        let query = HostedReviewQuery {
            reviews_page: 2,
            files_page: 2,
            ..HostedReviewQuery::default()
        };
        let mut review_pages = Vec::new();
        let result=load_review_from("team/repo",12,&oid,&query,|endpoint| {
            Ok(if endpoint.contains("/reviews?") { review_pages.push(endpoint.to_owned()); if endpoint.ends_with("page=1") { json!(first) } else { second.clone() } }
            else if endpoint.contains("/files?") { assert!(endpoint.ends_with("page=2")); json!([{"filename":"second-page.txt","status":"added"}]) }
            else if endpoint.contains("/check-runs?") { json!({"check_runs":[]}) }
            else if endpoint.contains("/status?") { json!({"state":"failure","statuses":[{"context":"external-ci","state":"failure","description":"Build failed"}]}) }
            else { json!({"head":{"sha":oid,"ref":"feature"},"base":{"ref":"main"},"changed_files":51}) })
        }).unwrap();
        assert_eq!(review_pages.len(), 2);
        assert_eq!(result.reviews.len(), 4);
        assert_eq!(result.current_reviews.len(), 3);
        assert_eq!(
            result
                .current_reviews
                .iter()
                .map(|r| (r.name.as_str(), r.state.as_str()))
                .collect::<Vec<_>>(),
            [
                ("alice", "APPROVED"),
                ("bob", "APPROVED"),
                ("carol", "DISMISSED")
            ]
        );
        assert_eq!(result.current_reviews[0].commit_oid, oid);
        assert_eq!(result.legacy_state.as_deref(), Some("failure"));
        assert_eq!(result.legacy_statuses[0].name, "external-ci");
        assert_eq!(result.files[0].path, "second-page.txt");
        assert!(!result.files_may_have_more);
        assert!(
            result.sections.files
                && result.sections.reviews
                && result.sections.checks
                && result.sections.statuses
        );
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn unavailable_check_sections_remain_unknown_without_discarding_accessible_review_files() {
        let oid = "a".repeat(40);
        let result = load_review_from(
            "team/repo",
            12,
            &oid,
            &HostedReviewQuery::default(),
            |endpoint| {
                if endpoint.contains("/check-runs?") || endpoint.contains("/status?") {
                    return Err(AppError::new(
                        "hostingUnavailable",
                        "sensitive diagnostic",
                        None,
                    ));
                }
                Ok(if endpoint.contains("/files?") {
                    json!([{"filename":"available.txt"}])
                } else if endpoint.contains("/reviews?") {
                    json!([])
                } else {
                    json!({"head":{"sha":oid}})
                })
            },
        )
        .unwrap();
        assert!(result.sections.files && result.sections.reviews);
        assert!(!result.sections.checks && !result.sections.statuses);
        assert!(result.legacy_state.is_none());
        assert!(result.checks.is_empty());
        assert_eq!(result.warnings.len(), 2);
        assert!(!result.warnings.join(" ").contains("sensitive"));
        let cancelled = load_review_from(
            "team/repo",
            12,
            &oid,
            &HostedReviewQuery::default(),
            |endpoint| {
                if endpoint.contains("/reviews?") {
                    return Err(AppError::new("operationCancelled", "cancelled", None));
                }
                Ok(if endpoint.contains("/files?") {
                    json!([])
                } else {
                    json!({"head":{"sha":oid}})
                })
            },
        )
        .unwrap_err();
        assert_eq!(cancelled.kind, "operationCancelled");
    }
}
