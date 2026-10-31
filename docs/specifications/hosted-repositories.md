# Hosted repository discovery and forks

Status: independent requirements for H02, with a source-only GitHub discovery
checkpoint and a desktop discovery/clone flow qualified for the recorded Linux artifact.
This specification does not claim full H02 acceptance. Provider
coverage remains part of the full parity
objective; implementing one adapter does not qualify another host or account type.

## Capability and authorities

The [public fork capability guide](https://help.gitkraken.com/gitkraken-desktop/fork/)
describes detecting an existing GitHub/GitHub Enterprise fork and linking it as a
remote, or creating a fork when needed. This is a capability reference only.
Khronos will use its own interface, account model and review sequence.

Public protocol authorities:

- [GitHub repository API](https://docs.github.com/en/rest/repos/repos): authenticated
  repository listing and repository metadata.
- [GitHub fork API](https://docs.github.com/en/rest/repos/forks): fork listing and
  creation, including destination organization, requested name and branch scope.
- [Git remotes](https://git-scm.com/docs/git-remote): local remote configuration.
- [Git clone](https://git-scm.com/docs/git-clone): obtaining a local repository.

No vendor implementation, package contents, assets, private APIs or copied
interface text are implementation material for this feature.

## Discover and clone

Show the selected host and account with every result set. Fetch accessible
repositories in bounded pages; preserve identity, query and pagination bindings
between requests. Distinguish an empty page, an incomplete result, cancellation,
authentication refusal and provider failure. Do not describe one page as the full
account catalogue. A refresh must not append results from a different account.

Present canonical repository identity, owner, name, description, visibility,
archival state, default branch and fork relationship when supplied. Treat absent
metadata as unknown. Do not infer write permission from visibility or ownership
text. Repository IDs and account IDs must survive the native/renderer boundary
without numeric precision loss.

Clone uses the existing explicit destination and transport review. The chosen
SSH or HTTPS URL must match the selected repository and host. Reject embedded
credentials, unsupported schemes and mismatched response identities. Never put
provider tokens into clone URLs, argv, activity text, persisted previews or logs.
Discovery itself does not clone, fetch or change repository configuration.

## Detect, create and reconcile a fork

For an open repository, bind the source provider identity to the reviewed local
remote configuration. Identify a usable existing fork by repository ancestry
and destination ownership, not solely by its name. Show its actual identity and
available clone transports. A same-name unrelated repository is a conflict.

Creating a fork is a separate reviewed provider write. The preview identifies
source repository, acting account, destination owner, requested name and branch
scope. Revalidate these bindings immediately before dispatch, and consume the
native preview once. Permission errors must remain visible; no fallback may
silently create a repository under another account or organization.

An accepted creation request and a ready-to-use fork are separate outcomes.
Verify the resulting repository identity and parent/source relationship before
using its clone URL. Bounded follow-up reads may establish readiness. An expired
wait, interrupted reply or unknown write outcome requires reconciliation; it
must not automatically repeat the creation request. If readiness is unknown,
retain enough nonsensitive context for explicit inspection or another read.

## Add a local remote

Remote attachment has its own local preview: repository path/session, proposed
remote name, validated URL and exact existing configuration. Preserve current
remotes unless the user explicitly reviews a separate change. A default new
fork remote can coexist with the source remote; do not require an implicit
rename, URL replacement or upstream reassignment.

Reject a name collision or a changed binding instead of overwriting it. Report
local attachment separately from provider creation. If attachment fails after a
fork was created, retain the provider outcome and offer a fresh local preview.
No implicit fetch, push, clone, remote deletion or remote repository deletion
is included in attachment.

## Behavioral acceptance

Use owned API fixtures, temporary Git repositories and independent Git output.
Do not use real account writes as an automatic acceptance test.

- Exercise paging, sorting/filtering scope, account changes, stale responses,
  canceled reads, unavailable metadata, permission failures and bounded output.
- Verify selected clone URL/transport/destination and existing clone recovery.
- Cover an existing fork, unrelated name collision, organization destination,
  disabled forking, accepted-but-pending creation and uncertain write replies.
- Prove that preview alteration, expiry, reuse and wrong repository/account
  bindings cannot dispatch a provider write or change local remotes.
- Assert local config bytes, refs, HEAD, index and files on refusal; independently
  inspect the added remote on success. Preserve existing remotes and tracking.
- Verify that provider success followed by local failure remains a partial
  outcome and never deletes the newly created fork as an automatic rollback.
- Qualify typed IPC, original renderer controls, keyboard/compact layouts and
  the exact packaged executable before accepting the desktop workflow.


## Initial discovery core checkpoint (2026-10-31)

`crates/git-core/src/hosted_repositories.rs` implements selected-account GitHub
catalogue reads and fresh inspection of a selected repository. It reuses the
existing cancellable CLI transport, which captures the account token separately
for each operation. An allowlist of metadata crosses the core API; raw provider
responses and temporary clone tokens are excluded. Account and repository IDs
are serialized as decimal strings.

Requests use pages of fifty entries, explicit sort/filter parameters and the
original account ID for subsequent pages. A full page advertises a possible next
page without claiming that the account catalogue is complete. Selected repository
inspection checks both account and repository identities. Canonical web, SSH and
HTTPS URLs must agree with the returned owner/name; missing optional metadata
remains unknown.

Seven owned API-fixture tests cover these behaviors without dispatching provider
writes. The final full source run passes 658 Rust and 166 frontend tests, with
45 Rust cases ignored. Angular build, Cargo check and Clippy with warnings denied
also pass. No discovery IPC, desktop catalogue, account-bound clone handoff, fork
creation/reconciliation or local remote-attachment workflow is qualified by this
source checkpoint. Enterprise and other providers remain open.

## Read-only fork discovery core checkpoint (2026-10-31)

`crates/git-core/src/hosted_forks.rs` implements bounded GitHub fork pages and a
separate fresh inspection of a selected candidate. Each request binds the source
repository ID and canonical name to the acting account ID. Pages contain at most
fifty candidates; a full page indicates possible continuation. An empty page
does not prove that another page or owner has no fork. Provider errors remain
errors, and no read failure is interpreted as permission to create a fork.

Listing alone does not verify a fork for attachment. Fresh inspection requires
the selected owner and repository IDs, canonical names, reported fork status,
parent metadata and the same confirmed network root as the source. A fork of
another fork is supported when the public metadata identifies the common root.
Unknown ancestry, a same-name unrelated repository, a changed account or source,
disabled access and inconsistent URLs are refused. IDs remain decimal strings;
raw responses and temporary clone tokens do not leave the core API.

Seven owned response fixtures exercise these transitions without provider writes
or local repository changes. The full source gate passes 665 Rust tests and 166
frontend tests, with 45 Rust cases ignored. Angular compilation, Cargo workspace
checks and Clippy with warnings denied also pass. This core-only checkpoint did not qualify native IPC or a
desktop fork screen, create a fork, establish object readiness, reconcile an
uncertain write or attach a local remote. Those workflows remain required.

## Reviewed fork request and reconciliation core checkpoint (2026-10-31)

`hosted_fork_request.rs` implements the provider-write portion independently.
A read-only preview records the acting account, source and network identities,
destination owner identity, requested name and default-branch-only choice. A
personal destination must be the acting account; an organization is explicit.
Reported refusal of forking is respected, while missing policy metadata remains
unknown. Execution rechecks the bindings and expires unused previews after
fifteen minutes.

Before dispatching a POST, the core writes and syncs a private request record.
Records exclude credentials, raw API responses, temporary clone tokens and
commit-message bodies. A repeated execution returns the saved outcome rather
than sending the POST again. Another preview for the same account, destination,
network and name returns the existing active record. A CLI failure or lost reply
does not establish that the request was never applied.

| State | Evidence and next action |
| --- | --- |
| Awaiting confirmation | Dispatch may have happened; reconcile with reads and never automatically repeat the write |
| Accepted, pending | A successful provider reply was received; repository and Git-object availability remain unverified |
| Metadata available | Fresh owner, repository and fork-network metadata match; read the exact default-branch reference and commit object |
| Ready | The reference names the expected branch and its matching commit object is readable; clone/attachment still needs its own review |
| Conflict | Returned owner, network, access or a previously observed repository ID does not match; retain the record for inspection |

Reconciliation never dispatches a provider write. Read failures do not establish
absence. The first verified fork ID remains bound across later failures and
replacement; unavailable or malformed metadata clears current readiness. A
changed source forking policy does not prevent read-only reconciliation of an
already dispatched request.

Completed records can be archived. The retained archive entry is synced before
the active name is removed, and an interrupted archive can finish without
reactivating the old review. An unresolved record requires explicit acknowledgement
of its exact current snapshot before local retirement; a changed snapshot is
refused. Retirement does not cancel the provider request or prove absence. Its
original outcome remains readable, the old preview never dispatches again, and
another submission requires a new preview and explicit execution.

That core-only checkpoint did not qualify native server-held preview/acknowledgement
tokens, typed IPC, desktop controls or local remote attachment. No live provider write is part of source
qualification. Owned fixtures cover both successful and interrupted dispatch,
asynchronous readiness, identity replacement, cancellation, locking and archive
recovery. The store explicitly unlocks before closing its file handle, so an
unrelated child retaining a duplicate descriptor cannot hold a completed
request's lock. Seventeen new owned cases pass within the full source gate:
682 Rust tests and 166 frontend tests pass, with 45 Rust cases ignored. Angular
compilation, Cargo workspace checks and Clippy with warnings denied also pass. The ignored cases
and source-only fixtures do not establish real provider or desktop acceptance.

## Native fork review boundary source checkpoint (2026-10-31)

`apps/desktop/src-tauri/src/fork_commands.rs` exposes fork discovery/inspection,
creation preview/execution, saved-request listing/loading/reconciliation and a
separate acknowledgement preview/execution. Request records use the application's
private data directory; clients cannot supply a storage path.

Creation and acknowledgement accept only a context-bound server token at execution.
The native cache retains the actual plan or exact saved-status snapshot. A token
has one purpose, expires after fifteen minutes and is consumed before storage
resolution or dispatch. Wrong-context and wrong-purpose calls cannot consume a
valid review for another action. A new review replaces the previous review in
its context; at most sixty-four reviews are retained, with expired entries pruned.
Discarding a review never changes a durable request or a provider outcome.

Provider reads/previews and writes use the existing registered-operation
cancellation mechanism. A confirmed accepted or unconfirmed provider outcome is
returned as its saved status; a successful local acknowledgement is not hidden
when cancellation races it. Acknowledgement loads its snapshot on the server and
checks that snapshot again when applying it. No client-supplied replacement status
can retire a different request or a newer outcome.

Three native cache/decoding cases pass within the full source gate: 685 Rust and
166 frontend tests pass, with 45 Rust cases ignored. Generated-contract freshness,
strict TypeScript input assertions and generator tests also pass. Angular/Cargo
compilation, Clippy with warnings denied and contract checks pass after boxing
the private cached action payloads; the final source recheck passes the same
685 Rust and 166 frontend cases. Packaged native routing/storage/cancellation scenarios,
desktop workflow qualification and reviewed local remote attachment remain open;
the older discovery/clone package does not qualify this new fork API.


## Reviewed desktop discovery and clone checkpoint (2026-10-31)

The existing Clone dialog offers an original hosted repository browser. Loading
is explicit and displays the actual catalogue account. Visibility, affiliation,
sort and direction have bounded page requests; local text filtering is explicitly
limited to the displayed page. Later page requests retain the original account
ID. A failed page retains its previous result and a visible error; it does not
mix accounts or present the failed page as empty. Repository selection requests
fresh provider metadata with the selected account and repository IDs.

Clone review identifies the acting catalogue account, canonical repository,
SSH/HTTPS transport, canonical local destination, branch/depth and recursive
submodule choice. Git credentials and the SSH agent remain managed by the existing
Git authentication flow; catalogue selection does not silently replace them.
Existing manual clone and commit drafts are preserved. Editing the clone form
invalidates its preview. The server stores the immutable plan in a bounded,
fifteen-minute cache and consumes a context-bound token once before dispatch.
Execution rechecks account, repository identity/name/URL, read availability and
the absent destination before using the existing Git clone implementation.
No provider token is stored in a plan or clone URL.

Close, Escape, leaving the hosted view and component destruction cancel a
pending read/preview. Late read replies cannot reopen it; canceled previews are
discarded. A confirmed successful clone that races a cancellation is reported as
completed instead of being hidden. Clone failures retain actionable information
about any partial destination, following the existing clone recovery behavior.

Current source validation passes 665 Rust and 166 frontend tests, with 45 Rust
cases ignored. Compile/lint and generated contracts pass. Thirteen focused hosted renderer
cases and two existing manual-clone cases pass, including both palettes at a
compact size, direct path entry, preserved drafts and focus transfer to review.
The exact package passes 166 normal scenarios and 167 inherited-environment
scenarios, and the full renderer suite passes all 1279 cases. Owned native scenarios use an offline API
fixture and real Git clones from an owned repository; external Git protocols are
blocked. The UI case uses the normal editable destination field; the OS
directory-chooser widget is not qualified by this case.
No live provider write is part of this qualification.

The first full run of package
`b026c6b4040ad2077aa5117fd84e19e4b958185687408c4745b49ed72e510c98`
completed all five new hosted cases, then failed in an existing rebase fixture
which looked up its menu item immediately after clicking the opener. The fixture
now waits for that item and captures failure evidence before restoring the
original repository. The same package bytes pass all 166 normal native scenarios
on rerun, with this test-only post-build change recorded separately. The initial
failure remains recorded. The same bytes also pass 167 inherited-environment
scenarios, giving 333 native scenario executions. The packaged executable SHA-256 is
`5e47f93f872036f616ee42c99cc13b2baada4018bf5ae14de5790901daf8b392`.

An interrupted full renderer run recorded browser crashes during a concurrent
isolated source run's temporary-storage quota failure. Its artifacts are retained.
The source fixtures and browser temporary directory now use disk-backed storage;
the unchanged renderer source passes all 1279 cases on rerun. The interrupted
partial run is retained separately and is not counted as a successful gate.

Packaged fork discovery/creation and reconciliation qualification, reviewed local
remote attachment, explicit provider/account management, enterprise and
other-provider coverage remain required for the full objective.


## Desktop fork controls (qualification in progress)

The hosted catalogue offers a separate fork panel using the project's existing
tokens, controls and original layout. It can load bounded candidate pages,
freshly inspect a fork's owner/network and hand the verified repository to the
existing clone form. That handoff creates neither a clone nor a local remote;
destination and SSH/HTTPS review remain separate.

Creation explicitly selects the acting personal account or a named organization,
repository name and default-branch-only choice. Editing these inputs discards the
server review. Applying it sends only context, token and operation ID. Accepted,
unconfirmed, metadata-only, ready and conflicting outcomes have separate text
states. Status checks only reconcile reads; they never resubmit creation.

Saved requests can be loaded without a selected catalogue repository, allowing
recovery after closing and reopening the dialog. Every record identifies its
original account, source and destination. An unresolved archive review requires
explicit acknowledgement and explains that the provider request may still
complete. Its execution uses a server-held snapshot and preserves a stale refusal
for fresh review. A confirmed result after cancellation remains visible while its
component is current; late results cannot reopen a dismissed panel.

Rapid close/reopen and manual/hosted or repository-tab transitions retire the old
context and render a fresh keyed instance even when Angular coalesces the state
changes into one frame. This prevents a retired component from leaving visible
controls unable to load or prepare another request. Existing manual clone and
commit drafts remain separate.

Thirty-two focused renderer cases pass: seventeen fork cases, thirteen hosted
catalogue/clone cases and two manual-clone cases. Both compact palettes were
visually inspected at 360 by 560 pixels, including contained keyboard navigation.
The first run's focus assertion used the wrong locator for a nested select; its
screenshot showed correct focus and the semantic combobox assertion passes.
Separate failing lifecycle probes are retained alongside the passing regressions.

These renderer cases use owned IPC fixtures. Integrated source and contract gates
pass: 692 Rust and 166 frontend tests, with 45 Rust cases ignored. Angular/Cargo
compilation and Clippy with warnings denied also pass. The first new package
passes the four new fork route/storage/recovery/cancellation scenarios; complete
native acceptance is still open. The earlier b026c6b4040a artifact qualifies discovery/clone only.
Reviewed local remote attachment remains required before full fork acceptance.

The fork controls and their integration with the qualified clone workflow are
checkpointed in `c1d35a72a4e49563168803f140bceb17cc012def`. Its new runtime is
undergoing separate package and full 1296-case renderer qualification, including
the checkbox correction described below. Running gates are not successful
qualification evidence.

The owned offline provider fixture now has an explicit fork capability, separate
from its existing review-request write capability. It rejects unowned endpoints
and unexpected creation payloads. Pending metadata and pending Git objects are
independent controls. The harness gate passes 31 tests, including opt-in,
precision-safe identity, unknown outcome and endpoint-isolation checks.
The new native scenarios exercise server-held creation reviews, context/purpose
binding, token consumption, private durable storage, uncertain replies,
deduplication, read-only readiness checks, stale archive refusal, retained archive
records, explicit organization/all-branches UI creation and separate clone
handoff. They also hold an owned provider process at dispatch to check
cancellation and a retained unconfirmed result. The initial four fork scenarios
pass on artifact `1d6a83566244`; later additions for checkbox geometry and an
exact, separately reviewed fork clone require the corrected artifact.
Renderer/session recreation is tested;
application-process restart acceptance remains a separate open case.

The first fork package attempt compiled and bundled successfully but its task
failed: the final naming script ignored `CARGO_TARGET_DIR` and looked in the
checkout's default target directory. The script and task output declarations now
honor absolute or working-directory-relative Cargo target paths. Fifty-seven
packaging tests pass, including real Debian artifact naming with spaces and
incremental cache separation across output directories. The corrected package
task passed and produced package
`1d6a835662442e483def147b517677d8c0e0a2162a3decf88bf9a3d7459d6e97`.
Its full native run completed 31 scenarios, including all four new fork cases,
then failed an older read-only paging assertion that included earlier fork POSTs
from the same fixture log. The assertion now examines only its own request
segment while retaining the complete log.

Native screenshots of that artifact also exposed oversized checkboxes in the
fork and clone forms. Explicit control dimensions and flex sizing correct the
layout, and all 32 focused renderer cases pass with non-vacuous geometry checks.
A test-only misplaced count assertion failed before being corrected; that log is
retained. The original full renderer runner was deliberately stopped before
editing runtime source, and its artifacts are retained. A fresh full renderer
run and package build use the corrected, frozen source. The failed/interrupted
gates remain excluded from successful complete acceptance.

The corrected package is
`2b61c4b380d7d55182bc27b3c234c8e1d3c2f0cd62be34b301afb303b5b65677`,
with executable
`d5f29d8a4cc0a8094204dd0b777ce61ea74dbfcea01ae7719386a4bbed8ab0ad`.
Its first full native run completes 111 scenarios, including all five fork
scenarios and the independently reviewed clone of the exact owned history.
Native checkbox geometry assertions pass, and the corrected screenshots were
visually inspected. That run then fails an older terminal startup fixture: a PTY
child may be reaped before its shell wrapper logs a PID. The test now requires
the real one-time native completion event and absence from the terminal registry,
checks every PID that became observable, and starts and reaps the retry. The
31-case harness gate passes. The same package bytes now pass all 171 normal
native scenarios and all 172 inherited-environment scenarios (343 executions).
Both reports verify the exact package and executable hashes above. This
test-only post-build change does not alter the packaged application.

The complete renderer run finishes with 1,293 passes and three failures out of
1,296 cases. Two wrapped diff-layout cases exhaust the overall test deadline;
a workspace-overview case stops responding during its final cached-state
assertion. Their traces and logs are retained. These failures remain open while
isolated reproduction runs; the package is not claimed fully qualified.

The previous dev checkpoint's remote CI fails before native packaging because
the hosted runner configures a needrestart invocation hook. Private dpkg fixture
transactions deliberately refuse host hooks. The workflow now temporarily moves
that specific hook aside for the packaging regression step and restores it on
both success and failure. Other configured hooks remain subject to the original
refusal. Shell syntax and restoration/exit-status behavior pass owned local
fixtures; the changed workflow still needs remote execution.


The isolated 23-case diff/workspace reproduction passes without changing
application code, assertions or test deadlines. A complete serial renderer run
is now in progress. The earlier three failures remain recorded and do not count
as passing results.
