use super::*;
use std::fs::OpenOptions;
use std::io::{Seek, SeekFrom};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_RECOVERY_PATHS: usize = 50;
const MAX_RECOVERY_PATH_REPORT_BYTES: usize = 1024 * 1024;
const MAX_RECOVERY_PATCH_INSPECTION_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiscardPreview {
    pub paths: Vec<String>,
    pub skipped_paths: Vec<String>,
    pub untracked: usize,
}

pub struct DiscardPlan {
    pub preview: DiscardPreview,
    selected: Option<Vec<String>>,
    patch: Vec<u8>,
    mutation_patch: Vec<u8>,
    index: Vec<u8>,
    selection_preview: Option<(String, String)>,
}

#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiscardRecoveryInfo {
    pub id: String,
    pub restored: bool,
    pub state_warning: Option<String>,
    pub state_blocked: bool,
    pub paths: Vec<String>,
    pub paths_truncated: bool,
    pub paths_error: Option<String>,
    pub content_sha256: Option<String>,
}

pub fn discard_plan_fingerprint(plan: &DiscardPlan) -> Result<String, AppError> {
    let mut hasher = gix::hash::hasher(gix::hash::Kind::Sha256);
    hasher.update(&plan.mutation_patch);
    hasher
        .try_finalize()
        .map(|hash| hash.to_string())
        .map_err(|_| {
            AppError::new(
                "discardRecoveryUnavailable",
                "The recovery capture could not be fingerprinted.",
                Some("Preserve the capture and inspect the Git directory before retrying."),
            )
        })
}

fn pathspec(file: &str) -> String {
    format!(":(literal){file}")
}

pub(super) fn safe_file(path: &Path, file: &str) -> bool {
    let candidate = Path::new(file);
    if file.is_empty()
        || file.contains('\0')
        || !candidate
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
        || candidate
            .components()
            .any(|part| part.as_os_str() == ".git")
    {
        return false;
    }
    #[cfg(any(windows, target_os = "macos"))]
    if candidate.components().any(|part| {
        part.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(".git")
    }) {
        return false;
    }
    let mut ancestor = path.to_path_buf();
    let components = candidate.components().collect::<Vec<_>>();
    for component in &components[..components.len().saturating_sub(1)] {
        ancestor.push(component);
        let Ok(metadata) = fs::symlink_metadata(&ancestor) else {
            return false;
        };
        if !metadata.is_dir() || repository_files::is_link_or_reparse_point(&metadata) {
            return false;
        }
        match fs::symlink_metadata(ancestor.join(".git")) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            _ => return false,
        }
    }
    !fs::symlink_metadata(path.join(file)).is_ok_and(|metadata| metadata.is_dir())
}

pub fn prepare_discard(
    path: &Path,
    selected: Option<Vec<String>>,
) -> Result<DiscardPlan, AppError> {
    if selected.as_ref().is_some_and(Vec::is_empty) {
        return Err(AppError::new(
            "emptyDiscard",
            "Select files to discard.",
            None,
        ));
    }
    let status = read_status(path)?;
    let index_output = run_git(path, &["ls-files", "--stage", "-z"])?;
    ensure_success("inspect the index before discarding", &index_output)?;
    let gitlinks = index_output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|record| record.starts_with(b"160000 "))
        .filter_map(|record| record.splitn(2, |byte| *byte == b'\t').nth(1))
        .map(|file| String::from_utf8_lossy(file).into_owned())
        .collect::<HashSet<_>>();
    let mut paths = Vec::new();
    let mut skipped_paths = Vec::new();
    let mut patch = Vec::new();
    let mut untracked = 0;
    for entry in status.entries {
        if selected.as_ref().is_some_and(|selection| {
            !selection.iter().any(|file| {
                file == &entry.path || (file.ends_with('/') && entry.path.starts_with(file))
            })
        }) {
            continue;
        }
        if entry.index_status != "?"
            && matches!(entry.worktree_status.as_str(), " " | "!")
            && !entry.conflicted
        {
            continue;
        }
        if entry.conflicted || gitlinks.contains(&entry.path) || !safe_file(path, &entry.path) {
            skipped_paths.push(entry.path);
            continue;
        }
        let output = if entry.index_status == "?" {
            untracked += 1;
            run_git_allow_diff_exit(
                path,
                &[
                    "-c",
                    "diff.noprefix=false",
                    "-c",
                    "diff.mnemonicPrefix=false",
                    "diff",
                    "--no-index",
                    "--binary",
                    "--full-index",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--no-color",
                    "--src-prefix=a/",
                    "--dst-prefix=b/",
                    "--unified=3",
                    "--",
                    "/dev/null",
                    &entry.path,
                ],
            )?
        } else {
            let output = run_git(
                path,
                &[
                    "-c",
                    "diff.noprefix=false",
                    "-c",
                    "diff.mnemonicPrefix=false",
                    "diff",
                    "--binary",
                    "--full-index",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--no-color",
                    "--no-renames",
                    "--src-prefix=a/",
                    "--dst-prefix=b/",
                    "--unified=3",
                    "--",
                    &pathspec(&entry.path),
                ],
            )?;
            ensure_success("capture discarded changes", &output)?;
            output
        };
        if output.stdout.is_empty() {
            return Err(AppError::new(
                "missingRecoveryPatch",
                format!("Git could not capture changes in '{}'.", entry.path),
                Some("No files were discarded. Refresh and review the file."),
            ));
        }
        patch.extend(output.stdout);
        paths.push(entry.path);
    }
    if paths.is_empty() {
        return Err(AppError::new(
            "emptyDiscard",
            "There are no eligible unstaged files to discard.",
            Some("Conflicts, submodule working trees and nested repositories are not discarded."),
        ));
    }
    Ok(DiscardPlan {
        preview: DiscardPreview {
            paths,
            skipped_paths,
            untracked,
        },
        selected,
        mutation_patch: patch.clone(),
        patch,
        index: index_output.stdout,
        selection_preview: None,
    })
}

pub fn prepare_partial_discard(
    path: &Path,
    file: &str,
    hunk_index: usize,
    lines: Option<&[usize]>,
) -> Result<DiscardPlan, AppError> {
    prepare_partial_discard_with_preview(path, file, hunk_index, lines, None)
}

pub fn prepare_partial_discard_with_preview(
    path: &Path,
    file: &str,
    hunk_index: usize,
    lines: Option<&[usize]>,
    expected_patch: Option<&str>,
) -> Result<DiscardPlan, AppError> {
    let mut plan = prepare_discard(path, Some(vec![file.to_owned()]))?;
    if plan.preview.untracked > 0 {
        return Err(AppError::new(
            "untrackedPartialDiscardUnsupported",
            "Discard an untracked file as a whole, not as individual changes.",
            None,
        ));
    }
    // Select from the same canonical preview the user saw, not the binary
    // recovery patch or repository-specific diff presentation settings.
    let patch = read_selection_patch(path, file, false, "discard", expected_patch)?;
    plan.mutation_patch = if let Some(lines) = lines {
        if lines.is_empty() || lines.len() > 10_000 {
            return Err(AppError::new(
                "invalidLineSelection",
                "Select at least one changed line.",
                None,
            ));
        }
        select_patch_lines_with_context(&patch, hunk_index, lines, true)?.into_bytes()
    } else {
        select_patch_hunk(&patch, hunk_index)?.into_bytes()
    };
    plan.selection_preview = Some((file.to_owned(), patch));
    Ok(plan)
}

pub(super) fn recovery_directory(path: &Path) -> Result<PathBuf, AppError> {
    // Ask for the owning Git directory, not an absolute --git-path: Git
    // canonicalizes the latter and hides a symlink at the recovery entry.
    let output = run_git(path, &["rev-parse", "--absolute-git-dir"])?;
    ensure_success("locate discarded-change recovery", &output)?;
    let git_directory = String::from_utf8_lossy(&output.stdout);
    let directory = PathBuf::from(git_directory.strip_suffix('\n').unwrap_or(&git_directory))
        .join("git-khronos-recovery");
    validate_recovery_directory(&directory)?;
    Ok(directory)
}

fn validate_recovery_directory(directory: &Path) -> Result<(), AppError> {
    match fs::symlink_metadata(directory) {
        Ok(metadata) if metadata.is_dir() && !metadata.is_symlink() => Ok(()),
        Ok(_) => Err(AppError::new(
            "invalidRecoveryPath",
            "The recovery directory must be an ordinary directory, not a symbolic link.",
            Some("Preserve the recovery data and inspect the Git directory before retrying."),
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error(error)),
    }
}

fn recovery_file_exists(file: &Path) -> Result<bool, AppError> {
    match fs::symlink_metadata(file) {
        Ok(metadata) if metadata.is_file() && !metadata.is_symlink() => Ok(true),
        Ok(_) => Err(AppError::new(
            "invalidRecoveryPath",
            "Recovery patches and markers must be ordinary files, not symbolic links.",
            Some("Preserve the recovery data and inspect the Git directory before retrying."),
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(io_error(error)),
    }
}

fn require_recovery_file(file: &Path) -> Result<(), AppError> {
    if !recovery_file_exists(file)? {
        return Err(missing_recovery_file());
    }
    Ok(())
}

fn missing_recovery_file() -> AppError {
    AppError::new(
        "discardRecoveryMissing",
        "The recovery file is no longer available.",
        Some("Refresh discarded-change recovery and inspect the Git directory."),
    )
}

fn changed_recovery_capture() -> AppError {
    AppError::new(
        "discardRecoveryChanged",
        "The saved recovery capture changed after it was reviewed.",
        Some("Nothing was changed. Refresh discarded-change recovery and review it again."),
    )
}

fn changed_recovery_state() -> AppError {
    AppError::new(
        "discardRecoveryStateChanged",
        "The recovery state cannot be matched to this saved capture.",
        Some(
            "Preserve the recovery files and inspect the working tree and Git directory before continuing.",
        ),
    )
}

fn open_recovery_capture(capture: &Path) -> Result<fs::File, AppError> {
    require_recovery_file(capture)?;
    #[cfg(unix)]
    let file = {
        use rustix::fs::{Mode, OFlags, open};
        let descriptor = open(
            capture,
            OFlags::RDONLY | OFlags::NONBLOCK | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|error| {
            if error == rustix::io::Errno::NOENT {
                missing_recovery_file()
            } else if error == rustix::io::Errno::LOOP {
                changed_recovery_capture()
            } else {
                io_error(error.into())
            }
        })?;
        fs::File::from(descriptor)
    };
    #[cfg(windows)]
    let file = {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        OpenOptions::new()
            .read(true)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(capture)
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    missing_recovery_file()
                } else {
                    io_error(error)
                }
            })?
    };
    #[cfg(not(any(unix, windows)))]
    let file = fs::File::open(capture).map_err(io_error)?;
    let metadata = file.metadata().map_err(io_error)?;
    if !metadata.is_file() || repository_files::is_link_or_reparse_point(&metadata) {
        return Err(changed_recovery_capture());
    }
    Ok(file)
}

struct RecoverySnapshot {
    file: fs::File,
    content_sha256: String,
}

fn copy_recovery_content(
    source: &mut fs::File,
    destination: &mut impl Write,
    expected_size: u64,
    limit: Option<u64>,
) -> Result<String, AppError> {
    let mut hasher = gix::hash::hasher(gix::hash::Kind::Sha256);
    let mut size = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        if git_cancellation::current().is_some_and(|token| token.is_cancelled()) {
            return Err(operation_cancelled());
        }
        if git_cancellation::deadline()
            .is_some_and(|deadline| std::time::Instant::now() >= deadline)
        {
            return Err(AppError::new(
                "gitInspectionTimeout",
                "Git state inspection exceeded its time limit.",
                Some("Refresh discarded-change recovery before retrying."),
            ));
        }
        let count = source.read(&mut buffer).map_err(io_error)?;
        if count == 0 {
            break;
        }
        size = size
            .checked_add(count as u64)
            .ok_or_else(changed_recovery_capture)?;
        if size > expected_size || limit.is_some_and(|limit| size > limit) {
            return Err(changed_recovery_capture());
        }
        hasher.update(&buffer[..count]);
        destination.write_all(&buffer[..count]).map_err(io_error)?;
    }
    if size != expected_size {
        return Err(changed_recovery_capture());
    }
    hasher
        .try_finalize()
        .map(|hash| hash.to_string())
        .map_err(|_| {
            AppError::new(
                "discardRecoveryUnavailable",
                "The recovery capture could not be fingerprinted.",
                Some("Preserve the capture and inspect the Git directory before retrying."),
            )
        })
}

fn recovery_content_fingerprint(capture: &Path) -> Result<String, AppError> {
    let mut source = open_recovery_capture(capture)?;
    let size = source.metadata().map_err(io_error)?.len();
    copy_recovery_content(&mut source, &mut std::io::sink(), size, None)
}

fn private_recovery_snapshot_file(path: &Path) -> Result<fs::File, AppError> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_DELETE_ON_CLOSE: u32 = 0x0400_0000;
        options
            .share_mode(0)
            .custom_flags(FILE_FLAG_DELETE_ON_CLOSE);
    }
    let file = options.open(path).map_err(io_error)?;
    #[cfg(unix)]
    fs::remove_file(path).map_err(io_error)?;
    #[cfg(not(any(unix, windows)))]
    {
        drop(file);
        fs::remove_file(path).map_err(io_error)?;
        return Err(AppError::new(
            "discardRecoveryUnavailable",
            "Private temporary recovery storage is not supported on this platform.",
            None,
        ));
    }
    #[cfg(any(unix, windows))]
    Ok(file)
}

impl RecoverySnapshot {
    fn capture(capture: &Path, limit: Option<u64>) -> Result<Self, AppError> {
        let mut source = open_recovery_capture(capture)?;
        let expected_size = source.metadata().map_err(io_error)?.len();
        if limit.is_some_and(|limit| expected_size > limit) {
            return Err(AppError::new(
                "discardRecoveryPathsUnavailable",
                "This capture is too large to inspect its file list.",
                Some("Review the saved patch in the Git directory before recovering it."),
            ));
        }
        let mut random = [0; 16];
        getrandom::fill(&mut random).map_err(|_| {
            AppError::new(
                "discardRecoveryUnavailable",
                "Could not allocate private recovery inspection storage.",
                None,
            )
        })?;
        let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let temporary = std::env::temp_dir().join(format!("git-khronos-discard-{suffix}"));
        let mut snapshot = Self {
            file: private_recovery_snapshot_file(&temporary)?,
            content_sha256: String::new(),
        };
        snapshot.content_sha256 =
            copy_recovery_content(&mut source, &mut snapshot.file, expected_size, limit)?;
        Ok(snapshot)
    }

    fn run_git(
        &mut self,
        path: &Path,
        args: &[&str],
        stdout_limit: Option<usize>,
    ) -> Result<(Output, bool), AppError> {
        self.file.seek(SeekFrom::Start(0)).map_err(io_error)?;
        let input = self.file.try_clone().map_err(io_error)?;
        let mut command = git_in(path);
        command
            .args(args)
            .arg("-")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("LC_ALL", "C")
            .stdin(Stdio::from(input))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_process_tree(&mut command);
        run_cancellable_command_with_stdout_limit(
            command,
            &CancellationToken::default(),
            stdout_limit,
        )
    }
}

fn remove_recovery_file(file: &Path) -> Result<(), AppError> {
    fs::remove_file(file).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            missing_recovery_file()
        } else {
            io_error(error)
        }
    })
}

pub(super) fn io_error(error: std::io::Error) -> AppError {
    AppError::new(
        "discardRecoveryUnavailable",
        format!("Could not access recovery data: {error}"),
        Some(
            "Check available disk space and repository permissions. Recovery data is kept in the Git directory.",
        ),
    )
}

fn capture_publish_error(error: std::io::Error) -> AppError {
    AppError::new(
        "discardRecoveryUnavailable",
        format!("Could not safely publish the recovery capture: {error}"),
        Some(
            "This action did not change working files. Check permissions and filesystem support for no-replace renames or hard links.",
        ),
    )
}

fn require_capture_fingerprint(capture: &Path, expected: &str) -> Result<(), AppError> {
    if recovery_content_fingerprint(capture)? != expected {
        return Err(changed_recovery_capture());
    }
    Ok(())
}

fn sync_recovery_directory(directory: &Path) -> Result<(), AppError> {
    #[cfg(unix)]
    fs::File::open(directory)
        .and_then(|directory| directory.sync_all())
        .map_err(io_error)?;
    #[cfg(not(unix))]
    let _ = directory;
    Ok(())
}

fn publish_recovery_file(pending: &Path, destination: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "linux")]
    {
        use rustix::fs::{CWD, RenameFlags, renameat_with};
        renameat_with(CWD, pending, CWD, destination, RenameFlags::NOREPLACE).map_err(Into::into)
    }
    #[cfg(not(target_os = "linux"))]
    {
        fs::hard_link(pending, destination)?;
        fs::remove_file(pending)
    }
}

fn save_discard_capture(
    directory: &Path,
    id: &str,
    write_contents: impl FnOnce(&mut fs::File) -> Result<(), AppError>,
    before_publish: impl FnOnce(&Path),
) -> Result<PathBuf, AppError> {
    let pending = directory.join(format!("{id}.pending"));
    let capture = directory.join(format!("{id}.patch"));
    let marker = directory.join(format!("{id}.restored"));
    if recovery_file_exists(&marker)?
        || recovery_file_exists(&recovery_binding_file(&marker))?
        || recovery_file_exists(&marker.with_extension("restored.pending"))?
    {
        return Err(changed_recovery_capture());
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&pending).map_err(io_error)?;
    write_contents(&mut file)?;
    file.sync_all().map_err(io_error)?;
    drop(file);
    before_publish(&pending);
    publish_recovery_file(&pending, &capture).map_err(capture_publish_error)?;
    sync_recovery_directory(directory)?;
    Ok(capture)
}

fn next_discard_capture_id() -> Result<String, AppError> {
    Ok(format!(
        "{:020}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| AppError::new("invalidSystemClock", "The system clock is invalid.", None))?
            .as_nanos(),
        std::process::id()
    ))
}

fn save_snapshot_capture(
    directory: &Path,
    id: &str,
    snapshot: &mut RecoverySnapshot,
) -> Result<PathBuf, AppError> {
    snapshot.file.seek(SeekFrom::Start(0)).map_err(io_error)?;
    let size = snapshot.file.metadata().map_err(io_error)?.len();
    let fingerprint = snapshot.content_sha256.clone();
    save_discard_capture(
        directory,
        id,
        |file| {
            if copy_recovery_content(&mut snapshot.file, file, size, None)? != fingerprint {
                return Err(changed_recovery_capture());
            }
            Ok(())
        },
        |_| {},
    )
}

fn apply_discard_capture(path: &Path, snapshot: &mut RecoverySnapshot) -> Result<(), AppError> {
    apply_recovery_snapshot(path, snapshot, true, false).map_err(|error| {
        AppError::new(
            "discardFailedWithRecovery",
            error.message,
            Some("Discard may have partially changed files. Inspect the working tree and discarded-change recovery before retrying."),
        )
    })
}

fn discard_recovery_after_mutation(message: &str, error: AppError) -> AppError {
    AppError::new(
        "discardFailedWithRecovery",
        format!("{message}: {}", error.message),
        Some(
            "The working tree may already have changed. Inspect it and the saved recovery captures before retrying.",
        ),
    )
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum DiscardStep {
    BeforePublish,
    AfterCheck,
    BeforeApply,
}

pub fn execute_discard(path: &Path, plan: &DiscardPlan) -> Result<String, AppError> {
    execute_discard_with_hook(path, plan, |_, _| {})
}

fn execute_discard_with_hook(
    path: &Path,
    plan: &DiscardPlan,
    mut hook: impl FnMut(DiscardStep, &Path),
) -> Result<String, AppError> {
    let current = prepare_discard(path, plan.selected.clone())?;
    if current.patch != plan.patch
        || current.index != plan.index
        || current.preview.paths != plan.preview.paths
        || current.preview.skipped_paths != plan.preview.skipped_paths
    {
        return Err(AppError::new(
            "staleDiscard",
            "Files or the index changed after the discard preview.",
            Some("Nothing was discarded. Review a new preview before continuing."),
        ));
    }
    if let Some((file, preview)) = &plan.selection_preview {
        read_selection_patch(path, file, false, "discard", Some(preview))?;
    }
    let directory = recovery_directory(path)?;
    fs::create_dir_all(&directory).map_err(io_error)?;
    validate_recovery_directory(&directory)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).map_err(io_error)?;
    }
    let id = next_discard_capture_id()?;
    let capture = save_discard_capture(
        &directory,
        &id,
        |file| file.write_all(&plan.mutation_patch).map_err(io_error),
        |pending| hook(DiscardStep::BeforePublish, pending),
    )?;
    let mut snapshot = RecoverySnapshot::capture(&capture, None)?;
    let fingerprint = discard_plan_fingerprint(plan)?;
    verify_capture_fingerprint(&snapshot, Some(&fingerprint))?;
    apply_recovery_snapshot(path, &mut snapshot, true, true)?;
    hook(DiscardStep::AfterCheck, &capture);
    require_capture_fingerprint(&capture, &fingerprint)?;

    // Keep an independent durable copy until both the mutation and the
    // original capture have been checked, including after cancellation.
    let backup_id = format!("{id}-1");
    let backup = save_discard_capture(
        &directory,
        &backup_id,
        |file| file.write_all(&plan.mutation_patch).map_err(io_error),
        |_| {},
    )?;
    require_capture_fingerprint(&capture, &fingerprint)?;
    require_capture_fingerprint(&backup, &fingerprint)?;
    hook(DiscardStep::BeforeApply, &capture);
    apply_discard_capture(path, &mut snapshot)?;
    require_capture_fingerprint(&capture, &fingerprint).map_err(|error| {
        discard_recovery_after_mutation(
            "Changes were discarded, but the original recovery capture could not be verified",
            error,
        )
    })?;
    require_capture_fingerprint(&backup, &fingerprint)
        .and_then(|_| remove_recovery_file(&backup))
        .map_err(|error| {
            discard_recovery_after_mutation(
                "Changes were discarded, but the extra recovery capture could not be safely released",
                error,
            )
        })?;
    Ok(id)
}

fn validate_id(id: &str) -> Result<(), AppError> {
    if id.is_empty() || !id.bytes().all(|byte| byte.is_ascii_digit() || byte == b'-') {
        return Err(AppError::new(
            "invalidRecovery",
            "That recovery identifier is invalid.",
            None,
        ));
    }
    Ok(())
}

fn recovery_paths(
    path: &Path,
    capture: &mut RecoverySnapshot,
) -> Result<(Vec<String>, bool), AppError> {
    let (output, output_truncated) = capture.run_git(
        path,
        &["apply", "--numstat", "-z"],
        Some(MAX_RECOVERY_PATH_REPORT_BYTES),
    )?;
    if !output_truncated {
        ensure_success("inspect discarded-change paths", &output)?;
        if !output.stdout.ends_with(&[0]) {
            return Err(AppError::new(
                "discardRecoveryPathsUnavailable",
                "Git could not provide a complete file list for this capture.",
                Some("Inspect the saved patch in the Git directory before recovering it."),
            ));
        }
    }
    let mut paths = Vec::new();
    let mut paths_truncated = output_truncated;
    for record in output.stdout.split_inclusive(|byte| *byte == 0) {
        let Some(record) = record.strip_suffix(&[0]) else {
            break;
        };
        let fields = record.splitn(3, |byte| *byte == b'\t').collect::<Vec<_>>();
        if fields.len() != 3 || fields[2].is_empty() {
            return Err(AppError::new(
                "discardRecoveryPathsUnavailable",
                "Git returned an unsupported file list for this capture.",
                Some("Inspect the saved patch in the Git directory before recovering it."),
            ));
        }
        let file = std::str::from_utf8(fields[2]).map_err(|_| {
            AppError::new(
                "discardRecoveryPathsUnavailable",
                "This capture contains a file path that cannot be displayed.",
                Some("Inspect the saved patch in the Git directory before recovering it."),
            )
        })?;
        if paths.len() == MAX_RECOVERY_PATHS {
            paths_truncated = true;
            break;
        }
        paths.push(file.to_owned());
    }
    if paths.is_empty() {
        return Err(AppError::new(
            "discardRecoveryPathsUnavailable",
            "No file paths could be read from this capture.",
            Some("Inspect the saved patch in the Git directory before recovering it."),
        ));
    }
    Ok((paths, paths_truncated))
}

pub fn discarded_change_recoveries(path: &Path) -> Result<Vec<DiscardRecoveryInfo>, AppError> {
    let directory = recovery_directory(path)?;
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(io_error(error)),
    };
    let mut recoveries = Vec::new();
    for entry in entries {
        let entry = entry.map_err(io_error)?;
        let name = entry.file_name();
        let Some(id) = name.to_str().and_then(|name| name.strip_suffix(".patch")) else {
            continue;
        };
        validate_id(id)?;
        require_recovery_file(&entry.path())?;
        let (inspection, content_sha256) = match RecoverySnapshot::capture(
            &entry.path(),
            Some(MAX_RECOVERY_PATCH_INSPECTION_BYTES),
        ) {
            Ok(mut snapshot) => {
                let digest = Some(snapshot.content_sha256.clone());
                (recovery_paths(path, &mut snapshot), digest)
            }
            Err(error) => (Err(error), None),
        };
        let (paths, paths_truncated, paths_error) = match inspection {
            Ok((paths, truncated)) => (paths, truncated, None),
            Err(error)
                if matches!(
                    error.kind.as_str(),
                    "operationCancelled" | "gitInspectionTimeout"
                ) =>
            {
                return Err(error);
            }
            Err(error) => {
                let message = [Some(error.message), error.hint]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(" ");
                (Vec::new(), false, Some(message))
            }
        };
        let marker = directory.join(format!("{id}.restored"));
        let restored = recovery_file_exists(&marker)?;
        let (state_warning, state_blocked) =
            recovery_state_warning(&marker, restored, content_sha256.as_deref())?;
        recoveries.push(DiscardRecoveryInfo {
            id: id.to_owned(),
            restored,
            state_warning,
            state_blocked,
            paths,
            paths_truncated,
            paths_error,
            content_sha256,
        });
    }
    recoveries.sort_by(|left, right| right.id.cmp(&left.id));
    Ok(recoveries)
}

fn verify_capture_fingerprint(
    snapshot: &RecoverySnapshot,
    expected: Option<&str>,
) -> Result<(), AppError> {
    if let Some(expected) = expected {
        if expected.len() != 64
            || !expected
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(AppError::new(
                "invalidRecovery",
                "The recovery review fingerprint is invalid.",
                Some("Refresh discarded-change recovery before retrying."),
            ));
        }
        if snapshot.content_sha256 != expected {
            return Err(changed_recovery_capture());
        }
    }
    Ok(())
}

fn apply_recovery_snapshot(
    path: &Path,
    snapshot: &mut RecoverySnapshot,
    reverse: bool,
    check: bool,
) -> Result<(), AppError> {
    let mut args = vec!["apply", "--binary", "--recount", "--whitespace=nowarn"];
    if reverse {
        args.push("--reverse");
    }
    if check {
        args.push("--check");
    }
    let (output, _) = snapshot.run_git(path, &args, None)?;
    ensure_success(
        if reverse {
            "discard the captured changes"
        } else {
            "recover discarded changes"
        },
        &output,
    )
}

pub fn recover_discarded_changes(path: &Path, id: &str, reverse: bool) -> Result<(), AppError> {
    recover_discarded_changes_reviewed(path, id, reverse, None)
}

enum RecoveryState {
    Captured,
    LegacyRestored,
    Restored(String),
}

fn recovery_binding_file(marker: &Path) -> PathBuf {
    let mut name = marker.as_os_str().to_os_string();
    name.push(".sha256");
    PathBuf::from(name)
}

fn read_recovery_fingerprint(file: &Path, allow_empty: bool) -> Result<Option<String>, AppError> {
    let mut bytes = Vec::new();
    open_recovery_capture(file)?
        .take(65)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.is_empty() && allow_empty {
        return Ok(None);
    }
    if bytes.len() != 64
        || !bytes
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
    {
        return Err(changed_recovery_state());
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| changed_recovery_state())
}

fn read_recovery_state(marker: &Path) -> Result<RecoveryState, AppError> {
    let binding = recovery_binding_file(marker);
    if recovery_file_exists(&marker.with_extension("restored.pending"))? {
        return Err(changed_recovery_state());
    }
    let marker_exists = recovery_file_exists(marker)?;
    let binding_exists = recovery_file_exists(&binding)?;
    if !marker_exists {
        return if binding_exists {
            Err(changed_recovery_state())
        } else {
            Ok(RecoveryState::Captured)
        };
    }
    let marker_fingerprint = read_recovery_fingerprint(marker, true)?;
    let legacy_binding = if binding_exists {
        read_recovery_fingerprint(&binding, false)?
    } else {
        None
    };
    match (marker_fingerprint, legacy_binding) {
        (None, None) => Ok(RecoveryState::LegacyRestored),
        (Some(marker), Some(binding)) if marker != binding => Err(changed_recovery_state()),
        (Some(fingerprint), _) | (None, Some(fingerprint)) => {
            Ok(RecoveryState::Restored(fingerprint))
        }
    }
}

fn require_recovery_state(marker: &Path, restored: bool) -> Result<(), AppError> {
    let state = read_recovery_state(marker)?;
    let is_restored = !matches!(state, RecoveryState::Captured);
    if is_restored != restored {
        return Err(AppError::new(
            "discardRecoveryStateChanged",
            "That recovery was already applied.",
            Some("Refresh discarded-change recovery."),
        ));
    }
    Ok(())
}

fn recovery_state_warning(
    marker: &Path,
    restored: bool,
    fingerprint: Option<&str>,
) -> Result<(Option<String>, bool), AppError> {
    let state = match read_recovery_state(marker) {
        Ok(state) => state,
        Err(error) if error.kind == "discardRecoveryStateChanged" => {
            return Ok((
                Some(
                    [Some(error.message), error.hint]
                        .into_iter()
                        .flatten()
                        .collect::<Vec<_>>()
                        .join(" "),
                ),
                true,
            ));
        }
        Err(error) => return Err(error),
    };
    match state {
        RecoveryState::Captured if !restored => Ok((None, false)),
        RecoveryState::LegacyRestored if restored => Ok((
            Some("This older recovery state is not bound to its capture. Inspect the working files before discarding again.".into()),
            false,
        )),
        RecoveryState::Restored(expected)
            if restored && fingerprint.is_none_or(|actual| actual == expected.as_str()) =>
        {
            Ok((None, false))
        }
        _ => {
            let error = changed_recovery_state();
            Ok((
                Some([Some(error.message), error.hint].into_iter().flatten().collect::<Vec<_>>().join(" ")),
                true,
            ))
        }
    }
}

fn require_bound_recovery_state(
    marker: &Path,
    restored: bool,
    fingerprint: &str,
) -> Result<(), AppError> {
    match read_recovery_state(marker)? {
        RecoveryState::Captured if !restored => Ok(()),
        RecoveryState::Restored(actual) if restored && actual == fingerprint => Ok(()),
        _ => Err(changed_recovery_state()),
    }
}

fn write_recovery_fingerprint(file: &Path, fingerprint: &str) -> Result<(), AppError> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(file).map_err(io_error)?;
    file.write_all(fingerprint.as_bytes()).map_err(io_error)?;
    file.sync_all().map_err(io_error)
}

fn bind_legacy_recovery_state(marker: &Path, fingerprint: &str) -> Result<(), AppError> {
    if matches!(read_recovery_state(marker)?, RecoveryState::LegacyRestored) {
        write_recovery_fingerprint(&recovery_binding_file(marker), fingerprint)?;
        sync_recovery_directory(marker.parent().ok_or_else(changed_recovery_state)?)?;
    }
    require_bound_recovery_state(marker, true, fingerprint)
}

fn write_recovery_state(marker: &Path, restored: bool, fingerprint: &str) -> Result<(), AppError> {
    if !restored {
        remove_recovery_file(marker)?;
        match fs::remove_file(recovery_binding_file(marker)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error(error)),
        }
        return sync_recovery_directory(marker.parent().ok_or_else(changed_recovery_state)?);
    }
    let pending = marker.with_extension("restored.pending");
    write_recovery_fingerprint(&pending, fingerprint)?;
    publish_recovery_file(&pending, marker).map_err(io_error)?;
    sync_recovery_directory(marker.parent().ok_or_else(changed_recovery_state)?)
}

fn recovery_after_mutation_error(message: &str, error: AppError) -> AppError {
    AppError::new(
        "discardRecoveryFailedWithRecovery",
        format!("{message}: {}", error.message),
        Some(
            "Do not repeat this action. Inspect the working files and saved recovery captures before continuing.",
        ),
    )
}

fn update_recovery_record(
    capture: &Path,
    marker: &Path,
    fingerprint: &str,
    reverse: bool,
) -> Result<(), AppError> {
    require_capture_fingerprint(capture, fingerprint)
        .and_then(|_| require_bound_recovery_state(marker, reverse, fingerprint))
        .map_err(|error| {
            recovery_after_mutation_error(
                "The recovery action completed, but a saved capture changed",
                error,
            )
        })?;
    write_recovery_state(marker, !reverse, fingerprint).map_err(|error| {
        let action = if reverse {
            "Recovered changes were discarded again"
        } else {
            "Discarded changes were restored"
        };
        AppError::new(
            "discardRecoveryRecordFailed",
            format!("{action}, but the recovery record could not be updated: {}", error.message),
            Some("Do not repeat this action. Inspect the working files and saved recovery before continuing."),
        )
    })?;
    require_capture_fingerprint(capture, fingerprint)
        .and_then(|_| require_bound_recovery_state(marker, !reverse, fingerprint))
        .map_err(|error| {
            recovery_after_mutation_error(
                "The recovery action completed, but its saved state could not be confirmed",
                error,
            )
        })
}

pub fn recover_discarded_changes_reviewed(
    path: &Path,
    id: &str,
    reverse: bool,
    expected_sha256: Option<&str>,
) -> Result<(), AppError> {
    recover_discarded_changes_with_hook(path, id, reverse, expected_sha256, |_, _| {})
}

fn recover_discarded_changes_with_hook(
    path: &Path,
    id: &str,
    reverse: bool,
    expected_sha256: Option<&str>,
    before_apply: impl FnOnce(&Path, &Path),
) -> Result<(), AppError> {
    validate_id(id)?;
    let directory = recovery_directory(path)?;
    let marker = directory.join(format!("{id}.restored"));
    require_recovery_state(&marker, reverse)?;
    let capture = directory.join(format!("{id}.patch"));
    let mut snapshot = RecoverySnapshot::capture(&capture, None)?;
    verify_capture_fingerprint(&snapshot, expected_sha256)?;
    let fingerprint = snapshot.content_sha256.clone();
    if reverse {
        bind_legacy_recovery_state(&marker, &fingerprint)?;
    } else {
        require_bound_recovery_state(&marker, false, &fingerprint)?;
    }
    apply_recovery_snapshot(path, &mut snapshot, reverse, true)?;

    let backup_id = next_discard_capture_id()?;
    let backup = save_snapshot_capture(&directory, &backup_id, &mut snapshot)?;
    let backup_marker = directory.join(format!("{backup_id}.restored"));
    if reverse {
        write_recovery_state(&backup_marker, true, &fingerprint)?;
        sync_recovery_directory(&directory)?;
    }
    require_capture_fingerprint(&capture, &fingerprint)?;
    require_bound_recovery_state(&marker, reverse, &fingerprint)?;
    require_capture_fingerprint(&backup, &fingerprint)?;
    require_bound_recovery_state(&backup_marker, reverse, &fingerprint)?;
    before_apply(&capture, &backup);
    apply_recovery_snapshot(path, &mut snapshot, reverse, false).map_err(|error| {
        AppError::new(
            "discardRecoveryFailedWithRecovery",
            error.message,
            Some("Recovery may have partially changed files. Inspect the working tree and discarded-change recovery before retrying."),
        )
    })?;

    // Update either independently verified copy even when the other changed.
    let original_result = update_recovery_record(&capture, &marker, &fingerprint, reverse);
    let backup_result = update_recovery_record(&backup, &backup_marker, &fingerprint, reverse);
    if let Err(mut error) = original_result {
        if let Err(backup_error) = backup_result {
            error.message.push_str(&format!(
                " The independent recovery copy also could not be updated: {}",
                backup_error.message
            ));
        }
        return Err(error);
    }
    backup_result?;
    sync_recovery_directory(&directory).map_err(|error| {
        recovery_after_mutation_error("Could not sync the saved recovery state", error)
    })?;
    require_capture_fingerprint(&capture, &fingerprint)
        .and_then(|_| require_bound_recovery_state(&marker, !reverse, &fingerprint))
        .and_then(|_| require_capture_fingerprint(&backup, &fingerprint))
        .and_then(|_| require_bound_recovery_state(&backup_marker, !reverse, &fingerprint))
        .and_then(|_| remove_recovery_file(&backup))
        .and_then(|_| {
            if !reverse {
                finish_removing_recovery_marker(&backup_marker)?;
            }
            Ok(())
        })
        .map_err(|error| {
            recovery_after_mutation_error(
                "The recovery action completed, but the extra capture could not be safely released",
                error,
            )
        })?;
    Ok(())
}

pub fn delete_discard_recovery(path: &Path, id: &str) -> Result<(), AppError> {
    delete_discard_recovery_reviewed(path, id, None)
}

pub fn delete_discard_recovery_reviewed(
    path: &Path,
    id: &str,
    expected_sha256: Option<&str>,
) -> Result<(), AppError> {
    validate_id(id)?;
    let directory = recovery_directory(path)?;
    let capture = directory.join(format!("{id}.patch"));
    let marker = directory.join(format!("{id}.restored"));
    // Validate both paths before removing either: a corrupt marker must not
    // cause the otherwise usable capture to be deleted on a refused request.
    require_recovery_file(&capture)?;
    recovery_file_exists(&marker)?;
    recovery_file_exists(&recovery_binding_file(&marker))?;
    recovery_file_exists(&marker.with_extension("restored.pending"))?;
    if expected_sha256.is_some() {
        let snapshot = RecoverySnapshot::capture(&capture, None)?;
        verify_capture_fingerprint(&snapshot, expected_sha256)?;
    }
    remove_recovery_file(&capture)?;
    finish_removing_recovery_marker(&marker)
}

fn finish_removing_recovery_marker(marker: &Path) -> Result<(), AppError> {
    for file in [
        marker.to_path_buf(),
        recovery_binding_file(marker),
        marker.with_extension("restored.pending"),
    ] {
        match fs::remove_file(file) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(AppError::new(
                    "discardRecoveryCaptureRemoved",
                    format!(
                        "The saved recovery capture was removed, but its status metadata could not be removed: {error}"
                    ),
                    Some(
                        "Do not repeat this action. Inspect the remaining recovery metadata before continuing.",
                    ),
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Repository(PathBuf);

    impl Repository {
        fn new() -> Self {
            let id = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir()
                .join(format!("chronos-bulk-discard-{}-{id}", std::process::id()));
            fs::create_dir(&path).unwrap();
            for args in [
                vec!["init", "-b", "main"],
                vec!["config", "user.name", "Test"],
                vec!["config", "user.email", "test@example.test"],
                vec!["config", "commit.gpgsign", "false"],
            ] {
                ensure_success("initialize test", &run_git(&path, &args).unwrap()).unwrap();
            }
            Self(path)
        }

        fn write(&self, file: &str, contents: &[u8]) {
            let path = self.0.join(file);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, contents).unwrap();
        }

        fn baseline(&self) {
            self.write("tracked.txt", b"base\n");
            stage_all(&self.0).unwrap();
            commit(&self.0, "Baseline").unwrap();
        }
    }

    impl Drop for Repository {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn missing_capture_is_distinct_from_a_recovery_io_failure() {
        for reverse in [false, true] {
            let repository = Repository::new();
            repository.baseline();
            repository.write("tracked.txt", b"edited\n");
            let plan = prepare_discard(&repository.0, None).unwrap();
            let id = execute_discard(&repository.0, &plan).unwrap();
            if reverse {
                recover_discarded_changes(&repository.0, &id, false).unwrap();
            }
            let capture = recovery_directory(&repository.0)
                .unwrap()
                .join(format!("{id}.patch"));
            fs::remove_file(&capture).unwrap();

            assert_eq!(
                recover_discarded_changes(&repository.0, &id, reverse)
                    .unwrap_err()
                    .kind,
                "discardRecoveryMissing"
            );
            assert_eq!(
                delete_discard_recovery(&repository.0, &id)
                    .unwrap_err()
                    .kind,
                "discardRecoveryMissing"
            );
            assert_eq!(
                remove_recovery_file(&capture).unwrap_err().kind,
                "discardRecoveryMissing"
            );
        }
        assert_eq!(
            io_error(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "temporarily unavailable"
            ))
            .kind,
            "discardRecoveryUnavailable"
        );
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn private_snapshot_is_inaccessible_by_name_and_removed_when_closed() {
        let repository = Repository::new();
        let path = repository.0.join("temporary-snapshot");
        let mut file = private_recovery_snapshot_file(&path).unwrap();
        file.write_all(b"private changes").unwrap();
        assert!(fs::File::open(&path).is_err());
        file.seek(SeekFrom::Start(0)).unwrap();
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes, b"private changes");
        drop(file);
        assert!(!path.exists());

        fs::write(&path, b"preexisting").unwrap();
        assert!(private_recovery_snapshot_file(&path).is_err());
        assert_eq!(fs::read(path).unwrap(), b"preexisting");
    }

    #[test]
    fn discard_does_not_replace_a_capture_published_by_another_process() {
        let repository = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"reviewed edit\n");
        let plan = prepare_discard(&repository.0, None).unwrap();
        let index = fs::read(repository.0.join(".git/index")).unwrap();
        let mut pending = None;
        let error = execute_discard_with_hook(&repository.0, &plan, |step, file| {
            if step == DiscardStep::BeforePublish {
                fs::write(file.with_extension("patch"), b"external capture").unwrap();
                pending = Some(file.to_owned());
            }
        })
        .unwrap_err();
        assert_eq!(error.kind, "discardRecoveryUnavailable");
        let pending = pending.unwrap();
        assert_eq!(
            fs::read(pending.with_extension("patch")).unwrap(),
            b"external capture"
        );
        assert_eq!(fs::read(pending).unwrap(), plan.mutation_patch);
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"reviewed edit\n"
        );
        assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
    }

    #[test]
    fn discard_refuses_a_replaced_capture_before_mutating_the_worktree() {
        let repository = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"reviewed edit\n");
        repository.write("other.txt", b"other work\n");
        let plan = prepare_discard(&repository.0, Some(vec!["tracked.txt".into()])).unwrap();
        let other = prepare_discard(&repository.0, Some(vec!["other.txt".into()])).unwrap();
        let index = fs::read(repository.0.join(".git/index")).unwrap();
        let mut capture = None;
        let error = execute_discard_with_hook(&repository.0, &plan, |step, file| {
            if step == DiscardStep::AfterCheck {
                fs::write(file, &other.mutation_patch).unwrap();
                capture = Some(file.to_owned());
            }
        })
        .unwrap_err();
        assert_eq!(error.kind, "discardRecoveryChanged");
        assert_eq!(fs::read(capture.unwrap()).unwrap(), other.mutation_patch);
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"reviewed edit\n"
        );
        assert_eq!(
            fs::read(repository.0.join("other.txt")).unwrap(),
            b"other work\n"
        );
        assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
    }

    #[cfg(unix)]
    #[test]
    fn untracked_discard_refuses_a_parent_symlink_swapped_after_review() {
        use std::os::unix::fs::symlink;

        let repository = Repository::new();
        repository.baseline();
        repository.write("folder/untracked.txt", b"outside file must survive\n");
        let plan =
            prepare_discard(&repository.0, Some(vec!["folder/untracked.txt".to_owned()])).unwrap();
        assert_eq!(plan.preview.untracked, 1);
        let index = fs::read(repository.0.join(".git/index")).unwrap();
        let outside = repository.0.with_file_name(format!(
            "{}-outside",
            repository.0.file_name().unwrap().to_string_lossy()
        ));

        let error = execute_discard_with_hook(&repository.0, &plan, |step, _| {
            if step == DiscardStep::BeforeApply {
                fs::rename(repository.0.join("folder"), &outside).unwrap();
                symlink(&outside, repository.0.join("folder")).unwrap();
            }
        })
        .unwrap_err();

        assert_eq!(error.kind, "discardFailedWithRecovery");
        assert_eq!(
            fs::read(outside.join("untracked.txt")).unwrap(),
            b"outside file must survive\n"
        );
        assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
        assert!(discarded_change_recoveries(&repository.0).unwrap().len() >= 1);
        fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn discard_keeps_an_independent_recovery_if_the_capture_changes_during_mutation() {
        let repository = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"reviewed edit\n");
        repository.write("other.txt", b"other work\n");
        let plan = prepare_discard(&repository.0, Some(vec!["tracked.txt".into()])).unwrap();
        let other = prepare_discard(&repository.0, Some(vec!["other.txt".into()])).unwrap();
        let index = fs::read(repository.0.join(".git/index")).unwrap();
        let mut capture = None;
        let error = execute_discard_with_hook(&repository.0, &plan, |step, file| {
            if step == DiscardStep::BeforeApply {
                fs::write(file, &other.mutation_patch).unwrap();
                capture = Some(file.to_owned());
            }
        })
        .unwrap_err();
        assert_eq!(error.kind, "discardFailedWithRecovery");
        let capture = capture.unwrap();
        assert_eq!(fs::read(&capture).unwrap(), other.mutation_patch);
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"base\n"
        );
        assert_eq!(
            fs::read(repository.0.join("other.txt")).unwrap(),
            b"other work\n"
        );
        assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);

        let backup_id = format!("{}-1", capture.file_stem().unwrap().to_string_lossy());
        let backup = capture.with_file_name(format!("{backup_id}.patch"));
        assert_eq!(fs::read(&backup).unwrap(), plan.mutation_patch);
        assert_eq!(discarded_change_recoveries(&repository.0).unwrap().len(), 2);
        recover_discarded_changes_reviewed(
            &repository.0,
            &backup_id,
            false,
            Some(&discard_plan_fingerprint(&plan).unwrap()),
        )
        .unwrap();
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"reviewed edit\n"
        );
        assert_eq!(
            fs::read(repository.0.join("other.txt")).unwrap(),
            b"other work\n"
        );
        assert_eq!(fs::read(capture).unwrap(), other.mutation_patch);
    }

    #[test]
    fn discard_preserves_captures_after_a_failed_or_cancelled_mutation() {
        for cancelled in [false, true] {
            let repository = Repository::new();
            repository.baseline();
            repository.write("tracked.txt", b"reviewed edit\n");
            let plan = prepare_discard(&repository.0, None).unwrap();
            let index = fs::read(repository.0.join(".git/index")).unwrap();
            let token = CancellationToken::default();
            let mut capture = None;
            let result = git_cancellation::with(Some(&token), || {
                execute_discard_with_hook(&repository.0, &plan, |step, file| {
                    if step == DiscardStep::BeforeApply {
                        capture = Some(file.to_owned());
                        if cancelled {
                            token.cancel();
                        } else {
                            repository.write("tracked.txt", b"later external edit\n");
                        }
                    }
                })
            });
            assert_eq!(result.unwrap_err().kind, "discardFailedWithRecovery");
            let capture = capture.unwrap();
            let backup_id = format!("{}-1", capture.file_stem().unwrap().to_string_lossy());
            let backup = capture.with_file_name(format!("{backup_id}.patch"));
            assert_eq!(fs::read(capture).unwrap(), plan.mutation_patch);
            assert_eq!(fs::read(backup).unwrap(), plan.mutation_patch);
            assert_eq!(discarded_change_recoveries(&repository.0).unwrap().len(), 2);
            assert_eq!(
                fs::read(repository.0.join("tracked.txt")).unwrap(),
                if cancelled {
                    &b"reviewed edit\n"[..]
                } else {
                    &b"later external edit\n"[..]
                }
            );
            assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
        }
    }

    #[test]
    fn discard_does_not_remove_a_replaced_safety_copy() {
        let repository = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"reviewed edit\n");
        let plan = prepare_discard(&repository.0, None).unwrap();
        let mut capture = None;
        let mut backup = None;
        let error = execute_discard_with_hook(&repository.0, &plan, |step, file| {
            if step == DiscardStep::BeforeApply {
                let id = file.file_stem().unwrap().to_string_lossy();
                let copy = file.with_file_name(format!("{id}-1.patch"));
                fs::write(&copy, b"external replacement").unwrap();
                capture = Some(file.to_owned());
                backup = Some(copy);
            }
        })
        .unwrap_err();
        assert_eq!(error.kind, "discardFailedWithRecovery");
        let capture = capture.unwrap();
        let backup = backup.unwrap();
        assert_eq!(fs::read(&capture).unwrap(), plan.mutation_patch);
        assert_eq!(fs::read(&backup).unwrap(), b"external replacement");
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"base\n"
        );
        let id = capture.file_stem().unwrap().to_str().unwrap();
        recover_discarded_changes(&repository.0, id, false).unwrap();
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"reviewed edit\n"
        );
        assert_eq!(fs::read(backup).unwrap(), b"external replacement");
    }

    #[test]
    fn recovery_applies_the_same_snapshot_if_the_capture_changes_after_check() {
        for reverse in [false, true] {
            let repository = Repository::new();
            repository.baseline();
            repository.write("tracked.txt", b"edited\n");
            let plan = prepare_discard(&repository.0, None).unwrap();
            let id = execute_discard(&repository.0, &plan).unwrap();
            if reverse {
                recover_discarded_changes(&repository.0, &id, false).unwrap();
            }
            let capture = recovery_directory(&repository.0)
                .unwrap()
                .join(format!("{id}.patch"));
            let mut snapshot = RecoverySnapshot::capture(&capture, None).unwrap();
            apply_recovery_snapshot(&repository.0, &mut snapshot, reverse, true).unwrap();
            fs::write(&capture, b"externally replaced capture").unwrap();
            apply_recovery_snapshot(&repository.0, &mut snapshot, reverse, false).unwrap();
            assert_eq!(
                fs::read(repository.0.join("tracked.txt")).unwrap(),
                if reverse {
                    &b"base\n"[..]
                } else {
                    &b"edited\n"[..]
                }
            );
            assert_eq!(fs::read(capture).unwrap(), b"externally replaced capture");
        }
    }

    #[test]
    fn recovery_keeps_a_usable_copy_if_the_original_changes_during_apply() {
        for reverse in [false, true] {
            let repository = Repository::new();
            repository.baseline();
            repository.write("tracked.txt", b"reviewed edit\n");
            repository.write("other.txt", b"other work\n");
            let plan = prepare_discard(&repository.0, Some(vec!["tracked.txt".into()])).unwrap();
            let id = execute_discard(&repository.0, &plan).unwrap();
            if reverse {
                recover_discarded_changes(&repository.0, &id, false).unwrap();
            }
            let other = prepare_discard(&repository.0, Some(vec!["other.txt".into()])).unwrap();
            let index = fs::read(repository.0.join(".git/index")).unwrap();
            let mut backup_id = None;
            let error = recover_discarded_changes_with_hook(
                &repository.0,
                &id,
                reverse,
                Some(&discard_plan_fingerprint(&plan).unwrap()),
                |capture, backup| {
                    fs::write(capture, &other.mutation_patch).unwrap();
                    backup_id = Some(backup.file_stem().unwrap().to_str().unwrap().to_owned());
                },
            )
            .unwrap_err();
            assert_eq!(error.kind, "discardRecoveryFailedWithRecovery");
            let directory = recovery_directory(&repository.0).unwrap();
            let capture = directory.join(format!("{id}.patch"));
            let backup_id = backup_id.unwrap();
            let backup = directory.join(format!("{backup_id}.patch"));
            assert_eq!(fs::read(&capture).unwrap(), other.mutation_patch);
            assert_eq!(fs::read(&backup).unwrap(), plan.mutation_patch);
            let recoveries = discarded_change_recoveries(&repository.0).unwrap();
            let saved = recoveries
                .iter()
                .find(|saved| saved.id == backup_id)
                .unwrap();
            assert_eq!(saved.restored, !reverse);
            assert!(!saved.state_blocked);
            let original = recoveries.iter().find(|saved| saved.id == id).unwrap();
            assert_eq!(original.state_blocked, reverse);
            if reverse {
                assert!(original.state_warning.is_some());
                assert_eq!(
                    recover_discarded_changes_reviewed(
                        &repository.0,
                        &id,
                        true,
                        original.content_sha256.as_deref(),
                    )
                    .unwrap_err()
                    .kind,
                    "discardRecoveryStateChanged"
                );
            }
            assert_eq!(
                fs::read(repository.0.join("tracked.txt")).unwrap(),
                if reverse {
                    &b"base\n"[..]
                } else {
                    &b"reviewed edit\n"[..]
                }
            );
            assert_eq!(
                fs::read(repository.0.join("other.txt")).unwrap(),
                b"other work\n"
            );
            assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
            recover_discarded_changes(&repository.0, &backup_id, !reverse).unwrap();
            assert_eq!(
                fs::read(repository.0.join("tracked.txt")).unwrap(),
                if reverse {
                    &b"reviewed edit\n"[..]
                } else {
                    &b"base\n"[..]
                }
            );
            assert_eq!(fs::read(capture).unwrap(), other.mutation_patch);
        }
    }

    #[test]
    fn legacy_recovery_state_is_bound_before_discarding_again() {
        for replace_during_apply in [false, true] {
            let repository = Repository::new();
            repository.baseline();
            repository.write("tracked.txt", b"reviewed edit\n");
            repository.write("other.txt", b"other work\n");
            let plan = prepare_discard(&repository.0, Some(vec!["tracked.txt".into()])).unwrap();
            let id = execute_discard(&repository.0, &plan).unwrap();
            recover_discarded_changes(&repository.0, &id, false).unwrap();
            let directory = recovery_directory(&repository.0).unwrap();
            let marker = directory.join(format!("{id}.restored"));
            fs::write(&marker, b"").unwrap();
            let saved = discarded_change_recoveries(&repository.0)
                .unwrap()
                .remove(0);
            assert!(!saved.state_blocked);
            assert!(
                saved
                    .state_warning
                    .unwrap()
                    .contains("older recovery state")
            );

            if !replace_during_apply {
                recover_discarded_changes(&repository.0, &id, true).unwrap();
                assert!(!marker.exists());
                assert!(!recovery_binding_file(&marker).exists());
                assert_eq!(
                    fs::read(repository.0.join("tracked.txt")).unwrap(),
                    b"base\n"
                );
                continue;
            }

            let other = prepare_discard(&repository.0, Some(vec!["other.txt".into()])).unwrap();
            let mut backup_id = None;
            let error = recover_discarded_changes_with_hook(
                &repository.0,
                &id,
                true,
                saved.content_sha256.as_deref(),
                |capture, backup| {
                    fs::write(capture, &other.mutation_patch).unwrap();
                    backup_id = Some(backup.file_stem().unwrap().to_str().unwrap().to_owned());
                },
            )
            .unwrap_err();
            assert_eq!(error.kind, "discardRecoveryFailedWithRecovery");
            assert_eq!(
                fs::read(recovery_binding_file(&marker)).unwrap(),
                discard_plan_fingerprint(&plan).unwrap().as_bytes()
            );
            let records = discarded_change_recoveries(&repository.0).unwrap();
            let original = records.iter().find(|record| record.id == id).unwrap();
            assert!(original.state_blocked);
            assert_eq!(
                recover_discarded_changes(&repository.0, &id, true)
                    .unwrap_err()
                    .kind,
                "discardRecoveryStateChanged"
            );
            assert_eq!(
                fs::read(repository.0.join("other.txt")).unwrap(),
                b"other work\n"
            );
            recover_discarded_changes(&repository.0, &backup_id.unwrap(), false).unwrap();
            assert_eq!(
                fs::read(repository.0.join("tracked.txt")).unwrap(),
                b"reviewed edit\n"
            );
        }
    }

    #[test]
    fn incomplete_recovery_state_blocks_mutation_and_can_be_removed() {
        for pending in [false, true] {
            let repository = Repository::new();
            repository.baseline();
            repository.write("tracked.txt", b"reviewed edit\n");
            let plan = prepare_discard(&repository.0, None).unwrap();
            let id = execute_discard(&repository.0, &plan).unwrap();
            let directory = recovery_directory(&repository.0).unwrap();
            let marker = directory.join(format!("{id}.restored"));
            let metadata = if pending {
                marker.with_extension("restored.pending")
            } else {
                recovery_binding_file(&marker)
            };
            fs::write(&metadata, discard_plan_fingerprint(&plan).unwrap()).unwrap();

            let saved = discarded_change_recoveries(&repository.0)
                .unwrap()
                .remove(0);
            assert!(saved.state_blocked);
            assert!(saved.state_warning.is_some());
            assert_eq!(
                recover_discarded_changes_reviewed(
                    &repository.0,
                    &id,
                    false,
                    saved.content_sha256.as_deref(),
                )
                .unwrap_err()
                .kind,
                "discardRecoveryStateChanged"
            );
            assert_eq!(
                fs::read(repository.0.join("tracked.txt")).unwrap(),
                b"base\n"
            );
            delete_discard_recovery_reviewed(&repository.0, &id, saved.content_sha256.as_deref())
                .unwrap();
            assert!(!metadata.exists());
            assert!(
                discarded_change_recoveries(&repository.0)
                    .unwrap()
                    .is_empty()
            );
        }
    }

    #[test]
    fn recovery_marker_publication_never_overwrites_an_existing_marker() {
        let repository = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"reviewed edit\n");
        let plan = prepare_discard(&repository.0, None).unwrap();
        let id = execute_discard(&repository.0, &plan).unwrap();
        let marker = recovery_directory(&repository.0)
            .unwrap()
            .join(format!("{id}.restored"));
        let pending = marker.with_extension("restored.pending");
        fs::write(&marker, b"external marker").unwrap();

        assert!(
            write_recovery_state(&marker, true, &discard_plan_fingerprint(&plan).unwrap()).is_err()
        );
        assert_eq!(fs::read(&marker).unwrap(), b"external marker");
        assert_eq!(
            fs::read(&pending).unwrap(),
            discard_plan_fingerprint(&plan).unwrap().as_bytes()
        );
        let saved = discarded_change_recoveries(&repository.0)
            .unwrap()
            .remove(0);
        assert!(saved.state_blocked);
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"base\n"
        );
    }

    #[test]
    fn recovery_preserves_the_original_if_its_safety_copy_changes() {
        for reverse in [false, true] {
            let repository = Repository::new();
            repository.baseline();
            repository.write("tracked.txt", b"reviewed edit\n");
            let plan = prepare_discard(&repository.0, None).unwrap();
            let id = execute_discard(&repository.0, &plan).unwrap();
            if reverse {
                recover_discarded_changes(&repository.0, &id, false).unwrap();
            }
            let mut backup = None;
            let error = recover_discarded_changes_with_hook(
                &repository.0,
                &id,
                reverse,
                None,
                |_, copy| {
                    fs::write(copy, b"external replacement").unwrap();
                    backup = Some(copy.to_owned());
                },
            )
            .unwrap_err();
            assert_eq!(error.kind, "discardRecoveryFailedWithRecovery");
            let backup = backup.unwrap();
            assert_eq!(fs::read(&backup).unwrap(), b"external replacement");
            let saved = discarded_change_recoveries(&repository.0)
                .unwrap()
                .into_iter()
                .find(|saved| saved.id == id)
                .unwrap();
            assert_eq!(saved.restored, !reverse);
            recover_discarded_changes(&repository.0, &id, !reverse).unwrap();
            assert_eq!(
                fs::read(repository.0.join("tracked.txt")).unwrap(),
                if reverse {
                    &b"reviewed edit\n"[..]
                } else {
                    &b"base\n"[..]
                }
            );
            assert_eq!(fs::read(backup).unwrap(), b"external replacement");
        }
    }

    #[test]
    fn recovery_keeps_both_copies_after_a_failed_or_cancelled_mutation() {
        for reverse in [false, true] {
            for cancelled in [false, true] {
                let repository = Repository::new();
                repository.baseline();
                repository.write("tracked.txt", b"reviewed edit\n");
                let plan = prepare_discard(&repository.0, None).unwrap();
                let id = execute_discard(&repository.0, &plan).unwrap();
                if reverse {
                    recover_discarded_changes(&repository.0, &id, false).unwrap();
                }
                let index = fs::read(repository.0.join(".git/index")).unwrap();
                let token = CancellationToken::default();
                let mut backup = None;
                let result = git_cancellation::with(Some(&token), || {
                    recover_discarded_changes_with_hook(
                        &repository.0,
                        &id,
                        reverse,
                        None,
                        |_, copy| {
                            backup = Some(copy.to_owned());
                            if cancelled {
                                token.cancel();
                            } else {
                                repository.write("tracked.txt", b"later external edit\n");
                            }
                        },
                    )
                });
                assert_eq!(
                    result.unwrap_err().kind,
                    "discardRecoveryFailedWithRecovery"
                );
                let backup = backup.unwrap();
                let backup_id = backup.file_stem().unwrap().to_str().unwrap();
                assert_eq!(fs::read(&backup).unwrap(), plan.mutation_patch);
                let recoveries = discarded_change_recoveries(&repository.0).unwrap();
                assert_eq!(recoveries.len(), 2);
                for saved in recoveries {
                    assert!(saved.id == id || saved.id == backup_id);
                    assert_eq!(saved.restored, reverse);
                    assert_eq!(
                        saved.content_sha256.as_deref(),
                        Some(discard_plan_fingerprint(&plan).unwrap().as_str())
                    );
                }
                assert_eq!(
                    fs::read(repository.0.join("tracked.txt")).unwrap(),
                    if !cancelled {
                        &b"later external edit\n"[..]
                    } else if reverse {
                        &b"reviewed edit\n"[..]
                    } else {
                        &b"base\n"[..]
                    }
                );
                assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
            }
        }
    }

    #[test]
    fn bulk_discard_preserves_index_and_recovers_binary_empty_deleted_and_new_files() {
        let repository = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"staged\n");
        stage_path(&repository.0, "tracked.txt").unwrap();
        repository.write("tracked.txt", b"unstaged\n");
        repository.write("binary.dat", &[0, 1, 2, 255]);
        repository.write("empty", b"");
        repository.write("folder/new.txt", b"new\n");
        let original_index = run_git(&repository.0, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout;
        let plan = prepare_discard(&repository.0, None).unwrap();
        assert_eq!(plan.preview.paths.len(), 4);
        let id = execute_discard(&repository.0, &plan).unwrap();
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"staged\n"
        );
        assert!(!repository.0.join("binary.dat").exists());
        assert_eq!(
            run_git(&repository.0, &["ls-files", "--stage", "-z"])
                .unwrap()
                .stdout,
            original_index
        );
        let recoveries = discarded_change_recoveries(&repository.0).unwrap();
        assert_eq!(recoveries.len(), 1);
        assert_eq!(recoveries[0].id, id);
        assert_eq!(recoveries[0].paths, plan.preview.paths);
        let mut paths = recoveries[0].paths.clone();
        paths.sort();
        assert_eq!(
            paths,
            ["binary.dat", "empty", "folder/new.txt", "tracked.txt"]
        );
        assert!(!recoveries[0].paths_truncated);
        assert!(recoveries[0].paths_error.is_none());
        assert_eq!(
            recoveries[0].content_sha256.as_deref(),
            Some(discard_plan_fingerprint(&plan).unwrap().as_str())
        );
        recover_discarded_changes(&repository.0, &id, false).unwrap();
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"unstaged\n"
        );
        assert_eq!(
            fs::read(repository.0.join("binary.dat")).unwrap(),
            [0, 1, 2, 255]
        );
        assert!(repository.0.join("empty").exists());
        recover_discarded_changes(&repository.0, &id, true).unwrap();
        delete_discard_recovery(&repository.0, &id).unwrap();
        assert!(
            discarded_change_recoveries(&repository.0)
                .unwrap()
                .is_empty()
        );
        fs::remove_file(repository.0.join("tracked.txt")).unwrap();
        let plan = prepare_discard(&repository.0, None).unwrap();
        let id = execute_discard(&repository.0, &plan).unwrap();
        assert!(repository.0.join("tracked.txt").exists());
        recover_discarded_changes(&repository.0, &id, false).unwrap();
        assert!(!repository.0.join("tracked.txt").exists());
    }

    #[cfg(unix)]
    #[test]
    fn recovery_lists_literal_special_paths_from_existing_patch_files() {
        let repository = Repository::new();
        repository.baseline();
        let file = "folder/a \"quoted\"\t雪\nname.txt";
        repository.write(file, b"preserved contents\n");
        let plan = prepare_discard(&repository.0, Some(vec![file.to_owned()])).unwrap();
        let id = execute_discard(&repository.0, &plan).unwrap();

        let recoveries = discarded_change_recoveries(&repository.0).unwrap();
        assert_eq!(recoveries[0].id, id);
        assert_eq!(recoveries[0].paths, [file]);
        assert!(!recoveries[0].paths_truncated);
        assert!(recoveries[0].paths_error.is_none());
        recover_discarded_changes(&repository.0, &id, false).unwrap();
        assert_eq!(
            fs::read(repository.0.join(file)).unwrap(),
            b"preserved contents\n"
        );
    }

    #[test]
    fn recovery_path_listing_is_bounded_and_reports_omitted_paths() {
        let repository = Repository::new();
        repository.baseline();
        for index in 0..=MAX_RECOVERY_PATHS {
            repository.write(&format!("file-{index:03}.txt"), b"preserved\n");
        }
        let plan = prepare_discard(&repository.0, None).unwrap();
        let id = execute_discard(&repository.0, &plan).unwrap();

        let recoveries = discarded_change_recoveries(&repository.0).unwrap();
        assert_eq!(recoveries[0].id, id);
        assert_eq!(recoveries[0].paths.len(), MAX_RECOVERY_PATHS);
        assert!(recoveries[0].paths_truncated);
        assert!(recoveries[0].paths_error.is_none());
        recover_discarded_changes(&repository.0, &id, false).unwrap();
        for index in 0..=MAX_RECOVERY_PATHS {
            assert_eq!(
                fs::read(repository.0.join(format!("file-{index:03}.txt"))).unwrap(),
                b"preserved\n"
            );
        }
    }

    #[test]
    fn recovery_path_failures_are_reported_without_hiding_other_captures() {
        let repository = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"edited\n");
        let plan = prepare_discard(&repository.0, None).unwrap();
        let valid_id = execute_discard(&repository.0, &plan).unwrap();
        let directory = recovery_directory(&repository.0).unwrap();
        fs::write(directory.join("1.patch"), b"not a patch").unwrap();
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(directory.join("2.patch"))
            .unwrap()
            .set_len(MAX_RECOVERY_PATCH_INSPECTION_BYTES + 1)
            .unwrap();

        let recoveries = discarded_change_recoveries(&repository.0).unwrap();
        let valid = recoveries
            .iter()
            .find(|capture| capture.id == valid_id)
            .unwrap();
        assert_eq!(valid.paths, ["tracked.txt"]);
        assert!(valid.paths_error.is_none());
        let malformed = recoveries.iter().find(|capture| capture.id == "1").unwrap();
        assert!(malformed.paths.is_empty());
        assert!(malformed.paths_error.is_some());
        assert!(malformed.content_sha256.is_some());
        let oversized = recoveries.iter().find(|capture| capture.id == "2").unwrap();
        assert!(oversized.paths.is_empty());
        assert!(oversized.content_sha256.is_none());
        assert!(
            oversized
                .paths_error
                .as_ref()
                .unwrap()
                .contains("too large")
        );
        recover_discarded_changes(&repository.0, &valid_id, false).unwrap();
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"edited\n"
        );
    }

    #[test]
    fn reviewed_recovery_refuses_a_replaced_capture_before_applying_or_removing_it() {
        let repository = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"reviewed edit\n");
        let plan = prepare_discard(&repository.0, None).unwrap();
        let reviewed_id = execute_discard(&repository.0, &plan).unwrap();
        let reviewed = discarded_change_recoveries(&repository.0)
            .unwrap()
            .into_iter()
            .find(|capture| capture.id == reviewed_id)
            .unwrap();
        assert_eq!(reviewed.paths, ["tracked.txt"]);
        let fingerprint = reviewed.content_sha256.unwrap();
        let index = fs::read(repository.0.join(".git/index")).unwrap();

        repository.write("other.txt", b"different saved file\n");
        let other_plan = prepare_discard(&repository.0, Some(vec!["other.txt".into()])).unwrap();
        let other_id = execute_discard(&repository.0, &other_plan).unwrap();
        let directory = recovery_directory(&repository.0).unwrap();
        let capture = directory.join(format!("{reviewed_id}.patch"));
        let replacement = fs::read(directory.join(format!("{other_id}.patch"))).unwrap();
        fs::write(&capture, &replacement).unwrap();

        assert_eq!(
            recover_discarded_changes_reviewed(
                &repository.0,
                &reviewed_id,
                false,
                Some(&fingerprint)
            )
            .unwrap_err()
            .kind,
            "discardRecoveryChanged"
        );
        assert_eq!(
            delete_discard_recovery_reviewed(&repository.0, &reviewed_id, Some(&fingerprint))
                .unwrap_err()
                .kind,
            "discardRecoveryChanged"
        );
        assert_eq!(
            recover_discarded_changes_reviewed(&repository.0, &reviewed_id, false, Some("bad"))
                .unwrap_err()
                .kind,
            "invalidRecovery"
        );
        assert_eq!(fs::read(&capture).unwrap(), replacement);
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"base\n"
        );
        assert!(!repository.0.join("other.txt").exists());
        assert_eq!(fs::read(repository.0.join(".git/index")).unwrap(), index);
        assert!(!directory.join(format!("{reviewed_id}.restored")).exists());

        let updated = discarded_change_recoveries(&repository.0)
            .unwrap()
            .into_iter()
            .find(|capture| capture.id == reviewed_id)
            .unwrap();
        assert_eq!(updated.paths, ["other.txt"]);
        recover_discarded_changes_reviewed(
            &repository.0,
            &reviewed_id,
            false,
            updated.content_sha256.as_deref(),
        )
        .unwrap();
        assert_eq!(
            fs::read(repository.0.join("other.txt")).unwrap(),
            b"different saved file\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn recovery_record_failure_reports_the_completed_change() {
        use std::os::unix::fs::PermissionsExt;

        for reverse in [false, true] {
            let repository = Repository::new();
            repository.baseline();
            repository.write("tracked.txt", b"edited\n");
            let plan = prepare_discard(&repository.0, None).unwrap();
            let id = execute_discard(&repository.0, &plan).unwrap();
            if reverse {
                recover_discarded_changes(&repository.0, &id, false).unwrap();
            }
            let directory = recovery_directory(&repository.0).unwrap();
            let original = fs::metadata(&directory).unwrap().permissions();
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o500)).unwrap();
            let probe = directory.join("permission-probe");
            if fs::write(&probe, b"").is_ok() {
                fs::remove_file(probe).unwrap();
                fs::set_permissions(directory, original).unwrap();
                eprintln!(
                    "Skipping permission test: the process can write to a read-only directory."
                );
                return;
            }
            fs::set_permissions(&directory, original.clone()).unwrap();
            let result =
                recover_discarded_changes_with_hook(&repository.0, &id, reverse, None, |_, _| {
                    fs::set_permissions(&directory, fs::Permissions::from_mode(0o500)).unwrap();
                });
            fs::set_permissions(directory, original).unwrap();
            let error = result.unwrap_err();

            assert_eq!(
                fs::read(repository.0.join("tracked.txt")).unwrap(),
                if reverse {
                    &b"base\n"[..]
                } else {
                    &b"edited\n"[..]
                }
            );
            assert_eq!(error.kind, "discardRecoveryRecordFailed");
            assert!(error.message.contains(if reverse {
                "discarded again"
            } else {
                "restored"
            }));
            assert!(error.hint.unwrap().contains("Do not repeat"));
        }
    }

    #[cfg(unix)]
    #[test]
    fn marker_removal_failure_reports_the_capture_was_removed() {
        use std::os::unix::fs::PermissionsExt;

        let repository = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"edited\n");
        let plan = prepare_discard(&repository.0, None).unwrap();
        let id = execute_discard(&repository.0, &plan).unwrap();
        recover_discarded_changes(&repository.0, &id, false).unwrap();
        let directory = recovery_directory(&repository.0).unwrap();
        let capture = directory.join(format!("{id}.patch"));
        let marker = directory.join(format!("{id}.restored"));
        fs::remove_file(&capture).unwrap();
        let original = fs::metadata(&directory).unwrap().permissions();
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o500)).unwrap();
        let probe = directory.join("permission-probe");
        if fs::write(&probe, b"").is_ok() {
            fs::remove_file(probe).unwrap();
            fs::set_permissions(directory, original).unwrap();
            eprintln!("Skipping permission test: the process can write to a read-only directory.");
            return;
        }

        let result = finish_removing_recovery_marker(&marker);
        fs::set_permissions(directory, original).unwrap();
        let error = result.unwrap_err();

        assert!(!capture.exists());
        assert!(marker.exists());
        assert_eq!(error.kind, "discardRecoveryCaptureRemoved");
        assert!(error.message.contains("capture was removed"));
        assert!(error.hint.unwrap().contains("Do not repeat"));
    }

    #[test]
    fn bulk_discard_skips_nested_repositories_and_preserves_ignored_and_unselected_files() {
        let repository = Repository::new();
        repository.baseline();
        repository.write(".gitignore", b"ignored/\n");
        stage_path(&repository.0, ".gitignore").unwrap();
        repository.write("ignored/secret", b"keep");
        repository.write("selected/new.txt", b"discard");
        repository.write("unselected.txt", b"keep");
        repository.write("nested/.git/HEAD", b"ref: refs/heads/main\n");
        repository.write("nested/new.txt", b"keep");
        // A real nested repository must be excluded even when status collapses it.
        ensure_success(
            "initialize nested",
            &run_git(&repository.0.join("nested"), &["init"]).unwrap(),
        )
        .unwrap();
        let plan = prepare_discard(&repository.0, Some(vec!["selected/".into()])).unwrap();
        execute_discard(&repository.0, &plan).unwrap();
        assert!(!repository.0.join("selected/new.txt").exists());
        assert!(repository.0.join("unselected.txt").exists());
        assert!(repository.0.join("ignored/secret").exists());
        let all = prepare_discard(&repository.0, None).unwrap();
        assert!(
            all.preview
                .skipped_paths
                .iter()
                .any(|file| file.starts_with("nested"))
        );
        execute_discard(&repository.0, &all).unwrap();
        assert!(repository.0.join("nested/new.txt").exists());
        assert!(repository.0.join("ignored/secret").exists());
    }

    #[test]
    fn bulk_discard_refuses_stale_file_and_index_previews() {
        let repository = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"first\n");
        let plan = prepare_discard(&repository.0, None).unwrap();
        repository.write("tracked.txt", b"second\n");
        assert_eq!(
            execute_discard(&repository.0, &plan).unwrap_err().kind,
            "staleDiscard"
        );
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"second\n"
        );
        let plan = prepare_discard(&repository.0, None).unwrap();
        repository.write("staged.txt", b"new index");
        stage_path(&repository.0, "staged.txt").unwrap();
        assert_eq!(
            execute_discard(&repository.0, &plan).unwrap_err().kind,
            "staleDiscard"
        );
        assert!(
            discarded_change_recoveries(&repository.0)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn bulk_discard_recovery_refuses_conflicting_later_edits() {
        let repository = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"discarded\n");
        let id = execute_discard(
            &repository.0,
            &prepare_discard(&repository.0, None).unwrap(),
        )
        .unwrap();
        repository.write("tracked.txt", b"later work\n");
        assert!(recover_discarded_changes(&repository.0, &id, false).is_err());
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"later work\n"
        );
        assert!(!discarded_change_recoveries(&repository.0).unwrap()[0].restored);
    }

    #[test]
    fn bulk_discard_uses_literal_paths_and_includes_unloaded_status_entries() {
        let repository = Repository::new();
        repository.baseline();
        for index in 0..1010 {
            repository.write(&format!("new-{index}"), b"new");
        }
        repository.write(":(glob)*.txt", b"literal");
        assert!(
            status_with_entry_limit(&repository.0, 10)
                .unwrap()
                .entries_truncated
        );
        let plan = prepare_discard(&repository.0, None).unwrap();
        assert_eq!(plan.preview.paths.len(), 1011);
        execute_discard(&repository.0, &plan).unwrap();
        assert_eq!(read_status(&repository.0).unwrap().untracked, 0);
        assert!(repository.0.join("tracked.txt").exists());
    }

    #[test]
    fn bulk_discard_handles_unborn_repositories() {
        let repository = Repository::new();
        repository.write("new.txt", b"new");
        let id = execute_discard(
            &repository.0,
            &prepare_discard(&repository.0, None).unwrap(),
        )
        .unwrap();
        assert!(!repository.0.join("new.txt").exists());
        recover_discarded_changes(&repository.0, &id, false).unwrap();
        assert_eq!(fs::read(repository.0.join("new.txt")).unwrap(), b"new");
    }

    #[test]
    fn bulk_discard_skips_conflicts_and_gitlinks() {
        let repository = Repository::new();
        repository.baseline();
        let oid = String::from_utf8_lossy(
            &run_git(&repository.0, &["rev-parse", "HEAD"])
                .unwrap()
                .stdout,
        )
        .trim()
        .to_owned();
        run_mutation(
            &repository.0,
            &[
                "update-index",
                "--add",
                "--cacheinfo",
                &format!("160000,{oid},submodule"),
            ],
            "create test gitlink",
        )
        .unwrap();
        run_mutation(
            &repository.0,
            &[
                "clone",
                "--no-hardlinks",
                "--no-local",
                repository.0.to_str().unwrap(),
                repository.0.join("submodule").to_str().unwrap(),
            ],
            "create test submodule checkout",
        )
        .unwrap();
        repository.write("submodule/dirty.txt", b"keep");
        let blob = run_git(&repository.0, &["rev-parse", "HEAD:tracked.txt"]).unwrap();
        let blob = String::from_utf8_lossy(&blob.stdout).trim().to_owned();
        let entries = format!("0 {}\\ttracked.txt\n100644 {blob} 1\\ttracked.txt\n100644 {blob} 2\\ttracked.txt\n100644 {blob} 3\\ttracked.txt\n", "0".repeat(40)).replace("\\t", "\t");
        run_git_with_input(
            &repository.0,
            &["update-index", "--index-info"],
            entries.as_bytes(),
            "create conflict",
        )
        .unwrap();
        repository.write("tracked.txt", b"conflicted work\n");
        repository.write("ordinary.txt", b"discard");
        let plan = prepare_discard(&repository.0, None).unwrap();
        assert!(
            plan.preview
                .skipped_paths
                .contains(&"tracked.txt".to_owned())
        );
        execute_discard(&repository.0, &plan).unwrap();
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"conflicted work\n"
        );
        assert!(repository.0.join("submodule/dirty.txt").exists());
    }

    #[test]
    fn bulk_discard_does_not_mutate_when_recovery_storage_is_unavailable() {
        let repository = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"keep\n");
        repository.write(".git/git-khronos-recovery", b"not a directory");
        let plan = prepare_discard(&repository.0, None).unwrap();
        assert!(execute_discard(&repository.0, &plan).is_err());
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"keep\n"
        );
    }

    #[test]
    #[cfg(unix)]
    fn discard_refuses_a_redirected_recovery_directory_without_external_writes() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let repository = Repository::new();
        let outside = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"keep this edit\n");
        let storage = outside.0.join("protected");
        fs::create_dir(&storage).unwrap();
        fs::set_permissions(&storage, fs::Permissions::from_mode(0o755)).unwrap();
        fs::write(storage.join("123.patch"), b"outside sentinel\n").unwrap();
        symlink(&storage, repository.0.join(".git/git-khronos-recovery")).unwrap();
        let plan = prepare_discard(&repository.0, None).unwrap();
        assert!(execute_discard(&repository.0, &plan).is_err());
        assert!(discarded_change_recoveries(&repository.0).is_err());
        assert!(delete_discard_recovery(&repository.0, "123").is_err());
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"keep this edit\n"
        );
        assert_eq!(
            fs::read(storage.join("123.patch")).unwrap(),
            b"outside sentinel\n"
        );
        assert_eq!(fs::read_dir(&storage).unwrap().count(), 1);
        assert_eq!(
            fs::metadata(&storage).unwrap().permissions().mode() & 0o777,
            0o755
        );
    }

    #[test]
    #[cfg(unix)]
    fn recovery_refuses_a_linked_capture_before_changing_files() {
        use std::os::unix::fs::symlink;
        let repository = Repository::new();
        let outside = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"captured edit\n");
        let id = execute_discard(
            &repository.0,
            &prepare_discard(&repository.0, None).unwrap(),
        )
        .unwrap();
        let capture = repository
            .0
            .join(format!(".git/git-khronos-recovery/{id}.patch"));
        let external = outside.0.join("outside.patch");
        fs::rename(&capture, &external).unwrap();
        symlink(&external, &capture).unwrap();
        let bytes = fs::read(&external).unwrap();
        assert!(recover_discarded_changes(&repository.0, &id, false).is_err());
        assert!(discarded_change_recoveries(&repository.0).is_err());
        assert!(delete_discard_recovery(&repository.0, &id).is_err());
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"base\n"
        );
        assert_eq!(fs::read(&external).unwrap(), bytes);
        assert!(fs::symlink_metadata(&capture).unwrap().is_symlink());
    }

    #[test]
    #[cfg(unix)]
    fn recovery_refuses_a_dangling_marker_link_without_creating_its_target() {
        use std::os::unix::fs::symlink;
        let repository = Repository::new();
        let outside = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"captured edit\n");
        let id = execute_discard(
            &repository.0,
            &prepare_discard(&repository.0, None).unwrap(),
        )
        .unwrap();
        let capture = repository
            .0
            .join(format!(".git/git-khronos-recovery/{id}.patch"));
        let marker = capture.with_extension("restored");
        let target = outside.0.join("must-not-be-created");
        symlink(&target, &marker).unwrap();
        assert!(recover_discarded_changes(&repository.0, &id, false).is_err());
        assert!(discarded_change_recoveries(&repository.0).is_err());
        assert!(delete_discard_recovery(&repository.0, &id).is_err());
        assert!(!target.exists());
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"base\n"
        );
        assert!(capture.is_file());
        assert!(fs::symlink_metadata(&marker).unwrap().is_symlink());
    }

    #[test]
    #[cfg(unix)]
    fn recovery_refuses_linked_state_metadata_without_deleting_the_capture() {
        use std::os::unix::fs::symlink;
        for pending in [false, true] {
            let repository = Repository::new();
            let outside = Repository::new();
            repository.baseline();
            repository.write("tracked.txt", b"captured edit\n");
            let id = execute_discard(
                &repository.0,
                &prepare_discard(&repository.0, None).unwrap(),
            )
            .unwrap();
            let capture = repository
                .0
                .join(format!(".git/git-khronos-recovery/{id}.patch"));
            let marker = capture.with_extension("restored");
            let metadata = if pending {
                marker.with_extension("restored.pending")
            } else {
                recovery_binding_file(&marker)
            };
            let target = outside.0.join("outside-metadata");
            fs::write(&target, b"external data").unwrap();
            symlink(&target, &metadata).unwrap();

            assert!(recover_discarded_changes(&repository.0, &id, false).is_err());
            assert!(discarded_change_recoveries(&repository.0).is_err());
            assert!(delete_discard_recovery(&repository.0, &id).is_err());
            assert_eq!(fs::read(&target).unwrap(), b"external data");
            assert!(capture.is_file());
            assert!(fs::symlink_metadata(metadata).unwrap().is_symlink());
            assert_eq!(
                fs::read(repository.0.join("tracked.txt")).unwrap(),
                b"base\n"
            );
        }
    }

    #[test]
    fn recovery_refuses_directory_entries_without_losing_the_capture() {
        for extension in ["patch", "restored"] {
            let repository = Repository::new();
            repository.baseline();
            repository.write("tracked.txt", b"captured edit\n");
            let id = execute_discard(
                &repository.0,
                &prepare_discard(&repository.0, None).unwrap(),
            )
            .unwrap();
            let capture = repository
                .0
                .join(format!(".git/git-khronos-recovery/{id}.patch"));
            let bytes = fs::read(&capture).unwrap();
            let invalid = capture.with_extension(extension);
            if extension == "patch" {
                fs::remove_file(&capture).unwrap();
            }
            fs::create_dir(&invalid).unwrap();
            assert_eq!(
                recover_discarded_changes(&repository.0, &id, false)
                    .unwrap_err()
                    .kind,
                "invalidRecoveryPath"
            );
            assert!(discarded_change_recoveries(&repository.0).is_err());
            assert!(delete_discard_recovery(&repository.0, &id).is_err());
            assert_eq!(
                fs::read(repository.0.join("tracked.txt")).unwrap(),
                b"base\n"
            );
            fs::remove_dir(&invalid).unwrap();
            if extension == "patch" {
                fs::write(&capture, &bytes).unwrap();
            } else {
                assert_eq!(fs::read(&capture).unwrap(), bytes);
            }
            recover_discarded_changes(&repository.0, &id, false).unwrap();
            assert_eq!(
                fs::read(repository.0.join("tracked.txt")).unwrap(),
                b"captured edit\n"
            );
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                assert_eq!(
                    fs::metadata(capture.with_extension("restored"))
                        .unwrap()
                        .permissions()
                        .mode()
                        & 0o777,
                    0o600
                );
            }
            recover_discarded_changes(&repository.0, &id, true).unwrap();
            delete_discard_recovery(&repository.0, &id).unwrap();
            assert!(
                discarded_change_recoveries(&repository.0)
                    .unwrap()
                    .is_empty()
            );
        }
    }

    #[test]
    fn discard_and_recovery_preserve_crlf_working_tree_contents() {
        let repository = Repository::new();
        repository.write(".gitattributes", b"tracked.txt text eol=crlf\n");
        repository.write("tracked.txt", b"base\r\n");
        stage_all(&repository.0).unwrap();
        commit(&repository.0, "CRLF baseline").unwrap();
        repository.write("tracked.txt", b"changed\r\n");
        let index = run_git(&repository.0, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout;
        let plan = prepare_discard(&repository.0, Some(vec!["tracked.txt".to_owned()])).unwrap();
        let id = execute_discard(&repository.0, &plan).unwrap();
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"base\r\n"
        );
        recover_discarded_changes(&repository.0, &id, false).unwrap();
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"changed\r\n"
        );
        assert_eq!(
            run_git(&repository.0, &["ls-files", "--stage", "-z"])
                .unwrap()
                .stdout,
            index
        );
    }

    #[cfg(unix)]
    #[test]
    fn discard_capture_never_executes_an_untracked_text_converter() {
        use std::os::unix::fs::PermissionsExt;
        let repository = Repository::new();
        repository.write(".gitattributes", b"*.owned diff=owned\n");
        stage_all(&repository.0).unwrap();
        commit(&repository.0, "Attributes").unwrap();
        let script = repository.0.join(".git/owned-textconv");
        fs::write(
            &script,
            b"#!/bin/sh\nprintf called > .git/textconv-called\nprintf 'converted contents\\n'\n",
        )
        .unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
        ensure_success(
            "configure owned converter",
            &run_git(
                &repository.0,
                &["config", "diff.owned.textconv", script.to_str().unwrap()],
            )
            .unwrap(),
        )
        .unwrap();
        let bytes = b"owned raw contents\0\xff\n";
        repository.write("payload.owned", bytes);
        let plan = prepare_discard(&repository.0, Some(vec!["payload.owned".to_owned()])).unwrap();
        assert!(!repository.0.join(".git/textconv-called").exists());
        let id = execute_discard(&repository.0, &plan).unwrap();
        assert!(!repository.0.join("payload.owned").exists());
        recover_discarded_changes(&repository.0, &id, false).unwrap();
        assert_eq!(fs::read(repository.0.join("payload.owned")).unwrap(), bytes);
        assert!(!repository.0.join(".git/textconv-called").exists());
    }

    #[cfg(unix)]
    #[test]
    fn discard_and_recovery_preserve_reversible_clean_smudge_filters() {
        let repository = Repository::new();
        repository.write(".gitattributes", b"*.owned filter=owned\n");
        for (key, value) in [
            ("filter.owned.clean", "sed 's/^WORK://'"),
            ("filter.owned.smudge", "sed 's/^/WORK:/'"),
        ] {
            ensure_success(
                "configure owned conversion",
                &run_git(&repository.0, &["config", key, value]).unwrap(),
            )
            .unwrap();
        }
        repository.write("tracked.owned", b"WORK:base\n");
        stage_all(&repository.0).unwrap();
        commit(&repository.0, "Filtered baseline").unwrap();
        assert_eq!(
            run_git(&repository.0, &["show", ":tracked.owned"])
                .unwrap()
                .stdout,
            b"base\n"
        );
        repository.write("tracked.owned", b"WORK:changed\n");
        let index = run_git(&repository.0, &["ls-files", "--stage", "-z"])
            .unwrap()
            .stdout;
        let plan = prepare_discard(&repository.0, Some(vec!["tracked.owned".to_owned()])).unwrap();
        let id = execute_discard(&repository.0, &plan).unwrap();
        assert_eq!(
            fs::read(repository.0.join("tracked.owned")).unwrap(),
            b"WORK:base\n"
        );
        recover_discarded_changes(&repository.0, &id, false).unwrap();
        assert_eq!(
            fs::read(repository.0.join("tracked.owned")).unwrap(),
            b"WORK:changed\n"
        );
        assert_eq!(
            run_git(&repository.0, &["ls-files", "--stage", "-z"])
                .unwrap()
                .stdout,
            index
        );
    }

    #[test]
    fn partial_discard_refuses_a_stale_review_without_capture_or_index_changes() {
        for selected_lines in [false, true] {
            for changed_index in [false, true] {
                let repository = Repository::new();
                repository.baseline();
                repository.write("tracked.txt", b"reviewed\n");
                let preview = working_tree_file_diff(&repository.0, "tracked.txt", false).unwrap();
                if changed_index {
                    stage_path(&repository.0, "tracked.txt").unwrap();
                }
                repository.write("tracked.txt", b"later edit\n");
                let index = run_git(&repository.0, &["ls-files", "--stage", "-z"])
                    .unwrap()
                    .stdout;
                let lines = selected_lines.then_some([0usize, 1]);
                let error = prepare_partial_discard_with_preview(
                    &repository.0,
                    "tracked.txt",
                    0,
                    lines.as_ref().map(|lines| lines.as_slice()),
                    Some(&preview.patch),
                )
                .err()
                .expect("stale review must fail");
                assert_eq!(error.kind, "staleDiffSelection");
                assert_eq!(
                    fs::read(repository.0.join("tracked.txt")).unwrap(),
                    b"later edit\n"
                );
                assert_eq!(
                    run_git(&repository.0, &["ls-files", "--stage", "-z"])
                        .unwrap()
                        .stdout,
                    index
                );
                assert!(
                    discarded_change_recoveries(&repository.0)
                        .unwrap()
                        .is_empty()
                );
            }
        }
    }

    #[test]
    fn partial_discard_rechecks_the_displayed_preview_before_capture_creation() {
        let repository = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"reviewed\n");
        let preview = working_tree_file_diff(&repository.0, "tracked.txt", false).unwrap();
        let plan = prepare_partial_discard_with_preview(
            &repository.0,
            "tracked.txt",
            0,
            None,
            Some(&preview.patch),
        )
        .unwrap();
        ensure_success(
            "change displayed object abbreviation",
            &run_git(&repository.0, &["config", "core.abbrev", "20"]).unwrap(),
        )
        .unwrap();
        let error = execute_discard(&repository.0, &plan).unwrap_err();
        assert_eq!(error.kind, "staleDiffSelection");
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"reviewed\n"
        );
        assert!(
            discarded_change_recoveries(&repository.0)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn bulk_discard_and_recovery_ignore_diff_presentation_configuration() {
        let repository = Repository::new();
        repository.baseline();
        repository.write("tracked.txt", b"changed\n");
        repository.write("new.txt", b"new contents\n");
        for (key, value) in [
            ("diff.context", "0"),
            ("diff.noprefix", "true"),
            ("diff.mnemonicPrefix", "true"),
        ] {
            ensure_success(
                "configure diff presentation",
                &run_git(&repository.0, &["config", key, value]).unwrap(),
            )
            .unwrap();
        }
        let plan = prepare_discard(&repository.0, None).unwrap();
        let id = execute_discard(&repository.0, &plan).unwrap();
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"base\n"
        );
        assert!(!repository.0.join("new.txt").exists());
        recover_discarded_changes(&repository.0, &id, false).unwrap();
        assert_eq!(
            fs::read(repository.0.join("tracked.txt")).unwrap(),
            b"changed\n"
        );
        assert_eq!(
            fs::read(repository.0.join("new.txt")).unwrap(),
            b"new contents\n"
        );
        assert!(
            run_git(&repository.0, &["diff", "--cached", "--name-only"])
                .unwrap()
                .stdout
                .is_empty()
        );
    }

    #[test]
    fn partial_discard_uses_displayed_hunks_despite_git_diff_configuration() {
        for selected_lines in [false, true] {
            let repository = Repository::new();
            let original = (1..=20)
                .map(|line| format!("line {line}\n"))
                .collect::<String>();
            repository.write("forest", original.as_bytes());
            stage_all(&repository.0).unwrap();
            commit(&repository.0, "Original").unwrap();
            for (key, value) in [
                ("diff.context", "0"),
                ("diff.noprefix", "true"),
                ("diff.mnemonicPrefix", "true"),
            ] {
                ensure_success(
                    "configure diff presentation",
                    &run_git(&repository.0, &["config", key, value]).unwrap(),
                )
                .unwrap();
            }
            let changed = original
                .replace("line 2\n", "changed two\n")
                .replace("line 5\n", "changed five\n")
                .replace("line 15\n", "changed fifteen\n");
            repository.write("forest", changed.as_bytes());
            let displayed = working_tree_file_diff(&repository.0, "forest", false).unwrap();
            assert_eq!(displayed.patch.matches("@@ -").count(), 2);
            let lines = selected_lines.then_some([0usize, 1]);
            let plan = prepare_partial_discard(
                &repository.0,
                "forest",
                0,
                lines.as_ref().map(|lines| lines.as_slice()),
            )
            .unwrap();
            let id = execute_discard(&repository.0, &plan).unwrap();
            let remaining = fs::read_to_string(repository.0.join("forest")).unwrap();
            assert!(remaining.contains("line 2\n"));
            assert_eq!(remaining.contains("changed five\n"), selected_lines);
            assert!(remaining.contains("changed fifteen\n"));
            assert!(
                run_git(&repository.0, &["diff", "--cached", "--name-only"])
                    .unwrap()
                    .stdout
                    .is_empty()
            );
            recover_discarded_changes(&repository.0, &id, false).unwrap();
            assert_eq!(
                fs::read_to_string(repository.0.join("forest")).unwrap(),
                changed
            );
        }
    }

    #[test]
    fn bulk_discard_partial_captures_survive_restart_and_leave_unselected_edits() {
        for selected_lines in [false, true] {
            let repository = Repository::new();
            let original = (1..=20)
                .map(|line| format!("line {line}\n"))
                .collect::<String>();
            repository.write("forest", original.as_bytes());
            stage_all(&repository.0).unwrap();
            commit(&repository.0, "Original").unwrap();
            let changed = original.replace("line 2\n", "changed two\n").replace(
                if selected_lines {
                    "line 5\n"
                } else {
                    "line 15\n"
                },
                "another edit\n",
            );
            repository.write("forest", changed.as_bytes());
            let index = run_git(&repository.0, &["ls-files", "--stage", "-z"])
                .unwrap()
                .stdout;
            let lines = selected_lines.then_some([0usize, 1]);
            let plan = prepare_partial_discard(
                &repository.0,
                "forest",
                0,
                lines.as_ref().map(|lines| lines.as_slice()),
            )
            .unwrap();
            let id = execute_discard(&repository.0, &plan).unwrap();
            drop(plan);
            let remaining = fs::read_to_string(repository.0.join("forest")).unwrap();
            assert!(remaining.contains("line 2\n"));
            assert!(remaining.contains("another edit\n"));
            assert!(!remaining.contains("changed two\n"));
            assert_eq!(
                run_git(&repository.0, &["ls-files", "--stage", "-z"])
                    .unwrap()
                    .stdout,
                index
            );
            let captures = discarded_change_recoveries(&repository.0).unwrap();
            assert_eq!(captures[0].id, id);
            recover_discarded_changes(&repository.0, &id, false).unwrap();
            assert_eq!(
                fs::read_to_string(repository.0.join("forest")).unwrap(),
                changed
            );
            assert!(discarded_change_recoveries(&repository.0).unwrap()[0].restored);
            recover_discarded_changes(&repository.0, &id, true).unwrap();
            assert!(!discarded_change_recoveries(&repository.0).unwrap()[0].restored);
        }
    }

    #[cfg(unix)]
    #[test]
    fn bulk_discard_symlink_capture_preserves_targets_and_restores_links() {
        use std::os::unix::fs::symlink;
        let repository = Repository::new();
        repository.baseline();
        repository.write("target", b"keep target\n");
        symlink("target", repository.0.join("link")).unwrap();
        let plan = prepare_discard(&repository.0, Some(vec!["link".into()])).unwrap();
        let id = execute_discard(&repository.0, &plan).unwrap();
        assert!(!repository.0.join("link").exists());
        assert_eq!(
            fs::read(repository.0.join("target")).unwrap(),
            b"keep target\n"
        );
        recover_discarded_changes(&repository.0, &id, false).unwrap();
        assert_eq!(
            fs::read_link(repository.0.join("link")).unwrap(),
            Path::new("target")
        );
        assert_eq!(
            fs::read(repository.0.join("target")).unwrap(),
            b"keep target\n"
        );
    }

    #[test]
    fn bulk_discard_partial_lines_keep_unselected_insertions_and_deletions() {
        let repository = Repository::new();
        let original = (1..=10)
            .map(|line| format!("line {line}\n"))
            .collect::<String>();
        repository.write("forest", original.as_bytes());
        stage_all(&repository.0).unwrap();
        commit(&repository.0, "Original").unwrap();
        let changed = original
            .replace("line 2\n", "changed two\n")
            .replace("line 5\n", "")
            .replace("line 7\n", "line 7\ninserted seven\n");
        repository.write("forest", changed.as_bytes());
        let plan = prepare_partial_discard(&repository.0, "forest", 0, Some(&[0, 1])).unwrap();
        let id = execute_discard(&repository.0, &plan).unwrap();
        assert_eq!(
            fs::read_to_string(repository.0.join("forest")).unwrap(),
            changed.replace("changed two\n", "line 2\n")
        );
        recover_discarded_changes(&repository.0, &id, false).unwrap();
        assert_eq!(
            fs::read_to_string(repository.0.join("forest")).unwrap(),
            changed
        );
    }
}
