import {
  filterMainScreenCliProviders,
  isGeminiUiFrozen,
  normalizeCreateLaunchProviderForUi,
} from '@renderer/utils/geminiUiFreeze';
import { describe, expect, it } from 'vitest';

describe('geminiUiFreeze', () => {
  it('hides gemini from the dashboard provider list when unsupported or unspecified', () => {
    expect(
      filterMainScreenCliProviders([
        { providerId: 'anthropic', label: 'Anthropic' },
        { providerId: 'codex', label: 'Codex' },
        { providerId: 'gemini', label: 'Gemini' },
      ])
    ).toEqual([
      { providerId: 'anthropic', label: 'Anthropic' },
      { providerId: 'codex', label: 'Codex' },
    ]);
  });

  it('retains gemini on the dashboard provider list when supported is true', () => {
    expect(
      filterMainScreenCliProviders([
        { providerId: 'anthropic', label: 'Anthropic', supported: true },
        { providerId: 'codex', label: 'Codex', supported: true },
        { providerId: 'gemini', label: 'Gemini', supported: true },
      ])
    ).toEqual([
      { providerId: 'anthropic', label: 'Anthropic', supported: true },
      { providerId: 'codex', label: 'Codex', supported: true },
      { providerId: 'gemini', label: 'Gemini', supported: true },
    ]);
  });

  it('falls back to anthropic when a create or launch form receives gemini with supported explicitly false', () => {
    expect(normalizeCreateLaunchProviderForUi('gemini', true, { supported: false })).toBe(
      'anthropic'
    );
  });

  it('allows gemini when providerStatus supported is true or unspecified when unfrozen', () => {
    expect(normalizeCreateLaunchProviderForUi('gemini', true, { supported: true })).toBe('gemini');
    expect(normalizeCreateLaunchProviderForUi('gemini', true)).toBe('gemini');
  });

  it('reports isGeminiUiFrozen correctly based on providerStatus and GEMINI_UI_FROZEN', () => {
    expect(isGeminiUiFrozen({ supported: true })).toBe(false);
    expect(isGeminiUiFrozen({ supported: false })).toBe(true);
    expect(isGeminiUiFrozen()).toBe(false);
  });

  it('keeps codex available when multimodel is enabled', () => {
    expect(normalizeCreateLaunchProviderForUi('codex', true)).toBe('codex');
  });

  it('keeps opencode available when multimodel is enabled', () => {
    expect(normalizeCreateLaunchProviderForUi('opencode', true)).toBe('opencode');
  });
});
