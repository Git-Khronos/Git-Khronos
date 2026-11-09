import type { RebaseStepView } from './interactive-rebase-editor.component';

export type AutosquashResult =
  | { steps: RebaseStepView[]; matched: number; error: null }
  | { steps: null; matched: 0; error: string };

export function previewAutosquash(steps: readonly RebaseStepView[]): AutosquashResult {
  const refuse = (error: string): AutosquashResult => ({ steps: null, matched: 0, error });
  if (new Set(steps.map(step => step.oid)).size !== steps.length) {
    return refuse('The plan contains duplicate commit IDs. Close and prepare a fresh plan.');
  }
  if (steps.some(step => step.action !== 'pick')) {
    return refuse('Autosquash needs an unedited Pick plan. Reset first, or keep your manual actions.');
  }
  const groups = new Map<string, RebaseStepView[]>();
  const roots = new Map<string, string>();
  const ordered: RebaseStepView[] = [];
  let matched = 0;
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const marker = /^(fixup|squash)! (.+)$/.exec(step.subject);
    if (!marker) {
      if (/^(fixup|squash|amend)!/.test(step.subject)) {
        return refuse(`Unsupported autosquash marker in "${step.subject}". Set its action manually.`);
      }
      ordered.push(step);
      groups.set(step.oid, []);
      roots.set(step.oid, step.oid);
      continue;
    }
    const target = marker[2];
    const preceding = steps.slice(0, index);
    const exact = preceding.filter(candidate => candidate.subject === target || candidate.oid === target);
    const candidates = exact.length ? exact : /^[0-9a-f]{4,64}$/i.test(target)
      ? preceding.filter(candidate => candidate.oid.toLowerCase().startsWith(target.toLowerCase())) : [];
    if (candidates.length !== 1) {
      return refuse(`${candidates.length ? 'Ambiguous' : 'Unmatched'} autosquash target "${target}". Use an exact unique subject or commit ID from an earlier row.`);
    }
    const root = roots.get(candidates[0].oid);
    const group = root ? groups.get(root) : undefined;
    if (!root || !group) return refuse(`Unsupported autosquash target "${target}". Set its action manually.`);
    roots.set(step.oid, root);
    group.push({ ...step, action: marker[1] === 'fixup' ? 'fixup' : 'squash' });
    matched++;
  }
  if (!matched) return refuse('No fixup! or squash! commits matched. The plan is unchanged.');
  return { steps: ordered.flatMap(step => [step, ...(groups.get(step.oid) ?? [])]), matched, error: null };
}
