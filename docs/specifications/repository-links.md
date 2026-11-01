# Repository and Git object links

Status: independently implemented manual-link candidate with packaged evidence; OS-delivery candidate under validation. Full renderer and platform delivery qualification remain open.
Inventory requirement: G28. This document does not qualify the media candidate.

## Capability and sources

Users can share a repository, commit, branch or tag and open that selection in a
local application. Several local copies require a choice; an unknown repository
opens a reviewed clone flow. These capability requirements come from the public
[product guide](https://help.gitkraken.com/gitkraken-desktop/linking/), inspected
2026-11-01. No proprietary URL grammar, code, assets or visual composition is used.

The URI grammar follows [RFC 3986](https://www.rfc-editor.org/rfc/rfc3986).
Reference validation uses the public
[Git rules](https://git-scm.com/docs/git-check-ref-format).
[Tauri's public guide](https://v2.tauri.app/plugin/deep-linking/) describes startup
and running-instance delivery; its platform limitations must be tested separately.
Any new plugin requires a version-specific license and notice review before use.

## Independent version-one format

Khronos-owned version-one format:

```text
git-khronos://repository?v=1&remote=<percent-encoded-remote-url>
git-khronos://repository?v=1&remote=<percent-encoded-remote-url>&commit=<full-oid>
git-khronos://repository?v=1&remote=<percent-encoded-remote-url>&ref=<encoded-full-ref>
```

There is exactly one version and remote parameter, and at most one target.
Reject unknown or duplicate keys, fragments, extra path segments, invalid UTF-8,
malformed percent escapes, control characters and links over 8 KiB. Decode each
URI component once. Do not treat a decoded value as a second application URL.
Commit IDs contain exactly 40 or 64 hexadecimal characters. A ref is a complete
`refs/heads/`, `refs/remotes/` or `refs/tags/` name accepted by Git; shorthand,
revision operators, option-like expressions and arbitrary object queries are not
part of this format. A commit link identifies a commit, not an arbitrary blob.

Remote identity is a parsed network address, never a shell command or filesystem
path. Supported forms are HTTPS, explicit-user SSH URLs and explicit-user SCP-style
SSH addresses. SCP-relative, absolute and `~user` paths keep their original Git
semantics; they are not rewritten into absolute `ssh://` paths. Literal percent
characters in SCP paths remain literal. SCP and SSH URL identities remain distinct.
Ambiguous host-only SCP forms are refused. Reject passwords, HTTPS
userinfo, query strings, fragments, local/file URLs and executable transports.
Never copy tokens or secret URL parameters into links, clipboard text or logs.
SSH usernames and ports remain explicit; do not silently equate unrelated users
or nondefault ports. Normalize the hostname and default port only according to
the URL scheme. Path case and provider-specific aliases require documented rules.
Do not infer repository identity from its final directory name.

## Opening and generation

1. Validate native OS/command-line input before publishing it to the renderer.
   Invalid requests produce an actionable error and cannot initiate Git work.
   Retain bounded startup requests until the renderer is ready; distinguish
   multiple requests and avoid replay after acknowledgement.
2. Match only explicitly known open/recent local repositories by revalidated
   remote identity. Do not scan unrelated directories. An expired or inaccessible
   path is reported, not silently replaced by another repository.
3. One matching copy opens that repository for browsing. Multiple copies display
   their paths and worktree identities for explicit selection, including linked
   worktrees. Revalidate the selection before opening; cancellation changes no
   repository state. Preserve existing drafts and in-flight confirmations.
4. Resolve the target as a read-only browse operation. Missing refs/objects retain
   the requested target and report its absence. Do not automatically fetch,
   check out a branch, reset, create refs or materialize promised objects.
5. No matching copy opens the existing clone dialog with only the validated
   remote prefilled. The user chooses a destination and explicitly starts clone.
   After successful clone/open, navigate to the retained target. Failed or
   cancelled clone never triggers a hidden retry or discards unrelated drafts.
6. Context actions generate original Khronos links for repository, commit,
   branch and tag selections. When several remotes identify different projects,
   ask the user which remote to share. Do not change Git configuration or refs.
   Clipboard failure remains visible and does not claim success.
7. Cold-start and running-instance requests reach the same review/navigation
   path. A second request cannot silently replace a pending clone, choice or
   mutation confirmation. Keep the incoming request available for explicit use.

## Behavioral acceptance

| Fixture/action | Required result |
| --- | --- |
| Generate and parse each supported target | Exact repository and target round-trip, including Unicode and escaped ref slashes |
| Duplicate/unknown parameters, encoded controls, malformed escape, nested URL | Refusal before any repository/network operation |
| Same basename on unrelated hosts/owners; mixed-case paths; different SSH users/ports | No accidental repository match |
| One open copy, one closed known copy, two clones, linked worktrees | Correct browse target or explicit unambiguous choice |
| Missing directory, changed remote, closed session after choice | Fresh refusal or re-selection; no use of stale bindings |
| Missing commit/ref or promised object | Visible unavailable result, no fetch sentinel activation and unchanged refs/index/worktree |
| Unknown repository | Prefilled clone dialog; zero writes until explicit user action |
| Clone cancellation/error/success | Retained request, no hidden retry, target navigation only after successful open |
| Incoming link while another review/draft is open | Existing state retained; explicit handling of the new request |
| Clipboard denied; no remote; ambiguous remotes | Original actionable feedback, no false success or configuration write |
| Packaged cold and warm OS delivery | Same validated path with actual process/OS evidence on each claimed platform |

Parser tests and renderer fixtures are insufficient proof of OS integration.
Linux registration tests must use owned desktop/XDG and D-Bus fixtures; they must
not replace the user's protocol handlers. Windows/macOS acceptance remains open
until performed on those platforms. Tests must inspect actual behavior and avoid
proprietary implementation matching.


## Parser foundation checkpoint

The first source slice provides bounded parse/generate functions and conservative
network-remote identities. It performs no Git, network or filesystem operation.
The only newly direct library is the already locked `url` 2.5.8 crate, whose
MIT/Apache-2.0 provenance and notice obligations are recorded separately. Six
focused tests pass, including strict malformed-input refusal, exact round trips,
literal plus/percent/Unicode refs, and independent `git check-ref-format` oracles.
The full core regression passes 714 tests (701 unit, 12 clone-policy and one trust-policy test), with 37 intentionally ignored. All-target Clippy passes with warnings denied. The notice collector retains both complete published URL license files. No native IPC, menu,
clipboard, local-copy resolver, clone handoff or OS handler is implemented by this
slice; G28 remains open.


## Known-repository verification candidate

A separate read-only core API now inspects one explicit canonical working-tree or
bare root. It matches the first effective fetch URL returned by Git, honoring
`insteadOf` and owned include configuration, and conservatively preserves host,
path, port, user and transport distinctions. Secondary fetch URLs and push-only
locations do not establish a match. Full branch/tag references resolve to a local
commit; missing objects and non-commit targets remain unavailable. No checkout,
fetch, scan, registration or repository write is requested. All Git queries use
the bounded no-lazy-fetch reader and thread-scoped cancellation. Malformed or
truncated metadata is refused rather than reported as an empty successful match.

Thirteen focused tests pass across the parser and verifier, including a local
promisor sentinel with an independent ordinary-Git control, dirty/index/config
preservation, bare/linked roots, includes and URL rewrites. Full core regression
passes 721 tests (708 unit, 12 clone-policy and one trust-policy test), with 37
intentionally ignored. All-target Clippy passes with warnings denied. This API does not yet implement the
multiple-copy selector, native IPC, clipboard/menu actions, clone handoff or OS
URL delivery. G28 remains open.


## Composed fetch-free read checkpoint

A scoped core policy now applies Git's no-lazy-fetch flag to composed reads on
one worker without changing the process environment. Nested scopes and unwinding
restore the preceding policy. Snapshot reads stay on that worker in this mode,
so the policy and cancellation context cannot be lost in their usual parallel
lanes. Normal snapshots retain their existing parallel behavior. The scope does
not prohibit an explicit user-requested fetch.

Four behavioral tests use owned local fetch sentinels to prove scope restoration,
worker isolation, composed snapshot protection and explicit-fetch dispatch. The
first explicit-fetch fixture incorrectly expected a raw failure output from the
transport API; its corrected expectation retains the positive dispatch sentinel.
That failed attempt is retained. The full core regression passes 725 tests (712
unit plus 13 integration), with 37 intentionally ignored, and all-target Clippy
passes with warnings denied. Native navigation/session policy and UI integration
are still pending; this checkpoint does not establish end-to-end G28 acceptance.


## Manual-link source and native checkpoints

Strict JSON target decoding rejects extraneous fields for every target variant.
The SCP and cancellation extension passes 21 focused cases. The latest complete
core suite passes 729 cases (716 unit and 13 integration), with 37 intentionally
ignored; workspace all-target Clippy passes with warnings denied. A blocking owned
FIFO configuration fixture proves cancellation interrupts the running Git read,
rather than merely discarding a result after the process finishes.

Typed native commands parse/create links, inspect at most 32 explicit absolute
known locations, and open a freshly revalidated local selection. Discovery never
registers a repository. Opening builds its snapshot under a cancellable no-fetch
scope; the registered session retains no-lazy reads and pauses automatic fetch.
A late refusal or cancellation may leave that conservative session policy cached,
but must not activate a renderer tab. The policy-list API exposes cached flags for hydration after a WebView
reload in the same application process; packaged recovery acceptance is pending. Explicit schedule resumption is separate
from manual fetch and does not change global preferences.

The original lazy dialog requires an explicit remote for sharing, generates a
selectable URI before a separate clipboard gesture, and lists local copy paths
before opening one. It keeps unavailable target feedback. Link changes and dialog
destruction invalidate pending replies. The clone review uses its own form service
instance and exposes only clone controls; it never overwrites ordinary clone or
initialization drafts. After clone success the retained request is inspected again
and the user reviews the matching context before opening it. No automatic clone,
fetch, checkout or destructive retry is requested.

The workspace source gate passes 767 Rust tests (45 intentionally ignored) and
166 unique frontend unit cases. Typed binding drift checks pass. The first UI
typecheck and production build pass within the existing size budget. Fifteen
renderer cases pass from a frozen source tree, including actual ordinary-clone
draft preservation, retained unavailable targets, refusal of late navigation
after a repository switch, modal focus recovery and stale policy-reply refusal.
A later 15-case attempt failed its newly added policy-ordering case after source
edits during server startup; that served revision was uncertain. Its diagnostics
are retained. The fresh 15-case run verifies unchanged inputs and passes. The initial renderer
attempt used an incorrect status-response fixture and was stopped with status
143 after failures; its traces are retained, and the corrected focused and full
link-specific groups pass. This is not a successful full application renderer
gate. The exact manual-link Debian package
`7c6069acc6fe32343526cba9b5ef47116d74d0c35f74b5985feba5959d26b3f5`
contains executable `fdd017bf889b8d78bfd32100a0311a16c4290bf8706e4df4d84ce0f38a5119c9`
from runtime commit `ac79b33bfe5c187a836cf48d6c762b44e6f37554`. Its 680 recorded
inputs matched. Normal acceptance passes 195 scenarios and inherited-Git-environment
acceptance passes 196: 391 actual native executions, including the seven new link
scenarios in each environment. These verify real UI navigation, policy hydration,
FIFO cancellation, no-lazy composed/follow-up reads with an independent positive
fetch control, and unchanged owned config/index/refs/HEAD/dirty bytes. That artifact
has no OS-link plugin. The broad 1377-case renderer attempt was stopped after two
large-diff timeouts; six isolated repetitions pass, but their original cause is
unresolved. This is not a full renderer qualification. G28 remains open.


## OS-delivery candidate

Public Tauri deep-link 2.6.3 and single-instance 2.5.5 APIs provide platform
transport. These pinned MIT OR Apache-2.0 dependencies were reviewed with the
44 newly locked packages; all declare known permissive licenses. The existing
package notice collector retains complete notices for the Linux dependency graph.

Before saved-tab restoration, process arguments enter an independently written
in-memory FIFO with capacity eight. Canonically identical pending requests coalesce;
acknowledged links can arrive again with a new ID. Malformed/oversize own-scheme
input becomes one static, redacted rejection. Other arguments are ignored. Overflow
retains the original requests plus an explicitly dismissible notice. The queue is
volatile across application-process shutdown; no durable delivery guarantee is made.

Any pending request or overflow notice pauses automatic fetch and applies no-lazy
reads to every native repository session. Closing a review does not consume a
request. Review uses the same original local-copy/clone dialog, retains the selected
request ID through new arrivals, and acknowledges it only after successful explicit
navigation or dismissal. Existing tabs and ordinary clone drafts are retained.
Configured schedule resumption is refused while the inbox remains pending. Manual
fetch remains a separate deliberate action.

The final focused group passes 32 renderer cases (15 manual links, 17 incoming-link cases),
including startup restoration, listener teardown/stale replies, rejected native
unlisten recovery, edited-link retention, queue/error/overflow handling, clone-draft
preservation and narrow layouts. Five native inbox unit cases
pass. These are source/renderer evidence, not actual OS delivery evidence.

The native harness runs each candidate on a private D-Bus session with no service
activation directories; 33 harness tests pass, including real isolated bus identities,
refused host-service activation and literal startup argument handling. At this source-only stage, packaged
startup/singleton acceptance remained pending; the later Linux package checkpoint
below records its actual transport results. No host protocol
handler is replaced. Linux association routing and Windows/macOS behavior require
separate actual platform acceptance. The unchanged production size budget remains a
gate; source compile or mocked IPC does not establish end-to-end G28 parity.


The OS candidate source gate passes 772 Rust cases (35 desktop unit, eight terminal
integration, 716 core unit and 13 core integration), with 45 intentionally ignored.
The final frontend recheck passes 166 cases across 25 files and typechecking. The
All-target workspace Clippy passes with warnings denied, and generated IPC drift
checks pass. The Linux package regression passes 59 tests, including rejection of missing URI
arguments or scheme association. The desktop entry explicitly declares the owned
scheme and `%U` argument forwarding.

An initial 1392-case renderer run was stopped with status 143 after case 47 for
review corrections, before any production edits. It is not acceptance evidence.
Editing a received link now separates it from the original queue ID, so opening
that edited context cannot acknowledge the untouched request. Failed native
unsubscription cannot prevent reconnection, and invalidated callbacks stay inert.
The corrected 32-case group passes; a fresh full 1394-case run is pending.

The package acceptance plan includes executable argv delivery, startup
and warm-instance forwarding, private-XDG GIO association from the packaged desktop
entry, WebView queue retention, exact/stale acknowledgement, malformed/oversize
redaction, bounded overflow and a missing promised-object fetch sentinel during
cold saved-tab restoration. An independent ordinary Git read must activate the
owned sentinel. These checks were pending at this source-only stage; their executed results are
recorded below. Cold process argument delivery
is separate from a cold desktop-launcher association claim; Windows/macOS delivery
and installed-host integration remain unqualified.


## Linux OS-transport package checkpoint

The independently implemented OS-delivery candidate is preserved as Debian SHA-256
`24b73deaf96a89e54e9daf855bf546efb661f94d5496868ecec1b96fa73160fa`, executable
`45bd67cb28215d49b9bacb479ad8308eb9805216e09289d2e5947eb4e92bfe96`.
All 686 recorded inputs matched at preservation. The final production build passes
without raising the size budget. All 201 normal native scenarios and 202 inherited-
environment scenarios pass against these same bytes: 403 actual executions.

Six new owned scenarios execute in each suite: actual secondary executable argv
forwarding/deduplication while preserving an open review, WebView reload and exact/
stale acknowledgements, GIO association from the packaged desktop entry inside
private XDG roots, actual cold process startup with saved tabs, missing promised-
object saved-tab/patch reads with an independent positive fetch control, and
redacted malformed/oversize FIFO/overflow handling with unchanged Git bytes.
The reports verify saved workspace identity/path sets across the cold process
boundary. Both suites use a private D-Bus session with no host service activation.
They perform no live provider writes or host protocol-handler replacement.

The first native attempt stopped on a new test's JavaScript selector quoting
mistake after ten baseline cases. Two further attempts completed the three warm
transport/retention cases but exposed incomplete saved-layout fixture assumptions:
legacy tab data versus canonical workspace data, including valid legacy-only
state. The corrected fixture seeds both supported representations and records the
actual state across restart. These failed attempts remain retained and are not
counted as successful full gates. Only the native test helper changed after package
preservation; application inputs and executable/package hashes remain unchanged.

The fresh full 1394-case renderer gate is still running. This checkpoint verifies
Linux cold executable argument delivery and warm GIO routing separately; it does
not claim cold desktop-launcher association, installed-host integration or
Windows/macOS acceptance. G28 and the broader parity goal remain open.
