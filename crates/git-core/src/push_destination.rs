use super::*;

const REVIEW_LIMIT: usize = 256 * 1024;
const DESTINATION_LIMIT: usize = 128;

/// Read-only configuration evidence, not a persistent mutation capability.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PushDestinationReview {
    pub state: String,
    pub destinations: Vec<String>,
}

fn unavailable() -> AppError {
    AppError::new(
        "pushDestinationUnavailable",
        "The complete push destination configuration could not be reviewed safely.",
        Some("Inspect the remote URLs and URL rewrites with local Git, then reopen the review."),
    )
}

fn bounded(path: &Path, args: &[&str]) -> Result<Output, AppError> {
    let (output, truncated) = run_git_with_stdout_limit(path, args, REVIEW_LIMIT)?;
    if truncated {
        return Err(unavailable());
    }
    Ok(output)
}

fn configured_urls(path: &Path, remote: &str) -> Result<Vec<Vec<u8>>, AppError> {
    for suffix in ["pushurl", "url"] {
        let key = format!("remote.{remote}.{suffix}");
        let output = bounded(path, &["config", "--null", "--get-all", &key])?;
        if output.status.code() == Some(1) && output.stdout.is_empty() {
            continue;
        }
        if !output.status.success() {
            return Err(unavailable());
        }
        let bytes = output.stdout.strip_suffix(&[0]).ok_or_else(unavailable)?;
        let values: Vec<Vec<u8>> = bytes.split(|byte| *byte == 0).map(<[u8]>::to_vec).collect();
        if values.is_empty()
            || values.len() > DESTINATION_LIMIT
            || values
                .iter()
                .any(|value| value.is_empty() || value.iter().any(u8::is_ascii_control))
        {
            return Err(unavailable());
        }
        return Ok(values);
    }
    Err(unavailable())
}

fn label(value: &str) -> String {
    // Git helper syntax is protocol::address; IPv6 SCP hosts and literal local
    // paths can also contain double colons and must not be mistaken for helpers.
    if let Some((protocol, _)) = value.split_once("::")
        && !protocol.is_empty()
        && !protocol.contains(['/', '\\', '@', '[', ']', ':'])
    {
        return "Custom Git transport destination".into();
    }
    if let Some(scheme_end) = value.find("://") {
        let Ok(url) = url::Url::parse(value) else {
            return "Custom Git transport destination".into();
        };
        if !url.has_host() && url.scheme() != "file" {
            return "Custom Git transport destination".into();
        }
        // Validate URI syntax, but do not serialize Url: that would normalize
        // literal path segments, case or escapes before displaying a Git target.
        let start = scheme_end + 3;
        let end = value[start..]
            .find(['/', '?', '#'])
            .map_or(value.len(), |i| start + i);
        let authority = value[start..end].rsplit('@').next().unwrap_or_default();
        let path_end = value[end..]
            .find(['?', '#'])
            .map_or(value.len(), |i| end + i);
        return format!("{}{}{}", &value[..start], authority, &value[end..path_end]);
    }
    // A colon outside IPv6 brackets separates an SCP host and path. Slashes
    // before it identify a local path; '@' in such a filename is not userinfo.
    let mut bracketed = false;
    for (index, character) in value.char_indices() {
        match character {
            '[' => bracketed = true,
            ']' => bracketed = false,
            ':' if !bracketed => {
                let host = &value[..index];
                if !host.contains(['/', '\\']) {
                    let host = host.rsplit('@').next().unwrap_or_default();
                    return format!("{host}:{}", &value[index + 1..]);
                }
                break;
            }
            _ => {}
        }
    }
    value.into()
}

/// Captures complete effective Git configuration and Git-expanded push URLs.
/// This is a launch preflight, not a lock against concurrent config/DNS changes.
pub fn review_push_destination(
    path: &Path,
    remote: &str,
) -> Result<PushDestinationReview, AppError> {
    validate_remote_name(path, remote)?;
    require_remote(path, remote)?;
    let raw = configured_urls(path, remote)?;
    let configuration = bounded(path, &["config", "--null", "--list"])?;
    if !configuration.status.success() {
        return Err(unavailable());
    }
    let output = bounded(path, &["remote", "get-url", "--push", "--all", remote])?;
    if !output.status.success() {
        return Err(unavailable());
    }
    let urls = std::str::from_utf8(&output.stdout).map_err(|_| unavailable())?;
    let urls = urls.strip_suffix('\n').ok_or_else(unavailable)?;
    let urls: Vec<&str> = urls.split('\n').collect();
    if urls.len() != raw.len()
        || urls
            .iter()
            .any(|url| url.is_empty() || url.bytes().any(|byte| byte.is_ascii_control()))
    {
        return Err(unavailable());
    }
    let mut hasher = gix::hash::hasher(gix::hash::Kind::Sha256);
    for bytes in [
        b"git-khronos-push-destination-v1".as_slice(),
        path.as_os_str().as_encoded_bytes(),
        remote.as_bytes(),
        configuration.stdout.as_slice(),
        output.stdout.as_slice(),
    ] {
        hasher.update(&(bytes.len() as u64).to_le_bytes());
        hasher.update(bytes);
    }
    let state = hasher
        .try_finalize()
        .map_err(|_| unavailable())?
        .to_string();
    Ok(PushDestinationReview {
        state,
        destinations: urls.into_iter().map(label).collect(),
    })
}

pub(super) fn require_reviewed_destination(
    path: &Path,
    remote: &str,
    expected: &str,
) -> Result<(), AppError> {
    if review_push_destination(path, remote)?.state != expected {
        return Err(AppError::new(
            "staleForcePush",
            "Git configuration or push destinations changed after force-push review.",
            Some(
                "Reopen the confirmation and review the current destination. No push was started.",
            ),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn force_push_destination_labels_do_not_expose_credentials_or_query_tokens() {
        assert_eq!(
            label("https://token:secret@example.test/repo.git?access_token=secret#fragment"),
            "https://example.test/repo.git"
        );
        assert_eq!(
            label("ssh://user:secret@example.test/repo.git?token=secret"),
            "ssh://example.test/repo.git"
        );
        assert_eq!(
            label("user@example.test:path/repo.git"),
            "example.test:path/repo.git"
        );
        assert_eq!(
            label("ext::helper secret"),
            "Custom Git transport destination"
        );
        assert_eq!(
            label("https://user:secret@[]/repo.git"),
            "Custom Git transport destination"
        );
        assert_eq!(
            label("file:///owned/repo.git?token=secret"),
            "file:///owned/repo.git"
        );
        assert_eq!(label("/owned/a path/repo.git"), "/owned/a path/repo.git");
        for value in [
            "example.test:path/repo.git",
            "https:repo.git",
            "[2001:db8::1]:repo.git",
            "/owned/dir@name:repo.git",
            "/owned/[::1]/repo.git",
            r"C:\owned\repo.git",
            "https://EXAMPLE.test/a/../Repo%2Egit",
            "ssh://example.test/a/link/../repo.git",
        ] {
            assert_eq!(label(value), value);
        }
        assert_eq!(
            label("user@[2001:db8::1]:path/repo.git"),
            "[2001:db8::1]:path/repo.git"
        );
        assert_eq!(
            label("https://token:secret@EXAMPLE.test/a/../repo.git?token=secret#fragment"),
            "https://EXAMPLE.test/a/../repo.git"
        );
    }
}
