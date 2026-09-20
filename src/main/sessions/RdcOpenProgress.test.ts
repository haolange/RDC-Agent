import { expect, it, vi } from 'vitest';
import type { RdcCliInvokerSettings } from '@shared/types/settings';
const execute = vi.hoisted(() => vi.fn());
vi.mock('../tools/RdcCliInvokerService', () => ({ rdcCliInvokerService: { executeCLI: execute } }));
import { withRdcOpenProgress } from './RdcOpenProgress';
const cli = { command: 'rdc', enabled: true, argsPrefix: [] } as unknown as RdcCliInvokerSettings;
it.each(['context', 'foreign'])('only forwards real transfer progress from owning %s daemon', async identity => {
  execute.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ ok: true, result_kind: 'rdc_tool.daemon.status',
    data: { state: { context_id: identity, active_operation: { stage: 'capture_transfer_progress' } } } }) });
  const stages = vi.fn(); let release!: () => void;
  const running = withRdcOpenProgress('context', cli, stages, () => new Promise<void>(resolve => { release = resolve; }));
  await Promise.resolve(); await Promise.resolve();
  release(); await running;
  if (identity === 'context') expect(stages).toHaveBeenCalledWith('transferring');
  else expect(stages).not.toHaveBeenCalled();
  expect(execute).toHaveBeenLastCalledWith('daemon', ['status', '--daemon-context', 'context'], expect.objectContaining({ settings: expect.objectContaining({ command: 'rdc' }) }));
});
it('does not invent progress from unavailable status and closes its poll on action failure', async () => {
  execute.mockRejectedValue(new Error('status unavailable'));
  const stages = vi.fn();
  await expect(withRdcOpenProgress('context', cli, stages, async () => { throw new Error('open failed'); })).rejects.toThrow('open failed');
  expect(stages).not.toHaveBeenCalled();
});
