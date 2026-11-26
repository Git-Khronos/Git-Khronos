"""Navigation-only stale refusal handling must never replay uncertain writes."""
import json
from http.client import RemoteDisconnected
import unittest
from unittest.mock import ANY, call, patch
from urllib.error import URLError

from native_acceptance import Driver
from native_webdriver_errors import stale_element_refusal

ELEMENT = 'element-6066-11e4-a52e-4f735466cecf'
ELIGIBILITY = ':not(:disabled, [aria-disabled="true"], [inert], [inert] *)'


class NativeNavigationTests(unittest.TestCase):
    def driver(self):
        driver = Driver('http://127.0.0.1:1')
        driver.session = 'owned'
        return driver

    def test_navigation_reacquires_after_explicit_stale_click_refusal(self):
        for wrapped in (False, True):
            with self.subTest(wrapped=wrapped):
                driver = self.driver()
                detail = {'error': 'stale element reference'}
                if wrapped:
                    detail = {'value': detail}
                stale = RuntimeError(json.dumps(detail))
                with patch.object(driver, 'request', side_effect=[
                    {ELEMENT: 'outgoing'}, stale, None,
                ]) as request, patch.object(driver, 'wait', return_value=[{ELEMENT: 'current'}]):
                    driver.click_navigation('[aria-label="New repository tab"]')
                self.assertEqual(request.call_args_list, [
                    call('POST', '/session/owned/element', {'using': 'css selector',
                        'value': ':is([aria-label="New repository tab"])' + ELIGIBILITY}),
                    call('POST', '/session/owned/element/outgoing/click', {}),
                    call('POST', '/session/owned/element/current/click', {}),
                ])

    def test_scrolled_navigation_repeats_fresh_lookup_and_paint_checks(self):
        driver = self.driver()
        geometry = {'interactable': True}
        stale = RuntimeError(json.dumps({'error': 'stale element reference'}))
        with patch.object(driver, 'script', return_value=[{ELEMENT: 'old'}]) as lookup, \
                patch.object(driver, 'request', side_effect=[geometry, stale, geometry, None]) as request, \
                patch.object(driver, 'wait', return_value=[{ELEMENT: 'new'}]):
            self.assertEqual(driver.click_navigation('button', 'Browse GitLab projects', scroll=True), geometry)
        lookup.assert_called_once()
        self.assertEqual(request.call_args_list[0].args[2]['args'], [{ELEMENT: 'old'}])
        self.assertEqual(request.call_args_list[2].args[2]['args'], [{ELEMENT: 'new'}])
        self.assertEqual(request.call_args_list[1].args[1], '/session/owned/element/old/click')
        self.assertEqual(request.call_args_list[3].args[1], '/session/owned/element/new/click')

    def test_initial_readiness_wait_captures_the_element_without_an_early_click(self):
        for count in (1, 2):
            with self.subTest(count=count):
                driver = self.driver()
                candidates = [{ELEMENT: str(index)} for index in range(count)]
                with patch.object(driver, 'script', side_effect=[[], candidates]) as poll, \
                        patch.object(driver, '_click_scrolled_element') as click, \
                        patch('native_acceptance.time.sleep'):
                    if count == 1:
                        driver.click_navigation('button', 'Browse GitLab projects', scroll=True, wait_for_ready=True)
                        click.assert_called_once_with(candidates[0], deadline=ANY)
                    else:
                        with self.assertRaisesRegex(ValueError, 'ready navigation control'):
                            driver.click_navigation('button', 'Browse GitLab projects', scroll=True, wait_for_ready=True)
                        click.assert_not_called()
                self.assertEqual(poll.call_count, 2)
                self.assertIn('Browse GitLab projects', poll.call_args.args[0])

    def test_ready_lookup_and_stale_replacement_use_the_same_eligibility(self):
        driver = self.driver()
        old, new = {ELEMENT: 'outgoing'}, {ELEMENT: 'replacement'}
        stale = RuntimeError(json.dumps({'error': 'stale element reference'}))
        with patch.object(driver, 'script', side_effect=[[], [old], [], [new]]) as poll, \
                patch.object(driver, '_click_scrolled_element', side_effect=[stale, None]) as click, \
                patch('native_acceptance.time.sleep'):
            driver.click_navigation('button', 'Browse GitLab projects', scroll=True, wait_for_ready=True)
        self.assertEqual(click.call_args_list, [call(old, deadline=ANY), call(new, deadline=ANY)])
        scripts = [invocation.args[0] for invocation in poll.call_args_list]
        self.assertEqual(len(scripts), 4)
        self.assertEqual(len(set(scripts)), 1)
        self.assertIn(json.dumps(':is(button)' + ELIGIBILITY), scripts[0])

    def test_ready_navigation_does_not_dispatch_when_scrolling_uses_its_budget(self):
        driver = self.driver()
        with patch.object(driver, 'wait', return_value=[{ELEMENT: 'owned'}]), \
                patch.object(driver, 'request', return_value={'interactable': True}) as request, \
                patch('native_acceptance.time.monotonic', side_effect=[10, 11, 13]):
            with self.assertRaisesRegex(TimeoutError, 'deadline expired before WebDriver dispatch'):
                driver.click_navigation('button', 'Browse projects', scroll=True, wait_for_ready=True)
        request.assert_called_once()
        self.assertEqual(request.call_args.args[1], '/session/owned/execute/async')
        self.assertEqual(request.call_args.kwargs, {'timeout': 2})

    def test_text_navigation_uses_the_native_text_click_helper(self):
        driver = self.driver()
        stale = RuntimeError(json.dumps({'value': {'error': 'stale element reference'}}))
        with patch.object(driver, 'click_text', side_effect=stale) as click, \
                patch.object(driver, 'wait', return_value=[{ELEMENT: 'new'}]), \
                patch.object(driver, '_click_element') as replacement:
            driver.click_navigation('[role=tab]', 'Clone')
        click.assert_called_once_with(':is([role=tab])' + ELIGIBILITY, 'Clone')
        replacement.assert_called_once_with({ELEMENT: 'new'})

    def test_stale_navigation_waits_for_a_replacement_but_refuses_ambiguity(self):
        stale = RuntimeError(json.dumps({'error': 'stale element reference'}))
        for count in (1, 2):
            with self.subTest(count=count):
                driver = self.driver()
                candidates = [{ELEMENT: str(index)} for index in range(count)]
                with patch.object(driver, 'click_text', side_effect=stale) as click, \
                        patch.object(driver, 'script', side_effect=[[], [], candidates]) as poll, \
                        patch.object(driver, '_click_element') as replacement, \
                        patch('native_acceptance.time.sleep'):
                    if count == 1:
                        driver.click_navigation('[role=tab]', 'Clone')
                    else:
                        with self.assertRaisesRegex(ValueError, 'replacement navigation control'):
                            driver.click_navigation('[role=tab]', 'Clone')
                self.assertEqual(poll.call_count, 3)
                click.assert_called_once()
                if count == 1:
                    replacement.assert_called_once_with(candidates[0])
                else:
                    replacement.assert_not_called()

    def test_navigation_never_replays_lost_or_other_error_replies(self):
        errors = [RemoteDisconnected('lost reply'), URLError('lost connection'),
                  RuntimeError('stale element reference'),
                  RuntimeError(json.dumps({'error': 'element click intercepted'})),
                  RuntimeError(json.dumps({'error': 'element not interactable'})),
                  RuntimeError(json.dumps({'error': 'unknown error'})), ValueError('ambiguous control')]
        for error in errors:
            with self.subTest(error=str(error)):
                driver = self.driver()
                with patch.object(driver, 'click', side_effect=error) as click:
                    with self.assertRaises(type(error)) as failure:
                        driver.click_navigation('button')
                self.assertIs(failure.exception, error)
                click.assert_called_once_with(':is(button)' + ELIGIBILITY)

    def test_a_lost_replacement_click_reply_does_not_reopen_recovery(self):
        driver = self.driver()
        stale = RuntimeError(json.dumps({'error': 'stale element reference'}))
        lost = RemoteDisconnected('lost replacement click reply')
        with patch.object(driver, 'click', side_effect=stale), \
                patch.object(driver, 'wait', return_value=[{ELEMENT: 'replacement'}]) as poll, \
                patch.object(driver, '_click_element', side_effect=lost) as click:
            with self.assertRaises(RemoteDisconnected) as failure:
                driver.click_navigation('button')
        self.assertIs(failure.exception, lost)
        poll.assert_called_once()
        click.assert_called_once_with({ELEMENT: 'replacement'})

    def test_bounded_navigation_retries_raise_the_original_refusal(self):
        driver = self.driver()
        error = RuntimeError(json.dumps({'error': 'stale element reference'}))
        with patch.object(driver, 'click', side_effect=error) as click, \
                patch('native_acceptance.time.monotonic', side_effect=[0, 3]):
            with self.assertRaises(RuntimeError) as failure:
                driver.click_navigation('button')
        self.assertIs(failure.exception, error)
        click.assert_called_once()

    def test_generic_write_click_is_still_never_retried(self):
        driver = self.driver()
        error = RuntimeError(json.dumps({'error': 'stale element reference'}))
        with patch.object(driver, 'request', side_effect=[{ELEMENT: 'submit'}, error]) as request:
            with self.assertRaises(RuntimeError) as failure:
                driver.click('button[type=submit]')
        self.assertIs(failure.exception, error)
        self.assertEqual(request.call_count, 2)

    def test_no_navigation_retry_bypasses_paint_or_uniqueness_refusals(self):
        driver = self.driver()
        for geometry in ({'interactable': False}, None):
            with self.subTest(geometry=geometry), \
                    patch.object(driver, 'script', return_value=[{ELEMENT: 'obscured'}]) as lookup, \
                    patch.object(driver, 'request', return_value=geometry) as request:
                with self.assertRaisesRegex(RuntimeError, 'not interactable'):
                    driver.click_navigation('button', 'Browse projects', scroll=True)
                lookup.assert_called_once()
                request.assert_called_once()


class WebDriverRefusalTests(unittest.TestCase):
    def test_only_exact_structured_stale_refusals_match(self):
        for value in [None, [], 'stale element reference', {'error': 'unknown error'},
                      {'message': 'stale element reference'}, {'value': {'error': 'element click intercepted'}}]:
            with self.subTest(value=value):
                self.assertFalse(stale_element_refusal(RuntimeError(json.dumps(value))))
        self.assertFalse(stale_element_refusal(RemoteDisconnected('stale element reference')))
        for detail in [{'error': 'stale element reference'}, {'value': {'error': 'stale element reference'}}]:
            self.assertTrue(stale_element_refusal(RuntimeError(json.dumps(detail))))


if __name__ == '__main__':
    unittest.main()
