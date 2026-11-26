import { expect, it } from 'vitest';
import { agentArgumentHint, agentDescription } from './agentDescription';

const shipped = {
  description: 'Execution Orchestrator for ordinary work.',
  descriptionTranslations: { 'zh-CN': '执行编排者' },
  argumentHint: 'Describe the task',
  argumentHintTranslations: { 'zh-CN': '要执行的任务' },
};

it('shows shipped manifest copy in the interface language and falls back to the manifest text', () => {
  expect(agentDescription(undefined, 'zh-CN')).toBe('');
  expect(agentDescription(shipped, 'zh-CN')).toBe('执行编排者');
  expect(agentDescription(shipped, 'en')).toBe(shipped.description);
  expect(agentArgumentHint(shipped, 'zh-CN')).toBe('要执行的任务');
  // A user or project copy is written without translations, so its own text always shows.
  expect(agentDescription({ description: '用户描述', argumentHint: '' }, 'zh-CN')).toBe('用户描述');
});
