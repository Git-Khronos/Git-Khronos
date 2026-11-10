use super::*;

#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LfsTrackingPattern {
    pub pattern: String,
    pub source: String,
    pub lockable: bool,
    pub tracked: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LfsTrackingRules {
    pub patterns: Vec<LfsTrackingPattern>,
    pub state: String,
    pub root_attributes: Option<String>,
}

#[derive(Deserialize, specta::Type)]
struct PatternOutput {
    patterns: Vec<LfsTrackingPattern>,
}

type AttributesState = (Vec<u8>, Vec<u8>, Vec<u8>, Option<String>, u32);

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LfsAttribute {
    pub name: String,
    pub working: String,
    pub index: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LfsFileAttributes {
    pub path: String,
    pub attributes: Vec<LfsAttribute>,
}

const LFS_ATTRIBUTES: [&str; 5] = ["filter", "diff", "merge", "text", "lockable"];

pub fn lfs_file_attributes(path: &Path, file: &str) -> Result<LfsFileAttributes, AppError> {
    validate_relative_path(
        file,
        "invalidAttributePath",
        "Enter a repository-relative file path without parent or absolute path components.",
    )?;
    if file.len() > 4096
        || file
            .split(['/', '\\'])
            .any(|part| part.eq_ignore_ascii_case(".git"))
    {
        return Err(AppError::new(
            "invalidAttributePath",
            "Git metadata paths and oversized paths cannot be inspected.",
            None,
        ));
    }
    let read = |cached: bool| -> Result<Vec<String>, AppError> {
        let mut args = vec!["check-attr", "-z"];
        if cached {
            args.push("--cached");
        }
        args.extend_from_slice(&LFS_ATTRIBUTES);
        args.extend_from_slice(&["--", file]);
        let (output, truncated) = run_git_with_stdout_limit(path, &args, 64 * 1024)?;
        ensure_success("inspect effective file attributes", &output)?;
        if truncated {
            return Err(AppError::new(
                "attributeOutputTooLarge",
                "Git's attribute response exceeds the safe inspection limit.",
                Some("Inspect this path with local git check-attr."),
            ));
        }
        parse_attributes(&output.stdout, file)
    };
    ensure_sparse_attributes_readable(path, file)?;
    let working = read(false)?;
    let index = read(true)?;
    Ok(LfsFileAttributes {
        path: file.into(),
        attributes: LFS_ATTRIBUTES
            .into_iter()
            .zip(working.into_iter().zip(index))
            .map(|(name, (working, index))| LfsAttribute {
                name: name.into(),
                working,
                index,
            })
            .collect(),
    })
}

/// Git before 2.43 ignores attribute files that sparse checkout excludes, which
/// would make inherited rules look unspecified.
fn ensure_sparse_attributes_readable(path: &Path, file: &str) -> Result<(), AppError> {
    if detect_git()
        .version
        .is_some_and(|version| version_at_least(&version, "2.43.0"))
    {
        return Ok(());
    }
    let parts: Vec<&str> = file.split('/').collect();
    let candidates: Vec<String> = (0..parts.len())
        .map(|depth| {
            let mut candidate = parts[..depth].join("/");
            if !candidate.is_empty() {
                candidate.push('/');
            }
            candidate + ".gitattributes"
        })
        .collect();
    let mut args = vec!["--literal-pathspecs", "ls-files", "-t", "-z", "--"];
    args.extend(candidates.iter().map(String::as_str));
    let output = run_git(path, &args)?;
    ensure_success("check sparse attribute files", &output)?;
    let excluded = output
        .stdout
        .split(|byte| *byte == 0)
        .find(|entry| entry.starts_with(b"S "))
        .map(|entry| String::from_utf8_lossy(&entry[2..]).into_owned());
    match excluded {
        Some(attributes) => Err(AppError::new(
            "sparseAttributesUnreadable",
            format!(
                "{attributes} is outside the sparse checkout, and this Git version ignores it when resolving attributes."
            ),
            Some(
                "Upgrade to Git 2.43 or newer, or include that folder in the sparse selection, then inspect again. Nothing was changed.",
            ),
        )),
        None => Ok(()),
    }
}

fn parse_attributes(bytes: &[u8], file: &str) -> Result<Vec<String>, AppError> {
    let invalid = || {
        AppError::new(
            "invalidAttributeOutput",
            "Git returned an incomplete or unsupported attribute response.",
            Some("Refresh and retry, or inspect the path with local git check-attr."),
        )
    };
    let text = std::str::from_utf8(bytes).map_err(|_| invalid())?;
    let fields: Vec<_> = text
        .strip_suffix('\0')
        .ok_or_else(invalid)?
        .split('\0')
        .collect();
    if fields.len() != LFS_ATTRIBUTES.len() * 3 {
        return Err(invalid());
    }
    fields
        .as_chunks::<3>()
        .0
        .iter()
        .zip(LFS_ATTRIBUTES)
        .map(|(record, name)| {
            if record[0] != file || record[1] != name || record[2].is_empty() {
                return Err(invalid());
            }
            Ok(record[2].to_owned())
        })
        .collect()
}

pub fn lfs_tracking_rules(path: &Path) -> Result<LfsTrackingRules, AppError> {
    ensure_lfs_available(path)?;
    let (state, root_attributes) = attributes_state(path)?;
    let (output, truncated) = run_pattern_command(path, &["track", "--json"])?;
    if truncated {
        return Err(AppError::new(
            "lfsTrackingTooLarge",
            "The LFS pattern list exceeds the safe preview limit.",
            Some("Review tracking rules with local Git LFS."),
        ));
    }
    ensure_success(
        "list Git LFS tracking patterns (requires JSON-capable Git LFS)",
        &output,
    )?;
    let patterns: PatternOutput = serde_json::from_slice(&output.stdout).map_err(|error|
        AppError::new("unsupportedLfsPatternOutput", format!("Git LFS did not return a valid pattern list: {error}"),
            Some("Use a Git LFS version supporting track --json, or inspect patterns with local Git LFS.")))?;
    if attributes_state(path)?.0 != state {
        return Err(stale_attributes());
    }
    Ok(LfsTrackingRules {
        patterns: patterns.patterns,
        state,
        root_attributes,
    })
}

pub fn untrack_lfs_pattern(
    path: &Path,
    pattern: &str,
    expected_state: &str,
) -> Result<(), AppError> {
    if pattern.is_empty()
        || pattern.starts_with('-')
        || pattern.chars().count() > 500
        || pattern.contains(['\0', '\n', '\r'])
    {
        return Err(AppError::new(
            "invalidLfsPattern",
            "Select a valid displayed LFS tracking pattern.",
            None,
        ));
    }
    if pattern.starts_with("[attr]") {
        return Err(AppError::new(
            "unsupportedLfsTrackingRule",
            "Attribute macro definitions cannot be removed through the tracking-rule action.",
            Some(
                "Review dependent rules and edit the macro with local Git. Nothing was untracked.",
            ),
        ));
    }
    let rules = lfs_tracking_rules(path)?;
    if rules.state != expected_state {
        return Err(stale_attributes());
    }
    if !rules
        .patterns
        .iter()
        .any(|rule| rule.source == ".gitattributes" && rule.tracked && rule.pattern == pattern)
    {
        return Err(AppError::new(
            "unknownLfsTrackingPattern",
            "That root LFS tracking rule is no longer available.",
            Some(
                "Reload the pattern list. Nested and external attribute files must be edited in their own scope.",
            ),
        ));
    }
    let expected_attributes = reviewed_untrack_result(&rules, pattern)?;
    let mut expected_after: AttributesState =
        serde_json::from_str(&rules.state).map_err(attributes_error)?;
    expected_after.3 = Some(expected_attributes.clone());
    let expected_after = serde_json::to_string(&expected_after).map_err(attributes_error)?;
    let conflicts = run_git(
        path,
        &[
            "--literal-pathspecs",
            "ls-files",
            "--unmerged",
            "--",
            ".gitattributes",
        ],
    )?;
    ensure_success("check attributes conflicts", &conflicts)?;
    if !conflicts.stdout.is_empty() {
        return Err(AppError::new(
            "conflictedLfsAttributes",
            "Resolve .gitattributes conflicts before removing a tracking rule.",
            None,
        ));
    }
    if attributes_state(path)?.0 != expected_state {
        return Err(stale_attributes());
    }
    let (output, _) = run_pattern_command(path, &["untrack", "--", pattern])?;
    ensure_success("remove the reviewed root LFS tracking pattern", &output)?;
    let remaining = lfs_tracking_rules(path).map_err(|error| AppError::new("lfsUntrackUnverified",
        format!("Git LFS untrack returned, but its result could not be verified: {}", error.message),
        Some(".gitattributes may have changed. Refresh and review its diff; no rollback was attempted.")))?;
    if remaining
        .patterns
        .iter()
        .any(|rule| rule.source == ".gitattributes" && rule.tracked && rule.pattern == pattern)
    {
        return Err(AppError::new(
            "lfsUntrackUnverified",
            "Git LFS returned, but the selected root tracking rule is still present.",
            Some("Review .gitattributes with local Git LFS. No rollback was attempted."),
        ));
    }
    if remaining.root_attributes.as_deref() != Some(expected_attributes.as_str()) {
        return Err(AppError::new(
            "lfsUntrackUnverified",
            "Git LFS returned, but other root attribute lines differ from the reviewed removal.",
            Some(
                "Review .gitattributes against the retained preview. It may have changed; no rollback was attempted.",
            ),
        ));
    }
    if remaining.state != expected_after {
        return Err(AppError::new(
            "lfsUntrackUnverified",
            "HEAD, branch, staged attributes or attribute permissions changed during the removal.",
            Some(
                ".gitattributes may have changed. Refresh and review actual state; no rollback was attempted.",
            ),
        ));
    }
    Ok(())
}

fn reviewed_untrack_result(rules: &LfsTrackingRules, pattern: &str) -> Result<String, AppError> {
    let mut removed = false;
    let mut expected = String::new();
    for line in rules.root_attributes.as_deref().unwrap_or_default().lines() {
        let mut fields = line.split_whitespace();
        let token = fields.next().unwrap_or_default();
        let selected = token.strip_prefix("./").unwrap_or(token)
            == pattern.strip_prefix("./").unwrap_or(pattern);
        let directly_tracked = fields.any(|field| field == "filter=lfs");
        if selected && line.contains("filter=lfs") && !directly_tracked {
            return Err(AppError::new(
                "unsupportedLfsTrackingRule",
                "A matching root line contains filter=lfs inside another attribute rather than as a tracking attribute.",
                Some("Edit this ambiguous rule with local Git. Nothing was untracked."),
            ));
        }
        if selected && directly_tracked {
            removed = true;
        } else {
            expected.push_str(line);
            expected.push('\n');
        }
    }
    if !removed {
        return Err(AppError::new(
            "unsupportedLfsTrackingRule",
            "The selected pattern does not identify a directly removable root filter=lfs line.",
            Some(
                "Macro-expanded or quoted rules need review and editing with local Git. Nothing was untracked.",
            ),
        ));
    }
    Ok(expected)
}

fn attributes_state(path: &Path) -> Result<(String, Option<String>), AppError> {
    let file = path.join(".gitattributes");
    let (contents, mode) = match fs::symlink_metadata(&file) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (None, 0),
        Err(error) => return Err(attributes_error(error)),
        Ok(metadata) => {
            if !metadata.is_file()
                || metadata.file_type().is_symlink()
                || metadata.len() > MAX_FILE_DIFF_BYTES as u64
            {
                return Err(attributes_error(
                    "Root .gitattributes must be a bounded ordinary file, not a symlink.",
                ));
            }
            let mut bytes = Vec::new();
            fs::File::open(&file)
                .map_err(attributes_error)?
                .take(MAX_FILE_DIFF_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(attributes_error)?;
            if bytes.len() > MAX_FILE_DIFF_BYTES {
                return Err(attributes_error(
                    "Root .gitattributes exceeds the safe review limit.",
                ));
            }
            let contents = String::from_utf8(bytes).map_err(attributes_error)?;
            if contents.contains('\0') {
                return Err(attributes_error(
                    "Root .gitattributes must be text without NUL bytes.",
                ));
            }
            if contents.lines().any(|line| line.len() >= 64 * 1024 - 1) {
                return Err(attributes_error(
                    "Root .gitattributes contains a line too long for safe Git LFS rewriting.",
                ));
            }
            #[cfg(unix)]
            let mode = {
                use std::os::unix::fs::PermissionsExt;
                metadata.permissions().mode()
            };
            #[cfg(not(unix))]
            let mode = u32::from(metadata.permissions().readonly());
            (Some(contents), mode)
        }
    };
    let head = run_git(path, &["rev-parse", "--verify", "--quiet", "HEAD"])?;
    if !head.status.success() && head.status.code() != Some(1) {
        ensure_success("read HEAD for attributes review", &head)?;
    }
    let branch = run_git(path, &["symbolic-ref", "--quiet", "HEAD"])?;
    if !branch.status.success() && branch.status.code() != Some(1) {
        ensure_success("read branch for attributes review", &branch)?;
    }
    let index = run_git(
        path,
        &[
            "--literal-pathspecs",
            "ls-files",
            "--stage",
            "-z",
            "--",
            ".gitattributes",
        ],
    )?;
    ensure_success("read staged attributes", &index)?;
    let state = serde_json::to_string(&(head.stdout, branch.stdout, index.stdout, &contents, mode))
        .map_err(attributes_error)?;
    Ok((state, contents))
}

fn stale_attributes() -> AppError {
    AppError::new(
        "staleLfsAttributes",
        "HEAD, branch or .gitattributes changed during review.",
        Some("Reload the tracking patterns and review the current .gitattributes before retrying."),
    )
}

fn attributes_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "lfsAttributesUnavailable",
        format!("Could not safely review .gitattributes: {error}"),
        Some(
            "Check encoding, file type, size and permissions; review unsupported attribute files with local Git.",
        ),
    )
}

fn run_pattern_command(path: &Path, args: &[&str]) -> Result<(Output, bool), AppError> {
    // LFS pattern commands install hooks even when only listing rules.
    let mut nonce = [0_u8; 16];
    getrandom::fill(&mut nonce).map_err(attributes_error)?;
    let name: String = nonce.iter().map(|byte| format!("{byte:02x}")).collect();
    let directory = fs::canonicalize(std::env::temp_dir())
        .map_err(attributes_error)?
        .join(format!("khronos-lfs-hooks-{name}"));
    let config = format!(
        "core.hooksPath={}",
        directory.to_str().ok_or_else(|| attributes_error(
            "The private hooks directory path is not valid UTF-8."
        ))?
    );
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(&directory).map_err(attributes_error)?;
    let mut command = vec!["-c", config.as_str(), "lfs"];
    command.extend_from_slice(args);
    let result = run_git_with_stdout_limit(path, &command, MAX_FILE_DIFF_BYTES);
    let cleanup = (|| -> std::io::Result<()> {
        for hook in ["pre-push", "post-checkout", "post-commit", "post-merge"] {
            match fs::remove_file(directory.join(hook)) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }
        fs::remove_dir(&directory)
    })();
    if let Err(error) = cleanup {
        return Err(AppError::new(
            "lfsHookScopeCleanup",
            format!(
                "The LFS pattern command returned, but its private hook directory could not be removed: {error}"
            ),
            Some(&format!(
                "Inspect {} and refresh the repository; .gitattributes may have changed. Configured hooks were not targeted.",
                directory.display()
            )),
        ));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracking_list_has_the_flat_camel_case_renderer_contract() {
        let output: PatternOutput = serde_json::from_str(r#"{"patterns":[{"pattern":"*.psd","source":".gitattributes","lockable":true,"tracked":true}]}"#).unwrap();
        let listing = LfsTrackingRules {
            patterns: output.patterns,
            state: "lease".into(),
            root_attributes: Some("*.psd filter=lfs\n".into()),
        };
        let value = serde_json::to_value(listing).unwrap();
        assert_eq!(value["state"], "lease");
        assert_eq!(value["rootAttributes"], "*.psd filter=lfs\n");
        assert_eq!(value["patterns"][0]["source"], ".gitattributes");
        assert_eq!(value["patterns"][0]["lockable"], true);
        assert!(value.get("root_attributes").is_none());
        assert!(
            serde_json::from_str::<PatternOutput>(r#"{"patterns":[{"pattern":"*.psd"}]}"#).is_err()
        );
    }

    #[test]
    fn reviewed_removal_keeps_comments_other_attributes_and_normalizes_only_line_endings() {
        let rules = LfsTrackingRules { patterns: vec![], state: String::new(),
            root_attributes: Some("# comment\r\n*.bin filter=lfs custom\r\n\r\n*.txt text eol=lf\r\n*.bin other=value\r\n".into()) };
        assert_eq!(
            reviewed_untrack_result(&rules, "*.bin").unwrap(),
            "# comment\n\n*.txt text eol=lf\n*.bin other=value\n"
        );
        assert_eq!(
            reviewed_untrack_result(&rules, "*.absent")
                .unwrap_err()
                .kind,
            "unsupportedLfsTrackingRule"
        );
    }

    #[test]
    fn attribute_parser_refuses_missing_reordered_wrong_path_or_invalid_utf8_records() {
        let good = LFS_ATTRIBUTES
            .iter()
            .map(|name| format!("a\0{name}\0unspecified\0"))
            .collect::<String>();
        assert_eq!(
            parse_attributes(good.as_bytes(), "a").unwrap(),
            vec!["unspecified"; 5]
        );
        for invalid in [
            b"a\0filter\0lfs".as_slice(),
            b"\xff",
            b"a\0filter\0lfs\0",
            good.trim_end_matches('\0').as_bytes(),
        ] {
            assert_eq!(
                parse_attributes(invalid, "a").unwrap_err().kind,
                "invalidAttributeOutput"
            );
        }
        assert!(parse_attributes(good.as_bytes(), "b").is_err());
        assert!(parse_attributes(good.replace("filter", "wrong").as_bytes(), "a").is_err());
        let result = LfsFileAttributes {
            path: "a".into(),
            attributes: vec![LfsAttribute {
                name: "filter".into(),
                working: "unset".into(),
                index: "lfs".into(),
            }],
        };
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::json!({
                "path": "a", "attributes": [{"name": "filter", "working": "unset", "index": "lfs"}]
            })
        );
    }
}
