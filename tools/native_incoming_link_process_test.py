import unittest

from native_incoming_link_scenarios import singleton_owner_pid


class SingletonObservationTest(unittest.TestCase):
    def setUp(self):
        self.owner = dict(pid=42, state='S', onPrivateBus=True, ownsBusName=True)

    def observation(self, *extra):
        return dict(ownerPid=42, processes=[self.owner, *extra])

    def test_only_an_observed_exit_or_exec_can_drop_a_candidate(self):
        observation = self.observation(
            dict(pid=52, exitedWhileInspected=True),
            dict(pid=53, changedExecutableWhileInspected=True),
        )
        self.assertEqual(singleton_owner_pid(observation), 42)

    def test_live_or_uninspectable_extra_processes_still_fail(self):
        for process in (
            dict(pid=52, state='S', onPrivateBus=True, ownsBusName=False),
            dict(pid=52, inspectionDenied=True),
        ):
            with self.subTest(process=process):
                self.assertIsNone(singleton_owner_pid(self.observation(process)))

    def test_matching_pid_without_private_bus_ownership_does_not_pass(self):
        for change in (dict(onPrivateBus=False), dict(ownsBusName=False), dict(state='Z')):
            with self.subTest(change=change):
                self.assertIsNone(singleton_owner_pid(dict(ownerPid=42, processes=[self.owner | change])))
        self.assertIsNone(singleton_owner_pid(dict(ownerPid=52, processes=[self.owner])))
