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
  SettingsGetEffectiveCatalogArgsSchema,
  TerminalWriteArgsSchema,
  WorkflowStopArgsSchema,
} from './ipcSchemas';
import { EmptyArgsSchema } from './commonIpcSchemas';
import { ConversationSendMessageArgsSchema } from './conversationSchemas';
import {
  ProjectSelectArgsSchema,
  ProjectInputsImportPathsArgsSchema,
  SessionCreateArgsSchema,
} from './projectSessionSchemas';
import { CaptureOpenProjectInputArgsSchema } from './captureDeviceSchemas';
import { CommandExecuteArgsSchema } from './commandSchemas';
import { KnowledgeGetCardArgsSchema } from './knowledgeSchemas';
import { RdxRuntimeTrustMcpArgsSchema } from './rdxRuntimeSchemas';
import { TraceGetEventsArgsSchema } from './traceSchemas';
import { WebResolveFaviconArgsSchema } from './webSchemas';

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

  it('accepts getEffectiveCatalog with omitted or null accountId', () => {
    const omitted = parseIpcArgs(SettingsGetEffectiveCatalogArgsSchema, ['openai'], {
      label: 'settings:getEffectiveCatalog',
      padTo: 2,
    });
    expect(omitted).toEqual(['openai', undefined]);

    const nulled = parseIpcArgs(SettingsGetEffectiveCatalogArgsSchema, ['openai', null], {
      label: 'settings:getEffectiveCatalog',
      padTo: 2,
    });
    expect(nulled).toEqual(['openai', null]);
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

  it('rejects unexpected args on empty channels', () => {
    expect(() => parseIpcArgs(EmptyArgsSchema, ['surprise'], { label: 'project:list' }))
      .toThrow(IpcValidationError);
  });

  it('rejects invalid project id format', () => {
    expect(() => parseIpcArgs(ProjectSelectArgsSchema, ['../evil'], { label: 'project:select' }))
      .toThrow(IpcValidationError);
  });

  it('normalizes a browser bridge null session title to an omitted title', () => {
    expect(parseIpcArgs(SessionCreateArgsSchema, ['proj_abc123', null], {
      label: 'session:create',
      padTo: 2,
    })).toEqual(['proj_abc123', undefined]);
  });

  it('rejects oversized import path arrays', () => {
    const paths = Array.from({ length: 65 }, (_, i) => `D:/file-${i}.rdc`);
    expect(() => parseIpcArgs(ProjectInputsImportPathsArgsSchema, ['proj_abc', paths], {
      label: 'project:inputs:importPaths',
    })).toThrow(IpcValidationError);
  });

  it('rejects conversation send with self-asserted approved field', () => {
    expect(() => parseIpcArgs(ConversationSendMessageArgsSchema, [{
      requestId: 'request-1',
      mode: 'debugger',
      message: 'hi',
      turnControls: { reasoningLevel: 'medium', maxContextMode: false, fastModel: false },
      approved: true,
    }], { label: 'conversation:sendMessage' })).toThrow(/schema violation|unrecognized|strict/i);
  });

  it('rejects conversation send with invalid mode', () => {
    expect(() => parseIpcArgs(ConversationSendMessageArgsSchema, [{
      requestId: 'request-1',
      mode: 'hacker',
      message: 'hi',
      turnControls: { reasoningLevel: 'medium', maxContextMode: false, fastModel: false },
    }], { label: 'conversation:sendMessage' })).toThrow(IpcValidationError);
  });

  it('rejects capture open payload with path-traversal project id', () => {
    expect(() => parseIpcArgs(CaptureOpenProjectInputArgsSchema, [{
      projectId: '../x',
      sessionId: 'session_a',
      ownerSessionId: null,
      inputId: 'input_a',
      filePath: 'D:/a.rdc',
      replayDeviceId: 'local',
    }], { label: 'capture:openProjectInput' })).toThrow(IpcValidationError);
  });

  it('rejects command execute with empty input', () => {
    expect(() => parseIpcArgs(CommandExecuteArgsSchema, [{ input: '' }], {
      label: 'command:execute',
    })).toThrow(IpcValidationError);
  });

  it('rejects knowledge getCard with empty relativePath', () => {
    expect(() => parseIpcArgs(KnowledgeGetCardArgsSchema, ['user', ''], {
      label: 'knowledge:getCard',
    })).toThrow(IpcValidationError);
  });

  it('rejects rdx-runtime trustMcp with empty descriptorId', () => {
    expect(() => parseIpcArgs(RdxRuntimeTrustMcpArgsSchema, ['D:/proj', ''], {
      label: 'rdx-runtime:trustMcp',
    })).toThrow(IpcValidationError);
  });

  it('rejects trace getEvents with negative afterSeq', () => {
    expect(() => parseIpcArgs(TraceGetEventsArgsSchema, ['run_1', -1], {
      label: 'trace:getEvents',
    })).toThrow(IpcValidationError);
  });

  it('rejects oversized favicon domain', () => {
    expect(() => parseIpcArgs(WebResolveFaviconArgsSchema, ['x'.repeat(300)], {
      label: 'web:resolveFavicon',
    })).toThrow(IpcValidationError);
  });

  it('accepts valid project select id', () => {
    const [projectId] = parseIpcArgs(ProjectSelectArgsSchema, ['proj_ab12cd34'], {
      label: 'project:select',
    });
    expect(projectId).toBe('proj_ab12cd34');
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
