//! Native application-update intent. No renderer-supplied URL, key, bytes or
//! installation result is an authority here. Transport and OS adapters are separate.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum UpdatePhase {
    Unconfigured,
    Idle,
    Checking,
    Available,
    Downloading,
    Ready,
    Installing,
    Installed,
    Refused,
    Uncertain,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstallAttempt {
    pub token: String,
    pub version: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdatePreferences {
    #[serde(default)]
    pub automatic: bool,
    #[serde(default)]
    pub deferred_version: Option<String>,
    #[serde(default)]
    pub attempt: Option<InstallAttempt>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Origin {
    Manual,
    Automatic(u64),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReadLease {
    generation: u64,
    origin: Origin,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpdateOffer {
    pub token: String,
    pub version: String,
}

#[derive(Debug)]
pub struct PreparedInstall {
    receipt: InstallAttempt,
    generation: u64,
    offer_token: String,
    origin: Origin,
}

impl PreparedInstall {
    pub fn preferences(&self, current: &UpdatePreferences) -> UpdatePreferences {
        let mut next = current.clone();
        next.attempt = Some(self.receipt.clone());
        next
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InstallOutcome {
    Confirmed,
    RefusedBeforeExecution,
    Uncertain,
}

#[derive(Debug)]
pub struct UpdateModel {
    pub preferences: UpdatePreferences,
    pub phase: UpdatePhase,
    pub offer: Option<UpdateOffer>,
    pub verified: bool,
    pub configured: bool,
    generation: u64,
    automatic_epoch: u64,
    download_origin: Option<Origin>,
}

impl UpdateModel {
    pub fn new(preferences: UpdatePreferences, configured: bool) -> Self {
        let phase = if preferences.attempt.is_some() {
            UpdatePhase::Uncertain
        } else if configured {
            UpdatePhase::Idle
        } else {
            UpdatePhase::Unconfigured
        };
        Self {
            preferences,
            phase,
            configured,
            offer: None,
            verified: false,
            generation: 0,
            automatic_epoch: 0,
            download_origin: None,
        }
    }

    pub fn automatic_origin(&self) -> Origin {
        Origin::Automatic(self.automatic_epoch)
    }

    pub fn origin_current(&self, origin: Origin) -> bool {
        match origin {
            Origin::Manual => true,
            Origin::Automatic(epoch) => self.preferences.automatic && epoch == self.automatic_epoch,
        }
    }

    /// Enabling requires confirmed persistence first. Revocation takes effect
    /// immediately even if saving the disabled preference subsequently fails.
    pub fn set_automatic(&mut self, automatic: bool) -> Result<(), &'static str> {
        if automatic && !self.configured {
            return Err("Publisher update trust is not configured.");
        }
        if self.preferences.automatic != automatic {
            self.automatic_epoch += 1;
            self.preferences.automatic = automatic;
        }
        Ok(())
    }

    pub fn busy(&self) -> bool {
        matches!(
            self.phase,
            UpdatePhase::Checking | UpdatePhase::Downloading | UpdatePhase::Installing
        )
    }

    pub fn begin_check(&mut self, origin: Origin) -> Result<ReadLease, &'static str> {
        if !self.configured {
            return Err("Publisher update trust is not configured.");
        }
        if self.busy()
            || self.preferences.attempt.is_some()
            || self.phase == UpdatePhase::Installed
            || !self.origin_current(origin)
        {
            return Err("Another update intent owns this action.");
        }
        self.generation += 1;
        self.phase = UpdatePhase::Checking;
        self.offer = None;
        self.verified = false;
        self.download_origin = None;
        Ok(ReadLease {
            generation: self.generation,
            origin,
        })
    }

    pub fn checked(&mut self, lease: ReadLease, offer: Option<UpdateOffer>) -> bool {
        if lease.generation != self.generation || self.phase != UpdatePhase::Checking {
            return false;
        }
        self.phase = if offer.is_some() {
            UpdatePhase::Available
        } else {
            UpdatePhase::Idle
        };
        self.offer = offer;
        true
    }

    pub fn begin_download(
        &mut self,
        token: &str,
        origin: Origin,
    ) -> Result<ReadLease, &'static str> {
        if !self.configured
            || !matches!(self.phase, UpdatePhase::Available | UpdatePhase::Failed)
            || self.offer.as_ref().is_none_or(|offer| offer.token != token)
            || self.preferences.attempt.is_some()
            || !self.origin_current(origin)
            || (matches!(origin, Origin::Automatic(_)) && self.deferred())
        {
            return Err("The offered update or download intent has expired.");
        }
        self.generation += 1;
        self.phase = UpdatePhase::Downloading;
        self.verified = false;
        self.download_origin = Some(origin);
        Ok(ReadLease {
            generation: self.generation,
            origin,
        })
    }

    /// The native cryptographic adapter must verify bytes and signed version first.
    pub fn downloaded_and_verified(&mut self, lease: ReadLease) -> bool {
        if lease.generation != self.generation || self.phase != UpdatePhase::Downloading {
            return false;
        }
        self.phase = UpdatePhase::Ready;
        self.verified = true;
        true
    }

    pub fn read_failed(&mut self, lease: ReadLease) -> bool {
        if lease.generation != self.generation
            || !matches!(self.phase, UpdatePhase::Checking | UpdatePhase::Downloading)
        {
            return false;
        }
        self.phase = UpdatePhase::Failed;
        self.verified = false;
        true
    }

    fn deferred(&self) -> bool {
        self.offer.as_ref().is_some_and(|offer| {
            self.preferences.deferred_version.as_deref() == Some(&offer.version)
        })
    }

    pub fn can_automatically_install(&self) -> bool {
        self.configured
            && self.phase == UpdatePhase::Ready
            && self.verified
            && self.preferences.attempt.is_none()
            && !self.deferred()
            && self.download_origin.is_some_and(|origin| {
                matches!(origin, Origin::Automatic(_)) && self.origin_current(origin)
            })
    }

    pub fn install_preflight_failed(&mut self, token: &str) -> bool {
        if !matches!(self.phase, UpdatePhase::Ready | UpdatePhase::Refused)
            || self.preferences.attempt.is_some()
            || self.offer.as_ref().is_none_or(|offer| offer.token != token)
        {
            return false;
        }
        self.phase = UpdatePhase::Failed;
        self.verified = false;
        true
    }

    /// Preparation is side-effect-free. Persist this receipt before accepting it
    /// and invoking an OS installer. Failure to persist must not launch anything.
    pub fn prepare_install(
        &self,
        token: &str,
        origin: Origin,
        native_idle: bool,
        attempt_token: String,
    ) -> Result<PreparedInstall, &'static str> {
        if attempt_token.is_empty()
            || attempt_token.len() > 128
            || !self.configured
            || !self.verified
            || !native_idle
            || self.preferences.attempt.is_some()
            || !matches!(self.phase, UpdatePhase::Ready | UpdatePhase::Refused)
            || self.offer.as_ref().is_none_or(|offer| offer.token != token)
            || !self.origin_current(origin)
            || (matches!(origin, Origin::Automatic(_)) && !self.can_automatically_install())
        {
            return Err("The update is not verified, current, or safe to install.");
        }
        Ok(PreparedInstall {
            receipt: InstallAttempt {
                token: attempt_token,
                version: self.offer.as_ref().unwrap().version.clone(),
            },
            generation: self.generation,
            offer_token: token.to_owned(),
            origin,
        })
    }

    /// The caller holds the controller lock through preparation and persistence.
    pub fn accept_persisted_install(
        &mut self,
        prepared: PreparedInstall,
        native_idle: bool,
    ) -> bool {
        if !native_idle
            || prepared.generation != self.generation
            || self
                .prepare_install(
                    &prepared.offer_token,
                    prepared.origin,
                    true,
                    prepared.receipt.token.clone(),
                )
                .is_err()
        {
            return false;
        }
        self.preferences.attempt = Some(prepared.receipt);
        self.phase = UpdatePhase::Installing;
        true
    }

    pub fn finish_install(
        &mut self,
        token: &str,
        outcome: InstallOutcome,
        receipt_retired: bool,
    ) -> bool {
        if self.phase != UpdatePhase::Installing
            || self
                .preferences
                .attempt
                .as_ref()
                .is_none_or(|attempt| attempt.token != token)
        {
            return false;
        }
        self.phase = match outcome {
            InstallOutcome::Confirmed => UpdatePhase::Installed,
            InstallOutcome::RefusedBeforeExecution => UpdatePhase::Refused,
            InstallOutcome::Uncertain => UpdatePhase::Uncertain,
        };
        if outcome == InstallOutcome::RefusedBeforeExecution {
            self.preferences.deferred_version =
                self.offer.as_ref().map(|offer| offer.version.clone());
        }
        if receipt_retired && outcome != InstallOutcome::Uncertain {
            self.preferences.attempt = None;
        }
        true
    }

    /// A fresh native installation observation, never a renderer assertion.
    pub fn reconcile_confirmed_install(
        &mut self,
        observed_version: &str,
        running_version: &str,
        receipt_retired: bool,
    ) -> bool {
        if self.phase != UpdatePhase::Uncertain
            || self
                .preferences
                .attempt
                .as_ref()
                .is_none_or(|attempt| attempt.version != observed_version)
        {
            return false;
        }
        // Once this process is already running the confirmed installed version,
        // retirement must resume checks rather than require a second restart.
        self.phase = if receipt_retired && running_version == observed_version {
            UpdatePhase::Idle
        } else {
            UpdatePhase::Installed
        };
        if receipt_retired {
            self.preferences.attempt = None;
        }
        true
    }
}

/// Atomic settings are separate from renderer preferences. Invalid/unreadable
/// documents are errors, not permission to overwrite them with default consent.
pub fn load_preferences(path: &std::path::Path) -> Result<UpdatePreferences, String> {
    use std::io::Read;
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(UpdatePreferences::default());
        }
        Err(_) => {
            return Err(
                "Update preferences could not be read; existing data was preserved.".into(),
            );
        }
    };
    let mut bytes = Vec::new();
    file.take(16 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Update preferences could not be read.")?;
    if bytes.len() > 16 * 1024 {
        return Err("Update preferences exceed the safe size limit.".into());
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| "Update preferences are invalid; existing data was preserved.".into())
}

pub fn save_preferences(
    path: &std::path::Path,
    preferences: &UpdatePreferences,
) -> Result<(), String> {
    use std::io::Write;
    let parent = path
        .parent()
        .ok_or("Update preference directory is unavailable.")?;
    std::fs::create_dir_all(parent)
        .map_err(|_| "Update preference directory could not be created.")?;
    let mut pending = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| "Update preferences could not be staged.")?;
    let bytes =
        serde_json::to_vec(preferences).map_err(|_| "Update preferences could not be encoded.")?;
    pending
        .write_all(&bytes)
        .and_then(|_| pending.as_file().sync_all())
        .map_err(|_| "Update preferences could not be flushed.")?;
    pending
        .persist(path)
        .map_err(|_| "Update preference replacement could not be confirmed.")?;
    #[cfg(unix)]
    std::fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| "Update preference replacement could not be confirmed durable.")?;
    Ok(())
}

#[cfg(test)]
mod tests;
