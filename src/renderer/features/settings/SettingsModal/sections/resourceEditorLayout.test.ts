import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(`src/renderer/features/settings/SettingsModal/${path}`, 'utf8');

describe('resource editor layout contracts (not Browser geometry)', () => {
  it('uses viewport height at the narrow shell breakpoint instead of the desktop aspect ratio', () => {
    const shell = source('sections/settings-shell.css');
    const narrow = shell.slice(shell.indexOf('@media (max-width: 960px)'));
    expect(narrow).toContain('height: calc(100dvh - var(--modal-workbench-inset) * 2)');
    expect(narrow).toMatch(/\.settings-center-brand\s*\{\s*display: none;/);
    const mobile = shell.slice(shell.indexOf('@media (max-width: 640px)'));
    expect(mobile).toMatch(/\.settings-modal-backdrop\s*\{\s*padding: 0;/);
    expect(mobile).toContain('height: 100dvh');
    expect(mobile).toContain('width: 100vw');
    expect(mobile).not.toContain('height: 100%');
  });

  it('bounds stacked lists and lets the editor shrink without a forced split minimum', () => {
    const css = source('sections/resource-editor-layout.css');
    expect(css).toMatch(/\.settings-page-skills \.settings-resource-split\s*\{\s*min-height: 0;/);
    expect(css).not.toMatch(/min-height: calc\(var\(--control-height-md\) \* (10|14)\)/);
    const narrow = css.slice(css.indexOf('@container settings-panel (max-width: 60rem)'));
    expect(narrow).toContain('max-height: calc(var(--control-height-md) * 2)');
    expect(narrow).toContain('grid-template-rows: auto minmax(0, 1fr)');
    expect(narrow).toContain('position: sticky');
    expect(narrow).toContain('flex-direction: row');
  });

  it('routes full documents through shared fill sizing without private pixel caps', () => {
    const editor = source('sections/ScopedResourceEditor.tsx');
    expect(editor).toContain('sizing="fill"');
    expect(editor).toContain('settings-resource-document-field');
    expect(editor).not.toMatch(/AutosizeTextarea|maxHeight/);
    expect(source('settings-resources.css')).not.toMatch(/resize:\s*vertical|min-height:\s*100%/);
  });

  it('provides a shrinking flex control wrapper and settings-only empty surface', () => {
    const css = source('sections/resource-editor-layout.css');
    expect(css).toMatch(/\.settings-resource-document-field > \.settings-field-control\s*\{[^}]*display: flex;[^}]*flex: 1;[^}]*min-height: 0;/);
    expect(css).not.toMatch(/height:\s*100%/);
    expect(source('parts/settings-kit.css')).toMatch(/\.settings-resource-empty\.ui-empty-state\s*\{[^}]*border:[^}]*background:/);
  });

  it('uses compact MCP empty states but fill for independent Skills, Policy and Hooks pages', () => {
    expect(source('sections/RuntimeScopePanel.tsx')).toContain("emptyLayout={kind === 'skill' || kind === 'policy' || kind === 'hook' ? 'fill' : 'compact'}");
    expect(source('sections/settings-page-layout.css')).toMatch(/\.settings-page-policy > \.settings-block\s*\{\s*flex: 0 0 auto;/);
  });

  it('fills the Hooks page while preserving bounded, scrollable populated columns', () => {
    const css = source('sections/settings-page-layout.css');
    expect(css).toContain('.settings-center-panel:has(> .settings-page-hooks)');
    expect(css).toMatch(/\.settings-page-hooks\s*\{\s*flex: 1 1 0;\s*min-height: 0;/);
    expect(css).toMatch(/\.settings-page-hooks > \.settings-runtime-scope\s*\{\s*flex: 1;\s*min-height: 0;/);
    expect(css).toMatch(/\.settings-page-hooks \.settings-resource-list-column\s*\{\s*max-height: calc\(var\(--control-height-md\) \* 2\)/);
    const kit = source('parts/settings-kit.css');
    for (const column of ['list', 'detail']) {
      expect(kit).toMatch(new RegExp(`\\.settings-resource-${column}-column\\s*\\{[^}]*min-height: 0;[^}]*overflow-y: auto;`));
    }
  });
});
