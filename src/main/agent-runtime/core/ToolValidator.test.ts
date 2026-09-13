import { describe, expect, it } from 'vitest';
import { ToolValidationError, ToolValidator } from './ToolValidator';
import type { ToolDefinition } from './types';
import { toolToDefinition } from '../agent/AgentTool';
import { getPrimitiveTools, createToolSearchTool } from '../tools';

const validator = new ToolValidator();

function def(parameters: ToolDefinition['parameters'], name = 'demo'): ToolDefinition {
  return { name, description: 'demo', parameters };
}

describe('ToolValidator', () => {
  it('enforces command/rdx exclusive schema modes before dispatch', () => {
    const tool = def({ type: 'object', properties: { command: { type: 'string' }, rdx: { type: 'object' } },
      oneOf: [{ required: ['command'], not: { required: ['rdx'] } }, { required: ['rdx'], not: { required: ['command'] } }] });
    expect(validator.validate(tool, { command: 'echo ok' })).toEqual({ command: 'echo ok' });
    expect(validator.validate(tool, { rdx: {} })).toEqual({ rdx: {} });
    for (const args of [{}, { command: 'echo ok', rdx: {} }, { command: true }]) {
      expect(() => validator.validate(tool, args)).toThrow(ToolValidationError);
    }
    expect(() => validator.validate(def({ oneOf: [] }), {})).toThrow();
    expect(() => validator.validate(def({ oneOf: [{ unsupported: true }] }), {})).toThrow();
  });

  it('accepts valid object args and coerces non-safe string numbers', () => {
    const result = validator.validate(
      def({
        type: 'object',
        required: ['count'],
        properties: {
          count: { type: 'integer' },
          label: { type: 'string' },
        },
      }),
      { count: '3', label: true },
    );
    expect(result).toEqual({ count: 3, label: 'true' });
  });

  it('rejects missing required fields', () => {
    expect(() => validator.validate(
      def({ type: 'object', required: ['path'], properties: { path: { type: 'string' } } }),
      {},
    )).toThrow(ToolValidationError);
  });

  it('enforces minLength/maxLength/pattern', () => {
    const tool = def({
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 4, pattern: '^[a-z]+$' },
      },
    });
    expect(validator.validate(tool, { name: 'ab' })).toEqual({ name: 'ab' });
    expect(() => validator.validate(tool, { name: 'a' })).toThrow(/不得小于 2/);
    expect(() => validator.validate(tool, { name: 'abcde' })).toThrow(/不得大于 4/);
    expect(() => validator.validate(tool, { name: 'A1' })).toThrow(/pattern/);
  });

  it('enforces minItems/maxItems', () => {
    const tool = def({
      type: 'object',
      properties: {
        items: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' } },
      },
    });
    expect(validator.validate(tool, { items: ['a'] })).toEqual({ items: ['a'] });
    expect(() => validator.validate(tool, { items: [] })).toThrow(/不得小于 1/);
    expect(() => validator.validate(tool, { items: ['a', 'b', 'c'] })).toThrow(/不得大于 2/);
  });

  it('does not coerce safe path/command/url parameters', () => {
    expect(() => validator.validate(
      def({
        type: 'object',
        properties: {
          path: { type: 'string' },
          command: { type: 'string' },
          url: { type: 'string' },
        },
      }),
      { path: 12, command: true, url: 1 },
    )).toThrow(/期望 string/);

    expect(validator.validate(
      def({
        type: 'object',
        properties: {
          path: { type: 'string' },
          command: { type: 'string' },
          url: { type: 'string' },
        },
      }),
      { path: '/tmp/a', command: 'ls', url: 'https://example.test' },
    )).toEqual({ path: '/tmp/a', command: 'ls', url: 'https://example.test' });
  });

  it('rejects undeclared fields by default', () => {
    expect(() => validator.validate(
      def({
        type: 'object',
        properties: { name: { type: 'string' } },
      }),
      { name: 'ok', extra: true },
    )).toThrow(/未声明字段/);
  });

  it('passes through opaque objects when properties is omitted', () => {
    const result = validator.validate(
      def({
        type: 'object',
        required: ['kind', 'record'],
        properties: {
          kind: { type: 'string' },
          record: { type: 'object' },
        },
      }),
      { kind: 'evidence', record: { evidenceId: 'ev-1', summary: 'observed' } },
    );
    expect(result).toEqual({
      kind: 'evidence',
      record: { evidenceId: 'ev-1', summary: 'observed' },
    });
  });

  it('still rejects every key when properties is an empty object', () => {
    expect(() => validator.validate(
      def({
        type: 'object',
        properties: {
          record: { type: 'object', properties: {} },
        },
      }),
      { record: { evidenceId: 'ev-1' } },
    )).toThrow(/未声明字段/);
  });

  it('rejects unsupported schema keywords at compile time', () => {
    expect(() => validator.validate(
      def({
        type: 'object',
        properties: {
          mode: { anyOf: [{ type: 'string' }, { type: 'number' }] } as never,
        },
      }),
      { mode: 'a' },
    )).toThrow(/不支持的 schema 关键字/);
  });

  it('rejects keywords outside the closed supported subset', () => {
    const unsupported = [
      'exclusiveMinimum',
      'exclusiveMaximum',
      'multipleOf',
      'minProperties',
      'maxProperties',
      'uniqueItems',
      'format',
      '$id',
    ];
    for (const key of unsupported) {
      expect(() => validator.validate(
        def({
          type: 'object',
          properties: {
            n: { type: 'number', [key]: 1 } as never,
          },
        }),
        { n: 1 },
      ), key).toThrow(/不支持的 schema 关键字/);
    }
  });

  it('enforces const and numeric minimum/maximum', () => {
    const tool = def({
      type: 'object',
      properties: {
        kind: { const: 'fixed' },
        n: { type: 'number', minimum: 1, maximum: 3 },
      },
    });
    expect(validator.validate(tool, { kind: 'fixed', n: 2 })).toEqual({ kind: 'fixed', n: 2 });
    expect(() => validator.validate(tool, { kind: 'other', n: 2 })).toThrow(/const/);
    expect(() => validator.validate(tool, { kind: 'fixed', n: 0 })).toThrow(/不得小于/);
    expect(() => validator.validate(tool, { kind: 'fixed', n: 4 })).toThrow(/不得大于/);
  });

  it('compiles every builtin primitive and tool_search schema', () => {
    const tools = [
      ...getPrimitiveTools(),
      createToolSearchTool(() => []),
    ];
    for (const tool of tools) {
      try {
        validator.validate(toolToDefinition(tool), {});
      } catch (error) {
        expect(error, tool.name).toBeInstanceOf(ToolValidationError);
        expect((error as Error).message, tool.name).not.toMatch(/不支持的 schema 关键字/);
      }
    }
  });
});

it('validates actual shell discovery and execution modes without mixed fields', async () => {
  const { shellTool } = await import('../tools/primitives/ShellTool');
  const tool = { name: shellTool.name, description: shellTool.description, parameters: shellTool.parameters };
  const validator = new ToolValidator();
  for (const rdx of [{ discovery: { kind: 'search', query: 'pixel', limit: 8 } }, { discovery: { kind: 'describe', operation: 'rd.texture.get_pixel_history' } }, { operation: 'rd.texture.get_pixel_history', args: { x: 0 } }]) expect(() => validator.validate(tool, { rdx })).not.toThrow();
  for (const rdx of [{ discovery: { kind: 'search', query: 'pixel' }, operation: 'rd.core.init' }, { discovery: { kind: 'describe', operation: 'rd.texture.get_pixel_history', query: 'pixel' } }]) expect(() => validator.validate(tool, { rdx })).toThrow();
});
