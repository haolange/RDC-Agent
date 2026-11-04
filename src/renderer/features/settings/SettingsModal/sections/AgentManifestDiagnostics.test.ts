import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { formatAgentManifestDiagnostic } from '@shared/utils/agentManifestDiagnostic';
import { translate } from '../../../../i18n/messages';
import { AgentManifestDiagnostics } from './AgentManifestDiagnostics';
import type { AgentManifestDiagnostic } from '@shared/types/agentManifest';

const bridge = vi.hoisted(() => ({ copyText: vi.fn() }));
vi.mock('../../../../hooks/useClipboardBridge', () => ({ useClipboardBridge: () => bridge }));
const issues: AgentManifestDiagnostic[] = [
  { code: 'resource.invalid', severity: 'error', scope: 'user', agentId: 'general', sourcePath: 'C:/user/agents/general.agent.md', message: 'Invalid tool name' },
  { code: 'resource.invalid', severity: 'error', scope: 'project', agentId: 'general', sourcePath: 'D:/project/.rdc-agent/agents/general.agent.md', message: 'Invalid handoff' },
];
it.each(['en', 'zh-CN'] as const)('keeps source identity and exact copy data, including failure and an empty refresh (%s)', async language => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const onClose = vi.fn();
  const t = ((key: Parameters<typeof translate>[1], args?: Parameters<typeof translate>[2]) => translate(language, key, args));
  const render = async (diagnostics = issues) => act(async () => root.render(createElement(AgentManifestDiagnostics, { open: true, onClose, diagnostics, t })));
  try {
    bridge.copyText.mockResolvedValue(true); await render();
    const dialog = document.querySelector('[data-testid="settings-agent-diagnostics-dialog"]')!;
    expect(dialog.textContent).toContain(issues[0].sourcePath); expect(dialog.textContent).toContain(issues[1].sourcePath);
    const buttons = () => [...dialog.querySelectorAll<HTMLButtonElement>('button')];
    const action = (key: Parameters<typeof translate>[1]) => buttons().find(button => button.textContent === translate(language, key))!;
    await act(async () => action('settings.agentDiagnosticsCopyOne').click());
    expect(bridge.copyText).toHaveBeenLastCalledWith(formatAgentManifestDiagnostic(issues[0]));
    await act(async () => action('settings.agentDiagnosticsCopyAll').click());
    expect(bridge.copyText).toHaveBeenLastCalledWith(issues.map(formatAgentManifestDiagnostic).join('\n\n'));
    bridge.copyText.mockResolvedValue(false);
    await act(async () => action('settings.agentDiagnosticsCopyAll').click());
    expect(dialog.textContent).toContain(translate(language, 'settings.agentDiagnosticsCopyFailed')); expect(onClose).not.toHaveBeenCalled();
    await render([]); expect(document.querySelector('[data-testid="settings-agent-diagnostics-dialog"]')).not.toBeNull();
    expect(action('settings.agentDiagnosticsCopyAll').disabled).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
