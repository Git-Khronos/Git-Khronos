use super::*;

struct Repository(PathBuf);
impl Repository {
    fn new(format: &str) -> Self {
        let mut random = [0; 12];
        getrandom::fill(&mut random).unwrap();
        let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let value = Self(std::env::temp_dir().join(format!("khronos-file-content-{suffix}")));
        fs::create_dir(&value.0).unwrap();
        value.git(&["init", "--initial-branch=main", "--object-format", format]);
        for (key, val) in [
            ("user.name", "Owned Content Fixture"),
            ("user.email", "content@example.test"),
            ("core.hooksPath", "/dev/null"),
            ("commit.gpgsign", "false"),
        ] {
            value.git(&["config", key, val]);
        }
        value
    }
    fn git(&self, args: &[&str]) -> Vec<u8> {
        let output = run_git(&self.0, args).unwrap();
        ensure_success("inspect owned content fixture", &output).unwrap();
        output.stdout
    }
    fn head(&self) -> String {
        String::from_utf8(self.git(&["rev-parse", "HEAD"]))
            .unwrap()
            .trim()
            .into()
    }
    fn commit(&self) -> String {
        self.git(&["add", "--all"]);
        self.git(&["commit", "-qm", "Owned fixture"]);
        self.head()
    }
    fn read(&self, source: &FileContentLocation, file: &str) -> FileContent {
        read_file_content(&self.0, source, file, &CancellationToken::default()).unwrap()
    }
}
impl Drop for Repository {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn selected_revision_and_index_return_exact_distinct_binary_blobs_without_writes() {
    for format in ["sha1", "sha256"] {
        let repo = Repository::new(format);
        fs::write(repo.0.join("image"), b"\x89PNG\r\n\x1a\nold\0bytes").unwrap();
        let first = repo.commit();
        let original = repo.git(&["show", &format!("{first}:image")]);
        fs::write(repo.0.join("image"), b"different\0index\xff").unwrap();
        repo.git(&["add", "--", "image"]);
        let before_index = fs::read(repo.0.join(".git/index")).unwrap();
        let before_config = fs::read(repo.0.join(".git/config")).unwrap();
        let refs = repo.git(&["show-ref"]);
        let old = repo.read(&FileContentLocation::Revision(first.clone()), "image");
        let index = repo.read(&FileContentLocation::Index, "image");
        assert_eq!(old.bytes, Some(original));
        assert_eq!(index.bytes, Some(b"different\0index\xff".to_vec()));
        assert_ne!(old.oid, index.oid);
        assert_eq!(old.kind, FileContentKind::Regular);
        assert_eq!(
            old.oid.as_ref().unwrap().len(),
            if format == "sha256" { 64 } else { 40 }
        );
        assert_eq!(fs::read(repo.0.join(".git/index")).unwrap(), before_index);
        assert_eq!(fs::read(repo.0.join(".git/config")).unwrap(), before_config);
        assert_eq!(repo.git(&["show-ref"]), refs);
        assert_eq!(
            repo.read(&FileContentLocation::Revision(first), "missing")
                .kind,
            FileContentKind::Absent
        );
    }
}

#[test]
#[cfg(unix)]
fn literal_names_and_unstaged_bytes_are_distinct_from_index_and_other_paths() {
    let repo = Repository::new("sha1");
    for file in ["*.bin", ":(glob)*.img", "--image", " leading space\n雪 \t"] {
        fs::write(repo.0.join(file), b"committed\0").unwrap();
    }
    fs::write(repo.0.join("other.bin"), b"unrelated").unwrap();
    let oid = repo.commit();
    for file in ["*.bin", ":(glob)*.img", "--image", " leading space\n雪 \t"] {
        fs::write(repo.0.join(file), b"staged\0").unwrap();
        repo.git(&["--literal-pathspecs", "add", "--", file]);
        fs::write(repo.0.join(file), b"dirty\xff\0").unwrap();
        assert_eq!(
            repo.read(&FileContentLocation::Revision(oid.clone()), file)
                .bytes
                .unwrap(),
            b"committed\0"
        );
        assert_eq!(
            repo.read(&FileContentLocation::Index, file).bytes.unwrap(),
            b"staged\0"
        );
        assert_eq!(
            repo.read(&FileContentLocation::WorkingTree, file)
                .bytes
                .unwrap(),
            b"dirty\xff\0"
        );
        assert_eq!(fs::read(repo.0.join(file)).unwrap(), b"dirty\xff\0");
    }
    assert_eq!(fs::read(repo.0.join("other.bin")).unwrap(), b"unrelated");
}

#[test]
fn unborn_index_and_empty_blob_are_not_a_missing_blob_or_failed_read() {
    let repo = Repository::new("sha1");
    assert_eq!(
        repo.read(&FileContentLocation::Index, "new").kind,
        FileContentKind::Absent
    );
    fs::write(repo.0.join("new"), []).unwrap();
    repo.git(&["add", "--", "new"]);
    let content = repo.read(&FileContentLocation::Index, "new");
    assert_eq!(content.size, Some(0));
    assert_eq!(content.bytes, Some(vec![]));
    assert!(!content.over_limit);
}

#[test]
#[cfg(unix)]
fn over_budget_blob_and_working_file_expose_size_without_partial_payload() {
    let repo = Repository::new("sha1");
    let file = fs::File::create(repo.0.join("large")).unwrap();
    file.set_len(MAX_FILE_CONTENT_BYTES as u64 + 1).unwrap();
    let oid = repo.commit();
    for source in [
        FileContentLocation::Revision(oid),
        FileContentLocation::Index,
        FileContentLocation::WorkingTree,
    ] {
        let content = repo.read(&source, "large");
        assert_eq!(content.kind, FileContentKind::Regular);
        assert!(content.over_limit);
        assert_eq!(content.bytes, None);
        assert_eq!(content.size, Some(MAX_FILE_CONTENT_BYTES as u64 + 1));
    }
    file.set_len(MAX_FILE_CONTENT_BYTES as u64).unwrap();
    let exact = repo.read(&FileContentLocation::WorkingTree, "large");
    assert!(!exact.over_limit);
    assert_eq!(exact.bytes.unwrap().len(), MAX_FILE_CONTENT_BYTES);
}

#[test]
fn unresolved_index_and_submodule_are_not_arbitrarily_selected_blob_sides() {
    let repo = Repository::new("sha1");
    fs::write(repo.0.join("conflict"), b"base\n").unwrap();
    let base = repo.commit();
    repo.git(&["checkout", "-qb", "side"]);
    fs::write(repo.0.join("conflict"), b"side\n").unwrap();
    repo.commit();
    repo.git(&["checkout", "-q", "main"]);
    fs::write(repo.0.join("conflict"), b"main\n").unwrap();
    repo.commit();
    assert!(
        !run_git(&repo.0, &["merge", "--no-edit", "side"])
            .unwrap()
            .status
            .success()
    );
    let value = repo.read(&FileContentLocation::Index, "conflict");
    assert_eq!(value.kind, FileContentKind::Unmerged);
    assert!(value.bytes.is_none());
    repo.git(&["merge", "--abort"]);
    repo.git(&[
        "update-index",
        "--add",
        "--cacheinfo",
        &format!("160000,{base},nested"),
    ]);
    let value = repo.read(&FileContentLocation::Index, "nested");
    assert_eq!(value.kind, FileContentKind::Submodule);
    assert_eq!(value.oid, Some(base));
    assert!(value.bytes.is_none());
}

#[test]
#[cfg(unix)]
fn symlink_contents_are_inspected_without_reading_external_target_and_parents_are_refused() {
    use std::os::unix::fs::symlink;
    let repo = Repository::new("sha1");
    let external = repo.0.with_extension("owned-external");
    fs::write(&external, b"retained outside bytes").unwrap();
    symlink(&external, repo.0.join("link")).unwrap();
    let oid = repo.commit();
    for source in [
        FileContentLocation::WorkingTree,
        FileContentLocation::Index,
        FileContentLocation::Revision(oid),
    ] {
        let content = repo.read(&source, "link");
        assert_eq!(content.kind, FileContentKind::SymbolicLink);
        assert_eq!(
            content.bytes.unwrap(),
            external.as_os_str().as_encoded_bytes()
        );
    }
    fs::create_dir(repo.0.join("outside-directory")).unwrap();
    fs::write(repo.0.join("outside-directory/secret"), b"retained").unwrap();
    symlink(repo.0.join("outside-directory"), repo.0.join("alias")).unwrap();
    assert!(
        read_file_content(
            &repo.0,
            &FileContentLocation::WorkingTree,
            "alias/secret",
            &CancellationToken::default()
        )
        .is_err()
    );
    assert_eq!(fs::read(&external).unwrap(), b"retained outside bytes");
    fs::remove_file(external).unwrap();
}

#[test]
#[cfg(unix)]
fn missing_parent_is_absent_but_fifo_and_directory_are_not_read_as_files() {
    let repo = Repository::new("sha1");
    assert_eq!(
        repo.read(&FileContentLocation::WorkingTree, "removed/old.img")
            .kind,
        FileContentKind::Absent
    );
    fs::create_dir(repo.0.join("directory")).unwrap();
    rustix::fs::mknodat(
        rustix::fs::CWD,
        repo.0.join("pipe"),
        rustix::fs::FileType::Fifo,
        rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
        0,
    )
    .unwrap();
    for file in ["directory", "pipe"] {
        assert!(
            read_file_content(
                &repo.0,
                &FileContentLocation::WorkingTree,
                file,
                &CancellationToken::default()
            )
            .is_err()
        );
    }
}

#[test]
fn paths_and_object_expressions_cannot_escape_the_selected_repository_content() {
    let repo = Repository::new("sha1");
    for file in [
        ".git/config",
        "../outside",
        "/absolute",
        "a/../outside",
        "./image",
        "a//image",
        "image\0",
    ] {
        assert!(
            read_file_content(
                &repo.0,
                &FileContentLocation::Index,
                file,
                &CancellationToken::default()
            )
            .is_err()
        );
    }
    for oid in ["HEAD", "--help", "HEAD:image", "a", "../../outside"] {
        assert!(
            read_file_content(
                &repo.0,
                &FileContentLocation::Revision(oid.into()),
                "file",
                &CancellationToken::default()
            )
            .is_err()
        );
    }
    let cancellation = CancellationToken::default();
    cancellation.cancel();
    assert_eq!(
        read_file_content(&repo.0, &FileContentLocation::Index, "file", &cancellation)
            .unwrap_err()
            .kind,
        "operationCancelled"
    );
}

#[test]
#[cfg(unix)]
fn file_content_does_not_start_filters_textconv_or_external_diff_tools() {
    let repo = Repository::new("sha1");
    fs::write(repo.0.join("image"), b"raw\0blob").unwrap();
    let oid = repo.commit();
    fs::write(
        repo.0.join(".gitattributes"),
        b"image filter=owned diff=owned\n",
    )
    .unwrap();
    let sentinel = repo.0.join("unexpected-filter");
    let command = format!("touch '{}'", sentinel.display());
    for key in [
        "filter.owned.clean",
        "filter.owned.smudge",
        "diff.owned.textconv",
        "diff.external",
    ] {
        repo.git(&["config", key, &command]);
    }
    for source in [
        FileContentLocation::Revision(oid),
        FileContentLocation::Index,
        FileContentLocation::WorkingTree,
    ] {
        assert_eq!(repo.read(&source, "image").bytes.unwrap(), b"raw\0blob");
    }
    assert!(!sentinel.exists());
}

#[test]
#[cfg(unix)]
fn promised_missing_blobs_never_trigger_a_fetch_or_repository_write() {
    use std::os::unix::fs::PermissionsExt;
    let repo = Repository::new("sha1");
    fs::write(repo.0.join("missing-image"), b"owned image bytes\0").unwrap();
    let commit = repo.commit();
    let blob = String::from_utf8(repo.git(&["rev-parse", &format!("{commit}:missing-image")]))
        .unwrap()
        .trim()
        .to_owned();
    let loose = repo
        .0
        .join(".git/objects")
        .join(&blob[..2])
        .join(&blob[2..]);
    let saved = fs::read(&loose).unwrap();
    fs::remove_file(&loose).unwrap();
    let remote = repo.0.join("owned-promisor.git");
    repo.git(&["init", "--bare", remote.to_str().unwrap()]);
    let sentinel = repo.0.join("unexpected-lazy-fetch");
    let helper = repo.0.join("owned-upload-pack");
    fs::write(
        &helper,
        format!(
            "#!/bin/sh\nprintf owned > '{}'\nexit 1\n",
            sentinel.display()
        ),
    )
    .unwrap();
    fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
    for (key, value) in [
        ("extensions.partialClone", "owned"),
        ("remote.owned.promisor", "true"),
        ("remote.owned.url", remote.to_str().unwrap()),
        ("remote.owned.uploadpack", helper.to_str().unwrap()),
        ("protocol.file.allow", "always"),
    ] {
        repo.git(&["config", key, value]);
    }
    let index = fs::read(repo.0.join(".git/index")).unwrap();
    assert!(
        read_file_content(
            &repo.0,
            &FileContentLocation::Revision(commit),
            "missing-image",
            &CancellationToken::default()
        )
        .is_err()
    );
    assert!(!sentinel.exists());
    assert!(!loose.exists());
    assert_eq!(fs::read(repo.0.join(".git/index")).unwrap(), index);
    // Prove the fixture would detect an implicit fetch: ordinary Git attempts
    // its explicitly configured, entirely local helper for the same object.
    let control = git_in(&repo.0)
        .args(["cat-file", "-t", &blob])
        .env_remove("GIT_NO_LAZY_FETCH")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .unwrap();
    assert!(!control.status.success());
    assert_eq!(fs::read(&sentinel).unwrap(), b"owned");
    fs::write(loose, saved).unwrap();
}

#[test]
#[cfg(unix)]
fn a_git_metadata_directory_cannot_be_reinterpreted_as_working_content() {
    let repo = Repository::new("sha1");
    fs::write(repo.0.join("image"), b"owned historical bytes").unwrap();
    let oid = repo.commit();
    let git_dir = repo.0.join(".git");
    assert!(
        read_file_content(
            &git_dir,
            &FileContentLocation::WorkingTree,
            "config",
            &CancellationToken::default()
        )
        .is_err()
    );
    repo.git(&["config", "core.bare", "true"]);
    assert!(
        read_file_content(
            &git_dir,
            &FileContentLocation::WorkingTree,
            "config",
            &CancellationToken::default()
        )
        .is_err()
    );
    let historical = read_file_content(
        &git_dir,
        &FileContentLocation::Revision(oid),
        "image",
        &CancellationToken::default(),
    )
    .unwrap();
    assert_eq!(historical.bytes.unwrap(), b"owned historical bytes");
}
