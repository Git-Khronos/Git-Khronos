// Match operator-owned local build and acceptance evidence. These JSON records
// are not signatures; the release stager still verifies the package itself.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA256 = /^[a-f0-9]{64}$/;
const TRUST_SCENARIO = 'native-updates-menu-recognizes-publisher-trust-with-default-off-and-no-installable-offer';

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

export async function checkEvidence(receiptPath, reportPath, keyPath) {
  return qualifiedPackageDigest(
    JSON.parse(await readBounded(receiptPath, 65536)),
    JSON.parse(await readBounded(reportPath, 4 * 1024 * 1024)),
    await readBounded(keyPath, 4096));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  try {
    if (args.length !== 3) throw new Error('Usage: check-debian-update-evidence BUILD-RECEIPT NATIVE-REPORT PUBLIC-KEY');
    console.log(await checkEvidence(...args));
  } catch (error) {
    console.error(`Git Khronos: ${error.message}`);
    process.exitCode = 1;
  }
}
