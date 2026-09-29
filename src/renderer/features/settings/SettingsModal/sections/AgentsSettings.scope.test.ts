import { describe, expect, it } from 'vitest';
import { resolveAgentWriteTargetFromDraft } from '@shared/types/agentManifest';
import { createNewAgent } from './AgentsSettings';

const t = ((key: string) => key) as Parameters<typeof createNewAgent>[1];

describe('new agent scope', () => {
  it('keeps a new project agent in the selected project even if the active project changes before save', () => {
    const draft = createNewAgent([], t, 'project', 'project-b');

    expect(draft).toMatchObject({ id: 'custom-agent', writeScope: 'project', writeProjectId: 'project-b' });
    expect(resolveAgentWriteTargetFromDraft(draft, 'project-a')).toEqual({ scope: 'project', projectId: 'project-b' });
  });

  it('keeps user agents in User Scope and assigns a distinct id across scopes', () => {
    const projectDraft = createNewAgent([], t, 'project', 'project-b');
    const userDraft = createNewAgent([projectDraft], t, 'user', 'project-b');

    expect(userDraft.id).toBe('custom-agent-2');
    expect(resolveAgentWriteTargetFromDraft(userDraft, 'project-b')).toEqual({ scope: 'user' });
  });
});
