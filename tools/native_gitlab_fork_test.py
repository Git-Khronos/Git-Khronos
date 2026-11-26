"""Regression coverage for catalogue entry controls replaced during rendering."""
from http.client import RemoteDisconnected
import json
import unittest
from unittest.mock import ANY, MagicMock, call, patch
from urllib.error import URLError

from native_acceptance import Driver
from native_gitlab_fork_scenarios import click_fork_button
from native_repository_navigation import open_gitlab_catalogue, open_repository_dialog


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
        driver.request.assert_called_once_with('POST', '/session/owned/element/tab/click', {}, timeout=ANY)
        driver.script.assert_called_once()
        script = driver.script.call_args.args[0]
        self.assertIn('.tabbar [aria-label="New repository tab"]', script)
        self.assertIn('elementFromPoint', script)
        self.assertNotIn('gk-welcome-launcher', script)
        self.assertNotIn('.click(', script)

    def test_catalogue_entry_waits_for_each_local_step_without_connecting(self):
        driver = MagicMock()
        with patch('native_repository_navigation.open_repository_dialog') as opener:
            open_gitlab_catalogue(driver)
        opener.assert_called_once_with(driver)
        self.assertEqual(driver.click_navigation.call_args_list, [
            call('#repository-tab-clone', 'Clone', wait_for_ready=True, timeout=15),
            call('gk-repository-dialog button', 'Browse GitLab projects', scroll=True, wait_for_ready=True, timeout=15),
        ])
        driver.wait.assert_called_once()
        self.assertIn('#gitlab-origin:not(:disabled)', driver.wait.call_args.args[0])
        driver.invoke.assert_not_called()

    def test_catalogue_navigation_reacquires_only_after_explicit_stale_refusal(self):
        driver = MagicMock()
        driver._click_scrolled_element.side_effect = [
            RuntimeError(json.dumps({'error': 'stale element reference', 'message': 'detached'})),
            None,
        ]
        driver.wait.side_effect = [[{ELEMENT: 'outgoing'}], [{ELEMENT: 'replacement'}]]
        driver.click_navigation = lambda selector, text, **options: Driver.click_navigation(
            driver, selector, text, **{**options, 'timeout': 1})
        click_fork_button(driver, 'gk-repository-dialog button', 'Browse GitLab projects')
        driver.click_scrolled_text.assert_not_called()
        self.assertEqual(driver._click_scrolled_element.call_args_list, [
            call({ELEMENT: 'outgoing'}, deadline=ANY), call({ELEMENT: 'replacement'}, deadline=ANY),
        ])
        self.assertEqual(driver.wait.call_count, 2)

    def test_only_local_fork_transitions_use_navigation_recovery(self):
        for text in ('Browse forks of team/subgroup/owned-project', 'Review a new GitLab fork'):
            with self.subTest(text=text):
                driver = MagicMock()
                click_fork_button(driver, 'gk-gitlab-projects button', text)
                driver.click_navigation.assert_called_once_with(
                    'gk-gitlab-projects button', text, scroll=True, wait_for_ready=True, timeout=30)
                driver.click_scrolled_text.assert_not_called()

    def test_fork_provider_and_record_controls_never_use_stale_click_replay(self):
        for selector, text in (
            ('gk-gitlab-fork-create button', 'Submit reviewed fork request'),
            ('gk-gitlab-projects button', 'Connect to GitLab'),
            ('gk-gitlab-fork-records button', 'Inspect saved outcome owned-reader/reviewed-project'),
            ('gk-gitlab-fork-create button', 'Review a new GitLab fork'),
            ('gk-gitlab-fork-create button', 'Open saved fork outcomes'),
        ):
            with self.subTest(text=text):
                driver = MagicMock()
                click_fork_button(driver, selector, text)
                driver.click_navigation.assert_not_called()
                driver.click_scrolled_text.assert_called_once_with(selector, text, wait_for_ready=True)

    def test_navigation_does_not_replay_uncertain_or_intercepted_clicks(self):
        errors = [
            TimeoutError('lost click reply'),
            RuntimeError(json.dumps({'error': 'element click intercepted'})),
        ]
        for error in errors:
            with self.subTest(error=str(error)):
                driver = MagicMock()
                driver._click_scrolled_element.side_effect = error
                driver.wait.return_value = [{ELEMENT: 'outgoing'}]
                driver.click_navigation = lambda selector, text, **options: Driver.click_navigation(
                    driver, selector, text, **{**options, 'timeout': 1})
                with self.assertRaises(type(error)) as failure:
                    click_fork_button(driver, 'gk-repository-dialog button', 'Browse GitLab projects')
                self.assertIs(failure.exception, error)
                driver._click_scrolled_element.assert_called_once_with({ELEMENT: 'outgoing'}, deadline=ANY)
                driver.wait.assert_called_once()

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
                    call('POST', '/session/owned/element/outgoing/click', {}, timeout=ANY),
                    call('POST', '/session/owned/element/current-tab/click', {}, timeout=ANY),
                ])

    def test_temporarily_missing_control_is_polled_without_a_click(self):
        driver = self.driver(None, {ELEMENT: 'restored'})
        with patch('native_repository_navigation.time.sleep'):
            open_repository_dialog(driver)
        self.assertEqual(driver.script.call_count, 2)
        driver.request.assert_called_once()

    def test_uncertain_or_non_stale_failures_are_never_replayed(self):
        errors = [RemoteDisconnected('lost click reply'), TimeoutError('lost click reply'), URLError('lost connection'),
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
        with patch('native_repository_navigation.time.monotonic', side_effect=[0, 0, 0.1, 30, 30]), \
                patch('native_repository_navigation.time.sleep'):
            with self.assertRaises(TimeoutError):
                open_repository_dialog(driver)
        driver.request.assert_called_once()

    def test_wait_and_click_share_one_deadline(self):
        driver = self.driver()
        driver.wait.side_effect = None
        driver.wait.return_value = {ELEMENT: 'ready'}
        with patch('native_repository_navigation.time.monotonic', side_effect=[0, 2, 5]):
            open_repository_dialog(driver)
        self.assertEqual(driver.wait.call_args.args[1], 28)
        driver.request.assert_called_once_with('POST', '/session/owned/element/ready/click', {}, timeout=25)

    def test_late_readiness_does_not_dispatch_a_click(self):
        driver = self.driver()
        driver.wait.side_effect = None
        driver.wait.return_value = {ELEMENT: 'late'}
        with patch('native_repository_navigation.time.monotonic', side_effect=[0, 0.1, 30]):
            with self.assertRaises(TimeoutError):
                open_repository_dialog(driver)
        driver.wait.assert_called_once()
        driver.request.assert_not_called()

    def test_missing_control_stops_at_the_deadline_without_clicking(self):
        driver = self.driver(None)
        with patch('native_repository_navigation.time.monotonic', side_effect=[0, 0, 0, 30]), \
                patch('native_repository_navigation.time.sleep'):
            with self.assertRaises(TimeoutError):
                open_repository_dialog(driver)
        driver.request.assert_not_called()


if __name__ == '__main__':
    unittest.main()
