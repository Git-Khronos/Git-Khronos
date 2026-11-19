"""Navigation-only stale refusal handling must never replay uncertain writes."""
import json
from http.client import RemoteDisconnected
import unittest
from unittest.mock import call, patch
from urllib.error import URLError

from native_acceptance import Driver
from native_webdriver_errors import stale_element_refusal

ELEMENT = 'element-6066-11e4-a52e-4f735466cecf'


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
                    {ELEMENT: 'outgoing'}, stale, {ELEMENT: 'current'}, None,
                ]) as request, patch('native_acceptance.time.sleep'):
                    driver.click_navigation('[aria-label="New repository tab"]')
                self.assertEqual(request.call_args_list, [
                    call('POST', '/session/owned/element', {'using': 'css selector', 'value': '[aria-label="New repository tab"]'}),
                    call('POST', '/session/owned/element/outgoing/click', {}),
                    call('POST', '/session/owned/element', {'using': 'css selector', 'value': '[aria-label="New repository tab"]'}),
                    call('POST', '/session/owned/element/current/click', {}),
                ])

    def test_scrolled_navigation_repeats_fresh_lookup_and_paint_checks(self):
        driver = self.driver()
        geometry = {'interactable': True}
        stale = RuntimeError(json.dumps({'error': 'stale element reference'}))
        with patch.object(driver, 'script', side_effect=[[{ELEMENT: 'old'}], [{ELEMENT: 'new'}]]) as lookup, \
                patch.object(driver, 'request', side_effect=[geometry, stale, geometry, None]) as request, \
                patch('native_acceptance.time.sleep'):
            self.assertEqual(driver.click_navigation('button', 'Browse GitLab projects', scroll=True), geometry)
        self.assertEqual(lookup.call_count, 2)
        self.assertEqual(request.call_args_list[0].args[2]['args'], [{ELEMENT: 'old'}])
        self.assertEqual(request.call_args_list[2].args[2]['args'], [{ELEMENT: 'new'}])
        self.assertEqual(request.call_args_list[1].args[1], '/session/owned/element/old/click')
        self.assertEqual(request.call_args_list[3].args[1], '/session/owned/element/new/click')

    def test_text_navigation_uses_the_native_text_click_helper(self):
        driver = self.driver()
        stale = RuntimeError(json.dumps({'value': {'error': 'stale element reference'}}))
        with patch.object(driver, 'click_text', side_effect=[stale, None]) as click, \
                patch('native_acceptance.time.sleep'):
            driver.click_navigation('[role=tab]', 'Clone')
        self.assertEqual(click.call_args_list, [call('[role=tab]', 'Clone')] * 2)

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
                click.assert_called_once_with('button')

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
