import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { agentManifestService } from './AgentManifestService';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('AgentManifestService seed manifests', () => {
  it('writes seeds with task token and without todo', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-agent-seeds-'));
    roots.push(root);
    const agentsPath = path.join(root, 'agents');
    const instructionsPath = path.join(root, 'RDX.md');

    const settings = agentManifestService.getSettings(
      { agentsPath, instructionsPath },
      [],
      [],
    );

    expect(settings.definitions.length).toBeGreaterThan(0);
    for (const definition of settings.definitions) {
      expect(definition.tools).toContain('task');
      expect(definition.tools).not.toContain('todo');
      expect(definition.tools).not.toContain('search_codebase');
    }
  });
});
