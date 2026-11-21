import unittest
from unittest.mock import Mock, patch

from native_incoming_link_scenarios import observe_settled_singleton, restore_incoming_link_session, singleton_owner_pid


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

    def test_reobserves_an_owned_child_before_accepting_same_singleton(self):
        initial = self.observation(dict(pid=52, parentPid=42, state='R', onPrivateBus=True, ownsBusName=False))
        evidence = {}
        probe = Mock(side_effect=[initial, self.observation()])
        with patch('native_incoming_link_scenarios.time.sleep'):
            self.assertEqual(observe_settled_singleton(probe, evidence, 'before'), 42)
        self.assertEqual(evidence, dict(beforeInitialObservation=initial, before=self.observation()))

    def test_persistent_or_unrelated_process_and_changed_owner_still_fail(self):
        owned_child = self.observation(dict(pid=52, parentPid=42, state='R', onPrivateBus=True, ownsBusName=False))
        for initial in (owned_child, self.observation(dict(pid=52, parentPid=77, onPrivateBus=True, ownsBusName=False))):
            probe = Mock(return_value=initial)
            with patch('native_incoming_link_scenarios.time.monotonic', side_effect=[0, 0, 1]), \
                    patch('native_incoming_link_scenarios.time.sleep'):
                self.assertIsNone(observe_settled_singleton(probe, {}, 'before'))
            self.assertEqual(probe.call_count, 2 if initial is owned_child else 1)
        new_owner = dict(ownerPid=52, processes=[self.owner | {'pid': 52}])
        with patch('native_incoming_link_scenarios.time.sleep'):
            self.assertIsNone(observe_settled_singleton(Mock(side_effect=[owned_child, new_owner]), {}, 'before'))


class IncomingLinkCleanupTest(unittest.TestCase):
    def test_an_absent_session_is_not_contacted_after_failed_restart(self):
        driver = Mock(session=None)
        report = {}
        restore_incoming_link_session(driver, '/owned/repository', report, during_failure=True)
        driver.invoke.assert_not_called()
        self.assertEqual(report['incomingLinkCleanup'], 'no-active-session')

    def test_cleanup_does_not_mask_primary_failure_but_otherwise_must_succeed(self):
        driver = Mock(session='owned-session')
        driver.invoke.side_effect = RuntimeError('invalid session id')
        report = {}
        restore_incoming_link_session(driver, '/owned/repository', report, during_failure=True)
        self.assertEqual(report['incomingLinkCleanup'], 'RuntimeError')
        with self.assertRaisesRegex(RuntimeError, 'invalid session id'):
            restore_incoming_link_session(driver, '/owned/repository', {}, during_failure=False)
