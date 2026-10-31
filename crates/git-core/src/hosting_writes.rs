//! Independently implemented, explicitly reviewed GitHub mutations.
//! Only documented REST endpoints are used. Never retry a dispatched write.
use super::*;
use serde_json::{Value, json};
use std::io::{Seek, SeekFrom};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum HostedReviewEvent {
    Approve,
    RequestChanges,
    Comment,
}
impl HostedReviewEvent {
    fn api(self) -> &'static str {
        match self {
            Self::Approve => "APPROVE",
            Self::RequestChanges => "REQUEST_CHANGES",
            Self::Comment => "COMMENT",
        }
    }
    fn state(self) -> &'static str {
        match self {
            Self::Approve => "APPROVED",
            Self::RequestChanges => "CHANGES_REQUESTED",
            Self::Comment => "COMMENTED",
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum HostedMergeMethod {
    Merge,
    Squash,
    Rebase,
}
impl HostedMergeMethod {
    fn api(self) -> &'static str {
        match self {
            Self::Merge => "merge",
            Self::Squash => "squash",
            Self::Rebase => "rebase",
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum HostedWriteRequest {
    CreatePull {
        #[serde(rename = "headRemote")]
        head_remote: String,
        #[serde(rename = "headBranch")]
        head_branch: String,
        #[serde(rename = "baseBranch")]
        base_branch: String,
        title: String,
        body: String,
        draft: bool,
    },
    Review {
        number: u32,
        #[serde(rename = "expectedHeadOid")]
        expected_head_oid: String,
        event: HostedReviewEvent,
        body: String,
    },
    Merge {
        number: u32,
        #[serde(rename = "expectedHeadOid")]
        expected_head_oid: String,
        method: HostedMergeMethod,
        title: String,
        body: String,
    },
}
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedWritePlan {
    pub repository: String,
    pub actor: String,
    pub actor_id: String,
    pub source_repository: Option<String>,
    pub head_oid: String,
    pub base_oid: String,
    pub base_branch: String,
    pub request: HostedWriteRequest,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostedWriteReceipt {
    pub repository: String,
    pub number: u32,
    pub url: String,
    pub actor: String,
    pub commit_oid: String,
    pub notice: Option<String>,
}

fn refused(message: &str) -> AppError {
    AppError::new("hostingWriteRefused", message, None)
}
fn stale() -> AppError {
    refused("The account, remote or commits changed. Prepare and review a fresh request.")
}
fn uncertain() -> AppError {
    AppError::new(
        "hostingWriteUncertain",
        "The provider write could not be confirmed. It may already have been applied.",
        Some(
            "Inspect the pull request on GitHub and reload its current state before preparing another submission. Do not retry this request automatically.",
        ),
    )
}
fn oid(value: &Value) -> Result<String, AppError> {
    let oid = value.as_str().unwrap_or_default();
    validate_commit_oid(oid)
        .map_err(|_| refused("The provider did not return a valid commit ID."))?;
    Ok(oid.to_owned())
}
fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}
fn body_valid(body: &str) -> bool {
    body.chars().count() <= 65_536 && !body.contains('\0')
}
fn title_valid(title: &str, required: bool) -> bool {
    (!required || !title.trim().is_empty())
        && title.chars().count() <= 256
        && !title.contains(['\0', '\n', '\r'])
}
fn validate(path: &Path, request: &HostedWriteRequest) -> Result<(), AppError> {
    match request {
        HostedWriteRequest::CreatePull {
            head_remote,
            head_branch,
            base_branch,
            title,
            body,
            ..
        } => {
            if head_remote.is_empty() || !title_valid(title, true) || !body_valid(body) {
                return Err(refused(
                    "Enter a title of at most 256 characters and a description of at most 65536 characters.",
                ));
            }
            for branch in [head_branch, base_branch] {
                validate_branch_name(path, branch)?;
                let output = run_git(path, &["check-ref-format", &format!("refs/heads/{branch}")])?;
                ensure_success("validate the pull-request branch", &output)?;
            }
        }
        HostedWriteRequest::Review {
            number,
            expected_head_oid,
            event,
            body,
        } => {
            if *number == 0
                || !body_valid(body)
                || (*event != HostedReviewEvent::Approve && body.trim().is_empty())
            {
                return Err(refused(
                    "Select a pull request and enter review text for a comment or change request.",
                ));
            }
            validate_commit_oid(expected_head_oid)?;
        }
        HostedWriteRequest::Merge {
            number,
            expected_head_oid,
            title,
            body,
            ..
        } => {
            if *number == 0 || !title_valid(title, false) || !body_valid(body) {
                return Err(refused("Select a pull request and valid merge text."));
            }
            validate_commit_oid(expected_head_oid)?;
        }
    }
    Ok(())
}
pub(crate) fn encode_segment(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
            encoded.push(char::from(byte));
        } else {
            use std::fmt::Write;
            write!(encoded, "%{byte:02X}").expect("write to String");
        }
    }
    encoded
}
pub(crate) trait Transport {
    fn get(&mut self, endpoint: &str) -> Result<Value, AppError>;
    fn write(
        &mut self,
        method: &'static str,
        endpoint: &str,
        payload: &Value,
    ) -> Result<Value, AppError>;
}

// A token snapshot binds every request in one preparation/execution to the same
// account even if the user switches gh's active account in another process.
pub(crate) struct CliTransport<'a> {
    token: String,
    cancellation: &'a CancellationToken,
}
impl<'a> CliTransport<'a> {
    pub(crate) fn new(cancellation: &'a CancellationToken) -> Result<Self, AppError> {
        let mut command = Command::new("gh");
        command
            .args(["auth", "token", "--hostname", "github.com"])
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
            .env("GH_PAGER", "cat");
        configure_process_tree(&mut command);
        let unavailable = || {
            AppError::new(
                "hostingAuthentication",
                "Could not obtain the selected GitHub CLI account.",
                Some("Authenticate with gh separately, then prepare a new request."),
            )
        };
        let (output, truncated) =
            run_cancellable_command_with_stdout_limit(command, cancellation, Some(8192)).map_err(
                |e| {
                    if e.kind == "operationCancelled" {
                        e
                    } else {
                        unavailable()
                    }
                },
            )?;
        if !output.status.success() || truncated {
            return Err(unavailable());
        }
        let token = std::str::from_utf8(&output.stdout)
            .map_err(|_| unavailable())?
            .trim()
            .to_owned();
        if token.is_empty() || !token.bytes().all(|b| b.is_ascii_graphic()) {
            return Err(unavailable());
        }
        Ok(Self {
            token,
            cancellation,
        })
    }
    fn command(&self, method: &str, endpoint: &str) -> Command {
        let mut command = hosting::api_command_for_method(endpoint, method);
        command
            .env("GH_TOKEN", &self.token)
            .env_remove("GITHUB_TOKEN");
        command
    }
}
impl Transport for CliTransport<'_> {
    fn get(&mut self, endpoint: &str) -> Result<Value, AppError> {
        hosting::request_command(self.command("GET", endpoint), self.cancellation)
    }
    fn write(
        &mut self,
        method: &'static str,
        endpoint: &str,
        payload: &Value,
    ) -> Result<Value, AppError> {
        let mut input = PrivatePayload::new(payload)?;
        let mut command = self.command(method, endpoint);
        command
            .args(["--input", "-"])
            .stdin(Stdio::from(input.reader()?));
        dispatch(command, self.cancellation)
    }
}

// The JSON is stdin, never command-line text. A private, create-new file avoids
// blocking a pipe writer before the cancellable process runner takes ownership.
struct PrivatePayload {
    directory: PathBuf,
    file: Option<fs::File>,
}
impl PrivatePayload {
    fn new(value: &Value) -> Result<Self, AppError> {
        let bytes =
            serde_json::to_vec(value).map_err(|_| refused("The request could not be encoded."))?;
        if bytes.len() > 1024 * 1024 {
            return Err(refused("The request exceeds the submission limit."));
        }
        let mut random = [0; 16];
        getrandom::fill(&mut random)
            .map_err(|_| refused("Could not allocate private request storage."))?;
        let suffix: String = random.iter().map(|b| format!("{b:02x}")).collect();
        let directory = std::env::temp_dir().join(format!("git-khronos-hosted-write-{suffix}"));
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(&directory)
            .map_err(|_| refused("Could not allocate private request storage."))?;
        let result = (|| {
            let mut options = fs::OpenOptions::new();
            options.read(true).write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(directory.join("body.json"))?;
            file.write_all(&bytes)?;
            file.seek(SeekFrom::Start(0))?;
            Ok::<_, std::io::Error>(file)
        })();
        match result {
            Ok(file) => Ok(Self {
                directory,
                file: Some(file),
            }),
            Err(_) => {
                let _ = fs::remove_dir_all(directory);
                Err(refused("Could not prepare private request storage."))
            }
        }
    }
    fn reader(&mut self) -> Result<fs::File, AppError> {
        let file = self
            .file
            .as_mut()
            .expect("private payload retains its file until drop");
        file.seek(SeekFrom::Start(0))
            .and_then(|_| file.try_clone())
            .map_err(|_| refused("Could not read private request storage."))
    }
}
impl Drop for PrivatePayload {
    fn drop(&mut self) {
        // Close before removal on Windows as well as Unix.
        drop(self.file.take());
        let _ = fs::remove_file(self.directory.join("body.json"));
        let _ = fs::remove_dir(&self.directory);
    }
}
fn dispatch(command: Command, cancellation: &CancellationToken) -> Result<Value, AppError> {
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    let (output, truncated) =
        run_cancellable_command_with_stdout_limit(command, cancellation, Some(2 * 1024 * 1024))
            .map_err(|error| {
                if error.kind == "gitUnavailable" {
                    refused("The GitHub CLI could not be started. No request was submitted.")
                } else {
                    uncertain()
                }
            })?;
    if !output.status.success() || truncated {
        return Err(uncertain());
    }
    serde_json::from_slice(&output.stdout).map_err(|_| uncertain())
}
fn branch_oid(
    transport: &mut impl Transport,
    repository: &str,
    branch: &str,
) -> Result<String, AppError> {
    let value = transport.get(&format!(
        "repos/{repository}/branches/{}",
        encode_segment(branch)
    ))?;
    if text(&value, "name") != branch {
        return Err(stale());
    }
    oid(&value["commit"]["sha"])
}
fn local_branch_oid(path: &Path, branch: &str) -> Result<String, AppError> {
    let local = run_git(
        path,
        &[
            "show-ref",
            "--verify",
            "--hash",
            &format!("refs/heads/{branch}"),
        ],
    )?;
    ensure_success("inspect the local pull-request branch", &local)?;
    let local = String::from_utf8_lossy(&local.stdout).trim().to_owned();
    validate_commit_oid(&local)?;
    Ok(local)
}
fn verify_local_bindings(
    path: &Path,
    remote: &str,
    plan: &HostedWritePlan,
) -> Result<(), AppError> {
    if hosting::repository_for_remote(path, remote)? != plan.repository {
        return Err(stale());
    }
    if let HostedWriteRequest::CreatePull {
        head_remote,
        head_branch,
        ..
    } = &plan.request
        && (Some(hosting::repository_for_remote(path, head_remote)?) != plan.source_repository
            || local_branch_oid(path, head_branch)? != plan.head_oid)
    {
        return Err(stale());
    }
    Ok(())
}
fn prepare_with(
    path: &Path,
    remote: &str,
    request: HostedWriteRequest,
    transport: &mut impl Transport,
) -> Result<HostedWritePlan, AppError> {
    validate(path, &request)?;
    let repository = hosting::repository_for_remote(path, remote)?;
    let account = transport.get("user")?;
    let actor = text(&account, "login");
    let actor_id = account["id"]
        .as_u64()
        .filter(|id| *id > 0)
        .map(|id| id.to_string())
        .ok_or_else(|| refused("The authenticated GitHub account ID could not be identified."))?;
    if actor.is_empty() || actor.len() > 256 || actor.chars().any(char::is_control) {
        return Err(refused(
            "The authenticated GitHub account could not be identified.",
        ));
    }
    let (source_repository, head_oid, base_oid, base_branch) = match &request {
        HostedWriteRequest::CreatePull {
            head_remote,
            head_branch,
            base_branch,
            ..
        } => {
            let source = hosting::repository_for_remote(path, head_remote)?;
            if source.eq_ignore_ascii_case(&repository) && head_branch == base_branch {
                return Err(refused("Choose different source and destination branches."));
            }
            let local = local_branch_oid(path, head_branch)?;
            let head = branch_oid(transport, &source, head_branch)?;
            if head != local {
                return Err(refused(
                    "The remote source branch differs from the local branch. Push the intended commit, then prepare again.",
                ));
            }
            let base = branch_oid(transport, &repository, base_branch)?;
            (Some(source), head, base, base_branch.clone())
        }
        HostedWriteRequest::Review {
            number,
            expected_head_oid,
            ..
        }
        | HostedWriteRequest::Merge {
            number,
            expected_head_oid,
            ..
        } => {
            let pull = transport.get(&format!("repos/{repository}/pulls/{number}"))?;
            if text(&pull, "state") != "open" || pull["merged"].as_bool() == Some(true) {
                return Err(refused("This pull request is no longer open."));
            }
            if !text(&pull["base"]["repo"], "full_name").eq_ignore_ascii_case(&repository) {
                return Err(stale());
            }
            let head = oid(&pull["head"]["sha"])?;
            if &head != expected_head_oid {
                return Err(stale());
            }
            if matches!(request, HostedWriteRequest::Merge { .. })
                && (pull["draft"].as_bool() != Some(false)
                    || pull["mergeable"].as_bool() != Some(true))
            {
                return Err(refused(
                    "The provider has not confirmed that this open, non-draft pull request can merge. Reload its current state.",
                ));
            }
            let base_branch = text(&pull["base"], "ref");
            if base_branch.is_empty() {
                return Err(refused(
                    "The provider did not identify the destination branch.",
                ));
            }
            (None, head, oid(&pull["base"]["sha"])?, base_branch)
        }
    };
    if hosting::repository_for_remote(path, remote)? != repository {
        return Err(stale());
    }
    let plan = HostedWritePlan {
        repository,
        actor,
        actor_id,
        source_repository,
        head_oid,
        base_oid,
        base_branch,
        request,
    };
    verify_local_bindings(path, remote, &plan)?;
    Ok(plan)
}

pub fn prepare_hosted_write(
    path: &Path,
    remote: &str,
    request: HostedWriteRequest,
    cancellation: &CancellationToken,
) -> Result<HostedWritePlan, AppError> {
    validate(path, &request)?;
    prepare_with(path, remote, request, &mut CliTransport::new(cancellation)?)
}
fn execute_with(
    path: &Path,
    remote: &str,
    plan: &HostedWritePlan,
    transport: &mut impl Transport,
) -> Result<HostedWriteReceipt, AppError> {
    verify_local_bindings(path, remote, plan)?;
    if prepare_with(path, remote, plan.request.clone(), transport)? != *plan {
        return Err(stale());
    }
    let prefix = format!("repos/{}/pulls", plan.repository);
    let (method, endpoint, payload, number) = match &plan.request {
        HostedWriteRequest::CreatePull {
            head_branch,
            base_branch,
            title,
            body,
            draft,
            ..
        } => {
            let (owner, name) = plan
                .source_repository
                .as_ref()
                .and_then(|r| r.split_once('/'))
                .ok_or_else(stale)?;
            (
                "POST",
                prefix,
                json!({"head":format!("{owner}:{head_branch}"),"head_repo":name,"base":base_branch,"title":title,"body":body,"draft":draft}),
                None,
            )
        }
        HostedWriteRequest::Review {
            number,
            event,
            body,
            ..
        } => (
            "POST",
            format!("{prefix}/{number}/reviews"),
            json!({"commit_id":plan.head_oid,"event":event.api(),"body":body}),
            Some(*number),
        ),
        HostedWriteRequest::Merge {
            number,
            method,
            title,
            body,
            ..
        } => {
            let mut payload = json!({"sha":plan.head_oid,"merge_method":method.api()});
            if !title.is_empty() {
                payload["commit_title"] = json!(title);
            }
            if !body.is_empty() {
                payload["commit_message"] = json!(body);
            }
            (
                "PUT",
                format!("{prefix}/{number}/merge"),
                payload,
                Some(*number),
            )
        }
    };
    verify_local_bindings(path, remote, plan)?;
    let value = transport.write(method, &endpoint, &payload)?;
    let number = number
        .or_else(|| {
            value["number"]
                .as_u64()
                .and_then(|n| u32::try_from(n).ok())
                .filter(|n| *n > 0)
        })
        .ok_or_else(uncertain)?;
    let mut notice = None;
    let (actor, actor_id, commit_oid) = match &plan.request {
        HostedWriteRequest::CreatePull {
            head_branch,
            base_branch,
            ..
        } => {
            if text(&value["head"], "ref") != *head_branch
                || text(&value["base"], "ref") != *base_branch
                || !text(&value["base"]["repo"], "full_name").eq_ignore_ascii_case(&plan.repository)
                || !plan.source_repository.as_ref().is_some_and(|source| {
                    text(&value["head"]["repo"], "full_name").eq_ignore_ascii_case(source)
                })
            {
                return Err(uncertain());
            }
            let actual = oid(&value["head"]["sha"]).map_err(|_| uncertain())?;
            if actual != plan.head_oid {
                notice = Some("The pull request was created, but its source moved during submission. Review the current change before continuing.".into());
            }
            let actual_base = oid(&value["base"]["sha"]).map_err(|_| uncertain())?;
            if actual_base != plan.base_oid {
                let message = "The destination advanced during creation. Review the current comparison before continuing.";
                notice = Some(
                    notice.map_or_else(|| message.to_owned(), |prior| format!("{prior} {message}")),
                );
            }
            (
                text(&value["user"], "login"),
                value["user"]["id"]
                    .as_u64()
                    .map(|id| id.to_string())
                    .unwrap_or_default(),
                actual,
            )
        }
        HostedWriteRequest::Review { event, .. } => {
            if value["id"].as_u64().is_none_or(|id| id == 0)
                || text(&value, "state") != event.state()
                || text(&value, "commit_id") != plan.head_oid
            {
                return Err(uncertain());
            }
            (
                text(&value["user"], "login"),
                value["user"]["id"]
                    .as_u64()
                    .map(|id| id.to_string())
                    .unwrap_or_default(),
                plan.head_oid.clone(),
            )
        }
        HostedWriteRequest::Merge { .. } => {
            if value["merged"].as_bool() != Some(true) {
                return Err(uncertain());
            }
            (
                plan.actor.clone(),
                plan.actor_id.clone(),
                oid(&value["sha"]).map_err(|_| uncertain())?,
            )
        }
    };
    if actor_id != plan.actor_id || !actor.eq_ignore_ascii_case(&plan.actor) {
        let message = "The provider reported a different or unavailable submitting identity. Inspect the result before taking another action.";
        notice =
            Some(notice.map_or_else(|| message.to_owned(), |prior| format!("{prior} {message}")));
    }
    Ok(HostedWriteReceipt {
        repository: plan.repository.clone(),
        number,
        url: format!("https://github.com/{}/pull/{number}", plan.repository),
        actor,
        commit_oid,
        notice,
    })
}
pub fn execute_hosted_write(
    path: &Path,
    remote: &str,
    plan: &HostedWritePlan,
    cancellation: &CancellationToken,
) -> Result<HostedWriteReceipt, AppError> {
    validate(path, &plan.request)?;
    execute_with(path, remote, plan, &mut CliTransport::new(cancellation)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BRANCH: &str = "feature/slash+percent%";
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let mut bytes = [0; 16];
            getrandom::fill(&mut bytes).unwrap();
            let name: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
            let fixture = Self(std::env::temp_dir().join(format!("khronos-hosted-fixture-{name}")));
            fs::create_dir(&fixture.0).unwrap();
            fixture.git(&["init", "--template=", "-q", "-b", "main"]);
            fs::create_dir(fixture.0.join("owned-hooks")).unwrap();
            fixture.git(&[
                "config",
                "core.hooksPath",
                fixture.0.join("owned-hooks").to_str().unwrap(),
            ]);
            fixture.git(&["config", "core.fsmonitor", "false"]);
            fixture.git(&["config", "user.name", "Owned fixture"]);
            fixture.git(&["config", "user.email", "owned@example.test"]);
            fixture.git(&["config", "commit.gpgsign", "false"]);
            fs::write(fixture.0.join("file.txt"), "base\n").unwrap();
            fixture.git(&["add", "file.txt"]);
            fixture.git(&["commit", "-qm", "Owned base"]);
            fixture.git(&["branch", BRANCH]);
            fixture.git(&[
                "remote",
                "add",
                "origin",
                "https://github.com/team/upstream.git",
            ]);
            fixture.git(&["remote", "add", "fork", "git@github.com:person/fork.git"]);
            fixture
        }
        fn git(&self, args: &[&str]) -> String {
            let output = run_git(&self.0, args).unwrap();
            assert!(
                output.status.success(),
                "Git fixture failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8(output.stdout).unwrap().trim().to_owned()
        }
        fn transport(&self) -> OwnedTransport {
            OwnedTransport {
                actor: "owned-author".into(),
                actor_id: 501,
                head: self.git(&["rev-parse", "HEAD"]),
                base: "b".repeat(40),
                reads: Vec::new(),
                writes: Vec::new(),
                response: json!({}),
                state: "open".into(),
                draft: json!(false),
                mergeable: json!(true),
                alter_source_after_read: None,
            }
        }
        fn state(&self) -> (String, Vec<u8>, Vec<u8>) {
            (
                self.git(&["show-ref"]),
                fs::read(self.0.join(".git/index")).unwrap(),
                fs::read(self.0.join("file.txt")).unwrap(),
            )
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    struct OwnedTransport {
        actor: String,
        actor_id: u64,
        head: String,
        base: String,
        reads: Vec<String>,
        writes: Vec<(String, String, Value)>,
        response: Value,
        state: String,
        draft: Value,
        mergeable: Value,
        alter_source_after_read: Option<PathBuf>,
    }
    impl OwnedTransport {
        fn created(&self) -> Value {
            json!({"number":17,"user":{"login":self.actor,"id":self.actor_id},"head":{"sha":self.head,"ref":BRANCH,"repo":{"full_name":"person/fork"}},"base":{"ref":"main","sha":self.base,"repo":{"full_name":"team/upstream"}},"html_url":"https://untrusted.example/never-open"})
        }
    }
    impl Transport for OwnedTransport {
        fn get(&mut self, endpoint: &str) -> Result<Value, AppError> {
            self.reads.push(endpoint.to_owned());
            match endpoint {
                "user" => Ok(json!({"login":self.actor,"id":self.actor_id})),
                "repos/person/fork/branches/feature%2Fslash%2Bpercent%25" => {
                    Ok(json!({"name":BRANCH,"commit":{"sha":self.head}}))
                }
                "repos/team/upstream/branches/main" => {
                    if let Some(path) = self.alter_source_after_read.take() {
                        run_mutation(
                            &path,
                            &[
                                "remote",
                                "set-url",
                                "fork",
                                "https://github.com/other/changed.git",
                            ],
                            "change owned fixture remote",
                        )
                        .unwrap();
                    }
                    Ok(json!({"name":"main","commit":{"sha":self.base}}))
                }
                "repos/team/upstream/pulls/7" => Ok(
                    json!({"state":self.state,"merged":false,"draft":self.draft,"mergeable":self.mergeable,"head":{"sha":self.head},"base":{"sha":self.base,"ref":"main","repo":{"full_name":"team/upstream"}}}),
                ),
                _ => panic!("Unowned fixture endpoint: {endpoint}"),
            }
        }
        fn write(
            &mut self,
            method: &'static str,
            endpoint: &str,
            payload: &Value,
        ) -> Result<Value, AppError> {
            self.writes
                .push((method.into(), endpoint.into(), payload.clone()));
            Ok(self.response.clone())
        }
    }
    fn create() -> HostedWriteRequest {
        HostedWriteRequest::CreatePull {
            head_remote: "fork".into(),
            head_branch: BRANCH.into(),
            base_branch: "main".into(),
            title: "Literal $(do-not-run)".into(),
            body: "Original fixture\nsecond line".into(),
            draft: true,
        }
    }
    fn review(head: &str, event: HostedReviewEvent) -> HostedWriteRequest {
        HostedWriteRequest::Review {
            number: 7,
            expected_head_oid: head.into(),
            event,
            body: "Owned review text".into(),
        }
    }
    fn merge(head: &str, method: HostedMergeMethod) -> HostedWriteRequest {
        HostedWriteRequest::Merge {
            number: 7,
            expected_head_oid: head.into(),
            method,
            title: String::new(),
            body: String::new(),
        }
    }

    #[test]
    fn fork_creation_previews_and_submits_exact_fields_without_changing_local_git() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("file.txt"), "dirty contents must remain\n").unwrap();
        let before = fixture.state();
        let mut transport = fixture.transport();
        let plan = prepare_with(&fixture.0, "origin", create(), &mut transport).unwrap();
        assert!(transport.writes.is_empty());
        assert_eq!(plan.source_repository.as_deref(), Some("person/fork"));
        assert_eq!(plan.actor, "owned-author");
        transport.response = transport.created();
        let receipt = execute_with(&fixture.0, "origin", &plan, &mut transport).unwrap();
        assert_eq!(
            transport.writes,
            [(
                "POST".into(),
                "repos/team/upstream/pulls".into(),
                json!({"head":format!("person:{BRANCH}"),"head_repo":"fork","base":"main","title":"Literal $(do-not-run)","body":"Original fixture\nsecond line","draft":true})
            )]
        );
        assert_eq!(receipt.url, "https://github.com/team/upstream/pull/17");
        assert_eq!(receipt.commit_oid, transport.head);
        assert!(receipt.notice.is_none());
        assert_eq!(fixture.state(), before);
    }
    #[test]
    fn changed_account_commits_or_remotes_refuse_before_any_write() {
        for change in [
            "account",
            "account-id",
            "head",
            "base",
            "target-remote",
            "source-remote",
            "local-branch",
        ] {
            let fixture = Fixture::new();
            let mut transport = fixture.transport();
            let plan = prepare_with(&fixture.0, "origin", create(), &mut transport).unwrap();
            match change {
                "account" => transport.actor = "another-author".into(),
                "account-id" => transport.actor_id = 999,
                "head" => transport.head = "c".repeat(40),
                "base" => transport.base = "c".repeat(40),
                "target-remote" => {
                    fixture.git(&[
                        "remote",
                        "set-url",
                        "origin",
                        "https://github.com/team/changed.git",
                    ]);
                }
                "source-remote" => {
                    fixture.git(&[
                        "remote",
                        "set-url",
                        "fork",
                        "https://github.com/team/changed.git",
                    ]);
                }
                "local-branch" => {
                    fixture.git(&["commit", "--allow-empty", "-qm", "Concurrent commit"]);
                    fixture.git(&["branch", "-f", BRANCH, "HEAD"]);
                }
                _ => unreachable!(),
            }
            let before = fixture.state();
            assert!(
                execute_with(&fixture.0, "origin", &plan, &mut transport).is_err(),
                "{change}"
            );
            assert!(transport.writes.is_empty(), "{change}");
            assert_eq!(fixture.state(), before);
        }
    }
    #[test]
    fn a_source_remote_changed_during_preflight_invalidates_the_plan() {
        let fixture = Fixture::new();
        let mut transport = fixture.transport();
        transport.alter_source_after_read = Some(fixture.0.clone());
        assert!(prepare_with(&fixture.0, "origin", create(), &mut transport).is_err());
        assert!(transport.writes.is_empty());
    }
    #[test]
    fn each_review_decision_is_explicit_and_targets_the_reviewed_commit() {
        for event in [
            HostedReviewEvent::Approve,
            HostedReviewEvent::RequestChanges,
            HostedReviewEvent::Comment,
        ] {
            let fixture = Fixture::new();
            let before = fixture.state();
            let mut transport = fixture.transport();
            let request = review(&transport.head, event);
            let plan = prepare_with(&fixture.0, "origin", request, &mut transport).unwrap();
            transport.response = json!({"id":55,"user":{"login":transport.actor,"id":transport.actor_id},"commit_id":transport.head,"state":event.state()});
            let receipt = execute_with(&fixture.0, "origin", &plan, &mut transport).unwrap();
            assert_eq!(
                transport.writes,
                [(
                    "POST".into(),
                    "repos/team/upstream/pulls/7/reviews".into(),
                    json!({"commit_id":transport.head,"event":event.api(),"body":"Owned review text"})
                )]
            );
            assert_eq!(receipt.commit_oid, transport.head);
            assert_eq!(fixture.state(), before);
        }
    }
    #[test]
    fn every_merge_method_sends_the_provider_head_precondition_without_bypass_flags() {
        for method in [
            HostedMergeMethod::Merge,
            HostedMergeMethod::Squash,
            HostedMergeMethod::Rebase,
        ] {
            let fixture = Fixture::new();
            let before = fixture.state();
            let mut transport = fixture.transport();
            let request = merge(&transport.head, method);
            let plan = prepare_with(&fixture.0, "origin", request, &mut transport).unwrap();
            transport.response = json!({"merged":true,"sha":"c".repeat(40)});
            let receipt = execute_with(&fixture.0, "origin", &plan, &mut transport).unwrap();
            assert_eq!(
                transport.writes,
                [(
                    "PUT".into(),
                    "repos/team/upstream/pulls/7/merge".into(),
                    json!({"sha":transport.head,"merge_method":method.api()})
                )]
            );
            assert_eq!(receipt.commit_oid, "c".repeat(40));
            assert_eq!(fixture.state(), before);
        }
    }
    #[test]
    fn closed_draft_unknown_mergeability_and_changed_heads_never_submit() {
        for change in ["closed", "draft", "unknown", "conflict", "stale"] {
            let fixture = Fixture::new();
            let mut transport = fixture.transport();
            let request = merge(&transport.head, HostedMergeMethod::Merge);
            match change {
                "closed" => transport.state = "closed".into(),
                "draft" => transport.draft = json!(true),
                "unknown" => transport.mergeable = Value::Null,
                "conflict" => transport.mergeable = json!(false),
                "stale" => transport.head = "d".repeat(40),
                _ => unreachable!(),
            }
            assert!(
                prepare_with(&fixture.0, "origin", request, &mut transport).is_err(),
                "{change}"
            );
            assert!(transport.writes.is_empty());
        }
    }
    #[test]
    fn malformed_inputs_are_refused_before_provider_reads() {
        let fixture = Fixture::new();
        let mut transport = fixture.transport();
        for request in [
            HostedWriteRequest::Review {
                number: 0,
                expected_head_oid: transport.head.clone(),
                event: HostedReviewEvent::Approve,
                body: String::new(),
            },
            HostedWriteRequest::Review {
                number: 7,
                expected_head_oid: transport.head.clone(),
                event: HostedReviewEvent::Comment,
                body: String::new(),
            },
            HostedWriteRequest::Merge {
                number: 7,
                expected_head_oid: "bad".into(),
                method: HostedMergeMethod::Merge,
                title: String::new(),
                body: String::new(),
            },
            HostedWriteRequest::CreatePull {
                title: String::new(),
                head_remote: "fork".into(),
                head_branch: BRANCH.into(),
                base_branch: "main".into(),
                body: String::new(),
                draft: false,
            },
        ] {
            assert!(prepare_with(&fixture.0, "origin", request, &mut transport).is_err());
        }
        assert!(transport.reads.is_empty() && transport.writes.is_empty());
    }
    #[test]
    fn unconfirmed_reviews_and_merges_are_uncertain_and_never_replayed() {
        let fixture = Fixture::new();
        let mut transport = fixture.transport();
        let request = review(&transport.head, HostedReviewEvent::Approve);
        let plan = prepare_with(&fixture.0, "origin", request, &mut transport).unwrap();
        for response in [
            json!({}),
            json!({"id":42,"commit_id":transport.head,"state":"PENDING"}),
            json!({"id":42,"commit_id":"e".repeat(40),"state":"APPROVED"}),
        ] {
            transport.response = response;
            let count = transport.writes.len();
            assert_eq!(
                execute_with(&fixture.0, "origin", &plan, &mut transport)
                    .unwrap_err()
                    .kind,
                "hostingWriteUncertain"
            );
            assert_eq!(transport.writes.len(), count + 1);
        }
        let request = merge(&transport.head, HostedMergeMethod::Merge);
        let plan = prepare_with(&fixture.0, "origin", request, &mut transport).unwrap();
        transport.response = json!({"merged":false,"sha":"e".repeat(40)});
        let count = transport.writes.len();
        assert_eq!(
            execute_with(&fixture.0, "origin", &plan, &mut transport)
                .unwrap_err()
                .kind,
            "hostingWriteUncertain"
        );
        assert_eq!(transport.writes.len(), count + 1);
    }
    #[test]
    fn a_creation_race_reports_the_created_record_and_actual_head() {
        let fixture = Fixture::new();
        let mut transport = fixture.transport();
        let plan = prepare_with(&fixture.0, "origin", create(), &mut transport).unwrap();
        transport.response = transport.created();
        transport.response["head"]["sha"] = json!("f".repeat(40));
        transport.response["base"]["sha"] = json!("e".repeat(40));
        transport.response["user"]["login"] = json!("reported-renamed-account");
        let receipt = execute_with(&fixture.0, "origin", &plan, &mut transport).unwrap();
        assert_eq!(receipt.number, 17);
        assert_eq!(receipt.commit_oid, "f".repeat(40));
        let notice = receipt.notice.unwrap();
        assert!(
            notice.contains("moved")
                && notice.contains("destination advanced")
                && notice.contains("identity")
        );
    }
    #[test]
    fn request_content_is_private_stdin_and_pinned_credentials_are_not_arguments() {
        let token = CancellationToken::default();
        let transport = CliTransport {
            token: "owned-fixture-token".into(),
            cancellation: &token,
        };
        let command = transport.command("POST", "repos/team/upstream/pulls");
        let args: Vec<_> = command
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            &args[..5],
            ["api", "--hostname", "github.com", "--method", "POST"]
        );
        assert!(!args.iter().any(|a| a.contains("owned-fixture-token")));
        assert!(command.get_envs().any(
            |(k, v)| k == "GH_TOKEN" && v == Some(std::ffi::OsStr::new("owned-fixture-token"))
        ));
        let value = json!({"body":"literal $(do-not-run)\nprivate text"});
        let mut payload = PrivatePayload::new(&value).unwrap();
        let path = payload.directory.clone();
        let mut contents = String::new();
        payload
            .reader()
            .unwrap()
            .read_to_string(&mut contents)
            .unwrap();
        assert_eq!(serde_json::from_str::<Value>(&contents).unwrap(), value);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(path.join("body.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        drop(payload);
        assert!(!path.exists());
    }
    #[cfg(unix)]
    #[test]
    fn dispatched_cli_failures_are_unknown_but_pre_cancelled_requests_do_not_start() {
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
        for script in [
            "printf 'private diagnostic' >&2; exit 1",
            "printf 'not-json'",
            "head -c 2100000 /dev/zero",
        ] {
            let error = dispatch(owned(script), &CancellationToken::default()).unwrap_err();
            assert_eq!(error.kind, "hostingWriteUncertain");
            assert!(!error.to_string().contains("private diagnostic"));
        }
        let token = CancellationToken::default();
        token.cancel();
        assert_eq!(
            dispatch(owned("exit 99"), &token).unwrap_err().kind,
            "operationCancelled"
        );
        let token = CancellationToken::default();
        let cancel = token.clone();
        let worker = thread::spawn(move || {
            thread::sleep(Duration::from_millis(150));
            cancel.cancel();
        });
        let before = std::time::Instant::now();
        let error = dispatch(owned("sleep 30"), &token).unwrap_err();
        worker.join().unwrap();
        assert_eq!(error.kind, "hostingWriteUncertain");
        assert!(before.elapsed() < Duration::from_secs(3));
    }
}
