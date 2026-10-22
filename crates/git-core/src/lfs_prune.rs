use super::*;
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader};
use std::time::{Duration, SystemTime};

/// Objects written this recently are never offered, so an in-progress `git add`
/// whose pointer blob is not yet written cannot lose its content.
const RECENT_GRACE: Duration = Duration::from_secs(60 * 60);
const REVIEW_LIMIT: usize = 5000;
/// The Git LFS pointer specification limits pointer files to fewer than 1024 bytes.
const POINTER_LIMIT: u64 = 1023;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LfsPruneObject {
    pub oid: String,
    pub size: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
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
        fs::remove_file(file).map_err(prune_io)?;
    }
    Ok(())
}

fn scan(path: &Path, cancellation: &CancellationToken) -> Result<Scan, AppError> {
    ensure_lfs_available(path)?;
    let shallow = checked_git(path, &["rev-parse", "--is-shallow-repository"])?;
    if shallow.trim() == "true" {
        return Err(unsafe_prune(
            "Shallow history is incomplete, so unreferenced objects cannot be proven.",
        ));
    }
    let promisor = run_git(
        path,
        &[
            "config",
            "--get-regexp",
            r"^(extensions\.partialclone|remote\..*\.promisor)$",
        ],
    )?;
    if promisor.status.success()
        && String::from_utf8_lossy(&promisor.stdout)
            .lines()
            .any(|line| !line.ends_with(" false"))
    {
        return Err(unsafe_prune(
            "Partial clones omit Git objects, so unreferenced objects cannot be proven.",
        ));
    }
    let storage = media_directory(path)?;
    let mut stored = Vec::new();
    if storage.exists() {
        collect_stored(&storage, &mut stored, cancellation)?;
    }
    let referenced = referenced_oids(path, cancellation)?;
    let now = SystemTime::now();
    let mut scan = Scan {
        candidates: BTreeMap::new(),
        referenced: 0,
        recent: 0,
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

fn media_directory(path: &Path) -> Result<PathBuf, AppError> {
    let environment = checked_git(path, &["lfs", "env"])?;
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
    )?;
    let common = fs::canonicalize(common.trim()).map_err(prune_io)?;
    let media = Path::new(locations[0]);
    // Resolve the deepest existing ancestor so a not-yet-created store is still checked.
    let mut existing = media;
    while !existing.exists() {
        existing = existing.parent().unwrap_or(Path::new("/"));
    }
    let resolved = fs::canonicalize(existing).map_err(prune_io)?;
    if !resolved
        .join(media.strip_prefix(existing).unwrap_or(Path::new("")))
        .starts_with(&common)
    {
        return Err(unsafe_prune(
            "LFS storage outside this repository's Git directory may be shared with other repositories.",
        ));
    }
    Ok(media.to_path_buf())
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
) -> Result<HashSet<String>, AppError> {
    let mut command = git_in(path);
    command
        .args([
            "cat-file",
            "--batch-all-objects",
            "--unordered",
            "--batch-check=%(objectname) %(objecttype) %(objectsize)",
        ])
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    configure_process_tree(&mut command);
    let mut child = command.spawn().map_err(prune_io)?;
    let mut small = Vec::new();
    let reader = BufReader::new(child.stdout.take().unwrap());
    for line in reader.lines() {
        if cancellation.is_cancelled() {
            terminate_process_tree(&mut child);
            return Err(operation_cancelled());
        }
        let line = line.map_err(prune_io)?;
        let mut fields = line.split(' ');
        if let (Some(oid), Some("blob"), Some(size)) = (fields.next(), fields.next(), fields.next())
            && size.parse::<u64>().is_ok_and(|size| size <= POINTER_LIMIT)
        {
            small.push(oid.to_owned());
        }
    }
    if !child.wait().map_err(prune_io)?.success() {
        return Err(unsafe_prune("Git could not enumerate the object database."));
    }
    let mut referenced = HashSet::new();
    if small.is_empty() {
        return Ok(referenced);
    }
    let mut command = git_in(path);
    command
        .args(["cat-file", "--batch"])
        .env("LC_ALL", "C")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    configure_process_tree(&mut command);
    let mut child = command.spawn().map_err(prune_io)?;
    let mut input = child.stdin.take().unwrap();
    let writer = thread::spawn(move || {
        for oid in small {
            if writeln!(input, "{oid}").is_err() {
                break;
            }
        }
    });
    let mut reader = BufReader::new(child.stdout.take().unwrap());
    let mut header = String::new();
    let mut failure = None;
    loop {
        if cancellation.is_cancelled() {
            failure = Some(operation_cancelled());
            break;
        }
        header.clear();
        if reader.read_line(&mut header).map_err(prune_io)? == 0 {
            break;
        }
        let mut fields = header.split_whitespace();
        let (Some(_), Some("blob"), Some(size)) = (fields.next(), fields.next(), fields.next())
        else {
            failure = Some(unsafe_prune(
                "A Git object could not be read, so references cannot be proven.",
            ));
            break;
        };
        let size: u64 = size.parse().unwrap_or(u64::MAX);
        if size > POINTER_LIMIT {
            failure = Some(unsafe_prune("Git returned unexpected object data."));
            break;
        }
        let mut contents = vec![0; size as usize + 1];
        reader.read_exact(&mut contents).map_err(prune_io)?;
        for line in contents.split(|byte| *byte == b'\n') {
            if let Some(oid) = line.strip_prefix(b"oid sha256:")
                && let Ok(oid) = std::str::from_utf8(oid)
                && is_hex(oid, 64)
            {
                referenced.insert(oid.to_owned());
            }
        }
    }
    if failure.is_some() {
        terminate_process_tree(&mut child);
    }
    let _ = writer.join();
    let status = child.wait().map_err(prune_io)?;
    if let Some(failure) = failure {
        return Err(failure);
    }
    if !status.success() {
        return Err(unsafe_prune(
            "Git could not read candidate pointer objects.",
        ));
    }
    Ok(referenced)
}

fn checked_git(path: &Path, args: &[&str]) -> Result<String, AppError> {
    let (output, truncated) = run_git_with_stdout_limit(path, args, 256 * 1024)?;
    ensure_success("review unreferenced LFS objects", &output)?;
    if truncated {
        return Err(unsafe_prune("Git output exceeds the safe review limit."));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
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
