//! Original process-isolated real-Git handoff fixtures; external protocols blocked.
use git_khronos_git_core as core;
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

const CHILD: &str = "GIT_KHRONOS_GITLAB_CLONE_FIXTURE";
const HTTPS: &str = "https://git.example.test/group/sub/project.git";
const SSH: &str = "ssh://git@ssh.example.test:2222/group/sub/project.git";

struct Fixture(PathBuf);
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
fn isolated(name: &str, action: impl FnOnce(&Path)) {
    if let Some(root) = std::env::var_os(CHILD) {
        action(Path::new(&root));
        return;
    }
    let mut random = [0; 16];
    getrandom::fill(&mut random).unwrap();
    let root = std::env::temp_dir().join(format!(
        "khronos-gitlab-clone-real-{:x}",
        u128::from_le_bytes(random)
    ));
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(&root).unwrap();
    let fixture = Fixture(root);
    fs::write(fixture.0.join("global"), "").unwrap();
    fs::write(fixture.0.join("system"), "").unwrap();
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args(["--exact", name, "--nocapture", "--test-threads=1"])
        .current_dir(&fixture.0)
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .env("HOME", &fixture.0)
        .env("XDG_CONFIG_HOME", &fixture.0)
        .env("GIT_CONFIG_GLOBAL", fixture.0.join("global"))
        .env("GIT_CONFIG_SYSTEM", fixture.0.join("system"))
        .env("GIT_CONFIG_NOSYSTEM", "0")
        .env("GIT_ALLOW_PROTOCOL", "file")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env(CHILD, &fixture.0);
    #[cfg(windows)]
    if let Some(value) = std::env::var_os("SystemRoot") {
        command.env("SystemRoot", value);
    }
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
fn git(root: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().into()
}
fn source(root: &Path, populated: bool) -> PathBuf {
    let path = root.join("source");
    fs::create_dir(&path).unwrap();
    git(&path, &["init", "-q", "-b", "main"]);
    git(&path, &["config", "user.name", "Owned Clone Fixture"]);
    git(&path, &["config", "user.email", "clone@example.test"]);
    git(&path, &["config", "commit.gpgsign", "false"]);
    git(&path, &["config", "core.hooksPath", "/dev/null"]);
    if populated {
        fs::write(path.join("owned.txt"), "first").unwrap();
        git(&path, &["add", "--", "owned.txt"]);
        git(&path, &["commit", "-qm", "first"]);
        git(&path, &["switch", "-qc", "topic/literal"]);
        fs::write(path.join("owned.txt"), "second").unwrap();
        git(&path, &["commit", "-qam", "second"]);
    }
    path
}
fn route(root: &Path, source: &Path) {
    let url = url::Url::from_file_path(source).unwrap();
    fs::write(
        root.join("global"),
        format!("[url \"{url}\"]\n\tinsteadOf = {HTTPS}\n\tinsteadOf = {SSH}\n"),
    )
    .unwrap();
}
struct ReadPort {
    requests: Vec<String>,
}
impl core::GitLabReadTransport for ReadPort {
    fn get(
        &mut self,
        instance: &core::GitLabInstance,
        endpoint: &str,
        _: &core::CancellationToken,
    ) -> Result<Value, core::AppError> {
        assert_eq!(instance.origin(), "https://gitlab.example.test:8443");
        self.requests.push(endpoint.into());
        Ok(match endpoint {
            "user" => json!({"id":41,"username":"owned-reader"}),
            "projects/9007199254740993" => json!({"id":9007199254740993u64,"name":"Owned",
                "path_with_namespace":"group/sub/project","web_url":"https://gitlab.example.test:8443/group/sub/project",
                "default_branch":null,"description":null,"archived":false,"visibility":"private",
                "http_url_to_repo":HTTPS,"ssh_url_to_repo":SSH}),
            _ => panic!("unexpected read {endpoint}"),
        })
    }
}
fn plan(
    root: &Path,
    port: &mut ReadPort,
    transport: core::HostedCloneTransport,
    branch: Option<&str>,
    depth: Option<u32>,
    recurse: bool,
) -> core::GitLabClonePlan {
    let instance = core::GitLabInstance::parse("https://gitlab.example.test:8443").unwrap();
    let account = core::GitLabAccount {
        origin: instance.origin().into(),
        id: "41".into(),
        login: "owned-reader".into(),
    };
    core::prepare_gitlab_clone_with(
        port,
        &instance,
        &account,
        core::GitLabCloneRequest {
            project_id: "9007199254740993".into(),
            full_path: "group/sub/project".into(),
            transport,
            parent_path: root.to_str().unwrap().into(),
            folder: "cloned".into(),
            branch: branch.map(str::to_owned),
            depth,
            recurse_submodules: recurse,
        },
        &core::CancellationToken::default(),
    )
    .unwrap()
}

#[test]
fn gitlab_clone_real_https_handoff_preserves_literal_branch_and_shallow_depth() {
    isolated(
        "gitlab_clone_real_https_handoff_preserves_literal_branch_and_shallow_depth",
        |root| {
            let source = source(root, true);
            route(root, &source);
            let mut port = ReadPort { requests: vec![] };
            let plan = plan(
                root,
                &mut port,
                core::HostedCloneTransport::Https,
                Some("topic/literal"),
                Some(1),
                false,
            );
            assert!(!root.join("cloned").exists());
            let cloned = core::execute_gitlab_clone_with(
                &mut port,
                &plan,
                &core::CancellationToken::default(),
            )
            .unwrap();
            assert_eq!(git(&cloned, &["branch", "--show-current"]), "topic/literal");
            assert_eq!(
                git(&cloned, &["rev-parse", "--is-shallow-repository"]),
                "true"
            );
            assert_eq!(git(&cloned, &["rev-list", "--count", "HEAD"]), "1");
            assert_eq!(
                fs::read_to_string(cloned.join("owned.txt")).unwrap(),
                "second"
            );
            assert_eq!(
                git(&cloned, &["config", "--get", "remote.origin.url"]),
                HTTPS
            );
            assert_eq!(
                port.requests,
                [
                    "user",
                    "projects/9007199254740993",
                    "user",
                    "user",
                    "projects/9007199254740993",
                    "user"
                ]
            );
        },
    );
}

#[test]
fn gitlab_clone_real_ssh_handoff_accepts_empty_repository() {
    isolated(
        "gitlab_clone_real_ssh_handoff_accepts_empty_repository",
        |root| {
            let source = source(root, false);
            route(root, &source);
            let mut port = ReadPort { requests: vec![] };
            let plan = plan(
                root,
                &mut port,
                core::HostedCloneTransport::Ssh,
                None,
                None,
                false,
            );
            let cloned = core::execute_gitlab_clone_with(
                &mut port,
                &plan,
                &core::CancellationToken::default(),
            )
            .unwrap();
            assert!(cloned.join(".git/config").is_file());
            assert_eq!(git(&cloned, &["config", "--get", "remote.origin.url"]), SSH);
            assert!(git(&cloned, &["for-each-ref", "--format=%(refname)"]).is_empty());
        },
    );
}

#[test]
fn gitlab_clone_real_incomplete_submodule_keeps_superproject_and_reports_recovery() {
    isolated(
        "gitlab_clone_real_incomplete_submodule_keeps_superproject_and_reports_recovery",
        |root| {
            let source = source(root, true);
            let child = root.join("child");
            fs::create_dir(&child).unwrap();
            git(&child, &["init", "-q", "-b", "main"]);
            git(&child, &["config", "user.name", "Owned"]);
            git(&child, &["config", "user.email", "clone@example.test"]);
            git(
                &child,
                &[
                    "-c",
                    "commit.gpgsign=false",
                    "commit",
                    "--allow-empty",
                    "-qm",
                    "child",
                ],
            );
            git(
                &source,
                &[
                    "-c",
                    "protocol.file.allow=always",
                    "submodule",
                    "add",
                    "--",
                    child.to_str().unwrap(),
                    "nested",
                ],
            );
            git(
                &source,
                &[
                    "config",
                    "-f",
                    ".gitmodules",
                    "submodule.nested.url",
                    root.join("unavailable").to_str().unwrap(),
                ],
            );
            git(&source, &["add", "--", ".gitmodules", "nested"]);
            git(&source, &["commit", "-qm", "submodule"]);
            route(root, &source);
            let mut port = ReadPort { requests: vec![] };
            let plan = plan(
                root,
                &mut port,
                core::HostedCloneTransport::Https,
                None,
                None,
                true,
            );
            let error = core::execute_gitlab_clone_with(
                &mut port,
                &plan,
                &core::CancellationToken::default(),
            )
            .unwrap_err();
            assert_eq!(error.kind, "submoduleCloneIncomplete");
            assert_eq!(
                fs::read_to_string(root.join("cloned/owned.txt")).unwrap(),
                "second"
            );
            assert!(!git(&root.join("cloned"), &["rev-parse", "--verify", "HEAD"]).is_empty());
            assert!(error.hint.unwrap().contains("Submodules"));
        },
    );
}
