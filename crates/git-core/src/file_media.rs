//! Selected-side presentation metadata. Raster bytes are never transcoded here.
use super::*;
use base64::Engine;

pub const MAX_PREVIEW_DIMENSION: u32 = 16_384;
pub const MAX_PREVIEW_PIXELS: u64 = 40_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FileMediaState {
    Absent,
    Text,
    Binary,
    Raster,
    InvalidRaster,
    OverLimit,
    SymbolicLink,
    Submodule,
    Unmerged,
    Unavailable,
    LfsPointer,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RasterMetadata {
    pub mime: String,
    /// Encoded dimensions; the browser may apply EXIF orientation when displaying.
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileLfsPointer {
    pub sha256: String,
    pub size: String,
}

#[derive(Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileMediaSide {
    pub label: String,
    pub path: String,
    pub state: FileMediaState,
    pub oid: Option<String>,
    /// Decimal text preserves large declared lengths across the JavaScript boundary.
    pub size: Option<String>,
    pub raster: Option<RasterMetadata>,
    /// A closed MIME allowlist and bounded bytes produce this URI. No SVG/HTML.
    pub data_url: Option<String>,
    pub lfs: Option<FileLfsPointer>,
    pub message: Option<String>,
}

impl std::fmt::Debug for FileMediaSide {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FileMediaSide")
            .field("label", &self.label)
            .field("path", &self.path)
            .field("state", &self.state)
            .field("oid", &self.oid)
            .field("size", &self.size)
            .field("raster", &self.raster)
            .field("lfs", &self.lfs)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileMediaComparison {
    pub before: FileMediaSide,
    pub after: FileMediaSide,
}

fn lfs_pointer(bytes: &[u8]) -> Option<FileLfsPointer> {
    if bytes.len() >= 1024 || !bytes.ends_with(b"\n") {
        return None;
    }
    let text = std::str::from_utf8(bytes).ok()?;
    if text.contains('\r') {
        return None;
    }
    let mut rows = text.lines();
    if !matches!(
        rows.next()?,
        "version https://git-lfs.github.com/spec/v1" | "version https://hawser.github.com/spec/v1"
    ) {
        return None;
    }
    let mut previous = "";
    let mut oid = None;
    let mut size = None;
    for row in rows {
        let (key, value) = row.split_once(' ')?;
        if key <= previous
            || key.is_empty()
            || value.is_empty()
            || !key
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'-'))
        {
            return None;
        }
        previous = key;
        match key {
            "oid" => {
                let hash = value.strip_prefix("sha256:")?;
                if hash.len() != 64
                    || !hash
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                {
                    return None;
                }
                oid = Some(hash.to_owned());
            }
            "size" => {
                if !value.bytes().all(|b| b.is_ascii_digit())
                    || (value.len() > 1 && value.starts_with('0'))
                {
                    return None;
                }
                let _: u64 = value.parse().ok()?;
                size = Some(value.to_owned());
            }
            _ => {}
        }
    }
    Some(FileLfsPointer {
        sha256: oid?,
        size: size?,
    })
}

fn raster_mime(bytes: &[u8]) -> Option<&'static str> {
    // Recognize signatures even when subsequent metadata is broken, so a damaged
    // raster cannot be reported as a successful text/binary preview.
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else if bytes.starts_with(b"BM")
        && (bytes.len() == 2 || bytes.get(6..10) == Some(&[0, 0, 0, 0]))
    {
        Some("image/bmp")
    } else if bytes.starts_with(b"\0\0\x01\0") {
        Some("image/x-icon")
    } else {
        None
    }
}

fn present(side: FileComparisonSide) -> FileMediaSide {
    let mut result = FileMediaSide {
        label: side.label,
        path: side.path,
        state: FileMediaState::Unavailable,
        oid: None,
        size: None,
        raster: None,
        data_url: None,
        lfs: None,
        message: None,
    };
    let content = match side.content {
        FileComparisonValue::Available(content) => content,
        FileComparisonValue::Unavailable(error) => {
            result.message = Some(error.message);
            return result;
        }
    };
    result.oid = content.oid;
    result.size = content.size.map(|size| size.to_string());
    result.state = match content.kind {
        FileContentKind::Absent => FileMediaState::Absent,
        FileContentKind::SymbolicLink => FileMediaState::SymbolicLink,
        FileContentKind::Submodule => FileMediaState::Submodule,
        FileContentKind::Unmerged => FileMediaState::Unmerged,
        FileContentKind::Regular => FileMediaState::Binary,
    };
    if content.kind != FileContentKind::Regular {
        return result;
    }
    if content.over_limit {
        result.state = FileMediaState::OverLimit;
        result.message = Some("File exceeds the 8 MiB preview byte limit.".into());
        return result;
    }
    let Some(bytes) = content.bytes else {
        result.state = FileMediaState::Unavailable;
        result.message = Some("Complete selected file bytes are unavailable.".into());
        return result;
    };
    if bytes.len() > MAX_FILE_CONTENT_BYTES || content.size != Some(bytes.len() as u64) {
        result.state = FileMediaState::Unavailable;
        result.message = Some("Selected file bytes do not match their bounded metadata.".into());
        return result;
    }
    if let Some(pointer) = lfs_pointer(&bytes) {
        result.state = FileMediaState::LfsPointer;
        result.lfs = Some(pointer);
        result.message =
            Some("Git LFS pointer. Preview does not fetch or materialize its object.".into());
        return result;
    }
    if let Some(mime) = raster_mime(&bytes) {
        result.state = FileMediaState::InvalidRaster;
        match imagesize::blob_size(&bytes) {
            Ok(dimensions) => {
                let width = u32::try_from(dimensions.width).unwrap_or(u32::MAX);
                let height = u32::try_from(dimensions.height).unwrap_or(u32::MAX);
                result.raster = Some(RasterMetadata {
                    mime: mime.into(),
                    width,
                    height,
                });
                if width == 0 || height == 0 {
                    result.message = Some("Image dimensions are invalid.".into());
                } else if width > MAX_PREVIEW_DIMENSION
                    || height > MAX_PREVIEW_DIMENSION
                    || u64::from(width) * u64::from(height) > MAX_PREVIEW_PIXELS
                {
                    result.state = FileMediaState::OverLimit;
                    result.message = Some(
                        "Image exceeds the 16,384-pixel edge or 40-million-pixel preview limit."
                            .into(),
                    );
                } else {
                    result.state = FileMediaState::Raster;
                    result.data_url = Some(format!(
                        "data:{mime};base64,{}",
                        base64::engine::general_purpose::STANDARD.encode(bytes)
                    ));
                }
            }
            Err(_) => result.message = Some("Image metadata is incomplete or invalid.".into()),
        }
        return result;
    }
    if !bytes.contains(&0) && std::str::from_utf8(&bytes).is_ok() {
        result.state = FileMediaState::Text;
    }
    result
}

pub fn read_file_media(
    path: &Path,
    request: &FileComparisonRequest,
    cancellation: &CancellationToken,
) -> Result<FileMediaComparison, AppError> {
    let content = read_file_comparison(path, request, cancellation)?;
    let before = present(content.before);
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    let after = present(content.after);
    if cancellation.is_cancelled() {
        return Err(operation_cancelled());
    }
    Ok(FileMediaComparison { before, after })
}

#[cfg(test)]
#[path = "file_media_tests.rs"]
mod tests;
