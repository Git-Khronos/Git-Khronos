//! Project-owned serialization for the documented fork-create request.
//! Validating bytes is not write authority: dispatch additionally requires a
//! consumed native review, fresh identities and a durable operation record.
use super::{AppError, CancellationToken, GitLabInstance};
use serde::Serialize;

const MAX_FIELD_BYTES: usize = 1024;
const MAX_FIELD_CHARACTERS: usize = 255;
const MAX_REQUEST_BYTES: usize = 8192;

/// Native-only wire material. No Deserialize/Specta implementation, endpoint
/// replacement, credential field, default visibility change or generic POST API.
pub struct GitLabForkDispatch {
    source_id: u64,
    namespace_id: u64,
    path: String,
    name: Option<String>,
}

/// Native-only response. Callers must project identities, never persist or expose
/// the provider JSON directly. Rejected HTTP responses have no diagnostic body.
pub struct GitLabForkPostReply {
    pub status: u16,
    pub body: Option<serde_json::Value>,
}

/// A distinct capability from GitLabReadTransport. The callback must durably
/// record the possibility of dispatch before this port can send POST bytes.
/// Callers retain that record on every post-callback error; this port never retries.
pub trait GitLabForkWriteTransport {
    fn post_fork(
        &mut self,
        instance: &GitLabInstance,
        dispatch: &GitLabForkDispatch,
        before_dispatch: &mut dyn FnMut() -> Result<(), AppError>,
        cancellation: &CancellationToken,
    ) -> Result<GitLabForkPostReply, AppError>;
}

fn refused() -> AppError {
    AppError::new(
        "gitlabForkRequest",
        "Review a valid source, destination namespace, project path and name.",
        None,
    )
}
fn resource_id(value: &str) -> Result<u64, AppError> {
    value
        .parse::<u64>()
        .ok()
        .filter(|id| *id > 0 && id.to_string() == value)
        .ok_or_else(refused)
}
fn field(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_FIELD_BYTES
        && value.chars().count() <= MAX_FIELD_CHARACTERS
        && value.trim() == value
        && !value.chars().any(char::is_control)
}
impl GitLabForkDispatch {
    pub fn new(
        source_id: &str,
        namespace_id: &str,
        path: &str,
        name: Option<&str>,
    ) -> Result<Self, AppError> {
        let source_id = resource_id(source_id)?;
        let namespace_id = resource_id(namespace_id)?;
        if !field(path)
            || matches!(path, "." | "..")
            || path.contains(['/', '\\'])
            || name.is_some_and(|name| !field(name))
        {
            return Err(refused());
        }
        // Do not normalize user values or infer provider permission. The server
        // still decides its full naming rules and namespace creation policy.
        Ok(Self {
            source_id,
            namespace_id,
            path: path.into(),
            name: name.map(Into::into),
        })
    }

    pub(super) fn url(&self, instance: &GitLabInstance) -> Result<url::Url, AppError> {
        let url = url::Url::parse(&format!(
            "{}/api/v4/projects/{}/fork",
            instance.origin(),
            self.source_id
        ))
        .map_err(|_| refused())?;
        if url.origin().ascii_serialization() != instance.origin()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(refused());
        }
        Ok(url)
    }

    pub(super) fn body(&self) -> Result<Vec<u8>, AppError> {
        #[derive(Serialize)]
        struct Body<'a> {
            namespace_id: u64,
            path: &'a str,
            #[serde(skip_serializing_if = "Option::is_none")]
            name: Option<&'a str>,
        }
        let bytes = serde_json::to_vec(&Body {
            namespace_id: self.namespace_id,
            path: &self.path,
            name: self.name.as_deref(),
        })
        .map_err(|_| refused())?;
        if bytes.len() > MAX_REQUEST_BYTES {
            return Err(refused());
        }
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn gitlab_fork_dispatch_preserves_wide_integer_identity_and_exact_closed_route() {
        let dispatch = GitLabForkDispatch::new(
            "18446744073709551615",
            "9007199254740993",
            "reviewed-project",
            Some("Reviewed project"),
        )
        .unwrap();
        let instance = GitLabInstance::parse("https://gitlab.example.test:8443").unwrap();
        assert_eq!(
            dispatch.url(&instance).unwrap().as_str(),
            "https://gitlab.example.test:8443/api/v4/projects/18446744073709551615/fork"
        );
        let bytes = dispatch.body().unwrap();
        assert!(
            std::str::from_utf8(&bytes)
                .unwrap()
                .contains("\"namespace_id\":9007199254740993")
        );
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["namespace_id"].as_u64(), Some(9007199254740993));
        assert_eq!(body["path"], "reviewed-project");
        assert_eq!(body["name"], "Reviewed project");
        assert_eq!(body.as_object().unwrap().len(), 3);
        assert!(
            body.get("namespace").is_none()
                && body.get("visibility").is_none()
                && body.get("branches").is_none()
        );
    }

    #[test]
    fn gitlab_fork_dispatch_keeps_json_values_literal_and_omits_absent_options() {
        let dispatch = GitLabForkDispatch::new(
            "101",
            "18446744073709551615",
            "literal?#%&",
            Some("Reviewed \"display\" \\ name café"),
        )
        .unwrap();
        let instance = GitLabInstance::parse("https://gitlab.example.test").unwrap();
        assert_eq!(
            dispatch.url(&instance).unwrap().as_str(),
            "https://gitlab.example.test/api/v4/projects/101/fork"
        );
        let body: Value = serde_json::from_slice(&dispatch.body().unwrap()).unwrap();
        assert_eq!(body["namespace_id"].as_u64(), Some(u64::MAX));
        assert_eq!(body["path"], "literal?#%&");
        assert_eq!(body["name"], "Reviewed \"display\" \\ name café");
        let body: Value = serde_json::from_slice(
            &GitLabForkDispatch::new("101", "9", "reviewed-project", None)
                .unwrap()
                .body()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(body.as_object().unwrap().len(), 2);
        assert!(body.get("name").is_none());
    }

    #[test]
    fn gitlab_fork_dispatch_refuses_noncanonical_ids_and_ambiguous_path_segments_without_echo() {
        for bad in [
            "",
            "0",
            "01",
            "+1",
            "-1",
            "1/../2",
            "%31",
            "1?other",
            " 1",
            "1 ",
            "18446744073709551616",
            "١",
        ] {
            for source in [true, false] {
                let result = if source {
                    GitLabForkDispatch::new(bad, "9", "reviewed", None)
                } else {
                    GitLabForkDispatch::new("101", bad, "reviewed", None)
                };
                let error = match result {
                    Ok(_) => panic!("Invalid fixture identifier accepted"),
                    Err(error) => error,
                };
                assert_eq!(error.kind, "gitlabForkRequest");
            }
        }
        for bad in [
            "",
            ".",
            "..",
            "a/b",
            "a\\b",
            " reviewed",
            "reviewed ",
            "owned-secret\nmarker",
            "owned-secret\0marker",
        ] {
            let error = match GitLabForkDispatch::new("101", "9", bad, None) {
                Ok(_) => panic!("Invalid fixture path accepted"),
                Err(error) => error,
            };
            assert!(!error.message.contains("owned-secret"));
        }
    }

    #[test]
    fn gitlab_fork_dispatch_bounds_unicode_fields_and_refuses_blank_names() {
        let exact = "🧭".repeat(MAX_FIELD_CHARACTERS);
        assert!(
            GitLabForkDispatch::new("101", "9", &exact, Some(&exact))
                .unwrap()
                .body()
                .unwrap()
                .len()
                <= MAX_REQUEST_BYTES
        );
        let oversized = "🧭".repeat(MAX_FIELD_CHARACTERS + 1);
        assert!(GitLabForkDispatch::new("101", "9", &oversized, None).is_err());
        assert!(GitLabForkDispatch::new("101", "9", "reviewed", Some(&oversized)).is_err());
        for name in ["", " ", " name", "name ", "name\rnext"] {
            assert!(GitLabForkDispatch::new("101", "9", "reviewed", Some(name)).is_err());
        }
    }
}
