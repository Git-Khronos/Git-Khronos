//! Private scratch repositories that cannot inherit source or host Git configuration.
use super::*;

pub(super) struct IsolatedGit(PathBuf);

impl IsolatedGit {
    /// Read local objects without taking the source repository's config,
    /// replacement refs, index or worktree into the new Git context.
    pub(super) fn for_local_objects(
        source: &Path,
        purpose: &str,
        cancellation: &CancellationToken,
    ) -> Result<Self, AppError> {
        exchange_files::require_local_exchange_objects(source)?;
        let common = run_git(
            source,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )?;
        ensure_success("locate Git metadata for isolated object access", &common)?;
        let objects = git_absolute_path(&common.stdout)?.join("objects");
        let object_path = objects
            .to_str()
            .filter(|value| objects.is_absolute() && !value.contains(['\n', '\r']))
            .ok_or_else(|| Self::storage_error("the alternate object path cannot be encoded"))?;
        let format = run_git(source, &["rev-parse", "--show-object-format"])?;
        ensure_success(
            "identify Git object format for isolated object access",
            &format,
        )?;
        let format = match format.stdout.as_slice() {
            b"sha1\n" => "--object-format=sha1",
            b"sha256\n" => "--object-format=sha256",
            _ => return Err(Self::storage_error("this Git object format is unsupported")),
        };
        let scratch = Self::new(purpose).map_err(Self::storage_error)?;
        scratch.init_with_alternate(format, object_path, cancellation)?;
        Ok(scratch)
    }

    pub(super) fn exact_commit(
        &self,
        oid: &str,
        cancellation: &CancellationToken,
    ) -> Result<String, AppError> {
        validate_commit_oid(oid)?;
        let oid = oid.to_ascii_lowercase();
        let expression = format!("{oid}^{{commit}}");
        let (commit, truncated) = run_cancellable_command_with_stdout_limit(
            self.command(&["rev-parse", "--verify", "--end-of-options", &expression]),
            cancellation,
            Some(4096),
        )?;
        if truncated || !commit.status.success() || commit.stdout != format!("{oid}\n").as_bytes() {
            return Err(AppError::new(
                "invalidCommit",
                "The selected ID is not an available commit object.",
                Some("Refresh the repository and choose the commit again."),
            ));
        }
        Ok(oid)
    }

    fn storage_error(error: impl std::fmt::Display) -> AppError {
        AppError::new(
            "isolatedGitStorage",
            format!("Could not prepare isolated Git storage: {error}"),
            None,
        )
    }

    pub(super) fn new(purpose: &str) -> Result<Self, std::io::Error> {
        let mut random = [0; 16];
        getrandom::fill(&mut random)
            .map_err(|_| std::io::Error::other("Could not allocate random scratch storage."))?;
        let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let path = std::env::temp_dir().join(format!("git-khronos-{purpose}-{suffix}"));
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&path)?;
        Ok(Self(path))
    }

    pub(super) fn path(&self) -> &Path {
        &self.0
    }

    pub(super) fn command(&self, args: &[&str]) -> Command {
        let mut command = Command::new("git");
        let mut attributes = std::ffi::OsString::from("core.attributesFile=");
        attributes.push(self.path().join("empty-config"));
        command
            .arg("-C")
            .arg(&self.0)
            .arg("-c")
            .arg(attributes)
            .args(args);
        for (name, _) in std::env::vars_os() {
            if name.to_string_lossy().starts_with("GIT_") {
                command.env_remove(name);
            }
        }
        command
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", self.0.join("empty-config"))
            .env("GIT_ATTR_NOSYSTEM", "1")
            .env("GIT_ALLOW_PROTOCOL", "")
            .env("GIT_NO_LAZY_FETCH", "1")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("LC_ALL", "C")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_process_tree(&mut command);
        command
    }

    /// Initialize only private metadata. The alternate lives outside the
    /// scratch repository and is used for object reads, not as a write target.
    pub(super) fn init_with_alternate(
        &self,
        object_format: &str,
        object_path: &str,
        cancellation: &CancellationToken,
    ) -> Result<(), AppError> {
        fs::write(self.0.join("empty-config"), b"").map_err(Self::storage_error)?;
        fs::create_dir(self.0.join("empty-template")).map_err(Self::storage_error)?;
        let (init, truncated) = run_cancellable_command_with_stdout_limit(
            self.command(&[
                "init",
                "--bare",
                "--quiet",
                "--template=empty-template",
                object_format,
                ".",
            ]),
            cancellation,
            Some(4096),
        )?;
        if truncated {
            return Err(AppError::new(
                "isolatedGitStorage",
                "Git returned unexpected output while preparing private storage.",
                None,
            ));
        }
        ensure_success("initialize isolated Git storage", &init)?;
        fs::write(
            self.0.join("objects/info/alternates"),
            format!("{object_path}\n"),
        )
        .map_err(Self::storage_error)
    }

    pub(super) fn remove(&self) -> std::io::Result<()> {
        fs::remove_dir_all(&self.0)
    }
}

impl Drop for IsolatedGit {
    fn drop(&mut self) {
        let _ = self.remove();
    }
}
