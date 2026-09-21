import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PolicySettings } from './PolicySettings';

vi.mock('../../../../i18n', () => ({ useI18n: () => ({
  t: (key: string, params?: { percent?: number }) => params?.percent === undefined ? key : `${params.percent}%`,
}) }));
vi.mock('./RuntimeScopePanel', () => ({
  RuntimeScopePanel: ({ scope }: { scope: string }) => React.createElement('div', { 'data-testid': 'policy-resources', 'data-scope': scope }),
}));
vi.mock('../../../../stores/appSettingsStore', () => ({
  useAppSettingsStore: (selector: (state: unknown) => unknown) => selector({
    settings: { agentRuntime: { context: { compactionThresholdPercent: 80 } } },
    setCompactionThresholdPercent: vi.fn(),
  }),
}));

describe('policy page composition', () => {
  it.each(['user', 'project'] as const)('renders one %s resource panel before independent global settings', (scope) => {
    const html = renderToStaticMarkup(React.createElement(PolicySettings, { overview: null, scope, onScopeChange: () => {}, onChanged: () => {} }));
    expect(html.match(/data-testid="policy-resources"/g)).toHaveLength(1);
    expect(html).toContain(`data-scope="${scope}"`);
    expect(html.indexOf('policy-resources')).toBeLessThan(html.indexOf('settings.globalRuntimeSettings'));
    expect(html).toContain('settings.compactionThresholdScope');
    expect(html).toContain('80');
  });
});
