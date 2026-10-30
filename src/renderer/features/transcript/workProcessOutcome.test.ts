import { translate } from '../../i18n/messages';
const t = (key: import('../../i18n/messages').TranslationKey, params?: Record<string, string | number>) => translate('zh-CN', key, params);
import { describe, expect, it } from 'vitest';
import { createToolRowForPresentation } from './workProcessToolRows';

const project = (toolName: string, args: unknown, details: unknown, status: 'complete' | 'error' | 'skipped' = 'complete') => {
  const resultPreview = JSON.stringify({ content: [{ type: 'text', text: 'invart-internal\tsha256:receipt' }], details });
  const row = createToolRowForPresentation({ id: 'test', toolName, status, startedAt: 1, argsPreview: JSON.stringify(args), resultPreview }, t);
  if (row.type !== 'tool') throw new Error('Expected tool');
  return row;
};

describe('semantic tool summaries', () => {
  it.each(['investigation_read', 'investigation_write'])('uses the returned manifest for %s while retaining the receipt', tool => {
    const row = project(tool, { title: 'Requested title', status: 'ready' }, {
      manifest: { title: 'Saved title', kind: 'checkpoint', status: 'draft' }, contentHash: 'sha256:receipt',
    });
    expect(row.outcome).toEqual({ type: 'investigation', title: 'Saved title', kind: 'checkpoint', status: 'draft' });
    expect(row.rawLines.join('\n')).toContain('sha256:receipt');
  });
  it('does not invent readiness when only the requested title is available', () => {
    expect(project('investigation_write', { title: 'Requested title', kind: 'evidence', status: 'ready' }, undefined).outcome)
      .toEqual({ type: 'investigation', title: 'Requested title', kind: 'evidence', status: undefined });
  });
  it.each(['error', 'skipped'] as const)('never presents a %s receipt as a successful result', status => {
    expect(project('investigation_write', { title: 'Not saved' }, {}, status).outcome).toBeUndefined();
  });
  it.each(['completed', 'partial', 'blocked', 'cancelled', 'budget_paused'])('keeps completion disposition %s independent of tool success', disposition => {
    expect(project('turn_complete', { disposition }, undefined).outcome).toEqual({ type: 'completion', disposition });
  });
  it('preserves the full search count instead of counting sampled names', () => {
    expect(project('tool_search', {}, { total: 20, matches: [{ name: 'subagent' }, { name: 'background_join' }] }).outcome)
      .toEqual({ type: 'toolSearch', count: 20, names: ['subagent', 'background_join'] });
  });
});
