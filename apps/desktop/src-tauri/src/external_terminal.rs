//! Opens the operating system's own terminal application in a repository.
//!
//! The integrated terminal owns its PTY sessions; this launcher only hands the
//! repository folder to a separate, user-owned program. Arguments are passed as
//! a literal argv (never through a shell), the working directory is set on the
//! process, and Git context variables from the app are not inherited.
use crate::{AppError, AppState, repository_session};
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TerminalCandidate {
    pub program: OsString,
    pub arguments: Vec<OsString>,
}

impl TerminalCandidate {
    fn new(program: impl Into<OsString>, arguments: Vec<OsString>) -> Self {
        Self {
            program: program.into(),
            arguments,
        }
    }
}

/// Facts about the environment that influence which terminal is chosen.
#[derive(Debug, Default, Clone)]
pub(crate) struct TerminalEnvironment {
    /// The user's preferred terminal command name (`$TERMINAL`).
    pub preferred: Option<OsString>,
    /// The WSL distribution name when the app runs inside WSL.
    pub wsl_distribution: Option<String>,
}

impl TerminalEnvironment {
    fn current() -> Self {
        let wsl_distribution = crate::display_environment::running_under_wsl()
            .then(|| std::env::var("WSL_DISTRO_NAME").ok())
            .flatten()
            .filter(|name| !name.is_empty());
        Self {
            preferred: std::env::var_os("TERMINAL").filter(|value| !value.is_empty()),
            wsl_distribution,
        }
    }
}

fn os(value: &str) -> OsString {
    value.into()
}

fn joined(flag: &str, path: &Path) -> OsString {
    let mut argument = OsString::from(flag);
    argument.push(path.as_os_str());
    argument
}

/// Launchers to try, most preferred first. Each one opens in `repository`.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn terminal_candidates(
    repository: &Path,
    environment: &TerminalEnvironment,
) -> Vec<TerminalCandidate> {
    let path = repository.as_os_str().to_owned();
    let mut candidates = Vec::new();
    if let Some(preferred) = &environment.preferred {
        candidates.push(TerminalCandidate::new(preferred.clone(), Vec::new()));
    }
    // Windows Terminal separates commands with ';', so such paths are skipped.
    if let Some(distribution) = &environment.wsl_distribution
        && !repository.to_string_lossy().contains(';')
    {
        candidates.push(TerminalCandidate::new(
            "wt.exe",
            vec![
                os("wsl.exe"),
                os("-d"),
                os(distribution),
                os("--cd"),
                path.clone(),
            ],
        ));
    }
    // Debian and Ubuntu expose the system-selected terminal under this name.
    candidates.push(TerminalCandidate::new("x-terminal-emulator", Vec::new()));
    for program in [
        "gnome-terminal",
        "ptyxis",
        "kgx",
        "xfce4-terminal",
        "mate-terminal",
        "tilix",
        "foot",
    ] {
        candidates.push(TerminalCandidate::new(
            program,
            vec![joined("--working-directory=", repository)],
        ));
    }
    candidates.push(TerminalCandidate::new(
        "konsole",
        vec![os("--workdir"), path.clone()],
    ));
    candidates.push(TerminalCandidate::new(
        "alacritty",
        vec![os("--working-directory"), path.clone()],
    ));
    candidates.push(TerminalCandidate::new(
        "kitty",
        vec![joined("--directory=", repository)],
    ));
    candidates.push(TerminalCandidate::new(
        "wezterm",
        vec![os("start"), os("--cwd"), path],
    ));
    candidates.push(TerminalCandidate::new("xterm", Vec::new()));
    candidates
}

#[cfg(target_os = "macos")]
pub(crate) fn terminal_candidates(
    repository: &Path,
    _environment: &TerminalEnvironment,
) -> Vec<TerminalCandidate> {
    vec![TerminalCandidate::new(
        "open",
        vec![os("-a"), os("Terminal"), repository.as_os_str().to_owned()],
    )]
}

#[cfg(target_os = "windows")]
pub(crate) fn terminal_candidates(
    repository: &Path,
    _environment: &TerminalEnvironment,
) -> Vec<TerminalCandidate> {
    let mut candidates = Vec::new();
    if !repository.to_string_lossy().contains(';') {
        candidates.push(TerminalCandidate::new(
            "wt.exe",
            vec![os("-d"), repository.as_os_str().to_owned()],
        ));
    }
    candidates.push(TerminalCandidate::new(crate::default_shell(), Vec::new()));
    candidates
}

/// Finds `program` the way a shell would, without running a shell.
pub(crate) fn find_program(program: &OsStr, search_path: Option<&OsStr>) -> Option<PathBuf> {
    let requested = Path::new(program);
    if requested.is_absolute() {
        return executable_file(requested).then(|| requested.to_path_buf());
    }
    if requested.components().count() != 1 {
        return None;
    }
    std::env::split_paths(search_path?)
        .filter(|directory| directory.is_absolute())
        .flat_map(|directory| program_files(&directory, program))
        .find(|candidate| executable_file(candidate))
}

#[cfg(windows)]
fn program_files(directory: &Path, program: &OsStr) -> Vec<PathBuf> {
    if Path::new(program).extension().is_some() {
        return vec![directory.join(program)];
    }
    let extensions = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
    extensions
        .split(';')
        .filter(|extension| !extension.is_empty())
        .map(|extension| {
            let mut name = program.to_owned();
            name.push(extension.to_ascii_lowercase());
            directory.join(name)
        })
        .collect()
}

#[cfg(not(windows))]
fn program_files(directory: &Path, program: &OsStr) -> Vec<PathBuf> {
    vec![directory.join(program)]
}

#[cfg(unix)]
fn executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn executable_file(path: &Path) -> bool {
    path.is_file()
}

fn unavailable() -> AppError {
    AppError {
        kind: "externalTerminalUnavailable".into(),
        message: "No system terminal application was found.".into(),
        hint: Some(
            "Install a terminal application, or set the TERMINAL environment variable to its command name, then try again.".into(),
        ),
    }
}

fn terminal_command(
    executable: &Path,
    candidate: &TerminalCandidate,
    repository: &Path,
) -> Command {
    let mut command = Command::new(executable);
    command
        .args(&candidate.arguments)
        .current_dir(repository)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    for variable in git_khronos_git_core::GIT_CONTEXT_ENVIRONMENT_VARIABLES {
        command.env_remove(variable);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        command.creation_flags(CREATE_NEW_CONSOLE);
    }
    command
}

/// Starts the first available terminal and returns the program that was used.
pub(crate) fn launch_external_terminal(
    repository: &Path,
    environment: &TerminalEnvironment,
    search_path: Option<&OsStr>,
) -> Result<PathBuf, AppError> {
    if !repository.is_dir() {
        return Err(AppError {
            kind: "externalTerminalUnavailable".into(),
            message: "The repository folder no longer exists.".into(),
            hint: Some("Open the repository again.".into()),
        });
    }
    let mut last_failure = None;
    for candidate in terminal_candidates(repository, environment) {
        let Some(executable) = find_program(&candidate.program, search_path) else {
            continue;
        };
        match terminal_command(&executable, &candidate, repository).spawn() {
            Ok(mut child) => {
                // The terminal is user-owned; only reap it so no zombie remains.
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
                return Ok(executable);
            }
            Err(error) => last_failure = Some((executable, error)),
        }
    }
    match last_failure {
        Some((executable, error)) => Err(AppError {
            kind: "externalTerminalFailed".into(),
            message: format!(
                "The system terminal could not be started ({}).",
                executable.display()
            ),
            hint: Some(format!(
                "{error}. Check that the terminal application is installed correctly."
            )),
        }),
        None => Err(unavailable()),
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn open_external_terminal(
    repo_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let session = repository_session(&repo_id, &state)?;
    let search_path = std::env::var_os("PATH");
    launch_external_terminal(
        &session.path,
        &TerminalEnvironment::current(),
        search_path.as_deref(),
    )
    .map(|_| ())
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::time::{Duration, Instant};

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let mut bytes = [0; 12];
            getrandom::fill(&mut bytes).unwrap();
            let id: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
            let root = std::env::temp_dir().join(format!("external-terminal-{id}"));
            std::fs::create_dir_all(root.join("bin")).unwrap();
            std::fs::create_dir_all(root.join("repo with spaces; and $(chars)")).unwrap();
            Self(root)
        }
        fn bin(&self) -> PathBuf {
            self.0.join("bin")
        }
        fn repository(&self) -> PathBuf {
            self.0.join("repo with spaces; and $(chars)")
        }
        fn record(&self) -> PathBuf {
            self.0.join("record.txt")
        }
        /// Installs a fake terminal that records its argv, cwd and Git context.
        fn install(&self, name: &str) {
            let path = self.bin().join(name);
            std::fs::write(
                &path,
                format!(
                    "#!/bin/sh\n{{ pwd; echo \"GIT_DIR=${{GIT_DIR-unset}}\"; for a in \"$@\"; do echo \"arg=$a\"; done; }} > '{}'\n",
                    self.record().display()
                ),
            )
            .unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        fn wait_for_record(&self) -> Vec<String> {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                if let Ok(text) = std::fs::read_to_string(self.record())
                    && text.contains("GIT_DIR=")
                {
                    return text.lines().map(str::to_owned).collect();
                }
                assert!(Instant::now() < deadline, "fake terminal never ran");
                std::thread::sleep(Duration::from_millis(20));
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn names(candidates: &[TerminalCandidate]) -> Vec<String> {
        candidates
            .iter()
            .map(|candidate| candidate.program.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn candidates_prefer_terminal_variable_then_wsl_then_system_default() {
        let repository = Path::new("/work/repo");
        let plain = terminal_candidates(repository, &TerminalEnvironment::default());
        assert_eq!(names(&plain)[0], "x-terminal-emulator");
        assert!(!names(&plain).contains(&"wt.exe".to_owned()));

        let environment = TerminalEnvironment {
            preferred: Some("my-term".into()),
            wsl_distribution: Some("DEV".into()),
        };
        let candidates = terminal_candidates(repository, &environment);
        assert_eq!(
            names(&candidates)[..3],
            ["my-term", "wt.exe", "x-terminal-emulator"]
        );
        assert!(candidates[0].arguments.is_empty());
        assert_eq!(
            candidates[1].arguments,
            ["wsl.exe", "-d", "DEV", "--cd", "/work/repo"].map(OsString::from)
        );
        let konsole = candidates.iter().find(|c| c.program == "konsole").unwrap();
        assert_eq!(
            konsole.arguments,
            ["--workdir", "/work/repo"].map(OsString::from)
        );
        let gnome = candidates
            .iter()
            .find(|c| c.program == "gnome-terminal")
            .unwrap();
        assert_eq!(
            gnome.arguments,
            [OsString::from("--working-directory=/work/repo")]
        );
    }

    #[test]
    fn windows_terminal_is_skipped_for_paths_it_would_split() {
        let environment = TerminalEnvironment {
            preferred: None,
            wsl_distribution: Some("DEV".into()),
        };
        let candidates = terminal_candidates(Path::new("/work/a;b"), &environment);
        assert!(!names(&candidates).contains(&"wt.exe".to_owned()));
    }

    #[test]
    fn program_lookup_requires_an_executable_file_on_an_absolute_path_entry() {
        let fixture = Fixture::new();
        std::fs::write(fixture.bin().join("plain"), "").unwrap();
        fixture.install("runnable");
        let search = std::env::join_paths(["relative/bin".into(), fixture.bin()]).unwrap();
        assert_eq!(find_program("plain".as_ref(), Some(&search)), None);
        assert_eq!(
            find_program("runnable".as_ref(), Some(&search)),
            Some(fixture.bin().join("runnable"))
        );
        assert_eq!(find_program("bin/runnable".as_ref(), Some(&search)), None);
        assert_eq!(find_program("runnable".as_ref(), None), None);
    }

    #[test]
    fn launches_first_available_terminal_in_the_repository_without_git_context() {
        let fixture = Fixture::new();
        fixture.install("konsole");
        fixture.install("xterm");
        let search = fixture.bin().into_os_string();
        let used = launch_external_terminal(
            &fixture.repository(),
            &TerminalEnvironment::default(),
            Some(&search),
        )
        .unwrap();
        assert_eq!(used, fixture.bin().join("konsole"));
        let record = fixture.wait_for_record();
        let repository = fixture.repository().display().to_string();
        assert_eq!(record[0], repository);
        assert_eq!(record[1], "GIT_DIR=unset");
        assert_eq!(
            record[2..],
            ["arg=--workdir".to_owned(), format!("arg={repository}")]
        );

        let command = terminal_command(
            &used,
            &TerminalCandidate::new("konsole", Vec::new()),
            &fixture.repository(),
        );
        let removed: Vec<_> = command
            .get_envs()
            .filter(|(_, value)| value.is_none())
            .map(|(key, _)| key.to_string_lossy().into_owned())
            .collect();
        for variable in git_khronos_git_core::GIT_CONTEXT_ENVIRONMENT_VARIABLES {
            assert!(
                removed.iter().any(|key| key == variable),
                "{variable} is inherited"
            );
        }
    }

    #[test]
    fn preferred_terminal_wins_and_missing_terminals_report_a_clear_error() {
        let fixture = Fixture::new();
        fixture.install("x-terminal-emulator");
        fixture.install("chosen");
        let search = fixture.bin().into_os_string();
        let preferred = TerminalEnvironment {
            preferred: Some("chosen".into()),
            wsl_distribution: None,
        };
        let used =
            launch_external_terminal(&fixture.repository(), &preferred, Some(&search)).unwrap();
        assert_eq!(used, fixture.bin().join("chosen"));
        assert_eq!(fixture.wait_for_record()[2..], [] as [String; 0]);

        let empty = fixture.0.join("empty");
        std::fs::create_dir(&empty).unwrap();
        let error = launch_external_terminal(
            &fixture.repository(),
            &TerminalEnvironment::default(),
            Some(empty.as_os_str()),
        )
        .unwrap_err();
        assert_eq!(error.kind, "externalTerminalUnavailable");
        assert!(error.hint.unwrap().contains("TERMINAL"));

        let missing = launch_external_terminal(
            &fixture.0.join("gone"),
            &TerminalEnvironment::default(),
            Some(&search),
        )
        .unwrap_err();
        assert_eq!(missing.message, "The repository folder no longer exists.");
    }
}
