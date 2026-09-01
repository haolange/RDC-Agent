import fs from 'node:fs';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => os.tmpdir(),
    getAppPath: () => process.cwd(),
  },
}));

import { agentManifestService } from './AgentManifestService';
import type { AgentManifestDraft } from '@shared/types/agentManifest';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function customDraft(id: string, model: string): AgentManifestDraft {
  return {
    id,
    fileName: `${id}.agent.md`,
    name: id,
    description: 'custom',
    argumentHint: '',
    target: 'rdc-agent',
    models: [model],
    icon: 'message-orbit',
    accent: '#33d1ff',
    disableModelInvocation: false,
    userInvocable: true,
    tools: ['read'],
    skills: [],
    mcpServers: [],
    agents: [],
    handoffs: [],
    metadata: {},
    instructions: 'custom profile',
    enabled: true,
  };
}

function assertEffectiveSaveShape(definition: unknown): asserts definition is {
  compiledRoute: { agentId: string; providerId: string; modelId: string };
  provenance: { sourceHash: string; scope: string };
} {
  if (!definition || typeof definition !== 'object') {
    throw new Error('save returned a missing definition');
  }
  const record = definition as {
    compiledRoute?: { agentId?: string; providerId?: string; modelId?: string };
    provenance?: { sourceHash?: string };
  };
  if (!record.compiledRoute?.agentId || !record.compiledRoute.providerId || !record.compiledRoute.modelId) {
    throw new Error('legacy save shape missing compiledRoute');
  }
  if (!record.provenance?.sourceHash) {
    throw new Error('legacy save shape missing provenance.sourceHash');
  }
}

describe('AgentManifestService save/delete effective commit', () => {
  it('returns compiledRoute and provenance.sourceHash and accepts that hash on the next save', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-agent-save-meta-'));
    roots.push(root);
    const paths = { agentsPath: path.join(root, 'agents'), instructionsPath: path.join(root, 'RDX.md') };
    const first = await agentManifestService.saveDefinition(
      paths,
      customDraft('custom-writer', 'openai:gpt-test'),
      { scope: 'user' },
    );
    assertEffectiveSaveShape(first.definition);
    expect(first.definition.compiledRoute).toEqual({
      agentId: 'custom-writer',
      providerId: 'openai',
      modelId: 'gpt-test',
    });
    expect(first.definition.provenance.scope).toBe('user');

    await expect(agentManifestService.saveDefinition(
      paths,
      { ...customDraft('custom-writer', 'openai:gpt-test-2'), sourceHash: first.definition.provenance.sourceHash },
      { scope: 'user', sourceHash: first.definition.provenance.sourceHash },
    )).resolves.toMatchObject({
      definition: {
        compiledRoute: { agentId: 'custom-writer', providerId: 'openai', modelId: 'gpt-test-2' },
        provenance: { scope: 'user', sourceHash: expect.any(String) },
      },
    });
  });

  it('restores builtin general after deleting a project override', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-agent-delete-restore-'));
    roots.push(root);
    const projectRoot = path.join(root, 'project');
    const projectAgents = path.join(projectRoot, '.rdx', 'agents');
    await mkdir(projectAgents, { recursive: true });
    const paths = { agentsPath: path.join(root, 'user-agents'), instructionsPath: path.join(root, 'RDX.md') };
    await agentManifestService.saveDefinition(
      paths,
      customDraft('general', 'openai:project-general'),
      { scope: 'project', projectRoot },
    );
    expect(fs.existsSync(path.join(projectAgents, 'general.agent.md'))).toBe(true);

    const deleted = await agentManifestService.saveDefinition(
      paths,
      { ...customDraft('general', 'openai:project-general'), delete: true },
      { scope: 'project', projectRoot },
    );
    expect(fs.existsSync(path.join(projectAgents, 'general.agent.md'))).toBe(false);
    expect(deleted.definition).toMatchObject({
      id: 'general',
      builtin: true,
      provenance: { scope: 'builtin', sourceHash: expect.any(String) },
      compiledRoute: { agentId: 'general' },
    });
    expect(deleted.definition?.compiledRoute).toBeDefined();
  });

  it('returns definition null only when the id is gone from every scope', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-agent-delete-gone-'));
    roots.push(root);
    const paths = { agentsPath: path.join(root, 'agents'), instructionsPath: path.join(root, 'RDX.md') };
    await agentManifestService.saveDefinition(paths, customDraft('only-mine', 'openai:a'), { scope: 'user' });
    const deleted = await agentManifestService.saveDefinition(
      paths,
      { ...customDraft('only-mine', 'openai:a'), delete: true },
      { scope: 'user' },
    );
    expect(deleted.definition).toBeNull();
  });
});
