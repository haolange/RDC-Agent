import { describe, expect, it, vi } from 'vitest';
import type { SkillSelectionOption } from '@shared/types/rdcRuntime';
import { observeScopedRequest, projectSkillSelection, resolveSkillSelectionRequest } from './scopedSkillSelection';

const skill = (id: string, unavailableToAgentIds: string[] = []): SkillSelectionOption => ({
  id, name: id, description: '', allowedTools: [], scope: 'builtin', sourcePath: '/skills',
  sourceHash: 'hash', effectiveStatus: 'effective', unavailableToAgentIds,
});

describe('scoped skill selection', () => {
  it('discards late success after scope/project switch or close while the next request succeeds', async () => {
    let resolveOld!: (value: string) => void;
    const stale = new Promise<string>((resolve) => { resolveOld = resolve; });
    const success = vi.fn();
    const error = vi.fn();
    const cancel = observeScopedRequest(stale, success, error);
    cancel();
    observeScopedRequest(Promise.resolve('new project'), success, error);
    resolveOld('old project');
    await Promise.resolve();
    expect(success.mock.calls).toEqual([['new project']]);
    expect(error).not.toHaveBeenCalled();
  });
  it('discards late failures after cleanup and reports an active retry failure', async () => {
    const success = vi.fn();
    const error = vi.fn();
    const cancel = observeScopedRequest(Promise.reject('stale'), success, error);
    cancel();
    observeScopedRequest(Promise.reject('current'), success, error);
    await Promise.resolve();
    expect(error.mock.calls).toEqual([['current']]);
    expect(success).not.toHaveBeenCalled();
  });
  it('never applies project overrides to user scope', () => {
    expect(resolveSkillSelectionRequest('user', '/project')).toEqual({ enabled: true, projectRoot: undefined });
    expect(resolveSkillSelectionRequest('project', '/project')).toEqual({ enabled: true, projectRoot: '/project' });
    expect(resolveSkillSelectionRequest('project').enabled).toBe(false);
  });
  it('filters target visibility without mutating or dropping selected IDs', () => {
    const selected = ['gone', 'restricted', 'visible'];
    const catalog = { status: 'ready' as const, options: [skill('visible'), skill('restricted', ['analyzer'])] };
    const result = projectSkillSelection(catalog, 'analyzer', selected);
    expect(result.options.map((option) => option.id)).toEqual(['visible']);
    expect(result.unavailable).toEqual({ gone: 'missing', restricted: 'target' });
    expect(selected).toEqual(['gone', 'restricted', 'visible']);
    expect(projectSkillSelection(catalog, 'general', selected).options).toHaveLength(2);
  });
  it('distinguishes read errors from an empty resolved catalog', () => {
    expect(projectSkillSelection({ status: 'ready', options: [] }, 'general', ['a']).unavailable).toEqual({ a: 'missing' });
    expect(projectSkillSelection({ status: 'error', options: [], error: { code: 'SKILL_CATALOG_READ_FAILED', message: 'denied' } }, 'general', ['a']).unavailable).toEqual({ a: 'catalog-error' });
  });
});
