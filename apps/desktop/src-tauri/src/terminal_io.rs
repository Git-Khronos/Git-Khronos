use portable_pty::MasterPty;
use std::io::{self, Read, Write};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

pub(crate) struct Endpoints {
    pub reader: Box<dyn Read + Send>,
    pub writer: Box<dyn Write + Send>,
    pub cancelled: Arc<AtomicBool>,
}

pub(crate) fn connect(master: &dyn MasterPty) -> io::Result<Endpoints> {
    let cancelled = Arc::new(AtomicBool::new(false));
    #[cfg(unix)]
    {
        unix::connect(master, cancelled)
    }
    #[cfg(not(unix))]
    {
        Ok(Endpoints {
            reader: master
                .try_clone_reader()
                .map_err(|error| io::Error::other(error.to_string()))?,
            writer: master
                .take_writer()
                .map_err(|error| io::Error::other(error.to_string()))?,
            cancelled,
        })
    }
}

#[cfg(unix)]
mod unix {
    use super::*;
    use std::fs::File;
    use std::os::fd::{AsRawFd, BorrowedFd};

    struct Stream {
        file: File,
        cancelled: Arc<AtomicBool>,
    }

    fn closed() -> io::Error {
        io::Error::new(
            io::ErrorKind::BrokenPipe,
            "The terminal session was closed.",
        )
    }

    pub(super) fn connect(
        master: &dyn MasterPty,
        cancelled: Arc<AtomicBool>,
    ) -> io::Result<Endpoints> {
        let raw = master
            .as_raw_fd()
            .ok_or_else(|| io::Error::other("The terminal has no Unix descriptor."))?;
        // SAFETY: master owns this live descriptor throughout duplication. The
        // borrowed descriptor never escapes; each stream gets an owned duplicate.
        let descriptor = unsafe { BorrowedFd::borrow_raw(raw) }.try_clone_to_owned()?;
        let reader = File::from(descriptor);
        // SAFETY: fcntl operates on reader's owned, live descriptor. F_GETFL
        // takes no extra argument; F_SETFL receives the flags returned below.
        let flags = unsafe { libc::fcntl(reader.as_raw_fd(), libc::F_GETFL) };
        if flags < 0
            || unsafe { libc::fcntl(reader.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) }
                < 0
        {
            return Err(io::Error::last_os_error());
        }
        let writer = reader.try_clone()?;
        Ok(Endpoints {
            reader: Box::new(Stream {
                file: reader,
                cancelled: cancelled.clone(),
            }),
            writer: Box::new(Stream {
                file: writer,
                cancelled: cancelled.clone(),
            }),
            cancelled,
        })
    }

    impl Stream {
        fn wait(&self, events: libc::c_short) -> io::Result<()> {
            loop {
                if self.cancelled.load(Ordering::Acquire) {
                    return Err(closed());
                }
                let mut descriptor = libc::pollfd {
                    fd: self.file.as_raw_fd(),
                    events,
                    revents: 0,
                };
                // SAFETY: descriptor points to one initialized pollfd, owned by
                // this stack frame, and file keeps its descriptor alive.
                let ready = unsafe { libc::poll(&mut descriptor, 1, 100) };
                if ready < 0 {
                    let error = io::Error::last_os_error();
                    if error.kind() == io::ErrorKind::Interrupted {
                        continue;
                    }
                    return Err(error);
                }
                if ready == 0 {
                    continue;
                }
                if descriptor.revents & (libc::POLLERR | libc::POLLNVAL) != 0 {
                    return Err(closed());
                }
                // Drain buffered output on HUP, but never wait for input space
                // after the peer has closed. No destructor writes an extra EOT.
                if descriptor.revents & libc::POLLHUP != 0
                    && (events == libc::POLLOUT || descriptor.revents & libc::POLLIN == 0)
                {
                    return Err(closed());
                }
                if descriptor.revents & events != 0 {
                    return Ok(());
                }
            }
        }
    }

    impl Read for Stream {
        fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
            if bytes.is_empty() {
                return Ok(0);
            }
            loop {
                if self.cancelled.load(Ordering::Acquire) {
                    return Err(closed());
                }
                match self.file.read(bytes) {
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        self.wait(libc::POLLIN)?
                    }
                    result => return result,
                }
            }
        }
    }

    impl Write for Stream {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            if bytes.is_empty() {
                return Ok(0);
            }
            loop {
                if self.cancelled.load(Ordering::Acquire) {
                    return Err(closed());
                }
                match self.file.write(bytes) {
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        self.wait(libc::POLLOUT)?
                    }
                    result => return result,
                }
            }
        }
        fn flush(&mut self) -> io::Result<()> {
            self.file.flush()
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn cancelling_full_raw_pty_input_settles_without_waiting_for_the_shell() {
        let pair = NativePtySystem::default()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut endpoints = connect(pair.master.as_ref()).unwrap();
        let mut command = CommandBuilder::new("/bin/sh");
        command.args(["-c", "stty raw -echo; printf ready; kill -STOP \"$$\""]);
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let mut ready = [0; 5];
        let read = endpoints.reader.read_exact(&mut ready);
        let (sent, received) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            let result = endpoints.writer.write_all(&vec![b'x'; 1024 * 1024]);
            let _ = sent.send(result);
        });
        let premature = received.recv_timeout(Duration::from_millis(200)).ok();
        endpoints.cancelled.store(true, Ordering::Release);
        let settled = if premature.is_none() {
            received.recv_timeout(Duration::from_secs(2)).ok()
        } else {
            None
        };
        crate::stop_terminal_child(child.as_mut()).unwrap();
        if settled.is_some() || premature.is_some() {
            worker.join().unwrap();
        }
        read.unwrap();
        assert_eq!(&ready, b"ready");
        assert!(
            premature.is_none(),
            "Owned raw PTY did not apply backpressure"
        );
        assert_eq!(
            settled
                .expect("Cancelled write remained blocked")
                .unwrap_err()
                .kind(),
            io::ErrorKind::BrokenPipe
        );
    }
}
