import { describe, expect, it } from 'vitest';
import { toolValidator } from '../core/ToolValidator';
import { compileMcpInputSchema } from './mcpInputSchema';

/** The shape common MCP SDKs emit: draft metadata, shared definitions, nullable unions and annotations. */
const SDK_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['query', 'options'],
  properties: {
    query: { type: 'string', minLength: 1, examples: ['shadow pass'] },
    options: { $ref: '#/$defs/Options' },
    since: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    tags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    extra: { type: 'object', additionalProperties: true },
  },
  $defs: {
    Options: {
      type: 'object',
      properties: { limit: { type: ['integer', 'null'], exclusiveMinimum: 0 } },
      allOf: [{ required: ['limit'] }],
    },
  },
};

describe('MCP input schema compilation', () => {
  it('compiles an SDK schema and validates arguments against every constraint it declares', () => {
    const compiled = compileMcpInputSchema(SDK_SCHEMA, 'search');
    if (!compiled.ok) throw new Error(compiled.reason);
    const definition = { name: 'search', description: '', parameters: compiled.schema };
    expect(toolValidator.validate(definition, {
      query: 'shadow', options: { limit: 5 }, since: null, tags: ['a', 'b'], extra: { any: 1 },
    })).toEqual({ query: 'shadow', options: { limit: 5 }, since: null, tags: ['a', 'b'], extra: { any: 1 } });
    expect(() => toolValidator.validate(definition, { query: 'shadow', options: { limit: 0 } })).toThrow(/大于 0/);
    expect(() => toolValidator.validate(definition, { query: 'shadow', options: {} })).toThrow(/allOf/);
    expect(() => toolValidator.validate(definition, { query: 'shadow', options: { limit: 1 }, since: { day: 1 } })).toThrow(/anyOf/);
    expect(() => toolValidator.validate(definition, { query: 'shadow', options: { limit: 1 }, tags: ['a', 'a'] })).toThrow(/互不相同/);
    expect(() => toolValidator.validate(definition, { query: 'shadow', options: { limit: 1 }, unknown: true })).toThrow(/未声明字段/);
  });

  it('checks every member of a union type instead of letting any value through', () => {
    const compiled = compileMcpInputSchema({ type: 'object', properties: { note: { type: ['string', 'null'] } } }, 'note');
    if (!compiled.ok) throw new Error(compiled.reason);
    const definition = { name: 'note', description: '', parameters: compiled.schema };
    expect(toolValidator.validate(definition, { note: null })).toEqual({ note: null });
    expect(() => toolValidator.validate(definition, { note: { nested: true } })).toThrow(/类型之一/);
  });

  it('reports a schema the validator cannot enforce at connect time', () => {
    expect(compileMcpInputSchema({ type: 'object', properties: { pair: { type: 'array', prefixItems: [{ type: 'string' }] } } }, 'pair'))
      .toMatchObject({ ok: false, reason: expect.stringContaining('prefixItems') });
    expect(compileMcpInputSchema({ type: 'object', properties: { item: { $ref: '#/$defs/Missing' } } }, 'item'))
      .toMatchObject({ ok: false, reason: expect.stringContaining('unresolvable $ref') });
  });
});
