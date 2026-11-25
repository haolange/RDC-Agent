import { describe, expect, it } from 'vitest';
import { IpcValidationError, parseIpcArgs } from './IpcPayloadGuard';
import {
  KnowledgeCancelArgsSchema,
  KnowledgeCandidateCreateArgsSchema,
  KnowledgeCardArgsSchema,
  KnowledgeExportArgsSchema,
  KnowledgeIndexRebuildArgsSchema,
  KnowledgeImageArgsSchema,
  KnowledgeImportArgsSchema,
  KnowledgeCompileArgsSchema,
  KnowledgePromoteArgsSchema,
  KnowledgeQueryArgsSchema,
  KnowledgeWriteArgsSchema,
  KnowledgeTopicApplyArgsSchema,
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
  it('requires explicit confirmation for topic changes', () => {
    const changes = { expectedRevision: 'a'.repeat(64), expectedCorpusRevision: 'b'.repeat(64), topics: [], assignments: [] };
    expect(() => parseIpcArgs(KnowledgeTopicApplyArgsSchema, [{ changes, changeHash: 'c'.repeat(64), confirmation: { explicitHumanConfirmation: false } }], { label: 'topics' })).toThrow(IpcValidationError);
  });
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

  it('rejects import without source or filePath', () => {
    expect(() => parseIpcArgs(KnowledgeImportArgsSchema, [{
      spaceId: 'user',
      sessionId: 'session_a',
    }], { label: 'knowledge:import' })).toThrow(IpcValidationError);
  });

  it('rejects import without a target spaceId', () => {
    expect(() => parseIpcArgs(KnowledgeImportArgsSchema, [{
      source: 'case_id: a\ntitle: A\nsymptoms: darker',
    }], { label: 'knowledge:import' })).toThrow(IpcValidationError);
  });

  it('accepts import with spaceId and source and no sessionId', () => {
    const [request] = parseIpcArgs(KnowledgeImportArgsSchema, [{
      spaceId: 'user',
      source: 'case_id: a\ntitle: A\nsymptoms: darker',
      operationId: 'op-1',
    }], { label: 'knowledge:import', maxBytes: 16 * 1024 });
    expect(request.spaceId).toBe('user');
    expect(request.sessionId).toBeUndefined();
  });

  it('runs import, export and rebuild only under a well-formed operation id, which cancel names too', () => {
    const source = 'case_id: a\ntitle: A\nsymptoms: darker';
    expect(() => parseIpcArgs(KnowledgeImportArgsSchema, [{ spaceId: 'user', source }], { label: 'knowledge:import' }))
      .toThrow(IpcValidationError);
    expect(() => parseIpcArgs(KnowledgeExportArgsSchema, [{ format: 'markdown', scope: 'space', spaceId: 'user' }],
      { label: 'knowledge:export' })).toThrow(IpcValidationError);
    expect(() => parseIpcArgs(KnowledgeIndexRebuildArgsSchema, [], { label: 'knowledge:index:rebuild' })).toThrow(IpcValidationError);
    expect(() => parseIpcArgs(KnowledgeCancelArgsSchema, [{ operationId: '../op' }], { label: 'knowledge:cancel' }))
      .toThrow(IpcValidationError);
    const operationId = '7d0c0c56-5b1e-4f7a-9c1e-2f4d1f0b9a11';
    expect(parseIpcArgs(KnowledgeIndexRebuildArgsSchema, [{ operationId }], { label: 'knowledge:index:rebuild' })).toEqual([{ operationId }]);
    expect(parseIpcArgs(KnowledgeCancelArgsSchema, [{ operationId }], { label: 'knowledge:cancel' })).toEqual([{ operationId }]);
    expect(parseIpcArgs(KnowledgeExportArgsSchema, [{ format: 'markdown', scope: 'space', spaceId: 'user', operationId }],
      { label: 'knowledge:export' })[0].operationId).toBe(operationId);
  });

  it('rejects knowledge image lookup with empty relativePath', () => {
    expect(() => parseIpcArgs(KnowledgeImageArgsSchema, [{
      spaceId: 'user',
      relativePath: '',
    }], { label: 'knowledge:image' })).toThrow(IpcValidationError);
  });

  it('rejects card lookup with empty relativePath', () => {
    expect(() => parseIpcArgs(KnowledgeCardArgsSchema, ['user', ''], {
      label: 'knowledge:card',
    })).toThrow(IpcValidationError);
  });
});
