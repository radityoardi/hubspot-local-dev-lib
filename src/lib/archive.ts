import fs from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
import __extract from 'extract-zip';

import { throwFileSystemError } from '../errors/fileSystemErrors';
import { throwError } from '../errors/standardErrors';
import { debug } from '../utils/logger';
import { BaseError } from '../types/Error';

const extract = promisify(__extract);

type ZipData = {
  extractDir: string;
  tmpDir: string;
};

async function extractZip(name: string, zip: Buffer): Promise<ZipData> {
  const result: ZipData = { extractDir: '', tmpDir: '' };

  const TMP_FOLDER_PREFIX = `hubspot-temp-${name}-`;
  debug('archive.extractZip.init');

  // Write zip to disk
  let tmpZipPath = '';
  try {
    result.tmpDir = await fs.mkdtemp(join(tmpdir(), TMP_FOLDER_PREFIX));
    tmpZipPath = join(result.tmpDir, 'hubspot-temp.zip');
    await fs.ensureFile(tmpZipPath);
    await fs.writeFile(tmpZipPath, zip, {
      mode: 0o777,
    });
  } catch (err) {
    debug('archive.extractZip.writeError');
    if (tmpZipPath || result.tmpDir) {
      throwFileSystemError(err as BaseError, {
        filepath: tmpZipPath || result.tmpDir,
        write: true,
      });
    } else {
      throwError(err as BaseError);
    }
    return result;
  }
  // Extract zip
  try {
    const tmpExtractPath = join(result.tmpDir, 'extracted');
    await extract(tmpZipPath, { dir: tmpExtractPath });
    result.extractDir = tmpExtractPath;
  } catch (err) {
    debug('archive.extractZip.extractError');
    throwError(err as BaseError);
  }
  debug('archive.extractZip.success');
  return result;
}

type CopySourceToDestOptions = {
  sourceDir?: string;
  includesRootDir?: boolean;
};

async function copySourceToDest(
  src: string,
  dest: string,
  { sourceDir, includesRootDir = true }: CopySourceToDestOptions = {}
): Promise<boolean> {
  try {
    debug('archive.copySourceToDest.init');
    const srcDirPath = [src];

    if (includesRootDir) {
      const files = await fs.readdir(src);
      const rootDir = files[0];
      if (!rootDir) {
        debug('archive.copySourceToDest.sourceEmpty');
        // Create the dest path if it doesn't already exist
        fs.ensureDir(dest);
        // No root found so nothing to copy
        return true;
      }
      srcDirPath.push(rootDir);
    }

    if (sourceDir) {
      srcDirPath.push(sourceDir);
    }

    const projectSrcDir = join(...srcDirPath);

    await fs.copy(projectSrcDir, dest);
    debug('archive.copySourceToDest.success');
    return true;
  } catch (err) {
    debug('archive.copySourceToDest.error', { dest });
    throwFileSystemError(err as BaseError, {
      filepath: dest,
      write: true,
    });
  }
  return false;
}

function cleanupTempDir(tmpDir: string): void {
  if (!tmpDir) return;
  try {
    fs.remove(tmpDir);
  } catch (e) {
    debug('archive.cleanupTempDir.error', { tmpDir });
  }
}

export async function extractZipArchive(
  zip: Buffer,
  name: string,
  dest: string,
  { sourceDir, includesRootDir }: CopySourceToDestOptions = {}
): Promise<boolean> {
  let success = false;

  if (zip) {
    const { extractDir, tmpDir } = await extractZip(name, zip);

    if (extractDir !== null) {
      success = await copySourceToDest(extractDir, dest, {
        sourceDir,
        includesRootDir,
      });
    }

    cleanupTempDir(tmpDir);
  }
  return success;
}
