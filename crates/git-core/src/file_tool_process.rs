//! A direct child handle for explicitly reviewed tools; no program-name/group kills.
//! The native session owner retains this handle until polling reaps the child.
use super::{
    AppError, FileToolProcessState, FileToolProcessStatus, GIT_CONTEXT_ENVIRONMENT_VARIABLES,
};
use std::{
    os::unix::process::ExitStatusExt,
    process::{Child, Command, ExitStatus, Stdio},
};

/// Drop does not stop a GUI program or delete its input/output copies.
/// A native registry must not drop a running handle just to retire UI context.
pub struct FileToolProcess {
    child: Child,
    exited: Option<ExitStatus>,
    cancellation_requested: bool,
}
fn failed(message: &str) -> AppError {
    AppError::new(
        "fileToolProcessUnavailable",
        message,
        Some(
            "Inspect the program and retained tool files. Do not repeat an uncertain launch automatically.",
        ),
    )
}
impl FileToolProcess {
    /// Only the native prepared-plan owner supplies the command. A renderer
    /// argument vector or arbitrary cwd is not launch authority.
    pub(crate) fn spawn(mut command: Command) -> Result<Self, AppError> {
        for name in GIT_CONTEXT_ENVIRONMENT_VARIABLES {
            command.env_remove(name);
        }
        for name in [
            "GIT_ASKPASS",
            "SSH_ASKPASS",
            "SSH_ASKPASS_REQUIRE",
            "GIT_KHRONOS_ASKPASS",
            "GIT_KHRONOS_ASKPASS_ADDRESS",
            "GIT_KHRONOS_ASKPASS_TOKEN",
        ] {
            command.env_remove(name);
        }
        let bridge_names: Vec<_> = std::env::vars_os()
            .map(|(key, _)| key)
            .chain(command.get_envs().map(|(key, _)| key.to_owned()))
            .filter(|key| key.to_string_lossy().starts_with("GIT_KHRONOS_ASKPASS"))
            .collect();
        for name in bridge_names {
            command.env_remove(name);
        }
        let child = command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| failed("The reviewed program could not be started."))?;
        Ok(Self {
            child,
            exited: None,
            cancellation_requested: false,
        })
    }
    pub fn poll(&mut self) -> Result<FileToolProcessStatus, AppError> {
        if self.exited.is_none() {
            self.exited = self
                .child
                .try_wait()
                .map_err(|_| failed("The owned command's current state could not be confirmed."))?;
        }
        Ok(match self.exited {
            Some(status) => FileToolProcessStatus {
                state: FileToolProcessState::Exited,
                code: status.code(),
                signal: status.signal(),
                success: Some(status.success()),
                cancellation_requested: self.cancellation_requested,
            },
            None => FileToolProcessStatus {
                state: FileToolProcessState::Running,
                code: None,
                signal: None,
                success: None,
                cancellation_requested: self.cancellation_requested,
            },
        })
    }
    /// Abort only this still-unreaped direct child. A launcher may already have
    /// handed off to a shared IDE; an exited handle never grants authority to
    /// signal a PID/process group or descendants. Exit does not prove file save.
    pub fn cancel(&mut self) -> Result<FileToolProcessStatus, AppError> {
        if self.poll()?.state == FileToolProcessState::Exited {
            return self.poll();
        }
        // This handle is the sole reaper. Until try_wait returns an exit, the
        // child remains unreaped and its numeric PID cannot be reassigned.
        if self.child.kill().is_err() {
            if self.poll()?.state == FileToolProcessState::Exited {
                return self.poll();
            }
            return Err(failed(
                "The owned command could not be stopped. Inspect its state before another action.",
            ));
        }
        self.cancellation_requested = true;
        self.poll()
    }
}

#[cfg(test)]
#[path = "file_tool_process_tests.rs"]
mod tests;
