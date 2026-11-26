import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { formatAgentManifestDiagnostic } from '@shared/utils/agentManifestDiagnostic';
import { translate } from '../../../../i18n/messages';
import { AgentManifestDiagnostics } from './AgentManifestDiagnostics';
import type { AgentManifestDiagnostic } from '@shared/types/agentManifest';
const locale = vi.hoisted(() => ({ language: 'en' as 'en' | 'zh-CN' | 'keys' }));
vi.mock('../../../../i18n', () => ({
  useI18n: () => ({
    t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
      locale.language === 'keys' ? key : translate(locale.language, key, params),
  }),
}));

const bridge = vi.hoisted(() => ({ copyText: vi.fn() }));
vi.mock('../../../../hooks/useClipboardBridge', () => ({ useClipboardBridge: () => bridge }));
const issues: AgentManifestDiagnostic[] = [
  {
    code: 'resource.invalid',
    severity: 'error',
    scope: 'user',
    agentId: 'general',
    sourcePath: 'C:/user/agents/general.agent.md',
    message: 'Invalid tool name',
  },
  {
    code: 'resource.invalid',
    severity: 'error',
    scope: 'project',
    agentId: 'general',
    sourcePath: 'D:/project/.rdc-agent/agents/general.agent.md',
    message: 'Invalid handoff',
  },
];
it.each(['en', 'zh-CN'] as const)(
  'keeps source identity and exact copy data, including failure and an empty refresh (%s)',
  async (language) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const onClose = vi.fn();
    locale.language = language;
    const render = async (diagnostics = issues) =>
      act(async () =>
        root.render(
          createElement(AgentManifestDiagnostics, {
            open: true,
            onClose,
            diagnostics,
            onDeleteOverride: vi.fn(),
            onReviewTrust: vi.fn(),
          }),
        ),
      );
    try {
      bridge.copyText.mockResolvedValue(true);
      await render();
      const dialog = document.querySelector('[data-testid="settings-agent-diagnostics-dialog"]')!;
      expect(dialog.textContent).toContain(issues[0].sourcePath);
      expect(dialog.textContent).toContain(issues[1].sourcePath);
      const buttons = () => [...dialog.querySelectorAll<HTMLButtonElement>('button')];
      const action = (key: Parameters<typeof translate>[1]) =>
        buttons().find((button) => button.textContent === translate(language, key))!;
      await act(async () => action('settings.agentDiagnosticsCopyOne').click());
      expect(bridge.copyText).toHaveBeenLastCalledWith(formatAgentManifestDiagnostic(issues[0]));
      await act(async () => action('settings.agentDiagnosticsCopyAll').click());
      expect(bridge.copyText).toHaveBeenLastCalledWith(issues.map(formatAgentManifestDiagnostic).join('\n\n'));
      bridge.copyText.mockResolvedValue(false);
      await act(async () => action('settings.agentDiagnosticsCopyAll').click());
      expect(dialog.textContent).toContain(translate(language, 'settings.agentDiagnosticsCopyFailed'));
      expect(onClose).not.toHaveBeenCalled();
      await render([]);
      expect(document.querySelector('[data-testid="settings-agent-diagnostics-dialog"]')).not.toBeNull();
      expect(action('settings.agentDiagnosticsCopyAll').disabled).toBe(true);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  },
);

it('offers delete only for an override that still declares model fields', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const moved: AgentManifestDiagnostic = {
    code: 'AGENT_MANIFEST_FIELD_MOVED',
    severity: 'error',
    scope: 'user',
    agentId: 'general',
    sourcePath: 'C:/user/agents/general.agent.md',
    message: 'model and reasoning-level are set in Settings → Agents.',
  };
  const onDeleteOverride = vi.fn();
  locale.language = 'en';
  try {
    await act(async () =>
      root.render(
        createElement(AgentManifestDiagnostics, {
          open: true,
          onClose: vi.fn(),
          diagnostics: [moved, issues[1]],
          onDeleteOverride,
          onReviewTrust: vi.fn(),
        }),
      ),
    );
    expect(document.querySelectorAll('[data-testid="settings-agent-diagnostic-delete"]')).toHaveLength(1);
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="settings-agent-diagnostic-delete"]')!.click(),
    );
    expect(onDeleteOverride).toHaveBeenCalledWith(moved);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('offers trust review only for a project profile that has not been trusted', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const untrusted: AgentManifestDiagnostic = {
    code: 'AGENT_PROJECT_UNTRUSTED',
    severity: 'warning',
    scope: 'project',
    agentId: 'reviewer',
    sourcePath: 'D:/project/.rdc-agent/agents/reviewer.agent.md',
    message: 'This project brings its own Agent profile; it loads only after you trust it.',
  };
  const onReviewTrust = vi.fn();
  locale.language = 'en';
  try {
    await act(async () =>
      root.render(
        createElement(AgentManifestDiagnostics, {
          open: true,
          onClose: vi.fn(),
          diagnostics: [untrusted, issues[1]],
          onDeleteOverride: vi.fn(),
          onReviewTrust,
        }),
      ),
    );
    expect(document.querySelectorAll('[data-testid="settings-agent-diagnostic-trust"]')).toHaveLength(1);
    expect(document.body.textContent).toContain(translate('en', 'settings.agentDiagnosticsUntrusted'));
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="settings-agent-diagnostic-trust"]')!.click(),
    );
    expect(onReviewTrust).toHaveBeenCalledWith(untrusted);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
