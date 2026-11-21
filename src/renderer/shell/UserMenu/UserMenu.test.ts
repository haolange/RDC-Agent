import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAppSettings } from '@shared/constants/appSettingsDefaults';
import { enLanguage } from '../../i18n/locales/en/language';
import { zhLanguage } from '../../i18n/locales/zh-CN/language';
import { UserMenu } from './index';

const DEFAULT_SETTINGS = createDefaultAppSettings();

vi.mock('react-dom', async (original) => ({ ...await original<typeof import('react-dom')>(), createPortal: (node: unknown) => node }));
vi.mock('../../lib/useDynStyle', () => ({ useDynStyle: () => ({}) }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../patterns/ProfileAvatar', () => ({ ProfileAvatar: () => null }));

afterEach(() => { vi.unstubAllGlobals(); });

describe('UserMenu', () => {
  it('uses compact language autonyms consistently in both locales', () => {
    expect(enLanguage).toMatchObject({ 'language.zh': '简体中文', 'language.en': 'English' });
    expect(zhLanguage).toMatchObject({ 'language.zh': '简体中文', 'language.en': 'English' });
  });

  it('holds only the profile and the Settings entry; theme, language and font size live in Settings', () => {
    vi.stubGlobal('document', { body: {} });
    const html = renderToStaticMarkup(createElement(UserMenu, { open: true, anchorRect: null, anchorElement: null,
      settings: DEFAULT_SETTINGS, onClose: vi.fn(), onOpenSettings: vi.fn() }));
    expect(html).toContain('user-menu-popover is-visible');
    expect(html).toContain(DEFAULT_SETTINGS.profile.nickname);
    expect(html).toMatch(/class="button button-primary user-menu-settings-button"[^>]*data-testid="open-settings-entry"/);
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('user-menu-preferences');
  });
});
