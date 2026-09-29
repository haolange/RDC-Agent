import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
