use super::*;

const LIMIT: usize = 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityReport {
    pub passed: bool,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
}

fn collect(mut stream: impl Read, limit: usize) -> std::io::Result<(Vec<u8>, bool)> {
    let mut kept = Vec::new();
    let mut truncated = false;
    let mut buffer = [0; 8192];
    loop {
        let count = stream.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        let available = limit.saturating_sub(kept.len());
        kept.extend_from_slice(&buffer[..count.min(available)]);
        truncated |= count > available;
    }
    Ok((kept, truncated))
}

pub fn inspect_integrity(
    path: &Path,
    cancellation: &CancellationToken,
) -> Result<IntegrityReport, AppError> {
    if cancellation.is_cancelled() {
        return Err(cancelled());
    }
    let config = run_git(
        path,
        &[
            "config",
            "--get-regexp",
            "^(extensions\\.partialclone|remote\\..*\\.promisor)$",
        ],
    )?;
    if config.status.success() {
        return Err(AppError::new(
            "integrityScopeUnsupported",
            "Partial-clone or promisor configuration requires a separate integrity workflow.",
            Some(
                "This check does not fetch promised objects or claim that a partial clone has all objects. Configuration is unchanged.",
            ),
        ));
    }
    if config.status.code() != Some(1) {
        ensure_success("inspect integrity-check scope", &config)?;
    }
    if cancellation.is_cancelled() {
        return Err(cancelled());
    }
    let mut child = crate::git_in(path)
        .args([
            "-c",
            "core.commitGraph=false",
            "fsck",
            "--full",
            "--no-progress",
        ])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_NO_LAZY_FETCH", "1")
        .env("LC_ALL", "C")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            AppError::new(
                "gitUnavailable",
                format!("Could not start the integrity check: {error}"),
                None,
            )
        })?;
    let stdout = child.stdout.take().expect("integrity stdout is piped");
    let stderr = child.stderr.take().expect("integrity stderr is piped");
    let out = thread::spawn(move || collect(stdout, LIMIT));
    let err = thread::spawn(move || collect(stderr, LIMIT));
    let status = loop {
        if cancellation.is_cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            let _ = out.join();
            let _ = err.join();
            return Err(cancelled());
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = out.join();
                let _ = err.join();
                return Err(AppError::new(
                    "gitWaitFailed",
                    format!("Could not finish the integrity check: {error}"),
                    None,
                ));
            }
        }
    };
    let read = |result: thread::Result<std::io::Result<(Vec<u8>, bool)>>| {
        result
            .map_err(|_| AppError::new("gitOutputFailed", "Integrity output worker failed.", None))?
            .map_err(|error| {
                AppError::new(
                    "gitOutputFailed",
                    format!("Could not collect integrity output: {error}"),
                    None,
                )
            })
    };
    let stdout = out.join();
    let stderr = err.join();
    let (stdout, out_truncated) = read(stdout)?;
    let (stderr, err_truncated) = read(stderr)?;
    if cancellation.is_cancelled() {
        return Err(cancelled());
    }
    let exit_code = status.code().ok_or_else(|| {
        AppError::new(
            "integrityInterrupted",
            "The integrity check was interrupted.",
            Some("No complete integrity result is available. Retry explicitly."),
        )
    })?;
    let truncated = out_truncated || err_truncated;
    Ok(IntegrityReport {
        passed: status.success() && !truncated,
        exit_code,
        stdout: redact_url_credentials(&String::from_utf8_lossy(&stdout)),
        stderr: redact_url_credentials(&String::from_utf8_lossy(&stderr)),
        truncated,
    })
}

fn cancelled() -> AppError {
    AppError::new(
        "operationCancelled",
        "Integrity inspection was cancelled.",
        Some("No complete integrity result is available. No repair was attempted."),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_collection_drains_both_exact_and_excess_output_without_claiming_complete_results() {
        assert_eq!(collect(&b"abcd"[..], 4).unwrap(), (b"abcd".to_vec(), false));
        assert_eq!(
            collect(&b"abcdef"[..], 4).unwrap(),
            (b"abcd".to_vec(), true)
        );
        assert_eq!(collect(&b""[..], 4).unwrap(), (vec![], false));
    }
}
