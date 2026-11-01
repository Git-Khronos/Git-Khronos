//! Independent, origin-bound reads of the public GitLab API.
//! Credentials are explicit native inputs; this module does not persist them.
use super::{AppError, CancellationToken, GitLabInstance, GitLabReadTransport};
use reqwest::header::{ACCEPT, HeaderValue};
use serde_json::Value;
use std::{collections::HashSet, future::Future, task::Poll, time::Duration};

const RESPONSE_LIMIT: usize = 1024 * 1024;

/// Owns a native-only credential and a runtime for the synchronous read port.
/// Construct and call outside an async runtime (for example, in spawn_blocking).
/// Deliberately neither Debug nor Serialize: do not expose the credential.
pub struct GitLabHttpsTransport {
    instance: GitLabInstance,
    credential: HeaderValue,
    runtime: Option<tokio::runtime::Runtime>,
    client: reqwest::Client,
}

fn failure(kind: &str, message: &str, hint: Option<&str>) -> AppError {
    AppError::new(kind, message, hint)
}

fn cancelled(cancellation: &CancellationToken) -> Result<(), AppError> {
    if cancellation.is_cancelled() {
        return Err(failure(
            "operationCancelled",
            "Loading GitLab data was cancelled.",
            None,
        ));
    }
    Ok(())
}

fn invalid_request() -> AppError {
    failure(
        "gitlabDiscoveryRequest",
        "The GitLab read request is invalid.",
        None,
    )
}

fn invalid_response() -> AppError {
    failure(
        "gitlabDiscoveryResponse",
        "GitLab did not return a bounded JSON response.",
        Some("Review the selected instance and reload the project page."),
    )
}

fn network_error(error: reqwest::Error) -> AppError {
    // Never propagate an upstream URL, diagnostic body, header or error chain.
    if error.is_timeout() {
        failure(
            "gitlabTimeout",
            "The GitLab read timed out.",
            Some("Check connectivity before explicitly retrying."),
        )
    } else {
        failure(
            "gitlabConnection",
            "A verified HTTPS read from GitLab could not complete.",
            Some("Check the selected instance, network and trusted certificates."),
        )
    }
}

fn status_error(status: reqwest::StatusCode) -> AppError {
    match status.as_u16() {
        300..=399 => failure(
            "gitlabRedirect",
            "GitLab redirected the read. No redirected request was sent.",
            Some("Review the instance address before connecting again."),
        ),
        401 => failure(
            "gitlabAuthentication",
            "GitLab did not accept the selected credential.",
            Some("Reconnect with a valid credential for this instance."),
        ),
        403 => failure(
            "gitlabPermission",
            "GitLab refused access to this account or resource.",
            Some("Check account access and the credential's read scope."),
        ),
        429 => failure(
            "gitlabRateLimit",
            "GitLab temporarily limited API reads.",
            Some("Wait before explicitly retrying."),
        ),
        500..=599 => failure(
            "gitlabUnavailable",
            "GitLab could not serve the read.",
            Some("Try again after the instance recovers."),
        ),
        _ => failure(
            "gitlabReadRefused",
            "GitLab did not accept this API read.",
            Some("Review the selected instance and account."),
        ),
    }
}

fn endpoint_url(instance: &GitLabInstance, endpoint: &str) -> Result<url::Url, AppError> {
    if endpoint != "user" {
        let query = endpoint
            .strip_prefix("projects?")
            .ok_or_else(invalid_request)?;
        if query.len() > 4096 || query.contains('#') || query.contains('\\') {
            return Err(invalid_request());
        }
        let mut keys = HashSet::new();
        for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
            if !keys.insert(key.to_string()) {
                return Err(invalid_request());
            }
            let valid = match key.as_ref() {
                "per_page" => value == "20",
                "page" => value.parse::<u32>().is_ok_and(|page| {
                    (1..=1000).contains(&page) && page.to_string() == value.as_ref()
                }),
                "order_by" => value == "id",
                "sort" => value == "asc",
                "membership" => value == "true",
                "archived" => value == "false",
                "search" => value.len() <= 256 && !value.chars().any(char::is_control),
                _ => false,
            };
            if !valid {
                return Err(invalid_request());
            }
        }
        if !["per_page", "page", "order_by", "sort"]
            .iter()
            .all(|key| keys.contains(*key))
        {
            return Err(invalid_request());
        }
    }
    let url = url::Url::parse(&format!("{}/api/v4/{endpoint}", instance.origin()))
        .map_err(|_| invalid_request())?;
    if url.origin().ascii_serialization() != instance.origin() || url.fragment().is_some() {
        return Err(invalid_request());
    }
    Ok(url)
}

async fn with_cancellation<T>(
    future: impl Future<Output = Result<T, AppError>>,
    cancellation: &CancellationToken,
) -> Result<T, AppError> {
    let mut future = std::pin::pin!(future);
    let mut timer = std::pin::pin!(tokio::time::sleep(Duration::from_millis(25)));
    std::future::poll_fn(|context| {
        if let Err(error) = cancelled(cancellation) {
            return Poll::Ready(Err(error));
        }
        if let Poll::Ready(result) = future.as_mut().poll(context) {
            return Poll::Ready(result);
        }
        if timer.as_mut().poll(context).is_ready() {
            timer
                .as_mut()
                .reset(tokio::time::Instant::now() + Duration::from_millis(25));
            let _ = timer.as_mut().poll(context);
        }
        Poll::Pending
    })
    .await
}

impl GitLabHttpsTransport {
    pub fn new(instance: GitLabInstance, token: &str) -> Result<Self, AppError> {
        Self::build(instance, token, None)
    }

    fn build(
        instance: GitLabInstance,
        token: &str,
        extra_root: Option<reqwest::Certificate>,
    ) -> Result<Self, AppError> {
        if token.is_empty()
            || token.len() > 8192
            || !token.bytes().all(|byte| byte.is_ascii_graphic())
        {
            return Err(failure(
                "gitlabAuthentication",
                "Use a valid credential for the selected GitLab instance.",
                None,
            ));
        }
        let mut credential = HeaderValue::from_str(token).map_err(|_| invalid_request())?;
        credential.set_sensitive(true);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|_| {
                failure(
                    "gitlabConnection",
                    "The GitLab read runtime could not start.",
                    None,
                )
            })?;
        let client = {
            let _entered = runtime.enter();
            let mut builder = reqwest::Client::builder()
                .https_only(true)
                .tls_backend_native()
                .redirect(reqwest::redirect::Policy::none())
                .retry(reqwest::retry::never())
                .referer(false)
                .no_proxy()
                .no_gzip()
                .no_brotli()
                .no_deflate()
                .no_zstd()
                .timeout(Duration::from_secs(15))
                .connect_timeout(Duration::from_secs(5))
                .read_timeout(Duration::from_secs(5))
                .user_agent(concat!("Git-Khronos/", env!("CARGO_PKG_VERSION")));
            if let Some(root) = extra_root {
                builder = builder.tls_certs_merge([root]);
            }
            builder.build().map_err(network_error)?
        };
        Ok(Self {
            instance,
            credential,
            runtime: Some(runtime),
            client,
        })
    }
}

impl Drop for GitLabHttpsTransport {
    fn drop(&mut self) {
        // A native session can be released from async application teardown.
        // Do not block that caller on an OS resolver's outstanding blocking task.
        if let Some(runtime) = self.runtime.take() {
            runtime.shutdown_background();
        }
    }
}

impl GitLabReadTransport for GitLabHttpsTransport {
    fn get(
        &mut self,
        instance: &GitLabInstance,
        endpoint: &str,
        cancellation: &CancellationToken,
    ) -> Result<Value, AppError> {
        cancelled(cancellation)?;
        if instance != &self.instance {
            return Err(invalid_request());
        }
        let url = endpoint_url(instance, endpoint)?;
        let runtime = self.runtime.as_ref().ok_or_else(|| {
            failure(
                "gitlabConnection",
                "The GitLab read context is unavailable.",
                None,
            )
        })?;
        runtime.block_on(with_cancellation(
            async {
                let mut response = self
                    .client
                    .get(url)
                    .header("PRIVATE-TOKEN", self.credential.clone())
                    .header(ACCEPT, "application/json")
                    .send()
                    .await
                    .map_err(network_error)?;
                if response.url().origin().ascii_serialization() != instance.origin() {
                    return Err(invalid_response());
                }
                if response.status() != reqwest::StatusCode::OK {
                    return Err(status_error(response.status()));
                }
                if response
                    .content_length()
                    .is_some_and(|length| length > RESPONSE_LIMIT as u64)
                {
                    return Err(invalid_response());
                }
                let mut body = Vec::new();
                while let Some(chunk) = response.chunk().await.map_err(network_error)? {
                    cancelled(cancellation)?;
                    if chunk.len() > RESPONSE_LIMIT - body.len() {
                        return Err(invalid_response());
                    }
                    body.extend_from_slice(&chunk);
                }
                cancelled(cancellation)?;
                serde_json::from_slice(&body).map_err(|_| invalid_response())
            },
            cancellation,
        ))
    }
}

#[cfg(test)]
#[path = "gitlab_https_tests.rs"]
mod tests;
