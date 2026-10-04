import { cp, mkdtemp, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function moveDirectory(source, destination, renameImpl) {
  try {
    await renameImpl(source, destination);
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
    await cp(source, destination, { recursive: true });
    await rm(source, { recursive: true, force: true });
  }
}

export async function installConsoleDist({ sourceDist, targetDist, verify, renameImpl = rename }) {
  const packageDir = path.dirname(targetDist);
  const stagingParent = await mkdtemp(path.join(packageDir, '.console94-install-'));
  const stagedDist = path.join(stagingParent, 'new-dist');
  const backupDist = path.join(stagingParent, 'previous-dist');
  let backupReady = false;
  let keepBackup = false;

  try {
    await cp(sourceDist, stagedDist, { recursive: true });
    await cp(targetDist, backupDist, { recursive: true });
    backupReady = true;

    await rm(targetDist, { recursive: true, force: true });
    await moveDirectory(stagedDist, targetDist, renameImpl);
    const result = await verify(targetDist);
    await rm(backupDist, { recursive: true, force: true });
    backupReady = false;
    return result;
  } catch (installError) {
    if (backupReady) {
      try {
        await rm(targetDist, { recursive: true, force: true });
        await cp(backupDist, targetDist, { recursive: true });
        backupReady = false;
      } catch (restoreError) {
        keepBackup = true;
        throw new AggregateError(
          [installError, restoreError],
          `Console injection failed and the original dist backup is preserved at ${backupDist}`,
        );
      }
    }
    throw installError;
  } finally {
    if (!keepBackup) await rm(stagingParent, { recursive: true, force: true });
  }
}
