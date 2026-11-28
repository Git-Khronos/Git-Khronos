import unittest

from native_application_updates_scenarios import public_update_expectations


class PublicUpdateExpectationTests(unittest.TestCase):
    def test_live_modes_are_explicit_and_require_trust(self):
        baseline = {'GIT_KHRONOS_NATIVE_CHECK_PUBLIC_BASELINE': '1'}
        update = {'GIT_KHRONOS_NATIVE_EXPECT_PUBLIC_UPDATE': '0.1.7'}
        self.assertEqual(public_update_expectations({}, False), (False, None))
        self.assertEqual(public_update_expectations(baseline, True), (True, None))
        self.assertEqual(public_update_expectations(update, True), (False, '0.1.7'))
        for mode in (baseline, update):
            with self.assertRaisesRegex(RuntimeError, 'require.*UPDATE_TRUST'):
                public_update_expectations(mode, False)
        with self.assertRaisesRegex(RuntimeError, 'not both'):
            public_update_expectations(baseline | update, True)

    def test_only_stable_version_values_are_accepted(self):
        for invalid in ('', 'v0.1.7', '0.1.7-rc.1', '0.01.7', '0.1.7\n'):
            with self.subTest(invalid=invalid), self.assertRaisesRegex(RuntimeError, 'stable x.y.z'):
                public_update_expectations({'GIT_KHRONOS_NATIVE_EXPECT_PUBLIC_UPDATE': invalid}, True)
