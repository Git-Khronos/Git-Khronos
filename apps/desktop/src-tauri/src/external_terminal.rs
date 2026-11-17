//! Opens the operating system's own terminal application in a repository.
//!
//! The integrated terminal owns its PTY sessions; this launcher only hands the
//! repository folder to a separate, user-owned program. Arguments are passed as
//! a literal argv (never through a shell), the working directory is set on the
//! process, and Git context variables from the app are not inherited.
use crate::{AppError, AppState, repository_session};
use std::ffi::{OsStr, OsString};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Line printed by launch helpers once the terminal itself has been started.
const READY_LINE: &str = "started";
/// Generous because the first PowerShell start on a machine can be slow.
const READY_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TerminalCandidate {
    pub program: OsString,
    pub arguments: Vec<OsString>,
    /// When set, the program is a helper that prints [`READY_LINE`] on stdout
    /// after starting the terminal; it fails if it exits without doing so.
    pub reports_ready: bool,
}

impl TerminalCandidate {
    fn new(program: impl Into<OsString>, arguments: Vec<OsString>) -> Self {
        Self {
            program: program.into(),
            arguments,
            reports_ready: false,
        }
    }
}

/// Quotes one argument for a Windows command line, following the parsing rules
/// documented for the Microsoft C runtime and `CommandLineToArgvW`.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn windows_argument(argument: &str) -> String {
    if !argument.is_empty() && !argument.contains([' ', '\t', '\n', '\u{b}', '"']) {
        return argument.to_owned();
    }
    let mut quoted = String::from('"');
    let mut backslashes = 0;
    for character in argument.chars() {
        match character {
            '\\' => backslashes += 1,
            '"' => {
                quoted.push_str(&"\\".repeat(backslashes * 2 + 1));
                quoted.push('"');
                backslashes = 0;
            }
            _ => {
                quoted.push_str(&"\\".repeat(backslashes));
                quoted.push(character);
                backslashes = 0;
            }
        }
    }
    quoted.push_str(&"\\".repeat(backslashes * 2));
    quoted.push('"');
    quoted
}

/// Standard base64 (RFC 4648, section 4) with padding.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let group = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for index in 0..4 {
            if index <= chunk.len() {
                encoded.push(ALPHABET[(group >> (18 - 6 * index) & 63) as usize] as char);
            } else {
                encoded.push('=');
            }
        }
    }
    encoded
}

/// Runs `wt.exe` from Windows PowerShell so the new window can be raised;
/// see `external_terminal_focus.ps1`.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn focus_helper_script(wt_arguments: &[&str]) -> String {
    let command_line = wt_arguments
        .iter()
        .map(|argument| windows_argument(argument))
        .collect::<Vec<_>>()
        .join(" ");
    // Base64 keeps paths with quotes or other special characters inert.
    format!(
        "$terminalArguments = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}'))\n{}",
        base64(command_line.as_bytes()),
        include_str!("external_terminal_focus.ps1")
    )
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn windows_terminal_focus_helper(wt_arguments: &[&str]) -> TerminalCandidate {
    let utf16: Vec<u8> = focus_helper_script(wt_arguments)
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect();
    TerminalCandidate {
        program: "powershell.exe".into(),
        arguments: [
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-EncodedCommand",
        ]
        .map(OsString::from)
        .into_iter()
        .chain([OsString::from(base64(&utf16))])
        .collect(),
        reports_ready: true,
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
        if let Some(repository) = repository.to_str() {
            candidates.push(windows_terminal_focus_helper(&[
                "wsl.exe",
                "-d",
                distribution,
                "--cd",
                repository,
            ]));
        }
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

/// Waits for a helper to print [`READY_LINE`]; stops it if it never does.
fn wait_until_ready(child: &mut Child) -> std::io::Result<()> {
    let stdout = child.stdout.take().expect("helper stdout is piped");
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut ready = false;
        // Keep draining after the ready line so the helper never blocks on output.
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if !ready && line.trim() == READY_LINE {
                ready = true;
                let _ = sender.send(());
            }
        }
    });
    if receiver.recv_timeout(READY_TIMEOUT).is_ok() {
        return Ok(());
    }
    let _ = child.kill();
    let _ = child.wait();
    Err(std::io::Error::other(
        "the launch helper ended without starting the terminal",
    ))
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
        let mut command = terminal_command(&executable, &candidate, repository);
        if candidate.reports_ready {
            command.stdout(Stdio::piped());
        }
        let started = command.spawn().and_then(|mut child| {
            if candidate.reports_ready {
                wait_until_ready(&mut child)?;
            }
            Ok(child)
        });
        match started {
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
pub async fn open_external_terminal(repo_id: String, app: AppHandle) -> Result<(), AppError> {
    // Launch helpers can take a moment; keep that off the UI thread.
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let session = repository_session(&repo_id, &state)?;
        let search_path = std::env::var_os("PATH");
        launch_external_terminal(
            &session.path,
            &TerminalEnvironment::current(),
            search_path.as_deref(),
        )
        .map(|_| ())
    })
    .await
    .map_err(crate::background_task_error)?
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
            self.install_script(
                name,
                &format!(
                    "{{ pwd; echo \"GIT_DIR=${{GIT_DIR-unset}}\"; for a in \"$@\"; do echo \"arg=$a\"; done; }} > '{}'",
                    self.record().display()
                ),
            );
        }
        fn install_script(&self, name: &str, body: &str) {
            let path = self.bin().join(name);
            std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
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
            names(&candidates)[..4],
            ["my-term", "powershell.exe", "wt.exe", "x-terminal-emulator"]
        );
        assert!(candidates[0].arguments.is_empty());
        assert!(candidates[1].reports_ready);
        assert!(!candidates[2].reports_ready);
        assert_eq!(
            candidates[2].arguments,
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
        assert!(!names(&candidates).contains(&"powershell.exe".to_owned()));
    }

    #[test]
    fn windows_arguments_and_base64_follow_their_specifications() {
        assert_eq!(windows_argument("/work/repo"), "/work/repo");
        assert_eq!(windows_argument(""), "\"\"");
        assert_eq!(windows_argument("/a b"), "\"/a b\"");
        assert_eq!(windows_argument("a\"b"), "\"a\\\"b\"");
        assert_eq!(windows_argument("a\\\"b c"), "\"a\\\\\\\"b c\"");
        assert_eq!(windows_argument("dir\\ x\\"), "\"dir\\ x\\\\\"");
        assert_eq!(windows_argument("no\\space\\"), "no\\space\\");
        // RFC 4648 section 10 test vectors.
        for (input, expected) in [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(base64(input.as_bytes()), expected);
        }
    }

    #[test]
    fn wsl_focus_helper_embeds_the_quoted_windows_terminal_command_line() {
        let wt_arguments = ["wsl.exe", "--cd", "/work/it's a \"repo\""];
        let script = focus_helper_script(&wt_arguments);
        let expected = base64(r#"wsl.exe --cd "/work/it's a \"repo\"""#.as_bytes());
        assert!(script.starts_with(&format!(
            "$terminalArguments = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{expected}'))\n"
        )));
        assert!(script.ends_with(include_str!("external_terminal_focus.ps1")));

        let helper = windows_terminal_focus_helper(&wt_arguments);
        assert_eq!(helper.program, "powershell.exe");
        assert!(helper.reports_ready);
        let utf16: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert_eq!(
            helper.arguments,
            [
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-EncodedCommand"
            ]
            .map(OsString::from)
            .into_iter()
            .chain([OsString::from(base64(&utf16))])
            .collect::<Vec<_>>()
        );
    }

    #[test]
    fn helper_must_report_ready_or_the_next_terminal_is_used() {
        let fixture = Fixture::new();
        let environment = TerminalEnvironment {
            preferred: None,
            wsl_distribution: Some("DEV".into()),
        };
        let search = fixture.bin().into_os_string();
        let plain = fixture.0.join("plain repo");
        std::fs::create_dir(&plain).unwrap();
        fixture.install("wt.exe");
        fixture.install_script("powershell.exe", "echo 'not ready'; exit 1");
        let used = launch_external_terminal(&plain, &environment, Some(&search)).unwrap();
        assert_eq!(used, fixture.bin().join("wt.exe"));
        assert_eq!(fixture.wait_for_record()[0], plain.display().to_string());

        std::fs::remove_file(fixture.record()).unwrap();
        let record = fixture.record().display().to_string();
        fixture.install_script(
            "powershell.exe",
            &format!("echo started; {{ pwd; echo GIT_DIR=; }} > '{record}'; sleep 1; echo more"),
        );
        let used = launch_external_terminal(&plain, &environment, Some(&search)).unwrap();
        assert_eq!(used, fixture.bin().join("powershell.exe"));
        assert_eq!(fixture.wait_for_record()[0], plain.display().to_string());
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
