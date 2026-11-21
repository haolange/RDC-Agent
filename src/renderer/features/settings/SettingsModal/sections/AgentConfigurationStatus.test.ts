import { expect, it } from 'vitest';
import { translate } from '../../../../i18n/messages';
import { configStatus } from './agentConfigStatus';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type { AgentModelSettings, AppSettings } from '@shared/types/settings';

const settingsWith = (modelOptions: unknown[], agentModels: AgentModelSettings) => (
  { agents: { modelOptions }, agentModels } as unknown as AppSettings
);

it('checks the reasoning level the Agent resolves to, its own before the default', () => {
  const t = ((key: string) => key) as Parameters<typeof configStatus>[2];
  const agent = { id: 'debugger', enabled: true, tools: ['read'] } as AgentManifestDraft;
  const models = { default: { model: 'provider:model', reasoningLevel: 'medium' }, byAgent: { debugger: { reasoningLevel: 'high' } } } as AgentModelSettings;
  const option = (reasoningSelections: string[] | null) => [{ canonicalId: 'provider:model', status: 'ready', reasoningSelections }];
  expect(configStatus(agent, settingsWith(option(['low']), models), t)).toEqual({ label: 'settings.agentStatusReasoningUnsupported', tone: 'error' });
  expect(configStatus(agent, settingsWith(option(null), models), t)).toEqual({ label: 'settings.agentStatusReasoningUnverified', tone: 'warning' });
  expect(configStatus(agent, settingsWith(option(['high']), models), t)).toEqual({ label: 'settings.agentStatusAvailable', tone: 'success' });
  expect(configStatus(agent, settingsWith([], { default: {}, byAgent: {} }), t)).toEqual({ label: 'settings.agentStatusNoModel', tone: 'warning' });
});

it('localizes provider state and keeps the provider reason as the detail', () => {
  const agent = { id: 'general', enabled: true, tools: ['read'] } as AgentManifestDraft;
  const makeSettings = (providerIssue: string, disabledReason?: string) => settingsWith(
    [{ canonicalId: 'provider:model', status: 'provider-unavailable', providerIssue, disabledReason }],
    { default: { model: 'provider:model' }, byAgent: {} },
  );
  const zh = ((key, params) => translate('zh-CN', key, params)) as Parameters<typeof configStatus>[2];
  const en = ((key, params) => translate('en', key, params)) as Parameters<typeof configStatus>[2];

  expect(configStatus(agent, makeSettings('unconfigured'), zh).label).toBe('供应商未配置');
  expect(configStatus(agent, makeSettings('unconfigured'), en).label).toBe('Provider is not configured');
  expect(configStatus(agent, makeSettings('failed', 'HTTP 401: account denied'), zh))
    .toEqual({ label: '供应商连接失败', tone: 'warning', detail: 'HTTP 401: account denied' });
  expect(configStatus(agent, makeSettings('unavailable', 'Account route is restricted'), en))
    .toEqual({ label: 'Selected provider is unavailable', tone: 'warning', detail: 'Account route is restricted' });
});
