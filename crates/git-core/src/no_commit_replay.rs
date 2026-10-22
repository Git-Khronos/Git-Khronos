use super::*;
use std::fs::OpenOptions;

const MAX_PLAN_BYTES: u64 = 128 * 1024;
const MAX_COMMITS: usize = 500;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Plan {
    head_oid: String,
    head_reference: String,
    oids: Vec<String>,
    next: usize,
    mainline: Option<u32>,
    phase: Phase,
}

#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum Phase {
    Applying,
    Conflicted,
}

fn storage(path: &Path) -> Result<PathBuf, AppError> {
    let output = run_git(
        path,
        &[
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            "git-khronos-no-commit.json",
        ],
    )?;
    ensure_success("locate no-commit replay state", &output)?;
    let value = std::str::from_utf8(&output.stdout).map_err(|_| invalid_state())?;
    Ok(PathBuf::from(value.strip_suffix('\n').unwrap_or(value)))
}

fn invalid_state() -> AppError {
    AppError::new("invalidNoCommitReplay", "The saved no-commit replay state is incomplete or unsupported.",
        Some("Do not replay automatically. Inspect the repository and preserve its current changes before manual recovery."))
}

fn io_error(error: std::io::Error) -> AppError {
    AppError::new("noCommitReplayStorage",     format!("Could not access no-commit replay state: {error}"),
        Some("Applied changes may remain in the index. Inspect them before retrying; the original history is protected by a recovery reference."))
}

fn read(file: &Path) -> Result<Option<Plan>, AppError> {
    let input = match fs::File::open(file) {
        Ok(input) => input,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_error(error)),
    };
    let mut bytes = Vec::new();
    input
        .take(MAX_PLAN_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() as u64 > MAX_PLAN_BYTES {
        return Err(invalid_state());
    }
    let plan: Plan = serde_json::from_slice(&bytes).map_err(|_| invalid_state())?;
    if plan.oids.is_empty()
        || plan.oids.len() > MAX_COMMITS
        || plan.next == 0
        || plan.next > plan.oids.len()
        || (plan.mainline.is_some() && plan.oids.len() != 1)
        || (plan.mainline == Some(0))
        || (!plan.head_reference.is_empty() && !plan.head_reference.starts_with("refs/heads/"))
    {
        return Err(invalid_state());
    }
    validate_commit_oid(&plan.head_oid)?;
    for oid in &plan.oids {
        validate_commit_oid(oid)?;
    }
    Ok(Some(plan))
}

pub(super) fn active(file: &Path) -> Result<bool, AppError> {
    Ok(read(file)?.is_some())
}

fn write(file: &Path, plan: &Plan) -> Result<(), AppError> {
    let bytes = serde_json::to_vec(plan).map_err(|_| invalid_state())?;
    if bytes.len() as u64 > MAX_PLAN_BYTES {
        return Err(invalid_state());
    }
    let temporary = file.with_extension("json.lock");
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(io_error)?;
    let result = (|| {
        output.write_all(&bytes).map_err(io_error)?;
        output.sync_all().map_err(io_error)?;
        drop(output);
        fs::rename(&temporary, file).map_err(io_error)
    })();
    if result.is_err() {
        fs::remove_file(&temporary).map_err(io_error)?;
    }
    result?;
    #[cfg(unix)]
    fs::File::open(file.parent().ok_or_else(invalid_state)?)
        .and_then(|directory| directory.sync_all())
        .map_err(io_error)?;
    Ok(())
}

fn current_head(path: &Path) -> Result<(String, String), AppError> {
    let output = run_git(path, &["rev-parse", "--verify", "HEAD"])?;
    ensure_success("read no-commit replay destination", &output)?;
    let oid = String::from_utf8(output.stdout)
        .map_err(|_| invalid_state())?
        .trim()
        .to_owned();
    validate_commit_oid(&oid)?;
    let output = run_git(path, &["symbolic-ref", "--quiet", "HEAD"])?;
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(AppError::git_failure(
            "read no-commit replay branch",
            &output,
        ));
    }
    let reference = String::from_utf8(output.stdout)
        .map_err(|_| invalid_state())?
        .trim()
        .to_owned();
    Ok((oid, reference))
}

fn require_original_head(path: &Path, plan: &Plan) -> Result<(), AppError> {
    let (head, reference) = current_head(path)?;
    if head != plan.head_oid || reference != plan.head_reference {
        return Err(AppError::new("staleNoCommitReplay", "The destination HEAD changed during no-commit replay.",
            Some("Finish manually to retain the current files and end the saved sequence; inspect the protected original tip before recovery.")));
    }
    Ok(())
}

pub(super) fn start(path: &Path, oids: &[String], mainline: Option<u32>) -> Result<(), AppError> {
    if oids.is_empty() || oids.len() > MAX_COMMITS {
        return Err(AppError::new(
            "invalidNoCommitRange",
            "Select between 1 and 500 commits for no-commit replay.",
            None,
        ));
    }
    for oid in oids {
        validate_commit_oid(oid)?;
    }
    validate_replay_mainline(path, oids, mainline)?;
    require_no_git_sequence(path)?;
    require_visible_replay_index(path)?;
    let protected_head = preserve_replay_tip(path)?;
    let (head_oid, head_reference) = current_head(path)?;
    if head_oid != protected_head {
        return Err(AppError::new("staleNoCommitReplay", "HEAD changed while protecting the no-commit replay destination.",
            Some("No changes were applied. Refresh and review the intended destination before retrying.")));
    }
    let file = storage(path)?;
    let mut plan = Plan {
        head_oid,
        head_reference,
        oids: oids.to_vec(),
        next: 0,
        mainline,
        phase: Phase::Applying,
    };
    apply_remaining(path, &file, &mut plan)
}

fn apply_remaining(path: &Path, file: &Path, plan: &mut Plan) -> Result<(), AppError> {
    while plan.next < plan.oids.len() {
        require_original_head(path, plan)?;
        let oid = plan.oids[plan.next].clone();
        plan.next += 1;
        plan.phase = Phase::Applying;
        // A crash during Git must require manual review, not repeat an uncertain step.
        write(file, plan)?;
        let parent = plan.mainline.map(|value| value.to_string());
        let mut args = vec!["cherry-pick", "--no-commit"];
        if let Some(parent) = &parent {
            args.extend(["--mainline", parent.as_str()]);
        }
        args.push(&oid);
        if let Err(error) = run_mutation(path, &args, "apply selected changes without committing") {
            if read_status(path)?.conflicted > 0 {
                plan.phase = Phase::Conflicted;
                write(file, plan)?;
            }
            return Err(error);
        }
        require_original_head(path, plan)?;
    }
    remove(file)
}

fn remove(file: &Path) -> Result<(), AppError> {
    fs::remove_file(file).map_err(io_error)?;
    #[cfg(unix)]
    fs::File::open(file.parent().ok_or_else(invalid_state)?)
        .and_then(|directory| directory.sync_all())
        .map_err(io_error)?;
    Ok(())
}

pub(super) fn control(path: &Path, action: &str) -> Result<(), AppError> {
    let file = storage(path)?;
    let mut plan = read(&file)?.ok_or_else(|| {
        AppError::new(
            "historyOperationNotInProgress",
            "No no-commit replay is active.",
            None,
        )
    })?;
    if action == "quit" {
        return remove(&file);
    }
    require_no_git_sequence(path)?;
    require_original_head(path, &plan)?;
    match action {
        "continue" => {
            if plan.phase != Phase::Conflicted {
                return Err(AppError::new("uncertainNoCommitReplay", "The last no-commit replay step did not finish reliably.",
                    Some("Inspect current changes. Abort restores the original tracked state; Finish manually retains all current files. No step is silently repeated or skipped.")));
            }
            let status = read_status(path)?;
            if status.conflicted > 0 || status.unstaged > 0 || status.entries_truncated {
                return Err(AppError::new("noCommitResolutionRequired", "Resolve and stage all tracked changes before continuing without a commit.", None));
            }
            apply_remaining(path, &file, &mut plan)
        }
        "abort" => {
            run_mutation(path, &["reset", "--merge", &plan.head_oid], "abort no-commit replay")?;
            remove(&file)
        }
        _ => Err(AppError::new("invalidHistoryOperationAction", "No-commit replay supports Continue, Abort or Finish manually.",
            Some("Skip is unavailable because it would need to discard only one step while preserving earlier staged changes."))),
    }
}
