# Contributing to Git Khronos

Thank you for helping build a Git client that stays free, local-first, and
pleasant to use.

## Before opening a change

1. Discuss large features or architectural changes in an issue first.
2. Keep changes focused and preserve the Rust boundary around filesystem and
   Git process access.
3. Never add telemetry, mandatory accounts, paid feature gates, or shell-based
   Git command construction.
4. Add tests for Git parsing and state-changing behavior.

## Local checks

```bash
pnpm install
pnpm check
pnpm test
```

Changes that affect the packaged application should also run:

```bash
pnpm exec tauri build --no-bundle --config apps/desktop/src-tauri/tauri.conf.json
```

Use conventional, imperative commit subjects and include a Developer
Certificate of Origin sign-off (`git commit -s`). By contributing, you certify
that you have the right to submit the work under GPL-3.0-only.

## Product principles

- Git remains the behavioral source of truth.
- Destructive actions explain scope and recoverability before execution.
- Display paths are never treated as executable arguments without validation.
- The application must remain useful without a network connection.
- Accessibility and keyboard operation are feature requirements.
