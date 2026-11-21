from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, call, patch

from native_folder_picker import _PickerKeyboard, respond_to_owned_picker


class OwnedFolderPickerTests(unittest.TestCase):
    def setUp(self):
        self.server = SimpleNamespace(args=['Xvfb', '-displayfd', '1'], pid=123, poll=MagicMock(return_value=None))
        self.display = (':42', self.server)
        self.owner = MagicMock(return_value=789)
        self.keyboard = MagicMock()
        self.keyboard.picker.return_value = 456
        self.title = 'Fixture folder picker'

    def test_refuses_an_unowned_display_or_folder_before_connecting(self):
        with (TemporaryDirectory() as private, TemporaryDirectory() as outside,
              patch('native_pointer.os.getpgid', return_value=123),
              patch('native_folder_picker._PickerKeyboard') as factory):
            with self.assertRaisesRegex(RuntimeError, 'owned private Xvfb'):
                respond_to_owned_picker(None, self.owner, self.title, private)
            with self.assertRaisesRegex(RuntimeError, 'only visible entry'):
                respond_to_owned_picker(self.display, self.owner, self.title, private, outside)
            factory.assert_not_called()
            self.owner.assert_not_called()

    def test_refuses_changed_application_or_changed_window_before_input(self):
        with patch('native_pointer.os.getpgid', return_value=123), patch('native_folder_picker._PickerKeyboard', return_value=self.keyboard):
            for reason in ('application', 'window'):
                with self.subTest(reason=reason):
                    self.owner.side_effect = [789, 790 if reason == 'application' else 789]
                    self.keyboard.picker.side_effect = [456, 457 if reason == 'window' else 456]
                    with self.assertRaisesRegex(RuntimeError, 'changed before input'):
                        respond_to_owned_picker(self.display, self.owner, self.title, '/unused')
            self.keyboard.focus_picker.assert_not_called()
            self.keyboard.key.assert_not_called()
            self.assertEqual(self.keyboard.close.call_count, 2)

    def test_never_cancels_a_picker_that_changes_after_focus(self):
        self.keyboard.picker.side_effect = [456, 456, 457]
        with (patch('native_pointer.os.getpgid', return_value=123),
              patch('native_folder_picker._PickerKeyboard', return_value=self.keyboard),
              patch('native_folder_picker.time.sleep')):
            with self.assertRaisesRegex(RuntimeError, 'changed while waiting for GTK'):
                respond_to_owned_picker(self.display, self.owner, self.title, '/unused')
        self.keyboard.focus_picker.assert_called_once_with(456)
        self.keyboard.key.assert_not_called()

    def test_selects_owned_path_once_then_cancels_separate_picker(self):
        with (TemporaryDirectory() as root, patch('native_pointer.os.getpgid', return_value=123),
              patch('native_folder_picker._PickerKeyboard', return_value=self.keyboard),
              patch('native_folder_picker.time.sleep')):
            folder = Path(root) / 'home' / 'moved checkout'
            folder.mkdir(parents=True)
            delivery = respond_to_owned_picker(self.display, self.owner, self.title, root, folder)
            self.assertEqual(delivery, {'pid': 789, 'windowId': 456, 'submitKeySent': True})
            self.assertEqual(self.keyboard.key.call_args_list, [
                call(456, 'Home', 'Alt_L'), call(456, 'Home'), call(456, 'o', 'Alt_L'),
            ])
            self.keyboard.key.reset_mock()
            delivery = respond_to_owned_picker(self.display, self.owner, self.title, root)
            self.assertFalse(delivery['submitKeySent'])
            self.keyboard.key.assert_called_once_with(456, 'Escape')

    def test_never_submits_after_the_fixture_home_gains_another_visible_entry(self):
        with (TemporaryDirectory() as root,
              patch('native_pointer.os.getpgid', return_value=123),
              patch('native_folder_picker._PickerKeyboard', return_value=self.keyboard),
              patch('native_folder_picker.time.sleep')):
            folder = Path(root) / 'home' / 'moved checkout'
            folder.mkdir(parents=True)
            self.keyboard.key.side_effect = lambda *_: (folder.parent / 'other').mkdir(exist_ok=True)
            with self.assertRaisesRegex(RuntimeError, 'only visible entry'):
                respond_to_owned_picker(self.display, self.owner, self.title, root, folder)
            self.assertNotIn(call(456, 'o', 'Alt_L'), self.keyboard.key.call_args_list)

    def test_initial_location_does_not_navigate_to_fixture_home(self):
        with (TemporaryDirectory() as root,
              patch('native_pointer.os.getpgid', return_value=123),
              patch('native_folder_picker._PickerKeyboard', return_value=self.keyboard),
              patch('native_folder_picker.time.sleep')):
            folder = Path(root) / 'nearby' / 'moved checkout'
            folder.mkdir(parents=True)
            respond_to_owned_picker(self.display, self.owner, self.title, root, folder, from_initial_location=True)
            self.assertEqual(self.keyboard.key.call_args_list, [call(456, 'Home'), call(456, 'o', 'Alt_L')])

    def test_releases_keys_after_an_uncertain_key_press(self):
        picker = object.__new__(_PickerKeyboard)
        picker.display = 'owned'
        picker.require_focus = MagicMock()
        picker._code = MagicMock(side_effect=[40, 29])
        picker.xtest = MagicMock()
        picker.xtest.XTestFakeKeyEvent.side_effect = [1, 0, 1, 1]
        picker.sync = MagicMock()
        with self.assertRaisesRegex(RuntimeError, 'press'):
            picker.key(456, 'l', 'Control_L')
        self.assertEqual(picker.xtest.XTestFakeKeyEvent.call_args_list, [
            call('owned', 29, 1, 0), call('owned', 40, 1, 0),
            call('owned', 40, 0, 0), call('owned', 29, 0, 0),
        ])
