# Linux packaged acceptance

The native acceptance harness tests the production WebKitGTK application
extracted from the Debian package. It does not install the package, alter a
personal Git configuration, reuse personal repositories, or expose a
development-only application endpoint.

## Prerequisites

- the pinned Node, pnpm, and Rust toolchains;
- `task`, `dpkg-deb`, Python 3, Git, Git LFS, and OpenSSH;
- `openssl` for the owned GitLab HTTPS test fixture;
- `fakeroot` for the package regression suite's private dpkg ownership checks
  (not required for normal application use or installation);
- `tauri-driver 2.0.6`, `WebKitWebDriver`, and Xvfb for headless runs;
- `desktop-file-utils` (`desktop-file-validate`, `update-desktop-database`) and
  `libglib2.0-bin` (`gio`) for full/inherited-environment incoming-link checks;
- the Linux libraries required by Tauri and WebKitGTK.

Missing prerequisites are failures. The harness never reports a skipped native
suite as a pass.

Linux bundling also prepares `rust-dependency-notices.json.gz` from locked,
offline Cargo metadata for Tauri's explicit target triple. It includes the
conservative normal/build dependency closure, upstream notice text/hashes and
versioned source locations, with separately marked project-authored source
availability where explicitly reviewed. It is not an exact linked-artifact
SBOM or a legal approval. Missing or changed license provenance fails bundling.
The Debian verifier rejects a missing, corrupt or mismatched catalog; rebuild
with `task package:deb` if the generated copy is absent or differs. Existing
curated notices remain alongside it. `desktop:package-test` covers collection,
generation and private Debian payload/cache regressions without installing.

The package also carries `frontend-dependency-notices.txt.gz`: Angular's
production-generated notice bytes, followed by the explicitly reviewed full
dialog-plugin terms omitted from that package's SPDX-only published notice.
The generator verifies the package/lock/source identities and retained hashes;
the Debian verifier rejects missing, corrupt or mismatched frontend notices.
The generated file alone is not an exact frontend SBOM or legal approval.

The separate `desktop:test-ssh` target requires `/usr/sbin/sshd`, or an absolute
`GIT_KHRONOS_SSHD` path to an already available OpenSSH server. A private extracted
package prefix is supported: keep `usr/lib/openssh/sshd-session` and `sshd-auth`
beside `usr/sbin/sshd` in that prefix. The test selects those helpers explicitly,
uses an ephemeral loopback listener and private keys/trust files, and does not
require installing or reconfiguring the host's SSH service. A missing prerequisite
is not an application transport regression or a successful qualification.

## CI Rust build footprint

The checks job builds serially with line-table debug information for Cargo's
`dev` and `test` profiles. This retains source-line backtraces without full type
and variable debug information. It does not disable debug assertions, overflow
checks or tests. Local developer defaults and the packaged release profile are
unchanged. See the [Cargo profile reference](https://doc.rust-lang.org/cargo/reference/profiles.html).

The checks cache uses the `checks-line-tables-v1` prefix, preventing restoration
of the previous full-debug target cache when establishing the smaller profile.
The [Rust cache action](https://github.com/Swatinem/rust-cache) includes Cargo
environment values in its cache identity. Disk availability is recorded before
verification and after releasing checked desktop artifacts. A CI disk-exhaustion
failure is retained as a failed build; it is never reported as passing tests.

## Durable local validation

For a long-running Linux validation command, run the existing Nx targets through
the owned-process wrapper from the repository root:

```sh
node tools/run-validation.mjs start target/validation-runs/my-source-check run-many --targets=test,check --projects=desktop --parallel=1 --skipNxCache --output-style=static
```

Use a new run directory every time; it is created exclusively. The launcher
prints its runner PID and directory, then the worker records `started.json`,
`output.log`, and a terminal `result.json`. Verify `started.json` and the live
process before interpreting a missing result as a running job. A launcher PID
alone does not establish that a command started successfully.

SIGINT or SIGTERM to that verified runner interrupts its owned command group,
waits for cleanup, and records the interruption instead of abandoning children.
Commands get a separate process group; unrelated groups are outside cleanup
scope. Descendants that deliberately leave that group are not chased. This is
validation tooling, not a way to manage personal applications or arbitrary PIDs.
For Playwright, also select a fresh, run-specific `--output` directory to avoid
two runs deleting one another's traces. Do not overlap timing-sensitive suites
with a compiler or a second browser suite.

The lightweight lifecycle tests include the actual CLI with a private fake
package-manager executable; they never change the user's PATH or launch a build:

```sh
pnpm nx exec --projects=desktop --excludeTaskDependencies -- node --test "$PWD/tools/owned-command.test.mjs"
```

`desktop:owned-process-test` runs the same lifecycle regressions, and
`desktop:graph-test-typecheck` strictly checks all `graph*.ts` renderer test
files without emitting output. Both are dependencies of `desktop:test` so they
also run through the ordinary test gate. The graph check does not claim to type
check unrelated renderer journeys.

## Nx targets

```text
pnpm nx run desktop:package-deb
pnpm nx run desktop:native-smoke
pnpm nx run desktop:native-full
pnpm nx run desktop:native-performance
pnpm nx run desktop:test-lfs
TMPDIR=/tmp pnpm nx run desktop:test-signing
```

The packaged GitLab catalogue suite uses the same verified package and ordinary
native IPC with an owned HTTPS service and synthetic credential:

```sh
package=$(task --silent package:deb:path)
pnpm nx exec -p desktop --excludeTaskDependencies -- \
  python3 "$PWD/tools/native_acceptance.py" --suite gitlab --headless --package "$package"
```

Its private CA applies only to the owned application process. It does not alter
host trust or contact a real GitLab account. See the
[GitLab specification](specifications/gitlab-projects.md) for behavior and evidence.

`test-lfs` runs the normally ignored Rust LFS integration checks serially with
real Git LFS, using disposable repositories and local transfer/locking fixtures.
It covers checkout, selective fetch, object inspection, tracking-rule removal,
and conservative cleanup. It is non-cached and fails if Git LFS is missing. The
CI checks job installs Git LFS and runs this target separately from ordinary unit
tests, so ignored coverage is not mistaken for an exercised integration gate.

The target also runs the desktop `authentication_transport` LFS regressions,
which require real Git LFS and the shipped askpass helper.
`lfs_lock_listing_uses_authenticated_json` uses a private Basic-auth locking endpoint that returns a known held
lock; the scoped core API must return that lock, report quiet authentication
failure instead of an empty list, honor prompt cancellation, and allow an explicit
retry. This is separate from native lock-dialog acceptance. Core bounded-reader
tests also retain complete bytes and exit status below the limit, stop inherited
pipe holders on overflow, and remain cancellable after parent exit.
Endpoint-policy regressions refuse embedded credentials from ordinary endpoint
keys and working/index/HEAD/bare `.lfsconfig` sources before any connection to the
owned server. Safe file-source and ordinary-config overrides still authenticate
and return the held lock without rewriting the configuration or index. Unix path
fixtures include whitespace, newlines, Unicode, and non-UTF-8 bytes. Invalid and
oversized file configuration must fail closed. A separate regression first
authenticates against the held-lock fixture, then repeats safe ordinary endpoint
values beyond the capture limit and requires refusal without another connection
or a change to Git configuration or index state. A Linux core fixture holds a
configuration FIFO open and requires cancellation to finish before the writer
closes, rather than relying on EOF to release the query.

Native full/environment acceptance also calls the packaged lock-list IPC against
a private Basic-auth locking server. Its fixture-only credential helper releases
saved credentials only when noninteractive retrieval is configured. The JSON
listing must retain the known held lock, an unauthenticated read must fail rather
than return an empty list without opening a prompt, and a configured retry must
recover the same lock. HEAD, index, and working contents must stay unchanged.
The packaged endpoint-policy checks refuse credential-bearing ordinary endpoint
keys and a working `.lfsconfig` without another TCP connection or HTTP request.
A safe ordinary-config override must still return the held lock without changing
the selected file or Git configuration. The core parser regression also keeps
distinct non-UTF-8 endpoint names separate when applying configuration overrides.
The native fixture also exceeds the ordinary endpoint-query capture limit with
repeated safe values and requires refusal before another connection or request.
This exercises the shipped command boundary, not a lock-dialog interaction.

Native full/environment acceptance also builds real local branches, remote refs,
and tags with short, medium, and overflowing names on separate commits. It uses the column separator's keyboard controls
at three increasing widths and real WebDriver pointer movement, sampling 30
animation frames on hover and focus. Labels must remain readable without moving
their resting position or the adjacent graph. The application-generated reference
markup is not replaced, and Git refs, index, and working contents must remain
unchanged. This complements the renderer-only reference-hover matrix.

The avatar-side fixture creates a real merge graph, an intervening branch, and a
branch that can be pinned to the left. In expanded/compact and pinned/unpinned
modes, it measures the packaged SVG endpoints in screen coordinates against the
actual avatar bounds. Left/right departures, converging arrivals, and straight
reference connectors must meet the circle's side center within 0.1 px. The
pinned case must exercise an incoming lane relocated to the avatar's right side;
the unpinned case must exercise departures on both sides. These checks use the
release DOM and persisted user preferences, not Angular debug APIs or replacement
markup. Git refs, index bytes, and working-file contents must stay unchanged.

A second fixture reproduces the nine-commit shared-parent/checkpoint topology
reported in Git-Khronos itself, using original fixture commits with deterministic
dates and verifying their actual loaded row order. In both graph densities, the
real parent link must leave the shared commit's right-side center, while
unrelated compacting lanes must remain at least 0.5 px outside the avatar circle.
Every rendered commit edge in this fixture must use only horizontal/vertical
SVG segments and circular quarter-turn arcs, with rounded joins in both modes.
At least one rounded turn must actually be exercised. Avatar lane spacing is
40 px expanded and 32 px compact, leaving room for the rounded side ports.
The report records the checked path count per mode as
`roundedOrthogonalGraphPathCount`; earlier reports without this field do not
qualify the rounded orthogonal routing requirement.
The report records the minimum measured bypass clearance. Parent links must not
be confused with continuing lanes, and this test also preserves refs, index, and
working contents.

On Linux hosts with changing bridge/veth interfaces, Chromium can abort even
loopback development-module requests with `net::ERR_NETWORK_CHANGED`, before
the application shell starts. Renderer-only checks can use a temporary private
network namespace when unprivileged user namespaces and `ip` are available:

```sh
NX_DAEMON=false NX_ISOLATE_PLUGINS=false \
  unshare --user --map-root-user --net -- sh -c \
  'ip link set lo up && exec pnpm nx run desktop:e2e -- --workers=1'
```

This enables only the private namespace's loopback; the host user's privileges,
host interfaces, services, browser flags, assertions, and timeouts are unchanged.
Do not disable host security settings to make this command work. These renderer
checks do not qualify real Git transport: run the separate native, HTTP, SSH,
LFS, and signing gates as described above. Keep heavy concurrent builds out of a
renderer timing requalification, and retain any preceding failure artifacts.

`desktop:check` compiles its development renderer into `dist/checks/desktop`,
separate from `dist/apps/desktop` used for production packaging. A check run
must not delete or replace release assets. It is not a production renderer build;
packaging still runs the production build and its preview-initializer guard.
Ordinary development builds (`desktop:build:development`, or Angular's
development configuration) write to `dist/development/desktop`. Nx's build
output declaration follows the selected `output-path` option, so restoring a
development build from cache must not restore or overwrite release assets.
The production guard reads that same selected output directory.

`test-signing` separately runs the three normally ignored real SSH, OpenPGP,
and X.509 signing tests, serially and without caching. It requires `ssh-keygen`,
`gpg`, `gpgconf`, `gpgsm`, and OpenSSL. Use a short temporary-directory path on
Unix because GnuPG's agent sockets have a platform pathname-length limit.
The CI checks job installs these tools and runs this target explicitly. Keys
and trust stores are fixture-local; personal signing material is not used.
The CRLF-pointer regression first asks Git LFS to accept the pointer, writes it
as an unreachable Git blob, and verifies that cleanup retains the referenced
object and rejects a stale pre-pointer removal preview without changing HEAD or
index bytes.

LFS reference scanning spools small-blob requests to a private temporary file
instead of retaining every Git object ID in memory. Each Git inventory/content
phase has a 120-second deadline; cancellation and parser failures terminate and
reap its process group before returning. Core tests reject malformed, truncated,
out-of-order, oversized, and extra batch responses, and check inherited-pipe
timeouts and owned temporary-file cleanup. Packaged acceptance separately blocks
each phase in an owned Git wrapper and requires cancellation to finish within
two seconds while the gate remains closed, with the child reaped and cached
object bytes unchanged.
The five preliminary Git/LFS metadata checks use the same monitored process
lifecycle, with a 15-second deadline and a 256 KiB output limit. Native acceptance
blocks each preliminary check separately and requires the same cancellation and
reaping guarantees. Clone settings use complete NUL-framed records: a partial
clone whose remote is named `false` is still refused, valid disabled promisor
booleans remain supported, and a failed configuration query is never interpreted
as proof of complete history. Both preview and reviewed removal must refuse an
owned injected configuration-query failure without changing cached bytes,
HEAD, or the index.
A failed metadata parent must also release any descendant holding stdout open
without waiting for the deadline. Core tests require buffered bytes and the
original nonzero status to survive cleanup, including Git config's exit 1 for no
matches. Packaged acceptance injects an exit-2 parent with an inherited writer;
both preview and reviewed removal must refuse within two seconds, with the
parent reaped, the descendant stopped, and all cached bytes unchanged.
Directory-swap acceptance separately holds Git's object inventory after local
cache discovery, replaces an owned cache directory with a link to an owned
outside sentinel, then resumes removal. The sentinel and the parked reviewed
object must both survive, and the operation must report an explicit refusal.
The outside sentinel has the same size as the reviewed object, so metadata
length checks alone cannot make this test pass.
Unix removal retains a handle to the common Git directory and walks each cache
parent relative to that handle without following links. Leaf metadata must
still describe an ordinary file of the reviewed size. Core regressions exercise
swaps at every cache directory level, replacement of the common-directory path,
leaf links, changed sizes, and directory traversal attempts. Linux regressions
also preserve support for execute-only ancestors and unreadable object bytes.
An additional real-Git regression replaces a stored pointer with an ordinary
blob, proves that normal Git reads hide the pointer, and requires cleanup to
retain its cached content anyway. The packaged scenario also verifies that the
replacement ref, HEAD, index, and all cached bytes remain unchanged.

`native-smoke` checks the production CSP, graph layout, selection, lazy dialog
styles, saved-tab restoration, native snapshot transport, workspace-menu outside
dismissal before mouse-up (without consuming the toolbar action), and asynchronous
untracked-file discovery and removal in the working-tree UI, including changes
made alongside an external branch checkout. `native-full`
adds disposable Git repositories and verifies the implemented staging,
history, recovery, reference, worktree, submodule, patch, bundle, mail,
remote, signing, and LFS workflows, plus retained history pages across metadata
refreshes with an exact Git history comparison. Shallow-history checks retain
older parent objects locally and compare commit IDs and parent edges against
Git across pagination, deepening, and unshallowing, in both the main checkout
and a linked worktree. Missing objects, invalid compressed objects, and malformed
decoded commit objects must produce explicit history
errors, not successful shortened pages. The error persists on retry; restoring
the owned object and explicitly refreshing must recover all commits without
advancing the retained page count on failure. A native UI commit refused by a
hook is explicitly retried without dismissing its error. Commit Undo/Redo is
also exercised through the real toolbar, with Git HEAD, index, and working-file
assertions. `native-performance` uses 20,000- and
100,000-commit histories with 64 branches and 36 linked worktrees.

Shared-reference fixtures create local branches, remote-tracking branches, and
tags with matching names. Under both `core.warnAmbiguousRefs` settings, native
snapshots must retain namespace-relative names and the correct upstream. Tag
inspection and deletion use the returned name, while the local branch, remote
reference, HEAD, index, and working contents must remain unchanged.

The Linux transport-cancellation fixture exits an owned Git wrapper while a
same-process-group child keeps its output pipes open. Cancellation must still
finish in under one second, stop that child, and leave HEAD, index, and working
contents unchanged. Core Unix tests separately retain delayed stdout/stderr and
the original successful or failed parent status when no cancellation is requested.
These checks do not qualify Windows descendant termination after parent exit.

Remote-URL configuration validation is also part of the cancellable operation,
before Git starts a transport. A Linux core fixture blocks an owned configuration
FIFO; native acceptance separately holds the URL-validation query in the owned
Git wrapper. Cancellation must finish while that hold remains active, reap the
query, and leave HEAD, index, and working contents unchanged. No network fetch
or implicit retry is needed to release either fixture.

Clone-policy integration fixtures use private global/system configuration in
isolated subprocesses and allow only file transport. The native fixture blocks
HTTPS before presenting a synthetic credential-bearing rewrite, then requires
`credentialsInUrl` for global, destination, and remote-conditional settings,
without a leftover destination. A safe rewrite must still clone the owned source.
An owned wrapper separately holds clone's `--get-url` review: cancellation must
finish within one second while the hold remains active, reap the process, remove
only the reserved empty destination, and preserve source HEAD, index, and bytes.
Template fixtures separately require HTTP and SSH password rewrites to be
refused despite a configured `transfer.credentialsInUrl=allow`, while a safe
template's rewrite and marker file remain usable. HTTP username-only template
URLs remain outside this qualification; see the explicit boundary in
[authentication.md](authentication.md).

The Linux harness starts its driver and headless display in private process
groups. Teardown stops and waits for surviving group members even after the
leader exits, before deleting owned fixtures. Deterministic tests retain a
SIGTERM-resistant writer and require it to stop; another test refuses to signal
the test runner's group. If shutdown cannot be verified, the harness fails and
retains the fixture instead of racing its deletion. Cleanup errors are not
converted into passing acceptance results.

Native keyboard smoke checks compare ordinary Tab navigation from the main and
workspace menu buttons with Tab dismissal from an open menu. Focus must reach
the same outside control, not a removed menu item. Renderer checks additionally
cover Shift+Tab, the welcome screen's document boundary, reopening menus,
Escape restoration, and pointer-down dismissal without waiting for a click.
Busy-menu regressions additionally disable every workspace action both before
opening and after focus enters the menu, then compare Tab/Shift+Tab with normal
closed-menu focus order. A packaged native fixture starts a real renderer fetch,
holds only its owned Git process, and checks menu dismissal and focus while that
operation is still pending, without patching Angular state or the native bridge.

Core cursor regressions separately verify that failed metadata initialization or
refresh remains an error on subsequent page requests, even after metadata is
repaired, until an explicit refresh successfully initializes the cursor again.
They cover both the in-process and Git CLI initialization paths; these exact
failure points are not injected into the packaged IPC scenarios.

Control-character fixtures create ordinary commits containing field/record
separator bytes in author names, subjects, and bodies, including message text
shaped like a forged history record. Packaged checks compare commit IDs against
independent Git traversal and each affected field against a separate Git query
across initial loading, pagination, and refresh, with non-ASCII author text and
configured UTF-16 log output overridden by the UTF-8 transport. Core tests also
reject truncated,
duplicate, invalid-OID, and unframed records and check that malformed raw NUL
messages cannot inject history. An owned signature helper proves that configured
signature presentation is not executed by history loading or tip discovery.

Stash-label fixtures likewise preserve control characters and Unicode under
configured UTF-16 log output. They compare stack selectors, IDs, and labels with
independent Git queries, retain duplicate stash objects, and exercise rename,
apply, drop, and pop against exact owned contents. Deleting an externally created
long-label stash retains its complete object behind operation recovery; only the
display preview is bounded. Restoring its recovery branch must restore the full
saved file contents. Core checks separately reject malformed stash frames and
verify that stash listing does not execute configured signature presentation.

Stash deletion requires the selected object ID as well as its mutable stack
selector. Core and packaged IPC checks reject a shifted selector before recovery
capture or deletion. The packaged UI scenario uses an owned Git reference lock
to refuse deletion, checks that the confirmation and focused inline error remain,
then removes only that lock and explicitly retries. Renderer checks additionally
cover pending-action dismissal and duplicate-submit guards, repository navigation
before a reply, keyboard focus trapping/restoration, and long labels in a narrow
reduced-motion viewport.

Plain apply/pop and latest-pop IPC also require the displayed object ID. Owned
fixtures reject shifted selectors without changing files or index bytes, apply
an older selected entry without removing it, preserve conflict stages and the
stash on failure, and distinguish successful application from refused removal.
A configured owned merge driver adds a different stash during application; the
selected contents must still be applied and the changed stack must remain intact.
The native Pop button is separately exercised with an owned stash-reference lock:
the persistent warning must explain that changes were applied and must not be
applied again. Only explicit deletion completes removal after repairing the lock.
Renderer checks cover captured menu/palette repository ownership and later
inspection/navigation while an action's reply is pending.

Immutable stash-preview checks read an older selected object after another stash
has moved its ordinal. Message text, tracked/untracked file lists, and patches
must all describe that same object under UTF-16 log output, notes, and forced
colour configuration. A signed-looking owned stash first exercises a configured
verifier to establish the fixture, then proves preview does not run it and does
not label the object unsigned. SHA-256 fixtures separately inspect tracked and
saved untracked files. Core checks also bound large messages and refuse to infer
signature absence from incomplete headers; renderer checks ensure later file
inspection retains the selected object ID after metadata refresh.
The packaged UI separately displays the Unicode stash body, then opens a saved
file after an external stash store has renumbered the stack; the diff must still
show the selected stash's contents without component-state injection.
Older listed stashes absent from the loaded history open directly through the
external-summary path, which also uses explicit UTF-8 and suppresses presentation
output. Renderer coverage checks that this selection does not fetch unrelated
commit pages.

The full suite also exercises bulk-discard confirmation and capture creation,
refusal of partial discard after an external edit followed by reload and explicit
retry, restoring and staging a file
from an earlier commit, and saving edited conflict
output through the production UI. Independent Git/file assertions verify those
results; renderer-only tests separately cover delayed-reply races.
Packaged IPC checks also verify raw untracked-binary discard/recovery without
executing a configured text converter.
Tracked and untracked working-directory comparisons likewise preserve raw text
and binary previews without executing converters. Large comparison previews are
explicitly truncated; the backend bounds collected diff stdout during the read,
rather than buffering the entire diff before trimming the response.
Untracked summary statistics use symlink target-path bytes without opening the
target. Native checks cover external, binary, directory, dangling, and newline
targets, plus non-UTF-8 text, empty/CRLF/binary files, and large streamed counts.
Binary-prefix checks cover NUL bytes immediately before and after Git's 8000-byte
probe boundary and beyond a streamed-read boundary, preserving later text counts.
Attribute scenarios cover forced text/binary, custom diff drivers without running
their text converters, inherited/info rules across a wide path set, and
files immediately below, at, and above a configured large-file threshold.
SHA-256 repositories have a separate native statistics fixture.
Index-only executable attribute files and attributes inside sparse-index trees
are checked without rewriting the original index or hydrating excluded files.
They also refuse linked recovery directories, patches, and existing or dangling
marker links, verify that external bytes and permissions remain unchanged, and
exercise recovery, redo, and deletion after the invalid entries are repaired.
Ignore-file scenarios preserve existing non-UTF-8 rules, refuse linked rules or
another writer's lock, retry after lock removal, untrack only the selected literal
filename, and leave rules unchanged when Git refuses to untrack staged contents.
Operation-storage scenarios retain external data when rebase support is linked,
refuse starting rebase or controlling a split through redirected support, and
keep native Abort available. Linked or dangling no-commit journals refuse before
replay/control; repairing the owned journal permits a normal explicit Abort.
Literal-file scenarios use wildcard-, bracket-, and Git-magic-looking filenames.
They restore only the selected path while preserving dirty neighbours and their
index entries, and isolate commit/stash previews, comparisons, and file history.
Selected-stash scenarios roll back both names of a rename in ordinary and
staged-only modes, including literal pattern and newline filenames. They preserve
unselected staged/working contents, refuse visible or ignored data occupying the
old name, verify keep-index capture and restoration from the original base, and
check that the explicit restore-index option overrides repository configuration.
An unselected non-UTF-8 untracked filename remains in place when selected stashing
includes untracked files; scope exclusions use raw Git filenames, not display text.

Each run writes a JSON report, screenshots, and driver output below
`test-results/native/`. Reports include the package and executable SHA-256
digests, platform, Git version, scenario list, and performance timings where
applicable. Repositories, application data, global Git configuration, and
signing material live in a disposable directory.

Native terminal fixtures also use a disposable home and `/bin/sh`, without
inherited `ENV` or `BASH_ENV` startup scripts. Read-only requests and element
lookups have a two-second transport retry window; the initial request retains
its normal timeout. Clicks, navigation, and action scripts are never automatically
repeated after an ambiguous transport failure. Session creation retries only a
refused connection, never a lost response that may already have launched the app.
Read-only wait predicates tolerate
document replacement, and reload waits for a new document identity before
checking restored UI state.
Visible-control actions additionally require a nonzero viewport intersection,
an enabled non-inert control, and a center-point hit test before issuing one
native click. A failed or ambiguous click is retained as a failure, not replayed.

Terminal acceptance executes Git in the actual PTY, checks its selected working
tree and staged bytes, and verifies owned shell PIDs disappear after natural
exit and after explicitly closing a shell that ignores HUP. New shells clear
the shared Git-context overrides while retaining PATH, user Git configuration,
and SSH-agent settings. Shell startup files remain under the user's control.
Backpressure acceptance fills an owned stopped shell's raw PTY input buffer,
then opens, resizes, and writes to another terminal while the first write is
pending. Closing the blocked terminal must finish promptly, reap its shell, and
settle the pending write. Renderer tests separately verify per-tab input order,
close/write races, and cancellation of queued suffixes after a write failure.
Renderer close-failure fixtures reject the close reply and verify the screen and
tab remain available, the error is announced, retry targets the failed tab even
if another tab is active, and pre-close queued input is not sent afterward.
These deterministic reply failures are renderer coverage, not a claim that a
native process-termination failure was induced.
Native Rust fault-injection tests separately retain real, test-owned child
handles across status, kill, and wait failures, then explicitly retry cleanup.
A controlled per-child lock verifies concurrent cleanup does not hold the shared
registry. Exit notification is gated on both completed output handling and a
reaped child, with one notification claim across competing cleanup paths. The
packaged-app fixture captures actual terminal events, requires complete final
output before a single exit event, and checks that the owned PID is gone.
Renderer startup fixtures fail add-on initialization and partially completed
mounting, then verify disposal, native close requests, preservation of other tabs,
and explicit retry. Cleanup-refusal fixtures retain the failed startup ID and
block another startup until cleanup succeeds; repository teardown also retries
that outstanding session. A packaged-app fixture injects a one-shot DOM append
failure without production test hooks, captures the real owned shell PID before
the test-owned launcher execs `/bin/sh`, and verifies that error handling reaps it
before offering a successful fresh startup. The native bridge is not replaced;
the launcher's PID record and the native registry are checked independently.

Authentication renderer tests cover interrupted listener registration, rejected
teardown, pending-request recovery, initial snapshot failure, cross-prompt reply
races, cleared credential inputs, and failed cancellation. The native fixture
uses the normal event API with fixture-only unavailable request IDs and dummy
input: it checks that the real broker's refusal does not trap the modal, lose the
next prompt, or falsely report confirmed cancellation. It asserts that the native
pending list is empty before and after; no real authentication request is consumed
and this fixture is not live remote-account authentication proof.

A separate packaged-UI scenario clicks Push in an owned repository whose real
Git pre-push hook calls the shipped askpass helper, accepts a dummy passphrase,
and refuses the push. The native dialog must close and show push-rejection
guidance rather than an authentication failure, without exposing the dummy
value. Local HEAD, the index, working-file bytes and the remote tip must remain
unchanged. This qualifies the packaged prompt/error path; actual server
authentication and divergent-history rejection are covered separately by the
loopback SSH integration test.

Another packaged Fetch scenario uses missing local remotes whose names contain
`certificate`, `ssl`, or a certificate-error phrase. It must show general
transport guidance, never a false HTTPS certificate warning, and preserve local
HEAD, index and working-file bytes. Real HTTPS certificate refusal remains a
separate transport integration check.

A separate Fetch scenario covers missing local target names containing
authentication, SSH host-trust and push-rejection phrases, including an embedded
quote. It requires general transport guidance with no pending credential request
and the same independent local-state preservation checks. Unit controls also
verify that quoted targets cannot override a genuine security or Push failure.

Renderer tests write to `test-results/renderer/`; native evidence stays in
`test-results/native/`. Playwright clears its output directory before a run,
so keep independently retained audits in sibling directories, not inside the
renderer output directory.

Pull requests run the smoke suite against a newly built package. Pushes to
`dev` run the full suite. Manual workflow dispatch can run full or performance
acceptance. CI artifacts retain both the tested package and its evidence.

## Evidence boundary

Production renderer builds must exclude development URL scenario initializers
without increasing the initial-bundle budget. The asset check refuses missing
output and scans every emitted JavaScript chunk for development-only query keys;
ordinary browser sample data remains supported. Native acceptance additionally
reloads an owned three-commit repository with comparison, diff, co-author, and
conflict preview parameters. Those parameters must not create inspections, edit
the commit draft, or change HEAD, index bytes, or working-file contents.

Diff-layout acceptance uses real before/after Git revisions and checks the same
visible new-source line across Hunk, Inline, and Split views, both wrapped and
unwrapped. Toolbar focus, HEAD, index bytes, and working-file contents must stay
unchanged. Reports retain per-layout pixel offsets and screenshots. Renderer
regressions separately cover keyboard layout navigation, manual reading positions,
large fonts, stacked panes, reduced/normal motion, newer navigation overriding
queued restoration, and closing/reopening before rendering. Wrapped-row anchoring
must release on real wheel input and stop scheduling corrections at a clamped
scroll boundary or after closing the viewer.

Blame acceptance separately holds both the legacy and paged Git reads open while
unrelated native controls and renderer probes must remain responsive. A real
100,000-line Unicode fixture checks exact first/middle/final ranges, immutable
attribution, and 100 rendered rows after navigating with the visible Next control.
HEAD, index, and working-file bytes must not change. Renderer coverage additionally
checks initial failures versus empty results, retrying a failed page without
losing the current page, stale-request ownership, large line-number visibility,
compact layout, and keyboard horizontal access to long source lines. New blame
pages cap each pipe at 2 MiB; the compatibility full-file reader caps each pipe
at 16 MiB. Both use the existing 15-second history deadline and refuse incomplete
data rather than claiming complete attribution.

On Linux, Tauri's driver creates the WebDriver session and owns the native driver
process. The harness then sends commands directly to the same native WebKit
session, avoiding the intermediary HTTP transport for session control. Reports
record this route as `webdriverTransport`. Lost mutation replies still fail the
run: no click, script, or navigation is replayed or sent through a fallback.

Commit-preview acceptance configures UTF-16 log output, notes, signature display,
and colour in an owned repository. The native UI must display the selected
Unicode message and unsigned status correctly. Legacy and paginated file-history
IDs are compared with an independent Git query; control characters in the author
and subject must remain text, not become extra records. Repository search must
retain Unicode subjects under the same settings. A separate real SSH-signed
commit must retain both its Unicode body and a valid verification status.
These read-only checks also verify that the preview fixture's HEAD, index bytes,
and working-file contents remain unchanged.

Legacy file-history acceptance uses an app-only Git wrapper to hold one owned
repository's `--follow` read open. Before releasing it, an unrelated native
command and a renderer-state read must complete in under two seconds. An
independent release thread prevents a regressed UI-thread reader from hanging
the test indefinitely. The wrapper does not affect the independent Git oracle,
other repositories, or commands without `--follow`. A changed-tree, unreferenced
commit with an oversized subject separately checks the real IPC output-limit
error, with no large subject inserted into the visible graph. HEAD, index bytes,
and working-file bytes must remain unchanged. The legacy preview retains its
existing 200-commit cap, adds a 2 MiB cap per output pipe and a 15-second read
deadline, and rejects overflow rather than returning a partial list.
A separate held read must return the native timeout before a 20-second fixture
fallback releases the gate, with the recorded owned Git PID already reaped.

`pnpm nx run desktop:native-environment` runs the full native suite with inherited
repository-routing and pathspec overrides pointing at another owned fixture.
The independent Git oracle keeps its clean environment; only the application
process and driver inherit the overrides. The outside fixture's HEAD, index, and
working contents must remain unchanged. Conflicting outside attributes expose
cross-worktree attribute lookup even if an index fallback would otherwise hide
it. This is separate from ordinary full and performance acceptance.

Passing headless acceptance proves behavior of the extracted production
package in WebKitGTK. It does not prove system installation, desktop-entry
integration, distribution-specific packaging beyond the runner, hardware-key
interaction, or a real hosted Git service. Those remain separate manual or
environment-specific acceptance steps.
