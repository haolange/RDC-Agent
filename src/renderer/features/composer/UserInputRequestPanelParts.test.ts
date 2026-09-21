import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { UserInputCustomAnswer } from './UserInputRequestPanelParts';

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
});
