//! WSL terminal transport for the OS-owned polkit authorization prompt.
//! The renderer never provides commands, paths, passwords, or installer results.
use std::{
    ffi::OsStr,
    io::{self, IsTerminal, Read, Write},
    os::fd::AsRawFd,
    os::unix::{
        ffi::{OsStrExt, OsStringExt},
        fs::MetadataExt,
        net::{UnixListener, UnixStream},
        process::ExitStatusExt,
    },
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant},
};

const HELPER: &str = "--owned-update-authorization-terminal";
pub(crate) const TERMINAL: &str = "/usr/bin/x-terminal-emulator";
const MAX_PACKAGE_PATH: usize = 4096;

fn terminal_command(executable: &Path, socket: &Path) -> Command {
    let mut command = Command::new(TERMINAL);
    command
        .arg("-e")
        .arg(executable)
        .arg(HELPER)
        .arg(socket)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

fn package_command(package: &Path) -> Option<Command> {
    let mut command = Command::new("/usr/bin/pkexec");
    match package.file_name()?.as_encoded_bytes() {
        b"package.deb" => command.args(["/usr/bin/dpkg", "--refuse-downgrade", "-i"]),
        b"package.rpm" => command.args(["/usr/bin/rpm", "-U"]),
        _ => return None,
    };
    command.arg(package);
    Some(command)
}

fn same_app_peer(stream: &UnixStream) -> io::Result<bool> {
    let mut credentials = std::mem::MaybeUninit::<libc::ucred>::uninit();
    let mut size = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    // SO_PEERCRED reports the kernel-authenticated Unix socket peer.
    let result = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            credentials.as_mut_ptr().cast(),
            &mut size,
        )
    };
    if result != 0 {
        return Err(io::Error::last_os_error());
    }
    if size as usize != std::mem::size_of::<libc::ucred>() {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let credentials = unsafe { credentials.assume_init() };
    if credentials.uid != unsafe { libc::geteuid() } || credentials.pid <= 0 {
        return Ok(false);
    }
    let local = std::fs::metadata("/proc/self/exe")?;
    let peer = std::fs::metadata(format!("/proc/{}/exe", credentials.pid))?;
    Ok(local.dev() == peer.dev() && local.ino() == peer.ino())
}

pub(crate) fn install(package: &Path) -> io::Result<ExitStatus> {
    let directory = tempfile::tempdir()?;
    let socket = directory.path().join("authorization");
    let listener = UnixListener::bind(&socket)?;
    listener.set_nonblocking(true)?;
    let mut terminal = terminal_command(&std::env::current_exe()?, &socket).spawn()?;
    // The terminal may delegate to a GUI server and exit before the helper
    // connects. Reap the launcher without using its status as installer proof.
    thread::spawn(move || {
        let _ = terminal.wait();
    });
    let deadline = Instant::now() + Duration::from_secs(8);
    let mut stream = loop {
        match listener.accept() {
            Ok((stream, _)) if same_app_peer(&stream).unwrap_or(false) => break stream,
            Ok(_) => {
                if Instant::now() >= deadline {
                    return Err(io::ErrorKind::NotFound.into());
                }
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    // A late helper never gets a package path and cannot install.
                    return Err(io::Error::new(
                        io::ErrorKind::NotFound,
                        "The authorization window did not connect.",
                    ));
                }
                thread::sleep(Duration::from_millis(25));
            }
            Err(error) => return Err(error),
        }
    };
    let bytes = package.as_os_str().as_bytes();
    if bytes.len() > MAX_PACKAGE_PATH {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    stream.write_all(&(bytes.len() as u32).to_be_bytes())?;
    stream.write_all(bytes)?;
    drop(listener);
    let mut status = [0];
    // The user may take time to authorize. Disconnecting after dispatch
    // is uncertain unless the package database proves the installed version.
    stream.read_exact(&mut status)?;
    Ok(ExitStatus::from_raw(i32::from(status[0]) << 8))
}

fn run_helper(socket: &Path) -> io::Result<()> {
    if !io::stdin().is_terminal() || !io::stderr().is_terminal() {
        return Err(io::ErrorKind::NotConnected.into());
    }
    let mut stream = UnixStream::connect(socket)?;
    if !same_app_peer(&stream)? {
        return Err(io::ErrorKind::PermissionDenied.into());
    }
    stream.set_read_timeout(Some(Duration::from_secs(4)))?;
    let mut len = [0; 4];
    stream.read_exact(&mut len)?;
    let len = u32::from_be_bytes(len) as usize;
    if len == 0 || len > MAX_PACKAGE_PATH {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let mut bytes = vec![0; len];
    stream.read_exact(&mut bytes)?;
    let path = PathBuf::from(std::ffi::OsString::from_vec(bytes));
    if !path.is_absolute() {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let mut command = package_command(&path).ok_or(io::ErrorKind::InvalidData)?;
    // All three standard streams are the external terminal, never the app.
    let status = command
        .status()?
        .code()
        .filter(|code| (0..=255).contains(code))
        .unwrap_or(255);
    stream.write_all(&[status as u8])
}

pub fn helper_entry() -> Option<i32> {
    let mut args = std::env::args_os().skip(1);
    if args.next()?.as_os_str() != OsStr::new(HELPER) {
        return None;
    }
    let Some(socket) = args.next().filter(|_| args.next().is_none()) else {
        return Some(2);
    };
    Some(match run_helper(Path::new(&socket)) {
        Ok(()) => 0,
        Err(_) => {
            eprintln!(
                "The Git Khronos authorization window could not complete the update request."
            );
            1
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn application_update_authorization_terminal_validates_kernel_peer_credentials() {
        let (left, right) = UnixStream::pair().unwrap();
        assert!(same_app_peer(&left).unwrap());
        assert!(same_app_peer(&right).unwrap());
    }

    #[test]
    fn application_update_authorization_terminal_passes_literal_paths_without_a_shell() {
        let executable = Path::new("/test/app 'quoted' $(unexpanded)");
        let socket = Path::new("/test/private socket");
        let launcher = terminal_command(executable, socket);
        assert_eq!(launcher.get_program(), TERMINAL);
        assert_eq!(
            launcher.get_args().collect::<Vec<_>>(),
            [
                OsStr::new("-e"),
                executable.as_os_str(),
                OsStr::new(HELPER),
                socket.as_os_str()
            ]
        );
        let package = Path::new("/private path/package.deb");
        let command = package_command(package).unwrap();
        assert_eq!(command.get_program(), "/usr/bin/pkexec");
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            [
                OsStr::new("/usr/bin/dpkg"),
                OsStr::new("--refuse-downgrade"),
                OsStr::new("-i"),
                package.as_os_str()
            ]
        );
        assert!(package_command(Path::new("/private/other.deb")).is_none());
    }
}
