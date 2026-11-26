import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ dialog: { showMessageBox: vi.fn() } }));
vi.mock('../settings/settings-core/SettingsService', () => ({ settingsService: { snapshot: vi.fn() } }));

import { RendererCrashPolicy } from './rendererRecovery';
import { rendererStartupFailureText } from './rendererStartupFailure';

describe('renderer crash policy', () => {
  it('reloads once, shows the failure page on a second crash within a minute, and asks natively when that page dies', () => {
    const policy = new RendererCrashPolicy();
    expect(policy.decide(0, false)).toBe('reload');
    expect(policy.decide(30_000, false)).toBe('crash-page');
    expect(policy.decide(35_000, true)).toBe('native-dialog');
    expect(policy.decide(200_000, false)).toBe('reload');
    policy.reset();
    expect(policy.decide(201_000, false)).toBe('reload');
  });

  it('words the native dialog in the committed language with Reload and Quit', () => {
    expect(rendererStartupFailureText('zh-CN', 'crashed')).toMatchObject({
      message: 'RDC-Agent 的窗口无法启动。',
      buttons: ['重新加载', '退出'],
    });
    const english = rendererStartupFailureText('en', 'load-failed:-6');
    expect(english.buttons).toEqual(['Reload', 'Quit']);
    expect(english.detail).toContain('load-failed:-6');
  });
});
