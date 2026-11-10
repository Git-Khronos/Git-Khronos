use git_khronos_git_core::clone_repository;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const CHILD: &str = "GIT_KHRONOS_OWNED_CLONE_POLICY_FIXTURE";
const REMOTE: &str = "https://example.test/repository.git";
const UNSAFE_RULE: &str = "[url \"https://fixture-user:fixture-not-a-secret@example.test/\"]\n\tinsteadOf = https://example.test/\n";

struct Fixture(PathBuf);

impl Drop for Fixture {
    fn drop(&mut self) {
        // This directory was exclusively created by this test, never user data.
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn isolated(name: &str, check: impl FnOnce(&Path)) {
    if let Some(root) = std::env::var_os(CHILD) {
        check(Path::new(&root));
        return;
    }
    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root =
        std::env::temp_dir().join(format!("khronos-clone-policy-{}-{id}", std::process::id()));
    let mut builder = fs::DirBuilder::new();
    builder.recursive(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(&root).unwrap();
    let fixture = Fixture(root);
    let global = fixture.0.join("global");
    let system = fixture.0.join("system");
    fs::write(&global, b"").unwrap();
    fs::write(&system, b"").unwrap();
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args(["--exact", name, "--nocapture", "--test-threads=1"])
        .current_dir(&fixture.0)
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .env("GIT_CONFIG_GLOBAL", &global)
        .env("GIT_CONFIG_SYSTEM", &system)
        .env("GIT_CONFIG_NOSYSTEM", "0")
        // A failed policy check must never send even synthetic credentials.
        .env("GIT_ALLOW_PROTOCOL", "file")
        .env(CHILD, &fixture.0);
    #[cfg(windows)]
    if let Some(system_root) = std::env::var_os("SystemRoot") {
        command.env("SystemRoot", system_root);
    }
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "isolated clone policy failed: {}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn reject(root: &Path) {
    let error = clone_repository(REMOTE, root, "destination", None, None).unwrap_err();
    assert_eq!(error.kind, "credentialsInUrl");
    assert!(!error.message.contains("fixture-not-a-secret"));
    assert!(!root.join("destination").exists());
}

fn git(root: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn safe_rule(root: &Path) -> String {
    let source = root.join("source.git");
    git(root, &["init", "--bare", source.to_str().unwrap()]);
    format!(
        "[url \"{}\"]\n\tinsteadOf = {REMOTE}\n",
        source.to_str().unwrap().replace('\\', "/")
    )
}

fn accept(root: &Path) {
    let result = clone_repository(REMOTE, root, "destination", None, None).unwrap();
    assert_eq!(result, root.join("destination").canonicalize().unwrap());
    assert!(result.join(".git/config").is_file());
    assert!(root.join("source.git/HEAD").is_file());
}

fn template(root: &Path, config: &str) {
    fs::create_dir(root.join("template")).unwrap();
    fs::write(
        root.join("template/config"),
        format!("[core]\n\tbare = false\n{config}"),
    )
    .unwrap();
    fs::write(
        root.join("template/owned-marker"),
        b"retain template contents",
    )
    .unwrap();
    fs::write(
        root.join("global"),
        format!(
            "[init]\n\ttemplateDir = {}\n[transfer]\n\tcredentialsInUrl = allow\n",
            root.join("template").to_str().unwrap().replace('\\', "/")
        ),
    )
    .unwrap();
}

#[test]
fn clone_rejects_template_http_password_despite_configured_allow() {
    isolated(
        "clone_rejects_template_http_password_despite_configured_allow",
        |root| {
            template(root, UNSAFE_RULE);
            reject(root);
        },
    );
}

#[test]
fn clone_rejects_template_ssh_password_despite_configured_allow() {
    isolated(
        "clone_rejects_template_ssh_password_despite_configured_allow",
        |root| {
            template(
                root,
                &UNSAFE_RULE.replace("https://fixture-user:", "ssh://fixture-user:"),
            );
            reject(root);
        },
    );
}

#[test]
fn clone_preserves_safe_template_rewrite_and_files() {
    isolated("clone_preserves_safe_template_rewrite_and_files", |root| {
        let safe = safe_rule(root);
        template(root, &safe);
        accept(root);
        assert_eq!(
            fs::read(root.join("destination/.git/owned-marker")).unwrap(),
            b"retain template contents"
        );
    });
}

#[test]
fn clone_rejects_global_credential_rewrite_before_transport() {
    isolated(
        "clone_rejects_global_credential_rewrite_before_transport",
        |root| {
            fs::write(root.join("global"), UNSAFE_RULE).unwrap();
            reject(root);
        },
    );
}

#[test]
fn clone_rejects_system_credential_rewrite_before_transport() {
    isolated(
        "clone_rejects_system_credential_rewrite_before_transport",
        |root| {
            fs::write(root.join("system"), UNSAFE_RULE).unwrap();
            reject(root);
        },
    );
}

#[test]
fn clone_rejects_destination_conditional_credential_rewrite() {
    isolated(
        "clone_rejects_destination_conditional_credential_rewrite",
        |root| {
            fs::write(root.join("rule"), UNSAFE_RULE).unwrap();
            fs::write(
                root.join("global"),
                format!(
                    "[includeIf \"gitdir:{}/destination/.git\"]\n\tpath = {}/rule\n",
                    root.display(),
                    root.display()
                ),
            )
            .unwrap();
            reject(root);
        },
    );
}

#[test]
fn clone_rejects_remote_conditional_credential_rewrite() {
    isolated(
        "clone_rejects_remote_conditional_credential_rewrite",
        |root| {
            fs::write(root.join("rule"), UNSAFE_RULE).unwrap();
            fs::write(
                root.join("global"),
                format!(
                    "[includeIf \"hasconfig:remote.*.url:{REMOTE}\"]\n\tpath = {}/rule\n",
                    root.display()
                ),
            )
            .unwrap();
            reject(root);
        },
    );
}

#[test]
fn clone_ignores_unrelated_parent_local_and_conditional_urls() {
    isolated(
        "clone_ignores_unrelated_parent_local_and_conditional_urls",
        |root| {
            let safe = safe_rule(root);
            git(root, &["init", "-b", "main"]);
            fs::write(
                root.join(".git/config"),
                format!("[core]\n\tbare = false\n{UNSAFE_RULE}"),
            )
            .unwrap();
            fs::write(root.join("rule"), UNSAFE_RULE).unwrap();
            fs::write(
                root.join("global"),
                format!(
                    "[includeIf \"gitdir:{}/.git\"]\n\tpath = {}/rule\n{safe}",
                    root.display(),
                    root.display()
                ),
            )
            .unwrap();
            let config = fs::read(root.join(".git/config")).unwrap();
            accept(root);
            assert_eq!(config, fs::read(root.join(".git/config")).unwrap());
        },
    );
}

#[test]
fn clone_ignores_unused_credential_rewrite() {
    isolated("clone_ignores_unused_credential_rewrite", |root| {
        let safe = safe_rule(root);
        let unused = UNSAFE_RULE.replace(
            "insteadOf = https://example.test/",
            "insteadOf = https://unused.example.test/",
        );
        fs::write(root.join("global"), format!("{unused}{safe}")).unwrap();
        accept(root);
    });
}

#[test]
fn clone_ignores_onbranch_include_before_checkout() {
    isolated("clone_ignores_onbranch_include_before_checkout", |root| {
        let safe = safe_rule(root);
        fs::write(
            root.join("rule"),
            UNSAFE_RULE.replace(
                "insteadOf = https://example.test/",
                &format!("insteadOf = {REMOTE}"),
            ),
        )
        .unwrap();
        fs::write(
            root.join("global"),
            format!("[init]\n\tdefaultBranch = main\n[includeIf \"onbranch:main\"]\n\tpath = {}/rule\n{safe}", root.display()),
        ).unwrap();
        accept(root);
    });
}

#[test]
fn clone_preserves_existing_destination_and_raw_credential_refusal() {
    isolated(
        "clone_preserves_existing_destination_and_raw_credential_refusal",
        |root| {
            fs::create_dir(root.join("destination")).unwrap();
            fs::write(root.join("destination/sentinel"), b"keep existing data").unwrap();
            let error = clone_repository(REMOTE, root, "destination", None, None).unwrap_err();
            assert_eq!(error.kind, "destinationExists");
            assert_eq!(
                fs::read(root.join("destination/sentinel")).unwrap(),
                b"keep existing data"
            );
            let error = clone_repository(
                "https://user:fixture-not-a-secret@example.test/repo",
                root,
                "other",
                None,
                None,
            )
            .unwrap_err();
            assert_eq!(error.kind, "credentialsInUrl");
            assert!(!root.join("other").exists());
        },
    );
}

#[test]
fn clone_refuses_invalid_configuration_without_leaving_destination() {
    isolated(
        "clone_refuses_invalid_configuration_without_leaving_destination",
        |root| {
            fs::write(root.join("global"), b"[malformed\n").unwrap();
            let error = clone_repository(REMOTE, root, "destination", None, None).unwrap_err();
            assert_eq!(error.kind, "remoteConfigurationUnavailable");
            assert!(!root.join("destination").exists());
        },
    );
}
