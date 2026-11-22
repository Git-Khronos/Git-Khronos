use super::*;

fn offered(model: &mut UpdateModel, origin: Origin, token: &str) {
    let lease = model.begin_check(origin).unwrap();
    assert_eq!(lease.origin, origin);
    assert!(model.checked(
        lease,
        Some(UpdateOffer {
            token: token.into(),
            version: "0.2.0".into()
        })
    ));
}
fn ready(model: &mut UpdateModel, origin: Origin) {
    offered(model, origin, "owned-offer");
    let lease = model.begin_download("owned-offer", origin).unwrap();
    assert!(model.downloaded_and_verified(lease));
}

#[test]
fn manual_updates_do_not_require_automatic_consent_and_install_only_once() {
    let mut model = UpdateModel::new(UpdatePreferences::default(), true);
    assert!(!model.preferences.automatic);
    ready(&mut model, Origin::Manual);
    assert!(!model.can_automatically_install());
    let attempt = model
        .prepare_install("owned-offer", Origin::Manual, true, "owned-attempt".into())
        .unwrap();
    assert!(model.preferences.attempt.is_none());
    assert!(attempt.preferences(&model.preferences).attempt.is_some());
    assert!(model.accept_persisted_install(attempt, true));
    assert!(model.busy());
    assert!(model.finish_install("owned-attempt", InstallOutcome::Confirmed, true));
    assert_eq!(model.phase, UpdatePhase::Installed);
    assert!(
        model
            .prepare_install("owned-offer", Origin::Manual, true, "again".into())
            .is_err()
    );
}

#[test]
fn missing_publisher_trust_refuses_checks_and_automatic_opt_in() {
    let mut model = UpdateModel::new(UpdatePreferences::default(), false);
    assert_eq!(model.phase, UpdatePhase::Unconfigured);
    assert!(model.set_automatic(true).is_err());
    assert!(!model.preferences.automatic);
    assert!(model.begin_check(Origin::Manual).is_err());
    model.set_automatic(false).unwrap();
}

#[test]
fn a_stale_check_or_offer_cannot_complete_or_dispatch_a_newer_intent() {
    let mut model = UpdateModel::new(UpdatePreferences::default(), true);
    let old = model.begin_check(Origin::Manual).unwrap();
    assert!(model.begin_check(Origin::Manual).is_err());
    assert!(model.read_failed(old));
    offered(&mut model, Origin::Manual, "new-offer");
    assert!(!model.checked(old, None));
    assert!(model.begin_download("old-offer", Origin::Manual).is_err());
    assert_eq!(model.phase, UpdatePhase::Available);
}

#[test]
fn failed_verification_never_authorizes_installation_or_double_completion() {
    let mut model = UpdateModel::new(UpdatePreferences::default(), true);
    offered(&mut model, Origin::Manual, "owned-offer");
    let lease = model.begin_download("owned-offer", Origin::Manual).unwrap();
    assert!(model.read_failed(lease));
    assert!(!model.downloaded_and_verified(lease));
    assert!(
        model
            .prepare_install("owned-offer", Origin::Manual, true, "attempt".into())
            .is_err()
    );
    assert!(!model.verified);
}

#[test]
fn opting_out_and_back_in_retires_the_older_automatic_download() {
    let mut model = UpdateModel::new(UpdatePreferences::default(), true);
    model.set_automatic(true).unwrap();
    let old = model.automatic_origin();
    ready(&mut model, old);
    assert!(model.can_automatically_install());
    model.set_automatic(false).unwrap();
    model.set_automatic(true).unwrap();
    assert!(!model.can_automatically_install());
    assert!(!model.origin_current(old));
    assert!(
        model
            .prepare_install(
                "owned-offer",
                model.automatic_origin(),
                true,
                "attempt".into()
            )
            .is_err()
    );
    assert!(
        model
            .prepare_install("owned-offer", Origin::Manual, true, "manual-attempt".into())
            .is_ok()
    );
}

#[test]
fn native_busy_state_refuses_install_before_any_durable_attempt() {
    let mut model = UpdateModel::new(UpdatePreferences::default(), true);
    ready(&mut model, Origin::Manual);
    assert!(
        model
            .prepare_install("owned-offer", Origin::Manual, false, "attempt".into())
            .is_err()
    );
    assert!(model.preferences.attempt.is_none());
    assert_eq!(model.phase, UpdatePhase::Ready);
}

#[test]
fn disabling_automatic_mode_cannot_discard_an_already_accepted_install_receipt() {
    let mut model = UpdateModel::new(UpdatePreferences::default(), true);
    model.set_automatic(true).unwrap();
    let origin = model.automatic_origin();
    ready(&mut model, origin);
    let attempt = model
        .prepare_install("owned-offer", origin, true, "attempt".into())
        .unwrap();
    assert!(model.accept_persisted_install(attempt, true));
    model.set_automatic(false).unwrap();
    assert!(model.preferences.attempt.is_some());
    assert!(model.finish_install("attempt", InstallOutcome::Confirmed, false));
    assert_eq!(model.phase, UpdatePhase::Installed);
    assert!(
        model.preferences.attempt.is_some(),
        "Unconfirmed receipt persistence must remain distinct from actual success"
    );
}

#[test]
fn an_uncertain_install_survives_restart_and_only_native_confirmation_resolves_it() {
    let mut model = UpdateModel::new(UpdatePreferences::default(), true);
    ready(&mut model, Origin::Manual);
    let attempt = model
        .prepare_install("owned-offer", Origin::Manual, true, "attempt".into())
        .unwrap();
    assert!(model.accept_persisted_install(attempt, true));
    assert!(!model.finish_install("foreign", InstallOutcome::Confirmed, true));
    assert!(model.finish_install("attempt", InstallOutcome::Uncertain, true));
    let mut restarted = UpdateModel::new(model.preferences, true);
    assert_eq!(restarted.phase, UpdatePhase::Uncertain);
    assert!(restarted.begin_check(Origin::Manual).is_err());
    assert!(!restarted.reconcile_confirmed_install("0.1.6", "0.1.6", true));
    assert!(restarted.reconcile_confirmed_install("0.2.0", "0.1.6", true));
    assert_eq!(restarted.phase, UpdatePhase::Installed);
    assert!(restarted.preferences.attempt.is_none());
}

#[test]
fn authorization_refusal_defers_automatic_replay_but_keeps_explicit_manual_retry() {
    let mut model = UpdateModel::new(UpdatePreferences::default(), true);
    model.set_automatic(true).unwrap();
    let origin = model.automatic_origin();
    ready(&mut model, origin);
    let attempt = model
        .prepare_install("owned-offer", origin, true, "attempt".into())
        .unwrap();
    assert!(model.accept_persisted_install(attempt, true));
    assert!(model.finish_install("attempt", InstallOutcome::RefusedBeforeExecution, true));
    assert!(!model.can_automatically_install());
    assert!(
        model
            .prepare_install("owned-offer", Origin::Manual, true, "manual-retry".into())
            .is_ok()
    );
    assert!(model.begin_check(origin).is_err());
    // Restart releases the cached bytes, not the saved version deferral.
    let mut restarted = UpdateModel::new(model.preferences, true);
    let restarted_origin = restarted.automatic_origin();
    offered(&mut restarted, restarted_origin, "fresh-offer");
    assert!(restarted.begin_download("fresh-offer", restarted_origin).is_err());
    assert!(restarted.begin_download("fresh-offer", Origin::Manual).is_ok());
}

#[test]
fn preferences_are_atomic_bounded_and_invalid_input_is_not_default_consent() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("update-preferences.json");
    assert_eq!(
        load_preferences(&path).unwrap(),
        UpdatePreferences::default()
    );
    let preferences = UpdatePreferences {
        automatic: true,
        deferred_version: Some("0.2.0".into()),
        attempt: None,
    };
    save_preferences(&path, &preferences).unwrap();
    assert_eq!(load_preferences(&path).unwrap(), preferences);
    save_preferences(&path, &UpdatePreferences::default()).unwrap();
    assert!(!load_preferences(&path).unwrap().automatic);
    std::fs::write(&path, b"{invalid").unwrap();
    assert!(load_preferences(&path).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"{invalid");
    std::fs::write(&path, vec![b' '; 16 * 1024 + 1]).unwrap();
    assert!(load_preferences(&path).is_err());
}

#[test]
fn a_prepared_receipt_cannot_authorize_a_replacement_offer_or_new_native_busy_state() {
    let mut model = UpdateModel::new(UpdatePreferences::default(), true);
    ready(&mut model, Origin::Manual);
    let old = model
        .prepare_install("owned-offer", Origin::Manual, true, "old-attempt".into())
        .unwrap();
    ready(&mut model, Origin::Manual);
    assert!(!model.accept_persisted_install(old, true));
    let current = model
        .prepare_install(
            "owned-offer",
            Origin::Manual,
            true,
            "current-attempt".into(),
        )
        .unwrap();
    assert!(!model.accept_persisted_install(current, false));
    assert_eq!(model.phase, UpdatePhase::Ready);
    assert!(model.preferences.attempt.is_none());
    assert!(
        model
            .prepare_install("owned-offer", Origin::Manual, true, String::new())
            .is_err()
    );
}

#[test]
fn installation_preflight_failure_retires_verified_bytes_without_creating_a_receipt() {
    let mut model = UpdateModel::new(UpdatePreferences::default(), true);
    model.set_automatic(true).unwrap();
    let origin = model.automatic_origin();
    ready(&mut model, origin);
    assert!(!model.install_preflight_failed("retired-offer"));
    assert_eq!(model.phase, UpdatePhase::Ready);
    assert!(model.can_automatically_install());
    assert!(model.install_preflight_failed("owned-offer"));
    assert_eq!(model.phase, UpdatePhase::Failed);
    assert!(!model.can_automatically_install());
    assert!(model.preferences.attempt.is_none());
    assert!(
        model
            .prepare_install("owned-offer", Origin::Manual, true, "attempt".into())
            .is_err()
    );
    assert!(!model.install_preflight_failed("owned-offer"));
    ready(&mut model, Origin::Manual);
    assert!(
        model
            .prepare_install("owned-offer", Origin::Manual, true, "retry".into())
            .is_ok()
    );
}
