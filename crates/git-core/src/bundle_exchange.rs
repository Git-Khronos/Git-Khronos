use super::*;
use std::fs::OpenOptions;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_BUNDLE_BYTES: usize = 16 * 1024 * 1024;
const MAX_BUNDLE_REFS: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BundleTip {
    pub reference: String,
    pub oid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BundleRequest {
    pub file: String,
    pub fingerprint: String,
    pub bytes: usize,
    pub tips: Vec<BundleTip>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BundleReview {
    pub request: BundleRequest,
    pub verification: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BundleExportRange {
    pub branch: String,
    pub tip_oid: String,
    pub base_oid: String,
    pub commit_count: u32,
}

fn refused(message: impl Into<String>) -> AppError {
    AppError::new(
        "bundleExchangeRefused",
        message,
        Some(
            "Keep the source bundle, inspect the repository and prepare a fresh review. No existing reference or working file is replaced.",
        ),
    )
}

fn io_error(error: std::io::Error) -> AppError {
    refused(format!("Bundle file access failed: {error}"))
}

fn read_bundle(file: &Path) -> Result<Vec<u8>, AppError> {
    if !fs::symlink_metadata(file).map_err(io_error)?.is_file() {
        return Err(refused(
            "Select a regular bundle file, not a symlink or special device.",
        ));
    }
    let input = fs::File::open(file).map_err(io_error)?;
    let mut bytes = Vec::new();
    input
        .take((MAX_BUNDLE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.is_empty() || bytes.len() > MAX_BUNDLE_BYTES {
        return Err(refused(
            "This workflow accepts complete bundles up to 16 MiB; no partial object import is offered.",
        ));
    }
    Ok(bytes)
}

fn fingerprint(bytes: &[u8]) -> Result<String, AppError> {
    gix::objs::compute_hash(gix::hash::Kind::Sha1, gix::objs::Kind::Blob, bytes)
        .map(|hash| hash.to_string())
        .map_err(|error| refused(format!("Could not identify bundle contents: {error}")))
}

fn idle(path: &Path) -> Result<(), AppError> {
    exchange_files::require_local_exchange_objects(path)?;
    let state = repository_operation_state(path)?;
    if state.merge
        || state.rebase
        || state.bisect
        || state.history.is_some()
        || read_status(path)?.history_no_commit
    {
        return Err(refused(
            "Finish or abort the active Git operation before exchanging bundles.",
        ));
    }
    require_no_git_sequence(path)
}

fn tips(path: &Path, file: &Path) -> Result<Vec<BundleTip>, AppError> {
    let filename = file
        .to_str()
        .ok_or_else(|| refused("Bundle path is not UTF-8."))?;
    let (output, truncated) =
        run_git_with_stdout_limit(path, &["bundle", "list-heads", filename], 256 * 1024)?;
    ensure_success("list every advertised bundle tip", &output)?;
    if truncated {
        return Err(refused(
            "The complete bundle reference list exceeds the review limit.",
        ));
    }
    let text = std::str::from_utf8(&output.stdout)
        .map_err(|_| refused("Bundle references are not UTF-8."))?;
    if !text.ends_with('\n') {
        return Err(refused("Bundle reference list is incomplete."));
    }
    let mut tips = Vec::new();
    let mut seen = HashSet::new();
    for line in text.lines() {
        let (oid, reference) = line
            .split_once(' ')
            .ok_or_else(|| refused("Bundle reference record is invalid."))?;
        validate_commit_oid(oid)?;
        if reference != "HEAD" {
            let result = run_git(path, &["check-ref-format", reference])?;
            ensure_success("validate an advertised bundle reference", &result)?;
        }
        if !seen.insert(reference.to_owned()) || tips.len() == MAX_BUNDLE_REFS {
            return Err(refused(
                "Review supports at most 500 distinct advertised references.",
            ));
        }
        tips.push(BundleTip {
            reference: reference.into(),
            oid: oid.into(),
        });
    }
    if !tips
        .iter()
        .any(|tip| tip.reference.starts_with("refs/heads/"))
    {
        return Err(refused(
            "This import workflow requires an advertised branch tip. Tag-only bundles require local Git.",
        ));
    }
    Ok(tips)
}

fn temporary_path(path: &Path) -> Result<PathBuf, AppError> {
    let output = run_git(path, &["rev-parse", "--absolute-git-dir"])?;
    ensure_success("locate bundle inspection metadata", &output)?;
    let directory = std::str::from_utf8(&output.stdout)
        .map_err(|_| refused("Git metadata path is not UTF-8."))?;
    let directory = directory
        .strip_suffix('\n')
        .ok_or_else(|| refused("Git metadata path is incomplete."))?;
    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| refused("The system clock is invalid."))?
        .as_nanos();
    Ok(PathBuf::from(directory).join(format!(
        "git-khronos-bundle-{id}-{}.tmp",
        std::process::id()
    )))
}

fn captured<T>(
    path: &Path,
    bytes: &[u8],
    action: impl FnOnce(&Path) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let file = temporary_path(path)?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&file)
        .map_err(io_error)?;
    let written = output.write_all(bytes).and_then(|_| output.sync_all());
    drop(output);
    let result = written.map_err(io_error).and_then(|_| action(&file));
    match fs::remove_file(&file) {
        Ok(()) => result,
        Err(error) => Err(refused(format!(
            "Bundle operation {} and temporary capture cleanup failed at '{}': {error}. Inspect object/recovery effects before retrying.",
            match result {
                Ok(_) => "finished".into(),
                Err(error) => format!("failed ({})", error.message),
            },
            file.display()
        ))),
    }
}

fn inspect(path: &Path, file: &Path) -> Result<(Vec<BundleTip>, String), AppError> {
    let filename = file
        .to_str()
        .ok_or_else(|| refused("Bundle path is not UTF-8."))?;
    let output = run_git(path, &["bundle", "verify", filename])?;
    ensure_success("verify bundle format and available prerequisites", &output)?;
    if output.stdout.len() + output.stderr.len() > 256 * 1024 {
        return Err(refused(
            "The complete bundle verification report exceeds the review limit.",
        ));
    }
    let report = [output.stdout, output.stderr].concat();
    let report = String::from_utf8(report)
        .map_err(|_| refused("Bundle verification report is not UTF-8."))?;
    Ok((tips(path, file)?, report))
}

pub fn review_bundle(path: &Path, file: &Path) -> Result<BundleReview, AppError> {
    idle(path)?;
    let bytes = read_bundle(file)?;
    let (tips, verification) = captured(path, &bytes, |capture| inspect(path, capture))?;
    Ok(BundleReview {
        request: BundleRequest {
            file: file
                .to_str()
                .ok_or_else(|| refused("Bundle path is not UTF-8."))?
                .into(),
            fingerprint: fingerprint(&bytes)?,
            bytes: bytes.len(),
            tips,
        },
        verification,
    })
}

pub fn import_bundle(
    path: &Path,
    request: &BundleRequest,
    tip: &BundleTip,
) -> Result<String, AppError> {
    idle(path)?;
    let branch = tip
        .reference
        .strip_prefix("refs/heads/")
        .ok_or_else(|| refused("Choose an advertised branch, not HEAD or a tag."))?;
    validate_branch_name(path, branch)?;
    validate_commit_oid(&tip.oid)?;
    let bytes = read_bundle(Path::new(&request.file))?;
    if request.bytes != bytes.len()
        || request.fingerprint != fingerprint(&bytes)?
        || request.tips.len() > MAX_BUNDLE_REFS
    {
        return Err(refused(
            "Bundle contents changed after review. No import started.",
        ));
    }
    captured(path, &bytes, |capture| {
        let (current, _) = inspect(path, capture)?;
        if current != request.tips || !current.contains(tip) {
            return Err(refused("The selected advertised tip changed after review."));
        }
        idle(path)?;
        let filename = capture
            .to_str()
            .ok_or_else(|| refused("Captured bundle path is not UTF-8."))?;
        run_mutation(
            path,
            &[
                "-c",
                "fetch.writeCommitGraph=false",
                "fetch",
                "--no-tags",
                "--no-recurse-submodules",
                "--no-auto-maintenance",
                "--no-write-fetch-head",
                "--refmap=",
                "--no-prune",
                "--no-prune-tags",
                filename,
                &tip.reference,
            ],
            "import bundle objects without updating existing refs",
        ).map_err(|error| AppError::new("bundleImportFailed",
            format!("Bundle object import failed: {}", error.message),
            Some("Objects may have been imported. No existing references or working files were intentionally updated; inspect before preparing a fresh review.")))?;
        let resolved = run_git(
            path,
            &["rev-parse", "--verify", &format!("{}^{{commit}}", tip.oid)],
        ).and_then(|output| {
            ensure_success("verify the imported branch tip is a commit", &output)?;
            Ok(output)
        }).map_err(|error| refused(format!(
            "The imported branch tip could not be verified as a commit: {}. Objects may have been imported; no recovery ref was created.",
            error.message
        )))?;
        if resolved.stdout != format!("{}\n", tip.oid).as_bytes() {
            return Err(refused(
                "The imported branch tip is not the advertised commit. Objects may have been imported; no recovery ref was created.",
            ));
        }
        preserve_reference(path, &tip.oid, &format!("Imported bundle branch {}", tip.reference))
            .map_err(|error| AppError::new("bundleRecoveryFailed",
                format!("Bundle objects were imported, but its recovery reference could not be created: {}", error.message),
                Some("No existing reference or working file moved. Fix the reference obstruction and prepare a fresh review.")))
    })
}

pub fn export_bundle(
    path: &Path,
    branch: &str,
    expected_oid: &str,
    destination: &Path,
) -> Result<usize, AppError> {
    export_bundle_with_base(path, branch, expected_oid, None, destination)
}

fn export_source(path: &Path, branch: &str, expected_oid: &str) -> Result<String, AppError> {
    idle(path)?;
    let shallow = run_git(path, &["rev-parse", "--is-shallow-repository"])?;
    ensure_success("inspect complete bundle history", &shallow)?;
    if shallow.stdout != b"false\n" {
        return Err(refused(
            "Bundle export requires complete, non-shallow history. Download the full history before exporting.",
        ));
    }
    let grafts = run_git(
        path,
        &[
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            "info/grafts",
        ],
    )?;
    ensure_success("locate legacy history grafts", &grafts)?;
    let graft_file = std::str::from_utf8(&grafts.stdout)
        .ok()
        .and_then(|text| text.strip_suffix('\n'))
        .filter(|text| !text.is_empty())
        .ok_or_else(|| refused("Could not validate legacy history grafts."))?;
    if std::env::var_os("GIT_GRAFT_FILE").is_some()
        || Path::new(graft_file).try_exists().map_err(io_error)?
    {
        return Err(refused(
            "Bundle export does not use history with legacy Git grafts.",
        ));
    }
    validate_branch_name(path, branch)?;
    validate_commit_oid(expected_oid)?;
    let reference = format!("refs/heads/{branch}");
    let commit = format!("{reference}^{{commit}}");
    let tip = run_git(
        path,
        &["--no-replace-objects", "rev-parse", "--verify", &commit],
    )?;
    ensure_success("read the bundle source commit", &tip)?;
    if tip.stdout != format!("{expected_oid}\n").as_bytes() {
        return Err(refused(
            "The source branch changed. Refresh before exporting.",
        ));
    }
    Ok(reference)
}

fn check_export_base(path: &Path, expected_oid: &str, base_oid: &str) -> Result<String, AppError> {
    validate_commit_oid(base_oid)?;
    let base = base_oid.to_ascii_lowercase();
    let expression = format!("{base}^{{commit}}");
    let commit = run_git(
        path,
        &[
            "--no-replace-objects",
            "rev-parse",
            "--verify",
            "--end-of-options",
            &expression,
        ],
    )?;
    if !commit.status.success() || commit.stdout != format!("{base}\n").as_bytes() {
        return Err(refused(
            "The prerequisite is not an existing commit with that exact ID.",
        ));
    }
    if base == expected_oid {
        return Err(refused(
            "The prerequisite is already the source tip; there is nothing to export.",
        ));
    }
    let ancestor = run_git(
        path,
        &[
            "--no-replace-objects",
            "merge-base",
            "--is-ancestor",
            &base,
            expected_oid,
        ],
    )?;
    if ancestor.status.code() == Some(1) {
        return Err(refused(
            "The prerequisite must be an ancestor of the selected branch tip.",
        ));
    }
    ensure_success("check the bundle prerequisite ancestry", &ancestor)?;
    Ok(base)
}

pub fn review_bundle_export_range(
    path: &Path,
    branch: &str,
    expected_oid: &str,
    base_oid: &str,
) -> Result<BundleExportRange, AppError> {
    without_lazy_fetch(|| {
        export_source(path, branch, expected_oid)?;
        let base_oid = check_export_base(path, expected_oid, base_oid)?;
        let revision = format!("{base_oid}..{expected_oid}");
        let args = ["--no-replace-objects", "rev-list", "--count", &revision].map(str::to_owned);
        let count = history_search::bounded_git_with_limit(
            path,
            &args,
            &CancellationToken::default(),
            4096,
        )?;
        let commit_count = std::str::from_utf8(&count.stdout)
            .ok()
            .and_then(|text| text.trim().parse::<u32>().ok())
            .filter(|count| *count > 0)
            .ok_or_else(|| refused("Could not count the commits in the reviewed bundle range."))?;
        Ok(BundleExportRange {
            branch: branch.into(),
            tip_oid: expected_oid.into(),
            base_oid,
            commit_count,
        })
    })
}

pub fn export_bundle_with_base(
    path: &Path,
    branch: &str,
    expected_oid: &str,
    base_oid: Option<&str>,
    destination: &Path,
) -> Result<usize, AppError> {
    without_lazy_fetch(|| {
        let reference = export_source(path, branch, expected_oid)?;
        let prerequisite = base_oid
            .map(|base| check_export_base(path, expected_oid, base))
            .transpose()?;
        let revision = prerequisite
            .as_ref()
            .map_or_else(|| reference.clone(), |base| format!("{base}..{reference}"));
        let (bundle, truncated) = run_git_with_stdout_limit(
            path,
            &["--no-replace-objects", "bundle", "create", "-", &revision],
            MAX_BUNDLE_BYTES,
        )?;
        ensure_success("create the reviewed branch bundle", &bundle)?;
        if truncated {
            return Err(refused(
                "The complete bundle exceeds 16 MiB; use local Git for larger exports.",
            ));
        }
        // Check the Git-generated header, not localized verification prose. A
        // merge may advertise additional boundaries reachable from the base.
        if let Some(base) = prerequisite {
            let found = bundle
                .stdout
                .split(|byte| *byte == b'\n')
                .skip(1)
                .take_while(|line| !line.is_empty())
                .filter_map(|line| line.strip_prefix(b"-"))
                .any(|line| {
                    line.strip_prefix(base.as_bytes())
                        .is_some_and(|remainder| remainder.starts_with(b" "))
                });
            if !found {
                return Err(refused(
                    "The generated bundle did not advertise the reviewed prerequisite. No destination written.",
                ));
            }
        }
        captured(path, &bundle.stdout, |capture| {
            let (tips, _) = inspect(path, capture)?;
            if tips
                != vec![BundleTip {
                    reference: reference.clone(),
                    oid: expected_oid.into(),
                }]
            {
                return Err(refused(
                    "The exported branch changed during bundle creation. No destination written.",
                ));
            }
            Ok(())
        })?;
        exchange_files::write_new_exchange_file(path, destination, &bundle.stdout)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        directory: PathBuf,
        source: PathBuf,
        target: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let id = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let directory =
                std::env::temp_dir().join(format!("khronos-bundle-{}-{id}", std::process::id()));
            let source = directory.join("source");
            let target = directory.join("target");
            for path in [&source, &target] {
                fs::create_dir_all(path).unwrap();
                for args in [
                    vec!["init", "-b", "main"],
                    vec!["config", "user.name", "Bundle Author"],
                    vec!["config", "user.email", "bundle@example.test"],
                    vec!["config", "commit.gpgsign", "false"],
                ] {
                    Self::git(path, &args);
                }
                fs::write(path.join("base"), b"base\n").unwrap();
                Self::git(path, &["add", "."]);
                Self::git(path, &["commit", "-m", "Base"]);
            }
            Self {
                directory,
                source,
                target,
            }
        }
        fn git(path: &Path, args: &[&str]) {
            run_mutation(path, args, "prepare owned bundle fixture").unwrap();
        }
        fn output(path: &Path, args: &[&str]) -> Vec<u8> {
            let output = run_git(path, args).unwrap();
            ensure_success("inspect owned bundle fixture", &output).unwrap();
            output.stdout
        }
        fn oid(path: &Path) -> String {
            String::from_utf8(Self::output(path, &["rev-parse", "HEAD"]))
                .unwrap()
                .trim()
                .into()
        }
        fn append(&self) -> String {
            fs::write(self.source.join("binary"), [0, 1, 255, 2]).unwrap();
            Self::git(&self.source, &["add", "."]);
            Self::git(&self.source, &["commit", "-m", "Offline commit"]);
            Self::oid(&self.source)
        }
        fn bundle(&self) -> PathBuf {
            let file = self.directory.join("exchange.bundle");
            export_bundle(&self.source, "main", &Self::oid(&self.source), &file).unwrap();
            file
        }
        fn no_captures(&self, path: &Path) {
            assert!(!fs::read_dir(path.join(".git")).unwrap().any(|entry| {
                entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with("git-khronos-bundle-")
            }));
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.directory).unwrap();
        }
    }

    #[test]
    fn self_contained_binary_history_round_trip_creates_only_a_new_recovery_reference() {
        let fixture = Fixture::new();
        let original = Fixture::oid(&fixture.target);
        Fixture::git(&fixture.target, &["branch", "keep"]);
        Fixture::git(&fixture.target, &["tag", "keep-tag"]);
        fs::write(fixture.target.join("base"), b"dirty staged\n").unwrap();
        Fixture::git(&fixture.target, &["add", "."]);
        fs::write(fixture.target.join("base"), b"dirty working\n").unwrap();
        fs::write(fixture.target.join("untracked"), b"keep\n").unwrap();
        let index = Fixture::output(&fixture.target, &["ls-files", "--stage", "-z"]);
        let status = Fixture::output(&fixture.target, &["status", "--porcelain", "-z"]);
        let fetched = fixture.append();
        let file = fixture.bundle();
        Fixture::git(&fixture.target, &["config", "fetch.prune", "true"]);
        Fixture::git(&fixture.target, &["config", "fetch.pruneTags", "true"]);
        let configured_remote = format!("remote.{}.fetch", file.to_str().unwrap());
        Fixture::git(
            &fixture.target,
            &["config", &configured_remote, "+refs/heads/*:refs/heads/*"],
        );
        fs::write(
            fixture.target.join(".git/FETCH_HEAD"),
            b"owned previous fetch\n",
        )
        .unwrap();
        let review = review_bundle(&fixture.target, &file).unwrap();
        assert!(review.verification.contains("complete history"));
        assert_eq!(
            review.request.tips,
            vec![BundleTip {
                reference: "refs/heads/main".into(),
                oid: fetched.clone()
            }]
        );
        assert_eq!(
            Fixture::output(
                &fixture.target,
                &["for-each-ref", "refs/git-khronos/recovery"]
            ),
            b""
        );
        let reference =
            import_bundle(&fixture.target, &review.request, &review.request.tips[0]).unwrap();
        assert!(reference.starts_with("refs/git-khronos/recovery/"));
        assert_eq!(
            Fixture::output(&fixture.target, &["rev-parse", &reference]),
            format!("{fetched}\n").as_bytes()
        );
        assert_eq!(
            Fixture::output(&fixture.target, &["show", &format!("{reference}:binary")]),
            [0, 1, 255, 2]
        );
        assert_eq!(
            Fixture::output(&fixture.target, &["log", "-1", "--format=%s", &reference]),
            b"Offline commit\n"
        );
        for tip in ["HEAD", "keep", "keep-tag"] {
            assert_eq!(
                Fixture::output(&fixture.target, &["rev-parse", tip]),
                format!("{original}\n").as_bytes()
            );
        }
        assert_eq!(
            Fixture::output(&fixture.target, &["ls-files", "--stage", "-z"]),
            index
        );
        assert_eq!(
            Fixture::output(&fixture.target, &["status", "--porcelain", "-z"]),
            status
        );
        assert_eq!(
            fs::read(fixture.target.join("base")).unwrap(),
            b"dirty working\n"
        );
        assert_eq!(
            fs::read(fixture.target.join("untracked")).unwrap(),
            b"keep\n"
        );
        assert_eq!(
            fs::read(fixture.target.join(".git/FETCH_HEAD")).unwrap(),
            b"owned previous fetch\n"
        );
        assert_eq!(
            Fixture::output(&fixture.target, &["config", "fetch.pruneTags"]),
            b"true\n"
        );
        assert_eq!(
            Fixture::output(&fixture.target, &["config", &configured_remote]),
            b"+refs/heads/*:refs/heads/*\n"
        );
        fixture.no_captures(&fixture.source);
        fixture.no_captures(&fixture.target);
    }

    #[test]
    fn exact_advertised_reference_limit_is_complete_and_extra_tip_refuses() {
        let fixture = Fixture::new();
        let oid = Fixture::oid(&fixture.source);
        for index in 0..499 {
            Fixture::git(
                &fixture.source,
                &["update-ref", &format!("refs/heads/limit-{index}"), &oid],
            );
        }
        let accepted = fixture.directory.join("500.bundle");
        Fixture::git(
            &fixture.source,
            &["bundle", "create", accepted.to_str().unwrap(), "--branches"],
        );
        let review = review_bundle(&fixture.target, &accepted).unwrap();
        assert_eq!(review.request.tips.len(), 500);
        Fixture::git(
            &fixture.source,
            &["update-ref", "refs/heads/extra-tip", &oid],
        );
        let refused = fixture.directory.join("501.bundle");
        Fixture::git(
            &fixture.source,
            &["bundle", "create", refused.to_str().unwrap(), "--branches"],
        );
        assert!(
            review_bundle(&fixture.target, &refused)
                .unwrap_err()
                .message
                .contains("500")
        );
        assert!(
            Fixture::output(
                &fixture.target,
                &["for-each-ref", "refs/git-khronos/recovery"]
            )
            .is_empty()
        );
        fixture.no_captures(&fixture.target);
    }

    #[test]
    fn advertised_branch_must_be_a_direct_commit_not_an_annotated_tag() {
        let fixture = Fixture::new();
        fixture.append();
        Fixture::git(
            &fixture.source,
            &["tag", "-a", "annotated", "-m", "Owned annotation"],
        );
        let blob = String::from_utf8(Fixture::output(
            &fixture.source,
            &["rev-parse", "HEAD:binary"],
        ))
        .unwrap();
        Fixture::git(&fixture.source, &["tag", "blob", blob.trim()]);
        let file = fixture.directory.join("tag-as-branch.bundle");
        Fixture::git(
            &fixture.source,
            &["bundle", "create", file.to_str().unwrap(), "--all"],
        );
        let bytes = fs::read(&file).unwrap();
        let needle = b"refs/tags/annotated\n";
        let offset = bytes
            .windows(needle.len())
            .position(|window| window == needle)
            .unwrap();
        let mut altered = bytes[..offset].to_vec();
        altered.extend_from_slice(b"refs/heads/annotated\n");
        altered.extend_from_slice(&bytes[offset + needle.len()..]);
        let needle = b"refs/tags/blob\n";
        let offset = altered
            .windows(needle.len())
            .position(|window| window == needle)
            .unwrap();
        altered.splice(
            offset..offset + needle.len(),
            b"refs/heads/blob\n".iter().copied(),
        );
        fs::write(&file, altered).unwrap();
        let review = review_bundle(&fixture.target, &file).unwrap();
        let tip = review
            .request
            .tips
            .iter()
            .find(|tip| tip.reference == "refs/heads/annotated")
            .unwrap();
        let refs = Fixture::output(&fixture.target, &["for-each-ref"]);
        let error = import_bundle(&fixture.target, &review.request, tip).unwrap_err();
        assert!(error.message.contains("not the advertised commit"));
        let blob_tip = review
            .request
            .tips
            .iter()
            .find(|tip| tip.reference == "refs/heads/blob")
            .unwrap();
        let error = import_bundle(&fixture.target, &review.request, blob_tip).unwrap_err();
        assert!(error.message.contains("could not be verified as a commit"));
        assert!(error.message.contains("Objects may have been imported"));
        assert_eq!(Fixture::output(&fixture.target, &["for-each-ref"]), refs);
        assert!(!fixture.target.join(".git/FETCH_HEAD").exists());
        fixture.no_captures(&fixture.target);
    }

    #[test]
    fn corrupt_object_payload_cannot_create_a_recovery_ref_or_change_existing_files() {
        let fixture = Fixture::new();
        fixture.append();
        let file = fixture.bundle();
        let mut bytes = fs::read(&file).unwrap();
        bytes.truncate(bytes.len() - 16);
        fs::write(&file, bytes).unwrap();
        let review = review_bundle(&fixture.target, &file).unwrap();
        let refs = Fixture::output(&fixture.target, &["for-each-ref"]);
        let index = Fixture::output(&fixture.target, &["ls-files", "--stage", "-z"]);
        let error =
            import_bundle(&fixture.target, &review.request, &review.request.tips[0]).unwrap_err();
        assert_eq!(error.kind, "bundleImportFailed");
        assert!(
            error
                .hint
                .unwrap()
                .contains("Objects may have been imported")
        );
        assert_eq!(Fixture::output(&fixture.target, &["for-each-ref"]), refs);
        assert_eq!(
            Fixture::output(&fixture.target, &["ls-files", "--stage", "-z"]),
            index
        );
        assert_eq!(fs::read(fixture.target.join("base")).unwrap(), b"base\n");
        assert!(!fixture.target.join(".git/FETCH_HEAD").exists());
        fixture.no_captures(&fixture.target);
    }

    #[test]
    fn shallow_export_and_partial_clone_exchange_refuse_before_implicit_network_downloads() {
        let fixture = Fixture::new();
        fixture.append();
        let file = fixture.bundle();
        let oid = Fixture::oid(&fixture.source);
        let destination = fixture.directory.join("refused.bundle");
        fs::write(fixture.source.join(".git/shallow"), format!("{oid}\n")).unwrap();
        let error = export_bundle(&fixture.source, "main", &oid, &destination).unwrap_err();
        assert!(error.message.contains("non-shallow"));
        assert!(!destination.exists());
        fs::remove_file(fixture.source.join(".git/shallow")).unwrap();
        Fixture::git(
            &fixture.source,
            &["config", "remote.owned.promisor", "true"],
        );
        let error = export_bundle(&fixture.source, "main", &oid, &destination).unwrap_err();
        assert!(error.message.contains("implicit network downloads"));
        assert!(!destination.exists());
        Fixture::git(
            &fixture.target,
            &["config", "remote.owned.promisor", "true"],
        );
        assert!(
            review_bundle(&fixture.target, &file)
                .unwrap_err()
                .message
                .contains("promisor")
        );
        Fixture::git(
            &fixture.target,
            &["config", "remote.owned.promisor", "false"],
        );
        let review = review_bundle(&fixture.target, &file).unwrap();
        Fixture::git(
            &fixture.target,
            &["config", "extensions.partialClone", "owned"],
        );
        let refs = Fixture::output(&fixture.target, &["for-each-ref"]);
        assert!(
            import_bundle(&fixture.target, &review.request, &review.request.tips[0])
                .unwrap_err()
                .message
                .contains("partial clones")
        );
        assert_eq!(Fixture::output(&fixture.target, &["for-each-ref"]), refs);
        fixture.no_captures(&fixture.source);
        fixture.no_captures(&fixture.target);
    }

    #[test]
    fn export_stale_tip_existing_destination_and_metadata_refuse_without_changes() {
        let fixture = Fixture::new();
        let original = Fixture::oid(&fixture.source);
        fixture.append();
        let file = fixture.directory.join("new.bundle");
        assert!(export_bundle(&fixture.source, "main", &original, &file).is_err());
        assert!(!file.exists());
        fs::write(&file, b"keep destination\n").unwrap();
        assert!(
            export_bundle(
                &fixture.source,
                "main",
                &Fixture::oid(&fixture.source),
                &file
            )
            .is_err()
        );
        assert_eq!(fs::read(file).unwrap(), b"keep destination\n");
        for destination in [
            fixture.source.join("inside.bundle"),
            fixture.source.join(".git/inside.bundle"),
        ] {
            assert!(
                export_bundle(
                    &fixture.source,
                    "main",
                    &Fixture::oid(&fixture.source),
                    &destination
                )
                .is_err()
            );
            assert!(!destination.exists());
        }
        fixture.no_captures(&fixture.source);
    }

    #[test]
    fn changed_file_unknown_advertisement_invalid_object_and_competing_sequence_refuse() {
        let fixture = Fixture::new();
        fixture.append();
        let file = fixture.bundle();
        let review = review_bundle(&fixture.target, &file).unwrap();
        let bytes = fs::read(&file).unwrap();
        fs::write(&file, [bytes.as_slice(), b"\n"].concat()).unwrap();
        assert!(import_bundle(&fixture.target, &review.request, &review.request.tips[0]).is_err());
        fs::write(&file, bytes).unwrap();
        let absent = BundleTip {
            reference: "refs/heads/absent".into(),
            oid: review.request.tips[0].oid.clone(),
        };
        assert!(import_bundle(&fixture.target, &review.request, &absent).is_err());
        let head = BundleTip {
            reference: "HEAD".into(),
            oid: review.request.tips[0].oid.clone(),
        };
        assert!(import_bundle(&fixture.target, &review.request, &head).is_err());
        let mut forged = review.request.clone();
        forged.tips[0].oid = "a".repeat(40);
        assert!(import_bundle(&fixture.target, &forged, &forged.tips[0]).is_err());
        for marker in ["rebase-apply", "rebase-merge", "sequencer"] {
            let directory = fixture.target.join(".git").join(marker);
            fs::create_dir(&directory).unwrap();
            assert!(
                import_bundle(&fixture.target, &review.request, &review.request.tips[0]).is_err()
            );
            assert!(directory.is_dir());
            fs::remove_dir(directory).unwrap();
        }
        assert_eq!(
            Fixture::output(
                &fixture.target,
                &["for-each-ref", "refs/git-khronos/recovery"]
            ),
            b""
        );
        fixture.no_captures(&fixture.target);
    }

    #[test]
    fn incremental_bundle_requires_available_prerequisites_before_import() {
        let fixture = Fixture::new();
        let base = Fixture::oid(&fixture.source);
        let file = fixture.directory.join("incremental.bundle");
        let imported = fixture.append();
        let reviewed =
            review_bundle_export_range(&fixture.source, "main", &imported, &base).unwrap();
        assert_eq!(
            reviewed,
            BundleExportRange {
                branch: "main".into(),
                tip_oid: imported.clone(),
                base_oid: base.clone(),
                commit_count: 1,
            }
        );
        let refs = Fixture::output(&fixture.source, &["for-each-ref"]);
        assert_eq!(
            export_bundle_with_base(&fixture.source, "main", &imported, Some(&base), &file)
                .unwrap(),
            fs::metadata(&file).unwrap().len() as usize
        );
        assert_eq!(
            Fixture::output(
                &fixture.source,
                &["bundle", "list-heads", file.to_str().unwrap()]
            ),
            format!("{imported} refs/heads/main\n").as_bytes()
        );
        let bytes = fs::read(&file).unwrap();
        assert!(
            bytes
                .split(|byte| *byte == b'\n')
                .take_while(|line| !line.is_empty())
                .any(|line| line.starts_with(format!("-{base} ").as_bytes()))
        );
        assert_eq!(Fixture::output(&fixture.source, &["for-each-ref"]), refs);
        fixture.no_captures(&fixture.source);
        let empty = fixture.directory.join("empty");
        fs::create_dir(&empty).unwrap();
        Fixture::git(&empty, &["init", "-b", "main"]);
        assert!(review_bundle(&empty, &file).is_err());
        assert_eq!(Fixture::output(&empty, &["for-each-ref"]), b"");
        fixture.no_captures(&empty);
        Fixture::git(
            &fixture.target,
            &[
                "fetch",
                "--no-tags",
                fixture.source.to_str().unwrap(),
                &base,
            ],
        );
        let review = review_bundle(&fixture.target, &file).unwrap();
        assert!(review.verification.contains("requires"));
        let reference =
            import_bundle(&fixture.target, &review.request, &review.request.tips[0]).unwrap();
        assert_eq!(
            Fixture::output(&fixture.target, &["rev-parse", &reference]),
            format!("{imported}\n").as_bytes()
        );
    }

    #[test]
    fn incremental_bundle_refuses_invalid_bases_and_moved_tips_without_writing() {
        let fixture = Fixture::new();
        let base = Fixture::oid(&fixture.source);
        Fixture::git(&fixture.source, &["switch", "-c", "unrelated"]);
        Fixture::git(
            &fixture.source,
            &["commit", "--allow-empty", "-m", "Different side"],
        );
        let side = Fixture::oid(&fixture.source);
        Fixture::git(&fixture.source, &["switch", "main"]);
        let tip = fixture.append();
        Fixture::git(
            &fixture.source,
            &["tag", "-a", "base", &base, "-m", "Annotated"],
        );
        let annotated = String::from_utf8(Fixture::output(
            &fixture.source,
            &["rev-parse", "refs/tags/base"],
        ))
        .unwrap();
        let file = fixture.directory.join("should-not-exist.bundle");
        for (oid, message) in [
            (side.as_str(), "must be an ancestor"),
            (tip.as_str(), "nothing to export"),
            (annotated.trim(), "not an existing commit"),
            (
                "0000000000000000000000000000000000000000",
                "not an existing commit",
            ),
        ] {
            let review =
                review_bundle_export_range(&fixture.source, "main", &tip, oid).unwrap_err();
            assert!(review.message.contains(message), "{review:?}");
            let export = export_bundle_with_base(&fixture.source, "main", &tip, Some(oid), &file)
                .unwrap_err();
            assert!(export.message.contains(message), "{export:?}");
            assert!(!file.exists());
        }
        assert!(review_bundle_export_range(&fixture.source, "main", &tip, &base).is_ok());
        Fixture::git(
            &fixture.source,
            &["commit", "--allow-empty", "-m", "Moved tip"],
        );
        let error =
            export_bundle_with_base(&fixture.source, "main", &tip, Some(&base), &file).unwrap_err();
        assert!(error.message.contains("source branch changed"));
        assert!(!file.exists());
        fixture.no_captures(&fixture.source);
    }

    #[test]
    fn incremental_bundle_preserves_merges_and_uses_original_objects() {
        let fixture = Fixture::new();
        let base = Fixture::oid(&fixture.source);
        Fixture::git(&fixture.source, &["switch", "-c", "side"]);
        Fixture::git(&fixture.source, &["commit", "--allow-empty", "-m", "Side"]);
        let side = Fixture::oid(&fixture.source);
        Fixture::git(&fixture.source, &["switch", "main"]);
        let main = fixture.append();
        Fixture::git(
            &fixture.source,
            &["merge", "--no-ff", "-m", "Merge", "side"],
        );
        let tip = Fixture::oid(&fixture.source);
        // A local replace ref hides the merge in normal display, but does
        // not change what the recipient can import from original objects.
        Fixture::git(&fixture.source, &["replace", &tip, &main]);
        let plan = review_bundle_export_range(&fixture.source, "main", &tip, &base).unwrap();
        assert_eq!(plan.commit_count, 3);
        let file = fixture.directory.join("merge.bundle");
        export_bundle_with_base(&fixture.source, "main", &tip, Some(&base), &file).unwrap();
        Fixture::git(
            &fixture.target,
            &[
                "fetch",
                "--no-tags",
                fixture.source.to_str().unwrap(),
                &base,
            ],
        );
        let review = review_bundle(&fixture.target, &file).unwrap();
        let recovery =
            import_bundle(&fixture.target, &review.request, &review.request.tips[0]).unwrap();
        assert_eq!(
            Fixture::output(&fixture.target, &["show", "-s", "--format=%P", &recovery]),
            format!("{main} {side}\n").as_bytes()
        );
    }

    #[test]
    fn bundle_export_refuses_legacy_history_grafts() {
        let fixture = Fixture::new();
        let base = Fixture::oid(&fixture.source);
        let tip = fixture.append();
        fs::write(fixture.source.join(".git/info/grafts"), format!("{tip}\n")).unwrap();
        let file = fixture.directory.join("grafted.bundle");
        assert!(
            review_bundle_export_range(&fixture.source, "main", &tip, &base)
                .unwrap_err()
                .message
                .contains("legacy Git grafts")
        );
        assert!(
            export_bundle(&fixture.source, "main", &tip, &file)
                .unwrap_err()
                .message
                .contains("legacy Git grafts")
        );
        assert!(!file.exists());
    }

    #[cfg(unix)]
    #[test]
    fn recovery_namespace_failure_is_explicit_after_object_import_without_moving_existing_refs() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = Fixture::new();
        let imported = fixture.append();
        let file = fixture.bundle();
        let review = review_bundle(&fixture.target, &file).unwrap();
        let original = Fixture::oid(&fixture.target);
        let hooks = fixture.target.join(".git/owned-hooks");
        fs::create_dir(&hooks).unwrap();
        let hook = hooks.join("reference-transaction");
        let script =
            b"#!/bin/sh\nif grep -q 'refs/git-khronos/recovery/'; then exit 1; fi\nexit 0\n";
        fs::write(&hook, script).unwrap();
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o700)).unwrap();
        Fixture::git(
            &fixture.target,
            &["config", "core.hooksPath", hooks.to_str().unwrap()],
        );
        let error =
            import_bundle(&fixture.target, &review.request, &review.request.tips[0]).unwrap_err();
        assert_eq!(error.kind, "bundleRecoveryFailed");
        assert!(error.message.contains("objects were imported"));
        assert_eq!(Fixture::oid(&fixture.target), original);
        assert_eq!(fs::read(hook).unwrap(), script);
        assert_eq!(
            Fixture::output(
                &fixture.target,
                &["rev-parse", &format!("{imported}^{{commit}}")]
            ),
            format!("{imported}\n").as_bytes()
        );
        fixture.no_captures(&fixture.target);
    }

    #[test]
    fn complete_byte_limits_corrupt_and_tag_only_bundles_are_not_partially_accepted() {
        let fixture = Fixture::new();
        let file = fixture.directory.join("bounded.bundle");
        fs::write(&file, vec![0; MAX_BUNDLE_BYTES]).unwrap();
        assert_eq!(read_bundle(&file).unwrap().len(), MAX_BUNDLE_BYTES);
        assert!(review_bundle(&fixture.target, &file).is_err());
        fs::write(&file, vec![0; MAX_BUNDLE_BYTES + 1]).unwrap();
        assert!(read_bundle(&file).is_err());
        fs::remove_file(&file).unwrap();
        Fixture::git(&fixture.source, &["tag", "tag-only"]);
        Fixture::git(
            &fixture.source,
            &[
                "bundle",
                "create",
                file.to_str().unwrap(),
                "refs/tags/tag-only",
            ],
        );
        assert!(review_bundle(&fixture.target, &file).is_err());
        fixture.no_captures(&fixture.target);
    }

    #[cfg(unix)]
    #[test]
    fn literal_newline_bundle_path_and_linked_worktree_import_keep_main_worktree_intact() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        fixture.append();
        let file = fixture.directory.join("literal\nexchange.bundle");
        export_bundle(
            &fixture.source,
            "main",
            &Fixture::oid(&fixture.source),
            &file,
        )
        .unwrap();
        let linked = fixture.directory.join("linked\nworktree");
        Fixture::git(
            &fixture.target,
            &["worktree", "add", "-b", "linked", linked.to_str().unwrap()],
        );
        let index = Fixture::output(&fixture.target, &["ls-files", "--stage", "-z"]);
        let review = review_bundle(&linked, &file).unwrap();
        let reference = import_bundle(&linked, &review.request, &review.request.tips[0]).unwrap();
        assert_eq!(
            Fixture::output(&fixture.target, &["rev-parse", &reference]),
            format!("{}\n", review.request.tips[0].oid).as_bytes()
        );
        assert_eq!(
            Fixture::output(&fixture.target, &["ls-files", "--stage", "-z"]),
            index
        );
        assert_eq!(Fixture::output(&linked, &["status", "--porcelain"]), b"");
        let symlinked = fixture.directory.join("linked.bundle");
        symlink(file, &symlinked).unwrap();
        assert!(review_bundle(&fixture.target, &symlinked).is_err());
    }
}
