"""Read-only completion observations; never retry a mutation or extend its deadline."""
import json


def wait_closed_confirmation_refusal(driver, message):
    """A disappearing diff is not proof that a confirmed action has finished."""
    if not isinstance(message, str) or not message:
        raise ValueError('A nonempty expected refusal message is required')
    return driver.wait('''
      const toast = document.querySelector('.error-toast');
      return !document.querySelector('[role=alertdialog]') && !!toast
        && toast.getClientRects().length > 0
        && getComputedStyle(toast).visibility === 'visible'
        && toast.textContent.includes(''' + json.dumps(message) + ''');
    ''')
