//! Interruptible reads from exclusively owned Unix child-output pipes.
use std::io::{self, Read};
use std::os::fd::AsFd;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

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

impl<P: Read> Read for InterruptiblePipe<P> {
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
                    thread::sleep(Duration::from_millis(10));
                }
                result => return result,
            }
        }
    }
}
