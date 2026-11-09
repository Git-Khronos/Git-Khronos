//! Reviewed hosted clone plans derived from public repository metadata.
use super::hosting_writes::{CliTransport, Transport};
use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum HostedCloneTransport {
    Https,
    Ssh,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedCloneRequest {
    pub full_name: String,
    pub repository_id: String,
    pub account_id: String,
    pub transport: HostedCloneTransport,
    pub parent_path: String,
    pub folder: String,
    pub branch: Option<String>,
    pub depth: Option<u32>,
    pub recurse_submodules: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostedClonePlan {
    pub account: HostedAccount,
    pub repository: HostedRepositoryIdentity,
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
        "hostedCloneRefused",
        message,
        Some("Review a fresh hosted clone preview."),
    )
}
pub(super) fn destination(
    parent: &str,
    folder: &str,
    branch: Option<&str>,
    depth: Option<u32>,
) -> Result<(String, String), AppError> {
    let parent = Path::new(parent);
    validate_parent_directory(parent)?;
    validate_folder_name(folder)?;
    if folder.len() > 255 || folder.contains(['\0', '\r', '\n']) {
        return Err(refused("Enter a single destination folder name."));
    }
    if let Some(branch) = branch {
        if branch.len() > 1024 {
            return Err(refused("The selected branch name is too long."));
        }
        validate_branch_name(parent, branch)?;
        let output = run_git(
            parent,
            &["check-ref-format", &format!("refs/heads/{branch}")],
        )?;
        ensure_success("validate a literal clone branch", &output)?;
    }
    if depth == Some(0) {
        return Err(refused("Shallow clone depth must be at least one."));
    }
    let parent = parent
        .canonicalize()
        .map_err(|_| refused("The destination directory cannot be resolved."))?;
    let target = parent.join(folder);
    match target.symlink_metadata() {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        _ => {
            return Err(refused(
                "The destination already exists or cannot be inspected. Choose another folder.",
            ));
        }
    }
    Ok((
        parent
            .to_str()
            .ok_or_else(|| refused("The destination path cannot be represented."))?
            .into(),
        target
            .to_str()
            .ok_or_else(|| refused("The destination path cannot be represented."))?
            .into(),
    ))
}
fn url(repository: &HostedRepository, transport: HostedCloneTransport) -> Result<String, AppError> {
    if repository.disabled == Some(true) || repository.can_pull == Some(false) {
        return Err(refused(
            "The selected repository is unavailable for this account.",
        ));
    }
    match transport {
        HostedCloneTransport::Https => &repository.clone_https,
        HostedCloneTransport::Ssh => &repository.clone_ssh,
    }
    .clone()
    .ok_or_else(|| refused("The provider did not supply the selected clone transport."))
}
fn prepare_with(
    request: HostedCloneRequest,
    transport: &mut impl Transport,
) -> Result<HostedClonePlan, AppError> {
    let (parent_path, target) = destination(
        &request.parent_path,
        &request.folder,
        request.branch.as_deref(),
        request.depth,
    )?;
    let inspected = hosted_repositories::inspect_with(
        transport,
        &request.full_name,
        &request.repository_id,
        &request.account_id,
    )?;
    Ok(HostedClonePlan {
        url: url(&inspected.repository, request.transport)?,
        account: inspected.account,
        repository: HostedRepositoryIdentity {
            id: inspected.repository.id,
            full_name: inspected.repository.full_name,
        },
        transport: request.transport,
        parent_path,
        folder: request.folder,
        destination: target,
        branch: request.branch,
        depth: request.depth,
        recurse_submodules: request.recurse_submodules,
    })
}
fn revalidate_with(plan: &HostedClonePlan, transport: &mut impl Transport) -> Result<(), AppError> {
    let (parent, target) = destination(
        &plan.parent_path,
        &plan.folder,
        plan.branch.as_deref(),
        plan.depth,
    )?;
    if parent != plan.parent_path || target != plan.destination {
        return Err(refused("The clone destination changed."));
    }
    let inspected = hosted_repositories::inspect_with(
        transport,
        &plan.repository.full_name,
        &plan.repository.id,
        &plan.account.id,
    )?;
    if inspected.account != plan.account
        || inspected.repository.full_name != plan.repository.full_name
        || url(&inspected.repository, plan.transport)? != plan.url
    {
        return Err(refused(
            "The selected account, repository or clone URL changed.",
        ));
    }
    Ok(())
}

pub fn prepare_hosted_clone(
    request: HostedCloneRequest,
    cancellation: &CancellationToken,
) -> Result<HostedClonePlan, AppError> {
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    // Reject local input before asking the credential provider for an account.
    destination(
        &request.parent_path,
        &request.folder,
        request.branch.as_deref(),
        request.depth,
    )?;
    let mut transport = CliTransport::new(cancellation)?;
    git_cancellation::with(Some(cancellation), || prepare_with(request, &mut transport))
}
pub fn execute_hosted_clone(
    plan: &HostedClonePlan,
    cancellation: &CancellationToken,
) -> Result<PathBuf, AppError> {
    let mut transport = CliTransport::new(cancellation)?;
    git_cancellation::with(Some(cancellation), || {
        revalidate_with(plan, &mut transport)?;
        if cancellation.is_cancelled() {
            return Err(operation_cancelled());
        }
        // Git transport credentials remain managed by the existing authentication
        // bridge, credential helpers and SSH agent, never by a provider token URL.
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
mod tests {
    use super::*;
    use serde_json::{Value, json};
    struct Fixture {
        root: PathBuf,
        account: Value,
        repository: Value,
        calls: Vec<String>,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "owned-hosted-clone-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir(&root).unwrap();
            Self {
                root,
                account: json!({"id":7,"login":"owned-user"}),
                repository: json!({"id":11,"full_name":"team/owned","name":"owned","owner":{"login":"team","id":3},"html_url":"https://github.com/team/owned","clone_url":"https://github.com/team/owned.git","ssh_url":"git@github.com:team/owned.git","permissions":{"pull":true}}),
                calls: vec![],
            }
        }
        fn request(&self) -> HostedCloneRequest {
            HostedCloneRequest {
                full_name: "team/owned".into(),
                repository_id: "11".into(),
                account_id: "7".into(),
                transport: HostedCloneTransport::Https,
                parent_path: self.root.to_str().unwrap().into(),
                folder: "chosen destination".into(),
                branch: Some("main".into()),
                depth: Some(2),
                recurse_submodules: true,
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).unwrap();
        }
    }
    impl Transport for Fixture {
        fn get(&mut self, endpoint: &str) -> Result<Value, AppError> {
            self.calls.push(endpoint.into());
            Ok(if endpoint == "user" {
                self.account.clone()
            } else {
                self.repository.clone()
            })
        }
        fn write(&mut self, _: &'static str, _: &str, _: &Value) -> Result<Value, AppError> {
            panic!("Clone preparation must not submit provider writes")
        }
    }
    #[test]
    fn preview_is_read_only_and_captures_the_verified_transport_and_clone_options() {
        for selected in [HostedCloneTransport::Https, HostedCloneTransport::Ssh] {
            let mut fixture = Fixture::new();
            let mut request = fixture.request();
            request.transport = selected;
            let plan = prepare_with(request, &mut fixture).unwrap();
            assert_eq!(plan.account.id, "7");
            assert_eq!(plan.repository.id, "11");
            assert_eq!(plan.transport, selected);
            assert_eq!(
                plan.url,
                if selected == HostedCloneTransport::Https {
                    "https://github.com/team/owned.git"
                } else {
                    "git@github.com:team/owned.git"
                }
            );
            assert_eq!(plan.branch.as_deref(), Some("main"));
            assert_eq!(plan.depth, Some(2));
            assert!(plan.recurse_submodules);
            assert_eq!(fs::read_dir(&fixture.root).unwrap().count(), 0);
            revalidate_with(&plan, &mut fixture).unwrap();
            assert_eq!(fs::read_dir(&fixture.root).unwrap().count(), 0);
        }
    }
    #[test]
    fn changed_account_repository_name_permissions_or_url_refuses_before_any_clone_destination_exists()
     {
        for change in ["account", "login", "identity", "name", "permission", "url"] {
            let mut fixture = Fixture::new();
            let plan = prepare_with(fixture.request(), &mut fixture).unwrap();
            match change {
                "account" => fixture.account["id"] = json!(8),
                "login" => fixture.account["login"] = json!("other-login"),
                "identity" => fixture.repository["id"] = json!(99),
                "permission" => fixture.repository["permissions"]["pull"] = json!(false),
                "url" => {
                    fixture.repository["clone_url"] = json!("https://elsewhere.test/team/owned.git")
                }
                _ => {
                    fixture.repository["name"] = json!("renamed");
                    fixture.repository["full_name"] = json!("team/renamed");
                    fixture.repository["html_url"] = json!("https://github.com/team/renamed");
                    fixture.repository["clone_url"] = json!("https://github.com/team/renamed.git");
                    fixture.repository["ssh_url"] = json!("git@github.com:team/renamed.git");
                }
            }
            assert!(revalidate_with(&plan, &mut fixture).is_err(), "{change}");
            assert!(!Path::new(&plan.destination).exists());
        }
    }
    #[test]
    fn existing_destination_is_never_replaced_and_invalid_local_options_do_not_load_provider_state()
    {
        let mut fixture = Fixture::new();
        let plan = prepare_with(fixture.request(), &mut fixture).unwrap();
        fs::create_dir(&plan.destination).unwrap();
        fs::write(Path::new(&plan.destination).join("owned"), "retain").unwrap();
        fixture.calls.clear();
        assert!(revalidate_with(&plan, &mut fixture).is_err());
        assert!(fixture.calls.is_empty());
        assert_eq!(
            fs::read_to_string(Path::new(&plan.destination).join("owned")).unwrap(),
            "retain"
        );
        for change in ["folder", "branch", "depth"] {
            let mut request = fixture.request();
            request.folder = "fresh".into();
            match change {
                "folder" => request.folder = "../outside".into(),
                "branch" => request.branch = Some("@{-1}".into()),
                _ => request.depth = Some(0),
            }
            assert!(prepare_with(request, &mut fixture).is_err());
            assert!(fixture.calls.is_empty());
        }
    }
    #[test]
    fn disabled_missing_transport_and_wrong_account_do_not_prepare_a_clone() {
        for change in ["disabled", "missing", "account"] {
            let mut fixture = Fixture::new();
            let mut request = fixture.request();
            match change {
                "disabled" => fixture.repository["disabled"] = json!(true),
                "missing" => fixture.repository["clone_url"] = Value::Null,
                _ => request.account_id = "8".into(),
            }
            assert!(prepare_with(request, &mut fixture).is_err());
            assert_eq!(fs::read_dir(&fixture.root).unwrap().count(), 0);
        }
    }
    #[test]
    fn cancelled_execution_never_creates_a_destination() {
        let fixture = Fixture::new();
        let token = CancellationToken::default();
        token.cancel();
        assert_eq!(
            prepare_hosted_clone(fixture.request(), &token)
                .unwrap_err()
                .kind,
            "operationCancelled"
        );
        assert_eq!(fs::read_dir(&fixture.root).unwrap().count(), 0);
    }
}
