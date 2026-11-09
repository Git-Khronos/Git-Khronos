use super::*;
use crate::authentication::{CONTEXT, Context, Scope, check_output_with_facts, classify_output};
use crate::{AppError, CancellationToken, Output};
use std::os::unix::process::ExitStatusExt;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

fn output(stderr: &[u8], stdout: &[u8]) -> Output {
    Output {
        status: std::process::ExitStatus::from_raw(256),
        stdout: stdout.to_vec(),
        stderr: stderr.to_vec(),
    }
}

fn signature(error: AppError) -> (String, String, Option<String>) {
    (error.kind, error.message, error.hint)
}

fn equivalent(bytes: &[u8], width: usize, command: &str, stdout: &[u8]) {
    let mut collector = DiagnosticCollector::default();
    for chunk in bytes.chunks(width) {
        collector.feed(chunk);
    }
    let actual = check_output_with_facts(
        output(b"excerpt is not authoritative", stdout),
        &[command],
        collector.finish(),
    )
    .unwrap_err();
    let expected = classify_output(output(bytes, stdout), &[command]).unwrap_err();
    assert_eq!(
        signature(actual),
        signature(expected),
        "command={command} chunk={width} bytes={:?}",
        String::from_utf8_lossy(bytes)
    );
}

#[test]
fn streaming_diagnostics_match_full_output_priority_and_framing() {
    let mut cases: Vec<Vec<u8>> = CONTAINS
        .iter()
        .map(|(s, _)| s.as_bytes().to_vec())
        .collect();
    cases.extend(TLS_PREFIXES.iter().map(|s| s.to_vec()));
    cases.extend([
        "error: could not apply a commit",
        "fatal: couldn't find remote ref missing",
        "fatal: URL 'https://fixture-user:fixture-secret@example.test' uses plaintext credentials",
        "fatal: url ' uses plaintext credentials", // Overlapping prefix and suffix.
        "fatal: url '' uses plaintext credentials\r\n",
        "fatal: url '' uses plaintext credentials\r", // Lone EOF CR is not stripped.
        " fatal: url '' uses plaintext credentials",
        "schannel: next InitializeSecurityContext failed: SEC_E_UNTRUSTED_ROOT",
        "fatal: schannel: fixture CERT_E_EXPIRED",
        "error: SSL certificate problem fixture-secret",
        "To /tmp/authentication failed/Host key verification failed",
        "fatal: 'authentication failed' does not appear to be a git repository",
        "fatal: repository 'host key verification failed' not found",
        "fatal: repository 'host key verification failed' not found but this is a diagnostic",
        "fatal: 'authentication failed' does not appear to be a git repository ",
        "fatal: could not read Username for 'https://example.test/host key verification failed'",
        "fatal: could not read Password for 'https://example.test/host key verification failed'",
        "fatal: Authentication failed for 'host key verification failed'",
        "error: failed to push some refs to 'authentication failed'",
        "fatal: unable to access 'host key verification failed': SSL certificate problem",
        "fatal: unable to access 'fixture-secret': SSL certificate OpenSSL verify result: self-signed certificate (18)",
        "fatal: unable to access 'SSL certificate OpenSSL verify result: fixture-secret': Could not resolve host",
        "fatal: unable to access 'authentication failed': host key verification failed",
        "fatal: unable to access 'authentication failed without a delimiter",
        "fatal: unable to access '': authentication failed': SSL certificate problem",
        "fatal: unable to access '': SSL certificate problem': unrelated failure",
        "fatal: unable to access '': fatal: 'authentication failed' does not appear to be a git repository",
        "fatal: unable to access ': authentication failed", // Opening quote is not a delimiter.
        "batch response: Authentication failed",
        "batch response: Post \"host key verification failed\": SSL certificate problem",
        "batch response: authentication failed\": unrelated failure",
        "batch response: SSL certificate problem\": authentication failed\": host key verification failed",
        "batch response: \"host key verification failed\": To authentication failed",
        "not possible to fast-forward\rerror: could not apply a commit\npermission denied",
        "permission denied\nhost key verification failed\nfatal: url '' uses plaintext credentials",
        "error: failed to push some refs\nSSL certificate problem",
        "ordinary failure",
        "",
    ].map(|s| s.as_bytes().to_vec()));
    for whitespace in [
        "\t", "\u{b}", "\u{c}", "\u{85}", "\u{a0}", "\u{1680}", "\u{2000}", "\u{200a}", "\u{2028}",
        "\u{2029}", "\u{202f}", "\u{205f}", "\u{3000}", "\u{feff}",
    ] {
        cases.push(
            format!(
                "{whitespace}fatal: unable to access 'permission denied': SSL certificate problem"
            )
            .into_bytes(),
        );
    }
    for prefix in [
        b"\xff".as_slice(),
        b"\xe2",
        b"\xe2\x80",
        b"\xe2\x20",
        b"\xf4\xbf\xbf\xbf",
    ] {
        let mut bytes = prefix.to_vec();
        bytes.extend_from_slice(
            b"fatal: unable to access 'permission denied': SSL certificate problem",
        );
        cases.push(bytes);
    }
    for requested in [false, true] {
        let old = CONTEXT.with(|slot| {
            slot.replace(Some(Context {
                address: "unused".into(),
                token: "unused".into(),
                executable: "unused".into(),
                cancellation: CancellationToken::default(),
                interactive: true,
                requested: Arc::new(AtomicBool::new(requested)),
            }))
        });
        let _scope = Scope(old);
        for bytes in &cases {
            for width in [1, 2, 3, 4, 7, 31, 64, 65, 256, 4096] {
                for command in ["fetch", "pull", "push", "ls-remote"] {
                    equivalent(bytes, width, command, b"");
                }
                equivalent(
                    bytes,
                    width,
                    "pull",
                    b"Automatic merge failed; fix conflicts",
                );
            }
        }
    }
}

#[test]
fn long_lines_and_late_delimiters_do_not_lose_or_invent_failure_facts() {
    let noise = vec![b'x'; MAX_RETAINED_STDERR * 2];
    for (prefix, middle, suffix) in [
        ("", "host key verification failed", ""),
        (
            "fatal: unable to access '",
            "authentication failed",
            "': SSL certificate problem",
        ),
        (
            "batch response: ",
            "host key verification failed",
            "\": ordinary failure",
        ),
        (
            "fatal: '",
            "host key verification failed",
            "' does not appear to be a git repository",
        ),
        (
            "fatal: url '",
            "permission denied",
            "' uses plaintext credentials",
        ),
        ("schannel: ", "SEC_E_UNTRUSTED_ROOT", ""),
    ] {
        let mut bytes = prefix.as_bytes().to_vec();
        bytes.extend_from_slice(&noise);
        bytes.extend_from_slice(middle.as_bytes());
        bytes.extend_from_slice(&noise);
        bytes.extend_from_slice(suffix.as_bytes());
        for width in [7, 4096, 16384] {
            equivalent(&bytes, width, "fetch", b"");
        }
    }
}

#[test]
fn fragmented_diagnostic_combinations_match_the_full_output_classifier() {
    // Deterministic combinations exercise delimiters and frame boundaries
    // without depending on external fuzzing tools or a nondeterministic seed.
    let fragments: &[&[u8]] = &[
        b"fatal: unable to access '",
        b"batch response: ",
        b"fatal: repository '",
        b"fatal: '",
        b"fatal: url '",
        b"To ",
        b"fatal: authentication failed for '",
        b"error: failed to push some refs to '",
        b"SSL certificate problem",
        b"schannel:",
        b"sec_e_untrusted_root",
        b"authentication failed",
        b"host key verification failed",
        b"error: could not apply a commit",
        b"fatal: couldn't find remote ref missing",
        b"' not found",
        b"' does not appear to be a git repository",
        b"' uses plaintext credentials",
        b"': ",
        b"\": ",
        b"\r",
        b"\n",
        b"\r\n",
        b"\xc2\xa0",
        b"\xe2\x80",
        b"\xff",
        b" ",
        b"x",
    ];
    let mut seed = 0x6a09_e667_f3bc_c909_u64;
    for index in 0_usize..2048 {
        let mut bytes = Vec::new();
        for _ in 0..(index % 12 + 1) {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            bytes.extend_from_slice(fragments[seed as usize % fragments.len()]);
        }
        if index.is_multiple_of(2) {
            bytes.make_ascii_uppercase();
        }
        for command in ["fetch", "pull", "push"] {
            equivalent(&bytes, index % 65 + 1, command, b"");
        }
    }
}

#[test]
fn bounded_reader_drains_large_stream_and_retains_exact_prefix() {
    let marker = b"host key verification failed";
    let reader = io::repeat(b'x')
        .take(2 * 1024 * 1024)
        .chain(marker.as_slice())
        .chain(io::repeat(b'x').take(2 * 1024 * 1024));
    let started = std::time::Instant::now();
    let captured = read_transport_stderr(reader).unwrap();
    assert_eq!(captured.retained, vec![b'x'; MAX_RETAINED_STDERR]);
    assert!(captured.retained.capacity() <= MAX_RETAINED_STDERR);
    assert_eq!(captured.diagnostics, DiagnosticFacts(HOST_TRUST));
    eprintln!(
        "scanned 4 MiB unterminated stderr in {:?}",
        started.elapsed()
    );
}

#[test]
fn reader_retries_interruptions_but_propagates_other_io_failures() {
    struct InterruptOnce {
        interrupted: bool,
        cursor: io::Cursor<Vec<u8>>,
    }
    impl Read for InterruptOnce {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            if !self.interrupted {
                self.interrupted = true;
                return Err(io::Error::from(io::ErrorKind::Interrupted));
            }
            self.cursor.read(buffer)
        }
    }
    let captured = read_transport_stderr(InterruptOnce {
        interrupted: false,
        cursor: io::Cursor::new(b"Permission denied".to_vec()),
    })
    .unwrap();
    assert_eq!(captured.retained, b"Permission denied");
    assert_eq!(captured.diagnostics, DiagnosticFacts(AUTHENTICATION));
    struct Broken;
    impl Read for Broken {
        fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
            Err(io::Error::from(io::ErrorKind::BrokenPipe))
        }
    }
    assert_eq!(
        read_transport_stderr(Broken).err().unwrap().kind(),
        io::ErrorKind::BrokenPipe
    );
}

#[test]
fn successful_output_is_not_rewritten_by_diagnostic_facts() {
    let expected = Output {
        status: std::process::ExitStatus::from_raw(0),
        stdout: b"binary\0stdout".to_vec(),
        stderr: b"Permission denied".to_vec(),
    };
    let actual = check_output_with_facts(
        expected.clone(),
        &["fetch"],
        DiagnosticFacts::from_bytes(&expected.stderr),
    )
    .unwrap();
    assert_eq!(actual, expected);
}
