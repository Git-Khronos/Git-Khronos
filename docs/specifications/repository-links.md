# Repository and Git object links

Status: neutral specification; implementation and runtime acceptance pending.
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

Proposed Khronos-owned format:

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

Remote identity is a parsed network URL, never a shell command or filesystem
path. Initial supported transports are HTTPS and SSH. Reject passwords, HTTPS
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
