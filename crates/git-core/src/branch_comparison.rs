use super::*;

/// Commits listed per side; counts are always complete.
const LISTED_COMMITS: usize = 20;

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparedCommit {
    pub oid: String,
    pub subject: String,
    pub author: String,
    pub timestamp: i64,
}

/// How two local branches relate, read without touching HEAD, the index or
/// the working tree. `incoming` commits exist only on `source`; `outgoing`
/// commits exist only on `target`.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BranchComparison {
    pub target: String,
    pub source: String,
    pub target_oid: String,
    pub source_oid: String,
    pub merge_base: Option<String>,
    pub incoming_count: u32,
    pub outgoing_count: u32,
    /// Outgoing commits already reachable from a remote-tracking branch;
    /// rebasing would rewrite commits other people may have.
    pub outgoing_published: u32,
    pub incoming: Vec<ComparedCommit>,
    pub outgoing: Vec<ComparedCommit>,
}

pub fn compare_branches(
    path: &Path,
    target: &str,
    source: &str,
) -> Result<BranchComparison, AppError> {
    let (_, target_oid) = local_branch_ref_and_tip(path, target)?;
    let (_, source_oid) = local_branch_ref_and_tip(path, source)?;
    let base = run_git(path, &["merge-base", &target_oid, &source_oid])?;
    let merge_base = match base.status.code() {
        Some(0) => Some(String::from_utf8_lossy(&base.stdout).trim().to_owned()),
        Some(1) => None,
        _ => {
            ensure_success("find the common history", &base)?;
            None
        }
    };
    let incoming_range = format!("{target_oid}..{source_oid}");
    let outgoing_range = format!("{source_oid}..{target_oid}");
    // One symmetric walk counts both sides. Its left side is the target.
    let (outgoing_count, incoming_count) = count_sides(path, &target_oid, &source_oid)?;
    let unpublished = if outgoing_count == 0 {
        0
    } else {
        count(path, &[&outgoing_range, "--not", "--remotes"])?
    };
    Ok(BranchComparison {
        target: target.to_owned(),
        source: source.to_owned(),
        target_oid,
        source_oid,
        merge_base,
        incoming_count,
        outgoing_count,
        outgoing_published: outgoing_count.saturating_sub(unpublished),
        incoming: list(path, &incoming_range, incoming_count)?,
        outgoing: list(path, &outgoing_range, outgoing_count)?,
    })
}

fn count_sides(path: &Path, target: &str, source: &str) -> Result<(u32, u32), AppError> {
    let range = format!("{target}...{source}");
    let output = run_git(path, &["rev-list", "--left-right", "--count", &range])?;
    ensure_success("count commits between the branches", &output)?;
    let counts = String::from_utf8_lossy(&output.stdout);
    let mut fields = counts.split_ascii_whitespace();
    match (
        fields.next().and_then(|value| value.parse().ok()),
        fields.next().and_then(|value| value.parse().ok()),
        fields.next(),
    ) {
        (Some(left), Some(right), None) => Ok((left, right)),
        _ => Err(AppError::new(
            "branchComparisonIncomplete",
            "Git did not return both commit counts.",
            None,
        )),
    }
}

fn count(path: &Path, range: &[&str]) -> Result<u32, AppError> {
    let mut args = vec!["rev-list", "--count"];
    args.extend_from_slice(range);
    let output = run_git(path, &args)?;
    ensure_success("count commits between the branches", &output)?;
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse()
        .map_err(|_| {
            AppError::new(
                "branchComparisonIncomplete",
                "Git did not return a commit count.",
                None,
            )
        })
}

fn list(path: &Path, range: &str, count: u32) -> Result<Vec<ComparedCommit>, AppError> {
    if count == 0 {
        return Ok(Vec::new());
    }
    let limit = format!("--max-count={LISTED_COMMITS}");
    let output = run_git(
        path,
        &[
            "-c",
            "log.showSignature=false",
            "log",
            "--no-color",
            &limit,
            "--format=%H%x1f%an%x1f%ct%x1f%s",
            range,
        ],
    )?;
    ensure_success("list commits between the branches", &output)?;
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut fields = line.splitn(4, '\u{1f}');
            Some(ComparedCommit {
                oid: fields.next()?.to_owned(),
                author: fields.next()?.to_owned(),
                timestamp: fields.next()?.parse().ok()?,
                subject: fields.next().unwrap_or_default().to_owned(),
            })
        })
        .collect())
}
