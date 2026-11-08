import ctypes as c
import os
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

from native_acceptance import Driver
from native_pointer import _X11Pointer, owned_right_press
from native_window_close import _WindowAttributes


class OwnedPointerTests(unittest.TestCase):
    def setUp(self):
        self.server = SimpleNamespace(args=['Xvfb', '-displayfd', '1'], pid=123,
                                      poll=MagicMock(return_value=None))
        self.display = (':42', self.server)
        self.executable = Path('/owned/package/usr/bin/git-khronos')

    def test_press_checks_display_and_window_then_releases_once(self):
        pointer = MagicMock()
        pointer.require_owned_window.return_value = 456
        with patch('native_pointer.os.getpgid', return_value=123), \
                patch('native_pointer.owned_application_pid', return_value=789) as pid, \
                patch('native_pointer._X11Pointer', return_value=pointer) as factory:
            with owned_right_press(self.display, self.executable, 200, 300) as delivery:
                self.assertEqual(delivery, {'pid': 789, 'windowId': 456, 'x': 200, 'y': 300})
                self.assertEqual(pointer.method_calls, [
                    call.move(200, 300), call.require_owned_window(200, 300, 789), call.button(True)])
        factory.assert_called_once_with(':42')
        self.assertEqual(pid.call_args_list, [call(self.executable), call(self.executable)])
        self.assertEqual(pointer.method_calls, [
            call.move(200, 300), call.require_owned_window(200, 300, 789),
            call.button(True), call.button(False), call.close()])

    def test_releases_after_wait_failure_or_uncertain_press(self):
        for fail_press in (False, True):
            with self.subTest(fail_press=fail_press):
                pointer = MagicMock()
                pointer.require_owned_window.return_value = 456
                if fail_press:
                    pointer.button.side_effect = [RuntimeError('uncertain press'), None]
                with patch('native_pointer.os.getpgid', return_value=123), \
                        patch('native_pointer.owned_application_pid', return_value=789), \
                        patch('native_pointer._X11Pointer', return_value=pointer):
                    with self.assertRaises(RuntimeError):
                        with owned_right_press(self.display, self.executable, 200, 300):
                            raise RuntimeError('context event not observed')
                self.assertEqual(pointer.button.call_args_list, [call(True), call(False)])
                pointer.close.assert_called_once_with()

    def test_refuses_unowned_or_dead_displays_before_opening_x11(self):
        cases = [
            None,
            ('localhost:42', self.server),
            (':42', SimpleNamespace(args=['Xorg', '-displayfd'], pid=123, poll=MagicMock(return_value=None))),
            (':42', SimpleNamespace(args=['Xvfb', '-displayfd'], pid=1, poll=MagicMock(return_value=None))),
            (':42', SimpleNamespace(args=['Xvfb', '-displayfd'], pid=123, poll=MagicMock(return_value=1))),
        ]
        with patch('native_pointer.os.getpgid', return_value=123), \
                patch('native_pointer.owned_application_pid') as pid, \
                patch('native_pointer._X11Pointer') as factory:
            for display in cases:
                with self.subTest(display=display):
                    with self.assertRaises(RuntimeError):
                        with owned_right_press(display, self.executable, 1, 2):
                            self.fail('Unowned display accepted')
            pid.assert_not_called()
            factory.assert_not_called()
        with patch('native_pointer.os.getpgid', return_value=999), \
                patch('native_pointer._X11Pointer') as factory:
            with self.assertRaises(RuntimeError):
                with owned_right_press(self.display, self.executable, 1, 2):
                    self.fail('Unowned process group accepted')
            factory.assert_not_called()

    def test_refuses_changed_owner_before_press(self):
        pointer = MagicMock()
        pointer.require_owned_window.return_value = 456
        with patch('native_pointer.os.getpgid', return_value=123), \
                patch('native_pointer.owned_application_pid', side_effect=[789, 790]), \
                patch('native_pointer._X11Pointer', return_value=pointer):
            with self.assertRaisesRegex(RuntimeError, 'changed before pointer input'):
                with owned_right_press(self.display, self.executable, 1, 2):
                    self.fail('Changed owner accepted')
        pointer.button.assert_not_called()
        pointer.close.assert_called_once_with()

    def test_refuses_wrong_window_before_press(self):
        pointer = MagicMock()
        pointer.require_owned_window.side_effect = RuntimeError('not owned')
        with patch('native_pointer.os.getpgid', return_value=123), \
                patch('native_pointer.owned_application_pid', return_value=789), \
                patch('native_pointer._X11Pointer', return_value=pointer):
            with self.assertRaisesRegex(RuntimeError, 'not owned'):
                with owned_right_press(self.display, self.executable, 1, 2):
                    self.fail('Wrong window accepted')
        pointer.button.assert_not_called()
        pointer.close.assert_called_once_with()

    def test_refuses_display_that_exits_before_press(self):
        pointer = MagicMock()
        self.server.poll.side_effect = [None, 1]
        with patch('native_pointer.os.getpgid', return_value=123), \
                patch('native_pointer.owned_application_pid', return_value=789), \
                patch('native_pointer._X11Pointer', return_value=pointer):
            with self.assertRaisesRegex(RuntimeError, 'changed before pointer input'):
                with owned_right_press(self.display, self.executable, 1, 2):
                    self.fail('Stopped display accepted')
        pointer.button.assert_not_called()
        pointer.close.assert_called_once_with()


class PointerWindowBindingTests(unittest.TestCase):
    def pointer(self, owner=789, visible=True):
        pointer = object.__new__(_X11Pointer)
        pointer.display = 1
        pointer.x = MagicMock()
        pointer.position = MagicMock(return_value=(10, 20, 456))
        pointer.sync = MagicMock()
        pointer.x.XInternAtom.return_value = 55
        owner_value = (c.c_ulong * 1)(owner)

        def attributes(_display, _window, output):
            value = c.cast(output, c.POINTER(_WindowAttributes)).contents
            value.map_state = 2 if visible else 0
            value.window_class = 1
            value.width = 800
            value.height = 600
            return 1

        def window_property(*args):
            c.cast(args[7], c.POINTER(c.c_ulong))[0] = 6
            c.cast(args[8], c.POINTER(c.c_int))[0] = 32
            c.cast(args[9], c.POINTER(c.c_ulong))[0] = 1
            c.cast(args[10], c.POINTER(c.c_ulong))[0] = 0
            c.cast(args[11], c.POINTER(c.c_void_p))[0] = c.cast(owner_value, c.c_void_p)
            return 0

        pointer.x.XGetWindowAttributes.side_effect = attributes
        pointer.x.XGetWindowProperty.side_effect = window_property
        return pointer

    def test_requires_matching_pid_and_visible_regular_window(self):
        pointer = self.pointer()
        self.assertEqual(pointer.require_owned_window(10, 20, 789), 456)
        pointer.x.XFree.assert_called_once()
        for owner, visible in ((790, True), (789, False)):
            with self.subTest(owner=owner, visible=visible):
                pointer = self.pointer(owner, visible)
                with self.assertRaisesRegex(RuntimeError, 'not over the owned visible'):
                    pointer.require_owned_window(10, 20, 789)
                pointer.x.XFree.assert_called_once()

    def test_refuses_wrong_pointer_location_before_reading_window(self):
        for position in ((11, 20, 456), (10, 20, 0)):
            with self.subTest(position=position):
                pointer = self.pointer()
                pointer.position.return_value = position
                with self.assertRaisesRegex(RuntimeError, 'did not reach'):
                    pointer.require_owned_window(10, 20, 789)
                pointer.x.XGetWindowProperty.assert_not_called()


class DriverContextClickTests(unittest.TestCase):
    def setUp(self):
        self.element = {'element-6066-11e4-a52e-4f735466cecf': 'owned-element'}
        self.geometry = {'interactable': True, 'x': 10, 'y': 20, 'scale': 1}
        self.driver = Driver('http://127.0.0.1:1')
        self.driver.session = 'owned-session'
        self.driver.executable = Path('/owned/package/usr/bin/git-khronos')
        self.driver.wait = MagicMock(side_effect=[self.element, True, True])
        self.driver.request = MagicMock(return_value=self.geometry)
        self.driver.script = MagicMock()

    def test_headless_uses_owned_display_and_checks_both_trusted_events(self):
        self.driver.owned_display = (':42', object())
        delivery = {'pid': 789, 'windowId': 456, 'x': 10, 'y': 20}
        press = MagicMock()
        press.return_value.__enter__.return_value = delivery
        with patch('native_pointer.owned_right_press', press):
            self.driver.context_click('.owned-row')
        press.assert_called_once_with(self.driver.owned_display, self.driver.executable, 10, 20)
        self.assertEqual(self.driver.native_pointer_deliveries, [delivery])
        self.assertIn('context', self.driver.wait.call_args_list[1].args[0])
        self.assertIn('release', self.driver.wait.call_args_list[2].args[0])
        self.assertEqual(self.driver.script.call_count, 2)

    def test_visible_session_never_injects_into_inherited_display(self):
        with patch.dict(os.environ, {'DISPLAY': ':0'}), \
                patch('native_pointer.owned_right_press') as press:
            self.driver.context_click('.owned-row')
        press.assert_not_called()
        actions = self.driver.request.call_args_list[-1].args[2]['actions'][0]['actions']
        self.assertEqual([action['type'] for action in actions], ['pointerMove', 'pointerDown', 'pointerUp'])
        self.assertEqual([action.get('button') for action in actions[1:]], [2, 2])
        self.assertEqual(self.driver.native_pointer_deliveries, [])

    def test_unpainted_target_never_sends_input(self):
        self.driver.request.return_value = {'interactable': False}
        with patch('native_pointer.owned_right_press') as press:
            with self.assertRaisesRegex(RuntimeError, 'not interactable'):
                self.driver.context_click('.owned-row')
        press.assert_not_called()
        self.driver.script.assert_not_called()

    def test_failed_event_verification_removes_listeners_and_does_not_replay(self):
        self.driver.owned_display = (':42', object())
        self.driver.wait.side_effect = [self.element, TimeoutError('no trusted context event')]
        press = MagicMock()
        with patch('native_pointer.owned_right_press', press):
            with self.assertRaisesRegex(TimeoutError, 'no trusted context event'):
                self.driver.context_click('.owned-row')
        press.assert_called_once()
        press.return_value.__exit__.assert_called_once()
        self.assertEqual(self.driver.script.call_count, 2)
        self.assertEqual(self.driver.native_pointer_deliveries, [])


if __name__ == '__main__':
    unittest.main()
