//! Read-only history investigation using documented Git commands and pinned revisions.
use super::*;
use std::time::Instant;

const OUTPUT_LIMIT: usize = 16 * 1024 * 1024;
const TIME_LIMIT: Duration = Duration::from_secs(15);

fn cancelled_history() -> AppError {
    AppError::new(
        "operationCancelled",
        "History investigation was cancelled. Returned results are incomplete; no repository changes were made.",
        None,
    )
}

pub(super) fn decode_git_path(value: &str) -> Result<String, AppError> {
    if !value.starts_with('"') {
        return Ok(value.into());
    }
    let mut decoded = Vec::new();
    let mut bytes = value.trim_matches('"').bytes();
    while let Some(byte) = bytes.next() {
        if byte != b'\\' {
            decoded.push(byte);
            continue;
        }
        let next = bytes
            .next()
            .ok_or_else(|| AppError::new("invalidBlameOutput", "Incomplete quoted path.", None))?;
        decoded.push(match next {
            b'n' => b'\n',
            b't' => b'\t',
            b'r' => b'\r',
            b'\\' => b'\\',
            b'"' => b'"',
            b'0'..=b'3' => {
                let second = bytes.next().filter(|b| (b'0'..=b'7').contains(b));
                let third = bytes.next().filter(|b| (b'0'..=b'7').contains(b));
                match (second, third) {
                    (Some(second), Some(third)) => {
                        (next - b'0') * 64 + (second - b'0') * 8 + third - b'0'
                    }
                    _ => {
                        return Err(AppError::new(
                            "invalidBlameOutput",
                            "Invalid quoted path.",
                            None,
                        ));
                    }
                }
            }
            _ => {
                return Err(AppError::new(
                    "invalidBlameOutput",
                    "Unsupported quoted path.",
                    None,
                ));
            }
        });
    }
    String::from_utf8(decoded)
        .map_err(|_| AppError::new("unsupportedPathEncoding", "Blame path is not UTF-8.", None))
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryQuery {
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub oid: String,
    #[serde(default)]
    pub since: String,
    #[serde(default)]
    pub until: String,
    #[serde(default)]
    pub path: String,
    /// Empty means all refs plus HEAD; supports a single ref or an A..B range.
    #[serde(default)]
    pub scope: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCursor {
    pub query: HistoryQuery,
    pub revisions: Vec<String>,
    pub offset: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySearchPage {
    pub entries: Vec<FileHistoryEntry>,
    pub cursor: Option<HistoryCursor>,
    pub complete: bool,
    pub scanned: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHistoryCursor {
    pub revision: String,
    #[serde(default)]
    pub requested_revision: String,
    pub path: String,
    pub historical_path: String,
    pub offset: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalFileEntry {
    #[serde(flatten)]
    pub commit: FileHistoryEntry,
    pub path: String,
    pub previous_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHistoryPage {
    pub entries: Vec<HistoricalFileEntry>,
    pub cursor: Option<FileHistoryCursor>,
    pub complete: bool,
}

/// Both pipes are capped and drained concurrently; timeout/cancel kills and reaps Git.
fn bounded_git(
    path: &Path,
    args: &[String],
    token: &CancellationToken,
) -> Result<Output, AppError> {
    if token.is_cancelled() {
        return Err(cancelled_history());
    }
    let mut command = crate::git_in(path);
    command
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_tree(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| AppError::new("gitUnavailable", error.to_string(), None))?;
    let overflow = Arc::new(AtomicBool::new(false));
    fn read_pipe(mut pipe: impl Read, overflow: Arc<AtomicBool>) -> std::io::Result<Vec<u8>> {
        let mut bytes = Vec::new();
        let mut buffer = [0; 8192];
        loop {
            let count = pipe.read(&mut buffer)?;
            if count == 0 {
                return Ok(bytes);
            }
            let retained = count.min(OUTPUT_LIMIT.saturating_sub(bytes.len()));
            bytes.extend_from_slice(&buffer[..retained]);
            if retained < count {
                overflow.store(true, Ordering::Release);
            }
        }
    }
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let out_overflow = overflow.clone();
    let err_overflow = overflow.clone();
    let out = thread::spawn(move || read_pipe(stdout, out_overflow));
    let err = thread::spawn(move || read_pipe(stderr, err_overflow));
    let started = Instant::now();
    let result = loop {
        let failure = if token.is_cancelled() {
            Some(cancelled_history())
        } else if overflow.load(Ordering::Acquire) {
            Some(AppError::new(
                "historyOutputLimit",
                "History output exceeded 16 MiB. Narrow the query.",
                None,
            ))
        } else if started.elapsed() >= TIME_LIMIT {
            Some(AppError::new(
                "historyTimeout",
                "History query exceeded 15 seconds. Narrow the scope or path and retry.",
                None,
            ))
        } else {
            None
        };
        if let Some(failure) = failure {
            terminate_process_tree(&mut child);
            let _ = child.wait();
            break Err(failure);
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(error) => {
                terminate_process_tree(&mut child);
                let _ = child.wait();
                break Err(AppError::new("gitWaitFailed", error.to_string(), None));
            }
        }
    };
    let stdout = out
        .join()
        .map_err(|_| AppError::new("gitOutputFailed", "History reader failed.", None))?
        .map_err(|e| AppError::new("gitOutputFailed", e.to_string(), None))?;
    let stderr = err
        .join()
        .map_err(|_| AppError::new("gitOutputFailed", "History reader failed.", None))?
        .map_err(|e| AppError::new("gitOutputFailed", e.to_string(), None))?;
    let status = result?;
    if overflow.load(Ordering::Acquire) {
        return Err(AppError::new(
            "historyOutputLimit",
            "History output exceeded 16 MiB. Narrow the query.",
            None,
        ));
    }
    let output = Output {
        status,
        stdout,
        stderr,
    };
    ensure_success("inspect history", &output)?;
    Ok(output)
}

fn git(path: &Path, args: &[&str], token: &CancellationToken) -> Result<Output, AppError> {
    bounded_git(
        path,
        &args.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>(),
        token,
    )
}

fn resolve(path: &Path, revision: &str, token: &CancellationToken) -> Result<String, AppError> {
    if revision.is_empty() || revision.starts_with('-') || revision.contains('\0') {
        return Err(AppError::new(
            "invalidRevision",
            "Choose a valid ref or commit.",
            None,
        ));
    }
    let output = git(
        path,
        &["rev-parse", "--verify", &format!("{revision}^{{commit}}")],
        token,
    )?;
    let oid = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    validate_commit_oid(&oid)?;
    Ok(oid)
}

fn scope(path: &Path, value: &str, token: &CancellationToken) -> Result<Vec<String>, AppError> {
    let started = Instant::now();
    if value.is_empty() {
        let output = git(
            path,
            &["for-each-ref", "--format=%(refname) %(objectname)"],
            token,
        )?;
        let mut tips = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| {
                let (name, oid) = line.split_once(' ')?;
                (!name.starts_with("refs/git-khronos/recovery/")).then(|| oid.to_owned())
            })
            .collect::<Vec<_>>();
        if let Ok(head) = resolve(path, "HEAD", token) {
            tips.push(head);
        }
        if token.is_cancelled() {
            return Err(cancelled_history());
        }
        tips.sort();
        tips.dedup();
        if tips.len() > 4096 {
            return Err(AppError::new(
                "historyScopeLimit",
                "More than 4,096 refs exist. Choose a ref or range.",
                None,
            ));
        }
        // Peel annotated tags; non-commit refs cannot define commit history.
        let mut commits = Vec::new();
        for tip in tips {
            if started.elapsed() >= TIME_LIMIT {
                return Err(AppError::new(
                    "historyTimeout",
                    "Resolving refs exceeded 15 seconds. Choose a narrower scope.",
                    None,
                ));
            }
            match resolve(path, &tip, token) {
                Ok(commit) => commits.push(commit),
                Err(error) => {
                    // Tags pointing to blobs/trees have no commit history. Missing
                    // objects must fail visibly rather than masquerade as no matches.
                    let peeled = git(
                        path,
                        &["rev-parse", "--verify", &format!("{tip}^{{}}")],
                        token,
                    )?;
                    let peeled = String::from_utf8_lossy(&peeled.stdout);
                    let kind = git(path, &["cat-file", "-t", peeled.trim()], token)?;
                    if String::from_utf8_lossy(&kind.stdout).trim() == "commit" {
                        return Err(error);
                    }
                }
            }
            if token.is_cancelled() {
                return Err(cancelled_history());
            }
        }
        commits.sort();
        commits.dedup();
        return Ok(commits);
    }
    if value.contains("...") {
        return Err(AppError::new(
            "invalidRange",
            "Use a single ref or an A..B range (not A...B).",
            None,
        ));
    }
    if let Some((base, target)) = value.split_once("..") {
        return Ok(vec![
            resolve(path, target, token)?,
            format!("^{}", resolve(path, base, token)?),
        ]);
    }
    Ok(vec![resolve(path, value, token)?])
}

fn validate_date(value: &str) -> Result<(), AppError> {
    if value.is_empty() {
        return Ok(());
    }
    let bytes = value.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes
            .iter()
            .enumerate()
            .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
        || !(1..=12).contains(&value[5..7].parse::<u8>().unwrap_or(0))
        || !(1..=31).contains(&value[8..10].parse::<u8>().unwrap_or(0))
    {
        return Err(AppError::new(
            "invalidDate",
            "Use dates in YYYY-MM-DD format.",
            None,
        ));
    }
    let year = value[..4].parse::<u16>().unwrap_or(0);
    let month = value[5..7].parse::<usize>().unwrap_or(0);
    let day = value[8..10].parse::<u8>().unwrap_or(0);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if year == 0 || day > days[month - 1] {
        return Err(AppError::new(
            "invalidDate",
            "Choose an existing calendar date.",
            None,
        ));
    }
    Ok(())
}

pub fn search_history(
    path: &Path,
    query: HistoryQuery,
    cursor: Option<HistoryCursor>,
    token: &CancellationToken,
) -> Result<HistorySearchPage, AppError> {
    if [
        &query.message,
        &query.author,
        &query.oid,
        &query.since,
        &query.until,
        &query.path,
        &query.scope,
    ]
    .iter()
    .any(|value| value.len() > 4096 || value.contains('\0'))
    {
        return Err(AppError::new(
            "invalidHistoryQuery",
            "History filters must be at most 4,096 bytes and contain no NUL.",
            None,
        ));
    }
    validate_date(&query.since)?;
    validate_date(&query.until)?;
    if !query.since.is_empty() && !query.until.is_empty() && query.since > query.until {
        return Err(AppError::new(
            "invalidDate",
            "Start date must not follow end date.",
            None,
        ));
    }
    if !query.path.is_empty() {
        validate_relative_path(
            &query.path,
            "invalidPath",
            "Choose a repository-relative path.",
        )?;
    }
    if !query.oid.is_empty()
        && (query.oid.len() > 64 || !query.oid.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        return Err(AppError::new(
            "invalidOid",
            "Use a hexadecimal commit ID or prefix.",
            None,
        ));
    }
    let (revisions, offset) = match cursor {
        Some(cursor) if cursor.query == query => (cursor.revisions, cursor.offset),
        Some(_) => {
            return Err(AppError::new(
                "staleHistoryCursor",
                "Filters changed. Start a new search.",
                None,
            ));
        }
        None => (scope(path, &query.scope, token)?, 0),
    };
    if revisions.len() > 4096 {
        return Err(AppError::new(
            "historyScopeLimit",
            "Choose a narrower ref scope.",
            None,
        ));
    }
    for revision in &revisions {
        validate_commit_oid(revision.strip_prefix('^').unwrap_or(revision))?;
    }
    if revisions.is_empty() {
        return Ok(HistorySearchPage {
            entries: vec![],
            cursor: None,
            complete: true,
            scanned: 0,
        });
    }
    let mut args = vec![
        "--literal-pathspecs".into(),
        "log".into(),
        "--date-order".into(),
        "--no-show-signature".into(),
        "--no-color".into(),
        "--no-decorate".into(),
        "--no-patch".into(),
        "--format=%H%x00%an%x00%ae%x00%aI%x00%s%x00%B%x00".into(),
        "-z".into(),
        "--max-count=201".into(),
        format!("--skip={offset}"),
    ];
    args.extend(revisions.iter().cloned());
    args.push("--".into());
    if !query.path.is_empty() {
        args.push(query.path.clone());
    }
    let output = bounded_git(path, &args, token)?;
    let fields = output.stdout.split(|b| *b == 0).collect::<Vec<_>>();
    let mut entries = Vec::new();
    let (records, remainder) = fields.as_chunks::<7>();
    if remainder.iter().any(|field| !field.is_empty()) {
        return Err(AppError::new(
            "invalidHistoryOutput",
            "Commit metadata contains unsupported NUL fields.",
            None,
        ));
    }
    let scanned = records.len().min(200);
    for record in records.iter().take(scanned) {
        let strings = record
            .iter()
            .map(|s| String::from_utf8_lossy(s).into_owned())
            .collect::<Vec<_>>();
        validate_commit_oid(&strings[0]).map_err(|_| {
            AppError::new(
                "invalidHistoryOutput",
                "Git returned invalid commit metadata.",
                None,
            )
        })?;
        let date = strings[3].get(..10).unwrap_or("");
        if strings[0].starts_with(&query.oid.to_ascii_lowercase())
            && strings[5]
                .to_lowercase()
                .contains(&query.message.to_lowercase())
            && format!("{} {}", strings[1], strings[2])
                .to_lowercase()
                .contains(&query.author.to_lowercase())
            && (query.since.is_empty() || date >= query.since.as_str())
            && (query.until.is_empty() || date <= query.until.as_str())
        {
            entries.push(FileHistoryEntry {
                oid: strings[0].clone(),
                author_name: strings[1].clone(),
                author_email: strings[2].clone(),
                authored_at: strings[3].clone(),
                subject: strings[4].clone(),
            });
        }
    }
    let complete = records.len() <= 200;
    Ok(HistorySearchPage {
        entries,
        scanned,
        complete,
        cursor: (!complete).then_some(HistoryCursor {
            query,
            revisions,
            offset: offset + scanned,
        }),
    })
}

pub fn file_history_page(
    path: &Path,
    revision: &str,
    file: &str,
    cursor: Option<FileHistoryCursor>,
    token: &CancellationToken,
) -> Result<FileHistoryPage, AppError> {
    validate_relative_path(file, "invalidPath", "Choose a repository-relative file.")?;
    let mut cursor = match cursor {
        Some(cursor)
            if cursor.path == file
                && (cursor.revision == revision || cursor.requested_revision == revision) =>
        {
            cursor
        }
        Some(_) => {
            return Err(AppError::new(
                "staleHistoryCursor",
                "File or revision changed. Reopen history.",
                None,
            ));
        }
        None => FileHistoryCursor {
            revision: resolve(path, revision, token)?,
            requested_revision: revision.into(),
            path: file.into(),
            historical_path: file.into(),
            offset: 0,
        },
    };
    validate_commit_oid(&cursor.revision)?;
    validate_relative_path(
        &cursor.historical_path,
        "invalidPath",
        "Invalid historical path.",
    )?;
    let args = vec![
        "--literal-pathspecs".into(),
        "log".into(),
        "--follow".into(),
        "--no-show-signature".into(),
        "--no-color".into(),
        "--no-decorate".into(),
        "--find-renames".into(),
        "--no-ext-diff".into(),
        "--no-textconv".into(),
        "--format=%x00GC_HISTORY%x00%H%x00%an%x00%ae%x00%aI%x00%s%x00".into(),
        "--name-status".into(),
        "-z".into(),
        format!("--max-count={}", cursor.offset.saturating_add(101)),
        cursor.revision.clone(),
        "--".into(),
        file.into(),
    ];
    let output = bounded_git(path, &args, token)?;
    let text = String::from_utf8(output.stdout).map_err(|_| {
        AppError::new(
            "unsupportedPathEncoding",
            "History contains non-UTF-8 paths.",
            None,
        )
    })?;
    let records = text.split("\0GC_HISTORY\0").skip(1).collect::<Vec<_>>();
    let mut entries = Vec::new();
    // Git --follow must see rename records before a page boundary. --skip can
    // suppress that traversal, so replay the bounded prefix and retain this page.
    cursor.historical_path = file.to_owned();
    for (record_index, record) in records
        .iter()
        .take(cursor.offset.saturating_add(100))
        .enumerate()
    {
        let parts = record.split('\0').collect::<Vec<_>>();
        if parts.len() < 6 {
            return Err(AppError::new(
                "invalidHistoryOutput",
                "Git returned an incomplete history record.",
                None,
            ));
        }
        validate_commit_oid(parts[0]).map_err(|_| {
            AppError::new(
                "invalidHistoryOutput",
                "Git returned invalid file history metadata.",
                None,
            )
        })?;
        let mut previous_path = None;
        let mut index = 5;
        while index < parts.len() {
            let status = parts[index].trim_start_matches('\n');
            if status.starts_with('R') && index + 2 < parts.len() {
                if parts[index + 2] == cursor.historical_path {
                    previous_path = Some(parts[index + 1].to_owned());
                }
                index += 3;
            } else {
                index += 1;
            }
        }
        if record_index >= cursor.offset {
            entries.push(HistoricalFileEntry {
                commit: FileHistoryEntry {
                    oid: parts[0].into(),
                    author_name: parts[1].into(),
                    author_email: parts[2].into(),
                    authored_at: parts[3].into(),
                    subject: parts[4].into(),
                },
                path: cursor.historical_path.clone(),
                previous_path: previous_path.clone(),
            });
        }
        if let Some(previous) = previous_path {
            cursor.historical_path = previous;
        }
    }
    cursor.offset += entries.len();
    let complete = records.len() <= cursor.offset;
    Ok(FileHistoryPage {
        entries,
        complete,
        cursor: (!complete).then_some(cursor),
    })
}

pub fn comparison_base(
    path: &Path,
    base: &str,
    target: &str,
    mode: &str,
    token: &CancellationToken,
) -> Result<String, AppError> {
    let base = resolve(path, base, token)?;
    let target = resolve(path, target, token)?;
    match mode {
        "direct" => Ok(base),
        "mergeBase" => {
            let output = git(path, &["merge-base", "--all", &base, &target], token)?;
            let bases = String::from_utf8_lossy(&output.stdout);
            let bases = bases.lines().collect::<Vec<_>>();
            if bases.len() != 1 {
                return Err(AppError::new(
                    "ambiguousMergeBase",
                    "Comparison requires exactly one merge base. Choose direct tips instead.",
                    None,
                ));
            }
            Ok(bases[0].into())
        }

        _ => Err(AppError::new(
            "invalidComparisonMode",
            "Choose direct tips or merge base.",
            None,
        )),
    }
}

pub fn history_commit(
    path: &Path,
    oid: &str,
    token: &CancellationToken,
) -> Result<CommitSummary, AppError> {
    let oid = resolve(path, oid, token)?;
    let output = git(
        path,
        &[
            "show",
            "-s",
            "--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%B",
            &oid,
        ],
        token,
    )?;
    let fields = output
        .stdout
        .split(|b| *b == 0)
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .collect::<Vec<_>>();
    if fields.len() != 7 {
        return Err(AppError::new(
            "invalidHistoryOutput",
            "Git returned invalid commit metadata.",
            None,
        ));
    }
    Ok(CommitSummary {
        oid,
        parents: fields[1].split_whitespace().map(str::to_owned).collect(),
        author_name: fields[2].clone(),
        author_email: fields[3].clone(),
        authored_at: fields[4].clone(),
        subject: fields[5].clone(),
        description: fields[6].clone(),
        decorations: vec![],
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameNavigation {
    pub oid: String,
    pub path: String,
    pub parents: Vec<String>,
    pub parent_path: Option<String>,
}

pub fn blame_navigation(
    path: &Path,
    oid: &str,
    file: &str,
    token: &CancellationToken,
) -> Result<BlameNavigation, AppError> {
    validate_relative_path(file, "invalidPath", "Choose a repository-relative file.")?;
    let oid = resolve(path, oid, token)?;
    let output = git(path, &["rev-list", "--parents", "-n", "1", &oid], token)?;
    let parents = String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .skip(1)
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let mut parent_path = parents.first().map(|_| file.to_owned());
    if let Some(parent) = parents.first() {
        let output = git(
            path,
            &["diff-tree", "-r", "-M", "--name-status", "-z", parent, &oid],
            token,
        )?;
        let fields = output.stdout.split(|b| *b == 0).collect::<Vec<_>>();
        let mut index = 0;
        while index < fields.len() {
            if fields[index].starts_with(b"R") && index + 2 < fields.len() {
                if fields[index + 2] == file.as_bytes() {
                    parent_path = Some(String::from_utf8_lossy(fields[index + 1]).into_owned());
                }
                index += 3;
            } else {
                index += 2;
            }
        }
    }
    Ok(BlameNavigation {
        oid,
        path: file.into(),
        parents,
        parent_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!(
                ".history-search-test-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&path).unwrap();
            let fixture = Self(path);
            fixture.run(&["init", "-q", "-b", "main"]);
            fixture.run(&["config", "user.name", "History Investigator"]);
            fixture.run(&["config", "user.email", "history@example.test"]);
            fixture.run(&["config", "commit.gpgsign", "false"]);
            fixture
        }
        fn run(&self, args: &[&str]) -> String {
            let output = Command::new("git")
                .arg("-C")
                .arg(&self.0)
                .args(args)
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8_lossy(&output.stdout).trim().into()
        }
        fn commit(&self, file: &str, contents: &str, message: &str) -> String {
            fs::write(self.0.join(file), contents).unwrap();
            self.run(&["add", "--", file]);
            self.run(&["commit", "-qm", message]);
            self.run(&["rev-parse", "HEAD"])
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn paginates_whole_history_pins_refs_and_follows_old_renamed_paths() {
        let repo = Fixture::new();
        let oldest = repo.commit(
            "old name.txt",
            "initial\n",
            "needle older than loaded pages",
        );
        repo.run(&["branch", "hidden", &oldest]);
        repo.run(&["checkout", "-q", "hidden"]);
        let hidden = repo.commit("hidden.txt", "hidden\n", "hidden branch needle");
        repo.run(&["checkout", "-q", "main"]);
        let mut current = "old name.txt";
        let mut rename = String::new();
        for index in 1..225 {
            if index == 120 {
                repo.run(&["mv", "--", current, "new name.txt"]);
                repo.run(&["commit", "-qm", "rename history path"]);
                rename = repo.run(&["rev-parse", "HEAD"]);
                current = "new name.txt";
            }
            repo.commit(
                current,
                &format!("initial\n{index}\n"),
                &format!("change {index}"),
            );
        }
        let token = CancellationToken::default();
        let query = HistoryQuery {
            message: "needle".into(),
            ..Default::default()
        };
        let first = search_history(&repo.0, query.clone(), None, &token).unwrap();
        assert!(!first.complete);
        assert_eq!(first.scanned, 200);
        let mut matches = first.entries;
        let cursor = first.cursor.unwrap();
        repo.commit(
            current,
            "new external commit\n",
            "needle after pinned search",
        );
        let second = search_history(&repo.0, query, Some(cursor), &token).unwrap();
        assert!(second.complete);
        assert!(second.entries.iter().any(|entry| entry.oid == oldest));
        matches.extend(second.entries);
        assert_eq!(matches.len(), 2);
        assert!(matches.iter().any(|entry| entry.oid == hidden));

        let head = repo.run(&["rev-parse", "HEAD"]);
        let mut cursor = None;
        let mut entries = Vec::new();
        loop {
            let page = file_history_page(&repo.0, &head, current, cursor, &token).unwrap();
            entries.extend(page.entries);
            cursor = page.cursor;
            if page.complete {
                break;
            }
        }
        assert!(
            entries.len() > 200,
            "count={} last={:?}",
            entries.len(),
            entries.last()
        );
        let renamed = entries
            .iter()
            .find(|entry| entry.commit.oid == rename)
            .unwrap();
        assert_eq!(renamed.path, "new name.txt");
        assert_eq!(renamed.previous_path.as_deref(), Some("old name.txt"));
        let original = entries
            .iter()
            .find(|entry| entry.commit.oid == oldest)
            .unwrap();
        assert_eq!(original.path, "old name.txt");
        let diff = commit_file_diff(&repo.0, &oldest, &original.path, None).unwrap();
        assert!(diff.patch.contains("+initial"));
        let navigation = blame_navigation(&repo.0, &rename, "new name.txt", &token).unwrap();
        assert_eq!(navigation.parent_path.as_deref(), Some("old name.txt"));
        assert_eq!(navigation.parents.len(), 1);
        let summary = history_commit(&repo.0, &oldest, &token).unwrap();
        assert_eq!(summary.subject, "needle older than loaded pages");
        assert!(summary.parents.is_empty());
    }

    #[test]
    fn filters_range_author_oid_dates_message_body_and_literal_path() {
        let repo = Fixture::new();
        let first = repo.commit("literal[1].txt", "first\n", "first subject\n\nbody needle");
        let second = repo.commit("other.txt", "second\n", "second");
        let token = CancellationToken::default();
        let query = HistoryQuery {
            message: "BODY NEEDLE".into(),
            author: "HISTORY@".into(),
            oid: first[..8].into(),
            path: "literal[1].txt".into(),
            since: "2000-01-01".into(),
            until: "2099-12-31".into(),
            ..Default::default()
        };
        let page = search_history(&repo.0, query, None, &token).unwrap();
        assert!(page.complete);
        assert_eq!(page.entries.len(), 1);
        assert_eq!(page.entries[0].oid, first);
        let page = search_history(
            &repo.0,
            HistoryQuery {
                scope: format!("{first}..{second}"),
                ..Default::default()
            },
            None,
            &token,
        )
        .unwrap();
        assert_eq!(page.entries.len(), 1);
        assert_eq!(page.entries[0].oid, second);
        let page = search_history(
            &repo.0,
            HistoryQuery {
                message: "absent".into(),
                ..Default::default()
            },
            None,
            &token,
        )
        .unwrap();
        assert!(page.complete && page.entries.is_empty());
        assert_eq!(
            search_history(
                &repo.0,
                HistoryQuery {
                    scope: "--all".into(),
                    ..Default::default()
                },
                None,
                &token
            )
            .unwrap_err()
            .kind,
            "invalidRevision"
        );
        assert_eq!(
            search_history(
                &repo.0,
                HistoryQuery {
                    since: "2026-00-02".into(),
                    ..Default::default()
                },
                None,
                &token
            )
            .unwrap_err()
            .kind,
            "invalidDate"
        );
        assert_eq!(
            search_history(
                &repo.0,
                HistoryQuery {
                    since: "2026-02-30".into(),
                    ..Default::default()
                },
                None,
                &token
            )
            .unwrap_err()
            .kind,
            "invalidDate"
        );
        token.cancel();
        assert_eq!(
            search_history(&repo.0, HistoryQuery::default(), None, &token)
                .unwrap_err()
                .kind,
            "operationCancelled"
        );
    }

    #[test]
    fn comparison_modes_and_blame_paths_are_explicit() {
        let repo = Fixture::new();
        let root = repo.commit("before.txt", "common line\n", "root");
        repo.run(&["checkout", "-qb", "topic"]);
        repo.run(&["mv", "before.txt", "after.txt"]);
        repo.run(&["commit", "-qm", "rename"]);
        let topic = repo.run(&["rev-parse", "HEAD"]);
        repo.run(&["checkout", "-q", "main"]);
        let main = repo.commit("main.txt", "main\n", "main branch");
        let token = CancellationToken::default();
        assert_eq!(
            comparison_base(&repo.0, &main, &topic, "direct", &token).unwrap(),
            main
        );
        assert_eq!(
            comparison_base(&repo.0, &main, &topic, "mergeBase", &token).unwrap(),
            root
        );
        let blame = file_blame(&repo.0, &topic, "after.txt").unwrap();
        assert_eq!(blame[0].oid, root);
        assert_eq!(blame[0].path.as_deref(), Some("before.txt"));
        assert!(
            blame_navigation(&repo.0, &root, "before.txt", &token)
                .unwrap()
                .parents
                .is_empty()
        );
        assert_eq!(
            decode_git_path("\"a\\t\\303\\251.txt\"").unwrap(),
            "a\té.txt"
        );
    }

    #[test]
    fn cancellation_terminates_an_active_bounded_process() {
        let repo = Fixture::new();
        let token = CancellationToken::default();
        let cancel = token.clone();
        let worker = thread::spawn(move || {
            thread::sleep(Duration::from_millis(80));
            cancel.cancel();
        });
        // Git's documented shell alias is fixture-only, never built from user inputs.
        let started = Instant::now();
        let result = git(
            &repo.0,
            &["-c", "alias.historywait=!sleep 30", "historywait"],
            &token,
        );
        worker.join().unwrap();
        assert_eq!(result.unwrap_err().kind, "operationCancelled");
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn empty_repository_and_annotated_tags_have_truthful_results() {
        let repo = Fixture::new();
        let token = CancellationToken::default();
        let empty = search_history(&repo.0, HistoryQuery::default(), None, &token).unwrap();
        assert!(empty.complete && empty.entries.is_empty());
        let root = repo.commit("file", "root\n", "tagged");
        repo.run(&["tag", "-a", "annotated", "-m", "annotation", &root]);
        repo.run(&["tag", "lightweight", &root]);
        let page = search_history(&repo.0, HistoryQuery::default(), None, &token).unwrap();
        assert_eq!(page.entries.len(), 1);
        assert_eq!(page.entries[0].oid, root);
        let stale = HistoryCursor {
            query: HistoryQuery::default(),
            revisions: vec![root],
            offset: 200,
        };
        assert_eq!(
            search_history(
                &repo.0,
                HistoryQuery {
                    message: "different".into(),
                    ..Default::default()
                },
                Some(stale),
                &token
            )
            .unwrap_err()
            .kind,
            "staleHistoryCursor"
        );
    }

    #[test]
    fn default_scope_excludes_internal_recovery_snapshots_but_explicit_oids_remain_inspectable() {
        let repo = Fixture::new();
        let root = repo.commit("file.txt", "committed\n", "ordinary history");
        fs::write(repo.0.join("file.txt"), "staged\n").unwrap();
        repo.run(&["add", "--", "file.txt"]);
        fs::write(repo.0.join("file.txt"), "unstaged\n").unwrap();
        let snapshot = repo.run(&["stash", "create", "internal recovery snapshot"]);
        let index = repo.run(&["rev-parse", &format!("{snapshot}^2")]);
        repo.run(&[
            "update-ref",
            "refs/git-khronos/recovery/test/worktree",
            &snapshot,
        ]);
        repo.run(&["update-ref", "refs/git-khronos/recovery/test/index", &index]);
        let token = CancellationToken::default();

        let ordinary = search_history(&repo.0, HistoryQuery::default(), None, &token).unwrap();
        assert!(ordinary.complete);
        assert_eq!(ordinary.entries.len(), 1);
        assert_eq!(ordinary.entries[0].oid, root);

        let explicit = search_history(
            &repo.0,
            HistoryQuery {
                scope: format!("{root}..{snapshot}"),
                ..Default::default()
            },
            None,
            &token,
        )
        .unwrap();
        assert!(explicit.complete);
        assert_eq!(explicit.entries.len(), 2);
        assert!(explicit.entries.iter().any(|entry| entry.oid == snapshot));
        assert!(explicit.entries.iter().any(|entry| entry.oid == index));
        assert_eq!(
            history_commit(&repo.0, &snapshot, &token).unwrap().oid,
            snapshot
        );

        // Exclusion is by ref namespace, not by object identity: a user ref can
        // legitimately make the same commit part of ordinary history.
        repo.run(&["branch", "user-visible-snapshot", &snapshot]);
        let visible = search_history(&repo.0, HistoryQuery::default(), None, &token).unwrap();
        assert!(visible.entries.iter().any(|entry| entry.oid == snapshot));
        assert!(visible.entries.iter().any(|entry| entry.oid == index));
    }
}
