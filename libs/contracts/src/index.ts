// Wire types, commands and events are generated from the native registry.
export * from './native';
export * as ipc from './native';
export * from './dispatch';
export { assertSafeIntegers, checked } from './safe-json';
import type { CommitComparison as NativeCommitComparison } from './native';
/** Renderer-only comparison presentation state, not a native payload field. */
export type CommitComparison = NativeCommitComparison & { comparisonMode?: 'direct' | 'mergeBase' };
export type { PreparedDiscard as DiscardPreview, DiscardRecoveryInfo as DiscardRecovery, PreparedReset as ResetPreview } from './native';

// UI choices narrower than the native command string arguments.
export type ResetMode = 'soft' | 'mixed' | 'hard';
export type CommitSignatureStatus = 'valid' | 'valid-unknown' | 'invalid' | 'expired-signature' | 'expired-key' | 'revoked-key' | 'unverifiable' | 'unsigned';
