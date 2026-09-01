import { describe, expect, it } from 'vitest';
import {
  LlmProviderDraftArgsSchema,
  SettingsGetAgentDefinitionCommitArgsSchema,
  SettingsSaveAgentDefinitionArgsSchema,
  SettingsSaveProviderDefinitionArgsSchema,
} from './settingsLlmSchemas';

describe('settingsLlmSchemas clientRevision / modelPreferences', () => {
  it('accepts Date.now()*1000 revision clocks used by the renderer', () => {
    const revision = Date.now() * 1_000;
    expect(revision).toBeGreaterThan(1_000_000_000);

    expect(SettingsSaveAgentDefinitionArgsSchema.safeParse([{
      draft: { id: 'debugger' },
      clientRevision: revision,
      scope: 'user',
    }]).success).toBe(true);

    expect(SettingsSaveProviderDefinitionArgsSchema.safeParse([{
      provider: { id: 'openai' },
      clientRevision: revision,
    }]).success).toBe(true);
  });

  it('rejects non-positive or non-safe-integer revisions', () => {
    expect(SettingsSaveAgentDefinitionArgsSchema.safeParse([{
      draft: { id: 'debugger' },
      clientRevision: 0,
    }]).success).toBe(false);

    expect(SettingsSaveAgentDefinitionArgsSchema.safeParse([{
      draft: { id: 'debugger' },
      clientRevision: Number.MAX_SAFE_INTEGER + 1,
    }]).success).toBe(false);
  });

  it('rejects path-shaped projectId and missing projectId on project scope', () => {
    expect(SettingsSaveAgentDefinitionArgsSchema.safeParse([{
      draft: { id: 'general' },
      clientRevision: 1,
      scope: 'project',
      projectId: 'D:/Projects/Demo',
    }]).success).toBe(false);
    expect(SettingsSaveAgentDefinitionArgsSchema.safeParse([{
      draft: { id: 'general' },
      clientRevision: 1,
      scope: 'project',
    }]).success).toBe(false);
    expect(SettingsSaveAgentDefinitionArgsSchema.safeParse([{
      draft: { id: 'general' },
      clientRevision: 1,
      scope: 'project',
      projectId: 'proj_demo',
    }]).success).toBe(true);
    expect(SettingsGetAgentDefinitionCommitArgsSchema.safeParse([{
      agentId: 'general',
      scope: 'project',
      projectId: 'proj_demo',
    }]).success).toBe(true);
    expect(SettingsGetAgentDefinitionCommitArgsSchema.safeParse([{
      agentId: 'general',
      scope: 'project',
    }]).success).toBe(false);
  });

  it('accepts large modelPreferences arrays beyond the old 512 cap', () => {
    const modelPreferences = Array.from({ length: 600 }, (_, index) => ({
      id: `model-${index}`,
      enabled: true,
    }));
    expect(LlmProviderDraftArgsSchema.safeParse([{
      providerId: 'openrouter',
      modelPreferences,
    }]).success).toBe(true);
  });
});
