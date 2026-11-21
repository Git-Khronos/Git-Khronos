// Match operator-owned local build and acceptance evidence. These JSON records
// are not signatures; the release stager still verifies the package itself.
import { createHash } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { checkPackage } from './check-linux-abi.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const TRUST_SCENARIO = 'native-updates-menu-recognizes-publisher-trust-with-default-off-and-no-installable-offer';
const EXECUTABLE = '/usr/bin/git-khronos';
const DESKTOP_ENTRY = '/usr/share/applications/git-khronos.desktop';

async function readBounded(path, max) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 1 || info.size > max) throw new Error('Invalid release evidence file');
    const bytes = Buffer.alloc(max + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > max) throw new Error('Oversized release evidence file');
    return bytes.subarray(0, offset).toString('utf8');
  } finally {
    await file.close();
  }
}

export function qualifiedPackageDigest(receipt, report, publicKey) {
  // Match the public-key value loaded by shell command substitution for the
  // build receipt. Interior or trailing non-newline characters aren't stripped.
  const key = publicKey.replace(/\n+$/, '');
  if (!key.trim()) throw new Error('Missing release publisher key');
  const fingerprint = createHash('sha256').update(key).digest('hex');
  const digest = receipt?.outputs?.package?.sha256;
  if (receipt?.version !== 1 || typeof digest !== 'string' || !SHA256.test(digest) ||
      receipt.buildConfiguration?.updaterPublicKeySha256 !== fingerprint) {
    throw new Error('The package build receipt does not bind the supplied publisher key');
  }
  const status = report?.applicationUpdates?.nativeStatus;
  if (report?.suite !== 'environment' || report.passed !== true || report.packageSha256 !== digest ||
      status?.packageFormat !== 'deb' || status.configured !== true || status.automatic !== false ||
      status.offerId !== null || status.canInstall !== false ||
      !Array.isArray(report.scenarios) || !report.scenarios.includes(TRUST_SCENARIO)) {
    throw new Error('The native report does not qualify this publisher-key-enabled package');
  }
  return digest;
}

export async function checkEvidence(receiptPath, reportPath, keyPath, releasePackage) {
  const receipt = JSON.parse(await readBounded(receiptPath, 65536));
  const report = JSON.parse(await readBounded(reportPath, 4 * 1024 * 1024));
  const digest = qualifiedPackageDigest(receipt, report, await readBounded(keyPath, 4096));
  if (releasePackage !== undefined) {
    if (typeof receipt.checksum !== 'string' || !/^ubuntu-jammy:[A-Za-z0-9_:+/=.-]+$/.test(receipt.checksum)) {
      throw new Error('Publication requires a completed Ubuntu 22.04 build receipt');
    }
    const source = await open(releasePackage, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let temporary;
    try {
      const info = await source.stat();
      if (!info.isFile() || info.size < 1 || info.size > 512 * 1024 * 1024) {
        throw new Error('Expected a bounded, regular release package');
      }
      temporary = await mkdtemp(join(tmpdir(), 'git-khronos-release-evidence-'));
      const snapshot = join(temporary, 'candidate.deb');
      const hash = createHash('sha256');
      const bytes = source.createReadStream({ autoClose: false, end: info.size - 1 });
      bytes.on('data', chunk => hash.update(chunk));
      await pipeline(bytes, createWriteStream(snapshot, { flags: 'wx', mode: 0o600 }));
      if (hash.digest('hex') !== digest) throw new Error('The release package differs from the qualified artifact');
      if (report.installedExecutable !== true || report.executable !== EXECUTABLE ||
          report.installedDesktopEntry?.path !== DESKTOP_ENTRY || report.inheritedGitEnvironment !== true ||
          ![report.initialRepositoryIntegrity, report.repositoryIntegrity].every(check =>
            check?.passed === true && check.exitCode === 0)) {
        throw new Error('Expected an installed environment report with the packaged launcher and passing initial and final Git integrity checks');
      }
      const checked = checkPackage(snapshot);
      if (checked.packageSha256 !== digest) {
        throw new Error('The ABI-checked release package differs from the qualified artifact');
      }
      if (report.executableSha256 !== checked.installedPayload.executableSha256 ||
          report.installedDesktopEntry.sha256 !== checked.installedPayload.desktopEntrySha256 ||
          report.applicationUpdates.nativeStatus.runningVersion !== checked.version) {
        throw new Error('Installed runtime evidence differs from the qualified artifact');
      }
    } finally {
      await source.close();
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
  }
  return digest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  try {
    let releasePackage;
    if (args[0] === '--release-package') [, releasePackage] = args.splice(0, 2);
    if (args.length !== 3 || args.some(arg => arg.startsWith('--'))) {
      throw new Error('Usage: check-debian-update-evidence [--release-package PACKAGE] BUILD-RECEIPT NATIVE-REPORT PUBLIC-KEY');
    }
    console.log(await checkEvidence(...args, releasePackage));
  } catch (error) {
    console.error(`Git Khronos: ${error.message}`);
    process.exitCode = 1;
  }
}
