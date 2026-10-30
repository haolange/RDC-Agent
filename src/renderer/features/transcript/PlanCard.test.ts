// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ConversationPlanReview } from '@shared/types/planReview';
import { PlanCard } from './PlanCard';
const mock = vi.hoisted(() => ({ open: vi.fn(), measure: () => {}, disconnect: vi.fn(), height: 100 }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../patterns/Markdown/MessageMarkdown', () => ({ MessageMarkdown: ({ content }: { content: string }) =>
  createElement('div', { className: 'markdown-body' }, content) }));
const plan: ConversationPlanReview = { planId: 'plan', revision: 1, hash: 'h', uri: 'session://plans/plan.md',
  title: 'Full long plan title', summary: ['Original excerpt'], sections: [], status: 'awaiting', handoffOptions: [] };
let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mock.height = 100; mock.open.mockReset(); mock.disconnect.mockReset();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { mock.measure = callback; }
    observe() {} disconnect() { mock.disconnect(); }
  });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => mock.height);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('fades only overflowing text and recomputes after reflow and a new excerpt', async () => {
  await act(async () => root.render(createElement(PlanCard, { onOpen: mock.open, plan })));
  expect(host.querySelector('.plan-card__preview.is-overflowing')).toBeNull();
  mock.height = 180;
  await act(async () => mock.measure());
  expect(host.querySelector('.plan-card__preview.is-overflowing')).not.toBeNull();
  expect(host.querySelector('.plan-card__preview button')).toBeNull();
  mock.height = 100;
  await act(async () => root.render(createElement(PlanCard, { onOpen: mock.open, plan: { ...plan, summary: ['Short replacement'] } })));
  expect(host.querySelector('.plan-card__preview.is-overflowing')).toBeNull();
  expect(mock.disconnect).toHaveBeenCalledOnce();
});
it('opens the exact plan through the existing reader with full accessible title', async () => {
  await act(async () => root.render(createElement(PlanCard, { onOpen: mock.open, plan })));
  const button = host.querySelector<HTMLElement>('[role="button"]')!;
  expect(host.querySelector('button')).toBeNull();
  expect(button.getAttribute('aria-label')).toContain(plan.title);
  await act(async () => button.click());
  expect(mock.open).toHaveBeenCalledWith(plan);
  expect(document.activeElement).toBe(button);
});
it('ends the fade at visible text rather than the Markdown whitespace below it', async () => {
  mock.height = 180;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 100));
  vi.spyOn(document, 'createRange').mockReturnValue({
    selectNodeContents() {}, getClientRects: () => [new DOMRect(0, 52, 180, 18), new DOMRect(0, 120, 180, 18)],
    detach() {},
  } as unknown as Range);
  await act(async () => root.render(createElement(PlanCard, { onOpen: mock.open, plan })));
  const css = document.adoptedStyleSheets.flatMap(sheet => Array.from(sheet.cssRules, rule => rule.cssText)).join('');
  expect(css).toMatch(/--plan-fade-start:\s*35px/);
  expect(css).toMatch(/--plan-fade-length:\s*35px/);
});
it('opens with Enter and Space while preserving selected text clicks', async () => {
  await act(async () => root.render(createElement(PlanCard, { onOpen: mock.open, plan })));
  const card = host.querySelector<HTMLElement>('[role="button"]')!;
  expect(card).not.toBeNull();
  for (const key of ['Enter', ' ']) {
    await act(async () => card.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
  }
  expect(mock.open).toHaveBeenCalledTimes(2);
  vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'selected text' } as Selection);
  await act(async () => card.click());
  expect(mock.open).toHaveBeenCalledTimes(2);
});

it('scales the fade with font reflow and preserves half of a height-limited excerpt', async () => {
  mock.height = 180;
  let visibleHeight = 120;
  let lineHeight = 18;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 200, visibleHeight));
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ lineHeight: `${lineHeight}px` }) as CSSStyleDeclaration);
  const declarations = () => document.adoptedStyleSheets.flatMap(sheet => Array.from(sheet.cssRules, rule => rule.cssText)).join('');
  await act(async () => root.render(createElement(PlanCard, { onOpen: mock.open, plan })));
  expect(declarations()).toMatch(/--plan-fade-length:\s*36px/);
  lineHeight = 24;
  await act(async () => mock.measure());
  expect(declarations()).toMatch(/--plan-fade-length:\s*48px/);
  visibleHeight = 50;
  await act(async () => mock.measure());
  expect(declarations()).toMatch(/--plan-fade-start:\s*25px/);
  expect(declarations()).toMatch(/--plan-fade-length:\s*25px/);
  mock.height = 80;
  await act(async () => mock.measure());
  expect(host.querySelector('.plan-card__preview.is-overflowing')).toBeNull();
  expect(declarations()).not.toContain('--plan-fade-length');
});
