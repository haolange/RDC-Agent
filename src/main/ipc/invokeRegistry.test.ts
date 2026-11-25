import { describe, expect, it, vi } from 'vitest';

const audit = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
}));
vi.mock('../runtime/AuditLog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../runtime/AuditLog')>()),
  auditLog: audit,
}));

import { ipcMain } from 'electron';
import { AppError, IPC_ERROR_KEY } from '@shared/errors/appError';
import { AuditWriteFailedError } from '../runtime/AuditLog';
import { installIpcInvokeRegistry, invokeRegisteredIpcChannel } from './invokeRegistry';

installIpcInvokeRegistry();

describe('IPC dispatch', () => {
  it('records the request before the handler and refuses the call when the record cannot be written', async () => {
    const handler = vi.fn(() => 'done');
    ipcMain.handle('conversation:answerToolApproval', handler);

    audit.record.mockImplementationOnce(() => { throw new AuditWriteFailedError(new Error('disk full')); });
    await expect(invokeRegisteredIpcChannel('conversation:answerToolApproval', [{}])).resolves.toMatchObject({
      [IPC_ERROR_KEY]: { code: 'AUDIT_WRITE_FAILED', category: 'security' },
    });
    expect(handler).not.toHaveBeenCalled();

    audit.record.mockReset();
    await expect(invokeRegisteredIpcChannel('conversation:answerToolApproval', [{}])).resolves.toBe('done');
    expect(audit.record.mock.calls.map(([event]) => event.outcome)).toEqual(['requested', 'ok']);
  });

  it('returns a failure as its code, params and class, and audits the code', async () => {
    ipcMain.handle('conversation:answerToolApproval', () => {
      throw new AppError('PLAN_REVIEW_BUSY', 'another review is open', { params: { reviews: 2 } });
    });
    audit.record.mockReset();

    await expect(invokeRegisteredIpcChannel('conversation:answerToolApproval', [{}])).resolves.toEqual({
      [IPC_ERROR_KEY]: {
        code: 'PLAN_REVIEW_BUSY',
        params: { reviews: 2 },
        category: 'availability',
        technical: 'PLAN_REVIEW_BUSY: another review is open',
      },
    });
    expect(audit.record.mock.calls.at(-1)?.[0]).toMatchObject({ outcome: 'error', errorCode: 'PLAN_REVIEW_BUSY' });
  });

  it('reports an uncoded failure as INTERNAL_ERROR with credential-like text redacted', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    ipcMain.handle('session:list', () => { throw new TypeError('request failed with Authorization: Bearer fixture-bearer-value-0000'); });

    const result = await invokeRegisteredIpcChannel('session:list', []) as Record<string, { code: string; technical: string }>;
    expect(result[IPC_ERROR_KEY]?.code).toBe('INTERNAL_ERROR');
    expect(result[IPC_ERROR_KEY]?.technical).not.toContain('fixture-bearer-value-0000');
    stderr.mockRestore();
  });
});
