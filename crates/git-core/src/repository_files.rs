use super::*;
use std::collections::BTreeMap;
use std::fs;

#[cfg(windows)]
use std::fs::OpenOptions;

const FILE_PAGE_SIZE: usize = 200;
const MAX_FILE_PATH_BYTES: usize = 16_384;
const MAX_GIT_ERROR_BYTES: usize = 64 * 1024;

#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryFile {
    pub path: String,
    pub tracked: bool,
    pub ignored: bool,
    pub symbolic_link: bool,
    pub deletable: bool,
}

#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryFiles {
    pub files: Vec<RepositoryFile>,
    pub next_cursor: Option<String>,
    pub incomplete: bool,
}

fn refused(message: &str) -> AppError {
    AppError::new(
        "repositoryFileRefused",
        message,
        Some("Refresh the repository file list and review the path before retrying."),
    )
}

fn validate_file_name(file: &str) -> Result<&Path, AppError> {
    let path = Path::new(file);
    if file.is_empty()
        || file.len() > MAX_FILE_PATH_BYTES
        || file.contains(['\0', '\n', '\r'])
        || file
            .split(std::path::is_separator)
            .any(|part| part.is_empty() || part == "." || part == "..")
        || !path
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
        || path.components().any(|part| part.as_os_str() == ".git")
    {
        return Err(refused(
            "Choose a literal repository-relative file outside Git metadata.",
        ));
    }
    #[cfg(target_os = "macos")]
    if path.components().any(|part| {
        part.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(".git")
    }) {
        return Err(refused("Git metadata cannot be used as a repository file."));
    }
    #[cfg(windows)]
    if path
        .components()
        .any(|part| unsafe_windows_component(part.as_os_str()))
    {
        return Err(refused(
            "Choose a regular Windows file name outside Git metadata.",
        ));
    }
    Ok(path)
}

#[cfg(windows)]
pub(super) fn unsafe_windows_component(component: &std::ffi::OsStr) -> bool {
    let part = component.to_string_lossy();
    let device = part.split('.').next().unwrap_or_default().to_uppercase();
    let numbered_device = device
        .strip_prefix("COM")
        .or_else(|| device.strip_prefix("LPT"))
        .is_some_and(|suffix| {
            matches!(
                suffix,
                "1" | "2"
                    | "3"
                    | "4"
                    | "5"
                    | "6"
                    | "7"
                    | "8"
                    | "9"
                    | "\u{00b9}"
                    | "\u{00b2}"
                    | "\u{00b3}"
            )
        });
    part.eq_ignore_ascii_case(".git")
        || part.ends_with(['.', ' '])
        || part.chars().any(|character| {
            character < ' ' || matches!(character, ':' | '<' | '>' | '"' | '|' | '?' | '*')
        })
        || matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || numbered_device
}

#[cfg(windows)]
pub(super) fn validate_windows_resolved_path(root: &Path, path: &Path) -> Result<(), AppError> {
    let resolved = fs::canonicalize(path)
        .map_err(|_| refused("The selected file path could not be resolved safely."))?;
    let relative = resolved
        .strip_prefix(root)
        .map_err(|_| refused("The selected file is outside this repository."))?;
    if relative
        .components()
        .any(|part| unsafe_windows_component(part.as_os_str()))
    {
        return Err(refused(
            "The resolved path is not a regular Windows file name outside Git metadata.",
        ));
    }
    Ok(())
}

pub(super) fn is_link_or_reparse_point(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn check_nested_repository(directory: &Path) -> Result<(), AppError> {
    match fs::symlink_metadata(directory.join(".git")) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Ok(_) => Err(refused(
            "File operations cannot cross symbolic links or nested repository boundaries.",
        )),
        Err(_) => Err(refused(
            "The file's parent directory could not be checked safely.",
        )),
    }
}

fn parent_directory(path: &Path, file: &str) -> Result<PathBuf, AppError> {
    let relative = validate_file_name(file)?;
    let root =
        fs::canonicalize(path).map_err(|_| refused("The repository directory is unavailable."))?;
    let mut parent = root.clone();
    for part in relative.parent().unwrap_or(Path::new("")).components() {
        parent.push(part.as_os_str());
        let metadata = fs::symlink_metadata(&parent)
            .map_err(|_| refused("The file's parent directory is no longer available."))?;
        if is_link_or_reparse_point(&metadata) || !metadata.is_dir() {
            return Err(refused(
                "File operations cannot cross symbolic links or nested repository boundaries.",
            ));
        }
        check_nested_repository(&parent)?;
    }
    if !parent.starts_with(&root) {
        return Err(refused("The selected file is outside this repository."));
    }
    Ok(parent)
}

#[cfg(windows)]
pub(super) fn locked_windows_parent_if_present(
    root: &Path,
    file: &Path,
) -> Result<(Option<PathBuf>, Vec<fs::File>), AppError> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

    let root =
        fs::canonicalize(root).map_err(|_| refused("The repository directory is unavailable."))?;
    let mut guards = Vec::new();
    let mut hold = |directory: &Path| -> Result<bool, AppError> {
        let handle = match OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(directory)
        {
            Ok(handle) => handle,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(_) => {
                return Err(refused(
                    "The file's parent directory could not be opened safely.",
                ));
            }
        };
        let metadata = handle
            .metadata()
            .map_err(|_| refused("The file's parent directory could not be checked safely."))?;
        if !metadata.is_dir() || is_link_or_reparse_point(&metadata) {
            return Err(refused(
                "File operations cannot cross symbolic links or nested repository boundaries.",
            ));
        }
        guards.push(handle);
        Ok(true)
    };
    let mut parent = PathBuf::new();
    for part in root.components() {
        parent.push(part.as_os_str());
        if matches!(part, Component::RootDir | Component::Normal(_)) && !hold(&parent)? {
            return Err(refused("The repository directory is no longer available."));
        }
    }
    for part in file.parent().unwrap_or(Path::new("")).components() {
        if !matches!(part, Component::Normal(_)) {
            return Err(refused("The file's parent directory is not safe."));
        }
        parent.push(part.as_os_str());
        if !hold(&parent)? {
            return Ok((None, guards));
        }
        // A short Windows name can resolve to .git without spelling it.
        validate_windows_resolved_path(&root, &parent)?;
        check_nested_repository(&parent)?;
    }
    Ok((Some(parent), guards))
}

#[cfg(windows)]
fn locked_windows_parent(root: &Path, file: &Path) -> Result<(PathBuf, Vec<fs::File>), AppError> {
    let (parent, guards) = locked_windows_parent_if_present(root, file)?;
    let parent =
        parent.ok_or_else(|| refused("The file's parent directory is no longer available."))?;
    Ok((parent, guards))
}

#[cfg(windows)]
fn locked_windows_creation_directory(directory: &Path) -> Result<fs::File, AppError> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

    let handle = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(directory)
        .map_err(|_| refused("The worktree directory could not be protected safely."))?;
    let metadata = handle
        .metadata()
        .map_err(|_| refused("The worktree directory could not be checked safely."))?;
    if !metadata.is_dir() || is_link_or_reparse_point(&metadata) {
        return Err(refused(
            "The worktree path cannot contain symbolic links or reparse points.",
        ));
    }
    Ok(handle)
}

#[cfg(windows)]
fn windows_creation_identity(file: &fs::File) -> Result<(u64, [u8; 16]), AppError> {
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle;

    #[repr(C)]
    struct FileIdInfo {
        volume_serial_number: u64,
        file_id: [u8; 16],
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetFileInformationByHandleEx(
            file: *mut c_void,
            class: i32,
            info: *mut c_void,
            size: u32,
        ) -> i32;
    }

    const FILE_ID_INFO: i32 = 18;
    let mut info = FileIdInfo {
        volume_serial_number: 0,
        file_id: [0; 16],
    };
    // SAFETY: `file` owns a live handle and `info` is a writable FILE_ID_INFO buffer.
    let ok = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FILE_ID_INFO,
            std::ptr::from_mut(&mut info).cast(),
            std::mem::size_of::<FileIdInfo>() as u32,
        )
    };
    if ok == 0 || info.volume_serial_number == 0 || info.file_id == [0; 16] {
        return Err(AppError::new(
            "repositoryFileRefused",
            "The filesystem could not provide a stable worktree directory identity.",
            Some("Create the file outside the application, then refresh the repository."),
        ));
    }
    Ok((info.volume_serial_number, info.file_id))
}

#[cfg(windows)]
fn locked_windows_creation_root(root: &Path) -> Result<Vec<fs::File>, AppError> {
    if !root.is_absolute()
        || root
            .components()
            .any(|part| matches!(part, Component::CurDir | Component::ParentDir))
    {
        return Err(refused(
            "The selected worktree root is not an absolute path.",
        ));
    }

    let mut directory = PathBuf::new();
    let mut guards = Vec::new();
    for part in root.components() {
        directory.push(part.as_os_str());
        if !matches!(part, Component::RootDir | Component::Normal(_)) {
            continue;
        }
        guards.push(locked_windows_creation_directory(&directory)?);
    }
    Ok(guards)
}

#[cfg(windows)]
fn locked_windows_git_marker(root: &Path) -> Result<fs::File, AppError> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

    let handle = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(root.join(".git"))
        .map_err(|_| refused("The working tree's Git marker could not be protected safely."))?;
    let metadata = handle
        .metadata()
        .map_err(|_| refused("The working tree's Git marker could not be checked safely."))?;
    if is_link_or_reparse_point(&metadata) || !(metadata.is_dir() || metadata.is_file()) {
        return Err(refused("The working tree's Git marker is not safe."));
    }
    Ok(handle)
}

#[cfg(windows)]
fn create_no_follow_windows(
    root: &Path,
    file: &Path,
    before_guard: impl FnOnce(),
    before_open: impl FnOnce(),
) -> Result<(), AppError> {
    // Directory share guards do not prevent another process from adding `.git`.
    if file
        .parent()
        .is_some_and(|parent| !parent.as_os_str().is_empty())
    {
        return Err(AppError::new(
            "repositoryFileRefused",
            "Creating files in subdirectories is unavailable because a nested repository could appear during creation.",
            Some("Create the file outside the application, then refresh the repository."),
        ));
    }

    if !root.is_absolute()
        || root
            .components()
            .any(|part| matches!(part, Component::CurDir | Component::ParentDir))
    {
        return Err(refused(
            "The selected worktree root is not an absolute path.",
        ));
    }
    let initial_root = locked_windows_creation_directory(root)?;
    before_guard();
    let _guards = locked_windows_creation_root(root)?;
    let guarded_root = _guards
        .last()
        .ok_or_else(|| refused("The worktree directory could not be protected safely."))?;
    if windows_creation_identity(&initial_root)? != windows_creation_identity(guarded_root)? {
        return Err(refused(
            "The selected worktree root changed during creation.",
        ));
    }
    let _git_marker = locked_windows_git_marker(root)?;
    file_content::worktree_root(root)
        .map_err(|_| refused("Files can be created only at the selected working tree root."))?;
    let name = file
        .file_name()
        .ok_or_else(|| refused("Choose a file name."))?;
    before_open();
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(root.join(name))
        .map(|_| ())
        .map_err(|_| refused("The file could not be created; it may already exist or its parent may have changed."))
}

fn read_file_record(reader: &mut impl BufRead, record: &mut Vec<u8>) -> Result<bool, AppError> {
    record.clear();
    loop {
        let buffer = reader.fill_buf().map_err(|error| {
            AppError::new(
                "gitOutputFailed",
                format!("Could not read the repository file list: {error}"),
                Some("Refresh the file list and try again."),
            )
        })?;
        if buffer.is_empty() {
            return if record.is_empty() {
                Ok(false)
            } else {
                Err(refused("Git returned an incomplete repository file list."))
            };
        }
        let end = buffer.iter().position(|byte| *byte == 0);
        let length = end.unwrap_or(buffer.len());
        if record.len() + length > MAX_FILE_PATH_BYTES + 2 {
            return Err(refused(
                "The repository contains a file path too long to display safely.",
            ));
        }
        record.extend_from_slice(&buffer[..length]);
        reader.consume(length + usize::from(end.is_some()));
        if end.is_some() {
            return Ok(true);
        }
    }
}

fn visit_git_file_records(
    path: &Path,
    args: &[&str],
    mut visit: impl FnMut(&str) -> Result<(), AppError>,
) -> Result<(), AppError> {
    let mut command = git_in(path);
    command
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_tree(&mut command);
    let mut child = command.spawn().map_err(|error| {
        AppError::new(
            "gitUnavailable",
            format!("Could not start Git: {error}"),
            Some("Install Git and ensure it is available on PATH."),
        )
    })?;
    let stdout = child.stdout.take().expect("piped Git stdout");
    let mut stderr = child.stderr.take().expect("piped Git stderr");
    let stderr_reader = thread::spawn(move || -> std::io::Result<Vec<u8>> {
        let mut captured = Vec::new();
        let mut buffer = [0; 8192];
        loop {
            let count = stderr.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            let retained = count.min(MAX_GIT_ERROR_BYTES.saturating_sub(captured.len()));
            captured.extend_from_slice(&buffer[..retained]);
        }
        Ok(captured)
    });
    let mut reader = BufReader::new(stdout);
    let result = (|| {
        let mut record = Vec::new();
        while read_file_record(&mut reader, &mut record)? {
            let file = std::str::from_utf8(&record).map_err(|_| {
                AppError::new(
                    "unsupportedFilePath",
                    "The repository contains a file path that is not valid UTF-8.",
                    Some("The file browser cannot display a complete list for this repository."),
                )
            })?;
            visit(file)?;
        }
        Ok(())
    })();
    drop(reader);
    if result.is_err() {
        terminate_process_tree(&mut child);
    }
    let status = child.wait().map_err(|error| {
        AppError::new(
            "gitOutputFailed",
            format!("Could not finish reading the repository file list: {error}"),
            Some("Refresh the file list and try again."),
        )
    })?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| refused("Could not read Git's error output."))?
        .map_err(|error| {
            AppError::new(
                "gitOutputFailed",
                format!("Could not read Git's error output: {error}"),
                Some("Refresh the file list and try again."),
            )
        })?;
    result?;
    ensure_success(
        "list repository files",
        &Output {
            status,
            stdout: Vec::new(),
            stderr,
        },
    )
}

pub fn repository_files(
    path: &Path,
    query: &str,
    cursor: Option<&str>,
) -> Result<RepositoryFiles, AppError> {
    if query.len() > MAX_FILE_PATH_BYTES || query.contains('\0') {
        return Err(refused(
            "The repository file filter is too long or invalid.",
        ));
    }
    if let Some(cursor) = cursor {
        validate_file_name(cursor)?;
    }
    let query = query.trim().to_lowercase();
    let head = run_git(path, &["rev-parse", "--verify", "--quiet", "HEAD"])?;
    let has_head = head.status.success();
    if !has_head && head.status.code() != Some(1) {
        ensure_success("inspect the repository HEAD", &head)?;
    }
    let mut entries = BTreeMap::<String, RepositoryFile>::new();
    let mut incomplete = false;
    for (args, is_tracked, is_ignored) in [
        (&["ls-files", "-z", "-v", "--cached"][..], true, false),
        (
            &["ls-files", "-z", "--others", "--exclude-standard"][..],
            false,
            false,
        ),
        (
            &[
                "ls-files",
                "-z",
                "--others",
                "--ignored",
                "--exclude-standard",
            ][..],
            false,
            true,
        ),
    ] {
        visit_git_file_records(path, args, |record| {
            let (file, index_permits_deletion) = if is_tracked {
                let bytes = record.as_bytes();
                if bytes.len() < 2 || bytes[1] != b' ' || !bytes[0].is_ascii() {
                    return Err(refused("Git returned an invalid repository file record."));
                }
                (&record[2..], bytes[0] == b'H')
            } else {
                (record, false)
            };
            if cursor.is_some_and(|cursor| file <= cursor)
                || (!query.is_empty() && !file.to_lowercase().contains(&query))
            {
                return Ok(());
            }
            if entries.len() > FILE_PAGE_SIZE
                && entries
                    .last_key_value()
                    .is_some_and(|(last, _)| file >= last.as_str())
            {
                return Ok(());
            }
            if validate_file_name(file).is_err() || parent_directory(path, file).is_err() {
                incomplete = true;
                return Ok(());
            }
            let metadata = match fs::symlink_metadata(path.join(file)) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                Err(_) => {
                    incomplete = true;
                    return Ok(());
                }
            };
            let kind = metadata.file_type();
            if !kind.is_file() && !is_link_or_reparse_point(&metadata) {
                return Ok(());
            }
            entries
                .entry(file.to_owned())
                .and_modify(|entry| {
                    if is_tracked {
                        entry.deletable &= index_permits_deletion;
                    }
                })
                .or_insert_with(|| RepositoryFile {
                    deletable: cfg!(windows)
                        && has_head
                        && is_tracked
                        && index_permits_deletion
                        && !is_link_or_reparse_point(&metadata),
                    path: file.to_owned(),
                    tracked: is_tracked,
                    ignored: is_ignored,
                    symbolic_link: is_link_or_reparse_point(&metadata),
                });
            if entries.len() > FILE_PAGE_SIZE + 1 {
                entries.pop_last();
            }
            Ok(())
        })?;
    }
    let has_more = entries.len() > FILE_PAGE_SIZE;
    if has_more {
        entries.pop_last();
    }
    let mut files = entries.into_values().collect::<Vec<_>>();
    if has_head && files.iter().any(|file| file.tracked && !file.symbolic_link) {
        let selected = files
            .iter()
            .filter(|file| file.tracked)
            .map(|file| file.path.as_str())
            .collect::<HashSet<_>>();
        let mut changed = HashSet::new();
        for args in [
            &[
                "diff",
                "--cached",
                "--name-only",
                "--no-renames",
                "-z",
                "HEAD",
                "--",
            ][..],
            &["diff", "--name-only", "--no-renames", "-z", "--"][..],
        ] {
            visit_git_file_records(path, args, |file| {
                if selected.contains(file) {
                    changed.insert(file.to_owned());
                }
                Ok(())
            })?;
        }
        for file in &mut files {
            file.deletable &= !changed.contains(&file.path);
        }
    }
    let next_cursor = if has_more {
        files.last().map(|file| file.path.clone())
    } else {
        None
    };
    Ok(RepositoryFiles {
        files,
        next_cursor,
        incomplete,
    })
}

pub fn create_repository_file(path: &Path, file: &str) -> Result<(), AppError> {
    create_repository_file_with(path, file, || {})
}

fn create_repository_file_with(
    path: &Path,
    file: &str,
    before_open: impl FnOnce(),
) -> Result<(), AppError> {
    create_repository_file_with_hooks(path, file, || {}, before_open)
}

fn create_repository_file_with_hooks(
    path: &Path,
    file: &str,
    before_guard: impl FnOnce(),
    before_open: impl FnOnce(),
) -> Result<(), AppError> {
    let relative = validate_file_name(file)?;
    #[cfg(windows)]
    {
        create_no_follow_windows(path, relative, before_guard, before_open)
    }
    #[cfg(not(windows))]
    {
        let _ = (path, relative, before_guard, before_open);
        // Unix directory descriptors do not prevent the selected root from moving.
        Err(AppError::new(
            "repositoryFileRefused",
            "Creating files is unavailable on this platform because the selected worktree directory cannot be protected against concurrent replacement.",
            Some("Create the file outside the application, then refresh the repository."),
        ))
    }
}

pub fn with_repository_regular_file<T>(
    path: &Path,
    file: &str,
    action: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    let relative = validate_file_name(file)?;
    #[cfg(not(windows))]
    let parent = parent_directory(path, file)?;
    #[cfg(windows)]
    let (parent, _guards) = locked_windows_parent(path, relative)?;
    let name = relative
        .file_name()
        .ok_or_else(|| refused("Choose a file name."))?;
    let metadata = fs::symlink_metadata(parent.join(name))
        .map_err(|_| refused("The selected file no longer exists."))?;
    if !metadata.file_type().is_file() || is_link_or_reparse_point(&metadata) {
        return Err(refused(
            "Only regular files outside symbolic links and reparse points can be deleted.",
        ));
    }
    #[cfg(windows)]
    validate_windows_resolved_path(
        &fs::canonicalize(path).map_err(|_| refused("The repository directory is unavailable."))?,
        &parent.join(name),
    )?;
    action()
}

pub fn delete_repository_file(path: &Path, file: &str) -> Result<(), AppError> {
    #[cfg(windows)]
    {
        delete_repository_file_with(path, file, |path, git_file| {
            let removed = run_git(path, &["--literal-pathspecs", "rm", "--", git_file])?;
            ensure_success("stage deletion of the file", &removed)
        })
    }
    #[cfg(not(windows))]
    {
        let _ = (path, file);
        Err(refused(
            "Staged deletion of tracked files is unavailable on this platform because Git's pathname-based removal cannot safely prevent concurrent parent-directory replacement.",
        ))
    }
}

#[cfg(any(windows, test))]
fn delete_repository_file_with(
    path: &Path,
    file: &str,
    delete: impl FnOnce(&Path, &str) -> Result<(), AppError>,
) -> Result<(), AppError> {
    let relative = validate_file_name(file)?;
    #[cfg(not(windows))]
    let parent = parent_directory(path, file)?;
    #[cfg(windows)]
    let (parent, _guards) = locked_windows_parent(path, relative)?;
    let target = parent.join(
        relative
            .file_name()
            .ok_or_else(|| refused("Choose a file name."))?,
    );
    #[cfg(windows)]
    let git_file = file.replace('\\', "/");
    #[cfg(not(windows))]
    let git_file = file.to_owned();
    let metadata = fs::symlink_metadata(&target)
        .map_err(|_| refused("The selected file no longer exists."))?;
    if !metadata.file_type().is_file() || is_link_or_reparse_point(&metadata) {
        return Err(refused(
            "Only regular files outside symbolic links and reparse points can be deleted.",
        ));
    }
    #[cfg(windows)]
    validate_windows_resolved_path(
        &fs::canonicalize(path).map_err(|_| refused("The repository directory is unavailable."))?,
        &target,
    )?;

    let indexed = run_git(
        path,
        &[
            "--literal-pathspecs",
            "ls-files",
            "-v",
            "--error-unmatch",
            "-z",
            "--",
            &git_file,
        ],
    )?;
    ensure_success("verify the tracked file before deletion", &indexed)?;
    let expected = format!("H {git_file}");
    let mut records = indexed
        .stdout
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty());
    if records.next() != Some(expected.as_bytes()) || records.next().is_some() {
        return Err(refused(
            "This file is unmerged or has Git index flags that can hide local changes. Review its index state before deleting it.",
        ));
    }

    for args in [
        &[
            "--literal-pathspecs",
            "diff",
            "--quiet",
            "--cached",
            "HEAD",
            "--",
            &git_file,
        ][..],
        &["--literal-pathspecs", "diff", "--quiet", "--", &git_file][..],
    ] {
        let diff = run_git_allow_diff_exit(path, args)?;
        if diff.status.code() == Some(1) {
            return Err(refused(
                "This file has local changes or is not committed. Save or discard those changes before deleting it.",
            ));
        }
    }

    parent_directory(path, file)?;
    delete(path, &git_file).map_err(|error| {
        let mut hint =
            "The file or index may already have changed. Refresh the repository and inspect both before retrying."
                .to_owned();
        if let Some(detail) = error.hint {
            hint.push(' ');
            hint.push_str(&detail);
        }
        AppError {
            kind: "repositoryFileDeletionUncertain".into(),
            message: format!("Could not confirm file deletion: {}", error.message),
            hint: Some(hint),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_ID: AtomicU64 = AtomicU64::new(0);

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "git-khronos-files-{}-{}",
                std::process::id(),
                NEXT_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            let fixture = Self(path);
            fixture.git(&["init", "-b", "main"]);
            fixture.git(&["config", "user.name", "File Browser Test"]);
            fixture.git(&["config", "user.email", "files@example.invalid"]);
            fixture
        }

        fn git(&self, args: &[&str]) {
            let output = Command::new("git")
                .arg("-C")
                .arg(&self.0)
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }

        fn commit(&self, file: &str, content: &[u8]) {
            let target = self.0.join(file);
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::write(target, content).unwrap();
            self.git(&["add", "--", file]);
            self.git(&["commit", "-m", "baseline"]);
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn repository_file_list_contains_tracked_untracked_and_ignored_files() {
        let fixture = Fixture::new();
        fixture.commit("tracked.txt", b"tracked");
        fs::write(fixture.0.join("new.txt"), b"new").unwrap();
        fs::create_dir_all(fixture.0.join("ignored")).unwrap();
        fs::write(fixture.0.join(".gitignore"), b"ignored/\n").unwrap();
        fs::write(fixture.0.join("ignored/secret.txt"), b"secret").unwrap();

        let listed = repository_files(&fixture.0, "", None).unwrap();
        assert!(listed.files.iter().any(|entry| entry.path == "tracked.txt"
            && entry.tracked
            && entry.deletable == cfg!(windows)));
        assert!(listed.files.iter().any(|entry| entry.path == "new.txt"
            && !entry.tracked
            && !entry.ignored
            && !entry.deletable));
        assert!(
            listed
                .files
                .iter()
                .any(|entry| entry.path == "ignored/secret.txt"
                    && entry.ignored
                    && !entry.deletable)
        );
        assert!(
            !listed
                .files
                .iter()
                .any(|entry| entry.path.starts_with(".git/"))
        );
    }

    #[test]
    fn file_creation_refuses_unsafe_paths_and_never_overwrites() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.0.join("folder")).unwrap();

        #[cfg(windows)]
        {
            create_repository_file(&fixture.0, "new.txt").unwrap();
            assert_eq!(fs::read(fixture.0.join("new.txt")).unwrap(), b"");
            assert!(create_repository_file(&fixture.0, "new.txt").is_err());
        }
        #[cfg(not(windows))]
        {
            let error = create_repository_file(&fixture.0, "new.txt").unwrap_err();
            assert_eq!(error.kind, "repositoryFileRefused");
            assert!(error.message.contains("unavailable on this platform"));
            assert!(error.hint.unwrap().contains("outside the application"));
            assert!(!fixture.0.join("new.txt").exists());
        }

        fs::write(fixture.0.join("existing.txt"), b"keep").unwrap();
        assert!(create_repository_file(&fixture.0, "existing.txt").is_err());
        assert_eq!(fs::read(fixture.0.join("existing.txt")).unwrap(), b"keep");
        assert!(create_repository_file(&fixture.0, "folder/new.txt").is_err());
        assert!(!fixture.0.join("folder/new.txt").exists());
        #[cfg(unix)]
        assert!(validate_file_name("folder/ name.txt ").is_ok());
        assert!(create_repository_file(&fixture.0, "../outside.txt").is_err());
        assert!(create_repository_file(&fixture.0, ".git/config").is_err());
        assert!(create_repository_file(&fixture.0, "missing/new.txt").is_err());
    }

    #[test]
    fn file_creation_requires_the_selected_worktree_root() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.0.join("folder")).unwrap();

        assert!(create_repository_file(&fixture.0.join("folder"), "new.txt").is_err());
        assert!(!fixture.0.join("folder/new.txt").exists());
    }

    #[test]
    fn file_creation_refuses_a_git_metadata_directory_as_root() {
        let fixture = Fixture::new();

        assert!(create_repository_file(&fixture.0.join(".git"), "new.txt").is_err());
        assert!(!fixture.0.join(".git/new.txt").exists());
    }

    #[test]
    fn file_creation_refuses_a_bare_repository_root() {
        let fixture = Fixture::new();
        fixture.git(&["init", "--bare", "bare.git"]);

        assert!(create_repository_file(&fixture.0.join("bare.git"), "new.txt").is_err());
        assert!(!fixture.0.join("bare.git/new.txt").exists());
    }

    #[test]
    fn file_operations_refuse_nested_repositories_and_unsafe_components() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.0.join("nested")).unwrap();
        fs::create_dir(fixture.0.join("nested/.git")).unwrap();
        for path in [
            "nested/new.txt",
            "nested/../outside.txt",
            "nested/./new.txt",
            "nested//new.txt",
            "/absolute.txt",
        ] {
            assert!(
                create_repository_file(&fixture.0, path).is_err(),
                "{path:?}"
            );
            assert!(
                delete_repository_file(&fixture.0, path).is_err(),
                "{path:?}"
            );
        }
        assert!(!fixture.0.join("nested/new.txt").exists());
    }

    #[cfg(windows)]
    #[test]
    fn deleting_a_clean_committed_file_stages_removal_and_refuses_local_edits() {
        let fixture = Fixture::new();
        fixture.commit("literala.txt", b"unrelated");
        fixture.commit("literal[a].txt", b"baseline");
        delete_repository_file(&fixture.0, "literal[a].txt").unwrap();
        assert!(!fixture.0.join("literal[a].txt").exists());
        assert_eq!(
            fs::read(fixture.0.join("literala.txt")).unwrap(),
            b"unrelated"
        );
        let status = run_git(&fixture.0, &["status", "--porcelain"]).unwrap();
        assert_eq!(
            String::from_utf8_lossy(&status.stdout),
            "D  literal[a].txt\n"
        );

        fixture.commit("edited.txt", b"baseline");
        fs::write(fixture.0.join("edited.txt"), b"local edit").unwrap();
        let listed = repository_files(&fixture.0, "", None).unwrap();
        assert!(
            listed
                .files
                .iter()
                .any(|entry| entry.path == "edited.txt" && !entry.deletable)
        );
        assert!(delete_repository_file(&fixture.0, "edited.txt").is_err());
        assert_eq!(
            fs::read(fixture.0.join("edited.txt")).unwrap(),
            b"local edit"
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn tracked_deletion_is_disabled_where_git_cannot_bind_unlink_to_the_reviewed_path() {
        #[cfg(unix)]
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new();
        fixture.commit("folder/tracked.txt", b"reviewed");
        let listed = repository_files(&fixture.0, "", None).unwrap();
        assert!(listed.files.iter().any(|entry| {
            entry.path == "folder/tracked.txt" && entry.tracked && !entry.deletable
        }));

        let outside = fixture.0.with_file_name(format!(
            "{}-outside",
            fixture.0.file_name().unwrap().to_string_lossy()
        ));
        fs::rename(fixture.0.join("folder"), &outside).unwrap();
        #[cfg(unix)]
        symlink(&outside, fixture.0.join("folder")).unwrap();
        let index = fs::read(fixture.0.join(".git/index")).unwrap();

        let error = delete_repository_file(&fixture.0, "folder/tracked.txt").unwrap_err();
        assert_eq!(error.kind, "repositoryFileRefused");
        assert_eq!(fs::read(outside.join("tracked.txt")).unwrap(), b"reviewed");
        assert_eq!(fs::read(fixture.0.join(".git/index")).unwrap(), index);
        fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn deletion_preserves_local_edits_hidden_by_git_index_flags() {
        let fixture = Fixture::new();
        for (file, flag) in [
            ("assumed.txt", "--assume-unchanged"),
            ("skipped.txt", "--skip-worktree"),
        ] {
            fixture.commit(file, b"baseline");
            fixture.git(&["update-index", flag, "--", file]);
            fs::write(fixture.0.join(file), b"hidden local edit").unwrap();
            let listed = repository_files(&fixture.0, "", None).unwrap();
            assert!(
                listed
                    .files
                    .iter()
                    .any(|entry| entry.path == file && !entry.deletable),
                "{flag}"
            );
            assert!(delete_repository_file(&fixture.0, file).is_err(), "{flag}");
            assert_eq!(
                fs::read(fixture.0.join(file)).unwrap(),
                b"hidden local edit"
            );
        }
    }

    #[test]
    fn deletion_preserves_staged_contents_when_the_worktree_matches_head() {
        let fixture = Fixture::new();
        fixture.commit("staged.txt", b"baseline");
        fs::write(fixture.0.join("staged.txt"), b"staged change").unwrap();
        fixture.git(&["add", "--", "staged.txt"]);
        fs::write(fixture.0.join("staged.txt"), b"baseline").unwrap();

        let error = delete_repository_file(&fixture.0, "staged.txt").unwrap_err();
        assert_eq!(error.kind, "repositoryFileRefused");
        assert_eq!(fs::read(fixture.0.join("staged.txt")).unwrap(), b"baseline");
        let index = run_git(&fixture.0, &["show", ":staged.txt"]).unwrap();
        assert_eq!(index.stdout, b"staged change");
    }

    #[cfg(windows)]
    #[test]
    fn deletion_reports_git_failures_without_changing_the_file_or_index() {
        let fixture = Fixture::new();
        fixture.commit("tracked.txt", b"baseline");
        let index = fixture.0.join(".git/index");
        let before = fs::read(&index).unwrap();
        fixture.git(&["update-ref", "-d", "refs/heads/main"]);

        let error = delete_repository_file(&fixture.0, "tracked.txt").unwrap_err();
        assert_eq!(error.kind, "gitFailure");
        assert_eq!(
            fs::read(fixture.0.join("tracked.txt")).unwrap(),
            b"baseline"
        );
        assert_eq!(fs::read(index).unwrap(), before);
    }

    #[test]
    fn deletion_reports_uncertain_outcomes_after_file_or_index_changes() {
        for publish_index in [false, true] {
            let fixture = Fixture::new();
            fixture.commit("tracked.txt", b"baseline");
            let index = fixture.0.join(".git/index");
            let before = fs::read(&index).unwrap();

            let error = delete_repository_file_with(&fixture.0, "tracked.txt", |path, file| {
                if publish_index {
                    let output = run_git(path, &["--literal-pathspecs", "rm", "--", file])?;
                    ensure_success("stage deletion of the file", &output)?;
                } else {
                    fs::remove_file(path.join(file)).unwrap();
                }
                Err(AppError::new(
                    "gitWaitFailed",
                    "The Git reply was lost.",
                    Some("Original diagnostic."),
                ))
            })
            .unwrap_err();

            assert_eq!(error.kind, "repositoryFileDeletionUncertain");
            assert!(error.message.contains("The Git reply was lost."));
            let hint = error.hint.unwrap();
            assert!(hint.contains("file or index may already have changed"));
            assert!(hint.contains("Original diagnostic."));
            assert!(!fixture.0.join("tracked.txt").exists());
            if publish_index {
                let indexed = run_git(
                    &fixture.0,
                    &["ls-files", "--error-unmatch", "--", "tracked.txt"],
                )
                .unwrap();
                assert!(!indexed.status.success());
            } else {
                assert_eq!(fs::read(index).unwrap(), before);
            }
        }
    }

    #[cfg(windows)]
    #[test]
    fn deletion_preserves_a_foreign_index_lock_when_git_refuses() {
        let fixture = Fixture::new();
        fixture.commit("tracked.txt", b"baseline");
        let index = fixture.0.join(".git/index");
        let before = fs::read(&index).unwrap();
        let lock = fixture.0.join(".git/index.lock");
        fs::write(&lock, b"foreign lock").unwrap();

        let error = delete_repository_file(&fixture.0, "tracked.txt").unwrap_err();
        assert_eq!(error.kind, "repositoryFileDeletionUncertain");
        assert_eq!(
            fs::read(fixture.0.join("tracked.txt")).unwrap(),
            b"baseline"
        );
        assert_eq!(fs::read(index).unwrap(), before);
        assert_eq!(fs::read(lock).unwrap(), b"foreign lock");
    }

    #[cfg(unix)]
    #[test]
    fn file_operations_do_not_follow_symbolic_linked_directories() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new();
        let outside = std::env::temp_dir().join(format!(
            "git-khronos-files-outside-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, fixture.0.join("linked")).unwrap();
        assert!(create_repository_file(&fixture.0, "linked/new.txt").is_err());
        assert!(delete_repository_file(&fixture.0, "linked/new.txt").is_err());
        assert!(!outside.join("new.txt").exists());
        let _ = fs::remove_dir_all(outside);
    }

    #[cfg(unix)]
    #[test]
    fn file_operations_refuse_broken_nested_git_links_and_tracked_symlinks() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new();
        fs::create_dir(fixture.0.join("nested")).unwrap();
        symlink("missing", fixture.0.join("nested/.git")).unwrap();
        assert!(create_repository_file(&fixture.0, "nested/new.txt").is_err());
        assert!(!discard::safe_file(&fixture.0, "nested/new.txt"));
        assert!(!fixture.0.join("nested/new.txt").exists());

        symlink("missing-target", fixture.0.join("tracked-link")).unwrap();
        fixture.git(&["add", "--", "tracked-link"]);
        fixture.git(&["commit", "-m", "tracked symbolic link"]);
        assert!(delete_repository_file(&fixture.0, "tracked-link").is_err());
        let mut called = false;
        assert!(
            with_repository_regular_file(&fixture.0, "tracked-link", || {
                called = true;
                Ok(())
            })
            .is_err()
        );
        assert!(!called);
        assert!(
            fs::symlink_metadata(fixture.0.join("tracked-link"))
                .unwrap()
                .file_type()
                .is_symlink()
        );
    }

    #[cfg(unix)]
    #[test]
    fn file_creation_refuses_a_parent_swapped_for_a_symlink() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new();
        let outside = std::env::temp_dir().join(format!(
            "git-khronos-files-outside-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&outside).unwrap();
        fs::create_dir(fixture.0.join("folder")).unwrap();
        parent_directory(&fixture.0, "folder/new.txt").unwrap();
        fs::rename(fixture.0.join("folder"), fixture.0.join("original")).unwrap();
        symlink(&outside, fixture.0.join("folder")).unwrap();
        assert!(create_repository_file(&fixture.0, "folder/new.txt").is_err());
        assert!(!outside.join("new.txt").exists());
        fs::remove_dir(outside).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn file_creation_refuses_a_parent_moved_outside_during_resolution() {
        let fixture = Fixture::new();
        let outside = fixture.0.parent().unwrap().join(format!(
            "moved-file-parent-{}",
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(fixture.0.join("folder")).unwrap();

        let mut reached_open = false;
        assert!(
            create_repository_file_with(&fixture.0, "folder/new.txt", || {
                reached_open = true;
                fs::rename(fixture.0.join("folder"), &outside).unwrap();
            })
            .is_err()
        );
        assert!(!reached_open);
        assert!(!outside.join("new.txt").exists());
        assert!(!fixture.0.join("folder/new.txt").exists());
        if outside.exists() {
            fs::remove_dir_all(outside).unwrap();
        }
    }

    #[cfg(unix)]
    #[test]
    fn file_creation_refuses_an_unreviewed_nested_parent_replacement() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.0.join("folder")).unwrap();
        fs::create_dir_all(fixture.0.join("replacement/.git")).unwrap();

        let mut reached_open = false;
        let result = create_repository_file_with(&fixture.0, "folder/new.txt", || {
            reached_open = true;
            fs::rename(fixture.0.join("folder"), fixture.0.join("reviewed")).unwrap();
            fs::rename(fixture.0.join("replacement"), fixture.0.join("folder")).unwrap();
        });

        assert!(
            result.is_err(),
            "created in unreviewed nested repository: {}",
            fixture.0.join("folder/new.txt").exists()
        );
        assert!(!reached_open);
        assert!(!fixture.0.join("folder/new.txt").exists());
        assert!(!fixture.0.join("reviewed/new.txt").exists());
    }

    #[cfg(unix)]
    #[test]
    fn file_creation_refuses_a_new_nested_repository_after_validation() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.0.join("folder")).unwrap();

        let mut reached_open = false;
        let result = create_repository_file_with(&fixture.0, "folder/new.txt", || {
            reached_open = true;
            fs::create_dir(fixture.0.join("folder/.git")).unwrap();
        });

        assert!(
            result.is_err(),
            "created after parent became a nested repository: {}",
            fixture.0.join("folder/new.txt").exists()
        );
        assert!(!reached_open);
        assert!(!fixture.0.join("folder/new.txt").exists());
    }

    #[cfg(unix)]
    #[test]
    fn file_creation_refuses_a_moved_worktree_root() {
        let fixture = Fixture::new();
        let moved = fixture.0.with_file_name(format!(
            "{}-moved",
            fixture.0.file_name().unwrap().to_string_lossy()
        ));

        let mut reached_open = false;
        let result = create_repository_file_with(&fixture.0, "new.txt", || {
            reached_open = true;
            fs::rename(&fixture.0, &moved).unwrap();
            fs::create_dir(&fixture.0).unwrap();
        });
        let created_in_moved_root = moved.join("new.txt").exists();
        let created_in_replacement = fixture.0.join("new.txt").exists();
        if moved.exists() {
            fs::remove_dir_all(&moved).unwrap();
        }

        assert!(
            result.is_err(),
            "created in the moved worktree root: {created_in_moved_root}"
        );
        assert!(!reached_open);
        assert!(!created_in_moved_root);
        assert!(!created_in_replacement);
    }

    #[test]
    fn file_pages_are_sorted_filtered_and_include_each_file_once() {
        let fixture = Fixture::new();
        fixture.commit("tracked.txt", b"tracked");
        fs::write(fixture.0.join(".gitignore"), b"ignored-*\n").unwrap();
        for index in 0..410 {
            fs::write(fixture.0.join(format!("untracked-{index:04}.txt")), b"").unwrap();
        }
        fs::write(fixture.0.join("ignored-last.txt"), b"ignored").unwrap();

        let mut cursor = None;
        let mut paths = Vec::new();
        loop {
            let page = repository_files(&fixture.0, "", cursor.as_deref()).unwrap();
            assert!(page.files.len() <= FILE_PAGE_SIZE);
            assert!(!page.incomplete);
            paths.extend(page.files.into_iter().map(|file| file.path));
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(paths.len(), 413);
        assert!(paths.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(paths.contains(&"tracked.txt".to_owned()));
        assert!(paths.contains(&"ignored-last.txt".to_owned()));

        let filtered = repository_files(&fixture.0, "IGNORED-LAST", None).unwrap();
        assert_eq!(filtered.files.len(), 1);
        assert!(filtered.files[0].ignored);
        assert!(filtered.next_cursor.is_none());
        assert!(
            repository_files(&fixture.0, "no-such-file", None)
                .unwrap()
                .files
                .is_empty()
        );
        assert!(repository_files(&fixture.0, "", Some("../invalid")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn file_search_reaches_paths_after_both_previous_limits() {
        let fixture = Fixture::new();
        let mut directory = fixture.0.clone();
        for index in 0..6 {
            directory.push(format!("{index}{}", "x".repeat(145)));
        }
        fs::create_dir_all(&directory).unwrap();
        for index in 0..5_010 {
            fs::write(directory.join(format!("file-{index:05}.txt")), b"").unwrap();
        }
        fs::write(directory.join("zz-last-match.txt"), b"").unwrap();

        let relative = directory
            .strip_prefix(&fixture.0)
            .unwrap()
            .to_str()
            .unwrap();
        assert!((relative.len() + "file-00000.txt".len() + 2) * 5_010 > 4_000_000);
        let match_page = repository_files(&fixture.0, "LAST-MATCH", None).unwrap();
        assert_eq!(match_page.files.len(), 1);
        assert!(match_page.files[0].path.ends_with("/zz-last-match.txt"));

        let mut cursor = None;
        let mut count = 0;
        let mut previous = String::new();
        loop {
            let page = repository_files(&fixture.0, "", cursor.as_deref()).unwrap();
            for file in page.files {
                assert!(previous < file.path);
                previous = file.path;
                count += 1;
            }
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(count, 5_011);
        assert!(previous.ends_with("/zz-last-match.txt"));
    }

    #[cfg(unix)]
    #[test]
    fn unsupported_paths_are_not_silently_reported_as_a_complete_listing() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;

        let fixture = Fixture::new();
        fs::write(fixture.0.join("line\nbreak.txt"), b"").unwrap();
        let page = repository_files(&fixture.0, "", None).unwrap();
        assert!(page.incomplete);
        assert!(page.files.is_empty());

        fs::write(
            fixture.0.join(OsString::from_vec(b"invalid-\xff".to_vec())),
            b"",
        )
        .unwrap();
        let error = match repository_files(&fixture.0, "", None) {
            Ok(_) => panic!("a non-UTF-8 path must not be silently omitted"),
            Err(error) => error,
        };
        assert_eq!(error.kind, "unsupportedFilePath");
    }

    #[cfg(windows)]
    #[test]
    fn windows_paths_check_backslash_parents_and_reparse_points() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.0.join("folder")).unwrap();
        fs::create_dir(fixture.0.join("folder/child")).unwrap();
        for path in [
            "folder\\new.txt",
            "folder/other.txt",
            "folder\\child/mixed.txt",
        ] {
            assert!(create_repository_file(&fixture.0, path).is_err());
        }
        assert!(!fixture.0.join("folder/new.txt").exists());
        assert!(!fixture.0.join("folder/other.txt").exists());
        assert!(!fixture.0.join("folder/child/mixed.txt").exists());
        fixture.commit("folder/tracked.txt", b"tracked");
        delete_repository_file(&fixture.0, "folder\\tracked.txt").unwrap();
        assert!(!fixture.0.join("folder/tracked.txt").exists());

        fs::create_dir(fixture.0.join("nested")).unwrap();
        fs::create_dir(fixture.0.join("nested/.git")).unwrap();
        for path in [
            "nested\\new.txt",
            "folder\\..\\outside.txt",
            "folder\\.GIT\\config",
            "folder\\.git.\\config",
            "folder\\.git \\config",
            "folder\\file.txt:stream",
            "folder\\CON.txt",
            "folder\\lpt1",
            "C:\\outside.txt",
            "\\\\server\\share\\outside.txt",
        ] {
            assert!(
                create_repository_file(&fixture.0, path).is_err(),
                "{path:?}"
            );
            assert!(
                delete_repository_file(&fixture.0, path).is_err(),
                "{path:?}"
            );
        }

        let outside = std::env::temp_dir().join(format!(
            "git-khronos-files-outside-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&outside).unwrap();
        let junction = fixture.0.join("junction");
        let output = Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&outside)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "junction creation failed: {output:?}"
        );
        assert!(create_repository_file(&fixture.0, "junction\\new.txt").is_err());
        assert!(create_repository_file(&fixture.0, "junction/new.txt").is_err());
        assert!(delete_repository_file(&fixture.0, "junction\\new.txt").is_err());
        assert!(!discard::safe_file(&fixture.0, "junction\\new.txt"));
        assert!(!outside.join("new.txt").exists());
        fs::remove_dir(junction).unwrap();
        fs::remove_dir(outside).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_creation_refuses_subdirectories_before_nested_repository_changes() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.0.join("folder")).unwrap();
        let mut reached_open = false;

        let error = create_repository_file_with(&fixture.0, "folder/new.txt", || {
            reached_open = true;
            fs::create_dir(fixture.0.join("folder/.git")).unwrap();
        })
        .unwrap_err();

        assert_eq!(error.kind, "repositoryFileRefused");
        assert!(error.message.contains("subdirectories is unavailable"));
        assert!(!reached_open);
        assert!(!fixture.0.join("folder/new.txt").exists());
    }

    #[cfg(windows)]
    #[test]
    fn windows_root_creation_pins_the_worktree_and_git_marker() {
        let fixture = Fixture::new();
        let moved = fixture.0.with_file_name(format!(
            "{}-moved",
            fixture.0.file_name().unwrap().to_string_lossy()
        ));

        create_repository_file_with(&fixture.0, "new.txt", || {
            assert!(fs::rename(&fixture.0, &moved).is_err());
            assert!(fs::rename(fixture.0.join(".git"), fixture.0.join("moved-git")).is_err());
        })
        .unwrap();

        assert_eq!(fs::read(fixture.0.join("new.txt")).unwrap(), b"");
        assert!(!moved.exists());
        assert!(!fixture.0.join("moved-git").exists());
    }

    #[cfg(windows)]
    #[test]
    fn windows_root_creation_pins_worktree_ancestors() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.0.join("container")).unwrap();
        fixture.git(&["init", "container/repository"]);
        let ancestor = fixture.0.join("container");
        let root = ancestor.join("repository");
        let moved = fixture.0.join("moved-container");

        create_repository_file_with(&root, "new.txt", || {
            assert!(fs::rename(&ancestor, &moved).is_err());
        })
        .unwrap();

        assert_eq!(fs::read(root.join("new.txt")).unwrap(), b"");
        assert!(!moved.exists());
    }

    #[cfg(windows)]
    #[test]
    fn windows_creation_refuses_a_replaced_worktree_while_locking_ancestors() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.0.join("original")).unwrap();
        fs::create_dir(fixture.0.join("replacement")).unwrap();
        fixture.git(&["init", "original/repository"]);
        fixture.git(&["init", "replacement/repository"]);
        let original_parent = fixture.0.join("original");
        let replacement_parent = fixture.0.join("replacement");
        let moved_parent = fixture.0.join("moved");
        let root = original_parent.join("repository");

        {
            let first = locked_windows_creation_directory(&root).unwrap();
            let same = locked_windows_creation_directory(&root).unwrap();
            let other =
                locked_windows_creation_directory(&replacement_parent.join("repository")).unwrap();
            assert_eq!(
                windows_creation_identity(&first).unwrap(),
                windows_creation_identity(&same).unwrap()
            );
            assert_ne!(
                windows_creation_identity(&first).unwrap(),
                windows_creation_identity(&other).unwrap()
            );
        }

        let mut replaced = false;
        let mut reached_open = false;
        let result = create_repository_file_with_hooks(
            &root,
            "new.txt",
            || {
                if fs::rename(&original_parent, &moved_parent).is_ok() {
                    fs::rename(&replacement_parent, &original_parent).unwrap();
                    replaced = true;
                }
            },
            || reached_open = true,
        );

        if replaced {
            let error = result.unwrap_err();
            assert!(error.message.contains("changed during creation"));
            assert!(!reached_open);
            assert!(!root.join("new.txt").exists());
            assert!(!moved_parent.join("repository/new.txt").exists());
        } else {
            result.unwrap();
            assert!(reached_open);
            assert_eq!(fs::read(root.join("new.txt")).unwrap(), b"");
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_root_creation_supports_linked_worktree_git_files() {
        let fixture = Fixture::new();
        fixture.commit("tracked.txt", b"tracked");
        fixture.git(&["worktree", "add", "--detach", "linked-worktree"]);
        let linked = fixture.0.join("linked-worktree");
        let marker = linked.join(".git");
        let original_marker = fs::read(&marker).unwrap();
        let writer = OpenOptions::new().write(true).open(&marker).unwrap();

        assert!(create_repository_file(&linked, "busy.txt").is_err());
        assert!(!linked.join("busy.txt").exists());
        drop(writer);

        create_repository_file_with(&linked, "new.txt", || {
            assert!(
                OpenOptions::new()
                    .write(true)
                    .truncate(true)
                    .open(&marker)
                    .is_err()
            );
        })
        .unwrap();

        assert_eq!(fs::read(linked.join("new.txt")).unwrap(), b"");
        assert_eq!(fs::read(marker).unwrap(), original_marker);
    }

    #[cfg(windows)]
    #[test]
    fn windows_creation_refuses_a_reparse_point_as_worktree_root() {
        use std::os::windows::fs::symlink_dir;

        let fixture = Fixture::new();
        let alias = fixture.0.with_file_name(format!(
            "{}-alias",
            fixture.0.file_name().unwrap().to_string_lossy()
        ));
        symlink_dir(&fixture.0, &alias)
            .expect("Windows path tests require permission to create directory symbolic links");

        assert!(create_repository_file(&alias, "new.txt").is_err());
        assert!(!fixture.0.join("new.txt").exists());
        fs::remove_dir(alias).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_parent_handles_prevent_replacement_and_refuse_directory_symlinks() {
        use std::os::windows::fs::{symlink_dir, symlink_file};

        let fixture = Fixture::new();
        let outside = std::env::temp_dir().join(format!(
            "git-khronos-files-outside-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&outside).unwrap();
        fs::create_dir(fixture.0.join("folder")).unwrap();
        let (_parent, guards) =
            locked_windows_parent(&fixture.0, Path::new("folder\\new.txt")).unwrap();
        assert!(fs::rename(fixture.0.join("folder"), fixture.0.join("renamed")).is_err());
        drop(guards);

        symlink_dir(&outside, fixture.0.join("linked"))
            .expect("Windows path tests require permission to create directory symbolic links");
        assert!(create_repository_file(&fixture.0, "linked\\new.txt").is_err());
        assert!(delete_repository_file(&fixture.0, "linked\\new.txt").is_err());
        assert!(!discard::safe_file(&fixture.0, "linked\\new.txt"));
        assert!(!outside.join("new.txt").exists());
        symlink_file(outside.join("missing.txt"), fixture.0.join("file-link"))
            .expect("Windows path tests require permission to create file symbolic links");
        assert!(with_repository_regular_file(&fixture.0, "file-link", || Ok(())).is_err());
        fs::remove_file(fixture.0.join("file-link")).unwrap();
        fs::remove_dir(fixture.0.join("linked")).unwrap();
        fs::remove_dir(outside).unwrap();
    }

    #[cfg(windows)]
    fn windows_short_path(path: &Path) -> PathBuf {
        use std::os::windows::ffi::{OsStrExt, OsStringExt};

        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn GetShortPathNameW(long_path: *const u16, short_path: *mut u16, length: u32) -> u32;
        }

        let input = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let mut output = vec![0_u16; 32_768];
        let length =
            unsafe { GetShortPathNameW(input.as_ptr(), output.as_mut_ptr(), output.len() as u32) }
                as usize;
        assert!(length > 0 && length < output.len());
        PathBuf::from(std::ffi::OsString::from_wide(&output[..length]))
    }

    #[cfg(windows)]
    #[test]
    fn windows_resolved_names_cannot_access_git_metadata_through_short_aliases() {
        let fixture = Fixture::new();
        fixture.commit("tracked.txt", b"tracked");
        let root = fs::canonicalize(&fixture.0).unwrap();
        let git_dir = fixture.0.join(".git");
        let config = fs::read(git_dir.join("config")).unwrap();
        assert!(validate_windows_resolved_path(&root, &git_dir).is_err());
        assert!(validate_windows_resolved_path(&root, &fixture.0.join("tracked.txt")).is_ok());

        let short_git = windows_short_path(&git_dir);
        let short_name = short_git.file_name().unwrap().to_string_lossy();
        if !short_name.eq_ignore_ascii_case(".git") {
            let relative = format!("{short_name}\\config");
            let mut called = false;
            assert!(
                with_repository_regular_file(&fixture.0, &relative, || {
                    called = true;
                    Ok(())
                })
                .is_err()
            );
            assert!(!called);
            assert!(create_repository_file(&fixture.0, &format!("{short_name}\\new")).is_err());
            assert!(delete_repository_file(&fixture.0, &relative).is_err());
            assert!(
                file_content::read_file_content(
                    &fixture.0,
                    &file_content::FileContentLocation::WorkingTree,
                    &relative,
                    &CancellationToken::default(),
                )
                .is_err()
            );
        } else {
            eprintln!("This filesystem did not provide a distinct short name for .git.");
        }
        assert_eq!(fs::read(git_dir.join("config")).unwrap(), config);
        assert!(!git_dir.join("new").exists());

        let worktree = fixture.0.join("owned-worktree");
        fixture.git(&["worktree", "add", "--detach", worktree.to_str().unwrap()]);
        let git_file = worktree.join(".git");
        let git_file_bytes = fs::read(&git_file).unwrap();
        let worktree_root = fs::canonicalize(&worktree).unwrap();
        assert!(validate_windows_resolved_path(&worktree_root, &git_file).is_err());
        let short_git_file = windows_short_path(&git_file);
        let short_name = short_git_file.file_name().unwrap().to_string_lossy();
        if !short_name.eq_ignore_ascii_case(".git") {
            assert!(
                file_content::read_file_content(
                    &worktree,
                    &file_content::FileContentLocation::WorkingTree,
                    &short_name,
                    &CancellationToken::default(),
                )
                .is_err()
            );
            assert!(with_repository_regular_file(&worktree, &short_name, || Ok(())).is_err());
        } else {
            eprintln!(
                "This filesystem did not provide a distinct short name for the worktree .git file."
            );
        }
        assert_eq!(fs::read(git_file).unwrap(), git_file_bytes);
    }
}
