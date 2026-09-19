import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({
  app: { getPath: () => process.env.TEMP ?? process.cwd(), getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false, decryptString: () => '', encryptString: (v: string) => Buffer.from(v) },
}));
import { createRdxProbeTool, type RdxProbeToolDeps } from './RdxProbeTool';
import { clearRdxContextLeases, getRdxContextLease, setRdxRuntimeContextForSession, grantDelegatedLease, quarantineRdxContext } from '../../sessions/RdxRuntimeContextRegistry';
import type { RdxProbeInput } from '@shared/constants/rdxProbe';
import { compileRdxProbe, RdxProbeInputSchema } from '@shared/constants/rdxProbe';
import type { RdxCliInvokerSettings } from '@shared/types/settings';
import type { RdxTurnBinding } from '../../tools/RdxTurnBindings';
const settings: RdxCliInvokerSettings = {
  enabled: true, command: 'configured-rdx.exe', argsPrefix: [], workingDirectory: '', env: {}, timeoutMs: 1000,
};
const binding = { cli: settings, definitions: [], definitionsFingerprint: '', identity: { contextId: 'ctx', version: 1, ownerSessionId: 's' } } as RdxTurnBinding;
const context = { sessionId: 's', projectId: 'p', workspaceRoot: '.', projectRootPath: '.', rdxBinding: binding };
function own() {
  setRdxRuntimeContextForSession('s', { contextId: 'ctx', runtimeOwner: 'rdc-agent', ownerLeaseId: 'lease-s', backend: 'local', updatedAt: 1 }, { projectId: 'p' });
}
function result(exitCode = 0, body: unknown = { ok: true, result_kind: 'rd.session.get_context', data: { context_id: 'ctx' } }) {
  return { exitCode, stdout: typeof body === 'string' ? body : JSON.stringify(body), stderr: '', duration_ms: 1 };
}
afterEach(clearRdxContextLeases);
describe('native RDX probe', () => {
  it('does not probe or close a parent while delegated execution owns its live context', async () => {
    own();
    grantDelegatedLease({ parentSessionId: 's', childSessionId: 'child', ownerTurnId: 'turn' });
    const executeCli = vi.fn();
    const closeLease = vi.fn();
    const tool = createRdxProbeTool('s', 'p', { executeCli, closeLease });
    for (const action of ['probe', 'lease_close'] as const) {
      expect((await tool.execute('t', { action }, undefined, undefined, context)).isError).toBe(true);
    }
    expect(executeCli).not.toHaveBeenCalled();
    expect(closeLease).not.toHaveBeenCalled();
  });
  it('routes quarantined recovery through the controlled lifecycle, then reads the rebound identity', async () => {
    own();
    quarantineRdxContext('s', getRdxContextLease('s')!.version, 'response lost');
    const openLease = vi.fn(async () => { own(); });
    const executeCli = vi.fn(async () => result());
    const tool = createRdxProbeTool('s', 'p', { openLease, executeCli });
    expect((await tool.execute('t', { action: 'probe' }, undefined, undefined, context)).isError).toBe(true);
    expect(executeCli).not.toHaveBeenCalled();
    expect((await tool.execute('t', { action: 'lease_open', capturePath: '/registered.rdc' }, undefined, undefined, context)).isError).not.toBe(true);
    expect(openLease).toHaveBeenCalledOnce();
    expect(getRdxContextLease('s')?.quarantineReason).toBeUndefined();
  });
  it('signals reprepare after first lease identity allocation and rejects old-turn reads', async () => {
    const initialBinding = { ...binding, identity: null } as RdxTurnBinding;
    const initialContext = { ...context, rdxBinding: initialBinding };
    const openLease = vi.fn(async () => { own(); });
    const executeCli = vi.fn(async () => result());
    const tool = createRdxProbeTool('s', 'p', { openLease, executeCli });
    const opened = await tool.execute('open', { action: 'lease_open', capturePath: '/registered.rdc' }, undefined, undefined, initialContext);
    expect(opened.isError).not.toBe(true);
    expect(opened.details).toMatchObject({ reprepareRequired: true, worldStateStamp: { contextId: 'ctx' } });
    expect(opened.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Prepare a new turn') });
    const staleRead = await tool.execute('read', { action: 'probe' }, undefined, undefined, initialContext);
    expect(staleRead.isError).toBe(true);
    expect(JSON.stringify(staleRead)).toContain('binding changed since prepareTurn');
    expect(executeCli).toHaveBeenCalledTimes(1);
  });
  it('requires a configured frozen binding', async () => {
    expect((await createRdxProbeTool('s', 'p').execute('t', { action: 'doctor' })).isError).toBe(true);
  });
  it('compiles parser-backed commands and passes no application session id', async () => {
    const executeCli = vi.fn<NonNullable<RdxProbeToolDeps['executeCli']>>(async () => result());
    const tool = createRdxProbeTool('s', 'p', { executeCli });
    for (const action of ['doctor', 'version', 'enumerate'] as const) {
      expect((await tool.execute('t', { action }, undefined, undefined, context)).isError).not.toBe(true);
    }
    expect(executeCli.mock.calls.map(([command, args]) => [command, args])).toEqual([
      ['doctor', []], ['version', ['--json']], ['tools', ['list']],
    ]);
    expect(executeCli.mock.calls[0]?.[2]?.settings?.argsPrefix).toEqual([]);
    expect(compileRdxProbe({ action: 'preview_status' }).args).toEqual(['preview', 'status']);
  });
  it.each([
    { action: 'probe', args: { action: 'shader-replace' } },
    { action: 'probe', args: { action: 'context_status', argv: '--evil' } },
    { action: 'probe', args: { action: 'vfs_cat', path: '/resources' } },
    { action: 'probe', args: { action: 'vfs_ls', path: '/../secret' } },
    { action: 'probe', args: { action: 'event_show' } },
    { action: 'doctor', args: { action: 'context_status' } },
  ])('rejects unapproved or unbounded queries: %j', async (input) => {
    const executeCli = vi.fn();
    const r = await createRdxProbeTool('s', 'p', { executeCli }).execute('t', input as RdxProbeInput, undefined, undefined, context);
    expect(r.isError).toBe(true);
    expect(executeCli).not.toHaveBeenCalled();
  });
  it.each([result(2), result(0, ''), result(0, 'RDOC\u0000capture'), result(0, { ok: false }), result(0, { ok: true })])(
    'does not clear ownership after a failed CLI result', async (cli) => {
      own();
      const closeLease = vi.fn();
      const r = await createRdxProbeTool('s', 'p', { executeCli: vi.fn(async () => cli), closeLease })
        .execute('t', { action: 'lease_close' }, undefined, undefined, context);
      expect(r.isError).toBe(true);
      expect(closeLease).not.toHaveBeenCalled();
      expect(getRdxContextLease('s')?.contextId).toBe('ctx');
      expect(JSON.stringify(r)).not.toContain('RDOC');
    },
  );
  it('rejects foreign context and never uses default', async () => {
    own();
    const executeCli = vi.fn();
    const tool = createRdxProbeTool('s', 'p', { executeCli });
    expect((await tool.execute('t', { action: 'probe', contextId: 'foreign' }, undefined, undefined, context)).isError).toBe(true);
    expect(executeCli).not.toHaveBeenCalled();
    clearRdxContextLeases();
    expect((await tool.execute('t', { action: 'probe' }, undefined, undefined, context)).isError).toBe(true);
  });
  it('validates context status before closing the product lifecycle', async () => {
    own();
    const closeLease = vi.fn(async () => { setRdxRuntimeContextForSession('s', null); });
    const executeCli = vi.fn<NonNullable<RdxProbeToolDeps['executeCli']>>(async () => result());
    const r = await createRdxProbeTool('s', 'p', { closeLease, executeCli })
      .execute('t', { action: 'lease_close' }, undefined, undefined, context);
    expect(r.isError).not.toBe(true);
    expect(executeCli).toHaveBeenCalledWith('context', ['status', '--daemon-context', 'ctx'], expect.anything());
    expect(closeLease).toHaveBeenCalledWith('s', 'p', binding, undefined);
    expect(getRdxContextLease('s')).toBeNull();
    expect(r.details).toMatchObject({ reprepareRequired: true, worldStateStamp: { contextId: null } });
  });
  it('rejects a mismatched response or cancellation without clearing a lease', async () => {
    own();
    const closeLease = vi.fn();
    const abort = new AbortController();
    const executeCli = vi.fn(async () => { abort.abort(); return result(); });
    const r = await createRdxProbeTool('s', 'p', { closeLease, executeCli })
      .execute('t', { action: 'lease_close' }, abort.signal, undefined, context);
    expect(r.isError).toBe(true);
    expect(closeLease).not.toHaveBeenCalled();
    const bad = createRdxProbeTool('s', 'p', { executeCli: vi.fn(async () => result(0, { ok: true, result_kind: 'context', data: { context_id: 'other' } })) });
    expect((await bad.execute('t', { action: 'probe' }, undefined, undefined, context)).isError).toBe(true);
  });
  it('requires bounded query args', () => {
    expect(RdxProbeInputSchema.safeParse({ action: 'probe', args: { action: 'event_show', eventId: '42' } }).success).toBe(true);
    expect(compileRdxProbe({ action: 'probe', args: { action: 'event_show', eventId: '42' } })).toMatchObject({ command: 'event', args: ['show', '--event-id', '42'] });
  });
});
