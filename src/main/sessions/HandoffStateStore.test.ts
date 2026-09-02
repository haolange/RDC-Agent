import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HANDOFF_CHAIN_LIMIT,
  HANDOFF_ERROR,
  isConsumableHandoff,
  type ProfileHandoffCancelReason,
} from '@shared/types/profileHandoff';
import { StorageIo } from './StorageIo';
import { HandoffStateStore } from './HandoffStateStore';
import { HANDOFF_STATE_MIGRATIONS } from './handoffStateSchema';
import { StorageSchemaError } from './storageSchema';
import { projectSessionAgentId } from './projectSessionHandoff';

const roots: string[] = [];

function createStore() {
  const sessionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-handoff-'));
  roots.push(sessionPath);
  const io = new StorageIo();
  const store = new HandoffStateStore({
    io,
    sessions: {
      findSessionLocation: () => ({ project: { projectId: 'proj' }, sessionPath }),
    },
  } as never);
  return { store, sessionPath, io };
}

function prepare(store: HandoffStateStore, overrides: Partial<Parameters<HandoffStateStore['prepare']>[1]> = {}) {
  return store.prepare('sess_1', {
    sourceTurnId: 'turn-1',
    sourceRequestId: 'req-1',
    sourceAgentId: 'plan',
    toAgentId: 'edit',
    prompt: 'Continue as edit.',
    label: 'Implement',
    declaredModel: null,
    send: true,
    chainRoot: 'root-1',
    depth: 1,
    ...overrides,
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('HandoffStateStore durable lifecycle', () => {
  it('walks prepared → committed → consumed and records each cancel reason', () => {
    const { store } = createStore();
    const prepared = prepare(store);
    expect(prepared.lifecycle).toBe('prepared');
    const committed = store.commit('sess_1', 'turn-1');
    expect(committed.lifecycle).toBe('committed');
    const consumed = store.consume('sess_1', committed.handoffId, 'turn-continue');
    expect(consumed).toMatchObject({
      lifecycle: 'consumed',
      continuationTurnId: 'turn-continue',
    });
    expect(store.getActive('sess_1')).toBeNull();

    const reasons: ProfileHandoffCancelReason[] = [
      'user_stop',
      'rewrite',
      'branch',
      'manual_switch',
      'session_close',
      'restart_degrade',
      'invalid_model',
      'depth_exceeded',
      'superseded',
    ];
    for (const reason of reasons) {
      const next = prepare(store, {
        sourceTurnId: `turn-${reason}`,
        sourceRequestId: `req-${reason}`,
        chainRoot: `root-${reason}`,
      });
      expect(store.cancel('sess_1', reason)).toMatchObject({
        handoffId: next.handoffId,
        lifecycle: 'cancelled',
        cancelReason: reason,
      });
      expect(store.getActive('sess_1')).toBeNull();
    }
  });

  it('keeps createPreparedDraft in memory until persist, and abandons without writing', () => {
    const { store, sessionPath } = createStore();
    const draft = store.createPreparedDraft('sess_1', {
      sourceTurnId: 'turn-1',
      sourceRequestId: 'req-1',
      sourceAgentId: 'plan',
      toAgentId: 'edit',
      prompt: 'Continue as edit.',
      label: 'Implement',
      declaredModel: null,
      send: true,
      chainRoot: 'root-1',
      depth: 1,
    });
    expect(draft.lifecycle).toBe('prepared');
    expect(store.getActive('sess_1')).toBeNull();
    expect(fs.existsSync(path.join(sessionPath, 'handoff-state.json'))).toBe(false);
    expect(() => store.createPreparedDraft('sess_1', {
      sourceTurnId: 'turn-2',
      sourceRequestId: 'req-2',
      sourceAgentId: 'plan',
      toAgentId: 'edit',
      prompt: 'Other.',
      label: 'Other',
      declaredModel: null,
      send: false,
      chainRoot: 'root-2',
      depth: 1,
    })).toThrow(/HANDOFF_ALREADY_ACTIVE/);
    store.abandonDraft('sess_1', draft.handoffId);
    expect(store.getActive('sess_1')).toBeNull();
    const persisted = store.prepare('sess_1', {
      sourceTurnId: 'turn-1',
      sourceRequestId: 'req-1',
      sourceAgentId: 'plan',
      toAgentId: 'edit',
      prompt: 'Continue as edit.',
      label: 'Implement',
      declaredModel: null,
      send: true,
      chainRoot: 'root-1',
      depth: 1,
      handoffId: draft.handoffId,
    });
    expect(persisted.handoffId).toBe(draft.handoffId);
    expect(store.getActive('sess_1')?.handoffId).toBe(draft.handoffId);
  });

  it('writes prepared then commits, and rejects a second active handoff', () => {
    const { store } = createStore();
    const prepared = prepare(store);
    expect(prepared.lifecycle).toBe('prepared');
    expect(prepared.declaredModel).toBeNull();
    expect(store.getActive('sess_1')?.handoffId).toBe(prepared.handoffId);
    const committed = store.commit('sess_1', 'turn-1');
    expect(committed.lifecycle).toBe('committed');
    expect(() => prepare(store, { sourceTurnId: 'turn-2', sourceRequestId: 'req-2' }))
      .toThrow(/HANDOFF_ALREADY_ACTIVE/);
  });

  it('consumes a committed handoff and records history', () => {
    const { store, sessionPath, io } = createStore();
    prepare(store);
    store.commit('sess_1', 'turn-1');
    const consumed = store.consume('sess_1', store.getActive('sess_1')!.handoffId);
    expect(consumed.lifecycle).toBe('consumed');
    expect(store.getActive('sess_1')).toBeNull();
    const document = io.readJson(path.join(sessionPath, 'handoff-state.json'), HANDOFF_STATE_MIGRATIONS);
    expect(document?.history?.[0]?.lifecycle).toBe('consumed');
  });

  it('cancels prepared and committed on Stop', () => {
    const { store } = createStore();
    prepare(store);
    expect(store.cancel('sess_1', 'user_stop')?.lifecycle).toBe('cancelled');
    expect(store.getActive('sess_1')).toBeNull();
    prepare(store, { sourceTurnId: 'turn-2', sourceRequestId: 'req-2', chainRoot: 'root-2' });
    store.commit('sess_1', 'turn-2');
    expect(store.cancel('sess_1', 'user_stop')?.cancelReason).toBe('user_stop');
  });

  it('cancels on rewrite and manual Agent switch', () => {
    const { store } = createStore();
    prepare(store);
    expect(store.cancel('sess_1', 'rewrite')?.cancelReason).toBe('rewrite');
    prepare(store, { sourceTurnId: 'turn-2', sourceRequestId: 'req-2', chainRoot: 'root-2' });
    expect(store.cancel('sess_1', 'manual_switch')?.cancelReason).toBe('manual_switch');
  });

  it('rejects a chain deeper than 3 at prepare without writing', () => {
    const { store, sessionPath } = createStore();
    expect(() => prepare(store, { depth: HANDOFF_CHAIN_LIMIT + 1 })).toThrow(/HANDOFF_CHAIN_LIMIT/);
    expect(fs.existsSync(path.join(sessionPath, 'handoff-state.json'))).toBe(false);
  });

  it('continues the same user root after consume and starts a new root otherwise', () => {
    const { store } = createStore();
    prepare(store, { chainRoot: 'root-a', depth: 1 });
    store.commit('sess_1', 'turn-1');
    store.consume('sess_1', store.getActive('sess_1')!.handoffId, 'turn-continue');
    expect(store.computeNextChain('sess_1', 'edit', 'turn-continue')).toEqual({
      chainRoot: 'root-a',
      depth: 2,
    });
    expect(store.computeNextChain('sess_1', 'debugger', 'turn-continue').depth).toBe(1);
  });

  it('starts a new root for a user-initiated message after a depth-3 consume', () => {
    const { store } = createStore();
    prepare(store, { chainRoot: 'root-a', depth: 3, toAgentId: 'edit' });
    store.commit('sess_1', 'turn-1');
    store.consume('sess_1', store.getActive('sess_1')!.handoffId, 'turn-continue');
    expect(store.computeNextChain('sess_1', 'edit', 'turn-continue')).toEqual({
      chainRoot: 'root-a',
      depth: 4,
    });
    expect(() => prepare(store, {
      sourceTurnId: 'turn-continue',
      sourceRequestId: 'req-continue',
      chainRoot: 'root-a',
      depth: 4,
    })).toThrow(/HANDOFF_CHAIN_LIMIT/);
    const next = store.computeNextChain('sess_1', 'edit', 'turn-user-new');
    expect(next.depth).toBe(1);
    expect(next.chainRoot).not.toBe('root-a');
    expect(prepare(store, {
      sourceTurnId: 'turn-user-new',
      sourceRequestId: 'req-user-new',
      chainRoot: next.chainRoot,
      depth: next.depth,
    }).lifecycle).toBe('prepared');
  });

  it('allows a new prepare after a source-turn error cancels prepared', () => {
    const { store } = createStore();
    prepare(store);
    expect(store.cancel('sess_1', 'superseded')?.lifecycle).toBe('cancelled');
    expect(store.getActive('sess_1')).toBeNull();
    expect(prepare(store, { sourceTurnId: 'turn-2', sourceRequestId: 'req-2' }).lifecycle).toBe('prepared');
  });

  it('allows a new prepare after auto-send preflight failure cancels committed', () => {
    const { store } = createStore();
    prepare(store);
    store.commit('sess_1', 'turn-1');
    expect(store.getActive('sess_1')?.lifecycle).toBe('committed');
    expect(store.cancel('sess_1', 'invalid_model')?.cancelReason).toBe('invalid_model');
    expect(store.getActive('sess_1')).toBeNull();
    expect(prepare(store, { sourceTurnId: 'turn-auto', sourceRequestId: 'req-auto' }).lifecycle)
      .toBe('prepared');
  });

  it('allows a new prepare after persistConversationSnapshot failure cancels prepared', () => {
    const { store } = createStore();
    prepare(store);
    expect(store.getActive('sess_1')?.lifecycle).toBe('prepared');
    expect(store.cancel('sess_1', 'superseded')?.cancelReason).toBe('superseded');
    expect(store.getActive('sess_1')).toBeNull();
    expect(prepare(store, { sourceTurnId: 'turn-persist', sourceRequestId: 'req-persist' }).lifecycle)
      .toBe('prepared');
  });

  it('does not auto-fire a committed send:true handoff after restart hydrate', () => {
    const { store } = createStore();
    const prepared = prepare(store, { send: true });
    store.commit('sess_1', 'turn-1');
    expect(store.isLiveThisProcess(prepared.handoffId)).toBe(true);
    store.forgetLiveHandoffs();
    const degraded = store.hydrate('sess_1');
    expect(degraded).toMatchObject({
      lifecycle: 'cancelled',
      cancelReason: 'restart_degrade',
    });
    expect(store.getActive('sess_1')).toBeNull();
    expect(store.isLiveThisProcess(prepared.handoffId)).toBe(false);
  });

  it('keeps a same-process prepared handoff across hydrate', () => {
    const { store } = createStore();
    const prepared = prepare(store);
    expect(store.hydrate('sess_1')?.handoffId).toBe(prepared.handoffId);
    expect(store.getActive('sess_1')?.lifecycle).toBe('prepared');
  });

  it('fails closed on an unknown higher schema version', () => {
    const { sessionPath, io } = createStore();
    const filePath = path.join(sessionPath, 'handoff-state.json');
    fs.writeFileSync(filePath, JSON.stringify({
      schemaVersion: '99',
      active: null,
    }), 'utf8');
    expect(() => io.readJson(filePath, HANDOFF_STATE_MIGRATIONS)).toThrow(StorageSchemaError);
    expect(() => io.readJson(filePath, HANDOFF_STATE_MIGRATIONS)).toThrow(/STORAGE_SCHEMA_UNSUPPORTED/);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('rejects illegal consume/commit transitions', () => {
    const { store } = createStore();
    expect(() => store.commit('sess_1', 'turn-1')).toThrow(/HANDOFF_STATE_CONFLICT/);
    prepare(store);
    expect(() => store.consume('sess_1', 'missing')).toThrow(/HANDOFF_STATE_CONFLICT/);
    expect(() => store.commit('sess_1', 'other-turn')).toThrow(/HANDOFF_STATE_CONFLICT/);
  });

  it('projects toAgentId while a committed handoff is unconsumed', () => {
    const { store } = createStore();
    prepare(store, { send: false });
    store.commit('sess_1', 'turn-1');
    const session = {
      sessionId: 'sess_1',
      projectId: 'proj',
      title: 't',
      goal: '',
      sessionPath: 'D:/sess',
      createdAt: 1,
      updatedAt: 1,
      agentId: 'plan',
    };
    expect(projectSessionAgentId(session, store.getActive('sess_1'))).toBe('edit');
    expect(isConsumableHandoff({ handoffId: store.getActive('sess_1')!.handoffId }, store.getActive('sess_1'))).toBe(true);
    store.cancel('sess_1', 'user_stop');
    expect(projectSessionAgentId(session, store.getActive('sess_1'))).toBe('plan');
    expect(isConsumableHandoff({ handoffId: 'handoff-1' }, store.getActive('sess_1'))).toBe(false);
  });
});

describe('Handoff error codes', () => {
  it('exports the required fail-closed codes', () => {
    expect(HANDOFF_ERROR).toMatchObject({
      REQUIRES_FROZEN_PLAN: 'HANDOFF_REQUIRES_FROZEN_PLAN',
      NOT_DECLARED: 'HANDOFF_NOT_DECLARED',
      TARGET_DISABLED: 'HANDOFF_TARGET_DISABLED',
      ALREADY_ACTIVE: 'HANDOFF_ALREADY_ACTIVE',
      CHAIN_LIMIT: 'HANDOFF_CHAIN_LIMIT',
      MODEL_INVALID: 'HANDOFF_MODEL_INVALID',
      STATE_CONFLICT: 'HANDOFF_STATE_CONFLICT',
      RESTART_DEGRADED: 'HANDOFF_RESTART_DEGRADED',
    });
  });
});
