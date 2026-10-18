import {
  buildEffectiveTeamMemberSpec,
  teamRequestIncludesCodexMember,
  teamRequestIncludesGeminiMember,
} from '../TeamProvisioningMemberSpecs';

describe('TeamProvisioningMemberSpecs', () => {
  it('matches an explicit anthropic member to the implicit anthropic lead provider', () => {
    expect(
      buildEffectiveTeamMemberSpec(
        { name: 'member', providerId: 'anthropic' },
        { model: 'sonnet', syncModelsWithLead: true }
      ).model
    ).toBe('sonnet');
  });

  it('keeps legacy lead-model inheritance when the sync preference is absent', () => {
    expect(
      buildEffectiveTeamMemberSpec(
        { name: 'builder' },
        { providerId: 'codex', model: 'gpt-5.6-sol', effort: 'high' }
      )
    ).toEqual({
      name: 'builder',
      providerId: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'high',
    });
  });

  it('inherits gemini lead model when sync preference is active', () => {
    expect(
      buildEffectiveTeamMemberSpec(
        { name: 'researcher' },
        { providerId: 'gemini', model: 'gemini-2.5-pro', effort: 'high', syncModelsWithLead: true }
      )
    ).toEqual({
      name: 'researcher',
      providerId: 'gemini',
      model: 'gemini-2.5-pro',
      effort: 'high',
    });
  });

  it('uses the teammate provider default when lead-model sync is disabled', () => {
    expect(
      buildEffectiveTeamMemberSpec(
        { name: 'builder' },
        {
          providerId: 'codex',
          model: 'gpt-5.6-sol',
          effort: 'high',
          syncModelsWithLead: false,
        }
      )
    ).toEqual({
      name: 'builder',
      providerId: 'codex',
      model: undefined,
      effort: undefined,
    });
  });

  it('preserves an explicit teammate model when lead-model sync is disabled', () => {
    expect(
      buildEffectiveTeamMemberSpec(
        { name: 'builder', model: 'gpt-5.5', effort: 'medium' },
        {
          providerId: 'codex',
          model: 'gpt-5.6-sol',
          effort: 'high',
          syncModelsWithLead: false,
        }
      )
    ).toEqual({
      name: 'builder',
      providerId: 'codex',
      model: 'gpt-5.5',
      effort: 'medium',
    });
  });

  it('detects gemini members in team create requests correctly', () => {
    expect(
      teamRequestIncludesGeminiMember({
        providerId: 'anthropic',
        members: [
          { name: 'lead', providerId: 'anthropic' },
          { name: 'helper', providerId: 'gemini' },
        ],
      })
    ).toBe(true);

    expect(
      teamRequestIncludesGeminiMember({
        providerId: 'gemini',
        members: [{ name: 'lead' }],
      })
    ).toBe(true);

    expect(
      teamRequestIncludesGeminiMember({
        providerId: 'anthropic',
        members: [{ name: 'codex-worker', providerId: 'codex' }],
      })
    ).toBe(false);

    expect(
      teamRequestIncludesCodexMember({
        providerId: 'anthropic',
        members: [{ name: 'codex-worker', providerId: 'codex' }],
      })
    ).toBe(true);

    expect(
      teamRequestIncludesCodexMember({
        providerId: 'gemini',
        members: [{ name: 'helper', providerId: 'gemini' }],
      })
    ).toBe(false);
  });
});
