use super::*;

const MAX_REPORT_BYTES: usize = 1024 * 1024;
const MAX_REGISTRATIONS: usize = 1000;

#[derive(Debug, Clone, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRegistration {
    pub path: String,
    pub oid: Option<String>,
    pub branch: Option<String>,
    pub bare: bool,
    pub locked: bool,
    pub lock_reason: Option<String>,
    pub prunable: bool,
    pub prune_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRegistrationReview {
    pub registrations: Vec<WorktreeRegistration>,
    pub prune_report: String,
}

pub fn review_worktree_registrations(path: &Path) -> Result<WorktreeRegistrationReview, AppError> {
    let (listing, truncated) = run_git_with_stdout_limit(
        path,
        &["worktree", "list", "--porcelain", "-z", "--expire=now"],
        MAX_REPORT_BYTES,
    )?;
    ensure_success("inspect complete worktree registrations", &listing)?;
    if truncated {
        return Err(unsupported(
            "The complete registration list exceeds the review limit.",
        ));
    }
    let registrations = parse_registrations(&listing.stdout)?;
    let (report, truncated) = run_git_with_stdout_limit(
        path,
        &[
            "worktree",
            "prune",
            "--dry-run",
            "--verbose",
            "--expire=now",
        ],
        MAX_REPORT_BYTES,
    )?;
    ensure_success("inspect worktree registration prune dry-run", &report)?;
    if truncated || report.stderr.len() > MAX_REPORT_BYTES {
        return Err(unsupported(
            "The complete prune dry-run exceeds the review limit.",
        ));
    }
    let stdout = std::str::from_utf8(&report.stdout)
        .map_err(|_| unsupported("The prune dry-run is not UTF-8."))?;
    let stderr = std::str::from_utf8(&report.stderr)
        .map_err(|_| unsupported("The prune dry-run diagnostics are not UTF-8."))?;
    let prune_report = match (stdout.is_empty(), stderr.is_empty()) {
        (true, true) => String::new(),
        (false, true) => stdout.to_owned(),
        (true, false) => stderr.to_owned(),
        (false, false) => format!("{stdout}\n{stderr}"),
    };
    Ok(WorktreeRegistrationReview {
        registrations,
        prune_report,
    })
}

pub(super) fn parse_registrations(bytes: &[u8]) -> Result<Vec<WorktreeRegistration>, AppError> {
    if bytes.is_empty() || !bytes.ends_with(b"\0\0") {
        return Err(unsupported(
            "The complete NUL-delimited registration list is missing.",
        ));
    }
    let text = std::str::from_utf8(bytes)
        .map_err(|_| unsupported("A registration path or description is not UTF-8."))?;
    let mut entries = Vec::new();
    let mut fields = Vec::new();
    for record in text.split_terminator('\0') {
        if record.is_empty() {
            if fields.is_empty() {
                return Err(unsupported("An empty registration record was reported."));
            }
            if entries.len() >= MAX_REGISTRATIONS {
                return Err(unsupported(
                    "More than 1000 worktree registrations were reported.",
                ));
            }
            let entry = parse_registration(&fields)?;
            if entries
                .iter()
                .any(|previous: &WorktreeRegistration| previous.path == entry.path)
            {
                return Err(unsupported("Duplicate worktree paths were reported."));
            }
            entries.push(entry);
            fields.clear();
        } else {
            if fields.len() >= 8 {
                return Err(unsupported(
                    "Unsupported registration fields were reported.",
                ));
            }
            fields.push(record);
        }
    }
    if !fields.is_empty() || entries.is_empty() {
        return Err(unsupported("The registration list is incomplete."));
    }
    Ok(entries)
}

fn parse_registration(fields: &[&str]) -> Result<WorktreeRegistration, AppError> {
    let path = fields
        .first()
        .and_then(|field| field.strip_prefix("worktree "))
        .filter(|path| !path.is_empty() && path.len() <= 8192)
        .ok_or_else(|| unsupported("A worktree path is missing or unsupported."))?;
    if !Path::new(path).is_absolute() {
        return Err(unsupported("A worktree registration path is not absolute."));
    }
    let mut entry = WorktreeRegistration {
        path: path.into(),
        oid: None,
        branch: None,
        bare: false,
        locked: false,
        lock_reason: None,
        prunable: false,
        prune_reason: None,
    };
    let mut detached = false;
    let mut seen = HashSet::new();
    for field in &fields[1..] {
        let (name, value) = field.split_once(' ').unwrap_or((field, ""));
        if !seen.insert(name) {
            return Err(unsupported("Duplicate registration fields were reported."));
        }
        match name {
            "HEAD" if valid_head(value) => entry.oid = Some(value.into()),
            "branch"
                if value.starts_with("refs/heads/")
                    && value.len() > 11
                    && !value.contains(['\n', '\r']) =>
            {
                entry.branch = Some(value[11..].into());
            }
            "detached" if value.is_empty() => detached = true,
            "bare" if value.is_empty() => entry.bare = true,
            "locked" => {
                entry.locked = true;
                entry.lock_reason = (!value.is_empty()).then(|| value.into());
            }
            "prunable" => {
                entry.prunable = true;
                entry.prune_reason = (!value.is_empty()).then(|| value.into());
            }
            _ => {
                return Err(unsupported(
                    "Unknown or malformed registration fields were reported.",
                ));
            }
        }
    }
    if (entry.bare && (entry.oid.is_some() || entry.branch.is_some() || detached))
        || (!entry.bare && (entry.oid.is_none() || detached == entry.branch.is_some()))
        || (entry.locked && entry.prunable)
    {
        return Err(unsupported(
            "Inconsistent registration identity or protection flags were reported.",
        ));
    }
    Ok(entry)
}

fn valid_head(value: &str) -> bool {
    matches!(value.len(), 40 | 64)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn unsupported(message: &str) -> AppError {
    AppError::new(
        "worktreeRegistrationReviewUnavailable",
        message,
        Some(
            "Inspect registrations with local Git worktree list/prune --dry-run. This review does not remove or repair registrations.",
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registration_parser_preserves_literal_paths_reasons_and_bare_detached_unborn_identity() {
        let bytes = format!(
            "worktree /repo\nwith tab\tand spaces\0HEAD {}\0branch refs/heads/main\0\0worktree /missing\0HEAD {}\0detached\0prunable gitdir file points to non-existent location\0\0worktree /offline\0HEAD {}\0branch refs/heads/topic\0locked portable\nvolume\0\0worktree /bare\0bare\0\0",
            "0".repeat(40),
            "a".repeat(40),
            "b".repeat(64),
        );
        let entries = parse_registrations(bytes.as_bytes()).unwrap();
        assert_eq!(entries.len(), 4);
        assert_eq!(entries[0].path, "/repo\nwith tab\tand spaces");
        assert_eq!(entries[0].oid, Some("0".repeat(40)));
        assert!(entries[1].prunable);
        assert_eq!(entries[1].branch, None);
        assert_eq!(entries[2].lock_reason.as_deref(), Some("portable\nvolume"));
        assert!(entries[3].bare);
        let value = serde_json::to_value(&entries[2]).unwrap();
        assert_eq!(value["lockReason"], "portable\nvolume");
        assert_eq!(value["pruneReason"], serde_json::Value::Null);
    }

    #[test]
    fn registration_parser_refuses_incomplete_duplicate_unknown_and_conflicting_records() {
        let head = "a".repeat(40);
        for bytes in [
            "".into(),
            format!("worktree /repo\0HEAD {head}\0detached\0"),
            format!("worktree /repo\0HEAD {head}\0HEAD {head}\0detached\0\0"),
            format!("worktree /repo\0HEAD {head}\0branch refs/heads/main\0detached\0\0"),
            format!("worktree /repo\0HEAD {head}\0detached\0locked\0prunable\0\0"),
            format!("worktree /repo\0HEAD {head}\0detached\0unknown surprise\0\0"),
            format!("worktree relative\0HEAD {head}\0detached\0\0"),
            "worktree /repo\0HEAD invalid\0detached\0\0".into(),
            format!("worktree /repo\0HEAD {head}\0detached\0\0worktree /repo\0bare\0\0"),
            "worktree /bare\0bare\0branch refs/heads/main\0\0".into(),
            format!("worktree /repo\0HEAD {head}\0\0"),
        ] {
            assert!(parse_registrations(bytes.as_bytes()).is_err(), "{bytes:?}");
        }
        assert!(parse_registrations(b"worktree /bad\xff\0bare\0\0").is_err());
    }
}
