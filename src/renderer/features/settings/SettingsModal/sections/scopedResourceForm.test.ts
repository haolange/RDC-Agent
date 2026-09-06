import { describe, expect, it } from 'vitest';
import { contentFromForm, emptyForm } from './scopedResourceForm';

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
