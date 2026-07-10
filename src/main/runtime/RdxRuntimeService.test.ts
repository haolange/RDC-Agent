import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RdxRuntimeService } from './RdxRuntimeService';
import { HookEngine } from '../hooks/HookEngine';

let home = '';
let userData = '';
const service = new RdxRuntimeService();

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'rdx-runtime-home-'));
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rdx-runtime-data-'));
  process.env.RDC_AGENT_HOME = home;
  process.env.RDC_AGENT_USER_DATA = userData;
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(userData, { recursive: true, force: true });
  delete process.env.RDC_AGENT_HOME; delete process.env.RDC_AGENT_USER_DATA;
});

describe('RdxRuntimeService', () => {
  it('writes user and project resources to canonical isolated paths with provenance status', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rdx-runtime-project-'));
    try {
      service.upsert({ kind: 'agent', scope: 'user', id: 'ask', content: '---\nname: Ask\nenabled: true\n---\n\nUser.' });
      service.upsert({ kind: 'agent', scope: 'project', projectRoot: project, id: 'ask', content: '---\nname: Project Ask\nenabled: true\n---\n\nProject.' });
      const agents = service.list(project).filter((item) => item.kind === 'agent' && item.id === 'ask');
      expect(agents.find((item) => item.scope === 'user')?.effectiveStatus).toBe('overridden');
      expect(agents.find((item) => item.scope === 'project')?.sourcePath).toContain(`${path.sep}.rdx${path.sep}agents${path.sep}`);
    } finally { fs.rmSync(project, { recursive: true, force: true }); }
  });

  it('rejects project policy attempts to loosen user limits', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rdx-runtime-policy-'));
    try {
      service.upsert({ kind: 'policy', scope: 'user', id: 'safe', content: 'approval: mutation\nlimits:\n  maxTurns: 10' });
      expect(service.validate({ kind: 'policy', scope: 'project', projectRoot: project, id: 'safe', content: 'approval: none\nlimits:\n  maxTurns: 20' })).toEqual(expect.arrayContaining([expect.stringContaining('cannot lower approval')]));
    } finally { fs.rmSync(project, { recursive: true, force: true }); }
  });

  it('revokes project hook trust when the hook resource is deleted', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rdx-runtime-hook-'));
    const trustPath = path.join(userData, 'hook-trust.json');
    const hooks = new HookEngine(trustPath);
    const hookService = new RdxRuntimeService(hooks);
    try {
      hookService.upsert({ kind: 'hook', scope: 'project', projectRoot: project, id: 'verify', content: 'id: verify\nenabled: true\nevent: tool.before-call\ncommand: node\nargs: []\ntimeoutMs: 1000\nfailurePolicy: warn' });
      hooks.load(path.join(home, '.rdx', 'hooks'), project);
      hooks.trustProjectHook(project, 'verify');
      hookService.delete('hook', 'project', 'verify', project);
      expect(JSON.parse(fs.readFileSync(trustPath, 'utf8'))).toEqual({});
    } finally { fs.rmSync(project, { recursive: true, force: true }); }
  });
});
