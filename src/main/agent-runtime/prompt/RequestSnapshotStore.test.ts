import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEnvelopeSnapshot } from '@shared/types/rdcRuntime';
import { RequestSnapshotStore } from './RequestSnapshotStore';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';

let rootPath = '';
let store: RequestSnapshotStore;

const sampleSnapshot = (overrides: Partial<RequestEnvelopeSnapshot> = {}): RequestEnvelopeSnapshot => ({
  id: 'snap-1',
  createdAt: '2026-07-20T00:00:00.000Z',
  sessionId: 'session-a',
  turnId: 'turn-1',
  callIndex: 1,
  route: { providerId: 'p', modelId: 'm', protocol: 'OpenAIResponses' },
  requestPlan: createTestRequestPlan({
    providerId: 'p',
    adapterId: 'openai-responses',
    catalogRevision: 'test-catalog',
    routeRevision: 'test-route',
    selectedModelId: 'm',
    effectiveModelId: 'm',
    appliedBindingIds: [],
    route: { protocol: 'OpenAIResponses', baseUrl: 'https://example.test', source: 'catalog' },
    headers: {},
    bodyPatch: {},
    contextBudgetTokens: 256_000,
    contextMode: 'normal',
    contextWindowTokens: 256_000,
    activeTierId: 'default',
    fastMode: false,
    reasoningWire: {
      selection: 'off',
      control: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
    },
  }),
  promptPlan: {
    id: 'plan',
    segments: [],
    systemPrompt: 'Authorization: [REDACTED]',
    totalTokenEstimate: 1,
    stablePrefix: { fingerprint: 'prefix', segmentIds: [], sourceHashes: [], tokenEstimate: 1, volatileSegmentIds: [] },
    metrics: { systemPrompt: 1, scopedInstructions: 0, skills: 0 },
    diagnostics: [],
  },
  messages: [{ role: 'user', content: 'hello' }],
  tools: [{ name: 'read_file' }],
  controls: {},
  reasoning: {
    semantic: 'opaque',
    source: 'provider',
    displayLabel: 'Reasoning metadata',
    carrier: 'opaque-provider-state',
    artifactFormat: 'provider.opaque',
    artifactVersion: 'v1',
    compatibilityGroup: 'test',
    continuation: 'exact-execution',
  },
  cache: {
    enabled: false,
    mode: 'none',
    keyCarrier: 'none',
    breakpointCarrier: 'none',
    ttl: 'none',
    breakpoint: 'none',
    stableSegmentIds: [],
    stableTokenEstimate: 0,
    providerReported: false,
    reason: 'test',
  },
  redactions: [{ path: 'promptPlan.systemPrompt', reason: 'credential' }],
  ...overrides,
});

beforeEach(() => {
  rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-snapshot-'));
  store = new RequestSnapshotStore(rootPath);
});

afterEach(() => {
  fs.rmSync(rootPath, { recursive: true, force: true });
});

describe('RequestSnapshotStore', () => {
  it('counts committed attempts across ordinary, auxiliary and child turns without reading request bodies', () => {
    store.write(sampleSnapshot());
    store.write(sampleSnapshot({ id: 'failed-2', callIndex: 2 }));
    store.write(sampleSnapshot({ id: 'compact', turnId: 'compaction-handoff-one' }));
    store.write(sampleSnapshot({ id: 'child', sessionId: 'session-a::subagent::one', turnId: 'child-turn' }));
    store.write(sampleSnapshot({ id: 'nested', sessionId: 'session-a::subagent::one::subagent::two' }));
    store.write(sampleSnapshot({ id: 'foreign', sessionId: 'session-a-other' }));
    const read = vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('request bodies must not be read'); });
    try {
      const usage = store.readUsage('session-a');
      expect(usage).toMatchObject({ scopeId: 'session-a', committedRequests: 5, isReservation: false,
        source: 'committed-request-snapshots' });
      expect(usage.scopes).toHaveLength(3);
      expect(usage.scopes.find(scope => scope.scopeKey === 'session-a')?.turns).toEqual([
        { turnId: 'compaction-handoff-one', committedRequests: 1 }, { turnId: 'turn-1', committedRequests: 2 },
      ]);
      expect(store.readUsage('session-a::subagent::one').committedRequests).toBe(2);
      expect(store.readUsage('session-a::subagent::one').scopes).toHaveLength(2);
      expect(store.readUsage('absent').committedRequests).toBe(0);
      expect(read).not.toHaveBeenCalled();
    } finally { read.mockRestore(); }
    store.complete('snap-1', 'session-a', 'turn-1', { inputTokens: 1, outputTokens: 1 });
    expect(store.readUsage('session-a').committedRequests).toBe(5);
    expect(new RequestSnapshotStore(rootPath).readUsage('session-a').committedRequests).toBe(5);
  });

  it('fails closed on an unreadable request inventory instead of returning zero attempts', () => {
    store.write(sampleSnapshot());
    const read = vi.spyOn(fs, 'readdirSync').mockImplementation(() => { throw new Error('EACCES'); });
    try { expect(() => store.readUsage('session-a')).toThrow('EACCES'); }
    finally { read.mockRestore(); }
  });

  it('rejects linked scope inventories without following them', () => {
    fs.mkdirSync(path.join(rootPath, 'foreign'));
    fs.symlinkSync(path.join(rootPath, 'foreign'), path.join(rootPath, 'session-a'), 'junction');
    expect(() => store.readUsage('session-a')).toThrow('REQUEST_USAGE_SCOPE_NOT_DIRECTORY');
  });

  it('rejects linked turn inventories and non-file commits instead of silently undercounting', () => {
    store.write(sampleSnapshot());
    const scope = path.join(rootPath, 'session-a');
    const target = path.join(rootPath, 'foreign');
    fs.mkdirSync(target);
    const linkedTurn = path.join(scope, 'linked-turn');
    fs.symlinkSync(target, linkedTurn, 'junction');
    expect(() => store.readUsage('session-a')).toThrow('REQUEST_USAGE_TURN_LINK_DENIED');
    fs.unlinkSync(linkedTurn);
    fs.mkdirSync(path.join(scope, 'turn-1', '002-non-file.json'));
    expect(() => store.readUsage('session-a')).toThrow('REQUEST_USAGE_COMMIT_NOT_FILE');
  });

  it('reports no committed attempts when no request store exists without creating it', () => {
    const missing = path.join(rootPath, 'not-created');
    expect(new RequestSnapshotStore(missing).readUsage('session-a').committedRequests).toBe(0);
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('writes, lists, and gets desensitized snapshots with redaction metadata', () => {
    const snapshot = sampleSnapshot();
    store.write(snapshot);

    const listed = store.list('session-a', 'turn-1');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe('snap-1');
    expect(listed[0]?.redactions.some((entry) => entry.reason === 'credential')).toBe(true);
    expect(listed[0]?.promptPlan.systemPrompt).toContain('[REDACTED]');

    const loaded = store.get('session-a', 'turn-1', 'snap-1');
    expect(loaded?.id).toBe('snap-1');
    expect(loaded?.route).toEqual(snapshot.route);
    expect(loaded?.redactions).toEqual(snapshot.redactions);

    store.complete('snap-1', 'session-a', 'turn-1', { inputTokens: 12, outputTokens: 3 });
    expect(store.get('session-a', 'turn-1', 'snap-1')?.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
  });

  it('projects prompt resources and mailbox commits without parsing full current requests', () => {
    const segment = {
      id: 'project-instruction', kind: 'scoped-instruction' as const, scope: 'project' as const,
      sourcePath: 'D:/project/AGENTS.md', sourceHash: 'source-hash', precedence: 1,
      content: 'instruction', stability: 'stable' as const, tokenEstimate: 2,
    };
    const delivery = { executionId: 'execution-1', generation: 1, direction: 'to_parent' as const, throughSequence: 2, messageIds: ['message-1'] };
    const snapshot = sampleSnapshot({ promptPlan: { ...sampleSnapshot().promptPlan, segments: [segment] }, mailboxDeliveries: [delivery] });
    store.write(snapshot);
    expect(store.nextCallIndex('session-a', 'turn-1')).toBe(2);
    const requestFile = fs.readdirSync(path.join(rootPath, 'session-a', 'turn-1')).find((name) => name.endsWith('.json'))!;
    fs.writeFileSync(path.join(rootPath, 'session-a', 'turn-1', requestFile), 'invalid full request', 'utf8');
    expect(store.listPromptSegments('session-a')).toEqual([segment]);
    expect(store.listMailboxDeliveries('session-a')).toEqual([delivery]);
  });

  it('reads legacy requests one at a time and retains the frozen plan once per turn', () => {
    const first = sampleSnapshot({ mailboxDeliveries: [{ executionId: 'first', generation: 1, direction: 'to_child', throughSequence: 1, messageIds: ['one'] }] });
    const second = sampleSnapshot({ id: 'snap-2', callIndex: 2, mailboxDeliveries: [{ executionId: 'second', generation: 1, direction: 'to_parent', throughSequence: 3, messageIds: ['two'] }] });
    const dir = path.join(rootPath, 'session-a', 'turn-1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '001-snap-1.json'), JSON.stringify(first), 'utf8');
    fs.writeFileSync(path.join(dir, '002-snap-2.json'), JSON.stringify(second), 'utf8');
    expect(store.listPromptSegments('session-a')).toEqual(first.promptPlan.segments);
    expect(store.listMailboxDeliveries('session-a').map((item) => item.executionId)).toEqual(['first', 'second']);
  });
});
