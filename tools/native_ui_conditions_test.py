"""Evaluate the actual observation predicate against independent DOM states."""
import json
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from native_ui_conditions import wait_closed_confirmation_refusal, wait_git_error_message


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
          const observe = new Function('document', 'getComputedStyle', 'Node', predicate);
          const result = states.map(state => {
            const toast = state.message == null ? null : {
              textContent: state.message,
              querySelector: selector => {
                if (selector !== 'p') throw Error('Unexpected toast query: ' + selector);
                return { childNodes: [
                  { nodeType: 1, textContent: 'Git needs attention' },
                  { nodeType: 3, textContent: state.body ?? '' },
                ] };
              },
              getClientRects: () => state.layout === false ? [] : [{}],
            };
            const document = { querySelector: selector => {
              if (selector === '.error-toast') return toast;
              if (selector === '[role=alertdialog]') return state.confirmation ? {} : null;
              if (selector.includes('Diff viewer')) return state.diff ? {} : null;
              throw Error('Unexpected DOM observation: ' + selector);
            } };
            return observe(document, () => ({ visibility: state.visibility ?? 'visible' }), { TEXT_NODE: 3 });
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

    def test_git_error_observation_ignores_heading_only_and_unpainted_bodies(self):
        driver = SimpleNamespace(wait=Mock(return_value='Actual Git error'))
        self.assertEqual(wait_git_error_message(driver, timeout=3), 'Actual Git error')
        predicate, timeout = driver.wait.call_args.args
        self.assertEqual(timeout, 3)
        states = [
            {},
            {'message': 'Git needs attention'},
            {'message': 'Git needs attention', 'body': '  '},
            {'message': 'Git needs attention Actual Git error', 'body': 'Actual Git error', 'layout': False},
            {'message': 'Git needs attention Actual Git error', 'body': 'Actual Git error', 'visibility': 'hidden'},
            {'message': 'Git needs attention Actual Git error', 'body': '  Actual Git error  '},
        ]
        self.assertEqual(self.evaluate(predicate, states), [None] * 5 + ['Actual Git error'])

    def test_empty_feedback_cannot_create_an_always_matching_gate(self):
        driver = SimpleNamespace(wait=Mock())
        for message in ('', None, 1):
            with self.assertRaises(ValueError):
                wait_closed_confirmation_refusal(driver, message)
        driver.wait.assert_not_called()


if __name__ == '__main__':
    unittest.main()
