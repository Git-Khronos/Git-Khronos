//! Reviewed fork requests with durable, non-replaying outcome reconciliation.
use super::hosted_repositories::{component, id, inspect_with, repository};
use super::hosting_writes::{CliTransport, Transport, encode_segment};
use super::*;
use serde_json::json;
use std::io::Read;
use std::time::{Duration, Instant};

const MAX_RECORDS: usize = 256;
const MAX_RECORD_BYTES: u64 = 262_144;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedForkRequest {
    pub source_full_name: String,
    pub source_repository_id: String,
    pub account_id: String,
    pub destination_owner: String,
    pub name: String,
    pub default_branch_only: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum HostedForkOwnerKind {
    Personal,
    Organization,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedForkOwner {
    pub id: String,
    pub login: String,
    pub kind: HostedForkOwnerKind,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedForkIntent {
    pub account: HostedAccount,
    pub source: HostedRepositoryIdentity,
    pub network: HostedRepositoryIdentity,
    pub destination: HostedForkOwner,
    pub name: String,
    pub default_branch_only: bool,
    pub forking_allowed: Option<bool>,
}
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostedForkPlan {
    pub id: String,
    pub intent: HostedForkIntent,
    #[serde(skip)]
    #[specta(skip)]
    created: Instant,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum HostedForkPhase {
    AwaitingConfirmation,
    AcceptedPending,
    MetadataAvailable,
    Ready,
    Conflict,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedForkRepository {
    pub id: String,
    pub full_name: String,
    pub owner_id: String,
    pub clone_https: Option<String>,
    pub clone_ssh: Option<String>,
    pub default_branch: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedForkStatus {
    pub id: String,
    pub phase: HostedForkPhase,
    pub intent: HostedForkIntent,
    pub server_reply_received: bool,
    pub observed_repository_id: Option<String>,
    pub repository: Option<HostedForkRepository>,
    pub head_oid: Option<String>,
    pub notice: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    version: u32,
    status: HostedForkStatus,
}

fn refused(message: &str) -> AppError {
    AppError::new(
        "hostingForkRequest",
        message,
        Some("Inspect any saved fork request before preparing another write."),
    )
}
fn storage_error() -> AppError {
    refused(
        "The saved fork request could not be read or persisted. No automatic submission retry is allowed.",
    )
}
fn random_id() -> Result<String, AppError> {
    let mut bytes = [0; 16];
    getrandom::fill(&mut bytes).map_err(|_| storage_error())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn valid_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
fn validate(request: &HostedForkRequest) -> Result<(), AppError> {
    if !component(&request.destination_owner) || !component(&request.name) {
        return Err(refused(
            "Enter a literal destination owner and repository name.",
        ));
    }
    Ok(())
}
fn owner_with(
    transport: &mut impl Transport,
    login: &str,
    actor: &HostedAccount,
) -> Result<HostedForkOwner, AppError> {
    let value = transport.get(&format!("users/{login}"))?;
    let canonical = value["login"]
        .as_str()
        .filter(|v| component(v) && v.eq_ignore_ascii_case(login))
        .ok_or_else(|| refused("The destination owner changed."))?;
    let owner_id = id(&value["id"])?;
    let kind = match value["type"].as_str() {
        Some("User") if owner_id == actor.id && canonical == actor.login => {
            HostedForkOwnerKind::Personal
        }
        Some("Organization") => HostedForkOwnerKind::Organization,
        _ => {
            return Err(refused(
                "A personal fork must belong to the acting account. Choose that account or an explicit organization.",
            ));
        }
    };
    Ok(HostedForkOwner {
        id: owner_id,
        login: canonical.into(),
        kind,
    })
}
fn intent_with(
    transport: &mut impl Transport,
    request: &HostedForkRequest,
) -> Result<HostedForkIntent, AppError> {
    validate(request)?;
    let source = inspect_with(
        transport,
        &request.source_full_name,
        &request.source_repository_id,
        &request.account_id,
    )?;
    if source.repository.full_name != request.source_full_name
        || source.repository.disabled == Some(true)
        || source.repository.can_pull == Some(false)
    {
        return Err(refused(
            "The source changed, is unavailable or does not allow forking.",
        ));
    }
    let network = super::hosted_forks::network(&source.repository)?;
    let destination = owner_with(transport, &request.destination_owner, &source.account)?;
    Ok(HostedForkIntent {
        account: source.account,
        source: HostedRepositoryIdentity {
            id: source.repository.id,
            full_name: source.repository.full_name,
        },
        network,
        destination,
        name: request.name.clone(),
        default_branch_only: request.default_branch_only,
        forking_allowed: source.repository.forking_allowed,
    })
}
fn prepare_with(
    transport: &mut impl Transport,
    request: &HostedForkRequest,
) -> Result<HostedForkPlan, AppError> {
    let intent = intent_with(transport, request)?;
    if intent.forking_allowed == Some(false) {
        return Err(refused("The source repository does not allow forking."));
    }
    Ok(HostedForkPlan {
        id: random_id()?,
        intent,
        created: Instant::now(),
    })
}
fn request_for(intent: &HostedForkIntent) -> HostedForkRequest {
    HostedForkRequest {
        source_full_name: intent.source.full_name.clone(),
        source_repository_id: intent.source.id.clone(),
        account_id: intent.account.id.clone(),
        destination_owner: intent.destination.login.clone(),
        name: intent.name.clone(),
        default_branch_only: intent.default_branch_only,
    }
}
fn same_destination(a: &HostedForkIntent, b: &HostedForkIntent) -> bool {
    a.account.id == b.account.id
        && a.account.host == b.account.host
        && a.destination.id == b.destination.id
        && a.network.id == b.network.id
        && a.name.eq_ignore_ascii_case(&b.name)
}

struct Store {
    directory: PathBuf,
    _lock: fs::File,
}
impl Drop for Store {
    fn drop(&mut self) {
        // Unlock before close: an unrelated concurrently spawned process can
        // briefly inherit the open-file description until it execs. Closing
        // only our descriptor would leave the lock held by that child.
        let _ = self._lock.unlock();
    }
}
impl Store {
    fn open(directory: &Path) -> Result<Self, AppError> {
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(directory).map_err(|_| storage_error())?;
        if !directory
            .symlink_metadata()
            .map_err(|_| storage_error())?
            .is_dir()
        {
            return Err(storage_error());
        }
        let mut options = fs::OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let lock = options
            .open(directory.join(".lock"))
            .map_err(|_| storage_error())?;
        lock.try_lock().map_err(|_| {
            refused(
                "Another fork request is using this storage. Wait for its outcome before retrying.",
            )
        })?;
        Ok(Self {
            directory: directory.into(),
            _lock: lock,
        })
    }
    fn path(&self, id: &str) -> Result<PathBuf, AppError> {
        if !valid_id(id) {
            return Err(refused("The saved fork request ID is invalid."));
        }
        Ok(self.directory.join(format!("{id}.json")))
    }
    fn read(&self, id: &str) -> Result<HostedForkStatus, AppError> {
        self.read_path(self.path(id)?, id)
    }
    fn existing(&self, id: &str) -> Result<Option<HostedForkStatus>, AppError> {
        let active = self.path(id)?;
        if active.symlink_metadata().is_ok() {
            return self.read(id).map(Some);
        }
        let archived = self.directory.join("archive").join(format!("{id}.json"));
        if archived.symlink_metadata().is_ok() {
            return self.read_path(archived, id).map(Some);
        }
        Ok(None)
    }
    fn read_path(&self, path: PathBuf, id: &str) -> Result<HostedForkStatus, AppError> {
        let metadata = path.symlink_metadata().map_err(|_| storage_error())?;
        if !metadata.is_file() || metadata.len() > MAX_RECORD_BYTES {
            return Err(storage_error());
        }
        let mut bytes = vec![];
        fs::File::open(path)
            .map_err(|_| storage_error())?
            .take(MAX_RECORD_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| storage_error())?;
        if bytes.len() as u64 > MAX_RECORD_BYTES {
            return Err(storage_error());
        }
        let journal: Journal = serde_json::from_slice(&bytes).map_err(|_| storage_error())?;
        if journal.version != 1 || journal.status.id != id {
            return Err(storage_error());
        }
        Ok(journal.status)
    }
    fn list(&self) -> Result<Vec<HostedForkStatus>, AppError> {
        let mut records = vec![];
        for entry in fs::read_dir(&self.directory).map_err(|_| storage_error())? {
            let path = entry.map_err(|_| storage_error())?.path();
            if path.extension().is_some_and(|e| e == "json") {
                if records.len() >= MAX_RECORDS {
                    return Err(refused(
                        "Too many active fork records. Review and archive completed requests.",
                    ));
                }
                let id = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .ok_or_else(storage_error)?;
                records.push(self.read(id)?);
            }
        }
        records.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(records)
    }
    fn sync_directory(&self) -> Result<(), AppError> {
        #[cfg(unix)]
        fs::File::open(&self.directory)
            .and_then(|f| f.sync_all())
            .map_err(|_| storage_error())?;
        Ok(())
    }
    fn save(&self, status: &HostedForkStatus, initial: bool) -> Result<(), AppError> {
        let target = self.path(&status.id)?;
        let path = if initial {
            target.clone()
        } else {
            self.directory.join(format!(".pending-{}", random_id()?))
        };
        let bytes = serde_json::to_vec(&Journal {
            version: 1,
            status: status.clone(),
        })
        .map_err(|_| storage_error())?;
        if bytes.len() as u64 > MAX_RECORD_BYTES {
            return Err(storage_error());
        }
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let result = (|| {
            let mut file = options.open(&path).map_err(|_| storage_error())?;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| storage_error())?;
            if !initial {
                fs::rename(&path, &target).map_err(|_| storage_error())?;
            }
            self.sync_directory()
        })();
        if !initial && result.is_err() {
            let _ = fs::remove_file(path);
        }
        result
    }
}

fn execute_with(
    directory: &Path,
    plan: &HostedForkPlan,
    transport: &mut impl Transport,
    cancellation: &CancellationToken,
) -> Result<HostedForkStatus, AppError> {
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    let store = Store::open(directory)?;
    if let Some(existing) = store.existing(&plan.id)? {
        return Ok(existing);
    }
    if plan.created.elapsed() >= Duration::from_secs(15 * 60) {
        return Err(refused("The fork review expired. Prepare a fresh preview."));
    }
    let current = intent_with(transport, &request_for(&plan.intent))?;
    if current != plan.intent || current.forking_allowed == Some(false) {
        return Err(refused(
            "The acting account, source, destination or fork policy changed.",
        ));
    }
    let records = store.list()?;
    if let Some(existing) = records
        .iter()
        .find(|r| same_destination(&r.intent, &current))
    {
        return Ok(existing.clone());
    }
    if records.len() >= MAX_RECORDS {
        return Err(refused(
            "Review and archive completed fork requests before creating another.",
        ));
    }
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    let mut status = HostedForkStatus {
        id: plan.id.clone(), phase: HostedForkPhase::AwaitingConfirmation,
        intent: current, server_reply_received: false,
        observed_repository_id: None, repository: None, head_oid: None,
        notice: Some("The request may be dispatched. Reconcile this saved record after interruption; never submit it automatically again.".into()),
    };
    // This durable record is the dispatch boundary. A crash at any later point
    // leaves an inspectable, non-replaying request, even before a reply arrives.
    store.save(&status, true)?;
    let mut payload =
        json!({"name":status.intent.name,"default_branch_only":status.intent.default_branch_only});
    if status.intent.destination.kind == HostedForkOwnerKind::Organization {
        payload["organization"] = json!(status.intent.destination.login);
    }
    let result = transport.write(
        "POST",
        &format!("repos/{}/forks", status.intent.source.full_name),
        &payload,
    );
    if result.is_ok() {
        status.server_reply_received = true;
        status.phase = HostedForkPhase::AcceptedPending;
        status.notice=Some("The provider accepted the request. Repository identity and Git references still need verification.".into());
    } else {
        status.notice=Some("The provider outcome is unconfirmed. The fork may already exist. Reconcile this saved request; do not submit it again.".into());
    }
    store.save(&status, false).map_err(|_| {
        AppError::new(
            "hostingForkUnconfirmed",
            "The dispatched request outcome could not be saved.",
            Some(&format!(
                "Reconcile saved fork request {}. Do not submit it again.",
                status.id
            )),
        )
    })?;
    Ok(status)
}

fn reconcile_with(
    directory: &Path,
    id: &str,
    transport: &mut impl Transport,
    cancellation: &CancellationToken,
) -> Result<HostedForkStatus, AppError> {
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    let store = Store::open(directory)?;
    let mut status = store.read(id)?;
    // Reconciliation only reads. Changed accounts cannot inspect and overwrite
    // another account's outcome, and no error path dispatches a POST.
    let mut current = intent_with(transport, &request_for(&status.intent))?;
    current.forking_allowed = status.intent.forking_allowed;
    if current != status.intent {
        return Err(refused(
            "The request bindings changed. Restore the reviewed account/source/destination before reconciliation.",
        ));
    }
    status.repository = None;
    status.head_oid = None;
    status.phase = if status.server_reply_received {
        HostedForkPhase::AcceptedPending
    } else {
        HostedForkPhase::AwaitingConfirmation
    };
    let full_name = format!("{}/{}", status.intent.destination.login, status.intent.name);
    let value = match transport.get(&format!("repos/{full_name}")) {
        Ok(value) => value,
        Err(error) if error.kind == "operationCancelled" => return Err(error),
        Err(_) => {
            status.notice=Some("The provider could not confirm the requested repository. It may still be pending or inaccessible; this does not prove absence.".into());
            store.save(&status, false)?;
            return Ok(status);
        }
    };
    let fork = match repository(&value) {
        Ok(fork) => fork,
        Err(_) => {
            status.notice = Some("The provider returned inconsistent repository metadata. The saved fork is not currently verified; no new request was submitted.".into());
            store.save(&status, false)?;
            return Ok(status);
        }
    };
    if fork.full_name != full_name
        || status
            .observed_repository_id
            .as_ref()
            .is_some_and(|id| id != &fork.id)
        || fork.owner_id != status.intent.destination.id
        || fork.fork != Some(true)
        || fork.source.as_ref() != Some(&status.intent.network)
        || fork.parent.as_ref().is_none_or(|p| p.id == fork.id)
        || fork.id == status.intent.source.id
        || fork.disabled == Some(true)
        || fork.can_pull == Some(false)
    {
        status.phase = HostedForkPhase::Conflict;
        status.notice=Some("The repository returned for this destination does not verify the reviewed owner, fork network or access. No local remote was changed.".into());
        store.save(&status, false)?;
        return Ok(status);
    }
    status.phase = HostedForkPhase::MetadataAvailable;
    status.observed_repository_id = Some(fork.id.clone());
    status.repository = Some(HostedForkRepository {
        id: fork.id,
        full_name: fork.full_name.clone(),
        owner_id: fork.owner_id,
        clone_https: fork.clone_https,
        clone_ssh: fork.clone_ssh,
        default_branch: fork.default_branch.clone(),
    });
    status.notice=Some("Repository metadata is verified. Git references are not yet confirmed; retry this read later.".into());
    if let Some(branch) = fork.default_branch.filter(|b| !b.is_empty()) {
        match transport.get(&format!(
            "repos/{}/git/ref/heads/{}",
            fork.full_name,
            encode_segment(&branch)
        )) {
            Ok(value)
                if value["ref"].as_str() == Some(&format!("refs/heads/{branch}"))
                    && value["object"]["type"] == "commit" =>
            {
                if let Some(oid) = value["object"]["sha"]
                    .as_str()
                    .filter(|oid| validate_commit_oid(oid).is_ok())
                {
                    match transport.get(&format!("repos/{}/git/commits/{oid}", fork.full_name)) {
                        Ok(commit)
                            if commit["sha"].as_str() == Some(oid)
                                && commit["tree"]["sha"]
                                    .as_str()
                                    .is_some_and(|tree| validate_commit_oid(tree).is_ok()) =>
                        {
                            status.phase = HostedForkPhase::Ready;
                            status.head_oid = Some(oid.into());
                            status.notice=Some("Fork identity, default-branch reference and its Git commit object are verified. Clone or remote attachment is a separate reviewed action.".into());
                        }
                        Err(error) if error.kind == "operationCancelled" => return Err(error),
                        _ => {}
                    }
                }
            }
            Err(error) if error.kind == "operationCancelled" => return Err(error),
            _ => {}
        }
    }
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    store.save(&status, false)?;
    Ok(status)
}

pub fn prepare_hosted_fork(
    request: &HostedForkRequest,
    cancellation: &CancellationToken,
) -> Result<HostedForkPlan, AppError> {
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    validate(request)?;
    prepare_with(&mut CliTransport::new(cancellation)?, request)
}
pub fn execute_hosted_fork(
    directory: &Path,
    plan: &HostedForkPlan,
    cancellation: &CancellationToken,
) -> Result<HostedForkStatus, AppError> {
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    // Restoring a saved outcome must not require credentials or dispatch again.
    {
        let store = Store::open(directory)?;
        if let Some(existing) = store.existing(&plan.id)? {
            return Ok(existing);
        }
    }
    execute_with(
        directory,
        plan,
        &mut CliTransport::new(cancellation)?,
        cancellation,
    )
}
pub fn reconcile_hosted_fork(
    directory: &Path,
    id: &str,
    cancellation: &CancellationToken,
) -> Result<HostedForkStatus, AppError> {
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    reconcile_with(
        directory,
        id,
        &mut CliTransport::new(cancellation)?,
        cancellation,
    )
}
pub fn list_hosted_fork_requests(directory: &Path) -> Result<Vec<HostedForkStatus>, AppError> {
    Store::open(directory)?.list()
}
pub fn load_hosted_fork_request(directory: &Path, id: &str) -> Result<HostedForkStatus, AppError> {
    Store::open(directory)?
        .existing(id)?
        .ok_or_else(storage_error)
}
pub fn archive_hosted_fork_request(directory: &Path, id: &str) -> Result<(), AppError> {
    archive_reviewed(directory, id, None)
}
/// Explicit local acknowledgement after reviewing an unresolved outcome. This
/// does not cancel the provider request or prove it was rejected. It retains
/// the original outcome and never submits a write; a new request needs a new
/// preview and explicit dispatch. Native callers must bind this snapshot to a
/// server-held, single-use review rather than accept an unreviewed client plan.
pub fn acknowledge_hosted_fork_request(
    directory: &Path,
    reviewed: &HostedForkStatus,
) -> Result<(), AppError> {
    archive_reviewed(directory, &reviewed.id, Some(reviewed))
}
fn archive_reviewed(
    directory: &Path,
    id: &str,
    reviewed: Option<&HostedForkStatus>,
) -> Result<(), AppError> {
    let store = Store::open(directory)?;
    let status = store.existing(id)?.ok_or_else(storage_error)?;
    if reviewed.is_some_and(|reviewed| reviewed != &status) {
        return Err(refused(
            "The saved request changed. Review its latest outcome before acknowledging it.",
        ));
    }
    if reviewed.is_none() && status.phase != HostedForkPhase::Ready {
        return Err(refused(
            "Reconcile an unresolved fork request before archiving it.",
        ));
    }
    if store.path(id)?.symlink_metadata().is_err() {
        return Ok(());
    }
    let archive = directory.join("archive");
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    if !archive.exists() {
        builder.create(&archive).map_err(|_| storage_error())?;
    }
    if !archive
        .symlink_metadata()
        .map_err(|_| storage_error())?
        .is_dir()
    {
        return Err(storage_error());
    }
    let target = archive.join(format!("{id}.json"));
    if target.symlink_metadata().is_ok() {
        let archived = store.read_path(target.clone(), id)?;
        if archived != status {
            return Err(storage_error());
        }
    } else {
        fs::hard_link(store.path(id)?, &target).map_err(|_| storage_error())?;
    }
    // Make the retained link durable before removing the active name. A crash
    // between these steps leaves one or both names, never a replayable gap.
    #[cfg(unix)]
    fs::File::open(&archive)
        .and_then(|f| f.sync_all())
        .map_err(|_| storage_error())?;
    fs::remove_file(store.path(id)?).map_err(|_| storage_error())?;
    store.sync_directory()
}

#[cfg(test)]
#[path = "hosted_fork_request_tests.rs"]
mod tests;
