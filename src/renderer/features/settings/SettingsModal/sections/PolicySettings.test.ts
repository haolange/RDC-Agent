import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { PolicySettings } from './PolicySettings';
import { CustomPermissionFields } from './CustomPermissionFields';

const saveRules = vi.hoisted(() => vi.fn());

vi.mock('../../../../i18n', () => ({ useI18n: () => ({
  t: (key: string, params?: { percent?: number }) => params?.percent === undefined ? key : `${params.percent}%`,
}) }));
vi.mock('./RuntimeScopePanel', () => ({
  RuntimeScopePanel: ({ scope }: { scope: string }) => React.createElement('div', { 'data-testid': 'policy-resources', 'data-scope': scope }),
}));
vi.mock('../../../../stores/appSettingsStore', () => ({
  useAppSettingsStore: (selector: (state: unknown) => unknown) => selector({
    settings: { agentRuntime: { context: { compactionThresholdPercent: 80 }, permissions: { readableRoots: [], writableRoots: [], allowedCommandPrefixes: [], deniedCommandPrefixes: [] } } },
    setCompactionThresholdPercent: vi.fn(),
    setCustomPermissionRules: saveRules,
  }),
}));

describe('policy page composition', () => {
  it('preserves typed spaces and line breaks until the custom rules are saved', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    saveRules.mockResolvedValue(undefined);
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(React.createElement(CustomPermissionFields)));
      const field = host.querySelector<HTMLTextAreaElement>('#settings-permission-allowedCommandPrefixes')!;
      const input = async (value: string) => act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await input('git ');
      expect(field.value).toBe('git ');
      await input('git status\n');
      expect(field.value).toBe('git status\n');
      await input('git status\n  git diff');
      await act(async () => host.querySelector<HTMLButtonElement>('.settings-actions button')!.click());
      expect(saveRules).toHaveBeenCalledWith({
        readableRoots: [], writableRoots: [], allowedCommandPrefixes: ['git status', 'git diff'], deniedCommandPrefixes: [],
      });
    } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
  });

  it.each(['user', 'project'] as const)('renders one %s resource panel before independent global settings', (scope) => {
    const html = renderToStaticMarkup(React.createElement(PolicySettings, { overview: null, scope, onScopeChange: () => {}, onChanged: () => {} }));
    expect(html.match(/data-testid="policy-resources"/g)).toHaveLength(1);
    expect(html).toContain(`data-scope="${scope}"`);
    expect(html.indexOf('policy-resources')).toBeLessThan(html.indexOf('settings.globalRuntimeSettings'));
    // The threshold's scope note sits behind the field's help tip instead of a line under it.
    expect(html).toContain('aria-label="settings.compactionThreshold"');
    expect(html).not.toContain('settings-help-text');
    expect(html).toContain('80');
  });
});
