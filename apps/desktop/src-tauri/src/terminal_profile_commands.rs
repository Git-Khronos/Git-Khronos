//! Explicit configured PTY launches reuse the existing terminal owner/lifecycle.
use crate::{AppError, AppState, TerminalInfo, TerminalLaunch, open_terminal_program};
use git_khronos_git_core::ToolProfile;
use tauri::{AppHandle, State, WebviewWindow};

fn main_window(window: &WebviewWindow) -> Result<(), AppError> {
    if window.label() == "main" {
        return Ok(());
    }
    Err(AppError {
        kind: "toolProfileUnavailable".into(),
        message: "Tool profiles are available only in the main application window.".into(),
        hint: None,
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn validate_tool_profile(profile: ToolProfile, window: WebviewWindow) -> Result<(), AppError> {
    main_window(&window)?;
    profile.validate()
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn open_configured_terminal(
    repo_id: String,
    profile: ToolProfile,
    rows: u16,
    cols: u16,
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<TerminalInfo, AppError> {
    main_window(&window)?;
    open_terminal_program(
        repo_id,
        rows,
        cols,
        TerminalLaunch::Configured(profile),
        app,
        state,
    )
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use crate::{AgentProgram, configure_terminal_command, terminal_launch_spec};
    use git_khronos_git_core::ToolRole;
    use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
    use std::path::PathBuf;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let mut bytes = [0; 12];
            getrandom::fill(&mut bytes).unwrap();
            let id: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
            let root = std::env::temp_dir().join(format!("owned-configured-pty-{id}"));
            std::fs::create_dir(&root).unwrap();
            Self(root)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn profile(role: ToolRole, arguments: Vec<String>) -> ToolProfile {
        ToolProfile {
            version: 1,
            id: "owned-pty".into(),
            name: "Owned configured program".into(),
            role,
            executable: "/usr/bin/python3".into(),
            arguments,
        }
    }

    #[test]
    fn configured_terminal_actual_pty_preserves_literal_argv_cwd_and_user_config_without_git_selectors()
     {
        let fixture = Fixture::new();
        let output = fixture.0.join("observed.json");
        let script = fixture.0.join("owned recorder.py");
        std::fs::write(&script, r#"import json, os, pathlib, sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({'args': sys.argv[2:], 'cwd': os.getcwd(), 'tty': [os.isatty(0), os.isatty(1)], 'gitDir': os.getenv('GIT_DIR'), 'index': os.getenv('GIT_INDEX_FILE'), 'config': os.getenv('GIT_CONFIG_GLOBAL')}))
"#).unwrap();
        let sentinel = fixture.0.join("must-not-exist");
        let literal = format!(
            "space [x] 'quotes'; touch {}; $(not-a-command)",
            sentinel.display()
        );
        let request = profile(
            ToolRole::Terminal,
            vec![
                script.to_str().unwrap().into(),
                output.to_str().unwrap().into(),
                literal.clone(),
                "{repository}".into(),
            ],
        );
        let prepared =
            terminal_launch_spec(TerminalLaunch::Configured(request), &fixture.0).unwrap();
        assert_eq!(prepared.label, "Owned configured program");
        let pair = NativePtySystem::default()
            .openpty(PtySize {
                rows: 12,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut command = CommandBuilder::new(&prepared.executable);
        command.args(&prepared.arguments);
        for key in git_khronos_git_core::GIT_CONTEXT_ENVIRONMENT_VARIABLES {
            command.env(key, "owned-invalid-context");
        }
        let own_config = fixture.0.join("preserved-user-config");
        command.env("GIT_CONFIG_GLOBAL", &own_config);
        configure_terminal_command(&mut command, &fixture.0);
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        assert!(child.wait().unwrap().success());
        let observed: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&output).unwrap()).unwrap();
        assert_eq!(
            observed["args"],
            serde_json::json!([literal, fixture.0.to_str().unwrap()])
        );
        assert_eq!(observed["cwd"], fixture.0.to_str().unwrap());
        assert_eq!(observed["tty"], serde_json::json!([true, true]));
        assert!(observed["gitDir"].is_null() && observed["index"].is_null());
        assert_eq!(observed["config"], own_config.to_str().unwrap());
        assert!(!sentinel.exists());
    }

    #[test]
    fn configured_terminal_refuses_file_tool_roles_and_invalid_profiles_before_pty_setup() {
        for role in [ToolRole::Editor, ToolRole::Diff, ToolRole::Merge] {
            let error = terminal_launch_spec(
                TerminalLaunch::Configured(profile(role, vec![])),
                std::path::Path::new("/owned"),
            )
            .err()
            .unwrap();
            assert_eq!(error.kind, "invalidTerminalToolRole");
        }
        let mut invalid = profile(ToolRole::Agent, vec!["{repository}".into()]);
        invalid.version = 2;
        assert_eq!(
            terminal_launch_spec(
                TerminalLaunch::Configured(invalid),
                std::path::Path::new("/owned")
            )
            .err()
            .unwrap()
            .kind,
            "invalidToolProfile"
        );
    }

    #[test]
    fn configured_terminal_keeps_existing_agent_programs_argument_free() {
        let prepared = terminal_launch_spec(
            TerminalLaunch::Agent(AgentProgram::Codex),
            std::path::Path::new("/owned"),
        )
        .unwrap();
        assert_eq!(prepared.executable, "codex");
        assert_eq!(prepared.label, "codex");
        assert!(prepared.arguments.is_empty());
    }
}
