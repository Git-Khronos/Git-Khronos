"""Match accessible and visible line totals in the same owned DOM read."""
import json


def wait_for_line_recaps(driver, unstaged, staged, *, uncounted=0, changed_files=None, timeout=30):
    def expected(section, counts, excluded=0):
        added, removed = counts
        label = (f'{added} {"addition" if added == 1 else "additions"} and '
                 f'{removed} {"deletion" if removed == 1 else "deletions"} in {section} files')
        if excluded:
            label += f'; {excluded} binary or uncounted {"file" if excluded == 1 else "files"} excluded'
        return {
            'selector': f'.{section}-section gc-working-tree-summary .summary',
            'label': label,
            'added': f'+{added}',
            'removed': f'−{removed}',
            'details': [f'{excluded} other'] if excluded else [],
        }

    rows = [expected('unstaged', unstaged, uncounted), expected('staged', staged)]
    return driver.wait(f"""
        const changedFiles = {json.dumps(changed_files)};
        if (changedFiles !== null && (
              document.querySelector('.wip-nav small')?.textContent.trim() !== changedFiles + ' changed files'
              || document.querySelector('[aria-label="Working directory status"]'))) return null;
        const actual = {json.dumps(rows)}.map(expected => {{
          const recap = document.querySelector(expected.selector);
          if (!recap?.getClientRects().length || recap.getAttribute('role') !== 'img') return null;
          const label = recap.getAttribute('aria-label');
          const added = recap.querySelector('span')?.textContent.trim();
          const removed = recap.querySelector('i')?.textContent.trim();
          const details = Array.from(recap.querySelectorAll('em'), element => element.textContent.trim());
          return label === expected.label && added === expected.added && removed === expected.removed
            && JSON.stringify(details) === JSON.stringify(expected.details)
            ? {{label, added, removed, text: recap.textContent}} : null;
        }});
        return actual.every(Boolean) ? actual : null;
    """, timeout)
