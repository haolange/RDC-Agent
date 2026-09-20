import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({ userDataRoot: '', appRoot: '' }));
vi.mock('electron', () => ({
  app: {
    getPath: () => electronMock.userDataRoot,
    getAppPath: () => electronMock.appRoot,
  },
}));

describe('AgentRuntimeConfigService scoped resources', () => {
  let root = '';
  let previousHome: string | undefined;
  let previousUserData: string | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-runtime-config-'));
    previousHome = process.env.RDC_AGENT_HOME;
    previousUserData = process.env.RDC_AGENT_USER_DATA;
    process.env.RDC_AGENT_HOME = path.join(root, 'user', '.rdc-agent');
    process.env.RDC_AGENT_USER_DATA = path.join(root, 'app-data');
    electronMock.userDataRoot = process.env.RDC_AGENT_USER_DATA;
    electronMock.appRoot = process.cwd();
    vi.resetModules();
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.RDC_AGENT_HOME;
    else process.env.RDC_AGENT_HOME = previousHome;
    if (previousUserData === undefined) delete process.env.RDC_AGENT_USER_DATA;
    else process.env.RDC_AGENT_USER_DATA = previousUserData;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('loads standard directory skills and applies project whole-resource precedence', async () => {
    const project = path.join(root, 'project');
    const skillDir = path.join(project, '.rdc-agent', 'skills', 'debug');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: debug',
      'description: Project-specific debugging contract.',
      'allowed-tools: [read_file]',
      '---',
      '',
      '# Project Debug',
      '',
      'Use project evidence only.',
    ].join('\n'));

    const { AgentRuntimeConfigService } = await import('./AgentRuntimeConfigService');
    const service = new AgentRuntimeConfigService();
    const loaded = service.loadSkill('debug', project);

    expect(loaded).toMatchObject({
      id: 'debug',
      scope: 'project',
      description: 'Project-specific debugging contract.',
      allowedTools: ['read_file'],
      effectiveStatus: 'overridden',
    });
    expect(loaded?.instructions).toContain('Use project evidence only.');
    expect(service.listSkillMetadata(project).every((skill) => !('instructions' in skill))).toBe(true);
  });

  it('rejects same-id project MCP executable overrides of user command/args/url/env', async () => {
    const userMcp = path.join(process.env.RDC_AGENT_HOME!, 'mcp');
    const project = path.join(root, 'project');
    const projectMcp = path.join(project, '.rdc-agent', 'mcp');
    fs.mkdirSync(userMcp, { recursive: true });
    fs.mkdirSync(projectMcp, { recursive: true });
    fs.writeFileSync(path.join(userMcp, 'docs.mcp.json'), JSON.stringify({ id: 'docs', name: 'User Docs', description: '', transport: 'stdio', command: 'user', enabledByDefault: true }));
    fs.writeFileSync(path.join(projectMcp, 'docs.mcp.json'), JSON.stringify({ id: 'docs', name: 'Project Docs', description: '', transport: 'stdio', command: 'project', enabledByDefault: true }));

    const { AgentRuntimeConfigService } = await import('./AgentRuntimeConfigService');
    const { mcpTrustService } = await import('./McpTrustService');
    const service = new AgentRuntimeConfigService();
    const docs = service.listMcpServers(project).find((server) => server.id === 'docs');
    expect(docs).toMatchObject({
      name: 'User Docs',
      scope: 'user',
      command: 'user',
      executableOverrideRejected: true,
    });
    expect(docs?.command).not.toBe('project');
    expect(() => mcpTrustService.assertConnectAllowed(docs!, project)).not.toThrow();
  });

  it('marks project-only MCP as needing trust before connect', async () => {
    const project = path.join(root, 'project');
    const projectMcp = path.join(project, '.rdc-agent', 'mcp');
    fs.mkdirSync(projectMcp, { recursive: true });
    fs.writeFileSync(path.join(projectMcp, 'local.mcp.json'), JSON.stringify({
      id: 'local',
      name: 'Local',
      description: '',
      transport: 'stdio',
      command: 'node',
      enabledByDefault: true,
    }));

    const { AgentRuntimeConfigService } = await import('./AgentRuntimeConfigService');
    const { mcpTrustService } = await import('./McpTrustService');
    const service = new AgentRuntimeConfigService();
    const local = service.listMcpServers(project).find((server) => server.id === 'local');
    expect(local).toMatchObject({
      scope: 'project',
      needsRetrust: true,
      command: 'node',
    });
    expect(() => mcpTrustService.assertConnectAllowed(local!, project)).toThrow(/needs trust/);

    mcpTrustService.trust(project, local!.id, local!.descriptorHash!);
    const trusted = service.listMcpServers(project).find((server) => server.id === 'local');
    expect(trusted?.needsRetrust).toBe(false);
    expect(() => mcpTrustService.assertConnectAllowed(trusted!, project)).not.toThrow();
  });

  it('discovers the Wave 4 method skills and Debugger causal method from the builtin catalog', async () => {
    const { AgentRuntimeConfigService } = await import('./AgentRuntimeConfigService');
    const {
      CANONICAL_SKILL_IDS,
      FORBIDDEN_SKILL_NAMES,
      GENERAL_SKILL_IDS,
      MISSION_KNOWLEDGE_COORDINATOR_SKILL_IDS,
      PLAN_ONLY_CONFLICT_SKILL_IDS,
      SKILL_ARMED_BY_PROFILE,
      isPlanOnlyConflictSkill,
      skillCallEntry,
      skillLane,
    } = await import('@shared/constants/canonicalSkills');
    const { MISSION_FORBIDDEN_TOOL_IDS } = await import('@shared/constants/missionPlanOnly');
    const service = new AgentRuntimeConfigService();
    const metadata = service.listSkillMetadata();
    const ids = metadata.map((skill) => skill.id).sort();
    expect(MISSION_KNOWLEDGE_COORDINATOR_SKILL_IDS).toHaveLength(22);
    expect(GENERAL_SKILL_IDS).toHaveLength(9);
    expect([...CANONICAL_SKILL_IDS].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    for (const forbidden of FORBIDDEN_SKILL_NAMES) {
      expect(ids).not.toContain(forbidden);
    }
    for (const skill of metadata) {
      expect(skill.scope).toBe('builtin');
      expect(skillLane(skill.id)).toBeTruthy();
      expect(skillCallEntry(skill.id)).toMatch(/agent\.md-skills|task-matched-or-explicit/);
      const loaded = service.loadSkill(skill.id);
      expect(loaded?.id).toBe(skill.id);
      expect(loaded?.instructions.length).toBeGreaterThan(0);
    }
    for (const id of PLAN_ONLY_CONFLICT_SKILL_IDS) {
      expect(skillLane(id)).toBe('general');
      expect(isPlanOnlyConflictSkill(id)).toBe(true);
      expect(service.loadSkill(id)?.allowedTools).toEqual([]);
    }
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const [profile, armed] of Object.entries(SKILL_ARMED_BY_PROFILE)) {
      const source = readFileSync(join(process.cwd(), 'resources/agent-runtime/agents', `${profile}.agent.md`), 'utf8');
      for (const skillId of armed) {
        expect(source).toMatch(new RegExp(`^  - ${skillId}$`, 'm'));
        expect(skillCallEntry(skillId)).toBe('agent.md-skills');
      }
      if (profile !== 'general') {
        for (const skillId of PLAN_ONLY_CONFLICT_SKILL_IDS) {
          expect(source).not.toMatch(new RegExp(`^  - ${skillId}$`, 'm'));
        }
      }
    }
    const provenance = service.loadSkill('artifact-provenance');
    expect(provenance?.allowedTools).toEqual([]);
    expect(provenance?.instructions).toContain('sourceRefs.length >= 1');
    const execution = service.loadSkill('renderdoc-execution');
    const causal = service.loadSkill('debugger-causal-method');
    const architecture = service.loadSkill('analyzer-architecture-method');
    for (const skill of [execution, causal, architecture]) {
      expect(skill?.allowedTools).toEqual([]);
    }
    const coordinator = service.loadSkill('debugger-coordinator');
    expect(coordinator?.allowedTools.some((tool) => (
      (MISSION_FORBIDDEN_TOOL_IDS as readonly string[]).includes(tool)
    ))).toBe(false);
  });

  it('hides General-only RDC manuals from Mission catalog and skill_read viewers', async () => {
    const { AgentRuntimeConfigService } = await import('./AgentRuntimeConfigService');
    const { isSkillVisibleToProfile } = await import('@shared/constants/canonicalSkills');
    const service = new AgentRuntimeConfigService();
    const generalOnly = ['rdc-tool-shell', 'debugger-rdc-tools', 'analyzer-rdc-tools', 'optimizer-rdc-tools'];
    for (const mission of ['debugger', 'analyzer', 'optimizer'] as const) {
      for (const skillId of generalOnly) {
        expect(isSkillVisibleToProfile(mission, skillId)).toBe(false);
        expect(service.listSkills(undefined, mission).map((skill) => skill.id)).not.toContain(skillId);
        expect(service.listSkillMetadata(undefined, mission).map((skill) => skill.id)).not.toContain(skillId);
        expect(service.loadSkill(skillId, undefined, mission)).toBeNull();
      }
    }
    for (const skillId of generalOnly) {
      expect(isSkillVisibleToProfile('general', skillId)).toBe(true);
      expect(service.listSkills(undefined, 'general').map((skill) => skill.id)).toContain(skillId);
      expect(service.loadSkill(skillId, undefined, 'general')?.id).toBe(skillId);
      expect(service.loadSkill(skillId)?.id).toBe(skillId);
    }
  });
});
