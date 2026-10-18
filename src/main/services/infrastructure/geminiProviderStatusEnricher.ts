import { AgyBinaryResolver } from '@main/services/team/AgyBinaryResolver';
import { execCli } from '@main/utils/childProcess';
import { createDefaultCliExtensionCapabilities } from '@shared/utils/providerExtensionCapabilities';

import type { CliProviderBackendOption, CliProviderStatus } from '@shared/types';

const FALLBACK_GEMINI_MODELS = [
  'gemini-4-argon-medium',
  'gemini-4-argon-high',
  'gemini-4-argon-low',
  'gemini-3.8-flash-high',
  'gemini-3.8-flash-medium',
  'gemini-3.8-flash-low',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

const MODELS_CACHE_TTL_MS = 60_000;
let cachedModels: string[] | null = null;
let cachedModelsVerifiedAt = 0;

function buildEnrichedBackends(
  existingBackends: CliProviderBackendOption[] | undefined,
  agyBinary: string
): CliProviderBackendOption[] {
  const options = existingBackends ? existingBackends.map((b) => ({ ...b })) : [];
  let hasCliSdk = false;

  const mapped = options.map((backend) => {
    if (backend.id === 'cli-sdk' || backend.id === 'cli-bin') {
      hasCliSdk = true;
      return {
        ...backend,
        id: 'cli-sdk',
        label: 'Antigravity CLI (agy)',
        description: backend.description || 'Use the local Google Antigravity CLI binary',
        selectable: true,
        available: true,
        state: 'ready' as const,
        statusMessage: 'Ready',
        detailMessage: agyBinary,
      };
    }
    if (backend.id === 'auto') {
      return {
        ...backend,
        available: true,
        selectable: true,
        state: 'ready' as const,
        statusMessage: 'Ready',
        detailMessage: null,
      };
    }
    return backend;
  });

  if (!hasCliSdk) {
    mapped.push({
      id: 'cli-sdk',
      label: 'Antigravity CLI (agy)',
      description: 'Use the local Google Antigravity CLI binary',
      selectable: true,
      recommended: false,
      available: true,
      state: 'ready',
      statusMessage: 'Ready',
      detailMessage: agyBinary,
    });
  }

  if (mapped.length === 1 && mapped[0].id === 'cli-sdk') {
    mapped.unshift({
      id: 'auto',
      label: 'Auto',
      description: 'Automatically select the best available backend',
      selectable: true,
      recommended: true,
      available: true,
      state: 'ready',
      statusMessage: 'Ready',
      detailMessage: null,
    });
  }

  return mapped;
}

function buildEnrichedDiagnostics(
  existingDiagnostics: CliProviderStatus['externalRuntimeDiagnostics'],
  agyBinary: string
): NonNullable<CliProviderStatus['externalRuntimeDiagnostics']> {
  const filtered = (existingDiagnostics ?? []).filter(
    (diag) => diag.id !== 'cli-bin' && !diag.label.toLowerCase().includes('gemini cli')
  );

  return [
    {
      id: 'cli-bin',
      label: 'Antigravity CLI (agy)',
      detected: true,
      statusMessage: 'Ready',
      detailMessage: agyBinary,
    },
    ...filtered,
  ];
}

function applyAgyEnrichment(
  status: CliProviderStatus,
  agyBinary: string | null,
  resolvedModels: string[],
  defaultModelCandidate?: string | null
): CliProviderStatus {
  const isReady = Boolean(agyBinary || status.authenticated);
  const models = resolvedModels.length > 0 ? resolvedModels : FALLBACK_GEMINI_MODELS;
  const defaultModel =
    defaultModelCandidate ??
    models.find((m) => m.includes('4-argon') || m.includes('3.8-flash')) ??
    models[0];

  const enriched: CliProviderStatus = {
    ...status,
    displayName: 'Antigravity / Gemini',
    supported: isReady || status.supported,
    authenticated: isReady,
    authMethod: agyBinary ? 'agy_cli' : (status.authMethod ?? null),
    verificationState: isReady ? 'verified' : status.verificationState,
    statusCheckOutcome: isReady ? 'authoritative' : status.statusCheckOutcome,
    statusCheckErrorCode: isReady ? undefined : status.statusCheckErrorCode,
    statusMessage: isReady ? null : status.statusMessage,
    detailMessage: isReady ? null : status.detailMessage,
    capabilities: {
      ...status.capabilities,
      teamLaunch: isReady,
      oneShot: true,
      extensions: createDefaultCliExtensionCapabilities(),
    },
    models,
    defaultModel,
  };

  if (agyBinary) {
    enriched.backend = {
      kind: 'cli',
      label: 'Antigravity CLI (agy)',
      endpointLabel: 'Google Antigravity',
      authMethodDetail: 'agy_cli',
    };
    enriched.availableBackends = buildEnrichedBackends(status.availableBackends, agyBinary);
    enriched.resolvedBackendId =
      status.selectedBackendId === 'api' && status.resolvedBackendId === 'api' ? 'api' : 'cli-sdk';
    enriched.selectedBackendId = status.selectedBackendId ?? 'auto';
    enriched.externalRuntimeDiagnostics = buildEnrichedDiagnostics(
      status.externalRuntimeDiagnostics,
      agyBinary
    );
  }

  return enriched;
}

export function enrichGeminiProviderStatusSync(
  status: CliProviderStatus | null
): CliProviderStatus | null {
  if (!status || status.providerId !== 'gemini') {
    return status;
  }

  const agyBinary = AgyBinaryResolver.getCached() ?? AgyBinaryResolver.resolveSync() ?? null;
  const models =
    cachedModels && Date.now() - cachedModelsVerifiedAt < MODELS_CACHE_TTL_MS
      ? cachedModels
      : status.models.filter((m) => m && m.trim().length > 0);

  return applyAgyEnrichment(status, agyBinary, models, status.defaultModel);
}

export async function enrichGeminiProviderStatus(
  status: CliProviderStatus | null
): Promise<CliProviderStatus | null> {
  if (!status || status.providerId !== 'gemini') {
    return status;
  }

  const agyBinary =
    AgyBinaryResolver.getCached() ??
    AgyBinaryResolver.resolveSync() ??
    (await AgyBinaryResolver.resolve().catch(() => null)) ??
    null;

  let models = status.models.filter((m) => m && m.trim().length > 0);
  let defaultModel = status.defaultModel;

  if (agyBinary) {
    if (cachedModels && Date.now() - cachedModelsVerifiedAt < MODELS_CACHE_TTL_MS) {
      models = cachedModels;
    } else {
      try {
        const { stdout } = await execCli(agyBinary, ['models'], {
          timeout: 15_000,
          maxBuffer: 4 * 1024 * 1024,
        });
        const parsedModels = stdout
          .split('\n')
          .map((line) => line.trim().split(/\t|\s{2,}/)[0])
          .filter((m) => m && !m.toLowerCase().startsWith('fetching'));
        if (parsedModels.length > 0) {
          models = parsedModels;
          cachedModels = parsedModels;
          cachedModelsVerifiedAt = Date.now();
          defaultModel =
            parsedModels.find((m) => m.includes('4-argon') || m.includes('3.8-flash')) ??
            parsedModels[0];
        }
      } catch {
        // Fall back to existing or standard models
      }
    }
  }

  return applyAgyEnrichment(status, agyBinary, models, defaultModel);
}

export function enrichProviderStatusesSync(statuses: CliProviderStatus[]): CliProviderStatus[] {
  return statuses.map((status) =>
    status.providerId === 'gemini' ? (enrichGeminiProviderStatusSync(status) ?? status) : status
  );
}

export async function enrichProviderStatuses(
  statuses: CliProviderStatus[]
): Promise<CliProviderStatus[]> {
  return Promise.all(
    statuses.map(async (status) =>
      status.providerId === 'gemini'
        ? ((await enrichGeminiProviderStatus(status)) ?? status)
        : status
    )
  );
}
