import { describe, expect, it } from 'vitest';
import { reduceComposerMenu } from './composerMenuState';

describe('reduceComposerMenu', () => {
  it('opens one menu and replaces any previous menu', () => {
    expect(reduceComposerMenu(null, { type: 'open', id: 'permission' })).toBe('permission');
    expect(reduceComposerMenu('permission', { type: 'open', id: 'agent' })).toBe('agent');
  });

  it('toggles the active menu closed and a different menu open', () => {
    expect(reduceComposerMenu('agent', { type: 'toggle', id: 'agent' })).toBeNull();
    expect(reduceComposerMenu('agent', { type: 'toggle', id: 'modelEffort' })).toBe('modelEffort');
    expect(reduceComposerMenu('modelEffort', { type: 'open', id: 'usage' })).toBe('usage');
  });

  it('closes only the matching menu', () => {
    expect(reduceComposerMenu('usage', { type: 'close' })).toBeNull();
    expect(reduceComposerMenu('usage', { type: 'close', id: 'usage' })).toBeNull();
    expect(reduceComposerMenu('usage', { type: 'close', id: 'agent' })).toBe('usage');
  });
});
