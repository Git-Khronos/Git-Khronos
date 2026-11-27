//! OS-owned installation. Linux never falls back from polkit to collecting a
//! password or feeding one to sudo. This module is not called by acceptance tests.
use super::model::InstallOutcome;
#[cfg(target_os = "linux")]
use std::io::{Read, Write};
#[cfg(target_os = "linux")]
use std::process::{Command, Stdio};
use tauri_plugin_updater::Update;

pub(super) fn format() -> Option<&'static str> {
    use tauri::utils::config::BundleType;
    match tauri::utils::platform::bundle_type()? {
        BundleType::Deb => Some("deb"),
        BundleType::Rpm => Some("rpm"),
        BundleType::AppImage => Some("appimage"),
        BundleType::App => Some("app"),
        BundleType::Msi => Some("msi"),
        BundleType::Nsis => Some("nsis"),
        _ => None,
    }
}

#[cfg(target_os = "linux")]
const PKEXEC: &str = "/usr/bin/pkexec";

#[cfg(target_os = "linux")]
fn package_authorizer_available(path: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

/// Detect a missing authorization launcher without running anything. A launcher
/// on disk does not prove there is an active polkit session or authorization.
pub(super) fn install_blocker(format: Option<&str>) -> Option<&'static str> {
    if cfg!(windows) {
        return Some(
            "This Windows build cannot install an update in place. Use the official release installer.",
        );
    }
    #[cfg(target_os = "linux")]
    if matches!(format, Some("deb" | "rpm"))
        && !package_authorizer_available(std::path::Path::new(PKEXEC))
    {
        return Some(
            "The package was verified, but this session does not have the system authorization launcher (pkexec). Install the official release package with your system package manager.",
        );
    }
    format
        .is_none()
        .then_some("This application bundle cannot self-update.")
}

#[cfg(target_os = "linux")]
fn query(program: &str, args: &[&std::ffi::OsStr]) -> Result<String, String> {
    let mut command = Command::new(program);
    command.args(args);
    query_with_deadline(command, std::time::Duration::from_secs(10))
}

#[cfg(target_os = "linux")]
fn query_with_deadline(
    mut command: Command,
    timeout: std::time::Duration,
) -> Result<String, String> {
    use std::{
        os::{fd::AsRawFd, unix::process::CommandExt},
        time::Instant,
    };
    // Package inspectors may spawn decompressors. Own their entire process
    // group so a deadline cannot leave a descendant holding the output pipe.
    let mut child = command
        .process_group(0)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "The system package inspector is unavailable.")?;
    let stop = |child: &mut std::process::Child| {
        let group = child.id() as i32;
        if group > 1 && group != unsafe { libc::getpgrp() } {
            // SAFETY: process_group(0) created this child's private group. Never
            // accept a renderer-supplied PID/group or signal our own group.
            unsafe {
                libc::kill(-group, libc::SIGKILL);
            }
        }
        let _ = child.kill();
        let _ = child.wait();
    };
    let Some(mut pipe) = child.stdout.take() else {
        stop(&mut child);
        return Err("Package inspection output is unavailable.".into());
    };
    let descriptor = pipe.as_raw_fd();
    // SAFETY: the owned live pipe descriptor stays open for both fcntl calls.
    let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(descriptor, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
    {
        stop(&mut child);
        return Err("Bounded package inspection could not start.".into());
    }
    let deadline = Instant::now() + timeout;
    let mut output = Vec::new();
    let mut eof = false;
    let status = loop {
        if Instant::now() >= deadline {
            stop(&mut child);
            return Err("Package inspection exceeded its safe time limit.".into());
        }
        let mut buffer = [0u8; 8193];
        match pipe.read(&mut buffer) {
            Ok(0) => eof = true,
            Ok(count) => {
                if count > 8192usize.saturating_sub(output.len()) {
                    stop(&mut child);
                    return Err("Package inspection exceeded its safe output limit.".into());
                }
                output.extend_from_slice(&buffer[..count]);
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => {
                stop(&mut child);
                return Err("Package inspection output could not be read.".into());
            }
        }
        match child.try_wait() {
            Ok(Some(status)) if eof => break status,
            Ok(_) => {}
            Err(_) => {
                stop(&mut child);
                return Err("Package inspection did not finish.".into());
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    };
    if !status.success() {
        return Err("The system package inspector refused this package.".into());
    }
    String::from_utf8(output).map_err(|_| "Package metadata is not valid text.".into())
}

pub(super) struct PreparedPackage {
    #[cfg(target_os = "linux")]
    directory: tempfile::TempDir,
}

pub(super) fn prepare(
    update: &Update,
    bytes: &[u8],
    package_format: &str,
) -> Result<PreparedPackage, String> {
    if cfg!(windows) {
        return Err("Windows self-installation requires a safe application restart boundary and is not enabled yet.".into());
    }
    update
        .verify(bytes)
        .map_err(|_| "Update signature or signed version verification failed.")?;
    let valid_format = match package_format {
        "appimage" => bytes.starts_with(b"\x7fELF"),
        "app" => bytes.starts_with(&[0x1f, 0x8b]),
        "deb" | "rpm" => true,
        _ => false,
    };
    if !valid_format {
        return Err(
            "The signed payload is not the supported package format for this application.".into(),
        );
    }
    #[cfg(target_os = "linux")]
    {
        let directory =
            tempfile::tempdir().map_err(|_| "A private update directory could not be created.")?;
        if matches!(package_format, "deb" | "rpm") {
            let path = directory.path().join(format!("package.{package_format}"));
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|_| "The verified package could not be staged.")?;
            file.write_all(bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| "The verified package could not be flushed.")?;
            let metadata = if package_format == "deb" {
                query(
                    "/usr/bin/dpkg-deb",
                    &[
                        "-f".as_ref(),
                        path.as_os_str(),
                        "Package".as_ref(),
                        "Version".as_ref(),
                        "Architecture".as_ref(),
                    ],
                )?
            } else {
                query(
                    "/usr/bin/rpm",
                    &[
                        "-qp".as_ref(),
                        "--qf".as_ref(),
                        "%{NAME}\n%{VERSION}\n%{ARCH}\n".as_ref(),
                        path.as_os_str(),
                    ],
                )?
            };
            let fields: Vec<_> = metadata
                .lines()
                .map(|line| line.split_once(": ").map_or(line, |(_, value)| value))
                .collect();
            let expected_arch = match (package_format, std::env::consts::ARCH) {
                ("deb", "x86_64") => "amd64",
                ("deb", "aarch64") => "arm64",
                ("rpm", "x86_64") => "x86_64",
                ("rpm", "aarch64") => "aarch64",
                _ => {
                    return Err("This package architecture is not supported by the updater.".into());
                }
            };
            if fields != ["git-khronos", update.version.as_str(), expected_arch] {
                return Err("The verified package does not match this application, version and architecture.".into());
            }
        }
        Ok(PreparedPackage { directory })
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = package_format;
        Ok(PreparedPackage {})
    }
}

pub(super) fn observed_version(package_format: &str) -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        if package_format == "deb" {
            let output = query(
                "/usr/bin/dpkg-query",
                &[
                    "-W".as_ref(),
                    "-f=${Status}\n${Version}\n".as_ref(),
                    "git-khronos".as_ref(),
                ],
            )
            .ok()?;
            let mut lines = output.lines();
            if lines.next()? != "install ok installed" {
                return None;
            }
            return lines.next().map(str::to_owned);
        }
        if package_format == "rpm" {
            return query(
                "/usr/bin/rpm",
                &[
                    "-q".as_ref(),
                    "--qf".as_ref(),
                    "%{VERSION}".as_ref(),
                    "git-khronos".as_ref(),
                ],
            )
            .ok();
        }
    }
    let _ = package_format;
    None
}

pub(super) fn refuse_downgrade(package_format: &str, offered: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if matches!(package_format, "deb" | "rpm") {
        let installed = observed_version(package_format)
            .ok_or("The installed package version cannot be inspected safely.")?;
        if package_format == "deb" {
            let status = Command::new("/usr/bin/dpkg")
                .args(["--compare-versions", &installed, "gt", offered])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map_err(|_| "The installed Debian version cannot be compared safely.")?;
            match status.code() { Some(0) => return Err("A newer system package is already installed. Restart Git Khronos instead of downgrading it.".into()),
                Some(1) => return Ok(()), _ => return Err("The installed Debian version cannot be compared safely.".into()) }
        }
        let installed = semver::Version::parse(&installed)
            .map_err(|_| "The installed RPM version cannot be compared safely.")?;
        let offered =
            semver::Version::parse(offered).map_err(|_| "The offered version is invalid.")?;
        if installed > offered {
            return Err("A newer system package is already installed. Restart Git Khronos instead of downgrading it.".into());
        }
    }
    let _ = (package_format, offered);
    Ok(())
}

#[cfg(target_os = "linux")]
fn privileged_command(package_format: &str, path: &std::path::Path) -> Command {
    let mut command = Command::new(PKEXEC);
    command.arg("--disable-internal-agent");
    if package_format == "deb" {
        // Dpkg permits downgrades by default. Keep the guard inside the
        // package transaction, including time spent waiting for authorization.
        command.args(["/usr/bin/dpkg", "--refuse-downgrade", "-i"]);
    } else {
        // RPM upgrade refuses older packages unless explicitly overridden.
        command.args(["/usr/bin/rpm", "-U"]);
    }
    command
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

#[cfg(target_os = "linux")]
fn classify_package_outcome(
    package_format: &str,
    status: std::io::Result<std::process::ExitStatus>,
    installed_version_matches: bool,
) -> InstallOutcome {
    if installed_version_matches {
        return InstallOutcome::Confirmed;
    }
    match status {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            InstallOutcome::RefusedBeforeExecution
        }
        // pkexec passes through the program's status. Only fixed dpkg has the
        // documented 0/1/2 range, so 126/127 identify authorization refusal here.
        // Do not assume the same for RPM or an arbitrary root program.
        Ok(status) if package_format == "deb" && matches!(status.code(), Some(126 | 127)) => {
            InstallOutcome::RefusedBeforeExecution
        }
        _ => InstallOutcome::Uncertain,
    }
}

pub(super) fn install(
    update: &Update,
    bytes: &[u8],
    package_format: &str,
    prepared: PreparedPackage,
) -> InstallOutcome {
    // Reverify immediately before the installation boundary, not only download.
    if install_blocker(Some(package_format)).is_some() {
        return InstallOutcome::RefusedBeforeExecution;
    }
    if update.verify(bytes).is_err() {
        return InstallOutcome::RefusedBeforeExecution;
    }
    #[cfg(target_os = "linux")]
    if matches!(package_format, "deb" | "rpm") {
        if observed_version(package_format).as_deref() == Some(update.version.as_str()) {
            return InstallOutcome::Confirmed;
        }
        if refuse_downgrade(package_format, &update.version).is_err() {
            return InstallOutcome::RefusedBeforeExecution;
        }
        let path = prepared
            .directory
            .path()
            .join(format!("package.{package_format}"));
        let status = privileged_command(package_format, &path).status();
        return classify_package_outcome(
            package_format,
            status,
            observed_version(package_format).as_deref() == Some(update.version.as_str()),
        );
    }
    let _ = (package_format, prepared);
    match update.install(bytes) {
        Ok(()) => InstallOutcome::Confirmed,
        Err(_) => InstallOutcome::Uncertain,
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn application_update_package_authorizer_requires_an_executable_file() {
        use std::os::unix::fs::PermissionsExt;
        let area = tempfile::tempdir().unwrap();
        let fixture = area.path().join("launcher");
        assert!(!package_authorizer_available(&fixture));
        assert!(!package_authorizer_available(area.path()));
        std::fs::write(&fixture, b"not an actual launcher").unwrap();
        std::fs::set_permissions(&fixture, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(!package_authorizer_available(&fixture));
        std::fs::set_permissions(&fixture, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(package_authorizer_available(&fixture));
        assert!(install_blocker(None).is_some());
        assert!(install_blocker(Some("appimage")).is_none());
    }

    use std::os::unix::process::ExitStatusExt;

    #[test]
    fn application_update_privilege_boundary_has_fixed_programs_and_no_textual_password_agent() {
        let path = std::path::Path::new("/owned private fixture/package.deb");
        let command = privileged_command("deb", path);
        assert_eq!(command.get_program(), "/usr/bin/pkexec");
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            [
                "--disable-internal-agent",
                "/usr/bin/dpkg",
                "--refuse-downgrade",
                "-i",
                path.to_str().unwrap()
            ]
        );
        let command = privileged_command("rpm", path);
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            [
                "--disable-internal-agent",
                "/usr/bin/rpm",
                "-U",
                path.to_str().unwrap()
            ]
        );
        assert_eq!(command.get_envs().count(), 0);
    }

    #[test]
    fn application_update_debian_auth_refusal_is_retryable_but_installer_errors_remain_uncertain() {
        let exit = |code| Ok(std::process::ExitStatus::from_raw(code << 8));
        for code in [126, 127] {
            assert_eq!(
                classify_package_outcome("deb", exit(code), false),
                InstallOutcome::RefusedBeforeExecution
            );
            assert_eq!(
                classify_package_outcome("rpm", exit(code), false),
                InstallOutcome::Uncertain
            );
        }
        for code in [0, 1, 2, 3] {
            assert_eq!(
                classify_package_outcome("deb", exit(code), false),
                InstallOutcome::Uncertain
            );
            assert_eq!(
                classify_package_outcome("deb", exit(code), true),
                InstallOutcome::Confirmed
            );
        }
        assert_eq!(
            classify_package_outcome("deb", Ok(std::process::ExitStatus::from_raw(9)), false),
            InstallOutcome::Uncertain
        );
        assert_eq!(
            classify_package_outcome(
                "deb",
                Err(std::io::Error::from(std::io::ErrorKind::NotFound)),
                false
            ),
            InstallOutcome::RefusedBeforeExecution
        );
        assert_eq!(
            classify_package_outcome(
                "deb",
                Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied)),
                false
            ),
            InstallOutcome::Uncertain
        );
    }

    #[test]
    fn application_update_package_inspection_bounds_output_and_time_without_privilege() {
        let mut echo = Command::new("/bin/echo");
        echo.arg("owned");
        assert_eq!(
            query_with_deadline(echo, std::time::Duration::from_secs(2)).unwrap(),
            "owned\n"
        );
        let flood = Command::new("/usr/bin/yes");
        assert!(
            query_with_deadline(flood, std::time::Duration::from_secs(2))
                .unwrap_err()
                .contains("output limit")
        );
        let mut sleeper = Command::new("/bin/sleep");
        sleeper.arg("10");
        let started = std::time::Instant::now();
        assert!(
            query_with_deadline(sleeper, std::time::Duration::from_millis(50))
                .unwrap_err()
                .contains("time limit")
        );
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
    }

    fn proc_task_exited(error: &std::io::Error) -> bool {
        // An already removed entry yields ENOENT. If the task disappears
        // after open, procfs may return ESRCH on read.
        error.raw_os_error() == Some(libc::ESRCH) || error.kind() == std::io::ErrorKind::NotFound
    }

    #[test]
    fn application_update_package_inspection_distinguishes_process_exit_from_read_failure() {
        for errno in [libc::ENOENT, libc::ESRCH] {
            assert!(proc_task_exited(&std::io::Error::from_raw_os_error(errno)));
        }
        for errno in [libc::EACCES, libc::EPERM, libc::EIO] {
            assert!(!proc_task_exited(&std::io::Error::from_raw_os_error(errno)));
        }
    }

    #[test]
    fn application_update_package_inspection_deadline_retires_owned_decompressor_group() {
        let directory = tempfile::tempdir().unwrap();
        let marker = directory.path().join("owned-child.pid");
        let mut command = Command::new("/bin/sh");
        command
            .args([
                "-c",
                "sleep 10 & printf '%s' $! > \"$1\"; exit 0",
                "owned-inspector",
            ])
            .arg(&marker);
        assert!(
            query_with_deadline(command, std::time::Duration::from_secs(1))
                .unwrap_err()
                .contains("time limit")
        );
        let pid: u32 = std::fs::read_to_string(&marker).unwrap().parse().unwrap();
        assert!(pid > 1);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        loop {
            let stat = match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
                Ok(stat) => stat,
                Err(error) if proc_task_exited(&error) => break,
                Err(error) => panic!("Could not inspect owned decompressor {pid}: {error}"),
            };
            let state = stat
                .rsplit_once(')')
                .unwrap()
                .1
                .split_whitespace()
                .next()
                .unwrap();
            if matches!(state, "Z" | "X") {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "Owned decompressor survived inspection timeout"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
}
