import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, inflateRawSync } from 'node:zlib';

export function consoleBuildEnvironment(parent, lock) {
  const environment = { ...parent, VITE_BASE_PATH: lock.artifact.basePath, VITE_UI_PROFILE: lock.source.uiProfile || 'compact-enterprise' };
  // ObjectUI skips gzip/Brotli for any nonempty CI/VERCEL value, even "false".
  // The locked production artifact includes those files; leave the parent alone.
  delete environment.CI;
  delete environment.VERCEL;
  return environment;
}

export async function canonicalizeConsoleGzip(distDir, lock) {
  const rule = lock.artifact.gzipNormalization;
  if (rule?.operatingSystem !== 255 || rule.compressionMethod !== 8 || rule.flags !== 0 || rule.singleMember !== true || rule.verifyOriginalBytes !== true) {
    throw new Error('Console lock must declare the standard single-member gzip OS=255 recipe.');
  }
  const pending = [];
  let gzipFiles = 0;
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) throw new Error('Console artifact contains an unsupported filesystem entry.');
      if (!entry.name.endsWith('.gz')) continue;
      const relative = path.relative(distDir, absolute);
      const bytes = await readFile(absolute);
      // Only the fixed ten-byte header emitted by this locked producer is
      // supported. In particular FHCRC cannot survive a blind OS-byte edit.
      if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8 || bytes[3] !== 0) {
        throw new Error(`Unexpected gzip header: ${relative}`);
      }
      const originalPath = absolute.slice(0, -3);
      if (!(await lstat(originalPath)).isFile()) throw new Error(`Gzip original must be a regular file: ${relative}`);
      const original = await readFile(originalPath);
      let payload, stream;
      try {
        payload = gunzipSync(bytes, { maxOutputLength: original.length + 1 });
        stream = inflateRawSync(bytes.subarray(10), { info: true, maxOutputLength: original.length + 1 });
      } catch {
        throw new Error(`Invalid gzip payload, CRC or size: ${relative}`);
      }
      if (10 + stream.engine.bytesWritten + 8 !== bytes.length) throw new Error(`Unexpected gzip member or trailing bytes: ${relative}`);
      if (!payload.equals(original)) throw new Error(`Gzip payload differs from its original file: ${relative}`);
      gzipFiles++;
      if (bytes[9] !== 255) {
        const canonical = Buffer.from(bytes);
        canonical[9] = 255; // RFC 1952: unknown OS. Payload, CRC and other bytes stay intact.
        pending.push({ absolute, canonical });
      }
    }
  }
  await walk(distDir);
  // Validate the entire generated set before changing any file.
  for (const item of pending) await writeFile(item.absolute, item.canonical);
  return { gzipFiles, changedFiles: pending.length };
}

export async function treeSha256(root) {
  const entries = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        entries.push({ absolute, relative: path.relative(root, absolute).split(path.sep).join('/') });
      } else {
        throw new Error(`Console artifact contains an unsupported filesystem entry: ${absolute}`);
      }
    }
  }
  await walk(root);
  entries.sort((left, right) => left.relative < right.relative ? -1 : left.relative > right.relative ? 1 : 0);

  const hash = createHash('sha256');
  let totalBytes = 0;
  for (const entry of entries) {
    const pathBytes = Buffer.from(entry.relative, 'utf8');
    const bytes = await readFile(entry.absolute);
    totalBytes += bytes.length;
    const fileHash = createHash('sha256').update(bytes).digest();
    const pathLength = Buffer.alloc(4);
    pathLength.writeUInt32BE(pathBytes.length);
    const fileLength = Buffer.alloc(8);
    fileLength.writeBigUInt64BE(BigInt(bytes.length));
    hash.update(pathLength).update(pathBytes).update(fileLength).update(fileHash);
  }
  return { sha256: hash.digest('hex'), files: entries.length, bytes: totalBytes };
}

export async function applyConsolePackagingPatches(distDir, lock) {
  const manifestPatch = lock.artifact.patches.find((entry) => entry.path === 'index.html');
  if (!manifestPatch) throw new Error('Console lock is missing its generated manifest URL patch.');
  const indexPath = path.join(distDir, manifestPatch.path);
  const index = await readFile(indexPath, 'utf8');
  const occurrences = index.split(manifestPatch.from).length - 1;
  if (occurrences !== 1) throw new Error(`Expected one generated manifest link to patch; found ${occurrences}.`);
  await writeFile(indexPath, index.replace(manifestPatch.from, manifestPatch.to));

  const stampPatch = lock.artifact.patches.find((entry) => entry.path === 'dist/.objectui-sha');
  if (!stampPatch) throw new Error('Console lock is missing its ObjectUI source stamp.');
  await writeFile(path.join(distDir, '.objectui-sha'), `${stampPatch.content}\n`);
}

export async function verifyConsoleArtifact({ distDir, manifest, lock }) {
  const stamp = (await readFile(path.join(distDir, '.objectui-sha'), 'utf8')).trim();
  if (stamp !== lock.source.revision) throw new Error(`Console source stamp mismatch: expected ${lock.source.revision}, got ${stamp}`);
  if (manifest.sourceRevision !== lock.source.revision) throw new Error('Console build manifest source revision does not match the lock.');
  if (manifest.basePath !== lock.artifact.basePath) throw new Error('Console build manifest base path does not match the lock.');
  if (manifest.sourceTreeSha256 !== lock.artifact.runtimeSourceTreeSha256) throw new Error('Console build manifest source tree digest does not match the lock.');
  if (manifest.rawIndexSha256 !== lock.artifact.rawIndexSha256) throw new Error('Console build manifest source index digest does not match the lock.');
  if (manifest.forgeRuntimeImage !== lock.forge.runtimeImageReference) throw new Error('Console build manifest runtime image does not match the lock.');
  const digest = await treeSha256(distDir);
  if (digest.sha256 !== lock.artifact.packagedTreeSha256) {
    throw new Error(`Packaged Console tree digest mismatch: expected ${lock.artifact.packagedTreeSha256}, got ${digest.sha256}`);
  }
  if (manifest.files !== digest.files || manifest.bytes !== digest.bytes) throw new Error('Console build manifest file count or byte count does not match the artifact.');
  const index = await readFile(path.join(distDir, 'index.html'), 'utf8');
  if (!index.includes('href="/_console/manifest.json"')) throw new Error('Console manifest link is not rooted at /_console/.');
  if (index.includes('href="./manifest.json"')) throw new Error('Console index still contains the nested-route-broken relative manifest link.');
  return { ...digest, sourceRevision: stamp, basePath: manifest.basePath };
}
