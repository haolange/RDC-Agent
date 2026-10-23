import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { rm } from 'fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.TEMP ?? process.env.TMP ?? process.cwd(),
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    decryptString: () => '',
    encryptString: (value: string) => Buffer.from(value),
  },
}));

vi.mock('../../sessions/RdcRuntimeContextRegistry', () => ({
  assertRdcContextLeaseOwnership: vi.fn(() => null),
  getRdcContextLease: vi.fn(() => null),
  setRdcRuntimeContextForSession: vi.fn(() => null),
}));

vi.mock('../../sessions', () => ({ rdcSessionService: {
  listBindingsForProject: vi.fn(() => []),
  snapshotOpenedCaptureForSession: vi.fn(() => null),
} }));

import { assertRdcContextLeaseOwnership, getRdcContextLease } from '../../sessions/RdcRuntimeContextRegistry';
import { rdcSessionService } from '../../sessions';
import { sessionArtifactResolver } from '../../sessions/SessionArtifactResolver';
import { freezeRdcTurnBinding } from '../../tools/RdcTurnBindings';
import { resolveAgentToolAllowlistFromDefinition } from './DebuggerRuntimePolicy';
import { combineActiveSkillAllowlists, isToolAllowedByFrozenAllowlist } from './DebuggerRuntimePolicy';
import { RuntimeToolAssembly } from './RuntimeToolAssembly';
import { ToolExecutorFactory } from './ToolExecutorFactory';
import type { ResolvedRuntimeTools } from './orchestratorTypes';
import { toolValidator } from '../../agent-runtime/core/ToolValidator';
import { toolToDefinition } from '../../agent-runtime/agent/AgentTool';
import { TaskRegistry, createSessionTaskStore, registerDelegatedTaskScope, resolveSessionTasksDir } from '../../agent-runtime/tasks';
import { TurnHandle } from './TurnCoordinator';
import type { McpConnectionCoordinator } from './McpConnectionCoordinator';
import { agentRuntimeConfigService } from '../../settings/AgentRuntimeConfigService';
import type { SkillLoadResult } from '@shared/types/rdcRuntime';
import { requestSnapshotStore } from '../../agent-runtime/prompt/RequestSnapshotStore';

function createAssembly(): RuntimeToolAssembly {
  return new RuntimeToolAssembly({
    mcp: {
      getConnectedTools: () => [],
      getAgentTools: () => [],
    } as unknown as McpConnectionCoordinator,
    getActiveTurn: () => null,
    getMemoryStore: () => ({}) as never,
    createSubagentTools: () => [],
    getMcpServerStatusSummary: () => [],
  });
}

describe('RuntimeToolAssembly', () => {
  it.each(['debugger', 'analyzer', 'optimizer'] as const)('lets %s read its operation knowledge without execution or workspace edit rights', async (mission) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-planning-knowledge-'));
    const previousHome = process.env.RDC_AGENT_HOME;
    process.env.RDC_AGENT_HOME = root;
    const reads = new Set<string>();
    const context = { workspaceRoot: root, projectRootPath: root, projectId: 'p', sessionId: 's', successfulFileReads: reads };
    try {
      const assembly = createAssembly();
      const index = await assembly.createSkillsCatalogTool(mission).execute('discover', { query: 'rdc' }, undefined, undefined, context);
      expect(index.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text', text: expect.stringContaining(`${mission}-rdc-tools`) })]));
      const tool = assembly.createSkillReadTool(mission);
      const shared = await tool.execute('shared', { skill_id: 'rdc-tool-shell' }, undefined, undefined, context);
      expect(shared.isError).not.toBe(true);
      const page = await tool.execute('method', { skill_id: `${mission}-rdc-tools`, reference: 'references/tools.md', offset: 1, limit: 30 }, undefined, undefined, context);
      const source = path.join(process.cwd(), 'resources/agent-runtime/skills', `${mission}-rdc-tools`, 'references/tools.md');
      expect(page.isError).not.toBe(true);
      expect(page.details).toMatchObject({ skillId: `${mission}-rdc-tools`, scope: 'builtin', reference: {
        sha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex'), truncated: true,
      } });
      const other = mission === 'debugger' ? 'optimizer' : 'debugger';
      const hidden = await tool.execute('other-specialty', { skill_id: `${other}-rdc-tools`, reference: 'references/tools.md' }, undefined, undefined, context);
      expect(hidden.isError).toBe(true);
      expect(reads.size).toBe(0);
      const profile = resolveAgentToolAllowlistFromDefinition(mission, ['read', 'search', 'skill', 'shell', 'interpreter', 'write']);
      for (const declarations of [[], ['*'], ['shell', 'write_file', 'code_interpreter']]) {
        const effective = combineActiveSkillAllowlists(profile, [declarations]) ?? profile;
        for (const forbidden of ['shell', 'write_file', 'edit_file', 'code_interpreter']) {
          expect(isToolAllowedByFrozenAllowlist(forbidden, mission, effective)).toBe(false);
        }
      }
    } finally {
      if (previousHome === undefined) delete process.env.RDC_AGENT_HOME;
      else process.env.RDC_AGENT_HOME = previousHome;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reads a selected effective Skill reference in bounded windows without granting workspace edits', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-skill-reference-'));
    const source = path.join(root, 'SKILL.md');
    fs.mkdirSync(path.join(root, 'references'));
    const bytes = Buffer.from('first\r\nsecond\r\nthird\r\n');
    fs.writeFileSync(path.join(root, 'references', 'tools.md'), bytes);
    fs.writeFileSync(source, '# fixture');
    const load = vi.spyOn(agentRuntimeConfigService, 'loadSkill').mockReturnValue({
      id: 'fixture', name: 'fixture', description: '', instructions: '# fixture', sourcePath: source,
      sourceHash: 'skill-source', scope: 'project', effectiveStatus: 'effective', allowedTools: [],
    } as SkillLoadResult);
    const reads = new Set<string>();
    const context = { workspaceRoot: path.join(root, 'workspace'), projectRootPath: '/project', projectId: 'p', sessionId: 's', successfulFileReads: reads };
    try {
      const tool = createAssembly().createSkillReadTool('general');
      const args = toolValidator.validate(toolToDefinition(tool), { skill_id: 'fixture', reference: 'references/tools.md', offset: 2, limit: 1 });
      const page = await tool.execute('reference', args, undefined, undefined, context);
      expect(page.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('2→second') });
      expect(page.details).toMatchObject({ skillId: 'fixture', sourcePath: source, reference: {
        path: path.join(root, 'references', 'tools.md'), sha256: createHash('sha256').update(bytes).digest('hex'), offset: 2, totalLines: 3, truncated: true,
      } });
      const end = await tool.execute('reference-end', { skill_id: 'fixture', reference: 'references/tools.md', offset: 3, limit: 1 }, undefined, undefined, context);
      expect(end.details).toMatchObject({ reference: { truncated: false, sha256: createHash('sha256').update(bytes).digest('hex') } });
      expect(reads.size).toBe(0);
      expect(load).toHaveBeenCalledWith('fixture', '/project', 'general');
    } finally {
      load.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects Skill reference traversal, absolute paths, binary content and symlink escapes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-skill-reference-'));
    fs.mkdirSync(path.join(root, 'references'));
    fs.mkdirSync(path.join(root, 'outside'));
    fs.writeFileSync(path.join(root, 'outside', 'secret.md'), 'not reference material');
    fs.writeFileSync(path.join(root, 'references', 'binary.md'), Buffer.from([0, 1, 2]));
    fs.symlinkSync(path.join(root, 'outside'), path.join(root, 'references', 'escape'), 'junction');
    const load = vi.spyOn(agentRuntimeConfigService, 'loadSkill').mockReturnValue({
      id: 'fixture', name: 'fixture', description: '', instructions: '# fixture', sourcePath: path.join(root, 'SKILL.md'),
      sourceHash: 'skill-source', scope: 'builtin', effectiveStatus: 'effective', allowedTools: [],
    } as SkillLoadResult);
    try {
      const tool = createAssembly().createSkillReadTool('general');
      for (const reference of ['../outside/secret.md', 'references/../outside/secret.md', path.join(root, 'outside', 'secret.md'), 'scripts/run.py', 'references/secret.md:stream']) {
        await expect(tool.execute('denied', { skill_id: 'fixture', reference })).rejects.toThrow('SKILL_REFERENCE_PATH_DENIED');
      }
      await expect(tool.execute('binary', { skill_id: 'fixture', reference: 'references/binary.md' })).rejects.toThrow(/binary/iu);
      await expect(tool.execute('symlink', { skill_id: 'fixture', reference: 'references/escape/secret.md' })).rejects.toThrow('SYMLINK_PATH_REJECTED');
      await expect(tool.execute('missing', { skill_id: 'fixture', reference: 'references/missing.md' })).rejects.toThrow('ENOENT');
      await expect(tool.execute('window-without-reference', { skill_id: 'fixture', offset: 1 })).rejects.toThrow('SKILL_REFERENCE_REQUIRED');
      const abort = new AbortController();
      abort.abort();
      await expect(tool.execute('cancelled', { skill_id: 'fixture', reference: 'references/binary.md' }, abort.signal)).rejects.toThrow('Aborted');
      const body = await tool.execute('body', { skill_id: 'fixture' });
      expect(body.content).toEqual([{ type: 'text', text: '# fixture' }]);
      load.mockReturnValue(null);
      const hidden = await tool.execute('hidden', { skill_id: 'fixture', reference: 'references/tools.md' });
      expect(hidden.isError).toBe(true);
      expect(hidden.content[0]).toMatchObject({ text: 'Skill is not configured: fixture' });
    } finally {
      load.mockRestore();
      fs.unlinkSync(path.join(root, 'references', 'escape'));
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    { intersection: ['artifact_read', 'tool_search'] },
    { intersection: null },
    { intersection: [] },
  ])('keeps executor discovery on the frozen Skill intersection $intersection', async ({ intersection }) => {
    const assembly = createAssembly();
    let resolved: ResolvedRuntimeTools | undefined;
    const factory = new ToolExecutorFactory({
      slots: { getSlot: () => undefined } as never,
      deferredActivation: {} as never,
      getActiveTurn: () => null,
      resolveRuntimeTools: (...args) => {
        resolved = assembly.resolveRuntimeTools(...args);
        return resolved;
      },
      isAllowedForRuntime: (...args) => assembly.isAllowedForRuntime(...args),
      matchesToolAllowlist: (...args) => assembly.matchesToolAllowlist(...args),
    });
    factory.createToolExecutor('general', ['read_file'], 'session-skill-discovery', {
      effectivePlan: { toolAllowlist: ['*'], skillIntersection: intersection } as never,
    });
    const search = resolved!.toolMap.get('tool_search');
    if (intersection?.length === 0) {
      expect(search).toBeUndefined();
      expect(resolved!.toolMap.size).toBe(0);
      return;
    }
    const denied = await search!.execute('search-file', { query: 'read_file', limit: 1 });
    const allowed = await search!.execute('search-artifact', { query: 'artifact_read', limit: 1 });
    if (intersection) expect(denied.details).toMatchObject({ total: 0, matches: [] });
    else expect(denied.details).toMatchObject({ matches: [{ name: 'read_file' }] });
    expect(allowed.details).toMatchObject({ matches: [{ name: 'artifact_read' }] });
    expect(resolved!.toolMap.has('read_file')).toBe(intersection === null);
  });

  it('validates structured completion through the actual executor schema boundary', async () => {
    const turn = { completionDeclaration: undefined } as unknown as TurnHandle;
    const tool = createAssembly().createTurnCompletionTool(turn);
    const args = {
      disposition: 'completed',
      result: { summary: 'Verified', outputs: { analysis: 'Scoped evidence' }, counterevidence: [], unresolved: [], scope: 'fixture', sideEffects: [], recoveryState: [] },
    };
    const validated = toolValidator.validate(toolToDefinition(tool), args);
    await tool.execute('completion', validated);
    expect(turn.completionDeclaration).toMatchObject(args);
    await expect(tool.execute('invalid-output', toolValidator.validate(toolToDefinition(tool), {
      ...args, result: { ...args.result, outputs: { analysis: { unauthorized: true } } },
    }))).rejects.toThrow('result.outputs values must be strings');
    expect(() => toolValidator.validate(toolToDefinition(tool), {
      ...args, result: { ...args.result, authority: 'expanded' },
    })).toThrow('未声明字段');
  });

  it('returns domain rejection before recording completion so the model can correct its declaration', async () => {
    const turn = { completionDeclaration: undefined } as unknown as TurnHandle;
    const tool = createAssembly().createTurnCompletionTool(turn, async value => {
      await Promise.resolve();
      if (value.disposition === 'completed') throw new Error('REPORT_REQUIRED');
    });
    await expect(tool.execute('wrong-completion', { disposition: 'completed' })).rejects.toThrow('REPORT_REQUIRED');
    expect(turn.completionDeclaration).toBeUndefined();
    await tool.execute('corrected', { disposition: 'partial' });
    expect(turn.completionDeclaration?.disposition).toBe('partial');
  });

  it('rejects turn_complete while a direct Task is running, then accepts it after settlement', async () => {
    const sessionId = `completion-${randomUUID()}`;
    const turn = new TurnHandle({ sessionKey: sessionId, turnId: `turn-${randomUUID()}`, generation: 1 });
    const registry = new TaskRegistry(createSessionTaskStore(sessionId));
    try {
      const task = await registry.createTask('Verify the result');
      const execution = await registry.startExecution(task.id, {
        mode: 'direct', frozenPlanRef: `turn:${turn.turnId}:generation:${turn.generation}`,
      });
      const tool = createAssembly().resolveRuntimeTools('general', ['*'], sessionId, turn).toolMap.get('turn_complete')!;
      await expect(tool.execute('premature', { disposition: 'partial' })).rejects.toThrow(`TASK_COMPLETION_DENIED: Settle direct Tasks before turn_complete with task_update(status=completed or blocked): ${task.id}`);
      expect(turn.completionDeclaration).toBeNull();
      await registry.settleExecution(execution.id, {
        expectedGeneration: execution.generation, status: 'blocked',
        result: { disposition: 'blocked', summary: 'Evidence is insufficient.', outputs: {} },
      });
      await tool.execute('settled', { disposition: 'partial' });
      expect(turn.completionDeclaration?.disposition).toBe('partial');
    } finally {
      await rm(resolveSessionTasksDir(sessionId), { recursive: true, force: true });
    }
  });

  it('createToolSignature sorts tool names', () => {
    const assembly = createAssembly();
    expect(assembly.createToolSignature([
      { name: 'b', description: '', parameters: { type: 'object', properties: {} } },
      { name: 'a', description: '', parameters: { type: 'object', properties: {} } },
    ])).toBe('a|b');
  });

  it('matchesToolAllowlist supports exact, star, and prefix wildcards', () => {
    const assembly = createAssembly();
    expect(assembly.matchesToolAllowlist('read_file', ['*'])).toBe(true);
    expect(assembly.matchesToolAllowlist('read_file', ['read_file'])).toBe(true);
    expect(assembly.matchesToolAllowlist('mcp__x__y', ['mcp__*'])).toBe(true);
    expect(assembly.matchesToolAllowlist('mcp__x__y', ['mcp__x*'])).toBe(true);
    expect(assembly.matchesToolAllowlist('write_file', ['read_file'])).toBe(false);
  });

  it('uses the turn-frozen allowlist for runtime checks and tool assembly', () => {
    const assembly = createAssembly();
    const frozen = ['read_file'];
    expect(assembly.isAllowedForRuntime('ask', 'read_file', frozen)).toBe(true);
    expect(assembly.isAllowedForRuntime('ask', 'write_file', frozen)).toBe(false);
    frozen[0] = 'write_file';
    expect(assembly.isAllowedForRuntime('ask', 'read_file', ['read_file'])).toBe(true);
  });

  it('isAllowedForRuntime denies tools outside the frozen allowlist', () => {
    const assembly = createAssembly();
    expect(assembly.isAllowedForRuntime('ask', 'read_file', ['read_file'])).toBe(true);
    expect(assembly.isAllowedForRuntime('ask', 'read_file', [])).toBe(false);
  });

  it('createAskUserTool rejects empty questions', async () => {
    const assembly = createAssembly();
    const tool = assembly.createAskUserTool('ask');
    const result = await tool.execute('tc-1', { questions: [] });
    expect(result.isError).toBe(true);
    expect(result.details?.questions).toEqual([]);
  });

  it('createRdcContextTool reports missing lease', async () => {
    const assembly = createAssembly();
    const tool = assembly.createRdcContextTool('sess-1', 'proj-1');
    const result = await tool.execute('tc-1', {});
    expect(result.details).toEqual({ available: false, requiresRecovery: false });
    expect(assertRdcContextLeaseOwnership).toHaveBeenCalled();
  });

  it('createRdcContextTool reports controlled recovery for its quarantined capture', async () => {
    vi.mocked(getRdcContextLease).mockReturnValueOnce({
      ownerSessionId: 'sess-1', ownerProjectId: 'proj-1', quarantineReason: 'uncertain native result',
    } as never);
    const result = await createAssembly().createRdcContextTool('sess-1', 'proj-1').execute('tc-1', {});
    expect(result.details).toEqual({ available: false, requiresRecovery: true });
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Close it in Capture') });
    expect(result.content[0]).not.toMatchObject({ text: expect.stringContaining('not open') });
  });

  it('createRdcContextTool does not disclose another project’s retained lease', async () => {
    vi.mocked(getRdcContextLease).mockReturnValueOnce({
      ownerSessionId: 'sess-1', ownerProjectId: 'other-project', quarantineReason: 'uncertain native result',
    } as never);
    const result = await createAssembly().createRdcContextTool('sess-1', 'proj-1').execute('tc-1', {});
    expect(result.details).toEqual({ available: false, requiresRecovery: false });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('not open') });
  });

  it('createRdcContextTool returns runtime context when lease exists', async () => {
    vi.mocked(assertRdcContextLeaseOwnership).mockReturnValueOnce({
      runtimeContext: { capture: 'demo.rdc' },
    } as never);
    const assembly = createAssembly();
    const tool = assembly.createRdcContextTool('sess-1', 'proj-1');
    const result = await tool.execute('tc-1', {});
    expect(result.details).toEqual({ available: true });
    expect(result.content[0]).toMatchObject({ type: 'text' });
  });

  it('passes the actual execution binding to the owning host-control projection', async () => {
    vi.mocked(assertRdcContextLeaseOwnership).mockReturnValueOnce({
      contextId: 'context', version: 4, ownerSessionId: 'sess-1', ownerProjectId: 'proj-1',
      runtimeContext: { contextId: 'context', captureFileId: 'capture', replaySessionId: 'replay' },
    } as never);
    const capacity = vi.spyOn(sessionArtifactResolver, 'getQuotaCapacity').mockReturnValue({
      usage: { diskBytes: 5, reservedBytes: 3, liveBytes: 8,
        diskToolOutputFiles: 1, reservedToolOutputFiles: 1, liveToolOutputFiles: 2 },
      limits: { maxFileBytes: 20, maxImageBytes: 20, maxSessionBytes: 30, maxToolOutputFiles: 3 },
      remaining: { bytes: 22, toolOutputFiles: 1 }, isReservation: false,
    });
    try {
      const result = await createAssembly().createRdcContextTool('sess-1', 'proj-1').execute('controls', {}, undefined, undefined, {
        workspaceRoot: '/project', projectRootPath: '/project', projectId: 'proj-1', sessionId: 'sess-1',
        rdcBinding: freezeRdcTurnBinding({ enabled: true, command: 'private-command', argsPrefix: ['private-entry'],
          workingDirectory: 'private-directory', env: { SECRET: 'private-secret' }, timeoutMs: 20000 }, [], {
          contextId: 'context', version: 4, ownerSessionId: 'sess-1',
        }),
      });
      const body = JSON.parse((result.content[0] as { text: string }).text);
      expect(body.hostControls).toMatchObject({ available: true,
        artifactCapacity: { remaining: { bytes: 22, toolOutputFiles: 1 }, isReservation: false },
        cliProcess: { timeoutMs: 20000, wholeOperationDeadline: false, nativeTerminationGuaranteed: false },
      });
      expect(JSON.stringify(body)).not.toContain('private-');
    } finally { capacity.mockRestore(); }
  });

  it.each([undefined, 'parent-session'])('exposes the main-owned capture byte hash for the matching lease (delegatedFrom=%s)', async (delegatedFrom) => {
    const ownerSession = delegatedFrom ?? 'sess-1';
    const runtimeContext = { contextId: 'ctx', captureFileId: 'cap', replaySessionId: 'replay' };
    vi.mocked(assertRdcContextLeaseOwnership).mockReturnValueOnce({ runtimeContext, delegatedFrom } as never);
    vi.mocked(rdcSessionService.listBindingsForProject).mockReturnValueOnce([{
      scope: { projectId: 'proj-1', sessionId: ownerSession }, phase: 'ready', contextId: 'ctx', captureHash: 'a'.repeat(64),
    }] as never);
    vi.mocked(rdcSessionService.snapshotOpenedCaptureForSession).mockReturnValueOnce({ ...runtimeContext, status: 'open' } as never);
    const result = await createAssembly().createRdcContextTool('sess-1', 'proj-1').execute('hash', {});
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining(`"captureContentSha256": "${'a'.repeat(64)}"`) });
    expect(rdcSessionService.snapshotOpenedCaptureForSession).toHaveBeenLastCalledWith({ projectId: 'proj-1', sessionId: ownerSession });
  });

  it.each(['contextId', 'captureFileId', 'replaySessionId', 'sessionId', 'projectId', 'captureHash', 'phase', 'status'])('does not bind a stale or foreign byte hash (%s)', async (mismatch) => {
    const runtimeContext = { contextId: 'ctx', captureFileId: 'cap', replaySessionId: 'replay' };
    vi.mocked(assertRdcContextLeaseOwnership).mockReturnValueOnce({ runtimeContext } as never);
    vi.mocked(rdcSessionService.listBindingsForProject).mockReturnValueOnce([{
      scope: { projectId: mismatch === 'projectId' ? 'foreign' : 'proj-1', sessionId: mismatch === 'sessionId' ? 'foreign' : 'sess-1' },
      phase: mismatch === 'phase' ? 'opening' : 'ready', contextId: 'ctx', captureHash: mismatch === 'captureHash' ? 'identity-digest' : 'a'.repeat(64),
    }] as never);
    vi.mocked(rdcSessionService.snapshotOpenedCaptureForSession).mockReturnValueOnce({
      ...runtimeContext, status: mismatch === 'status' ? 'error' : 'open', ...(mismatch in runtimeContext ? { [mismatch]: 'foreign' } : {}),
    } as never);
    const result = await createAssembly().createRdcContextTool('sess-1', 'proj-1').execute('hash', {});
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('"captureContentSha256": null') });
  });

  it('createPlanArtifactTool is a fail-closed stub', async () => {
    const assembly = createAssembly();
    const tool = assembly.createPlanArtifactTool('sess-1');
    const result = await tool.execute('tc', { title: 'Plan', summary: ['One'], content: '## Goal\nDo work.' });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('plan review bridge') });
  });

  it('createTaskRuntimeTools uses memory store for subagent sessions', () => {
    const assembly = createAssembly();
    const tools = assembly.createTaskRuntimeTools('parent::subagent::child');
    expect(tools.some((tool) => tool.name.includes('task') || tool.name === 'task_create' || tool.name.length > 0)).toBe(true);
  });

  it('limits a Task-owned child session to a durable descendant subtree', async () => {
    const ownerSessionId = `owner-${Date.now()}`;
    const childSessionId = `${ownerSessionId}::subagent::child`;
    const registry = new TaskRegistry(createSessionTaskStore(ownerSessionId));
    const root = await registry.createTask('Owned root');
    const execution = await registry.startExecution(root.id, { mode: 'subagent' });
    const release = registerDelegatedTaskScope(childSessionId, { ownerSessionId, rootTaskId: root.id, executionId: execution.id, generation: execution.generation });
    const usage = vi.spyOn(requestSnapshotStore, 'readUsage').mockReturnValue({ observedAt: 1, isReservation: false,
      source: 'committed-request-snapshots', scopeId: childSessionId, committedRequests: 2, scopes: [] });
    try {
      const tools = createAssembly().createTaskRuntimeTools(childSessionId);
      const create = tools.find((tool) => tool.name === 'task_create')!;
      const get = tools.find((tool) => tool.name === 'task_get')!;
      const created = await create.execute('create-child', { tasks: [{ subject: 'Child work' }] });
      const childId = (created.details as { ids: string[] }).ids[0]!;
      await expect(registry.getTask(childId)).resolves.toMatchObject({ parentTaskId: root.id });
      const observed = await get.execute('read-child', { taskId: childId });
      expect(observed.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('"committedRequests": 2') });
      expect(usage).toHaveBeenCalledExactlyOnceWith(childSessionId);
      await expect(get.execute('read-root', { taskId: root.id })).rejects.toThrow(/TASK_SCOPE_DENIED/);
      expect(usage).toHaveBeenCalledTimes(1);
      const report = tools.find((tool) => tool.name === 'subagent_report')!;
      await report.execute('report', { kind: 'progress', body: 'Evidence search complete.' });
      await expect(registry.consumeExecutionMessages(execution.id, 0, 'to_parent')).resolves.toMatchObject({ messages: [expect.objectContaining({ body: 'Evidence search complete.' })] });
    } finally {
      usage.mockRestore();
      release();
    }
  });

  it('keeps output publication on General task tokens and drops it for Mission', () => {
    const assembly = createAssembly();
    const handle = new TurnHandle({ sessionKey: 'session-a', turnId: 'turn-a', runId: 'run-a', generation: 1 });
    const general = assembly.resolveRuntimeTools('general', ['task'], 'session-a', handle, 'project-a');
    expect(general.toolMap.has('output_register')).toBe(true);

    const missionAllowlist = resolveAgentToolAllowlistFromDefinition('debugger', ['task']);
    const mission = assembly.resolveRuntimeTools('debugger', missionAllowlist, 'session-a', handle, 'project-a');
    expect(mission.toolMap.has('output_register')).toBe(false);
    expect(mission.toolMap.has('task_create')).toBe(true);
  });

  it('does not assemble agent_handoff', () => {
    const tools = createAssembly().createWorkbenchTools('debugger', 'session-a');
    expect(tools.some((tool) => tool.name === 'agent_handoff')).toBe(false);
  });
});
