import type { Page } from '@playwright/test';

export type Column = 'branch' | 'graph' | 'message' | 'author' | 'date' | 'sha';

export const HEADINGS: Record<Column, string> = {
  branch: 'BRANCH / TAG', graph: 'GRAPH', message: 'COMMIT MESSAGE', author: 'AUTHOR', date: 'DATE / TIME', sha: 'SHA',
};

interface GraphLayoutProbe {
  readonly expectedTitles: string[];
  readonly fit: boolean;
  readonly explain?: boolean;
}

/** Use the same browser-side checks for readiness and failure diagnostics. */
function probeGraphLayout({ expectedTitles, fit, explain }: GraphLayoutProbe): boolean | string[] {
  const problems: string[] = [];
  const header = document.querySelector<HTMLElement>('.graph-columns');
  const list = document.querySelector<HTMLElement>('.commit-list');
  const row = document.querySelector<HTMLElement>('.commit-row[data-commit-oid]');
  const settings = document.querySelector<HTMLElement>('[aria-label="Configure graph columns"]');
  if (!header || !list || !row || !settings) {
    if (!header) problems.push('column header is missing');
    if (!list) problems.push('commit list is missing');
    if (!row) problems.push('commit row is missing');
    if (!settings) problems.push('column settings button is missing');
    return explain ? problems : false;
  }
  const byOrder = (parent: Element, selector: string) => [...parent.querySelectorAll<HTMLElement>(selector)]
    .filter((element) => element.style.order !== '' && element.getBoundingClientRect().width > 0)
    .sort((a, b) => Number(a.style.order) - Number(b.style.order));
  const headings = byOrder(header, ':scope > .draggable-column');
  const cells = byOrder(row, ':scope > [style*="order"]');
  const titles = headings.map((heading) => (heading.textContent ?? '').replace(/\s+/g, ' ').trim());
  if (headings.length !== expectedTitles.length) problems.push(`expected ${expectedTitles.length} headings, found ${headings.length}: ${titles.join('|')}`);
  else if (!titles.every((title, index) => title.toUpperCase().includes(expectedTitles[index]))) {
    problems.push(`expected headings ${expectedTitles.join('|')}, found ${titles.join('|')}`);
  }
  if (cells.length !== expectedTitles.length) problems.push(`expected ${expectedTitles.length} row cells, found ${cells.length}`);
  const boxes = headings.map((heading) => heading.getBoundingClientRect());
  for (let index = 1; index < boxes.length; index += 1) {
    const gap = boxes[index].left - boxes[index - 1].right;
    if (Math.abs(gap) > 1) problems.push(`${gap < 0 ? 'overlap' : 'gap'} of ${gap.toFixed(1)}px between headings ${index - 1} and ${index}`);
  }
  for (const [index, box] of boxes.entries()) {
    if (box.width < 30) problems.push(`heading ${index} is only ${box.width.toFixed(1)}px wide`);
  }
  // Row cells share the heading tracks.
  for (const [index, cell] of cells.entries()) {
    const heading = boxes[index];
    const box = cell.getBoundingClientRect();
    if (heading && Math.abs(box.left - heading.left) > 1.5) problems.push(`row cell ${index} starts at ${box.left.toFixed(1)}, heading at ${heading.left.toFixed(1)}`);
  }
  // Resizing moves only a column's right edge, so narrowing may leave free space after the last
  // heading. The last heading never spills past the visible header, and the settings button stays
  // at the panel's right end.
  const gear = settings.getBoundingClientRect();
  const layoutIcon = settings.querySelector('gc-icon');
  const last = boxes.at(-1);
  const overflow = list.scrollWidth - list.clientWidth;
  const visibleRight = header.getBoundingClientRect().left + header.clientWidth - parseFloat(getComputedStyle(header).paddingRight);
  if (gear.width < 20 || gear.width > 32) problems.push(`settings button is ${gear.width.toFixed(1)}px wide`);
  if (!layoutIcon || layoutIcon.querySelectorAll('rect').length !== 1 || layoutIcon.querySelectorAll('path').length !== 1) {
    problems.push('settings button does not show the framed columns layout icon');
  }
  if (overflow <= 1) {
    if (last && last.right > visibleRight + 1) problems.push(`last heading ends at ${last.right.toFixed(1)}, past the panel edge at ${visibleRight.toFixed(1)}`);
    if (Math.abs(gear.right - visibleRight) > 4) problems.push(`settings button ${gear.left.toFixed(1)}-${gear.right.toFixed(1)} is not at the panel edge ${visibleRight.toFixed(1)}`);
  }
  // Scroll markers stay in their own rail and never cover the settings button, or row actions once
  // they rest at the end (no overflow, or scrolled fully right). Until then, overflowing content
  // scrolls under the rail as it would under a scrollbar.
  const atEnd = list.scrollWidth - list.clientWidth - list.scrollLeft <= 1;
  const actions = [
    ...(atEnd ? [...document.querySelectorAll<HTMLElement>('.commit-row .row-menu')].map((element) => element.getBoundingClientRect()) : []),
    gear,
  ];
  for (const marker of document.querySelectorAll<HTMLElement>('.graph-scroll-marker')) {
    const box = marker.getBoundingClientRect();
    if (actions.some((action) => box.left < action.right && action.left < box.right && box.top < action.bottom && action.top < box.bottom)) {
      problems.push(`scroll marker ${marker.getAttribute('aria-label')} at ${box.left.toFixed(1)}-${box.right.toFixed(1)} covers a row action`);
    }
  }
  if (fit && overflow > 1) problems.push(`fitted columns overflow by ${overflow}px`);
  if (Math.abs(header.scrollLeft - list.scrollLeft) > 1) problems.push(`header scroll ${header.scrollLeft} differs from list scroll ${list.scrollLeft}`);
  // Separators report sane, in-range widths that match what is drawn.
  for (const [index, heading] of headings.entries()) {
    const separator = heading.querySelector<HTMLElement>(':scope > [role="separator"]');
    if (!separator) { problems.push(`heading ${index} has no separator`); continue; }
    const now = Number(separator.getAttribute('aria-valuenow'));
    const min = Number(separator.getAttribute('aria-valuemin'));
    const max = Number(separator.getAttribute('aria-valuemax'));
    const label = separator.getAttribute('aria-label');
    if (!(Number.isFinite(min) && Number.isFinite(now) && Number.isFinite(max)
      && min <= now && now <= max)) problems.push(`${label}: now ${now} outside ${min}-${max}`);
    if (now < min) problems.push(`${label}: ${now} below minimum ${min}`);
    const drawn = boxes[index].width - (index === boxes.length - 1 && headings.length ? 26 : 0);
    if (Math.abs(now - drawn) > 1.5 && Math.abs(now - boxes[index].width) > 1.5) problems.push(`${label}: reports ${now}px, draws ${drawn.toFixed(1)}px`);
    // Every column, including the last, resizes from its own right edge.
    const handle = separator.getBoundingClientRect();
    const handleCenter = handle.left + handle.width / 2;
    if (handleCenter <= boxes[index].left + boxes[index].width / 2 || handleCenter > boxes[index].right + 1) {
      problems.push(`${label}: handle at ${handleCenter.toFixed(1)} is not on the right edge ending at ${boxes[index].right.toFixed(1)}`);
    }
  }
  return explain ? problems : problems.length === 0;
}

export async function expectGraphLayout(page: Page, order: Column[], context: string, fit = false) {
  const input = { expectedTitles: order.map(column => HEADINGS[column]), fit };
  try {
    // Bound readiness where geometry is measured, not around browser-reply
    // delivery to the test worker. The overall test deadline still applies.
    const ready = await page.waitForFunction(probeGraphLayout, input, { timeout: 3000 });
    await ready.dispose();
  } catch (error) {
    // Only failed checks need a diagnostic snapshot. Preserve the timeout even
    // if the page has closed or the next frame has already recovered.
    const observed = !page.isClosed() && await page.evaluate(probeGraphLayout, { ...input, explain: true }).catch(() => false);
    const detail = Array.isArray(observed) && observed.length ? ` (${observed.join('; ')})` : '';
    throw new Error(`${context}: layout verification failed${detail}`, { cause: error });
  }
}
