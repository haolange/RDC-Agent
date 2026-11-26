import { describe, expect, it } from 'vitest';
import { ToolValidationError, ToolValidator } from './ToolValidator';
import type { ToolDefinition } from './types';

const validator = new ToolValidator();

function def(parameters: ToolDefinition['parameters'], name = 'demo'): ToolDefinition {
  return { name, description: 'demo', parameters };
}

describe('ToolValidator', () => {
  it('enforces command/rdc exclusive schema modes before dispatch', () => {
    const tool = def({
      type: 'object',
      properties: { command: { type: 'string' }, rdc: { type: 'object' } },
      oneOf: [
        { required: ['command'], not: { required: ['rdc'] } },
        { required: ['rdc'], not: { required: ['command'] } },
      ],
    });
    expect(validator.validate(tool, { command: 'echo ok' })).toEqual({ command: 'echo ok' });
    expect(validator.validate(tool, { rdc: {} })).toEqual({ rdc: {} });
    for (const args of [{}, { command: 'echo ok', rdc: {} }, { command: true }]) {
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
    expect(() =>
      validator.validate(def({ type: 'object', required: ['path'], properties: { path: { type: 'string' } } }), {}),
    ).toThrow(ToolValidationError);
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
    expect(() =>
      validator.validate(
        def({
          type: 'object',
          properties: {
            path: { type: 'string' },
            command: { type: 'string' },
            url: { type: 'string' },
          },
        }),
        { path: 12, command: true, url: 1 },
      ),
    ).toThrow(/期望 string/);

    expect(
      validator.validate(
        def({
          type: 'object',
          properties: {
            path: { type: 'string' },
            command: { type: 'string' },
            url: { type: 'string' },
          },
        }),
        { path: '/tmp/a', command: 'ls', url: 'https://example.test' },
      ),
    ).toEqual({ path: '/tmp/a', command: 'ls', url: 'https://example.test' });
  });

  it('rejects undeclared fields by default', () => {
    expect(() =>
      validator.validate(
        def({
          type: 'object',
          properties: { name: { type: 'string' } },
        }),
        { name: 'ok', extra: true },
      ),
    ).toThrow(/未声明字段/);
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
    expect(() =>
      validator.validate(
        def({
          type: 'object',
          properties: {
            record: { type: 'object', properties: {} },
          },
        }),
        { record: { evidenceId: 'ev-1' } },
      ),
    ).toThrow(/未声明字段/);
  });

  it('enforces anyOf and union types instead of rejecting them', () => {
    const tool = def({
      type: 'object',
      properties: {
        mode: { anyOf: [{ type: 'string', enum: ['fast'] }, { type: 'integer' }] } as never,
        note: { type: ['string', 'null'] } as never,
      },
    });
    expect(validator.validate(tool, { mode: 'fast', note: null })).toEqual({ mode: 'fast', note: null });
    expect(() => validator.validate(tool, { mode: 'slow' })).toThrow(/anyOf 要求至少匹配一个 schema（分支：/);
  });

  it('fails the compile on a keyword or format it cannot enforce', () => {
    for (const extra of [{ patternMatch: 'x' }, { 'x-vendor': 1 }, { format: 'banana' }]) {
      expect(
        () => validator.assertCompilable({ type: 'object', properties: { n: { type: 'string', ...extra } } }, 'demo'),
        JSON.stringify(extra),
      ).toThrow(/\[demo\] parameters: schema 无法编译/);
    }
  });

  it('accepts annotation keywords and enforces format, prefixItems, $defs references and type arrays', () => {
    const tool = def({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $comment: 'fixture',
      title: 'Fixture',
      type: 'object',
      properties: {
        when: { type: 'string', format: 'date-time', examples: ['2026-01-01T00:00:00Z'], deprecated: true },
        pair: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'integer' }], minItems: 2, maxItems: 2 },
        target: { $ref: '#/$defs/Target' },
        note: { type: ['string', 'null'] },
      },
      $defs: { Target: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1 } } } },
    });
    const valid = { when: '2026-11-26T10:00:00Z', pair: ['a', 1], target: { id: 'x' }, note: null };
    expect(validator.validate(tool, valid)).toEqual(valid);
    expect(() => validator.validate(tool, { when: 'yesterday' })).toThrow(/args\.when: 值不符合 format "date-time"/);
    expect(() => validator.validate(tool, { pair: ['a', 'b'] })).toThrow(/args\.pair\[1\]: 期望 integer/);
    expect(() => validator.validate(tool, { pair: ['a', 1, 2] })).toThrow(/args\.pair/);
    expect(() => validator.validate(tool, { target: {} })).toThrow(/args\.target\.id: 缺少必填字段 "id"/);
    expect(() => validator.validate(tool, { target: { id: 'x', extra: 1 } })).toThrow(/未声明字段 "extra"/);
    expect(() => validator.validate(tool, { note: { nested: true } })).toThrow(
      /期望类型之一 string \| null，实际为 object/,
    );
  });

  it('fills declared defaults for missing fields', () => {
    const tool = def({
      type: 'object',
      required: ['limit'],
      properties: { limit: { type: 'integer', default: 20 }, query: { type: 'string' } },
    });
    expect(validator.validate(tool, { query: 'q' })).toEqual({ query: 'q', limit: 20 });
  });

  it('finds a compiled validator by schema content, not by object identity', () => {
    const local = new ToolValidator();
    // An open tuple compiles only under the external (MCP) options; strict built-in compilation rejects it.
    const schema = { type: 'object', properties: { pair: { type: 'array', prefixItems: [{ type: 'string' }] } } };
    expect(() => new ToolValidator().assertCompilable(schema, 'strict')).toThrow(/"prefixItems" is 1-tuple/);
    local.compileExternal(schema, 'external');
    const copy = def(structuredClone(schema), 'copy');
    expect(local.validate(copy, { pair: ['a', 2] })).toEqual({ pair: ['a', 2] });
    expect(() => local.validate(copy, { pair: [1] })).toThrow(/\[copy\] args\.pair\[0\]: 期望 string/);
  });

  it('bounds schema size before compiling and argument size before validating', () => {
    let deep: ToolDefinition['parameters'] = { type: 'string' };
    for (let level = 0; level < 13; level += 1) deep = { type: 'object', properties: { next: deep } };
    expect(() => new ToolValidator().assertCompilable(deep, 'deep')).toThrow(
      /\[deep\] parameters(\.properties\.next)+: schema 递归深度超过上限 12/,
    );
    const wide = {
      type: 'object',
      properties: Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`f${i}`, { type: 'string' }])),
    };
    expect(() => new ToolValidator().compileExternal(wide, 'wide')).toThrow(
      /\[wide\] parameters\.properties\.f255: schema 节点数超过上限 256/,
    );

    const bag = def({ type: 'object', properties: { record: { type: 'object' }, list: { type: 'array' } } });
    const keys = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`k${i}`, i]));
    expect(validator.validate(bag, { record: keys(64), list: Array.from({ length: 256 }, () => 0) })).toBeTruthy();
    expect(() => validator.validate(bag, { record: { nested: keys(65) } })).toThrow(
      /\[demo\] args\.record\.nested: 对象字段数超过上限 64/,
    );
    expect(() => validator.validate(bag, { list: Array.from({ length: 257 }, () => 0) })).toThrow(
      /\[demo\] args\.list: 数组元素数超过硬上限 256/,
    );
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
});

it('validates actual shell discovery and execution modes without mixed fields', async () => {
  const { shellTool } = await import('../tools/primitives/ShellTool');
  const tool = { name: shellTool.name, description: shellTool.description, parameters: shellTool.parameters };
  const validator = new ToolValidator();
  for (const rdc of [
    { discovery: { kind: 'search', query: 'pixel', limit: 8 } },
    { discovery: { kind: 'describe', operation: 'rd.texture.get_pixel_history' } },
    { operation: 'rd.texture.get_pixel_history', args: { x: 0 } },
  ])
    expect(() => validator.validate(tool, { rdc })).not.toThrow();
  for (const rdc of [
    { discovery: { kind: 'search', query: 'pixel' }, operation: 'rd.core.init' },
    { discovery: { kind: 'describe', operation: 'rd.texture.get_pixel_history', query: 'pixel' } },
  ])
    expect(() => validator.validate(tool, { rdc })).toThrow();
});
