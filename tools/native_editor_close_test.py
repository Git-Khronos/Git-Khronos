"""Approved-close transport checks must not replay a click or hide live processes."""
import json
import unittest
from unittest.mock import Mock, patch
import native_editor_close_scenarios as close


class ApprovedCloseTests(unittest.TestCase):
    def driver(self, error=None):
        driver = Mock()
        driver.wait.return_value = {'element-6066-11e4-a52e-4f735466cecf': 'owned-control'}
        driver.path.return_value = '/session/owned/element/owned-control/click'
        if error is not None: driver.request.side_effect = error
        return driver

    def test_confirmed_click_uses_one_dispatch(self):
        driver = self.driver(); report = {}
        close.approve_editor_window_close(driver, 'Discard draft', 101, report)
        driver.request.assert_called_once_with('POST', '/session/owned/element/owned-control/click', {})
        self.assertEqual(report, {})

    def test_known_terminated_reply_requires_owned_exit_and_is_never_replayed(self):
        error = RuntimeError(json.dumps({'value': {'error': 'unknown error', 'message': 'Session terminated without a reply'}}))
        driver = self.driver(error); report = {}
        with patch.object(close, 'process_running', return_value=False):
            close.approve_editor_window_close(driver, 'Discard draft', 101, report)
        driver.request.assert_called_once()
        self.assertEqual(report['editorWindowCloseTerminatedReplies'], [{'pid': 101, 'action': 'Discard draft', 'ownedProcessExited': True, 'clickReplayed': False}])
        driver = self.driver(error)
        with patch.object(close, 'process_running', return_value=True), patch.object(close.time, 'monotonic', side_effect=[0, 11]):
            with self.assertRaisesRegex(RuntimeError, 'still running'):
                close.approve_editor_window_close(driver, 'Discard draft', 101, {})
        driver.request.assert_called_once()

    def test_unrelated_errors_are_never_accepted_even_if_the_process_exited(self):
        for error in [RuntimeError('unrecognized'), RuntimeError(json.dumps({'value': {'error': 'javascript error', 'message': 'Session terminated without a reply'}}))]:
            driver = self.driver(error)
            with patch.object(close, 'process_running', return_value=False) as running:
                with self.assertRaises(RuntimeError): close.approve_editor_window_close(driver, 'Save draft', 101, {})
            running.assert_not_called(); driver.request.assert_called_once()


if __name__ == '__main__': unittest.main()
