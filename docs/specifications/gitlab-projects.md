# GitLab account and project catalogue

## Capability and provenance

Provide bounded project discovery for an explicitly selected GitLab instance and
account. Project metadata is data for review; it does not grant Git transport,
clone, checkout or provider-write authority.

The requirement and model are independently designed from the public GitLab v4
REST documentation. No proprietary implementation, assets or UI wording were
used. The informational sources are recorded in the provenance register.

## Current scope

The secondary `codex/gitlab-read-catalogue` branch contains a core normalization
candidate and eight independently written model tests, plus a concrete HTTPS
transport candidate and twelve transport tests, plus a native account-session
candidate with fourteen tests. All 34 focused Rust/native cases pass on the
current dev base in `parity-gitlab-expiry-request-fence-rust`. The transport uses
explicit native-only credentials and a private runtime behind the synchronous
read port. Four native commands retain source registrations alongside recovery.
The desktop catalogue passes nineteen renderer journeys with one worker and no
retries in `parity-gitlab-renderer-failure-fallback-v4`. Native
bindings generate from the combined Rust registry in
`parity-gitlab-combined-contract-generate`, retaining all recovery and four GitLab
commands. Final generated-contract checks, Angular development build/type checking,
all-target Rust checking and Clippy with warnings denied pass in
`parity-gitlab-final-packaging-scope-check`. The production build, deferred panel inspection and exact packaged GitLab
workflow, full native regression and inherited-environment regression pass.
Complete local renderer regression and native visual review pass. Integration
and exact-head remote CI qualification remain pending.

The candidate manifest directly selects reqwest 0.13.5 with native TLS and Tokio
1.53.3. Both versions already occur in the base lockfile. Resolution adds fifteen
MIT/Apache-licensed packages without updating or removing prior package versions.
Locked offline Linux notice collection passes for the conservative 468-package
normal/build closure; exact-package redistribution verification remains pending.
The native session candidate also directly requests the same Tokio version for
its expiry timer. Its updated offline metadata and Linux notice collection also
pass with the same 468-package conservative closure; no further package/version
was added or updated.
No real GitLab credential has been used and no live account service called.
Recovery is now integrated into dev. This candidate preserves its six commands
and managed state; local candidate qualification continues sequentially.

## Instance and account

The instance constructor canonicalizes an HTTPS origin, including an explicit
nondefault port. It rejects credentials, queries, fragments and non-root base
paths. Subfolder installations need a separate explicit base-path design before
they are advertised. A transport must use the exact validated instance rather
than infer a host from a Git remote or working directory.

Account identity contains the canonical instance, positive decimal ID and login.
IDs remain strings across JSON so JavaScript precision does not change identity.
Only allowlisted account fields leave the model; raw API responses, token fields
and other private metadata do not become renderer payloads.

A page reads account identity before requesting projects and again before
returning results. An expected identity must match, and pages after the first
require one. Detected account/instance changes require reconnecting and a fresh project read.
These checks detect changed read contexts; they are not a credential snapshot or
authorization for a later mutation.

## Project reads and bounds

- Request twenty records, one explicit page at a time, ordered by ID.
- Offer membership-scoped or accessible-project discovery. Omit archived projects
  by default; allow an explicit inclusive read.
- Encode search literally as a query value. Bound it to 256 bytes without control
  characters. Do not interpret search as a command, file name or HTTP method.
- Bound page numbers to 1–1000. A full page means more results may exist. At the
  preview limit return a visible warning rather than claim the catalogue is complete.
- Preserve nested namespace paths. Require the supplied project web URL to match
  the selected HTTPS instance and that literal path.
- Keep descriptions and nullable default branches as metadata. Visibility and
  archived state do not imply write permission. Clone URLs are not exported by
  this first discovery model; cloning needs fresh independent inspection.
- Reject oversized pages, duplicate IDs, malformed required fields and conflicting
  links. An invalid response or transport error is never an empty successful page.
- Check cancellation before and between reads; cancelled late data is not returned.

A concrete transport must cap response bytes before JSON decoding, use only
authenticated GETs for these operations, retain cancellation and avoid returning
raw diagnostics or credentials. The model's field/count bounds do not replace
that transport-level byte budget.

## Transport selection and evidence

The canonical GitLab CLI is MIT licensed, but it has not been adopted. Its public
configuration documentation identifies host, API-host, protocol, subfolder,
token, CI-auto-login and debug overrides. A concrete adapter must define and test
that precedence before using a saved account. It must not silently redirect an
environment token, relax TLS verification or mutate a user's configuration.

The candidate selects a native HTTPS transport based on explicit account/instance
binding, cancellation, secret handling and the existing project architecture.
The CLI investigation below explains that choice. No proprietary client internals
were needed.

An isolated normal-use probe of the official CLI 1.126.0 release supplies a
synthetic saved login and a private HTTPS API, with no host installation or real
credentials. `api --hostname` rejects a hostname containing a port; the account
hostname and API authority must be represented separately. With that separation,
three explicit API reads use the saved fixture token and the selected authority,
override conflicting routing/protocol settings, preserve the profile bytes and
refuse an untrusted certificate despite an insecure fixture configuration.

These are observed CLI mechanics, not product authentication qualification.
A future client must bind a saved credential realm to a reviewed API origin and
must not silently reinterpret a configured account's API authority. The core
model currently identifies API origins; it does not capture or authorize a
credential realm.

A further owned-fixture probe of **glab 1.126.0 (4dd0d32d1)** observes that
`api --method GET user` follows a 302 to another HTTPS port and to another host,
forwarding the synthetic saved credential in both cases. Both destination
servers, certificates and the credential belong to the fixture. This is
version-specific normal-use evidence, not a claim about every CLI release.
Its raw API command therefore does not satisfy this adapter's exact-origin
transport requirement. The documented API command exposes no redirect-policy
option. Do not adopt that command as the concrete transport on these findings.

The initial credential input is a personal access token with API read access;
OAuth login/refresh and CI job credentials are outside this candidate. The HTTPS
candidate uses a redirect-disabled client, system certificate
verification, explicit credentials, no automatic proxies, no automatic retries,
no compression, a one-MiB response budget, five-second connect/read timeouts and
a fifteen-second request deadline. Only the user and bounded project-list
endpoints are permitted. A 25-ms cancellation wakeup drops the active future;
the passing stalled-body fixture verifies that behavior. Teardown does not
wait on blocking system DNS work, which may finish after request cancellation;
it does not authorize a later HTTP request. Errors use
original bounded messages without upstream diagnostic bodies or error chains.
The private test constructor adds only a fixture CA and never disables certificate
verification. It is not a renderer-supplied trust override.

The dependency provenance register records the resolved license closure and
notice collection. Broker behavior and package notices passed the local
integration checks recorded below.

## Native account sessions

The user explicitly selects an HTTPS instance and supplies an API-read personal
access token in the connect request. It is a one-way input: no response contains
the token, and the request type has no debug/serialization implementation.
The copied request string is released after creating the native transport.
Credential headers stay inside that transport; no process arguments, Git remote
URLs, environment-token inference, settings or credential files carry them.
There is no memory-zeroization claim or persistent login in this first slice.

Connect reads the account through verified HTTPS before publishing a native
connection ID. The native registry limits connected and pending attempts together
to eight. Failed or cancelled attempts release their reservation. Random IDs do
not replace another connected/pending entry on collision.

Connection authority expires thirty minutes after successful connection, without
renewal by reads. Expired entries are refused on access and pruned on access or
by a periodic sixty-second cleanup task. The task owns only a weak registry
reference. Expired data may remain until cleanup or an existing read releases
its reference; expiry is not a guarantee of immediate memory erasure.
Process restart does not restore credentials or replay a provider request.

Only one read may use a connection at a time; another request receives explicit
busy feedback. Every project page forces the connection's verified native
account as its expected identity, including the first page. A renderer-supplied
different identity is refused before provider I/O. Read results are rechecked
against cancellation, retirement and expiry before returning. Each provider GET
also checks the native lease before and after the response: an account read that
crosses expiry cannot authorize the remaining project/account reads in a page.

Disconnect retires the native ID and cancels the owned read without acquiring
its HTTP transport lock. Registry teardown also retires/cancels active contexts.
Metadata listing and disconnect perform no provider requests. The four commands
(connect, list connections, load projects, disconnect) enforce the main-window
boundary. These reads neither change commit identity nor grant Git cloning,
checkout, transport credentials or provider-write authority.

The desktop UI clears its transient token input after dispatch and retires
new late connection results after cancellation or dialog destruction, while
preserving previously connected accounts. Lost replies
can leave an expiring native connection discoverable through metadata listing;
they do not justify silently reconnecting or replaying a request.

## Verification and integration gates

The TypeScript and Angular-template syntax checks pass in
`parity-gitlab-ui-final-syntax-run`; they do not resolve imports, generate
bindings, typecheck, build, render or execute any behavioral case.

The eight passing focused model cases cover canonical instance roots; nested namespaces
and large IDs; account changes before/during reads; literal search and bounded
paging; invalid requests before I/O; malformed/duplicate data; conflicting links;
and cancellation. They use original owned JSON fixtures through the read port.
They do not qualify a live GitLab connection.

The twelve passing focused transport cases cover fixed endpoints and literal query values;
invalid credentials; real trusted HTTPS account/project normalization; untrusted
certificates; all five common redirect statuses without destination requests;
declared/streamed size limits, exact-boundary success and malformed JSON; redacted
HTTP failures;
cross-instance/pre-cancelled requests; cancellation and read timeout during a stalled body; and releasing the client during async
application teardown.
Their original Python fixtures create two local HTTPS servers and fresh test
certificates, use only a synthetic token, and own their child process/profile.

The fourteen passing focused native cases cover strict inputs/window access; metadata-only
listing/disconnect; pending/connected capacity and collision preservation;
cancelled publication; foreign-origin refusal; forced account binding; expiry before and between provider requests;
read-lease exclusion; disconnect while the transport is busy; periodic cleanup
without retaining app state; and cancellation during state teardown. They use
an injected owned read port and do not replace actual native IPC/TLS evidence.

The nineteen passing renderer journeys cover explicit loading; token clearing and
instance changes; Enter without manual clone submission; connection failures;
literal query/paging identity; retained rows after errors; late connection cleanup
on cancel/close; preservation of another connection; disconnect during a read;
lost/disallowed disconnect replies; foreign account replies; inert metadata;
manual clone/commit draft preservation; unknown versus empty connection inventory;
multibyte search feedback; compact keyboard behavior in both project themes;
canceling a held panel chunk without late metadata reads; and recovering from an initial
chunk failure through the preserved manual URL form without an implicit connection request; and disconnecting the
selected account during unrelated Git activity without canceling that Git operation.
They use a synthetic native-protocol fixture, not an actual authenticated service.
Both compact theme screenshots have been executed and visually reviewed;
packaged WebKit execution is qualified separately below.

## Desktop interaction

Repository management offers GitLab browsing beside the existing GitHub controls.
The new component is referenced only inside a deferred view, with plain loading,
cancel and error controls. Production module-graph inspection confirms chunk
isolation, and the build passes the unchanged production size budget. The modal's keyboard containment remains
the repository dialog's responsibility.

The token is an ephemeral input outside persistent form drafts. Changing the
instance, starting connection or leaving the panel clears it. A visibility toggle
and ordinary paste/password-manager behavior remain available. The panel initially
reads only local connection metadata; connecting and reading project pages require
separate explicit actions. A failed inventory does not become a successful empty
one. Unrecognized error values receive original fallback text.

Queries support membership/accessible scope, literal search and archived inclusion.
Changed queries require a fresh first page before paging. Failed/cancelled reads
retain visibly older rows; account/query mismatches never replace them. Metadata
is interpolated as text, with an explicit project-path copy action. Current reads
do not authorize cloning or other mutations; fresh GitLab clone review remains
an implementation gap, and the existing manual URL workflow remains available.

Disconnect stays available during a read. Late rows cannot revive that context.
A lost disconnect reply is reconciled by complete native metadata absence, without
replaying disconnect. A connection returned after cancellation or panel destruction
is retired only when its returned ID is valid and was not already present before
that connect request. Unconfirmed cleanup asks the user to review connections;
it does not clear an existing unrelated error. Manual clone and commit drafts are
separate from these transient controls.

## Current qualification

| Gate | Evidence | Result |
| --- | --- | --- |
| Focused core, HTTPS and native-session behavior | `parity-gitlab-expiry-request-fence-rust` | 34 passed: 8 model, 12 real-HTTPS-fixture, 14 native-state cases |
| Full locked offline Rust workspace | `parity-gitlab-full-rust-regression` | 887 passed, zero failures, 45 optional cases ignored |
| Optional LFS behavior | `parity-gitlab-final-lfs` | 34 core plus 7 native transport cases passed; no selected cases ignored |
| Optional signing behavior | `parity-gitlab-final-signing` | 3 passed; no selected cases ignored |
| Contracts, Angular build/type checking, all-target Rust check and Clippy | `parity-gitlab-final-packaging-scope-check` | Passed with Rust warnings denied |
| Frontend unit regression | `parity-gitlab-final-frontend-unit` | 178 passed across 27 files, one worker |
| Graph type checking, process/recovery controllers, native harness and package tests | `parity-gitlab-final-packaging-controller-and-harness` | All five Nx targets passed |
| Package-test environment isolation | `parity-gitlab-package-fixture-target-isolation` | 65 passed with an inherited shared Cargo target |
| GitLab browser journeys | `parity-gitlab-renderer-failure-fallback-v4` | All 19 passed, one worker, zero retries; both compact theme screenshots visually reviewed |
| Production budget and preview exclusion | `parity-gitlab-final-production` | Passed unchanged 1.40 MB initial cap; 54 JavaScript assets contain no development-preview initialization |
| Deferred production panel | `parity-gitlab-production-chunk-inspection.json` | 19,798-byte panel is outside the initial module graph and reached by a dynamic import |
| Exact Linux package and GitLab workflow | `parity-gitlab-final-package`, `parity-gitlab-final-native-gitlab` | Package passed inspection; 17 native scenarios passed, including 7 GitLab-specific scenarios |
| Full native regression | `parity-gitlab-final-native-full` | 216 distinct scenarios passed on the same package |
| Inherited-environment native regression | `parity-gitlab-final-native-environment` | 217 distinct scenarios passed on the same package |
| Complete renderer collection | `parity-gitlab-final-renderer-collection-run` | 1,457 cases, zero static skips, disjoint complete four-way assignment |
| Complete renderer execution | `parity-gitlab-final-renderer-shard-1` through `-4` | All 1,457 cases passed across four disjoint partitions; one worker, zero retries, no skips |
| Native painted views | `parity-gitlab-native-visual-painted` | 17 repeated native scenarios plus four viewport captures passed; all captures visually reviewed |
| CI-equivalent packaged GitLab command | `parity-gitlab-ci-native-command` | Passed on the qualified package |
| Integration and exact-head remote CI | Pending | Local acceptance does not establish remote CI or live-account acceptance |

The production initial bundle is 1.38881 MB, retaining the existing 900 kB warning.
The existing application stylesheet warning also remains (79.81 kB against its
76 kB warning). Neither error cap was relaxed. Module-graph inspection is a
read-only build-artifact check, separate from browser and native execution.

The optional native `gitlab` suite exercises actual packaged IPC and owned HTTPS.
Its private CA is scoped to the owned application process through `SSL_CERT_FILE`
and `SSL_CERT_DIR`; host trust is unchanged. It checks explicit connection and
reads, redirect refusal, stalled-read cancellation, metadata-only disconnect,
retirement, restart without credential restoration and unchanged independent Git
state. The suite also verifies the actual Deb dependency and extracted executable's
OpenSSL ELF requirements before launch. The Deb explicitly declares `libssl3`;
the local `libssl3t64` package provides that dependency. All 17 scenarios pass on
the exact package, including seven GitLab-specific cases. Seven HTTPS requests
carry the synthetic credential only to the owned source; no redirect-destination
request occurs. The extracted executable requires `OPENSSL_3.0.0` symbols.
No real account or credential has been used.

Qualified package SHA-256:
`90c23c9a82851c151cf7f849ae4dc58372c978ad655377aee8963835a404729a`.
Extracted executable SHA-256:
`d72415505eae4aaedf43d0ed6cd7010606689cc4aa53013cce6aa303c6a6fc6c`.
The three native suites total 450 executions covering 224 distinct scenarios;
repeated executions are not additional capabilities. The exact package contains
the 468-package conservative Rust notice catalogue;
that catalogue is not an exact linked-artifact SBOM. The native account/query
screenshot and four painted captures of connection controls/project rows at
1440×900 and 780×560 have been visually reviewed. The viewport probe uses normal
WebDriver resizing and DOM scrolling, followed by two animation frames before
capture. Its 17 repeated native scenarios do not add distinct capabilities.
The original viewport run passed DOM checks but captured stale frames; those
images are retained and excluded from visual qualification. The corrected
`parity-gitlab-native-visual-painted` run qualifies the views without changing
application code.

## Recovery behavior and retained regressions

Each native provider GET checks the read lease before and after its response.
The retained expiry regression `parity-gitlab-expiry-boundary-regression-red`
reproduces an account read crossing expiry followed by two unauthorized later
reads. The corrected 34-case focused run and full workspace regression pass.
A connection's account remains immutable: local metadata refresh and first-page
retry cannot rebind it. Changed-account feedback therefore directs reconnection.

Connection options bind selection when inserted, and Enter uses a full keyboard
event without submitting the parent manual-clone form. The browser fixture
supports the existing read-only background status refresh from its owned preview
repository while rejecting unknown commands. The initial failing receipts remain
in `parity-gitlab-renderer-first` and `parity-gitlab-renderer-account-selection-v2`.

A failed deferred dependency cannot be retried by recreating its Angular view.
The retained `parity-gitlab-renderer-status-fixture-v3` receipt passed 17 cases and
exposed that failed retry. The panel now preserves drafts, offers the manual URL
form and gives save/restart guidance. It never reloads the application automatically
or promises transparent in-place retry. The passing 19-case run tests the working
fallback, focus, draft retention and absence of implicit provider or Git mutations.

The retained `parity-gitlab-final-controller-and-harness` receipt has one failing
package test: the installer fixture inherited `CARGO_TARGET_DIR` and inspected an
unrelated real artifact. Its fixture now clears that variable, matching the other
package fixtures. Both the focused 65-case rerun and combined five-target gate
pass; production verification remains unchanged. Failed receipts and superseded
coordinator records are retained, and dependent work stops on a failed gate.

## Remaining parity scope

This catalogue is one capability within the wider provider goal. Reviewed GitLab
cloning, fork creation, remote attachment, merge-request workflows and issue
workflows remain open. Persistent/OAuth login, subfolder installations and explicit
proxy configuration also require independent design and qualification. Existing
GitHub behavior remains separate; GitLab namespaces must not be passed through its
two-segment repository normalizer. Full feature parity is not established by this
candidate's focused tests or by completion of its catalogue-specific gates.

The packaged-native CI job now explicitly installs OpenSSL for the owned HTTPS
fixture and runs the GitLab suite after ordinary WebKitGTK acceptance. It resolves
the verified package path through `task --silent package:deb:path` and invokes the
harness through Nx. This adds ongoing actual-IPC/HTTPS coverage rather than relying
only on the synthetic browser fixture. The same command passed locally in `parity-gitlab-ci-native-command`; remote
results remain separate.
