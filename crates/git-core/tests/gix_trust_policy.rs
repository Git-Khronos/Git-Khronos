//! Dependency regression for reduced-trust path protection. This exercises an
//! in-memory index only: no crafted path is ever checked out onto the host.
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("git-khronos-gix-trust-{}-{id}", std::process::id()));
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&root).unwrap();
        let fixture = Self(root);
        fixture.git(&["init", "--bare", "--initial-branch=main", "."], b"");
        fixture.git(&["config", "core.protectNTFS", "false"], b"");
        fixture.git(&["config", "core.protectHFS", "false"], b"");
        fixture
    }

    fn git(&self, args: &[&str], input: &[u8]) -> Vec<u8> {
        let mut command = Command::new("git");
        command
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap_or_default())
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", self.0.join("absent-global-config"))
            .current_dir(&self.0)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        if let Some(system_root) = std::env::var_os("SystemRoot") {
            command.env("SystemRoot", system_root);
        }
        let mut child = command.spawn().unwrap();
        child.stdin.take().unwrap().write_all(input).unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "owned fixture Git command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        output.stdout
    }

    fn tree(&self, filename: &str) -> gix::ObjectId {
        let blob =
            String::from_utf8(self.git(&["hash-object", "-w", "--stdin"], b"fixture\n")).unwrap();
        let record = format!("100644 blob {}\t{filename}\n", blob.trim());
        let tree = self.git(&["mktree"], record.as_bytes());
        gix::ObjectId::from_hex(tree.trim_ascii()).unwrap()
    }

    fn open(&self, trust: gix::sec::Trust) -> gix::Repository {
        gix::open_opts(&self.0, gix::open::Options::isolated().with(trust)).unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // The non-recursive, exclusive creation above owns this entire directory.
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn reduced_trust_cannot_disable_ntfs_path_protection_in_repository_config() {
    let fixture = Fixture::new();
    let ordinary = fixture.tree("ordinary.txt");
    let alias = fixture.tree("GIT~1");
    let config_before = fs::read(fixture.0.join("config")).unwrap();
    let head_before = fs::read(fixture.0.join("HEAD")).unwrap();

    let reduced = fixture.open(gix::sec::Trust::Reduced);
    assert_eq!(
        reduced.index_from_tree(&ordinary).unwrap().entries().len(),
        1
    );
    assert!(
        reduced.index_from_tree(&alias).is_err(),
        "untrusted repository-local protectNTFS=false must not admit a .git alias"
    );

    // A trusted repository may explicitly opt out. This control ensures the
    // fixture tests section trust rather than unconditional name rejection.
    let trusted = fixture.open(gix::sec::Trust::Full);
    assert_eq!(trusted.index_from_tree(&alias).unwrap().entries().len(), 1);
    assert!(!fixture.0.join("index").exists());
    assert!(!fixture.0.join("GIT~1").exists());
    assert_eq!(fs::read(fixture.0.join("config")).unwrap(), config_before);
    assert_eq!(fs::read(fixture.0.join("HEAD")).unwrap(), head_before);
}
