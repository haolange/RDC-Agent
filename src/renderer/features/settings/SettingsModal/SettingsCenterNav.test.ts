// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SettingsCenterNav } from './SettingsCenterNav';

it('moves through results with the arrow keys and opens a provider found by name with Enter', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const openOllama = vi.fn();
  try {
    await act(async () => root.render(createElement(SettingsCenterNav, {
      sections: [{ id: 'general', label: 'General' }, { id: 'models', label: 'Models' }], activeSection: 'general',
      onSelectSection: () => {}, t: (key: string) => key,
      providers: [{ id: 'ollama', label: 'Ollama', open: openOllama }, { id: 'openai', label: 'OpenAI', open: vi.fn() }],
    })));
    const input = host.querySelector<HTMLInputElement>('[data-testid="settings-nav-search"] input, input[data-testid="settings-nav-search"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(input, 'llama'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    const options = () => [...host.querySelectorAll('[role="option"]')];
    expect(options().map((option) => option.textContent)).toEqual(['OllamaModels']);
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[0].id);
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(openOllama).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
