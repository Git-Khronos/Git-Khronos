use super::{AppError, ensure_success, run_git};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const MAX_TEMPLATE_BYTES: u64 = 1024 * 1024;
const TEMPLATE_HINT: &str = "Check commit.template and the file's permissions and UTF-8 encoding, then refresh. No message or Git configuration was changed.";

fn failure(message: impl Into<String>) -> AppError {
    AppError::new("commitTemplateUnavailable", message, Some(TEMPLATE_HINT))
}

pub(super) fn read(path: &Path) -> Result<Option<String>, AppError> {
    let output = run_git(
        path,
        &["config", "--null", "--path", "--get", "commit.template"],
    )?;
    if output.status.code() == Some(1) && output.stdout.is_empty() && output.stderr.is_empty() {
        return Ok(None);
    }
    ensure_success("read commit.template configuration", &output)?;
    let configured = output
        .stdout
        .strip_suffix(&[0])
        .ok_or_else(|| failure("Git returned an incomplete template path."))?;
    let configured = std::str::from_utf8(configured)
        .map_err(|_| failure("The configured template path is not valid UTF-8."))?;
    if configured.is_empty() || configured.contains('\0') {
        return Err(failure("Configure a nonempty commit.template path."));
    }
    let configured = PathBuf::from(configured);
    let template_path = if configured.is_absolute() {
        configured
    } else {
        path.join(configured)
    };
    let metadata = fs::metadata(&template_path).map_err(|error| {
        failure(format!(
            "Could not inspect the configured commit template: {error}"
        ))
    })?;
    if !metadata.is_file() || metadata.len() > MAX_TEMPLATE_BYTES {
        return Err(failure(
            "The commit template must be a regular file no larger than 1 MiB.",
        ));
    }
    let file = fs::File::open(&template_path).map_err(|error| {
        failure(format!(
            "Could not open the configured commit template: {error}"
        ))
    })?;
    let mut bytes = Vec::new();
    file.take(MAX_TEMPLATE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            failure(format!(
                "Could not read the configured commit template: {error}"
            ))
        })?;
    if bytes.len() as u64 > MAX_TEMPLATE_BYTES {
        return Err(failure("The commit template exceeds the 1 MiB limit."));
    }
    if bytes.contains(&0) || std::str::from_utf8(&bytes).is_err() {
        return Err(failure(
            "The commit template must contain UTF-8 text without NUL characters.",
        ));
    }
    let mut child = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["stripspace", "--strip-comments"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            failure(format!(
                "Could not start Git to prepare the commit template: {error}"
            ))
        })?;
    let mut stdin = child
        .stdin
        .take()
        .expect("Git template input was explicitly piped");
    // Write concurrently so pipe capacity cannot deadlock larger templates.
    let writer = std::thread::spawn(move || stdin.write_all(&bytes));
    let output = child.wait_with_output();
    let written = writer
        .join()
        .map_err(|_| failure("The commit-template input worker failed."))?;
    let output = output.map_err(|error| {
        failure(format!(
            "Could not finish preparing the commit template: {error}"
        ))
    })?;
    ensure_success("prepare the configured commit template", &output)?;
    written.map_err(|error| {
        failure(format!(
            "Could not send the commit template to Git: {error}"
        ))
    })?;
    String::from_utf8(output.stdout)
        .map(Some)
        .map_err(|_| failure("Git returned a non-UTF-8 commit template."))
}
