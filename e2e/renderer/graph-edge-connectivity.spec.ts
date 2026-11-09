import { expect, test, type Page } from '@playwright/test';

type Topology = Array<[string, string[]]>;

// Deterministic generator for histories with interleaved branches and merges.
function randomTopology(seed: number, size: number): Topology {
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const commits: Topology = [];
  for (let index = size - 1; index >= 0; index--) {
    const older = commits.map(([oid]) => oid);
    const parents: string[] = [];
    if (older.length) {
      parents.push(older[Math.max(0, older.length - 1 - Math.floor(random() * Math.min(4, older.length)))]);
      if (older.length > 2 && random() < 0.3) {
        const merged = older[Math.floor(random() * older.length)];
        if (!parents.includes(merged)) parents.push(merged);
      }
    }
    commits.push([`c${index}`, parents]);
  }
  return commits.reverse();
}

async function connectivityProblems(page: Page, topology: Topology, compact: boolean, width: number) {
  return page.evaluate(({ topology, compact, width }) => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const repo = app.git.repository();
    const template = repo.commits[0];
    const commits = topology.map(([oid, parents]) => ({ ...template, oid, parents, subject: oid, decorations: [] }));
    app.hiddenBranches.set([]);
    app.soloBranches.set([]);
    app.smartBranchVisibility.set(false);
    app.pinnedBranch.set(null);
    app.git.repositories.update((items: any[]) => items.map(item => item.id === repo.id ? {
      ...item, commits, worktrees: [], stashes: [], branches: [],
    } : item));
    app.setCompactGraphColumn(compact);
    app.graphColumnWidth.set(width);
    const radius = compact ? 10 : 12;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.append(probe);
    document.body.append(svg);
    const problems: string[] = [];
    const rows = app.graphRows();
    const ends = rows.map((row: any) => {
      const top: number[] = [], bottom: number[] = [];
      for (const segment of row.segments) {
        probe.setAttribute('d', app.graphSegmentPath(segment));
        const length = probe.getTotalLength();
        for (const point of [probe.getPointAtLength(0), probe.getPointAtLength(length)]) {
          if (Math.abs(point.y) < 0.01) top.push(point.x);
          else if (Math.abs(point.y - 40) < 0.01) bottom.push(point.x);
          else if (Math.hypot(point.x - row.nodeOffset, point.y - 20) > radius + 1) {
            problems.push(`${row.commit.oid}: ${app.graphSegmentPath(segment)} ends at ${point.x.toFixed(1)},${point.y.toFixed(1)} away from its avatar`);
          }
        }
      }
      return { oid: row.commit.oid, top: [...new Set(top.map(x => x.toFixed(2)))].sort(), bottom: [...new Set(bottom.map(x => x.toFixed(2)))].sort() };
    });
    svg.remove();
    for (let index = 1; index < ends.length; index++) {
      const above = ends[index - 1].bottom.join(',');
      const below = ends[index].top.join(',');
      if (above !== below) problems.push(`${ends[index - 1].oid} -> ${ends[index].oid}: lanes [${above}] continue as [${below}]`);
    }
    return problems;
  }, { topology, compact, width });
}

for (const compact of [false, true]) {
  test(`connects every graph edge to an avatar or an adjacent row (${compact ? 'compact' : 'expanded'})`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.author-node').first()).toBeVisible();
    const problems: string[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      for (const width of [compact ? 92 : 112, 640]) {
        const found = await connectivityProblems(page, randomTopology(seed, 40), compact, width);
        problems.push(...found.slice(0, 3).map(problem => `seed ${seed}, width ${width}: ${problem}`));
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
  });
}
