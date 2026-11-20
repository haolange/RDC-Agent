import { expect, it } from 'vitest';
import { connectionPhase } from './ProviderConnectSummary';
import type { ProviderConnectionDraft } from '../types';

const draft = (patch: Partial<ProviderConnectionDraft> = {}) => ({ busy: 'idle', error: '', ...patch }) as ProviderConnectionDraft;

it('reads connected only for a saved, unchanged connection; a passing test of unsaved changes says so', () => {
  expect(connectionPhase(draft(), false)).toBe('untested');
  expect(connectionPhase(draft(), true)).toBe('testPassed');
  expect(connectionPhase(draft(), true, true)).toBe('connected');
  expect(connectionPhase(draft(), false, true)).toBe('connected');
  expect(connectionPhase(draft({ error: 'Unauthorized' }), true, true)).toBe('failed');
  expect(connectionPhase(draft({ busy: 'testing' }), false)).toBe('testing');
});
