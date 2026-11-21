import { expect, it } from 'vitest';
import { COMMON_ICONS } from './icons/commonIcons';
import { INVESTIGATION_ICONS } from './icons/investigationIcons';
import { KNOWLEDGE_ICONS } from './icons/knowledgeIcons';
import { SHELL_ICONS } from './icons/shellIcons';
import { TRANSCRIPT_ICONS } from './icons/transcriptIcons';

const TABLES = { COMMON_ICONS, SHELL_ICONS, TRANSCRIPT_ICONS, KNOWLEDGE_ICONS, INVESTIGATION_ICONS };

it('gives every glyph exactly one owner table so the merged registry never shadows a name', () => {
  const owners = new Map<string, string[]>();
  for (const [table, icons] of Object.entries(TABLES)) {
    for (const name of Object.keys(icons)) owners.set(name, [...(owners.get(name) ?? []), table]);
  }
  expect([...owners].filter(([, tables]) => tables.length > 1)).toEqual([]);
});

it('names glyphs in kebab case and draws each with at least one primitive', () => {
  for (const icons of Object.values(TABLES)) {
    for (const [name, parts] of Object.entries(icons)) {
      expect(name).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(parts.length).toBeGreaterThan(0);
    }
  }
});
