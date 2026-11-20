import { describe, expect, it } from 'vitest';
import { resolveAgentWriteTargetFromDraft } from '@shared/types/agentManifest';
import { createNewAgent, toSlug } from './agentDraftFactory';
import { uniqueResourceId } from './uniqueResourceId';

const t = ((key: string) => key) as Parameters<typeof createNewAgent>[1];

describe('new agent scope', () => {
  it('keeps a new project agent in the selected project even if the active project changes before save', () => {
    const draft = createNewAgent({ name: 'Frame Checker', id: 'frame-checker' }, t, 'project', 'project-b');

    expect(draft).toMatchObject({ id: 'frame-checker', name: 'Frame Checker', writeScope: 'project', writeProjectId: 'project-b' });
    expect(resolveAgentWriteTargetFromDraft(draft, 'project-a')).toEqual({ scope: 'project', projectId: 'project-b' });
  });

  it('keeps user agents in User Scope and assigns a distinct id across scopes', () => {
    const projectDraft = createNewAgent({ name: 'Frame Checker', id: 'frame-checker' }, t, 'project', 'project-b');
    const id = uniqueResourceId(toSlug('Frame Checker'), [projectDraft.id]);
    const userDraft = createNewAgent({ name: 'Frame Checker', id }, t, 'user', 'project-b');

    expect(userDraft.id).toBe('frame-checker-2');
    expect(resolveAgentWriteTargetFromDraft(userDraft, 'project-b')).toEqual({ scope: 'user' });
  });
});
