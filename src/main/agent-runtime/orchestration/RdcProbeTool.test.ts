import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => process.env.TEMP ?? process.cwd(), getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false, decryptString: () => '', encryptString: (v: string) => Buffer.from(v) } }));
import { createRdcProbeTool, type RdcProbeToolDeps } from './RdcProbeTool';
import type { ApprovedCaptureController } from './ApprovedCaptureController';
import { toolToDefinition } from '../agent/AgentTool';
import { ToolValidator } from '../core/ToolValidator';
import { clearRdcContextLeases, getRdcContextLease, setRdcRuntimeContextForSession, grantDelegatedLease, quarantineRdcContext } from '../../rdc/RdcRuntimeContextRegistry';
import { freezeRdcTurnBinding } from '../../rdc/RdcTurnBindings';
import type { RdcProbeInput } from '@shared/constants/rdcProbe';
import { compileRdcProbe, RdcProbeInputSchema } from '@shared/constants/rdcProbe';

const settings = { enabled: true, command: 'configured-rdc-tool.exe', argsPrefix: [], workingDirectory: '', env: {}, timeoutMs: 1000 };
function context() {
  const lease = setRdcRuntimeContextForSession('s', { contextId: 'ctx', runtimeOwner: 'owner', ownerLeaseId: 'lease', backend: 'local',
    replaySessionId: 'replay', captureFileId: 'file', updatedAt: 1 }, { projectId: 'p' })!;
  return { sessionId: 's', projectId: 'p', workspaceRoot: '.', projectRootPath: '.', rdcBinding: freezeRdcTurnBinding(settings, [], lease) };
}
function result(exitCode = 0, body: unknown = { ok: true, result_kind: 'rd.session.get_context', data: { context_id: 'ctx' } }) {
  return { exitCode, stdout: typeof body === 'string' ? body : JSON.stringify(body), stderr: '', duration_ms: 1 };
}
afterEach(clearRdcContextLeases);

describe('native RDC probe', () => {
  it('exposes bounded query and approved capture actions without paths or context overrides', () => {
    const definition = toolToDefinition(createRdcProbeTool('s', 'p'));
    const validator = new ToolValidator();
    for (const input of [{ action: 'enumerate' }, { action: 'probe', args: { action: 'event_list' } },
      { action: 'probe', args: { action: 'event_show', eventId: '1248' } }, { action: 'probe', args: { action: 'pipeline_show' } },
      { action: 'probe', args: { action: 'vfs_ls', path: '/draws' } }, { action: 'capture_select', inputId: 'registered' }, { action: 'capture_restore' }, { action: 'capture_recover' }]) {
      expect(validator.validate(definition, input)).toEqual(input);
    }
    for (const input of [{ action: 'capture_select', capturePath: '/file.rdc' }, { action: 'capture_select' },
      { action: 'probe', contextId: 'foreign', args: { action: 'event_list' } },
      { action: 'probe', args: { action: 'event_show', eventId: '1248', path: '/' } }, { action: 'enumerate', args: { action: 'event_list' } }]) {
      expect(() => validator.validate(definition, input)).toThrow();
    }
    expect(() => compileRdcProbe({ action: 'capture_select', inputId: 'x' })).toThrow('RDC_PROBE_LIFECYCLE');
  });

  it('routes selection only to the main-owned approved General controller', async () => {
    const current = context();
    const select = vi.fn(async () => ({ changed: true, receipt: { uri: 'session://tool-outputs/r.json', expectedHash: `sha256:${'a'.repeat(64)}` },
      current: { inputId: 'b', contentSha256: 'b'.repeat(64), deviceId: 'device', native: { eventId: 9 }, target: null } }));
    const restore = vi.fn(async () => ({ changed: false }));
    const restorationStatus = vi.fn(async () => ({ restored: true,
      original: { inputId: 'a', native: { contextId: 'old', eventId: 42 } },
      current: { inputId: 'a', native: { contextId: 'reopened', eventId: 42 } },
      receipt: { uri: 'session://tool-outputs/baseline.json', expectedHash: `sha256:${'c'.repeat(64)}` } }));
    const recover = vi.fn(async () => ({ changed: true, current: { inputId: 'b', contentSha256: 'b'.repeat(64), deviceId: 'device', native: { eventId: 9 }, target: null } }));
    const captureControl = { select, restore, recover, restorationStatus } as unknown as ApprovedCaptureController;
    const tool = createRdcProbeTool('s', 'p');
    for (const denied of [current, { ...current, agentId: 'general', accessCeiling: 'read-only' as const, turnId: 't', captureControl },
      { ...current, agentId: 'general', accessCeiling: 'full' as const, turnId: 't', captureControl, projectId: 'other' }]) {
      expect((await tool.execute('select', { action: 'capture_select', inputId: 'b' }, undefined, undefined, denied)).isError).toBe(true);
    }
    expect(select).not.toHaveBeenCalled();
    const owning = { ...current, agentId: 'general', accessCeiling: 'full' as const, turnId: 't', captureControl };
    const selected = await tool.execute('select', { action: 'capture_select', inputId: 'b' }, undefined, undefined, owning);
    expect(selected.isError).not.toBe(true);
    expect(selected.details).toMatchObject({ current: { inputId: 'b', eventId: 9 }, changed: true });
    expect(select).toHaveBeenCalledWith('b', undefined);
    const restored = await tool.execute('restore', { action: 'capture_restore' }, undefined, undefined, owning);
    expect(restored.details).toEqual({ action: 'capture_restore', changed: false, restoration: {
      restored: true, original: { inputId: 'a', native: { contextId: 'old', eventId: 42 } },
      current: { inputId: 'a', native: { contextId: 'reopened', eventId: 42 } },
      baselineReceipt: { uri: 'session://tool-outputs/baseline.json', expectedHash: `sha256:${'c'.repeat(64)}` },
      terminalReceiptPending: true,
    } });
    expect(restore).toHaveBeenCalledOnce();
    expect(restorationStatus).toHaveBeenCalledOnce();
    const recovered = await tool.execute('recover', { action: 'capture_recover' }, undefined, undefined, owning);
    expect(recovered.details).toMatchObject({ action: 'capture_recover', changed: true, current: { inputId: 'b' } });
    expect(recover).toHaveBeenCalledOnce();
  });

  it('does not report restoration when the post-restore observation differs or fails', async () => {
    const current = context();
    const restorationStatus = vi.fn(async () => ({ restored: false, original: null, current: { inputId: 'other' },
      receipt: { uri: 'session://tool-outputs/baseline.json', expectedHash: `sha256:${'c'.repeat(64)}` } }));
    const captureControl = { restore: vi.fn(async () => ({ changed: true })), restorationStatus } as unknown as ApprovedCaptureController;
    const owning = { ...current, agentId: 'general', accessCeiling: 'full' as const, turnId: 't', captureControl };
    const tool = createRdcProbeTool('s', 'p');
    const observed = await tool.execute('restore', { action: 'capture_restore' }, undefined, undefined, owning);
    expect(observed.details).toMatchObject({ changed: true, restoration: { restored: false, terminalReceiptPending: true } });
    restorationStatus.mockRejectedValueOnce(new Error('RDC_RESTORE_UNCONFIRMED: cannot observe current position'));
    const failed = await tool.execute('restore-failed', { action: 'capture_restore' }, undefined, undefined, owning);
    expect(failed.isError).toBe(true);
    expect(failed.details).toMatchObject({ code: 'RDC_RESTORE_UNCONFIRMED' });
  });

  it('does not probe the parent while a child holds its lease or while it is quarantined', async () => {
    const current = context(); grantDelegatedLease({ parentSessionId: 's', childSessionId: 'child', ownerTurnId: 'turn' });
    const executeCli = vi.fn();
    const tool = createRdcProbeTool('s', 'p', { executeCli });
    expect((await tool.execute('t', { action: 'probe' }, undefined, undefined, current)).isError).toBe(true);
    expect(executeCli).not.toHaveBeenCalled();
    clearRdcContextLeases(); const next = context(); quarantineRdcContext('s', getRdcContextLease('s')!.version, 'uncertain');
    expect((await tool.execute('t', { action: 'probe' }, undefined, undefined, next)).isError).toBe(true);
    expect(executeCli).not.toHaveBeenCalled();
  });

  it('requires a configured binding and compiles only parser-backed native commands', async () => {
    expect((await createRdcProbeTool('s', 'p').execute('t', { action: 'doctor' })).isError).toBe(true);
    const current = context();
    const executeCli = vi.fn<NonNullable<RdcProbeToolDeps['executeCli']>>(async () => result());
    const tool = createRdcProbeTool('s', 'p', { executeCli });
    for (const action of ['doctor', 'version', 'enumerate'] as const) expect((await tool.execute('t', { action }, undefined, undefined, current)).isError).not.toBe(true);
    expect(executeCli.mock.calls.map(([command, args]) => [command, args])).toEqual([['doctor', []], ['version', ['--json']], ['tools', ['list']]]);
    expect(compileRdcProbe({ action: 'preview_status' }).args).toEqual(['preview', 'status']);
    expect(compileRdcProbe({ action: 'probe', args: { action: 'event_show', eventId: '42' } })).toMatchObject({ command: 'event', args: ['show', '--event-id', '42'] });
  });

  it.each([
    { action: 'probe', args: { action: 'shader-replace' } }, { action: 'probe', args: { action: 'context_status', argv: '--evil' } },
    { action: 'probe', args: { action: 'vfs_cat', path: '/resources' } }, { action: 'probe', args: { action: 'vfs_ls', path: '/../secret' } },
    { action: 'probe', args: { action: 'event_show' } }, { action: 'doctor', args: { action: 'context_status' } },
    { action: 'capture_select', inputId: '' }, { action: 'lease_open', capturePath: '/file.rdc' },
  ])('rejects an invalid or unbounded request: %j', async input => {
    const executeCli = vi.fn();
    const response = await createRdcProbeTool('s', 'p', { executeCli }).execute('t', input as RdcProbeInput, undefined, undefined, context());
    expect(response.isError).toBe(true); expect(executeCli).not.toHaveBeenCalled();
  });

  it.each([result(2), result(0, ''), result(0, 'RDOC\u0000capture'), result(0, { ok: false }), result(0, { ok: true })])(
    'never treats malformed native output as success', async cli => {
      const response = await createRdcProbeTool('s', 'p', { executeCli: vi.fn(async () => cli) }).execute('t', { action: 'probe' }, undefined, undefined, context());
      expect(response.isError).toBe(true); expect(JSON.stringify(response)).not.toContain('RDOC');
    });

  it('rejects stale bindings, foreign responses, and cancellation without mutating ownership', async () => {
    const old = context(); context();
    const executeCli = vi.fn(async () => result());
    const tool = createRdcProbeTool('s', 'p', { executeCli });
    expect((await tool.execute('t', { action: 'probe' }, undefined, undefined, old)).isError).toBe(true);
    expect(executeCli).not.toHaveBeenCalled();
    const current = context();
    const bad = createRdcProbeTool('s', 'p', { executeCli: vi.fn(async () => result(0, { ok: true, result_kind: 'context', data: { context_id: 'other' } })) });
    expect((await bad.execute('t', { action: 'probe' }, undefined, undefined, current)).isError).toBe(true);
    const abort = new AbortController(); abort.abort();
    expect((await tool.execute('t', { action: 'probe' }, abort.signal, undefined, current)).isError).toBe(true);
    expect(getRdcContextLease('s')?.contextId).toBe('ctx');
  });

  it('pages and searches the event tree through read-only catalog operations bound to the owned replay', async () => {
    expect(compileRdcProbe({ action: 'probe', args: { action: 'event_list', offset: 256, limit: 100, maxDepth: 2, nameContains: 'Eye' } }, 'replay'))
      .toEqual({ command: 'call', operation: 'rd.event.get_action_tree', needsContext: true, args: ['rd.event.get_action_tree', '--args-json',
        JSON.stringify({ session_id: 'replay', offset: 256, limit: 100, max_depth: 2, filter: { name_contains: 'Eye' } })] });
    expect(compileRdcProbe({ action: 'probe', args: { action: 'event_search', eventIdMin: 300, eventIdMax: 500, flagsInclude: ['Drawcall'] } }, 'replay').args)
      .toEqual(['rd.event.search_actions', '--args-json', JSON.stringify({ session_id: 'replay', query: { event_id_min: 300, event_id_max: 500, flags_include: ['Drawcall'] } })]);
    expect(() => compileRdcProbe({ action: 'probe', args: { action: 'event_list' } })).toThrow('RDC_PROBE_OWNER');
    for (const args of [{ action: 'event_show', eventId: '1', offset: 2 }, { action: 'event_list', flagsInclude: ['Drawcall'] },
      { action: 'event_search' }, { action: 'event_search', nameContains: 'x', path: '/' }]) {
      expect(RdcProbeInputSchema.safeParse({ action: 'probe', args }).success, JSON.stringify(args)).toBe(false);
    }

    const tree = { ok: true, result_kind: 'rd.event.get_action_tree',
      data: { session_id: 'replay', nodes: Array.from({ length: 400 }, (_, id) => ({ event_id: id, name: 'vkCmdDrawIndexed'.repeat(4) })),
        pagination: { total_root_count: 592, truncated: true } } };
    const executeCli = vi.fn(async () => result(0, tree));
    const listed = await createRdcProbeTool('s', 'p', { executeCli }).execute('t', { action: 'probe', args: { action: 'event_list', limit: 400 } }, undefined, undefined, context());
    expect(listed.isError).not.toBe(true);
    expect(executeCli).toHaveBeenCalledWith('call', ['rd.event.get_action_tree', '--args-json', JSON.stringify({ session_id: 'replay', limit: 400 }),
      '--daemon-context', 'ctx'], expect.anything());
    const text = (listed.content[0] as { text: string }).text;
    expect(text.length).toBeGreaterThan(16 * 1024);
    expect(JSON.parse(text)).toEqual(tree);

    for (const foreign of [{ ...tree, result_kind: 'rd.event.search_actions' }, { ...tree, data: { ...tree.data, session_id: 'other' } }]) {
      const rejected = await createRdcProbeTool('s', 'p', { executeCli: vi.fn(async () => result(0, foreign)) })
        .execute('t', { action: 'probe', args: { action: 'event_list' } }, undefined, undefined, context());
      expect(rejected.isError).toBe(true);
    }
  });

  it('treats empty optional query values as omission while requiring specific event identities', async () => {
    const request = { action: 'probe', args: { action: 'event_show', eventId: '1248', path: '' } } as const;
    expect(RdcProbeInputSchema.parse(request)).toEqual({ action: 'probe', args: { action: 'event_show', eventId: '1248' } });
    expect(RdcProbeInputSchema.safeParse({ action: 'probe', args: { action: 'event_show', eventId: '' } }).success).toBe(false);
    expect(RdcProbeInputSchema.safeParse({ action: 'probe', args: { action: 'event_show', eventId: '1248', path: '/secret' } }).success).toBe(false);
    const executeCli = vi.fn(async () => result());
    const response = await createRdcProbeTool('s', 'p', { executeCli }).execute('t', request, undefined, undefined, context());
    expect(response.isError).not.toBe(true);
    expect(executeCli).toHaveBeenCalledWith('event', ['show', '--event-id', '1248', '--daemon-context', 'ctx'], expect.anything());
  });
});
