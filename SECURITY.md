# Security policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this
repository. Do not open a public issue containing exploit details, credentials,
or private repository information.

Include the affected version, operating system, reproduction steps, expected
impact, and whether the issue requires opening an untrusted repository.

## Security boundaries

Git Chronos invokes Git directly with argument arrays and does not construct
shell commands. After opening a repository, frontend operations use an opaque
session identifier rather than supplying a working directory. Tauri capability
files restrict native access to the application window.

Git itself may execute configured hooks, credential helpers, signing tools,
filters, and SSH programs. Treat repositories and Git configuration from
untrusted sources cautiously until the planned repository trust controls are
complete.

No telemetry or remote diagnostics are collected. Before sharing logs, review
them for repository names, paths, remote hosts, and other sensitive context.
