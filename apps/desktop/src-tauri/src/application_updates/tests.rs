//! Owned public fixtures; no test invokes an installer or uses production trust.
use super::*;

const PAYLOAD: &[u8] = include_bytes!("fixtures/payload");
const SIGNATURE: &str = include_str!("fixtures/payload.sig");
const PUBLIC_KEY: &str = include_str!("fixtures/public.key");

fn updater() -> (
    tauri::App<tauri::test::MockRuntime>,
    tauri_plugin_updater::Updater,
) {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.package_info_mut().version = env!("CARGO_PKG_VERSION").parse().unwrap();
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({"pubkey":PUBLIC_KEY.trim(),"requireSignedVersion":true}),
    );
    let app = tauri::test::mock_builder()
        .plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(PUBLIC_KEY.trim())
                .build(),
        )
        .build(context)
        .unwrap();
    let updater = app
        .updater_builder()
        .target("owned-test-target")
        .endpoints(vec![transport::MANIFEST.parse().unwrap()])
        .unwrap()
        .build()
        .unwrap();
    (app, updater)
}
fn manifest(version: &str, signature: &str) -> serde_json::Value {
    serde_json::json!({"version": version, "url": transport::MANIFEST, "signature": signature.trim()})
}

#[test]
fn application_update_signatures_bind_both_payload_and_announced_version() {
    let (_app, updater) = updater();
    let update = updater
        .restore_update(manifest("0.2.0", SIGNATURE))
        .unwrap()
        .unwrap();
    assert!(update.verify(PAYLOAD).is_ok());
    let mut advertised_key = manifest("0.2.0", SIGNATURE);
    advertised_key["pubkey"] = serde_json::json!(PUBLIC_KEY.trim());
    let wrong_key_updater = _app
        .updater_builder()
        .pubkey(include_str!("fixtures/other-public.key").trim())
        .endpoints(vec![transport::MANIFEST.parse().unwrap()])
        .unwrap()
        .target("owned-test-target")
        .build()
        .unwrap();
    let untrusted = wrong_key_updater
        .restore_update(advertised_key)
        .unwrap()
        .unwrap();
    assert!(
        untrusted.verify(PAYLOAD).is_err(),
        "A manifest-supplied key cannot replace application trust"
    );

    let mut tampered = PAYLOAD.to_vec();
    tampered[5] ^= 1;
    assert!(update.verify(&tampered).is_err());
    let mismatched = updater
        .restore_update(manifest("0.3.0", SIGNATURE))
        .unwrap()
        .unwrap();
    assert!(mismatched.verify(PAYLOAD).is_err());
    let unversioned = updater
        .restore_update(manifest("0.2.0", include_str!("fixtures/unversioned.sig")))
        .unwrap()
        .unwrap();
    assert!(unversioned.verify(PAYLOAD).is_err());
    let malformed = updater
        .restore_update(manifest("0.2.0", "not-a-signature"))
        .unwrap()
        .unwrap();
    assert!(malformed.verify(PAYLOAD).is_err());
}

#[test]
fn application_update_restoration_rejects_old_versions_and_malformed_manifests() {
    let (_app, updater) = updater();
    assert!(
        updater
            .restore_update(manifest("0.0.0", SIGNATURE))
            .unwrap()
            .is_none()
    );
    assert!(
        updater
            .restore_update(manifest(env!("CARGO_PKG_VERSION"), SIGNATURE))
            .unwrap()
            .is_none()
    );
    assert!(
        updater
            .restore_update(serde_json::json!({"version":"not-a-version"}))
            .is_err()
    );
}

#[test]
fn application_update_staging_verifies_before_accepting_a_package_format() {
    let (_app, updater) = updater();
    let update = updater
        .restore_update(manifest("0.2.0", SIGNATURE))
        .unwrap()
        .unwrap();
    assert!(installer::prepare(&update, b"tampered", "appimage").is_err());
    assert!(installer::prepare(&update, PAYLOAD, "unsupported").is_err());
    // Even a signed ELF fixture cannot impersonate a Debian or macOS package.
    assert!(installer::prepare(&update, PAYLOAD, "app").is_err());
    #[cfg(target_os = "linux")]
    {
        assert!(installer::prepare(&update, PAYLOAD, "deb").is_err());
        assert!(installer::prepare(&update, PAYLOAD, "appimage").is_ok());
    }
}

#[cfg(target_os = "linux")]
#[test]
fn application_update_debian_metadata_is_checked_after_real_signature_verification() {
    let (_app, updater) = updater();
    let fixtures: &[(&[u8], &str, bool)] = &[
        (
            include_bytes!("fixtures/matching-amd64.deb"),
            include_str!("fixtures/matching-amd64.deb.sig"),
            cfg!(target_arch = "x86_64"),
        ),
        (
            include_bytes!("fixtures/matching-arm64.deb"),
            include_str!("fixtures/matching-arm64.deb.sig"),
            cfg!(target_arch = "aarch64"),
        ),
        (
            include_bytes!("fixtures/wrong-package.deb"),
            include_str!("fixtures/wrong-package.deb.sig"),
            false,
        ),
        (
            include_bytes!("fixtures/wrong-version.deb"),
            include_str!("fixtures/wrong-version.deb.sig"),
            false,
        ),
    ];
    for (bytes, signature, accepted) in fixtures {
        let update = updater
            .restore_update(manifest("0.2.0", signature))
            .unwrap()
            .unwrap();
        assert!(
            update.verify(bytes).is_ok(),
            "Every fixture is genuinely signed for the announced 0.2.0"
        );
        assert_eq!(installer::prepare(&update, bytes, "deb").is_ok(), *accepted);
    }
}

fn ready_runtime(store: PathBuf) -> Runtime {
    let mut model = UpdateModel::new(UpdatePreferences::default(), true);
    let check = model.begin_check(Origin::Manual).unwrap();
    assert!(model.checked(
        check,
        Some(UpdateOffer {
            token: "owned".into(),
            version: "0.2.0".into()
        })
    ));
    let download = model.begin_download("owned", Origin::Manual).unwrap();
    assert!(model.downloaded_and_verified(download));
    runtime_with_model(store, model)
}

fn runtime_with_model(store: PathBuf, model: UpdateModel) -> Runtime {
    Runtime {
        model,
        store,
        revision: 1,
        update: None,
        bytes: None,
        installed_version: None,
        notes: String::new(),
        downloaded: 0,
        total: None,
        message: String::new(),
        storage_error: None,
        next_check: Instant::now(),
    }
}

#[cfg(all(
    target_os = "linux",
    any(target_arch = "x86_64", target_arch = "aarch64")
))]
fn matching_debian_fixture() -> (&'static [u8], &'static str) {
    #[cfg(target_arch = "x86_64")]
    let fixture: (&[u8], &str) = (
        include_bytes!("fixtures/matching-amd64.deb"),
        include_str!("fixtures/matching-amd64.deb.sig"),
    );
    #[cfg(target_arch = "aarch64")]
    let fixture: (&[u8], &str) = (
        include_bytes!("fixtures/matching-arm64.deb"),
        include_str!("fixtures/matching-arm64.deb.sig"),
    );
    fixture
}

#[cfg(all(
    target_os = "linux",
    any(target_arch = "x86_64", target_arch = "aarch64")
))]
fn start_fixture_download(
    runtime: &mut Runtime,
    id: &str,
    update: Update,
    origin: Origin,
) -> ReadLease {
    let check = runtime.model.begin_check(origin).unwrap();
    assert!(runtime.model.checked(
        check,
        Some(UpdateOffer {
            token: id.into(),
            version: update.version.clone(),
        })
    ));
    runtime.update = Some((id.into(), update));
    runtime.model.begin_download(id, origin).unwrap()
}

#[cfg(all(
    target_os = "linux",
    any(target_arch = "x86_64", target_arch = "aarch64")
))]
#[test]
fn application_update_controller_keeps_signed_bytes_bound_to_an_explicit_opt_out() {
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = runtime_with_model(
        directory.path().join("settings"),
        UpdateModel::new(UpdatePreferences::default(), true),
    );
    runtime.model.set_automatic(true).unwrap();
    let origin = runtime.model.automatic_origin();
    let (_app, updater) = updater();
    let (payload, signature) = matching_debian_fixture();
    let candidate = updater
        .restore_update(manifest("0.2.0", signature))
        .unwrap()
        .unwrap();
    let lease = start_fixture_download(&mut runtime, "owned-verified", candidate.clone(), origin);

    runtime.model.set_automatic(false).unwrap();
    let verified = verify_downloaded_package(&candidate, payload.to_vec(), Some("deb"));
    assert!(settle_download(
        &mut runtime,
        lease,
        "owned-verified",
        verified
    ));
    assert_eq!(runtime.model.phase, UpdatePhase::Ready);
    assert_eq!(runtime.downloaded, payload.len());
    let (owner, bytes) = runtime.bytes.as_ref().unwrap();
    assert_eq!(owner, "owned-verified");
    assert_eq!(bytes.as_slice(), payload);
    assert!(!runtime.model.can_automatically_install());
    assert!(
        runtime
            .model
            .prepare_install(
                "owned-verified",
                Origin::Manual,
                true,
                "owned-attempt".into()
            )
            .is_ok()
    );
    assert!(
        !runtime.store.exists(),
        "Verification alone must not record or invoke an install"
    );
}

#[cfg(all(
    target_os = "linux",
    any(target_arch = "x86_64", target_arch = "aarch64")
))]
#[test]
fn application_update_controller_rejects_wrong_metadata_and_a_stale_verified_reply() {
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = runtime_with_model(
        directory.path().join("settings"),
        UpdateModel::new(UpdatePreferences::default(), true),
    );
    let (_app, updater) = updater();
    let bad_signature = include_str!("fixtures/wrong-package.deb.sig");
    let wrong = updater
        .restore_update(manifest("0.2.0", bad_signature))
        .unwrap()
        .unwrap();
    let wrong_bytes = include_bytes!("fixtures/wrong-package.deb");
    assert!(wrong.verify(wrong_bytes).is_ok());
    let wrong_lease = start_fixture_download(&mut runtime, "first", wrong.clone(), Origin::Manual);
    let rejected = verify_downloaded_package(&wrong, wrong_bytes.to_vec(), Some("deb"));
    assert!(rejected.is_err());
    assert!(settle_download(
        &mut runtime,
        wrong_lease,
        "first",
        rejected
    ));
    assert_eq!(runtime.model.phase, UpdatePhase::Failed);
    assert!(!runtime.model.verified);
    assert!(runtime.bytes.is_none());

    let (payload, signature) = matching_debian_fixture();
    let candidate = updater
        .restore_update(manifest("0.2.0", signature))
        .unwrap()
        .unwrap();
    let lease = start_fixture_download(&mut runtime, "retired", candidate.clone(), Origin::Manual);
    let verified = verify_downloaded_package(&candidate, payload.to_vec(), Some("deb"));
    assert!(verified.is_ok());
    assert!(runtime.model.read_failed(lease));
    let _current = start_fixture_download(&mut runtime, "current", candidate, Origin::Manual);
    assert!(!settle_download(&mut runtime, lease, "retired", verified));
    assert_eq!(runtime.model.phase, UpdatePhase::Downloading);
    assert_eq!(runtime.model.offer.as_ref().unwrap().token, "current");
    assert!(runtime.bytes.is_none());
}

#[test]
fn application_update_uncertain_receipt_write_never_admits_or_replays_installation() {
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = ready_runtime(directory.path().join("preferences.json"));
    let result = admit_install(
        &mut runtime,
        "owned",
        Origin::Manual,
        true,
        "attempt".into(),
        |path, preferences| {
            // Real durable rename followed by a simulated directory-flush error.
            model::save_preferences(path, preferences)?;
            Err("Owned post-rename flush uncertainty".into())
        },
        || panic!("An unconfirmed write cannot reach the activity recheck or OS boundary"),
    );
    assert!(result.is_err());
    assert_eq!(runtime.model.phase, UpdatePhase::Uncertain);
    assert!(runtime.storage_error.is_some());
    assert!(runtime.model.preferences.attempt.is_some());
    assert!(
        model::load_preferences(&runtime.store)
            .unwrap()
            .attempt
            .is_some()
    );
    assert!(
        admit_install(
            &mut runtime,
            "owned",
            Origin::Manual,
            true,
            "replay".into(),
            |_, _| panic!("Replay must not reach persistence"),
            || true
        )
        .is_err()
    );
}

#[test]
fn application_update_admission_persists_before_rechecking_native_activity() {
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = ready_runtime(directory.path().join("preferences.json"));
    let path = runtime.store.clone();
    assert!(
        admit_install(
            &mut runtime,
            "owned",
            Origin::Manual,
            true,
            "attempt".into(),
            model::save_preferences,
            || {
                assert_eq!(
                    model::load_preferences(&path)
                        .unwrap()
                        .attempt
                        .unwrap()
                        .token,
                    "attempt"
                );
                false
            }
        )
        .is_err()
    );
    assert_eq!(runtime.model.phase, UpdatePhase::Uncertain);
    assert!(runtime.model.preferences.attempt.is_some());
    assert!(!runtime.model.can_automatically_install());
    let mut runtime = ready_runtime(directory.path().join("other.json"));
    assert!(
        admit_install(
            &mut runtime,
            "owned",
            Origin::Manual,
            false,
            "busy".into(),
            |_, _| panic!("Busy native work must refuse before writing a receipt"),
            || true
        )
        .is_err()
    );
    assert!(runtime.model.preferences.attempt.is_none());
}

#[test]
fn application_update_worker_failure_releases_installing_ui_but_retains_uncertain_receipt() {
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = ready_runtime(directory.path().join("preferences.json"));
    assert!(!install_worker_failed(&mut runtime, "retired"));
    assert_eq!(runtime.model.phase, UpdatePhase::Ready);
    admit_install(
        &mut runtime,
        "owned",
        Origin::Manual,
        true,
        "attempt".into(),
        model::save_preferences,
        || true,
    )
    .unwrap();
    assert_eq!(runtime.model.phase, UpdatePhase::Installing);
    assert!(install_worker_failed(&mut runtime, "owned"));
    assert_eq!(runtime.model.phase, UpdatePhase::Uncertain);
    assert!(!runtime.model.busy());
    assert_eq!(
        runtime.model.preferences.attempt.as_ref().unwrap().token,
        "attempt"
    );
    assert_eq!(
        model::load_preferences(&runtime.store)
            .unwrap()
            .attempt
            .unwrap()
            .token,
        "attempt"
    );
    assert!(
        runtime
            .model
            .prepare_install("owned", Origin::Manual, true, "replay".into())
            .is_err()
    );
}

#[test]
fn application_update_worker_failure_does_not_overwrite_native_success_or_retry_preflight_automatically()
 {
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = ready_runtime(directory.path().join("first.json"));
    assert!(install_worker_failed(&mut runtime, "owned"));
    assert_eq!(runtime.model.phase, UpdatePhase::Failed);
    assert!(runtime.model.preferences.attempt.is_none());
    assert!(!runtime.model.can_automatically_install());
    let mut runtime = ready_runtime(directory.path().join("second.json"));
    admit_install(
        &mut runtime,
        "owned",
        Origin::Manual,
        true,
        "attempt".into(),
        model::save_preferences,
        || true,
    )
    .unwrap();
    assert!(
        runtime
            .model
            .finish_install("attempt", InstallOutcome::Confirmed, true)
    );
    assert!(!install_worker_failed(&mut runtime, "owned"));
    assert_eq!(runtime.model.phase, UpdatePhase::Installed);
}

#[test]
fn application_update_missing_package_db_proof_cannot_be_replaced_by_a_running_binary() {
    for format in [Some("deb"), Some("rpm"), None] {
        assert_eq!(native_installation_observation(format, "0.2.0", None), None);
    }
    assert_eq!(
        native_installation_observation(Some("deb"), "0.1.6", Some("0.2.0".into())),
        Some("0.2.0".into())
    );
}

#[test]
fn application_update_confirmed_restart_resumes_checks_without_requiring_a_second_restart() {
    let preferences = UpdatePreferences {
        automatic: true,
        attempt: Some(model::InstallAttempt {
            token: "owned".into(),
            version: "0.2.0".into(),
        }),
        ..UpdatePreferences::default()
    };
    let mut model = UpdateModel::new(preferences.clone(), true);
    assert!(model.reconcile_confirmed_install("0.2.0", "0.2.0", true));
    assert_eq!(model.phase, UpdatePhase::Idle);
    assert!(model.begin_check(model.automatic_origin()).is_ok());
    let mut pending = UpdateModel::new(preferences, true);
    assert!(pending.reconcile_confirmed_install("0.2.0", "0.2.0", false));
    assert!(pending.preferences.attempt.is_some());
    assert!(pending.begin_check(Origin::Manual).is_err());
}
