use super::*;
use serde_json::{Value, json};

struct Fixture {
    root: PathBuf,
    repo: PathBuf,
    actor: Value,
    fork: Value,
    on_read: Option<Box<dyn FnOnce()>>,
}
impl Fixture {
    fn new() -> Self {
        let mut nonce = [0; 12];
        getrandom::fill(&mut nonce).unwrap();
        let root = std::env::temp_dir().join(format!(
            "khronos-fork-remote-{}",
            nonce.iter().map(|b| format!("{b:02x}")).collect::<String>()
        ));
        let repo = root.join("repository");
        fs::create_dir_all(&repo).unwrap();
        let source = json!({"id":101,"name":"source","full_name":"team/source","owner":{"id":90,"login":"team"},"html_url":"https://github.com/team/source","fork":false,"permissions":{"pull":true}});
        let fork = json!({"id":9007199254740993u64,"name":"fork","full_name":"owned/fork","owner":{"id":7,"login":"owned"},"html_url":"https://github.com/owned/fork","clone_url":"https://github.com/owned/fork.git","ssh_url":"git@github.com:owned/fork.git","fork":true,"source":{"id":101,"full_name":"team/source"},"parent":{"id":101,"full_name":"team/source"},"permissions":{"pull":true}});
        let fixture = Self {
            root,
            repo,
            actor: json!({"id":7,"login":"owned"}),
            fork,
            on_read: None,
        };
        fixture.git(&["init", "--initial-branch=main"]);
        fixture.git(&["config", "user.name", "Owned Fork Fixture"]);
        fixture.git(&["config", "user.email", "fork@example.test"]);
        fixture.git(&["config", "commit.gpgsign", "false"]);
        fixture.git(&["config", "core.hooksPath", "/dev/null"]);
        fs::write(fixture.repo.join("owned.txt"), "initial\n").unwrap();
        fixture.git(&["add", "--", "owned.txt"]);
        fixture.git(&["commit", "-qm", "Owned initial state"]);
        fixture.git(&[
            "remote",
            "add",
            "origin",
            "https://github.com/team/source.git",
        ]);
        fs::write(
            fixture.root.join("source.json"),
            serde_json::to_vec(&source).unwrap(),
        )
        .unwrap();
        fixture
    }
    fn git(&self, args: &[&str]) -> String {
        let result = run_git(&self.repo, args).unwrap();
        assert!(
            result.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        String::from_utf8(result.stdout).unwrap().trim().into()
    }
    fn request(&self) -> HostedForkRemoteRequest {
        HostedForkRemoteRequest {
            source_remote: "origin".into(),
            remote_name: "fork".into(),
            transport: HostedCloneTransport::Https,
            selection: HostedForkSelection {
                source_full_name: "team/source".into(),
                source_repository_id: "101".into(),
                account_id: "7".into(),
                fork_full_name: "owned/fork".into(),
                fork_repository_id: "9007199254740993".into(),
                fork_owner_id: "7".into(),
            },
        }
    }
    fn prepare(&mut self) -> HostedForkRemotePlan {
        let path = self.repo.clone();
        prepare_with(&path, &self.request(), self).unwrap()
    }
    fn apply(&mut self, plan: &HostedForkRemotePlan) -> Result<HostedForkRemoteReceipt, AppError> {
        let path = self.repo.clone();
        execute_with(&path, plan, self, &CancellationToken::default())
    }
    fn config(&self) -> Vec<u8> {
        fs::read(self.repo.join(".git/config")).unwrap()
    }
}
impl Transport for Fixture {
    fn get(&mut self, endpoint: &str) -> Result<Value, AppError> {
        if let Some(action) = self.on_read.take() {
            action();
        }
        Ok(match endpoint {
            "user" => self.actor.clone(),
            "repos/team/source" => {
                serde_json::from_slice(&fs::read(self.root.join("source.json")).unwrap()).unwrap()
            }
            "repos/owned/fork" => self.fork.clone(),
            _ => panic!("Unowned endpoint {endpoint}"),
        })
    }
    fn write(&mut self, _: &'static str, _: &str, _: &Value) -> Result<Value, AppError> {
        panic!("Local attachment must never write to a provider")
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn fork_remote_review_and_atomic_add_preserve_config_refs_index_and_dirty_bytes() {
    let mut fixture = Fixture::new();
    fixture.git(&["config", "branch.main.remote", "origin"]);
    fixture.git(&["config", "branch.main.merge", "refs/heads/main"]);
    fixture.git(&["config", "owned.privateToken", "owned-private-config-token"]);
    fixture.git(&[
        "config",
        "remote.origin.pushurl",
        "git@github.com:team/source.git",
    ]);
    fs::write(fixture.repo.join("owned.txt"), "dirty retained\n").unwrap();
    let before = fixture.config();
    let refs = fixture.git(&["show-ref"]);
    let index = fs::read(fixture.repo.join(".git/index")).unwrap();
    let plan = fixture.prepare();
    assert_eq!(fixture.config(), before);
    assert_eq!(plan.existing_remote_names, ["origin"]);
    assert!(!serde_json::to_string(&plan).unwrap().contains("effective"));
    assert!(
        !serde_json::to_string(&plan)
            .unwrap()
            .contains("owned-private-config-token")
    );
    assert!(!format!("{plan:?}").contains("owned-private-config-token"));
    let receipt = fixture.apply(&plan).unwrap();
    assert_eq!(receipt.url, "https://github.com/owned/fork.git");
    assert!(fixture.config().starts_with(&before));
    assert_eq!(fixture.git(&["remote", "get-url", "fork"]), receipt.url);
    assert_eq!(
        fixture.git(&["config", "--get-all", "remote.fork.fetch"]),
        "+refs/heads/*:refs/remotes/fork/*"
    );
    assert_eq!(
        fixture.git(&["config", "--get", "remote.origin.pushurl"]),
        "git@github.com:team/source.git"
    );
    assert_eq!(
        fixture.git(&["config", "--get", "branch.main.remote"]),
        "origin"
    );
    assert_eq!(fixture.git(&["show-ref"]), refs);
    assert_eq!(fs::read(fixture.repo.join(".git/index")).unwrap(), index);
    assert_eq!(
        fs::read_to_string(fixture.repo.join("owned.txt")).unwrap(),
        "dirty retained\n"
    );
    assert!(!fixture.repo.join(".git/config.lock").exists());
    let saved = fixture.config();
    assert!(fixture.apply(&plan).is_err());
    assert_eq!(fixture.config(), saved);
}

#[test]
fn fork_remote_ssh_quotes_remote_subsections_and_values() {
    let mut fixture = Fixture::new();
    let path = fixture.repo.clone();
    let mut request = fixture.request();
    request.remote_name = "review\";#fork".into();
    request.transport = HostedCloneTransport::Ssh;
    let plan = prepare_with(&path, &request, &mut fixture).unwrap();
    fixture.apply(&plan).unwrap();
    assert_eq!(
        fixture.git(&["remote", "get-url", &request.remote_name]),
        "git@github.com:owned/fork.git"
    );
    assert_eq!(
        fixture.git(&[
            "config",
            "--get",
            &format!("remote.{}.fetch", request.remote_name)
        ]),
        format!("+refs/heads/*:refs/remotes/{}/*", request.remote_name)
    );
}

#[test]
fn fork_remote_stale_local_and_included_configuration_refuse_without_losing_changes() {
    for included in [false, true] {
        let mut fixture = Fixture::new();
        let include = fixture.repo.join(".git/owned-extra");
        if included {
            fs::write(&include, "[owned]\nvalue=before\n").unwrap();
            fixture.git(&["config", "include.path", "owned-extra"]);
        }
        let plan = fixture.prepare();
        if included {
            fs::write(include, "[owned]\nvalue=after\n").unwrap();
        } else {
            fixture.git(&["config", "owned.value", "after"]);
        }
        let current = fixture.config();
        assert!(fixture.apply(&plan).is_err());
        assert_eq!(fixture.config(), current);
        assert_eq!(fixture.git(&["config", "--get", "owned.value"]), "after");
        assert!(!fixture.repo.join(".git/config.lock").exists());
    }
}

#[test]
fn fork_remote_collision_and_existing_git_lock_preserve_owned_files() {
    let mut fixture = Fixture::new();
    let plan = fixture.prepare();
    let lock = fixture.repo.join(".git/config.lock");
    fs::write(&lock, "foreign Git writer\n").unwrap();
    let before = fixture.config();
    assert!(fixture.apply(&plan).is_err());
    assert_eq!(fixture.config(), before);
    assert_eq!(fs::read_to_string(&lock).unwrap(), "foreign Git writer\n");
    fs::remove_file(lock).unwrap();
    fixture.git(&[
        "remote",
        "add",
        "fork",
        "https://github.com/unrelated/repository.git",
    ]);
    let before = fixture.config();
    assert!(fixture.apply(&plan).is_err());
    assert_eq!(fixture.config(), before);
    let path = fixture.repo.clone();
    assert!(prepare_with(&path, &fixture.request(), &mut fixture).is_err());
}

#[test]
fn fork_remote_account_network_owner_and_client_plan_edits_refuse_before_local_write() {
    for change in 0..8 {
        let mut fixture = Fixture::new();
        let mut plan = fixture.prepare();
        let before = fixture.config();
        match change {
            0 => fixture.actor["id"] = json!(8),
            1 => fixture.fork["source"]["id"] = json!(999),
            2 => fixture.fork["owner"]["id"] = json!(8),
            3 => plan.url = "https://github.com/foreign/repository.git".into(),
            4 => plan.remote_name = "client-altered".into(),
            5 => plan.transport = HostedCloneTransport::Ssh,
            6 => plan.repository_path = "client-altered".into(),
            _ => plan.network.id = "client-altered".into(),
        }
        assert!(fixture.apply(&plan).is_err(), "change {change}");
        assert_eq!(fixture.config(), before);
    }
}

#[test]
fn fork_remote_changed_network_root_refuses_even_when_source_and_fork_ids_stay_the_same() {
    let mut fixture = Fixture::new();
    let source_path = fixture.root.join("source.json");
    let mut source: Value = serde_json::from_slice(&fs::read(&source_path).unwrap()).unwrap();
    source["fork"] = json!(true);
    source["source"] = json!({"id":100,"full_name":"team/network-root"});
    fixture.fork["source"] = source["source"].clone();
    fs::write(&source_path, serde_json::to_vec(&source).unwrap()).unwrap();
    let plan = fixture.prepare();
    let before = fixture.config();
    source["source"] = json!({"id":200,"full_name":"another/network-root"});
    fixture.fork["source"] = source["source"].clone();
    fs::write(source_path, serde_json::to_vec(&source).unwrap()).unwrap();
    assert!(fixture.apply(&plan).is_err());
    assert_eq!(fixture.config(), before);
}

#[test]
fn fork_remote_configuration_changed_during_provider_reads_is_preserved() {
    let mut fixture = Fixture::new();
    let plan = fixture.prepare();
    let config = fixture.repo.join(".git/config");
    fixture.on_read = Some(Box::new(move || {
        let mut file = fs::OpenOptions::new().append(true).open(config).unwrap();
        file.write_all(b"\n[owned]\nvalue=changed-during-read\n")
            .unwrap();
    }));
    assert!(fixture.apply(&plan).is_err());
    assert_eq!(
        fixture.git(&["config", "--get", "owned.value"]),
        "changed-during-read"
    );
    assert_eq!(fixture.git(&["remote"]), "origin");
}

#[test]
fn fork_remote_cancellation_and_expired_review_never_create_a_remote() {
    let mut fixture = Fixture::new();
    let mut plan = fixture.prepare();
    let before = fixture.config();
    let cancellation = CancellationToken::default();
    cancellation.cancel();
    let path = fixture.repo.clone();
    assert_eq!(
        execute_with(&path, &plan, &mut fixture, &cancellation)
            .unwrap_err()
            .kind,
        "operationCancelled"
    );
    plan.created = Instant::now() - Duration::from_secs(16 * 60);
    assert!(fixture.apply(&plan).is_err());
    assert_eq!(fixture.config(), before);
}

#[test]
fn fork_remote_url_rewrites_require_a_separate_explicit_configuration_review() {
    for key in ["insteadOf", "pushInsteadOf"] {
        let mut fixture = Fixture::new();
        fixture.git(&[
            "config",
            &format!("url.ssh://owned.invalid/.{key}"),
            "https://github.com/owned/",
        ]);
        let path = fixture.repo.clone();
        let before = fixture.config();
        assert!(prepare_with(&path, &fixture.request(), &mut fixture).is_err());
        assert_eq!(fixture.config(), before);
    }
}

#[cfg(unix)]
#[test]
fn fork_remote_symlinked_config_is_not_replaced() {
    let mut fixture = Fixture::new();
    let config = fixture.repo.join(".git/config");
    let original = fixture.root.join("retained-config");
    fs::rename(&config, &original).unwrap();
    std::os::unix::fs::symlink(&original, &config).unwrap();
    let before = fs::read(&original).unwrap();
    let path = fixture.repo.clone();
    assert!(prepare_with(&path, &fixture.request(), &mut fixture).is_err());
    assert_eq!(fs::read(original).unwrap(), before);
    assert!(config.is_symlink());
}

#[test]
fn fork_remote_linked_worktree_updates_only_shared_remote_configuration() {
    let mut fixture = Fixture::new();
    let common = fixture.repo.join(".git");
    let linked = fixture.root.join("linked-worktree");
    fixture.git(&[
        "worktree",
        "add",
        "--detach",
        linked.to_str().unwrap(),
        "HEAD",
    ]);
    let before = fs::read(common.join("config")).unwrap();
    let refs = fixture.git(&["show-ref"]);
    let index = fs::read(common.join("index")).unwrap();
    fixture.repo = linked;
    let git_dir = PathBuf::from(fixture.git(&["rev-parse", "--absolute-git-dir"]));
    let linked_index = fs::read(git_dir.join("index")).unwrap();
    let plan = fixture.prepare();
    fixture.apply(&plan).unwrap();
    assert!(
        fs::read(common.join("config"))
            .unwrap()
            .starts_with(&before)
    );
    assert!(!git_dir.join("config").exists());
    assert_eq!(
        fixture.git(&["remote", "get-url", "fork"]),
        "https://github.com/owned/fork.git"
    );
    assert_eq!(fixture.git(&["show-ref"]), refs);
    assert_eq!(fs::read(common.join("index")).unwrap(), index);
    assert_eq!(fs::read(git_dir.join("index")).unwrap(), linked_index);
}

#[test]
fn fork_remote_empty_and_bare_repositories_need_no_checkout_or_commit() {
    for bare in [false, true] {
        let mut fixture = Fixture::new();
        fixture.repo = fixture.root.join("empty");
        fs::create_dir(&fixture.repo).unwrap();
        if bare {
            fixture.git(&["init", "--bare"]);
        } else {
            fixture.git(&["init"]);
        }
        fixture.git(&[
            "remote",
            "add",
            "origin",
            "https://github.com/team/source.git",
        ]);
        let plan = fixture.prepare();
        fixture.apply(&plan).unwrap();
        assert_eq!(
            fixture.git(&["remote", "get-url", "fork"]),
            "https://github.com/owned/fork.git"
        );
        assert!(
            fixture
                .git(&["for-each-ref", "--format=%(refname)"])
                .is_empty()
        );
    }
}

#[cfg(unix)]
#[test]
fn fork_remote_cleanup_never_removes_a_replacement_git_lock() {
    let fixture = Fixture::new();
    let path = fixture.repo.join(".git/config.lock");
    let file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .unwrap();
    let lock = ConfigLock {
        path: path.clone(),
        file,
        published: false,
    };
    fs::rename(&path, fixture.repo.join(".git/retired-owned-lock")).unwrap();
    fs::write(&path, "another Git writer\n").unwrap();
    drop(lock);
    assert_eq!(fs::read_to_string(path).unwrap(), "another Git writer\n");
}
