//! GitHub repository discovery from the public REST contract.
//! Provider metadata is allowlisted; raw responses and temporary clone tokens
//! never become renderer payloads. Fork creation remains a separate operation.
use super::hosting_writes::{CliTransport, Transport};
use super::*;
use serde_json::Value;

const PAGE_SIZE: usize = 50;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedAccount {
    pub host: String,
    pub id: String,
    pub login: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedRepositoryIdentity {
    pub id: String,
    pub full_name: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostedRepository {
    pub id: String,
    pub owner_id: String,
    pub owner: String,
    pub name: String,
    pub full_name: String,
    pub url: String,
    pub clone_https: Option<String>,
    pub clone_ssh: Option<String>,
    pub description: Option<String>,
    pub default_branch: Option<String>,
    pub private: Option<bool>,
    pub archived: Option<bool>,
    pub disabled: Option<bool>,
    pub fork: Option<bool>,
    pub parent: Option<HostedRepositoryIdentity>,
    pub source: Option<HostedRepositoryIdentity>,
    pub can_pull: Option<bool>,
    pub can_push: Option<bool>,
    pub forking_allowed: Option<bool>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum HostedRepositoryVisibility {
    #[default]
    All,
    Public,
    Private,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum HostedRepositoryAffiliation {
    #[default]
    Accessible,
    Owned,
    Collaborating,
    OrganizationMember,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum HostedRepositorySort {
    #[default]
    FullName,
    Updated,
    Pushed,
    Created,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum HostedRepositoryDirection {
    #[default]
    Ascending,
    Descending,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedRepositoryQuery {
    pub page: u32,
    pub expected_account_id: Option<String>,
    pub visibility: HostedRepositoryVisibility,
    pub affiliation: HostedRepositoryAffiliation,
    pub sort: HostedRepositorySort,
    pub direction: HostedRepositoryDirection,
}
impl Default for HostedRepositoryQuery {
    fn default() -> Self {
        Self {
            page: 1,
            expected_account_id: None,
            visibility: Default::default(),
            affiliation: Default::default(),
            sort: Default::default(),
            direction: Default::default(),
        }
    }
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostedRepositoryPage {
    pub account: HostedAccount,
    pub query: HostedRepositoryQuery,
    pub entries: Vec<HostedRepository>,
    pub may_have_more: bool,
    pub next_page: Option<u32>,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostedRepositoryInspection {
    pub account: HostedAccount,
    pub repository: HostedRepository,
}

fn response_error() -> AppError {
    AppError::new(
        "hostingDiscoveryResponse",
        "The provider returned incomplete or inconsistent repository metadata.",
        Some("Reload the account catalogue before selecting a repository."),
    )
}
fn request_error(message: &str) -> AppError {
    AppError::new(
        "hostingDiscoveryRequest",
        message,
        Some("Review the selected account and repository."),
    )
}
pub(crate) fn component(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 100
        && text != "."
        && text != ".."
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}
fn slug(text: &str) -> Result<(&str, &str), AppError> {
    let Some((owner, name)) = text.split_once('/') else {
        return Err(response_error());
    };
    if !component(owner) || !component(name) {
        return Err(response_error());
    }
    Ok((owner, name))
}
fn positive_id(text: &str) -> Option<u64> {
    if text.is_empty() || text.len() > 20 || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    text.parse::<u64>().ok().filter(|id| *id > 0)
}
pub(crate) fn id(value: &Value) -> Result<String, AppError> {
    // Preserve REST integer identity across the JavaScript precision boundary.
    value
        .as_u64()
        .filter(|id| *id > 0)
        .or_else(|| positive_id(value.as_str()?))
        .map(|id| id.to_string())
        .ok_or_else(response_error)
}
fn validate_query(query: &HostedRepositoryQuery) -> Result<(), AppError> {
    if query.page == 0 {
        return Err(request_error("Repository page numbers start at one."));
    }
    if query.page > 1 && query.expected_account_id.is_none() {
        return Err(request_error(
            "Reload the first repository page before continuing its account catalogue.",
        ));
    }
    if query
        .expected_account_id
        .as_ref()
        .is_some_and(|id| positive_id(id).is_none())
    {
        return Err(request_error(
            "The selected provider account identity is invalid.",
        ));
    }
    Ok(())
}
fn validate_selection(
    full_name: &str,
    expected_id: &str,
    expected_account_id: &str,
) -> Result<(), AppError> {
    slug(full_name).map_err(|_| request_error("Select a literal owner/repository name."))?;
    if positive_id(expected_id).is_none() || positive_id(expected_account_id).is_none() {
        return Err(request_error("The selected provider identity is invalid."));
    }
    Ok(())
}

fn required_text<'a>(value: &'a Value, key: &str, limit: usize) -> Result<&'a str, AppError> {
    let text = value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(response_error)?;
    if text.is_empty() || text.len() > limit || text.contains('\0') {
        return Err(response_error());
    }
    Ok(text)
}
fn optional_text(value: &Value, key: &str, limit: usize) -> Result<Option<String>, AppError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) if text.len() <= limit && !text.contains('\0') => {
            Ok(Some(text.clone()))
        }
        _ => Err(response_error()),
    }
}
fn optional_bool(value: &Value, key: &str) -> Result<Option<bool>, AppError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(value)) => Ok(Some(*value)),
        _ => Err(response_error()),
    }
}
fn identity(value: &Value) -> Result<HostedRepositoryIdentity, AppError> {
    let full_name = required_text(value, "full_name", 201)?;
    slug(full_name)?;
    Ok(HostedRepositoryIdentity {
        id: id(&value["id"])?,
        full_name: full_name.into(),
    })
}
fn optional_identity(
    value: &Value,
    key: &str,
) -> Result<Option<HostedRepositoryIdentity>, AppError> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => identity(value).map(Some),
    }
}
pub(crate) fn repository(value: &Value) -> Result<HostedRepository, AppError> {
    let identity = identity(value)?;
    let (expected_owner, expected_name) = slug(&identity.full_name)?;
    let owner = required_text(&value["owner"], "login", 100)?;
    let name = required_text(value, "name", 100)?;
    if owner != expected_owner || name != expected_name {
        return Err(response_error());
    }
    let url = required_text(value, "html_url", 1024)?;
    if url != format!("https://github.com/{}", identity.full_name) {
        return Err(response_error());
    }
    let clone_https = optional_text(value, "clone_url", 1024)?;
    let clone_ssh = optional_text(value, "ssh_url", 1024)?;
    if clone_https
        .as_ref()
        .is_some_and(|url| url != &format!("https://github.com/{}.git", identity.full_name))
        || clone_ssh
            .as_ref()
            .is_some_and(|url| url != &format!("git@github.com:{}.git", identity.full_name))
    {
        return Err(response_error());
    }
    let permissions = match value.get("permissions") {
        None | Some(Value::Null) => &Value::Null,
        Some(value) if value.is_object() => value,
        _ => return Err(response_error()),
    };
    Ok(HostedRepository {
        id: identity.id,
        owner_id: id(&value["owner"]["id"])?,
        owner: owner.into(),
        name: name.into(),
        full_name: identity.full_name.clone(),
        url: url.into(),
        clone_https,
        clone_ssh,
        description: optional_text(value, "description", 4096)?,
        default_branch: optional_text(value, "default_branch", 1024)?,
        private: optional_bool(value, "private")?,
        archived: optional_bool(value, "archived")?,
        disabled: optional_bool(value, "disabled")?,
        fork: optional_bool(value, "fork")?,
        parent: optional_identity(value, "parent")?,
        source: optional_identity(value, "source")?,
        can_pull: optional_bool(permissions, "pull")?,
        can_push: optional_bool(permissions, "push")?,
        forking_allowed: optional_bool(value, "allow_forking")?,
    })
}
fn account(transport: &mut impl Transport) -> Result<HostedAccount, AppError> {
    let value = transport.get("user")?;
    let login = required_text(&value, "login", 100)?;
    if !component(login) {
        return Err(response_error());
    }
    Ok(HostedAccount {
        host: "github.com".into(),
        id: id(&value["id"])?,
        login: login.into(),
    })
}
fn page_with(
    transport: &mut impl Transport,
    query: HostedRepositoryQuery,
) -> Result<HostedRepositoryPage, AppError> {
    validate_query(&query)?;
    let account = account(transport)?;
    if query
        .expected_account_id
        .as_ref()
        .is_some_and(|expected| expected != &account.id)
    {
        return Err(request_error(
            "The provider account changed. Reload its first repository page.",
        ));
    }
    let visibility = match query.visibility {
        HostedRepositoryVisibility::All => "all",
        HostedRepositoryVisibility::Public => "public",
        HostedRepositoryVisibility::Private => "private",
    };
    let affiliation = match query.affiliation {
        HostedRepositoryAffiliation::Accessible => "owner,collaborator,organization_member",
        HostedRepositoryAffiliation::Owned => "owner",
        HostedRepositoryAffiliation::Collaborating => "collaborator",
        HostedRepositoryAffiliation::OrganizationMember => "organization_member",
    };
    let sort = match query.sort {
        HostedRepositorySort::FullName => "full_name",
        HostedRepositorySort::Updated => "updated",
        HostedRepositorySort::Pushed => "pushed",
        HostedRepositorySort::Created => "created",
    };
    let direction = match query.direction {
        HostedRepositoryDirection::Ascending => "asc",
        HostedRepositoryDirection::Descending => "desc",
    };
    let endpoint = format!(
        "user/repos?per_page={PAGE_SIZE}&page={}&visibility={visibility}&affiliation={affiliation}&sort={sort}&direction={direction}",
        query.page
    );
    let value = transport.get(&endpoint)?;
    let records = value.as_array().ok_or_else(response_error)?;
    if records.len() > PAGE_SIZE {
        return Err(response_error());
    }
    let entries = records
        .iter()
        .map(repository)
        .collect::<Result<Vec<_>, _>>()?;
    let mut ids = HashSet::new();
    if entries.iter().any(|entry| !ids.insert(&entry.id)) {
        return Err(response_error());
    }
    let may_have_more = records.len() == PAGE_SIZE;
    let next_page = if may_have_more {
        query.page.checked_add(1)
    } else {
        None
    };
    Ok(HostedRepositoryPage {
        account,
        query,
        entries,
        may_have_more,
        next_page,
    })
}
pub(crate) fn inspect_with(
    transport: &mut impl Transport,
    full_name: &str,
    expected_id: &str,
    expected_account_id: &str,
) -> Result<HostedRepositoryInspection, AppError> {
    validate_selection(full_name, expected_id, expected_account_id)?;
    let account = account(transport)?;
    if account.id != expected_account_id {
        return Err(request_error(
            "The selected provider account changed. Reload its repositories.",
        ));
    }
    let repository = repository(&transport.get(&format!("repos/{full_name}"))?)?;
    if repository.id != expected_id {
        return Err(request_error(
            "That repository identity changed. Select it again from fresh provider state.",
        ));
    }
    Ok(HostedRepositoryInspection {
        account,
        repository,
    })
}

pub fn load_hosted_repository_page(
    query: HostedRepositoryQuery,
    cancellation: &CancellationToken,
) -> Result<HostedRepositoryPage, AppError> {
    validate_query(&query)?;
    let mut transport = CliTransport::new(cancellation)?;
    page_with(&mut transport, query)
}
pub fn inspect_hosted_repository(
    full_name: &str,
    expected_id: &str,
    expected_account_id: &str,
    cancellation: &CancellationToken,
) -> Result<HostedRepositoryInspection, AppError> {
    validate_selection(full_name, expected_id, expected_account_id)?;
    let mut transport = CliTransport::new(cancellation)?;
    inspect_with(&mut transport, full_name, expected_id, expected_account_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    struct Fixture {
        account: Value,
        list: Value,
        repository: Value,
        calls: Vec<String>,
    }
    impl Transport for Fixture {
        fn get(&mut self, endpoint: &str) -> Result<Value, AppError> {
            self.calls.push(endpoint.into());
            Ok(if endpoint == "user" {
                self.account.clone()
            } else if endpoint.starts_with("user/repos?") {
                self.list.clone()
            } else {
                self.repository.clone()
            })
        }
        fn write(&mut self, _: &'static str, _: &str, _: &Value) -> Result<Value, AppError> {
            panic!("Repository discovery must not submit provider writes")
        }
    }
    fn entry() -> Value {
        json!({"id": 9007199254740993u64, "name": "owned", "full_name": "team/owned", "owner": {"login": "team", "id": 9007199254740995u64}, "html_url": "https://github.com/team/owned", "clone_url": "https://github.com/team/owned.git", "ssh_url": "git@github.com:team/owned.git", "fork": false, "private": true, "permissions": {"pull": true, "push": false}, "temp_clone_token": "must-never-leave-the-provider-response"})
    }
    fn fixture() -> Fixture {
        Fixture {
            account: json!({"id": 7, "login": "owned-user"}),
            list: json!([entry()]),
            repository: entry(),
            calls: vec![],
        }
    }

    #[test]
    fn discover_page_is_account_bound_precision_safe_and_does_not_expose_raw_provider_fields() {
        let mut fixture = fixture();
        let page = page_with(&mut fixture, Default::default()).unwrap();
        assert_eq!(page.account.id, "7");
        assert_eq!(page.account.host, "github.com");
        assert_eq!(page.entries[0].id, "9007199254740993");
        assert_eq!(page.entries[0].owner_id, "9007199254740995");
        assert_eq!(page.entries[0].can_push, Some(false));
        assert!(!page.may_have_more);
        assert_eq!(page.next_page, None);
        let encoded = serde_json::to_string(&page).unwrap();
        assert!(!encoded.contains("temp_clone_token"));
        assert!(!encoded.contains("must-never-leave"));
        assert_eq!(
            fixture.calls,
            [
                "user",
                "user/repos?per_page=50&page=1&visibility=all&affiliation=owner,collaborator,organization_member&sort=full_name&direction=asc"
            ]
        );
    }
    #[test]
    fn complete_api_pages_expose_the_next_page_without_claiming_the_catalogue_is_complete() {
        let mut fixture = fixture();
        fixture.list = Value::Array(
            (1..=50)
                .map(|id| {
                    let mut entry = entry();
                    entry["id"] = json!(id);
                    entry
                })
                .collect(),
        );
        let query = HostedRepositoryQuery {
            page: 3,
            expected_account_id: Some("7".into()),
            visibility: HostedRepositoryVisibility::Private,
            affiliation: HostedRepositoryAffiliation::Owned,
            sort: HostedRepositorySort::Updated,
            direction: HostedRepositoryDirection::Descending,
        };
        let page = page_with(&mut fixture, query.clone()).unwrap();
        assert_eq!(page.query, query);
        assert!(page.may_have_more);
        assert_eq!(page.next_page, Some(4));
        assert_eq!(page.entries.len(), 50);
        assert_eq!(
            fixture.calls[1],
            "user/repos?per_page=50&page=3&visibility=private&affiliation=owner&sort=updated&direction=desc"
        );
    }
    #[test]
    fn missing_optional_metadata_remains_unknown_instead_of_becoming_false() {
        let entry = repository(
            &json!({"id": 1, "name": ".github", "full_name": "team/.github",
            "owner": {"id": 2, "login": "team"}, "html_url": "https://github.com/team/.github"}),
        )
        .unwrap();
        assert_eq!(entry.fork, None);
        assert_eq!(entry.private, None);
        assert_eq!(entry.can_push, None);
        assert_eq!(entry.clone_https, None);
        assert_eq!(entry.default_branch, None);
    }
    #[test]
    fn response_urls_and_repository_ownership_cannot_redirect_cloning_or_browsing() {
        for (key, value) in [
            ("clone_url", "https://credential@github.com/team/owned.git"),
            ("clone_url", "https://elsewhere.test/team/owned.git"),
            ("ssh_url", "git@github.com:other/owned.git"),
            ("html_url", "https://github.com/team/other"),
            ("full_name", "other/owned"),
        ] {
            let mut entry = entry();
            entry[key] = json!(value);
            assert!(repository(&entry).is_err(), "{key}: {value}");
        }
    }
    #[test]
    fn mismatched_accounts_and_repository_ids_refuse_selection_without_any_provider_write() {
        let mut fixture = fixture();
        assert!(inspect_with(&mut fixture, "team/owned", "9007199254740993", "8").is_err());
        assert_eq!(fixture.calls, ["user"]);
        fixture.calls.clear();
        assert!(inspect_with(&mut fixture, "team/owned", "99", "7").is_err());
        assert_eq!(fixture.calls, ["user", "repos/team/owned"]);
        let selected = inspect_with(&mut fixture, "team/owned", "9007199254740993", "7").unwrap();
        assert_eq!(selected.repository.id, "9007199254740993");
    }
    #[test]
    fn oversized_malformed_duplicate_and_zero_page_results_are_refused() {
        let mut fixture = fixture();
        let query = HostedRepositoryQuery {
            page: 0,
            ..Default::default()
        };
        assert!(page_with(&mut fixture, query).is_err());
        assert!(fixture.calls.is_empty());
        fixture.list = json!([entry(), entry()]);
        assert!(page_with(&mut fixture, Default::default()).is_err());
        fixture.list = Value::Array((0..51).map(|_| entry()).collect());
        assert!(page_with(&mut fixture, Default::default()).is_err());
        fixture.list = json!({"unexpected": []});
        assert!(page_with(&mut fixture, Default::default()).is_err());
        let mut entry = entry();
        entry["permissions"] = json!({"push": "true"});
        assert!(repository(&entry).is_err());
    }
    #[test]
    fn later_pages_require_the_original_account_and_never_query_a_replacement_account() {
        let mut fixture = fixture();
        let mut query = HostedRepositoryQuery {
            page: 2,
            ..Default::default()
        };
        assert!(page_with(&mut fixture, query.clone()).is_err());
        assert!(fixture.calls.is_empty());
        query.expected_account_id = Some("8".into());
        assert!(page_with(&mut fixture, query).is_err());
        assert_eq!(fixture.calls, ["user"]);
    }
}
