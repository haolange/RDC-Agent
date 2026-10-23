import { describe, expect, it } from 'vitest';
import { hashScopedResource, ScopedResourceResolver } from './ScopedResourceResolver';
import { createHash } from 'node:crypto';

// Frozen historical serializer: this oracle must not follow implementation changes.
const historicalSerialize = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (Array.isArray(value)) return `[${value.map(historicalSerialize).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${historicalSerialize(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? String(value);
};

describe('historical canonical hash compatibility', () => {
  const sparse = new Array(4);
  sparse[1] = undefined;
  sparse[3] = null;
  const fixtures: unknown[] = [undefined, null, true, false, -0, NaN, Infinity, 42n,
    Symbol('symbol'), new Date(0), Buffer.from([0, 255]), sparse,
    { z: undefined, a: ['quote"\\\n\t', { 'é': -1, 'e': 2 }] },
    '', '\ud800', '\udc00', 'x'.repeat(8191) + '😀' + 'y'.repeat(8191) + '\ud800',
    { ['x'.repeat(8191) + '😀']: '\u0000\r\n\b\f' },
    Array.from({ length: 100 }, (_, i) => ({ i, content: 'evidence 😀'.repeat(1000) }))];
  it.each(fixtures.map((value, index) => ({ value, index })))('preserves historical bytes for fixture $index', ({ value }) => {
    expect(hashScopedResource(value)).toBe(createHash('sha256').update(historicalSerialize(value)).digest('hex'));
  });
  it('detects changes beyond chunk boundaries', () => {
    const value = 'x'.repeat(100_000);
    expect(hashScopedResource(value + 'a')).not.toBe(hashScopedResource(value + 'b'));
  });
});

describe('ScopedResourceResolver', () => {
  it('hashes undefined resource payloads deterministically instead of crashing the runtime', () => {
    expect(hashScopedResource(undefined)).toBe(hashScopedResource(undefined));
  });
  it('resolves whole-resource precedence with provenance', () => {
    const resolver = new ScopedResourceResolver();
    const catalog = resolver.resolve([
      { id: 'ask', kind: 'agent', scope: 'builtin', sourcePath: 'builtin/ask.agent.md', value: { model: 'default' } },
      { id: 'ask', kind: 'agent', scope: 'user', sourcePath: 'C:/Users/Vip/.rdc-agent/agents/ask.agent.md', value: { model: 'kimi' } },
      { id: 'ask', kind: 'agent', scope: 'project', sourcePath: 'D:/Project/.rdc-agent/agents/ask.agent.md', value: { model: 'deepseek' } },
    ]);

    expect(catalog.resources).toHaveLength(1);
    expect(catalog.resources[0].value).toEqual({ model: 'deepseek' });
    expect(catalog.resources[0].provenance.scope).toBe('project');
    expect(catalog.resources[0].provenance.overriddenSource?.scope).toBe('user');
    expect(catalog.resources[0].effectiveStatus).toBe('overridden');
  });

  it('keeps a lower-scope winner when a higher-scope candidate is invalid', () => {
    const resolver = new ScopedResourceResolver();
    const catalog = resolver.resolve([
      { id: 'general', kind: 'agent', scope: 'builtin', sourcePath: 'builtin/general.agent.md', value: { model: 'builtin' } },
      {
        id: 'general',
        kind: 'agent',
        scope: 'project',
        sourcePath: 'project/general.agent.md',
        value: { model: 'broken' },
        invalid: true,
        invalidReason: 'malformed frontmatter',
      },
    ]);
    expect(catalog.resources).toHaveLength(1);
    expect(catalog.resources[0].value).toEqual({ model: 'builtin' });
    expect(catalog.resources[0].provenance.scope).toBe('builtin');
    expect(catalog.diagnostics.some((entry) => (
      entry.code === 'resource.invalid' && entry.sourcePath === 'project/general.agent.md'
    ))).toBe(true);
  });

  it('allows a project disabled override to shadow an inherited resource', () => {
    const resolver = new ScopedResourceResolver();
    const catalog = resolver.resolve([
      { id: 'network', kind: 'mcp', scope: 'user', sourcePath: 'user/network.mcp.json', value: { url: 'https://example.test' } },
      { id: 'network', kind: 'mcp', scope: 'project', sourcePath: 'project/network.mcp.json', value: { disabled: true }, enabled: false },
    ]);
    expect(catalog.resources[0].enabled).toBe(false);
    expect(catalog.resources[0].effectiveStatus).toBe('disabled');
  });

  it('merges only tighter project policy', () => {
    const resolver = new ScopedResourceResolver();
    expect(resolver.tightenPolicy(
      { deniedTools: ['shell'], approval: 'destructive', limits: { maxTurns: 20 } },
      { deniedTools: ['web_search'], approval: 'all', limits: { maxTurns: 10 } },
    )).toEqual({ deniedTools: ['shell', 'web_search'], approval: 'all', limits: { maxTurns: 10 } });
    expect(() => resolver.tightenPolicy(
      { approval: 'mutation', limits: { maxTurns: 10 } },
      { approval: 'none', limits: { maxTurns: 20 } },
    )).toThrow(/cannot lower approval/);
  });
});
