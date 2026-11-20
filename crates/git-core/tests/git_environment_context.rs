//! Exercise inherited config-file selectors in child processes, never by
//! mutating the environment of parallel tests or touching personal config.
use git_khronos_git_core::{commit, review_push_destination, set_repository_identity, snapshot};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

const CHILD_ROOT: &str = "GIT_KHRONOS_CONFIG_CONTEXT_CHILD_ROOT";
const EXPECTED_STATE: &str = "GIT_KHRONOS_CONFIG_CONTEXT_EXPECTED_STATE";
const MARKER: &str = "owned Git configuration context fixture";

struct Fixture(PathBuf);
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn environment(command: &mut Command, root: &Path, count_policy: bool) {
    command
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default());
    for key in ["SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    command
        .env("GIT_CONFIG_SYSTEM", root.join("system.config"))
        .env("GIT_CONFIG_NOSYSTEM", "0")
        .env("GIT_CONFIG_GLOBAL", root.join("global.config"))
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C");
    if count_policy {
        command
            .env("GIT_CONFIG_COUNT", "1")
            .env("GIT_CONFIG_KEY_0", "user.email")
            .env("GIT_CONFIG_VALUE_0", "count-policy@example.test");
    }
}

fn git(root: &Path, args: &[&str]) -> String {
    let mut command = Command::new("git");
    environment(&mut command, root, false);
    let output = command
        .arg("-C")
        .arg(root.join("selected"))
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "Owned Git fixture failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

fn successful(output: Output) -> String {
    assert!(
        output.status.success(),
        "Native config context failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

fn exercise(name: &str, count_policy: bool) {
    let expected_email = if count_policy {
        "count-policy@example.test"
    } else {
        "global-policy@example.test"
    };
    if let Some(root) = std::env::var_os(CHILD_ROOT) {
        let root = PathBuf::from(root);
        assert!(
            root.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("git-khronos-config-context-")
        );
        assert_eq!(
            fs::read_to_string(root.join("owned-marker")).unwrap(),
            MARKER
        );
        let selected = root.join("selected");
        let review = review_push_destination(&selected, "origin").unwrap();
        if let Ok(expected) = std::env::var(EXPECTED_STATE) {
            assert_eq!(
                review.state, expected,
                "Legacy GIT_CONFIG changed the selected repository's native review evidence"
            );
        }
        let view = snapshot(&selected).unwrap();
        assert_eq!(view.identity.name.as_deref(), Some("Selected author"));
        assert_eq!(view.identity.email.as_deref(), Some(expected_email));
        assert_eq!(view.signing.format, "ssh");
        println!("REVIEW_STATE:{}", review.state);
        if std::env::var_os(EXPECTED_STATE).is_some() {
            commit(&selected, "Native selected-context commit").unwrap();
            set_repository_identity(
                &selected,
                "Edited selected author",
                "edited-local@example.test",
            )
            .unwrap();
            let edited = snapshot(&selected).unwrap();
            assert_eq!(
                edited.identity.name.as_deref(),
                Some("Edited selected author")
            );
            assert_eq!(
                edited.identity.email.as_deref(),
                Some(if count_policy {
                    expected_email
                } else {
                    "edited-local@example.test"
                })
            );
        }
        return;
    }
    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "git-khronos-config-context-{}-{id}",
        std::process::id()
    ));
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(&root).unwrap();
    let fixture = Fixture(root);
    let root = &fixture.0;
    fs::write(root.join("owned-marker"), MARKER).unwrap();
    fs::create_dir(root.join("selected")).unwrap();
    fs::write(root.join("system.config"), "[gpg]\n format = ssh\n").unwrap();
    fs::write(root.join("global.config"), "[user]\n name = Global fallback\n email = global-policy@example.test\n[commit]\n gpgSign = false\n").unwrap();
    fs::write(root.join("outside.config"), "[user]\n name = Outside author\n email = outside@example.test\n[remote \"origin\"]\n url = /owned/not-the-selected-destination.git\n").unwrap();
    git(root, &["init", "-q", "-b", "main"]);
    git(root, &["config", "--local", "user.name", "Selected author"]);
    git(
        root,
        &[
            "remote",
            "add",
            "origin",
            root.join("owned-read-only-destination.git")
                .to_str()
                .unwrap(),
        ],
    );
    fs::write(root.join("selected/owned.txt"), "Owned staged contents\n").unwrap();
    git(root, &["add", "owned.txt"]);
    let unchanged: Vec<_> = ["system.config", "global.config", "outside.config"]
        .into_iter()
        .map(|file| (root.join(file), fs::read(root.join(file)).unwrap()))
        .collect();
    let child = |legacy: bool, state: Option<&str>| {
        let mut command = Command::new(std::env::current_exe().unwrap());
        environment(&mut command, root, count_policy);
        command
            .args(["--exact", name, "--nocapture"])
            .env(CHILD_ROOT, root);
        if legacy {
            command.env("GIT_CONFIG", root.join("outside.config"));
        }
        if let Some(state) = state {
            command.env(EXPECTED_STATE, state);
        }
        command.output().unwrap()
    };
    let baseline = successful(child(false, None));
    let state = &baseline
        .split("REVIEW_STATE:")
        .nth(1)
        .expect("Native review evidence")[..64];
    successful(child(true, Some(state)));
    assert_eq!(
        git(root, &["show", "-s", "--format=%an|%ae", "HEAD"]),
        format!("Selected author|{expected_email}")
    );
    assert_eq!(
        git(root, &["config", "--local", "--get", "user.name"]),
        "Edited selected author"
    );
    assert_eq!(
        git(root, &["config", "--local", "--get", "user.email"]),
        "edited-local@example.test"
    );
    for (path, contents) in unchanged {
        assert_eq!(fs::read(path).unwrap(), contents);
    }
}

#[test]
fn legacy_git_config_cannot_redirect_selected_identity_or_review() {
    exercise(
        "legacy_git_config_cannot_redirect_selected_identity_or_review",
        false,
    );
}

#[test]
fn valid_system_global_and_count_configuration_remain_authoritative() {
    exercise(
        "valid_system_global_and_count_configuration_remain_authoritative",
        true,
    );
}
