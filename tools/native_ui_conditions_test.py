"""Evaluate the actual observation predicate against independent DOM states."""
import json
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from native_ui_conditions import wait_closed_confirmation_refusal


class ConfirmationRefusalObservationTests(unittest.TestCase):
    def predicate(self, message):
        driver = SimpleNamespace(wait=Mock(return_value=True))
        self.assertTrue(wait_closed_confirmation_refusal(driver, message))
        driver.wait.assert_called_once()
        # Use Driver.wait's unchanged default timeout and its read-only polling.
        self.assertEqual(driver.wait.call_args.kwargs, {})
        return driver.wait.call_args.args[0]

    def evaluate(self, predicate, states):
        program = r"""
          import { readFileSync } from 'node:fs';
          const { predicate, states } = JSON.parse(readFileSync(0, 'utf8'));
          const observe = new Function('document', 'getComputedStyle', predicate);
          const result = states.map(state => {
            const toast = state.message == null ? null : {
              textContent: state.message,
              getClientRects: () => state.layout === false ? [] : [{}],
            };
            const document = { querySelector: selector => {
              if (selector === '.error-toast') return toast;
              if (selector === '[role=alertdialog]') return state.confirmation ? {} : null;
              if (selector.includes('Diff viewer')) return state.diff ? {} : null;
              throw Error('Unexpected DOM observation: ' + selector);
            } };
            return observe(document, () => ({ visibility: state.visibility ?? 'visible' }));
          });
          process.stdout.write(JSON.stringify(result));
        """
        completed = subprocess.run(['node', '--input-type=module', '-e', program],
                                   input=json.dumps({'predicate': predicate, 'states': states}),
                                   text=True, capture_output=True, check=True)
        return json.loads(completed.stdout)

    def test_diff_disappearance_or_pending_feedback_cannot_finish_a_refusal_observation(self):
        message = 'The file or index changed after this diff was opened.'
        states = [
            {'diff': False, 'confirmation': True, 'message': None},
            {'diff': False, 'confirmation': False, 'message': None},
            {'confirmation': True, 'message': message},
            {'confirmation': False, 'message': 'An unrelated error'},
            {'confirmation': False, 'message': message, 'layout': False},
            {'confirmation': False, 'message': message, 'visibility': 'hidden'},
            {'confirmation': False, 'message': message},
        ]
        self.assertEqual(self.evaluate(self.predicate(message), states), [False] * 6 + [True])

    def test_expected_feedback_is_treated_as_text_not_javascript(self):
        message = 'Owned "changed"; throw Error("not code");\nfeedback'
        self.assertEqual(self.evaluate(self.predicate(message), [
            {'confirmation': False, 'message': 'Unrelated'},
            {'confirmation': False, 'message': message},
        ]), [False, True])

    def test_empty_feedback_cannot_create_an_always_matching_gate(self):
        driver = SimpleNamespace(wait=Mock())
        for message in ('', None, 1):
            with self.assertRaises(ValueError):
                wait_closed_confirmation_refusal(driver, message)
        driver.wait.assert_not_called()


if __name__ == '__main__':
    unittest.main()
