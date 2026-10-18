import { AgyMcpConfigManager } from '@main/services/extensions/agy/AgyMcpConfigManager';
import { AgyMcpSyncService } from '@main/services/extensions/agy/AgyMcpSyncService';
import { ExtensionFacadeService } from '@main/services/extensions/ExtensionFacadeService';
import { describe, expect, it, vi } from 'vitest';

describe('ExtensionFacadeService - AGY MCP Integration', () => {
  it('delegates syncAgyMcp to AgyMcpSyncService and invalidates cache', async () => {
    const mockPluginCatalog = {
      getPlugins: vi.fn(),
      getPluginReadme: vi.fn(),
      resolvePlugin: vi.fn(),
    } as any;
    const mockPluginState = {
      getInstalledPlugins: vi.fn(),
      getInstallCounts: vi.fn(),
      invalidateCache: vi.fn(),
    } as any;
    const mockMcpState = {
      getInstalled: vi.fn(),
      invalidateCache: vi.fn(),
    } as any;

    const mockSyncResult = {
      success: true,
      direction: 'bidirectional' as const,
      toAgy: { success: true, direction: 'to-agy' as const, added: ['server1'], updated: [], skipped: [], failed: [] },
      fromAgy: { success: true, direction: 'from-agy' as const, added: [], updated: [], skipped: [], failed: [] },
    };

    const mockAgyMcpSync = {
      sync: vi.fn().mockResolvedValue(mockSyncResult),
    } as unknown as AgyMcpSyncService;

    const mockAgyConfigManager = {
      listServers: vi.fn().mockResolvedValue([
        {
          name: 'test-server',
          type: 'stdio',
          status: 'enabled',
          commandOrUrl: 'npx -y test-pkg',
          scope: 'global',
        },
      ]),
    } as unknown as AgyMcpConfigManager;

    const facade = new ExtensionFacadeService(
      mockPluginCatalog,
      mockPluginState,
      null,
      mockMcpState,
      mockAgyMcpSync,
      mockAgyConfigManager
    );

    const syncResult = await facade.syncAgyMcp({ preferSource: 'app' });
    expect(syncResult).toEqual(mockSyncResult);
    expect(mockAgyMcpSync.sync).toHaveBeenCalledWith({ preferSource: 'app' });
    expect(mockPluginState.invalidateCache).toHaveBeenCalled();
    expect(mockMcpState.invalidateCache).toHaveBeenCalled();

    const servers = await facade.listAgyMcp('/test/project');
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('test-server');
    expect(mockAgyConfigManager.listServers).toHaveBeenCalledWith('/test/project');
  });
});
