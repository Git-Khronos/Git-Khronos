//! Independent, bounded link syntax. Parsing performs no Git, network or filesystem work.
use super::{AppError, validate_commit_oid};
use serde::Serialize;
use url::Url;

const MAX_LINK_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, serde::Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum RepositoryLinkTarget {
    Repository {},
    Commit { oid: String },
    Reference { reference: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryLink {
    remote: String,
    target: RepositoryLinkTarget,
}

impl RepositoryLink {
    pub fn remote(&self) -> &str {
        &self.remote
    }
    pub fn target(&self) -> &RepositoryLinkTarget {
        &self.target
    }
}

fn refused() -> AppError {
    AppError::new(
        "invalidRepositoryLink",
        "This repository link is not supported or is malformed.",
        Some("Use a version-one Khronos link with a network remote and one optional Git target."),
    )
}

fn decode_component(value: &str) -> Result<String, AppError> {
    let mut bytes = Vec::with_capacity(value.len());
    let mut input = value.bytes();
    while let Some(byte) = input.next() {
        if byte == b'%' {
            let high = input.next().and_then(|b| (b as char).to_digit(16));
            let low = input.next().and_then(|b| (b as char).to_digit(16));
            bytes.push(((high.ok_or_else(refused)? << 4) | low.ok_or_else(refused)?) as u8);
        } else {
            // URI query '+' is literal; only percent escapes encode this format.
            bytes.push(byte);
        }
    }
    let decoded = String::from_utf8(bytes).map_err(|_| refused())?;
    if decoded.chars().any(char::is_control) {
        return Err(refused());
    }
    Ok(decoded)
}

pub(super) fn valid_reference(reference: &str) -> bool {
    let namespace = ["refs/heads/", "refs/remotes/", "refs/tags/"]
        .iter()
        .any(|prefix| reference.starts_with(prefix));
    namespace
        && reference.len() <= MAX_LINK_BYTES
        && !reference.ends_with('.')
        && !reference.contains("..")
        && !reference.contains("@{")
        && !reference
            .bytes()
            .any(|b| b <= b' ' || b == 127 || b"~^:?*[\\".contains(&b))
        && reference
            .split('/')
            .all(|part| !part.is_empty() && !part.starts_with('.') && !part.ends_with(".lock"))
}

/// Canonicalize only transport-defined properties; path case and transport stay distinct.
/// The returned identity is safe to share: passwords and token/query fields are refused.
pub fn repository_link_remote_identity(input: &str) -> Result<String, AppError> {
    if input.is_empty()
        || input.len() > MAX_LINK_BYTES
        || input.chars().any(|c| c.is_control() || c.is_whitespace())
        || input.contains(['\\', '?', '#'])
    {
        return Err(refused());
    }
    if !input.contains("://") {
        let (user, host_path) = input.split_once('@').ok_or_else(refused)?;
        if user.is_empty()
            || !user
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        {
            return Err(refused());
        }
        let (host, path) = if host_path.starts_with('[') {
            let end = host_path.find("]:").ok_or_else(refused)?;
            (&host_path[..end + 1], &host_path[end + 2..])
        } else {
            host_path.split_once(':').ok_or_else(refused)?
        };
        if host.is_empty()
            || host.contains(['/', '@', '%'])
            || path.is_empty()
            || path.starts_with('-')
            || path.split('/').any(|part| matches!(part, "." | ".."))
        {
            return Err(refused());
        }
        let authority =
            Url::parse(&format!("ssh://{user}@{host}/owned-validation")).map_err(|_| refused())?;
        let host = authority
            .host_str()
            .ok_or_else(refused)?
            .to_ascii_lowercase();
        // SCP path bytes are literal, not URL escapes; keep relative/absolute and ~ semantics.
        return Ok(format!("{user}@{host}:{path}"));
    }
    let (scheme, authority_path) = input.split_once("://").ok_or_else(refused)?;
    if !scheme.eq_ignore_ascii_case("https") && !scheme.eq_ignore_ascii_case("ssh") {
        return Err(refused());
    }
    let (_, raw_path) = authority_path.split_once('/').ok_or_else(refused)?;
    let decoded_path = decode_component(raw_path)?;
    if decoded_path.is_empty()
        || decoded_path
            .split('/')
            .any(|part| matches!(part, "." | ".."))
    {
        return Err(refused());
    }
    let mut url = Url::parse(input).map_err(|_| refused())?;
    if url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err(refused());
    }
    if url.scheme() == "https" {
        if !url.username().is_empty()
            || authority_path.split('/').next().unwrap_or("").contains('@')
        {
            return Err(refused());
        }
    } else {
        let username = url.username();
        if username.is_empty()
            || !username
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        {
            return Err(refused());
        }
        if url.port() == Some(22) {
            url.set_port(None).map_err(|_| refused())?;
        }
    }
    let host = url
        .host_str()
        .filter(|host| !host.is_empty())
        .ok_or_else(refused)?
        .to_ascii_lowercase();
    if host.contains('%') {
        return Err(refused());
    }
    url.set_host(Some(&host)).map_err(|_| refused())?;
    // Validate escapes even where WHATWG parsing would retain malformed ones.
    decode_component(url.path())?;
    Ok(url.into())
}

pub fn parse_repository_link(input: &str) -> Result<RepositoryLink, AppError> {
    if input.len() > MAX_LINK_BYTES
        || !input.is_ascii()
        || input.bytes().any(|b| b <= b' ' || b == 127)
        || input.contains('#')
    {
        return Err(refused());
    }
    let (route, query) = input.split_once('?').ok_or_else(refused)?;
    if !route.eq_ignore_ascii_case("git-khronos://repository") {
        return Err(refused());
    }
    let (mut version, mut remote, mut target) = (None, None, None);
    for entry in query.split('&') {
        let (key, value) = entry.split_once('=').ok_or_else(refused)?;
        let key = decode_component(key)?;
        let value = decode_component(value)?;
        match key.as_str() {
            "v" if version.is_none() => version = Some(value),
            "remote" if remote.is_none() => remote = Some(value),
            "commit" if target.is_none() => {
                validate_commit_oid(&value).map_err(|_| refused())?;
                target = Some(RepositoryLinkTarget::Commit {
                    oid: value.to_ascii_lowercase(),
                });
            }
            "ref" if target.is_none() && valid_reference(&value) => {
                target = Some(RepositoryLinkTarget::Reference { reference: value });
            }
            _ => return Err(refused()),
        }
    }
    if version.as_deref() != Some("1") {
        return Err(refused());
    }
    Ok(RepositoryLink {
        remote: repository_link_remote_identity(&remote.ok_or_else(refused)?)?,
        target: target.unwrap_or(RepositoryLinkTarget::Repository {}),
    })
}

pub fn create_repository_link(
    remote: &str,
    target: &RepositoryLinkTarget,
) -> Result<String, AppError> {
    match target {
        RepositoryLinkTarget::Reference { reference } if !valid_reference(reference) => {
            return Err(refused());
        }
        RepositoryLinkTarget::Commit { oid } => validate_commit_oid(oid).map_err(|_| refused())?,
        _ => {}
    }
    let remote = repository_link_remote_identity(remote)?;
    let mut link = Url::parse("git-khronos://repository").map_err(|_| refused())?;
    {
        let mut query = link.query_pairs_mut();
        query.append_pair("v", "1").append_pair("remote", &remote);
        match target {
            RepositoryLinkTarget::Repository {} => {}
            RepositoryLinkTarget::Commit { oid } => {
                query.append_pair("commit", &oid.to_ascii_lowercase());
            }
            RepositoryLinkTarget::Reference { reference } => {
                query.append_pair("ref", reference);
            }
        }
    }
    let link: String = link.into();
    // Generation and external input have exactly the same validation boundary.
    parse_repository_link(&link)?;
    Ok(link)
}

#[cfg(test)]
#[path = "repository_links_tests.rs"]
mod tests;
