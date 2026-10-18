import { AgyBinaryResolver } from '@main/services/team/AgyBinaryResolver';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('AgyBinaryResolver', () => {
  let tmpDir: string;
  const originalAgyCliPath = process.env.AGY_CLI_PATH;

  beforeEach(() => {
    AgyBinaryResolver.invalidateCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-resolver-test-'));
  });

  afterEach(() => {
    AgyBinaryResolver.invalidateCache();
    if (originalAgyCliPath !== undefined) {
      process.env.AGY_CLI_PATH = originalAgyCliPath;
    } else {
      delete process.env.AGY_CLI_PATH;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves explicit AGY_CLI_PATH when set to a valid file', async () => {
    const fakeBinaryName = process.platform === 'win32' ? 'fake-agy.exe' : 'fake-agy';
    const fakeBinaryPath = path.join(tmpDir, fakeBinaryName);
    fs.writeFileSync(fakeBinaryPath, '#!/bin/sh\necho "agy 1.4.0"', { mode: 0o755 });

    process.env.AGY_CLI_PATH = fakeBinaryPath;
    const resolved = await AgyBinaryResolver.resolve();

    expect(resolved).toBe(fakeBinaryPath);
  });

  it('caches the resolved binary path across subsequent calls', async () => {
    const fakeBinaryName = process.platform === 'win32' ? 'fake-agy.exe' : 'fake-agy';
    const fakeBinaryPath = path.join(tmpDir, fakeBinaryName);
    fs.writeFileSync(fakeBinaryPath, '#!/bin/sh\necho "agy 1.4.0"', { mode: 0o755 });

    process.env.AGY_CLI_PATH = fakeBinaryPath;
    const first = await AgyBinaryResolver.resolve();
    expect(first).toBe(fakeBinaryPath);

    // Remove the file, but cache should still return it
    fs.unlinkSync(fakeBinaryPath);
    const cached = await AgyBinaryResolver.resolve();
    expect(cached).toBe(fakeBinaryPath);

    // Invalidate cache
    AgyBinaryResolver.invalidateCache();
    const afterInvalidate = await AgyBinaryResolver.resolve();
    expect(afterInvalidate).not.toBe(fakeBinaryPath);
  });

  it('resolves synchronously with resolveSync', () => {
    const fakeBinaryName = process.platform === 'win32' ? 'fake-agy.exe' : 'fake-agy';
    const fakeBinaryPath = path.join(tmpDir, fakeBinaryName);
    fs.writeFileSync(fakeBinaryPath, '#!/bin/sh\necho "agy 1.4.0"', { mode: 0o755 });

    process.env.AGY_CLI_PATH = fakeBinaryPath;
    const resolved = AgyBinaryResolver.resolveSync();
    expect(resolved).toBe(fakeBinaryPath);
  });
});
