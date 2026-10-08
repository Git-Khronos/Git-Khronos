use super::*;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LfsFetchPreview {
    pub file: String,
    pub remote: String,
    pub head: String,
    pub oid: String,
    pub size: u64,
    pub settings: String,
}

pub fn preview_lfs_fetch(
    path: &Path,
    file: &str,
    remote: &str,
    expected_oid: &str,
    expected_size: u64,
) -> Result<LfsFetchPreview, AppError> {
    validate_fetch_file(file)?;
    validate_remote_name(path, remote)?;
    require_remote(path, remote)?;
    ensure_lfs_available(path)?;
    let output = run_git(path, &["rev-parse", "--verify", "HEAD^{commit}"])?;
    ensure_success("read committed HEAD for selective LFS fetch", &output)?;
    let head = String::from_utf8(output.stdout)
        .map_err(|_| stale_fetch())?
        .trim()
        .to_owned();
    let object = committed_object(path, &head, file)?;
    if object.oid != expected_oid || object.size != expected_size {
        return Err(AppError::new(
            "stagedLfsObjectNotFetchable",
            "The inspected LFS object does not match this path in committed HEAD.",
            Some(
                "Fetch here only downloads a reviewed committed object. Commit the intended pointer or use local Git LFS for staged-only objects.",
            ),
        ));
    }
    Ok(LfsFetchPreview {
        file: file.into(),
        remote: remote.into(),
        head,
        oid: object.oid,
        size: object.size,
        settings: settings_fingerprint(path)?,
    })
}

pub fn fetch_lfs_object(
    path: &Path,
    preview: &LfsFetchPreview,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    let current = preview_lfs_fetch(
        path,
        &preview.file,
        &preview.remote,
        &preview.oid,
        preview.size,
    )?;
    if current != *preview {
        return Err(stale_fetch());
    }
    let include = format!("--include=/{}", preview.file);
    let result = run_mutation_with_cancellation(
        path,
        &[
            "-c",
            "lfs.remote.autodetect=false",
            "-c",
            "lfs.remote.searchall=false",
            "-c",
            "lfs.fetchrecentalways=false",
            "-c",
            "lfs.fetchrecentrefsdays=0",
            "-c",
            "lfs.fetchrecentcommitsdays=0",
            "lfs",
            "fetch",
            &include,
            "--exclude=",
            "--",
            &preview.remote,
            &preview.head,
        ],
        "fetch the reviewed LFS object into local storage",
        Some(cancellation),
    );
    if let Err(mut error) = result {
        error.hint = Some(format!(
            "{} Downloaded or partial cache data may remain; no checkout, staging, pruning or Git reference update was requested. Check credentials, LFS endpoint and server object availability, then review and retry.",
            error
                .hint
                .as_deref()
                .unwrap_or("Inspect the transfer error.")
        ));
        return Err(error);
    }
    if !committed_object(path, &preview.head, &preview.file)?.downloaded {
        return Err(AppError::new(
            "lfsObjectUnavailableAfterFetch",
            "Git LFS finished but the reviewed object is not locally available by size.",
            Some(
                "No working file was hydrated. Inspect the configured cache and endpoint before retrying; cache availability is not hash verification.",
            ),
        ));
    }
    Ok(())
}

fn validate_fetch_file(file: &str) -> Result<(), AppError> {
    validate_relative_path(
        file,
        "unsupportedSelectiveLfsPath",
        "Select a repository-relative file for LFS fetching.",
    )?;
    if file.len() > 4096
        || file.contains([',', '*', '?', '[', ']', '\\', '!'])
        || file
            .split('/')
            .any(|part| part.eq_ignore_ascii_case(".git"))
    {
        return Err(AppError::new(
            "unsupportedSelectiveLfsPath",
            "This file name cannot be represented safely by the selective LFS include filter.",
            Some(
                "Use local Git LFS for names containing commas, wildcard syntax, backslashes or exclamation marks. No transfer started.",
            ),
        ));
    }
    Ok(())
}

fn committed_object(
    path: &Path,
    head: &str,
    file: &str,
) -> Result<lfs_objects::LfsObjectFile, AppError> {
    let include = format!("--include=/{file}");
    let (output, truncated) = run_git_with_stdout_limit(
        path,
        &["lfs", "ls-files", "--json", &include, "--exclude=", head],
        2 * 1024 * 1024,
    )?;
    ensure_success("inspect selected committed LFS pointer", &output)?;
    if truncated {
        return Err(stale_fetch());
    }
    let mut objects = lfs_objects::parse_objects(&output.stdout)?;
    if objects.files.len() != 1 || objects.files[0].name != file {
        return Err(AppError::new(
            "unsupportedSelectiveLfsScope",
            "Git LFS did not report exactly the selected file in committed HEAD.",
            Some(
                "The path may be staged-only, absent, zero-size or unsupported by this LFS version. No transfer started; use local Git LFS for this scope.",
            ),
        ));
    }
    Ok(objects.files.remove(0))
}

pub(super) fn settings_fingerprint(path: &Path) -> Result<String, AppError> {
    let mut bytes = Vec::new();
    for args in [vec!["config", "--null", "--list"], vec!["lfs", "env"]] {
        let (output, truncated) = run_git_with_stdout_limit(path, &args, 256 * 1024)?;
        ensure_success("review effective Git LFS settings", &output)?;
        if truncated {
            return Err(AppError::new(
                "lfsSettingsTooLarge",
                "Effective LFS settings exceed the safe review limit.",
                Some("Inspect the configuration with local Git LFS."),
            ));
        }
        bytes.extend_from_slice(&output.stdout);
        bytes.push(0);
    }
    gix::objs::compute_hash(gix::hash::Kind::Sha1, gix::objs::Kind::Blob, &bytes)
        .map(|hash| hash.to_string())
        .map_err(|error| {
            AppError::new(
                "lfsSettingsUnavailable",
                format!("Could not fingerprint LFS settings: {error}"),
                None,
            )
        })
}

fn stale_fetch() -> AppError {
    AppError::new(
        "staleLfsFetch",
        "HEAD or effective Git/LFS settings changed after reviewing this fetch.",
        Some("Inspect objects again and review the selected file and remote. No transfer started."),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selective_fetch_filters_refuse_patterns_but_keep_literal_spaces_and_option_looking_paths() {
        for file in ["space file.bin", "nested/space file.bin", "-leading.bin"] {
            validate_fetch_file(file).unwrap();
        }
        for file in [
            "",
            "../a",
            "/a",
            "*.bin",
            "a,b",
            "a?b",
            "[a]",
            "a\\b",
            "!a",
            ".git/file",
            "dir/.git/file",
        ] {
            assert!(validate_fetch_file(file).is_err(), "{file}");
        }
    }
}
