use super::submodule_review::unavailable;
use super::*;
use std::collections::BTreeMap;

const MAX_CONFIG_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmoduleUrlSync {
    pub path: String,
    pub expected_declared_url: String,
    pub expected_registered_url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleUrlSyncResult {
    pub path: String,
    pub name: String,
    pub previous_registered_url: String,
    pub registered_url: String,
    pub remote_name: Option<String>,
    pub previous_remote_url: Option<String>,
    pub remote_url: Option<String>,
}

type Entries = BTreeMap<String, Vec<String>>;

pub fn sync_submodule_url(
    path: &Path,
    request: &SubmoduleUrlSync,
) -> Result<SubmoduleUrlSyncResult, AppError> {
    let review = review_submodule_state(path)?;
    let entry = review
        .entries
        .iter()
        .find(|entry| entry.path == request.path)
        .ok_or_else(|| refused("The reviewed submodule path is no longer reported."))?;
    let name = entry
        .name
        .clone()
        .ok_or_else(|| refused("The submodule has no .gitmodules declaration to copy from."))?;
    if entry.declared_url.as_deref() != Some(request.expected_declared_url.as_str()) {
        return Err(refused(
            "The URL declared in .gitmodules changed after the review.",
        ));
    }
    let previous_registered_url = entry.registered_url.clone().ok_or_else(|| {
        refused("The submodule is not initialized, so it has no local URL to synchronize.")
    })?;
    if previous_registered_url != request.expected_registered_url {
        return Err(refused("The local submodule URL changed after the review."));
    }
    if entry.url_matches == Some(true) {
        return Err(refused("The local URL already matches .gitmodules."));
    }
    let module = path.join(&entry.path);
    let module_config = entry.checked_out.then(|| module.clone());
    let parent_before = read_config(path, r"^submodule\.")?;
    let module_before = match &module_config {
        Some(module) => Some(read_config(module, r"^remote\.")?),
        None => None,
    };

    let output = run_git(path, &["submodule", "sync", "--", &entry.path])?;
    ensure_success("synchronize the submodule URL", &output)?;

    let url_key = format!("submodule.{name}.url");
    let parent_after = read_config(path, r"^submodule\.")?;
    let registered_url = single_value(&parent_after, &url_key)?;
    if without(&parent_before, &url_key) != without(&parent_after, &url_key) {
        return Err(verification(
            "Git changed other submodule settings during the synchronization.",
        ));
    }
    let declared = &request.expected_declared_url;
    if !declared.starts_with("./") && !declared.starts_with("../") && registered_url != *declared {
        return Err(verification(
            "The local URL does not match the absolute .gitmodules URL after synchronization.",
        ));
    }
    let (remote_name, previous_remote_url, remote_url) = match (&module_config, module_before) {
        (Some(module), Some(before)) => {
            let after = read_config(module, r"^remote\.")?;
            let changed: Vec<&String> = before
                .keys()
                .chain(after.keys())
                .filter(|key| before.get(*key) != after.get(*key))
                .collect::<std::collections::BTreeSet<_>>()
                .into_iter()
                .collect();
            match changed.as_slice() {
                [] => (None, None, None),
                [key] if key.starts_with("remote.") && key.ends_with(".url") => {
                    let remote = key["remote.".len()..key.len() - ".url".len()].to_owned();
                    let new_url = single_value(&after, key)?;
                    if new_url != registered_url {
                        return Err(verification(
                            "The submodule's remote URL differs from the synchronized local URL.",
                        ));
                    }
                    let old = before.get(*key).and_then(|values| values.first().cloned());
                    (Some(remote), old, Some(new_url))
                }
                _ => {
                    return Err(verification(
                        "Git changed more than one remote setting inside the submodule.",
                    ));
                }
            }
        }
        _ => (None, None, None),
    };
    Ok(SubmoduleUrlSyncResult {
        path: entry.path.clone(),
        name,
        previous_registered_url,
        registered_url,
        remote_name,
        previous_remote_url,
        remote_url,
    })
}

fn read_config(path: &Path, pattern: &str) -> Result<Entries, AppError> {
    let (output, truncated) = run_git_with_stdout_limit(
        path,
        &["config", "-z", "--local", "--get-regexp", pattern],
        MAX_CONFIG_BYTES,
    )?;
    if truncated {
        return Err(unavailable(
            "Submodule configuration exceeds the review limit.",
        ));
    }
    if output.status.code() == Some(1) && output.stdout.is_empty() {
        return Ok(Entries::new());
    }
    ensure_success("read submodule configuration", &output)?;
    let text = std::str::from_utf8(&output.stdout)
        .map_err(|_| unavailable("Submodule configuration is not UTF-8."))?;
    let mut entries = Entries::new();
    for record in text.split_terminator('\0') {
        let (key, value) = record.split_once('\n').unwrap_or((record, ""));
        entries.entry(key.into()).or_default().push(value.into());
    }
    Ok(entries)
}

fn single_value(entries: &Entries, key: &str) -> Result<String, AppError> {
    match entries.get(key).map(Vec::as_slice) {
        Some([value]) => Ok(value.clone()),
        _ => Err(verification(
            "The synchronized URL setting is missing or has several values.",
        )),
    }
}

fn without(entries: &Entries, key: &str) -> Entries {
    let mut copy = entries.clone();
    copy.remove(key);
    copy
}

fn refused(message: &str) -> AppError {
    AppError::new(
        "submoduleUrlSyncRefused",
        message,
        Some("Review the submodule state again. Nothing was changed."),
    )
}

fn verification(message: &str) -> AppError {
    AppError::new(
        "submoduleUrlSyncUnverified",
        message,
        Some(
            "Git ran the synchronization, so local configuration may have changed. Inspect it with git config before relying on the result.",
        ),
    )
}
