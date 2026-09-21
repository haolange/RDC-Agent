// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentListItem } from './AgentListItem';

let root: Root;
let container: HTMLDivElement;
const onSelect = vi.fn();
const render = async (overrides: Partial<Parameters<typeof AgentListItem>[0]> = {}) => {
  await act(async () => root.render(createElement(AgentListItem, {
    id: 'analyzer', name: 'Analyzer', description: '用于证据分析。',
    selected: false, onSelect, ...overrides,
  })));
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onSelect.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('AgentListItem', () => {
  it('uses the shared selectable row and leaves selection controlled by its parent', async () => {
    await render();
    const row = container.querySelector('button')!;
    expect(row.classList.contains('ui-list-row')).toBe(true);
    expect(row.getAttribute('aria-selected')).toBe('false');
    await act(async () => row.click());
    expect(onSelect).toHaveBeenCalledOnce();
    expect(row.getAttribute('aria-selected')).toBe('false');
    await render({ selected: true });
    expect(row.getAttribute('aria-selected')).toBe('true');
    expect(row.classList.contains('is-selected')).toBe(true);
  });

  it('keeps complete long text and an empty description slot on async updates', async () => {
    const name = '很长的 Agent 名称 / Long Agent name '.repeat(8);
    const description = '完整的描述与 English description '.repeat(12);
    await render({ name, description });
    const title = container.querySelector<HTMLElement>('.settings-agent-list-item-name')!;
    const detail = container.querySelector<HTMLElement>('.ui-overflow-fade')!;
    expect(title.title).toBe(name);
    expect(title.textContent).toBe(name);
    expect(detail.title).toBe(description);
    expect(detail.textContent).toBe(description);
    expect(container.querySelector('strong')).toBeNull();
    await render({ description: '' });
    expect(container.querySelector('.ui-overflow-fade')).toBe(detail);
    expect(detail.textContent).toBe('');
    expect(detail.title).toBe('');
  });

  it('keeps glyphs decorative and small, and delegates disabled behavior to ListRow', async () => {
    await render({ disabled: true, icon: 'waveform-gauge' });
    const row = container.querySelector('button')!;
    expect(row.disabled).toBe(true);
    expect(row.classList.contains('is-disabled')).toBe(true);
    await act(async () => row.click());
    expect(onSelect).not.toHaveBeenCalled();
    const icon = container.querySelector('.settings-agent-list-item-icon')!;
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.querySelector('svg')?.getAttribute('width')).toBe('18');
    expect(icon.querySelector('svg')?.getAttribute('height')).toBe('18');
    expect(container.querySelector('[style]')).toBeNull();
  });
});
