use super::*;
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, BufWriter};
use std::time::{Duration, Instant, SystemTime};

/// Objects written this recently are never offered, so an in-progress `git add`
/// whose pointer blob is not yet written cannot lose its content.
const RECENT_GRACE: Duration = Duration::from_secs(60 * 60);
const REVIEW_LIMIT: usize = 5000;
/// The Git LFS pointer specification limits pointer files to fewer than 1024 bytes.
const POINTER_LIMIT: u64 = 1023;
const SCAN_TIME_LIMIT: Duration = Duration::from_secs(120);
const METADATA_TIME_LIMIT: Duration = Duration::from_secs(15);
const METADATA_LIMIT: u64 = 256 * 1024;

#[cfg(unix)]
type ScanOutput = crate::process_pipe::InterruptiblePipe<std::process::ChildStdout>;
#[cfg(not(unix))]
type ScanOutput = std::process::ChildStdout;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LfsPruneObject {
    pub oid: String,
    pub size: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LfsPrunePreview {
    pub objects: Vec<LfsPruneObject>,
    pub total_size: u64,
    /// Unreferenced objects beyond this review batch; review again after removal.
    pub remaining: u64,
    /// Local objects kept because some Git object references them.
    pub referenced: u64,
    /// Unreferenced objects kept because they were written within the grace period.
    pub recent: u64,
}

struct Scan {
    candidates: BTreeMap<String, (u64, PathBuf)>,
    referenced: u64,
    recent: u64,
    storage: MediaDirectory,
}

struct MediaDirectory {
    path: PathBuf,
    #[cfg(unix)]
    common: std::os::fd::OwnedFd,
    #[cfg(unix)]
    relative: PathBuf,
}

impl MediaDirectory {
    fn remove(&self, file: &Path, size: u64) -> Result<(), AppError> {
        #[cfg(unix)]
        {
            use rustix::fs::{AtFlags, FileType, statat, unlinkat};
            let relative = file.strip_prefix(&self.path).map_err(prune_io)?;
            let parent = relative
                .parent()
                .ok_or_else(|| prune_io("Missing cache parent"))?;
            let name = relative
                .file_name()
                .ok_or_else(|| prune_io("Missing cache object name"))?;
            // Resolve each directory from the retained Git directory handle.
            // Never re-traverse an ambient path that may now contain a link.
            let directory = open_relative_directory(&self.common, &self.relative.join(parent))?;
            let metadata = statat(&directory, name, AtFlags::SYMLINK_NOFOLLOW).map_err(prune_io)?;
            if FileType::from_raw_mode(metadata.st_mode) != FileType::RegularFile
                || i128::from(metadata.st_size) != i128::from(size)
            {
                return Err(prune_io(
                    "The reviewed LFS cache object changed before removal.",
                ));
            }
            unlinkat(&directory, name, AtFlags::empty()).map_err(prune_io)
        }
        #[cfg(not(unix))]
        {
            let _ = size;
            fs::remove_file(file).map_err(prune_io)
        }
    }
}

#[cfg(unix)]
fn directory_flags() -> rustix::fs::OFlags {
    use rustix::fs::OFlags;
    #[cfg(any(target_os = "linux", target_os = "android"))]
    let access = OFlags::PATH;
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    let access = OFlags::RDONLY;
    access | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC
}

#[cfg(unix)]
fn open_relative_directory(
    root: &std::os::fd::OwnedFd,
    relative: &Path,
) -> Result<std::os::fd::OwnedFd, AppError> {
    use rustix::fs::{Mode, openat};
    let mut directory = root.try_clone().map_err(prune_io)?;
    for component in relative.components() {
        let std::path::Component::Normal(name) = component else {
            return Err(prune_io(
                "LFS cache traversal must stay relative to its Git directory.",
            ));
        };
        directory =
            openat(&directory, name, directory_flags(), Mode::empty()).map_err(|error| {
                prune_io(format!(
                    "LFS cache directory changed or is not ordinary: {error}"
                ))
            })?;
    }
    Ok(directory)
}

#[cfg(unix)]
fn open_absolute_directory(path: &Path) -> Result<std::os::fd::OwnedFd, AppError> {
    use rustix::fs::{Mode, open};
    let relative = path.strip_prefix(Path::new("/")).map_err(prune_io)?;
    let root = open(Path::new("/"), directory_flags(), Mode::empty()).map_err(prune_io)?;
    open_relative_directory(&root, relative)
}

pub fn preview_lfs_prune(
    path: &Path,
    cancellation: &CancellationToken,
) -> Result<LfsPrunePreview, AppError> {
    let scan = scan(path, cancellation)?;
    let total = scan.candidates.len();
    let objects: Vec<LfsPruneObject> = scan
        .candidates
        .into_iter()
        .take(REVIEW_LIMIT)
        .map(|(oid, (size, _))| LfsPruneObject { oid, size })
        .collect();
    Ok(LfsPrunePreview {
        total_size: objects.iter().map(|object| object.size).sum(),
        remaining: (total - objects.len()) as u64,
        objects,
        referenced: scan.referenced,
        recent: scan.recent,
    })
}

pub fn prune_lfs_objects(
    path: &Path,
    preview: &LfsPrunePreview,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    if preview.objects.is_empty() || preview.objects.len() > REVIEW_LIMIT {
        return Err(unsafe_prune(
            "Review unreferenced LFS objects before removing them.",
        ));
    }
    let scan = scan(path, cancellation)?;
    let mut targets = Vec::with_capacity(preview.objects.len());
    for object in &preview.objects {
        match scan.candidates.get(&object.oid) {
            Some((size, file)) if *size == object.size => targets.push(file.clone()),
            _ => {
                return Err(AppError::new(
                    "staleLfsPrune",
                    "LFS storage or references changed after review.",
                    Some("Review unreferenced LFS objects again. Nothing was removed."),
                ));
            }
        }
    }
    for (removed, file) in targets.iter().enumerate() {
        if cancellation.is_cancelled() {
            return Err(AppError::new(
                "operationCancelled",
                "LFS cleanup was cancelled.",
                Some(&format!(
                    "{removed} of {} reviewed unreferenced objects were removed before cancellation. Review again to continue.",
                    targets.len()
                )),
            ));
        }
        let size = preview.objects[removed].size;
        scan.storage.remove(file, size)?;
    }
    Ok(())
}

fn scan(path: &Path, cancellation: &CancellationToken) -> Result<Scan, AppError> {
    let (_, version) = metadata_git(path, &["lfs", "version"], cancellation)?;
    if !version.success() {
        return Err(AppError::new(
            "lfsUnavailable",
            "Git LFS is not available on PATH.",
            Some("Install Git LFS 3.0 or newer and reopen the repository."),
        ));
    }
    let shallow = checked_git(
        path,
        &["rev-parse", "--is-shallow-repository"],
        cancellation,
    )?;
    match shallow.trim() {
        "false" => {}
        "true" => {
            return Err(unsafe_prune(
                "Shallow history is incomplete, so unreferenced objects cannot be proven.",
            ));
        }
        _ => {
            return Err(unsafe_prune(
                "Git did not report a valid shallow-history state.",
            ));
        }
    }
    let (promisor, status) = metadata_git(
        path,
        &[
            "config",
            "--null",
            "--get-regexp",
            r"^(extensions\.partialclone|remote\..*\.promisor)$",
        ],
        cancellation,
    )?;
    let partial = match status.code() {
        Some(0) if !promisor.is_empty() => promisor_settings(&promisor)?,
        // Git config uses 1, not an arbitrary failure, for no matching keys.
        Some(1) if promisor.is_empty() => false,
        _ => {
            return Err(unsafe_prune(
                "Git could not verify partial-clone configuration.",
            ));
        }
    };
    if partial {
        return Err(unsafe_prune(
            "Partial clones omit Git objects, so unreferenced objects cannot be proven.",
        ));
    }
    let storage = media_directory(path, cancellation)?;
    let mut stored = Vec::new();
    if storage.path.exists() {
        collect_stored(&storage.path, &mut stored, cancellation)?;
    }
    let interest = stored.iter().map(|(oid, ..)| oid.clone()).collect();
    let referenced = if stored.is_empty() {
        HashSet::new()
    } else {
        referenced_oids(path, cancellation, interest)?
    };
    let now = SystemTime::now();
    let mut scan = Scan {
        candidates: BTreeMap::new(),
        referenced: 0,
        recent: 0,
        storage,
    };
    for (oid, size, modified, file) in stored {
        if referenced.contains(&oid) {
            scan.referenced += 1;
        } else if now.duration_since(modified).unwrap_or_default() < RECENT_GRACE {
            scan.recent += 1;
        } else {
            scan.candidates.insert(oid, (size, file));
        }
    }
    Ok(scan)
}

fn media_directory(
    path: &Path,
    cancellation: &CancellationToken,
) -> Result<MediaDirectory, AppError> {
    let environment = checked_git(path, &["lfs", "env"], cancellation)?;
    let locations: Vec<&str> = environment
        .lines()
        .filter_map(|line| line.strip_prefix("LocalMediaDir="))
        .collect();
    if locations.len() != 1 || !Path::new(locations[0]).is_absolute() {
        return Err(unsafe_prune(
            "Git LFS did not report one absolute local media directory.",
        ));
    }
    let common = checked_git(
        path,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        cancellation,
    )?;
    let common = common.strip_suffix('\n').unwrap_or(&common);
    #[cfg(windows)]
    let common = common.strip_suffix('\r').unwrap_or(common);
    let common = fs::canonicalize(common).map_err(prune_io)?;
    let media = Path::new(locations[0]);
    // Resolve the deepest existing ancestor so a not-yet-created store is still checked.
    let mut existing = media;
    while !existing.exists() {
        existing = existing.parent().unwrap_or(Path::new("/"));
    }
    let resolved = fs::canonicalize(existing).map_err(prune_io)?;
    let canonical_media = resolved.join(media.strip_prefix(existing).unwrap_or(Path::new("")));
    if !canonical_media.starts_with(&common) {
        return Err(unsafe_prune(
            "LFS storage outside this repository's Git directory may be shared with other repositories.",
        ));
    }
    Ok(MediaDirectory {
        path: media.to_path_buf(),
        #[cfg(unix)]
        common: open_absolute_directory(&common)?,
        #[cfg(unix)]
        relative: canonical_media
            .strip_prefix(&common)
            .map_err(prune_io)?
            .to_path_buf(),
    })
}

fn is_hex(text: &str, length: usize) -> bool {
    text.len() == length
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn collect_stored(
    storage: &Path,
    stored: &mut Vec<(String, u64, SystemTime, PathBuf)>,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    let directory = |path: &Path| {
        fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_dir())
    };
    if !directory(storage) {
        return Err(unsafe_prune("LFS storage is not an ordinary directory."));
    }
    for first in fs::read_dir(storage).map_err(prune_io)? {
        let first = first.map_err(prune_io)?;
        let first_name = first.file_name().to_string_lossy().into_owned();
        if !is_hex(&first_name, 2) || !directory(&first.path()) {
            continue;
        }
        for second in fs::read_dir(first.path()).map_err(prune_io)? {
            let second = second.map_err(prune_io)?;
            let second_name = second.file_name().to_string_lossy().into_owned();
            if !is_hex(&second_name, 2) || !directory(&second.path()) {
                continue;
            }
            for object in fs::read_dir(second.path()).map_err(prune_io)? {
                if cancellation.is_cancelled() {
                    return Err(operation_cancelled());
                }
                let object = object.map_err(prune_io)?;
                let oid = object.file_name().to_string_lossy().into_owned();
                let metadata = fs::symlink_metadata(object.path()).map_err(prune_io)?;
                // Symlinks and unexpected names are never removal candidates.
                if is_hex(&oid, 64)
                    && oid[..2] == first_name
                    && oid[2..4] == second_name
                    && metadata.file_type().is_file()
                {
                    stored.push((
                        oid,
                        metadata.len(),
                        metadata.modified().map_err(prune_io)?,
                        object.path(),
                    ));
                }
            }
        }
    }
    Ok(())
}

/// Every SHA-256 pointer named by any Git object in the object database, including
/// unreachable objects and alternates, so reflogs, stashes and every worktree index
/// are covered without trusting retention policy.
fn referenced_oids(
    path: &Path,
    cancellation: &CancellationToken,
    interest: HashSet<String>,
) -> Result<HashSet<String>, AppError> {
    // A repository may contain millions of small blobs. Spool requests rather
    // than retaining every Git object ID in memory or starting Git per object.
    let spool = PointerRequests::new()?;
    let output = spool.create()?;
    let mut command = git_in(path);
    command
        .args([
            "--no-replace-objects",
            "cat-file",
            "--batch-all-objects",
            "--unordered",
            "--batch-check=%(objectname) %(objecttype) %(objectsize)",
        ])
        .env("LC_ALL", "C")
        .stdin(Stdio::null());
    let count = scan_process(command, cancellation, SCAN_TIME_LIMIT, move |reader| {
        spool_requests(reader, BufWriter::new(output))
    })?;
    if count == 0 {
        return Ok(HashSet::new());
    }
    // Independent opens are intentional: cloned files share their seek offset.
    let input = fs::File::open(spool.file()).map_err(prune_io)?;
    let expected = fs::File::open(spool.file()).map_err(prune_io)?;
    let mut command = git_in(path);
    command
        // Read actual stored blobs, not their replace-ref presentation. The
        // original pointer must remain protected if a replacement is removed.
        .args(["--no-replace-objects", "cat-file", "--batch"])
        .env("LC_ALL", "C")
        .stdin(Stdio::from(input));
    scan_process(command, cancellation, SCAN_TIME_LIMIT, move |reader| {
        read_pointer_responses(reader, BufReader::new(expected), &interest)
    })
}

/// Own only the random directory we created; never clean an existing temp path.
struct PointerRequests(PathBuf);

impl PointerRequests {
    fn new() -> Result<Self, AppError> {
        let mut nonce = [0u8; 16];
        getrandom::fill(&mut nonce).map_err(prune_io)?;
        let name: String = nonce.iter().map(|byte| format!("{byte:02x}")).collect();
        let path = std::env::temp_dir().join(format!("git-khronos-lfs-scan-{name}"));
        let mut directory = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            directory.mode(0o700);
        }
        directory.create(&path).map_err(prune_io)?;
        Ok(Self(path))
    }

    fn file(&self) -> PathBuf {
        self.0.join("requests")
    }

    fn create(&self) -> Result<fs::File, AppError> {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(self.file()).map_err(prune_io)
    }
}

impl Drop for PointerRequests {
    fn drop(&mut self) {
        let _ = fs::remove_file(self.file());
        let _ = fs::remove_dir(&self.0);
    }
}

/// Keep cancellation/deadlines outside blocking reads. Even when Git exits,
/// descendants can keep stdout open; keep monitoring until the reader finishes.
fn scan_process<T: Send + 'static>(
    command: Command,
    cancellation: &CancellationToken,
    timeout: Duration,
    parse: impl FnOnce(BufReader<ScanOutput>) -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    let (value, status) = scan_process_status(command, cancellation, timeout, parse)?;
    if !status.success() {
        return Err(unsafe_prune("Git could not complete the reference scan."));
    }
    Ok(value)
}

fn scan_process_status<T: Send + 'static>(
    mut command: Command,
    cancellation: &CancellationToken,
    timeout: Duration,
    parse: impl FnOnce(BufReader<ScanOutput>) -> Result<T, AppError> + Send + 'static,
) -> Result<(T, std::process::ExitStatus), AppError> {
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    command.stdout(Stdio::piped()).stderr(Stdio::null());
    configure_process_tree(&mut command);
    let mut child = command.spawn().map_err(prune_io)?;
    let stdout = child.stdout.take().expect("piped stdout");
    let stop_reader = Arc::new(AtomicBool::new(false));
    #[cfg(unix)]
    let stdout = crate::process_pipe::InterruptiblePipe::new(stdout, stop_reader.clone()).map_err(
        |error| {
            terminate_process_tree(&mut child);
            let _ = child.wait();
            prune_io(error)
        },
    )?;
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    let reader = thread::Builder::new()
        .name("lfs-reference-reader".to_owned())
        .spawn(move || {
            let _ = send.send(parse(BufReader::new(stdout)));
        });
    let reader = match reader {
        Ok(reader) => reader,
        Err(error) => {
            terminate_process_tree(&mut child);
            let _ = child.wait();
            return Err(prune_io(error));
        }
    };
    let started = Instant::now();
    let mut parsed = None;
    let mut exited = None;
    let outcome = loop {
        let failure = if cancellation.is_cancelled() {
            Some(operation_cancelled())
        } else if started.elapsed() >= timeout {
            Some(AppError::new(
                "lfsPruneTimeout",
                "Git exceeded the LFS reference scan deadline. Nothing was removed.",
                Some("Check repository health and retry the review."),
            ))
        } else {
            None
        };
        if let Some(failure) = failure {
            break Err(failure);
        }
        if parsed.is_none() {
            match receive.try_recv() {
                Ok(Ok(value)) => parsed = Some(value),
                Ok(Err(error)) => break Err(error),
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    break Err(prune_io("Git reference reader stopped unexpectedly"));
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => {}
            }
        }
        if exited.is_none() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if !status.success() {
                        // A failed Git parent must not leave the reader waiting
                        // on inherited stdout. Drain buffered bytes after closing
                        // its owned process tree, preserving the exact status
                        // (notably config's exit 1 for no matching settings).
                        terminate_process_tree(&mut child);
                    }
                    exited = Some(status);
                }
                Ok(None) => {}
                Err(error) => break Err(prune_io(error)),
            }
        }
        if parsed.is_some()
            && let Some(status) = exited.take()
        {
            break Ok(status);
        }
        thread::sleep(Duration::from_millis(10));
    };
    if outcome.is_err() {
        // A failed/cancelled scan never authorizes deletion from partial data.
        // Interrupt our read even if a detached helper kept the pipe open.
        stop_reader.store(true, Ordering::Release);
        terminate_process_tree(&mut child);
    }
    // Join and reap on every path, including parser errors and cancellation.
    let waited = child.wait();
    let joined = reader.join();
    let status = outcome?;
    waited.map_err(prune_io)?;
    joined.map_err(|_| prune_io("Git reference reader failed"))?;
    parsed
        .map(|value| (value, status))
        .ok_or_else(|| unsafe_prune("Git reference results are incomplete."))
}

/// Headers are bounded independently of object count. Do not accept partial
/// lines, extra fields, missing objects, or silently skip malformed inventory.
fn scan_header(reader: &mut impl BufRead) -> Result<Option<String>, AppError> {
    let mut bytes = Vec::new();
    reader
        .take(128)
        .read_until(b'\n', &mut bytes)
        .map_err(prune_io)?;
    if bytes.is_empty() {
        return Ok(None);
    }
    if bytes.pop() != Some(b'\n') || bytes.len() >= 127 {
        return Err(unsafe_prune(
            "Git returned an incomplete or oversized object header.",
        ));
    }
    String::from_utf8(bytes).map(Some).map_err(prune_io)
}

fn object_header(header: &str) -> Result<(&str, &str, u64), AppError> {
    let mut fields = header.split(' ');
    if let (Some(oid), Some(kind), Some(size), None) =
        (fields.next(), fields.next(), fields.next(), fields.next())
        && (is_hex(oid, 40) || is_hex(oid, 64))
        && matches!(kind, "blob" | "tree" | "commit" | "tag")
        && !size.is_empty()
        && size.bytes().all(|byte| byte.is_ascii_digit())
        && let Ok(size) = size.parse()
    {
        return Ok((oid, kind, size));
    }
    Err(unsafe_prune("Git returned invalid object metadata."))
}

fn spool_requests(mut reader: impl BufRead, mut output: impl Write) -> Result<u64, AppError> {
    let mut count = 0;
    while let Some(header) = scan_header(&mut reader)? {
        let (oid, kind, size) = object_header(&header)?;
        if kind == "blob" && size <= POINTER_LIMIT {
            writeln!(output, "{oid}").map_err(prune_io)?;
            count += 1;
        }
    }
    output.flush().map_err(prune_io)?;
    Ok(count)
}

fn read_pointer_responses(
    mut reader: impl BufRead,
    mut expected: impl BufRead,
    interest: &HashSet<String>,
) -> Result<HashSet<String>, AppError> {
    let mut referenced = HashSet::new();
    while let Some(oid) = scan_header(&mut expected)? {
        let header = scan_header(&mut reader)?
            .ok_or_else(|| unsafe_prune("Git omitted a requested pointer object."))?;
        let (actual, kind, size) = object_header(&header)?;
        if actual != oid || kind != "blob" || size > POINTER_LIMIT {
            return Err(unsafe_prune("Git returned unexpected pointer object data."));
        }
        let mut contents = vec![0; size as usize];
        reader.read_exact(&mut contents).map_err(prune_io)?;
        let mut delimiter = [0];
        reader.read_exact(&mut delimiter).map_err(prune_io)?;
        if delimiter != *b"\n" {
            return Err(unsafe_prune("Git returned invalid pointer object framing."));
        }
        for line in contents.split(|byte| *byte == b'\n') {
            if let Some(oid) = referenced_pointer_oid(line)
                && interest.contains(oid)
            {
                referenced.insert(oid.to_owned());
            }
        }
    }
    if !reader.fill_buf().map_err(prune_io)?.is_empty() {
        return Err(unsafe_prune("Git returned unrequested pointer objects."));
    }
    Ok(referenced)
}

fn referenced_pointer_oid(line: &[u8]) -> Option<&str> {
    // Git LFS accepts CRLF pointers; their objects must be protected just like LF pointers.
    let line = line.strip_suffix(b"\r").unwrap_or(line);
    let oid = std::str::from_utf8(line.strip_prefix(b"oid sha256:")?).ok()?;
    is_hex(oid, 64).then_some(oid)
}

fn metadata_git(
    path: &Path,
    args: &[&str],
    cancellation: &CancellationToken,
) -> Result<(Vec<u8>, std::process::ExitStatus), AppError> {
    let mut command = git_in(path);
    command
        .args(args)
        .env("LC_ALL", "C")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null());
    scan_process_status(command, cancellation, METADATA_TIME_LIMIT, read_metadata)
}

fn read_metadata(reader: impl Read) -> Result<Vec<u8>, AppError> {
    let mut bytes = Vec::new();
    reader
        .take(METADATA_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(prune_io)?;
    if bytes.len() as u64 > METADATA_LIMIT {
        return Err(unsafe_prune("Git output exceeds the safe review limit."));
    }
    Ok(bytes)
}

fn checked_git(
    path: &Path,
    args: &[&str],
    cancellation: &CancellationToken,
) -> Result<String, AppError> {
    let (bytes, status) = metadata_git(path, args, cancellation)?;
    if !status.success() {
        return Err(unsafe_prune(
            "Git could not complete the LFS metadata review.",
        ));
    }
    String::from_utf8(bytes)
        .map_err(|_| unsafe_prune("Git returned unsupported LFS metadata text."))
}

fn promisor_settings(bytes: &[u8]) -> Result<bool, AppError> {
    let records = bytes
        .strip_suffix(b"\0")
        .ok_or_else(|| unsafe_prune("Git returned incomplete partial-clone settings."))?;
    let mut partial = false;
    for record in records.split(|byte| *byte == 0) {
        let split = record
            .iter()
            .position(|byte| *byte == b'\n')
            .ok_or_else(|| unsafe_prune("Git returned invalid partial-clone settings."))?;
        let (key, value) = (&record[..split], &record[split + 1..]);
        if key == b"extensions.partialclone" {
            // The extension value is a remote name, not a boolean. Even a
            // remote named "false" still denotes incomplete object storage.
            partial = true;
        } else if key.starts_with(b"remote.") && key.ends_with(b".promisor") {
            partial |= ![b"false".as_slice(), b"no", b"off", b"0"]
                .iter()
                .any(|disabled| value.eq_ignore_ascii_case(disabled));
        } else {
            return Err(unsafe_prune(
                "Git returned unexpected partial-clone settings.",
            ));
        }
    }
    Ok(partial)
}

fn unsafe_prune(message: &str) -> AppError {
    AppError::new(
        "unsafeLfsPrune",
        message,
        Some(
            "Nothing was removed. Only objects that no Git object references are offered for removal.",
        ),
    )
}

fn prune_io(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "lfsPruneFailed",
        format!("LFS storage could not be reviewed or cleaned: {error}"),
        Some(
            "Review unreferenced LFS objects again. Objects already removed have no offline undo.",
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    struct CacheFixture(PointerRequests);

    #[cfg(unix)]
    impl CacheFixture {
        fn new() -> Self {
            Self(PointerRequests::new().unwrap())
        }

        fn root(&self) -> &Path {
            &self.0.0
        }

        fn common(&self) -> PathBuf {
            self.root().join("git")
        }

        fn object(&self) -> PathBuf {
            self.common()
                .join("lfs/objects/aa/bb")
                .join(format!("aabb{}", "a".repeat(60)))
        }

        fn prepare(&self) {
            fs::create_dir_all(self.object().parent().unwrap()).unwrap();
            fs::write(self.object(), b"cached").unwrap();
        }

        fn storage(&self) -> Result<MediaDirectory, AppError> {
            let common = fs::canonicalize(self.common()).unwrap();
            let path = self.common().join("lfs/objects");
            let resolved = fs::canonicalize(&path).unwrap();
            Ok(MediaDirectory {
                path,
                common: open_absolute_directory(&common)?,
                relative: resolved.strip_prefix(common).unwrap().to_path_buf(),
            })
        }
    }

    #[cfg(unix)]
    impl Drop for CacheFixture {
        fn drop(&mut self) {
            // This exclusive private directory and every fixture below it were
            // created by this test. No personal repositories are reused.
            let _ = fs::remove_dir_all(self.root());
        }
    }

    #[test]
    #[cfg(unix)]
    fn cache_removal_never_follows_a_swapped_directory_at_any_storage_level() {
        use std::os::unix::fs::symlink;
        for level in ["lfs", "lfs/objects", "lfs/objects/aa", "lfs/objects/aa/bb"] {
            let fixture = CacheFixture::new();
            fixture.prepare();
            let storage = fixture.storage().unwrap();
            let directory = fixture.common().join(level);
            let object = fixture.object();
            let remainder = object.strip_prefix(&directory).unwrap();
            let outside = fixture.root().join("outside");
            let external = outside.join(remainder);
            fs::create_dir_all(external.parent().unwrap()).unwrap();
            fs::write(&external, b"extern").unwrap();
            let parked = fixture.root().join("parked");
            fs::rename(&directory, &parked).unwrap();
            symlink(&outside, &directory).unwrap();
            assert!(storage.remove(&object, 6).is_err(), "{level}");
            assert_eq!(fs::read(&external).unwrap(), b"extern", "{level}");
            assert_eq!(
                fs::read(parked.join(remainder)).unwrap(),
                b"cached",
                "{level}"
            );
        }
    }

    #[test]
    #[cfg(unix)]
    fn cache_removal_is_anchored_even_if_the_common_directory_is_replaced() {
        use std::os::unix::fs::symlink;
        let fixture = CacheFixture::new();
        fixture.prepare();
        let storage = fixture.storage().unwrap();
        let outside = fixture.root().join("outside");
        let external = outside
            .join("lfs/objects/aa/bb")
            .join(format!("aabb{}", "a".repeat(60)));
        fs::create_dir_all(external.parent().unwrap()).unwrap();
        fs::write(&external, b"extern").unwrap();
        let parked = fixture.root().join("parked");
        fs::rename(fixture.common(), &parked).unwrap();
        symlink(outside, fixture.common()).unwrap();
        storage.remove(&fixture.object(), 6).unwrap();
        assert_eq!(fs::read(external).unwrap(), b"extern");
        assert!(
            !parked
                .join("lfs/objects/aa/bb")
                .join(format!("aabb{}", "a".repeat(60)))
                .exists()
        );
    }

    #[test]
    #[cfg(unix)]
    fn cache_removal_refuses_replaced_leaf_links_and_changed_sizes() {
        use std::os::unix::fs::symlink;
        let fixture = CacheFixture::new();
        fixture.prepare();
        let storage = fixture.storage().unwrap();
        assert!(storage.remove(&fixture.object(), 7).is_err());
        assert_eq!(fs::read(fixture.object()).unwrap(), b"cached");
        let external = fixture.root().join("external");
        fs::write(&external, b"cached").unwrap();
        fs::remove_file(fixture.object()).unwrap();
        symlink(&external, fixture.object()).unwrap();
        assert!(storage.remove(&fixture.object(), 6).is_err());
        assert!(fixture.object().is_symlink());
        assert_eq!(fs::read(external).unwrap(), b"cached");
    }

    #[test]
    #[cfg(unix)]
    fn directory_handles_reject_parent_escape_and_absolute_traversal() {
        let fixture = CacheFixture::new();
        fixture.prepare();
        let common = open_absolute_directory(&fixture.common()).unwrap();
        assert!(open_relative_directory(&common, Path::new("../outside")).is_err());
        assert!(open_relative_directory(&common, fixture.root()).is_err());
    }

    #[test]
    #[cfg(unix)]
    fn cache_removal_preserves_supported_internal_storage_ancestor_links() {
        use std::os::unix::fs::symlink;
        let fixture = CacheFixture::new();
        fixture.prepare();
        fs::rename(
            fixture.common().join("lfs"),
            fixture.common().join("actual-lfs"),
        )
        .unwrap();
        symlink("actual-lfs", fixture.common().join("lfs")).unwrap();
        fixture
            .storage()
            .unwrap()
            .remove(&fixture.object(), 6)
            .unwrap();
        assert!(fixture.common().join("lfs").is_symlink());
        assert!(!fixture.object().exists());
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn cache_removal_does_not_require_read_permission_on_ancestors_or_object_bytes() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = CacheFixture::new();
        fixture.prepare();
        fs::set_permissions(fixture.object(), fs::Permissions::from_mode(0o000)).unwrap();
        fs::set_permissions(fixture.common(), fs::Permissions::from_mode(0o111)).unwrap();
        let result = fixture
            .storage()
            .and_then(|storage| storage.remove(&fixture.object(), 6));
        fs::set_permissions(fixture.common(), fs::Permissions::from_mode(0o700)).unwrap();
        result.unwrap();
        assert!(!fixture.object().exists());
    }

    #[test]
    fn metadata_output_accepts_exact_limit_but_never_silently_truncates() {
        let exact = std::io::repeat(b'a').take(METADATA_LIMIT);
        assert_eq!(read_metadata(exact).unwrap().len() as u64, METADATA_LIMIT);
        let excess = std::io::repeat(b'a').take(METADATA_LIMIT + 1);
        assert_eq!(read_metadata(excess).unwrap_err().kind, "unsafeLfsPrune");
    }

    #[test]
    fn clone_settings_are_framed_and_extension_names_are_not_booleans() {
        assert!(promisor_settings(b"extensions.partialclone\nfalse\0").unwrap());
        for enabled in [
            b"true".as_slice(),
            b"YES",
            b"1",
            b"",
            b"false\nremote.other.promisor false",
        ] {
            let mut bytes = b"remote.origin.promisor\n".to_vec();
            bytes.extend_from_slice(enabled);
            bytes.push(0);
            assert!(promisor_settings(&bytes).unwrap());
        }
        assert!(!promisor_settings(b"remote.first.promisor\nfalse\0remote.second.promisor\nOFF\0remote.third.promisor\nNo\0remote.fourth.promisor\n0\0").unwrap());
        assert!(
            promisor_settings(b"remote.first.promisor\nfalse\0remote.second.promisor\ntrue\0")
                .unwrap()
        );
        for invalid in [
            b"".as_slice(),
            b"\0",
            b"remote.origin.promisor\nfalse",
            b"remote.origin.promisor false\0",
            b"unexpected.setting\nfalse\0",
            b"remote.origin.promisor\nfalse\0truncated",
        ] {
            assert!(promisor_settings(invalid).is_err(), "{invalid:?}");
        }
    }

    #[test]
    #[cfg(unix)]
    fn metadata_reader_preserves_nonzero_exit_status_for_explicit_validation() {
        let mut command = Command::new("sh");
        command.args(["-c", "exit 1"]);
        let (bytes, status) = scan_process_status(
            command,
            &CancellationToken::default(),
            Duration::from_secs(3),
            read_metadata,
        )
        .unwrap();
        assert!(bytes.is_empty());
        assert_eq!(status.code(), Some(1));
        let mut command = Command::new("sh");
        command.args(["-c", "exit 2"]);
        let error = scan_process(
            command,
            &CancellationToken::default(),
            Duration::from_secs(3),
            read_metadata,
        )
        .unwrap_err();
        assert_eq!(error.kind, "unsafeLfsPrune");
    }

    #[test]
    fn inventory_is_streamed_and_malformed_records_are_not_skipped() {
        let oid = "a".repeat(40);
        let inventory = format!("{oid} blob 1023\n{oid} blob 1024\n{oid} tree 0\n");
        let mut output = Vec::new();
        assert_eq!(
            spool_requests(inventory.as_bytes(), &mut output).unwrap(),
            1
        );
        assert_eq!(output, format!("{oid}\n").as_bytes());
        for invalid in [
            format!("{oid} blob 1"),
            format!("{oid} blob 1 extra\n"),
            format!("{oid} blob +1\n"),
            format!("{oid} blob 18446744073709551616\n"),
            format!("{oid} unknown 1\n"),
            "a blob 1\n".to_owned(),
            format!("{}\n", "a".repeat(200)),
        ] {
            assert!(
                spool_requests(invalid.as_bytes(), Vec::new()).is_err(),
                "{invalid:?}"
            );
        }
    }

    #[test]
    #[cfg(unix)]
    fn failed_metadata_exit_closes_inherited_stdout_without_losing_status_or_bytes() {
        for (code, contents) in [("1", ""), ("2", "owned metadata\n")] {
            let mut command = Command::new("sh");
            command.args([
                "-c",
                "sleep 30 & printf '%s' \"$1\"; exit \"$2\"",
                "owned-lfs-metadata",
                contents,
                code,
            ]);
            let started = Instant::now();
            let (bytes, status) = scan_process_status(
                command,
                &CancellationToken::default(),
                Duration::from_millis(400),
                read_metadata,
            )
            .expect("An exited failed command must not wait for a descendant's inherited stdout");
            assert_eq!(bytes, contents.as_bytes());
            assert_eq!(status.code(), code.parse().ok());
            assert!(started.elapsed() < Duration::from_secs(2));
        }
    }

    #[test]
    fn pointer_responses_require_every_requested_object_and_exact_framing() {
        let oid = "a".repeat(40);
        let pointer = "b".repeat(64);
        let contents = format!("oid sha256:{pointer}\r\n");
        let expected = format!("{oid}\n");
        let valid = format!("{oid} blob {}\n{contents}\n", contents.len());
        let interest = HashSet::from([pointer.clone()]);
        let parse = |bytes: &[u8]| read_pointer_responses(bytes, expected.as_bytes(), &interest);
        assert_eq!(parse(valid.as_bytes()).unwrap(), interest);
        assert!(
            read_pointer_responses(valid.as_bytes(), expected.as_bytes(), &HashSet::new())
                .unwrap()
                .is_empty()
        );
        for invalid in [
            String::new(),
            valid[..valid.len() - 1].to_owned(),
            format!("{}!", &valid[..valid.len() - 1]),
            format!("{valid}{valid}"),
            valid.replacen(&oid, &"c".repeat(40), 1),
            valid.replacen("blob", "tree", 1),
            format!("{oid} missing\n"),
            format!("{oid} blob 1024\n"),
        ] {
            assert!(parse(invalid.as_bytes()).is_err(), "{invalid:?}");
        }
        let two_requests = format!("{expected}{expected}");
        assert!(
            read_pointer_responses(valid.as_bytes(), two_requests.as_bytes(), &interest).is_err()
        );
    }

    #[test]
    fn request_spool_is_exclusive_and_removed_when_dropped() {
        let directory;
        {
            let spool = PointerRequests::new().unwrap();
            directory = spool.0.clone();
            let mut file = spool.create().unwrap();
            file.write_all(b"owned requests\n").unwrap();
            assert!(spool.create().is_err());
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                assert_eq!(
                    fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
                    0o700
                );
                assert_eq!(file.metadata().unwrap().permissions().mode() & 0o777, 0o600);
            }
        }
        assert!(!directory.exists());
    }

    #[test]
    #[cfg(unix)]
    fn blocked_pointer_scan_cancels_and_reaps_its_child() {
        let token = CancellationToken::default();
        let cancel = token.clone();
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        let canceller = thread::spawn(move || {
            let pid = receive.recv_timeout(Duration::from_secs(3)).unwrap();
            cancel.cancel();
            pid
        });
        let mut command = Command::new("sh");
        command.args(["-c", "printf '%s\\n' \"$$\"; exec sleep 30"]);
        let started = Instant::now();
        let result = scan_process(
            command,
            &token,
            Duration::from_secs(5),
            move |mut reader| {
                let pid = scan_header(&mut reader)?.unwrap();
                send.send(pid).unwrap();
                let mut bytes = Vec::new();
                reader.read_to_end(&mut bytes).map_err(prune_io)
            },
        );
        let pid = canceller.join().unwrap();
        assert_eq!(result.unwrap_err().kind, "operationCancelled");
        assert!(started.elapsed() < Duration::from_secs(3));
        #[cfg(target_os = "linux")]
        assert!(!Path::new(&format!("/proc/{pid}")).exists());
        #[cfg(not(target_os = "linux"))]
        let _ = pid;
    }

    #[test]
    #[cfg(unix)]
    fn pointer_scan_deadline_includes_pipes_inherited_after_git_exits() {
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 30 & exit 0"]);
        let started = Instant::now();
        let result = scan_process(
            command,
            &CancellationToken::default(),
            Duration::from_millis(100),
            |mut reader| {
                let mut bytes = Vec::new();
                reader.read_to_end(&mut bytes).map_err(prune_io)
            },
        );
        assert_eq!(result.unwrap_err().kind, "lfsPruneTimeout");
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn lfs_scan_cancel_interrupts_escaped_pipe_holders() {
        crate::transport_stderr_tests::check_escaped_pipe_holder(
            true,
            Some("operationCancelled"),
            |command, _, token| {
                scan_process(command, &token, Duration::from_secs(5), read_metadata).map(|_| ())
            },
        );
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn lfs_scan_timeout_interrupts_escaped_pipe_holders() {
        crate::transport_stderr_tests::check_escaped_pipe_holder(
            false,
            Some("lfsPruneTimeout"),
            |command, _, token| {
                scan_process(command, &token, Duration::from_millis(500), read_metadata).map(|_| ())
            },
        );
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn lfs_scan_parser_refusal_interrupts_escaped_pipe_holders() {
        crate::transport_stderr_tests::check_escaped_pipe_holder(
            false,
            Some("unsafeLfsPrune"),
            |command, _, token| {
                scan_process(command, &token, Duration::from_secs(5), |mut reader| {
                    assert_eq!(scan_header(&mut reader)?.as_deref(), Some("abcdef"));
                    Err::<(), _>(unsafe_prune("Owned parser-refusal fixture"))
                })
            },
        );
    }

    #[test]
    #[cfg(unix)]
    fn malformed_pointer_scan_terminates_before_child_exit() {
        let mut command = Command::new("sh");
        command.args(["-c", "printf 'invalid object metadata\\n'; exec sleep 30"]);
        let started = Instant::now();
        let result = scan_process(
            command,
            &CancellationToken::default(),
            Duration::from_secs(5),
            |reader| spool_requests(reader, Vec::new()),
        );
        assert_eq!(result.unwrap_err().kind, "unsafeLfsPrune");
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn pointer_references_preserve_lf_and_crlf_without_accepting_incomplete_ids() {
        let oid = "a".repeat(64);
        for ending in ["", "\r"] {
            assert_eq!(
                referenced_pointer_oid(format!("oid sha256:{oid}{ending}").as_bytes()),
                Some(oid.as_str())
            );
        }
        for invalid in [
            format!("oid sha256:{}", "a".repeat(63)).into_bytes(),
            format!("oid sha256:{oid}extra\r").into_bytes(),
            b"oid sha256:\xff\r".to_vec(),
        ] {
            assert_eq!(referenced_pointer_oid(&invalid), None);
        }
    }
}
