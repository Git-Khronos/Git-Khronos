# Independently configured external tools

Status: initial profile/argument model under source validation. Program execution,
persistence, native commands and preferences UI are not implemented by this checkpoint.
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

## Execution and desktop work still required

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
are argument-model tests, not proof that any program launched. Next gates require owned
executables recording actual argv/cwd/environment, process/cancellation and snapshot
checks, native profile persistence, renderer journeys and real packaged UI acceptance.
