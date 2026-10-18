import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { AgyBinaryResolver } from '@main/services/team/AgyBinaryResolver';
import { execCli } from '@main/utils/childProcess';
import { getHomeDir } from '@main/utils/pathDecoder';
import { createLogger } from '@shared/utils/logger';

import type { AgyMcpServerConfig, AgyMcpServerInfo } from '@shared/types/extensions';

const logger = createLogger('Extensions:AgyMcpConfigManager');

export function getAgyGlobalConfigPath(): string {
  return path.join(getHomeDir(), '.gemini', 'config', 'mcp_config.json');
}

export function getAgyIdeConfigPath(): string {
  return path.join(getHomeDir(), '.gemini', 'antigravity-ide', 'mcp_config.json');
}

export function getAgyProjectConfigPath(projectPath: string): string {
  return path.join(projectPath, '.agents', 'mcp_config.json');
}

export class AgyMcpConfigManager {
  /**
   * Read raw AGY mcp_config.json file. Returns record of server configs.
   */
  async readConfigFile(filePath: string): Promise<Record<string, AgyMcpServerConfig>> {
    try {
      const raw = await fsp.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') return {};

      const servers = parsed.mcpServers;
      if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
        return {};
      }

      return servers as Record<string, AgyMcpServerConfig>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      logger.warn(`Failed to read AGY MCP config from ${filePath}:`, err);
      return {};
    }
  }

  /**
   * Write server configurations to AGY mcp_config.json file, preserving existing top-level keys.
   */
  async writeConfigFile(
    filePath: string,
    servers: Record<string, AgyMcpServerConfig>
  ): Promise<void> {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });

    let existingData: Record<string, unknown> = {};
    try {
      const raw = await fsp.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existingData = parsed;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`Could not read existing config prior to write at ${filePath}:`, err);
      }
    }

    const payload = {
      ...existingData,
      mcpServers: servers,
    };

    await fsp.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  }

  /**
   * List all configured AGY MCP servers across global and optional project scopes.
   */
  async listServers(projectPath?: string): Promise<AgyMcpServerInfo[]> {
    const results: AgyMcpServerInfo[] = [];

    // 1. Global config (~/.gemini/config/mcp_config.json)
    const globalConfig = await this.readConfigFile(getAgyGlobalConfigPath());
    for (const [name, config] of Object.entries(globalConfig)) {
      results.push(this.formatServerInfo(name, config, 'global'));
    }

    // 2. Fallback IDE config (~/.gemini/antigravity-ide/mcp_config.json) for unlisted servers
    const ideConfig = await this.readConfigFile(getAgyIdeConfigPath());
    for (const [name, config] of Object.entries(ideConfig)) {
      if (!results.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
        results.push(this.formatServerInfo(name, config, 'global'));
      }
    }

    // 3. Project config (<projectPath>/.agents/mcp_config.json)
    if (projectPath) {
      const projectConfig = await this.readConfigFile(getAgyProjectConfigPath(projectPath));
      for (const [name, config] of Object.entries(projectConfig)) {
        results.push(this.formatServerInfo(name, config, 'project'));
      }
    }

    return results;
  }

  /**
   * List servers by invoking `agy mcp list` CLI if available. Falls back to null on failure.
   */
  async listServersViaCli(projectPath?: string): Promise<AgyMcpServerInfo[] | null> {
    const agyBinary = await AgyBinaryResolver.resolve();
    if (!agyBinary) return null;

    try {
      const { stdout } = await execCli(agyBinary, ['mcp', 'list'], {
        timeout: 10_000,
        cwd: projectPath,
      });
      return this.parseAgyMcpListOutput(stdout);
    } catch (err) {
      logger.warn('Failed to query agy mcp list via CLI:', err);
      return null;
    }
  }

  /**
   * Parse tabular output of `agy mcp list`.
   * Columns: NAME TYPE STATUS COMMAND/URL
   */
  parseAgyMcpListOutput(stdout: string): AgyMcpServerInfo[] {
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const servers: AgyMcpServerInfo[] = [];

    for (const line of lines) {
      if (/^NAME\s+TYPE\s+STATUS\s+COMMAND/i.test(line)) continue;
      const parts = line.split(/\s+/);
      if (parts.length >= 4) {
        const name = parts[0];
        const type = parts[1].toLowerCase() === 'http' ? 'http' : 'stdio';
        const status = parts[2].toLowerCase() === 'disabled' ? 'disabled' : 'enabled';
        const commandOrUrl = parts.slice(3).join(' ');

        servers.push({
          name,
          type,
          status,
          commandOrUrl,
          scope: 'global',
        });
      }
    }

    return servers;
  }

  /**
   * Add or update an MCP server in the target AGY configuration.
   */
  async addServer(
    name: string,
    config: AgyMcpServerConfig,
    scope: 'global' | 'project',
    projectPath?: string
  ): Promise<void> {
    const targetPath =
      scope === 'project' && projectPath
        ? getAgyProjectConfigPath(projectPath)
        : getAgyGlobalConfigPath();

    const existing = await this.readConfigFile(targetPath);
    existing[name] = { ...config };
    await this.writeConfigFile(targetPath, existing);
  }

  /**
   * Remove an MCP server from the target AGY configuration.
   */
  async removeServer(
    name: string,
    scope: 'global' | 'project',
    projectPath?: string
  ): Promise<boolean> {
    const targetPath =
      scope === 'project' && projectPath
        ? getAgyProjectConfigPath(projectPath)
        : getAgyGlobalConfigPath();

    const existing = await this.readConfigFile(targetPath);
    if (!existing[name]) return false;

    delete existing[name];
    await this.writeConfigFile(targetPath, existing);
    return true;
  }

  /**
   * Enable or disable an MCP server in the target AGY configuration.
   */
  async setServerDisabled(
    name: string,
    disabled: boolean,
    scope: 'global' | 'project',
    projectPath?: string
  ): Promise<boolean> {
    const targetPath =
      scope === 'project' && projectPath
        ? getAgyProjectConfigPath(projectPath)
        : getAgyGlobalConfigPath();

    const existing = await this.readConfigFile(targetPath);
    if (!existing[name]) return false;

    existing[name] = {
      ...existing[name],
      disabled,
    };
    await this.writeConfigFile(targetPath, existing);
    return true;
  }

  private formatServerInfo(
    name: string,
    config: AgyMcpServerConfig,
    scope: 'global' | 'project'
  ): AgyMcpServerInfo {
    const isHttp = Boolean(config.serverUrl || config.url);
    const type: 'stdio' | 'http' = isHttp ? 'http' : 'stdio';
    const status: 'enabled' | 'disabled' = config.disabled === true ? 'disabled' : 'enabled';
    const commandOrUrl = isHttp
      ? String(config.serverUrl || config.url || '')
      : [config.command, ...(config.args || [])].filter(Boolean).join(' ');

    return {
      name,
      type,
      status,
      commandOrUrl,
      scope,
      config,
    };
  }
}
