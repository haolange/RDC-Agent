import { expect, it } from 'vitest';
import { createDefaultAppSettings } from '@shared/constants/appSettingsDefaults';
import { translate } from '../../../../i18n/messages';
import { createNewAgent } from './agentDraftFactory';
import { agentPanelSummary } from './agentPanelSummary';
import type { useI18n } from '../../../../i18n';

it('summarizes real limits and handoff choices, leaving default permissions and empty handoffs quiet', () => {
  const t: ReturnType<typeof useI18n>['t'] = (key, args) => translate('en', key, args);
  const settings = createDefaultAppSettings();
  const draft = createNewAgent({ name: 'Analysis', id: 'analysis' }, t, 'user', null);
  expect(agentPanelSummary('permissions', draft, settings, t)).toBeUndefined();
  expect(agentPanelSummary('handoffs', draft, settings, t)).toBeUndefined();
  draft.accessCeiling = 'read-only';
  expect(agentPanelSummary('permissions', draft, settings, t)).toBe('Read only');
  draft.handoffs = [
    { agent: 'general', label: 'Inspect', prompt: 'Inspect the capture' },
    { agent: 'general', label: 'Verify', prompt: 'Verify the result' },
  ];
  expect(agentPanelSummary('handoffs', draft, settings, t)).toBe(t('settings.agentHandoffChoices', { count: 2 }));
});
