import { expect, test } from '@playwright/test';

for (const compact of [false, true]) {
  test(`keeps continuing lanes vertical when neighboring lanes close and reopen (${compact ? 'compact' : 'expanded'})`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.author-node').first()).toBeVisible();
    await page.evaluate(compact => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const repo = app.git.repository();
      const template = repo.commits[0];
      const topology: Array<[string, string[]]> = [
        ['merge', ['left', 'middle', 'right']],
        ['left', ['middle']],
        ['new-tip', ['new-parent']],
        ['new-parent', []],
        ['middle', ['base']],
        ['right', ['base']],
        ['base', []],
      ];
      const commits = topology.map(([oid, parents]) => ({
        ...template, oid, parents, subject: oid, decorations: [],
      }));
      app.hiddenBranches.set([]);
      app.soloBranches.set([]);
      app.smartBranchVisibility.set(false);
      app.pinnedBranch.set(null);
      app.git.repositories.update((items: any[]) => items.map(item => item.id === repo.id ? {
        ...item, commits: commits.slice(0, 3), worktrees: [], stashes: [], branches: [],
      } : item));
      app.setCompactGraphColumn(compact);
      app.graphColumnWidth.set(240);
      const initialRows = app.graphRows();
      (window as any).__straightLanes = { commits, initialRows };
    }, compact);
    await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const repo = app.git.repository();
      app.git.repositories.update((items: any[]) => items.map(item => item.id === repo.id
        ? { ...item, commits: (window as any).__straightLanes.commits } : item));
    });
    await expect(page.locator('[data-commit-oid="base"]')).toBeVisible();
    const geometry = await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const rows = app.graphRows();
      const initial = (window as any).__straightLanes.initialRows;
      const samples = rows.flatMap((row: any) => {
        const element = document.querySelector(`[data-commit-oid="${row.commit.oid}"]`)!;
        const paths = element.querySelectorAll('.graph-edges path');
        return row.segments.flatMap((segment: any, index: number) => segment.bypassNode ? [{
          oid: row.commit.oid, x1: segment.x1, x2: segment.x2,
          path: paths[index].getAttribute('d'),
        }] : []);
      });
      return {
        samples,
        initialOffsets: initial.map((row: any) => row.nodeOffset),
        appendedOffsets: rows.slice(0, initial.length).map((row: any) => row.nodeOffset),
        offsets: Object.fromEntries(rows.map((row: any) => [row.commit.oid, row.nodeOffset])),
      };
    });
    expect(geometry.samples.length).toBeGreaterThan(0);
    for (const sample of geometry.samples) {
      expect(sample.x2, JSON.stringify(sample)).toBe(sample.x1);
      expect(sample.path, JSON.stringify(sample)).toBe(`M ${sample.x1} 0 V 40`);
    }
    expect(geometry.appendedOffsets).toEqual(geometry.initialOffsets);
    expect(geometry.offsets['new-tip']).toBe(geometry.offsets['left']);
    expect(geometry.offsets['new-parent']).toBe(geometry.offsets['new-tip']);
    expect(geometry.offsets['right']).toBe(compact ? 78 : 96);
  });

  test(`keeps a shared-parent bypass clear while the real parent link leaves the bottom center (${compact ? 'compact' : 'expanded'})`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.author-node').first()).toBeVisible();
    await page.evaluate(compact => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const repo = app.git.repository();
      const template = repo.commits[0];
      // Neutral form of Git-Khronos's dev/recovery/checkpoint/shared-parent graph.
      const topology = [
        ['tip', ['shared']], ['checkpoint', ['shared']],
        ['checkpoint-a', ['main']], ['checkpoint-b', ['main']],
        ['recovery', ['parent']], ['shared', ['parent']],
        ['parent', ['older']], ['older', ['main']], ['main', []],
      ] as const;
      const commits = topology.map(([oid, parents]) => ({ ...template, oid, parents: [...parents],
        subject: oid, decorations: [] }));
      app.hiddenBranches.set([]);
      app.soloBranches.set([]);
      app.smartBranchVisibility.set(false);
      app.pinnedBranch.set(null);
      app.git.repositories.update((items: any[]) => items.map(item => item.id === repo.id ? {
        ...item, commits, worktrees: [], stashes: [], branches: [],
      } : item));
      app.setCompactGraphColumn(compact);
      app.graphColumnWidth.set(240);
    }, compact);
    const row = page.locator('[data-commit-oid="shared"]');
    await expect(row).toBeVisible();
    const nonOrthogonalPaths = await page.locator('.graph-edges path').evaluateAll(paths =>
      paths.map(path => path.getAttribute('d') ?? '')
        .filter(path => /[CQLST]/i.test(path) || !/^M [-\d.]+ [-\d.]+(?: [HVA] [-\d. ]+)+$/.test(path)));
    expect(nonOrthogonalPaths).toEqual([]);
    const routing = await page.evaluate(() => ({
      rounded: [...document.querySelectorAll('.graph-edges path')]
        .filter(path => (path.getAttribute('d') ?? '').includes(' A ')).length,
      lanes: [...new Set([...document.querySelectorAll<HTMLElement>('.author-node')]
        .map(node => Number(node.dataset['laneOffset'])))].sort((a, b) => a - b),
    }));
    expect(routing.rounded).toBeGreaterThan(0);
    expect(routing.lanes.length).toBeGreaterThan(1);
    for (let index = 1; index < routing.lanes.length; index++) {
      expect(routing.lanes[index] - routing.lanes[index - 1]).toBe(compact ? 32 : 40);
    }
    const geometry = await row.evaluate(element => {
      const avatar = element.querySelector('.author-node')!;
      const node = avatar.getBoundingClientRect();
      const offset = Number((avatar as HTMLElement).dataset['laneOffset']);
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const graphRow = app.graphRows().find((candidate: any) => candidate.commit.oid === 'shared');
      let departure: { x: number; y: number } | undefined;
      let expectedX = NaN;
      let clearance = Infinity;
      for (const [index, path] of [...element.querySelectorAll<SVGPathElement>('.graph-edges path')].entries()) {
        if (/[CQLST]/i.test(path.getAttribute('d') ?? '')) {
          throw new Error(`Non-orthogonal graph edge: ${path.getAttribute('d')}`);
        }
        const length = path.getTotalLength();
        const start = path.getPointAtLength(0), end = path.getPointAtLength(length);
        const matrix = path.getScreenCTM()!;
        const connection = graphRow.segments[index].nodeConnection;
        if (connection?.part === 'source') {
          const point = new DOMPoint(start.x, start.y).matrixTransform(matrix);
          departure = { x: point.x, y: point.y };
          expectedX = node.x + node.width / 2;
        }
        if (graphRow.segments[index].bypassNode) {
          for (let step = 0; step <= 100; step++) {
            const point = path.getPointAtLength(length * step / 100);
            const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
            clearance = Math.min(clearance, Math.hypot(screen.x - (node.x + node.width / 2),
              screen.y - (node.y + node.height / 2)) - node.width / 2);
          }
        }
      }
      return { departure, clearance, offset, expectedX, bottomY: node.bottom };
    });
    expect(Number.isFinite(geometry.clearance), JSON.stringify(geometry)).toBe(true);
    expect(geometry.clearance, JSON.stringify(geometry)).toBeGreaterThanOrEqual(0.5);
    expect(geometry.departure).toBeDefined();
    expect(Math.abs(geometry.departure!.x - geometry.expectedX), JSON.stringify(geometry)).toBeLessThan(0.1);
    // The row divider slightly scales SVG height; the stroke must still touch the circle.
    expect(Math.abs(geometry.departure!.y - geometry.bottomY), JSON.stringify(geometry)).toBeLessThan(0.5);
    await test.info().attach('Shared-parent bottom-center routing', {
      body: await page.locator('.virtual-commit-rows').screenshot({
        path: test.info().outputPath('orthogonal-shared-parent.png'),
      }), contentType: 'image/png',
    });
  });

  test(`keeps converging incoming lanes stacked at the pinned avatar (${compact ? 'compact' : 'expanded'})`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.author-node').first()).toBeVisible();
    await page.evaluate(compact => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const repo = app.git.repository();
      const template = repo.commits[0];
      const topology: Array<[string, string[]]> = [
        ['fork', ['parent', 'target', 'source', 'other']],
        ['source', ['target']],
        ['target', ['parent']],
        ['other', ['base']],
        ['parent', ['base']],
        ['base', []],
      ];
      const commits = topology.map(([oid, parents]) => ({
        ...template, oid, parents, subject: oid, decorations: [],
      }));
      app.hiddenBranches.set([]);
      app.soloBranches.set([]);
      app.smartBranchVisibility.set(false);
      app.pinnedBranch.set('pinned');
      app.git.repositories.update((items: any[]) => items.map(item => item.id === repo.id ? {
        ...item, commits, headOid: 'target', worktrees: [], stashes: [],
        branches: [{ ...repo.branches[0], name: 'pinned', fullName: 'refs/heads/pinned',
          oid: 'target', current: true, remote: false }],
        status: { ...repo.status, branch: 'pinned', staged: 0, unstaged: 0, entries: [] },
      } : item));
      app.setCompactGraphColumn(compact);
      app.graphColumnWidth.set(240);
    }, compact);
    const row = page.locator('[data-commit-oid="target"]');
    await expect(row).toBeVisible();
    const incoming: { from: number; trackY: number; attachmentY: number; radiusError: number; visible: boolean }[] =
      await row.evaluate(element => {
        const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
        const graphRow = app.graphRows().find((candidate: any) => candidate.commit.oid === 'target');
        const node = element.querySelector('.author-node')!.getBoundingClientRect();
        const paths = element.querySelectorAll<SVGPathElement>('.graph-edges path');
        const laneGap = app.compactGraphColumn() ? 32 : 40;
        const radius = app.compactGraphColumn() ? 10 : 12;
        const probeX = graphRow.nodeOffset + radius + (laneGap - radius) / 2;
        return graphRow.segments.flatMap((segment: any, index: number) => {
          if (!segment.parentNodeRadius || segment.x1 === segment.x2) return [];
          const path = paths[index];
          const trackY = segment.horizontalTrack?.y;
          if (trackY === undefined) throw new Error('Incoming edge was not assigned a track');
          const probe = new DOMPoint(probeX, trackY).matrixTransform(path.getScreenCTM()!);
          const point = path.getPointAtLength(path.getTotalLength());
          const attachment = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
          return [{
            from: segment.x1, trackY: probe.y, attachmentY: attachment.y,
            radiusError: Math.abs(Math.hypot(attachment.x - (node.x + node.width / 2),
              attachment.y - (node.y + node.height / 2)) - node.width / 2),
            visible: document.elementFromPoint(probe.x, probe.y) === path,
          }];
        });
      });
    expect(incoming).toHaveLength(2);
    incoming.sort((a, b) => a.from - b.from);
    expect(incoming[0].trackY).toBeLessThan(incoming[1].trackY);
    for (const edge of incoming) {
      expect(edge.visible, JSON.stringify(incoming)).toBe(true);
      expect(Math.abs(edge.trackY - edge.attachmentY)).toBeLessThan(0.1);
      expect(edge.radiusError).toBeLessThan(0.5);
    }
    await test.info().attach('Stacked incoming lanes', {
      body: await row.locator('.graph-cell').screenshot({
        path: test.info().outputPath(`stacked-incoming-${compact ? 'compact' : 'expanded'}.png`),
      }), contentType: 'image/png',
    });
  });

  for (const direction of ['right-to-left', 'left-to-right'] as const) {
    for (const edgeCount of [2, 3, 14]) {
      test(`keeps ${edgeCount} overlapping graph edges visible on separate tracks (${direction}, ${compact ? 'compact' : 'expanded'})`, async ({ page }) => {
        if (edgeCount === 14) await page.setViewportSize({ width: 1920, height: 900 });
        await page.goto('/');
        await expect(page.locator('.author-node').first()).toBeVisible();
        await page.evaluate(({ compact, direction, edgeCount }) => {
          const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
          const repo = app.git.repository();
          const template = repo.commits[0];
          const parents = Array.from({ length: edgeCount - 1 }, (_, index) => `parent-${index}`);
          const forkParents = direction === 'left-to-right'
            ? ['merge', 'filler', 'source', ...parents]
            : [...parents, 'source', 'filler', 'merge'];
          const topology: Array<[string, string[]]> = [
            ['fork', forkParents],
            ['source', ['merge']],
            ['merge', parents],
            ['filler', ['base']],
            ...parents.map((parent): [string, string[]] => [parent, ['base']]),
            ['base', []],
          ];
          const commits = topology.map(([oid, commitParents]) => ({
            ...template, oid, parents: commitParents, subject: oid, decorations: [],
          }));
          app.hiddenBranches.set([]);
          app.soloBranches.set([]);
          app.smartBranchVisibility.set(false);
          app.pinnedBranch.set(null);
          app.git.repositories.update((items: any[]) => items.map(item => item.id === repo.id ? {
            ...item, commits, worktrees: [], stashes: [], branches: [],
          } : item));
          app.setCompactGraphColumn(compact);
          app.graphColumnWidth.set(Math.max(240, (forkParents.length + 1) * 40));
        }, { compact, direction, edgeCount });
        const row = page.locator('[data-commit-oid="merge"]');
        await expect(row).toBeVisible();
        const geometry: {
          tracks: {
            y: number; stroke: string; width: number; visible: boolean;
            attachmentY: number; radiusError: number; outgoing: boolean; distance: number; hasBoundaryCap: boolean;
          }[];
          join: { sourceX: number; parentX: number; gap: number; sourceWidth: number; parentWidth: number };
        } = await row.evaluate((element, direction) => {
          const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
          const rows = app.graphRows();
          const graphRow = rows.find((candidate: any) => candidate.commit.oid === 'merge');
          const incomingIndex = graphRow.segments.findIndex((segment: any) => segment.nodeConnection?.part === 'parent');
          if (incomingIndex < 0) throw new Error('Missing incoming adjacent-parent connection');
          const incoming = graphRow.segments[incomingIndex];
          const laneGap = app.compactGraphColumn() ? 32 : 40;
          const probeX = incoming.x1 + (direction === 'left-to-right' ? -laneGap / 2 : laneGap / 2);
          const paths = element.querySelectorAll<SVGPathElement>('.graph-edges path');
          const node = element.querySelector('.author-node')!.getBoundingClientRect();
          const tracks = graphRow.segments.flatMap((segment: any, index: number) => {
            if (segment.nodeConnection?.part !== 'parent'
              && !(segment.sourceNodeRadius && segment.x1 !== segment.x2)) return [];
            const path = paths[index];
            const tokens = (path.getAttribute('d') ?? '').match(/[A-Za-z]|-?\d+(?:\.\d+)?/g) ?? [];
            let x = 0, y = 0, trackY: number | undefined;
            while (tokens.length) {
              const command = tokens.shift();
              if (command === 'M') { x = Number(tokens.shift()); y = Number(tokens.shift()); }
              else if (command === 'V') y = Number(tokens.shift());
              else if (command === 'H') {
                const endX = Number(tokens.shift());
                if (probeX > Math.min(x, endX) && probeX < Math.max(x, endX)) trackY = y;
                x = endX;
              } else if (command === 'A') {
                const arc = tokens.splice(0, 7).map(Number);
                x = arc[5]; y = arc[6];
              } else throw new Error(`Unexpected path command ${command}`);
            }
            if (trackY === undefined) throw new Error(`No horizontal edge at ${probeX}: ${path.getAttribute('d')}`);
            const point = new DOMPoint(probeX, trackY).matrixTransform(path.getScreenCTM()!);
            const outgoing = !!segment.sourceNodeRadius;
            const attachment = path.getPointAtLength(outgoing ? 0 : path.getTotalLength());
            const attachmentPoint = new DOMPoint(attachment.x, attachment.y).matrixTransform(path.getScreenCTM()!);
            return [{
              y: point.y,
              stroke: getComputedStyle(path).stroke,
              width: parseFloat(getComputedStyle(path).strokeWidth),
              visible: document.elementFromPoint(point.x, point.y) === path,
              attachmentY: attachmentPoint.y,
              radiusError: Math.abs(Math.hypot(attachmentPoint.x - (node.x + node.width / 2),
                attachmentPoint.y - (node.y + node.height / 2)) - node.width / 2),
              outgoing,
              distance: Math.abs(segment.x2 - segment.x1),
              hasBoundaryCap: !!path.ownerSVGElement!.querySelector(
                `.graph-edge-cap[cx="${outgoing ? segment.x2 : segment.x1}"][cy="${outgoing ? 40 : 0}"]`),
            }];
          });
          const sourceRow = rows.find((candidate: any) => candidate.commit.oid === 'source');
          const sourceIndex = sourceRow.segments.findIndex((segment: any) => segment.nodeConnection?.part === 'source');
          if (sourceIndex < 0) throw new Error('Missing source adjacent-parent connection');
          const sourceElement = document.querySelector('[data-commit-oid="source"]')!;
          const sourcePath = sourceElement.querySelectorAll<SVGPathElement>('.graph-edges path')[sourceIndex];
          const parentPath = paths[incomingIndex];
          const toScreen = (path: SVGPathElement, atEnd: boolean) => {
            const point = path.getPointAtLength(atEnd ? path.getTotalLength() : 0);
            return new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
          };
          const sourceEnd = toScreen(sourcePath, true), parentStart = toScreen(parentPath, false);
          return {
            tracks,
            join: {
              sourceX: sourceEnd.x, parentX: parentStart.x, gap: parentStart.y - sourceEnd.y,
              sourceWidth: parseFloat(getComputedStyle(sourcePath).strokeWidth),
              parentWidth: parseFloat(getComputedStyle(parentPath).strokeWidth),
            },
          };
        }, direction);
        const { tracks, join } = geometry;
        expect(tracks).toHaveLength(edgeCount);
        expect(new Set(tracks.map(track => track.stroke)).size).toBe(Math.min(edgeCount, 12));
        expect(tracks.every(track => track.visible), JSON.stringify(tracks)).toBe(true);
        const ordered = [...tracks].sort((a, b) => a.y - b.y);
        for (let index = 1; index < ordered.length; index++) {
          expect(ordered[index].y - ordered[index - 1].y, JSON.stringify(tracks))
            .toBeGreaterThan(Math.max(ordered[index].width, ordered[index - 1].width));
        }
        for (const track of tracks) {
          expect(Math.abs(track.y - track.attachmentY), JSON.stringify(track)).toBeLessThan(0.1);
          expect(track.radiusError, JSON.stringify(track)).toBeLessThan(0.5);
          if (track.width < 2) expect(track.hasBoundaryCap, JSON.stringify(track)).toBe(true);
        }
        const outgoing = tracks.filter(track => track.outgoing).sort((a, b) => a.distance - b.distance);
        for (let index = 1; index < outgoing.length; index++) {
          expect(outgoing[index - 1].y, JSON.stringify(outgoing)).toBeGreaterThan(outgoing[index].y);
        }
        expect(Math.abs(join.sourceX - join.parentX)).toBeLessThan(0.1);
        expect(join.gap).toBeGreaterThanOrEqual(0);
        expect(join.gap).toBeLessThanOrEqual((join.sourceWidth + join.parentWidth) / 2);
        await test.info().attach('Separated graph tracks', {
          body: await row.locator('.graph-cell').screenshot({
            path: test.info().outputPath(`stacked-${edgeCount}-${direction}-${compact ? 'compact' : 'expanded'}.png`),
          }), contentType: 'image/png',
        });
      });
    }

    test(`connects adjacent avatars from the source bottom center (${direction}, ${compact ? 'compact' : 'expanded'})`, async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.author-node').first()).toBeVisible();
      await page.evaluate(({ compact, direction }) => {
        const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
        const repo = app.git.repository();
        const template = repo.commits[0];
        const topology: Array<[string, string[]]> = direction === 'right-to-left'
          ? [['tip', ['parent']], ['source', ['parent']], ['parent', []]]
          : [['merge', ['source', 'other']], ['tip', ['parent']], ['source', ['parent']],
            ['parent', []], ['other', []]];
        const commits = topology.map(([oid, parents]) => ({ ...template, oid, parents,
          subject: oid, decorations: [] }));
        app.hiddenBranches.set([]);
        app.soloBranches.set([]);
        app.smartBranchVisibility.set(false);
        app.pinnedBranch.set(null);
        app.git.repositories.update((items: any[]) => items.map(item => item.id === repo.id ? {
          ...item, commits, worktrees: [], stashes: [], branches: [],
        } : item));
        app.setCompactGraphColumn(compact);
        app.graphColumnWidth.set(240);
      }, { compact, direction });
      await expect(page.locator('[data-commit-oid="source"]')).toBeVisible();
      await expect(page.locator('[data-commit-oid="parent"]')).toBeVisible();
      const geometry = await page.evaluate(() => {
        const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
        const rows = app.graphRows();
        const read = (oid: string, part: 'source' | 'parent') => {
          const row = rows.find((candidate: any) => candidate.commit.oid === oid);
          const index = row.segments.findIndex((segment: any) => segment.nodeConnection?.part === part);
          if (index < 0) throw new Error(`Missing ${part} connection for ${oid}`);
          const element = document.querySelector(`[data-commit-oid="${oid}"]`)!;
          const node = element.querySelector('.author-node')!.getBoundingClientRect();
          const path = element.querySelectorAll<SVGPathElement>('.graph-edges path')[index];
          const matrix = path.getScreenCTM()!;
          const screenPoint = (length: number) => {
            const point = path.getPointAtLength(length);
            const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
            return { x: screen.x, y: screen.y };
          };
          return {
            node: { left: node.left, right: node.right, centerX: node.x + node.width / 2,
              centerY: node.y + node.height / 2, bottom: node.bottom },
            segment: row.segments[index], start: screenPoint(0), end: screenPoint(path.getTotalLength()),
            strokeWidth: parseFloat(getComputedStyle(path).strokeWidth),
            linecap: getComputedStyle(path).strokeLinecap,
          };
        };
        return { source: read('source', 'source'), parent: read('parent', 'parent') };
      });
      const { source, parent } = geometry;
      expect(source.node.centerY).toBeLessThan(parent.node.centerY);
      const sourceIsLeft = source.segment.nodeConnection.sourceOffset < source.segment.nodeConnection.parentOffset;
      expect(sourceIsLeft).toBe(direction === 'left-to-right');
      expect(source.segment.x2).toBe(parent.segment.x1);
      expect(Math.abs(source.start.x - source.node.centerX)).toBeLessThan(0.1);
      expect(Math.abs(source.start.y - source.node.bottom)).toBeLessThan(source.strokeWidth / 2);
      expect(Math.abs(source.end.x - source.start.x)).toBeLessThan(0.1);
      expect(Math.abs(source.end.x - parent.start.x)).toBeLessThan(0.1);
      expect([source.linecap, parent.linecap]).toEqual(['round', 'round']);
      expect(parent.start.y - source.end.y).toBeGreaterThanOrEqual(0);
      expect(parent.start.y - source.end.y).toBeLessThanOrEqual((source.strokeWidth + parent.strokeWidth) / 2);
      expect(Math.abs(parent.end.x - (sourceIsLeft ? parent.node.left : parent.node.right))).toBeLessThan(0.1);
      expect(Math.abs(parent.end.y - parent.node.centerY)).toBeLessThan(0.1);
    });
  }

  test(`aligns each avatar connection with its assigned side position (${compact ? 'compact' : 'expanded'})`, async ({ page }) => {
    await page.goto('/?unmerged-branch-preview');
    await expect(page.locator('.author-node').first()).toBeVisible();
    await page.evaluate(compact => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      app.setCompactGraphColumn(compact);
    }, compact);
    const attachments = await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      return app.graphRows().flatMap((row: any) => {
        const element = document.querySelector(`[data-commit-oid="${row.commit.oid}"]`);
        const node = element?.querySelector('.author-node')?.getBoundingClientRect();
        if (!element || !node) return [];
        const paths = element.querySelectorAll('.graph-edges path');
        const edges = row.segments.flatMap((segment: any, index: number) => {
          if (segment.x1 === segment.x2 || (!segment.sourceNodeRadius && !segment.parentNodeRadius && !segment.nodeConnection)) return [];
          const path = paths[index] as SVGPathElement;
          const source = segment.sourceNodeRadius || segment.nodeConnection?.part === 'source';
          const length = source ? 0 : path.getTotalLength();
          const point = path.getPointAtLength(length);
          const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
          const right = source ? segment.x2 > segment.x1 : segment.x1 > segment.x2;
          const verticalOffset = (segment.horizontalTrack?.y ?? 20) - 20;
          const radius = node.width / 2;
          const sideX = Math.sqrt(Math.max(0, radius * radius - verticalOffset * verticalOffset));
          const scaleY = path.ownerSVGElement!.getBoundingClientRect().height / 40;
          return [{ oid: row.commit.oid, x: screen.x, y: screen.y,
            expectedX: segment.nodeConnection?.part === 'source' ? node.x + node.width / 2
              : node.x + radius + (right ? sideX : -sideX),
            expectedY: segment.nodeConnection?.part === 'source' ? node.bottom
              : node.y + node.height / 2 + verticalOffset * scaleY }];
        });
        const connector = element.querySelector('.ref-connector')?.getBoundingClientRect();
        return connector ? [...edges, { oid: row.commit.oid, x: node.left,
          expectedX: node.left, y: connector.y + connector.height / 2,
          expectedY: node.y + node.height / 2 }] : edges;
      });
    });
    expect(attachments.length).toBeGreaterThan(0);
    for (const attachment of attachments) {
      expect(Math.abs(attachment.x - attachment.expectedX), JSON.stringify(attachment)).toBeLessThan(0.1);
      expect(Math.abs(attachment.y - attachment.expectedY), JSON.stringify(attachment)).toBeLessThan(0.1);
    }
  });

  test(`joins a lane relocated by a pinned branch at the avatar side (${compact ? 'compact' : 'expanded'})`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.author-node').first()).toBeVisible();
    const oid = 'c'.repeat(40);
    await page.evaluate(({ compact, oid }) => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const repo = app.git.repository();
      const [merge, other, base] = ['a', 'b', 'd'].map(letter => letter.repeat(40));
      const template = repo.commits[0];
      const commits = [
        { ...template, oid: merge, parents: [other, oid], decorations: [], subject: 'Merge' },
        { ...template, oid: other, parents: [base], decorations: [], subject: 'Other lane' },
        { ...template, oid, parents: [base], decorations: ['main'], subject: 'Pinned lane' },
        { ...template, oid: base, parents: [], decorations: [], subject: 'Base' },
      ];
      app.hiddenBranches.set([]);
      app.soloBranches.set([]);
      app.smartBranchVisibility.set(false);
      app.pinnedBranch.set('main');
      app.git.repositories.update((items: any[]) => items.map(item => item.id === repo.id ? {
        ...item, commits, headOid: oid, worktrees: [], stashes: [],
        branches: [{ ...repo.branches[0], name: 'main', fullName: 'refs/heads/main', oid, current: true, remote: false }],
        status: { ...repo.status, branch: 'main', staged: 0, unstaged: 0, entries: [] },
      } : item));
      app.setCompactGraphColumn(compact);
    }, { compact, oid });
    const row = page.locator(`[data-commit-oid="${oid}"]`);
    await expect(row).toBeVisible();
    const attachment = await row.evaluate(element => {
      const node = element.querySelector('.author-node')!.getBoundingClientRect();
      const path = element.querySelector('.graph-edges path') as SVGPathElement;
      const point = path.getPointAtLength(path.getTotalLength());
      const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
      return { d: path.getAttribute('d'), x: screen.x, y: screen.y,
        expectedX: node.right, expectedY: node.y + node.height / 2 };
    });
    expect(attachment.d).toMatch(/ A 6 6 0 0 [01] /);
    expect(Math.abs(attachment.x - attachment.expectedX), JSON.stringify(attachment)).toBeLessThan(0.1);
    expect(Math.abs(attachment.y - attachment.expectedY), JSON.stringify(attachment)).toBeLessThan(0.1);
    await test.info().attach('Pinned branch side attachment', {
      body: await page.locator('.virtual-commit-rows').screenshot(), contentType: 'image/png',
    });
  });
}
