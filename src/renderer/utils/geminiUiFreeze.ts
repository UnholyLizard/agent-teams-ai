import { normalizeOptionalTeamProviderId } from '@shared/utils/teamProvider';

import type { TeamProviderId } from '@shared/types';
import type { CliProviderId, CliProviderStatus } from '@shared/types/cliInstaller';

export const GEMINI_UI_FROZEN = false;
export const GEMINI_UI_DISABLED_REASON = 'Gemini in development';
export const GEMINI_UI_DISABLED_BADGE_LABEL = 'In development';

export function isGeminiUiFrozen(
  providerStatus?: Pick<CliProviderStatus, 'supported'> | null
): boolean {
  if (providerStatus !== undefined && providerStatus !== null) {
    return !providerStatus.supported;
  }
  return GEMINI_UI_FROZEN;
}

export function isGeminiProviderId(
  providerId: CliProviderId | TeamProviderId | undefined
): providerId is 'gemini' {
  return providerId === 'gemini';
}

export function filterMainScreenCliProviders<
  T extends { providerId: CliProviderId; supported?: boolean },
>(providers: readonly T[]): T[] {
  return providers.filter((provider) => {
    if (provider.providerId !== 'gemini') {
      return true;
    }
    return provider.supported === true;
  });
}

export function normalizeCreateLaunchProviderForUi(
  providerId: TeamProviderId | undefined,
  multimodelEnabled: boolean,
  providerStatus?: Pick<CliProviderStatus, 'supported'> | null
): TeamProviderId {
  if (!multimodelEnabled) {
    return 'anthropic';
  }

  const normalizedProviderId = normalizeOptionalTeamProviderId(providerId);
  if (normalizedProviderId === 'gemini' && isGeminiUiFrozen(providerStatus)) {
    return 'anthropic';
  }
  return normalizedProviderId ?? 'anthropic';
}

export function isCreateLaunchProviderDisabled(
  providerId: TeamProviderId,
  multimodelEnabled: boolean,
  providerStatus?: Pick<CliProviderStatus, 'supported'> | null
): boolean {
  if (providerId === 'gemini' && isGeminiUiFrozen(providerStatus)) {
    return true;
  }
  if (!multimodelEnabled && providerId !== 'anthropic') {
    return true;
  }
  return false;
}
