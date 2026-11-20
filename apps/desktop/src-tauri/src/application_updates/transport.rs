//! Public release transport. No Git credentials, renderer URLs, insecure TLS or
//! unbounded response bodies. Package verification remains a separate step.
use reqwest::{Client, Url};
use std::time::Duration;

pub(super) const MANIFEST: &str =
    "https://github.com/Git-Khronos/Git-Khronos/releases/latest/download/latest.json";
pub(super) const MAX_MANIFEST: usize = 256 * 1024;
pub(super) const MAX_PACKAGE: usize = 512 * 1024 * 1024;

pub(super) fn trusted_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && match url.host_str() {
            Some("github.com") => url.path().starts_with("/Git-Khronos/Git-Khronos/releases/"),
            Some("release-assets.githubusercontent.com" | "objects.githubusercontent.com") => true,
            _ => false,
        }
}

pub(super) async fn read(
    url: &Url,
    limit: usize,
    progress: impl FnMut(usize, Option<usize>),
) -> Result<Option<Vec<u8>>, String> {
    if !trusted_url(url) {
        return Err("The update URL is not an approved HTTPS release source.".into());
    }
    let client = Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(if limit == MAX_MANIFEST {
            20
        } else {
            300
        }))
        .user_agent(concat!("Git-Khronos/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !trusted_url(attempt.url()) {
                attempt.error("Update redirect refused")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| "The secure update client could not start.")?;
    let response = client
        .get(url.clone())
        .send()
        .await
        .map_err(|_| "The signed update source could not be reached.")?;
    read_response(response, limit, progress).await
}

async fn read_response(
    mut response: reqwest::Response,
    limit: usize,
    mut progress: impl FnMut(usize, Option<usize>),
) -> Result<Option<Vec<u8>>, String> {
    if response.status() == reqwest::StatusCode::NO_CONTENT {
        return Ok(None);
    }
    if response.status() != reqwest::StatusCode::OK {
        return Err(format!(
            "The update source returned HTTP {}.",
            response.status().as_u16()
        ));
    }
    let total = response.content_length();
    if total.is_some_and(|size| size > limit as u64) {
        return Err("The update response exceeds its safe size limit.".into());
    }
    let total = total.map(|size| size as usize);
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The update download was interrupted.")?
    {
        if chunk.len() > limit.saturating_sub(bytes.len()) {
            return Err("The update response exceeds its safe size limit.".into());
        }
        bytes.extend_from_slice(&chunk);
        progress(bytes.len(), total);
    }
    Ok(Some(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn release_transport_does_not_accept_arbitrary_hosts_ports_credentials_or_http() {
        for url in [
            "http://github.com/Git-Khronos/Git-Khronos/releases/latest/download/latest.json",
            "https://github.com/other/repo/releases/download/test",
            "https://localhost/update",
            "https://user:secret@github.com/Git-Khronos/Git-Khronos/releases/download/test",
            "https://github.com:444/Git-Khronos/Git-Khronos/releases/download/test",
            "https://github.com.evil.test/Git-Khronos/Git-Khronos/releases/download/test",
        ] {
            assert!(!trusted_url(&Url::parse(url).unwrap()), "{url}");
        }
        assert!(trusted_url(&Url::parse(MANIFEST).unwrap()));
        assert!(trusted_url(
            &Url::parse(
                "https://release-assets.githubusercontent.com/owned-update?signature=opaque"
            )
            .unwrap()
        ));
    }

    // Only the response-consumption boundary accepts this owned loopback stream;
    // the production URL/redirect/TLS policy has no environment or test bypass.
    fn consume(raw: &'static [u8], limit: usize) -> Result<Option<Vec<u8>>, String> {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = [0u8; 4096];
            let _ = socket.read(&mut request);
            let _ = socket.write_all(raw);
        });
        let result = tauri::async_runtime::block_on(async {
            let response = Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(3))
                .build()
                .unwrap()
                .get(format!("http://{address}/owned-fixture"))
                .send()
                .await
                .unwrap();
            read_response(response, limit, |_, _| {}).await
        });
        server.join().unwrap();
        result
    }

    #[test]
    fn application_update_transport_bounds_content_length_and_chunked_bodies() {
        assert_eq!(
            consume(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nbody", 4).unwrap(),
            Some(b"body".to_vec())
        );
        assert!(
            consume(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\novers", 4)
                .unwrap_err()
                .contains("size limit")
        );
        assert!(consume(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n3\r\ndef\r\n0\r\n\r\n", 4).unwrap_err().contains("size limit"));
        assert!(
            consume(b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\n\r\nshort", 8)
                .unwrap_err()
                .contains("interrupted")
        );
    }

    #[test]
    fn application_update_transport_accepts_only_complete_success_or_no_content() {
        assert!(
            consume(b"HTTP/1.1 204 No Content\r\n\r\n", 4)
                .unwrap()
                .is_none()
        );
        assert!(
            consume(
                b"HTTP/1.1 206 Partial Content\r\nContent-Length: 4\r\n\r\nbody",
                4
            )
            .unwrap_err()
            .contains("206")
        );
        assert!(
            consume(b"HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\n\r\n", 4)
                .unwrap_err()
                .contains("503")
        );
    }
}
