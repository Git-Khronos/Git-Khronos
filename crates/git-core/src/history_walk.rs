//! In-process, date-ordered commit history walk backed by gitoxide (`gix`).
//!
//! The walk reproduces the observable output of
//! `git log --decorate=short --format=%H %P %an %ae %aI %s %b %D` for the
//! fields the desktop renders, without spawning a Git process per page.
//! Reference tips and decorations are taken from the Git CLI once per reset
//! so `--all` and `%D` keep Git's exact semantics.

use crate::CommitSummary;
use gix::ObjectId;
use gix::bstr::{BStr, ByteSlice};
use std::cmp::{Ordering, Reverse};
use std::collections::{BinaryHeap, HashMap, HashSet};
use std::path::{Path, PathBuf};

/// Objects decoded per page are reused across pages through this cache.
const OBJECT_CACHE_BYTES: usize = 32 * 1024 * 1024;

struct Queued {
    committer_seconds: i64,
    sequence: Reverse<u64>,
    summary: CommitSummary,
    parents: Vec<ObjectId>,
}

impl PartialEq for Queued {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for Queued {}

impl PartialOrd for Queued {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Queued {
    // Newest committer date first; equal dates keep insertion order, like
    // Git's date-ordered revision queue.
    fn cmp(&self, other: &Self) -> Ordering {
        self.committer_seconds
            .cmp(&other.committer_seconds)
            .then(self.sequence.cmp(&other.sequence))
    }
}

pub(crate) struct HistoryWalk {
    path: PathBuf,
    repository: gix::Repository,
    queue: BinaryHeap<Queued>,
    sequence: u64,
    seen: HashSet<ObjectId>,
    decorations: HashMap<ObjectId, Vec<String>>,
    stash_oids: HashSet<ObjectId>,
}

impl HistoryWalk {
    /// Opens the repository at `path`. Returns `None` when gitoxide cannot
    /// open it, so callers can keep using the Git CLI.
    pub(crate) fn open(path: &Path) -> Option<Self> {
        let mut repository = gix::discover(path).ok()?;
        repository.object_cache_size_if_unset(OBJECT_CACHE_BYTES);
        Some(Self {
            path: path.to_path_buf(),
            repository,
            queue: BinaryHeap::new(),
            sequence: 0,
            seen: HashSet::new(),
            decorations: HashMap::new(),
            stash_oids: HashSet::new(),
        })
    }

    pub(crate) fn opened_from(&self, path: &Path) -> bool {
        self.path == path
    }

    /// Starts a walk from `tips`, excluding commits already shown in `initial`.
    pub(crate) fn reset(
        &mut self,
        tips: &[CommitSummary],
        initial: &[CommitSummary],
        stash_oids: &[String],
    ) {
        self.queue.clear();
        self.sequence = 0;
        self.seen = initial
            .iter()
            .filter_map(|commit| parse_oid(&commit.oid))
            .collect();
        self.decorations = tips
            .iter()
            .filter(|tip| !tip.decorations.is_empty())
            .filter_map(|tip| Some((parse_oid(&tip.oid)?, tip.decorations.clone())))
            .collect();
        self.stash_oids = stash_oids.iter().filter_map(|oid| parse_oid(oid)).collect();

        let frontier = tips
            .iter()
            .map(|tip| tip.oid.as_str())
            .chain(initial.iter().flat_map(|commit| {
                let follow = if self.is_stash(&commit.oid) {
                    1
                } else {
                    usize::MAX
                };
                commit.parents.iter().take(follow).map(String::as_str)
            }))
            .filter_map(parse_oid)
            .collect::<Vec<_>>();
        for oid in frontier {
            self.enqueue(oid);
        }
    }

    pub(crate) fn has_more(&self) -> bool {
        !self.queue.is_empty()
    }

    pub(crate) fn next_page(&mut self, limit: usize) -> Vec<CommitSummary> {
        let mut commits = Vec::with_capacity(limit.min(1024));
        while commits.len() < limit {
            let Some(next) = self.queue.pop() else {
                break;
            };
            for parent in next.parents {
                self.enqueue(parent);
            }
            commits.push(next.summary);
        }
        commits
    }

    fn is_stash(&self, oid: &str) -> bool {
        parse_oid(oid).is_some_and(|oid| self.stash_oids.contains(&oid))
    }

    fn enqueue(&mut self, oid: ObjectId) {
        if !self.seen.insert(oid) {
            return;
        }
        // Missing objects (for example beyond a shallow boundary) end that
        // line of history, matching how Git stops at grafted parents.
        let Some(queued) = self.load(oid) else {
            return;
        };
        self.queue.push(queued);
    }

    fn load(&mut self, oid: ObjectId) -> Option<Queued> {
        let sequence = Reverse(self.sequence);
        self.sequence += 1;
        let commit = self.repository.find_commit(oid).ok()?;
        let decoded = commit.decode().ok()?;
        let latin1 = decoded.encoding.is_some_and(is_latin1_encoding);
        let text = |value: &BStr| decode_text(value, latin1);

        let mut parents = decoded.parents().collect::<Vec<_>>();
        if self.stash_oids.contains(&oid) {
            parents.truncate(1);
        }
        let committer_seconds = decoded.time().map(|time| time.seconds).unwrap_or(0);
        // `CommitRef::author()` trims Unicode whitespace; Git keeps it, so parse
        // the raw header and trim ASCII whitespace only.
        let (author_name, author_email, authored_at) =
            match gix::actor::SignatureRef::from_bytes(decoded.author.as_bytes()) {
                Ok(author) => {
                    let trim = |value: &BStr| -> String { text(value.trim_ascii().as_bstr()) };
                    (
                        trim(author.name),
                        trim(author.email),
                        author
                            .time()
                            .map(|time| format_iso8601_strict(time.seconds, time.offset))
                            .unwrap_or_default(),
                    )
                }
                Err(_) => Default::default(),
            };
        let message = text(decoded.message);
        let (subject, description) = split_message(&message);

        Some(Queued {
            committer_seconds,
            sequence,
            summary: CommitSummary {
                oid: oid.to_string(),
                parents: parents.iter().map(ObjectId::to_string).collect(),
                author_name,
                author_email,
                authored_at,
                subject,
                description,
                decorations: self.decorations.get(&oid).cloned().unwrap_or_default(),
            },
            parents,
        })
    }
}

fn parse_oid(value: &str) -> Option<ObjectId> {
    ObjectId::from_hex(value.as_bytes()).ok()
}

fn is_latin1_encoding(encoding: &BStr) -> bool {
    let encoding = encoding.to_ascii_lowercase();
    matches!(
        encoding.as_slice(),
        b"iso-8859-1" | b"iso8859-1" | b"latin1" | b"latin-1" | b"l1"
    )
}

fn decode_text(value: &BStr, latin1: bool) -> String {
    if latin1 && value.to_str().is_err() {
        value.iter().map(|&byte| char::from(byte)).collect()
    } else {
        value.to_str_lossy().into_owned()
    }
}

/// Splits a raw commit message into Git's `%s` (first paragraph joined into
/// one line) and the trimmed remainder used as the description.
fn split_message(message: &str) -> (String, String) {
    let mut lines = message.split('\n').peekable();
    while lines.next_if(|line| line.trim().is_empty()).is_some() {}

    let mut subject = String::new();
    for line in lines.by_ref() {
        if line.trim().is_empty() {
            break;
        }
        if !subject.is_empty() {
            subject.push(' ');
        }
        subject.push_str(line.trim_end());
    }
    let description = lines.collect::<Vec<_>>().join("\n").trim().to_owned();
    (subject, description)
}

/// Formats a Unix timestamp like Git's strict ISO 8601 date (`%aI`).
pub(crate) fn format_iso8601_strict(seconds: i64, offset_seconds: i32) -> String {
    let local = seconds + i64::from(offset_seconds);
    let days = local.div_euclid(86_400);
    let second_of_day = local.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let clock = format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}",
        second_of_day / 3600,
        second_of_day % 3600 / 60,
        second_of_day % 60
    );
    if offset_seconds == 0 {
        return format!("{clock}Z");
    }
    let sign = if offset_seconds < 0 { '-' } else { '+' };
    let minutes = offset_seconds.unsigned_abs() / 60;
    format!("{clock}{sign}{:02}:{:02}", minutes / 60, minutes % 60)
}

/// Converts days since 1970-01-01 to a proleptic Gregorian calendar date.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_index + 2) / 5 + 1) as u32;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    } as u32;
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_strict_iso_dates_like_git() {
        assert_eq!(
            format_iso8601_strict(1_577_836_800, 0),
            "2020-01-01T00:00:00Z"
        );
        assert_eq!(
            format_iso8601_strict(1_577_836_800, -9000),
            "2019-12-31T21:30:00-02:30"
        );
        assert_eq!(
            format_iso8601_strict(951_782_400, 3600),
            "2000-02-29T01:00:00+01:00"
        );
        assert_eq!(format_iso8601_strict(-1, 0), "1969-12-31T23:59:59Z");
    }

    #[test]
    fn splits_subject_paragraph_and_description() {
        assert_eq!(
            split_message("\n\n  lead  \nsecond line\t\n\n\nbody\n\nmore\n"),
            ("  lead second line".to_owned(), "body\n\nmore".to_owned())
        );
        assert_eq!(split_message("only"), ("only".to_owned(), String::new()));
    }
}
