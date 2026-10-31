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
