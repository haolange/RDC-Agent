import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ directory: '' }));
vi.mock('./AppPathService', () => ({ appPathService: { getAppStatePaths: () => ({ profileStatePath: state.directory }) } }));
import { acknowledgeGettingStarted, hasSeenGettingStarted } from './GettingStartedState';
afterEach(() => { if (state.directory) fs.rmSync(state.directory, { recursive: true, force: true }); });
it('persists only an idempotent UI acknowledgement, independent of configuration', () => {
  state.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-guide-'));
  expect(hasSeenGettingStarted()).toBe(false);
  acknowledgeGettingStarted(); acknowledgeGettingStarted();
  expect(hasSeenGettingStarted()).toBe(true);
  expect(fs.readdirSync(state.directory)).toEqual(['getting-started.seen']);
});
