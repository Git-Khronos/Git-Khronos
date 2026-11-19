"""Modifier actions must remain balanced and never replay an uncertain command."""
from http.client import RemoteDisconnected
import unittest
from unittest.mock import patch

from native_acceptance import Driver
from native_setup_keyboard_scenarios import _chord


class SetupKeyboardActionTests(unittest.TestCase):
    def driver(self):
        driver = Driver('http://127.0.0.1:1')
        driver.session = 'owned'
        return driver

    def test_shift_commit_chord_releases_both_modifiers_in_one_delivery(self):
        driver = self.driver()
        with patch.object(driver, 'request') as request:
            _chord(driver, '\ue007', shift=True)
        request.assert_called_once_with('POST', '/session/owned/actions', {'actions': [{
            'type': 'key', 'id': 'native-keyboard', 'actions': [
                {'type': 'keyDown', 'value': '\ue009'},
                {'type': 'keyDown', 'value': '\ue008'},
                {'type': 'keyDown', 'value': '\ue007'},
                {'type': 'keyUp', 'value': '\ue007'},
                {'type': 'keyUp', 'value': '\ue008'},
                {'type': 'keyUp', 'value': '\ue009'},
            ],
        }]})

    def test_a_lost_command_reply_is_not_replayed(self):
        driver = self.driver()
        error = RemoteDisconnected('Owned command reply lost')
        with patch.object(driver, 'request', side_effect=error) as request:
            with self.assertRaises(RemoteDisconnected) as raised:
                _chord(driver, '\ue007')
        self.assertIs(raised.exception, error)
        self.assertEqual(request.call_count, 1)


if __name__ == '__main__':
    unittest.main()
