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
import { AuditWriteFailedError } from '../runtime/AuditLog';
import { installIpcInvokeRegistry, invokeRegisteredIpcChannel } from './invokeRegistry';

describe('high-impact IPC audit', () => {
  it('records the request before the handler and refuses the call when the record cannot be written', async () => {
    installIpcInvokeRegistry();
    const handler = vi.fn(() => 'done');
    ipcMain.handle('conversation:answerToolApproval', handler);

    audit.record.mockImplementationOnce(() => { throw new AuditWriteFailedError(new Error('disk full')); });
    await expect(invokeRegisteredIpcChannel('conversation:answerToolApproval', [{}])).rejects.toThrow(/^AUDIT_WRITE_FAILED: /u);
    expect(handler).not.toHaveBeenCalled();

    audit.record.mockReset();
    await expect(invokeRegisteredIpcChannel('conversation:answerToolApproval', [{}])).resolves.toBe('done');
    expect(audit.record.mock.calls.map(([event]) => event.outcome)).toEqual(['requested', 'ok']);
  });
});
