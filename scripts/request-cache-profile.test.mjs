import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadSnapshots, profileRequests, renderMarkdown } from './request-cache-profile.mjs';

const SECRET_TEXT = 'USER-CONTENT-SENTINEL';
const core = { id: 'core:agent-loop.md', kind: 'core-contract', content: `core ${SECRET_TEXT}` };
const skill = { id: 'skill:rdc-tool-shell', kind: 'preloaded-skill', content: 'method text' };
const permission = (revision) => ({
  id: 'runtime:permission',
  kind: 'runtime-fact',
  content: `Mode: auto\nRevision: ${revision}`,
});
const user = { role: 'user', content: `find the cause ${SECRET_TEXT}`, timestamp: 1 };
const call = (id) => ({
  role: 'assistant',
  content: [
    { type: 'thinking', redacted: true },
    { type: 'toolCall', id, name: 'shell', arguments: { rdc: { operation: 'rd.texture.get_pixel' } } },
  ],
  model: 'm',
  provider: 'p',
  usage: {},
  stopReason: 'toolUse',
  timestamp: 2,
});
const result = (id, text) => ({
  role: 'toolResult',
  toolCallId: id,
  toolName: 'shell',
  isError: false,
  content: [{ type: 'text', text }],
  timestamp: 3,
});
const tail = { role: 'user', content: 'ephemeral hint', timestamp: 4 };

function snapshot(callIndex, { segments, messages, tools = [{ name: 'shell' }], usage, redactions = [] }) {
  return {
    id: `llm-call-${callIndex}`,
    createdAt: `2026-11-18T00:00:0${callIndex}.000Z`,
    completedAt: `2026-11-18T00:00:0${callIndex}.500Z`,
    sessionId: 'sess_a',
    turnId: 'turn_1',
    callIndex,
    route: { providerId: 'chatgpt-account', modelId: 'gpt', protocol: 'OpenAIResponses' },
    promptPlan: { segments, systemPrompt: segments.map((segment) => segment.content).join('\n\n') },
    messages,
    tools,
    cache: { enabled: false },
    usage,
    redactions,
  };
}

function writeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-request-profile-'));
  const dir = path.join(root, 'sess_a', 'turn_1');
  fs.mkdirSync(dir, { recursive: true });
  const hash = (index) => [
    { path: `messages[${index}].content[0]`, reason: 'protected opaque reasoning', hash: `h${index}` },
  ];
  const requests = [
    snapshot(0, {
      segments: [core, skill, permission(1)],
      messages: [user],
      usage: { inputTokens: 1000, cacheReadTokens: 0 },
    }),
    snapshot(1, {
      segments: [core, skill, permission(1)],
      messages: [user, call('a'), result('a', 'x'.repeat(4000))],
      usage: { inputTokens: 2000, cacheReadTokens: 1000 },
      redactions: hash(1),
    }),
    snapshot(2, {
      segments: [core, skill, permission(1)],
      messages: [user, call('a'), result('a', 'x'.repeat(4000)), tail],
      usage: { inputTokens: 2100, cacheReadTokens: 0 },
      redactions: hash(1),
    }),
    snapshot(3, {
      segments: [core, skill, permission(1)],
      messages: [user, call('a'), result('a', 'x'.repeat(4000)), call('b'), result('b', 'y')],
      usage: { inputTokens: 2200, cacheReadTokens: 2000 },
      redactions: [...hash(1), ...hash(3)],
    }),
    snapshot(4, {
      segments: [core, skill, permission(2)],
      messages: [user, call('a'), result('a', 'x'.repeat(4000)), call('b'), result('b', 'y')],
      usage: { inputTokens: 2200, cacheReadTokens: 100 },
      redactions: [...hash(1), ...hash(3)],
    }),
    snapshot(5, {
      segments: [core, skill, permission(2)],
      tools: [{ name: 'shell' }, { name: 'subagent' }],
      messages: [user],
      usage: { inputTokens: 900, cacheReadTokens: 0 },
    }),
  ];
  for (const { completedAt, usage, ...request } of requests) {
    const name = `${String(request.callIndex).padStart(3, '0')}-${request.id}`;
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(request));
    fs.writeFileSync(
      path.join(dir, `${name}.completion.meta`),
      JSON.stringify({ completedAt, usage: { ...usage, outputTokens: 0, estimated: false } }),
    );
  }
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ unrelated: true }));
  return root;
}

test('locates the first canonical difference between adjacent requests and keeps text out of the output', () => {
  const root = writeFixture();
  try {
    const { snapshots, ignoredFiles } = loadSnapshots([root]);
    assert.equal(ignoredFiles, 1);
    const { requests, summary } = profileRequests(snapshots);
    const regions = requests.map(
      (row) =>
        row.difference &&
        (row.difference.region === 'input' ? `input:${row.difference.fromEnd}` : row.difference.region),
    );
    assert.deepEqual(regions, [null, 'none', 'none', 'input:1', 'instructions', 'tools']);
    assert.equal(requests[4].difference.label, 'runtime:permission');
    assert.ok(requests[1].difference.coveredOfPrevious === 1);
    assert.equal(summary.all.toolChanges, 1);
    assert.equal(summary.all.firstDifference['input:previous-tail'], 1);
    assert.equal(summary.all.stablePrefixButUncached, 1);
    assert.equal(summary.all.cacheReadRatio, 3100 / 10400);
    assert.equal(summary.all.topToolResultBytes[0].tool, 'shell');
    const serialized = JSON.stringify({ requests, summary }) + renderMarkdown(summary);
    assert.ok(!serialized.includes(SECRET_TEXT));
    assert.ok(!serialized.includes('xxxx'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not count an unfinished request as measured usage', () => {
  const { completedAt, usage, ...request } = snapshot(0, { segments: [core], messages: [user] });
  const { summary } = profileRequests([request]);
  assert.equal(summary.all.requests, 1);
  assert.equal(summary.all.inputTokens, null);
  assert.equal(summary.all.cacheReadTokens, null);
  assert.equal(summary.all.averageInputTokens, null);
});

test('rejects a malformed snapshot instead of skipping it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-request-profile-'));
  try {
    fs.writeFileSync(path.join(root, 'broken.json'), JSON.stringify({ promptPlan: {}, messages: [] }));
    assert.throws(() => loadSnapshots([root]), /Malformed request snapshot/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
