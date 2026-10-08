use super::*;
use std::collections::{BTreeMap, BTreeSet};

const MAX_LISTING_BYTES: usize = 16 * 1024 * 1024;
const MAX_CONFIG_BYTES: usize = 1024 * 1024;
const MAX_SUBMODULES: usize = 500;
const GITLINK: &str = "160000";

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleConflict {
    pub base: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
    pub mixed_types: bool,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleState {
    pub path: String,
    pub name: Option<String>,
    pub declared_url: Option<String>,
    pub registered_url: Option<String>,
    pub url_matches: Option<bool>,
    pub head_oid: Option<String>,
    pub index_oid: Option<String>,
    pub checkout_oid: Option<String>,
    pub conflict: Option<SubmoduleConflict>,
    pub checked_out: bool,
    pub commit_changed: bool,
    pub tracked_changes: bool,
    pub untracked_changes: bool,
    pub staged_change: bool,
    pub undeclared: bool,
    pub missing_gitlink: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleStateReview {
    pub gitmodules_present: bool,
    pub entries: Vec<SubmoduleState>,
}

#[derive(Default)]
struct StatusRecord {
    head_oid: Option<String>,
    commit_changed: bool,
    tracked_changes: bool,
    untracked_changes: bool,
}

pub fn review_submodule_state(path: &Path) -> Result<SubmoduleStateReview, AppError> {
    let bare = run_git(path, &["rev-parse", "--is-bare-repository"])?;
    ensure_success("inspect repository layout", &bare)?;
    if bare.stdout.trim_ascii() != b"false" {
        return Err(unavailable(
            "Bare repositories have no submodule working trees to review.",
        ));
    }
    let index = parse_index(&bounded(
        path,
        &["ls-files", "-z", "--stage"],
        MAX_LISTING_BYTES,
        "index",
    )?)?;
    let status = parse_status(&bounded(
        path,
        &[
            "status",
            "--porcelain=v2",
            "-z",
            "--no-renames",
            "--untracked-files=no",
            "--ignore-submodules=none",
        ],
        MAX_LISTING_BYTES,
        "status",
    )?)?;
    let gitmodules_present = path.join(".gitmodules").is_file();
    let declared = if gitmodules_present {
        parse_config(&config(path, &["--file", ".gitmodules"])?)?
    } else {
        BTreeMap::new()
    };
    let registered = parse_config(&config(path, &["--local"])?)?;
    let mut by_path: BTreeMap<String, (String, Option<String>)> = BTreeMap::new();
    for (name, values) in &declared {
        let Some(target) = values.get("path") else {
            continue;
        };
        valid_path(target)?;
        if by_path
            .insert(target.clone(), (name.clone(), values.get("url").cloned()))
            .is_some()
        {
            return Err(unavailable(
                "Two .gitmodules entries declare the same path.",
            ));
        }
    }
    let mut paths: BTreeSet<String> = index.keys().cloned().collect();
    paths.extend(status.keys().cloned());
    paths.extend(by_path.keys().cloned());
    if paths.len() > MAX_SUBMODULES {
        return Err(unavailable("More than 500 submodule paths were reported."));
    }
    let mut entries = Vec::with_capacity(paths.len());
    for target in paths {
        valid_path(&target)?;
        let (index_oid, conflict) = index.get(&target).cloned().unwrap_or_default();
        let record = status.get(&target);
        let head_oid = match record {
            Some(record) => record.head_oid.clone(),
            None if conflict.is_none() => index_oid.clone(),
            None => None,
        };
        let gitlink = index_oid.is_some() || head_oid.is_some() || conflict.is_some();
        let (name, declared_url) = by_path
            .get(&target)
            .map(|(name, url)| (Some(name.clone()), url.clone()))
            .unwrap_or_default();
        let registered_url = name
            .as_ref()
            .and_then(|name| registered.get(name))
            .and_then(|values| values.get("url"))
            .cloned();
        let url_matches = match (&declared_url, &registered_url) {
            (Some(declared), Some(registered))
                if !declared.starts_with("./") && !declared.starts_with("../") =>
            {
                Some(declared == registered)
            }
            _ => None,
        };
        let module = path.join(&target);
        let checked_out = gitlink && module.join(".git").exists();
        let checkout_oid = if checked_out {
            let output = run_git(&module, &["rev-parse", "--verify", "-q", "HEAD^{commit}"])?;
            output
                .status
                .success()
                .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
                .filter(|oid| valid_oid(oid))
        } else {
            None
        };
        entries.push(SubmoduleState {
            staged_change: conflict.is_none() && head_oid != index_oid,
            commit_changed: record.is_some_and(|record| record.commit_changed),
            tracked_changes: record.is_some_and(|record| record.tracked_changes),
            untracked_changes: record.is_some_and(|record| record.untracked_changes),
            undeclared: gitlink && name.is_none(),
            missing_gitlink: !gitlink && name.is_some(),
            path: target,
            name,
            declared_url,
            registered_url,
            url_matches,
            head_oid,
            index_oid,
            checkout_oid,
            conflict,
            checked_out,
        });
    }
    Ok(SubmoduleStateReview {
        gitmodules_present,
        entries,
    })
}

fn bounded(path: &Path, args: &[&str], limit: usize, label: &str) -> Result<Vec<u8>, AppError> {
    let (output, truncated) = run_git_with_stdout_limit(path, args, limit)?;
    ensure_success(
        &format!("inspect the complete {label} for submodules"),
        &output,
    )?;
    if truncated {
        return Err(unavailable(&format!(
            "The complete {label} exceeds the submodule review limit."
        )));
    }
    Ok(output.stdout)
}

pub(super) fn config(path: &Path, scope: &[&str]) -> Result<Vec<u8>, AppError> {
    let mut args = vec!["config", "-z"];
    args.extend_from_slice(scope);
    args.extend(["--get-regexp", r"^submodule\."]);
    let (output, truncated) = run_git_with_stdout_limit(path, &args, MAX_CONFIG_BYTES)?;
    if truncated {
        return Err(unavailable(
            "Submodule configuration exceeds the review limit.",
        ));
    }
    match output.status.code() {
        Some(0) => Ok(output.stdout),
        Some(1) if output.stdout.is_empty() => Ok(Vec::new()),
        _ => {
            ensure_success("read submodule configuration", &output)?;
            Ok(output.stdout)
        }
    }
}

type ConfigValues = BTreeMap<String, BTreeMap<String, String>>;

pub(super) fn parse_config(bytes: &[u8]) -> Result<ConfigValues, AppError> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| unavailable("Submodule configuration is not UTF-8."))?;
    let mut values = ConfigValues::new();
    for record in text.split_terminator('\0') {
        let (key, value) = record.split_once('\n').unwrap_or((record, ""));
        let Some((name, variable)) = key
            .strip_prefix("submodule.")
            .and_then(|rest| rest.rsplit_once('.'))
        else {
            continue;
        };
        if name.is_empty() {
            return Err(unavailable("A submodule configuration name is empty."));
        }
        values
            .entry(name.into())
            .or_default()
            .insert(variable.into(), value.into());
    }
    Ok(values)
}

type IndexEntries = BTreeMap<String, (Option<String>, Option<SubmoduleConflict>)>;

pub(super) fn parse_index(bytes: &[u8]) -> Result<IndexEntries, AppError> {
    let text =
        std::str::from_utf8(bytes).map_err(|_| unavailable("An index path is not UTF-8."))?;
    let mut entries = IndexEntries::new();
    let mut unmerged: BTreeMap<&str, Vec<(&str, &str, &str)>> = BTreeMap::new();
    for record in text.split_terminator('\0') {
        let (meta, target) = record
            .split_once('\t')
            .ok_or_else(|| unavailable("An index record is malformed."))?;
        let mut fields = meta.split(' ');
        let (Some(mode), Some(oid), Some(stage), None) =
            (fields.next(), fields.next(), fields.next(), fields.next())
        else {
            return Err(unavailable("An index record is malformed."));
        };
        if !valid_oid(oid) || target.is_empty() {
            return Err(unavailable("An index record is malformed."));
        }
        match stage {
            "0" if mode == GITLINK => {
                entries.insert(target.into(), (Some(oid.into()), None));
            }
            "0" => {}
            "1" | "2" | "3" => unmerged.entry(target).or_default().push((stage, mode, oid)),
            _ => return Err(unavailable("An index stage is unsupported.")),
        }
    }
    for (target, stages) in unmerged {
        if !stages.iter().any(|(_, mode, _)| *mode == GITLINK) {
            continue;
        }
        let mut conflict = SubmoduleConflict::default();
        for (stage, mode, oid) in stages {
            if mode != GITLINK {
                conflict.mixed_types = true;
                continue;
            }
            let slot = match stage {
                "1" => &mut conflict.base,
                "2" => &mut conflict.ours,
                _ => &mut conflict.theirs,
            };
            *slot = Some(oid.into());
        }
        if entries
            .insert(target.into(), (None, Some(conflict)))
            .is_some()
        {
            return Err(unavailable("A path is both merged and unmerged."));
        }
    }
    Ok(entries)
}

fn parse_status(bytes: &[u8]) -> Result<BTreeMap<String, StatusRecord>, AppError> {
    let text =
        std::str::from_utf8(bytes).map_err(|_| unavailable("A status path is not UTF-8."))?;
    let mut records = BTreeMap::new();
    for record in text.split_terminator('\0') {
        let (kind, rest) = record.split_at(record.len().min(2));
        let (modes, head, sub, target) = match kind {
            "1 " => {
                let fields: Vec<&str> = rest.splitn(8, ' ').collect();
                if fields.len() != 8 {
                    return Err(unavailable("A status record is malformed."));
                }
                (
                    vec![fields[2], fields[3], fields[4]],
                    (fields[2] == GITLINK).then_some(fields[5]),
                    fields[1],
                    fields[7],
                )
            }
            "u " => {
                let fields: Vec<&str> = rest.splitn(10, ' ').collect();
                if fields.len() != 10 {
                    return Err(unavailable("A status record is malformed."));
                }
                (
                    vec![fields[2], fields[3], fields[4], fields[5]],
                    None,
                    fields[1],
                    fields[9],
                )
            }
            "# " => continue,
            _ => return Err(unavailable("An unsupported status record was reported.")),
        };
        if !modes.contains(&GITLINK) {
            continue;
        }
        let flags = sub.as_bytes();
        let submodule = flags.len() == 4 && flags[0] == b'S';
        if !(submodule || sub == "N...") || head.is_some_and(|oid| !valid_oid(oid)) {
            return Err(unavailable("A submodule status record is malformed."));
        }
        records.insert(
            target.to_owned(),
            StatusRecord {
                head_oid: head.map(str::to_owned),
                commit_changed: submodule && flags[1] == b'C',
                tracked_changes: submodule && flags[2] == b'M',
                untracked_changes: submodule && flags[3] == b'U',
            },
        );
    }
    Ok(records)
}

fn valid_path(value: &str) -> Result<(), AppError> {
    let candidate = Path::new(value);
    if value.is_empty()
        || value.contains('\0')
        || !candidate
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err(unavailable("A submodule path is outside the working tree."));
    }
    Ok(())
}

fn valid_oid(value: &str) -> bool {
    matches!(value.len(), 40 | 64)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(super) fn unavailable(message: &str) -> AppError {
    AppError::new(
        "submoduleReviewUnavailable",
        message,
        Some(
            "Inspect submodules with local Git status and submodule status. This review changes nothing.",
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn submodule_parsers_keep_literal_paths_conflict_sides_and_names_with_dots() {
        let a = "a".repeat(40);
        let b = "b".repeat(40);
        let index = format!(
            "160000 {a} 0\tmod one\0100644 {b} 0\tfile\0160000 {a} 1\tclash\0160000 {b} 2\tclash\0100644 {a} 3\tclash\0"
        );
        let entries = parse_index(index.as_bytes()).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries["mod one"].0.as_deref(), Some(a.as_str()));
        let conflict = entries["clash"].1.clone().unwrap();
        assert_eq!(conflict.base.as_deref(), Some(a.as_str()));
        assert_eq!(conflict.ours.as_deref(), Some(b.as_str()));
        assert_eq!(conflict.theirs, None);
        assert!(conflict.mixed_types);
        let config =
            parse_config(b"submodule.lib.v2.path\nlibs/v2\0submodule.lib.v2.url\n../lib\0")
                .unwrap();
        assert_eq!(config["lib.v2"]["path"], "libs/v2");
        let status = format!(
            "1 .M SCMU 160000 160000 160000 {a} {a} mod one\x001 M. N... 100644 100644 100644 {a} {b} file\0"
        );
        let records = parse_status(status.as_bytes()).unwrap();
        assert_eq!(records.len(), 1);
        let record = &records["mod one"];
        assert!(record.commit_changed && record.tracked_changes && record.untracked_changes);
    }

    #[test]
    fn submodule_parsers_refuse_malformed_and_non_utf8_records() {
        let a = "a".repeat(40);
        assert!(parse_index(format!("160000 {a}\tbad\0").as_bytes()).is_err());
        assert!(parse_index(format!("160000 {a} 4\tbad\0").as_bytes()).is_err());
        assert!(parse_index(b"160000 short 0\tbad\0").is_err());
        assert!(parse_index(b"160000 \xff 0\tbad\0").is_err());
        assert!(
            parse_status(format!("1 .M SC 160000 160000 160000 {a} {a} x\0").as_bytes()).is_err()
        );
        assert!(parse_status(b"? untracked\0").is_err());
        assert!(parse_config(b"submodule..url\nx\0").is_err());
    }
}
