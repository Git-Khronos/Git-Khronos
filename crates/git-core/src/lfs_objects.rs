use super::*;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LfsObjectFile {
    pub name: String,
    pub size: u64,
    pub checkout: bool,
    pub downloaded: bool,
    #[serde(alias = "oid_type")]
    pub oid_type: String,
    pub oid: String,
    pub version: String,
    #[serde(skip_deserializing)]
    pub working_state: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct LfsObjects {
    #[serde(deserialize_with = "deserialize_files")]
    pub files: Vec<LfsObjectFile>,
}

fn deserialize_files<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<LfsObjectFile>, D::Error> {
    Option::<Vec<LfsObjectFile>>::deserialize(deserializer).map(Option::unwrap_or_default)
}

pub fn lfs_objects(path: &Path) -> Result<LfsObjects, AppError> {
    ensure_lfs_available(path)?;
    let (output, truncated) = run_git_with_stdout_limit(
        path,
        &["lfs", "ls-files", "--json", "--include=", "--exclude="],
        2 * 1024 * 1024,
    )?;
    ensure_success(
        "inspect Git LFS objects (requires JSON-capable Git LFS)",
        &output,
    )?;
    if truncated {
        return Err(AppError::new(
            "lfsObjectsTooLarge",
            "The LFS object list exceeds the safe inspection limit.",
            Some(
                "Inspect this repository with local git lfs ls-files. No partial list was presented.",
            ),
        ));
    }
    let mut objects = parse_objects(&output.stdout)?;
    for file in &mut objects.files {
        file.working_state = working_state(path, file)?;
    }
    Ok(objects)
}

pub(super) fn parse_objects(bytes: &[u8]) -> Result<LfsObjects, AppError> {
    let invalid = |message: String| {
        AppError::new(
            "unsupportedLfsObjectOutput",
            format!("Git LFS returned an unsupported object list: {message}"),
            Some("Use a JSON-capable Git LFS version or inspect objects with local Git LFS."),
        )
    };
    let objects: LfsObjects =
        serde_json::from_slice(bytes).map_err(|error| invalid(error.to_string()))?;
    if objects.files.len() > 2000 {
        return Err(invalid(
            "more than 2000 paths; use local Git LFS for this repository".into(),
        ));
    }
    let mut names = HashSet::new();
    for file in &objects.files {
        validate_relative_path(
            &file.name,
            "unsupportedLfsObjectOutput",
            "Git LFS reported an unsafe or unsupported file path.",
        )?;
        if file.size > 9_007_199_254_740_991
            || file.name.len() > 4096
            || file
                .name
                .split(['/', '\\'])
                .any(|part| part.eq_ignore_ascii_case(".git"))
            || !names.insert(&file.name)
            || file.oid_type != "sha256"
            || file.oid.len() != 64
            || !file
                .oid
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            || file.version != "https://git-lfs.github.com/spec/v1"
        {
            return Err(invalid(
                "invalid path, duplicate path, hash or pointer version".into(),
            ));
        }
    }
    Ok(objects)
}

fn working_state(path: &Path, file: &LfsObjectFile) -> Result<String, AppError> {
    let mut target = path.to_path_buf();
    for component in Path::new(&file.name).components() {
        target.push(component);
        match fs::symlink_metadata(&target) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok("missing".into());
            }
            Err(error) => return Err(object_read_error(error)),
            Ok(metadata) if metadata.file_type().is_symlink() => return Ok("symlink".into()),
            Ok(_) => {}
        }
    }
    let metadata = fs::symlink_metadata(&target).map_err(object_read_error)?;
    if !metadata.is_file() {
        return Ok("nonFile".into());
    }
    if metadata.len() < 1024 {
        let mut bytes = Vec::new();
        fs::File::open(&target)
            .map_err(object_read_error)?
            .take(1024)
            .read_to_end(&mut bytes)
            .map_err(object_read_error)?;
        let canonical = format!(
            "version https://git-lfs.github.com/spec/v1\noid sha256:{}\nsize {}\n",
            file.oid, file.size
        );
        if bytes == canonical.as_bytes() {
            return Ok("pointer".into());
        }
        if bytes.starts_with(b"version https://git-lfs.github.com/spec/v1")
            || bytes.starts_with(b"version https://hawser.github.com/spec/v1")
        {
            return Ok("pointerLike".into());
        }
    }
    Ok(if metadata.len() == file.size {
        "contentSizeMatches"
    } else {
        "sizeMismatch"
    }
    .into())
}

fn object_read_error(error: std::io::Error) -> AppError {
    AppError::new(
        "lfsWorkingFileUnavailable",
        format!("Could not inspect an LFS working path: {error}"),
        Some("Check file permissions and refresh. No hydration or file changes were attempted."),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn object_json_null_is_empty_but_missing_invalid_or_duplicate_records_fail() {
        assert!(
            parse_objects(br#"{"files":null}"#)
                .unwrap()
                .files
                .is_empty()
        );
        assert!(parse_objects(br#"{"files":[]}"#).unwrap().files.is_empty());
        for invalid in [br#"{}"#.as_slice(), br#"{"files":[{"name":"a"}]}"#, b"\xff"] {
            assert_eq!(
                parse_objects(invalid).unwrap_err().kind,
                "unsupportedLfsObjectOutput"
            );
        }
        let record = serde_json::json!({"name":"a","size":5,"checkout":false,"downloaded":true,
            "oid_type":"sha256","oid":"a".repeat(64),"version":"https://git-lfs.github.com/spec/v1"});
        let value = serde_json::json!({"files":[record]});
        let object = parse_objects(&serde_json::to_vec(&value).unwrap()).unwrap();
        let serialized = serde_json::to_value(object).unwrap();
        assert_eq!(serialized["files"][0]["oidType"], "sha256");
        assert!(serialized["files"][0].get("oid_type").is_none());
        let duplicate = serde_json::json!({"files":[value["files"][0],value["files"][0]]});
        assert!(parse_objects(&serde_json::to_vec(&duplicate).unwrap()).is_err());
        for (field, invalid) in [
            ("name", "../a"),
            ("name", ".git/config"),
            ("oid", "bad"),
            ("oid_type", "sha1"),
            ("version", "unknown"),
        ] {
            let mut value = value.clone();
            value["files"][0][field] = invalid.into();
            assert!(parse_objects(&serde_json::to_vec(&value).unwrap()).is_err());
        }
    }

    #[test]
    fn object_list_accepts_exact_path_limit_and_refuses_overflow_and_unsafe_integer_sizes() {
        let record = serde_json::json!({"name":"a","size":9_007_199_254_740_991_u64,
            "checkout":false,"downloaded":false,"oid_type":"sha256","oid":"a".repeat(64),
            "version":"https://git-lfs.github.com/spec/v1"});
        let mut files: Vec<_> = (0..2000)
            .map(|index| {
                let mut value = record.clone();
                value["name"] = format!("file-{index}").into();
                value
            })
            .collect();
        assert_eq!(
            parse_objects(&serde_json::to_vec(&serde_json::json!({"files":files})).unwrap())
                .unwrap()
                .files
                .len(),
            2000
        );
        let mut overflow = record.clone();
        overflow["name"] = "one-too-many".into();
        files.push(overflow);
        assert!(
            parse_objects(&serde_json::to_vec(&serde_json::json!({"files":files})).unwrap())
                .is_err()
        );
        let mut record = record;
        record["size"] = serde_json::json!(9_007_199_254_740_992_u64);
        assert!(
            parse_objects(&serde_json::to_vec(&serde_json::json!({"files":[record]})).unwrap())
                .is_err()
        );
    }
}
