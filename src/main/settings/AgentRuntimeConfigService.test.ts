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
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdx-runtime-config-'));
    previousHome = process.env.RDC_AGENT_HOME;
    previousUserData = process.env.RDC_AGENT_USER_DATA;
    process.env.RDC_AGENT_HOME = path.join(root, 'user', '.rdx');
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
    const skillDir = path.join(project, '.rdx', 'skills', 'debug');
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

  it('resolves same-id project MCP over user MCP with source provenance', async () => {
    const userMcp = path.join(process.env.RDC_AGENT_HOME!, 'mcp');
    const project = path.join(root, 'project');
    const projectMcp = path.join(project, '.rdx', 'mcp');
    fs.mkdirSync(userMcp, { recursive: true });
    fs.mkdirSync(projectMcp, { recursive: true });
    fs.writeFileSync(path.join(userMcp, 'docs.mcp.json'), JSON.stringify({ id: 'docs', name: 'User Docs', description: '', transport: 'stdio', command: 'user', enabledByDefault: true }));
    fs.writeFileSync(path.join(projectMcp, 'docs.mcp.json'), JSON.stringify({ id: 'docs', name: 'Project Docs', description: '', transport: 'stdio', command: 'project', enabledByDefault: true }));

    const { AgentRuntimeConfigService } = await import('./AgentRuntimeConfigService');
    const service = new AgentRuntimeConfigService();
    expect(service.listMcpServers(project).find((server) => server.id === 'docs')).toMatchObject({
      name: 'Project Docs',
      scope: 'project',
      command: 'project',
    });
  });
});
