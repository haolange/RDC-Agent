import { describe, expect, it, vi } from 'vitest';

vi.mock('./projectRegistryLookup', () => ({
  lookupProjectById: vi.fn(),
  lookupCurrentProjectId: vi.fn(),
}));

import { lookupCurrentProjectId, lookupProjectById } from './projectRegistryLookup';
import { resolveRegisteredProjectRoot, tryCurrentProjectRoot } from './resolveRegisteredProjectRoot';

describe('resolveRegisteredProjectRoot', () => {
  it('rejects path-shaped ids and unknown registry ids', () => {
    expect(() => resolveRegisteredProjectRoot('D:/Projects/Demo')).toThrow(/AGENT_MANIFEST_PROJECT_ID_INVALID/);
    expect(() => resolveRegisteredProjectRoot('../escape')).toThrow(/AGENT_MANIFEST_PROJECT_ID_INVALID/);
    vi.mocked(lookupProjectById).mockReturnValue(null);
    expect(() => resolveRegisteredProjectRoot('missing-project')).toThrow(/AGENT_MANIFEST_PROJECT_UNKNOWN/);
  });

  it('resolves a registered id to its rootPath', () => {
    vi.mocked(lookupProjectById).mockReturnValue({
      projectId: 'proj_demo',
      rootPath: 'D:/Projects/Demo',
    });
    expect(resolveRegisteredProjectRoot('proj_demo')).toBe('D:/Projects/Demo');
  });

  it('reads the current project through the leaf registry lookup', () => {
    vi.mocked(lookupCurrentProjectId).mockReturnValue('proj_demo');
    vi.mocked(lookupProjectById).mockReturnValue({
      projectId: 'proj_demo',
      rootPath: 'D:/Projects/Demo',
    });
    expect(tryCurrentProjectRoot()).toBe('D:/Projects/Demo');
  });
});
