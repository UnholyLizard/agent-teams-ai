import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { getHomeDir } from '@main/utils/pathDecoder';
import { createLogger } from '@shared/utils/logger';
import { getMcpRuntimeTargetKey } from '@shared/utils/mcpTargets';

import type { InstalledMcpEntry } from '@shared/types/extensions';

const logger = createLogger('Extensions:McpConfigStateReader');

export interface ConfiguredMcpEntry extends InstalledMcpEntry {
  scope: 'local' | 'user' | 'project';
  config: Record<string, unknown>;
}

export class McpConfigStateReader {
  async readInstalled(
    projectPath?: string,
    options?: { includeAgy?: boolean }
  ): Promise<InstalledMcpEntry[]> {
    const entries: InstalledMcpEntry[] = [];
    const claudeConfig = await this.readClaudeConfig();

    entries.push(...this.readUserMcpServers(claudeConfig));

    if (options?.includeAgy) {
      const agyUserEntries = await this.readAgyUserMcpServers();
      for (const agyEntry of agyUserEntries) {
        if (!entries.some((e) => e.name.toLowerCase() === agyEntry.name.toLowerCase())) {
          entries.push(agyEntry);
        }
      }
    }

    if (projectPath) {
      entries.push(...this.readLocalMcpServers(claudeConfig, projectPath));
      entries.push(...(await this.readProjectMcpServers(projectPath)));

      if (options?.includeAgy) {
        const agyProjectEntries = await this.readAgyProjectMcpServers(projectPath);
        for (const agyEntry of agyProjectEntries) {
          if (!entries.some((e) => e.name.toLowerCase() === agyEntry.name.toLowerCase())) {
            entries.push(agyEntry);
          }
        }
      }
    }

    return entries;
  }

  async readConfigured(
    projectPath?: string,
    options?: { includeAgy?: boolean }
  ): Promise<ConfiguredMcpEntry[]> {
    const entries: ConfiguredMcpEntry[] = [];
    const claudeConfig = await this.readClaudeConfig();

    entries.push(...this.readConfiguredMcpServersFromConfig(claudeConfig?.mcpServers, 'user'));

    if (options?.includeAgy) {
      const agyUserEntries = await this.readAgyUserConfiguredMcpServers();
      for (const agyEntry of agyUserEntries) {
        if (!entries.some((e) => e.name.toLowerCase() === agyEntry.name.toLowerCase())) {
          entries.push(agyEntry);
        }
      }
    }

    if (projectPath) {
      entries.push(...this.readLocalConfiguredMcpServers(claudeConfig, projectPath));
      entries.push(...(await this.readProjectConfiguredMcpServers(projectPath)));

      if (options?.includeAgy) {
        const agyProjectEntries = await this.readAgyProjectConfiguredMcpServers(projectPath);
        for (const agyEntry of agyProjectEntries) {
          if (!entries.some((e) => e.name.toLowerCase() === agyEntry.name.toLowerCase())) {
            entries.push(agyEntry);
          }
        }
      }
    }

    return entries;
  }

  private async readClaudeConfig(): Promise<Record<string, unknown> | null> {
    const configPath = path.join(getHomeDir(), '.claude.json');
    try {
      const raw = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      logger.error(`Failed to read MCP servers from ${configPath}:`, err);
      return null;
    }
  }

  private readUserMcpServers(config: Record<string, unknown> | null): InstalledMcpEntry[] {
    return this.readMcpServersFromConfig(config?.mcpServers, 'user');
  }

  private readLocalMcpServers(
    config: Record<string, unknown> | null,
    projectPath: string
  ): InstalledMcpEntry[] {
    return this.readLocalConfiguredMcpServers(config, projectPath).map(
      ({ config: _config, ...entry }) => entry
    );
  }

  private readLocalConfiguredMcpServers(
    config: Record<string, unknown> | null,
    projectPath: string
  ): ConfiguredMcpEntry[] {
    const projects =
      config && typeof config.projects === 'object' && config.projects
        ? (config.projects as Record<string, unknown>)
        : null;
    const projectConfig =
      projects && typeof projects[projectPath] === 'object' && projects[projectPath]
        ? (projects[projectPath] as Record<string, unknown>)
        : null;
    return this.readConfiguredMcpServersFromConfig(projectConfig?.mcpServers, 'local');
  }

  private async readProjectMcpServers(projectPath: string): Promise<InstalledMcpEntry[]> {
    const configPath = path.join(projectPath, '.mcp.json');
    return this.readMcpServersFromFile(configPath, 'project');
  }

  private async readProjectConfiguredMcpServers(
    projectPath: string
  ): Promise<ConfiguredMcpEntry[]> {
    const configPath = path.join(projectPath, '.mcp.json');
    return this.readConfiguredMcpServersFromFile(configPath, 'project');
  }

  private readMcpServersFromConfig(
    value: unknown,
    scope: 'user' | 'project' | 'local'
  ): InstalledMcpEntry[] {
    return this.readConfiguredMcpServersFromConfig(value, scope).map(
      ({ config: _config, ...entry }) => entry
    );
  }

  private readConfiguredMcpServersFromConfig(
    value: unknown,
    scope: 'user' | 'project' | 'local'
  ): ConfiguredMcpEntry[] {
    const mcpServers =
      value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
    if (!mcpServers) {
      return [];
    }

    return Object.entries(mcpServers)
      .filter((entry): entry is [string, Record<string, unknown>] => {
        const [, config] = entry;
        return Boolean(config && typeof config === 'object' && !Array.isArray(config));
      })
      .map(([name, config]): ConfiguredMcpEntry => {
        let transport: string | undefined;
        if (typeof config.command === 'string') transport = 'stdio';
        else if (typeof config.url === 'string' || typeof config.serverUrl === 'string')
          transport = 'http';

        let targetKey: string | undefined;
        if (
          transport === 'stdio' &&
          config.command === 'npx' &&
          Array.isArray(config.args) &&
          config.args.length === 2 &&
          config.args[0] === '-y' &&
          typeof config.args[1] === 'string'
        ) {
          targetKey = getMcpRuntimeTargetKey(`npx -y ${config.args[1]}`, transport) ?? undefined;
        } else if (
          transport === 'http' &&
          (typeof config.url === 'string' || typeof config.serverUrl === 'string')
        ) {
          const urlString = (
            typeof config.url === 'string' ? config.url : config.serverUrl
          ) as string;
          targetKey = getMcpRuntimeTargetKey(urlString, transport) ?? undefined;
        }

        return { name, scope, transport, targetKey, config: { ...config } };
      });
  }

  private async readMcpServersFromFile(
    filePath: string,
    scope: 'user' | 'project'
  ): Promise<InstalledMcpEntry[]> {
    return (await this.readConfiguredMcpServersFromFile(filePath, scope)).map(
      ({ config: _config, ...entry }) => entry
    );
  }

  private async readConfiguredMcpServersFromFile(
    filePath: string,
    scope: 'user' | 'project'
  ): Promise<ConfiguredMcpEntry[]> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const json = JSON.parse(raw) as Record<string, unknown>;
      return this.readConfiguredMcpServersFromConfig(json.mcpServers, scope);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      logger.error(`Failed to read MCP servers from ${filePath}:`, err);
      return [];
    }
  }

  private async readAgyUserMcpServers(): Promise<InstalledMcpEntry[]> {
    return (await this.readAgyUserConfiguredMcpServers()).map(
      ({ config: _config, ...entry }) => entry
    );
  }

  private async readAgyProjectMcpServers(projectPath: string): Promise<InstalledMcpEntry[]> {
    return (await this.readAgyProjectConfiguredMcpServers(projectPath)).map(
      ({ config: _config, ...entry }) => entry
    );
  }

  private async readAgyUserConfiguredMcpServers(): Promise<ConfiguredMcpEntry[]> {
    const globalConfigPath = path.join(getHomeDir(), '.gemini', 'config', 'mcp_config.json');
    const entries = await this.readConfiguredMcpServersFromFile(globalConfigPath, 'user');
    if (entries.length > 0) return entries;

    const ideConfigPath = path.join(getHomeDir(), '.gemini', 'antigravity-ide', 'mcp_config.json');
    return this.readConfiguredMcpServersFromFile(ideConfigPath, 'user');
  }

  private async readAgyProjectConfiguredMcpServers(
    projectPath: string
  ): Promise<ConfiguredMcpEntry[]> {
    const projectConfigPath = path.join(projectPath, '.agents', 'mcp_config.json');
    return this.readConfiguredMcpServersFromFile(projectConfigPath, 'project');
  }
}
