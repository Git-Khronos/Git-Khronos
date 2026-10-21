import { describe, expect, it } from 'vitest';
import type { SubmoduleState } from '@git-chronos/contracts';
import { submoduleFindings } from './submodule-findings';

const a = 'a'.repeat(40);
const b = 'b'.repeat(40);
const state = (overrides: Partial<SubmoduleState> = {}): SubmoduleState => ({
  path: 'lib', name: 'lib', declaredUrl: '/lib', trackingBranch: null, registeredUrl: '/lib', urlMatches: true,
  headOid: a, indexOid: a, checkoutOid: a, conflict: null, checkedOut: true, commitChanged: false,
  trackedChanges: false, untrackedChanges: false, stagedChange: false, undeclared: false, missingGitlink: false,
  ...overrides,
});
const labels = (entry: SubmoduleState) => submoduleFindings(entry).map(finding => finding.label);

describe('submodule findings', () => {
  it('reports a clean submodule without attention', () => {
    const findings = submoduleFindings(state());
    expect(findings).toEqual([expect.objectContaining({ label: 'Matches the recorded commit', attention: false })]);
  });

  it('explains moved, staged, dirty and URL states with exact commits', () => {
    const findings = submoduleFindings(state({ commitChanged: true, checkoutOid: b, stagedChange: true, indexOid: b,
      trackedChanges: true, untrackedChanges: true, urlMatches: false, registeredUrl: '/elsewhere' }));
    expect(findings.map(finding => finding.label)).toEqual(['Different commit checked out', 'Submodule commit change staged',
      'Uncommitted changes inside', 'Untracked files inside', 'Local URL differs from .gitmodules']);
    expect(findings[0].detail).toContain(b.slice(0, 10));
    expect(findings[1].detail).toContain(`HEAD ${a.slice(0, 10)}`);
    expect(findings[4].detail).toContain('/elsewhere');
  });

  it('distinguishes uninitialized, unchecked-out, undeclared, missing and conflicted paths', () => {
    expect(labels(state({ checkedOut: false, registeredUrl: null, urlMatches: null }))).toEqual(['Not initialized']);
    expect(labels(state({ checkedOut: false }))).toEqual(['Initialized, not checked out']);
    expect(labels(state({ name: null, declaredUrl: null, registeredUrl: null, urlMatches: null, undeclared: true, checkedOut: false })))
      .toEqual(['Not declared in .gitmodules', 'Not initialized']);
    expect(labels(state({ missingGitlink: true, checkedOut: false, headOid: null, indexOid: null }))).toEqual(['Declared without a recorded commit']);
    const conflict = submoduleFindings(state({ indexOid: null, headOid: null, conflict: { base: a, ours: b, theirs: null, mixedTypes: true } }));
    expect(conflict.map(finding => finding.label)).toEqual(['Submodule commit conflict', 'File and submodule conflict']);
    expect(conflict[0].detail).toContain('theirs none');
  });

  it('does not claim a mismatch for relative declared URLs', () => {
    const findings = submoduleFindings(state({ declaredUrl: '../lib', urlMatches: null }));
    expect(findings.map(finding => finding.label)).toEqual(['Matches the recorded commit', 'Relative declared URL']);
  });
});
