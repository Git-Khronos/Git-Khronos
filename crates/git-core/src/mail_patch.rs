use super::*;
use std::fs::OpenOptions;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_MAIL_PATCH_BYTES: usize = 16 * 1024 * 1024;
const MAX_MAIL_PATCH_COMMITS: usize = 500;
const MAX_METADATA_BYTES: usize = 4 * 1024 * 1024;
const MAIL_RECORD_DATE: &[u8] = b" Mon Sep 17 00:00:00 2001";

/// Commands run with replacement objects disabled so exported history always
/// matches the stored commits, and plain (not mboxrd) quoting so standard
/// `git am` receivers reproduce messages exactly.
const FORMAT_PATCH_ARGS: &[&str] = &[
    "-c",
    "format.mboxrd=false",
    "--no-replace-objects",
    "format-patch",
    "--stdout",
    "-k",
    "--no-cover-letter",
    "--no-signoff",
    "--no-to",
    "--no-cc",
    "--no-add-header",
    "--no-thread",
    "--no-attach",
    "--no-signature",
    "--no-from",
    "--no-base",
    "--no-notes",
    "--no-numbered",
    "--binary",
    "--full-index",
    "--no-renames",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--unified=3",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--no-relative",
    "--ignore-submodules=none",
    "--submodule=short",
    "--no-show-signature",
    "--pretty=email",
    "--encoding=UTF-8",
    "--quiet",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MailPatchRequest {
    pub oids: Vec<String>,
    pub bytes: usize,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MailPatchCommit {
    pub oid: String,
    pub author_name: String,
    pub author_email: String,
    pub subject: String,
    pub root: bool,
    pub empty: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailPatchReview {
    pub request: MailPatchRequest,
    pub commits: Vec<MailPatchCommit>,
}

fn refused(message: impl Into<String>) -> AppError {
    AppError::new(
        "mailPatchRefused",
        message,
        Some(
            "Choose consecutive non-merge commits, refresh the history and prepare a fresh review. No existing file is replaced.",
        ),
    )
}

fn fingerprint(bytes: &[u8]) -> Result<String, AppError> {
    gix::objs::compute_hash(gix::hash::Kind::Sha1, gix::objs::Kind::Blob, bytes)
        .map(|hash| hash.to_string())
        .map_err(|error| refused(format!("Could not identify mail-patch contents: {error}")))
}

fn normalized_selection(oids: &[String]) -> Result<Vec<String>, AppError> {
    if oids.is_empty() || oids.len() > MAX_MAIL_PATCH_COMMITS {
        return Err(refused(format!(
            "Select between 1 and {MAX_MAIL_PATCH_COMMITS} commits for a mail-patch series."
        )));
    }
    let mut seen = HashSet::new();
    oids.iter()
        .map(|oid| {
            validate_commit_oid(oid)?;
            let oid = oid.to_ascii_lowercase();
            if !seen.insert(oid.clone()) {
                return Err(refused(
                    "Each commit can appear only once in a mail-patch series.",
                ));
            }
            Ok(oid)
        })
        .collect()
}

fn empty_tree(oid: &str) -> &'static str {
    if oid.len() == 64 {
        "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321"
    } else {
        "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
    }
}

fn read_commits(
    path: &Path,
    oids: &[String],
) -> Result<(Vec<MailPatchCommit>, Option<String>), AppError> {
    let mut args = vec![
        "--no-replace-objects",
        "log",
        "--no-walk=unsorted",
        "--no-show-signature",
        "--no-notes",
        "--encoding=UTF-8",
        "-z",
        "--format=%H%x1f%P%x1f%T%x1f%an%x1f%ae%x1f%s",
    ];
    args.extend(oids.iter().map(String::as_str));
    let (output, truncated) = run_git_with_stdout_limit(path, &args, MAX_METADATA_BYTES)?;
    ensure_success("read the selected mail-patch commits", &output)?;
    if truncated {
        return Err(refused(
            "Selected commit metadata is too large to review completely.",
        ));
    }
    let text = String::from_utf8(output.stdout)
        .map_err(|_| refused("Selected commit metadata is not valid UTF-8."))?;
    let records: Vec<&str> = text
        .split('\0')
        .filter(|record| !record.is_empty())
        .collect();
    if records.len() != oids.len() {
        return Err(refused(
            "Git did not report every selected commit exactly once.",
        ));
    }
    let shallow = run_git(path, &["rev-parse", "--is-shallow-repository"])?;
    ensure_success("inspect mail-patch history depth", &shallow)?;
    let shallow = shallow.stdout != b"false\n";
    let mut commits = Vec::with_capacity(oids.len());
    let mut previous_tree = String::new();
    let mut base = None;
    for (index, (record, expected)) in records.iter().zip(oids).enumerate() {
        let fields: Vec<&str> = record.trim_start_matches('\n').split('\x1f').collect();
        let [oid, parents, tree, author_name, author_email, subject] = fields[..] else {
            return Err(refused(
                "Selected commit metadata could not be read unambiguously.",
            ));
        };
        if oid != expected {
            return Err(refused(
                "Git reported a different commit than the one selected.",
            ));
        }
        let parents: Vec<&str> = parents.split_whitespace().collect();
        if parents.len() > 1 {
            return Err(refused(
                "Mail patches cannot represent merge commits. Select only ordinary commits.",
            ));
        }
        if parents.is_empty() && shallow {
            return Err(refused(
                "A selected commit sits at a shallow history boundary. Deepen the history through local Git before exporting.",
            ));
        }
        let parent_tree = if index == 0 {
            match parents.first() {
                Some(parent) => {
                    base = Some((*parent).to_string());
                    let resolved = run_git(
                        path,
                        &[
                            "--no-replace-objects",
                            "rev-parse",
                            "--verify",
                            &format!("{parent}^{{tree}}"),
                        ],
                    )?;
                    ensure_success("read the mail-patch base tree", &resolved)?;
                    String::from_utf8_lossy(&resolved.stdout).trim().to_string()
                }
                None => empty_tree(oid).to_string(),
            }
        } else {
            if parents.first() != Some(&oids[index - 1].as_str()) {
                return Err(refused(
                    "Select consecutive commits from oldest to newest, each the direct child of the previous one.",
                ));
            }
            previous_tree.clone()
        };
        previous_tree = tree.to_string();
        commits.push(MailPatchCommit {
            oid: oid.into(),
            author_name: author_name.into(),
            author_email: author_email.into(),
            subject: subject.into(),
            root: parents.is_empty(),
            empty: tree == parent_tree,
        });
    }
    Ok((commits, base))
}

fn record_oids(series: &[u8]) -> Vec<&[u8]> {
    series
        .split(|byte| *byte == b'\n')
        .filter_map(|line| {
            let rest = line.strip_prefix(b"From ")?;
            let oid = rest.strip_suffix(MAIL_RECORD_DATE)?;
            (matches!(oid.len(), 40 | 64) && oid.iter().all(|byte| byte.is_ascii_hexdigit()))
                .then_some(oid)
        })
        .collect()
}

fn create_series(
    path: &Path,
    oids: &[String],
) -> Result<(Vec<MailPatchCommit>, Vec<u8>), AppError> {
    exchange_files::require_local_exchange_objects(path)?;
    let (commits, base) = read_commits(path, oids)?;
    let range;
    let mut args = FORMAT_PATCH_ARGS.to_vec();
    let last = oids.last().map(String::as_str).unwrap_or_default();
    match &base {
        Some(base) => {
            range = format!("{base}..{last}");
            args.push(&range);
        }
        None => args.extend(["--root", last]),
    }
    let (output, truncated) = run_git_with_stdout_limit(path, &args, MAX_MAIL_PATCH_BYTES)?;
    if truncated {
        return Err(refused(
            "The complete mail-patch series exceeds 16 MiB; use local Git for larger exports.",
        ));
    }
    ensure_success("format the selected commits as mail patches", &output)?;
    let reported = record_oids(&output.stdout);
    if !output.stdout.starts_with(b"From ")
        || reported.len() != oids.len()
        || reported
            .iter()
            .zip(oids)
            .any(|(found, oid)| *found != oid.as_bytes())
    {
        if omitted_only_empty_commits(path, oids, &reported)? {
            return Err(AppError::new(
                "mailPatchEmptyCommitsUnsupported",
                "This Git version leaves empty commits out of mail patches, so the series would be incomplete.",
                Some(
                    "Deselect the empty commits or upgrade Git (2.43 includes them), then prepare a fresh review. No file was written.",
                ),
            ));
        }
        return Err(refused(
            "The generated series does not separate exactly the selected commits. A commit message may contain a line that Git would treat as a new patch; use local Git for that series.",
        ));
    }
    Ok((commits, output.stdout))
}

/// True when Git reported the selection in order except for commits that change nothing.
fn omitted_only_empty_commits(
    path: &Path,
    oids: &[String],
    reported: &[&[u8]],
) -> Result<bool, AppError> {
    let mut found = reported.iter().peekable();
    let mut omitted = Vec::new();
    for oid in oids {
        if found.peek().is_some_and(|next| **next == oid.as_bytes()) {
            found.next();
        } else {
            omitted.push(oid);
        }
    }
    if found.next().is_some() || omitted.is_empty() {
        return Ok(false);
    }
    for oid in omitted {
        let output = run_git(path, &["show", "-s", "--format=%T %P", oid, "--"])?;
        ensure_success("inspect an omitted commit", &output)?;
        let text = String::from_utf8_lossy(&output.stdout);
        let mut fields = text.split_whitespace();
        let tree = fields.next().unwrap_or_default();
        let parent_tree = match fields.next() {
            Some(parent) => {
                let tree = run_git(
                    path,
                    &["rev-parse", "--verify", &format!("{parent}^{{tree}}")],
                )?;
                ensure_success("inspect an omitted commit's parent", &tree)?;
                String::from_utf8_lossy(&tree.stdout).trim().to_owned()
            }
            None => return Ok(false),
        };
        if fields.next().is_some() || tree != parent_tree {
            return Ok(false);
        }
    }
    Ok(true)
}

pub fn review_mail_patch_export(path: &Path, oids: &[String]) -> Result<MailPatchReview, AppError> {
    let oids = normalized_selection(oids)?;
    let (commits, series) = create_series(path, &oids)?;
    Ok(MailPatchReview {
        request: MailPatchRequest {
            oids,
            bytes: series.len(),
            fingerprint: fingerprint(&series)?,
        },
        commits,
    })
}

pub fn export_mail_patch(
    path: &Path,
    request: &MailPatchRequest,
    destination: &Path,
) -> Result<usize, AppError> {
    let oids = normalized_selection(&request.oids)?;
    let (_, series) = create_series(path, &oids)?;
    if series.len() != request.bytes || fingerprint(&series)? != request.fingerprint {
        return Err(refused(
            "The generated patches differ from the reviewed series, possibly because Git settings changed. Prepare a fresh review.",
        ));
    }
    exchange_files::write_new_exchange_file(path, destination, &series)
}

/// Explicit `git am` options so configured three-way fallback, scissors,
/// message IDs, CR stripping, whitespace fixing and rerere staging cannot
/// change what was reviewed. Configured hooks and commit signing still apply.
const AM_ARGS: &[&str] = &[
    "-c",
    "apply.ignoreWhitespace=false",
    "am",
    "-k",
    "--no-3way",
    "--no-scissors",
    "--no-message-id",
    "--keep-cr",
    "--no-rerere-autoupdate",
    "--whitespace=nowarn",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MailPatchImportRequest {
    pub file: String,
    pub bytes: usize,
    pub fingerprint: String,
    pub head_oid: String,
    pub branch: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MailPatchEntry {
    pub author_name: String,
    pub author_email: String,
    pub subject: String,
    pub empty: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailPatchImportReview {
    pub request: MailPatchImportRequest,
    pub patches: Vec<MailPatchEntry>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MailPatchAction {
    Continue,
    Skip,
    Abort,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MailPatchProgress {
    pub stopped: bool,
    pub current: Option<usize>,
    pub total: Option<usize>,
    pub message: String,
    pub recovery_ref: Option<String>,
}

fn io_error(error: std::io::Error) -> AppError {
    refused(format!("Mail-patch file access failed: {error}"))
}

fn git_directory(path: &Path) -> Result<PathBuf, AppError> {
    let output = run_git(path, &["rev-parse", "--absolute-git-dir"])?;
    ensure_success("locate mail-patch metadata", &output)?;
    let directory = std::str::from_utf8(&output.stdout)
        .ok()
        .and_then(|value| value.strip_suffix('\n'))
        .ok_or_else(|| refused("Git metadata path is not complete UTF-8."))?;
    Ok(PathBuf::from(directory))
}

fn read_series(file: &Path) -> Result<Vec<u8>, AppError> {
    if !fs::symlink_metadata(file).map_err(io_error)?.is_file() {
        return Err(refused(
            "Choose a regular mail-patch file, not a symlink or special device.",
        ));
    }
    let mut bytes = Vec::new();
    fs::File::open(file)
        .map_err(io_error)?
        .take((MAX_MAIL_PATCH_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.is_empty() || bytes.len() > MAX_MAIL_PATCH_BYTES {
        return Err(refused(
            "A complete mail-patch series must contain 1 byte to 16 MiB; partial imports are not offered.",
        ));
    }
    Ok(bytes)
}

/// Clean tracked state on a committed local branch. Untracked files may stay:
/// Git refuses to overwrite them while applying.
fn import_preflight(path: &Path) -> Result<(String, String), AppError> {
    exchange_files::require_local_exchange_objects(path)?;
    let status = read_status_with_limit_mode(path, 1, "no")?;
    if status.merge_in_progress
        || status.rebase_in_progress
        || status.mail_patch_in_progress
        || status.history_operation.is_some()
        || status.bisect_in_progress
        || status.rebase_split.is_some()
    {
        return Err(refused(
            "Finish or abort the active Git operation before applying mail patches.",
        ));
    }
    require_no_git_sequence(path)?;
    if status.entry_count != 0 || status.entries_truncated {
        return Err(refused(
            "Applying mail patches requires no staged, unstaged or conflicted tracked changes. Commit, stash or discard them first.",
        ));
    }
    require_visible_replay_index(path)?;
    let (flags, truncated) =
        run_git_with_stdout_limit(path, &["ls-files", "-v", "-z"], MAX_METADATA_BYTES)?;
    ensure_success(
        "inspect excluded paths before applying mail patches",
        &flags,
    )?;
    if truncated
        || flags
            .stdout
            .split(|byte| *byte == 0)
            .any(|record| record.starts_with(b"S ") || record.starts_with(b"s "))
    {
        return Err(refused(
            "Sparse or skip-worktree entries prevent complete mail-patch application. Restore a full working tree first.",
        ));
    }
    let head = run_git(path, &["rev-parse", "--verify", "HEAD^{commit}"])?;
    ensure_success("identify the mail-patch base commit", &head).map_err(|_| {
        refused("Applying mail patches here requires a branch with at least one commit.")
    })?;
    let head = String::from_utf8(head.stdout)
        .ok()
        .and_then(|value| value.strip_suffix('\n').map(str::to_owned))
        .ok_or_else(|| refused("HEAD is not a complete commit ID."))?;
    validate_commit_oid(&head)?;
    let branch = run_git(path, &["symbolic-ref", "-q", "HEAD"])?;
    let branch = String::from_utf8(branch.stdout)
        .ok()
        .and_then(|value| value.strip_suffix('\n').map(str::to_owned))
        .filter(|value| value.starts_with("refs/heads/"))
        .ok_or_else(|| {
            refused("Check out a local branch before applying mail patches; detached HEAD is not supported here.")
        })?;
    Ok((head, branch))
}

fn temporary_directory(path: &Path) -> Result<PathBuf, AppError> {
    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| refused("The system clock is invalid."))?
        .as_nanos();
    let directory =
        git_directory(path)?.join(format!("git-khronos-mail-{id}-{}.tmp", std::process::id()));
    fs::create_dir(&directory).map_err(io_error)?;
    Ok(directory)
}

fn captured<T>(
    path: &Path,
    bytes: &[u8],
    action: impl FnOnce(&Path, &Path) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let directory = temporary_directory(path)?;
    let series = directory.join("series");
    let result = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&series)
        .and_then(|mut output| output.write_all(bytes).and_then(|_| output.sync_all()))
        .map_err(io_error)
        .and_then(|_| action(&directory, &series));
    match fs::remove_dir_all(&directory) {
        Ok(()) => result,
        Err(error) => Err(refused(format!(
            "Mail-patch operation {} and temporary capture cleanup failed at '{}': {error}. Inspect the repository before retrying.",
            match result {
                Ok(_) => "finished".into(),
                Err(error) => format!("failed ({})", error.message),
            },
            directory.display()
        ))),
    }
}

fn mail_info(path: &Path, part: &Path, directory: &Path) -> Result<MailPatchEntry, AppError> {
    let message = directory.join("msg");
    let patch = directory.join("patch");
    let output = crate::git_in(path)
        .args(["mailinfo", "-k", "--no-scissors"])
        .arg(&message)
        .arg(&patch)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .stdin(fs::File::open(part).map_err(io_error)?)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(io_error)?;
    ensure_success("read mail-patch author and subject", &output)?;
    if output.stdout.len() > MAX_METADATA_BYTES {
        return Err(refused(
            "Mail-patch header information exceeds the review limit.",
        ));
    }
    let text = String::from_utf8(output.stdout)
        .map_err(|_| refused("Mail-patch author or subject is not UTF-8."))?;
    let field = |name: &str| {
        text.lines()
            .find_map(|line| line.strip_prefix(name))
            .unwrap_or_default()
            .to_owned()
    };
    let entry = MailPatchEntry {
        author_name: field("Author: "),
        author_email: field("Email: "),
        subject: field("Subject: "),
        empty: fs::metadata(&patch).map_err(io_error)?.len() == 0,
    };
    if entry.author_email.is_empty() {
        return Err(refused(
            "Every mail patch must name its author with an email address.",
        ));
    }
    Ok(entry)
}

fn inspect_series(
    path: &Path,
    directory: &Path,
    series: &Path,
) -> Result<Vec<MailPatchEntry>, AppError> {
    let parts = directory.join("parts");
    fs::create_dir(&parts).map_err(io_error)?;
    let output = run_git(
        path,
        &[
            "mailsplit",
            "--keep-cr",
            &format!("-o{}", parts.display()),
            series
                .to_str()
                .ok_or_else(|| refused("Captured series path is not UTF-8."))?,
        ],
    )?;
    ensure_success("split the mail-patch series", &output)?;
    let count = std::str::from_utf8(&output.stdout)
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .ok_or_else(|| refused("Git did not report a complete mail-patch count."))?;
    if count == 0 || count > MAX_MAIL_PATCH_COMMITS {
        return Err(refused(format!(
            "A mail-patch series must contain 1 to {MAX_MAIL_PATCH_COMMITS} patches."
        )));
    }
    (1..=count)
        .map(|number| mail_info(path, &parts.join(format!("{number:04}")), directory))
        .collect()
}

pub fn review_mail_patch_import(
    path: &Path,
    file: &Path,
) -> Result<MailPatchImportReview, AppError> {
    let (head_oid, branch) = import_preflight(path)?;
    let bytes = read_series(file)?;
    let patches = captured(path, &bytes, |directory, series| {
        inspect_series(path, directory, series)
    })?;
    Ok(MailPatchImportReview {
        request: MailPatchImportRequest {
            file: file
                .to_str()
                .ok_or_else(|| refused("Mail-patch file path is not UTF-8."))?
                .into(),
            bytes: bytes.len(),
            fingerprint: fingerprint(&bytes)?,
            head_oid,
            branch,
            count: patches.len(),
        },
        patches,
    })
}

fn progress(
    path: &Path,
    message: String,
    recovery_ref: Option<String>,
) -> Result<MailPatchProgress, AppError> {
    let directory = git_directory(path)?.join("rebase-apply");
    let stopped = directory.join("applying").is_file();
    let number = |name: &str| {
        let mut value = String::new();
        fs::File::open(directory.join(name))
            .and_then(|file| file.take(32).read_to_string(&mut value))
            .ok()
            .and_then(|_| value.trim().parse().ok())
    };
    Ok(MailPatchProgress {
        stopped,
        current: stopped.then(|| number("next")).flatten(),
        total: stopped.then(|| number("last")).flatten(),
        message,
        recovery_ref,
    })
}

fn report(output: &Output) -> String {
    let mut text =
        String::from_utf8_lossy(&[&output.stdout[..], &output.stderr[..]].concat()).into_owned();
    if text.len() > 64 * 1024 {
        let mut end = 64 * 1024;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
        text.push_str("\n[report truncated]");
    }
    redact_url_credentials(&text)
}

pub fn import_mail_patch(
    path: &Path,
    request: &MailPatchImportRequest,
) -> Result<MailPatchProgress, AppError> {
    let (head, branch) = import_preflight(path)?;
    let bytes = read_series(Path::new(&request.file))?;
    if head != request.head_oid
        || branch != request.branch
        || bytes.len() != request.bytes
        || fingerprint(&bytes)? != request.fingerprint
    {
        return Err(refused(
            "The mail-patch file, HEAD or branch changed after review. No patch was applied.",
        ));
    }
    captured(path, &bytes, |directory, series| {
        if inspect_series(path, directory, series)?.len() != request.count {
            return Err(refused(
                "The reviewed patch count changed. No patch was applied.",
            ));
        }
        if import_preflight(path)? != (head.clone(), branch.clone()) {
            return Err(refused(
                "Repository state changed during preparation. No patch was applied.",
            ));
        }
        let recovery = preserve_reference(
            path,
            &head,
            &format!("Before applying mail patches to {branch}"),
        )?;
        let mut args = AM_ARGS.to_vec();
        let file = series
            .to_str()
            .ok_or_else(|| refused("Captured series path is not UTF-8."))?;
        args.push(file);
        let output = run_git(path, &args)?;
        let state = progress(path, report(&output), Some(recovery.clone()))?;
        if output.status.success() || state.stopped {
            return Ok(state);
        }
        Err(AppError::new(
            "mailPatchImportFailed",
            format!("Git could not apply the mail patches: {}", state.message),
            Some(&format!(
                "The original branch tip is preserved at {recovery}. Inspect the branch and working tree before retrying."
            )),
        ))
    })
}

pub fn control_mail_patch(
    path: &Path,
    action: MailPatchAction,
) -> Result<MailPatchProgress, AppError> {
    if !progress(path, String::new(), None)?.stopped {
        return Err(refused(
            "No mail-patch application is waiting for a decision.",
        ));
    }
    let flag = match action {
        MailPatchAction::Continue => "--continue",
        MailPatchAction::Skip => "--skip",
        MailPatchAction::Abort => "--abort",
    };
    let output = run_git(path, &["am", flag])?;
    let state = progress(path, report(&output), None)?;
    if output.status.success() || state.stopped {
        return Ok(state);
    }
    Err(AppError::new(
        "mailPatchControlFailed",
        format!(
            "Git could not {} the mail-patch application: {}",
            &flag[2..],
            state.message
        ),
        Some(
            "Inspect the branch and working tree; a recovery reference was created before application began.",
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture {
        directory: PathBuf,
        source: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let id = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let directory =
                std::env::temp_dir().join(format!("chronos-mail-{}-{id}", std::process::id()));
            let source = directory.join("source");
            Self::repository(&source);
            Self { directory, source }
        }
        fn repository(path: &Path) {
            fs::create_dir_all(path).unwrap();
            for args in [
                vec!["init", "-b", "main"],
                vec!["config", "user.name", "Mail Author"],
                vec!["config", "user.email", "mail@example.test"],
                vec!["config", "commit.gpgsign", "false"],
            ] {
                Self::git(path, &args);
            }
        }
        fn git(path: &Path, args: &[&str]) {
            run_mutation(path, args, "prepare owned mail-patch fixture").unwrap();
        }
        fn output(path: &Path, args: &[&str]) -> Vec<u8> {
            let output = run_git(path, args).unwrap();
            ensure_success("inspect owned mail-patch fixture", &output).unwrap();
            output.stdout
        }
        fn commit(&self, file: &str, contents: &[u8], message: &str) -> String {
            fs::write(self.source.join(file), contents).unwrap();
            Self::git(&self.source, &["add", "."]);
            Self::git(&self.source, &["commit", "-m", message]);
            Self::head(&self.source)
        }
        fn head(path: &Path) -> String {
            String::from_utf8(Self::output(path, &["rev-parse", "HEAD"]))
                .unwrap()
                .trim()
                .into()
        }
        fn history(path: &Path) -> Vec<u8> {
            Self::output(path, &["log", "--format=%T%x00%an%x00%ae%x00%ad%x00%B%x00"])
        }
        fn apply(target: &Path, series: &Path) {
            Self::git(
                target,
                &[
                    "am",
                    "-k",
                    "--no-3way",
                    "--no-scissors",
                    "--no-message-id",
                    "--empty=keep",
                    series.to_str().unwrap(),
                ],
            );
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.directory).unwrap();
        }
    }

    #[test]
    fn complete_series_round_trips_exact_history_despite_hostile_configuration() {
        let fixture = Fixture::new();
        let root = fixture.commit("text", b"one\n", "[tag] Root subject");
        Fixture::git(
            &fixture.source,
            &["commit", "--allow-empty", "-m", "Empty step"],
        );
        let empty = Fixture::head(&fixture.source);
        let binary = fixture.commit(
            "binary",
            &[0, 1, 255, 2],
            "Binary payload\n\nFrom the body\n>From quoted",
        );
        Fixture::git(
            &fixture.source,
            &["notes", "add", "-m", "private note", "HEAD"],
        );
        for (key, value) in [
            ("format.mboxrd", "true"),
            ("format.signOff", "true"),
            ("format.headers", "X-Owned: header"),
            ("format.coverLetter", "true"),
            ("format.numbered", "true"),
            ("format.notes", "true"),
            ("format.signature", "owned signature"),
            ("diff.noprefix", "true"),
            ("diff.context", "0"),
            ("diff.external", "false"),
            ("diff.renames", "copies"),
        ] {
            Fixture::git(&fixture.source, &["config", key, value]);
        }
        let selection = vec![root.clone(), empty.clone(), binary.to_uppercase()];
        let review = match review_mail_patch_export(&fixture.source, &selection) {
            Err(error) if error.kind == "mailPatchEmptyCommitsUnsupported" => return,
            result => result.unwrap(),
        };
        assert_eq!(review.request.oids, vec![root, empty, binary]);
        assert!(review.commits[0].root && !review.commits[0].empty);
        assert!(review.commits[1].empty && !review.commits[2].empty);
        assert_eq!(review.commits[0].subject, "[tag] Root subject");
        let file = fixture.directory.join("series.mbox");
        assert_eq!(
            export_mail_patch(&fixture.source, &review.request, &file).unwrap(),
            review.request.bytes
        );
        let series = fs::read(&file).unwrap();
        for absent in [
            "Signed-off-by",
            "X-Owned",
            "private note",
            "owned signature",
            "[PATCH",
        ] {
            assert!(
                !String::from_utf8_lossy(&series).contains(absent),
                "{absent}"
            );
        }
        let target = fixture.directory.join("target");
        Fixture::repository(&target);
        Fixture::apply(&target, &file);
        assert_eq!(Fixture::history(&target), Fixture::history(&fixture.source));
        let existing = fs::read(&file).unwrap();
        assert!(export_mail_patch(&fixture.source, &review.request, &file).is_err());
        assert_eq!(fs::read(&file).unwrap(), existing);
    }

    #[test]
    fn partial_series_applies_on_the_original_parent_and_refuses_unsafe_selections() {
        let fixture = Fixture::new();
        let base = fixture.commit("text", b"base\n", "Base");
        let first = fixture.commit("text", b"first\n", "First");
        let second = fixture.commit("text", b"second\n", "Second");
        let third = fixture.commit("text", b"third\n", "Third");
        let review =
            review_mail_patch_export(&fixture.source, &[first.clone(), second.clone()]).unwrap();
        assert!(review.commits.iter().all(|commit| !commit.root));
        let file = fixture.directory.join("partial.mbox");
        export_mail_patch(&fixture.source, &review.request, &file).unwrap();
        let target = fixture.directory.join("target");
        Fixture::git(
            &fixture.directory,
            &[
                "clone",
                "--quiet",
                fixture.source.to_str().unwrap(),
                target.to_str().unwrap(),
            ],
        );
        Fixture::git(&target, &["reset", "--hard", &base]);
        Fixture::apply(&target, &file);
        assert_eq!(
            Fixture::output(&target, &["rev-parse", "HEAD^{tree}"]),
            Fixture::output(
                &fixture.source,
                &["rev-parse", &format!("{second}^{{tree}}")]
            )
        );
        for (selection, expected) in [
            (vec![], "between 1 and 500"),
            (vec![first.clone(), third.clone()], "consecutive"),
            (vec![second.clone(), first.clone()], "consecutive"),
            (vec![first.clone(), first.to_uppercase()], "only once"),
            (vec!["z".repeat(40)], "invalid"),
            (vec![first.clone(); 501], "between 1 and 500"),
        ] {
            let error = review_mail_patch_export(&fixture.source, &selection).unwrap_err();
            assert!(
                error.message.contains(expected),
                "{expected}: {}",
                error.message
            );
        }
        assert!(review_mail_patch_export(&fixture.source, &["0".repeat(40)]).is_err());
        Fixture::git(&fixture.source, &["checkout", "-q", "-b", "side", &base]);
        let side = fixture.commit("side", b"side\n", "Side");
        Fixture::git(&fixture.source, &["checkout", "-q", "main"]);
        Fixture::git(
            &fixture.source,
            &["merge", "--no-ff", "-q", "-m", "Merge side", "side"],
        );
        let merge = Fixture::head(&fixture.source);
        assert!(
            review_mail_patch_export(&fixture.source, &[merge])
                .unwrap_err()
                .message
                .contains("merge")
        );
        assert!(review_mail_patch_export(&fixture.source, &[side]).is_ok());
        for destination in [
            fixture.source.join("inside.mbox"),
            fixture.source.join(".git/inside.mbox"),
            PathBuf::from("relative.mbox"),
        ] {
            assert!(export_mail_patch(&fixture.source, &review.request, &destination).is_err());
            assert!(!destination.exists());
        }
        Fixture::git(&fixture.source, &["config", "diff.context", "1"]);
        let mut stale = review.request.clone();
        stale.fingerprint = "0".repeat(40);
        let destination = fixture.directory.join("stale.mbox");
        assert!(
            export_mail_patch(&fixture.source, &stale, &destination)
                .unwrap_err()
                .message
                .contains("fresh review")
        );
        assert!(!destination.exists());
    }

    #[test]
    fn ambiguous_records_shallow_boundaries_and_partial_clones_refuse() {
        let fixture = Fixture::new();
        fixture.commit("text", b"base\n", "Base");
        let header = format!("From {} Mon Sep 17 00:00:00 2001", "a".repeat(40));
        let forged = fixture.commit("text", b"forged\n", &format!("Forged\n\n{header}\nbody"));
        assert!(
            review_mail_patch_export(&fixture.source, std::slice::from_ref(&forged))
                .unwrap_err()
                .message
                .contains("new patch")
        );
        let ordinary = fixture.commit("text", b"next\n", "Next");
        fs::write(fixture.source.join(".git/shallow"), format!("{ordinary}\n")).unwrap();
        assert!(
            review_mail_patch_export(&fixture.source, std::slice::from_ref(&ordinary))
                .unwrap_err()
                .message
                .contains("shallow")
        );
        fs::remove_file(fixture.source.join(".git/shallow")).unwrap();
        Fixture::git(
            &fixture.source,
            &["config", "remote.owned.promisor", "true"],
        );
        assert!(
            review_mail_patch_export(&fixture.source, std::slice::from_ref(&ordinary))
                .unwrap_err()
                .message
                .contains("implicit network downloads")
        );
        Fixture::git(
            &fixture.source,
            &["config", "--unset", "remote.owned.promisor"],
        );
        Fixture::git(
            &fixture.source,
            &["config", "extensions.partialClone", "owned"],
        );
        assert!(
            review_mail_patch_export(&fixture.source, &[ordinary])
                .unwrap_err()
                .message
                .contains("partial clones")
        );
    }

    #[test]
    fn five_hundred_commit_series_and_oversized_output_boundaries() {
        let fixture = Fixture::new();
        let mut stream = Vec::new();
        for index in 1..=500 {
            let contents = format!("{index}\n");
            let message = format!("Step {index}\n");
            stream.extend(format!(
                "commit refs/heads/main\ncommitter Mail Author <mail@example.test> {} +0000\ndata {}\n{message}M 100644 inline counter\ndata {}\n{contents}\n",
                1_700_000_000 + index, message.len(), contents.len()
            ).as_bytes());
        }
        run_git_with_input(
            &fixture.source,
            &["fast-import", "--quiet"],
            &stream,
            "prepare owned mail-patch fixture",
        )
        .unwrap();
        let oids: Vec<String> = String::from_utf8(Fixture::output(
            &fixture.source,
            &["rev-list", "--reverse", "main"],
        ))
        .unwrap()
        .lines()
        .map(String::from)
        .collect();
        assert_eq!(oids.len(), 500);
        let review = review_mail_patch_export(&fixture.source, &oids).unwrap();
        assert_eq!(review.commits.len(), 500);
        assert_eq!(
            record_oids(&create_series(&fixture.source, &oids).unwrap().1).len(),
            500
        );
        Fixture::git(&fixture.source, &["reset", "-q", "--hard", "main"]);
        let mut state = 0x9e37_79b9_7f4a_7c15_u64;
        let noise: Vec<u8> = (0..(14 * 1024 * 1024))
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                state as u8
            })
            .collect();
        let large = fixture.commit("noise", &noise, "Large noise");
        let error = review_mail_patch_export(&fixture.source, &[large]).unwrap_err();
        assert!(error.message.contains("16 MiB"), "{}", error.message);
    }

    impl Fixture {
        fn export(&self, oids: &[String], name: &str) -> PathBuf {
            let review = review_mail_patch_export(&self.source, oids).unwrap();
            let file = self.directory.join(name);
            export_mail_patch(&self.source, &review.request, &file).unwrap();
            file
        }
        fn target(&self, base: &str) -> PathBuf {
            let target = self.directory.join("target");
            Self::git(
                &self.directory,
                &[
                    "clone",
                    "-q",
                    "--no-local",
                    self.source.to_str().unwrap(),
                    "target",
                ],
            );
            Self::git(&target, &["config", "commit.gpgsign", "false"]);
            Self::git(&target, &["reset", "-q", "--hard", base]);
            target
        }
        fn in_progress(path: &Path) -> bool {
            read_status(path).unwrap().mail_patch_in_progress
        }
    }

    #[test]
    fn import_applies_reviewed_series_exactly_despite_hostile_configuration() {
        let fixture = Fixture::new();
        let base = fixture.commit("text", b"base\n", "Base");
        let first = fixture.commit(
            "text",
            b"spaced line   \r\nsecond\r\n",
            "CRLF and whitespace\n\nBody keeps\n-- >8 --\nafter scissors",
        );
        let second = fixture.commit("binary", &[0, 159, 255, 13, 10], "[keep] Binary");
        let series = fixture.export(&[first.clone(), second.clone()], "series.mbox");
        let target = fixture.target(&base);
        for (key, value) in [
            ("am.threeWay", "true"),
            ("am.keepcr", "false"),
            ("am.messageid", "true"),
            ("mailinfo.scissors", "true"),
            ("apply.whitespace", "fix"),
            ("apply.ignoreWhitespace", "change"),
            ("rerere.enabled", "true"),
        ] {
            Fixture::git(&target, &["config", key, value]);
        }
        Fixture::git(&target, &["tag", "unrelated", &base]);
        fs::write(target.join("untracked"), b"keep").unwrap();

        let review = review_mail_patch_import(&target, &series).unwrap();
        assert_eq!(review.request.count, 2);
        assert_eq!(review.request.head_oid, base);
        assert_eq!(review.request.branch, "refs/heads/main");
        assert_eq!(review.patches[0].subject, "CRLF and whitespace");
        assert_eq!(review.patches[1].subject, "[keep] Binary");
        assert_eq!(review.patches[0].author_email, "mail@example.test");
        assert!(!review.patches[0].empty);

        let result = import_mail_patch(&target, &review.request).unwrap();
        assert!(!result.stopped, "{}", result.message);
        let recovery = result.recovery_ref.unwrap();
        assert_eq!(
            Fixture::output(&target, &["rev-parse", &recovery]),
            format!("{base}\n").into_bytes()
        );
        let range = |path: &Path| {
            Fixture::output(
                path,
                &[
                    "log",
                    "--format=%T%x00%an%x00%ae%x00%ad%x00%B%x00",
                    &format!("{base}..HEAD"),
                ],
            )
        };
        assert_eq!(range(&target), range(&fixture.source));
        assert_eq!(fs::read(target.join("untracked")).unwrap(), b"keep");
        assert_eq!(
            Fixture::output(&target, &["rev-parse", "unrelated"]),
            format!("{base}\n").into_bytes()
        );
        assert!(!Fixture::in_progress(&target));
    }

    #[test]
    fn conflicts_stop_recoverably_and_continue_skip_abort_follow_git() {
        let fixture = Fixture::new();
        let base = fixture.commit("text", b"base\n", "Base");
        let conflicting = fixture.commit("text", b"source\n", "Conflicting change");
        let independent = fixture.commit("other", b"other\n", "Independent change");
        Fixture::git(
            &fixture.source,
            &["commit", "--allow-empty", "-m", "Empty change"],
        );
        let empty = Fixture::head(&fixture.source);
        let selection = [conflicting, independent, empty];
        if let Err(error) = review_mail_patch_export(&fixture.source, &selection) {
            assert_eq!(error.kind, "mailPatchEmptyCommitsUnsupported", "{error:?}");
            return;
        }
        let series = fixture.export(&selection, "series.mbox");
        let target = fixture.target(&base);
        fs::write(target.join("text"), b"target\n").unwrap();
        Fixture::git(&target, &["commit", "-qam", "Target change"]);
        let original = Fixture::head(&target);

        let review = review_mail_patch_import(&target, &series).unwrap();
        assert!(review.patches[2].empty);
        let stopped = import_mail_patch(&target, &review.request).unwrap();
        assert!(stopped.stopped);
        assert_eq!((stopped.current, stopped.total), (Some(1), Some(3)));
        assert!(Fixture::in_progress(&target));
        let busy = review_mail_patch_import(&target, &series).unwrap_err();
        assert!(
            busy.message.contains("active Git operation"),
            "{}",
            busy.message
        );

        let aborted = control_mail_patch(&target, MailPatchAction::Abort).unwrap();
        assert!(!aborted.stopped);
        assert_eq!(Fixture::head(&target), original);
        assert_eq!(fs::read(target.join("text")).unwrap(), b"target\n");
        assert!(!Fixture::in_progress(&target));
        assert!(control_mail_patch(&target, MailPatchAction::Continue).is_err());

        let review = review_mail_patch_import(&target, &series).unwrap();
        assert!(import_mail_patch(&target, &review.request).unwrap().stopped);
        let unresolved = control_mail_patch(&target, MailPatchAction::Continue).unwrap();
        assert!(unresolved.stopped && unresolved.current == Some(1));
        fs::write(target.join("text"), b"resolved\n").unwrap();
        Fixture::git(&target, &["add", "text"]);
        let paused_head = Fixture::head(&target);
        let refused = crate::commit_with_policy(
            &target,
            "Ordinary commit",
            false,
            false,
            None,
            &crate::CommitPolicy::default(),
        )
        .unwrap_err();
        assert_eq!(refused.kind, "mailPatchCommit");
        assert_eq!(Fixture::head(&target), paused_head);
        assert!(Fixture::in_progress(&target));
        let empty_stop = control_mail_patch(&target, MailPatchAction::Continue).unwrap();
        assert!(empty_stop.stopped);
        assert_eq!(empty_stop.current, Some(3));
        let done = control_mail_patch(&target, MailPatchAction::Skip).unwrap();
        assert!(!done.stopped && !Fixture::in_progress(&target));
        assert_eq!(
            Fixture::output(
                &target,
                &["log", "--format=%s", &format!("{original}..HEAD")]
            ),
            b"Independent change\nConflicting change\n"
        );
        assert_eq!(fs::read(target.join("text")).unwrap(), b"resolved\n");

        Fixture::git(&target, &["reset", "-q", "--hard", &original]);
        let review = review_mail_patch_import(&target, &series).unwrap();
        assert!(import_mail_patch(&target, &review.request).unwrap().stopped);
        let skipped = control_mail_patch(&target, MailPatchAction::Skip).unwrap();
        assert!(skipped.stopped && skipped.current == Some(3));
        assert!(
            !control_mail_patch(&target, MailPatchAction::Skip)
                .unwrap()
                .stopped
        );
        assert_eq!(
            Fixture::output(
                &target,
                &["log", "--format=%s", &format!("{original}..HEAD")]
            ),
            b"Independent change\n"
        );
    }

    #[test]
    fn import_refuses_stale_dirty_detached_and_invalid_inputs_before_applying() {
        let fixture = Fixture::new();
        let base = fixture.commit("text", b"base\n", "Base");
        let change = fixture.commit("text", b"change\n", "Change");
        let series = fixture.export(&[change], "series.mbox");
        let target = fixture.target(&base);

        let review = review_mail_patch_import(&target, &series).unwrap();
        let mut changed = fs::read(&series).unwrap();
        changed.extend_from_slice(b"\n");
        fs::write(fixture.directory.join("changed.mbox"), &changed).unwrap();
        let mut stale = review.request.clone();
        stale.file = fixture
            .directory
            .join("changed.mbox")
            .to_str()
            .unwrap()
            .into();
        assert!(
            import_mail_patch(&target, &stale)
                .unwrap_err()
                .message
                .contains("changed after review")
        );
        let mut count = review.request.clone();
        count.count = 2;
        assert!(
            import_mail_patch(&target, &count)
                .unwrap_err()
                .message
                .contains("count changed")
        );

        fs::write(target.join("text"), b"dirty\n").unwrap();
        assert!(
            import_mail_patch(&target, &review.request)
                .unwrap_err()
                .message
                .contains("tracked changes")
        );
        Fixture::git(&target, &["commit", "-qam", "Moved"]);
        assert!(
            import_mail_patch(&target, &review.request)
                .unwrap_err()
                .message
                .contains("changed after review")
        );
        Fixture::git(&target, &["checkout", "-q", "--detach"]);
        assert!(
            review_mail_patch_import(&target, &series)
                .unwrap_err()
                .message
                .contains("detached")
        );
        Fixture::git(&target, &["checkout", "-q", "main"]);

        let moved = Fixture::head(&target);
        for (name, contents) in [
            ("blank.mbox", &b""[..]),
            ("text.mbox", &b"not a mail patch\n"[..]),
        ] {
            let file = fixture.directory.join(name);
            fs::write(&file, contents).unwrap();
            assert!(review_mail_patch_import(&target, &file).is_err(), "{name}");
        }
        #[cfg(unix)]
        {
            let link = fixture.directory.join("link.mbox");
            std::os::unix::fs::symlink(&series, &link).unwrap();
            assert!(
                review_mail_patch_import(&target, &link)
                    .unwrap_err()
                    .message
                    .contains("symlink")
            );
        }
        assert_eq!(Fixture::head(&target), moved);
        assert!(!Fixture::in_progress(&target));
        assert_eq!(
            Fixture::output(&target, &["for-each-ref", "refs/git-khronos"]),
            b""
        );
    }

    #[cfg(unix)]
    #[test]
    fn refusing_applypatch_hook_stops_without_committing_and_abort_restores() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = Fixture::new();
        let base = fixture.commit("text", b"base\n", "Base");
        let change = fixture.commit("text", b"change\n", "Change");
        let series = fixture.export(&[change], "series.mbox");
        let target = fixture.target(&base);
        let hooks = fixture.directory.join("hooks");
        fs::create_dir(&hooks).unwrap();
        let hook = hooks.join("pre-applypatch");
        fs::write(&hook, "#!/bin/sh\necho owned hook refused >&2\nexit 1\n").unwrap();
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
        Fixture::git(
            &target,
            &["config", "core.hooksPath", hooks.to_str().unwrap()],
        );
        let review = review_mail_patch_import(&target, &series).unwrap();
        let result = import_mail_patch(&target, &review.request).unwrap();
        assert!(result.stopped, "{}", result.message);
        assert!(
            result.message.contains("owned hook refused"),
            "{}",
            result.message
        );
        assert_eq!(Fixture::head(&target), base);
        control_mail_patch(&target, MailPatchAction::Abort).unwrap();
        assert_eq!(Fixture::head(&target), base);
        assert_eq!(fs::read(target.join("text")).unwrap(), b"base\n");
        assert!(!Fixture::in_progress(&target));
    }
}
