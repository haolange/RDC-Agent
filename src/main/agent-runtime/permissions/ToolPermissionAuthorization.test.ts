import { describe, expect, it, vi } from 'vitest';

const audit = vi.hoisted(() => ({ record: vi.fn() }));
const evaluate = vi.hoisted(() => vi.fn());
vi.mock('../../runtime/AuditLog', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../runtime/AuditLog')>(),
  auditLog: audit,
}));
vi.mock('./AgentPermissionPolicy', () => ({ agentPermissionPolicyService: { evaluate } }));
vi.mock('./AgentToolApprovalRequestService', () => ({ agentToolApprovalRequestService: {} }));

import { AuditWriteFailedError } from '../../runtime/AuditLog';
import { authorizeToolPermission } from './ToolPermissionAuthorization';
import type { RuntimePermissionState } from '@shared/types/runtimePermission';

const input = {
  decision: { toolCall: { type: 'toolCall' as const, id: 'tc-1', name: 'read_file', arguments: { path: 'a.txt' } } },
  assertLive: vi.fn(),
} as unknown as Parameters<typeof authorizeToolPermission>[0];
const state = {} as RuntimePermissionState;

describe('tool permission authorization', () => {
  it('records a policy allow before the tool may run, and refuses the call when that record cannot be written', async () => {
    evaluate.mockReturnValue({ action: 'allow', risk: 'low', temporaryPathRoots: [] });
    await expect(authorizeToolPermission(input, state, new AbortController().signal)).resolves.toMatchObject({ action: 'allow' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'tool-decision', decidedBy: 'policy', approved: true, tool: 'read_file' }));

    audit.record.mockImplementationOnce(() => { throw new AuditWriteFailedError(new Error('disk full')); });
    await expect(authorizeToolPermission(input, state, new AbortController().signal)).rejects.toThrow(/^AUDIT_WRITE_FAILED: /u);
  });
});
