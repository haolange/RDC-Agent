import { describe, expect, it } from 'vitest';
import type { ToolExecutionContext } from '../agent-runtime/agent/AgentTool';
import type { RdxOperationDefinition } from '@shared/types/tool';
import { authorizeRdxOperation, validateRdxArguments } from './RdxOperationPolicy';
import { freezeRdxTurnBinding } from './RdxTurnBindings';
const cli = { enabled: true, command: 'rdx', argsPrefix: [], workingDirectory: '', env: {}, timeoutMs: 30000 };
function definition(patch: Partial<RdxOperationDefinition> = {}): RdxOperationDefinition { return {
  name: 'rd.texture.query', namespace: 'texture', description: '', scope: 'replay', effects: [], evidence_kind: null, path_inputs: [], prerequisites: [],
  input_schema: { type: 'object', properties: { session_id: { type: 'string' }, filter: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' } } } }, required: ['session_id'], additionalProperties: false }, ...patch,
}; }
function context(item: RdxOperationDefinition): ToolExecutionContext { return { workspaceRoot: process.cwd(), projectRootPath: process.cwd(), projectId: 'project', sessionId: 'session', rdxBinding: freezeRdxTurnBinding(cli, [item]) }; }
describe('capability execution policy', () => {
  it('accepts a discovered texture query beyond the removed six-domain restriction', () => {
    const item = definition(); expect(authorizeRdxOperation(item.name, {}, context(item), 'replay').args).toEqual({ session_id: 'replay' });
  });
  it.each(['unknown', 'lifecycle', 'global_config', 'artifact_delete', 'desktop_window', 'remote_control'])('rejects effect %s before invocation', effect => {
    const item = definition({ effects: [effect] }); expect(() => authorizeRdxOperation(item.name, {}, context(item), 'replay')).toThrow(/DENIED/);
  });
  it.each([{ filter: { name: 3 } }, { filter: { invented: true } }, { filter: { context_id: 'foreign' } }, { invented: true }])('rejects nested or unknown args %j', args => {
    const item = definition(); expect(() => authorizeRdxOperation(item.name, args, context(item), 'replay')).toThrow(/DENIED/);
  });
  it('does not inject replay identity into context/global operations', () => {
    for (const scope of ['context', 'global'] as const) { const item = definition({ scope, input_schema: { type: 'object', properties: {}, additionalProperties: false } }); expect(authorizeRdxOperation(item.name, {}, context(item), 'replay').args).toEqual({}); }
  });
  it('restricts context updates to user fields', () => {
    const item = definition({ scope: 'context', effects: ['context_metadata'], input_schema: { type: 'object', properties: { key: { type: 'string' }, value: {} }, required: ['key'], additionalProperties: false } });
    expect(authorizeRdxOperation(item.name, { key: 'notes', value: 'observed' }, context(item), 'replay').args.key).toBe('notes');
    expect(() => authorizeRdxOperation(item.name, { key: 'active_event_id', value: 9 }, context(item), 'replay')).toThrow(/application-owned/);
  });
  it('rejects paths outside the owning workspace', () => {
    const item = definition({ input_schema: { type: 'object', properties: { session_id: { type: 'string' }, output_path: { type: 'string' } }, additionalProperties: false }, path_inputs: [{ name: 'output_path', access: 'write' }] });
    expect(() => authorizeRdxOperation(item.name, { output_path: '../outside.png' }, context(item), 'replay')).toThrow();
  });
  it('rejects unknown prerequisites and virtual traversal', () => {
    const item = definition({ prerequisites: [{ requires: 'anything' }] }); expect(() => authorizeRdxOperation(item.name, {}, context(item), 'replay')).toThrow(/prerequisite/);
    const vfs = definition({ name: 'rd.vfs.cat', namespace: 'vfs', scope: 'global', input_schema: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: false } });
    expect(() => authorizeRdxOperation(vfs.name, { path: '/textures/../context' }, context(vfs), 'replay')).toThrow(/virtual/);
  });
});


it('injects the owning capture and rejects user identity overrides', () => {
  const item = definition({ name: 'rd.capture.get_thumbnail', namespace: 'capture', scope: 'capture',
    prerequisites: [{ requires: 'capture_file_id' }],
    input_schema: { type: 'object', properties: { capture_file_id: { type: 'string' } }, required: ['capture_file_id'], additionalProperties: false } });
  expect(authorizeRdxOperation(item.name, {}, context(item), 'replay', 'owned-capture').args).toEqual({ capture_file_id: 'owned-capture' });
  expect(() => authorizeRdxOperation(item.name, {}, context(item), 'replay')).toThrow(/identity/);
  expect(() => authorizeRdxOperation(item.name, { capture_file_id: 'foreign' }, context(item), 'replay', 'owned-capture')).toThrow(/main-owned/);
});
it('enforces exclusive selectors, timepoint conflicts and array budgets', () => {
  const schema = { type: 'object', oneOf: [{ required: ['event_id'], not: { required: ['chunk_indices'] } }, { required: ['chunk_indices'], not: { required: ['event_id'] } }], properties: { event_id: { type: 'integer' }, chunk_indices: { type: 'array', maxItems: 2, minItems: 1, items: { type: 'integer' } } } };
  expect(() => validateRdxArguments({ event_id: 4 }, schema)).not.toThrow();
  for (const value of [{}, { event_id: 4, chunk_indices: [1] }, { chunk_indices: [] }, { chunk_indices: [1, 2, 3] }]) expect(() => validateRdxArguments(value, schema)).toThrow(/DENIED/);
  const timepoint = { not: { required: ['state', 'event_id'], properties: { state: { enum: ['capture_initial'] } } } };
  expect(() => validateRdxArguments({ state: 'capture_initial', event_id: 4 }, timepoint)).toThrow(/DENIED/);
  expect(() => validateRdxArguments({ state: 'current', event_id: 4 }, timepoint)).not.toThrow();
});
