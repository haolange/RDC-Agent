import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EXECUTION_OFFER_SCHEMA } from '@shared/types/executionOffer';
import { StorageIo } from './StorageIo';
import {
  EXECUTION_OFFER_FILE,
  ExecutionOfferStore,
  REMOVED_HANDOFF_STATE_FILE,
  executionOfferMatches,
} from './ExecutionOfferStore';

describe('ExecutionOfferStore', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  function createStore() {
    const root = roots[roots.length - 1]!;
    return new ExecutionOfferStore({
      io: new StorageIo(),
      sessions: { findSessionLocation: () => ({ sessionPath: root }) },
    });
  }

  function offer(overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: EXECUTION_OFFER_SCHEMA,
      sourceAgentId: 'debugger',
      targetAgentId: 'general',
      plan: { uri: 'session://plans/plan-frozen.md', hash: 'a'.repeat(64) },
      requiredSkillIds: ['renderdoc-execution', 'debugger-causal-method'],
      label: 'Execute with General',
      prompt: 'Execute the frozen plan.',
      approvedAt: 1,
      ...overrides,
    };
  }

  it('writes, reads, overwrites, and clears an offer', async () => {
    roots.push(await mkdtemp(path.join(os.tmpdir(), 'rdx-execution-offer-')));
    const store = createStore();
    store.write('sess', offer());
    expect(store.read('sess')?.targetAgentId).toBe('general');
    store.write('sess', offer({ requiredSkillIds: ['renderdoc-execution'] }));
    expect(store.read('sess')?.requiredSkillIds).toEqual(['renderdoc-execution']);
    store.clear('sess');
    expect(store.read('sess')).toBeNull();
    expect(existsSync(path.join(roots[0]!, EXECUTION_OFFER_FILE))).toBe(false);
  });

  it('unlinks removed handoff-state.json without parsing it', async () => {
    roots.push(await mkdtemp(path.join(os.tmpdir(), 'rdx-execution-offer-')));
    const stale = path.join(roots[0]!, REMOVED_HANDOFF_STATE_FILE);
    writeFileSync(stale, '{not-json');
    const store = createStore();
    store.discardRemovedHandoffState('sess');
    expect(existsSync(stale)).toBe(false);
    expect(store.read('sess')).toBeNull();
  });

  it('matches only the same target and frozen plan', () => {
    const current = offer();
    expect(executionOfferMatches(current, { agentId: 'general', planHash: 'a'.repeat(64), planUri: current.plan.uri })).toBe(true);
    expect(executionOfferMatches(current, { agentId: 'analyzer', planHash: 'a'.repeat(64) })).toBe(false);
    expect(executionOfferMatches(current, { agentId: 'general', planHash: 'b'.repeat(64) })).toBe(false);
  });
});
