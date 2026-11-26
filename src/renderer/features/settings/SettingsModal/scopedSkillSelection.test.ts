import { describe, expect, it } from 'vitest';
import { projectSkillSelection, resolveSkillSelectionRequest } from './scopedSkillSelection';
import type { SkillSelectionOption } from '@shared/types/rdcRuntime';

const skill = (id: string, unavailableToAgentIds: string[] = []): SkillSelectionOption => ({
  id,
  name: id,
  description: '',
  allowedTools: [],
  scope: 'builtin',
  sourcePath: '/skills',
  sourceHash: 'hash',
  effectiveStatus: 'effective',
  unavailableToAgentIds,
});

describe('scoped skill selection', () => {
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
    expect(projectSkillSelection({ status: 'ready', options: [] }, 'general', ['a']).unavailable).toEqual({
      a: 'missing',
    });
    expect(
      projectSkillSelection(
        { status: 'error', options: [], error: { code: 'SKILL_CATALOG_READ_FAILED', message: 'denied' } },
        'general',
        ['a'],
      ).unavailable,
    ).toEqual({ a: 'catalog-error' });
  });
});
