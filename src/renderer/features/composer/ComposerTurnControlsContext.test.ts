// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';
import type { SessionRecord } from '@shared/types/session';
import { ComposerTurnControlsProvider, useComposerTurnControls } from './ComposerTurnControlsContext';
import { useTurnControlsStore } from '../../stores/turnControlsStore';
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const agentDefaults = vi.hoisted(() => ({ reasoningLevel: undefined as 'high' | 'xhigh' | undefined }));
vi.mock('../../stores/appSettingsStore', () => ({ useAppSettingsStore: (select: (state: unknown) => unknown) => select({
  settings: { agents: { definitions: [{ id: 'general', reasoningLevel: agentDefaults.reasoningLevel }] },
    llm: { providers: [{ id: 'p', protocol: 'OpenAICompatibleChatCompletions', models: [] }] } },
  agentRouteSyncById: {}, hydrated: true,
}) }));
vi.mock('../../hooks/useComposerEffectiveModel', () => ({ useComposerEffectiveModel: () => ({ effective: { providerId: 'p', modelId: 'm' } }) }));
vi.mock('./useEffectiveModelCapability', () => ({ useEffectiveModelCapability: () => () => {} }));
const model: EffectiveModel = { providerId: 'p', modelId: 'm', label: 'Model', aliases: [], enabled: true,
  availability: 'available', presencePolicy: 'maintained', route: { protocol: 'OpenAICompatibleChatCompletions', source: 'catalog' },
  routeRevision: 'route', catalogRevision: 'catalog', defaultBudgetTokens: 1000,
  contextTiers: [{ id: 'default', label: 'Default', maxPromptTokens: 1000, activation: { kind: 'implicit' }, entitlement: 'granted' }],
  controls: { reasoning: { kind: 'levels', supportsOff: false, levels: ['low', 'high'], defaultSelection: 'low', wireProfile: { kind: 'none' } },
    fast: { state: 'unsupported', fixedValue: false }, maxContext: { state: 'unsupported', fixedValue: false } },
  toolCalling: { state: 'supported' }, structuredOutput: { state: 'supported' }, visionInput: { state: 'unsupported' }, provenance: [] };
const session = { sessionId: 's', turnControls: { reasoningLevel: 'low', maxContextMode: false, fastModel: false } } as SessionRecord;
function Consumer() {
  const controls = useComposerTurnControls();
  return createElement('button', { onClick: () => controls.updateTurnControls({ reasoningLevel: 'high' }) }, controls.turnControls.reasoningLevel);
}
it('starts from the Agent reasoning and retains an unavailable default until the user explicitly replaces it', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  agentDefaults.reasoningLevel = 'high';
  useTurnControlsStore.setState({ capabilityState: { status: 'ready', model }, controlsByCapabilityKey: {} });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const render = () => root.render(createElement(ComposerTurnControlsProvider,
    { agentId: 'general', currentSession: null, children: createElement(Consumer) }));
  try {
    await act(async () => render());
    expect(host.textContent).toBe('high');
    agentDefaults.reasoningLevel = 'xhigh';
    await act(async () => render());
    expect(useTurnControlsStore.getState().turnControls.reasoningLevel).toBe('xhigh');
    await act(async () => host.querySelector('button')!.click());
    expect(useTurnControlsStore.getState().turnControls.reasoningLevel).toBe('high');
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
    agentDefaults.reasoningLevel = undefined;
  }
});
it('preserves an edited effort across review revisions and return to the editor, and resets for another session', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useTurnControlsStore.setState({ capabilityState: { status: 'ready', model }, controlsByCapabilityKey: {} });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const render = (key: string, currentSession = session) => act(async () => root.render(createElement(ComposerTurnControlsProvider,
    { agentId: 'debugger', currentSession, children: createElement(Consumer, { key }) })));
  try {
    await render('review-1');
    await act(async () => host.querySelector('button')!.click());
    expect(host.textContent).toBe('high');
    await render('review-2'); expect(host.textContent).toBe('high');
    await render('editor'); expect(host.textContent).toBe('high');
    await render('other', { ...session, sessionId: 'other' }); expect(host.textContent).toBe('low');
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it('restores persisted effort when a new session arrives while its capability is loading', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const selectableOffModel: EffectiveModel = { ...model, controls: { ...model.controls,
    reasoning: { kind: 'levels', supportsOff: true, levels: ['low', 'high'], defaultSelection: 'low', wireProfile: { kind: 'none' } } } };
  useTurnControlsStore.setState({ capabilityState: { status: 'ready', model: selectableOffModel }, controlsByCapabilityKey: {} });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const render = (currentSession: SessionRecord | null) => root.render(createElement(ComposerTurnControlsProvider,
    { agentId: 'general', currentSession, children: createElement(Consumer) }));
  try {
    await act(async () => render(null));
    expect(host.textContent).toBe('low');
    await act(async () => {
      useTurnControlsStore.setState({ capabilityState: { status: 'loading' } });
      render(session);
    });
    expect(useTurnControlsStore.getState().turnControls).toEqual(session.turnControls);
    await act(async () => useTurnControlsStore.setState({ capabilityState: { status: 'ready', model: selectableOffModel } }));
    expect(host.textContent).toBe('low');
    // The next ordinary render must keep the restored choice instead of a temporary Off.
    await act(async () => render({ ...session }));
    expect(host.textContent).toBe('low');
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it('retains every conversation control through review remounts, refresh and the target Agent switch', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const capable: EffectiveModel = { ...model,
    contextTiers: [...model.contextTiers, { id: 'max', label: 'Max', maxPromptTokens: 2000, activation: { kind: 'implicit' }, entitlement: 'granted' }],
    controls: { ...model.controls, fast: { state: 'fixed', fixedValue: true, entitlement: 'granted' },
      maxContext: { state: 'selectable', defaultValue: false, entitlement: 'granted', tierId: 'max' } } };
  const selected = { reasoningLevel: 'high' as const, fastModel: true, maxContextMode: true };
  const persisted = { ...session, modelOverride: { providerId: 'p', modelId: 'm' }, turnControls: selected };
  useTurnControlsStore.setState({ capabilityState: { status: 'loading' }, controlsByCapabilityKey: {} });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const render = (agentId: string, key: string) => root.render(createElement(ComposerTurnControlsProvider,
    { agentId, currentSession: persisted, children: createElement(Consumer, { key }) }));
  try {
    await act(async () => render('debugger', 'editor'));
    expect(useTurnControlsStore.getState().turnControls).toEqual(selected);
    await act(async () => useTurnControlsStore.setState({ capabilityState: { status: 'ready', model: capable } }));
    await act(async () => render('debugger', 'review'));
    await act(async () => render('debugger', 'review-revised'));
    await act(async () => useTurnControlsStore.setState({ capabilityState: { status: 'refreshing', model: { ...capable, catalogRevision: 'refreshed' } } }));
    await act(async () => render('general', 'editor'));
    expect(useTurnControlsStore.getState().turnControls).toEqual(selected);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it('keeps the approved selection when switching back to an Agent with older controls on the same model', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useTurnControlsStore.setState({ capabilityState: { status: 'ready', model }, controlsByCapabilityKey: {} });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const render = (agentId: string, currentSession: SessionRecord) => root.render(createElement(ComposerTurnControlsProvider,
    { agentId, currentSession, children: createElement(Consumer) }));
  try {
    await act(async () => render('general', session));
    await act(async () => render('analyzer', session));
    await act(async () => host.querySelector('button')!.click());
    expect(host.textContent).toBe('high');
    const approved = { ...session, turnControls: { reasoningLevel: 'high' as const, maxContextMode: false, fastModel: false } };
    await act(async () => render('analyzer', approved));
    await act(async () => render('general', approved));
    expect(host.textContent).toBe('high');
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  }
});
