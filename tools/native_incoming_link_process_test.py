import signal
import subprocess
import unittest
from unittest.mock import Mock, patch

from native_incoming_link_scenarios import check_secondary_activation, observe_settled_singleton, restore_incoming_link_session, singleton_owner_pid


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


class SecondaryActivationEvidenceTest(unittest.TestCase):
    def setUp(self):
        self.owner = dict(ownerPid=42, processes=[dict(pid=42, state='S', onPrivateBus=True, ownsBusName=True)])

    def test_signal_preserves_exit_and_original_primary_without_counting_success(self):
        child = Mock(pid=90, returncode=-signal.SIGSEGV)
        child.communicate.return_value = b'not retained', b''
        evidence = {}
        with self.assertRaisesRegex(AssertionError, '-11'):
            check_secondary_activation(child, lambda: self.owner, evidence, 42)
        self.assertEqual(evidence, dict(secondaryPid=90, exitCode=-signal.SIGSEGV,
                                        terminationSignal='SIGSEGV', after=self.owner))
        child.communicate.assert_called_once_with(timeout=15)
        child.kill.assert_not_called()

    def test_secondary_failure_takes_precedence_over_a_failed_post_exit_observation(self):
        child = Mock(pid=90, returncode=2)
        child.communicate.return_value = b'', b'owned launch refusal'
        evidence = {}
        with self.assertRaisesRegex(AssertionError, 'owned launch refusal'):
            check_secondary_activation(child, Mock(side_effect=OSError('fixture unavailable')), evidence, 42)
        self.assertEqual(evidence, dict(secondaryPid=90, exitCode=2, afterObservationError='OSError'))

    def test_zero_exit_still_requires_the_original_primary_on_the_private_bus(self):
        child = Mock(pid=90, returncode=0)
        child.communicate.return_value = b'', b''
        evidence = {}
        check_secondary_activation(child, lambda: self.owner, evidence, 42)
        self.assertEqual(evidence, dict(secondaryPid=90, exitCode=0, after=self.owner))
        with self.assertRaises(AssertionError):
            check_secondary_activation(child, lambda: dict(ownerPid=None, processes=[]), {}, 42)

    def test_timeout_remains_a_failure_after_the_owned_child_is_reaped(self):
        child = Mock(pid=90, returncode=-signal.SIGKILL)
        child.communicate.side_effect = [subprocess.TimeoutExpired('owned app', 15), (b'', b'')]
        evidence = {}
        with self.assertRaisesRegex(AssertionError, 'did not terminate'):
            check_secondary_activation(child, lambda: self.owner, evidence, 42)
        child.kill.assert_called_once_with()
        self.assertEqual(evidence, dict(secondaryPid=90, exitCode=-signal.SIGKILL, timedOut=True,
                                        terminationSignal='SIGKILL', after=self.owner))
