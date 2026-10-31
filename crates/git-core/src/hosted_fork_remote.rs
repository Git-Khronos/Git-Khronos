//! Explicit local attachment of a freshly verified fork. No provider writes.
use super::hosted_forks::inspect_fork_with;
use super::hosting_writes::{CliTransport, Transport};
use super::*;
use std::time::{Instant, SystemTime};

#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedForkRemoteRequest {
    pub source_remote: String,
    pub selection: HostedForkSelection,
    pub remote_name: String,
    pub transport: HostedCloneTransport,
}

// Effective configuration can contain credentials. Keep its exact comparison
// bytes in native memory only, outside serialization, debugging and journals.
#[derive(Clone, PartialEq, Eq)]
struct Snapshot {
    repository: PathBuf,
    git_dir: PathBuf,
    common_dir: PathBuf,
    git_dir_created: Option<SystemTime>,
    #[cfg(unix)]
    git_dir_identity: (u64, u64),
    config: Vec<u8>,
    local_entries: Vec<u8>,
    effective: Vec<u8>,
}

#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostedForkRemotePlan {
    pub repository_path: String,
    pub account: HostedAccount,
    pub source: HostedRepositoryIdentity,
    pub network: HostedRepositoryIdentity,
    pub fork: HostedRepositoryIdentity,
    pub fork_owner_id: String,
    pub source_remote: String,
    pub remote_name: String,
    pub transport: HostedCloneTransport,
    pub url: String,
    pub fetch_refspec: String,
    pub existing_remote_names: Vec<String>,
    #[serde(skip)]
    #[specta(skip)]
    snapshot: Snapshot,
    #[serde(skip)]
    #[specta(skip)]
    request: HostedForkRemoteRequest,
    #[serde(skip)]
    #[specta(skip)]
    created: Instant,
}
impl std::fmt::Debug for HostedForkRemotePlan {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HostedForkRemotePlan")
            .field("repository_path", &self.repository_path)
            .field("remote_name", &self.remote_name)
            .field("fork", &self.fork)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostedForkRemoteReceipt {
    pub remote_name: String,
    pub url: String,
    pub source_remote: String,
    pub fork: HostedRepositoryIdentity,
}

fn refused(message: &str) -> AppError {
    AppError::new(
        "hostedForkRemoteRefused",
        message,
        Some(
            "Inspect the current remotes and review a fresh attachment. No provider request is retried.",
        ),
    )
}
fn git_bytes(path: &Path, args: &[&str]) -> Result<Vec<u8>, AppError> {
    let output = run_git(path, args)?;
    // Do not propagate config diagnostics, which can include private values.
    if !output.status.success() {
        return Err(refused(
            "Git could not inspect the attachment configuration.",
        ));
    }
    if output.stdout.len() > 4 * 1024 * 1024 {
        return Err(refused(
            "The configuration is too large for a reviewed attachment.",
        ));
    }
    Ok(output.stdout)
}
fn git_directory(path: &Path, option: &str) -> Result<PathBuf, AppError> {
    let bytes = git_bytes(path, &["rev-parse", "--path-format=absolute", option])?;
    let value = std::str::from_utf8(&bytes)
        .map_err(|_| refused("The Git metadata path is not representable."))?;
    Path::new(value.trim_end_matches('\n'))
        .canonicalize()
        .map_err(|_| refused("The Git metadata directory cannot be resolved."))
}
fn config_path(snapshot: &Snapshot) -> PathBuf {
    snapshot.common_dir.join("config")
}
fn config_entries(path: &Path, file: &Path) -> Result<Vec<u8>, AppError> {
    let file = file
        .to_str()
        .ok_or_else(|| refused("The configuration path is not representable."))?;
    git_bytes(
        path,
        &["config", "--file", file, "--includes", "--null", "--list"],
    )
}
fn snapshot(path: &Path) -> Result<Snapshot, AppError> {
    let repository = path
        .canonicalize()
        .map_err(|_| refused("The repository path cannot be resolved."))?;
    let git_dir = git_directory(&repository, "--git-dir")?;
    let common_dir = git_directory(&repository, "--git-common-dir")?;
    let metadata =
        fs::metadata(&git_dir).map_err(|_| refused("Git metadata cannot be inspected."))?;
    let config = common_dir.join("config");
    let file = fs::symlink_metadata(&config)
        .map_err(|_| refused("The local configuration cannot be inspected."))?;
    if !file.is_file() || file.len() > 4 * 1024 * 1024 {
        return Err(refused(
            "Reviewed attachment requires a regular, bounded local configuration file.",
        ));
    }
    let bytes =
        fs::read(&config).map_err(|_| refused("The local configuration cannot be read."))?;
    Ok(Snapshot {
        git_dir_created: metadata.created().ok(),
        #[cfg(unix)]
        git_dir_identity: {
            use std::os::unix::fs::MetadataExt;
            (metadata.dev(), metadata.ino())
        },
        config: bytes,
        local_entries: config_entries(&repository, &config)?,
        effective: git_bytes(
            &repository,
            &[
                "config",
                "--includes",
                "--show-origin",
                "--show-scope",
                "--null",
                "--list",
            ],
        )?,
        repository,
        git_dir,
        common_dir,
    })
}
fn local_bindings(path: &Path, request: &HostedForkRemoteRequest) -> Result<Vec<String>, AppError> {
    validate_remote_name(path, &request.remote_name)?;
    validate_remote_name(path, &request.source_remote)?;
    if request.remote_name.len() > 128 {
        return Err(refused("Use a remote name of at most 128 bytes."));
    }
    let names: Vec<String> = read_remotes(path)?
        .into_iter()
        .map(|remote| remote.name)
        .collect();
    if names.contains(&request.remote_name) {
        return Err(refused("That remote name is already configured."));
    }
    if hosting::repository_for_remote(path, &request.source_remote)?
        != request.selection.source_full_name
    {
        return Err(refused(
            "The selected source remote does not identify the reviewed source repository.",
        ));
    }
    let urls = git_bytes(
        path,
        &["remote", "get-url", "--all", &request.source_remote],
    )?;
    if urls
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
        .count()
        != 1
    {
        return Err(refused(
            "Select a source remote with one unambiguous fetch URL.",
        ));
    }
    Ok(names)
}
fn prepare_with(
    path: &Path,
    request: &HostedForkRemoteRequest,
    provider: &mut impl Transport,
) -> Result<HostedForkRemotePlan, AppError> {
    let before = snapshot(path)?;
    let names = local_bindings(path, request)?;
    let checked = inspect_fork_with(provider, &request.selection)?;
    let url = match request.transport {
        HostedCloneTransport::Https => checked.repository.clone_https,
        HostedCloneTransport::Ssh => checked.repository.clone_ssh,
    }
    .ok_or_else(|| refused("The fork does not provide that clone transport."))?;
    // An existing insteadOf/pushInsteadOf rule must not silently redirect this
    // provider-bound attachment. A separate explicit remote edit remains usable.
    let setting = format!("remote.{}.url={url}", request.remote_name);
    // `remote get-url` requires a persisted remote, whereas the verbose list
    // evaluates this command-scoped candidate without writing configuration.
    let listing = git_bytes(path, &["-c", &setting, "remote", "-v"])?;
    let prefix = format!("{}\t", request.remote_name);
    let candidate: Vec<&[u8]> = listing
        .split(|byte| *byte == b'\n')
        .filter(|line| line.starts_with(prefix.as_bytes()))
        .collect();
    let fetch = format!("{}{url} (fetch)", prefix);
    let push = format!("{}{url} (push)", prefix);
    if candidate != [fetch.as_bytes(), push.as_bytes()] {
        return Err(refused(
            "Git URL rewrite rules redirect this fork transport. Review those rules or configure the remote explicitly.",
        ));
    }
    if snapshot(path)? != before {
        return Err(refused(
            "The repository or configuration changed during inspection.",
        ));
    }
    Ok(HostedForkRemotePlan {
        repository_path: before
            .repository
            .to_str()
            .ok_or_else(|| refused("The repository path is not representable."))?
            .into(),
        account: checked.account,
        source: checked.source,
        network: checked.network,
        fork: HostedRepositoryIdentity {
            id: checked.repository.id,
            full_name: checked.repository.full_name,
        },
        fork_owner_id: checked.repository.owner_id,
        source_remote: request.source_remote.clone(),
        remote_name: request.remote_name.clone(),
        transport: request.transport,
        url,
        fetch_refspec: format!("+refs/heads/*:refs/remotes/{}/*", request.remote_name),
        existing_remote_names: names,
        snapshot: before,
        request: request.clone(),
        created: Instant::now(),
    })
}

struct ConfigLock {
    path: PathBuf,
    file: fs::File,
    published: bool,
}
impl ConfigLock {
    fn owned(&self) -> bool {
        let Ok(on_disk) = fs::symlink_metadata(&self.path) else {
            return false;
        };
        let Ok(opened) = self.file.metadata() else {
            return false;
        };
        if !on_disk.is_file() {
            return false;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            on_disk.dev() == opened.dev() && on_disk.ino() == opened.ino()
        }
        #[cfg(not(unix))]
        {
            on_disk.created().ok() == opened.created().ok()
                && on_disk.modified().ok() == opened.modified().ok()
                && on_disk.len() == opened.len()
        }
    }
}
impl Drop for ConfigLock {
    fn drop(&mut self) {
        if !self.published && self.owned() {
            let _ = fs::remove_file(&self.path);
        }
    }
}
fn quoted(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}
fn execute_with(
    path: &Path,
    plan: &HostedForkRemotePlan,
    provider: &mut impl Transport,
    cancellation: &CancellationToken,
) -> Result<HostedForkRemoteReceipt, AppError> {
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    if plan.created.elapsed() >= Duration::from_secs(15 * 60) {
        return Err(refused("The attachment review expired."));
    }
    if snapshot(path)? != plan.snapshot {
        return Err(refused(
            "The repository or its configuration changed after review.",
        ));
    }
    let current = prepare_with(path, &plan.request, provider)?;
    if current.account != plan.account
        || current.source != plan.source
        || current.network != plan.network
        || current.fork != plan.fork
        || current.fork_owner_id != plan.fork_owner_id
        || current.remote_name != plan.remote_name
        || current.url != plan.url
        || current.source_remote != plan.source_remote
        || current.fetch_refspec != plan.fetch_refspec
        || current.repository_path != plan.repository_path
        || current.existing_remote_names != plan.existing_remote_names
        || std::mem::discriminant(&current.transport) != std::mem::discriminant(&plan.transport)
    {
        return Err(refused("The reviewed account, fork or attachment changed."));
    }
    let config = config_path(&plan.snapshot);
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let lock_path = config.with_extension("lock");
    let file = options.open(&lock_path).map_err(|_| {
        refused("Git configuration is locked or cannot be written. Existing locks are preserved.")
    })?;
    let mut lock = ConfigLock {
        path: lock_path,
        file,
        published: false,
    };
    // The lock excludes cooperating external Git writers before the final CAS.
    if snapshot(path)? != plan.snapshot {
        return Err(refused(
            "The configuration changed before its write lock was acquired.",
        ));
    }
    let addition = format!(
        "\n\n[remote {}]\n\turl = {}\n\tfetch = {}\n",
        quoted(&plan.remote_name),
        quoted(&plan.url),
        quoted(&plan.fetch_refspec)
    );
    lock.file
        .write_all(&plan.snapshot.config)
        .and_then(|_| lock.file.write_all(addition.as_bytes()))
        .map_err(|_| refused("The prepared configuration could not be written."))?;
    let mut expected = plan.snapshot.local_entries.clone();
    expected.extend_from_slice(
        format!(
            "remote.{}.url\n{}\0remote.{}.fetch\n{}\0",
            plan.remote_name, plan.url, plan.remote_name, plan.fetch_refspec
        )
        .as_bytes(),
    );
    if config_entries(path, &lock.path)? != expected {
        return Err(refused(
            "The prepared configuration would alter existing values.",
        ));
    }
    let permissions = fs::metadata(&config)
        .map_err(|_| refused("Configuration permissions cannot be inspected."))?
        .permissions();
    lock.file
        .set_permissions(permissions)
        .and_then(|_| lock.file.sync_all())
        .map_err(|_| refused("The prepared configuration could not be persisted."))?;
    if plan.created.elapsed() >= Duration::from_secs(15 * 60)
        || snapshot(path)? != plan.snapshot
        || !lock.owned()
    {
        return Err(refused(
            "The attachment became stale before publishing configuration.",
        ));
    }
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    fs::rename(&lock.path, &config)
        .map_err(|_| refused("The prepared configuration could not be published."))?;
    lock.published = true;
    #[cfg(unix)]
    fs::File::open(&plan.snapshot.common_dir).and_then(|file| file.sync_all()).map_err(|_| AppError::new(
        "hostedForkRemoteDurability", "The remote configuration was replaced, but directory durability could not be confirmed.",
        Some("Inspect the existing remote before preparing another attachment. No automatic retry is performed.")))?;
    // Publication is a confirmed local outcome even if cancellation races it.
    Ok(HostedForkRemoteReceipt {
        remote_name: plan.remote_name.clone(),
        url: plan.url.clone(),
        source_remote: plan.source_remote.clone(),
        fork: plan.fork.clone(),
    })
}

pub fn prepare_hosted_fork_remote(
    path: &Path,
    request: &HostedForkRemoteRequest,
    cancellation: &CancellationToken,
) -> Result<HostedForkRemotePlan, AppError> {
    git_cancellation::with(Some(cancellation), || {
        if cancellation.is_cancelled() {
            return Err(operation_cancelled());
        }
        snapshot(path)?;
        local_bindings(path, request)?;
        let mut provider = CliTransport::new(cancellation)?;
        prepare_with(path, request, &mut provider)
    })
}
pub fn execute_hosted_fork_remote(
    path: &Path,
    plan: &HostedForkRemotePlan,
    cancellation: &CancellationToken,
) -> Result<HostedForkRemoteReceipt, AppError> {
    git_cancellation::with(Some(cancellation), || {
        if cancellation.is_cancelled() {
            return Err(operation_cancelled());
        }
        let mut provider = CliTransport::new(cancellation)?;
        execute_with(path, plan, &mut provider, cancellation)
    })
}

#[cfg(test)]
#[path = "hosted_fork_remote_tests.rs"]
mod tests;
