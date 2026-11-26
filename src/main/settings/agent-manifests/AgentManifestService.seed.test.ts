import fs from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('AgentManifestService effective builtin snapshot', () => {
  it('loads all builtins without creating or changing user resources', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-agent-seeds-'));
    roots.push(root);
    const agentsPath = path.join(root, 'agents');
    const instructionsPath = path.join(root, 'RDC.md');

    const settings = agentManifestService.getSettings({ agentsPath, instructionsPath });

    expect(fs.existsSync(agentsPath)).toBe(false);

    expect(settings.definitions.map((definition) => definition.id).sort()).toEqual([
      'analyzer',
      'debugger',
      'general',
      'generator',
      'knowledge-scout',
      'optimizer',
      'pass-analyst',
      'pixel-analyst',
      'report-writer',
      'resource-analyst',
      'shader-analyst',
      'verifier',
    ]);
    expect(settings.definitions.every((definition) => definition.builtin)).toBe(true);
    for (const definition of settings.definitions) {
      expect(definition.tools).not.toContain('todo');
      expect(definition.tools).not.toContain('search_codebase');
      expect(definition.tools).toContain('tool_search');
    }
    const byId = new Map(settings.definitions.map((definition) => [definition.id, definition]));
    for (const id of ['general', 'debugger', 'analyzer', 'optimizer'])
      expect(byId.get(id)?.tools).toContain('knowledge');
    for (const id of [
      'generator',
      'verifier',
      'knowledge-scout',
      'report-writer',
      'shader-analyst',
      'pass-analyst',
      'resource-analyst',
      'pixel-analyst',
    ])
      expect(byId.get(id)?.userInvocable).toBe(false);
    expect(byId.get('general')?.tools).toContain('file-manage');
    expect(byId.get('debugger')?.tools).not.toContain('write');
    expect(byId.get('debugger')?.tools).toContain('planArtifact');
  });

  it('rejects saving general into debugger.agent.md and does not delete debugger', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-agent-filename-'));
    roots.push(root);
    const agentsPath = path.join(root, 'agents');
    const instructionsPath = path.join(root, 'RDC.md');
    await mkdir(agentsPath, { recursive: true });
    const debuggerPath = path.join(agentsPath, 'debugger.agent.md');
    await writeFile(debuggerPath, '---\nname: Debugger\n---\nuser copy\n', 'utf8');
    await expect(
      agentManifestService.saveDefinition(
        { agentsPath, instructionsPath },
        {
          id: 'general',
          fileName: 'debugger.agent.md',
          name: 'General',
          description: 'x',
          argumentHint: '',
          target: 'rdc-agent',
          icon: 'nodes',
          accent: '#33d1ff',
          disableModelInvocation: false,
          userInvocable: true,
          tools: ['read'],
          skills: [],
          mcpServers: [],
          agents: [],
          handoffs: [],
          metadata: {},
          instructions: 'general',
          enabled: true,
        },
        { scope: 'user' },
      ),
    ).rejects.toThrow(/AGENT_MANIFEST_FILENAME_MISMATCH/);
    expect(await readFile(debuggerPath, 'utf8')).toContain('user copy');
    expect(fs.existsSync(path.join(agentsPath, 'general.agent.md'))).toBe(false);
  });

  it('surfaces project invalid candidates as Settings diagnostics without overriding builtin', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-agent-invalid-'));
    roots.push(root);
    const projectRoot = path.join(root, 'project');
    const projectAgents = path.join(projectRoot, '.rdc-agent', 'agents');
    await mkdir(projectAgents, { recursive: true });
    await writeFile(path.join(projectAgents, 'general.agent.md'), 'not a valid manifest\n', 'utf8');
    const settings = agentManifestService.getSettings(
      { agentsPath: path.join(root, 'user-agents'), instructionsPath: path.join(root, 'RDC.md') },
      projectRoot,
    );
    const general = settings.definitions.find((definition) => definition.id === 'general');
    expect(general?.builtin).toBe(true);
    expect(general?.tools).toContain('write');
    expect(settings.diagnostics).toEqual([
      expect.objectContaining({
        code: 'resource.invalid',
        scope: 'project',
        agentId: 'general',
        sourcePath: path.join(projectAgents, 'general.agent.md'),
      }),
    ]);
  });

  it('reports four invalid user files once each and preserves a same-id project diagnostic', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-agent-diagnostics-'));
    roots.push(root);
    const agentsPath = path.join(root, 'agents');
    const projectRoot = path.join(root, 'project');
    const projectAgents = path.join(projectRoot, '.rdc-agent', 'agents');
    await mkdir(agentsPath, { recursive: true });
    await mkdir(projectAgents, { recursive: true });
    for (const id of ['general', 'debugger', 'analyzer', 'optimizer'])
      await writeFile(path.join(agentsPath, `${id}.agent.md`), 'invalid user manifest', 'utf8');
    const service = agentManifestService;
    const paths = { agentsPath, instructionsPath: path.join(root, 'RDC.md') };
    expect(service.resolveEffectiveSnapshot(paths).diagnostics).toHaveLength(4);
    await writeFile(path.join(projectAgents, 'general.agent.md'), 'invalid project manifest', 'utf8');
    const result = service.resolveEffectiveSnapshot(paths, projectRoot);
    expect(result.diagnostics).toHaveLength(5);
    expect(
      result.diagnostics
        .filter((issue) => issue.agentId === 'general')
        .map((issue) => issue.scope)
        .sort(),
    ).toEqual(['project', 'user']);
    expect(result.profiles).toHaveLength(12);
    expect(result.profiles.every((profile) => profile.provenance.scope === 'builtin')).toBe(true);
  });

  it('drops reserved historical ids from effective snapshot and diagnoses both scopes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-agent-reserved-'));
    roots.push(root);
    const agentsPath = path.join(root, 'user-agents');
    const projectAgents = path.join(root, 'project', '.rdc-agent', 'agents');
    await mkdir(agentsPath, { recursive: true });
    await mkdir(projectAgents, { recursive: true });
    await writeFile(
      path.join(agentsPath, 'ask.agent.md'),
      `---
id: leftover-ask
name: Leftover Ask
description: reserved
argument-hint: x
target: rdc-agent
model: []
tools:
  - read
agents: []
handoffs: []
---

reserved
`,
      'utf8',
    );
    await writeFile(
      path.join(projectAgents, 'plan.agent.md'),
      `---
name: Plan
description: reserved
argument-hint: x
target: rdc-agent
model: []
tools:
  - read
agents: []
handoffs: []
---

reserved
`,
      'utf8',
    );
    const settings = agentManifestService.getSettings(
      { agentsPath, instructionsPath: path.join(root, 'RDC.md') },
      path.join(root, 'project'),
    );
    expect(settings.definitions.map((definition) => definition.id)).not.toContain('ask');
    expect(settings.definitions.map((definition) => definition.id)).not.toContain('plan');
    expect(
      settings.diagnostics.some((entry) => entry.code === 'AGENT_ID_RESERVED_HISTORICAL' && entry.scope === 'user'),
    ).toBe(true);
    expect(
      settings.diagnostics.some((entry) => entry.code === 'AGENT_ID_RESERVED_HISTORICAL' && entry.scope === 'project'),
    ).toBe(true);
    expect(fs.existsSync(path.join(projectAgents, 'plan.agent.md'))).toBe(true);
  });
});
