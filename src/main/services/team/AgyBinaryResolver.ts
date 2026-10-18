import * as fs from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildMergedCliPath } from '@main/utils/cliPathMerge';

const CACHE_TTL_MS = 30_000;

let cachedBinaryPath: string | null | undefined;
let cacheVerifiedAt = 0;
let resolveInFlight: Promise<string | null> | null = null;

async function isExecutableFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return false;
    if (process.platform === 'win32') return true;
    await fsp.access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isExecutableFileSync(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (process.platform === 'win32') return true;
    fs.accessSync(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function expandWindowsExtensions(candidate: string): string[] {
  if (process.platform !== 'win32') {
    return [candidate];
  }

  const pathext = process.env.PATHEXT?.split(';').filter(Boolean) ?? [
    '.EXE',
    '.CMD',
    '.BAT',
    '.COM',
  ];
  const hasKnownExtension = pathext.some((ext) =>
    candidate.toLowerCase().endsWith(ext.toLowerCase())
  );
  if (hasKnownExtension) {
    return [candidate];
  }

  return [candidate, ...pathext.map((ext) => `${candidate}${ext.toLowerCase()}`)];
}

export class AgyBinaryResolver {
  static getCached(): string | null | undefined {
    return cachedBinaryPath;
  }

  static resolveSync(): string | null {
    const now = Date.now();
    if (cachedBinaryPath !== undefined && now - cacheVerifiedAt < CACHE_TTL_MS) {
      return cachedBinaryPath;
    }

    const result = AgyBinaryResolver.findBinarySync();
    cachedBinaryPath = result;
    cacheVerifiedAt = Date.now();
    return result;
  }

  static async resolve(): Promise<string | null> {
    const now = Date.now();
    if (cachedBinaryPath !== undefined && now - cacheVerifiedAt < CACHE_TTL_MS) {
      return cachedBinaryPath;
    }

    if (resolveInFlight) {
      return resolveInFlight;
    }

    resolveInFlight = (async () => {
      try {
        const result = await AgyBinaryResolver.findBinary();
        cachedBinaryPath = result;
        cacheVerifiedAt = Date.now();
        return result;
      } finally {
        resolveInFlight = null;
      }
    })();

    return resolveInFlight;
  }

  static invalidateCache(): void {
    cachedBinaryPath = undefined;
    cacheVerifiedAt = 0;
    resolveInFlight = null;
  }

  private static getWellKnownCandidates(): string[] {
    const home = os.homedir();
    const wellKnownCandidates: string[] = [];

    if (process.resourcesPath) {
      const bundledName = process.platform === 'win32' ? 'agy.exe' : 'agy';
      wellKnownCandidates.push(
        path.join(process.resourcesPath, 'runtime', bundledName),
        path.join(process.resourcesPath, bundledName)
      );
    }
    const devRuntimeDir = path.join(process.cwd(), 'resources', 'runtime');
    wellKnownCandidates.push(
      path.join(devRuntimeDir, process.platform === 'win32' ? 'agy.exe' : 'agy')
    );

    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
      wellKnownCandidates.push(
        path.join(localAppData, 'agy', 'bin', 'agy.exe'),
        path.join(home, '.gemini', 'bin', 'agy.exe'),
        path.join(home, 'bin', 'agy.exe')
      );
    } else {
      wellKnownCandidates.push(
        path.join(home, '.local', 'bin', 'agy'),
        path.join(home, '.gemini', 'bin', 'agy'),
        path.join(home, 'bin', 'agy'),
        '/usr/local/bin/agy',
        '/opt/homebrew/bin/agy',
        '/usr/bin/agy'
      );
    }
    return wellKnownCandidates;
  }

  private static findBinarySync(): string | null {
    const explicitPath = process.env.AGY_CLI_PATH;
    if (explicitPath) {
      for (const candidate of expandWindowsExtensions(explicitPath)) {
        if (isExecutableFileSync(candidate)) {
          return candidate;
        }
      }
    }

    const searchPath = buildMergedCliPath();
    const pathDirs = searchPath.split(path.delimiter).filter(Boolean);
    for (const dir of pathDirs) {
      for (const candidate of expandWindowsExtensions(path.join(dir, 'agy'))) {
        if (isExecutableFileSync(candidate)) {
          return candidate;
        }
      }
    }

    for (const candidate of AgyBinaryResolver.getWellKnownCandidates()) {
      if (isExecutableFileSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private static async findBinary(): Promise<string | null> {
    // 1. Explicit override via AGY_CLI_PATH
    const explicitPath = process.env.AGY_CLI_PATH;
    if (explicitPath) {
      for (const candidate of expandWindowsExtensions(explicitPath)) {
        if (await isExecutableFile(candidate)) {
          return candidate;
        }
      }
    }

    // 2. Search PATH directories
    const searchPath = buildMergedCliPath();
    const pathDirs = searchPath.split(path.delimiter).filter(Boolean);
    for (const dir of pathDirs) {
      for (const candidate of expandWindowsExtensions(path.join(dir, 'agy'))) {
        if (await isExecutableFile(candidate)) {
          return candidate;
        }
      }
    }

    // 3. Well-known standard OS install locations and bundled runtime paths
    for (const candidate of AgyBinaryResolver.getWellKnownCandidates()) {
      if (await isExecutableFile(candidate)) {
        return candidate;
      }
    }

    return null;
  }
}
