// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { GettingStartedDialog } from './GettingStartedDialog';

vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

describe('getting started walkthrough', () => {
  it('navigates all four pages, closes on finish and restarts on reopen', () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const close = vi.fn();
    const click = (label: string) => {
      const button = [...document.querySelectorAll('button')].find((element) => element.textContent === label);
      expect(button, label).toBeTruthy();
      act(() => button!.click());
    };
    try {
      act(() => root.render(createElement(GettingStartedDialog, { onClose: close })));
      expect(document.querySelector('.getting-started-counter')?.textContent).toBe('1 / 4');
      expect(document.querySelector('.getting-started-intro h3')?.textContent).toBe('onboarding.welcome.headline');
      expect(document.querySelectorAll('.getting-started-instructions li')).toHaveLength(3);
      expect(document.querySelector('.getting-started-outcome')).toBeTruthy();
      expect([...document.querySelectorAll('button')].find((button) => button.textContent === 'onboarding.previous')?.disabled).toBe(true);
      click('onboarding.next');
      expect(document.querySelector('.getting-started-page')?.getAttribute('aria-labelledby')).toBe('getting-started-model');
      expect(document.querySelector('.getting-started-intro h3')?.textContent).toBe('onboarding.model.headline');
      expect(document.querySelectorAll('.getting-started-instructions li')).toHaveLength(3);
      click('onboarding.previous');
      expect(document.querySelector('.getting-started-counter')?.textContent).toBe('1 / 4');
      click('onboarding.next'); click('onboarding.next'); click('onboarding.next');
      expect(document.querySelector('.getting-started-download')?.getAttribute('href')).toContain('RDC-Tool/releases');
      click('onboarding.finish'); expect(close).toHaveBeenCalledOnce();
      act(() => root.render(null));
      expect(document.querySelector('[data-testid="getting-started"]')).toBeNull();
      act(() => root.render(createElement(GettingStartedDialog, { onClose: close })));
      expect(document.querySelector('.getting-started-counter')?.textContent).toBe('1 / 4');
      act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      expect(close).toHaveBeenCalledTimes(2);
    } finally { act(() => root.unmount()); host.remove(); }
  });
});
