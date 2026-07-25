import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  IpcValidationError,
  assertIpcPayloadBytes,
  ipcId,
  parseIpcArgs,
} from './IpcPayloadGuard';
import { IpcApprovalTokenService } from './IpcApprovalTokenService';
import {
  MemoryWriteArgsSchema,
  TerminalWriteArgsSchema,
  WorkflowStopArgsSchema,
} from './ipcSchemas';

describe('parseIpcArgs', () => {
  it('rejects payloads that exceed maxBytes', () => {
    const schema = z.tuple([z.string()]);
    expect(() => parseIpcArgs(schema, ['x'.repeat(100)], { maxBytes: 40, label: 'test' }))
      .toThrow(IpcValidationError);
  });

  it('rejects schema violations for memory write', () => {
    expect(() => parseIpcArgs(MemoryWriteArgsSchema, [{
      scope: 'user',
      approvalToken: 'tok',
      name: 'n',
      description: 'd',
      type: 'project',
      content: 'c',
      approved: true,
    }], { label: 'memory:write' })).toThrow(/schema violation|unrecognized|strict/i);
  });

  it('rejects self-asserted approved field (strict object)', () => {
    try {
      parseIpcArgs(MemoryWriteArgsSchema, [{
        scope: 'user',
        approvalToken: 'tok',
        name: 'n',
        description: 'd',
        type: 'project',
        content: 'c',
        approved: true,
      }]);
      expect.unreachable('should reject');
    } catch (error) {
      expect(error).toBeInstanceOf(IpcValidationError);
    }
  });

  it('rejects oversized terminal write data', () => {
    expect(() => parseIpcArgs(TerminalWriteArgsSchema, ['tab-1', 'y'.repeat(65 * 1024)], {
      label: 'terminal:write',
    })).toThrow(IpcValidationError);
  });

  it('rejects invalid run id format', () => {
    expect(() => parseIpcArgs(WorkflowStopArgsSchema, ['../evil'], { label: 'workflow:stop' }))
      .toThrow(IpcValidationError);
  });

  it('accepts valid workflow stop id', () => {
    const [runId] = parseIpcArgs(WorkflowStopArgsSchema, ['run_ab12cd34'], { label: 'workflow:stop' });
    expect(runId).toBe('run_ab12cd34');
  });

  it('assertIpcPayloadBytes rejects non-serializable values', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => assertIpcPayloadBytes(cyclic, 1024)).toThrow(IpcValidationError);
  });

  it('ipcId rejects path traversal characters', () => {
    expect(ipcId().safeParse('../x').success).toBe(false);
    expect(ipcId().safeParse('run_ok-1').success).toBe(true);
  });
});

describe('IpcApprovalTokenService', () => {
  it('issues single-use tokens that bind action/scope/name', () => {
    const service = new IpcApprovalTokenService(60_000);
    const token = service.issue({
      action: 'memory.write',
      scope: 'user',
      name: 'note',
    });
    expect(service.consume({
      token,
      action: 'memory.write',
      scope: 'user',
      name: 'note',
    })).toBe(true);
    expect(service.consume({
      token,
      action: 'memory.write',
      scope: 'user',
      name: 'note',
    })).toBe(false);
  });

  it('rejects token reused for a different action', () => {
    const service = new IpcApprovalTokenService(60_000);
    const token = service.issue({
      action: 'memory.delete',
      scope: 'project',
      name: 'old',
      projectRoot: 'D:/proj',
    });
    expect(service.consume({
      token,
      action: 'memory.write',
      scope: 'project',
      name: 'old',
      projectRoot: 'D:/proj',
    })).toBe(false);
  });

  it('rejects expired tokens', () => {
    const service = new IpcApprovalTokenService(-1);
    const token = service.issue({ action: 'memory.write', scope: 'user', name: 'n' });
    expect(service.consume({
      token,
      action: 'memory.write',
      scope: 'user',
      name: 'n',
    })).toBe(false);
  });
});
