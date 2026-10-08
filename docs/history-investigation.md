# History investigation

Use the history search button, **Ctrl/Cmd+F**, or **Search Commits** in the
command palette. The focused message field performs case-insensitive literal
substring matching against the entire commit message, including its body.
Advanced filters are disclosed separately: author name/email, hexadecimal
commit-ID prefix, inclusive author calendar dates, repository-relative literal
path, and a single ref or `A..B` range. Empty scope searches all local refs and
HEAD, independently of graph loading and visibility. Remote-tracking refs are
local snapshots; this does not fetch remote history.

Default scope excludes the reserved `refs/git-chronos/recovery/*` namespace,
so protected recovery captures and their synthetic index/worktree commits do
not appear solely because an internal recovery ref retains them. Explicit OID
or range queries can still inspect those objects. Objects also reachable from
a user-visible ref remain part of ordinary history.

Each search continuation examines at most 200 history records and returns
matching commits. **Continue searching older history** advances the pinned
query, even when the current page has no matches. Only a completed search can
report no matches; timeout, cancellation, and output-limit failures are
explicitly incomplete. Returned results and the last successful cursor survive
a failure so that retry does not lose or duplicate a page.

Ref tips are resolved to object IDs at search start. New commits, moved refs,
and graph filters do not alter subsequent pages. Restart search to include new
history. These pins are read cursors, not persistent recovery refs: externally
pruned objects produce a visible Git failure. Searches see only locally
available history, including the shallow boundary if the repository is shallow.
An unborn repository with no commit refs has an empty local history.

Selecting a result opens commit details even when that commit has never been
loaded into the graph. The graph is not replaced or silently enlarged.
The inline graph field remains a separately labelled **Filter loaded graph**
shortcut, not evidence of whole-repository search completeness.

## File history and blame

From a file's diff, choose **History** and use **Load older file history**.
Pages contain 100 entries and follow Git's documented single-path `--follow`
rename traversal. Historical entries retain the path at that commit and the
previous rename path; opening an entry uses those paths, not the current name.
Git rename identification is similarity-based, so unrelated replacements and
ambiguous merge-path histories cannot promise identity continuity.

Git's rename traversal needs the prefix preceding a page boundary. The native
query replays that prefix under the same timeout/output limits instead of using
`--skip`, which can suppress earlier rename transitions. Very deep or expensive
histories can therefore hit an explicit limit; no truncated prefix is presented
as a complete history. Non-UTF-8 historical filenames fail explicitly.

Blame commit IDs open the blamed commit at its porcelain-reported historical
filename. **Parent** opens that commit's first parent and resolves renamed paths
against that parent. Root commits report that no parent exists. For merge
commits this action means **first parent**, not an inferred originating parent.

## Comparisons and limits

**Compare two revisions** in history search offers:

- **Direct tips:** base tree versus target tree.
- **Merge base:** the unique common-ancestor tree versus target tree.

Unrelated histories and multiple merge bases fail rather than choosing an
arbitrary ancestor. The inspector identifies the comparison mode and shows the
resolved object IDs.

Native commands use argument arrays, literal pathspecs, and validated ref/OID,
date, and repository-relative-path input. No shell interpolation, external diff
driver, or text-conversion helper is used for history queries. Git 2.34 or newer
is the application's supported baseline; these commands require no newer Git
options. Search subprocesses have a 15-second time limit and separate 16-MiB
stdout/stderr limits. Ref discovery is limited to 4,096 tips and a bounded
resolution window; choose a single ref/range for larger ref sets. Cancellation
terminates and reaps the operation's actual process tree. This is a read-only
operation and does not mutate repository state.

Browser preview intentionally reports native investigation unavailable, rather
than substituting loaded mock rows. Renderer fixtures exercise interactions,
while Rust fixtures execute real Git for older commits, hidden branches,
pagination, rename continuity, comparisons, and cancellation.
