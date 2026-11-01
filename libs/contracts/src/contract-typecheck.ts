import { ipc, invokeCommand, type GitAuthenticationPrompt, type BranchWorkflowSettings, type HostedForkRemotePlan } from './index';

// Compiled, never executed. Widened bindings make expect-error directives fail.
function typeAssertions(prompt: GitAuthenticationPrompt, settings: BranchWorkflowSettings): void {
  void ipc.parse_repository_link({ rawLink: 'git-khronos://repository?v=1&remote=https%3A%2F%2Fexample.test%2Fowned.git' });
  void ipc.create_repository_link({ remote: 'git@example.test:owned/project.git', target: { kind: 'reference', reference: 'refs/heads/main' } });
  void ipc.discover_repository_link({ rawLink: 'owned-link', knownPaths: ['/owned/repository'], operationId: 'owned-discovery' });
  void ipc.open_repository_link({ rawLink: 'owned-link', path: '/owned/repository', expectedOid: 'a'.repeat(40), operationId: 'owned-open' });
  void ipc.repository_link_read_policies();
  void ipc.resume_repository_link_auto_fetch({ repoId: 'owned-repository' });
  // @ts-expect-error known locations are explicit and lookup has a cancellable operation
  void ipc.discover_repository_link({ rawLink: 'owned-link', root: '/scan-everything' });
  // @ts-expect-error link creation has no checkout or mutation request
  void ipc.create_repository_link({ remote: 'owned', target: { kind: 'commit', oid: 'a'.repeat(40) }, checkout: true });
  // @ts-expect-error repository targets do not contain an ambiguous object selector
  void ipc.create_repository_link({ remote: 'owned', target: { kind: 'repository', oid: 'a'.repeat(40) } });
  // @ts-expect-error exact IPC camelCase arguments are required
  void ipc.open_repository_link({ raw_link: 'owned-link', path: '/owned/repository', operation_id: 'owned-open' });

  const privateAttachmentFieldsAbsent: Extract<keyof HostedForkRemotePlan, 'snapshot' | 'request' | 'created'> extends never ? true : never = true;
  void privateAttachmentFieldsAbsent;
  void ipc.inspect_file_media({ repoId: 'owned-repository', operationId: 'owned-media', request: {
    context: { kind: 'revisions', baseOid: 'a'.repeat(40), targetOid: 'b'.repeat(40) }, path: 'image', previousPath: null,
  } });
  void ipc.inspect_file_media({ repoId: 'owned-repository', operationId: 'owned-stash-media', request: {
    context: { kind: 'stash', oid: 'a'.repeat(40), layer: 'untracked' }, path: 'image', previousPath: null,
  } });
  // @ts-expect-error media selection requires a registered repository session
  void ipc.inspect_file_media({ operationId: 'owned-media', request: { context: { kind: 'commit', oid: 'a'.repeat(40) }, path: 'image', previousPath: null } });
  // @ts-expect-error comparison fields follow native camelCase and do not accept Git expressions as an alternate field
  void ipc.inspect_file_media({ repoId: 'owned-repository', operationId: 'owned-media', request: { context: { kind: 'commit', revision: 'HEAD~1' }, path: 'image', previousPath: null } });
  // @ts-expect-error a comparison has no arbitrary filesystem root
  void ipc.inspect_file_media({ repoId: 'owned-repository', operationId: 'owned-media', request: { context: { kind: 'workingTree', staged: false }, path: 'image', previousPath: null }, root: '/outside' });
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
  void ipc.execute_hosted_fork({ contextId: 'owned-dialog', token: 'owned-token', operationId: 'owned-fork' });
  void ipc.prepare_hosted_fork_remote({ repoId: 'owned-repository', contextId: 'owned-dialog', operationId: 'owned-preview', request: { sourceRemote: 'origin', remoteName: 'fork', transport: 'https', selection: { sourceFullName: 'team/source', sourceRepositoryId: '101', accountId: '7', forkFullName: 'owned/fork', forkRepositoryId: '9007199254740993', forkOwnerId: '7' } } });
  void ipc.execute_hosted_fork_remote({ repoId: 'owned-repository', contextId: 'owned-dialog', token: 'owned-token', operationId: 'owned-attachment' });
  void ipc.discard_hosted_fork_remote({ repoId: 'owned-repository', contextId: 'owned-dialog', token: 'owned-token' });
  // @ts-expect-error attachment execution cannot accept a client-authored plan
  void ipc.execute_hosted_fork_remote({ repoId: 'owned-repository', contextId: 'owned-dialog', plan: {}, operationId: 'owned-attachment' });
  // @ts-expect-error attachment execution must identify its original repository session
  void ipc.execute_hosted_fork_remote({ contextId: 'owned-dialog', token: 'owned-token', operationId: 'owned-attachment' });
  // @ts-expect-error clients cannot choose a configuration path
  void ipc.execute_hosted_fork_remote({ repoId: 'owned-repository', contextId: 'owned-dialog', token: 'owned-token', operationId: 'owned-attachment', configurationPath: '/elsewhere/config' });
  // @ts-expect-error discard cannot address another dialog's review without its context
  void ipc.discard_hosted_fork_remote({ repoId: 'owned-repository', token: 'owned-token' });
  void ipc.execute_hosted_fork_acknowledgement({ contextId: 'owned-dialog', token: 'owned-token', operationId: 'owned-acknowledgement' });
  // @ts-expect-error fork execution cannot accept a client-authored plan
  void ipc.execute_hosted_fork({ contextId: 'owned-dialog', plan: {}, operationId: 'owned-fork' });
  // @ts-expect-error a fork review is bound to its original dialog context
  void ipc.execute_hosted_fork({ token: 'owned-token', operationId: 'owned-fork' });
  // @ts-expect-error acknowledgement uses a server-held snapshot, not a client replacement
  void ipc.execute_hosted_fork_acknowledgement({ contextId: 'owned-dialog', status: {}, operationId: 'owned-acknowledgement' });
  // @ts-expect-error clients cannot choose the request storage directory
  void ipc.list_hosted_fork_requests({ operationId: 'owned-read', directory: '/elsewhere' });
  // @ts-expect-error fork IDs must preserve decimal precision across JavaScript
  void ipc.inspect_hosted_fork({ operationId: 'owned-inspect', selection: { sourceFullName: 'team/source', sourceRepositoryId: '101', accountId: '7', forkFullName: 'owned/forked', forkRepositoryId: 9007199254740993, forkOwnerId: '7' } });
  void ipc.execute_hosted_clone({ contextId: 'owned-dialog', token: 'owned-token', operationId: 'owned-clone' });
  // @ts-expect-error execution cannot accept a client-replaced URL or plan
  void ipc.execute_hosted_clone({ contextId: 'owned-dialog', plan: { url: 'https://elsewhere.test/owned.git' }, operationId: 'owned-clone' });
  // @ts-expect-error a clone execution must remain bound to its review context
  void ipc.execute_hosted_clone({ token: 'owned-token', operationId: 'owned-clone' });
  // @ts-expect-error repository IDs must not cross the JavaScript precision boundary as numbers
  void ipc.inspect_hosted_repository({ fullName: 'team/owned', repositoryId: 9007199254740993, accountId: '7', operationId: 'owned-inspection' });
  void ipc.inspect_gitlab_project({ request: { connectionId: 'owned-connection', projectId: '9007199254740993', operationId: 'owned-inspection' } });
  void ipc.execute_gitlab_clone({ request: { contextId: 'owned-context', token: 'owned-token', operationId: 'owned-clone' } });
  void ipc.discard_gitlab_clone_plan({ contextId: 'owned-context', token: 'owned-token' });
  // @ts-expect-error stable GitLab IDs must retain decimal precision across JavaScript
  void ipc.inspect_gitlab_project({ request: { connectionId: 'owned-connection', projectId: 9007199254740993, operationId: 'owned-inspection' } });
  // @ts-expect-error execution accepts only a native-held review token, not a replacement plan
  void ipc.execute_gitlab_clone({ request: { contextId: 'owned-context', token: 'owned-token', operationId: 'owned-clone', plan: { url: 'https://other.test/project.git' } } });
  // @ts-expect-error execution must remain bound to its original review context
  void ipc.execute_gitlab_clone({ request: { token: 'owned-token', operationId: 'owned-clone' } });
  // @ts-expect-error a renderer cannot replace the instance bound to a native connection
  void ipc.inspect_gitlab_project({ request: { connectionId: 'owned-connection', projectId: '1', operationId: 'owned-inspection', origin: 'https://other.test' } });
  // @ts-expect-error discarding a clone review must identify its owned context
  void ipc.discard_gitlab_clone_plan({ token: 'owned-token' });
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
