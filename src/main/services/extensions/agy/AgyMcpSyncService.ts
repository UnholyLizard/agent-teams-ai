import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { getHomeDir } from '@main/utils/pathDecoder';
import { createLogger } from '@shared/utils/logger';

import { AgyMcpConfigManager } from './AgyMcpConfigManager';

import type {
  AgyMcpServerConfig,
  AgyMcpSyncRequest,
  McpBidirectionalSyncResult,
  McpSyncResult,
} from '@shared/types/extensions';

const logger = createLogger('Extensions:AgyMcpSyncService');

export class AgyMcpSyncService {
  constructor(private readonly configManager = new AgyMcpConfigManager()) {}

  /**
   * Main dispatch method for MCP synchronization requests.
   */
  async sync(request: AgyMcpSyncRequest = {}): Promise<McpSyncResult | McpBidirectionalSyncResult> {
    const direction = request.direction ?? 'bidirectional';
    if (direction === 'to-agy') {
      return this.syncAppToAgy(request);
    }
    if (direction === 'from-agy') {
      return this.syncAgyToApp(request);
    }
    return this.syncBidirectional(request);
  }

  /**
   * Synchronize AGY MCP servers into Claude / app-managed configs (~/.claude.json or .mcp.json).
   */
  async syncAgyToApp(request: AgyMcpSyncRequest = {}): Promise<McpSyncResult> {
    const { projectPath, overwrite = false, includeDisabled = false } = request;
    const added: string[] = [];
    const updated: string[] = [];
    const skipped: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];

    try {
      // 1. Read AGY servers from global and optional project scope
      const agyServers = await this.configManager.listServers(projectPath);

      // 2. Determine target Claude config path
      const targetConfigPath = projectPath
        ? path.join(projectPath, '.mcp.json')
        : path.join(getHomeDir(), '.claude.json');

      const claudeData = await this.readClaudeConfigFile(targetConfigPath);
      claudeData.mcpServers ??= {};
      const targetMcpServers = claudeData.mcpServers as Record<string, Record<string, unknown>>;

      for (const server of agyServers) {
        try {
          if (!includeDisabled && server.status === 'disabled') {
            skipped.push(server.name);
            continue;
          }

          const normalized = this.normalizeAgyToClaude(server.config ?? {});
          if (!normalized) {
            failed.push({ name: server.name, error: 'Could not normalize AGY server config' });
            continue;
          }

          const existing = targetMcpServers[server.name];
          if (existing) {
            if (overwrite) {
              targetMcpServers[server.name] = normalized;
              updated.push(server.name);
            } else {
              skipped.push(server.name);
            }
          } else {
            targetMcpServers[server.name] = normalized;
            added.push(server.name);
          }
        } catch (itemErr) {
          failed.push({
            name: server.name,
            error: itemErr instanceof Error ? itemErr.message : String(itemErr),
          });
        }
      }

      // 3. Write back Claude config
      await this.writeClaudeConfigFile(targetConfigPath, claudeData);

      return {
        success: failed.length === 0,
        direction: 'from-agy',
        added,
        updated,
        skipped,
        failed,
      };
    } catch (err) {
      logger.error('Failed to sync AGY servers to app:', err);
      return {
        success: false,
        direction: 'from-agy',
        added,
        updated,
        skipped,
        failed: [{ name: 'all', error: err instanceof Error ? err.message : String(err) }],
      };
    }
  }

  /**
   * Synchronize Claude / app-managed MCP servers into AGY ecosystem (~/.gemini/config/mcp_config.json or .agents/mcp_config.json).
   */
  async syncAppToAgy(request: AgyMcpSyncRequest = {}): Promise<McpSyncResult> {
    const { projectPath, overwrite = false } = request;
    const added: string[] = [];
    const updated: string[] = [];
    const skipped: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];

    try {
      // 1. Read Claude servers from target scope
      const sourceConfigPath = projectPath
        ? path.join(projectPath, '.mcp.json')
        : path.join(getHomeDir(), '.claude.json');

      const claudeData = await this.readClaudeConfigFile(sourceConfigPath);
      const claudeServers = (claudeData.mcpServers ?? {}) as Record<
        string,
        Record<string, unknown>
      >;

      // 2. Read AGY servers from target config
      const agyTargetScope = projectPath ? 'project' : 'global';
      const agyServers = await this.configManager.listServers(projectPath);
      const agyMap = new Map(agyServers.map((s) => [s.name.toLowerCase(), s]));

      for (const [name, serverSpec] of Object.entries(claudeServers)) {
        try {
          const normalized = this.normalizeClaudeToAgy(serverSpec);
          if (!normalized) {
            failed.push({ name, error: 'Could not normalize Claude server config' });
            continue;
          }

          const existing = agyMap.get(name.toLowerCase());
          if (existing) {
            if (overwrite) {
              await this.configManager.addServer(name, normalized, agyTargetScope, projectPath);
              updated.push(name);
            } else {
              skipped.push(name);
            }
          } else {
            await this.configManager.addServer(name, normalized, agyTargetScope, projectPath);
            added.push(name);
          }
        } catch (itemErr) {
          failed.push({
            name,
            error: itemErr instanceof Error ? itemErr.message : String(itemErr),
          });
        }
      }

      return {
        success: failed.length === 0,
        direction: 'to-agy',
        added,
        updated,
        skipped,
        failed,
      };
    } catch (err) {
      logger.error('Failed to sync app servers to AGY:', err);
      return {
        success: false,
        direction: 'to-agy',
        added,
        updated,
        skipped,
        failed: [{ name: 'all', error: err instanceof Error ? err.message : String(err) }],
      };
    }
  }

  /**
   * Perform bidirectional reconciliation between Claude and AGY configurations.
   */
  async syncBidirectional(request: AgyMcpSyncRequest = {}): Promise<McpBidirectionalSyncResult> {
    const { preferSource = 'app' } = request;

    if (preferSource === 'agy') {
      // AGY has precedence: sync AGY -> App with overwrite, then App -> AGY without overwrite
      const fromAgy = await this.syncAgyToApp({ ...request, overwrite: true });
      const toAgy = await this.syncAppToAgy({ ...request, overwrite: false });
      return {
        success: fromAgy.success && toAgy.success,
        toAgy,
        fromAgy,
      };
    }

    // App has precedence: sync App -> AGY with overwrite, then AGY -> App without overwrite
    const toAgy = await this.syncAppToAgy({ ...request, overwrite: true });
    const fromAgy = await this.syncAgyToApp({ ...request, overwrite: false });
    return {
      success: toAgy.success && fromAgy.success,
      toAgy,
      fromAgy,
    };
  }

  private normalizeAgyToClaude(config: AgyMcpServerConfig): Record<string, unknown> | null {
    if (typeof config.command === 'string') {
      const result: Record<string, unknown> = {
        command: config.command,
        args: Array.isArray(config.args) ? config.args : [],
      };
      if (config.env && typeof config.env === 'object') {
        result.env = config.env;
      }
      return result;
    }

    const url = config.url || config.serverUrl;
    if (typeof url === 'string') {
      const result: Record<string, unknown> = { url };
      if (config.headers && typeof config.headers === 'object') {
        result.headers = config.headers;
      }
      return result;
    }

    return null;
  }

  private normalizeClaudeToAgy(config: Record<string, unknown>): AgyMcpServerConfig | null {
    if (typeof config.command === 'string') {
      const result: AgyMcpServerConfig = {
        command: config.command,
        args: Array.isArray(config.args) ? (config.args as string[]) : [],
        disabled: false,
      };
      if (config.env && typeof config.env === 'object') {
        result.env = config.env as Record<string, string>;
      }
      return result;
    }

    const url = config.url || config.serverUrl;
    if (typeof url === 'string') {
      const result: AgyMcpServerConfig = {
        url,
        serverUrl: url,
        disabled: false,
      };
      if (config.headers && typeof config.headers === 'object') {
        result.headers = config.headers as Record<string, string>;
      }
      return result;
    }

    return null;
  }

  private async readClaudeConfigFile(filePath: string): Promise<Record<string, unknown>> {
    try {
      const raw = await fsp.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      logger.warn(`Failed to read Claude config from ${filePath}:`, err);
      return {};
    }
  }

  private async writeClaudeConfigFile(
    filePath: string,
    data: Record<string, unknown>
  ): Promise<void> {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  }
}
