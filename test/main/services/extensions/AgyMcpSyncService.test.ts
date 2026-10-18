import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { AgyMcpConfigManager } from '@main/services/extensions/agy/AgyMcpConfigManager';
import { AgyMcpSyncService } from '@main/services/extensions/agy/AgyMcpSyncService';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_ROOT = path.parse(process.cwd()).root || path.sep;
const MOCK_HOME_PATH = path.join(TEST_ROOT, 'tmp', 'mock-home');
const PROJECT_PATH = path.join(TEST_ROOT, 'tmp', 'project-test');

function normalizeMockPath(filePath: unknown): string {
  return String(filePath).replaceAll('\\', '/');
}

vi.mock('@main/utils/pathDecoder', () => ({
  getHomeDir: () => {
    const cwd = process.cwd();
    const windowsRoot = cwd.match(/^[A-Za-z]:[\\/]/)?.[0] ?? null;
    const root = windowsRoot ?? '/';
    const sep = windowsRoot ? '\\' : '/';
    return `${root}${root.endsWith(sep) ? '' : sep}tmp${sep}mock-home`;
  },
}));

vi.mock('node:fs/promises');

describe('AgyMcpSyncService', () => {
  let syncService: AgyMcpSyncService;
  let configManager: AgyMcpConfigManager;
  const mockedFsp = vi.mocked(fsp);

  beforeEach(() => {
    configManager = new AgyMcpConfigManager();
    syncService = new AgyMcpSyncService(configManager);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('syncAgyToApp', () => {
    it('imports AGY servers into Claude config, skipping disabled servers by default', async () => {
      const claudeConfigPath = normalizeMockPath(path.join(MOCK_HOME_PATH, '.claude.json'));
      const storedFiles: Record<string, string> = {
        [claudeConfigPath]: JSON.stringify({
          mcpServers: {
            existingClaudeServer: { command: 'node', args: ['existing.js'] },
          },
        }),
      };

      vi.spyOn(configManager, 'listServers').mockResolvedValue([
        {
          name: 'agyStdioServer',
          type: 'stdio',
          status: 'enabled',
          commandOrUrl: 'npx -y agy-server',
          scope: 'global',
          config: {
            command: 'npx',
            args: ['-y', 'agy-server'],
            env: { API_KEY: 'secret' },
            disabled: false,
          },
        },
        {
          name: 'agyHttpServer',
          type: 'http',
          status: 'enabled',
          commandOrUrl: 'https://example.com/mcp',
          scope: 'global',
          config: {
            serverUrl: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer token' },
            disabled: false,
          },
        },
        {
          name: 'disabledAgyServer',
          type: 'stdio',
          status: 'disabled',
          commandOrUrl: 'npx -y disabled-pkg',
          scope: 'global',
          config: {
            command: 'npx',
            args: ['-y', 'disabled-pkg'],
            disabled: true,
          },
        },
        {
          name: 'existingClaudeServer',
          type: 'stdio',
          status: 'enabled',
          commandOrUrl: 'node updated.js',
          scope: 'global',
          config: {
            command: 'node',
            args: ['updated.js'],
          },
        },
      ]);

      mockedFsp.readFile.mockImplementation(async (filePath) => {
        const norm = normalizeMockPath(filePath);
        if (storedFiles[norm]) return storedFiles[norm];
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });
      mockedFsp.mkdir.mockResolvedValue(undefined);
      mockedFsp.writeFile.mockImplementation(async (filePath, content) => {
        const norm = normalizeMockPath(filePath);
        storedFiles[norm] = String(content);
      });

      const result = await syncService.syncAgyToApp({ overwrite: false });

      expect(result.success).toBe(true);
      expect(result.added).toEqual(['agyStdioServer', 'agyHttpServer']);
      expect(result.skipped).toEqual(['disabledAgyServer', 'existingClaudeServer']);

      const updatedClaude = JSON.parse(storedFiles[claudeConfigPath]);
      expect(updatedClaude.mcpServers.agyStdioServer).toEqual({
        command: 'npx',
        args: ['-y', 'agy-server'],
        env: { API_KEY: 'secret' },
      });
      expect(updatedClaude.mcpServers.agyHttpServer).toEqual({
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer token' },
      });
    });

    it('updates existing servers when overwrite is true', async () => {
      const claudeConfigPath = normalizeMockPath(path.join(MOCK_HOME_PATH, '.claude.json'));
      const storedFiles: Record<string, string> = {
        [claudeConfigPath]: JSON.stringify({
          mcpServers: {
            conflictServer: { command: 'node', args: ['old.js'] },
          },
        }),
      };

      vi.spyOn(configManager, 'listServers').mockResolvedValue([
        {
          name: 'conflictServer',
          type: 'stdio',
          status: 'enabled',
          commandOrUrl: 'node new.js',
          scope: 'global',
          config: { command: 'node', args: ['new.js'] },
        },
      ]);

      mockedFsp.readFile.mockImplementation(async (filePath) => {
        const norm = normalizeMockPath(filePath);
        if (storedFiles[norm]) return storedFiles[norm];
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });
      mockedFsp.mkdir.mockResolvedValue(undefined);
      mockedFsp.writeFile.mockImplementation(async (filePath, content) => {
        const norm = normalizeMockPath(filePath);
        storedFiles[norm] = String(content);
      });

      const result = await syncService.syncAgyToApp({ overwrite: true });

      expect(result.updated).toEqual(['conflictServer']);
      const updatedClaude = JSON.parse(storedFiles[claudeConfigPath]);
      expect(updatedClaude.mcpServers.conflictServer).toEqual({
        command: 'node',
        args: ['new.js'],
      });
    });
  });

  describe('syncAppToAgy', () => {
    it('exports Claude servers to AGY ecosystem config', async () => {
      const claudeConfigPath = normalizeMockPath(path.join(PROJECT_PATH, '.mcp.json'));
      mockedFsp.readFile.mockImplementation(async (filePath) => {
        const norm = normalizeMockPath(filePath);
        if (norm === claudeConfigPath) {
          return JSON.stringify({
            mcpServers: {
              claudeOnlyServer: {
                command: 'npx',
                args: ['-y', 'some-pkg'],
                env: { TOKEN: 'xyz' },
              },
            },
          });
        }
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });

      vi.spyOn(configManager, 'listServers').mockResolvedValue([]);
      const addServerSpy = vi.spyOn(configManager, 'addServer').mockResolvedValue(undefined);

      const result = await syncService.syncAppToAgy({ projectPath: PROJECT_PATH });

      expect(result.success).toBe(true);
      expect(result.added).toEqual(['claudeOnlyServer']);
      expect(addServerSpy).toHaveBeenCalledWith(
        'claudeOnlyServer',
        {
          command: 'npx',
          args: ['-y', 'some-pkg'],
          env: { TOKEN: 'xyz' },
          disabled: false,
        },
        'project',
        PROJECT_PATH
      );
    });
  });

  describe('syncBidirectional', () => {
    it('orchestrates bidirectional sync delegating based on preferSource', async () => {
      const syncToAppSpy = vi.spyOn(syncService, 'syncAgyToApp').mockResolvedValue({
        success: true,
        direction: 'from-agy',
        added: ['serverA'],
        updated: [],
        skipped: [],
        failed: [],
      });
      const syncToAgySpy = vi.spyOn(syncService, 'syncAppToAgy').mockResolvedValue({
        success: true,
        direction: 'to-agy',
        added: ['serverB'],
        updated: [],
        skipped: [],
        failed: [],
      });

      const result = await syncService.syncBidirectional({ preferSource: 'app' });

      expect(result.success).toBe(true);
      expect(syncToAgySpy).toHaveBeenCalledWith(expect.objectContaining({ overwrite: true }));
      expect(syncToAppSpy).toHaveBeenCalledWith(expect.objectContaining({ overwrite: false }));
    });
  });
});
