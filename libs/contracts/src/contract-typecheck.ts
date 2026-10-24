import { ipc, invokeCommand, type GitAuthenticationPrompt } from './index';

// Compiled, never executed. Widened bindings make expect-error directives fail.
function typeAssertions(prompt: GitAuthenticationPrompt): void {
  void ipc.open_repository({ path: '/owned/fixture' });
  void ipc.inspect_stash({ repoId: 'fixture', oid: 'a'.repeat(40) });
  void ipc.inspect_stash_file({ repoId: 'fixture', oid: 'a'.repeat(40), path: 'fixture.txt' });
  // @ts-expect-error stash previews must use the selected immutable object
  void ipc.inspect_stash({ repoId: 'fixture', reference: 'stash@{0}' });
  // @ts-expect-error later file inspection must not resolve a moved selector
  void ipc.inspect_stash_file({ repoId: 'fixture', reference: 'stash@{0}', path: 'fixture.txt' });
  void ipc.drop_stash({ repoId: 'fixture', reference: 'stash@{0}', expectedOid: 'a'.repeat(40) });
  void ipc.apply_stash({ repoId: 'fixture', reference: 'stash@{0}', expectedOid: 'a'.repeat(40) });
  void ipc.pop_stash_entry({ repoId: 'fixture', reference: 'stash@{0}', expectedOid: 'a'.repeat(40) });
  void ipc.pop_stash({ repoId: 'fixture', expectedOid: 'a'.repeat(40) });
  // @ts-expect-error apply must identify the displayed stash object
  void ipc.apply_stash({ repoId: 'fixture', reference: 'stash@{0}' });
  // @ts-expect-error pop must identify the displayed stash object
  void ipc.pop_stash_entry({ repoId: 'fixture', reference: 'stash@{0}' });
  // @ts-expect-error latest-pop must identify the displayed stash object
  void ipc.pop_stash({ repoId: 'fixture' });
  // @ts-expect-error deletion must identify the selected object, not only its mutable ordinal
  void ipc.drop_stash({ repoId: 'fixture', reference: 'stash@{0}' });
  void invokeCommand('refresh_repository', { repoId: 'fixture' });
  const id: string = prompt.requestId;
  void id;
  // @ts-expect-error native command names are exhaustive
  void invokeCommand('missing_command', {});
  // @ts-expect-error required path cannot be omitted
  void ipc.open_repository({});
  // @ts-expect-error unknown argument must not be silently accepted
  void ipc.refresh_repository({ repositoryId: 'fixture' });
  // @ts-expect-error nested request payloads are generated too
  void ipc.import_git_bundle({ repoId: 'fixture', request: { file: 123 } });
  // @ts-expect-error results cannot be chosen by the caller
  const wrong: Promise<string> = ipc.system_info();
  void wrong;
}
void typeAssertions;
