import { AgyBinaryResolver } from '@main/services/team/AgyBinaryResolver';
import { execCli } from '@main/utils/childProcess';
import { createDefaultCliExtensionCapabilities } from '@shared/utils/providerExtensionCapabilities';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  enrichGeminiProviderStatus,
  enrichGeminiProviderStatusSync,
  enrichProviderStatuses,
  enrichProviderStatusesSync,
} from '../../../../src/main/services/infrastructure/geminiProviderStatusEnricher';

import type { CliProviderStatus } from '@shared/types';

vi.mock('@main/services/team/AgyBinaryResolver', () => ({
  AgyBinaryResolver: {
    resolve: vi.fn(),
    resolveSync: vi.fn(),
    getCached: vi.fn(),
  },
}));

vi.mock('@main/utils/childProcess', () => ({
  execCli: vi.fn(),
}));

function createRawGeminiStatus(overrides: Partial<CliProviderStatus> = {}): CliProviderStatus {
  return {
    providerId: 'gemini',
    displayName: 'Gemini',
    supported: true,
    authenticated: false,
    authMethod: null,
    verificationState: 'unknown',
    statusCheckOutcome: 'authoritative',
    statusMessage: 'Gemini CLI not found',
    detailMessage: 'Authentication required',
    models: [],
    canLoginFromUi: true,
    capabilities: {
      teamLaunch: false,
      oneShot: false,
      extensions: createDefaultCliExtensionCapabilities(),
    },
    backend: null,
    availableBackends: [
      {
        id: 'auto',
        label: 'Auto',
        description: 'Auto backend',
        selectable: true,
        recommended: true,
        available: true,
        state: 'authentication-required',
      },
      {
        id: 'cli-sdk',
        label: 'Gemini CLI',
        description: 'Google Gemini CLI',
        selectable: true,
        recommended: false,
        available: false,
        state: 'authentication-required',
      },
    ],
    selectedBackendId: 'auto',
    resolvedBackendId: null,
    externalRuntimeDiagnostics: [
      {
        id: 'cli-bin',
        label: 'Gemini CLI',
        detected: false,
        statusMessage: 'Gemini CLI not found',
      },
    ],
    ...overrides,
  };
}

describe('geminiProviderStatusEnricher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when passed null', async () => {
    expect(await enrichGeminiProviderStatus(null)).toBeNull();
    expect(enrichGeminiProviderStatusSync(null)).toBeNull();
  });

  it('returns unchanged status when providerId is not gemini', async () => {
    const anthropicStatus: CliProviderStatus = {
      providerId: 'anthropic',
      displayName: 'Anthropic',
      supported: true,
      authenticated: true,
      authMethod: 'anthropic_api_key',
      verificationState: 'verified',
      statusMessage: null,
      models: ['claude-3-5-sonnet'],
      canLoginFromUi: true,
      capabilities: {
        teamLaunch: true,
        oneShot: true,
        extensions: createDefaultCliExtensionCapabilities(),
      },
      backend: null,
    };

    expect(await enrichGeminiProviderStatus(anthropicStatus)).toBe(anthropicStatus);
    expect(enrichGeminiProviderStatusSync(anthropicStatus)).toBe(anthropicStatus);
  });

  it('enriches gemini status with Antigravity CLI when binary is detected', async () => {
    const fakeBinary = 'C:\\Users\\test\\AppData\\Local\\agy\\bin\\agy.exe';
    vi.mocked(AgyBinaryResolver.resolve).mockResolvedValue(fakeBinary);
    vi.mocked(AgyBinaryResolver.resolveSync).mockReturnValue(fakeBinary);
    vi.mocked(AgyBinaryResolver.getCached).mockReturnValue(fakeBinary);

    vi.mocked(execCli).mockResolvedValue({
      stdout: 'gemini-4-argon-high\ngemini-3.8-flash-high\ngemini-2.5-pro\n',
      stderr: '',
    });

    const raw = createRawGeminiStatus();
    const enriched = await enrichGeminiProviderStatus(raw);

    expect(enriched).not.toBeNull();
    expect(enriched!.displayName).toBe('Antigravity / Gemini');
    expect(enriched!.supported).toBe(true);
    expect(enriched!.authenticated).toBe(true);
    expect(enriched!.authMethod).toBe('agy_cli');
    expect(enriched!.verificationState).toBe('verified');
    expect(enriched!.statusCheckOutcome).toBe('authoritative');
    expect(enriched!.statusMessage).toBeNull();
    expect(enriched!.detailMessage).toBeNull();
    expect(enriched!.capabilities.teamLaunch).toBe(true);
    expect(enriched!.capabilities.oneShot).toBe(true);

    // Backend should prioritize Antigravity CLI
    expect(enriched!.backend).toEqual({
      kind: 'cli',
      label: 'Antigravity CLI (agy)',
      endpointLabel: 'Google Antigravity',
      authMethodDetail: 'agy_cli',
    });

    // Available backends should have auto and cli-sdk in ready state
    expect(enriched!.availableBackends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'auto',
          state: 'ready',
          statusMessage: 'Ready',
        }),
        expect.objectContaining({
          id: 'cli-sdk',
          label: 'Antigravity CLI (agy)',
          state: 'ready',
          available: true,
          statusMessage: 'Ready',
          detailMessage: fakeBinary,
        }),
      ])
    );

    // Resolved backend should be cli-sdk
    expect(enriched!.resolvedBackendId).toBe('cli-sdk');
    expect(enriched!.selectedBackendId).toBe('auto');

    // External runtime diagnostics must replace "Gemini CLI not found" with Antigravity CLI detected
    expect(enriched!.externalRuntimeDiagnostics).toEqual([
      {
        id: 'cli-bin',
        label: 'Antigravity CLI (agy)',
        detected: true,
        statusMessage: 'Ready',
        detailMessage: fakeBinary,
      },
    ]);

    // Models should be parsed from agy models probe
    expect(enriched!.models).toEqual([
      'gemini-4-argon-high',
      'gemini-3.8-flash-high',
      'gemini-2.5-pro',
    ]);
    expect(enriched!.defaultModel).toBe('gemini-4-argon-high');
  });

  it('synchronously enriches gemini status with cached/resolved binary', () => {
    const fakeBinary = 'C:\\Users\\test\\AppData\\Local\\agy\\bin\\agy.exe';
    vi.mocked(AgyBinaryResolver.getCached).mockReturnValue(fakeBinary);

    const raw = createRawGeminiStatus();
    const enriched = enrichGeminiProviderStatusSync(raw);

    expect(enriched).not.toBeNull();
    expect(enriched!.displayName).toBe('Antigravity / Gemini');
    expect(enriched!.authenticated).toBe(true);
    expect(enriched!.authMethod).toBe('agy_cli');
    expect(enriched!.resolvedBackendId).toBe('cli-sdk');
    expect(enriched!.externalRuntimeDiagnostics).toEqual([
      {
        id: 'cli-bin',
        label: 'Antigravity CLI (agy)',
        detected: true,
        statusMessage: 'Ready',
        detailMessage: fakeBinary,
      },
    ]);
    expect(enriched!.availableBackends?.find((b) => b.id === 'cli-sdk')?.state).toBe('ready');
    expect(enriched!.availableBackends?.find((b) => b.id === 'auto')?.state).toBe('ready');
  });

  it('enriches array of provider statuses synchronously and asynchronously', async () => {
    const fakeBinary = '/usr/local/bin/agy';
    vi.mocked(AgyBinaryResolver.getCached).mockReturnValue(fakeBinary);
    vi.mocked(AgyBinaryResolver.resolveSync).mockReturnValue(fakeBinary);
    vi.mocked(AgyBinaryResolver.resolve).mockResolvedValue(fakeBinary);

    const anthropicStatus: CliProviderStatus = {
      providerId: 'anthropic',
      displayName: 'Anthropic',
      supported: true,
      authenticated: true,
      authMethod: 'anthropic_api_key',
      verificationState: 'verified',
      statusMessage: null,
      models: ['claude-3-5-sonnet'],
      canLoginFromUi: true,
      capabilities: {
        teamLaunch: true,
        oneShot: true,
        extensions: createDefaultCliExtensionCapabilities(),
      },
      backend: null,
    };
    const geminiStatus = createRawGeminiStatus();

    const syncResult = enrichProviderStatusesSync([anthropicStatus, geminiStatus]);
    expect(syncResult[0]).toBe(anthropicStatus);
    expect(syncResult[1].displayName).toBe('Antigravity / Gemini');
    expect(syncResult[1].authenticated).toBe(true);
    expect(syncResult[1].resolvedBackendId).toBe('cli-sdk');

    const asyncResult = await enrichProviderStatuses([anthropicStatus, geminiStatus]);
    expect(asyncResult[0]).toBe(anthropicStatus);
    expect(asyncResult[1].displayName).toBe('Antigravity / Gemini');
    expect(asyncResult[1].authenticated).toBe(true);
  });
});
