import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import {
  AgyMcpConfigManager,
  getAgyGlobalConfigPath,
  getAgyIdeConfigPath,
  getAgyProjectConfigPath,
} from '@main/services/extensions/agy/AgyMcpConfigManager';
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

describe('AgyMcpConfigManager', () => {
  let manager: AgyMcpConfigManager;
  const mockedFsp = vi.mocked(fsp);

  beforeEach(() => {
    manager = new AgyMcpConfigManager();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('path resolution', () => {
    it('resolves expected paths for global, IDE fallback, and project', () => {
      expect(normalizeMockPath(getAgyGlobalConfigPath())).toBe(
        normalizeMockPath(path.join(MOCK_HOME_PATH, '.gemini', 'config', 'mcp_config.json'))
      );
      expect(normalizeMockPath(getAgyIdeConfigPath())).toBe(
        normalizeMockPath(path.join(MOCK_HOME_PATH, '.gemini', 'antigravity-ide', 'mcp_config.json'))
      );
      expect(normalizeMockPath(getAgyProjectConfigPath(PROJECT_PATH))).toBe(
        normalizeMockPath(path.join(PROJECT_PATH, '.agents', 'mcp_config.json'))
      );
    });
  });

  describe('readConfigFile', () => {
    it('returns empty object when file is not found (ENOENT)', async () => {
      mockedFsp.readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const result = await manager.readConfigFile('/fake/path.json');
      expect(result).toEqual({});
    });

    it('returns empty object when JSON is malformed', async () => {
      mockedFsp.readFile.mockResolvedValue('not a valid json');

      const result = await manager.readConfigFile('/fake/path.json');
      expect(result).toEqual({});
    });

    it('returns parsed mcpServers record when JSON is valid', async () => {
      const config = {
        mcpServers: {
          'server-a': {
            command: 'npx',
            args: ['-y', 'mcp-remote'],
            disabled: false,
          },
          'server-b': {
            serverUrl: 'https://example.com/mcp',
            disabled: true,
          },
        },
      };
      mockedFsp.readFile.mockResolvedValue(JSON.stringify(config));

      const result = await manager.readConfigFile('/fake/path.json');
      expect(result).toEqual(config.mcpServers);
    });
  });

  describe('writeConfigFile', () => {
    it('creates parent directory and writes formatted JSON preserving existing top-level properties', async () => {
      mockedFsp.readFile.mockResolvedValue(
        JSON.stringify({
          allowNonWorkspaceAccess: true,
          mcpServers: {},
        })
      );
      mockedFsp.mkdir.mockResolvedValue(undefined);
      mockedFsp.writeFile.mockResolvedValue(undefined);

      const targetServers = {
        'server-x': { command: 'node', args: ['script.js'] },
      };

      await manager.writeConfigFile('/mock/dir/mcp_config.json', targetServers);

      expect(mockedFsp.mkdir).toHaveBeenCalledWith(path.dirname('/mock/dir/mcp_config.json'), { recursive: true });
      expect(mockedFsp.writeFile).toHaveBeenCalledWith(
        '/mock/dir/mcp_config.json',
        expect.stringContaining('"allowNonWorkspaceAccess": true'),
        'utf-8'
      );
      expect(mockedFsp.writeFile).toHaveBeenCalledWith(
        '/mock/dir/mcp_config.json',
        expect.stringContaining('"server-x"'),
        'utf-8'
      );
    });
  });

  describe('listServers', () => {
    it('aggregates global and project servers with correct scopes and statuses', async () => {
      const globalPath = normalizeMockPath(getAgyGlobalConfigPath());
      const idePath = normalizeMockPath(getAgyIdeConfigPath());
      const projectPath = normalizeMockPath(getAgyProjectConfigPath(PROJECT_PATH));

      mockedFsp.readFile.mockImplementation(async (filePath) => {
        const norm = normalizeMockPath(filePath);
        if (norm === globalPath) {
          return JSON.stringify({
            mcpServers: {
              globalServer: {
                command: 'npx',
                args: ['-y', 'server-pkg'],
                disabled: false,
              },
            },
          });
        }
        if (norm === idePath) {
          return JSON.stringify({
            mcpServers: {
              ideOnlyServer: {
                serverUrl: 'https://ide.example.com/mcp',
                disabled: true,
              },
            },
          });
        }
        if (norm === projectPath) {
          return JSON.stringify({
            mcpServers: {
              projectServer: {
                url: 'https://project.example.com/mcp',
                disabled: false,
              },
            },
          });
        }
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });

      const list = await manager.listServers(PROJECT_PATH);

      expect(list).toHaveLength(3);
      expect(list).toEqual(
        expect.arrayContaining([
          {
            name: 'globalServer',
            type: 'stdio',
            status: 'enabled',
            commandOrUrl: 'npx -y server-pkg',
            scope: 'global',
            config: expect.any(Object),
          },
          {
            name: 'ideOnlyServer',
            type: 'http',
            status: 'disabled',
            commandOrUrl: 'https://ide.example.com/mcp',
            scope: 'global',
            config: expect.any(Object),
          },
          {
            name: 'projectServer',
            type: 'http',
            status: 'enabled',
            commandOrUrl: 'https://project.example.com/mcp',
            scope: 'project',
            config: expect.any(Object),
          },
        ])
      );
    });
  });

  describe('parseAgyMcpListOutput', () => {
    it('correctly parses agy mcp list table output', () => {
      const sampleOutput = `
NAME                        TYPE   STATUS    COMMAND/URL
cloudflare-bindings         stdio  enabled   npx -y mcp-remote https://bindings.mcp.cloudflare.com/mcp
cloudflare-observability    stdio  enabled   npx -y mcp-remote https://observability.mcp.cloudflare.com/mcp
google-developer-knowledge  http   disabled  https://developerknowledge.googleapis.com/mcp
`;
      const servers = manager.parseAgyMcpListOutput(sampleOutput);

      expect(servers).toHaveLength(3);
      expect(servers[0]).toEqual({
        name: 'cloudflare-bindings',
        type: 'stdio',
        status: 'enabled',
        commandOrUrl: 'npx -y mcp-remote https://bindings.mcp.cloudflare.com/mcp',
        scope: 'global',
      });
      expect(servers[2]).toEqual({
        name: 'google-developer-knowledge',
        type: 'http',
        status: 'disabled',
        commandOrUrl: 'https://developerknowledge.googleapis.com/mcp',
        scope: 'global',
      });
    });
  });

  describe('addServer, removeServer, setServerDisabled', () => {
    it('adds, disables, and removes servers from target config', async () => {
      const stored: Record<string, string> = {};
      mockedFsp.readFile.mockImplementation(async (filePath) => {
        const norm = normalizeMockPath(filePath);
        if (stored[norm]) return stored[norm];
        return JSON.stringify({ mcpServers: {} });
      });
      mockedFsp.mkdir.mockResolvedValue(undefined);
      mockedFsp.writeFile.mockImplementation(async (filePath, content) => {
        const norm = normalizeMockPath(filePath);
        stored[norm] = String(content);
      });

      // Add server
      await manager.addServer(
        'custom-server',
        { command: 'node', args: ['custom.js'] },
        'global'
      );

      const afterAdd = await manager.listServers();
      expect(afterAdd.some((s) => s.name === 'custom-server')).toBe(true);

      // Disable server
      await manager.setServerDisabled('custom-server', true, 'global');
      const afterDisable = await manager.listServers();
      const disabledServer = afterDisable.find((s) => s.name === 'custom-server');
      expect(disabledServer?.status).toBe('disabled');

      // Remove server
      const removed = await manager.removeServer('custom-server', 'global');
      expect(removed).toBe(true);

      const afterRemove = await manager.listServers();
      expect(afterRemove.some((s) => s.name === 'custom-server')).toBe(false);
    });
  });
});
