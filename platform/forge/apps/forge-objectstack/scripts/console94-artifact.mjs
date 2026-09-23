import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
