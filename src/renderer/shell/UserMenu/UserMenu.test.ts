import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../stores/defaultAppSettings';
import type { TabsProps } from '../../ui/Tabs';
import { enLanguage } from '../../i18n/locales/en/language';
import { zhLanguage } from '../../i18n/locales/zh-CN/language';
import { UserMenu } from './index';

const controls = vi.hoisted(() => [] as TabsProps[]);
vi.mock('react-dom', async (original) => ({ ...await original<typeof import('react-dom')>(), createPortal: (node: unknown) => node }));
vi.mock('../../lib/useDynStyle', () => ({ useDynStyle: () => ({}) }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../patterns/ProfileAvatar', () => ({ ProfileAvatar: () => null }));
vi.mock('../../ui/Tabs', async (original) => {
  const { Tabs } = await original<typeof import('../../ui/Tabs')>();
  return { Tabs: (props: TabsProps) => { controls.push(props); return createElement(Tabs, props); } };
});

afterEach(() => { controls.length = 0; vi.unstubAllGlobals(); });
describe('UserMenu shared preference selectors', () => {
  it('uses compact language autonyms consistently in both locales', () => {
    expect(enLanguage).toMatchObject({ 'language.zh': '简体中文', 'language.en': 'English' });
    expect(zhLanguage).toMatchObject({ 'language.zh': '简体中文', 'language.en': 'English' });
  });

  it('renders three selected, keyboard-reachable segmented groups and applies changes immediately', () => {
    vi.stubGlobal('document', { body: {} });
    const onLanguageChange = vi.fn();
    const onThemeChange = vi.fn();
    const onFontScaleChange = vi.fn();
    const onClose = vi.fn();
    const html = renderToStaticMarkup(createElement(UserMenu, { open: true, anchorRect: null, anchorElement: null,
      settings: DEFAULT_SETTINGS, onClose, onOpenSettings: vi.fn(), onLanguageChange, onThemeChange, onFontScaleChange }));
    expect(html.match(/role="tablist"/g)).toHaveLength(3);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(3);
    expect(html.match(/tabindex="0"/g)).toHaveLength(3);
    expect(html).not.toContain('user-menu-pill');
    expect(html).toMatch(/class="button button-primary user-menu-settings-button"[^>]*data-testid="open-settings-entry"/);
    expect(controls.every(control => control.variant === 'segmented' && control.fullWidth === true)).toBe(true);
    expect(controls.map(control => control.value)).toEqual([
      DEFAULT_SETTINGS.appearance.language, DEFAULT_SETTINGS.appearance.theme, DEFAULT_SETTINGS.appearance.fontScale,
    ]);
    controls[0].onChange('en'); controls[1].onChange('system'); controls[2].onChange('large');
    expect(onLanguageChange).toHaveBeenCalledWith('en');
    expect(onThemeChange).toHaveBeenCalledWith('system');
    expect(onFontScaleChange).toHaveBeenCalledWith('large');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('uses the measured, viewport-fit popover state without legacy visibility or width fallbacks', () => {
    vi.stubGlobal('document', { body: {} });
    const html = renderToStaticMarkup(createElement(UserMenu, { open: true, anchorRect: null, anchorElement: null,
      settings: DEFAULT_SETTINGS, onClose: vi.fn(), onOpenSettings: vi.fn(), onLanguageChange: vi.fn(),
      onThemeChange: vi.fn(), onFontScaleChange: vi.fn() }));
    expect(html).toContain('user-menu-popover is-visible');
    expect(html).not.toContain('user-menu-popover visible');
    expect(html).toContain('user-menu-preferences');
  });
});
