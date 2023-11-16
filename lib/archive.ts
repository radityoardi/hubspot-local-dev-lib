import fs from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
import __extract from 'extract-zip';

import { throwFileSystemError } from '../errors/fileSystemErrors';
import { throwErrorWithMessage } from '../errors/standardErrors';
import { debug, makeTypedLogger } from '../utils/logger';
import { BaseError } from '../types/Error';
import { LogCallbacksArg } from '../types/LogCallbacks';

const extract = promisify(__extract);

const i18nKey = 'lib.archive';

type ZipData = {
  extractDir: string;
  tmpDir: string;
};

const archiveCallbackKeys = ['init', 'copy'];

async function extractZip(
  name: string,
  zip: Buffer,
  logCallbacks?: LogCallbacksArg<typeof archiveCallbackKeys>
): Promise<ZipData> {
  const logger = makeTypedLogger<typeof archiveCallbackKeys>(logCallbacks);
  const result: ZipData = { extractDir: '', tmpDir: '' };

  const TMP_FOLDER_PREFIX = `hubspot-temp-${name}-`;
  logger('init', `${i18nKey}.extractZip.init`);

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
    if (tmpZipPath || result.tmpDir) {
      throwFileSystemError(err as BaseError, {
        filepath: tmpZipPath || result.tmpDir,
        write: true,
      });
    } else {
      throwErrorWithMessage(
        `${i18nKey}.extractZip.errors.write`,
        {},
        err as BaseError
      );
    }
    return result;
  }
  // Extract zip
  try {
    const tmpExtractPath = join(result.tmpDir, 'extracted');
    await extract(tmpZipPath, { dir: tmpExtractPath });
    result.extractDir = tmpExtractPath;
  } catch (err) {
    throwErrorWithMessage(
      `${i18nKey}.extractZip.errors.extract`,
      {},
      err as BaseError
    );
  }
  debug(`${i18nKey}.extractZip.success`);
  return result;
}

type CopySourceToDestOptions = {
  sourceDir?: string;
  includesRootDir?: boolean;
};

async function copySourceToDest(
  src: string,
  dest: string,
  { sourceDir, includesRootDir = true }: CopySourceToDestOptions = {},
  logCallbacks?: LogCallbacksArg<typeof archiveCallbackKeys>
): Promise<boolean> {
  try {
    const logger = makeTypedLogger<typeof archiveCallbackKeys>(logCallbacks);
    logger('copy', `${i18nKey}.copySourceToDest.init`);
    const srcDirPath = [src];

    if (includesRootDir) {
      const files = await fs.readdir(src);
      const rootDir = files[0];
      if (!rootDir) {
        debug(`${i18nKey}.copySourceToDest.sourceEmpty`);
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
    debug(`${i18nKey}.copySourceToDest.success`);
    return true;
  } catch (err) {
    debug(`${i18nKey}.copySourceToDest.error`, { dest });
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
    debug(`${i18nKey}.cleanupTempDir.error`, { tmpDir });
  }
}

export async function extractZipArchive(
  zip: Buffer,
  name: string,
  dest: string,
  { sourceDir, includesRootDir }: CopySourceToDestOptions = {},
  logCallbacks?: LogCallbacksArg<typeof archiveCallbackKeys>
): Promise<boolean> {
  let success = false;

  if (zip) {
    const { extractDir, tmpDir } = await extractZip(name, zip, logCallbacks);

    if (extractDir !== null) {
      success = await copySourceToDest(
        extractDir,
        dest,
        {
          sourceDir,
          includesRootDir,
        },
        logCallbacks
      );
    }

    cleanupTempDir(tmpDir);
  }
  return success;
}
