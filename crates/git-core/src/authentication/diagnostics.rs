//! Bounded, incremental facts for transport failures. Retained stderr is only an
//! excerpt; classification must inspect every byte, including arbitrarily long
//! lines and diagnostics beyond that excerpt. No untrusted text is synthesized
//! into the messages passed to the renderer.
use aho_corasick::automaton::{Automaton, StateID};
use aho_corasick::{Anchored, MatchKind, dfa::DFA};
use std::io::{self, Read};
use std::sync::OnceLock;

#[cfg(all(test, unix))]
mod tests;

pub(crate) const MAX_RETAINED_STDERR: usize = 64 * 1024;
const PREFIX_BYTES: usize = 64;
const TAIL_BYTES: usize = 64;
const CREDENTIALS: u16 = 1 << 0;
const HOST_TRUST: u16 = 1 << 1;
const AUTHENTICATION: u16 = 1 << 2;
const FAST_FORWARD: u16 = 1 << 3;
const INTEGRATION: u16 = 1 << 4;
const UPSTREAM: u16 = 1 << 5;
const LOCAL_CHANGES: u16 = 1 << 6;
const PUSH_REJECTED: u16 = 1 << 7;
const TLS: u16 = 1 << 8;
const SCHANNEL_MARKER: u16 = 1 << 9;

const CONTAINS: &[(&str, u16)] = &[
    ("host key verification failed", HOST_TRUST),
    ("remote host identification has changed", HOST_TRUST),
    ("authentication failed", AUTHENTICATION),
    ("could not read username", AUTHENTICATION),
    ("could not read password", AUTHENTICATION),
    ("permission denied", AUTHENTICATION),
    ("invalid username", AUTHENTICATION),
    ("terminal prompts disabled", AUTHENTICATION),
    ("access denied", AUTHENTICATION),
    ("unable to get password", AUTHENTICATION),
    ("unable to get username", AUTHENTICATION),
    ("not possible to fast-forward", FAST_FORWARD),
    (
        "there is no tracking information for the current branch",
        UPSTREAM,
    ),
    ("but no such ref was fetched", UPSTREAM),
    (
        "your local changes to the following files would be overwritten by merge",
        LOCAL_CHANGES,
    ),
    (
        "the following untracked working tree files would be overwritten by merge",
        LOCAL_CHANGES,
    ),
    (
        "cannot pull with rebase: you have unstaged changes",
        LOCAL_CHANGES,
    ),
    (
        "cannot pull with rebase: your index contains uncommitted changes",
        LOCAL_CHANGES,
    ),
    ("cannot rebase: you have unstaged changes", LOCAL_CHANGES),
    (
        "cannot rebase: your index contains uncommitted changes",
        LOCAL_CHANGES,
    ),
    ("non-fast-forward", PUSH_REJECTED),
    ("[rejected]", PUSH_REJECTED),
    ("failed to push some refs", PUSH_REJECTED),
    ("sec_e_untrusted_root", SCHANNEL_MARKER),
    ("sec_e_cert_expired", SCHANNEL_MARKER),
    ("sec_e_wrong_principal", SCHANNEL_MARKER),
    ("cert_e_", SCHANNEL_MARKER),
    ("certificate verification failed", SCHANNEL_MARKER),
];

const TLS_PREFIXES: &[&[u8]] = &[
    b"ssl certificate problem",
    b"ssl certificate verification failed",
    b"ssl certificate openssl verify result:",
    b"server certificate verification failed",
    b"ssl peer certificate",
    b"ssl: certificate",
    b"ssl: no alternative certificate subject name",
    b"error setting certificate",
    b"could not load pem client certificate",
    b"tls: failed to verify certificate",
    b"tls: bad certificate",
    b"x509: certificate",
    b"ssl connect error",
    b"openssl ssl_connect:",
    b"gnutls_handshake() failed",
];

pub(super) fn matches_tls_prefix(detail: &[u8]) -> bool {
    TLS_PREFIXES
        .iter()
        .any(|pattern| detail.starts_with(pattern))
}

fn matcher() -> &'static DFA {
    static MATCHER: OnceLock<DFA> = OnceLock::new();
    MATCHER.get_or_init(|| {
        DFA::builder()
            .match_kind(MatchKind::Standard)
            .build(CONTAINS.iter().map(|(pattern, _)| pattern.as_bytes()))
            .expect("fixed transport diagnostic patterns must form a valid automaton")
    })
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct DiagnosticFacts(u16);

impl DiagnosticFacts {
    #[cfg(all(test, unix))]
    pub(crate) fn from_bytes(bytes: &[u8]) -> Self {
        let mut collector = DiagnosticCollector::default();
        collector.feed(bytes);
        collector.finish()
    }

    /// Canonical facts let the existing classifier keep its branch priority and
    /// caller-thread askpass context. These fixed strings never contain targets,
    /// helper output, usernames, or credentials.
    pub(crate) fn canonical_stderr(self) -> Vec<u8> {
        let mut result = Vec::new();
        for (flag, line) in [
            (CREDENTIALS, "fatal: url '' uses plaintext credentials"),
            (HOST_TRUST, "host key verification failed"),
            (AUTHENTICATION, "authentication failed"),
            (FAST_FORWARD, "not possible to fast-forward"),
            (INTEGRATION, "error: could not apply a commit"),
            (
                UPSTREAM,
                "there is no tracking information for the current branch",
            ),
            (
                LOCAL_CHANGES,
                "cannot pull with rebase: you have unstaged changes",
            ),
            (PUSH_REJECTED, "failed to push some refs"),
            (TLS, "ssl certificate problem"),
        ] {
            if self.0 & flag != 0 {
                result.extend_from_slice(line.as_bytes());
                result.push(b'\n');
            }
        }
        result
    }
}

pub(crate) struct TransportStderr {
    pub(crate) retained: Vec<u8>,
    pub(crate) diagnostics: DiagnosticFacts,
}

pub(crate) fn read_transport_stderr(mut reader: impl Read) -> io::Result<TransportStderr> {
    let mut retained = Vec::new();
    let mut collector = DiagnosticCollector::default();
    let mut buffer = [0; 16 * 1024];
    loop {
        let count = match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        };
        collector.feed(&buffer[..count]);
        let keep = count.min(MAX_RETAINED_STDERR - retained.len());
        retained.extend_from_slice(&buffer[..keep]);
    }
    Ok(TransportStderr {
        retained,
        diagnostics: collector.finish(),
    })
}

#[derive(Clone, Copy)]
struct Prefix {
    bytes: [u8; PREFIX_BYTES],
    len: usize,
}

impl Default for Prefix {
    fn default() -> Self {
        Self {
            bytes: [0; PREFIX_BYTES],
            len: 0,
        }
    }
}

impl Prefix {
    fn push(&mut self, byte: u8) {
        if self.len < self.bytes.len() {
            self.bytes[self.len] = byte;
            self.len += 1;
        }
    }

    fn as_bytes(&self) -> &[u8] {
        &self.bytes[..self.len]
    }
}

#[derive(Clone, Copy)]
struct Tail {
    bytes: [u8; TAIL_BYTES],
    next: usize,
    len: usize,
}

impl Default for Tail {
    fn default() -> Self {
        Self {
            bytes: [0; TAIL_BYTES],
            next: 0,
            len: 0,
        }
    }
}

impl Tail {
    fn push(&mut self, byte: u8) {
        self.bytes[self.next] = byte;
        self.next = (self.next + 1) % TAIL_BYTES;
        self.len = (self.len + 1).min(TAIL_BYTES);
    }

    fn ends_with(&self, suffix: &[u8], strip_cr: bool) -> bool {
        debug_assert!(suffix.len() < TAIL_BYTES);
        let last_is_cr =
            self.len > 0 && self.bytes[(self.next + TAIL_BYTES - 1) % TAIL_BYTES] == b'\r';
        let skip = usize::from(strip_cr && last_is_cr);
        if self.len < suffix.len() + skip {
            return false;
        }
        let start = (self.next + TAIL_BYTES - skip - suffix.len()) % TAIL_BYTES;
        suffix
            .iter()
            .enumerate()
            .all(|(index, byte)| self.bytes[(start + index) % TAIL_BYTES] == *byte)
    }
}

struct FactScanner {
    automaton: &'static DFA,
    state: StateID,
    flags: u16,
    prefix: Prefix,
}

impl FactScanner {
    fn new() -> Self {
        let automaton = matcher();
        Self {
            automaton,
            state: automaton
                .start_state(Anchored::No)
                .expect("unanchored searches are enabled"),
            flags: 0,
            prefix: Prefix::default(),
        }
    }

    fn push(&mut self, byte: u8) {
        self.prefix.push(byte);
        self.state = self.automaton.next_state(Anchored::No, self.state, byte);
        if self.automaton.is_match(self.state) {
            for index in 0..self.automaton.match_len(self.state) {
                let pattern = self.automaton.match_pattern(self.state, index).as_usize();
                self.flags |= CONTAINS[pattern].1;
            }
        }
    }

    fn finish(self) -> DiagnosticFacts {
        let prefix = self.prefix.as_bytes();
        let mut flags = self.flags & !SCHANNEL_MARKER;
        if prefix.starts_with(b"error: could not apply ") {
            flags |= INTEGRATION;
        }
        if prefix.starts_with(b"fatal: couldn't find remote ref ") {
            flags |= UPSTREAM;
        }
        let detail = prefix
            .strip_prefix(b"fatal: ")
            .or_else(|| prefix.strip_prefix(b"error: "))
            .unwrap_or(prefix);
        if matches_tls_prefix(detail)
            || (detail.starts_with(b"schannel:") && self.flags & SCHANNEL_MARKER != 0)
        {
            flags |= TLS;
        }
        DiagnosticFacts(flags)
    }
}

struct DetailScanner {
    delimiter: &'static [u8],
    tail: Tail,
    active: bool,
    scanner: FactScanner,
}

impl DetailScanner {
    fn new(delimiter: &'static [u8], active: bool) -> Self {
        Self {
            delimiter,
            tail: Tail::default(),
            active,
            scanner: FactScanner::new(),
        }
    }

    fn push(&mut self, byte: u8) {
        self.tail.push(byte);
        if self.tail.ends_with(self.delimiter, false) {
            // rsplit_once semantics: a later delimiter invalidates ALL earlier
            // facts, including an earlier anchored TLS prefix.
            self.scanner = FactScanner::new();
            self.active = true;
        } else if self.active {
            self.scanner.push(byte);
        }
    }

    fn finish(self) -> DiagnosticFacts {
        if self.active {
            self.scanner.finish()
        } else {
            DiagnosticFacts::default()
        }
    }
}

enum LineRoute {
    Pending(Prefix),
    Ignore,
    Constant(DiagnosticFacts),
    Common {
        scanner: FactScanner,
        missing: Option<(&'static [u8], Tail)>,
    },
    Detail(DetailScanner),
}

impl Default for LineRoute {
    fn default() -> Self {
        Self::Pending(Prefix::default())
    }
}

impl LineRoute {
    fn routed(bytes: &[u8]) -> Self {
        if bytes.starts_with(b"to ") {
            return Self::Ignore;
        }
        // Strip the opening quote too. A delimiter crossing that boundary is
        // not part of the access substring inspected by the original parser.
        if let Some(payload) = bytes.strip_prefix(b"fatal: unable to access '") {
            let mut scanner = DetailScanner::new(b"': ", false);
            for &byte in payload {
                scanner.push(byte);
            }
            return Self::Detail(scanner);
        }
        if let Some(payload) = bytes.strip_prefix(b"batch response: ") {
            let mut scanner = DetailScanner::new(b"\": ", true);
            for &byte in payload {
                scanner.push(byte);
            }
            return Self::Detail(scanner);
        }
        if [
            b"fatal: could not read username for '".as_slice(),
            b"fatal: could not read password for '".as_slice(),
            b"fatal: authentication failed for '".as_slice(),
        ]
        .iter()
        .any(|prefix| bytes.starts_with(prefix))
        {
            return Self::Constant(DiagnosticFacts(AUTHENTICATION));
        }
        if bytes.starts_with(b"error: failed to push some refs to '") {
            return Self::Constant(DiagnosticFacts(PUSH_REJECTED));
        }
        let suffix = if bytes.starts_with(b"fatal: '") {
            Some(b"' does not appear to be a git repository".as_slice())
        } else if bytes.starts_with(b"fatal: repository '") {
            Some(b"' not found".as_slice())
        } else {
            None
        };
        let mut routed = Self::Common {
            scanner: FactScanner::new(),
            missing: suffix.map(|suffix| (suffix, Tail::default())),
        };
        for &byte in bytes {
            routed.push(byte);
        }
        routed
    }

    fn push(&mut self, byte: u8) {
        match self {
            Self::Pending(prefix) => {
                prefix.push(byte);
                if prefix.len == PREFIX_BYTES {
                    let routed = Self::routed(prefix.as_bytes());
                    *self = routed;
                }
            }
            Self::Common { scanner, missing } => {
                scanner.push(byte);
                if let Some((_, tail)) = missing {
                    tail.push(byte);
                }
            }
            Self::Detail(scanner) => scanner.push(byte),
            Self::Ignore | Self::Constant(_) => {}
        }
    }

    fn finish(self) -> DiagnosticFacts {
        match self {
            Self::Pending(prefix) if prefix.len == 0 => DiagnosticFacts::default(),
            Self::Pending(prefix) => Self::routed(prefix.as_bytes()).finish(),
            Self::Ignore => DiagnosticFacts::default(),
            Self::Constant(facts) => facts,
            Self::Common { scanner, missing } => {
                if missing.is_some_and(|(suffix, tail)| tail.ends_with(suffix, false)) {
                    DiagnosticFacts::default()
                } else {
                    scanner.finish()
                }
            }
            Self::Detail(scanner) => scanner.finish(),
        }
    }
}

#[derive(Default)]
struct LeadingWhitespace {
    done: bool,
    bytes: [u8; 4],
    len: usize,
    width: usize,
}

impl LeadingWhitespace {
    fn flush(&mut self, route: &mut LineRoute) {
        for &byte in &self.bytes[..self.len] {
            route.push(byte);
        }
        self.len = 0;
        self.done = true;
    }

    fn push(&mut self, byte: u8, route: &mut LineRoute) {
        if self.done {
            route.push(byte);
        } else if self.len > 0 {
            self.bytes[self.len] = byte;
            self.len += 1;
            if !(0x80..=0xbf).contains(&byte) || self.len == self.width {
                let whitespace = std::str::from_utf8(&self.bytes[..self.len])
                    .ok()
                    .and_then(|text| text.chars().next())
                    .is_some_and(char::is_whitespace);
                if whitespace {
                    self.len = 0;
                } else {
                    self.flush(route);
                }
            }
        } else if byte.is_ascii() {
            // char::is_whitespace also includes vertical tab, unlike some byte
            // whitespace predicates. It is the same predicate trim_start uses.
            if !char::from(byte).is_whitespace() {
                self.done = true;
                route.push(byte);
            }
        } else {
            self.width = match byte {
                0xc2..=0xdf => 2,
                0xe0..=0xef => 3,
                0xf0..=0xf4 => 4,
                _ => {
                    self.done = true;
                    route.push(byte);
                    return;
                }
            };
            self.bytes[0] = byte;
            self.len = 1;
        }
    }
}

#[derive(Default)]
struct NormalizedLine {
    leading: LeadingWhitespace,
    route: LineRoute,
}

impl NormalizedLine {
    fn push(&mut self, byte: u8) {
        self.leading.push(byte, &mut self.route);
    }

    fn finish(mut self) -> DiagnosticFacts {
        if self.leading.len > 0 {
            self.leading.flush(&mut self.route);
        }
        self.route.finish()
    }
}

#[derive(Default)]
struct RawLine {
    prefix: Prefix,
    tail: Tail,
}

impl RawLine {
    fn push(&mut self, byte: u8) {
        self.prefix.push(byte);
        self.tail.push(byte);
    }

    fn credentials(&self, strip_cr: bool) -> bool {
        self.prefix.as_bytes().starts_with(b"fatal: url '")
            && self
                .tail
                .ends_with(b"' uses plaintext credentials", strip_cr)
    }
}

#[derive(Default)]
pub(crate) struct DiagnosticCollector {
    facts: DiagnosticFacts,
    raw: RawLine,
    line: NormalizedLine,
}

impl DiagnosticCollector {
    pub(crate) fn feed(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            let byte = byte.to_ascii_lowercase();
            // String::lines strips CR only before LF. Diagnostic lines, unlike
            // this raw credentials guard, split on either CR or LF.
            if byte == b'\n' {
                if self.raw.credentials(true) {
                    self.facts.0 |= CREDENTIALS;
                }
                self.raw = RawLine::default();
            } else {
                self.raw.push(byte);
            }
            if matches!(byte, b'\r' | b'\n') {
                self.facts.0 |= std::mem::take(&mut self.line).finish().0;
            } else {
                self.line.push(byte);
            }
        }
    }

    pub(crate) fn finish(mut self) -> DiagnosticFacts {
        if self.raw.credentials(false) {
            self.facts.0 |= CREDENTIALS;
        }
        self.facts.0 |= self.line.finish().0;
        self.facts
    }
}
