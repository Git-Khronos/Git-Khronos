//! Local publisher tooling only. Never signs, installs, or uploads a package.

#[cfg(not(target_os = "linux"))]
fn main() -> std::process::ExitCode {
    eprintln!("Debian update staging requires Linux and dpkg-deb.");
    std::process::ExitCode::FAILURE
}

#[cfg(target_os = "linux")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if let [mode, directory, key, tag, expected_hash] = args.as_slice()
        && mode == "--verify-release"
    {
        linux::verify_release(
            directory.as_ref(),
            key.as_ref(),
            tag.to_str().ok_or("expected a UTF-8 release tag")?,
            expected_hash.to_str().ok_or("expected a UTF-8 SHA-256")?,
        )?;
        println!("Verified the prepared signed release assets without publishing them.");
        return Ok(());
    }
    let [package, signature, key, output_parent, expected_hash] = args.as_slice() else {
        return Err(
            "usage: stage-debian-update PACKAGE SIGNATURE PUBLIC_KEY OUTPUT_PARENT PACKAGE_SHA256\n       stage-debian-update --verify-release DIRECTORY PUBLIC_KEY RELEASE_TAG PACKAGE_SHA256"
                .into(),
        );
    };
    let staged = linux::stage(
        package.as_ref(),
        signature.as_ref(),
        key.as_ref(),
        output_parent.as_ref(),
        expected_hash.to_str().ok_or("expected a UTF-8 SHA-256")?,
    )?;
    println!("{}", staged.display());
    Ok(())
}

#[cfg(target_os = "linux")]
mod linux {
    use base64::{Engine, engine::general_purpose::STANDARD};
    use minisign_verify::{PublicKey, Signature};
    use sha2::{Digest, Sha256};
    use std::{
        collections::BTreeMap,
        error::Error,
        fs::{self, File},
        io::{Read, Write},
        path::{Path, PathBuf},
        process::Command,
    };

    type Result<T> = std::result::Result<T, Box<dyn Error>>;
    const MAX_PACKAGE: u64 = 512 * 1024 * 1024;
    const MAX_MANIFEST: u64 = 256 * 1024;
    const MAX_INVENTORY: u64 = 64 * 1024 * 1024;

    fn bounded_input(path: &Path, limit: u64) -> Result<File> {
        use std::os::unix::fs::OpenOptionsExt;
        // Refuse links and avoid blocking on a FIFO before checking its type.
        let file = File::options()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(path)?;
        let info = file.metadata()?;
        if !info.is_file() || info.len() == 0 || info.len() > limit {
            return Err("expected a bounded regular input file".into());
        }
        Ok(file)
    }

    pub(super) fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>> {
        let mut bytes = Vec::new();
        bounded_input(path, limit)?
            .take(limit + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > limit {
            return Err("oversized release input".into());
        }
        Ok(bytes)
    }

    fn encoded(path: &Path) -> Result<String> {
        Ok(String::from_utf8(read_bounded(path, 4096)?)?
            .trim()
            .to_owned())
    }

    fn is_sha256(hash: &str) -> bool {
        hash.len() == 64
            && hash
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    }

    pub(super) fn stage(
        package: &Path,
        signature: &Path,
        key: &Path,
        output_parent: &Path,
        expected_hash: &str,
    ) -> Result<PathBuf> {
        stage_with_signature(
            package,
            &encoded(signature)?,
            key,
            output_parent,
            expected_hash,
        )
    }

    fn stage_with_signature(
        package: &Path,
        signature_text: &str,
        key: &Path,
        output_parent: &Path,
        expected_hash: &str,
    ) -> Result<PathBuf> {
        if !is_sha256(expected_hash) {
            return Err("expected the lowercase SHA-256 of the qualified package".into());
        }
        let asset = package
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or("invalid asset name")?;
        if signature_text.len() > 4096 {
            return Err("oversized package signature".into());
        }
        let signature = Signature::decode(&String::from_utf8(STANDARD.decode(signature_text)?)?)?;
        let key = PublicKey::decode(&String::from_utf8(STANDARD.decode(encoded(key)?)?)?)?;
        let mut verifier = key.verify_stream(&signature)?;

        let output_parent = output_parent.canonicalize()?;
        let staging = tempfile::Builder::new()
            .prefix("git-khronos-update-")
            .tempdir_in(output_parent)?;
        let staged_package = staging.path().join(asset);
        let mut sink = File::options()
            .write(true)
            .create_new(true)
            .open(&staged_package)?;
        let mut source = bounded_input(package, MAX_PACKAGE)?.take(MAX_PACKAGE + 1);
        let mut digest = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let size = source.read(&mut buffer)?;
            if size == 0 {
                break;
            }
            let bytes = &buffer[..size];
            digest.update(bytes);
            verifier.update(bytes);
            sink.write_all(bytes)?;
        }
        if source.limit() == 0 || format!("{:x}", digest.finalize()) != expected_hash {
            return Err("package differs from the qualified artifact".into());
        }
        verifier.finalize()?;
        sink.sync_all()?;
        drop(sink);

        // Inspect only the exact copied bytes, after checking both digest and signature.
        let metadata = Command::new("/usr/bin/dpkg-deb")
            .arg("-f")
            .arg(&staged_package)
            .args(["Package", "Version", "Architecture"])
            .output()?;
        if !metadata.status.success() {
            return Err("could not inspect Debian package metadata".into());
        }
        let metadata = String::from_utf8(metadata.stdout)?;
        let field = |prefix| metadata.lines().find_map(|line| line.strip_prefix(prefix));
        let version = field("Version: ").ok_or("missing Debian version")?;
        let stable = semver::Version::parse(version)?;
        if !stable.pre.is_empty() || !stable.build.is_empty() || stable.to_string() != version {
            return Err("expected a stable release version".into());
        }
        let (architecture, platform) = match field("Architecture: ") {
            Some("amd64") => ("amd64", "linux-x86_64-deb"),
            Some("arm64") => ("arm64", "linux-aarch64-deb"),
            _ => return Err("unsupported Debian architecture".into()),
        };
        if field("Package: ") != Some("git-khronos")
            || asset != format!("Git-Khronos_{version}_{architecture}.deb")
        {
            return Err("package metadata does not match the release asset name".into());
        }
        let mut signed_versions = signature
            .trusted_comment()
            .split('\t')
            .filter_map(|field| field.strip_prefix("version:"));
        if signed_versions.next() != Some(version) || signed_versions.next().is_some() {
            return Err("signature must bind the exact Debian version".into());
        }

        let url = format!(
            "https://github.com/Git-Khronos/Git-Khronos/releases/download/v{version}/{asset}"
        );
        let mut manifest = serde_json::to_vec_pretty(&serde_json::json!({
            "version": version,
            "platforms": { (platform): { "url": url, "signature": signature_text } }
        }))?;
        manifest.push(b'\n');
        fs::write(staging.path().join("latest.json"), &manifest)?;
        let manifest_hash = Sha256::digest(manifest);
        fs::write(
            staging.path().join("update-assets.sha256"),
            format!("{expected_hash}  {asset}\n{manifest_hash:x}  latest.json\n"),
        )?;
        Ok(staging.keep())
    }

    /// Recheck the files intended for upload against a separately qualified digest.
    /// Use owned temporary storage; the release directory is strictly read-only.
    pub(super) fn verify_release(
        directory: &Path,
        key: &Path,
        tag: &str,
        expected_hash: &str,
    ) -> Result<()> {
        let version = tag
            .strip_prefix('v')
            .ok_or("expected a stable v-prefixed release tag")?;
        let parsed = semver::Version::parse(version)?;
        if !parsed.pre.is_empty() || !parsed.build.is_empty() || parsed.to_string() != version {
            return Err("expected a stable v-prefixed release tag".into());
        }
        let asset = format!("Git-Khronos_{version}_amd64.deb");
        let package_inventory = format!("Git-Khronos_{version}_amd64.cdx.json");
        let source_inventory = format!("Git-Khronos_{version}_source.cdx.json");
        let manifest_bytes = read_bounded(&directory.join("latest.json"), MAX_MANIFEST)?;
        let manifest: serde_json::Value = serde_json::from_slice(&manifest_bytes)?;
        let signature = manifest["platforms"]["linux-x86_64-deb"]["signature"]
            .as_str()
            .ok_or("manifest is missing the amd64 Debian signature")?;

        let area = tempfile::tempdir()?;
        let verified = stage_with_signature(
            &directory.join(&asset),
            signature,
            key,
            area.path(),
            expected_hash,
        )?;
        if read_bounded(&verified.join("latest.json"), MAX_MANIFEST)? != manifest_bytes {
            return Err(
                "manifest differs from the canonical signed asset for the release tag".into(),
            );
        }

        let mut expected = BTreeMap::from([
            (asset.as_str(), expected_hash.to_owned()),
            (
                "latest.json",
                format!("{:x}", Sha256::digest(manifest_bytes)),
            ),
        ]);
        for (name, is_source) in [
            (package_inventory.as_str(), false),
            (source_inventory.as_str(), true),
        ] {
            let bytes = read_bounded(&directory.join(name), MAX_INVENTORY)?;
            let inventory: serde_json::Value = serde_json::from_slice(&bytes)?;
            if inventory["bomFormat"] != "CycloneDX"
                || !inventory["components"]
                    .as_array()
                    .is_some_and(|components| !is_source || !components.is_empty())
            {
                return Err(format!("invalid CycloneDX inventory: {name}").into());
            }
            expected.insert(name, format!("{:x}", Sha256::digest(bytes)));
        }
        let checksums = String::from_utf8(read_bounded(&directory.join("SHA256SUMS"), 4096)?)?;
        for entry in checksums.lines() {
            let (hash, filename) = entry
                .split_once("  ")
                .ok_or("invalid release checksum line")?;
            if expected.remove(filename).as_deref() != Some(hash) {
                return Err(format!(
                    "unexpected, repeated, or mismatched release checksum: {filename}"
                )
                .into());
            }
        }
        if !expected.is_empty() {
            return Err("SHA256SUMS is missing required release assets".into());
        }
        Ok(())
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::linux::{read_bounded, stage, verify_release};
    use sha2::{Digest, Sha256};
    use std::{env, fs, path::PathBuf};
    use tauri_plugin_updater::{Updater, UpdaterExt};

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src/application_updates/fixtures")
            .join(name)
    }

    fn manifest_consumer(
        installed_version: &str,
        verification_key: &str,
        target: &str,
    ) -> (tauri::App<tauri::test::MockRuntime>, Updater) {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.package_info_mut().version = installed_version.parse().unwrap();
        context.config_mut().plugins.0.insert(
            "updater".into(),
            serde_json::json!({"pubkey": verification_key, "requireSignedVersion": true}),
        );
        let app = tauri::test::mock_builder()
            .plugin(
                tauri_plugin_updater::Builder::new()
                    .pubkey(verification_key)
                    .build(),
            )
            .build(context)
            .unwrap();
        let updater = app
            .updater_builder()
            .target(target)
            .endpoints(vec![
                "https://github.com/Git-Khronos/Git-Khronos/releases/latest/download/latest.json"
                    .parse()
                    .unwrap(),
            ])
            .unwrap()
            .build()
            .unwrap();
        (app, updater)
    }

    #[test]
    #[ignore = "requires owned staged release assets and their public key"]
    fn qualified_release_can_be_consumed_offline() {
        let required = |name: &str| env::var(name).unwrap_or_else(|_| panic!("Set {name}"));
        let dir = PathBuf::from(required("GIT_KHRONOS_STAGED_RELEASE_DIR"));
        let key_path = PathBuf::from(required("GIT_KHRONOS_STAGED_PUBLIC_KEY"));
        let digest = required("GIT_KHRONOS_QUALIFIED_PACKAGE_SHA256");
        let baseline = required("GIT_KHRONOS_STAGED_BASELINE_VERSION");
        let manifest: serde_json::Value =
            serde_json::from_slice(&read_bounded(&dir.join("latest.json"), 256 * 1024).unwrap())
                .unwrap();
        let version = manifest["version"].as_str().expect("manifest version");
        assert!(
            semver::Version::parse(&baseline).unwrap() < semver::Version::parse(version).unwrap()
        );
        verify_release(&dir, &key_path, &format!("v{version}"), &digest).unwrap();
        let asset = format!("Git-Khronos_{version}_amd64.deb");
        let mut bytes = read_bounded(&dir.join(&asset), 512 * 1024 * 1024).unwrap();
        assert_eq!(format!("{:x}", Sha256::digest(&bytes)), digest);
        let key = String::from_utf8(read_bounded(&key_path, 4096).unwrap()).unwrap();
        let target = "linux-x86_64-deb";
        let (_app, updater) = manifest_consumer(&baseline, key.trim(), target);
        let offer = updater.restore_update(manifest.clone()).unwrap().unwrap();
        assert_eq!(offer.version, version);
        assert_eq!(
            offer.download_url.as_str(),
            format!(
                "https://github.com/Git-Khronos/Git-Khronos/releases/download/v{version}/{asset}"
            )
        );
        offer.verify(&bytes).unwrap();
        // Keep the same accepted offer and change the downloaded body.
        // Manifest parsing alone cannot stand in for payload verification.
        *bytes.last_mut().expect("nonempty verified Debian package") ^= 1;
        assert!(offer.verify(&bytes).is_err());
        let (_app, current) = manifest_consumer(version, key.trim(), target);
        assert!(current.restore_update(manifest).unwrap().is_none());
    }

    #[test]
    fn stages_verified_packages_and_exact_platform_manifests() {
        for (arch, rust_arch) in [("amd64", "x86_64"), ("arm64", "aarch64")] {
            let area = tempfile::tempdir().unwrap();
            let name = format!("Git-Khronos_0.2.0_{arch}.deb");
            let package = area.path().join(&name);
            let bytes = fs::read(fixture(&format!("matching-{arch}.deb"))).unwrap();
            fs::write(&package, &bytes).unwrap();
            let digest = format!("{:x}", Sha256::digest(&bytes));
            let signature = fixture(&format!("matching-{arch}.deb.sig"));
            let staged = stage(
                &package,
                &signature,
                &fixture("public.key"),
                area.path(),
                &digest,
            )
            .unwrap();
            let manifest_bytes = fs::read(staged.join("latest.json")).unwrap();
            let manifest: serde_json::Value = serde_json::from_slice(&manifest_bytes).unwrap();
            let target = format!("linux-{rust_arch}-deb");
            let platform = &manifest["platforms"][&target];
            assert_eq!(manifest["version"], "0.2.0");
            assert_eq!(
                platform["url"],
                format!(
                    "https://github.com/Git-Khronos/Git-Khronos/releases/download/v0.2.0/{name}"
                )
            );
            assert_eq!(
                platform["signature"],
                fs::read_to_string(signature).unwrap().trim()
            );
            let staged_bytes = fs::read(staged.join(&name)).unwrap();
            assert_eq!(staged_bytes, bytes);
            let key = fs::read_to_string(fixture("public.key")).unwrap();
            // The publisher and consumer are distinct: exercise the real
            // updater against the exact manifest and bytes emitted by staging.
            // Simulate each manifest target without changing process-wide
            // bundle detection or introducing a network endpoint override.
            let (_app, updater) = manifest_consumer("0.1.0", key.trim(), &target);
            let offer = updater.restore_update(manifest.clone()).unwrap().unwrap();
            assert_eq!(offer.version, "0.2.0");
            assert_eq!(Some(offer.download_url.as_str()), platform["url"].as_str());
            offer.verify(&staged_bytes).unwrap();
            let (_app, current) = manifest_consumer("0.2.0", key.trim(), &target);
            assert!(current.restore_update(manifest.clone()).unwrap().is_none());
            let (_app, unsupported) = manifest_consumer("0.1.0", key.trim(), "linux-x86_64-rpm");
            assert!(unsupported.restore_update(manifest).is_err());
            assert_eq!(
                fs::read_to_string(staged.join("update-assets.sha256")).unwrap(),
                format!(
                    "{digest}  {name}\n{:x}  latest.json\n",
                    Sha256::digest(manifest_bytes)
                )
            );
        }
    }

    #[test]
    fn refusals_leave_no_release_staging_directory() {
        let area = tempfile::tempdir().unwrap();
        let package = area.path().join("Git-Khronos_0.2.0_amd64.deb");
        for (deb, sig, key, right_digest) in [
            ("matching-amd64", "matching-amd64", "other-public.key", true),
            ("matching-amd64", "matching-amd64", "public.key", false),
            ("wrong-package", "wrong-package", "public.key", true),
            ("matching-arm64", "matching-arm64", "public.key", true),
            ("matching-arm64", "matching-amd64", "public.key", true),
        ] {
            let bytes = fs::read(fixture(&format!("{deb}.deb"))).unwrap();
            fs::write(&package, &bytes).unwrap();
            let digest = if right_digest {
                format!("{:x}", Sha256::digest(bytes))
            } else {
                "0".repeat(64)
            };
            assert!(
                stage(
                    &package,
                    &fixture(&format!("{sig}.deb.sig")),
                    &fixture(key),
                    area.path(),
                    &digest
                )
                .is_err()
            );
            assert_eq!(area.path().read_dir().unwrap().count(), 1);
        }
        let old = area.path().join("Git-Khronos_0.1.0_amd64.deb");
        let bytes = fs::read(fixture("wrong-version.deb")).unwrap();
        fs::write(&old, &bytes).unwrap();
        let error = stage(
            &old,
            &fixture("wrong-version.deb.sig"),
            &fixture("public.key"),
            area.path(),
            &format!("{:x}", Sha256::digest(bytes)),
        )
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("signature must bind the exact Debian version"),
            "{error}"
        );
        assert_eq!(area.path().read_dir().unwrap().count(), 2);
    }

    #[test]
    fn prepublication_verification_rechecks_final_assets_and_independent_qualification() {
        let area = tempfile::tempdir().unwrap();
        let package_name = "Git-Khronos_0.2.0_amd64.deb";
        let package = area.path().join(package_name);
        let payload = fs::read(fixture("matching-amd64.deb")).unwrap();
        fs::write(&package, &payload).unwrap();
        let digest = format!("{:x}", Sha256::digest(&payload));
        let key = fixture("public.key");
        let staged = stage(
            &package,
            &fixture("matching-amd64.deb.sig"),
            &key,
            area.path(),
            &digest,
        )
        .unwrap();
        let package_inventory = "Git-Khronos_0.2.0_amd64.cdx.json";
        let source_inventory = "Git-Khronos_0.2.0_source.cdx.json";
        let inventory = br#"{"bomFormat":"CycloneDX","components":[{"name":"owned-fixture"}]}"#;
        for name in [package_inventory, source_inventory] {
            fs::write(staged.join(name), inventory).unwrap();
        }
        let write_sums = || {
            let sums = [
                package_name,
                "latest.json",
                package_inventory,
                source_inventory,
            ]
            .iter()
            .map(|name| {
                let bytes = fs::read(staged.join(name)).unwrap();
                format!("{:x}  {name}\n", Sha256::digest(bytes))
            })
            .collect::<String>();
            fs::write(staged.join("SHA256SUMS"), &sums).unwrap();
            sums
        };
        let original_sums = write_sums();
        verify_release(&staged, &key, "v0.2.0", &digest).unwrap();
        assert_eq!(
            staged.read_dir().unwrap().count(),
            6,
            "verification must not publish or add files"
        );
        assert!(verify_release(&staged, &key, "v0.2.1", &digest).is_err());
        assert!(verify_release(&staged, &fixture("other-public.key"), "v0.2.0", &digest).is_err());

        let manifest_path = staged.join("latest.json");
        let original = fs::read_to_string(&manifest_path).unwrap();
        fs::write(
            &manifest_path,
            original.replace("/releases/download/", "/releases/latest/download/"),
        )
        .unwrap();
        write_sums();
        let error = verify_release(&staged, &key, "v0.2.0", &digest).unwrap_err();
        assert!(error.to_string().contains("manifest differs"));
        fs::write(&manifest_path, original).unwrap();

        let repeated = format!("{original_sums}{original_sums}");
        fs::write(staged.join("SHA256SUMS"), repeated).unwrap();
        let error = verify_release(&staged, &key, "v0.2.0", &digest).unwrap_err();
        assert!(error.to_string().contains("repeated"));

        fs::write(
            staged.join(source_inventory),
            br#"{"bomFormat":"CycloneDX","components":[]}"#,
        )
        .unwrap();
        write_sums();
        let error = verify_release(&staged, &key, "v0.2.0", &digest).unwrap_err();
        assert!(error.to_string().contains("invalid CycloneDX inventory"));
        fs::write(staged.join(source_inventory), inventory).unwrap();

        fs::write(staged.join(package_name), b"different package").unwrap();
        write_sums();
        let error = verify_release(&staged, &key, "v0.2.0", &digest).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("differs from the qualified artifact")
        );
    }
}
