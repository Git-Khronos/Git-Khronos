//! Interruptible reads from exclusively owned Unix child-output pipes.
use rustix::event::{PollFd, PollFlags, Timespec, poll};
use std::io::{self, Read};
use std::os::fd::AsFd;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

const STOP_CHECK: Timespec = Timespec {
    tv_sec: 0,
    tv_nsec: 10_000_000,
};

pub(super) struct InterruptiblePipe<P> {
    pipe: P,
    stopped: Arc<AtomicBool>,
}

impl<P: AsFd> InterruptiblePipe<P> {
    pub(super) fn new(pipe: P, stopped: Arc<AtomicBool>) -> io::Result<Self> {
        let flags = rustix::fs::fcntl_getfl(&pipe)?;
        rustix::fs::fcntl_setfl(&pipe, flags | rustix::fs::OFlags::NONBLOCK)?;
        Ok(Self { pipe, stopped })
    }
}

impl<P: AsFd + Read> Read for InterruptiblePipe<P> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        loop {
            // A detached helper may retain a write end after Git's process
            // group is killed. Stop our own readers instead of joining forever.
            // Normal completion still reads every byte until actual EOF.
            if self.stopped.load(Ordering::Acquire) {
                return Ok(0);
            }
            match self.pipe.read(buffer) {
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    // Wake as soon as data or EOF is ready. The short timeout
                    // still bounds cancellation if a detached writer is idle.
                    let mut output = [PollFd::new(&self.pipe, PollFlags::IN)];
                    match poll(&mut output, Some(&STOP_CHECK)) {
                        Ok(_) | Err(rustix::io::Errno::INTR) => {}
                        Err(error) => return Err(error.into()),
                    }
                }
                result => return result,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn output_is_drained_when_the_writer_closes_with_unread_bytes() {
        let (input, mut output) = io::pipe().unwrap();
        let stopped = Arc::new(AtomicBool::new(false));
        output.write_all(b"final bytes\0").unwrap();
        drop(output);
        let mut input = InterruptiblePipe::new(input, stopped).unwrap();
        let mut bytes = Vec::new();
        input.read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes, b"final bytes\0");
    }

    #[test]
    fn stopped_reader_returns_even_while_the_pipe_writer_remains_open() {
        let (input, output) = io::pipe().unwrap();
        let stopped = Arc::new(AtomicBool::new(false));
        let terminate = stopped.clone();
        let (ready, started) = mpsc::channel();
        let (result, finished) = mpsc::channel();
        let worker = thread::spawn(move || {
            let mut input = InterruptiblePipe::new(input, stopped).unwrap();
            let mut byte = [0];
            ready.send(()).unwrap();
            result.send(input.read(&mut byte)).unwrap();
        });
        started.recv_timeout(Duration::from_secs(1)).unwrap();
        let before_stop = finished.recv_timeout(Duration::from_millis(30));
        terminate.store(true, Ordering::Release);
        let captured = finished.recv_timeout(Duration::from_secs(1));
        drop(output);
        worker.join().unwrap();
        assert!(matches!(before_stop, Err(mpsc::RecvTimeoutError::Timeout)));
        assert_eq!(captured.unwrap().unwrap(), 0);
    }
}
