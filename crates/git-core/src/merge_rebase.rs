use super::*;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeRebaseCommit {
    #[serde(flatten)]
    pub commit: InteractiveRebaseCommit,
    pub parents: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MergeRebaseRequest {
    pub source: String,
    pub target: String,
    pub source_oid: String,
    pub target_oid: String,
    pub base: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeRebasePlan {
    pub request: MergeRebaseRequest,
    pub commits: Vec<MergeRebaseCommit>,
    pub remote_reachable_oids: Vec<String>,
}

fn tip(path: &Path, branch: &str) -> Result<String, AppError> {
    validate_branch_name(path, branch)?;
    let output = run_git(
        path,
        &["rev-parse", "--verify", &format!("refs/heads/{branch}")],
    )?;
    ensure_success("inspect merge-preserving branch tip", &output)?;
    let text = std::str::from_utf8(&output.stdout).map_err(|_| incomplete())?;
    let oid = text.strip_suffix('\n').unwrap_or(text);
    validate_commit_oid(oid)?;
    Ok(oid.to_owned())
}

fn incomplete() -> AppError {
    AppError::new(
        "mergeRebaseReviewIncomplete",
        "The complete merge-preserving topology could not be reviewed.",
        Some("Refresh and inspect the history with local Git. No partial replay is offered."),
    )
}

pub fn prepare_merge_rebase(
    path: &Path,
    source: &str,
    target: &str,
) -> Result<MergeRebasePlan, AppError> {
    let source_oid = tip(path, source)?;
    let target_oid = tip(path, target)?;
    let shallow = run_git(path, &["rev-parse", "--is-shallow-repository"])?;
    ensure_success("check complete merge-preserving history", &shallow)?;
    if shallow.stdout != b"false\n" {
        return Err(AppError::new(
            "shallowMergeRebase",
            "Merge-preserving review requires complete history.",
            Some("Deepen the repository before preparing a fresh review."),
        ));
    }
    let review = prepare_rebase_review(path, source, target, None, false, true)?;
    let bases = run_git(path, &["merge-base", "--all", &source_oid, &target_oid])?;
    ensure_success("inspect merge-preserving common base", &bases)?;
    if bases.stdout != format!("{}\n", review.base).as_bytes() {
        return Err(AppError::new(
            "ambiguousMergeRebase",
            "Merge-preserving replay requires one unambiguous common base.",
            Some("Criss-cross histories require a separately chosen boundary in local Git."),
        ));
    }
    let (topology, truncated) = run_git_with_stdout_limit(
        path,
        &[
            "rev-list",
            "--reverse",
            "--parents",
            "--max-count=501",
            &format!("{}..{source_oid}", review.base),
        ],
        MAX_INTERACTIVE_REBASE_BYTES,
    )?;
    ensure_success("review every merge parent", &topology)?;
    if truncated {
        return Err(incomplete());
    }
    let text = std::str::from_utf8(&topology.stdout).map_err(|_| incomplete())?;
    let rows = text.lines().collect::<Vec<_>>();
    if rows.len() != review.commits.len() {
        return Err(incomplete());
    }
    let mut commits = Vec::new();
    for (line, commit) in rows.into_iter().zip(review.commits) {
        let fields = line.split_whitespace().collect::<Vec<_>>();
        if fields.len() < 2 || fields.len() > 3 || fields[0] != commit.oid {
            return Err(AppError::new(
                "unsupportedMergeRebase",
                "This review supports ordinary commits and two-parent merges only.",
                Some("Root, octopus and incomplete parent histories require local Git."),
            ));
        }
        for parent in &fields[1..] {
            validate_commit_oid(parent)?;
            let object = run_git(path, &["cat-file", "-e", &format!("{parent}^{{commit}}")])?;
            ensure_success("verify a reviewed merge parent exists", &object)?;
        }
        commits.push(MergeRebaseCommit {
            commit,
            parents: fields[1..]
                .iter()
                .map(|parent| (*parent).to_owned())
                .collect(),
        });
    }
    if !commits.iter().any(|commit| commit.parents.len() == 2) {
        return Err(AppError::new(
            "noMergesToPreserve",
            "The reviewed history contains no merge commits.",
            Some("Use ordinary interactive rebase for this linear range."),
        ));
    }
    if tip(path, source)? != source_oid || tip(path, target)? != target_oid {
        return Err(AppError::new(
            "staleMergeRebase",
            "A branch changed while merge-preserving history was reviewed.",
            Some("Reload the complete review."),
        ));
    }
    Ok(MergeRebasePlan {
        request: MergeRebaseRequest {
            source: source.into(),
            target: target.into(),
            source_oid,
            target_oid,
            base: review.base,
        },
        commits,
        remote_reachable_oids: review.remote_reachable_oids,
    })
}

pub fn execute_merge_rebase(path: &Path, request: &MergeRebaseRequest) -> Result<(), AppError> {
    for oid in [&request.source_oid, &request.target_oid, &request.base] {
        validate_commit_oid(oid)?;
    }
    let review = prepare_merge_rebase(path, &request.source, &request.target)?;
    if review.request.source_oid != request.source_oid
        || review.request.target_oid != request.target_oid
        || review.request.base != request.base
    {
        return Err(AppError::new(
            "staleMergeRebase",
            "Source, destination or common base changed after review.",
            Some("Reload and review the complete topology before starting."),
        ));
    }
    preserve_reference(
        path,
        &request.source_oid,
        &format!(
            "Merge-preserving rebase {} onto {}",
            request.source, request.target
        ),
    )?;
    let status = read_status(path)?;
    if status.entry_count != 0
        || status.entries_truncated
        || status.branch.as_deref() != Some(request.source.as_str())
        || tip(path, &request.source)? != request.source_oid
        || tip(path, &request.target)? != request.target_oid
    {
        return Err(AppError::new(
            "staleMergeRebase",
            "Repository state changed after merge-preserving recovery was saved.",
            Some("Preserve local changes and reload the complete review. No rebase started."),
        ));
    }
    require_visible_replay_index(path)?;
    require_no_git_sequence(path)?;
    // Keep Git's generated label/reset/merge instructions intact.
    let output = crate::git_in(path)
        .args([
            "-c",
            "rebase.updateRefs=false",
            "-c",
            "rebase.autoSquash=false",
            "-c",
            "rebase.autoStash=false",
            "rebase",
            "-i",
            "--rebase-merges=no-rebase-cousins",
            "--onto",
            &request.target_oid,
            &request.base,
        ])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .env("GIT_EDITOR", "true")
        .output()
        .map_err(|error| {
            AppError::new(
                "gitUnavailable",
                format!("Could not start Git: {error}"),
                None,
            )
        })?;
    finish_rebase_command(path, output, "run the reviewed merge-preserving rebase")
}
