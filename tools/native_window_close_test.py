"""Safety gates for standard X11 close requests to owned test processes."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import native_window_close as close


class OwnedWindowCloseTests(unittest.TestCase):
    def test_exact_executable_binding_refuses_missing_or_multiple_owned_processes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); proc = root / 'proc'; proc.mkdir()
            executable = root / 'owned'; executable.write_bytes(b'owned fixture')
            other = root / 'other'; other.write_bytes(b'other fixture')
            def path(value):
                return proc if str(value) == '/proc' else Path(value)
            with patch.object(close, 'Path', side_effect=path):
                with self.assertRaisesRegex(RuntimeError, 'exactly one'):
                    close.owned_application_pid(executable)
                for pid, target in [(101, executable), (202, other)]:
                    location = proc / str(pid); location.mkdir(); (location / 'exe').symlink_to(target)
                self.assertEqual(close.owned_application_pid(executable), 101)
                location = proc / '303'; location.mkdir(); (location / 'exe').symlink_to(executable)
                with self.assertRaisesRegex(RuntimeError, 'exactly one'):
                    close.owned_application_pid(executable)

    def test_unbound_process_never_loads_xlib_or_sends_a_window_request(self):
        with patch.object(close, 'owned_application_pid', side_effect=RuntimeError('owned binding refused')), \
             patch.object(close.ctypes.util, 'find_library') as lookup, patch.object(close.c, 'CDLL') as library:
            with self.assertRaisesRegex(RuntimeError, 'owned binding refused'):
                close.request_owned_window_close(':owned-fixture', '/owned/program')
            lookup.assert_not_called(); library.assert_not_called()

    def test_missing_xlib_refuses_before_opening_a_connection(self):
        with patch.object(close, 'owned_application_pid', return_value=101), \
             patch.object(close.ctypes.util, 'find_library', return_value=None), patch.object(close.c, 'CDLL') as library:
            with self.assertRaisesRegex(RuntimeError, 'libX11 is required'):
                close.request_owned_window_close(':owned-fixture', '/owned/program')
            library.assert_not_called()

    def test_close_target_refuses_hidden_unviewable_popup_and_input_only_windows(self):
        attributes = close._WindowAttributes()
        attributes.map_state = 2; attributes.window_class = 1
        attributes.width = 1440; attributes.height = 900
        self.assertTrue(close._visible_regular_window(attributes))
        for name, value in [('map_state', 0), ('map_state', 1), ('window_class', 2),
                            ('override_redirect', 1), ('width', 0), ('height', 0)]:
            previous = getattr(attributes, name); setattr(attributes, name, value)
            self.assertFalse(close._visible_regular_window(attributes), (name, value))
            setattr(attributes, name, previous)

    def test_process_state_handles_names_with_parentheses_and_does_not_treat_zombies_as_running(self):
        with tempfile.TemporaryDirectory() as directory:
            stat = Path(directory) / 'stat'
            with patch.object(close, 'Path', return_value=stat):
                self.assertFalse(close.process_running(101))
                for state in ['S', 'R', 'Z', 'X']:
                    stat.write_text(f'101 (owned (fixture) process) {state} 0 0 0\n')
                    self.assertEqual(close.process_running(101), state in ['S', 'R'])


if __name__ == '__main__':
    unittest.main()
