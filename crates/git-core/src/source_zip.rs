use super::*;
use isolated_git::IsolatedGit;

const MAX_ZIP_BYTES: usize = 64 * 1024 * 1024;
const ARCHIVE_DEADLINE: Duration = Duration::from_secs(30);

fn refused(message: impl Into<String>) -> AppError {
    AppError::new(
        "sourceArchiveRefused",
        message,
        Some("No ZIP was written. Review the commit and try again, or use local Git."),
    )
}

fn storage_error(error: std::io::Error) -> AppError {
    refused(format!(
        "Could not prepare or clean up source archive storage: {error}"
    ))
}

fn archive_bytes(
    path: &Path,
    oid: &str,
    cancellation: &CancellationToken,
    limit: usize,
) -> Result<Vec<u8>, AppError> {
    let scratch = IsolatedGit::for_local_objects(path, "source-archive", cancellation)?;
    let oid = scratch.exact_commit(oid, cancellation)?;
    let prefix = format!("--prefix=source-{}/", &oid[..12]);
    let (archive, truncated) = run_cancellable_command_with_stdout_limit(
        scratch.command(&["archive", "--format=zip", &prefix, &oid]),
        cancellation,
        Some(limit),
    )?;
    if truncated {
        return Err(refused(
            "The compressed archive exceeds 64 MiB. Use local Git for larger exports.",
        ));
    }
    ensure_success("archive the selected source commit", &archive)?;
    // Git includes the commit ID as the ZIP comment for commit archives.
    if !archive.stdout.starts_with(b"PK\x03\x04") || !archive.stdout.ends_with(oid.as_bytes()) {
        return Err(refused("Git did not return a ZIP for the selected commit."));
    }
    scratch.remove().map_err(storage_error)?;
    Ok(archive.stdout)
}

/// Export committed files, excluding uncommitted work and repository data.
/// Neither local archive filters nor ambient configuration can run during packing.
pub fn export_source_zip(
    path: &Path,
    oid: &str,
    destination: &Path,
    cancellation: &CancellationToken,
) -> Result<usize, AppError> {
    let result = without_lazy_fetch_cancellable(cancellation, || {
        git_cancellation::inspect_within(ARCHIVE_DEADLINE, || {
            archive_bytes(path, oid, cancellation, MAX_ZIP_BYTES)
        })
    });
    let archive = result.map_err(|error| {
        if error.kind == "gitInspectionTimeout" {
            refused("The offline archive did not finish within 30 seconds.")
        } else {
            error
        }
    })?;
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    // Once the exclusive write begins, return its real outcome even if a
    // cancellation request arrives while the file is being synchronized.
    exchange_files::write_new_exchange_file(path, destination, &archive)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        scratch: IsolatedGit,
        source: PathBuf,
    }

    impl Fixture {
        fn new(format: &str) -> Self {
            let scratch = IsolatedGit::new("test-source-archive").unwrap();
            let source = scratch.path().join("source");
            fs::create_dir(&source).unwrap();
            let fixture = Self { scratch, source };
            fixture.git(&["init", "-q", "-b", "main", format]);
            fixture.git(&["config", "user.name", "Archive Fixture"]);
            fixture.git(&["config", "user.email", "archive@example.test"]);
            fixture.git(&["config", "commit.gpgsign", "false"]);
            fixture
        }
        fn git(&self, args: &[&str]) -> Vec<u8> {
            let output = run_git(&self.source, args).unwrap();
            ensure_success("prepare source ZIP fixture", &output).unwrap();
            output.stdout
        }
        fn oid(&self) -> String {
            let oid = self.git(&["rev-parse", "HEAD"]);
            String::from_utf8(oid).unwrap().trim_end().to_owned()
        }
        fn zip(&self) -> PathBuf {
            self.scratch.path().join("source.zip")
        }
    }

    fn includes(bytes: &[u8], text: &str) -> bool {
        bytes
            .windows(text.len())
            .any(|part| part == text.as_bytes())
    }

    #[test]
    fn source_zip_pins_the_commit_and_ignores_configured_archive_filters() {
        let fixture = Fixture::new("--object-format=sha1");
        fs::write(fixture.source.join("checked.txt"), b"committed\n").unwrap();
        fs::write(fixture.source.join("hidden.txt"), b"excluded\n").unwrap();
        fs::write(
            fixture.source.join(".gitattributes"),
            b"hidden.txt export-ignore\n",
        )
        .unwrap();
        fixture.git(&["add", "."]);
        fixture.git(&["commit", "-qm", "Archive point"]);
        let oid = fixture.oid();
        fixture.git(&["commit", "--allow-empty", "-qm", "New head"]);
        fs::write(fixture.source.join("dirty.txt"), b"new staged file\n").unwrap();
        fixture.git(&["add", "dirty.txt"]);
        fs::write(fixture.source.join("checked.txt"), b"dirty working\n").unwrap();
        fs::write(
            fixture.source.join(".gitattributes"),
            b"checked.txt export-ignore\n",
        )
        .unwrap();
        fs::write(
            fixture.source.join(".git/info/attributes"),
            b"checked.txt export-ignore\n",
        )
        .unwrap();
        fixture.git(&[
            "config",
            "tar.zip.command",
            "echo incorrectly-configured-format",
        ]);
        let status = fixture.git(&["status", "--porcelain=v1"]);
        let refs = fixture.git(&["show-ref"]);
        let size = export_source_zip(
            &fixture.source,
            &oid,
            &fixture.zip(),
            &CancellationToken::default(),
        )
        .unwrap();
        let bytes = fs::read(fixture.zip()).unwrap();
        assert_eq!(bytes.len(), size);
        assert!(bytes.ends_with(oid.as_bytes()));
        assert!(includes(
            &bytes,
            &format!("source-{}/checked.txt", &oid[..12])
        ));
        let root = format!("source-{}/", &oid[..12]);
        assert!(!includes(&bytes, &(root.clone() + "hidden.txt")));
        assert!(!includes(&bytes, &(root + "dirty.txt")));
        assert_eq!(fixture.git(&["status", "--porcelain=v1"]), status);
        assert_eq!(fixture.git(&["show-ref"]), refs);
    }

    #[test]
    fn source_zip_refuses_noncommit_inside_checkout_existing_destination_and_missing_objects() {
        let fixture = Fixture::new("--object-format=sha1");
        fs::write(fixture.source.join("a.txt"), b"fixture\n").unwrap();
        fixture.git(&["add", "a.txt"]);
        fixture.git(&["commit", "-qm", "Archive point"]);
        let oid = fixture.oid();
        let token = CancellationToken::default();
        let blob = fixture.git(&["rev-parse", "HEAD:a.txt"]);
        let blob = std::str::from_utf8(&blob).unwrap().trim_end();
        let local = fixture.source.join("inside.zip");
        for (commit, path) in [
            (blob, fixture.zip()),
            (oid.as_str(), local.clone()),
            ("0000000000000000000000000000000000000000", fixture.zip()),
        ] {
            export_source_zip(&fixture.source, commit, &path, &token).unwrap_err();
            assert!(!path.exists());
        }
        fs::write(fixture.zip(), b"owner bytes").unwrap();
        export_source_zip(&fixture.source, &oid, &fixture.zip(), &token).unwrap_err();
        assert_eq!(fs::read(fixture.zip()).unwrap(), b"owner bytes");
        fixture.git(&["config", "remote.origin.promisor", "true"]);
        assert!(
            export_source_zip(&fixture.source, &oid, &local, &token)
                .unwrap_err()
                .message
                .contains("promisor")
        );
    }

    #[test]
    fn source_zip_supports_empty_sha256_commits_limits_and_cancellation() {
        let fixture = Fixture::new("--object-format=sha256");
        fixture.git(&["commit", "--allow-empty", "-qm", "Empty"]);
        let oid = fixture.oid();
        assert_eq!(oid.len(), 64);
        let token = CancellationToken::default();
        assert!(
            archive_bytes(&fixture.source, &oid, &token, 12)
                .unwrap_err()
                .message
                .contains("64 MiB")
        );
        token.cancel();
        assert_eq!(
            export_source_zip(&fixture.source, &oid, &fixture.zip(), &token)
                .unwrap_err()
                .kind,
            "operationCancelled"
        );
        assert!(!fixture.zip().exists());
        export_source_zip(
            &fixture.source,
            &oid,
            &fixture.zip(),
            &CancellationToken::default(),
        )
        .unwrap();
        assert!(fs::read(fixture.zip()).unwrap().ends_with(oid.as_bytes()));
    }

    #[test]
    fn source_zip_does_not_need_parents_of_a_shallow_boundary_commit() {
        let fixture = Fixture::new("--object-format=sha1");
        fixture.git(&["commit", "--allow-empty", "-qm", "Unavailable parent"]);
        fs::write(
            fixture.source.join("included.txt"),
            b"Only the local snapshot\n",
        )
        .unwrap();
        fixture.git(&["add", "included.txt"]);
        fixture.git(&["commit", "-qm", "Shallow tip"]);
        let oid = fixture.oid();
        let shallow = fixture.scratch.path().join("shallow");
        fixture.git(&[
            "clone",
            "--quiet",
            "--no-local",
            "--depth=1",
            fixture.source.to_str().unwrap(),
            shallow.to_str().unwrap(),
        ]);
        let depth = run_git(&shallow, &["rev-parse", "--is-shallow-repository"]).unwrap();
        assert_eq!(depth.stdout, b"true\n");
        export_source_zip(
            &shallow,
            &oid,
            &fixture.zip(),
            &CancellationToken::default(),
        )
        .unwrap();
        assert!(includes(&fs::read(fixture.zip()).unwrap(), "included.txt"));
    }
}
