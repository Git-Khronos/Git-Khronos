"""Regression coverage for catalogue entry controls replaced during rendering."""
from http.client import RemoteDisconnected
import json
import unittest
from unittest.mock import MagicMock, call, patch
from urllib.error import URLError

from native_acceptance import Driver
from native_repository_navigation import open_repository_dialog


ELEMENT = 'element-6066-11e4-a52e-4f735466cecf'


class CatalogueEntryTests(unittest.TestCase):
    def driver(self, *elements):
        driver = MagicMock()
        driver.script.side_effect = elements
        driver.path.side_effect = lambda suffix: '/session/owned/' + suffix
        driver.wait.side_effect = lambda *args: Driver.wait(driver, *args)
        return driver

    def test_success_clicks_painted_toolbar_control_once_with_a_real_webdriver_request(self):
        driver = self.driver({ELEMENT: 'tab'})
        open_repository_dialog(driver)
        driver.request.assert_called_once_with('POST', '/session/owned/element/tab/click', {})
        driver.script.assert_called_once()
        script = driver.script.call_args.args[0]
        self.assertIn('.tabbar [aria-label="New repository tab"]', script)
        self.assertIn('elementFromPoint', script)
        self.assertNotIn('gc-welcome-launcher', script)
        self.assertNotIn('.click(', script)

    def test_stale_refusal_reacquires_the_current_entry_for_both_error_shapes(self):
        for wrapped in (False, True):
            with self.subTest(wrapped=wrapped):
                detail = {'error': 'stale element reference', 'message': 'detached'}
                if wrapped:
                    detail = {'value': detail}
                driver = self.driver({ELEMENT: 'outgoing'}, None, {ELEMENT: 'current-tab'})
                driver.request.side_effect = [RuntimeError(json.dumps(detail)), None]
                with patch('native_repository_navigation.time.sleep'):
                    open_repository_dialog(driver)
                self.assertEqual(driver.script.call_count, 3)
                self.assertEqual(driver.request.call_args_list, [
                    call('POST', '/session/owned/element/outgoing/click', {}),
                    call('POST', '/session/owned/element/current-tab/click', {}),
                ])

    def test_temporarily_missing_control_is_polled_without_a_click(self):
        driver = self.driver(None, {ELEMENT: 'restored'})
        with patch('native_repository_navigation.time.sleep'):
            open_repository_dialog(driver)
        self.assertEqual(driver.script.call_count, 2)
        driver.request.assert_called_once()

    def test_uncertain_or_non_stale_failures_are_never_replayed(self):
        errors = [RemoteDisconnected('lost click reply'), URLError('lost connection'),
                  RuntimeError('stale element reference'),
                  RuntimeError(json.dumps({'error': 'element click intercepted'})),
                  RuntimeError(json.dumps({'value': {'error': 'unknown error'}})),
                  RuntimeError('[]'), RuntimeError('null')]
        for error in errors:
            with self.subTest(error=str(error)):
                driver = self.driver({ELEMENT: 'owned'})
                driver.request.side_effect = error
                with self.assertRaises(type(error)) as failure:
                    open_repository_dialog(driver)
                self.assertIs(failure.exception, error)
                driver.request.assert_called_once()
                driver.script.assert_called_once()

    def test_lookup_failure_is_not_retried_as_a_click_failure(self):
        driver = self.driver()
        error = RuntimeError(json.dumps({'error': 'stale element reference'}))
        driver.script.side_effect = error
        with self.assertRaises(RuntimeError) as failure:
            open_repository_dialog(driver)
        self.assertIs(failure.exception, error)
        driver.request.assert_not_called()

    def test_repeated_stale_refusals_stop_at_the_deadline(self):
        driver = self.driver({ELEMENT: 'outgoing'})
        driver.wait.side_effect = None
        driver.wait.return_value = {ELEMENT: 'outgoing'}
        driver.request.side_effect = RuntimeError(json.dumps({'error': 'stale element reference'}))
        with patch('native_repository_navigation.time.monotonic', side_effect=[0, 30]), \
                patch('native_repository_navigation.time.sleep'):
            with self.assertRaises(TimeoutError):
                open_repository_dialog(driver)
        driver.request.assert_called_once()

    def test_missing_control_stops_at_the_deadline_without_clicking(self):
        driver = self.driver(None)
        with patch('native_repository_navigation.time.monotonic', side_effect=[0, 0, 0, 30]), \
                patch('native_repository_navigation.time.sleep'):
            with self.assertRaises(TimeoutError):
                open_repository_dialog(driver)
        driver.request.assert_not_called()


if __name__ == '__main__':
    unittest.main()
