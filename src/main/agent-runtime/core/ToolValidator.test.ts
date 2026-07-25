import { describe, expect, it } from 'vitest';
import { ToolValidationError, ToolValidator } from './ToolValidator';
import type { ToolDefinition } from './types';

const validator = new ToolValidator();

function def(parameters: ToolDefinition['parameters'], name = 'demo'): ToolDefinition {
  return { name, description: 'demo', parameters };
}

describe('ToolValidator', () => {
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
});
