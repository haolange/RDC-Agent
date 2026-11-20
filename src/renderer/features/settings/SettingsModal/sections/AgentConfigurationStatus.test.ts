import { expect, it } from 'vitest';
import { translate } from '../../../../i18n/messages';
import { configStatus, modelSourceLabel } from './agentConfigStatus';
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

it('names the model that runs and whether it comes from the default or the Agent', () => {
  const en = ((key, params) => translate('en', key, params)) as Parameters<typeof configStatus>[2];
  const options = [{ canonicalId: 'provider:model', modelLabel: 'Model' }, { canonicalId: 'provider:own', modelLabel: 'Own' }];
  const fromDefault = settingsWith(options, { default: { model: 'provider:model', reasoningLevel: 'medium' }, byAgent: {} });
  expect(modelSourceLabel({ id: 'general' }, fromDefault, en)).toBe('Runs Model · medium, from the default model.');
  const own = settingsWith(options, { default: { model: 'provider:model' }, byAgent: { general: { model: 'provider:own' } } });
  expect(modelSourceLabel({ id: 'general' }, own, en)).toBe('Runs Own, set for this agent.');
  const mixed = settingsWith(options, { default: { model: 'provider:model', reasoningLevel: 'medium' }, byAgent: { general: { reasoningLevel: 'high' } } });
  expect(modelSourceLabel({ id: 'general' }, mixed, en)).toBe('Runs Model · high: the model follows the default, the reasoning level is set for this agent.');
});

it('localizes provider state and preserves provider diagnostics in both languages', () => {
  const agent = { id: 'general', enabled: true, tools: ['read'] } as AgentManifestDraft;
  const makeSettings = (providerIssue: string, disabledReason?: string) => settingsWith(
    [{ canonicalId: 'provider:model', status: 'provider-unavailable', providerIssue, disabledReason }],
    { default: { model: 'provider:model' }, byAgent: {} },
  );
  const zh = ((key, params) => translate('zh-CN', key, params)) as Parameters<typeof configStatus>[2];
  const en = ((key, params) => translate('en', key, params)) as Parameters<typeof configStatus>[2];

  expect(configStatus(agent, makeSettings('unconfigured'), zh).label).toBe('供应商未配置');
  expect(configStatus(agent, makeSettings('unconfigured'), en).label).toBe('Provider is not configured');
  expect(configStatus(agent, makeSettings('failed', 'HTTP 401: account denied'), zh).label)
    .toBe('供应商连接失败：HTTP 401: account denied');
  expect(configStatus(agent, makeSettings('unavailable', 'Account route is restricted'), en).label)
    .toBe('Selected provider is unavailable: Account route is restricted');
});
