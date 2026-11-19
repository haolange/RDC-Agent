import { expect, it } from 'vitest';
import { translate } from '../../../../i18n/messages';
import { configStatus } from './AgentManifestEditor';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';

it('shows unsupported and unverified reasoning without claiming the configuration is available', () => {
  const t = ((key: string) => key) as Parameters<typeof configStatus>[2];
  const agent = { enabled: true, models: ['provider/model'], reasoningLevel: 'high', tools: ['read'] } as AgentManifestDraft;
  const makeSettings = (reasoningSelections: string[] | null) => ({ agents: { modelOptions: [
    { canonicalId: 'provider/model', status: 'ready', reasoningSelections },
  ] } } as unknown as AppSettings);
  expect(configStatus(agent, makeSettings(['low']), t)).toEqual({ label: 'settings.agentStatusReasoningUnsupported', tone: 'error' });
  expect(configStatus(agent, makeSettings(null), t)).toEqual({ label: 'settings.agentStatusReasoningUnverified', tone: 'warning' });
  expect(configStatus(agent, makeSettings(['high']), t)).toEqual({ label: 'settings.agentStatusAvailable', tone: 'success' });
});

it('localizes provider state and preserves provider diagnostics in both languages', () => {
  const agent = { enabled: true, models: ['provider:model'], tools: ['read'] } as AgentManifestDraft;
  const makeSettings = (providerIssue: string, disabledReason?: string) => ({ agents: { modelOptions: [
    { canonicalId: 'provider:model', status: 'provider-unavailable', providerIssue, disabledReason },
  ] } } as unknown as AppSettings);
  const zh = ((key, params) => translate('zh-CN', key, params)) as Parameters<typeof configStatus>[2];
  const en = ((key, params) => translate('en', key, params)) as Parameters<typeof configStatus>[2];

  expect(configStatus(agent, makeSettings('unconfigured'), zh).label).toBe('供应商未配置');
  expect(configStatus(agent, makeSettings('unconfigured'), en).label).toBe('Provider is not configured');
  expect(configStatus(agent, makeSettings('failed', 'HTTP 401: account denied'), zh).label)
    .toBe('供应商连接失败：HTTP 401: account denied');
  expect(configStatus(agent, makeSettings('unavailable', 'Account route is restricted'), en).label)
    .toBe('Selected provider is unavailable: Account route is restricted');
});
