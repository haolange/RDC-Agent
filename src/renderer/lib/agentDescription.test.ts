import { expect, it } from 'vitest';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import { translate, type TranslationKey } from '../i18n/messages';
import { agentDescription } from './agentDescription';

it('translates shipped descriptions and preserves same-id user/project overrides', () => {
  const t = (key: TranslationKey) => translate('zh-CN', key);
  expect(agentDescription(undefined, t)).toBe('');
  for (const scope of ['builtin', 'user', 'project'] as const) {
    const agent = { id: 'general', description: 'Original metadata', provenance: { scope } } as AgentManifestDefinition;
    expect(agentDescription(agent, t)).toBe(scope === 'builtin' ? t('settings.agentDescription.general') : 'Original metadata');
  }
  expect(agentDescription({ id: 'custom', description: '用户描述' } as AgentManifestDefinition, t)).toBe('用户描述');
});
