import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RequestEnvelopeSnapshot } from '@shared/types/rdxRuntime';
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
  rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rdx-snapshot-'));
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
});
