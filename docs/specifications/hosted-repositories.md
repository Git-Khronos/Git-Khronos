# Hosted repository discovery and forks

Status: independent requirements for H02, with a source-only GitHub discovery
checkpoint below. This specification does not claim desktop acceptance. Provider
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
checks and Clippy with warnings denied also pass. This module does not yet expose native IPC or a
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

Native server-held preview/acknowledgement tokens, typed IPC, desktop controls and
reviewed local remote attachment remain required. No live provider write is part of source
qualification. Owned fixtures cover both successful and interrupted dispatch,
asynchronous readiness, identity replacement, cancellation, locking and archive
recovery. The store explicitly unlocks before closing its file handle, so an
unrelated child retaining a duplicate descriptor cannot hold a completed
request's lock. Seventeen new owned cases pass within the full source gate:
682 Rust tests and 166 frontend tests pass, with 45 Rust cases ignored. Angular
compilation, Cargo workspace checks and Clippy with warnings denied also pass. The ignored cases
and source-only fixtures do not establish real provider or desktop acceptance.
