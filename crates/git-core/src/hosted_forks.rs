//! Read-only fork discovery from the public GitHub REST contract.
//! A list entry is only a candidate; fresh identity and network inspection is
//! required before another operation may review its URL or local attachment.
use super::hosted_repositories::{inspect_with, repository};
use super::hosting_writes::{CliTransport, Transport};
use super::*;

const PAGE_SIZE: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedForkQuery {
    pub source_full_name: String,
    pub source_repository_id: String,
    pub account_id: String,
    pub page: u32,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostedForkPage {
    pub account: HostedAccount,
    pub source: HostedRepositoryIdentity,
    pub network: HostedRepositoryIdentity,
    pub query: HostedForkQuery,
    pub entries: Vec<HostedRepository>,
    pub may_have_more: bool,
    pub next_page: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedForkSelection {
    pub source_full_name: String,
    pub source_repository_id: String,
    pub account_id: String,
    pub fork_full_name: String,
    pub fork_repository_id: String,
    pub fork_owner_id: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostedForkInspection {
    pub account: HostedAccount,
    pub source: HostedRepositoryIdentity,
    pub network: HostedRepositoryIdentity,
    pub repository: HostedRepository,
}

fn refused(message: &str) -> AppError {
    AppError::new(
        "hostingForkDiscovery",
        message,
        Some("Reload the source repository and inspect the selected fork again."),
    )
}

fn identity(repository: &HostedRepository) -> HostedRepositoryIdentity {
    HostedRepositoryIdentity {
        id: repository.id.clone(),
        full_name: repository.full_name.clone(),
    }
}

pub(crate) fn network(source: &HostedRepository) -> Result<HostedRepositoryIdentity, AppError> {
    match (source.fork, &source.source) {
        (Some(false), None) => Ok(identity(source)),
        (Some(true), Some(root)) if root.id != source.id => Ok(root.clone()),
        _ => Err(refused(
            "The provider did not identify the source fork network consistently.",
        )),
    }
}

fn source_with(
    transport: &mut impl Transport,
    full_name: &str,
    repository_id: &str,
    account_id: &str,
) -> Result<HostedRepositoryInspection, AppError> {
    let source = inspect_with(transport, full_name, repository_id, account_id)?;
    if source.repository.full_name != full_name
        || source.repository.disabled == Some(true)
        || source.repository.can_pull == Some(false)
    {
        return Err(refused("The source repository changed or is unavailable."));
    }
    Ok(source)
}

fn page_with(
    transport: &mut impl Transport,
    query: HostedForkQuery,
) -> Result<HostedForkPage, AppError> {
    if query.page == 0 {
        return Err(refused("Fork page numbers start at one."));
    }
    let source = source_with(
        transport,
        &query.source_full_name,
        &query.source_repository_id,
        &query.account_id,
    )?;
    let network = network(&source.repository)?;
    let value = transport.get(&format!(
        "repos/{}/forks?per_page={PAGE_SIZE}&page={}&sort=newest",
        source.repository.full_name, query.page
    ))?;
    let values = value
        .as_array()
        .filter(|values| values.len() <= PAGE_SIZE)
        .ok_or_else(|| refused("The provider returned an invalid fork page."))?;
    let entries = values
        .iter()
        .map(repository)
        .collect::<Result<Vec<_>, _>>()?;
    let mut ids = HashSet::new();
    if entries.iter().any(|entry| {
        entry.fork != Some(true) || entry.id == source.repository.id || !ids.insert(&entry.id)
    }) {
        return Err(refused(
            "The provider returned inconsistent fork candidates.",
        ));
    }
    let may_have_more = entries.len() == PAGE_SIZE;
    Ok(HostedForkPage {
        account: source.account,
        source: identity(&source.repository),
        network,
        next_page: if may_have_more {
            query.page.checked_add(1)
        } else {
            None
        },
        query,
        entries,
        may_have_more,
    })
}

fn inspect_fork_with(
    transport: &mut impl Transport,
    selection: &HostedForkSelection,
) -> Result<HostedForkInspection, AppError> {
    let source = source_with(
        transport,
        &selection.source_full_name,
        &selection.source_repository_id,
        &selection.account_id,
    )?;
    let network = network(&source.repository)?;
    let fork = inspect_with(
        transport,
        &selection.fork_full_name,
        &selection.fork_repository_id,
        &selection.account_id,
    )?;
    // Both ownership and ancestry are identities, never guesses based on a
    // same-name repository. Forks of another fork share the network root.
    if fork.account != source.account
        || fork.repository.full_name != selection.fork_full_name
        || fork.repository.owner_id != selection.fork_owner_id
        || fork.repository.id == source.repository.id
        || fork.repository.fork != Some(true)
        || fork.repository.source.as_ref() != Some(&network)
        || fork
            .repository
            .parent
            .as_ref()
            .is_none_or(|parent| parent.id == fork.repository.id)
        || fork.repository.disabled == Some(true)
        || fork.repository.can_pull == Some(false)
    {
        return Err(refused(
            "The selected repository is not a verified, accessible fork for that owner and source network.",
        ));
    }
    Ok(HostedForkInspection {
        account: source.account,
        source: identity(&source.repository),
        network,
        repository: fork.repository,
    })
}

pub fn load_hosted_fork_page(
    query: HostedForkQuery,
    cancellation: &CancellationToken,
) -> Result<HostedForkPage, AppError> {
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    if query.page == 0 {
        return Err(refused("Fork page numbers start at one."));
    }
    let mut transport = CliTransport::new(cancellation)?;
    page_with(&mut transport, query)
}

pub fn inspect_hosted_fork(
    selection: &HostedForkSelection,
    cancellation: &CancellationToken,
) -> Result<HostedForkInspection, AppError> {
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    let mut transport = CliTransport::new(cancellation)?;
    inspect_fork_with(&mut transport, selection)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    struct Fixture {
        actor: Value,
        source: Value,
        fork: Value,
        list: Value,
        calls: Vec<String>,
        fail: bool,
    }
    impl Transport for Fixture {
        fn get(&mut self, endpoint: &str) -> Result<Value, AppError> {
            self.calls.push(endpoint.into());
            if self.fail {
                return Err(refused("Owned provider read failed."));
            }
            Ok(match endpoint {
                "user" => self.actor.clone(),
                "repos/team/source" => self.source.clone(),
                "repos/owned/source" => self.fork.clone(),
                _ if endpoint.starts_with("repos/team/source/forks?") => self.list.clone(),
                _ => panic!("Unexpected read: {endpoint}"),
            })
        }
        fn write(&mut self, _: &'static str, _: &str, _: &Value) -> Result<Value, AppError> {
            panic!("Fork discovery must never submit a provider write")
        }
    }
    fn entry(id: u64, owner: &str, owner_id: u64, name: &str, fork: bool) -> Value {
        let full_name = format!("{owner}/{name}");
        json!({"id":id,"owner":{"id":owner_id,"login":owner},"name":name,"full_name":full_name,"html_url":format!("https://github.com/{full_name}"),"clone_url":format!("https://github.com/{full_name}.git"),"ssh_url":format!("git@github.com:{full_name}.git"),"fork":fork,"permissions":{"pull":true,"push":false},"temp_clone_token":"owned-private-field"})
    }
    fn fixture() -> Fixture {
        let source = entry(101, "team", 90, "source", false);
        let mut fork = entry(9007199254740993, "owned", 9007199254740995, "source", true);
        fork["parent"] = json!({"id":101,"full_name":"team/source"});
        fork["source"] = fork["parent"].clone();
        Fixture {
            actor: json!({"id":7,"login":"owned-actor"}),
            source,
            list: json!([fork.clone()]),
            fork,
            calls: vec![],
            fail: false,
        }
    }
    fn query() -> HostedForkQuery {
        HostedForkQuery {
            source_full_name: "team/source".into(),
            source_repository_id: "101".into(),
            account_id: "7".into(),
            page: 1,
        }
    }
    fn selection() -> HostedForkSelection {
        HostedForkSelection {
            source_full_name: "team/source".into(),
            source_repository_id: "101".into(),
            account_id: "7".into(),
            fork_full_name: "owned/source".into(),
            fork_repository_id: "9007199254740993".into(),
            fork_owner_id: "9007199254740995".into(),
        }
    }
    #[test]
    fn fork_page_is_bounded_account_bound_and_precision_safe() {
        let mut f = fixture();
        let page = page_with(&mut f, query()).unwrap();
        assert_eq!(page.entries[0].id, "9007199254740993");
        assert_eq!(page.account.id, "7");
        assert_eq!(page.network.id, "101");
        assert!(!page.may_have_more);
        assert_eq!(page.next_page, None);
        assert_eq!(
            f.calls,
            [
                "user",
                "repos/team/source",
                "repos/team/source/forks?per_page=50&page=1&sort=newest"
            ]
        );
        let encoded = serde_json::to_string(&page).unwrap();
        assert!(!encoded.contains("owned-private-field"));
        assert!(!encoded.contains("temp_clone_token"));
        f.actor["id"] = json!(8);
        let mut q = query();
        q.page = 2;
        assert!(page_with(&mut f, q).is_err());
        assert_eq!(f.calls.last().unwrap(), "user");
    }
    #[test]
    fn fork_page_empty_is_distinct_from_failure_and_invalid_pages() {
        let mut f = fixture();
        f.list = json!([]);
        assert!(page_with(&mut f, query()).unwrap().entries.is_empty());
        f.fail = true;
        assert!(page_with(&mut f, query()).is_err());
        f.fail = false;
        let mut q = query();
        q.page = 0;
        f.calls.clear();
        assert!(page_with(&mut f, q).is_err());
        assert!(f.calls.is_empty());
        for list in [
            json!({}),
            json!([f.fork.clone(), f.fork.clone()]),
            json!([f.source.clone()]),
            json!(vec![f.fork.clone(); 51]),
        ] {
            f.list = list;
            assert!(page_with(&mut f, query()).is_err());
        }
    }
    #[test]
    fn fork_page_requires_continuation_for_a_full_page() {
        let mut f = fixture();
        f.list = json!(
            (0..50)
                .map(|i| entry(1000 + i, "owned", 8, &format!("fork-{i}"), true))
                .collect::<Vec<_>>()
        );
        let page = page_with(&mut f, query()).unwrap();
        assert!(page.may_have_more);
        assert_eq!(page.next_page, Some(2));
        let mut q = query();
        q.page = u32::MAX;
        assert_eq!(page_with(&mut f, q).unwrap().next_page, None);
    }
    #[test]
    fn fork_inspection_requires_fresh_owner_identity_and_network_not_name() {
        let mut f = fixture();
        let selected = inspect_fork_with(&mut f, &selection()).unwrap();
        assert_eq!(selected.repository.owner_id, "9007199254740995");
        for (field, value) in [
            ("id", json!(999)),
            ("owner", json!({"login":"owned","id":8})),
            ("fork", json!(false)),
            ("source", json!({"id":999,"full_name":"unrelated/source"})),
            ("parent", Value::Null),
            ("disabled", json!(true)),
            ("permissions", json!({"pull":false})),
            ("clone_url", json!("https://elsewhere.test/owned.git")),
        ] {
            let mut f = fixture();
            f.fork[field] = value;
            assert!(
                inspect_fork_with(&mut f, &selection()).is_err(),
                "accepted {field}"
            );
        }
        let mut s = selection();
        s.fork_owner_id = "8".into();
        assert!(inspect_fork_with(&mut fixture(), &s).is_err());
    }
    #[test]
    fn forks_of_forks_require_the_same_confirmed_network_root() {
        let mut f = fixture();
        f.source["fork"] = json!(true);
        f.source["source"] = json!({"id":77,"full_name":"upstream/root"});
        f.fork["source"] = f.source["source"].clone();
        assert_eq!(
            inspect_fork_with(&mut f, &selection()).unwrap().network.id,
            "77"
        );
        f.source["source"] = Value::Null;
        assert!(inspect_fork_with(&mut f, &selection()).is_err());
    }
    #[test]
    fn stale_source_and_unknown_network_refuse_without_listing_or_writing() {
        for (field, value) in [
            ("id", json!(99)),
            ("fork", Value::Null),
            ("disabled", json!(true)),
        ] {
            let mut f = fixture();
            f.source[field] = value;
            assert!(page_with(&mut f, query()).is_err());
            assert!(!f.calls.iter().any(|c| c.contains("/forks?")));
        }
        let mut s = selection();
        s.source_repository_id = "99".into();
        assert!(inspect_fork_with(&mut fixture(), &s).is_err());
    }
    #[test]
    fn canceled_discovery_never_acquires_cli_credentials() {
        let cancellation = CancellationToken::default();
        cancellation.cancel();
        assert_eq!(
            load_hosted_fork_page(query(), &cancellation)
                .unwrap_err()
                .kind,
            "operationCancelled"
        );
        assert_eq!(
            inspect_hosted_fork(&selection(), &cancellation)
                .unwrap_err()
                .kind,
            "operationCancelled"
        );
    }
}
