# Independently configured external tools

Status: the terminal/agent PTY, versioned preferences and explicit launcher have
combined Linux renderer and exact-package qualification recorded below.
External editor, diff and merge program execution remains unimplemented.
Inventory: G07, G20 and W05. No complete tool-integration parity claim is made.

## Capability and sources

Public sources inspected 2026-11-01:

- https://help.gitkraken.com/gitkraken-desktop/preferences/
- https://git-scm.com/docs/git-difftool
- https://git-scm.com/docs/git-mergetool

These sources establish configurable editors, terminals, agent commands and
comparison/resolution tools, plus documented Git file roles and exit behavior.
The profile format, argument model and following implementation design are original.
No vendor implementation, visual composition, assets or documentation was copied.

## Initial profile and literal argument model

Version-one application profiles identify an editor, diff, merge, terminal or agent
program by stable ID, display name, absolute executable path and separate arguments.
Saving a profile does not execute a program or change Git configuration. Unsupported
versions, unknown serialized fields, invalid IDs/names and excessive data refuse.

Arguments use the closed placeholders `{repository}`, `{file}`, `{line}`, `{before}`,
`{after}`, `{base}` and `{merged}`. Doubled braces represent literal braces. Placeholders
are role-specific: file/line for editors, before/after for diff or merge, base/output
for merge, repository for all. Editors require a file argument, diffs both before/after,
and merge profiles an output argument. Terminal/agent profiles can rely on their cwd.
Missing values and invalid one-based lines refuse; no argument is silently omitted.

Rendering preserves each argument boundary, empty arguments, Unicode, quotes and shell
punctuation. Substituted values are not parsed again. This module performs no shell
expansion, command-string splitting, executable lookup, path authorization or process
execution. Context paths must be bounded absolute UTF-8 paths; this is shape validation,
not a proof of containment, existence, identity or authority to execute.

Limits: 32 arguments, 16 KiB per template/expanded argument and 64 KiB total. IDs are
bounded ASCII identifiers; display names and executable/context paths have independent
bounds. Profile Debug output omits executable paths and argument values.

## Terminal and agent candidate

Main-window commands validate a profile or open a configured terminal against a registered
repository session. Terminal and agent profiles expand a captured repository cwd and
literal argv, then reuse the existing owned PTY registry, I/O, close/retry and exit lifecycle.
File-tool profiles refuse this endpoint before PTY setup. Existing fixed agent launchers
and the system-shell fallback remain available. No extra shell is introduced. The same
eight inherited repository selectors are cleared as for existing terminals; ordinary
user configuration remains available.

Application-local storage contains a version-one list of at most 16 terminal/agent
profiles and an optional default terminal ID. The preferences form accepts separate
argument rows, validates through the native command before saving and commits storage
before live state. A failed write preserves existing preferences. Invalid stored data is
preserved until an explicit reviewed clear. Saving, loading, selecting or deleting a
profile starts no program, changes no Git configuration and does not close existing
sessions. New terminal actions use the current default; explicit agent-launcher selection
can start a saved profile. A retry retains the originally submitted profile snapshot.
These initial focused results are supplemented by the complete combined Linux
renderer and packaged UI qualification recorded below.

These preferences contain ordinary program paths/arguments, not secret storage. Users
configure and authenticate installed programs independently. Launching an agent proves
neither task state nor approval, worktree isolation, resume or provider integration.

## External file-tool execution candidate

The independent [reviewed file-tool candidate](external-file-tools.md) now implements
native preparation, owned direct execution, raw-byte result review, separate saving
and staging, and checked cleanup. Its original UI has focused renderer and exact
Linux-package evidence, including normal/compact capture review. All 1,484 current
renderer cases and 471 broad package executions now pass, alongside 45 optional
transport source cases. Missing-target save and restart storage management remain
open. The requirements below remain the acceptance boundary.

### Required behavior

Native execution must derive captured repository/file roles and private snapshots,
validate their current ownership/identity and the selected program, and explicitly
review the program, cwd and argument vector. No repository-provided setup program
runs automatically. Configuration persistence must be application-owned and versioned.

Reuse owned process/PTY lifecycle and cancellation. Clear inherited repository selectors
and application-owned prompt bridges consistently with existing terminal behavior.
An explicit shell is a selected program; the application never introduces one implicitly.
A GUI handoff or zero exit proves neither saving nor conflict resolution or staging.
Wait-for-exit and detached-launch lifetimes need separate snapshot cleanup semantics.
Cancellation must not terminate an existing IDE or all processes by program name.

Dirty editor drafts need save/open-saved/stay choices before handoff. Comparisons need
fetch-free exact snapshots. Merge results need a fresh explicit review and staging step;
do not infer resolution from exit status or timestamps. Other platforms and public agent
status/resume integrations require separate qualification.

## Evidence gates

Six focused Unix argument-model tests pass for literal boundaries, escaped/nonrecursive
placeholders, role requirements, missing values, bounds and strict profile data. These
are argument-model tests. Three native tests additionally pass, including a real owned
Python recorder under a PTY proving literal argv, captured cwd, TTY endpoints, absence
of inherited repository selectors and preservation of user configuration. Six preference
transaction tests pass for persistence/reload, corrupt data, storage/validation failures,
concurrent saves and deletion/default behavior. Initial decorator-based test setup failed
before collecting tests; a normal injection-token factory permits testing the same store.
All 178 frontend unit tests, generated-contract freshness/type checks and workspace
all-target Clippy pass. The complete focused renderer group passes 23 cases, including
validation refusal, literal argv handoff, retrying the original captured profile after
a saved profile changes, default consistency and 320/700px layouts. Actual compact
screenshots were reviewed; controls use existing project theme tokens.

Production compilation passes at approximately 1.38353 MB under the unchanged
1.40 MB hard cap; all 51 JavaScript assets pass the production-preview exclusion
check. Existing soft bundle/style warnings remain. The initial template attempt failed
on unescaped literal placeholder braces; character entities corrected it.

The configured-profile source passes the complete 808-test Rust candidate gate
(`parity-configured-tools-full-rust`; unique tests are counted once despite the
then-current Nx dependency expansion executing them twice). The configured
program core/native source remains unchanged in the combined package.

The fresh combined Linux package `ecbdad48a0f7` passes all 213 normal and 214
inherited-environment native scenarios. All three configured-program scenarios
execute in each mode: real PTY argument/cwd/configuration checks, invalid-profile
refusal, and normal preferences persistence/default/explicit-launch/close/delete
behavior. These are three distinct configured-program cases executed twice, not
six distinct cases. The desktop screenshot was reviewed. The first two attempts
used a nonexistent DOM name selector for a dynamic form input; the helper now
waits for its existing accessible label. Those failures are retained separately.
Exact artifact hashes and full-run evidence are recorded in the
[editor specification](working-file-editor.md#combined-package-and-acceptance-recovery).

`parity-combined-renderer-network-recheck` also passes all 1,424 renderer tests
on clean `0696f9a64b2d368205767127b7b1a63df1ed3ce3`, with one worker, zero
retries and zero skips. The 712 source inputs remain unchanged. Application runtime
is identical to the retained package source; later changes are reviewed harness
and documentation only. The final [editor qualification](working-file-editor.md#complete-combined-linux-qualification-2026-11-01)
records source/artifact association and the separately retained failed attempts.
Remote CI and other platforms remain separate gates. External file-tool snapshot,
wait/detach and cancellation behavior still needs its own implementation and tests.
