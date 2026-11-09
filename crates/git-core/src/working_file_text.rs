//! Lossless bounded text interpretation for independently designed file editing.
use super::*;

pub const MAX_WORKING_TEXT_BYTES: usize = 1024 * 1024;
const MAX_EDITED_UTF8_BYTES: usize = 3 * MAX_WORKING_TEXT_BYTES;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum WorkingTextEncoding {
    Utf8,
    Utf16Le,
    Utf16Be,
    Windows1252,
}

/// The encoding and BOM are fixed by the validated original bytes. This type is
/// deliberately not deserializable; a client cannot turn saving into conversion.
#[derive(Clone)]
pub struct DecodedWorkingText {
    text: String,
    encoding: WorkingTextEncoding,
    bom: bool,
}
impl std::fmt::Debug for DecodedWorkingText {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DecodedWorkingText")
            .field("encoding", &self.encoding)
            .field("bom", &self.bom)
            .finish_non_exhaustive()
    }
}
fn encoding_error(message: &str) -> AppError {
    AppError::new(
        "workingFileEncoding",
        message,
        Some("Choose the file's actual encoding before editing. No file was written."),
    )
}
fn text_limit() -> AppError {
    AppError::new(
        "workingFileTextLimit",
        "The file exceeds the editor's one MiB encoded-text limit.",
        Some("Use an external editor for larger files. No file was written."),
    )
}
fn bom(encoding: WorkingTextEncoding) -> &'static [u8] {
    match encoding {
        WorkingTextEncoding::Utf8 => b"\xef\xbb\xbf",
        WorkingTextEncoding::Utf16Le => b"\xff\xfe",
        WorkingTextEncoding::Utf16Be => b"\xfe\xff",
        WorkingTextEncoding::Windows1252 => b"",
    }
}

pub fn decode_working_text(
    bytes: &[u8],
    selected: Option<WorkingTextEncoding>,
) -> Result<DecodedWorkingText, AppError> {
    if bytes.len() > MAX_WORKING_TEXT_BYTES {
        return Err(text_limit());
    }
    let detected = if bytes.starts_with(b"\xef\xbb\xbf") {
        Some(WorkingTextEncoding::Utf8)
    } else if bytes.starts_with(b"\xff\xfe") {
        Some(WorkingTextEncoding::Utf16Le)
    } else if bytes.starts_with(b"\xfe\xff") {
        Some(WorkingTextEncoding::Utf16Be)
    } else {
        None
    };
    if selected
        .zip(detected)
        .is_some_and(|(chosen, actual)| chosen != actual)
    {
        return Err(encoding_error(
            "The selected encoding conflicts with the file's byte-order mark.",
        ));
    }
    let encoding = detected.or(selected).unwrap_or(WorkingTextEncoding::Utf8);
    let has_bom = detected.is_some();
    let payload = if has_bom {
        &bytes[bom(encoding).len()..]
    } else {
        bytes
    };
    let text = match encoding {
        WorkingTextEncoding::Utf8 => {
            std::str::from_utf8(payload)
                .map(str::to_owned)
                .map_err(|_| {
                    encoding_error("The file is not valid UTF-8. Select its encoding explicitly.")
                })?
        }
        WorkingTextEncoding::Utf16Le | WorkingTextEncoding::Utf16Be => {
            if !payload.len().is_multiple_of(2) {
                return Err(encoding_error(
                    "The UTF-16 file has an incomplete code unit.",
                ));
            }
            let units: Vec<u16> = payload
                .as_chunks::<2>()
                .0
                .iter()
                .map(|pair| {
                    let pair = *pair;
                    if encoding == WorkingTextEncoding::Utf16Le {
                        u16::from_le_bytes(pair)
                    } else {
                        u16::from_be_bytes(pair)
                    }
                })
                .collect();
            String::from_utf16(&units)
                .map_err(|_| encoding_error("The UTF-16 file contains an unpaired surrogate."))?
        }
        WorkingTextEncoding::Windows1252 => encoding_rs::WINDOWS_1252
            .decode_without_bom_handling_and_without_replacement(payload)
            .ok_or_else(|| encoding_error("The file cannot be decoded without replacing bytes."))?
            .into_owned(),
    };
    if text.contains('\0') {
        return Err(encoding_error(
            "Files containing NUL characters are not editable text.",
        ));
    }
    let decoded = DecodedWorkingText {
        text,
        encoding,
        bom: has_bom,
    };
    if decoded.encode_replacement(decoded.text())? != bytes {
        return Err(encoding_error(
            "The chosen interpretation cannot preserve the original bytes.",
        ));
    }
    Ok(decoded)
}
impl DecodedWorkingText {
    pub fn text(&self) -> &str {
        &self.text
    }
    pub fn encoding(&self) -> WorkingTextEncoding {
        self.encoding
    }
    pub fn has_bom(&self) -> bool {
        self.bom
    }

    /// Encode verbatim text in the original encoding/BOM; newline interpretation
    /// belongs to the editor and is never silently normalized by this codec.
    pub fn encode_replacement(&self, text: &str) -> Result<Vec<u8>, AppError> {
        if text.len() > MAX_EDITED_UTF8_BYTES {
            return Err(text_limit());
        }
        if text.contains('\0') {
            return Err(encoding_error(
                "NUL characters cannot be saved as editable text.",
            ));
        }
        let mut bytes = if self.bom {
            bom(self.encoding).to_vec()
        } else {
            Vec::new()
        };
        match self.encoding {
            WorkingTextEncoding::Utf8 => bytes.extend_from_slice(text.as_bytes()),
            WorkingTextEncoding::Utf16Le | WorkingTextEncoding::Utf16Be => {
                for unit in text.encode_utf16() {
                    bytes.extend_from_slice(&if self.encoding == WorkingTextEncoding::Utf16Le {
                        unit.to_le_bytes()
                    } else {
                        unit.to_be_bytes()
                    });
                }
            }
            WorkingTextEncoding::Windows1252 => {
                let (encoded, _, replaced) = encoding_rs::WINDOWS_1252.encode(text);
                if replaced {
                    return Err(encoding_error(
                        "Some edited characters cannot be represented in Windows-1252.",
                    ));
                }
                bytes.extend_from_slice(&encoded);
            }
        }
        if bytes.len() > MAX_WORKING_TEXT_BYTES {
            return Err(text_limit());
        }
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn working_text_utf8_preserves_bom_unicode_and_every_original_newline_byte() {
        for bytes in [
            b"".as_slice(),
            b"plain\n",
            b"\xef\xbb\xbfna\xc3\xafve\r\n",
            b"mixed\r\nLF\nCR\rend",
        ] {
            let decoded = decode_working_text(bytes, None).unwrap();
            assert_eq!(decoded.encoding(), WorkingTextEncoding::Utf8);
            assert_eq!(decoded.has_bom(), bytes.starts_with(b"\xef\xbb\xbf"));
            assert_eq!(decoded.encode_replacement(decoded.text()).unwrap(), bytes);
        }
    }
    #[test]
    fn working_text_utf16_preserves_endian_bom_and_supplementary_characters() {
        for (encoding, bytes) in [
            (
                WorkingTextEncoding::Utf16Le,
                b"\xff\xfeA\x00=\xd8\x00\xde\r\x00\n\x00".as_slice(),
            ),
            (
                WorkingTextEncoding::Utf16Be,
                b"\xfe\xff\x00A\xd8=\xde\x00\x00\r\x00\n",
            ),
        ] {
            let decoded = decode_working_text(bytes, None).unwrap();
            assert_eq!(decoded.text(), "A😀\r\n");
            assert_eq!(decoded.encoding(), encoding);
            assert_eq!(decoded.encode_replacement(decoded.text()).unwrap(), bytes);
        }
    }
    #[test]
    fn working_text_explicit_bomless_utf16_does_not_add_a_bom() {
        for (encoding, original, changed) in [
            (
                WorkingTextEncoding::Utf16Le,
                b"A\x00".as_slice(),
                b"B\x00".as_slice(),
            ),
            (WorkingTextEncoding::Utf16Be, b"\x00A", b"\x00B"),
        ] {
            let decoded = decode_working_text(original, Some(encoding)).unwrap();
            assert!(!decoded.has_bom());
            assert_eq!(decoded.encode_replacement("B").unwrap(), changed);
        }
    }
    #[test]
    fn working_text_windows1252_roundtrips_euro_quotes_and_refuses_unrepresentable_edits() {
        let decoded = decode_working_text(
            b"\x80 \x93owned\x94\r\n",
            Some(WorkingTextEncoding::Windows1252),
        )
        .unwrap();
        assert_eq!(decoded.text(), "€ “owned”\r\n");
        assert_eq!(
            decoded.encode_replacement("€ “edited”\r\n").unwrap(),
            b"\x80 \x93edited\x94\r\n"
        );
        assert_eq!(
            decoded.encode_replacement("😀").unwrap_err().kind,
            "workingFileEncoding"
        );
    }
    #[test]
    fn working_text_never_guesses_a_legacy_encoding_or_replaces_invalid_unicode() {
        assert!(decode_working_text(b"legacy \xe9", None).is_err());
        assert!(decode_working_text(b"\xff\xfe\x00\xd8", None).is_err());
        assert!(decode_working_text(b"\xfe\xff\xdc\x00", None).is_err());
        assert!(decode_working_text(b"\xff\xfeA", None).is_err());
        assert_eq!(
            decode_working_text(b"legacy \xe9", Some(WorkingTextEncoding::Windows1252))
                .unwrap()
                .text(),
            "legacy é"
        );
    }
    #[test]
    fn working_text_conflicting_declared_encoding_and_nul_content_refuse() {
        assert!(decode_working_text(b"\xff\xfeA\x00", Some(WorkingTextEncoding::Utf8)).is_err());
        assert!(
            decode_working_text(b"\xef\xbb\xbfA", Some(WorkingTextEncoding::Windows1252)).is_err()
        );
        assert!(decode_working_text(b"A\x00B", Some(WorkingTextEncoding::Utf8)).is_err());
        assert!(decode_working_text(b"\xff\xfe\x00\x00", None).is_err());
        let decoded = decode_working_text(b"normal", None).unwrap();
        assert!(decoded.encode_replacement("bad\0text").is_err());
    }
    #[test]
    fn working_text_budgets_apply_to_encoded_bytes_including_the_existing_bom() {
        let bytes = vec![b'a'; MAX_WORKING_TEXT_BYTES];
        assert!(decode_working_text(&bytes, None).is_ok());
        assert!(decode_working_text(&vec![b'a'; MAX_WORKING_TEXT_BYTES + 1], None).is_err());
        let decoded = decode_working_text(b"\xff\xfe", None).unwrap();
        assert!(
            decoded
                .encode_replacement(&"a".repeat(MAX_WORKING_TEXT_BYTES / 2 - 1))
                .is_ok()
        );
        assert!(
            decoded
                .encode_replacement(&"a".repeat(MAX_WORKING_TEXT_BYTES / 2))
                .is_err()
        );
    }
    #[test]
    fn working_text_debug_never_contains_file_contents() {
        let decoded = decode_working_text(b"owned-private-file-body", None).unwrap();
        assert!(!format!("{decoded:?}").contains("owned-private"));
    }
}
