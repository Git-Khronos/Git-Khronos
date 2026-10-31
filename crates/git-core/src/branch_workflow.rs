use super::*;

#[path = "branch_workflow_finish.rs"]
mod finish;
pub use finish::{
    BranchWorkflowFinishOptions, BranchWorkflowFinishPhase, BranchWorkflowFinishPlan,
    BranchWorkflowFinishStatus, BranchWorkflowFinishTag, BranchWorkflowFinishTarget,
    BranchWorkflowHead, BranchWorkflowMergePolicy, BranchWorkflowTagRequest,
    abort_branch_workflow_finish, acknowledge_branch_workflow_finish, finish_branch_workflow,
    load_branch_workflow_finish, prepare_branch_workflow_finish, resume_branch_workflow_finish,
};

const SETTINGS_KEY: &str = "gitkhronos.branchWorkflow";
const SETTINGS_LIMIT: usize = 16 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BranchWorkflowSettings {
    pub version: u32,
    pub production: String,
    pub development: String,
    pub feature_prefix: String,
    pub release_prefix: String,
    pub hotfix_prefix: String,
    pub tag_prefix: String,
}

impl Default for BranchWorkflowSettings {
    fn default() -> Self {
        Self {
            version: 1,
            production: "main".into(),
            development: "develop".into(),
            feature_prefix: "feature/".into(),
            release_prefix: "release/".into(),
            hotfix_prefix: "hotfix/".into(),
            tag_prefix: String::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum BranchWorkflowKind {
    Feature,
    Release,
    Hotfix,
}

impl BranchWorkflowSettings {
    fn prefix(&self, kind: BranchWorkflowKind) -> &str {
        match kind {
            BranchWorkflowKind::Feature => &self.feature_prefix,
            BranchWorkflowKind::Release => &self.release_prefix,
            BranchWorkflowKind::Hotfix => &self.hotfix_prefix,
        }
    }
    fn base(&self, kind: BranchWorkflowKind) -> &str {
        if kind == BranchWorkflowKind::Hotfix {
            &self.production
        } else {
            &self.development
        }
    }
    fn classify(&self, branch: &str) -> Option<(BranchWorkflowKind, String)> {
        if branch == self.production || branch == self.development {
            return None;
        }
        for kind in [
            BranchWorkflowKind::Feature,
            BranchWorkflowKind::Release,
            BranchWorkflowKind::Hotfix,
        ] {
            if let Some(suffix) = branch
                .strip_prefix(self.prefix(kind))
                .filter(|suffix| !suffix.is_empty())
            {
                return Some((kind, suffix.into()));
            }
        }
        None
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BranchWorkflowBinding {
    pub branch: String,
    pub expected_oid: Option<String>,
    pub create_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BranchWorkflowSetup {
    pub previous: Option<BranchWorkflowSettings>,
    pub settings: BranchWorkflowSettings,
    pub initial_oid: String,
    pub branches: Vec<BranchWorkflowBinding>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BranchWorkflowStart {
    pub settings: BranchWorkflowSettings,
    pub kind: BranchWorkflowKind,
    pub suffix: String,
    pub branch: String,
    pub base_branch: String,
    pub base_oid: String,
    pub previous_head_oid: String,
    pub previous_head_reference: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BranchWorkflowTopic {
    pub kind: BranchWorkflowKind,
    pub branch: String,
    pub suffix: String,
    pub oid: String,
    pub worktree: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BranchWorkflowState {
    pub settings: Option<BranchWorkflowSettings>,
    pub production_oid: Option<String>,
    pub development_oid: Option<String>,
    pub topics: Vec<BranchWorkflowTopic>,
    pub finish_pending: bool,
}

fn refused(message: impl Into<String>) -> AppError {
    AppError::new(
        "branchWorkflowRefused",
        message,
        Some("Inspect the repository and prepare a fresh workflow preview."),
    )
}

fn stale() -> AppError {
    refused("Workflow settings, branches or checkout state changed after preparation.")
}

fn branch_name(path: &Path, name: &str) -> Result<(), AppError> {
    if name.len() > 1024 {
        return Err(refused("The branch name is too long."));
    }
    validate_branch_name(path, name)?;
    // --branch also accepts checkout expressions. Full ref validation keeps the
    // requested branch literal instead of expanding expressions such as @{-1}.
    let output = run_git(path, &["check-ref-format", &format!("refs/heads/{name}")])?;
    ensure_success("validate a literal workflow branch", &output)
}

fn validate_settings(path: &Path, settings: &BranchWorkflowSettings) -> Result<(), AppError> {
    if settings.version != 1 || settings.production == settings.development {
        return Err(refused(
            "Choose distinct production and development branches and supported workflow settings.",
        ));
    }
    branch_name(path, &settings.production)?;
    branch_name(path, &settings.development)?;
    let prefixes = [
        &settings.feature_prefix,
        &settings.release_prefix,
        &settings.hotfix_prefix,
    ];
    for (i, prefix) in prefixes.iter().enumerate() {
        if prefix.is_empty()
            || prefix.trim() != *prefix
            || prefix.len() > 512
            || prefixes.iter().enumerate().any(|(j, other)| {
                i != j && (prefix.starts_with(other.as_str()) || other.starts_with(prefix.as_str()))
            })
        {
            return Err(refused("Use nonempty, nonoverlapping topic prefixes."));
        }
        branch_name(path, &format!("{prefix}probe"))?;
    }
    if settings.tag_prefix.len() > 512 || settings.tag_prefix.trim() != settings.tag_prefix {
        return Err(refused("Enter a valid tag prefix."));
    }
    let output = run_git(
        path,
        &[
            "check-ref-format",
            &format!("refs/tags/{}probe", settings.tag_prefix),
        ],
    )?;
    ensure_success("validate the workflow tag prefix", &output)?;
    if serde_json::to_vec(settings)
        .map_err(|_| refused("Could not encode workflow settings."))?
        .len()
        > SETTINGS_LIMIT
    {
        return Err(refused("Workflow settings exceed the storage limit."));
    }
    Ok(())
}

fn read_settings(path: &Path) -> Result<Option<BranchWorkflowSettings>, AppError> {
    let (output, truncated) = run_git_with_stdout_limit(
        path,
        &[
            "config",
            "--local",
            "--no-includes",
            "--null",
            "--get-all",
            SETTINGS_KEY,
        ],
        SETTINGS_LIMIT,
    )?;
    if truncated {
        return Err(refused(
            "Stored workflow settings exceed the supported limit.",
        ));
    }
    if output.status.code() == Some(1) && output.stdout.is_empty() {
        return Ok(None);
    }
    ensure_success("read repository-local workflow settings", &output)?;
    let Some(value) = output.stdout.strip_suffix(&[0]) else {
        return Err(refused("Stored workflow settings are incomplete."));
    };
    if value.contains(&0) {
        return Err(refused(
            "Multiple workflow configurations are present. Inspect the repository-local setting.",
        ));
    }
    let settings: BranchWorkflowSettings = serde_json::from_slice(value).map_err(|_| {
        refused("Stored workflow settings have an unsupported or malformed format.")
    })?;
    validate_settings(path, &settings)?;
    Ok(Some(settings))
}

fn direct_tip(path: &Path, branch: &str) -> Result<Option<String>, AppError> {
    branch_name(path, branch)?;
    let reference = format!("refs/heads/{branch}");
    let symbolic = run_git(path, &["symbolic-ref", "--quiet", &reference])?;
    if symbolic.status.success() {
        return Err(refused(
            "Workflow branches must be direct local branch references.",
        ));
    }
    if symbolic.status.code() != Some(1) {
        ensure_success("inspect workflow reference identity", &symbolic)?;
    }
    let exists = run_git(path, &["show-ref", "--verify", "--quiet", &reference])?;
    if exists.status.code() == Some(1) {
        return Ok(None);
    }
    ensure_success("check whether the workflow branch exists", &exists)?;
    let output = run_git(path, &["show-ref", "--verify", "--hash", &reference])?;
    ensure_success("read a workflow branch tip", &output)?;
    let value = std::str::from_utf8(&output.stdout)
        .map_err(|_| refused("A workflow branch has an unsupported object ID."))?
        .trim();
    commit_object(path, value)?;
    Ok(Some(value.into()))
}

fn commit_object(path: &Path, oid: &str) -> Result<(), AppError> {
    validate_commit_oid(oid)?;
    let output = run_git(path, &["cat-file", "-t", oid])?;
    ensure_success("verify the workflow commit exists", &output)?;
    if output.stdout != b"commit\n" {
        return Err(refused(
            "Workflow branches and initialization points must refer to commit objects.",
        ));
    }
    Ok(())
}

fn common_journal(path: &Path) -> Result<PathBuf, AppError> {
    let output = run_git(
        path,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    ensure_success("locate shared workflow state", &output)?;
    let text = std::str::from_utf8(&output.stdout)
        .map_err(|_| refused("The shared Git directory has an unsupported path."))?;
    let common = Path::new(text.strip_suffix('\n').unwrap_or(text));
    if !common.is_absolute() || !common.is_dir() {
        return Err(refused(
            "Git did not return a valid shared repository directory.",
        ));
    }
    let directory = common.join("git-khronos-branch-workflow");
    operation_storage::directory(&directory)?;
    Ok(directory.join("active.json"))
}

struct ActionGuard {
    _file: fs::File,
}

fn action_guard(path: &Path) -> Result<ActionGuard, AppError> {
    let journal = common_journal(path)?;
    let directory = journal.parent().expect("workflow journal has a parent");
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    if let Err(error) = builder.create(directory)
        && error.kind() != std::io::ErrorKind::AlreadyExists
    {
        return Err(refused(format!(
            "Could not create shared workflow storage: {error}"
        )));
    }
    operation_storage::directory(directory)?;
    let lock = directory.join("action.lock");
    operation_storage::file(&lock)?;
    let mut options = fs::OpenOptions::new();
    options.read(true).write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = match options.open(&lock) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            operation_storage::file(&lock)?;
            fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&lock)
                .map_err(|e| refused(format!("Could not open the workflow action lock: {e}")))?
        }
        Err(error) => {
            return Err(refused(format!(
                "Could not create the workflow action lock: {error}"
            )));
        }
    };
    let metadata = operation_storage::file(&lock)?
        .ok_or_else(|| refused("The workflow action lock disappeared."))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let opened = file
            .metadata()
            .map_err(|e| refused(format!("Could not inspect the workflow action lock: {e}")))?;
        if opened.dev() != metadata.dev() || opened.ino() != metadata.ino() {
            return Err(refused(
                "The workflow action lock changed while opening it.",
            ));
        }
    }
    #[cfg(not(unix))]
    let _ = metadata;
    file.try_lock().map_err(|_| {
        refused("Another workflow action is active in this repository or a linked worktree.")
    })?;
    // Keep this file in place: unlinking a lock permits a second inode to be
    // locked independently. Closing this owned handle also releases crash locks.
    Ok(ActionGuard { _file: file })
}

fn finish_pending(path: &Path) -> Result<bool, AppError> {
    Ok(operation_storage::file(&common_journal(path)?)?.is_some())
}

fn require_no_finish(path: &Path) -> Result<(), AppError> {
    if finish_pending(path)? {
        return Err(refused(
            "A branch workflow is unfinished. Inspect or reconcile it before changing settings or starting another topic.",
        ));
    }
    Ok(())
}

fn clean_checkout(path: &Path) -> Result<(String, Option<String>), AppError> {
    require_no_git_sequence(path)?;
    require_visible_replay_index(path)?;
    let status = read_status(path)?;
    if status.entry_count != 0
        || status.entries_truncated
        || status.mail_patch_in_progress
        || status.bisect_in_progress
    {
        return Err(refused(
            "Save working changes and finish the active Git operation before starting a workflow branch.",
        ));
    }
    let head = run_git(path, &["rev-parse", "--verify", "HEAD"])?;
    ensure_success("read the current workflow checkout", &head)?;
    let oid = std::str::from_utf8(&head.stdout)
        .map_err(|_| refused("The current commit ID is unsupported."))?
        .trim()
        .to_owned();
    commit_object(path, &oid)?;
    let reference = run_git(path, &["symbolic-ref", "--quiet", "HEAD"])?;
    let reference = if reference.status.code() == Some(1) {
        None
    } else {
        ensure_success("read the current workflow branch", &reference)?;
        let text = std::str::from_utf8(&reference.stdout)
            .map_err(|_| refused("The checkout reference is unsupported."))?
            .trim()
            .to_owned();
        if !text.starts_with("refs/heads/") {
            return Err(refused(
                "The current checkout is outside the local branch namespace.",
            ));
        }
        Some(text)
    };
    Ok((oid, reference))
}

pub fn prepare_branch_workflow_setup(
    path: &Path,
    settings: BranchWorkflowSettings,
    initial_oid: &str,
) -> Result<BranchWorkflowSetup, AppError> {
    require_no_finish(path)?;
    require_no_git_sequence(path)?;
    validate_settings(path, &settings)?;
    commit_object(path, initial_oid)?;
    let previous = read_settings(path)?;
    let mut branches = Vec::new();
    for branch in [&settings.production, &settings.development] {
        let expected_oid = direct_tip(path, branch)?;
        let create_at = expected_oid.is_none().then(|| initial_oid.to_owned());
        branches.push(BranchWorkflowBinding {
            branch: branch.clone(),
            expected_oid,
            create_at,
        });
    }
    Ok(BranchWorkflowSetup {
        previous,
        settings,
        initial_oid: initial_oid.into(),
        branches,
    })
}

pub fn apply_branch_workflow_setup(
    path: &Path,
    plan: &BranchWorkflowSetup,
) -> Result<(), AppError> {
    let _guard = action_guard(path)?;
    if prepare_branch_workflow_setup(path, plan.settings.clone(), &plan.initial_oid)? != *plan {
        return Err(stale());
    }
    let mut transaction = String::from("start\n");
    for branch in &plan.branches {
        transaction.push_str("option no-deref\n");
        match (&branch.expected_oid, &branch.create_at) {
            (Some(oid), None) => {
                transaction.push_str(&format!("verify refs/heads/{} {oid}\n", branch.branch))
            }
            (None, Some(oid)) => {
                transaction.push_str(&format!("create refs/heads/{} {oid}\n", branch.branch))
            }
            _ => return Err(stale()),
        }
    }
    transaction.push_str("prepare\ncommit\n");
    run_git_with_input(
        path,
        &["update-ref", "--stdin"],
        transaction.as_bytes(),
        "initialize the reviewed workflow branches",
    )?;
    // Ref creation and Git configuration are separate stores. Never roll back
    // created branches when configuration changes or fails after the ref transaction.
    let partial = |message: String| {
        AppError::new(
            "branchWorkflowSetupPartial",
            message,
            Some(
                "Reviewed branch creation may have completed. Existing refs were not overwritten. Inspect local branches and settings before preparing again.",
            ),
        )
    };
    if read_settings(path).map_err(|e| partial(e.message))? != plan.previous {
        return Err(partial("Workflow settings changed after branch initialization; the new settings were not overwritten.".into()));
    }
    let value = serde_json::to_string(&plan.settings)
        .map_err(|_| partial("Could not encode workflow settings.".into()))?;
    let output = run_git(
        path,
        &["config", "--local", "--replace-all", SETTINGS_KEY, &value],
    )
    .map_err(|e| partial(e.message))?;
    ensure_success("save repository-local workflow settings", &output)
        .map_err(|e| partial(e.message))?;
    if read_settings(path).map_err(|e| partial(e.message))? != Some(plan.settings.clone()) {
        return Err(partial(
            "Workflow settings changed while they were being saved.".into(),
        ));
    }
    for branch in &plan.branches {
        if direct_tip(path, &branch.branch).map_err(|e| partial(e.message))?
            != branch
                .expected_oid
                .clone()
                .or_else(|| branch.create_at.clone())
        {
            return Err(partial(
                "A workflow branch changed during setup. Inspect the resulting refs and settings."
                    .into(),
            ));
        }
    }
    Ok(())
}

pub fn branch_workflow_state(path: &Path) -> Result<BranchWorkflowState, AppError> {
    let settings = read_settings(path)?;
    let finish_pending = finish_pending(path)?;
    let Some(configured) = &settings else {
        return Ok(BranchWorkflowState {
            settings,
            production_oid: None,
            development_oid: None,
            topics: Vec::new(),
            finish_pending,
        });
    };
    let production_oid = direct_tip(path, &configured.production)?;
    let development_oid = direct_tip(path, &configured.development)?;
    let status = read_status(path)?;
    let worktrees = read_worktrees(path, &status, false)?;
    let output = run_git(
        path,
        &["for-each-ref", "--format=%(refname)", "refs/heads/"],
    )?;
    ensure_success("list local workflow topics", &output)?;
    let text = std::str::from_utf8(&output.stdout)
        .map_err(|_| refused("A local branch has an unsupported name encoding."))?;
    let mut topics = Vec::new();
    for reference in text.lines() {
        let Some(branch) = reference.strip_prefix("refs/heads/") else {
            continue;
        };
        if let Some((kind, suffix)) = configured.classify(branch) {
            let oid = direct_tip(path, branch)?.ok_or_else(stale)?;
            let worktree = worktrees
                .iter()
                .find(|worktree| worktree.branch.as_deref() == Some(branch))
                .map(|worktree| worktree.path.clone());
            topics.push(BranchWorkflowTopic {
                kind,
                branch: branch.into(),
                suffix,
                oid,
                worktree,
            });
        }
    }
    Ok(BranchWorkflowState {
        settings,
        production_oid,
        development_oid,
        topics,
        finish_pending,
    })
}

pub fn prepare_branch_workflow_start(
    path: &Path,
    kind: BranchWorkflowKind,
    suffix: &str,
) -> Result<BranchWorkflowStart, AppError> {
    require_no_finish(path)?;
    let settings = read_settings(path)?
        .ok_or_else(|| refused("Configure this repository's branch workflow first."))?;
    if suffix.is_empty() || suffix.trim() != suffix || suffix.starts_with('-') || suffix.len() > 512
    {
        return Err(refused("Enter a valid, nonempty topic name."));
    }
    let branch = format!("{}{suffix}", settings.prefix(kind));
    branch_name(path, &branch)?;
    if direct_tip(path, &branch)?.is_some() {
        return Err(refused("That local workflow branch already exists."));
    }
    let base_branch = settings.base(kind).to_owned();
    let base_oid = direct_tip(path, &base_branch)?.ok_or_else(|| {
        refused(
            "The configured workflow base branch is missing. Review setup before starting a topic.",
        )
    })?;
    let (previous_head_oid, previous_head_reference) = clean_checkout(path)?;
    Ok(BranchWorkflowStart {
        settings,
        kind,
        suffix: suffix.into(),
        branch,
        base_branch,
        base_oid,
        previous_head_oid,
        previous_head_reference,
    })
}

pub fn start_branch_workflow(
    path: &Path,
    plan: &BranchWorkflowStart,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    let _guard = action_guard(path)?;
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    if prepare_branch_workflow_start(path, plan.kind, &plan.suffix)? != *plan {
        return Err(stale());
    }
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    let result = run_mutation_with_cancellation(
        path,
        &[
            "checkout",
            "--no-guess",
            "--no-overwrite-ignore",
            "--no-recurse-submodules",
            "--no-track",
            "-b",
            &plan.branch,
            &plan.base_oid,
            "--",
        ],
        "start the reviewed workflow branch",
        Some(cancellation),
    );
    if let Err(error) = result {
        return Err(AppError::new(
            "branchWorkflowStartStopped",
            format!(
                "Git stopped while starting {}. {}",
                plan.branch, error.message
            ),
            Some(
                "Inspect local branches, checkout and files before another request. A checkout hook or interrupted reply may follow an applied branch change.",
            ),
        ));
    }
    let (head, reference) = clean_checkout(path)?;
    if head != plan.base_oid
        || reference != Some(format!("refs/heads/{}", plan.branch))
        || direct_tip(path, &plan.branch)? != Some(plan.base_oid.clone())
    {
        return Err(AppError::new(
            "branchWorkflowStartStopped",
            "Checkout state changed after branch creation.",
            Some(
                "The branch may already exist. Inspect the repository and hook effects before continuing.",
            ),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(super) struct Fixture {
        pub(super) root: PathBuf,
        pub(super) repo: PathBuf,
    }
    impl Fixture {
        pub(super) fn new() -> Self {
            let mut random = [0; 16];
            getrandom::fill(&mut random).unwrap();
            let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
            let root = std::env::temp_dir().join(format!("khronos-workflow-{suffix}"));
            let repo = root.join("repo");
            fs::create_dir_all(&repo).unwrap();
            let fixture = Self { root, repo };
            fixture.git(&["init", "--template=", "-q", "-b", "main"]);
            let hooks = fixture.root.join("hooks");
            fs::create_dir(&hooks).unwrap();
            fixture.git(&["config", "core.hooksPath", hooks.to_str().unwrap()]);
            fixture.git(&["config", "core.fsmonitor", "false"]);
            fixture.git(&["config", "user.name", "Owned Workflow Fixture"]);
            fixture.git(&["config", "user.email", "owned-workflow@example.test"]);
            fixture.git(&["config", "commit.gpgsign", "false"]);
            fixture.git(&["config", "tag.gpgsign", "false"]);
            fixture.git(&["config", "tag.forceSignAnnotated", "false"]);
            fixture.git(&["config", "gpg.format", "openpgp"]);
            fixture.git(&["config", "user.signingkey", "owned-workflow-test-key"]);
            fixture.git(&["config", "core.autocrlf", "false"]);
            let empty_attributes = fixture.root.join("empty-attributes");
            fs::write(&empty_attributes, b"").unwrap();
            fixture.git(&[
                "config",
                "core.attributesFile",
                empty_attributes.to_str().unwrap(),
            ]);
            fixture.git(&[
                "config",
                "core.excludesFile",
                empty_attributes.to_str().unwrap(),
            ]);
            fixture.commit("base\n");
            fixture
        }
        pub(super) fn git(&self, args: &[&str]) -> String {
            let output = run_git(&self.repo, args).unwrap();
            assert!(
                output.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8(output.stdout).unwrap().trim().into()
        }
        pub(super) fn commit(&self, text: &str) -> String {
            fs::write(self.repo.join("file.txt"), text).unwrap();
            self.git(&["add", "file.txt"]);
            self.git(&["commit", "-qm", "Owned workflow change"]);
            self.git(&["rev-parse", "HEAD"])
        }
        pub(super) fn setup(&self) {
            let oid = self.git(&["rev-parse", "HEAD"]);
            let plan =
                prepare_branch_workflow_setup(&self.repo, BranchWorkflowSettings::default(), &oid)
                    .unwrap();
            apply_branch_workflow_setup(&self.repo, &plan).unwrap();
        }
        pub(super) fn refs(&self) -> String {
            self.git(&["show-ref"])
        }
        pub(super) fn index(&self) -> Vec<u8> {
            fs::read(self.repo.join(".git/index")).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn setup_preview_is_read_only_and_retains_existing_branch_tips() {
        let fixture = Fixture::new();
        let old = fixture.git(&["rev-parse", "HEAD"]);
        fixture.git(&["branch", "develop"]);
        let production = fixture.commit("production\n");
        let refs = fixture.refs();
        let index = fixture.index();
        let config = fs::read(fixture.repo.join(".git/config")).unwrap();
        let plan = prepare_branch_workflow_setup(
            &fixture.repo,
            BranchWorkflowSettings::default(),
            &production,
        )
        .unwrap();
        assert_eq!(fixture.refs(), refs);
        assert_eq!(fixture.index(), index);
        assert_eq!(fs::read(fixture.repo.join(".git/config")).unwrap(), config);
        assert_eq!(
            plan.branches[0].expected_oid.as_deref(),
            Some(production.as_str())
        );
        assert_eq!(plan.branches[1].expected_oid.as_deref(), Some(old.as_str()));
        assert!(
            plan.branches
                .iter()
                .all(|branch| branch.create_at.is_none())
        );
        apply_branch_workflow_setup(&fixture.repo, &plan).unwrap();
        assert_eq!(fixture.refs(), refs);
        assert_eq!(fixture.index(), index);
        assert_eq!(
            fs::read(fixture.repo.join("file.txt")).unwrap(),
            b"production\n"
        );
        assert_eq!(fixture.git(&["symbolic-ref", "HEAD"]), "refs/heads/main");
    }

    #[test]
    fn setup_creates_only_missing_reviewed_branches_without_switching() {
        let fixture = Fixture::new();
        let oid = fixture.git(&["rev-parse", "HEAD"]);
        let settings = BranchWorkflowSettings {
            production: "stable".into(),
            development: "integration".into(),
            ..Default::default()
        };
        let plan = prepare_branch_workflow_setup(&fixture.repo, settings.clone(), &oid).unwrap();
        assert!(
            plan.branches
                .iter()
                .all(|branch| branch.expected_oid.is_none()
                    && branch.create_at.as_deref() == Some(oid.as_str()))
        );
        apply_branch_workflow_setup(&fixture.repo, &plan).unwrap();
        assert_eq!(fixture.git(&["rev-parse", "stable"]), oid);
        assert_eq!(fixture.git(&["rev-parse", "integration"]), oid);
        assert_eq!(fixture.git(&["symbolic-ref", "HEAD"]), "refs/heads/main");
        assert_eq!(read_settings(&fixture.repo).unwrap(), Some(settings));
        assert_eq!(
            fixture
                .git(&["for-each-ref", "--format=%(refname)", "refs/heads/"])
                .lines()
                .count(),
            3
        );
    }

    #[test]
    fn setup_refuses_changed_refs_and_changed_settings_without_overwriting_them() {
        let fixture = Fixture::new();
        let oid = fixture.git(&["rev-parse", "HEAD"]);
        let plan =
            prepare_branch_workflow_setup(&fixture.repo, BranchWorkflowSettings::default(), &oid)
                .unwrap();
        fixture.git(&["branch", "develop"]);
        let refs = fixture.refs();
        assert!(apply_branch_workflow_setup(&fixture.repo, &plan).is_err());
        assert_eq!(fixture.refs(), refs);
        assert!(read_settings(&fixture.repo).unwrap().is_none());
        fixture.setup();
        let plan =
            prepare_branch_workflow_setup(&fixture.repo, BranchWorkflowSettings::default(), &oid)
                .unwrap();
        let changed = BranchWorkflowSettings {
            tag_prefix: "v".into(),
            ..Default::default()
        };
        fixture.git(&[
            "config",
            "--local",
            SETTINGS_KEY,
            &serde_json::to_string(&changed).unwrap(),
        ]);
        assert!(apply_branch_workflow_setup(&fixture.repo, &plan).is_err());
        assert_eq!(read_settings(&fixture.repo).unwrap(), Some(changed));
    }

    #[test]
    fn invalid_or_ambiguous_settings_never_fall_back_to_defaults() {
        let fixture = Fixture::new();
        let oid = fixture.git(&["rev-parse", "HEAD"]);
        for settings in [
            BranchWorkflowSettings {
                development: "main".into(),
                ..Default::default()
            },
            BranchWorkflowSettings {
                release_prefix: "feature/nested/".into(),
                ..Default::default()
            },
            BranchWorkflowSettings {
                production: "-stable".into(),
                ..Default::default()
            },
            BranchWorkflowSettings {
                feature_prefix: String::new(),
                ..Default::default()
            },
            BranchWorkflowSettings {
                development: "@{-1}".into(),
                ..Default::default()
            },
            BranchWorkflowSettings {
                tag_prefix: "bad..prefix".into(),
                ..Default::default()
            },
            BranchWorkflowSettings {
                version: 9,
                ..Default::default()
            },
        ] {
            assert!(prepare_branch_workflow_setup(&fixture.repo, settings, &oid).is_err());
        }
        for value in ["{}", "null", "not json"] {
            fixture.git(&["config", "--local", SETTINGS_KEY, value]);
            assert!(branch_workflow_state(&fixture.repo).is_err());
            assert_eq!(
                fixture.git(&["config", "--local", "--get", SETTINGS_KEY]),
                value
            );
        }
        let value = serde_json::to_string(&BranchWorkflowSettings::default()).unwrap();
        fixture.git(&["config", "--local", "--replace-all", SETTINGS_KEY, &value]);
        fixture.git(&["config", "--local", "--add", SETTINGS_KEY, &value]);
        assert!(branch_workflow_state(&fixture.repo).is_err());
        assert_eq!(
            fixture.git(&["for-each-ref", "--format=%(refname)", "refs/heads/"]),
            "refs/heads/main"
        );
    }

    #[test]
    fn topics_include_manual_local_prefixes_and_report_linked_checkout_occupancy() {
        let fixture = Fixture::new();
        fixture.setup();
        for branch in ["feature/manual", "release/1.0", "hotfix/修正", "ordinary"] {
            fixture.git(&["branch", branch]);
        }
        let oid = fixture.git(&["rev-parse", "HEAD"]);
        fixture.git(&[
            "update-ref",
            "refs/remotes/origin/feature/remote-only",
            &oid,
        ]);
        let linked = fixture.root.join("linked");
        fixture.git(&[
            "worktree",
            "add",
            "-q",
            linked.to_str().unwrap(),
            "feature/manual",
        ]);
        let state = branch_workflow_state(&fixture.repo).unwrap();
        assert_eq!(
            state
                .topics
                .iter()
                .map(|topic| topic.branch.as_str())
                .collect::<Vec<_>>(),
            ["feature/manual", "hotfix/修正", "release/1.0"]
        );
        assert_eq!(state.topics[0].worktree.as_deref(), linked.to_str());
        assert_eq!(state.topics[1].kind, BranchWorkflowKind::Hotfix);
        assert_eq!(state.topics[1].suffix, "修正");
        assert!(!state.finish_pending);
        assert_eq!(state.production_oid.as_deref(), Some(oid.as_str()));
    }

    #[test]
    fn feature_and_release_start_at_development_and_hotfix_at_production() {
        let fixture = Fixture::new();
        fixture.setup();
        let production = fixture.git(&["rev-parse", "main"]);
        fixture.git(&["checkout", "-q", "develop"]);
        let development = fixture.commit("development\n");
        fixture.git(&["checkout", "-q", "main"]);
        for (kind, name, expected) in [
            (BranchWorkflowKind::Feature, "feature/topic", &development),
            (BranchWorkflowKind::Release, "release/topic", &development),
            (BranchWorkflowKind::Hotfix, "hotfix/topic", &production),
        ] {
            let refs = fixture.refs();
            let index = fixture.index();
            let plan = prepare_branch_workflow_start(&fixture.repo, kind, "topic").unwrap();
            assert_eq!(fixture.refs(), refs);
            assert_eq!(fixture.index(), index);
            assert_eq!(&plan.base_oid, expected);
            assert_eq!(plan.branch, name);
            start_branch_workflow(&fixture.repo, &plan, &CancellationToken::default()).unwrap();
            assert_eq!(
                fixture.git(&["symbolic-ref", "HEAD"]),
                format!("refs/heads/{name}")
            );
            assert_eq!(&fixture.git(&["rev-parse", "HEAD"]), expected);
            let tracking = run_git(
                &fixture.repo,
                &["config", "--local", "--get-regexp", "^branch\\."],
            )
            .unwrap();
            assert_eq!(tracking.status.code(), Some(1));
            assert!(tracking.stdout.is_empty());
            fixture.git(&["checkout", "-q", "main"]);
        }
    }

    #[test]
    fn stale_dirty_and_cancelled_starts_do_not_create_a_topic() {
        let fixture = Fixture::new();
        fixture.setup();
        let plan =
            prepare_branch_workflow_start(&fixture.repo, BranchWorkflowKind::Feature, "stale")
                .unwrap();
        let new = fixture.commit("advanced\n");
        fixture.git(&["update-ref", "refs/heads/develop", &new]);
        let refs = fixture.refs();
        assert!(
            start_branch_workflow(&fixture.repo, &plan, &CancellationToken::default()).is_err()
        );
        assert_eq!(fixture.refs(), refs);
        fs::write(fixture.repo.join("file.txt"), "unsaved\n").unwrap();
        assert!(
            prepare_branch_workflow_start(&fixture.repo, BranchWorkflowKind::Feature, "dirty")
                .is_err()
        );
        assert_eq!(
            fs::read(fixture.repo.join("file.txt")).unwrap(),
            b"unsaved\n"
        );
        fixture.git(&["checkout", "--", "file.txt"]);
        let plan =
            prepare_branch_workflow_start(&fixture.repo, BranchWorkflowKind::Feature, "cancelled")
                .unwrap();
        let token = CancellationToken::default();
        token.cancel();
        assert_eq!(
            start_branch_workflow(&fixture.repo, &plan, &token)
                .unwrap_err()
                .kind,
            "operationCancelled"
        );
        assert_eq!(fixture.refs(), refs);
    }

    #[test]
    fn ignored_checkout_collisions_are_preserved_and_never_force_overwritten() {
        let fixture = Fixture::new();
        fixture.setup();
        fixture.git(&["checkout", "-q", "develop"]);
        fs::write(fixture.repo.join("collision.txt"), "tracked development\n").unwrap();
        fixture.git(&["add", "collision.txt"]);
        fixture.git(&["commit", "-qm", "Owned collision"]);
        fixture.git(&["checkout", "-q", "main"]);
        fs::create_dir_all(fixture.repo.join(".git/info")).unwrap();
        fs::write(fixture.repo.join(".git/info/exclude"), "collision.txt\n").unwrap();
        fs::write(fixture.repo.join("collision.txt"), "owned ignored data\n").unwrap();
        let plan =
            prepare_branch_workflow_start(&fixture.repo, BranchWorkflowKind::Feature, "collision")
                .unwrap();
        let refs = fixture.refs();
        let index = fixture.index();
        assert!(
            start_branch_workflow(&fixture.repo, &plan, &CancellationToken::default()).is_err()
        );
        assert_eq!(fixture.refs(), refs);
        assert_eq!(fixture.index(), index);
        assert_eq!(
            fs::read(fixture.repo.join("collision.txt")).unwrap(),
            b"owned ignored data\n"
        );
        assert_eq!(fixture.git(&["symbolic-ref", "HEAD"]), "refs/heads/main");
    }

    #[test]
    fn shared_action_lock_refuses_overlap_and_releases_on_close() {
        let fixture = Fixture::new();
        fixture.setup();
        let linked = fixture.root.join("linked");
        fixture.git(&[
            "worktree",
            "add",
            "-q",
            "-b",
            "ordinary",
            linked.to_str().unwrap(),
        ]);
        let guard = action_guard(&fixture.repo).unwrap();
        assert!(action_guard(&fixture.repo).is_err());
        assert!(action_guard(&linked).is_err());
        drop(guard);
        let _next = action_guard(&linked).unwrap();
        assert_eq!(
            read_settings(&linked).unwrap(),
            read_settings(&fixture.repo).unwrap()
        );
    }

    #[test]
    fn unfinished_workflow_metadata_blocks_setup_and_start_without_being_erased() {
        let fixture = Fixture::new();
        fixture.setup();
        let journal = common_journal(&fixture.repo).unwrap();
        fs::write(&journal, b"unfinished owned record").unwrap();
        assert!(branch_workflow_state(&fixture.repo).unwrap().finish_pending);
        let oid = fixture.git(&["rev-parse", "HEAD"]);
        assert!(
            prepare_branch_workflow_setup(&fixture.repo, BranchWorkflowSettings::default(), &oid)
                .is_err()
        );
        assert!(
            prepare_branch_workflow_start(&fixture.repo, BranchWorkflowKind::Feature, "blocked")
                .is_err()
        );
        assert_eq!(fs::read(journal).unwrap(), b"unfinished owned record");
    }

    #[test]
    fn custom_prefixes_do_not_turn_long_lived_or_empty_suffix_branches_into_topics() {
        let fixture = Fixture::new();
        let oid = fixture.git(&["rev-parse", "HEAD"]);
        let settings = BranchWorkflowSettings {
            production: "work-stable".into(),
            feature_prefix: "work-".into(),
            ..Default::default()
        };
        let plan = prepare_branch_workflow_setup(&fixture.repo, settings, &oid).unwrap();
        apply_branch_workflow_setup(&fixture.repo, &plan).unwrap();
        fixture.git(&["branch", "work-"]);
        fixture.git(&["branch", "work-manual"]);
        let state = branch_workflow_state(&fixture.repo).unwrap();
        assert_eq!(state.topics.len(), 1);
        assert_eq!(state.topics[0].branch, "work-manual");
        assert_eq!(state.topics[0].suffix, "manual");
    }

    #[test]
    fn symbolic_branch_aliases_and_noncommit_initialization_are_rejected() {
        let fixture = Fixture::new();
        let oid = fixture.git(&["rev-parse", "HEAD"]);
        fixture.git(&["symbolic-ref", "refs/heads/develop", "refs/heads/main"]);
        let refs = fixture.refs();
        assert!(
            prepare_branch_workflow_setup(&fixture.repo, BranchWorkflowSettings::default(), &oid)
                .is_err()
        );
        assert_eq!(fixture.refs(), refs);
        fixture.git(&["symbolic-ref", "--delete", "refs/heads/develop"]);
        let tree = fixture.git(&["rev-parse", "HEAD^{tree}"]);
        assert!(
            prepare_branch_workflow_setup(&fixture.repo, BranchWorkflowSettings::default(), &tree)
                .is_err()
        );
        for name in ["", "-bad", "@{-1}", "has space", "bad..name"] {
            fixture.setup();
            assert!(
                prepare_branch_workflow_start(&fixture.repo, BranchWorkflowKind::Feature, name)
                    .is_err()
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn failed_post_checkout_hook_reports_the_applied_branch_change_without_replay() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = Fixture::new();
        fixture.setup();
        let hook = fixture.root.join("hooks/post-checkout");
        fs::write(&hook, "#!/bin/sh\nprintf called >> \"$(git rev-parse --git-path owned-hook-count)\"\nexit 1\n").unwrap();
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o700)).unwrap();
        let plan =
            prepare_branch_workflow_start(&fixture.repo, BranchWorkflowKind::Feature, "hook")
                .unwrap();
        let error =
            start_branch_workflow(&fixture.repo, &plan, &CancellationToken::default()).unwrap_err();
        assert_eq!(error.kind, "branchWorkflowStartStopped");
        assert_eq!(
            fixture.git(&["symbolic-ref", "HEAD"]),
            "refs/heads/feature/hook"
        );
        assert_eq!(fixture.git(&["rev-parse", "HEAD"]), plan.base_oid);
        assert!(
            start_branch_workflow(&fixture.repo, &plan, &CancellationToken::default()).is_err()
        );
        assert_eq!(
            fs::read(fixture.repo.join(".git/owned-hook-count")).unwrap(),
            b"called"
        );
    }
}
