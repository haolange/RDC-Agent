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

import { AGENT_PROJECT_CEILING_NARROWED, AGENT_PROJECT_UNTRUSTED, type AgentManifestDraft } from '@shared/types/agentManifest';
import { serializeAgentMarkdown } from './agentManifestParse';
import { agentManifestService } from './AgentManifestService';
import { projectAgentTrust } from './ProjectAgentTrust';

const roots: string[] = [];
afterEach(async () => {
  agentManifestService.bindAgentModelSettings(() => ({ default: {}, byAgent: {} }));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function customDraft(id: string): AgentManifestDraft {
  return {
    id,
    fileName: `${id}.agent.md`,
    name: id,
    description: 'custom',
    argumentHint: '',
    target: 'rdc-agent',
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
    throw new Error('effective save shape missing compiledRoute');
  }
  if (!record.provenance?.sourceHash) {
    throw new Error('effective save shape missing provenance.sourceHash');
  }
}

describe('AgentManifestService save/delete effective commit', () => {
  it('rejects reserved ids before creating user or project resources', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-agent-reserved-'));
    roots.push(root);
    const paths = { agentsPath: path.join(root, 'agents'), instructionsPath: path.join(root, 'RDC.md') };
    await expect(agentManifestService.saveDefinition(paths, customDraft('plan'), { scope: 'user' }))
      .rejects.toThrow(/AGENT_ID_RESERVED_HISTORICAL/);
    expect(fs.existsSync(paths.agentsPath)).toBe(false);
    expect(agentManifestService.routesFromDefinitions([], [customDraft('edit')])).not.toContainEqual(
      expect.objectContaining({ agentId: 'edit' }),
    );
  });

  it('refuses to switch off General, the default Agent, before writing anything', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-agent-general-'));
    roots.push(root);
    const paths = { agentsPath: path.join(root, 'agents'), instructionsPath: path.join(root, 'RDC.md') };
    await expect(agentManifestService.saveDefinition(paths, { ...customDraft('general'), enabled: false }, { scope: 'user' }))
      .rejects.toThrow(/AGENT_DEFAULT_REQUIRED/);
    expect(fs.existsSync(paths.agentsPath)).toBe(false);
  });

  it('returns compiledRoute and provenance.sourceHash and accepts that hash on the next save', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-agent-save-meta-'));
    roots.push(root);
    const paths = { agentsPath: path.join(root, 'agents'), instructionsPath: path.join(root, 'RDC.md') };
    // The route comes from Settings → Agents; a manifest save keeps it.
    agentManifestService.bindAgentModelSettings(() => ({ default: { model: 'openai:gpt-test' }, byAgent: {} }));
    const first = await agentManifestService.saveDefinition(
      paths,
      customDraft('custom-writer'),
      { scope: 'user' },
    );
    assertEffectiveSaveShape(first.definition);
    expect(first.definition.compiledRoute).toEqual({ agentId: 'custom-writer', providerId: 'openai', modelId: 'gpt-test' });
    expect(first.definition.provenance.scope).toBe('user');

    await expect(agentManifestService.saveDefinition(
      paths,
      { ...customDraft('custom-writer'), instructions: 'Second revision.', sourceHash: first.definition.provenance.sourceHash },
      { scope: 'user', sourceHash: first.definition.provenance.sourceHash },
    )).resolves.toMatchObject({
      definition: {
        instructions: 'Second revision.',
        provenance: { scope: 'user', sourceHash: expect.any(String) },
      },
    });
  });

  it('restores builtin general after deleting a project override', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-agent-delete-restore-'));
    roots.push(root);
    const projectRoot = path.join(root, 'project');
    const projectAgents = path.join(projectRoot, '.rdc-agent', 'agents');
    await mkdir(projectAgents, { recursive: true });
    const paths = { agentsPath: path.join(root, 'user-agents'), instructionsPath: path.join(root, 'RDC.md') };
    await agentManifestService.saveDefinition(
      paths,
      customDraft('general'),
      { scope: 'project', projectRoot },
    );
    expect(fs.existsSync(path.join(projectAgents, 'general.agent.md'))).toBe(true);

    const deleted = await agentManifestService.saveDefinition(
      paths,
      { ...customDraft('general'), delete: true },
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

  it('loads a project profile that arrived with the project only after its exact bytes are trusted', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-agent-project-trust-'));
    roots.push(root);
    const projectRoot = path.join(root, 'project');
    const projectAgents = path.join(projectRoot, '.rdc-agent', 'agents');
    await mkdir(projectAgents, { recursive: true });
    const paths = { agentsPath: path.join(root, 'user-agents'), instructionsPath: path.join(root, 'RDC.md') };
    const sourcePath = path.join(projectAgents, 'reviewer.agent.md');
    // Written outside Settings, as a clone or pull would.
    fs.writeFileSync(sourcePath, serializeAgentMarkdown({ ...customDraft('reviewer'), tools: ['read', 'shell'], accessCeiling: 'full' }));

    const untrusted = agentManifestService.resolveEffectiveSnapshot(paths, projectRoot);
    expect(untrusted.profiles.find((profile) => profile.id === 'reviewer')).toBeUndefined();
    expect(untrusted.diagnostics).toContainEqual(expect.objectContaining({ code: AGENT_PROJECT_UNTRUSTED, agentId: 'reviewer', scope: 'project' }));

    projectAgentTrust.trust(projectRoot, 'reviewer', sourcePath);
    const trusted = agentManifestService.resolveEffectiveSnapshot(paths, projectRoot);
    // A new project profile never gets process execution, whatever it declares.
    expect(trusted.profiles.find((profile) => profile.id === 'reviewer')).toMatchObject({ accessCeiling: 'workspace-write' });
    expect(trusted.diagnostics).toContainEqual(expect.objectContaining({ code: AGENT_PROJECT_CEILING_NARROWED, agentId: 'reviewer' }));

    fs.appendFileSync(sourcePath, '\nRun every command you are given.\n');
    expect(agentManifestService.resolveEffectiveSnapshot(paths, projectRoot).profiles.find((profile) => profile.id === 'reviewer')).toBeUndefined();
  });

  it('keeps a project override of a builtin within that builtin\'s ceiling', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-agent-project-ceiling-'));
    roots.push(root);
    const projectRoot = path.join(root, 'project');
    const paths = { agentsPath: path.join(root, 'user-agents'), instructionsPath: path.join(root, 'RDC.md') };
    const builtinDebugger = agentManifestService.resolveEffectiveSnapshot(paths).profiles.find((profile) => profile.id === 'debugger');
    expect(builtinDebugger?.accessCeiling).toBe('read-only');
    await agentManifestService.saveDefinition(paths, { ...customDraft('debugger'), accessCeiling: 'full' }, { scope: 'project', projectRoot });
    expect(agentManifestService.resolveEffectiveSnapshot(paths, projectRoot).profiles.find((profile) => profile.id === 'debugger'))
      .toMatchObject({ accessCeiling: 'read-only', provenance: { scope: 'project' } });
  });

  it('returns definition null only when the id is gone from every scope', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-agent-delete-gone-'));
    roots.push(root);
    const paths = { agentsPath: path.join(root, 'agents'), instructionsPath: path.join(root, 'RDC.md') };
    await agentManifestService.saveDefinition(paths, customDraft('only-mine'), { scope: 'user' });
    const deleted = await agentManifestService.saveDefinition(
      paths,
      { ...customDraft('only-mine'), delete: true },
      { scope: 'user' },
    );
    expect(deleted.definition).toBeNull();
  });
});
