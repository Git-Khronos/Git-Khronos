import { ipc, invokeCommand, type GitAuthenticationPrompt, type BranchWorkflowSettings } from './index';

// Compiled, never executed. Widened bindings make expect-error directives fail.
function typeAssertions(prompt: GitAuthenticationPrompt, settings: BranchWorkflowSettings): void {
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
  void ipc.prepare_branch_workflow({ repoId: 'fixture', operationId: 'owned-preview',
    request: { action: 'setup', settings, initialOid: 'a'.repeat(40) } });
  void ipc.prepare_branch_workflow({ repoId: 'fixture', operationId: 'owned-preview',
    request: { action: 'start', kind: 'feature', suffix: 'owned-topic' } });
  void ipc.execute_branch_workflow({ repoId: 'fixture', operationId: 'owned-execute', token: 'owned-token' });
  void ipc.control_branch_workflow_finish({ repoId: 'fixture', operationId: 'owned-continue',
    id: 'owned-finish', revision: 1, control: { action: 'continue', retry: false } });
  // @ts-expect-error execution accepts only the server's one-use preview token
  void ipc.execute_branch_workflow({ repoId: 'fixture', operationId: 'owned-execute', plan: {} });
  // @ts-expect-error the setup commit field must match the native camelCase schema
  void ipc.prepare_branch_workflow({ repoId: 'fixture', operationId: 'owned-preview', request: { action: 'setup', settings, initial_oid: 'a'.repeat(40) } });
  // @ts-expect-error a continuation must identify the saved action revision
  void ipc.control_branch_workflow_finish({ repoId: 'fixture', operationId: 'owned-continue', id: 'owned-finish', control: { action: 'continue', retry: false } });
  // @ts-expect-error only Continue can request a retry
  void ipc.control_branch_workflow_finish({ repoId: 'fixture', operationId: 'owned-abort', id: 'owned-finish', revision: 1, control: { action: 'abort', retry: true } });
  void ipc.execute_hosted_clone({ contextId: 'owned-dialog', token: 'owned-token', operationId: 'owned-clone' });
  // @ts-expect-error execution cannot accept a client-replaced URL or plan
  void ipc.execute_hosted_clone({ contextId: 'owned-dialog', plan: { url: 'https://elsewhere.test/owned.git' }, operationId: 'owned-clone' });
  // @ts-expect-error a clone execution must remain bound to its review context
  void ipc.execute_hosted_clone({ token: 'owned-token', operationId: 'owned-clone' });
  // @ts-expect-error repository IDs must not cross the JavaScript precision boundary as numbers
  void ipc.inspect_hosted_repository({ fullName: 'team/owned', repositoryId: 9007199254740993, accountId: '7', operationId: 'owned-inspection' });
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
