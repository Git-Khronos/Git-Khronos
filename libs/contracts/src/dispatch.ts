import type { CommandMap, RepositorySnapshot, RepositoryStatus } from './native';
import { safeInvoke } from './safe-json';

export type CommandName = keyof CommandMap;
export type CommandArgs<K extends CommandName> = NonNullable<Parameters<CommandMap[K]>[0]>;
export type CommandResult<K extends CommandName> = Awaited<ReturnType<CommandMap[K]>>;
export type CommandsReturning<T> = {
  [K in CommandName]: CommandResult<K> extends T
    ? 'repoId' extends keyof CommandArgs<K> ? K : never : never
}[CommandName];
export type SnapshotCommand = CommandsReturning<RepositorySnapshot>;
export type StatusCommand = CommandsReturning<RepositoryStatus>;
export type MutationExtra<K extends CommandName> = Omit<CommandArgs<K>, 'repoId' | 'operationId'>;
export type MutationOptions<K extends CommandName> = {} extends MutationExtra<K>
  ? [extra?: MutationExtra<K>, preserveConflictOnFailure?: boolean]
  : [extra: MutationExtra<K>, preserveConflictOnFailure?: boolean];

/** Dynamic operation helpers retain the same generated argument/result contract. */
export function invokeCommand<K extends CommandName>(command: K, args: CommandArgs<K>): Promise<CommandResult<K>> {
  return safeInvoke<CommandResult<K>>(command, args);
}
