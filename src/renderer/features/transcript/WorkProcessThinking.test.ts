// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translate, type TranslationKey } from '../../i18n/messages';
import { WorkProcessThinkingRow } from './WorkProcessThinking';
import { ScopedWorkDisclosure } from './ScopedWorkDisclosure';
import type { WorkProcessRow } from './workProcessTypes';

vi.mock('../../i18n', () => ({
  useI18n: () => ({
    t: (key: TranslationKey, params?: Record<string, string | number>) => translate('en', key, params),
  }),
}));

type ThinkingRow = Extract<WorkProcessRow, { type: 'thinking' }>;

const summary: ThinkingRow = {
  type: 'thinking',
  id: 'thinking',
  status: 'complete',
  thinkingStatus: 'complete',
  duration: '',
  label: 'Thought for 20ms',
  kind: 'summary',
  visibility: 'summary',
  preview: '',
  openByDefault: false,
};

describe('public thinking Markdown', () => {
  let host: HTMLUListElement;
  let root: ReturnType<typeof createRoot>;
  const render = (preview: string, overrides?: Partial<ThinkingRow>, scope = 'thinking-test') =>
    act(async () => {
      root.render(
        React.createElement(ScopedWorkDisclosure, {
          scope,
          children: React.createElement(WorkProcessThinkingRow, { row: { ...summary, ...overrides, preview } }),
        }),
      );
    });
  const toggle = () => act(async () => host.querySelector('summary')!.click());

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('ul');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('keeps a single heading in a status-labelled disclosure', async () => {
    await render('## Check **the capture** ###');
    expect(host.querySelector('details')).not.toBeNull();
    expect(host.querySelector('[data-work-node-heading] .work-row-title')?.textContent).toBe('Thought for 20ms');
    expect(host.textContent).toContain('Thought for 20ms');
  });

  it('displays all original titles together after opening', async () => {
    await render('**Compare passes**\n**Read targets**\n**Check output**');
    expect(host.querySelector('details')?.open).toBe(false);
    expect(host.querySelector('summary')?.textContent).toBe('Thought for 20ms');
    await toggle();
    expect(host.querySelector('details')?.open).toBe(true);
    expect([...host.querySelectorAll('.markdown-body strong')].map((node) => node.textContent)).toEqual([
      'Compare passes',
      'Read targets',
      'Check output',
    ]);
  });

  it('retains the row and manual disclosure choice as a title gains streamed Markdown body and settles', async () => {
    const streaming = {
      status: 'running',
      thinkingStatus: 'streaming',
      label: 'Thinking…',
      openByDefault: true,
    } as const;
    await render('# Read capture', streaming, 'thinking-stream');
    const row = host.firstElementChild;
    expect(host.querySelector('details')).not.toBeNull();
    expect(host.querySelector('[data-active-signal="info"]')?.textContent).toBe('Thinking…');

    const preview =
      '# Read capture\n\nInspect [visible events](https://example.com/events).\n\n- Depth output\n\n```md\n# literal heading\n```';
    await render(preview, streaming, 'thinking-stream');
    expect(host.firstElementChild).toBe(row);
    expect(host.querySelector('details')?.open).toBe(true);
    expect(host.querySelector('.markdown-body')?.textContent).toContain('Read capture');
    expect(host.querySelector('.markdown-body a')?.getAttribute('href')).toBe('https://example.com/events');
    expect(host.querySelector('.markdown-body li')?.textContent).toBe('Depth output');
    expect(host.querySelector('.markdown-body pre')?.textContent).toContain('# literal heading');
    await toggle();
    await render(`${preview}\n\nRead the final pass.`, streaming, 'thinking-stream');
    expect(host.querySelector('details')?.open).toBe(false);
    await toggle();
    await render(preview, {}, 'thinking-stream');
    expect(host.querySelector('details')?.open).toBe(true);
    expect(host.querySelector('[data-active-signal]')).toBeNull();
  });

  it('keeps a rich title and its interactive reference link in the disclosure', async () => {
    await render(
      '## **Read** [the capture][capture]\n\n[capture]: https://example.com/capture',
      {},
      'thinking-rich-heading',
    );
    expect(host.querySelector('details')).not.toBeNull();
    expect(host.querySelector('.markdown-body strong')?.textContent).toBe('Read');
    expect(host.querySelector('.markdown-body a')?.getAttribute('href')).toBe('https://example.com/capture');
  });

  it('keeps an interactive rich heading with its body inside the disclosure', async () => {
    await render('## **Read** [the capture](https://example.com/capture)\n\nInspect its output.');
    expect(host.querySelector('summary')?.textContent).toBe('Thought for 20ms');
    await toggle();
    expect(host.querySelector('.markdown-body h2 strong')?.textContent).toBe('Read');
    expect(host.querySelector('.markdown-body h2 a')?.getAttribute('href')).toBe('https://example.com/capture');
  });

  it.each([
    { preview: 'A normal summary sentence.', bodyNode: 'p', overrides: {} },
    { preview: '- **A list item**', bodyNode: 'li', overrides: {} },
    { preview: '```md\n# A literal heading\n```', bodyNode: 'pre', overrides: {} },
    { preview: '# A raw heading', bodyNode: 'h1', overrides: { kind: 'raw', visibility: 'raw-collapsed' } as const },
  ])('keeps $bodyNode in the ordinary disclosure', async ({ preview, bodyNode, overrides }) => {
    await render(preview, overrides, `thinking-${bodyNode}`);
    expect(host.querySelector('summary')?.textContent).toBe('Thought for 20ms');
    expect(host.querySelector(`.markdown-body ${bodyNode}`)).not.toBeNull();
  });
});
