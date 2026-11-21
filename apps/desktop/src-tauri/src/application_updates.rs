//! Application-global signed updater. The renderer chooses actions and opaque
//! offers, never a URL, verification key, package path or installation result.
use crate::{AppError, AppState, application_update_model as model};
use model::{
    InstallOutcome, Origin, ReadLease, UpdateModel, UpdateOffer, UpdatePhase, UpdatePreferences,
};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use tauri_specta::Event;
mod installer;
mod transport;

const KEY: &str = match option_env!("GIT_KHRONOS_UPDATER_PUBLIC_KEY") {
    Some(value) => value,
    None => "",
};
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationUpdateStatus {
    pub revision: u32,
    pub phase: UpdatePhase,
    pub running_version: String,
    pub installed_version: Option<String>,
    pub package_format: Option<String>,
    pub configured: bool,
    pub automatic: bool,
    pub offer_id: Option<String>,
    pub offered_version: Option<String>,
    pub notes: String,
    pub verified: bool,
    pub downloaded_bytes: usize,
    pub total_bytes: Option<usize>,
    pub message: String,
    pub storage_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_blocker: Option<String>,
    pub can_check: bool,
    pub can_download: bool,
    pub can_install: bool,
    pub can_inspect: bool,
}

#[derive(Clone, Serialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationUpdateChanged {
    pub state: ApplicationUpdateStatus,
}

struct Runtime {
    model: UpdateModel,
    store: PathBuf,
    revision: u32,
    update: Option<(String, Update)>,
    bytes: Option<(String, Arc<Vec<u8>>)>,
    installed_version: Option<String>,
    notes: String,
    downloaded: usize,
    total: Option<usize>,
    message: String,
    storage_error: Option<String>,
    next_check: Instant,
}

#[derive(Default)]
pub struct ApplicationUpdates {
    inner: Mutex<Option<Runtime>>,
}

fn error(message: impl Into<String>) -> AppError {
    AppError {
        kind: "applicationUpdate".into(),
        message: message.into(),
        hint: None,
    }
}
fn native_installation_observation(
    format: Option<&str>,
    running_version: &str,
    package_observation: Option<String>,
) -> Option<String> {
    match format {
        Some("deb" | "rpm") => package_observation,
        Some("appimage" | "app" | "msi" | "nsis") => Some(running_version.into()),
        _ => None,
    }
}

fn token() -> Result<String, AppError> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| error("Update intent randomness is unavailable."))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
fn with_runtime<T>(
    app: &AppHandle,
    action: impl FnOnce(&mut Runtime) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let state = app.state::<ApplicationUpdates>();
    let mut slot = state
        .inner
        .lock()
        .map_err(|_| error("The updater state is unavailable."))?;
    if slot.is_none() {
        let store = app
            .path()
            .app_config_dir()
            .map_err(|_| error("The update settings directory is unavailable."))?
            .join("application-updates.json");
        let (preferences, storage_error) = match model::load_preferences(&store) {
            Ok(value) => (value, None),
            Err(message) => (UpdatePreferences::default(), Some(message)),
        };
        let configured = !KEY.trim().is_empty() && installer::format().is_some();
        // Pending receipts stay uncertain until off-thread native inspection.
        // Running a new binary alone cannot prove Debian/RPM configuration.
        let model = UpdateModel::new(preferences, configured);
        let message = if KEY.trim().is_empty() {
            "The publisher has not configured a signing key in this build. Unsigned updates cannot be installed."
        } else if installer::format().is_none() {
            "Run an installed application bundle to use signed updates."
        } else if model.phase == UpdatePhase::Uncertain {
            "An earlier installation needs native inspection. No installer has been replayed."
        } else {
            "Manual checks are available. Automatic updates are off unless you enable them."
        };
        *slot = Some(Runtime {
            model,
            store,
            revision: 0,
            update: None,
            bytes: None,
            installed_version: None,
            notes: String::new(),
            downloaded: 0,
            total: None,
            message: message.into(),
            storage_error,
            next_check: Instant::now(),
        });
    }
    action(slot.as_mut().unwrap())
}

const EDITOR_BLOCKER: &str = "Finish and close open file editors before installing the update.";
const FILE_TOOL_BLOCKER: &str = "Finish open diff or merge tools before installing the update.";
const TERMINAL_BLOCKER: &str =
    "Close open Git Khronos terminal sessions before installing the update.";
const GIT_BLOCKER: &str = "Wait for active Git operations to finish before installing the update.";

fn native_activity_blocker(app: &AppHandle) -> Option<&'static str> {
    let state = app.state::<AppState>();
    if app
        .state::<crate::working_file_commands::EditorState>()
        .has_open_contexts()
    {
        return Some(EDITOR_BLOCKER);
    }
    if app
        .state::<crate::file_tool_commands::FileToolState>()
        .has_open_contexts()
    {
        return Some(FILE_TOOL_BLOCKER);
    }
    if !state
        .terminals
        .lock()
        .is_ok_and(|terminals| terminals.is_empty())
    {
        return Some(TERMINAL_BLOCKER);
    }
    let git_idle = state
        .active_operations
        .lock()
        .is_ok_and(|operations| operations.is_empty())
        && state.repositories.lock().is_ok_and(|repositories| {
            repositories
                .values()
                .all(|repository| repository.operation.try_lock().is_ok())
        });
    (!git_idle).then_some(GIT_BLOCKER)
}

fn native_idle(app: &AppHandle) -> bool {
    native_activity_blocker(app).is_none()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum InstallReadiness {
    NotReady,
    Blocked(&'static str),
    Ready,
}

fn install_readiness(
    runtime: &Runtime,
    format_blocker: Option<&'static str>,
    activity_blocker: Option<&'static str>,
) -> InstallReadiness {
    let model = &runtime.model;
    if !model.configured
        || !model.verified
        || runtime.bytes.is_none()
        || !matches!(model.phase, UpdatePhase::Ready | UpdatePhase::Refused)
    {
        return InstallReadiness::NotReady;
    }
    if runtime.storage_error.is_some() {
        return InstallReadiness::Blocked("Resolve the updater storage error before installing.");
    }
    if model.preferences.attempt.is_some() {
        return InstallReadiness::Blocked("Inspect the earlier installation before retrying.");
    }
    format_blocker
        .or(activity_blocker)
        .map_or(InstallReadiness::Ready, InstallReadiness::Blocked)
}

fn snapshot(app: &AppHandle) -> Result<ApplicationUpdateStatus, AppError> {
    let activity_blocker = native_activity_blocker(app);
    let format = installer::format();
    let format_blocker = installer::install_blocker(format);
    with_runtime(app, |runtime| {
        let model = &runtime.model;
        let readiness = install_readiness(runtime, format_blocker, activity_blocker);
        Ok(ApplicationUpdateStatus {
            revision: runtime.revision,
            phase: model.phase,
            running_version: env!("CARGO_PKG_VERSION").into(),
            installed_version: runtime.installed_version.clone(),
            package_format: format.map(str::to_owned),
            configured: model.configured,
            automatic: model.preferences.automatic,
            offer_id: model.offer.as_ref().map(|offer| offer.token.clone()),
            offered_version: model.offer.as_ref().map(|offer| offer.version.clone()),
            notes: runtime.notes.clone(),
            verified: model.verified,
            downloaded_bytes: runtime.downloaded,
            total_bytes: runtime.total,
            message: runtime.message.clone(),
            storage_error: runtime.storage_error.clone(),
            install_blocker: match readiness {
                InstallReadiness::Blocked(reason) => Some(reason.to_owned()),
                _ => None,
            },
            can_check: model.configured
                && !model.busy()
                && model.preferences.attempt.is_none()
                && model.phase != UpdatePhase::Installed,
            can_download: model.configured
                && matches!(model.phase, UpdatePhase::Available | UpdatePhase::Failed)
                && model.offer.is_some(),
            can_install: readiness == InstallReadiness::Ready,
            can_inspect: !model.busy() && model.preferences.attempt.is_some(),
        })
    })
}
fn changed(app: &AppHandle) {
    let _ = with_runtime(app, |runtime| {
        runtime.revision = runtime.revision.saturating_add(1);
        Ok(())
    });
    if let Ok(state) = snapshot(app) {
        let _ = ApplicationUpdateChanged { state }.emit(app);
    }
}

#[tauri::command]
#[specta::specta]
pub fn application_update_status(app: AppHandle) -> Result<ApplicationUpdateStatus, AppError> {
    snapshot(&app)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn set_automatic_application_updates(
    enabled: bool,
    app: AppHandle,
) -> Result<ApplicationUpdateStatus, AppError> {
    let outcome = with_runtime(&app, |runtime| {
        if !enabled {
            runtime.model.set_automatic(false).map_err(error)?;
        }
        if let Some(message) = &runtime.storage_error {
            return Err(error(message.clone()));
        }
        if enabled && !runtime.model.configured {
            return Err(error(
                "Publisher update trust is not configured in this build.",
            ));
        }
        let mut next = runtime.model.preferences.clone();
        next.automatic = enabled;
        if let Err(message) = model::save_preferences(&runtime.store, &next) {
            runtime.storage_error = Some(message.clone());
            return Err(error(message));
        }
        runtime.model.set_automatic(enabled).map_err(error)?;
        runtime.next_check = Instant::now();
        runtime.message = if enabled { "Automatic updates enabled. Verified updates wait for idle Git and closed terminal sessions. OS authorization may be required; Windows currently checks and verifies downloads only; self-installation still needs a safe restart flow." }
            else { "Automatic updates disabled. Manual checks and installs remain available." }.into();
        Ok(())
    });
    changed(&app);
    outcome?;
    snapshot(&app)
}

fn begin_check(app: AppHandle, origin: Origin) -> Result<ApplicationUpdateStatus, AppError> {
    let lease = with_runtime(&app, |runtime| {
        let lease = runtime.model.begin_check(origin).map_err(error)?;
        runtime.update = None;
        runtime.bytes = None;
        runtime.notes.clear();
        runtime.downloaded = 0;
        runtime.total = None;
        runtime.message = "Checking the signed release source…".into();
        runtime.next_check = Instant::now() + CHECK_INTERVAL;
        Ok(lease)
    })?;
    changed(&app);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = async {
            let url = reqwest::Url::parse(transport::MANIFEST)
                .map_err(|_| "The official update endpoint is invalid.")?;
            let Some(bytes) =
                transport::read(&url, transport::Resource::Manifest, |_, _| {}).await?
            else {
                return Ok(None);
            };
            let json =
                serde_json::from_slice(&bytes).map_err(|_| "The update manifest is invalid.")?;
            let updater = handle
                .updater_builder()
                .endpoints(vec![
                    transport::MANIFEST
                        .parse()
                        .map_err(|_| "The release endpoint is invalid.")?,
                ])
                .map_err(|_| "The release endpoint is invalid.")?
                .pubkey(KEY)
                .build()
                .map_err(|_| "The trusted updater could not be initialized.")?;
            let update = updater
                .restore_update(json)
                .map_err(|_| "The update manifest has no compatible, newer signed release.")?;
            if let Some(update) = &update {
                let version = semver::Version::parse(&update.version)
                    .map_err(|_| "The offered version is invalid.")?;
                if !version.pre.is_empty() || !transport::trusted_url(&update.download_url) {
                    return Err(
                        "The offered update is outside the stable, approved HTTPS channel.".into(),
                    );
                }
            }
            Ok::<_, String>(update)
        }
        .await;
        let mut download = None;
        let _ = with_runtime(&handle, |runtime| {
            match result {
                Ok(update) => {
                    let offer = if let Some(update) = &update {
                        match token() {
                            Ok(token) => Some(UpdateOffer {
                                token,
                                version: update.version.clone(),
                            }),
                            Err(_) => {
                                runtime.model.read_failed(lease);
                                runtime.message =
                                    "A fresh update intent could not be created.".into();
                                return Ok(());
                            }
                        }
                    } else {
                        None
                    };
                    if runtime.model.checked(lease, offer.clone()) {
                        runtime.message = if update.is_some() { "A newer release is available. Download it to verify the package and its signed version." } else { "No newer release is available." }.into();
                        if let (Some(offer), Some(update)) = (offer, update) {
                            runtime.notes = update
                                .body
                                .as_deref()
                                .unwrap_or_default()
                                .chars()
                                .take(4000)
                                .collect();
                            runtime.update = Some((offer.token.clone(), update));
                            if matches!(origin, Origin::Automatic(_))
                                && runtime.model.origin_current(origin)
                            {
                                download = Some(offer.token);
                            }
                        }
                    }
                }
                Err(message) => {
                    if runtime.model.read_failed(lease) {
                        runtime.message = message;
                    }
                }
            }
            Ok(())
        });
        changed(&handle);
        if let Some(offer_id) = download {
            let _ = begin_download(handle, offer_id, origin);
        }
    });
    snapshot(&app)
}

#[tauri::command]
#[specta::specta]
pub fn check_application_update(app: AppHandle) -> Result<ApplicationUpdateStatus, AppError> {
    begin_check(app, Origin::Manual)
}

fn begin_download(
    app: AppHandle,
    offer_id: String,
    origin: Origin,
) -> Result<ApplicationUpdateStatus, AppError> {
    let (lease, update) = with_runtime(&app, |runtime| {
        let update = runtime
            .update
            .as_ref()
            .filter(|(token, _)| token == &offer_id)
            .map(|(_, update)| update.clone())
            .ok_or_else(|| error("This update offer has expired."))?;
        let lease = runtime
            .model
            .begin_download(&offer_id, origin)
            .map_err(error)?;
        runtime.bytes = None;
        runtime.downloaded = 0;
        runtime.total = None;
        runtime.message = "Downloading the offered package…".into();
        Ok((lease, update))
    })?;
    changed(&app);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last_event = Instant::now();
        let result = transport::read(
            &update.download_url,
            transport::Resource::Package,
            |count, total| {
                let _ = with_runtime(&handle, |runtime| {
                    runtime.downloaded = count;
                    runtime.total = total;
                    Ok(())
                });
                if last_event.elapsed() > Duration::from_millis(250) {
                    changed(&handle);
                    last_event = Instant::now();
                }
            },
        )
        .await
        .and_then(|bytes| bytes.ok_or_else(|| "The package download returned no content.".into()));
        let result = match result {
            Ok(bytes) => {
                let candidate = update.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    verify_downloaded_package(&candidate, bytes, installer::format())
                })
                .await
                .unwrap_or_else(|_| Err("Native package verification could not finish.".into()))
            }
            Err(message) => Err(message),
        };
        let applied = with_runtime(&handle, |runtime| {
            Ok(settle_download(runtime, lease, &offer_id, result))
        })
        .unwrap_or(false);
        if applied {
            changed(&handle);
        }
    });
    snapshot(&app)
}

struct VerifiedDownload(Vec<u8>);

fn verify_downloaded_package(
    candidate: &Update,
    bytes: Vec<u8>,
    format: Option<&str>,
) -> Result<VerifiedDownload, String> {
    candidate
        .verify(&bytes)
        .map_err(|_| "The package signature or signed version is invalid.")?;
    if !cfg!(windows) {
        let format = format.ok_or("This bundle cannot self-update.")?;
        let _validated = installer::prepare(candidate, &bytes, format)?;
    }
    Ok(VerifiedDownload(bytes))
}

fn settle_download(
    runtime: &mut Runtime,
    lease: ReadLease,
    offer_id: &str,
    result: Result<VerifiedDownload, String>,
) -> bool {
    match result {
        Ok(VerifiedDownload(bytes)) if runtime.model.downloaded_and_verified(lease) => {
            runtime.downloaded = bytes.len();
            runtime.bytes = Some((offer_id.into(), Arc::new(bytes)));
            runtime.message = if cfg!(windows) {
                "The package and signed version are verified. Windows self-installation is not enabled until a safe application restart flow is implemented."
            } else {
                "The package and signed version are verified. Installation waits for idle Git, terminals and editors, may require OS authorization, and does not force a restart."
            }.into();
            true
        }
        Err(message) if runtime.model.read_failed(lease) => {
            runtime.message = message;
            true
        }
        _ => false,
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn download_application_update(
    offer_id: String,
    app: AppHandle,
) -> Result<ApplicationUpdateStatus, AppError> {
    begin_download(app, offer_id, Origin::Manual)
}

// Persistence and activity are separate observations. A prepared receipt must
// survive any uncertain write before an OS side effect can be admitted.
fn admit_install(
    runtime: &mut Runtime,
    offer_id: &str,
    origin: Origin,
    idle: bool,
    attempt_token: String,
    persist: impl FnOnce(&std::path::Path, &UpdatePreferences) -> Result<(), String>,
    recheck_idle: impl FnOnce() -> bool,
) -> Result<(), AppError> {
    if let Some(message) = &runtime.storage_error {
        return Err(error(message.clone()));
    }
    let receipt = runtime
        .model
        .prepare_install(offer_id, origin, idle, attempt_token)
        .map_err(error)?;
    let preferences = receipt.preferences(&runtime.model.preferences);
    if let Err(message) = persist(&runtime.store, &preferences) {
        // Atomic rename may have succeeded before a directory flush failed.
        // Keep the proposed receipt even though no installer was invoked;
        // never treat an unconfirmed durable write as retry authorization.
        runtime.model.preferences = preferences;
        runtime.model.phase = UpdatePhase::Uncertain;
        runtime.storage_error = Some(message.clone());
        runtime.message = "The prepared installation receipt could not be confirmed. No installer was invoked; automatic replay is blocked.".into();
        return Err(error(message));
    }
    if !runtime
        .model
        .accept_persisted_install(receipt, recheck_idle())
    {
        // No OS invocation occurred, but do not erase an unconfirmed receipt.
        runtime.model.preferences = preferences;
        runtime.model.phase = UpdatePhase::Uncertain;
        runtime.message = "Installation did not start because native activity changed. The prepared receipt needs inspection.".into();
        return Err(error(runtime.message.clone()));
    }
    Ok(())
}

fn install_blocking(
    app: &AppHandle,
    offer_id: &str,
    origin: Origin,
) -> Result<ApplicationUpdateStatus, AppError> {
    let (update, bytes) = with_runtime(app, |runtime| {
        let update = runtime
            .update
            .as_ref()
            .filter(|(token, _)| token == offer_id)
            .map(|(_, value)| value.clone())
            .ok_or_else(|| error("The update offer has expired."))?;
        let bytes = runtime
            .bytes
            .as_ref()
            .filter(|(token, _)| token == offer_id)
            .map(|(_, value)| value.clone())
            .ok_or_else(|| error("No verified package belongs to this offer."))?;
        Ok((update, bytes))
    })?;
    let format =
        installer::format().ok_or_else(|| error("This application bundle cannot self-update."))?;
    if let Some(message) = installer::install_blocker(Some(format)) {
        return Err(error(message));
    }
    let prepared = match installer::refuse_downgrade(format, &update.version)
        .and_then(|()| installer::prepare(&update, &bytes, format))
    {
        Ok(prepared) => prepared,
        Err(message) => {
            let _ = with_runtime(app, |runtime| {
                if runtime.model.install_preflight_failed(offer_id) {
                    runtime.bytes = None;
                    runtime.message = message.clone();
                }
                Ok(())
            });
            changed(app);
            return Err(error(message));
        }
    };
    let attempt_token = token()?;
    let idle = native_idle(app);
    with_runtime(app, |runtime| {
        admit_install(
            runtime,
            offer_id,
            origin,
            idle,
            attempt_token.clone(),
            model::save_preferences,
            || native_idle(app),
        )?;
        runtime.message =
            "Installing the verified update through the OS installer. Do not replay this action."
                .into();
        Ok(())
    })?;
    changed(app);
    let outcome = installer::install(&update, &bytes, format, prepared);
    with_runtime(app, |runtime| {
        let mut next = runtime.model.preferences.clone();
        if outcome != InstallOutcome::Uncertain {
            next.attempt = None;
        }
        if outcome == InstallOutcome::RefusedBeforeExecution {
            next.deferred_version = Some(update.version.clone());
        }
        let retired = if outcome == InstallOutcome::Uncertain {
            false
        } else {
            match model::save_preferences(&runtime.store, &next) {
                Ok(()) => true,
                Err(message) => {
                    runtime.storage_error = Some(message);
                    false
                }
            }
        };
        runtime
            .model
            .finish_install(&attempt_token, outcome, retired);
        match outcome {
            InstallOutcome::Confirmed => {
                runtime.installed_version = Some(update.version);
                runtime.bytes = None;
                runtime.message = "Update installed. Restart Git Khronos when convenient to use it; this window was not forcibly restarted.".into();
            }
            InstallOutcome::RefusedBeforeExecution => {
                runtime.message = "The installer was not started. This version will not be retried automatically.".into();
            }
            InstallOutcome::Uncertain => {
                runtime.message = "Installation outcome is unconfirmed. Inspect the OS package manager; the updater will not replay this installer.".into();
            }
        }
        Ok(())
    })?;
    changed(app);
    snapshot(app)
}

fn install_worker_failed(runtime: &mut Runtime, offer_id: &str) -> bool {
    if runtime
        .model
        .offer
        .as_ref()
        .is_none_or(|offer| offer.token != offer_id)
    {
        return false;
    }
    if runtime.model.phase == UpdatePhase::Installing {
        let Some(attempt) = runtime.model.preferences.attempt.clone() else {
            return false;
        };
        if runtime
            .model
            .finish_install(&attempt.token, InstallOutcome::Uncertain, false)
        {
            runtime.message = "The installer worker ended without a confirmed outcome. Inspect the OS package manager; no automatic replay is allowed.".into();
            return true;
        }
    } else if runtime.model.phase == UpdatePhase::Ready
        && runtime.model.install_preflight_failed(offer_id)
    {
        runtime.bytes = None;
        runtime.message = "The update worker ended before an installer was admitted. Download and verify the package again before another attempt.".into();
        return true;
    }
    // An already confirmed installation or refusal remains native authority.
    false
}

async fn install_owned(
    app: AppHandle,
    offer_id: String,
    origin: Origin,
) -> Result<ApplicationUpdateStatus, AppError> {
    let worker_app = app.clone();
    let worker_offer = offer_id.clone();
    match tauri::async_runtime::spawn_blocking(move || {
        install_blocking(&worker_app, &worker_offer, origin)
    })
    .await
    {
        Ok(outcome) => outcome,
        Err(_) => {
            let _ = with_runtime(&app, |runtime| {
                install_worker_failed(runtime, &offer_id);
                Ok(())
            });
            changed(&app);
            Err(error(
                "The native installer worker ended unexpectedly. Refresh native status and inspect any unconfirmed installation; do not replay it blindly.",
            ))
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn install_application_update(
    offer_id: String,
    app: AppHandle,
) -> Result<ApplicationUpdateStatus, AppError> {
    install_owned(app, offer_id, Origin::Manual).await
}

#[tauri::command]
#[specta::specta]
pub async fn inspect_application_update(
    app: AppHandle,
) -> Result<ApplicationUpdateStatus, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let format = installer::format();
        let observed = native_installation_observation(format, env!("CARGO_PKG_VERSION"), format.and_then(installer::observed_version))
            .ok_or_else(|| error("The installed version cannot be confirmed natively. No installer was replayed."))?;
        with_runtime(&app, |runtime| {
            if runtime.model.busy() { return Err(error("Wait for the active updater action to finish.")); }
            if runtime.model.preferences.attempt.as_ref().is_some_and(|attempt| attempt.version == observed) {
                let mut next = runtime.model.preferences.clone(); next.attempt = None;
                let retired = match model::save_preferences(&runtime.store, &next) { Ok(()) => { runtime.storage_error = None; true }, Err(message) => { runtime.storage_error = Some(message); false } };
                runtime.model.phase = UpdatePhase::Uncertain;
                runtime.model.reconcile_confirmed_install(&observed, env!("CARGO_PKG_VERSION"), retired);
                runtime.installed_version = Some(observed);
                runtime.message = if runtime.installed_version.as_deref() == Some(env!("CARGO_PKG_VERSION")) {
                    "The native installation confirms the earlier update, and this window is running it."
                } else { "The native installed version confirms the earlier update. Restart when convenient to use it." }.into();
            } else { runtime.message = "The requested installation is not confirmed. No installer was replayed. Inspect or repair it with the OS package manager.".into(); }
            Ok(())
        })?;
        changed(&app); snapshot(&app)
    }).await.map_err(|_| error("Native update inspection could not finish."))?
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(5)).await;
        let pending = with_runtime(&app, |runtime| {
            Ok(runtime.model.phase == UpdatePhase::Uncertain
                && runtime.model.preferences.attempt.is_some())
        });
        if matches!(pending, Ok(true))
            && let Err(failure) = inspect_application_update(app.clone()).await
        {
            let _ = with_runtime(&app, |runtime| {
                if runtime.model.phase == UpdatePhase::Uncertain
                    && runtime.model.preferences.attempt.is_some()
                {
                    runtime.message = failure.message;
                }
                Ok(())
            });
            changed(&app);
        }

        loop {
            let next = with_runtime(&app, |runtime| {
                if !runtime.model.configured
                    || !runtime.model.preferences.automatic
                    || runtime.storage_error.is_some()
                    || runtime.model.busy()
                    || runtime.model.preferences.attempt.is_some()
                    || runtime.model.phase == UpdatePhase::Installed
                {
                    return Ok(None);
                }
                let origin = runtime.model.automatic_origin();
                if runtime.model.can_automatically_install()
                    && installer::install_blocker(installer::format()).is_none()
                    && native_idle(&app)
                {
                    return Ok(runtime
                        .model
                        .offer
                        .as_ref()
                        .map(|offer| (true, offer.token.clone(), origin)));
                }
                if Instant::now() >= runtime.next_check {
                    return Ok(Some((false, String::new(), origin)));
                }
                Ok(None)
            });
            if let Ok(Some((install, offer_id, origin))) = next {
                if install {
                    let _ = install_owned(app.clone(), offer_id, origin).await;
                } else {
                    let _ = begin_check(app.clone(), origin);
                }
            }
            tokio::time::sleep(Duration::from_secs(15)).await;
        }
    });
}

#[cfg(test)]
mod tests;
