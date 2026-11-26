import { expect, it } from 'vitest';
import { chineseTranslations, englishTranslations, translate } from './messages';

it('spaces a Chinese template where an interpolated value meets Han text across scripts', () => {
  expect(translate('zh-CN', 'settings.scopeEditTitle', { kind: '钩子' })).toBe('编辑钩子');
  expect(translate('zh-CN', 'settings.scopeEditTitle', { kind: 'MCP' })).toBe('编辑 MCP');
  expect(translate('zh-CN', 'settings.scopeEmpty', { kind: 'MCP' })).toBe('当前作用域还没有 MCP。');
  expect(translate('zh-CN', 'settings.mcpStatusToolCount', { count: 3 })).toBe('3 个工具');
  expect(translate('en', 'settings.scopeEditTitle', { kind: 'hook' })).toBe('Edit hook');
});

it('pseudo-localizes English templates longer and accented while keeping placeholders', async () => {
  const { pseudoLocalize } = await import('./pseudoLocale');
  const text = pseudoLocalize('Edit {kind}');
  expect(text).toMatch(/^\[Édít \{kind\}~+\]$/u);
  expect(text.length).toBeGreaterThanOrEqual(Math.ceil('Edit {kind}'.length * 1.4));
});

it('names every user-facing one-million context control Max mode in both languages', () => {
  const oneMillionControl = /\b1M (context|mode)\b|\bVerify 1M\b|1M ?(上下文|模式)|验证 ?1M/u;
  const offending = [...Object.entries(englishTranslations), ...Object.entries(chineseTranslations)]
    .filter(([, text]) => oneMillionControl.test(text))
    .map(([key, text]) => `${key}: ${text}`);
  expect(offending).toEqual([]);
});
