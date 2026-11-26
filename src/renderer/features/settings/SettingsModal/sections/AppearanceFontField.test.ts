// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AppearanceFontField } from './AppearanceFontField';
vi.mock('../../../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

it('keeps a multiword font name editable while settings writes are in flight', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  const onChange = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(AppearanceFontField, {
          kind: 'code',
          variant: 'dark',
          value: null,
          onChange,
        }),
      ),
    );
    const input = host.querySelector('input')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    for (const text of ['Example', 'Example ', 'Example Mono', '']) {
      await act(async () => {
        setValue.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(input.value).toBe(text);
    }
    expect(onChange.mock.calls.flat()).toEqual(['Example', 'Example Mono', null]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
