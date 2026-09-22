import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { UserInputCustomAnswer, UserInputOptionList } from './UserInputRequestPanelParts';

const locale = vi.hoisted(() => ({ language: 'en' }));
vi.mock('../../stores/appSettingsStore', () => ({
  useAppSettingsStore: (selector: (state: unknown) => unknown) => selector({ settings: { appearance: locale } }),
}));

describe('custom answer shared input', () => {
  const question = { questionId: 'question', header: 'Context', prompt: 'Explain?', options: [], allowFreeform: true };

  it.each([false, true])('preserves answer and disabled=%s on the shared content input', (isSubmitting) => {
    const html = renderToStaticMarkup(createElement(UserInputCustomAnswer, { question, customAnswer: '中文\ncontext',
      isSubmitting, textareaRef: createRef<HTMLTextAreaElement>(), onChange: vi.fn() }));
    expect(html).toContain('ui-textarea');
    expect(html).toContain('is-sizing-content');
    expect(html).toContain('rows="1"');
    expect(html).toContain('中文\ncontext');
    expect(html.includes('disabled=""')).toBe(isSubmitting);
    expect(html).toContain('aria-label="Custom answer"');
  });

  it('retains custom-answer selection when alternatives exist', () => {
    const html = renderToStaticMarkup(createElement(UserInputCustomAnswer, {
      question: { ...question, options: [{ optionId: 'a', label: 'Option A', description: 'First option' }] },
      customAnswer: 'Other', isSubmitting: false, textareaRef: createRef<HTMLTextAreaElement>(), onChange: vi.fn() }));
    expect(html).toContain('composer-user-input-custom is-selected');
    expect(html).toContain('Enter custom answer');
    expect(html.match(/<textarea/g)).toHaveLength(1);
  });

  it.each([
    ['zh-CN', '输入自定义答案', '请输入你的答案…', '自定义答案', '答案选项'],
    ['en', 'Enter custom answer', 'Type your answer...', 'Custom answer', 'Answer choices'],
  ])('uses the real %s catalog for controls while preserving model option text', (language, label, placeholder, aria, choices) => {
    locale.language = language;
    const value = { ...question, options: [{ optionId: 'a', label: 'Model supplied option' }] };
    const html = renderToStaticMarkup(createElement(UserInputCustomAnswer, {
      question: value, customAnswer: '', isSubmitting: false,
      textareaRef: createRef<HTMLTextAreaElement>(), onChange: vi.fn(),
    }));
    expect(html).toContain(label);
    expect(html).toContain(`placeholder="${placeholder}"`);
    expect(html).toContain(`aria-label="${aria}"`);
    const options = renderToStaticMarkup(createElement(UserInputOptionList, {
      question: value, isSubmitting: false, onSelect: vi.fn(),
    }));
    expect(options).toContain(`aria-label="${choices}"`);
    expect(options).toContain('Model supplied option');
    locale.language = 'en';
  });
});
