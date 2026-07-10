import { describe, expect, it } from 'vitest';
import { hashScopedResource, ScopedResourceResolver } from './ScopedResourceResolver';

describe('ScopedResourceResolver', () => {
  it('hashes undefined resource payloads deterministically instead of crashing the runtime', () => {
    expect(hashScopedResource(undefined)).toBe(hashScopedResource(undefined));
  });
  it('resolves whole-resource precedence with provenance', () => {
    const resolver = new ScopedResourceResolver();
    const catalog = resolver.resolve([
      { id: 'ask', kind: 'agent', scope: 'builtin', sourcePath: 'builtin/ask.agent.md', value: { model: 'default' } },
      { id: 'ask', kind: 'agent', scope: 'user', sourcePath: 'C:/Users/Vip/.rdx/agents/ask.agent.md', value: { model: 'kimi' } },
      { id: 'ask', kind: 'agent', scope: 'project', sourcePath: 'D:/Project/.rdx/agents/ask.agent.md', value: { model: 'deepseek' } },
    ]);

    expect(catalog.resources).toHaveLength(1);
    expect(catalog.resources[0].value).toEqual({ model: 'deepseek' });
    expect(catalog.resources[0].provenance.scope).toBe('project');
    expect(catalog.resources[0].provenance.overriddenSource?.scope).toBe('user');
    expect(catalog.resources[0].effectiveStatus).toBe('overridden');
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
      { deniedTools: ['bash'], approval: 'destructive', limits: { maxTurns: 20 } },
      { deniedTools: ['web_search'], approval: 'all', limits: { maxTurns: 10 } },
    )).toEqual({ deniedTools: ['bash', 'web_search'], approval: 'all', limits: { maxTurns: 10 } });
    expect(() => resolver.tightenPolicy(
      { approval: 'mutation', limits: { maxTurns: 10 } },
      { approval: 'none', limits: { maxTurns: 20 } },
    )).toThrow(/cannot lower approval/);
  });
});
