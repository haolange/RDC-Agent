// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { TooltipHost } from './TooltipHost';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

it('shows a data-tooltip after the hover delay, describes the element and hides on Escape', async () => {
  vi.useFakeTimers();
  const container = document.createElement('div');
  document.body.append(container);
  const button = document.createElement('button');
  button.setAttribute('aria-label', 'Copy');
  button.dataset.tooltip = 'Copy the full path';
  document.body.append(button);
  const root = createRoot(container);
  await act(async () => root.render(createElement(TooltipHost)));

  await act(async () => { button.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })); });
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await act(async () => { vi.advanceTimersByTime(500); });
  const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
  expect(tooltip.textContent).toBe('Copy the full path');
  expect(button.getAttribute('aria-describedby')).toBe(tooltip.id);

  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(button.hasAttribute('aria-describedby')).toBe(false);
  await act(async () => root.unmount());
});

it('ignores touch hover', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const target = document.createElement('span');
  target.dataset.tooltip = 'Full title';
  document.body.append(target);
  const root = createRoot(container);
  await act(async () => root.render(createElement(TooltipHost)));
  await act(async () => { target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'touch' })); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await act(async () => root.unmount());
});

it('shows the tooltip of a label inside a focused control and describes the control', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const row = document.createElement('button');
  const title = document.createElement('span');
  title.textContent = 'Shader pass';
  title.dataset.tooltip = 'Shader pass · 12 draws';
  row.append(title);
  document.body.append(row);
  const root = createRoot(container);
  await act(async () => root.render(createElement(TooltipHost)));
  await act(async () => { row.focus(); });
  const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
  expect(tooltip.textContent).toBe('Shader pass · 12 draws');
  expect(row.getAttribute('aria-describedby')).toBe(tooltip.id);
  expect(title.hasAttribute('aria-describedby')).toBe(false);
  await act(async () => root.unmount());
});
