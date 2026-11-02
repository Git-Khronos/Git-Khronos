# GitLab fork dispatch and durable outcomes

Status: reviewed all-branches fork submission and durable read-only outcome
recovery are implemented independently for Linux. The current source passes 1,077
Rust cases, 182 frontend unit cases, 60 harness cases, strict workspace all-target
Clippy, generated contracts, production AOT and 81 focused renderer cases. The
immutable package passes 37 GitLab, 220 full and 221 inherited-environment scenarios
(478 executions, 248 distinct scenarios); all 45 optional source cases also pass.
Eight renderer and 12 native captures were actually viewed and accepted.

Complete renderer qualification passes all 1,519 cases, with exact collection
matching, one attempt per case, no retries and no skips. The final qualification
section identifies exact package/executable hashes and retained failed attempts.
Earlier source checkpoint sections below describe the evidence available at those
checkpoints; the current results above supersede their pending-gate statements.
Live GitLab, other platforms, ancestry, branch-scope selection, reviewed remote
attachment and further packaged error/cancellation composition remain open.

The implementation uses a separate write connection, one-use native reviews and a
private journal before possible dispatch. Stored records grant no submission or
Git authority. Existing namespace and fork reads remain read-only.

## Sources and boundaries

Public protocol requirements were checked on 2026-11-02 against:

- https://docs.gitlab.com/api/project_forks/
- https://docs.gitlab.com/api/namespaces/

Only protocol facts are used. No vendor implementation, assets, example code or UI
wording is incorporated. Implementation choices below belong to Git Khronos.

The existing project-owned `gitlab_https.rs` already disables redirects, HTTP retries,
proxies and automatic decompression, bounds response bytes, validates TLS and binds
requests to an exact HTTPS origin. Its read-only trait and endpoint allowlist must
remain read-only. A new fork-specific write port must not accept arbitrary methods,
URLs, resource paths, headers or credential replacements.

## Request review

1. Select a connected account and stable source project ID/full path.
2. Select a personal or group namespace by canonical ID, full path and kind. Refresh
   its detail through the existing native account lease. Visibility or ownership of
   a namespace does not grant project-creation permission.
3. Enter a project path and optional display name. Validate bounded, nonempty values
   and the destination path segment before any provider request. Reject controls,
   slashes, backslashes, traversal segments and ambiguous leading/trailing whitespace.
   Server-side naming and permission restrictions remain authoritative.
4. Review the account, exact instance, source identity, destination namespace/path,
   branch selection and options. No provider write occurs while reviewing.
5. Retain the validated plan natively for at most five monotonic minutes. Bind its
   one-use random token to the main window, UI context and exact connection. Replacing
   a selection, closing a review or expiring it retires its token.
6. Execute receives only the context, token and operation ID. The exact connection
   remains native-held. Consume the token before performing I/O. Never accept a client replacement plan, resource URL or credential.

The public create route is `POST /projects/:id/fork`. Build the source segment from a
canonical native-held numeric ID, with no query supplied by the renderer. Explicitly
send `namespace_id` and `path`, and `name` only when selected. Parse canonical namespace
IDs to an exact Rust `u64` and encode an integer; never round them through JavaScript.
Do not use the deprecated ambiguous namespace selector. No visibility widening or
merge-request policy change is implied by a fork.

All-branch creation omits a branch filter. Before offering selective/default-branch
forking, verify the server's documented filter representation and ambiguous branch-name
cases. A branchless source must not be assigned an invented default branch. The initial
UI must not advertise an option whose exact wire behavior has not been implemented and
qualified. Selective-branch capability remains a separate parity requirement until then.

## Native capability and lifetime

A connection may retain a separate optional fork-write port, built only by native code
from its same validated origin and credential. Existing read-only fixtures/ports do not
acquire it implicitly. A dedicated HTTPS writer can have its own runtime/client while
remaining subject to the same connection lifetime, cancellation and active-operation
lease. Do not expose its credential, client or runtime through generated contracts.

Use one shared active-operation reservation for reads and a fork dispatch on a connection.
Before dispatch, freshly verify the account, source stable ID/path and namespace stable
ID/path/kind. A closed/expired connection or cancellation must prevent subsequent reads
and dispatch. Disconnect must cancel without waiting for a held HTTP transport mutex.

The existing read helper's post-action lease check must not turn a completed write into
an apparent safe-to-retry failure. Once dispatch is possible, return or retain a durable
outcome, including when the lease expires or cancellation wins after the server accepts.
The renderer may suppress a stale callback; the native operation record must survive it.

Public documentation refreshed 2026-11-02 confirms that the fork UI supports all
branches or the current default branch, while the create API declares a string
`branches` field. These pages do not define multi-branch string grammar. The current
port and candidate plan remain explicitly all-branches only. Default/selected branch
support remains required and must gain wire-level behavioral evidence before being
advertised. Missing default-branch metadata must not be replaced with an invented name.

## Native integration boundary

The registered core `gitlab_fork_plan.rs` implements read-only preparation and
revalidation. Its six behavioral cases pass alongside ten journal and 27 HTTPS cases,
strict workspace Clippy and generated contract checks. These checks cover the retained
account, source, namespace and empty-repository facts. Native prepare/execute commands
remain absent; the core plan grants no submission capability.

The `gitlab_fork_reviews.rs` cache previously compiled as its exact standalone
source with warnings denied and passed ten behavioral cases, including concurrent
one-use consumption. It retains a typed plan and connection ID without serialization,
bounds contexts to eight, expires reviews after five monotonic minutes, and retains live
reviews on capacity or token collision. The native caller must generate each token and
check cancellation before publication and after publication, discarding its exact token
on cancellation. It must consume a ready slot before provider I/O. This isolated cache
proof does not establish registered commands, native account/write authority, HTTP
composition or packaged fork creation.

The qualified baseline `GitLabAccounts::read` owned a `Session` containing only a read transport.
Its `LeasedTransport` checks connection lifetime before and after each GET, and the
outer read helper also checks after the action. That helper must remain read-only:
using its final check around a POST could discard a successful response after a
concurrent disconnect and present a misleading ordinary error.

Add an explicit fork-capable connection path. Construct both credential owners natively
from the newly supplied token, verify the account through the read port, and publish the
connection only after verification. Ordinary existing read connections retain no write
port. Neither a renderer flag on an existing connection nor a saved record may upgrade
its authority. The capability permits only the closed fork request, never arbitrary
HTTP methods or endpoints. Do not expose or retain the supplied token in settings,
previews, records or diagnostics.

A fork-capable session must share one active-operation reservation across its read and
write ports. Disconnect sets the closed flag and cancels the active token without
acquiring either HTTP mutex. The execution path retains that same session through fresh
account/source/namespace preflight and submission; releasing it between preflight and
POST must not allow a different connection to replace its authority.

Prepare uses a bounded native plan cache with one pending/ready slot per renderer
context, a random one-use token and monotonic expiry. It retains the complete validated
intent and exact connection identity. Execute accepts only context, token and operation
ID, consumes the slot before I/O, and obtains request fields from the retained plan.
Wrong-context tokens do not consume another context's slot. Preparing a new preview,
expiry, discard or restart cannot recreate a consumed token. No renderer-supplied
record, origin, namespace, path, endpoint or credential is accepted at execute time.

Before the port polls its send future, its callback checks the live session and
cancellation, calls `journal.begin` for the exact retained intent, then checks cancellation
and lifetime again. A failed final check retains the durable uncertain record and stops
submission. Retain the returned row lease until the response has been projected and its
status append has been attempted. Release the journal-wide lock before network I/O.
The journal callback is not a reusable dispatch capability.

Execution distinguishes pre-marker errors from post-marker outcomes. After a marker
exists, timeout, cancellation, disconnect, rejected response or failed status persistence
must return an operation identity and bounded outcome suitable for inspection. If the
webview or caller disappears, the record remains discoverable. A persistence failure
must not be converted to a retry invitation. Reconciliation uses only the read port and
a fresh explicitly selected connection matching the saved origin and stable account ID;
it never re-enters the write callback.

Required native tests include ordinary-read connection refusal, expired/disconnected
capability refusal, cache context/purpose/expiry and one-use behavior, fresh identity
changes, concurrent execute, cancellation before/after durable publication, disconnect
during actual POST, lost response, status-append failure and restart with zero replay.
The scoped native tests below cover several of these cases. The final qualification
section records the later real HTTPS-native composition and packaged results.
Further expiry and error/cancellation composition coverage remains open.

## Native submission source checkpoint

The new source registers `connect_gitlab_fork_account`, `prepare_gitlab_fork`,
`discard_gitlab_fork` and `execute_gitlab_fork`. Ordinary connections still receive
no writer. A fork connection constructs separate read/write credential owners from
the newly supplied token, verifies the account before publication and reports its
capability as native metadata. The same active-operation slot protects both ports;
disconnect cancels without acquiring either HTTP mutex.

Preparation uses the bounded typed review cache. Execution accepts only context,
one-use token and operation ID, consumes before storage/provider I/O, revalidates
through the retained session, and attempts journal publication in the write callback.
After that attempt every outcome retains a native operation identity. An append
failure remains storage-unconfirmed; a disconnect after acceptance does not discard
the result. Provider body/text never enters the journal or returned outcome.

The current adapter records successful HTTP status without claiming verified import
or adopting a project ID from an unverified create reply. Read-only project lookup,
fresh relation/import verification, record inspection/retirement commands and recovery
UI still need implementation. The native cases use owned filesystem journals and simulated read/write ports; they
are not real HTTPS-native or packaged creation proof. The completed gate passes
50 native tests (14 new submission, ten newly registered cache, 26 existing
account/clone/fork adapter cases), 38 core fork tests and 27 HTTPS cases, strict
workspace Clippy, generated contracts, AOT and 50 existing renderer cases. The actual
renderer report contains 16 clone, 15 fork and 19 catalogue cases, each passing once
with no retry or skip. No live fork was created.

## Durable record before possible dispatch

Create an application-owned record before polling any future that can send POST bytes.
Use a random operation ID, an explicit record version and a bounded schema. Persist:

- exact origin and stable account ID, with a display login snapshot;
- source project ID/path and namespace ID/path/kind;
- selected destination path, display name and branch/options;
- local operation ID, timestamps and typed phase;
- returned project ID, if validated, and safe status/error categories when available.

Never persist a credential, authorization header, raw response body, provider diagnostic,
transport URL containing secrets, executable command or native preview token.

Use checked application-owned directories, private modes and bounded regular files.
Refuse symlink/hardlink or foreign substitutions. Publish records atomically and confirm
file/directory durability before dispatch. A storage failure prevents the POST. If an
ambiguous storage failure leaves a record, retain it for inspection; do not dispatch as
an implicit recovery action. Restart loads records as data and never restores authority
to submit a previous plan.

Prevent two active records for the same origin/account/source/namespace/destination
intent, including simultaneous preview executions and multiple application processes.
The check and record publication need an interprocess serialization boundary. Do not
hold a global registry mutex across network I/O. A per-record operation lock can retain
dispatch ownership while allowing unrelated records to be inspected.

## Observable states

| State | Evidence required | Available next action |
| --- | --- | --- |
| Review | Native-held plan; no durable dispatch marker | Submit once or cancel |
| Awaiting confirmation | Durable marker precedes possible POST; acceptance unknown | Read-only reconciliation |
| Accepted, importing | A bounded reply identifies the intended project; import unfinished | Read-only status refresh |
| Metadata verified | Fresh project, namespace and fork relation match the intent | Separate clone/remote review |
| Import failed | Fresh matching project reports failed import | Inspect and resolve; no automatic POST |
| Conflict | Fresh destination/resource identity disagrees with the intent | Inspect identities; no retargeting |
| Response rejected | A bounded non-success HTTP status was received | Inspect saved outcome/destination before any new review |

Unknown import values remain unknown, not ready. A finished import proves neither Git
authentication nor remote reachability. An empty project requires explicit empty-repository
semantics; absence of a default branch is not evidence of failure by itself.

All failures after the durable dispatch marker retain an inspectable outcome: timeout,
lost headers/body, invalid JSON, response budget overflow, redirect, cancellation,
disconnect, rate limiting, server error or failure to persist the returned result. No
HTTP redirect is followed and no POST is retried by the client, transport or renderer.
A rejected status is recorded without exposing upstream text and does not grant replay.

## Reconciliation and retirement

Reconciliation is read-only. Reconnect to the exact origin and stable account ID; a
changed display login alone must not silently retarget a destination. Verify source,
namespace, destination ID/path and fork ancestry against the saved intent. If a returned
project ID exists, inspect it rather than adopting an unrelated project at an old path.
Renames/transfers and hidden or partial ancestry need explicit conflict/unconfirmed
states. A 404 or inaccessible search result does not prove the original POST was absent.

A new user-requested attempt requires inspecting the unresolved record and destination;
never restore the consumed preview or infer authorization from elapsed time. Explicit
retirement preserves an archive receipt and does not delete any provider project. An
unresolved record cannot disappear merely because a connection expires, the dialog
closes, the webview reloads or the application restarts. Bound active/archive counts and
report capacity without silently deleting records.

Clone and local remote attachment remain separate reviewed operations with separate Git
credentials and configuration preservation. Neither readiness nor archiving performs a
fetch, push, checkout, branch publication or provider deletion.

## Required behavioral evidence

Use owned verified-HTTPS fixtures with independent request counts, synthetic credentials
and a separate redirect destination. Prove exact request method/path/body and wide-ID
encoding; no write before review/dispatch persistence; read-only ports cannot write;
permission refusal; source/namespace/account changes; token context/purpose/expiry;
parallel duplicate intents; denied storage, owned locks and substituted files.

Prove one POST after accepted-with-lost-reply, partial response, cancellation after actual
bytes arrive, server rejection, disconnect and restart. Retain private records and never
replay a POST during restore or read-only reconciliation. Exercise known/unknown/failed
imports, empty projects, conflicting destination identity, renamed/transferred resources
and bounded fork ancestry. Verify that the API credential never reaches Git or a redirect.

Test original UI review, cancellation, saved-outcome recovery, connection changes and
separate clone/remote handoffs. Run applicable source, renderer and immutable packaged
native gates; inspect normal/compact views. Local fixtures are not live-service or
Windows/macOS acceptance.

## Recovery and reconciliation candidate after the source checkpoint

New core and native recovery source passes its scoped backend qualification.
Its completed backend gate is separate from the earlier 50-native source checkpoint.

`list_gitlab_fork_records` projects private records, active/retired/pending flags and
bounded storage issue categories. It restores data only. `reconcile_gitlab_fork_record`
accepts a selected read connection, native record ID, expected revision and operation
ID. The journal row lease spans the read without holding its global lock. Origin and
stable account ID must match the saved intent; a changed display login alone does
not change that intent. Source, namespace and destination metadata are read afresh.

A known destination ID is inspected directly, with no fallback to a project now
occupying its old path. An unidentified response uses the exact saved slug path,
encoded as one public project resource. Inaccessible projects remain unconfirmed;
no response, timeout or 404 proves the POST was absent. Matching metadata does not
prove that this operation created the project. A rejected original HTTP status is
retained even if a later inspection finds an independently matching fork.

A failed fresh project inspection revokes readiness while retaining an already bound
ID. Hidden or indirect upstream relationships stay unconfirmed; complete fork-network
ancestry still needs implementation. Empty import readiness requires the original
source-empty and current destination-empty facts. A default branch does not substitute
for either fact. Unknown imports remain pending. If the local status append fails,
the response labels its observation as unpersisted and preserves the stored revision.

`retire_gitlab_fork_record` archives locally by exact revision. An uncertain outcome
requires explicit acknowledgement. Provider projects, refs and credentials are not
deleted or changed. Retirement grants no submission authority; every new submission
still needs its own new native connection/review path and durable dispatch boundary.

At the earlier recovery-backend checkpoint, the completed scope passed 58 native, 51 core fork, two locator and 31 HTTPS
cases (142 actual cases), strict workspace all-target Clippy with warnings denied, and
generated contracts. The source and detailed counts were reviewed against the frozen
224 inputs; generated binding SHA-256 is
`1088db7377961de0827650e24ee3fdd584b0dbad6d5ad5be699dbe05a96310cd`. At that checkpoint, packaged acceptance and the frontend gate were
still pending; later results are recorded below.

## Original creation and recovery interface candidate

The connection form defaults to read-only API access. A user must explicitly choose
reviewed fork requests when creating a new connection. Existing read connections
are not upgraded. The returned native connection capability must match that choice.

The fork browser can open a separate destination review with bounded namespace
pages and an all-branches request. Search or destination edits invalidate the
one-use native preview. Preparing is read-only; submitting sends only the retained
native context, token and cancellation identity. A response is displayed as an
outcome for inspection, never as proof that import or Git access has completed.
An ambiguous error offers saved-outcome inspection instead of automatic resubmission.
Stopping the wait or disconnecting cannot undo a request already received by GitLab.

Saved outcomes can be opened without a connected account, including after restarting
the application. Fresh provider inspection requires the saved origin and stable
account ID; a read-only connection is sufficient. Incomplete, pending, active and
locally archived rows expose no mutation or inspection authority. A fresh observation
that was not persisted is presented separately; it never replaces the stored revision
in the list. Further actions require reloading the actual stored record.

Local archiving requires an explicit acknowledgement that the request might have
reached GitLab. It neither deletes a provider project nor restores a consumed review.
No recovery action sends a creation request, runs Git or changes repository remotes.

The frontend candidate has a 528-input source snapshot and a queued production build
plus renderer protocol cases. The first run passed 67 of 68 cases and failed a
namespace test locator; the corrected 68-case run passed, once per case with no
retry or skip. Eight later 320px/780px review/record/action captures were actually
viewed and accepted for fit and readability. A new disconnect regression then
exposed a missing explicit cancellation call (69 of 70 passed). Disconnect now
cancels a held recovery read directly, before waiting for account retirement.
The combined-source gate on the current dev base now passes all 70
GitLab cases plus 11 existing file-tool cases, each once without retries or skips,
confirmed by detailed report review. Eight paired renderer captures were viewed.
Subsequent focused native qualification is recorded below; broad qualification
remains separate. No new dependency, proprietary source, assets
or distinctive wording was introduced.

## Combined-source and native acceptance candidate

The fork working branch now includes the qualified dev external-file-tool and
restart-harness changes. The original fork work was preserved before alignment;
independent registry/type-check additions and provenance sections were retained,
and the IPC binding is regenerated from the combined native registry. The current
554-input source checkpoint passes generated contracts, the full desktop check,
strict workspace all-target Clippy, 1,072 Rust cases (45 optional cases ignored),
182 frontend unit cases, 60 harness cases, production AOT and 81 focused renderer
cases. Detailed renderer reports confirm one attempt per case, no retries or skips,
and preserved earlier GitLab/file-tool cases. Eight current paired 320px/780px
review/record/action captures were actually viewed and accepted for fit/readability.
The first combined attempt stopped at an outdated exact GET-log expectation; the
corrected attempt reused source/unit evidence only after verifying that application
and backend bytes were unchanged. These source/renderer results do not qualify the
new native fork scenarios or requalify the optional cases on the combined source.

A new original native acceptance module is registered after the existing GitLab
catalogue/clone scenarios. It uses the packaged controls, process-only TLS trust
and an owned HTTPS server. The server can independently inspect the actual initial
private journal before receiving a fork request; the probe cannot change production
storage or substitute an artificial marker for native publication. Its source
currently exercises separate connection purpose, reviewed submission, fresh metadata
inspection, bound-ID 404 handling, lost replies, process restart and local retirement.
The corrected immutable package passes its 37 focused scenarios, as detailed below.
Rejection, post-receipt cancellation,
account substitution and storage-failure native composition still require coverage.

A successful HTTP response for an unidentified project retains an unconfirmed
creation record with its HTTP status. It must not be mistaken for verified project
identity, completed import or Git access. The new native harness must assert that
actual model distinction rather than assuming the record is already ID-bound.

The first immutable combined Linux package was built successfully after the package
helper tests passed. DEB SHA-256 is
`6cbd75880c019b9732a8be2ed0fa0eed9d71ddc8e3cae0e03d4b395e94fae1f7`;
its independently extracted executable SHA-256 is
`fab84ae57d4420659091a25d891ce3f32877ac81fee3d62e82d960479e9e9edc`.
Its native run passes the original 30 GitLab smoke/catalogue/clone scenarios, then
fails when the first new fork scenario opens local storage. No fork POST was sent.
The planned suite contains those 30 scenarios and seven new fork scenarios; the
failed overall run is not packaged fork creation/recovery qualification.

## Actual private-parent failure and native correction

A read-only diagnostic around unchanged packaged scenarios found the native data
home owned by the current account with mode 0700, while the framework-created
`org.gitkhronos.desktop` application directory had mode 0775 under the process umask.
The journal correctly rejects a group-writable immediate parent. The source tests
had used explicitly private parents and had not exposed this application adapter gap.

The corrected native factory creates missing application directories with mode 0700,
then pins the application namespace with O_DIRECTORY, O_NOFOLLOW and O_CLOEXEC. It
confirms the actual effective UID and current path/inode before and after restricting
that owned application directory to mode 0700 through its descriptor. It does not
change the data-home directory, repository permissions, preferences-file contents,
a symlink target or a directory owned by another account. Existing journal children
retain the original strict checks: an insecure or substituted child is refused and
preserved, rather than silently repaired.

Five new filesystem cases cover a framework-style 0775 parent with existing
preferences, symlink refusal, a different UID, retained insecure journal data and
regular-file/relative-path refusal. The new 63-case native subset, full 1,077-case
Rust suite, strict workspace all-target Clippy and unchanged contracts now pass. A fresh
immutable package and actual native fork run followed as described below; the
failed 6cbd artifact remains retained with its original failure.

## Focused immutable Linux qualification

The corrected package has DEB SHA-256
`ff61643e85a9767a9550dfb44d5c05fff0771dacb47824dbe4c96d46b32f6d34`
and packaged executable SHA-256
`d0948757be7db28d0dfa908fc45290b4d41a4daa31daadb5ea99c93af755ad3d`.
The build-tree executable is a distinct output; its hash is not substituted for
the actual packaged executable. The package is retained with its completed build
receipt, and the 554-input manifest records the runtime and acceptance sources.

All 30 earlier GitLab scenarios and seven new fork scenarios pass. Before both
actual POSTs, the owned verified-TLS server observes the real random-ID initial
private journal, including matching account/source/namespace/path and restrictive
permissions. No artificial dispatch marker is used. An accepted response retains
an unidentified outcome until a fresh read binds the project ID. A known-ID 404
revokes readiness without looking up the old path. A lost reply survives an actual
application restart without replaying the POST; a matching read-only connection
can reconcile it. Local retirement requires explicit acknowledgement and performs
no provider deletion or Git operation. Repository refs/index/configuration/status
and journal credential exclusion checks pass.

The first run of this corrected package stopped at a harness navigation assumption:
a restarted application showed its ordinary welcome screen. The harness now uses
the visible Clone action there, or the repository toolbar when present. A later
37-scenario run passed but exposed a screenshot captured before scrolling painted.
The final run waits for two paint frames and checks bounds before capture; all
37 scenarios pass and all 12 actual 1440x900/780x560 paired content/action images
were viewed and accepted. Assertions and unsuccessful evidence are retained.

These are owned-service Linux results. The same package also passes all 220 full
and 221 inherited-environment scenarios. Including the 37 GitLab scenarios, this
is 478 actual executions over 248 distinct scenarios. All 45 optional source cases
(41 LFS, three signing, one SSH) pass. The complete 1,519-case renderer qualification also passes, as recorded below. The native local-retirement step uses the acknowledged IPC command; its
checkbox/button interaction is covered by renderer tests. Live GitLab, other
platforms, additional rejection/cancellation/storage-failure compositions, ancestry,
branch scopes and reviewed remote attachment remain unqualified or incomplete.

## Complete renderer gate

The first complete-gate coordinator stopped during collection, before executing
any tests. Its reused helper had a hard-coded path to the older external-file-tool
worktree, so it collected the old 1,484-case baseline and found zero new GitLab
cases. The retained failure is not an application or test assertion failure.
A corrected external collector targets this fork worktree; no application or test
source was changed. It collected all 1,519 cases, preserving the exact earlier
1,484 identities and adding 15 fork-browser, 18 creation/recovery and two
connection-purpose cases. Its four disjoint shards contain 380/380/380/379 cases.

The run uses one worker and zero retries. The final detailed HTML report audit
confirms all 1,519 cases pass in the qualified report set, preserving all 1,484
earlier identities and adding 35 GitLab cases. No case is skipped.

The corrected complete renderer attempt passed the first three shards (1,140
cases), then the fourth passed 378 of 379. Its sole failure was an existing
relative-date assertion: the sample commit crossed exactly 30 days on
2026-11-02 at 09:42 UTC, and the correct narrow English output became `last mo.`.
The real-clock regex did not admit that correct formatter output. The retained
screenshot and error context show the correct preference selection and month text.

The isolated date test now fixes the browser clock at that exact boundary and
asserts the precise ISO date, UTC time, persisted preference and relative label.
No application, native, binding or package input changed. Fresh collection preserves
all 1,519 identities. The unchanged first three audited shards (1,140 cases) are
retained. Both the focused date check and the complete corrected fourth shard
(379 cases) pass. The final combined report audit confirms exact collection
matching and one successful attempt per case in that qualified set. The earlier
failed fourth-shard evidence remains retained; it is not relabeled as a pass.
