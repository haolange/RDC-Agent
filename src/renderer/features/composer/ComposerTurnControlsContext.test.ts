// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';
import type { SessionRecord } from '@shared/types/session';
import { ComposerTurnControlsProvider, useComposerTurnControls } from './ComposerTurnControlsContext';
import { useTurnControlsStore } from '../../stores/turnControlsStore';
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../stores/appSettingsStore', () => ({ useAppSettingsStore: (select: (state: unknown) => unknown) => select({
  settings: { llm: { providers: [{ id: 'p', protocol: 'OpenAICompatibleChatCompletions', models: [] }] } },
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
