use super::*;
use std::os::unix::fs::{MetadataExt, PermissionsExt, symlink};

struct Repository(PathBuf);
impl Repository {
    fn new(format: &str) -> Self {
        let mut random = [0; 12];
        getrandom::fill(&mut random).unwrap();
        let path = std::env::temp_dir().join(format!(
            "owned-byte-write-{}",
            random
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        ));
        fs::create_dir(&path).unwrap();
        let value = Self(path);
        for args in [
            vec!["init", "-q", "-b", "main", "--object-format", format],
            vec!["config", "user.name", "Owned byte writer"],
            vec!["config", "user.email", "byte-writer@example.test"],
            vec!["config", "commit.gpgsign", "false"],
            vec!["config", "core.hooksPath", "/dev/null"],
        ] {
            value.git(&args);
        }
        value
    }
    fn git(&self, args: &[&str]) -> Vec<u8> {
        let output = run_git(&self.0, args).unwrap();
        ensure_success("owned byte fixture", &output).unwrap();
        output.stdout
    }
    fn open(&self) -> WorkingFileBytesEdit {
        WorkingFileBytesEdit::capture(&self.0, "literal [file].bin", &CancellationToken::default())
            .unwrap()
    }
    fn path(&self) -> PathBuf {
        self.0.join("literal [file].bin")
    }
    fn no_temporaries(&self) {
        assert!(!fs::read_dir(&self.0).unwrap().any(|e| {
            e.unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".git-khronos-edit-")
        }));
    }
}
impl Drop for Repository {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn working_file_bytes_save_binary_above_text_limit_exactly_preserves_metadata_and_git() {
    let repo = Repository::new("sha1");
    let original: Vec<u8> = (0..2 * MAX_WORKING_TEXT_BYTES)
        .map(|n| (n % 256) as u8)
        .collect();
    fs::write(repo.path(), &original).unwrap();
    fs::set_permissions(repo.path(), fs::Permissions::from_mode(0o755)).unwrap();
    let file = fs::File::open(repo.path()).unwrap();
    rustix::fs::fsetxattr(
        &file,
        "user.owned-byte-write",
        b"retained",
        rustix::fs::XattrFlags::empty(),
    )
    .unwrap();
    repo.git(&["add", "--all"]);
    repo.git(&["commit", "-qm", "Owned binary baseline"]);
    let index = fs::read(repo.0.join(".git/index")).unwrap();
    let config = fs::read(repo.0.join(".git/config")).unwrap();
    let refs = repo.git(&["show-ref"]);
    let edit = repo.open();
    assert_eq!(edit.bytes(), original);
    let replacement = [b"\x00\xff\xfe".as_slice(), original.as_slice(), b"\x80\x00"].concat();
    let saved = edit
        .save(&replacement, &CancellationToken::default(), || Ok(()))
        .unwrap();
    assert_eq!(saved.status, WorkingFileWriteStatus::Saved);
    assert!(saved.warning.is_none());
    assert_eq!(fs::read(repo.path()).unwrap(), replacement);
    assert!(edit.verify_current(&CancellationToken::default()).is_err());
    saved
        .next
        .unwrap()
        .verify_current(&CancellationToken::default())
        .unwrap();
    assert_eq!(fs::metadata(repo.path()).unwrap().mode() & 0o777, 0o755);
    let mut attribute = [0u8; 32];
    let size = rustix::fs::fgetxattr(
        fs::File::open(repo.path()).unwrap(),
        "user.owned-byte-write",
        &mut attribute[..],
    )
    .unwrap();
    assert_eq!(&attribute[..size], b"retained");
    assert_eq!(fs::read(repo.0.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(repo.0.join(".git/config")).unwrap(), config);
    assert_eq!(repo.git(&["show-ref"]), refs);
    repo.no_temporaries();
}
#[test]
fn working_file_bytes_unchanged_unborn_detached_and_sha256_save_without_text_interpretation() {
    for format in ["sha1", "sha256"] {
        let repo = Repository::new(format);
        fs::write(repo.path(), b"\xff\x00original").unwrap();
        let edit = repo.open();
        let before = fs::metadata(repo.path()).unwrap();
        let saved = edit
            .save(edit.bytes(), &CancellationToken::default(), || Ok(()))
            .unwrap();
        assert_eq!(saved.status, WorkingFileWriteStatus::Unchanged);
        assert!(saved.warning.is_none());
        assert_eq!(fs::metadata(repo.path()).unwrap().ino(), before.ino());
        assert!(!repo.0.join(".git/index").exists());
        repo.git(&["add", "--all"]);
        repo.git(&["commit", "-qm", "Owned bytes"]);
        repo.git(&["checkout", "-q", "--detach"]);
        let saved = repo
            .open()
            .save(b"\x00new\xff", &CancellationToken::default(), || Ok(()))
            .unwrap();
        assert_eq!(saved.status, WorkingFileWriteStatus::Saved);
        assert_eq!(fs::read(repo.path()).unwrap(), b"\x00new\xff");
        repo.no_temporaries();
    }
}
#[test]
fn working_file_bytes_guard_refusal_and_post_guard_changes_never_overwrite_external_bytes() {
    for refuse in [false, true] {
        let repo = Repository::new("sha1");
        fs::write(repo.path(), b"original").unwrap();
        let edit = repo.open();
        let result = edit.save(b"intended", &CancellationToken::default(), || {
            fs::write(repo.path(), b"external change").unwrap();
            if refuse {
                Err(refused("Owned changed index guard"))
            } else {
                Ok(())
            }
        });
        assert!(result.is_err());
        assert_eq!(fs::read(repo.path()).unwrap(), b"external change");
        repo.no_temporaries();
    }
}
#[test]
fn working_file_bytes_cancel_oversize_and_read_only_refuse_without_consuming_valid_review() {
    let repo = Repository::new("sha1");
    fs::write(repo.path(), b"original").unwrap();
    let edit = repo.open();
    let cancelled = CancellationToken::default();
    cancelled.cancel();
    assert!(edit.save(b"cancelled", &cancelled, || Ok(())).is_err());
    assert!(
        edit.save(
            &vec![0; MAX_FILE_CONTENT_BYTES + 1],
            &CancellationToken::default(),
            || Ok(())
        )
        .is_err()
    );
    edit.verify_current(&CancellationToken::default()).unwrap();
    assert_eq!(fs::read(repo.path()).unwrap(), b"original");
    fs::set_permissions(repo.path(), fs::Permissions::from_mode(0o444)).unwrap();
    assert!(
        repo.open()
            .save(b"refused", &CancellationToken::default(), || Ok(()))
            .is_err()
    );
    repo.no_temporaries();
}
#[test]
fn working_file_bytes_refuses_replaced_symlink_and_branch_context_even_with_identical_bytes() {
    let repo = Repository::new("sha1");
    fs::write(repo.path(), b"original").unwrap();
    repo.git(&["add", "--all"]);
    repo.git(&["commit", "-qm", "Owned baseline"]);
    let edit = repo.open();
    repo.git(&["checkout", "-q", "-b", "other"]);
    assert!(
        edit.save(b"refused", &CancellationToken::default(), || Ok(()))
            .is_err()
    );
    let edit = repo.open();
    fs::rename(repo.path(), repo.0.join("retained")).unwrap();
    symlink(repo.0.join("retained"), repo.path()).unwrap();
    assert!(
        edit.save(b"refused", &CancellationToken::default(), || Ok(()))
            .is_err()
    );
    assert!(
        WorkingFileBytesEdit::capture(&repo.0, "literal [file].bin", &CancellationToken::default())
            .is_err()
    );
    assert_eq!(fs::read(repo.0.join("retained")).unwrap(), b"original");
    repo.no_temporaries();
}
