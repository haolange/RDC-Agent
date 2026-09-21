import { describe, expect, it } from 'vitest';
import { contentFromForm, emptyForm, formFromContent, resourceCardMeta } from './scopedResourceForm';

describe('resource list summaries', () => {
  it('keeps full skill descriptions in the document, not in list rows', () => {
    const content = '---\nname: sample\ndescription: A long workflow description\n---\n\nFull instructions';
    expect(resourceCardMeta('skill', content)).toBe('');
    expect(contentFromForm('skill', formFromContent('skill', 'sample', content))).toBe(content);
  });

  it('retains useful tool and hook metadata', () => {
    expect(resourceCardMeta('mcp', '{"transport":"stdio","command":"tool"}')).toBe('stdio · tool');
    expect(resourceCardMeta('hook', 'event: tool.before-call')).toBe('tool.before-call');
    expect(resourceCardMeta('mcp', '{')).toBe('');
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
