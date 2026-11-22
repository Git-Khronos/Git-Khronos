"""Safe entry into repository management from the restored native toolbar."""
import time

from native_webdriver_errors import stale_element_refusal


_RESTORED_REPOSITORY_ENTRY = """const button = document.querySelector('.tabbar [aria-label="New repository tab"]');
  if (!button || !button.getClientRects().length || getComputedStyle(button).visibility !== 'visible'
    || button.matches(':disabled') || button.closest('[inert]')) return null;
  const rect = button.getBoundingClientRect();
  const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
  const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
  return right > left && bottom > top
    && button.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2)) ? button : null;"""


def open_repository_dialog(driver, timeout=30):
    """Enter from the restored workspace, never from the startup launcher."""
    # A saved workspace may be restoring a repository after startup or restart.
    # The welcome Clone button can disappear between pointer press and release
    # when restoration finishes. WebDriver can acknowledge the click anyway.
    deadline = time.monotonic() + timeout
    while (remaining := deadline - time.monotonic()) > 0:
        element = driver.wait(_RESTORED_REPOSITORY_ENTRY, remaining)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        identifier = element['element-6066-11e4-a52e-4f735466cecf']
        try:
            driver.request('POST', driver.path('element/' + identifier + '/click'), {},
                           timeout=min(90, remaining))
            return
        except RuntimeError as error:
            # Read-only readiness polling is safe. Only an explicit stale
            # refusal permits reacquiring and clicking a replacement control.
            if not stale_element_refusal(error):
                raise
        remaining = deadline - time.monotonic()
        if remaining > 0:
            time.sleep(min(0.1, remaining))
    raise TimeoutError('Restored repository dialog entry control did not remain available for a click')
