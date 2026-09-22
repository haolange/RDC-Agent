// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('preserves narrow approval and question layouts inside the original viewport breakpoint', () => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(readFileSync('src/renderer/features/composer/composer-viewport.css', 'utf8'));
  const media = [...sheet.cssRules].find(rule => rule instanceof CSSMediaRule && rule.conditionText === '(max-width: 900px)') as CSSMediaRule;
  expect(media).toBeDefined();
  const property = (selector: string, name: string) => {
    const rule = [...media.cssRules].find(item => item instanceof CSSStyleRule && item.selectorText.split(',').map(part => part.trim()).includes(selector)) as CSSStyleRule;
    return rule?.style.getPropertyValue(name);
  };
  expect(property('.composer-user-input-question-bar', 'flex-direction')).toBe('column');
  expect(property('.composer-user-input-progress', 'align-self')).toBe('flex-end');
  expect(property('.composer-user-input-option-copy', 'grid-template-columns')).toBe('1fr');
  expect(property('.composer-user-input-option-copy', 'gap')).toBe('var(--space-1)');
  expect(property('.composer-user-input-footer', 'flex-direction')).toBe('column');
  expect(property('.composer-user-input-footer', 'align-items')).toBe('stretch');
  expect(property('.composer-user-input-hint', 'text-align')).toBe('center');
  expect(property('.composer-tool-approval-actions', 'justify-content')).toBe('stretch');
  expect(property('.composer-tool-approval-deny', 'flex')).toBe('1 1 0%');
  expect(property('.composer-tool-approval-approve', 'flex')).toBe('1 1 0%');
});
