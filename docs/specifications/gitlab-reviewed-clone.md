# Reviewed GitLab cloning

## Capability

A user selects a project from a connected GitLab instance, inspects its current
metadata, chooses an HTTPS or SSH transport and local clone options, then reviews
the resulting destination and authority before explicitly starting Git.
The implementation is independent and uses the public
[GitLab Projects API](https://docs.gitlab.com/api/projects/) and
[Git clone contract](https://git-scm.com/docs/git-clone).
No proprietary implementation, wording, assets or layout is used.

## Required behavior

1. Inspect by a canonical decimal project ID, retaining precision above the
   JavaScript integer boundary. Read account, project, then account again through
   the selected native connection. Require its immutable account identity and
   exact instance at every stage. A renamed/moved project requires fresh selection.
2. Preserve nested namespaces and nullable default branches, including empty
   repositories. Archived repositories may be cloned. Browser URLs are not clone
   URLs; missing transports remain unavailable instead of being invented.
3. Validate the selected Git operand independently: credential-free HTTPS or SSH,
   no fragments, queries, control characters or arbitrary helper/local protocols,
   and a path matching the selected namespace. Support ordinary SCP-style SSH,
   SSH URLs with explicit ports, and IPv6. Self-hosted Git authorities may differ
   from the API authority; show the API origin, project browser URL and complete
   selected Git URL in the review.
4. Validate local options before provider I/O. Canonicalize the parent directory,
   refuse occupied or uninspectable destinations, preserve literal branch names,
   reject zero shallow depth, and retain explicit recursive-submodule selection.
   Reviewing a plan creates no clone destination and changes no Git repository.
5. Hold bounded, expiring plans natively. Bind each plan to its connection and
   review context. Consume it once before execution; an error or lost reply does
   not authorize replay. Cancel/discard affects only the owned operation/context.
6. Re-read account/project/account before execution. Refuse changed identity,
   namespace, browser URL, selected clone URL or destination. The unselected
   transport does not grant authority and need not stay identical.
7. Release the API read lease before starting the separately authorized Git
   operation. Its cancellation and authentication lifecycle belongs to Git;
   expiring or disconnecting the API connection after this handoff does not
   implicitly cancel an already accepted clone. Explicit Git cancellation remains
   available. API tokens never become Git arguments, URLs, configuration or
   credential-helper input.
8. Use the existing Git authentication/SSH and URL-rewrite review boundaries.
   Preserve nonempty partial clone data and report incomplete submodule outcomes.
   Do not retry automatically after cancellation, an uncertain reply or partial
   output. Registration/opening occurs only after successful execution.

## Independent desktop and native design

Original desktop controls provide fresh project inspection, explicit HTTPS/SSH
selection, literal branch/depth/submodule options and a destination/authority
review. Keyed component instances retire cancelled or late previews and preserve
the separate manual clone and commit drafts. An uncertain execution reply consumes
the visible token and asks the user to inspect the destination; it offers no replay.

Main-window-only native commands retain at most eight pending/ready previews for
five minutes using a monotonic lifetime. Strict nested requests accept only the
original connection/context and token for execution. API reads are fenced before
and after each request and release their lease before Git starts. Generated
contracts come from the project generator; no bindings were hand edited.

## Qualified Linux checkpoint

The corrected distributable is:

- Deb SHA-256: `38f876a06ff60c42bed6ea7080b51e5943ea216b4ebaa0972f0eebdc6e68078a`.
- Extracted ELF SHA-256: `aa144a00338e8eea293b4832ac7383d9159eef549f0f7a246dce68898b606dc8`.

The retained local validation receipts under `target/validation-runs/` include:

- `parity-gitlab-clone-final-rust`: 911 passed, 45 optional cases ignored by the
  default suite. Separate selected LFS (41), signing (3) and actual OpenSSH (1)
  runs passed all 45. The SSH run uses the extracted application's askpass helper
  and tests trust, passphrase rejection, cancellation, fetch and push.
- `parity-gitlab-clone-final-check`: generated-contract freshness, TypeScript,
  Angular development/AOT, all-target Rust checking and Clippy with warnings denied.
- `parity-gitlab-clone-final-frontend-unit`: 178 cases across 27 files.
- `parity-gitlab-clone-final-acceptance.json`: the complete 1,473-case renderer
  collection passed in four disjoint partitions (369/368/368/368), one worker,
  one attempt, no retries, failures, skipped or flaky cases. All previous 1,457
  identities remain covered; the 16 additions test the clone workflow.
- The same package passed 216 normal and 217 inherited-environment native scenarios,
  and 30 GitLab scenarios (463 executions, 237 distinct scenarios). GitLab tests
  exercise actual verified HTTPS API and Git transfers, independent synthetic
  credentials, native-held plan forgery/context/replay refusal, stale account/URL/
  destination refusal, API cancellation, ordinary desktop cloning and restart.
  A normal desktop SSH clone uses a loopback OpenSSH server, disposable keys and
  pinned host trust; it verifies the exact reviewed URL, literal branch, shallow
  depth and working bytes, with one read-only upload and no HTTPS Git request.
  A real HTTPS PACK prefix is sent before holding the response: disconnecting the API
  leaves Git running, explicit Git cancellation stops it and replay is refused.
- Eight additional native views at 1440×900 and 780×560 were visually reviewed,
  along with the ordinary desktop review and completed-clone views. Controls remain
  legible with normal vertical scrolling and no horizontal overflow.

The unchanged 1,400,000-byte hard initial cap passes at 1,389,397 bytes (JS plus
CSS). The 39,510-byte GitLab lazy chunk remains outside the initial graph. Existing
soft size warnings remain. Package dependency and ELF checks verify OpenSSL 3;
Linux normal/build notices conservatively cover 468 packages and are not a claim
of an exact linked-artifact SBOM.

## Acceptance corrections and source association

The initial package (`d2ef9d7d27e4`) passed 27 functional scenarios but its native
screenshots revealed inherited styling that enlarged checkboxes. Those views were
rejected. Scoped checkbox geometry, browser/native assertions and a rebuilt
package produced the corrected artifact above; the earlier receipts are retained.

Published dev CI run `41348894370` separately exposed a partly clipped recovery
button that older WebKit did not scroll into view before clicking. The harness
now performs a normal centered scroll, waits for painted geometry and verifies
the center hit target before one real WebDriver click. It does not inject a DOM
click or retry an uncertain action. All 51 harness tests and 13 native recovery
scenarios pass against the exact failed CI package (`47623c28f855`); all five
recovery actions have verified hit targets. This local correction does not change
that original remote CI failure into a pass.

The original 32-path source manifest and artifact receipts are retained. Subsequent
changes are acceptance harness, fixture, workflow-prerequisite and documentation
changes; application Rust, renderer, contracts and dependencies remain identical
to the corrected package inputs. The final source association manifest verifies
this. `parity-gitlab-clone-native-real-ssh-ready` passes all 30 scenarios and
`parity-gitlab-clone-integrated-harness` passes 56 harness tests. The prior added
SSH attempt stopped before Git because the harness selected an account before its
option was populated. Waiting for the exact option fixes test readiness; its
failed receipt remains. No action is retried within an application session.
`parity-native-recovery-scroll-final-full` and `-environment` pass the unchanged
216/217 case sets with all five recovery actions verified after ordinary scrolling.
New-head remote CI remains a separate integration gate.

## Remaining scope

No live GitLab account or cross-platform acceptance is claimed. Self-managed
subfolder instances, durable login/OAuth, GitLab forks, reviewed remote attachment,
merge requests/issues and other providers remain open. Path validation does not
retain filesystem identity against a concurrent directory replacement; stronger
claims require dedicated ownership tests. This checkpoint does not establish full
Git feature parity.
