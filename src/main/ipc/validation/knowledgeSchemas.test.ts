import { describe, expect, it } from 'vitest';
import { IpcValidationError, parseIpcArgs } from './IpcPayloadGuard';
import {
  KnowledgeCandidateCreateArgsSchema,
  KnowledgeCardArgsSchema,
  KnowledgeColdDataImportArgsSchema,
  KnowledgeCompileArgsSchema,
  KnowledgePromoteArgsSchema,
  KnowledgeQueryArgsSchema,
  KnowledgeWriteArgsSchema,
} from './knowledgeSchemas';

const card = {
  cardId: 'user:facts/sample.md',
  spaceId: 'user',
  relativePath: 'facts/sample.md',
  type: 'fact' as const,
  lifecycle: 'draft' as const,
  title: 'Sample',
  scope: {},
  relations: [],
  body: 'Body',
};

describe('knowledge IPC schemas', () => {
  it('accepts knowledge query with space ids and text', () => {
    const [request] = parseIpcArgs(KnowledgeQueryArgsSchema, [{
      spaceIds: ['user', 'project:demo'],
      text: 'vulkan',
      lanes: ['Lexical'],
    }], { label: 'knowledge:query', maxBytes: 16 * 1024 });
    expect(request.text).toBe('vulkan');
  });

  it('rejects knowledge compile limit above 50', () => {
    expect(() => parseIpcArgs(KnowledgeCompileArgsSchema, [{ limit: 51 }], {
      label: 'knowledge:compile',
    })).toThrow(IpcValidationError);
  });

  it('rejects write without explicit human confirmation', () => {
    expect(() => parseIpcArgs(KnowledgeWriteArgsSchema, [{
      spaceId: 'user',
      card,
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: false },
      approvalToken: 'tok',
    }], { label: 'knowledge:write' })).toThrow(IpcValidationError);
  });

  it('rejects write without approvalToken', () => {
    expect(() => parseIpcArgs(KnowledgeWriteArgsSchema, [{
      spaceId: 'user',
      card,
      permissionMode: 'default',
      confirmation: { explicitHumanConfirmation: true },
    }], { label: 'knowledge:write' })).toThrow(IpcValidationError);
  });

  it('rejects promote without confirmation', () => {
    expect(() => parseIpcArgs(KnowledgePromoteArgsSchema, [{
      spaceId: 'user',
      card,
      to: 'verified',
      permissionMode: 'default',
    }], { label: 'knowledge:promote' })).toThrow(IpcValidationError);
  });

  it('rejects candidateCreate when explicitUserIntent is missing', () => {
    expect(() => parseIpcArgs(KnowledgeCandidateCreateArgsSchema, [{
      sessionId: 'session_a',
      card,
    }], { label: 'knowledge:candidateCreate' })).toThrow(IpcValidationError);
  });

  it('rejects coldDataImport without source or filePath', () => {
    expect(() => parseIpcArgs(KnowledgeColdDataImportArgsSchema, [{
      sessionId: 'session_a',
    }], { label: 'knowledge:coldDataImport' })).toThrow(IpcValidationError);
  });

  it('rejects card lookup with empty relativePath', () => {
    expect(() => parseIpcArgs(KnowledgeCardArgsSchema, ['user', ''], {
      label: 'knowledge:card',
    })).toThrow(IpcValidationError);
  });
});
