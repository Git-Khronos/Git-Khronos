import { describe, expect, it } from 'vitest';
import { GIT_DOCUMENTATION_TOPICS, GIT_RELATED_MANUALS } from './git-documentation-topics';

describe('Git feature documentation', () => {
  it('distinguishes bundle prerequisites and recovery-only imports from authenticity and working contents', () => {
    const topic = GIT_DOCUMENTATION_TOPICS.find(topic => topic.id === 'bundle');
    expect(topic?.manual).toBe('https://git-scm.com/docs/git-bundle');
    expect(topic?.hint).toContain('prerequisite commits');
    expect(topic?.hint).toContain('new recovery reference');
    expect(topic?.caution).toContain('not authenticity or signatures');
    expect(topic?.caution).toContain('16 MiB and 500 references');
    expect(topic?.caution).toContain('may leave objects downloaded');
    expect(GIT_RELATED_MANUALS.bundle?.[0].command).toBe('git fetch');
  });
  it('explains mail-patch authorship, recovery and stop controls', () => {
    const topic = GIT_DOCUMENTATION_TOPICS.find(topic => topic.id === 'mail-patch');
    expect(topic?.manual).toBe('https://git-scm.com/docs/git-format-patch');
    expect(topic?.hint).toContain('recorded as committer');
    expect(topic?.hint).toContain('protected recovery reference');
    expect(topic?.caution).toContain('signatures and notes are not carried');
    expect(topic?.caution).toContain('Abort to restore the original tip');
    expect(GIT_RELATED_MANUALS['mail-patch']?.[0].command).toBe('git am');
  });
  it('distinguishes exact patch targets from commit exchange and partial recovery', () => {
    const topic = GIT_DOCUMENTATION_TOPICS.find(topic => topic.id === 'patch');
    expect(topic?.commands).toContain('--check');
    expect(topic?.hint).toContain('--cached changes only the index');
    expect(topic?.hint).toContain('--index changes both');
    expect(topic?.caution).toContain('reverse of the staged patch');
    expect(topic?.caution).toContain('Exact file bytes');
    expect(topic?.caution).toContain('never overwrites');
    expect(topic?.caution).toContain('do not carry commit authors');
    expect(GIT_RELATED_MANUALS.patch?.[0].command).toBe('git diff');
  });
  it('provides unique searchable topics with original hints, precautions and official HTTPS manuals', () => {
    expect(new Set(GIT_DOCUMENTATION_TOPICS.map(topic => topic.id)).size).toBe(GIT_DOCUMENTATION_TOPICS.length);
    expect(GIT_DOCUMENTATION_TOPICS.length).toBe(39);
    for (const topic of GIT_DOCUMENTATION_TOPICS) {
      expect(topic.title.length).toBeGreaterThan(10);
      expect(topic.commands.length).toBeGreaterThan(5);
      expect(topic.hint.length).toBeGreaterThan(40);
      expect(topic.caution.length).toBeGreaterThan(40);
      const url = new URL(topic.manual);
      expect(url.protocol).toBe('https:');
      expect(url.username).toBe('');
      expect(url.password).toBe('');
      expect(url.search).toBe('');
      if (topic.id.startsWith('lfs')) {
        expect(url.hostname).toBe('github.com');
        expect(url.pathname).toMatch(/^\/git-lfs\/git-lfs\/blob\/main\/docs\/man\/git-lfs-[a-z-]+\.adoc$/);
      } else {
        expect(url.hostname).toBe('git-scm.com');
        expect(url.pathname).toMatch(/^\/docs\/git[a-z-]+$/);
      }
    }
  });

  it('distinguishes fetch/tag scope, independent hydration and unfinished safe pruning', () => {
    const topic = (id: string) => GIT_DOCUMENTATION_TOPICS.find(topic => topic.id === id);
    expect(topic('fetch')?.hint).toContain('leaves tags unchanged');
    expect(topic('lfs-checkout')?.hint).toContain('independently copies');
    expect(topic('lfs-prune')?.caution).toContain('No exact preview');
    expect(topic('worktree')?.caution).toContain('dry-run only');
    expect(topic('rebase')?.caution).toContain('not implied');
  });

  it('includes command-specific manuals for grouped workflows without arbitrary destinations', () => {
    for (const [id, manuals] of Object.entries(GIT_RELATED_MANUALS)) {
      expect(GIT_DOCUMENTATION_TOPICS.some(topic => topic.id === id)).toBe(true);
      for (const manual of manuals) {
        const url = new URL(manual.url);
        expect(url.protocol).toBe('https:');
        expect(url.username + url.password + url.search + url.hash).toBe('');
        expect(['git-scm.com', 'github.com']).toContain(url.hostname);
        if (url.hostname === 'github.com') expect(url.pathname).toMatch(/^\/git-lfs\/git-lfs\/blob\/main\/docs\/man\/git-lfs-[a-z-]+\.adoc$/);
        else expect(url.pathname).toMatch(/^\/docs\/git[a-z-]+$/);
      }
    }
    expect(GIT_RELATED_MANUALS.stage?.map(manual => manual.command)).toEqual(['git restore', 'git apply']);
    expect(GIT_RELATED_MANUALS.lfs?.map(manual => manual.command)).toContain('git lfs untrack');
  });

  it('explains effective signer aliases without implying key access or trust repair', () => {
    const topic = GIT_DOCUMENTATION_TOPICS.find(topic => topic.id === 'signing');
    expect(topic?.commands).toContain('gpg.openpgp.program');
    expect(topic?.hint).toContain('last effective assignment');
    expect(topic?.caution).toContain('Missing public keys prevent verification');
    expect(topic?.caution).toContain('unknown trust is distinct from an invalid signature');
    expect(topic?.caution).toContain('never installs trusted keys');
  });

  it('explains explicit pull choices and partial fetch effects without automatic recovery', () => {
    const topic = GIT_DOCUMENTATION_TOPICS.find(topic => topic.id === 'pull');
    expect(topic?.commands).toContain('--no-rebase');
    expect(topic?.commands).toContain('--ff-only');
    expect(topic?.hint).toContain('without saving Git settings');
    expect(topic?.hint).toContain('rebase replays local commits');
    expect(topic?.caution).toContain('still update remote-tracking references');
    expect(topic?.caution).toContain('continue or abort');
    expect(topic?.caution).toContain('not replaced automatically');
  });

  it('distinguishes fixup messages, retained predecessors and recovery limits', () => {
    const topic = GIT_DOCUMENTATION_TOPICS.find(topic => topic.id === 'rebase');
    expect(topic?.hint).toContain('Fixup combines changes but retains the preceding message');
    expect(topic?.hint).toContain('not a dropped row');
    expect(topic?.hint).toContain('recovery reference');
    expect(topic?.caution).toContain('not remote rollback');
    expect(topic?.hint).toContain('autosquash');
    expect(topic?.caution).toContain('not implied');
  });
  it('explains intentional Edit stops and explicit amendments rather than automatic commits', () => {
    const topic = GIT_DOCUMENTATION_TOPICS.find(topic => topic.id === 'rebase');
    expect(topic?.commands).toContain('· edit ·');
    expect(topic?.hint).toContain('Edit pauses after replaying the commit');
    expect(topic?.hint).toContain('Continue unchanged');
    expect(topic?.caution).toContain('refuses uncommitted tracked changes');
    expect(topic?.caution).toContain('guided split');
  });
  it('defines explicit autosquash preview and conservative matching limits', () => {
    const topic = GIT_DOCUMENTATION_TOPICS.find(topic => topic.id === 'rebase');
    expect(topic?.commands).toContain('--autosquash');
    expect(topic?.hint).toContain('without executing Git');
    expect(topic?.caution).toContain('ambiguous/unmatched targets');
    expect(topic?.caution).toContain('existing manual actions');
    expect(topic?.caution).toContain('amend! message replacement are unsupported');
  });
  it('explains full selected-range scope, unchanged refs and uncertain publication', () => {
    const topic = GIT_DOCUMENTATION_TOPICS.find(topic => topic.id === 'rebase');
    expect(topic?.hint).toContain('all later descendants through HEAD');
    expect(topic?.hint).toContain('original parent as the base');
    expect(topic?.hint).toContain('current local branch');
    expect(topic?.hint).toContain('Originally empty commits');
    expect(topic?.caution).toContain('unknown does not mean unpublished');
    expect(topic?.caution).toContain('does not update other local branches');
  });
  it('explains explicit whole-history scope and root limitations', () => {
    const topic = GIT_DOCUMENTATION_TOPICS.find(topic => topic.id === 'rebase');
    expect(topic?.commands).toContain('--root');
    expect(topic?.hint).toContain('includes the actual root and every descendant');
    expect(topic?.hint).toContain('no unchanged parent base');
    expect(topic?.hint).toContain('Retain at least one commit');
    expect(topic?.caution).toContain('refuses shallow or merge-containing history');
    expect(topic?.caution).toContain('Root commits cannot use guided split');
    expect(topic?.caution).toContain('leaves unrelated refs unchanged');
  });
  it('distinguishes replay boundary from immutable explicit destination', () => {
    const topic = GIT_DOCUMENTATION_TOPICS.find(topic => topic.id === 'rebase');
    expect(topic?.commands).toContain('--onto');
    expect(topic?.hint).toContain('captured destination commit, not a moving branch');
    expect(topic?.hint).toContain('boundary selects which changes replay');
    expect(topic?.caution).toContain('destination reference is never moved');
    expect(topic?.caution).toContain('destination inside the reviewed suffix is refused');
    expect(topic?.caution).toContain('newly empty steps require explicit');
  });
  it('discloses recreated merge topology, cousin scope and lost manual resolutions', () => {
    const topic = GIT_DOCUMENTATION_TOPICS.find(topic => topic.id === 'merge-rebase');
    expect(topic?.commands).toContain('--rebase-merges=no-rebase-cousins');
    expect(topic?.hint).toContain('does not flatten or replace');
    expect(topic?.hint).toContain('original branch points');
    expect(topic?.caution).toContain('manual merge resolutions are not automatically preserved');
    expect(topic?.caution).toContain('final contents can differ');
    expect(topic?.caution).toContain('octopus and ambiguous-base');
  });
  it('explains guided split parts, exact-tree completion and safe Abort obstructions', () => {
    const topic = GIT_DOCUMENTATION_TOPICS.find(topic => topic.id === 'split');
    expect(topic?.commands).toContain('git reset --mixed');
    expect(topic?.hint).toContain('at least two separate commits');
    expect(topic?.hint).toContain('exact original combined tree');
    expect(topic?.hint).toContain('across restart');
    expect(topic?.caution).toContain('Do not Amend');
    expect(topic?.caution).toContain('original authors and signatures are not automatically inherited');
    expect(topic?.caution).toContain('untracked files can block Abort');
    expect(topic?.caution).toContain('stage only those files');
  });
  it('explains reviewed mainline differences, preserved ancestry and explicit replay limits', () => {
    for (const id of ['cherry-pick', 'revert']) {
      const topic = GIT_DOCUMENTATION_TOPICS.find(topic => topic.id === id);
      expect(topic?.commands).toContain('--mainline <parent-number>');
      expect(topic?.hint).toContain('1-based mainline parent');
      expect(topic?.hint).toContain('relative to that parent');
      expect(topic?.hint).toContain('recovery reference');
      expect(topic?.caution).toContain('Parent 1 is never selected automatically');
      expect(topic?.caution).toContain('clean working tree');
      expect(topic?.caution).toContain('continue or abort');
    }
    expect(GIT_DOCUMENTATION_TOPICS.find(topic => topic.id === 'cherry-pick')?.caution).toContain('mixed selection');
    expect(GIT_DOCUMENTATION_TOPICS.find(topic => topic.id === 'revert')?.caution).toContain('does not erase its ancestry');
  });
  it('explains staged no-commit replay, durable conflict review and manual identity instead of hidden commits', () => {
    const topic = GIT_DOCUMENTATION_TOPICS.find(topic => topic.id === 'cherry-pick');
    expect(topic?.commands).toContain('--no-commit');
    expect(topic?.hint).toContain('HEAD stays unchanged');
    expect(topic?.hint).toContain('your own message and current identity');
    expect(topic?.hint).toContain('worktree-local journal');
    expect(topic?.caution).toContain('Skip is unavailable');
    expect(topic?.caution).toContain('keeps all current files and conflicts');
    expect(topic?.caution).toContain('never silently repeated');
    expect(topic?.caution).toContain('Empty effects create no commit');
  });
  it('explains ordered inverse commits, sequencer recovery and explicit later hook completion', () => {
    const topic = GIT_DOCUMENTATION_TOPICS.find(topic => topic.id === 'revert');
    expect(topic?.commands).toContain('--no-walk=unsorted');
    expect(topic?.hint).toContain('newest-to-oldest order');
    expect(topic?.hint).toContain('without revision traversal');
    expect(topic?.caution).toContain('review each merge individually');
    expect(topic?.caution).toContain('Abort restores the original sequence tip');
    expect(topic?.caution).toContain('explicitly commit that step before continuing');
    expect(topic?.caution).toContain('No-commit revert remains unsupported');
  });
});
