import { expect, it } from 'vitest';
import { translate } from './messages';

it('spaces a Chinese template where an interpolated value meets Han text across scripts', () => {
  expect(translate('zh-CN', 'settings.scopeEditTitle', { kind: '钩子' })).toBe('编辑钩子');
  expect(translate('zh-CN', 'settings.scopeEditTitle', { kind: 'MCP' })).toBe('编辑 MCP');
  expect(translate('zh-CN', 'settings.scopeEmpty', { kind: 'MCP' })).toBe('当前作用域还没有 MCP。');
  expect(translate('zh-CN', 'settings.mcpStatusToolCount', { count: 3 })).toBe('3 个工具');
  expect(translate('en', 'settings.scopeEditTitle', { kind: 'hook' })).toBe('Edit hook');
});
