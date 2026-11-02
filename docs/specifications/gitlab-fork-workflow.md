# GitLab fork workflow

Status: independent namespace/fork discovery, explicit reviewed submission and
private outcome recovery are implemented. The current combined source passes
1,077 Rust cases, 182 frontend unit cases, 60 harness cases, strict workspace
all-target Clippy, generated contracts, production AOT and 81 focused renderer
cases without retries or skips. The same immutable Linux package passes 37
GitLab scenarios plus 220 full and 221 inherited-environment scenarios (478
executions over 248 distinct scenarios). All 45 optional LFS/signing/SSH cases
pass. Eight renderer and 12 native captures were viewed and accepted.

Complete renderer qualification passes all 1,519 cases. Detailed reports confirm
all 1,484 earlier identities are preserved, with 35 new GitLab cases and one
attempt per case, no retries and no skips. The detailed
[dispatch specification](gitlab-fork-dispatch.md) records artifact hashes,
authority/storage boundaries, earlier unsuccessful attempts and exact evidence
limits. Owned-service Linux results do not establish live GitLab or other-platform
acceptance. Full fork ancestry, branch-scope selection, reviewed remote attachment
and further native error/cancellation composition remain open. This is a scoped
implementation, not a complete feature-parity claim.

## Public protocol sources

Inspected 2026-11-02:

- https://docs.gitlab.com/api/project_forks/
- https://docs.gitlab.com/api/namespaces/
- https://docs.gitlab.com/api/projects/
- https://docs.gitlab.com/api/project_import_export/

GitLab exposes project fork listing and creation, namespace listing/detail and project
metadata. A fork request can return before its background import finishes. Import states
include none, scheduled, started, finished and failed. Namespace availability is not a
guarantee of project-creation permission. These public protocol facts inform requirements;
no vendor source, examples, assets, UI composition or substantial wording is reused.

## Required capability

Select an existing account/instance and source project; inspect existing forks; choose a
personal or group namespace and project path; review the complete proposed fork request;
submit once; retain uncertain outcomes; inspect import progress; and separately review
an advertised SSH/HTTPS remote before attaching it to a selected local repository.

The user must never need to guess whether a timeout created a duplicate project. A
connection, account, source, namespace or local-repository change must not silently
retarget an already reviewed action. Public API identity and Git authentication remain
separate authorities, as in reviewed cloning.

## Initial read design

- Reuse the closed, verified-HTTPS, instance-bound read transport and native account
  lease. Project/namespace IDs remain canonical strings, including values above the
  JavaScript safe-integer range. No read grants an API-write or Git-configuration token.
- Namespace pages contain at most 20 projected identities with explicit user/group kind
  and full nested path. Search stays one encoded literal parameter. No billing fields
  or inferred write permissions are displayed or retained. A full page means more may
  exist, not that a complete namespace inventory has been obtained.
- A separate native account-leased namespace inspection reads the selected canonical ID
  between fresh account checks. The returned stable ID, full path and user/group kind
  must match the selection. Display-name changes are allowed; namespace transfer, rename,
  type changes or account switches refuse the selection. The projection grants no
  project-creation permission and strips provider-only permission/billing/secret fields.
  The preflight passed its three additional core cases, one additional native case and
  real-HTTPS identity/detail checks as part of the qualified totals above.
- Fork pages are candidate lists tied to the selected stable source ID and full path.
  Duplicate IDs/paths, moved sources, cross-origin project URLs, oversized pages and
  account changes refuse the whole projection. Selecting a candidate requires a fresh
  relationship check; list membership itself is not reusable attachment authority.
- Inspection checks the candidate stable ID/path, reported upstream identity, namespace
  path and advertised credential-free Git URLs. Distinct API and Git host/port values
  remain visible and are not silently rewritten. HTTP clone addresses are unavailable.
- Import metadata remains a typed state. Unknown values remain unknown. Neither a
  successful API read nor a finished import alone proves authenticated Git connectivity.
  Raw provider import diagnostics must not be exposed as trusted UI or logged secrets.
- The initial implementation verifies a direct source relation. Full fork-network and
  fork-of-fork behavior still needs bounded ancestor discovery with cycle/identity checks;
  missing private upstream metadata must remain unconfirmed rather than guessed.

## Creation and reconciliation scope

The concrete next-stage request, capability, journal and recovery invariants are
specified in [GitLab fork dispatch](gitlab-fork-dispatch.md). The independently implemented creation and recovery slice now has source, focused
renderer and 37-scenario packaged Linux evidence recorded there. Broader workflow
requirements below, including ancestry and remote attachment, remain open.

Provide an explicit write capability alongside the read lease; do not turn arbitrary
read endpoints into write authority or pass the API credential to Git. Expose only the
specific authenticated fork POST with a native-retained validated request. Revalidate
account, source and namespace before dispatch. Namespace listing does not replace the
server's actual permission checks. Do not silently widen token scope or visibility.

Create a durable application-owned operation record before a possible dispatch. It
contains bounded non-secret instance/account/source/destination identity, selected
options and a random request ID. A one-use preview is bound to its window/context and
connection. Never accept a replacement plan, endpoint, credential or advertised URL in
an execute request. Preserve a post-dispatch cancellation, disconnect, lost reply, body
failure, rate limit or ambiguous server error as an inspectable uncertain outcome.
Never automatically replay a POST. A fresh user retry must follow explicit inspection
of the destination and earlier record; an absent read does not prove non-dispatch.

After acceptance, record the returned project ID if usable and report import progress
without claiming readiness. Explicit read-only refresh and restart reconciliation must
match instance, account, source relationship, destination namespace ID/path and project
path. Existing unrelated projects, transferred/renamed identities, ambiguous fork
networks, failed imports and partial relations require an actionable stop. A branchless
source and an empty fork need explicit semantics rather than an invented default branch.
Selecting an existing fork must follow the same fresh inspection boundary.

Remote attachment is a separate reviewed Git-configuration operation. Reuse the existing
original configuration-preservation/lock/publication machinery only after supplying a
fresh provider-neutral, natively verified repository identity and transport. Do not
reuse a GitHub identity shape to pretend a GitLab network was verified. Preserve remote
names, duplicate/multivalue configuration, push URLs, refspecs and unrelated bytes;
require explicit conflict resolution rather than overwriting. No fetch/push, credential
change or branch publication is implied by adding a remote.

## Required verification

Initial core fixtures must exercise personal and nested namespaces, wide IDs, exact
literal search parameters, bounded pagination, malformed/duplicate pages, changed
accounts and source paths, cancellation, direct relationship checks, unrelated projects,
import states and separate credential-free Git hosts. The closed HTTPS endpoint tests
must retain existing discovery/clone restrictions and add the exact read routes.

The complete workflow additionally needs real verified-HTTPS POST fixtures with request
counts and credential isolation, async/failed/unknown/empty import states, fork-network
ancestry, declined permissions, source/namespace moves, lost replies, cancellation after
actual bytes are sent, server acceptance before disconnect, uncertain outcome restart,
changed destination conflicts, expiration and main-window boundaries. Native-held plans,
durable records and Git remote bytes must be tested against independent behavioral
oracles. Run complete applicable source/renderer gates and an immutable Linux package
through the ordinary UI, then inspect normal/compact screenshots. Live-service and
Windows/macOS acceptance remain separate requirements. No fixture credential may be
used against a real service, and no real fork is created as part of local qualification.
