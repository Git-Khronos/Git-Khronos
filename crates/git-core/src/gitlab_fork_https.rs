//! A closed fork-create HTTPS port, separate from account/project GET authority.
use super::{GitLabHttpsTransport, RESPONSE_LIMIT, with_cancellation};
use crate::{
    AppError, CancellationToken, GitLabForkDispatch, GitLabForkPostReply, GitLabForkWriteTransport,
    GitLabInstance,
};
use reqwest::header::{ACCEPT, CONTENT_TYPE};

/// Native-only credential/runtime owner. Construct outside an async runtime.
/// Its inner context uses the same verified TLS, no-redirect/no-retry policy as
/// reads. The wrapper intentionally does not implement GitLabReadTransport.
pub struct GitLabForkHttpsTransport {
    inner: GitLabHttpsTransport,
}
fn failed(kind: &str, message: &str) -> AppError {
    AppError::new(
        kind,
        message,
        Some("Inspect the saved fork request before considering another submission."),
    )
}
fn cancelled(token: &CancellationToken) -> Result<(), AppError> {
    if token.is_cancelled() {
        return Err(failed(
            "operationCancelled",
            "Fork submission was interrupted.",
        ));
    }
    Ok(())
}
fn network(error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        failed(
            "gitlabForkTimeout",
            "The fork submission did not complete before its network deadline.",
        )
    } else {
        failed(
            "gitlabForkConnection",
            "The fork submission could not complete over verified HTTPS.",
        )
    }
}
fn response_error() -> AppError {
    failed(
        "gitlabForkResponse",
        "GitLab did not return a bounded fork response.",
    )
}
impl GitLabForkHttpsTransport {
    pub fn new(instance: GitLabInstance, token: &str) -> Result<Self, AppError> {
        Ok(Self {
            inner: GitLabHttpsTransport::new(instance, token)?,
        })
    }
    #[cfg(test)]
    pub(super) fn with_root(
        instance: GitLabInstance,
        token: &str,
        root: reqwest::Certificate,
    ) -> Result<Self, AppError> {
        Ok(Self {
            inner: GitLabHttpsTransport::build(instance, token, Some(root))?,
        })
    }
}
impl GitLabForkWriteTransport for GitLabForkHttpsTransport {
    fn post_fork(
        &mut self,
        instance: &GitLabInstance,
        dispatch: &GitLabForkDispatch,
        before_dispatch: &mut dyn FnMut() -> Result<(), AppError>,
        cancellation: &CancellationToken,
    ) -> Result<GitLabForkPostReply, AppError> {
        cancelled(cancellation)?;
        if instance != &self.inner.instance {
            return Err(AppError::new(
                "gitlabForkRequest",
                "The fork request does not belong to this HTTPS instance.",
                None,
            ));
        }
        let url = dispatch.url(instance)?;
        let request = self
            .inner
            .client
            .post(url.clone())
            .header("PRIVATE-TOKEN", self.inner.credential.clone())
            .header(ACCEPT, "application/json")
            .header(CONTENT_TYPE, "application/json")
            .body(dispatch.body()?)
            .build()
            .map_err(network)?;
        let runtime = self.inner.runtime.as_ref().ok_or_else(|| {
            failed(
                "gitlabForkConnection",
                "The fork request context is unavailable.",
            )
        })?;
        cancelled(cancellation)?;
        // Building the request above performs no network I/O. Only this
        // callback's confirmed success permits polling its send future.
        before_dispatch()?;
        cancelled(cancellation)?;
        let result = runtime.block_on(with_cancellation(
            async {
                let mut response = self.inner.client.execute(request).await.map_err(network)?;
                if response.url() != &url {
                    return Err(response_error());
                }
                let status = response.status();
                if !status.is_success() {
                    // Do not read, propagate or persist a rejected response body.
                    return Ok(GitLabForkPostReply {
                        status: status.as_u16(),
                        body: None,
                    });
                }
                if response
                    .content_length()
                    .is_some_and(|length| length > RESPONSE_LIMIT as u64)
                {
                    return Err(response_error());
                }
                let mut body = Vec::new();
                while let Some(chunk) = response.chunk().await.map_err(network)? {
                    cancelled(cancellation)?;
                    if chunk.len() > RESPONSE_LIMIT - body.len() {
                        return Err(response_error());
                    }
                    body.extend_from_slice(&chunk);
                }
                cancelled(cancellation)?;
                let body = serde_json::from_slice(&body).map_err(|_| response_error())?;
                Ok(GitLabForkPostReply {
                    status: status.as_u16(),
                    body: Some(body),
                })
            },
            cancellation,
        ));
        result.map_err(|error| {
            if error.kind == "operationCancelled" {
                failed("operationCancelled", "Fork submission was interrupted.")
            } else {
                error
            }
        })
    }
}
