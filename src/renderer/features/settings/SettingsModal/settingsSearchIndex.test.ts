import { describe, expect, it } from 'vitest';
import type { SettingsSection } from './types';
import { matchSettingsSearchEntries, SETTINGS_SEARCH_INDEX } from './settingsSearchIndex';

const titles: Record<string, string> = {
  'settings.general': 'General',
  'userMenu.language': 'Language',
  'settings.personalization': 'Personalization',
  'settings.appearance': 'Appearance',
  'userMenu.fontScale': 'Font scale',
  'settings.appearanceReduceMotion': 'Reduce motion',
  'settings.workspace': 'Workspace',
  'settings.workspaceRuntimeRoot': 'RDX runtime root',
  'settings.models': 'Models',
  'settings.agentManifestTitle': 'Agents',
  'settings.skills': 'Skills',
  'settings.toolsAndExtensions': 'Tools',
  'settings.hooks': 'Hooks',
  'settings.policy': 'Policy',
  'settings.compactionThreshold': 'Compaction threshold',
};

describe('settingsSearchIndex', () => {
  it('covers every settings section at least once', () => {
    const sections = new Set(SETTINGS_SEARCH_INDEX.map((entry) => entry.section));
    const expected: SettingsSection[] = [
      'general', 'appearance', 'workspace', 'models', 'agents', 'skills', 'tools', 'hooks', 'policy',
    ];
    expect([...sections].sort()).toEqual([...expected].sort());
  });

  it('matches English and Chinese keywords', () => {
    const titleOf = (key: string) => titles[key] ?? key;
    expect(matchSettingsSearchEntries('language', titleOf).map((entry) => entry.id)).toContain('language');
    expect(matchSettingsSearchEntries('语言', titleOf).map((entry) => entry.id)).toContain('language');
    expect(matchSettingsSearchEntries('压缩', titleOf).map((entry) => entry.id)).toContain('compaction');
    expect(matchSettingsSearchEntries('agents', titleOf).map((entry) => entry.section)).toContain('agents');
  });
});
