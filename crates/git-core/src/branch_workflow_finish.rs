use super::*;
use std::io::{Read, Write};

const RECORD_LIMIT: usize = 256 * 1024;
const TEXT_LIMIT: usize = 16 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum BranchWorkflowMergePolicy {
    MergeCommit,
    FastForwardAllowed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BranchWorkflowTagRequest {
    pub message: String,
    pub sign: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BranchWorkflowFinishOptions {
    pub merge_policy: BranchWorkflowMergePolicy,
    pub merge_message: Option<String>,
    pub tag: Option<BranchWorkflowTagRequest>,
    pub delete_topic: bool,
}

impl Default for BranchWorkflowFinishOptions {
    fn default() -> Self {
        Self {
            merge_policy: BranchWorkflowMergePolicy::MergeCommit,
            merge_message: None,
            tag: None,
            delete_topic: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BranchWorkflowFinishTarget {
    pub branch: String,
    pub oid: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BranchWorkflowFinishTag {
    pub name: String,
    pub message: String,
    pub sign: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BranchWorkflowHead {
    pub oid: String,
    pub reference: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BranchWorkflowFinishPlan {
    pub settings: BranchWorkflowSettings,
    pub kind: BranchWorkflowKind,
    pub branch: String,
    pub source_oid: String,
    pub targets: Vec<BranchWorkflowFinishTarget>,
    pub tag: Option<BranchWorkflowFinishTag>,
    pub delete_topic: bool,
    pub merge_policy: BranchWorkflowMergePolicy,
    pub previous_head: BranchWorkflowHead,
    pub execution_configuration: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum BranchWorkflowFinishPhase {
    Ready,
    CheckingOut,
    Merging,
    Conflicted,
    Tagging,
    Cleaning,
    Complete,
    Aborted,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BranchWorkflowFinishStatus {
    pub version: u32,
    pub id: String,
    pub revision: u32,
    pub owner_worktree: String,
    pub plan: BranchWorkflowFinishPlan,
    pub phase: BranchWorkflowFinishPhase,
    pub completed_targets: Vec<String>,
    pub tag_oid: Option<String>,
    pub recovery: Vec<OperationRecovery>,
    pub checkout_before: Option<BranchWorkflowHead>,
    pub retry_required: bool,
    pub notice: Option<String>,
}

pub fn prepare_branch_workflow_finish_cancellable(
    path: &Path,
    branch: &str,
    options: BranchWorkflowFinishOptions,
    cancellation: &CancellationToken,
) -> Result<BranchWorkflowFinishPlan, AppError> {
    cancellable_read(cancellation, || {
        prepare_branch_workflow_finish(path, branch, options)
    })
}

pub fn load_branch_workflow_finish_cancellable(
    path: &Path,
    cancellation: &CancellationToken,
) -> Result<Option<BranchWorkflowFinishStatus>, AppError> {
    cancellable_read(cancellation, || load_branch_workflow_finish(path))
}

fn text_valid(text: &str) -> bool {
    !text.trim().is_empty() && text.len() <= TEXT_LIMIT && !text.contains('\0')
}

fn owner(path: &Path) -> Result<String, AppError> {
    path.canonicalize()
        .map_err(|e| refused(format!("Could not identify the workflow checkout: {e}")))?
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| refused("This workflow checkout uses an unsupported path encoding."))
}

fn head_binding(path: &Path) -> Result<BranchWorkflowHead, AppError> {
    let output = run_git(path, &["rev-parse", "--verify", "HEAD"])?;
    ensure_success("inspect the workflow checkout commit", &output)?;
    let oid = std::str::from_utf8(&output.stdout)
        .map_err(|_| stale())?
        .trim()
        .to_owned();
    commit_object(path, &oid)?;
    let output = run_git(path, &["symbolic-ref", "--quiet", "HEAD"])?;
    let reference = if output.status.code() == Some(1) {
        None
    } else {
        ensure_success("inspect the workflow checkout reference", &output)?;
        let reference = std::str::from_utf8(&output.stdout)
            .map_err(|_| stale())?
            .trim()
            .to_owned();
        if !reference.starts_with("refs/heads/") {
            return Err(stale());
        }
        Some(reference)
    };
    Ok(BranchWorkflowHead { oid, reference })
}

fn effective_bool(path: &Path, key: &str) -> Result<bool, AppError> {
    let output = run_git(path, &["config", "--type=bool", "--get", key])?;
    if output.status.code() == Some(1) {
        return Ok(false);
    }
    ensure_success("read workflow signing policy", &output)?;
    match output.stdout.as_slice() {
        b"true\n" => Ok(true),
        b"false\n" => Ok(false),
        _ => Err(refused("The signing policy could not be read.")),
    }
}

fn configuration_digest(path: &Path) -> Result<String, AppError> {
    let mut entries = Vec::new();
    for key in [
        "user.name",
        "user.email",
        "user.signingkey",
        "gpg.format",
        "gpg.program",
        "gpg.openpgp.program",
        "gpg.ssh.program",
        "gpg.x509.program",
        "commit.gpgsign",
        "tag.gpgsign",
        "tag.forceSignAnnotated",
        "core.hooksPath",
    ] {
        let (output, truncated) =
            run_git_with_stdout_limit(path, &["config", "--null", "--get", key], 4096)?;
        if truncated {
            return Err(refused(
                "A workflow execution setting exceeds the supported limit.",
            ));
        }
        let value = if output.status.code() == Some(1) {
            None
        } else {
            ensure_success("inspect workflow execution settings", &output)?;
            Some(output.stdout)
        };
        entries.push((key, value));
    }
    // Keep signing-key and program configuration out of renderer previews.
    // hash-object without -w computes an identity without storing the values.
    let bytes = serde_json::to_vec(&entries).map_err(|_| stale())?;
    let output = run_git_with_input_output(path, &["hash-object", "--stdin"], &bytes)?;
    ensure_success("capture workflow execution settings", &output)?;
    let digest = std::str::from_utf8(&output.stdout)
        .map_err(|_| stale())?
        .trim()
        .to_owned();
    validate_commit_oid(&digest)?;
    Ok(digest)
}

fn tag_object(path: &Path, name: &str) -> Result<Option<String>, AppError> {
    validate_tag_name(path, name)?;
    let reference = format!("refs/tags/{name}");
    let symbolic = run_git(path, &["symbolic-ref", "--quiet", &reference])?;
    if symbolic.status.success() {
        return Err(refused("A workflow tag cannot be a symbolic reference."));
    }
    if symbolic.status.code() != Some(1) {
        ensure_success("inspect workflow tag identity", &symbolic)?;
    }
    let exists = run_git(path, &["show-ref", "--verify", "--quiet", &reference])?;
    if exists.status.code() == Some(1) {
        return Ok(None);
    }
    ensure_success("inspect workflow tag existence", &exists)?;
    let output = run_git(path, &["show-ref", "--verify", "--hash", &reference])?;
    ensure_success("inspect workflow tag object", &output)?;
    let oid = std::str::from_utf8(&output.stdout)
        .map_err(|_| stale())?
        .trim()
        .to_owned();
    validate_commit_oid(&oid)?;
    Ok(Some(oid))
}

fn unoccupied(path: &Path, branches: &[&str]) -> Result<(), AppError> {
    let status = read_status(path)?;
    for worktree in read_worktrees(path, &status, false)? {
        if !worktree.current
            && worktree
                .branch
                .as_deref()
                .is_some_and(|branch| branches.contains(&branch))
        {
            return Err(refused(format!(
                "A workflow branch is checked out in {}. Use that checkout or release it first.",
                worktree.path
            )));
        }
    }
    Ok(())
}

pub fn prepare_branch_workflow_finish(
    path: &Path,
    branch: &str,
    options: BranchWorkflowFinishOptions,
) -> Result<BranchWorkflowFinishPlan, AppError> {
    require_no_finish(path)?;
    let settings = read_settings(path)?
        .ok_or_else(|| refused("Configure this repository's branch workflow first."))?;
    branch_name(path, branch)?;
    let (kind, suffix) = settings
        .classify(branch)
        .ok_or_else(|| refused("Choose a configured local topic branch to finish."))?;
    if options
        .merge_message
        .as_deref()
        .is_some_and(|text| !text_valid(text))
    {
        return Err(refused(
            "Enter a nonempty merge message within the supported limit.",
        ));
    }
    if kind == BranchWorkflowKind::Feature && options.tag.is_some() {
        return Err(refused("Feature finishing does not create a release tag."));
    }
    let source_oid = direct_tip(path, branch)?.ok_or_else(stale)?;
    let (oid, reference) = clean_checkout(path)?;
    let mut targets = Vec::new();
    let branches = if kind == BranchWorkflowKind::Feature {
        vec![&settings.development]
    } else {
        vec![&settings.production, &settings.development]
    };
    for target in branches {
        let oid = direct_tip(path, target)?.ok_or_else(|| {
            refused("A configured finish target is missing. Review workflow setup.")
        })?;
        let message = options
            .merge_message
            .clone()
            .unwrap_or_else(|| format!("Integrate {branch} into {target}"));
        targets.push(BranchWorkflowFinishTarget {
            branch: target.clone(),
            oid,
            message,
        });
    }
    let tag_request = if kind == BranchWorkflowKind::Release {
        Some(
            options
                .tag
                .clone()
                .unwrap_or_else(|| BranchWorkflowTagRequest {
                    message: format!("Release {suffix}"),
                    sign: None,
                }),
        )
    } else {
        options.tag.clone()
    };
    let tag = if let Some(request) = tag_request {
        if !text_valid(&request.message) {
            return Err(refused(
                "Enter a nonempty tag annotation within the supported limit.",
            ));
        }
        let name = format!("{}{suffix}", settings.tag_prefix);
        validate_tag_name(path, &name)?;
        if tag_object(path, &name)?.is_some() {
            return Err(refused(
                "That release tag already exists. Workflow finishing never replaces tags.",
            ));
        }
        let sign = match request.sign {
            Some(sign) => sign,
            None => {
                effective_bool(path, "tag.gpgsign")?
                    || effective_bool(path, "tag.forceSignAnnotated")?
            }
        };
        Some(BranchWorkflowFinishTag {
            name,
            message: request.message,
            sign,
        })
    } else {
        None
    };
    let mut occupied = targets
        .iter()
        .map(|target| target.branch.as_str())
        .collect::<Vec<_>>();
    occupied.push(branch);
    unoccupied(path, &occupied)?;
    let plan = BranchWorkflowFinishPlan {
        settings,
        kind,
        branch: branch.into(),
        source_oid,
        targets,
        tag,
        delete_topic: kind == BranchWorkflowKind::Feature || options.delete_topic,
        merge_policy: options.merge_policy,
        previous_head: BranchWorkflowHead { oid, reference },
        execution_configuration: configuration_digest(path)?,
    };
    validate_shape(path, &plan)?;
    if serde_json::to_vec(&plan).map_err(|_| stale())?.len() > RECORD_LIMIT / 2 {
        return Err(refused(
            "The workflow preview exceeds the durable storage limit.",
        ));
    }
    Ok(plan)
}

fn validate_shape(path: &Path, plan: &BranchWorkflowFinishPlan) -> Result<(), AppError> {
    validate_settings(path, &plan.settings)?;
    branch_name(path, &plan.branch)?;
    let Some((kind, suffix)) = plan.settings.classify(&plan.branch) else {
        return Err(stale());
    };
    if kind != plan.kind {
        return Err(stale());
    }
    validate_commit_oid(&plan.source_oid)?;
    validate_commit_oid(&plan.previous_head.oid)?;
    validate_commit_oid(&plan.execution_configuration)?;
    let expected = if kind == BranchWorkflowKind::Feature {
        vec![&plan.settings.development]
    } else {
        vec![&plan.settings.production, &plan.settings.development]
    };
    if plan.targets.len() != expected.len() {
        return Err(stale());
    }
    for (target, expected) in plan.targets.iter().zip(expected) {
        if &target.branch != expected || !text_valid(&target.message) {
            return Err(stale());
        }
        validate_commit_oid(&target.oid)?;
    }
    if kind == BranchWorkflowKind::Feature && (!plan.delete_topic || plan.tag.is_some())
        || kind == BranchWorkflowKind::Release && plan.tag.is_none()
    {
        return Err(stale());
    }
    if let Some(tag) = &plan.tag {
        if tag.name != format!("{}{suffix}", plan.settings.tag_prefix) || !text_valid(&tag.message)
        {
            return Err(stale());
        }
        validate_tag_name(path, &tag.name)?;
    }
    Ok(())
}

struct Journal {
    status: BranchWorkflowFinishStatus,
    persisted: Vec<u8>,
}

fn read_record_bytes(path: &Path) -> Result<Option<Vec<u8>>, AppError> {
    let journal = common_journal(path)?;
    let Some(metadata) = operation_storage::file(&journal)? else {
        return Ok(None);
    };
    if metadata.len() > RECORD_LIMIT as u64 {
        return Err(refused(
            "The saved workflow record exceeds the supported limit.",
        ));
    }
    let file = fs::File::open(&journal)
        .map_err(|e| refused(format!("Could not read the saved workflow: {e}")))?;
    let mut bytes = Vec::new();
    file.take(RECORD_LIMIT as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| refused(format!("Could not read the saved workflow: {e}")))?;
    if bytes.len() > RECORD_LIMIT {
        return Err(refused(
            "The saved workflow record exceeds the supported limit.",
        ));
    }
    Ok(Some(bytes))
}

fn load_journal(path: &Path) -> Result<Option<Journal>, AppError> {
    let Some(persisted) = read_record_bytes(path)? else {
        return Ok(None);
    };
    let status: BranchWorkflowFinishStatus = serde_json::from_slice(&persisted).map_err(|_| refused("The saved workflow record is malformed. Preserve its recovery refs and inspect it before continuing."))?;
    if status.version != 1
        || status.id.len() != 32
        || !status.id.bytes().all(|byte| byte.is_ascii_hexdigit())
        || status.completed_targets.len() > status.plan.targets.len()
        || !Path::new(&status.owner_worktree).is_absolute()
    {
        return Err(refused(
            "The saved workflow record has an unsupported identity or stage.",
        ));
    }
    validate_shape(path, &status.plan)?;
    for oid in &status.completed_targets {
        validate_commit_oid(oid)?;
    }
    if let Some(oid) = &status.tag_oid {
        validate_commit_oid(oid)?;
    }
    let complete = status.completed_targets.len() == status.plan.targets.len();
    let invalid_stage = match status.phase {
        BranchWorkflowFinishPhase::CheckingOut
        | BranchWorkflowFinishPhase::Merging
        | BranchWorkflowFinishPhase::Conflicted => complete,
        BranchWorkflowFinishPhase::Tagging => !complete || status.plan.tag.is_none(),
        BranchWorkflowFinishPhase::Cleaning | BranchWorkflowFinishPhase::Complete => {
            !complete || (status.plan.tag.is_some() && status.tag_oid.is_none())
        }
        BranchWorkflowFinishPhase::Ready | BranchWorkflowFinishPhase::Aborted => false,
    };
    if invalid_stage
        || status.tag_oid.is_some() && (!complete || status.plan.tag.is_none())
        || status.recovery.len() != status.plan.targets.len() + 1
    {
        return Err(refused(
            "The saved workflow stages are inconsistent. Preserve the record and recovery refs for inspection.",
        ));
    }
    Ok(Some(Journal { status, persisted }))
}

fn random_id() -> Result<String, AppError> {
    let mut bytes = [0; 16];
    getrandom::fill(&mut bytes).map_err(|_| refused("Could not allocate a workflow identity."))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn private_file(path: &Path) -> Result<fs::File, AppError> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .map_err(|e| refused(format!("Could not create durable workflow storage: {e}")))
}

fn sync_directory(path: &Path) -> Result<(), AppError> {
    #[cfg(unix)]
    fs::File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|e| refused(format!("Could not sync durable workflow storage: {e}")))?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn save_journal(path: &Path, journal: &mut Journal, initial: bool) -> Result<(), AppError> {
    let destination = common_journal(path)?;
    let parent = destination.parent().expect("workflow record has a parent");
    let bytes = serde_json::to_vec(&journal.status)
        .map_err(|_| refused("Could not encode durable workflow state."))?;
    if bytes.len() > RECORD_LIMIT {
        return Err(refused(
            "The durable workflow record exceeds the storage limit.",
        ));
    }
    if !initial && read_record_bytes(path)?.as_deref() != Some(journal.persisted.as_slice()) {
        return Err(refused(
            "The saved workflow record changed externally. No replacement was written.",
        ));
    }
    let temporary = parent.join(format!(".active-{}.tmp", random_id()?));
    let result = (|| {
        let mut file = private_file(&temporary)?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| refused(format!("Could not persist workflow state: {e}")))?;
        drop(file);
        if initial {
            // Publish only a complete, synced file, without replacing an existing
            // record. A crash before publication leaves no active operation.
            fs::hard_link(&temporary, &destination)
                .map_err(|e| refused(format!("Could not publish initial workflow state: {e}")))?;
            fs::remove_file(&temporary)
                .map_err(|e| refused(format!("Could not release temporary workflow storage: {e}")))
        } else {
            operation_storage::file(&destination)?;
            fs::rename(&temporary, &destination)
                .map_err(|e| refused(format!("Could not replace durable workflow state: {e}")))
        }
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result?;
    sync_directory(parent)?;
    journal.persisted = bytes;
    Ok(())
}

pub fn load_branch_workflow_finish(
    path: &Path,
) -> Result<Option<BranchWorkflowFinishStatus>, AppError> {
    Ok(load_journal(path)?.map(|journal| journal.status))
}

fn owns_record(path: &Path, status: &BranchWorkflowFinishStatus) -> Result<(), AppError> {
    if owner(path)? != status.owner_worktree {
        return Err(refused(format!(
            "Resume this workflow from its owning checkout: {}",
            status.owner_worktree
        )));
    }
    Ok(())
}

fn bindings_match(path: &Path, status: &BranchWorkflowFinishStatus) -> Result<(), AppError> {
    owns_record(path, status)?;
    if read_settings(path)? != Some(status.plan.settings.clone())
        || configuration_digest(path)? != status.plan.execution_configuration
    {
        return Err(stale());
    }
    if status.recovery.len() != status.plan.targets.len() + 1 {
        return Err(stale());
    }
    for (capture, expected) in status.recovery.iter().zip(
        std::iter::once(&status.plan.source_oid)
            .chain(status.plan.targets.iter().map(|target| &target.oid)),
    ) {
        operation_recovery::verify_commit_capture(path, capture, expected).map_err(|error|
            refused(format!("Workflow recovery is unavailable: {} Previously applied stages are retained; further stages were refused.", error.message)))?;
    }
    let source = direct_tip(path, &status.plan.branch)?;
    let source_removed = status.plan.delete_topic
        && matches!(
            status.phase,
            BranchWorkflowFinishPhase::Cleaning | BranchWorkflowFinishPhase::Complete
        )
        && source.is_none();
    if source != Some(status.plan.source_oid.clone()) && !source_removed {
        return Err(stale());
    }
    for (index, target) in status.plan.targets.iter().enumerate() {
        if index == status.completed_targets.len()
            && matches!(
                status.phase,
                BranchWorkflowFinishPhase::Merging | BranchWorkflowFinishPhase::Conflicted
            )
        {
            continue;
        }
        let expected = status.completed_targets.get(index).unwrap_or(&target.oid);
        if direct_tip(path, &target.branch)?.as_deref() != Some(expected.as_str()) {
            return Err(stale());
        }
        if index < status.completed_targets.len()
            && !completed_tip_matches(path, status, target, expected)?
        {
            return Err(refused(
                "A saved integration does not match the reviewed ancestry. No further stages were applied.",
            ));
        }
    }
    if let Some(object) = &status.tag_oid {
        let tag = status.plan.tag.as_ref().ok_or_else(stale)?;
        if tag_object(path, &tag.name)?.as_deref() != Some(object.as_str())
            || !tag_matches(path, status, object)?
        {
            return Err(refused(
                "The completed release tag changed. Cleanup was refused; integrations and recovery refs are retained.",
            ));
        }
    }
    Ok(())
}

fn run_finish_git(
    path: &Path,
    args: &[&str],
    cancellation: &CancellationToken,
) -> Result<Output, AppError> {
    let mut command = git_in(path);
    configure_process_tree(&mut command);
    command
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_EDITOR", "true")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let (output, truncated) =
        run_cancellable_command_with_stdout_limit(command, cancellation, Some(2 * 1024 * 1024))?;
    if truncated {
        return Err(refused(
            "Git output was truncated; inspect the workflow state before another action.",
        ));
    }
    Ok(output)
}

fn command_problem(result: &Result<Output, AppError>) -> Option<String> {
    match result {
        Err(error) => Some(error.message.clone()),
        Ok(output) if !output.status.success() => Some(
            String::from_utf8_lossy(&output.stderr)
                .chars()
                .take(4096)
                .collect(),
        ),
        _ => None,
    }
}

fn persist_notice(
    path: &Path,
    journal: &mut Journal,
    message: impl Into<String>,
) -> Result<(), AppError> {
    journal.status.notice = Some(message.into());
    save_journal(path, journal, false)
}

fn dispatch_phase(
    path: &Path,
    journal: &mut Journal,
    phase: BranchWorkflowFinishPhase,
) -> Result<(), AppError> {
    journal.status.phase = phase;
    journal.status.retry_required = true;
    journal.status.notice = None;
    save_journal(path, journal, false)
}

fn ancestor(path: &Path, before: &str, after: &str) -> Result<bool, AppError> {
    let output = run_git(path, &["merge-base", "--is-ancestor", before, after])?;
    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => {
            ensure_success("inspect workflow integration ancestry", &output)?;
            unreachable!()
        }
    }
}

enum Integration {
    Complete(String),
    AppliedWithMetadata,
    Conflicted,
    CanContinue,
    NotApplied,
}

fn inspect_integration(
    path: &Path,
    status: &BranchWorkflowFinishStatus,
) -> Result<Integration, AppError> {
    let target = status
        .plan
        .targets
        .get(status.completed_targets.len())
        .ok_or_else(stale)?;
    let head = head_binding(path)?;
    if head.reference.as_deref() != Some(format!("refs/heads/{}", target.branch).as_str()) {
        return Err(stale());
    }
    let working = read_status(path)?;
    if working.rebase_in_progress
        || working.history_operation.is_some()
        || working.mail_patch_in_progress
        || working.bisect_in_progress
    {
        return Err(stale());
    }
    if working.merge_in_progress {
        let merge_head = operation_storage::git_entry(path, "MERGE_HEAD")?;
        let metadata = operation_storage::file(&merge_head)?.ok_or_else(stale)?;
        if metadata.len() > 1024 {
            return Err(stale());
        }
        let bytes = fs::read(&merge_head).map_err(|_| stale())?;
        if bytes != format!("{}\n", status.plan.source_oid).as_bytes()
            || direct_tip(path, &target.branch)?.as_deref() != Some(head.oid.as_str())
        {
            return Err(stale());
        }
        if head.oid != target.oid {
            require_visible_replay_index(path)?;
            if working.entry_count != 0
                || working.entries_truncated
                || operation_storage::file(&operation_storage::git_entry(path, "MERGE_AUTOSTASH")?)?
                    .is_some()
                || !completed_tip_matches(path, status, target, &head.oid)?
            {
                return Err(stale());
            }
            return Ok(Integration::AppliedWithMetadata);
        }
        return Ok(if working.conflicted == 0 {
            Integration::CanContinue
        } else {
            Integration::Conflicted
        });
    }
    clean_checkout(path)?;
    if direct_tip(path, &target.branch)?.as_deref() != Some(head.oid.as_str()) {
        return Err(stale());
    }
    if completed_tip_matches(path, status, target, &head.oid)? {
        Ok(Integration::Complete(head.oid))
    } else if head.oid == target.oid {
        Ok(Integration::NotApplied)
    } else {
        Err(stale())
    }
}

fn completed_tip_matches(
    path: &Path,
    status: &BranchWorkflowFinishStatus,
    target: &BranchWorkflowFinishTarget,
    oid: &str,
) -> Result<bool, AppError> {
    if oid == target.oid {
        return ancestor(path, &status.plan.source_oid, oid);
    }
    if status.plan.merge_policy == BranchWorkflowMergePolicy::FastForwardAllowed
        && oid == status.plan.source_oid
        && ancestor(path, &target.oid, oid)?
    {
        return Ok(true);
    }
    let parents = run_git(path, &["rev-list", "--parents", "--max-count=1", oid])?;
    ensure_success("inspect the completed workflow merge", &parents)?;
    let text = std::str::from_utf8(&parents.stdout).map_err(|_| stale())?;
    Ok(text.split_whitespace().collect::<Vec<_>>()
        == [oid, target.oid.as_str(), status.plan.source_oid.as_str()])
}

fn record_integration(
    path: &Path,
    journal: &mut Journal,
    result: &Result<Output, AppError>,
) -> Result<bool, AppError> {
    match git_cancellation::inspect(Duration::from_secs(8), || {
        inspect_integration(path, &journal.status)
    }) {
        Ok(Integration::Complete(oid)) => {
            journal.status.completed_targets.push(oid);
            journal.status.phase = BranchWorkflowFinishPhase::Ready;
            journal.status.checkout_before = None;
            journal.status.retry_required = false;
            journal.status.notice = command_problem(result).map(|problem| format!("Integration is verified, but Git stopped with: {problem} Inspect hook effects before continuing the remaining stages."));
            save_journal(path, journal, false)?;
            Ok(journal.status.notice.is_none())
        }
        Ok(Integration::AppliedWithMetadata) => {
            persist_notice(
                path,
                journal,
                "A completed integration is verified, but its merge metadata remains after interruption. Continue explicitly to clear this metadata; the merge and its hooks will not be replayed.",
            )?;
            Ok(false)
        }
        Ok(Integration::Conflicted | Integration::CanContinue) => {
            journal.status.phase = BranchWorkflowFinishPhase::Conflicted;
            journal.status.retry_required = false;
            persist_notice(
                path,
                journal,
                "This target has a pending merge. Resolve and stage its files, then continue explicitly; abort affects this merge only.",
            )?;
            Ok(false)
        }
        Ok(Integration::NotApplied) => {
            let problem = command_problem(result)
                .unwrap_or_else(|| "The expected integration was not found.".into());
            persist_notice(
                path,
                journal,
                format!(
                    "{problem} No completed integration was verified. Inspect hook effects before explicitly retrying this stage."
                ),
            )?;
            Ok(false)
        }
        Err(error) => {
            persist_notice(
                path,
                journal,
                format!(
                    "Git state does not match the reviewed integration: {} Preserve current work and inspect before continuing.",
                    error.message
                ),
            )?;
            Ok(false)
        }
    }
}

fn settle_applied_merge(
    path: &Path,
    journal: &mut Journal,
    cancellation: &CancellationToken,
) -> Result<bool, AppError> {
    bindings_match(path, &journal.status)?;
    if !matches!(
        inspect_integration(path, &journal.status)?,
        Integration::AppliedWithMetadata
    ) {
        return Err(stale());
    }
    // Git's quit action forgets merge metadata while retaining HEAD, index and
    // files. Only the exact completed integration above is eligible; an active
    // conflict is never silently abandoned or reset.
    let result = run_finish_git(path, &["merge", "--quit"], cancellation);
    record_integration(path, journal, &result)
}

fn merge_target(
    path: &Path,
    journal: &mut Journal,
    cancellation: &CancellationToken,
    continuing: bool,
) -> Result<bool, AppError> {
    cancellable_read(cancellation, || bindings_match(path, &journal.status))?;
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    let target = journal
        .status
        .plan
        .targets
        .get(journal.status.completed_targets.len())
        .ok_or_else(stale)?
        .clone();
    if continuing {
        if !matches!(
            inspect_integration(path, &journal.status)?,
            Integration::CanContinue
        ) {
            return Err(stale());
        }
    } else {
        let (oid, reference) = clean_checkout(path)?;
        if oid != target.oid || reference != Some(format!("refs/heads/{}", target.branch)) {
            return Err(stale());
        }
        unoccupied(path, &[&target.branch])?;
    }
    dispatch_phase(path, journal, BranchWorkflowFinishPhase::Merging)?;
    let result = if continuing {
        run_finish_git(path, &["merge", "--continue"], cancellation)
    } else {
        let policy = if journal.status.plan.merge_policy == BranchWorkflowMergePolicy::MergeCommit {
            "--no-ff"
        } else {
            "--ff"
        };
        run_finish_git(
            path,
            &[
                "merge",
                policy,
                "--no-edit",
                "--no-autostash",
                "--no-overwrite-ignore",
                "--cleanup=verbatim",
                "-m",
                &target.message,
                &journal.status.plan.source_oid,
            ],
            cancellation,
        )
    };
    record_integration(path, journal, &result)
}

fn tag_matches(
    path: &Path,
    status: &BranchWorkflowFinishStatus,
    object: &str,
) -> Result<bool, AppError> {
    let tag = status.plan.tag.as_ref().ok_or_else(stale)?;
    let production = status.completed_targets.first().ok_or_else(stale)?;
    let kind = run_git(path, &["cat-file", "-t", object])?;
    ensure_success("inspect the workflow tag type", &kind)?;
    if kind.stdout != b"tag\n" {
        return Ok(false);
    }
    let (output, truncated) =
        run_git_with_stdout_limit(path, &["cat-file", "-p", object], RECORD_LIMIT)?;
    ensure_success("inspect the workflow tag annotation", &output)?;
    if truncated {
        return Err(refused(
            "The workflow tag annotation exceeds the inspection limit.",
        ));
    }
    let text = std::str::from_utf8(&output.stdout).map_err(|_| stale())?;
    let Some((headers, contents)) = text.split_once("\n\n") else {
        return Ok(false);
    };
    if !headers
        .lines()
        .any(|line| line == format!("object {production}"))
        || !headers.lines().any(|line| line == "type commit")
        || !headers
            .lines()
            .any(|line| line == format!("tag {}", tag.name))
    {
        return Ok(false);
    }
    let reference = format!("refs/tags/{}", tag.name);
    let (signature, truncated) = run_git_with_stdout_limit(
        path,
        &[
            "for-each-ref",
            "--format=%(refname)%00%(contents:signature)%00",
            &reference,
        ],
        RECORD_LIMIT,
    )?;
    ensure_success("inspect the workflow tag signature presence", &signature)?;
    if truncated {
        return Err(refused(
            "The workflow tag signature exceeds the inspection limit.",
        ));
    }
    let fields = signature
        .stdout
        .split(|byte| *byte == 0)
        .collect::<Vec<_>>();
    if fields.len() != 3 || fields[0] != reference.as_bytes() || fields[2] != b"\n" {
        return Ok(false);
    }
    let signature = std::str::from_utf8(fields[1]).map_err(|_| stale())?;
    if tag.sign == signature.is_empty() {
        return Ok(false);
    }
    let message = if signature.is_empty() {
        contents
    } else {
        let Some(message) = contents.strip_suffix(signature) else {
            return Ok(false);
        };
        message
    };
    Ok(message.trim_end_matches('\n') == tag.message.trim_end_matches('\n'))
}

fn create_tag(
    path: &Path,
    journal: &mut Journal,
    cancellation: &CancellationToken,
) -> Result<bool, AppError> {
    cancellable_read(cancellation, || bindings_match(path, &journal.status))?;
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    let tag = journal.status.plan.tag.as_ref().ok_or_else(stale)?.clone();
    let production = journal
        .status
        .completed_targets
        .first()
        .ok_or_else(stale)?
        .clone();
    if tag_object(path, &tag.name)?.is_some() {
        persist_notice(
            path,
            journal,
            "The release tag already exists. It was not replaced; inspect it before continuing.",
        )?;
        return Ok(false);
    }
    dispatch_phase(path, journal, BranchWorkflowFinishPhase::Tagging)?;
    let sign = if tag.sign { "--sign" } else { "--no-sign" };
    let result = run_finish_git(
        path,
        &[
            "tag",
            "--annotate",
            sign,
            "--cleanup=verbatim",
            "--message",
            &tag.message,
            &tag.name,
            &production,
        ],
        cancellation,
    );
    let object = tag_object(path, &tag.name)?;
    if let Some(object) = object
        && tag_matches(path, &journal.status, &object)?
    {
        journal.status.tag_oid = Some(object);
        journal.status.phase = BranchWorkflowFinishPhase::Cleaning;
        journal.status.retry_required = false;
        journal.status.notice = command_problem(&result).map(|problem| format!("The expected tag is present, but Git stopped with: {problem} Inspect before continuing cleanup."));
        save_journal(path, journal, false)?;
        return Ok(journal.status.notice.is_none());
    }
    let problem = command_problem(&result)
        .unwrap_or_else(|| "The expected annotated tag could not be confirmed.".into());
    persist_notice(
        path,
        journal,
        format!(
            "{problem} Branch integrations are retained. The tag is not reported as completed."
        ),
    )?;
    Ok(false)
}

fn cleanup(
    path: &Path,
    journal: &mut Journal,
    cancellation: &CancellationToken,
) -> Result<bool, AppError> {
    cancellable_read(cancellation, || bindings_match(path, &journal.status))?;
    if !journal.status.plan.delete_topic || direct_tip(path, &journal.status.plan.branch)?.is_none()
    {
        journal.status.phase = BranchWorkflowFinishPhase::Complete;
        journal.status.retry_required = false;
        return save_journal(path, journal, false).map(|_| true);
    }
    let (head, reference) = clean_checkout(path)?;
    let target = journal.status.plan.targets.last().ok_or_else(stale)?;
    if reference != Some(format!("refs/heads/{}", target.branch))
        || Some(&head) != journal.status.completed_targets.last()
    {
        return Err(refused(
            "Restore the last integration checkout before deleting the topic branch.",
        ));
    }
    unoccupied(path, &[&journal.status.plan.branch])?;
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    dispatch_phase(path, journal, BranchWorkflowFinishPhase::Cleaning)?;
    // Deletion is conditional on the reviewed source OID. Upstream tracking
    // state cannot substitute a different merge target or an unreviewed tip.
    for target in &journal.status.completed_targets {
        if !ancestor(path, &journal.status.plan.source_oid, target)? {
            return Err(refused(
                "The topic is not contained in every completed target; cleanup was refused.",
            ));
        }
    }
    let reference = format!("refs/heads/{}", journal.status.plan.branch);
    let result = run_finish_git(
        path,
        &[
            "update-ref",
            "--no-deref",
            "-d",
            &reference,
            &journal.status.plan.source_oid,
        ],
        cancellation,
    );
    if direct_tip(path, &journal.status.plan.branch)?.is_none() {
        journal.status.phase = BranchWorkflowFinishPhase::Complete;
        journal.status.retry_required = false;
        journal.status.notice = command_problem(&result).map(|problem| format!("The topic branch is absent, but Git stopped with: {problem} Recovery refs are retained."));
        save_journal(path, journal, false)?;
        return Ok(true);
    }
    let problem = command_problem(&result)
        .unwrap_or_else(|| "The local topic branch remains present.".into());
    persist_notice(
        path,
        journal,
        format!("Integrations are retained; cleanup is unfinished. {problem}"),
    )?;
    Ok(false)
}

fn advance(
    path: &Path,
    journal: &mut Journal,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    loop {
        cancellable_read(cancellation, || bindings_match(path, &journal.status))?;
        if cancellation.is_cancelled() {
            return Err(operation_cancelled());
        }
        if journal.status.completed_targets.len() == journal.status.plan.targets.len() {
            if journal.status.plan.tag.is_some() && journal.status.tag_oid.is_none() {
                journal.status.phase = BranchWorkflowFinishPhase::Tagging;
                journal.status.retry_required = false;
                save_journal(path, journal, false)?;
                if !create_tag(path, journal, cancellation)? {
                    return Ok(());
                }
            }
            journal.status.phase = BranchWorkflowFinishPhase::Cleaning;
            save_journal(path, journal, false)?;
            cleanup(path, journal, cancellation)?;
            return Ok(());
        }
        let target = journal.status.plan.targets[journal.status.completed_targets.len()].clone();
        let (oid, reference) = clean_checkout(path)?;
        unoccupied(path, &[&target.branch])?;
        let expected = Some(format!("refs/heads/{}", target.branch));
        if reference != expected {
            journal.status.checkout_before = Some(BranchWorkflowHead { oid, reference });
            dispatch_phase(path, journal, BranchWorkflowFinishPhase::CheckingOut)?;
            let result = run_finish_git(
                path,
                &[
                    "checkout",
                    "--no-guess",
                    "--no-overwrite-ignore",
                    "--no-recurse-submodules",
                    &target.branch,
                    "--",
                ],
                cancellation,
            );
            if let Some(problem) = command_problem(&result) {
                persist_notice(
                    path,
                    journal,
                    format!(
                        "Checkout stopped: {problem} Inspect the selected branch and hook effects before continuing."
                    ),
                )?;
                return Ok(());
            }
        }
        let (head, reference) = clean_checkout(path)?;
        if reference != expected || head != target.oid {
            return Err(stale());
        }
        journal.status.phase = BranchWorkflowFinishPhase::Merging;
        journal.status.retry_required = false;
        save_journal(path, journal, false)?;
        if ancestor(path, &journal.status.plan.source_oid, &target.oid)? {
            journal.status.completed_targets.push(target.oid);
            journal.status.phase = BranchWorkflowFinishPhase::Ready;
            save_journal(path, journal, false)?;
        } else if !merge_target(path, journal, cancellation, false)? {
            return Ok(());
        }
    }
}

pub fn finish_branch_workflow(
    path: &Path,
    plan: &BranchWorkflowFinishPlan,
    cancellation: &CancellationToken,
) -> Result<BranchWorkflowFinishStatus, AppError> {
    let _guard = cancellable_read(cancellation, || action_guard(path))?;
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    let options = BranchWorkflowFinishOptions {
        merge_policy: plan.merge_policy,
        merge_message: None,
        tag: plan.tag.as_ref().map(|tag| BranchWorkflowTagRequest {
            message: tag.message.clone(),
            sign: Some(tag.sign),
        }),
        delete_topic: plan.delete_topic,
    };
    let mut fresh =
        prepare_branch_workflow_finish_cancellable(path, &plan.branch, options, cancellation)?;
    // User-authored messages are part of the immutable reviewed plan, while its
    // branch/configuration bindings must be freshly derived.
    if fresh.targets.len() != plan.targets.len() {
        return Err(stale());
    }
    for (target, reviewed) in fresh.targets.iter_mut().zip(&plan.targets) {
        target.message.clone_from(&reviewed.message);
    }
    if &fresh != plan {
        return Err(stale());
    }
    cancellable_read(cancellation, || validate_shape(path, plan))?;
    let mut recovery = Vec::new();
    for (label, oid) in std::iter::once((
        format!("Workflow {}: source", plan.branch),
        &plan.source_oid,
    ))
    .chain(plan.targets.iter().map(|target| {
        (
            format!("Workflow {}: {}", plan.branch, target.branch),
            &target.oid,
        )
    })) {
        if cancellation.is_cancelled() {
            return Err(operation_cancelled());
        }
        recovery.push(operation_recovery::preserve_commits_cancellable(
            path,
            &label,
            oid,
            cancellation,
        )?);
    }
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    let mut journal = Journal {
        status: BranchWorkflowFinishStatus {
            version: 1,
            id: random_id()?,
            revision: 0,
            owner_worktree: owner(path)?,
            plan: plan.clone(),
            phase: BranchWorkflowFinishPhase::Ready,
            completed_targets: Vec::new(),
            tag_oid: None,
            recovery,
            checkout_before: None,
            retry_required: false,
            notice: None,
        },
        persisted: Vec::new(),
    };
    cancellable_read(cancellation, || bindings_match(path, &journal.status))?;
    let (head, reference) = cancellable_read(cancellation, || clean_checkout(path))?;
    if (BranchWorkflowHead {
        oid: head,
        reference,
    }) != plan.previous_head
    {
        return Err(stale());
    }
    save_journal(path, &mut journal, true)?;
    if let Err(error) = advance(path, &mut journal, cancellation) {
        persist_notice(
            path,
            &mut journal,
            format!(
                "Workflow paused: {} Applied stages and recovery refs are retained.",
                error.message
            ),
        )?;
    }
    Ok(journal.status)
}

fn selected_journal(path: &Path, id: &str, revision: u32) -> Result<Journal, AppError> {
    let journal = load_journal(path)?.ok_or_else(|| refused("No saved workflow is active."))?;
    owns_record(path, &journal.status)?;
    if journal.status.id != id || journal.status.revision != revision {
        return Err(refused(
            "The saved workflow changed. Reload its current stages before another action.",
        ));
    }
    Ok(journal)
}

fn consume_revision(path: &Path, journal: &mut Journal) -> Result<(), AppError> {
    journal.status.revision = journal
        .status
        .revision
        .checked_add(1)
        .ok_or_else(|| refused("The workflow action revision is exhausted."))?;
    journal.status.notice = None;
    save_journal(path, journal, false)
}

pub fn resume_branch_workflow_finish(
    path: &Path,
    id: &str,
    revision: u32,
    retry: bool,
    cancellation: &CancellationToken,
) -> Result<BranchWorkflowFinishStatus, AppError> {
    let _guard = cancellable_read(cancellation, || action_guard(path))?;
    let mut journal = selected_journal(path, id, revision)?;
    if matches!(
        journal.status.phase,
        BranchWorkflowFinishPhase::Complete | BranchWorkflowFinishPhase::Aborted
    ) {
        return Ok(journal.status);
    }
    cancellable_read(cancellation, || bindings_match(path, &journal.status))?;
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    consume_revision(path, &mut journal)?;
    let result = (|| {
        match journal.status.phase {
            BranchWorkflowFinishPhase::CheckingOut => {
                let head = head_binding(path)?;
                let target = &journal.status.plan.targets[journal.status.completed_targets.len()];
                if head.reference == Some(format!("refs/heads/{}", target.branch))
                    && head.oid == target.oid
                {
                    clean_checkout(path)?;
                } else if !retry || journal.status.checkout_before.as_ref() != Some(&head) {
                    persist_notice(
                        path,
                        &mut journal,
                        "The expected checkout was not verified. Inspect its state before an explicit retry; hooks may already have run.",
                    )?;
                    return Ok(());
                }
                journal.status.phase = BranchWorkflowFinishPhase::Ready;
                journal.status.retry_required = false;
                save_journal(path, &mut journal, false)?;
            }
            BranchWorkflowFinishPhase::Merging | BranchWorkflowFinishPhase::Conflicted => {
                match cancellable_read(cancellation, || inspect_integration(path, &journal.status))?
                {
                    Integration::Complete(oid) => {
                        journal.status.completed_targets.push(oid);
                        journal.status.phase = BranchWorkflowFinishPhase::Ready;
                        journal.status.retry_required = false;
                        save_journal(path, &mut journal, false)?;
                    }
                    Integration::AppliedWithMetadata => {
                        if !settle_applied_merge(path, &mut journal, cancellation)? {
                            return Ok(());
                        }
                    }
                    Integration::Conflicted => {
                        persist_notice(
                            path,
                            &mut journal,
                            "Resolve and stage the active workflow merge before continuing, or abort this merge.",
                        )?;
                        return Ok(());
                    }
                    Integration::CanContinue => {
                        if !merge_target(path, &mut journal, cancellation, true)? {
                            return Ok(());
                        }
                    }
                    Integration::NotApplied => {
                        if !retry {
                            persist_notice(
                                path,
                                &mut journal,
                                "No completed merge is verified. Explicit retry is required because hooks may already have run.",
                            )?;
                            return Ok(());
                        }
                        if !merge_target(path, &mut journal, cancellation, false)? {
                            return Ok(());
                        }
                    }
                }
            }
            BranchWorkflowFinishPhase::Tagging => {
                let tag = journal.status.plan.tag.as_ref().ok_or_else(stale)?;
                if let Some(object) = tag_object(path, &tag.name)? {
                    if !tag_matches(path, &journal.status, &object)? {
                        return Err(refused(
                            "The existing tag differs from the reviewed tag. It was not replaced.",
                        ));
                    }
                    journal.status.tag_oid = Some(object);
                    journal.status.phase = BranchWorkflowFinishPhase::Cleaning;
                    journal.status.retry_required = false;
                    save_journal(path, &mut journal, false)?;
                } else if journal.status.retry_required && !retry {
                    persist_notice(
                        path,
                        &mut journal,
                        "Tag creation was not verified. Inspect signing or hook effects before an explicit retry.",
                    )?;
                    return Ok(());
                } else if !create_tag(path, &mut journal, cancellation)? {
                    return Ok(());
                }
            }
            BranchWorkflowFinishPhase::Cleaning => {
                if journal.status.retry_required
                    && !retry
                    && direct_tip(path, &journal.status.plan.branch)?.is_some()
                {
                    persist_notice(
                        path,
                        &mut journal,
                        "Topic deletion was not verified. Inspect before explicitly retrying cleanup.",
                    )?;
                    return Ok(());
                }
                cleanup(path, &mut journal, cancellation)?;
                return Ok(());
            }
            BranchWorkflowFinishPhase::Ready => {}
            BranchWorkflowFinishPhase::Complete | BranchWorkflowFinishPhase::Aborted => {
                return Ok(());
            }
        }
        advance(path, &mut journal, cancellation)
    })();
    if let Err(error) = result {
        persist_notice(
            path,
            &mut journal,
            format!(
                "Workflow remains paused: {} Applied stages and recovery refs are retained.",
                error.message
            ),
        )?;
    }
    Ok(journal.status)
}

pub fn abort_branch_workflow_finish(
    path: &Path,
    id: &str,
    revision: u32,
    cancellation: &CancellationToken,
) -> Result<BranchWorkflowFinishStatus, AppError> {
    let _guard = cancellable_read(cancellation, || action_guard(path))?;
    let mut journal = selected_journal(path, id, revision)?;
    if journal.status.phase == BranchWorkflowFinishPhase::Complete {
        return Err(refused(
            "This workflow is complete. Its applied integrations are not rolled back by abort.",
        ));
    }
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    consume_revision(path, &mut journal)?;
    let status = read_status(path)?;
    if status.merge_in_progress {
        match cancellable_read(cancellation, || inspect_integration(path, &journal.status))? {
            Integration::AppliedWithMetadata => {
                if !settle_applied_merge(path, &mut journal, cancellation)? {
                    return Ok(journal.status);
                }
            }
            Integration::Conflicted | Integration::CanContinue => {
                let output = run_finish_git(path, &["merge", "--abort"], cancellation)?;
                ensure_success("abort the current workflow merge", &output)?;
                if read_status(path)?.merge_in_progress {
                    return Err(refused(
                        "The workflow merge is still active. Current files and recovery refs were retained.",
                    ));
                }
            }
            _ => return Err(stale()),
        }
    } else {
        require_no_git_sequence(path)?;
    }
    journal.status.phase = BranchWorkflowFinishPhase::Aborted;
    journal.status.retry_required = false;
    journal.status.notice = Some("The workflow was stopped. Any remaining working changes are retained. Previously completed integrations and tags remain applied; recovery refs are retained.".into());
    save_journal(path, &mut journal, false)?;
    Ok(journal.status)
}

pub fn acknowledge_branch_workflow_finish(
    path: &Path,
    id: &str,
    revision: u32,
) -> Result<(), AppError> {
    let _guard = action_guard(path)?;
    let journal = selected_journal(path, id, revision)?;
    if !matches!(
        journal.status.phase,
        BranchWorkflowFinishPhase::Complete | BranchWorkflowFinishPhase::Aborted
    ) {
        return Err(refused(
            "Complete or abort the saved workflow before acknowledging its record.",
        ));
    }
    require_no_git_sequence(path)?;
    if read_record_bytes(path)?.as_deref() != Some(journal.persisted.as_slice()) {
        return Err(stale());
    }
    let record = common_journal(path)?;
    fs::remove_file(&record)
        .map_err(|e| refused(format!("Could not acknowledge the workflow record: {e}")))?;
    sync_directory(record.parent().expect("workflow record has a parent"))
}

#[cfg(test)]
mod tests {
    use super::super::tests::Fixture;
    use super::*;

    fn topic(fixture: &Fixture, branch: &str, text: &str) -> String {
        fixture.git(&["checkout", "-q", "-b", branch, "develop"]);
        fixture.commit(text)
    }
    fn finish(
        fixture: &Fixture,
        branch: &str,
        options: BranchWorkflowFinishOptions,
    ) -> BranchWorkflowFinishStatus {
        let plan = prepare_branch_workflow_finish(&fixture.repo, branch, options).unwrap();
        finish_branch_workflow(&fixture.repo, &plan, &CancellationToken::default()).unwrap()
    }
    fn pending(
        fixture: &Fixture,
        plan: BranchWorkflowFinishPlan,
        phase: BranchWorkflowFinishPhase,
    ) -> Journal {
        let _guard = action_guard(&fixture.repo).unwrap();
        let mut recovery = vec![
            operation_recovery::preserve_commits(
                &fixture.repo,
                "Owned workflow source",
                &plan.source_oid,
                None,
            )
            .unwrap(),
        ];
        for target in &plan.targets {
            recovery.push(
                operation_recovery::preserve_commits(
                    &fixture.repo,
                    "Owned workflow target",
                    &target.oid,
                    None,
                )
                .unwrap(),
            );
        }
        let mut journal = Journal {
            status: BranchWorkflowFinishStatus {
                version: 1,
                id: random_id().unwrap(),
                revision: 0,
                owner_worktree: owner(&fixture.repo).unwrap(),
                plan,
                phase,
                completed_targets: Vec::new(),
                tag_oid: None,
                recovery,
                checkout_before: None,
                retry_required: true,
                notice: None,
            },
            persisted: Vec::new(),
        };
        save_journal(&fixture.repo, &mut journal, true).unwrap();
        journal
    }
    fn assert_contains(fixture: &Fixture, ancestor_oid: &str, reference: &str) {
        fixture.git(&["merge-base", "--is-ancestor", ancestor_oid, reference]);
    }

    #[test]
    fn feature_finish_previews_without_mutation_then_merges_deletes_and_retains_recovery() {
        let fixture = Fixture::new();
        fixture.setup();
        let base = fixture.git(&["rev-parse", "main"]);
        let source = topic(&fixture, "feature/owned", "feature\n");
        let refs = fixture.refs();
        let index = fixture.index();
        let plan =
            prepare_branch_workflow_finish(&fixture.repo, "feature/owned", Default::default())
                .unwrap();
        assert_eq!(fixture.refs(), refs);
        assert_eq!(fixture.index(), index);
        assert!(!finish_pending(&fixture.repo).unwrap());
        let status =
            finish_branch_workflow(&fixture.repo, &plan, &CancellationToken::default()).unwrap();
        assert_eq!(
            status.phase,
            BranchWorkflowFinishPhase::Complete,
            "{:?}",
            status.notice
        );
        assert_eq!(status.completed_targets.len(), 1);
        assert_eq!(status.recovery.len(), 2);
        assert!(
            direct_tip(&fixture.repo, "feature/owned")
                .unwrap()
                .is_none()
        );
        assert_eq!(
            fixture.git(&["rev-list", "--parents", "--max-count=1", "develop"]),
            format!("{} {base} {source}", status.completed_targets[0])
        );
        assert_eq!(fixture.git(&["rev-parse", "main"]), base);
        assert_eq!(
            fs::read(fixture.repo.join("file.txt")).unwrap(),
            b"feature\n"
        );
        for recovery in &status.recovery {
            assert_eq!(
                fixture.git(&["rev-parse", &recovery.head_reference]),
                recovery.head_oid
            );
        }
        assert!(
            finish_branch_workflow(&fixture.repo, &plan, &CancellationToken::default()).is_err()
        );
        acknowledge_branch_workflow_finish(&fixture.repo, &status.id, status.revision).unwrap();
        assert!(
            load_branch_workflow_finish(&fixture.repo)
                .unwrap()
                .is_none()
        );
        for recovery in &status.recovery {
            assert_eq!(
                fixture.git(&["rev-parse", &recovery.head_reference]),
                recovery.head_oid
            );
        }
    }

    #[test]
    fn release_finish_integrates_both_targets_and_tags_the_resulting_production_commit() {
        let fixture = Fixture::new();
        fixture.setup();
        let oid = fixture.git(&["rev-parse", "HEAD"]);
        let settings = BranchWorkflowSettings {
            tag_prefix: "v".into(),
            ..Default::default()
        };
        apply_branch_workflow_setup(
            &fixture.repo,
            &prepare_branch_workflow_setup(&fixture.repo, settings, &oid).unwrap(),
        )
        .unwrap();
        fixture.git(&["checkout", "-q", "develop"]);
        fixture.commit("development\n");
        let source = topic(&fixture, "release/1.0", "release\n");
        fixture.git(&["checkout", "-q", "main"]);
        fs::write(fixture.repo.join("production.txt"), b"production only\n").unwrap();
        fixture.git(&["add", "production.txt"]);
        fixture.git(&["commit", "-qm", "Owned production change"]);
        let options = BranchWorkflowFinishOptions {
            tag: Some(BranchWorkflowTagRequest {
                message: "Owned release\nSecond line".into(),
                sign: Some(false),
            }),
            ..Default::default()
        };
        let status = finish(&fixture, "release/1.0", options);
        assert_eq!(
            status.phase,
            BranchWorkflowFinishPhase::Complete,
            "{:?}",
            status.notice
        );
        assert_eq!(status.completed_targets.len(), 2);
        assert_contains(&fixture, &source, "main");
        assert_contains(&fixture, &source, "develop");
        assert_eq!(
            fixture.git(&["rev-parse", "v1.0^{commit}"]),
            status.completed_targets[0]
        );
        assert_eq!(fixture.git(&["cat-file", "-t", "v1.0"]), "tag");
        assert_eq!(fixture.git(&["rev-parse", "release/1.0"]), source);
        assert_eq!(
            fixture.git(&["show", "main:production.txt"]),
            "production only"
        );
        assert!(!fixture.repo.join("production.txt").exists());
        assert_eq!(
            fs::read(fixture.repo.join("file.txt")).unwrap(),
            b"release\n"
        );
    }

    #[test]
    fn hotfix_supports_explicit_fast_forward_and_optional_local_cleanup_without_a_tag() {
        let fixture = Fixture::new();
        fixture.setup();
        let source = topic(&fixture, "hotfix/urgent", "urgent\n");
        let options = BranchWorkflowFinishOptions {
            merge_policy: BranchWorkflowMergePolicy::FastForwardAllowed,
            delete_topic: true,
            ..Default::default()
        };
        let status = finish(&fixture, "hotfix/urgent", options);
        assert_eq!(
            status.phase,
            BranchWorkflowFinishPhase::Complete,
            "{:?}",
            status.notice
        );
        assert_eq!(status.completed_targets, [source.clone(), source]);
        assert!(status.tag_oid.is_none());
        assert!(
            direct_tip(&fixture.repo, "hotfix/urgent")
                .unwrap()
                .is_none()
        );
        assert_eq!(fixture.git(&["tag", "--list"]), "");
    }

    #[test]
    fn conflicting_feature_survives_restart_and_continues_only_after_explicit_resolution() {
        let fixture = Fixture::new();
        fixture.setup();
        let source = topic(&fixture, "feature/conflict", "feature side\n");
        fixture.git(&["checkout", "-q", "develop"]);
        let before = fixture.commit("development side\n");
        let status = finish(&fixture, "feature/conflict", Default::default());
        assert_eq!(
            status.phase,
            BranchWorkflowFinishPhase::Conflicted,
            "{:?}",
            status.notice
        );
        assert!(status.completed_targets.is_empty());
        assert_eq!(fixture.git(&["rev-parse", "develop"]), before);
        let loaded = load_branch_workflow_finish(&fixture.repo).unwrap().unwrap();
        assert_eq!(loaded.id, status.id);
        fs::write(fixture.repo.join("file.txt"), b"resolved by owner\n").unwrap();
        fixture.git(&["add", "file.txt"]);
        let resumed = resume_branch_workflow_finish(
            &fixture.repo,
            &loaded.id,
            loaded.revision,
            false,
            &CancellationToken::default(),
        )
        .unwrap();
        assert_eq!(
            resumed.phase,
            BranchWorkflowFinishPhase::Complete,
            "{:?}",
            resumed.notice
        );
        assert_contains(&fixture, &source, "develop");
        assert_eq!(
            fs::read(fixture.repo.join("file.txt")).unwrap(),
            b"resolved by owner\n"
        );
        assert!(
            resume_branch_workflow_finish(
                &fixture.repo,
                &loaded.id,
                loaded.revision,
                false,
                &CancellationToken::default()
            )
            .is_err()
        );
    }

    #[test]
    fn aborting_a_second_target_conflict_preserves_the_first_completed_merge() {
        let fixture = Fixture::new();
        fixture.setup();
        let source = topic(&fixture, "release/conflict", "release side\n");
        fixture.git(&["checkout", "-q", "develop"]);
        let development = fixture.commit("development conflict\n");
        let status = finish(&fixture, "release/conflict", Default::default());
        assert_eq!(
            status.phase,
            BranchWorkflowFinishPhase::Conflicted,
            "{:?}",
            status.notice
        );
        assert_eq!(status.completed_targets.len(), 1);
        let production = fixture.git(&["rev-parse", "main"]);
        assert_contains(&fixture, &source, "main");
        assert!(tag_object(&fixture.repo, "conflict").unwrap().is_none());
        let aborted = abort_branch_workflow_finish(
            &fixture.repo,
            &status.id,
            status.revision,
            &CancellationToken::default(),
        )
        .unwrap();
        assert_eq!(aborted.phase, BranchWorkflowFinishPhase::Aborted);
        assert_eq!(fixture.git(&["rev-parse", "main"]), production);
        assert_eq!(fixture.git(&["rev-parse", "develop"]), development);
        assert_eq!(fixture.git(&["rev-parse", "release/conflict"]), source);
        assert_eq!(
            fs::read(fixture.repo.join("file.txt")).unwrap(),
            b"development conflict\n"
        );
        assert!(fixture.git(&["status", "--porcelain"]).is_empty());
        acknowledge_branch_workflow_finish(&fixture.repo, &aborted.id, aborted.revision).unwrap();
        assert_eq!(fixture.git(&["rev-parse", "main"]), production);
    }

    #[test]
    fn stale_target_configuration_and_tag_collisions_refuse_before_finish_writes() {
        let fixture = Fixture::new();
        fixture.setup();
        topic(&fixture, "release/blocked", "release\n");
        let plan =
            prepare_branch_workflow_finish(&fixture.repo, "release/blocked", Default::default())
                .unwrap();
        fixture.git(&["tag", "blocked", "main"]);
        let refs = fixture.refs();
        let index = fixture.index();
        assert!(
            finish_branch_workflow(&fixture.repo, &plan, &CancellationToken::default()).is_err()
        );
        assert_eq!(fixture.refs(), refs);
        assert_eq!(fixture.index(), index);
        assert!(!finish_pending(&fixture.repo).unwrap());
        fixture.git(&["tag", "-d", "blocked"]);
        let plan =
            prepare_branch_workflow_finish(&fixture.repo, "release/blocked", Default::default())
                .unwrap();
        fixture.git(&["config", "user.email", "changed-owner@example.test"]);
        let refs = fixture.refs();
        assert!(
            finish_branch_workflow(&fixture.repo, &plan, &CancellationToken::default()).is_err()
        );
        assert_eq!(fixture.refs(), refs);
        fixture.git(&["config", "user.email", "owned-workflow@example.test"]);
        let plan =
            prepare_branch_workflow_finish(&fixture.repo, "release/blocked", Default::default())
                .unwrap();
        let source = fixture.git(&["rev-parse", "HEAD"]);
        fixture.git(&["update-ref", "refs/heads/develop", &source]);
        let refs = fixture.refs();
        assert!(
            finish_branch_workflow(&fixture.repo, &plan, &CancellationToken::default()).is_err()
        );
        assert_eq!(fixture.refs(), refs);
    }

    #[test]
    fn an_interrupted_applied_merge_is_reconciled_without_replaying_it() {
        let fixture = Fixture::new();
        fixture.setup();
        topic(&fixture, "hotfix/restart", "hotfix\n");
        let plan =
            prepare_branch_workflow_finish(&fixture.repo, "hotfix/restart", Default::default())
                .unwrap();
        let journal = pending(&fixture, plan.clone(), BranchWorkflowFinishPhase::Merging);
        fixture.git(&["checkout", "-q", "main"]);
        fixture.git(&[
            "merge",
            "--no-ff",
            "-m",
            &plan.targets[0].message,
            &plan.source_oid,
        ]);
        let applied = fixture.git(&["rev-parse", "main"]);
        let status = resume_branch_workflow_finish(
            &fixture.repo,
            &journal.status.id,
            0,
            false,
            &CancellationToken::default(),
        )
        .unwrap();
        assert_eq!(
            status.phase,
            BranchWorkflowFinishPhase::Complete,
            "{:?}",
            status.notice
        );
        assert_eq!(status.completed_targets[0], applied);
        assert_eq!(fixture.git(&["rev-parse", "main"]), applied);
        assert_contains(&fixture, &plan.source_oid, "develop");
    }

    #[test]
    fn an_unconfirmed_unapplied_merge_needs_a_new_explicit_retry_and_consumes_revisions() {
        let fixture = Fixture::new();
        fixture.setup();
        topic(&fixture, "feature/retry", "feature\n");
        fixture.git(&["checkout", "-q", "develop"]);
        let plan =
            prepare_branch_workflow_finish(&fixture.repo, "feature/retry", Default::default())
                .unwrap();
        let journal = pending(&fixture, plan, BranchWorkflowFinishPhase::Merging);
        let refs = fixture.refs();
        let index = fixture.index();
        let paused = resume_branch_workflow_finish(
            &fixture.repo,
            &journal.status.id,
            0,
            false,
            &CancellationToken::default(),
        )
        .unwrap();
        assert_eq!(paused.phase, BranchWorkflowFinishPhase::Merging);
        assert!(paused.retry_required);
        assert_eq!(fixture.refs(), refs);
        assert_eq!(fixture.index(), index);
        assert!(
            resume_branch_workflow_finish(
                &fixture.repo,
                &paused.id,
                0,
                true,
                &CancellationToken::default()
            )
            .is_err()
        );
        let completed = resume_branch_workflow_finish(
            &fixture.repo,
            &paused.id,
            paused.revision,
            true,
            &CancellationToken::default(),
        )
        .unwrap();
        assert_eq!(
            completed.phase,
            BranchWorkflowFinishPhase::Complete,
            "{:?}",
            completed.notice
        );
    }

    #[test]
    fn unfinished_records_are_shared_but_cannot_be_executed_from_another_worktree() {
        let fixture = Fixture::new();
        fixture.setup();
        topic(&fixture, "feature/owner", "feature\n");
        fixture.git(&["checkout", "-q", "main"]);
        let plan =
            prepare_branch_workflow_finish(&fixture.repo, "feature/owner", Default::default())
                .unwrap();
        let journal = pending(&fixture, plan, BranchWorkflowFinishPhase::Ready);
        let linked = fixture.root.join("linked");
        fixture.git(&[
            "worktree",
            "add",
            "-q",
            "-b",
            "ordinary",
            linked.to_str().unwrap(),
        ]);
        assert_eq!(
            load_branch_workflow_finish(&linked).unwrap().unwrap().id,
            journal.status.id
        );
        let refs = fixture.refs();
        assert!(
            resume_branch_workflow_finish(
                &linked,
                &journal.status.id,
                0,
                false,
                &CancellationToken::default()
            )
            .is_err()
        );
        assert_eq!(fixture.refs(), refs);
    }

    #[test]
    fn topic_cleanup_is_bound_to_the_reviewed_tip_even_when_its_upstream_is_behind() {
        let fixture = Fixture::new();
        fixture.setup();
        let base = fixture.git(&["rev-parse", "HEAD"]);
        topic(&fixture, "feature/published", "feature\n");
        fixture.git(&["config", "remote.owned.url", "/owned-offline-remote"]);
        fixture.git(&[
            "config",
            "remote.owned.fetch",
            "+refs/heads/*:refs/remotes/owned/*",
        ]);
        fixture.git(&["update-ref", "refs/remotes/owned/feature/published", &base]);
        fixture.git(&[
            "branch",
            "--set-upstream-to=owned/feature/published",
            "feature/published",
        ]);
        let status = finish(&fixture, "feature/published", Default::default());
        assert_eq!(
            status.phase,
            BranchWorkflowFinishPhase::Complete,
            "{:?}",
            status.notice
        );
        assert!(
            direct_tip(&fixture.repo, "feature/published")
                .unwrap()
                .is_none()
        );
        assert_eq!(
            fixture.git(&["rev-parse", "refs/remotes/owned/feature/published"]),
            base
        );
    }

    #[cfg(unix)]
    #[test]
    fn applied_checkout_hook_failure_is_not_replayed_when_the_workflow_continues() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = Fixture::new();
        fixture.setup();
        topic(&fixture, "feature/hook", "feature\n");
        let hook = fixture.root.join("hooks/post-checkout");
        fs::write(&hook, "#!/bin/sh\nprintf called >> \"$(git rev-parse --git-path workflow-checkout-count)\"\nexit 1\n").unwrap();
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o700)).unwrap();
        let status = finish(&fixture, "feature/hook", Default::default());
        assert_eq!(status.phase, BranchWorkflowFinishPhase::CheckingOut);
        assert!(status.completed_targets.is_empty());
        let resumed = resume_branch_workflow_finish(
            &fixture.repo,
            &status.id,
            status.revision,
            false,
            &CancellationToken::default(),
        )
        .unwrap();
        assert_eq!(
            resumed.phase,
            BranchWorkflowFinishPhase::Complete,
            "{:?}",
            resumed.notice
        );
        assert_eq!(
            fs::read(fixture.repo.join(".git/workflow-checkout-count")).unwrap(),
            b"called"
        );
    }

    #[cfg(unix)]
    #[test]
    fn signing_failure_retains_integrations_and_new_review_can_finish_without_remerging() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = Fixture::new();
        fixture.setup();
        topic(&fixture, "release/signing", "release\n");
        let signer = fixture.root.join("owned-signer");
        fs::write(&signer, "#!/bin/sh\nexit 1\n").unwrap();
        fs::set_permissions(&signer, fs::Permissions::from_mode(0o700)).unwrap();
        fixture.git(&["config", "gpg.program", signer.to_str().unwrap()]);
        let options = BranchWorkflowFinishOptions {
            tag: Some(BranchWorkflowTagRequest {
                message: "Owned release".into(),
                sign: Some(true),
            }),
            delete_topic: true,
            ..Default::default()
        };
        let status = finish(&fixture, "release/signing", options);
        assert_eq!(
            status.phase,
            BranchWorkflowFinishPhase::Tagging,
            "{:?}",
            status.notice
        );
        assert_eq!(status.completed_targets.len(), 2);
        assert!(tag_object(&fixture.repo, "signing").unwrap().is_none());
        assert!(
            direct_tip(&fixture.repo, "release/signing")
                .unwrap()
                .is_some()
        );
        let production = fixture.git(&["rev-parse", "main"]);
        let development = fixture.git(&["rev-parse", "develop"]);
        let aborted = abort_branch_workflow_finish(
            &fixture.repo,
            &status.id,
            status.revision,
            &CancellationToken::default(),
        )
        .unwrap();
        acknowledge_branch_workflow_finish(&fixture.repo, &aborted.id, aborted.revision).unwrap();
        let options = BranchWorkflowFinishOptions {
            tag: Some(BranchWorkflowTagRequest {
                message: "Owned release".into(),
                sign: Some(false),
            }),
            delete_topic: true,
            ..Default::default()
        };
        let completed = finish(&fixture, "release/signing", options);
        assert_eq!(
            completed.phase,
            BranchWorkflowFinishPhase::Complete,
            "{:?}",
            completed.notice
        );
        assert_eq!(fixture.git(&["rev-parse", "main"]), production);
        assert_eq!(fixture.git(&["rev-parse", "develop"]), development);
        assert_eq!(fixture.git(&["rev-parse", "signing^{commit}"]), production);
    }

    #[cfg(unix)]
    #[test]
    fn linked_or_corrupt_workflow_metadata_is_not_followed_or_erased() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        fixture.setup();
        topic(&fixture, "feature/metadata", "feature\n");
        let outside = fixture.root.join("outside");
        fs::write(&outside, b"owned outside data").unwrap();
        let record = common_journal(&fixture.repo).unwrap();
        symlink(&outside, &record).unwrap();
        let refs = fixture.refs();
        assert!(load_branch_workflow_finish(&fixture.repo).is_err());
        assert!(
            prepare_branch_workflow_finish(&fixture.repo, "feature/metadata", Default::default())
                .is_err()
        );
        assert_eq!(fixture.refs(), refs);
        assert_eq!(fs::read(&outside).unwrap(), b"owned outside data");
        fs::remove_file(&record).unwrap();
        fs::write(&record, b"malformed owned record").unwrap();
        assert!(load_branch_workflow_finish(&fixture.repo).is_err());
        assert!(acknowledge_branch_workflow_finish(&fixture.repo, "invalid", 0).is_err());
        assert_eq!(fs::read(record).unwrap(), b"malformed owned record");
    }

    #[test]
    fn initial_publication_never_replaces_an_existing_complete_record() {
        let fixture = Fixture::new();
        fixture.setup();
        topic(&fixture, "feature/publication", "feature\n");
        let plan = prepare_branch_workflow_finish(
            &fixture.repo,
            "feature/publication",
            Default::default(),
        )
        .unwrap();
        let mut journal = pending(&fixture, plan, BranchWorkflowFinishPhase::Ready);
        let record = common_journal(&fixture.repo).unwrap();
        let before = fs::read(&record).unwrap();
        journal.status.revision += 1;
        assert!(save_journal(&fixture.repo, &mut journal, true).is_err());
        assert_eq!(fs::read(&record).unwrap(), before);
        let temporary_count = fs::read_dir(record.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().starts_with(".active-"))
            .count();
        assert_eq!(temporary_count, 0);
    }

    #[test]
    fn impossible_saved_stages_are_refused_without_erasing_the_record() {
        let fixture = Fixture::new();
        fixture.setup();
        topic(&fixture, "feature/stages", "feature\n");
        let plan =
            prepare_branch_workflow_finish(&fixture.repo, "feature/stages", Default::default())
                .unwrap();
        let mut journal = pending(&fixture, plan, BranchWorkflowFinishPhase::Ready);
        let record = common_journal(&fixture.repo).unwrap();
        let refs = fixture.refs();
        for phase in [
            BranchWorkflowFinishPhase::Tagging,
            BranchWorkflowFinishPhase::Cleaning,
            BranchWorkflowFinishPhase::Complete,
        ] {
            journal.status.phase = phase;
            let bytes = serde_json::to_vec(&journal.status).unwrap();
            fs::write(&record, &bytes).unwrap();
            assert!(load_branch_workflow_finish(&fixture.repo).is_err());
            assert_eq!(fs::read(&record).unwrap(), bytes);
            assert_eq!(fixture.refs(), refs);
        }
    }

    #[test]
    fn saved_completion_without_the_reviewed_ancestry_cannot_trigger_cleanup() {
        let fixture = Fixture::new();
        fixture.setup();
        topic(&fixture, "feature/ancestry", "feature\n");
        let plan =
            prepare_branch_workflow_finish(&fixture.repo, "feature/ancestry", Default::default())
                .unwrap();
        let mut journal = pending(&fixture, plan, BranchWorkflowFinishPhase::Ready);
        journal
            .status
            .completed_targets
            .push(journal.status.plan.targets[0].oid.clone());
        save_journal(&fixture.repo, &mut journal, false).unwrap();
        let refs = fixture.refs();
        let record = fs::read(common_journal(&fixture.repo).unwrap()).unwrap();
        assert!(
            resume_branch_workflow_finish(
                &fixture.repo,
                &journal.status.id,
                0,
                true,
                &CancellationToken::default()
            )
            .is_err()
        );
        assert_eq!(fixture.refs(), refs);
        assert_eq!(
            fs::read(common_journal(&fixture.repo).unwrap()).unwrap(),
            record
        );
    }

    #[test]
    fn replacing_a_completed_tag_blocks_later_topic_cleanup() {
        let fixture = Fixture::new();
        fixture.setup();
        topic(&fixture, "release/tag-check", "release\n");
        let status = finish(&fixture, "release/tag-check", Default::default());
        assert_eq!(status.phase, BranchWorkflowFinishPhase::Complete);
        let mut journal = load_journal(&fixture.repo).unwrap().unwrap();
        journal.status.phase = BranchWorkflowFinishPhase::Cleaning;
        journal.status.plan.delete_topic = true;
        save_journal(&fixture.repo, &mut journal, false).unwrap();
        fixture.git(&[
            "tag",
            "--annotate",
            "--no-sign",
            "--message",
            "Other annotation",
            "other-owned-tag",
            &status.completed_targets[0],
        ]);
        let replacement = fixture.git(&["rev-parse", "refs/tags/other-owned-tag"]);
        fixture.git(&["update-ref", "refs/tags/tag-check", &replacement]);
        let refs = fixture.refs();
        assert!(
            resume_branch_workflow_finish(
                &fixture.repo,
                &status.id,
                status.revision,
                true,
                &CancellationToken::default()
            )
            .is_err()
        );
        assert_eq!(fixture.refs(), refs);
        assert!(
            direct_tip(&fixture.repo, "release/tag-check")
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn abort_after_a_completed_merge_with_leftover_metadata_retains_the_commit() {
        let fixture = Fixture::new();
        fixture.setup();
        topic(&fixture, "feature/completed-abort", "feature\n");
        let plan = prepare_branch_workflow_finish(
            &fixture.repo,
            "feature/completed-abort",
            Default::default(),
        )
        .unwrap();
        fixture.git(&["checkout", "-q", "develop"]);
        let journal = pending(&fixture, plan, BranchWorkflowFinishPhase::Merging);
        fixture.git(&[
            "merge",
            "--no-ff",
            "--no-edit",
            &journal.status.plan.source_oid,
        ]);
        let applied = fixture.git(&["rev-parse", "HEAD"]);
        fs::write(
            fixture.repo.join(".git/MERGE_HEAD"),
            format!("{}\n", journal.status.plan.source_oid),
        )
        .unwrap();
        let index = fixture.index();
        let aborted = abort_branch_workflow_finish(
            &fixture.repo,
            &journal.status.id,
            0,
            &CancellationToken::default(),
        )
        .unwrap();
        assert_eq!(aborted.phase, BranchWorkflowFinishPhase::Aborted);
        assert_eq!(aborted.completed_targets, vec![applied.clone()]);
        assert_eq!(fixture.git(&["rev-parse", "HEAD"]), applied);
        assert_eq!(fixture.index(), index);
        assert_eq!(
            fs::read(fixture.repo.join("file.txt")).unwrap(),
            b"feature\n"
        );
        assert!(
            direct_tip(&fixture.repo, "feature/completed-abort")
                .unwrap()
                .is_some()
        );
        assert!(!read_status(&fixture.repo).unwrap().merge_in_progress);
    }

    #[test]
    fn leftover_completed_merge_metadata_is_retained_if_working_files_changed() {
        let fixture = Fixture::new();
        fixture.setup();
        topic(&fixture, "feature/completed-dirty", "feature\n");
        let plan = prepare_branch_workflow_finish(
            &fixture.repo,
            "feature/completed-dirty",
            Default::default(),
        )
        .unwrap();
        fixture.git(&["checkout", "-q", "develop"]);
        let journal = pending(&fixture, plan, BranchWorkflowFinishPhase::Merging);
        fixture.git(&[
            "merge",
            "--no-ff",
            "--no-edit",
            &journal.status.plan.source_oid,
        ]);
        let applied = fixture.git(&["rev-parse", "HEAD"]);
        let metadata = format!("{}\n", journal.status.plan.source_oid);
        fs::write(fixture.repo.join(".git/MERGE_HEAD"), &metadata).unwrap();
        fs::write(fixture.repo.join("file.txt"), b"new owned work\n").unwrap();
        let paused = resume_branch_workflow_finish(
            &fixture.repo,
            &journal.status.id,
            0,
            false,
            &CancellationToken::default(),
        )
        .unwrap();
        assert_eq!(paused.phase, BranchWorkflowFinishPhase::Merging);
        assert!(paused.notice.is_some());
        assert_eq!(fixture.git(&["rev-parse", "HEAD"]), applied);
        assert_eq!(
            fs::read_to_string(fixture.repo.join(".git/MERGE_HEAD")).unwrap(),
            metadata
        );
        assert_eq!(
            fs::read(fixture.repo.join("file.txt")).unwrap(),
            b"new owned work\n"
        );
        assert!(
            direct_tip(&fixture.repo, "feature/completed-dirty")
                .unwrap()
                .is_some()
        );
    }

    #[cfg(unix)]
    #[test]
    fn cancelling_a_running_post_merge_hook_retains_the_merge_without_replaying_it() {
        use std::os::unix::fs::PermissionsExt;
        use std::time::{Duration, Instant};
        let fixture = Fixture::new();
        fixture.setup();
        topic(&fixture, "feature/cancel-hook", "feature\n");
        let hook = fixture.root.join("hooks/post-merge");
        fs::write(
            &hook,
            r#"#!/bin/sh
printf called >> "$(git rev-parse --git-path workflow-merge-count)"
sleep 30 &
printf '%s' "$!" > "$(git rev-parse --git-path workflow-hook-child)"
wait
"#,
        )
        .unwrap();
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o700)).unwrap();
        let plan = prepare_branch_workflow_finish(
            &fixture.repo,
            "feature/cancel-hook",
            Default::default(),
        )
        .unwrap();
        let cancellation = CancellationToken::default();
        let worker_token = cancellation.clone();
        let repo = fixture.repo.clone();
        let (sender, receiver) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let result = finish_branch_workflow(&repo, &plan, &worker_token);
            let _ = sender.send(result);
        });
        let marker = fixture.repo.join(".git/workflow-hook-child");
        let deadline = Instant::now() + Duration::from_secs(15);
        while !marker.exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        let reached_hook = marker.exists();
        cancellation.cancel();
        let status = receiver
            .recv_timeout(Duration::from_secs(10))
            .expect("cancellation must settle")
            .unwrap();
        worker.join().unwrap();
        assert!(
            reached_hook,
            "owned hook was never reached: {:?}",
            status.notice
        );
        assert_eq!(
            status.phase,
            BranchWorkflowFinishPhase::Merging,
            "{:?}",
            status.notice
        );
        assert!(status.completed_targets.is_empty());
        assert!(
            status
                .notice
                .as_deref()
                .unwrap()
                .contains("completed integration is verified")
        );
        assert!(status.notice.is_some());
        assert!(
            direct_tip(&fixture.repo, "feature/cancel-hook")
                .unwrap()
                .is_some()
        );
        let applied = fixture.git(&["rev-parse", "develop"]);
        fs::remove_file(&hook).unwrap();
        let resumed = resume_branch_workflow_finish(
            &fixture.repo,
            &status.id,
            status.revision,
            false,
            &CancellationToken::default(),
        )
        .unwrap();
        assert_eq!(resumed.phase, BranchWorkflowFinishPhase::Complete);
        assert_eq!(fixture.git(&["rev-parse", "develop"]), applied);
        assert_eq!(
            fs::read(fixture.repo.join(".git/workflow-merge-count")).unwrap(),
            b"called"
        );
        #[cfg(target_os = "linux")]
        {
            let pid = fs::read_to_string(marker).unwrap();
            if let Ok(stat) = fs::read_to_string(format!("/proc/{pid}/stat")) {
                let state = stat.rsplit_once(") ").unwrap().1.chars().next().unwrap();
                assert_eq!(state, 'Z', "owned hook descendant is still running");
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn cancelling_a_prepared_backup_transaction_does_not_start_finish() {
        use super::super::tests::{blocking_hook, cancel_at_owned_hook};
        let fixture = Fixture::new();
        fixture.setup();
        topic(&fixture, "feature/backup-prepared", "feature\n");
        let plan = prepare_branch_workflow_finish(
            &fixture.repo,
            "feature/backup-prepared",
            Default::default(),
        )
        .unwrap();
        blocking_hook(&fixture, "reference-transaction", Some("prepared"));
        let refs = fixture.refs();
        let index = fixture.index();
        let repo = fixture.repo.clone();
        let error = cancel_at_owned_hook(&fixture, move |token| {
            finish_branch_workflow(&repo, &plan, &token)
        })
        .unwrap_err();
        assert_eq!(error.kind, "operationCancelled");
        assert_eq!(fixture.refs(), refs);
        assert_eq!(fixture.index(), index);
        assert!(
            operation_recovery::operation_recoveries(&fixture.repo)
                .unwrap()
                .is_empty()
        );
        assert!(!finish_pending(&fixture.repo).unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn cancelling_a_committed_backup_keeps_a_discoverable_recovery_record_without_starting_finish()
    {
        use super::super::tests::{blocking_hook, cancel_at_owned_hook};
        let fixture = Fixture::new();
        fixture.setup();
        let source = topic(&fixture, "feature/backup-committed", "feature\n");
        let plan = prepare_branch_workflow_finish(
            &fixture.repo,
            "feature/backup-committed",
            Default::default(),
        )
        .unwrap();
        let heads = fixture.git(&[
            "for-each-ref",
            "--format=%(refname) %(objectname)",
            "refs/heads/",
        ]);
        let index = fixture.index();
        blocking_hook(&fixture, "reference-transaction", Some("committed"));
        let repo = fixture.repo.clone();
        let error = cancel_at_owned_hook(&fixture, move |token| {
            finish_branch_workflow(&repo, &plan, &token)
        })
        .unwrap_err();
        assert_eq!(error.kind, "recoveryCaptureStopped");
        assert_eq!(
            fixture.git(&[
                "for-each-ref",
                "--format=%(refname) %(objectname)",
                "refs/heads/"
            ]),
            heads
        );
        assert_eq!(fixture.index(), index);
        assert!(!finish_pending(&fixture.repo).unwrap());
        let records = operation_recovery::operation_recoveries(&fixture.repo).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].head_oid, source);
        assert_eq!(
            fixture.git(&["rev-parse", &records[0].head_reference]),
            source
        );
        assert!(error.hint.unwrap().contains(&records[0].head_reference));
    }

    #[test]
    fn missing_changed_or_symbolic_recovery_refs_and_missing_records_refuse_further_stages() {
        for damage in ["missing", "changed", "symbolic", "record"] {
            let fixture = Fixture::new();
            fixture.setup();
            topic(&fixture, "feature/recovery-binding", "feature\n");
            let plan = prepare_branch_workflow_finish(
                &fixture.repo,
                "feature/recovery-binding",
                Default::default(),
            )
            .unwrap();
            let journal = pending(&fixture, plan, BranchWorkflowFinishPhase::Ready);
            let capture = &journal.status.recovery[0];
            match damage {
                "missing" => {
                    fixture.git(&["update-ref", "-d", &capture.head_reference]);
                }
                "changed" => {
                    let other = fixture.git(&["rev-parse", "main"]);
                    fixture.git(&["update-ref", &capture.head_reference, &other]);
                }
                "symbolic" => {
                    fixture.git(&[
                        "symbolic-ref",
                        &capture.head_reference,
                        "refs/heads/feature/recovery-binding",
                    ]);
                }
                "record" => {
                    let path = discard::recovery_directory(&fixture.repo)
                        .unwrap()
                        .join(format!("{}.json", capture.id));
                    fs::remove_file(path).unwrap();
                }
                _ => unreachable!(),
            }
            let refs = fixture.refs();
            let index = fixture.index();
            let record = fs::read(common_journal(&fixture.repo).unwrap()).unwrap();
            let error = resume_branch_workflow_finish(
                &fixture.repo,
                &journal.status.id,
                0,
                true,
                &CancellationToken::default(),
            )
            .unwrap_err();
            assert!(
                error.message.contains("recovery"),
                "{damage}: {}",
                error.message
            );
            assert_eq!(fixture.refs(), refs, "{damage}");
            assert_eq!(fixture.index(), index, "{damage}");
            assert_eq!(
                fs::read(common_journal(&fixture.repo).unwrap()).unwrap(),
                record,
                "{damage}"
            );
            assert_eq!(
                fixture.git(&["symbolic-ref", "HEAD"]),
                "refs/heads/feature/recovery-binding"
            );
        }
    }
}
