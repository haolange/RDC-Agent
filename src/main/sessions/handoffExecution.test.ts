import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HandoffContract } from '@shared/types/handoffContract';
import { HandoffStateStore, type PrepareHandoffInput } from './HandoffStateStore';
import { StorageIo } from './StorageIo';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-cycles-')); roots.push(root);
  const store = new HandoffStateStore({ io: new StorageIo(), sessions: { findSessionLocation: () => ({ sessionPath: root }) } } as never);
  return { root, store };
}
const plan = { uri: 'session://plans/strategy.md', hash: 'a'.repeat(64) };
const checkpoint = { uri: 'session://investigation/checkpoint.json', hash: 'b'.repeat(64) };
function dispatch(store: HandoffStateStore, source: string, target: string, turn: string, contract: HandoffContract) {
  const chain = store.computeNextChain('session', source, turn);
  const input: PrepareHandoffInput = { ...chain, sourceTurnId: turn, sourceRequestId: 'req-' + turn,
    sourceAgentId: source, toAgentId: target, prompt: '中文交接摘要：输入、证据、缺口与下一步。', label: '交接', declaredModel: null, send: true, contract };
  const prepared = store.prepare('session', input);
  store.commit('session', turn);
  const nextTurn = 'continue-' + prepared.handoffId;
  store.consume('session', prepared.handoffId, nextTurn);
  return { prepared, nextTurn, input };
}
function execution(): HandoffContract { return { intent: 'execute', plan, requiredSkillIds: ['renderdoc-execution'], returnTo: 'debugger', deliveryRequirements: '更新 Checkpoint，提供证据与未解问题。' }; }

describe('two complete handoff cycles', () => {
  it.each([false, true])('permits both evaluations and rejects cycle three (initial route=%s)', route => {
    const { store } = setup();
    let turn = 'user-turn';
    if (route) turn = dispatch(store, 'general', 'debugger', turn, { intent: 'route' }).nextTurn;
    let root = '';
    for (let cycle = 0; cycle < 2; cycle++) {
      const run = dispatch(store, 'debugger', 'general', turn, execution()); root = run.prepared.chainRoot;
      const before = store.readDocument('session')!.history!.length;
      // Small Loop evidence work does not mutate handoff history or reserve a cycle.
      expect(store.computeNextChain('session', 'general', run.nextTurn).chainRoot).toBe(root);
      expect(store.readDocument('session')!.history).toHaveLength(before);
      expect(() => store.consume('session', run.prepared.handoffId, run.nextTurn)).toThrow(/STATE_CONFLICT/);
      const returned = dispatch(store, 'general', 'debugger', run.nextTurn, { intent: 'return', executionHandoffId: run.prepared.handoffId, artifacts: [checkpoint] });
      expect(returned.prepared.chainRoot).toBe(root);
      turn = returned.nextTurn;
    }
    const history = store.readDocument('session')!.history!;
    expect(history.filter(entry => entry.contract.intent === 'execute')).toHaveLength(2);
    expect(history.filter(entry => entry.contract.intent === 'return')).toHaveLength(2);
    expect(() => dispatch(store, 'debugger', 'general', turn, execution())).toThrow(/CYCLE_LIMIT|CHAIN_LIMIT/);
    expect(() => dispatch(store, 'debugger', 'general', turn, { intent: 'route' })).toThrow(/STATE_CONFLICT|CHAIN_LIMIT/);
    expect(store.readDocument('session')!.history).toHaveLength(history.length);
    expect(store.computeNextChain('session', 'debugger', 'new-user-instruction').chainRoot).not.toBe(root);
  });

  it('rejects a forged return target, binding id and dispatcher', () => {
    const { store } = setup();
    const run = dispatch(store, 'debugger', 'general', 'user', execution());
    const contract = { intent: 'return' as const, executionHandoffId: run.prepared.handoffId, artifacts: [checkpoint] };
    expect(() => dispatch(store, 'general', 'analyzer', run.nextTurn, contract)).toThrow(/STATE_CONFLICT/);
    expect(() => dispatch(store, 'general', 'debugger', run.nextTurn, { ...contract, executionHandoffId: 'forged' })).toThrow(/STATE_CONFLICT/);
    expect(() => dispatch(store, 'debugger', 'general', 'new-user', { ...execution(), returnTo: 'analyzer' } as HandoffContract)).toThrow(/returnTo/);
    expect(store.readDocument('session')!.history).toHaveLength(1);
  });

  it('rejects noncurrent handoff storage without writing or resuming it', () => {
    const { root, store } = setup();
    const original = '{"schemaVersion":"1","active":{"handoffId":"old","lifecycle":"committed","send":true}}';
    fs.writeFileSync(path.join(root, 'handoff-state.json'), original);
    expect(() => store.hydrate('session')).toThrow(/STORAGE_SCHEMA/);
    expect(fs.readFileSync(path.join(root, 'handoff-state.json'), 'utf8')).toBe(original);
  });
});
