use super::*;

fn selected(bytes: &[u8], name: &str) -> FileComparisonSide {
    FileComparisonSide {
        label: "Selected commit".into(),
        path: name.into(),
        location: Some(FileContentLocation::Revision("a".repeat(40))),
        content: FileComparisonValue::Available(FileContent {
            kind: FileContentKind::Regular,
            oid: Some("b".repeat(40)),
            size: Some(bytes.len() as u64),
            bytes: Some(bytes.into()),
            over_limit: false,
        }),
    }
}

#[test]
fn owned_raster_formats_are_detected_from_bytes_without_extensions_or_transcoding() {
    let fixtures: &[(&[u8], &str, u32, u32)] = &[
        (
            include_bytes!("../tests/fixtures/media/tiles.png"),
            "image/png",
            3,
            2,
        ),
        (
            include_bytes!("../tests/fixtures/media/tiles.jpg"),
            "image/jpeg",
            3,
            2,
        ),
        (
            include_bytes!("../tests/fixtures/media/tiles.gif"),
            "image/gif",
            3,
            2,
        ),
        (
            include_bytes!("../tests/fixtures/media/tiles.webp"),
            "image/webp",
            3,
            2,
        ),
        (
            include_bytes!("../tests/fixtures/media/tiles.bmp"),
            "image/bmp",
            3,
            2,
        ),
        (
            include_bytes!("../tests/fixtures/media/tiles.ico"),
            "image/x-icon",
            16,
            16,
        ),
    ];
    for (bytes, mime, width, height) in fixtures {
        for path in ["extensionless", "misleading.txt", "renamed.bin"] {
            let view = present(selected(bytes, path));
            assert_eq!(view.state, FileMediaState::Raster, "{mime}");
            assert_eq!(view.path, path);
            assert_eq!(view.size, Some(bytes.len().to_string()));
            assert_eq!(
                view.raster.as_ref().unwrap(),
                &RasterMetadata {
                    mime: (*mime).into(),
                    width: *width,
                    height: *height,
                }
            );
            let url = view.data_url.unwrap();
            let encoded = url.strip_prefix(&format!("data:{mime};base64,")).unwrap();
            assert_eq!(
                base64::engine::general_purpose::STANDARD
                    .decode(encoded)
                    .unwrap(),
                *bytes
            );
        }
    }
}

#[test]
fn exif_orientation_and_source_bytes_are_retained_for_actual_browser_decoding() {
    let bytes = include_bytes!("../tests/fixtures/media/rotated.jpg");
    let view = present(selected(bytes, "rotated"));
    let metadata = view.raster.unwrap();
    assert_eq!((metadata.width, metadata.height), (3, 2));
    let url = view.data_url.unwrap();
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(url.split_once(',').unwrap().1)
            .unwrap(),
        bytes
    );
}

#[test]
fn damaged_raster_headers_are_explicit_and_never_produce_a_data_uri() {
    for bytes in [
        b"\x89PNG\r\n\x1a\n".as_slice(),
        b"\xff\xd8\xff",
        b"GIF89a",
        b"RIFF\0\0\0\0WEBP",
        b"BM",
        b"\0\0\x01\0",
    ] {
        let view = present(selected(bytes, "image"));
        assert_eq!(view.state, FileMediaState::InvalidRaster);
        assert!(view.message.is_some());
        assert!(view.data_url.is_none());
    }
}

#[test]
fn zero_excessive_edges_and_pixel_counts_are_refused_before_browser_payload_creation() {
    for (width, height, expected) in [
        (0u32, 2u32, FileMediaState::InvalidRaster),
        (MAX_PREVIEW_DIMENSION + 1, 1, FileMediaState::OverLimit),
        (8000, 8000, FileMediaState::OverLimit),
    ] {
        let mut bytes = include_bytes!("../tests/fixtures/media/tiles.png").to_vec();
        bytes[16..20].copy_from_slice(&width.to_be_bytes());
        bytes[20..24].copy_from_slice(&height.to_be_bytes());
        let view = present(selected(&bytes, "image"));
        assert_eq!(view.state, expected);
        assert!(view.data_url.is_none());
        let meta = view.raster.unwrap();
        assert_eq!((meta.width, meta.height), (width, height));
    }
}

#[test]
fn text_svg_and_binary_are_metadata_only_and_never_gain_an_active_document_url() {
    for (bytes, expected) in [
        (b"plain text".as_slice(), FileMediaState::Text),
        (b"BM ordinary notes", FileMediaState::Text),
        (b"", FileMediaState::Text),
        (
            b"<svg xmlns=\"http://www.w3.org/2000/svg\"><script>throw 1</script></svg>",
            FileMediaState::Text,
        ),
        (b"binary\0content", FileMediaState::Binary),
        (b"invalid utf8\xff", FileMediaState::Binary),
    ] {
        let view = present(selected(bytes, "pretend.png"));
        assert_eq!(view.state, expected);
        assert!(view.data_url.is_none());
        assert!(view.raster.is_none());
    }
}

#[test]
fn absent_links_submodules_conflicts_and_unavailable_sides_are_distinct() {
    for (kind, state) in [
        (FileContentKind::Absent, FileMediaState::Absent),
        (FileContentKind::SymbolicLink, FileMediaState::SymbolicLink),
        (FileContentKind::Submodule, FileMediaState::Submodule),
        (FileContentKind::Unmerged, FileMediaState::Unmerged),
    ] {
        let mut side = selected(include_bytes!("../tests/fixtures/media/tiles.png"), "file");
        let FileComparisonValue::Available(ref mut content) = side.content else {
            unreachable!()
        };
        content.kind = kind;
        let view = present(side);
        assert_eq!(view.state, state);
        assert!(view.data_url.is_none());
    }
    let mut side = selected(b"", "missing");
    side.content = FileComparisonValue::Unavailable(FileComparisonUnavailable {
        kind: "missingObject".into(),
        message: "Selected blob unavailable".into(),
        hint: None,
    });
    let view = present(side);
    assert_eq!(view.state, FileMediaState::Unavailable);
    assert_eq!(view.message.as_deref(), Some("Selected blob unavailable"));
    assert!(view.data_url.is_none());
}

#[test]
fn oversized_or_inconsistent_file_payloads_are_never_encoded() {
    let mut side = selected(b"", "large");
    let FileComparisonValue::Available(ref mut content) = side.content else {
        unreachable!()
    };
    content.over_limit = true;
    content.size = Some(MAX_FILE_CONTENT_BYTES as u64 + 1);
    content.bytes = None;
    let view = present(side);
    assert_eq!(view.state, FileMediaState::OverLimit);
    assert_eq!(view.size, Some((MAX_FILE_CONTENT_BYTES + 1).to_string()));
    assert!(view.data_url.is_none());
    let mut side = selected(b"bytes", "inconsistent");
    let FileComparisonValue::Available(ref mut content) = side.content else {
        unreachable!()
    };
    content.size = Some(999);
    assert_eq!(present(side).state, FileMediaState::Unavailable);
}

#[test]
fn canonical_lfs_pointers_expose_identity_and_declared_length_without_fetching() {
    let hash = "ab".repeat(32);
    for version in [
        "https://git-lfs.github.com/spec/v1",
        "https://hawser.github.com/spec/v1",
    ] {
        let pointer =
            format!("version {version}\next-owned original\noid sha256:{hash}\nsize 12345\n");
        let view = present(selected(pointer.as_bytes(), "photo.png"));
        assert_eq!(view.state, FileMediaState::LfsPointer);
        assert_eq!(
            view.lfs,
            Some(FileLfsPointer {
                sha256: hash.clone(),
                size: "12345".into()
            })
        );
        assert!(view.data_url.is_none());
        assert_eq!(view.size, Some(pointer.len().to_string()));
    }
}

#[test]
fn noncanonical_lfs_like_text_is_not_treated_as_a_valid_object_pointer() {
    let valid = format!(
        "version https://git-lfs.github.com/spec/v1\noid sha256:{}\nsize 7\n",
        "a".repeat(64)
    );
    for value in [
        valid.trim_end().into(),
        valid.replace('\n', "\r\n"),
        valid.replace("size 7", "size 07"),
        valid.replace("size 7", "size -7"),
        valid.replace("sha256:", "sha1:"),
        valid.replace(&"a".repeat(64), &"A".repeat(64)),
        valid.replace("size 7", "size 7\nsize 7"),
        valid.replace("spec/v1", "spec/v2"),
    ] {
        assert_eq!(
            present(selected(value.as_bytes(), "image.png")).state,
            FileMediaState::Text
        );
    }
}

#[test]
fn debug_omits_media_payload_while_serialization_preserves_the_selected_response() {
    let side = present(selected(
        include_bytes!("../tests/fixtures/media/tiles.png"),
        "image",
    ));
    let debug = format!("{side:?}");
    assert!(!debug.contains("base64"));
    assert!(!debug.contains(side.data_url.as_ref().unwrap()));
    let json = serde_json::to_value(&side).unwrap();
    assert_eq!(json["state"], "raster");
    assert_eq!(json["dataUrl"], side.data_url.unwrap());
}

#[test]
fn large_lfs_lengths_are_exact_decimal_strings_at_the_javascript_boundary() {
    let pointer = format!(
        "version https://git-lfs.github.com/spec/v1\noid sha256:{}\nsize 18446744073709551615\n",
        "a".repeat(64)
    );
    let view = present(selected(pointer.as_bytes(), "huge.png"));
    assert_eq!(view.state, FileMediaState::LfsPointer);
    let wire = serde_json::to_value(view).unwrap();
    assert_eq!(wire["lfs"]["size"], "18446744073709551615");
}
