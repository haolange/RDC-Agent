import { describe, expect, it } from 'vitest';
import { contentFromForm, emptyForm, formFromContent, resourceDisplayName } from './scopedResourceForm';

describe('resource list names', () => {
  it('names a skill by its frontmatter and keeps the document intact', () => {
    const content = '---\nname: "Frame review"\ndescription: A long workflow description\n---\n\nFull instructions';
    expect(resourceDisplayName('skill', 'frame-review', content)).toBe('Frame review');
    expect(resourceDisplayName('skill', 'bare', 'No frontmatter')).toBe('bare');
    expect(contentFromForm('skill', formFromContent('skill', 'frame-review', content))).toBe(content);
  });

  it('names an MCP server by its name and falls back to the id', () => {
    expect(resourceDisplayName('mcp', 'fs', '{"name":"Files","transport":"stdio","command":"tool"}')).toBe('Files');
    expect(resourceDisplayName('mcp', 'fs', '{')).toBe('fs');
    expect(resourceDisplayName('hook', 'lint-on-edit', 'event: tool.before-call')).toBe('lint-on-edit');
  });
});

describe('MCP argument editing', () => {
  it.each(['[', '{}', '[1]', '[null]'])('rejects %s instead of silently removing arguments', (argsText) => {
    expect(() => contentFromForm('mcp', { ...emptyForm('mcp', 'test'), argsText })).toThrow();
  });
  it('preserves argument boundaries and spaces', () => {
    const args = ['--path', 'C:\\QA folder\\中文', ''];
    const content = contentFromForm('mcp', { ...emptyForm('mcp', 'test'), argsText: JSON.stringify(args) });
    expect(JSON.parse(content).args).toEqual(args);
  });
});

describe('MCP descriptor round trip', () => {
  it('keeps fields the form does not edit and drops a URL once the transport is no longer HTTP', () => {
    const original = JSON.stringify({
      id: 'files',
      name: 'Files',
      transport: 'streamable-http',
      url: 'http://localhost:8123/mcp',
      command: '',
      args: [],
      enabledByDefault: true,
      env: { WORKSPACE: '/tmp' },
      description: 'Workspace files',
    });
    const toggled = JSON.parse(
      contentFromForm('mcp', { ...formFromContent('mcp', 'files', original), enabled: false }),
    );
    expect(toggled).toMatchObject({
      enabledByDefault: false,
      env: { WORKSPACE: '/tmp' },
      description: 'Workspace files',
      url: 'http://localhost:8123/mcp',
    });
    const local = JSON.parse(
      contentFromForm('mcp', { ...formFromContent('mcp', 'files', original), transport: 'stdio', command: 'npx' }),
    );
    expect(local).toMatchObject({ transport: 'stdio', command: 'npx', env: { WORKSPACE: '/tmp' } });
    expect(local).not.toHaveProperty('url');
  });
});
