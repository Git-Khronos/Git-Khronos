//! Resolve the worktree's previous checkout without checking anything out.
use super::*;

pub fn previous_local_branch(path: &Path) -> Result<Option<String>, AppError> {
    without_lazy_fetch(|| {
        git_cancellation::inspect_within(Duration::from_secs(4), || {
            let worktree = run_git(path, &["rev-parse", "--is-inside-work-tree"])?;
            ensure_success(
                "identify the checkout for previous branch lookup",
                &worktree,
            )?;
            if worktree.stdout != b"true\n" {
                return Ok(None);
            }

            // Unlike rev-parse on @{-1}, this retains the original branch
            // spelling even if a tag with that name now exists.
            let (previous, truncated) =
                run_git_with_stdout_limit(path, &["check-ref-format", "--branch", "@{-1}"], 4096)?;
            if previous.status.code() == Some(128)
                && previous.stderr == b"fatal: '@{-1}' is not a valid branch name\n"
            {
                return Ok(None);
            }
            ensure_success("read the previous checkout from Git", &previous)?;
            let name = std::str::from_utf8(&previous.stdout)
                .ok()
                .and_then(|text| text.strip_suffix('\n'))
                .filter(|name| {
                    !truncated
                        && !name.is_empty()
                        && !name.contains(['\n', '\r', '\0'])
                        && !name.starts_with('-')
                });
            let Some(name) = name else { return Ok(None) };
            // Git can expand a previous detached checkout to a full object
            // ID. Never reinterpret it as a similarly named local branch.
            if validate_commit_oid(name).is_ok() {
                return Ok(None);
            }
            let reference = format!("refs/heads/{name}");
            let exists = run_git(path, &["show-ref", "--verify", "--quiet", &reference])?;
            if exists.status.code() == Some(1) {
                return Ok(None);
            }
            ensure_success("verify the exact previous local branch", &exists)?;

            let current = run_git(path, &["symbolic-ref", "--quiet", "HEAD"])?;
            if current.status.code() != Some(1) {
                ensure_success("read the current checkout branch", &current)?;
            }
            if current.stdout.strip_suffix(b"\n") == Some(reference.as_bytes()) {
                return Ok(None);
            }
            Ok(Some(reference))
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use isolated_git::IsolatedGit;

    fn git(path: &Path, args: &[&str]) -> String {
        let result = run_git(path, args).unwrap();
        ensure_success("prepare owned previous-branch fixture", &result).unwrap();
        String::from_utf8(result.stdout).unwrap().trim().to_owned()
    }

    fn repository() -> IsolatedGit {
        let scratch = IsolatedGit::new("test-previous-branch").unwrap();
        let path = scratch.path();
        git(path, &["init", "-q", "-b", "main"]);
        git(path, &["config", "user.name", "Checkout Fixture"]);
        git(path, &["config", "user.email", "checkout@example.test"]);
        git(path, &["config", "commit.gpgsign", "false"]);
        git(path, &["commit", "--allow-empty", "-qm", "Initial"]);
        scratch
    }

    #[test]
    fn previous_branch_uses_exact_local_namespace_and_keeps_dirty_checkout_unchanged() {
        let scratch = repository();
        let path = scratch.path();
        assert_eq!(previous_local_branch(path).unwrap(), None);
        git(path, &["tag", "main"]);
        git(path, &["switch", "-qc", "topic"]);
        fs::write(path.join("draft"), "leave me unchanged").unwrap();
        assert_eq!(
            previous_local_branch(path).unwrap().as_deref(),
            Some("refs/heads/main")
        );
        assert_eq!(git(path, &["symbolic-ref", "--short", "HEAD"]), "topic");
        assert_eq!(fs::read(path.join("draft")).unwrap(), b"leave me unchanged");
        git(path, &["branch", "-D", "main"]);
        assert_eq!(
            previous_local_branch(path).unwrap(),
            None,
            "the retained tag is not a branch"
        );
    }

    #[test]
    fn previous_branch_ignores_detached_history_but_can_return_to_a_branch_from_detached() {
        let scratch = repository();
        let path = scratch.path();
        let head = git(path, &["rev-parse", "HEAD"]);
        git(path, &["switch", "--detach", &head]);
        assert_eq!(
            previous_local_branch(path).unwrap().as_deref(),
            Some("refs/heads/main")
        );
        git(path, &["branch", &head]);
        git(path, &["switch", "-qc", "topic"]);
        assert_eq!(previous_local_branch(path).unwrap(), None);
    }

    #[test]
    fn previous_branch_reads_linked_head_log_instead_of_the_main_worktree_log() {
        let scratch = repository();
        let path = scratch.path();
        let worktree = path.join("linked");
        git(path, &["switch", "-qc", "primary-topic"]);
        git(
            path,
            &[
                "worktree",
                "add",
                "--quiet",
                "-b",
                "linked-base",
                worktree.to_str().unwrap(),
            ],
        );
        git(&worktree, &["switch", "-qc", "linked-topic"]);
        assert_eq!(
            previous_local_branch(path).unwrap().as_deref(),
            Some("refs/heads/main")
        );
        assert_eq!(
            previous_local_branch(&worktree).unwrap().as_deref(),
            Some("refs/heads/linked-base")
        );
    }
}
