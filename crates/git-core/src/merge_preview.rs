use super::*;

const OUTPUT_LIMIT: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MergePreviewRequest {
    pub source: String,
    pub target: String,
    pub source_oid: String,
    pub target_oid: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MergePreview {
    pub request: MergePreviewRequest,
    pub clean: bool,
    pub conflicted_paths: Vec<String>,
}

fn refused(message: &str) -> AppError {
    AppError::new(
        "mergePreviewUnsupported",
        message,
        Some("No merge was started. Review this case with local Git."),
    )
}

fn incomplete() -> AppError {
    AppError::new(
        "mergePreviewIncomplete",
        "Git did not return a complete merge preview.",
        Some("Refresh and retry. No clean result can be inferred."),
    )
}

fn stale() -> AppError {
    AppError::new(
        "staleMergePreview",
        "A selected reference changed after it was displayed.",
        Some("Refresh the repository and request a new preview."),
    )
}

fn inspect(
    path: &Path,
    args: &[&str],
    cancellation: &CancellationToken,
) -> Result<Output, AppError> {
    let mut command = git_in(path);
    command
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_NO_LAZY_FETCH", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_tree(&mut command);
    let (output, truncated) =
        run_cancellable_command_with_stdout_limit(command, cancellation, Some(OUTPUT_LIMIT))?;
    if truncated {
        return Err(incomplete());
    }
    Ok(output)
}

fn tip(path: &Path, reference: &str, cancellation: &CancellationToken) -> Result<String, AppError> {
    if reference != "HEAD" {
        if !(reference.starts_with("refs/heads/") || reference.starts_with("refs/remotes/"))
            || reference.len() > 1024
        {
            return Err(refused(
                "Choose HEAD or an explicit local or remote-tracking branch.",
            ));
        }
        ensure_success(
            "validate preview reference",
            &inspect(path, &["check-ref-format", reference], cancellation)?,
        )?;
    }
    let output = inspect(
        path,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{reference}^{{commit}}"),
        ],
        cancellation,
    )?;
    ensure_success("resolve preview reference", &output)?;
    let oid = std::str::from_utf8(&output.stdout)
        .map_err(|_| incomplete())?
        .trim_end_matches('\n');
    validate_commit_oid(oid)?;
    Ok(oid.into())
}

fn current(
    path: &Path,
    request: &MergePreviewRequest,
    cancellation: &CancellationToken,
) -> Result<(), AppError> {
    validate_commit_oid(&request.source_oid)?;
    validate_commit_oid(&request.target_oid)?;
    if tip(path, &request.source, cancellation)? != request.source_oid
        || tip(path, &request.target, cancellation)? != request.target_oid
    {
        return Err(stale());
    }
    Ok(())
}

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Result<Self, AppError> {
        let mut random = [0; 16];
        getrandom::fill(&mut random).map_err(|_| incomplete())?;
        let name = random
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        let path = std::env::temp_dir().join(format!("git-khronos-merge-preview-{name}"));
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&path).map_err(io_error)?;
        Ok(Self(path))
    }
    fn command(&self, args: &[&str]) -> Command {
        let mut command = Command::new("git");
        command.arg("-C").arg(&self.0).args(args);
        // The isolated repository must not inherit object/index redirection,
        // config injection, replacement refs, attributes or executable drivers.
        for (name, _) in std::env::vars_os() {
            if name.to_string_lossy().starts_with("GIT_") {
                command.env_remove(name);
            }
        }
        command
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", self.0.join("empty-config"))
            .env("GIT_ATTR_NOSYSTEM", "1")
            .env("GIT_NO_LAZY_FETCH", "1")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("LC_ALL", "C")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_process_tree(&mut command);
        command
    }
    fn run(&self, args: &[&str], cancellation: &CancellationToken) -> Result<Output, AppError> {
        let (output, truncated) = run_cancellable_command_with_stdout_limit(
            self.command(args),
            cancellation,
            Some(OUTPUT_LIMIT),
        )?;
        if truncated {
            return Err(incomplete());
        }
        Ok(output)
    }
    fn remove(&self) -> Result<(), AppError> {
        fs::remove_dir_all(&self.0).map_err(io_error)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn io_error(error: std::io::Error) -> AppError {
    AppError::new(
        "mergePreviewStorage",
        format!("Could not prepare or clean up merge preview storage: {error}"),
        None,
    )
}

/// Preview default Git merge semantics in an isolated object database, never
/// invoking a configured driver or writing the selected repository's objects.
pub fn preview_merge(
    path: &Path,
    request: &MergePreviewRequest,
    cancellation: &CancellationToken,
) -> Result<MergePreview, AppError> {
    let version = inspect(path, &["--version"], cancellation)?;
    ensure_success("inspect Git preview support", &version)?;
    if !parse_git_version(&version.stdout)
        .is_some_and(|version| version_at_least(&version, "2.43.0"))
    {
        return Err(refused(
            "Merge preview requires Git 2.43 or newer for explicit committed-attribute lookup.",
        ));
    }
    let shallow = inspect(
        path,
        &["rev-parse", "--is-shallow-repository"],
        cancellation,
    )?;
    ensure_success("inspect preview history", &shallow)?;
    if shallow.stdout != b"false\n" {
        return Err(refused(
            "Merge preview requires complete history; shallow repositories are unsupported.",
        ));
    }
    let custom = inspect(
        path,
        &[
            "config",
            "--get-regexp",
            "^(extensions\\.partialclone|remote\\..*\\.promisor|merge\\..*\\.(driver|recursive)|merge\\.default)$",
        ],
        cancellation,
    )?;
    if custom.status.success() {
        return Err(refused(
            "Partial clones and configured merge drivers require a separate review.",
        ));
    }
    if custom.status.code() != Some(1) {
        ensure_success("inspect preview configuration", &custom)?;
    }
    let replacements = inspect(
        path,
        &["for-each-ref", "--format=%(refname)", "refs/replace/"],
        cancellation,
    )?;
    ensure_success("inspect replacement references", &replacements)?;
    if !replacements.stdout.is_empty() {
        return Err(refused(
            "Replacement references are unsupported by this preview.",
        ));
    }
    current(path, request, cancellation)?;
    let base = inspect(
        path,
        &["merge-base", &request.source_oid, &request.target_oid],
        cancellation,
    )?;
    if base.status.code() == Some(1) {
        return Err(refused("The selected commits have unrelated histories."));
    }
    ensure_success("inspect common history", &base)?;
    let objects = inspect(
        path,
        &[
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            "objects",
        ],
        cancellation,
    )?;
    ensure_success("locate preview object source", &objects)?;
    let object_path = std::str::from_utf8(&objects.stdout)
        .map_err(|_| incomplete())?
        .strip_suffix('\n')
        .ok_or_else(incomplete)?;
    if object_path.contains(['\n', '\r']) || !Path::new(object_path).is_absolute() {
        return Err(refused(
            "The object-directory path cannot be represented safely for preview.",
        ));
    }
    let format = inspect(path, &["rev-parse", "--show-object-format"], cancellation)?;
    ensure_success("inspect preview object format", &format)?;
    let object_format = match format.stdout.as_slice() {
        b"sha1\n" => "--object-format=sha1",
        b"sha256\n" => "--object-format=sha256",
        _ => return Err(incomplete()),
    };
    let scratch = Scratch::new()?;
    let result = (|| {
        fs::write(scratch.0.join("empty-config"), b"").map_err(io_error)?;
        fs::create_dir(scratch.0.join("empty-template")).map_err(io_error)?;
        let init = scratch.run(
            &[
                "init",
                "--bare",
                "--quiet",
                "--template=empty-template",
                object_format,
                ".",
            ],
            cancellation,
        )?;
        ensure_success("initialize isolated merge preview", &init)?;
        fs::write(
            scratch.0.join("objects/info/alternates"),
            format!("{object_path}\n"),
        )
        .map_err(io_error)?;
        let output = scratch.run(
            &[
                &format!("--attr-source={}", request.target_oid),
                "merge-tree",
                "--write-tree",
                "--name-only",
                "-z",
                "--no-messages",
                &request.target_oid,
                &request.source_oid,
            ],
            cancellation,
        )?;
        if !matches!(output.status.code(), Some(0 | 1)) {
            ensure_success("preview committed merge", &output)?;
        }
        let clean = output.status.success();
        let conflicted_paths = parse(&output.stdout, clean)?;
        current(path, request, cancellation)?;
        if cancellation.is_cancelled() {
            return Err(operation_cancelled());
        }
        Ok(MergePreview {
            request: request.clone(),
            clean,
            conflicted_paths,
        })
    })();
    scratch.remove()?;
    result
}

fn parse(bytes: &[u8], clean: bool) -> Result<Vec<String>, AppError> {
    let mut fields = bytes.split(|b| *b == 0);
    let tree =
        std::str::from_utf8(fields.next().ok_or_else(incomplete)?).map_err(|_| incomplete())?;
    validate_commit_oid(tree).map_err(|_| incomplete())?;
    if !bytes.ends_with(&[0]) {
        return Err(incomplete());
    }
    let mut paths = Vec::new();
    for field in fields {
        if field.is_empty() {
            continue;
        }
        if paths.len() >= 5000 {
            return Err(incomplete());
        }
        let path = std::str::from_utf8(field)
            .map_err(|_| refused("A conflicted path is not valid UTF-8."))?;
        paths.push(path.to_owned());
    }
    if clean && !paths.is_empty() {
        return Err(incomplete());
    }
    // Status 1 remains conflicted even if Git has no individual path records.
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(Scratch);
    impl Fixture {
        fn new() -> Self {
            let scratch = Scratch::new().unwrap();
            let f = Self(scratch);
            f.git(&["init", "-q", "-b", "main"]);
            for (key, value) in [
                ("user.name", "Preview Tester"),
                ("user.email", "preview@example.test"),
                ("commit.gpgsign", "false"),
            ] {
                f.git(&["config", key, value]);
            }
            f.write("text", "base\n");
            f.git(&["add", "."]);
            f.git(&["commit", "-qm", "Base"]);
            f.git(&["branch", "topic"]);
            f
        }
        fn path(&self) -> &Path {
            &self.0.0
        }
        fn git(&self, args: &[&str]) -> Vec<u8> {
            let output = run_git(self.path(), args).unwrap();
            assert!(
                output.status.success(),
                "{args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            output.stdout
        }
        fn write(&self, name: &str, contents: &str) {
            fs::write(self.path().join(name), contents).unwrap();
        }
        fn commit(&self) {
            self.git(&["add", "-A"]);
            self.git(&["commit", "-qm", "Change"]);
        }
        fn request(&self) -> MergePreviewRequest {
            let cancellation = CancellationToken::default();
            MergePreviewRequest {
                source: "refs/heads/topic".into(),
                target: "refs/heads/main".into(),
                source_oid: tip(self.path(), "refs/heads/topic", &cancellation).unwrap(),
                target_oid: tip(self.path(), "refs/heads/main", &cancellation).unwrap(),
            }
        }
        fn preview(&self) -> MergePreview {
            preview_merge(self.path(), &self.request(), &CancellationToken::default()).unwrap()
        }
        fn state(&self) -> Vec<(PathBuf, Vec<u8>)> {
            fn visit(root: &Path, path: &Path, rows: &mut Vec<(PathBuf, Vec<u8>)>) {
                for entry in fs::read_dir(path).unwrap() {
                    let path = entry.unwrap().path();
                    if path.is_dir() {
                        visit(root, &path, rows);
                    } else {
                        rows.push((
                            path.strip_prefix(root).unwrap().to_owned(),
                            fs::read(path).unwrap(),
                        ));
                    }
                }
            }
            let mut rows = Vec::new();
            visit(self.path(), self.path(), &mut rows);
            rows.sort();
            rows
        }
    }
    #[test]
    fn merge_preview_clean_fast_forward_and_dirty_repository_are_read_only() {
        let f = Fixture::new();
        assert!(f.preview().clean);
        f.git(&["checkout", "-q", "topic"]);
        f.write("topic", "independent\n");
        f.commit();
        assert!(f.preview().clean);
        f.git(&["checkout", "-q", "main"]);
        f.write("main", "independent\n");
        f.commit();
        f.write("staged", "staged\n");
        f.git(&["add", "staged"]);
        f.write("staged", "unstaged too\n");
        f.write("untracked", "preserve\n");
        let before = f.state();
        let result = f.preview();
        assert!(result.clean);
        assert!(result.conflicted_paths.is_empty());
        assert_eq!(before, f.state());
    }
    #[test]
    fn merge_preview_content_and_modify_delete_conflicts_keep_every_byte() {
        let f = Fixture::new();
        f.git(&["checkout", "-q", "topic"]);
        f.write("text", "source\n");
        f.commit();
        f.git(&["checkout", "-q", "main"]);
        f.write("text", "target\n");
        f.commit();
        let before = f.state();
        let result = f.preview();
        assert!(!result.clean);
        assert_eq!(result.conflicted_paths, ["text"]);
        assert_eq!(before, f.state());
        f.git(&["rm", "text"]);
        f.git(&["commit", "-qm", "Delete"]);
        let before = f.state();
        let result = f.preview();
        assert!(!result.clean);
        assert_eq!(result.conflicted_paths, ["text"]);
        assert_eq!(before, f.state());
    }
    #[test]
    fn merge_preview_detects_rename_conflicts_and_preserves_newlines_in_names() {
        let f = Fixture::new();
        f.git(&["checkout", "-q", "topic"]);
        f.git(&["mv", "text", "source\nname"]);
        f.commit();
        f.git(&["checkout", "-q", "main"]);
        f.git(&["mv", "text", "target name"]);
        f.commit();
        let result = f.preview();
        assert!(!result.clean);
        assert!(result.conflicted_paths.contains(&"source\nname".into()));
        assert!(result.conflicted_paths.contains(&"target name".into()));
    }
    #[test]
    fn merge_preview_binary_conflicts_are_reported_without_text_assumptions() {
        let f = Fixture::new();
        f.git(&["checkout", "-q", "topic"]);
        fs::write(f.path().join("text"), b"source\0binary").unwrap();
        f.commit();
        f.git(&["checkout", "-q", "main"]);
        fs::write(f.path().join("text"), b"target\0binary").unwrap();
        f.commit();
        let result = f.preview();
        assert!(!result.clean);
        assert_eq!(result.conflicted_paths, ["text"]);
    }
    #[test]
    fn merge_preview_stale_deleted_and_unsafe_references_refuse() {
        let f = Fixture::new();
        let request = f.request();
        f.write("text", "next\n");
        f.commit();
        assert_eq!(
            preview_merge(f.path(), &request, &CancellationToken::default())
                .unwrap_err()
                .kind,
            "staleMergePreview"
        );
        let mut request = f.request();
        request.source = "--help".into();
        assert_eq!(
            preview_merge(f.path(), &request, &CancellationToken::default())
                .unwrap_err()
                .kind,
            "mergePreviewUnsupported"
        );
        request = f.request();
        f.git(&["branch", "-D", "topic"]);
        assert!(preview_merge(f.path(), &request, &CancellationToken::default()).is_err());
    }
    #[test]
    fn merge_preview_unrelated_shallow_partial_and_custom_drivers_refuse() {
        let f = Fixture::new();
        let request = f.request();
        f.git(&["checkout", "--orphan", "unrelated"]);
        f.git(&["commit", "-qm", "Separate root"]);
        let mut unrelated = request.clone();
        unrelated.target = "refs/heads/unrelated".into();
        unrelated.target_oid =
            tip(f.path(), &unrelated.target, &CancellationToken::default()).unwrap();
        assert!(
            preview_merge(f.path(), &unrelated, &CancellationToken::default())
                .unwrap_err()
                .message
                .contains("unrelated")
        );
        fs::write(
            f.path().join(".git/shallow"),
            format!("{}\n", request.source_oid),
        )
        .unwrap();
        assert!(
            preview_merge(f.path(), &request, &CancellationToken::default())
                .unwrap_err()
                .message
                .contains("shallow")
        );
        fs::remove_file(f.path().join(".git/shallow")).unwrap();
        for key in [
            "remote.origin.promisor",
            "extensions.partialClone",
            "merge.test.driver",
            "merge.default",
        ] {
            f.git(&["config", key, "true"]);
            assert_eq!(
                preview_merge(f.path(), &request, &CancellationToken::default())
                    .unwrap_err()
                    .kind,
                "mergePreviewUnsupported"
            );
            f.git(&["config", "--unset", key]);
        }
    }
    #[test]
    fn merge_preview_cancelled_and_incomplete_output_never_looks_clean() {
        let f = Fixture::new();
        let token = CancellationToken::default();
        token.cancel();
        assert_eq!(
            preview_merge(f.path(), &f.request(), &token)
                .unwrap_err()
                .kind,
            "operationCancelled"
        );
        assert!(parse(b"missing", true).is_err());
        assert!(parse(format!("{}\0path\0", "a".repeat(40)).as_bytes(), true).is_err());
        assert!(
            parse(format!("{}\0", "a".repeat(40)).as_bytes(), false)
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    fn merge_preview_uses_committed_attributes_without_external_drivers() {
        let f = Fixture::new();
        f.write("text", "first\nmiddle\nlast\n");
        f.write(".gitattributes", "text -merge\n");
        f.commit();
        f.git(&["branch", "-f", "topic"]);
        f.git(&["checkout", "-q", "topic"]);
        f.write("text", "changed first\nmiddle\nlast\n");
        f.commit();
        f.git(&["checkout", "-q", "main"]);
        f.write("text", "first\nmiddle\nchanged last\n");
        f.commit();
        let before = f.state();
        assert!(
            !f.preview().clean,
            "Committed binary-merge attributes must prevent a text auto-merge"
        );
        assert_eq!(before, f.state());
    }

    #[test]
    fn merge_preview_cancels_after_start_without_changing_repository() {
        let f = Fixture::new();
        let token = CancellationToken::default();
        let before = f.state();
        thread::scope(|scope| {
            let request = f.request();
            let path = f.path();
            let cancellation = &token;
            let handle = scope.spawn(move || preview_merge(path, &request, cancellation));
            thread::sleep(Duration::from_millis(50));
            token.cancel();
            assert_eq!(
                handle.join().unwrap().unwrap_err().kind,
                "operationCancelled"
            );
        });
        assert_eq!(before, f.state());
    }

    #[test]
    fn merge_preview_remote_tracking_and_sha256_repositories_are_supported() {
        let f = Fixture::new();
        let mut request = f.request();
        f.git(&[
            "update-ref",
            "refs/remotes/origin/main",
            &request.target_oid,
        ]);
        request.target = "refs/remotes/origin/main".into();
        assert!(
            preview_merge(f.path(), &request, &CancellationToken::default())
                .unwrap()
                .clean
        );
        let scratch = Scratch::new().unwrap();
        let init = inspect(
            &scratch.0,
            &["init", "--object-format=sha256", "-b", "main"],
            &CancellationToken::default(),
        )
        .unwrap();
        assert!(init.status.success());
        let g = Fixture(scratch);
        g.git(&["config", "user.name", "Preview Tester"]);
        g.git(&["config", "user.email", "preview@example.test"]);
        g.git(&["config", "commit.gpgsign", "false"]);
        g.write("text", "sha256\n");
        g.commit();
        g.git(&["branch", "topic"]);
        assert_eq!(g.preview().request.source_oid.len(), 64);
    }
}
