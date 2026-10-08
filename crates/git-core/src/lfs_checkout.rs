use super::*;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LfsCheckoutPreview {
    pub file: String,
    pub oid: String,
    pub size: u64,
    pub state: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
struct HydrationIdentity {
    head: Vec<u8>,
    branch: Vec<u8>,
    index_hash: Vec<u8>,
}

pub fn preview_lfs_checkout(
    path: &Path,
    file: &str,
    oid: &str,
    size: u64,
) -> Result<LfsCheckoutPreview, AppError> {
    validate_relative_path(
        file,
        "unsafeLfsCheckout",
        "Select a literal repository-relative LFS file.",
    )?;
    if file.len() > 4096
        || file
            .split(['/', '\\'])
            .any(|part| part.eq_ignore_ascii_case(".git"))
        || oid.len() != 64
        || !oid
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || size == 0
        || size > 9_007_199_254_740_991
    {
        return Err(unsafe_checkout(
            "The path, SHA-256 object ID or nonempty size is unsupported.",
        ));
    }
    ensure_lfs_available(path)?;
    let identity = repository_identity(path)?;
    let pointer = pointer_bytes(oid, size);
    let target = path.join(file);
    ordinary_file(&target)?;
    let metadata = fs::symlink_metadata(&target).map_err(checkout_io)?;
    if metadata.len() != pointer.len() as u64 || bounded_read(&target, 1024)? != pointer {
        return Err(unsafe_checkout(
            "The working file is not the exact canonical pointer for this object. Modified, missing and already hydrated files are not replaced.",
        ));
    }
    let entries = bounded_git(
        path,
        &[
            "--literal-pathspecs",
            "ls-files",
            "--stage",
            "-z",
            "--",
            file,
        ],
        8192,
    )?;
    let records = entries
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .collect::<Vec<_>>();
    if records.len() != 1 {
        return Err(unsafe_checkout(
            "The path must have exactly one ordinary, unconflicted index entry.",
        ));
    }
    let record = std::str::from_utf8(records[0]).map_err(checkout_io)?;
    let (header, name) = record
        .split_once('\t')
        .ok_or_else(|| unsafe_checkout("Invalid index output."))?;
    let fields = header.split(' ').collect::<Vec<_>>();
    if name != file
        || fields.len() != 3
        || !matches!(fields[0], "100644" | "100755")
        || fields[2] != "0"
    {
        return Err(unsafe_checkout(
            "Only an ordinary stage-zero file can be hydrated.",
        ));
    }
    let target_text = target
        .to_str()
        .ok_or_else(|| unsafe_checkout("The working path is not UTF-8."))?;
    let working_blob = bounded_git(
        path,
        &["hash-object", "--no-filters", "--", target_text],
        128,
    )?;
    if working_blob != format!("{}\n", fields[1]).as_bytes() {
        return Err(unsafe_checkout(
            "The index pointer differs from the working pointer or inspected object. Review the staged changes first.",
        ));
    }
    let flags = bounded_git(
        path,
        &["--literal-pathspecs", "ls-files", "-v", "-z", "--", file],
        8192,
    )?;
    if flags != format!("H {file}\0").as_bytes() {
        return Err(unsafe_checkout(
            "Sparse-excluded and assume-unchanged entries cannot be hydrated here.",
        ));
    }
    let attributes = lfs_file_attributes(path, file)?;
    if attributes
        .attributes
        .iter()
        .find(|attribute| attribute.name == "filter")
        .is_none_or(|attribute| attribute.working != "lfs" || attribute.index != "lfs")
    {
        return Err(unsafe_checkout(
            "Both working and index views must assign filter=lfs to this file.",
        ));
    }
    let cache = local_object(path, oid)?;
    ordinary_file(&cache)?;
    if fs::symlink_metadata(&cache).map_err(checkout_io)?.len() != size {
        return Err(unsafe_checkout(
            "The local LFS object is missing or has the wrong size. Fetch it before hydration.",
        ));
    }
    if repository_identity(path)? != identity
        || bounded_read(&target, 1024)? != pointer
        || file_mode(&fs::symlink_metadata(&target).map_err(checkout_io)?) != file_mode(&metadata)
    {
        return Err(stale_checkout());
    }
    let state = serde_json::to_string(&(
        identity,
        entries,
        flags,
        file_mode(&metadata),
        attributes,
        cache,
        lfs_fetch::settings_fingerprint(path)?,
    ))
    .map_err(checkout_io)?;
    Ok(LfsCheckoutPreview {
        file: file.into(),
        oid: oid.into(),
        size,
        state,
    })
}

pub fn checkout_lfs_object(
    path: &Path,
    preview: &LfsCheckoutPreview,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    let current = preview_lfs_checkout(path, &preview.file, &preview.oid, preview.size)?;
    if current != *preview {
        return Err(stale_checkout());
    }
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    let identity = repository_identity(path)?;
    let target = path.join(&preview.file);
    let permissions = fs::symlink_metadata(&target)
        .map_err(checkout_io)?
        .permissions();
    let source = local_object(path, &preview.oid)?;
    let mut nonce = [0_u8; 16];
    getrandom::fill(&mut nonce).map_err(checkout_io)?;
    let suffix: String = nonce.iter().map(|byte| format!("{byte:02x}")).collect();
    let temporary = target
        .parent()
        .ok_or_else(|| unsafe_checkout("No ordinary parent directory."))?
        .join(format!(".chronos-lfs-{suffix}.tmp"));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut output = options.open(&temporary).map_err(checkout_io)?;
    let result = (|| -> Result<(), AppError> {
        let mut input = fs::File::open(source)
            .map_err(checkout_io)?
            .take(preview.size + 1);
        let mut buffer = [0_u8; 64 * 1024];
        let mut copied = 0_u64;
        loop {
            if cancellation.is_cancelled() {
                return Err(operation_cancelled());
            }
            let count = input.read(&mut buffer).map_err(checkout_io)?;
            if count == 0 {
                break;
            }
            copied += count as u64;
            if copied > preview.size {
                return Err(unsafe_checkout(
                    "The cached object changed size while being copied.",
                ));
            }
            output.write_all(&buffer[..count]).map_err(checkout_io)?;
        }
        if copied != preview.size {
            return Err(unsafe_checkout(
                "The cached object became incomplete while being copied.",
            ));
        }
        output.sync_all().map_err(checkout_io)?;
        let argument = format!(
            "--file={}",
            temporary
                .to_str()
                .ok_or_else(|| unsafe_checkout("The temporary path is not UTF-8."))?
        );
        let hash =
            run_git_with_cancellation(path, &["lfs", "pointer", &argument], Some(cancellation))?;
        ensure_success("verify copied LFS object before hydration", &hash)?;
        if hash.stdout != pointer_bytes(&preview.oid, preview.size) {
            return Err(AppError::new(
                "corruptLfsHydrationObject",
                "The copied local LFS object does not match the reviewed SHA-256 and size.",
                Some(
                    "The working pointer was not replaced. Verify or re-fetch the cached object with local Git LFS; no automatic cache deletion or repair was attempted.",
                ),
            ));
        }
        if preview_lfs_checkout(path, &preview.file, &preview.oid, preview.size)? != *preview {
            return Err(stale_checkout());
        }
        if cancellation.is_cancelled() {
            return Err(operation_cancelled());
        }
        output.set_permissions(permissions).map_err(checkout_io)?;
        output.sync_all().map_err(checkout_io)?;
        Ok(())
    })();
    drop(output);
    if let Err(error) = result {
        cleanup_temporary(&temporary)?;
        return Err(error);
    }
    if cancellation.is_cancelled() {
        cleanup_temporary(&temporary)?;
        return Err(operation_cancelled());
    }
    if let Err(error) = fs::rename(&temporary, &target) {
        cleanup_temporary(&temporary)?;
        return Err(checkout_io(error));
    }
    #[cfg(unix)]
    fs::File::open(target.parent().unwrap())
        .and_then(|directory| directory.sync_all())
        .map_err(|error| changed_checkout(error.to_string()))?;
    if repository_identity(path).map_err(|error| changed_checkout(error.message))? != identity {
        return Err(changed_checkout(
            "HEAD, branch or index changed during hydration.".into(),
        ));
    }
    Ok(())
}

fn pointer_bytes(oid: &str, size: u64) -> Vec<u8> {
    format!("version https://git-lfs.github.com/spec/v1\noid sha256:{oid}\nsize {size}\n")
        .into_bytes()
}

fn local_object(path: &Path, oid: &str) -> Result<PathBuf, AppError> {
    let environment = bounded_git(path, &["lfs", "env"], 256 * 1024)?;
    let text = std::str::from_utf8(&environment).map_err(checkout_io)?;
    let locations = text
        .lines()
        .filter_map(|line| line.strip_prefix("LocalMediaDir="))
        .collect::<Vec<_>>();
    if locations.len() != 1 || !Path::new(locations[0]).is_absolute() {
        return Err(unsafe_checkout(
            "Git LFS did not report one supported absolute local media directory.",
        ));
    }
    Ok(Path::new(locations[0])
        .join(&oid[..2])
        .join(&oid[2..4])
        .join(oid))
}

fn ordinary_file(path: &Path) -> Result<(), AppError> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component);
        let metadata = fs::symlink_metadata(&current).map_err(checkout_io)?;
        if metadata.file_type().is_symlink() || (current != path && !metadata.is_dir()) {
            return Err(unsafe_checkout(
                "Symlink paths and non-directory parents are not followed for hydration.",
            ));
        }
    }
    if !fs::symlink_metadata(path).map_err(checkout_io)?.is_file() {
        return Err(unsafe_checkout(
            "Hydration requires an existing ordinary working pointer and ordinary cached object.",
        ));
    }
    Ok(())
}

fn bounded_read(path: &Path, limit: u64) -> Result<Vec<u8>, AppError> {
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(checkout_io)?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(checkout_io)?;
    if bytes.len() as u64 > limit {
        return Err(unsafe_checkout(
            "Pointer output exceeds the safe review limit.",
        ));
    }
    Ok(bytes)
}

fn bounded_git(path: &Path, args: &[&str], limit: usize) -> Result<Vec<u8>, AppError> {
    let (output, truncated) = run_git_with_stdout_limit(path, args, limit)?;
    ensure_success("review LFS hydration state", &output)?;
    if truncated {
        return Err(unsafe_checkout(
            "Git output exceeds the safe hydration review limit.",
        ));
    }
    Ok(output.stdout)
}

fn repository_identity(path: &Path) -> Result<HydrationIdentity, AppError> {
    let head = run_git(path, &["rev-parse", "--verify", "--quiet", "HEAD"])?;
    if !head.status.success() && head.status.code() != Some(1) {
        ensure_success("review hydration HEAD", &head)?;
    }
    let branch = run_git(path, &["symbolic-ref", "--quiet", "HEAD"])?;
    if !branch.status.success() && branch.status.code() != Some(1) {
        ensure_success("review hydration branch", &branch)?;
    }
    let location = bounded_git(
        path,
        &["rev-parse", "--path-format=absolute", "--git-path", "index"],
        8192,
    )?;
    let index = std::str::from_utf8(&location)
        .map_err(checkout_io)?
        .trim_end_matches('\n');
    let hash = bounded_git(path, &["hash-object", "--no-filters", "--", index], 128)?;
    Ok(HydrationIdentity {
        head: head.stdout,
        branch: branch.stdout,
        index_hash: hash,
    })
}

fn file_mode(metadata: &fs::Metadata) -> u32 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode()
    }
    #[cfg(not(unix))]
    {
        u32::from(metadata.permissions().readonly())
    }
}

fn cleanup_temporary(path: &Path) -> Result<(), AppError> {
    fs::remove_file(path).map_err(|error| {
        AppError::new(
            "lfsHydrationCleanupFailed",
            format!("Hydration failed and its temporary file could not be removed: {error}"),
            Some(&format!(
                "Inspect {} before retrying. The working pointer was not replaced.",
                path.display()
            )),
        )
    })
}

fn unsafe_checkout(message: &str) -> AppError {
    AppError::new(
        "unsafeLfsCheckout",
        message,
        Some(
            "Inspect objects again. Only an existing canonical pointer matching an ordinary included index entry can be hydrated. No file replacement was attempted.",
        ),
    )
}
fn stale_checkout() -> AppError {
    AppError::new(
        "staleLfsCheckout",
        "The pointer, index, HEAD, branch, attributes, permissions or LFS settings changed after review.",
        Some("Inspect and review hydration again. The working pointer was not replaced."),
    )
}
fn checkout_io(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "lfsHydrationUnavailable",
        format!("Could not safely prepare local LFS hydration: {error}"),
        Some(
            "Check local object availability, file types, permissions and disk space. The working pointer was not replaced.",
        ),
    )
}
fn changed_checkout(message: String) -> AppError {
    AppError::new(
        "lfsHydrationPostcondition",
        message,
        Some(
            "The verified working contents have been replaced, but final checks failed. Refresh and inspect the file/index. No rollback was attempted.",
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checkout_preview_is_strict_camel_case_and_pointer_encoding_is_canonical() {
        let preview = LfsCheckoutPreview {
            file: "a [*],.bin".into(),
            oid: "a".repeat(64),
            size: 25,
            state: "lease".into(),
        };
        let value = serde_json::to_value(&preview).unwrap();
        assert_eq!(
            value,
            serde_json::json!({"file":"a [*],.bin","oid":"a".repeat(64),"size":25,"state":"lease"})
        );
        assert!(
            serde_json::from_value::<LfsCheckoutPreview>(serde_json::json!({"file":"a","oid":"a"}))
                .is_err()
        );
        let mut extra = value;
        extra["force"] = true.into();
        assert!(serde_json::from_value::<LfsCheckoutPreview>(extra).is_err());
        assert_eq!(
            pointer_bytes(&preview.oid, preview.size),
            format!(
                "version https://git-lfs.github.com/spec/v1\noid sha256:{}\nsize 25\n",
                preview.oid
            )
            .into_bytes()
        );
    }
}
