//! Private scratch repositories that cannot inherit source or host Git configuration.
use super::*;

pub(super) struct IsolatedGit(PathBuf);

impl IsolatedGit {
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
        let storage_error = |error: std::io::Error| {
            AppError::new(
                "isolatedGitStorage",
                format!("Could not prepare isolated Git storage: {error}"),
                None,
            )
        };
        fs::write(self.0.join("empty-config"), b"").map_err(storage_error)?;
        fs::create_dir(self.0.join("empty-template")).map_err(storage_error)?;
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
        .map_err(storage_error)
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
