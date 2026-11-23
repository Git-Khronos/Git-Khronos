import { describe, expect, it } from 'vitest';
import { previewAutosquash } from './rebase-autosquash';
import type { RebaseStepView } from './interactive-rebase-editor.component';

function rows(...subjects: string[]): RebaseStepView[] {
  return subjects.map((subject, index) => ({
    oid: (index + 1).toString(16).repeat(40), subject, message: `${subject}\n\nOriginal body`,
    authorName: 'Author', authorEmail: 'author@example.test', action: 'pick',
  }));
}

describe('explicit autosquash preview', () => {
  it('moves matched commits after their target in stable order and preserves messages and unrelated rows', () => {
    const input = rows('Target', 'Independent', 'fixup! Target', 'squash! Target', 'Last');
    const original = structuredClone(input);
    const result = previewAutosquash(input);
    expect(result.error).toBeNull();
    expect(result.matched).toBe(2);
    expect(result.steps?.map(step => step.subject)).toEqual(['Target', 'fixup! Target', 'squash! Target', 'Independent', 'Last']);
    expect(result.steps?.map(step => step.action)).toEqual(['pick', 'fixup', 'squash', 'pick', 'pick']);
    expect(result.steps?.find(step => step.subject === 'fixup! Target')?.message).toBe(input[2].message);
    expect(input).toEqual(original);
  });
  it('matches full IDs and unique abbreviations and resolves nested marker targets into one stable group', () => {
    const input = rows('Target', 'Independent', 'fixup! 11111111', 'fixup! fixup! 11111111', `squash! ${'2'.repeat(40)}`);
    const result = previewAutosquash(input);
    expect(result.error).toBeNull();
    expect(result.steps?.map(step => step.oid)).toEqual([input[0].oid, input[2].oid, input[3].oid, input[1].oid, input[4].oid]);
  });
  it('maps amend! to message-replacing fixup and retains its full message', () => {
    const input = rows('Target', 'Independent', 'amend! Target');
    input[2].message = 'amend! Target\n\nReplacement subject\n\nReplacement body';
    const result = previewAutosquash(input);
    expect(result.error).toBeNull();
    expect(result.steps?.map(step => step.oid)).toEqual([input[0].oid, input[2].oid, input[1].oid]);
    expect(result.steps?.map(step => step.action)).toEqual(['pick', 'fixup-reword', 'pick']);
    expect(result.steps?.[1].message).toBe(input[2].message);
  });
  it('matches a unique subject prefix while exact subjects take precedence over broader prefixes', () => {
    const prefix = rows('Add parser with tests', 'Independent', 'fixup! Add parser');
    const result = previewAutosquash(prefix);
    expect(result.error).toBeNull();
    expect(result.steps?.map(step => step.oid)).toEqual([prefix[0].oid, prefix[2].oid, prefix[1].oid]);

    const exactWins = rows('Add parser implementation', 'Add parser', 'fixup! Add parser');
    const exactResult = previewAutosquash(exactWins);
    expect(exactResult.error).toBeNull();
    expect(exactResult.steps?.map(step => step.oid)).toEqual([exactWins[0].oid, exactWins[1].oid, exactWins[2].oid]);
    expect(exactResult.steps?.map(step => step.action)).toEqual(['pick', 'pick', 'fixup']);
  });
  it('refuses ambiguous subjects, ambiguous ID prefixes, unmatched and forward-only targets atomically', () => {
    const ambiguousIds = rows('First', 'Second', 'fixup! abcd');
    ambiguousIds[0].oid = `abcd${'1'.repeat(36)}`;
    ambiguousIds[1].oid = `abcd${'2'.repeat(36)}`;
    for (const input of [
      rows('Same', 'Same', 'fixup! Same'),
      rows('Target alpha', 'Target beta', 'fixup! Target'),
      ambiguousIds, rows('Target', 'fixup! Unknown'),
      rows('fixup! Later', 'Later'),
      rows('Target', 'fixup! Target', 'squash! Unknown'),
    ]) {
      const original = structuredClone(input);
      expect(previewAutosquash(input).steps).toBeNull();
      expect(previewAutosquash(input).error).toMatch(/Ambiguous|Unmatched/);
      expect(input).toEqual(original);
    }
  });
  it('refuses manual actions, malformed markers, empty targets and no markers without losing drafts', () => {
    const manual = rows('Target', 'fixup! Target');
    manual[0] = { ...manual[0], action: 'reword', message: 'My edited draft' };
    for (const input of [manual, rows('Target', 'amend!'), rows('Target', 'fixup!'), rows('Target'), []]) {
      const original = structuredClone(input);
      expect(previewAutosquash(input).steps).toBeNull();
      expect(previewAutosquash(input).error).toBeTruthy();
      expect(input).toEqual(original);
    }
  });
  it('refuses duplicate IDs rather than losing rows during grouping', () => {
    const input = rows('Target', 'Independent', 'fixup! Target');
    input[1].oid = input[0].oid;
    expect(previewAutosquash(input).error).toContain('duplicate commit IDs');
    expect(previewAutosquash(input).steps).toBeNull();
  });
});
