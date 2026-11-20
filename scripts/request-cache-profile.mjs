#!/usr/bin/env node
/**
 * Profile recorded provider request snapshots (`<userData>/state/llm-calls/...`).
 *
 * For each request it reports how the input is composed (instructions by segment kind,
 * tool schemas, history by message category) and, against the previous request of the
 * same scope, where the canonical request first differs. The canonical order is the
 * order a provider builds the cached prefix from: tools, then instructions, then input.
 *
 * Output carries sizes, hashes, segment/tool names and record identifiers only; no
 * prompt, message or tool-result text leaves the snapshot.
 *
 * Usage: node scripts/request-cache-profile.mjs <llm-calls dir>... [--json <file>]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const utf8Bytes = (text) => Buffer.byteLength(text, 'utf8');
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
const estimateTokens = (text) => Math.ceil(text.length / 4);

function isSnapshot(value) {
  return Boolean(value) && typeof value === 'object' && 'promptPlan' in value && 'messages' in value;
}

function assertSnapshot(value, file) {
  const plan = value.promptPlan;
  if (!plan || !Array.isArray(plan.segments) || !Array.isArray(value.messages) || !Array.isArray(value.tools)
    || typeof value.callIndex !== 'number' || typeof value.createdAt !== 'string') {
    throw new Error(`Malformed request snapshot: ${file}`);
  }
}

function listJsonFiles(root) {
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(full);
    }
  };
  visit(root);
  return files;
}

/** Read every request snapshot under the given roots; other JSON files are counted, not parsed further. */
export function loadSnapshots(roots) {
  const snapshots = [];
  let ignoredFiles = 0;
  for (const root of roots) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Not a directory: ${root}`);
    for (const file of listJsonFiles(root)) {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!isSnapshot(value)) { ignoredFiles += 1; continue; }
      assertSnapshot(value, file);
      snapshots.push(value);
    }
  }
  return { snapshots, ignoredFiles };
}

function redactionHashes(snapshot) {
  const hashes = new Map();
  for (const entry of snapshot.redactions ?? []) if (entry.hash) hashes.set(entry.path, entry.hash);
  return hashes;
}

function canonicalBlock(block, blockPath, hashes) {
  switch (block?.type) {
    case 'text': return { type: 'text', text: block.text, ...(block.phase ? { phase: block.phase } : {}) };
    case 'toolCall': return { type: 'toolCall', id: block.id, name: block.name, arguments: block.arguments };
    case 'thinking': return { type: 'thinking', hash: hashes.get(blockPath) ?? sha(JSON.stringify(block)) };
    case 'image': return { type: 'image', hash: hashes.get(blockPath) ?? hashes.get(`${blockPath}.data`) ?? sha(String(block.data ?? '')), byteLength: block.byteLength ?? String(block.data ?? '').length };
    default: return { type: String(block?.type ?? 'unknown'), hash: sha(JSON.stringify(block)) };
  }
}

/** The wire-relevant projection of one message; timestamps, usage and diagnostics never reach a provider. */
function canonicalMessage(message, index, hashes) {
  const blocks = (content) => typeof content === 'string'
    ? content
    : (content ?? []).map((block, blockIndex) => canonicalBlock(block, `messages[${index}].content[${blockIndex}]`, hashes));
  if (message.role === 'toolResult') {
    return { role: 'toolResult', toolCallId: message.toolCallId, toolName: message.toolName, isError: Boolean(message.isError), content: blocks(message.content) };
  }
  return { role: message.role, content: blocks(message.content) };
}

function segmentLabel(segment, scopedOrdinal) {
  return segment.kind === 'scoped-instruction' ? `scoped-instruction#${scopedOrdinal}` : segment.id;
}

function canonicalItems(snapshot) {
  const hashes = redactionHashes(snapshot);
  const items = [{ region: 'tools', label: 'tools', text: JSON.stringify(snapshot.tools) }];
  let scopedOrdinal = 0;
  for (const segment of snapshot.promptPlan.segments) {
    if (segment.kind === 'scoped-instruction') scopedOrdinal += 1;
    items.push({ region: 'instructions', label: segmentLabel(segment, scopedOrdinal), text: `${segment.content}\n\n` });
  }
  snapshot.messages.forEach((message, index) => {
    items.push({ region: 'input', label: `${index}:${message.role}`, inputIndex: index, text: JSON.stringify(canonicalMessage(message, index, hashes)) });
  });
  return items.map((item) => ({ ...item, bytes: utf8Bytes(item.text) }));
}

function add(map, key, value) { map[key] = (map[key] ?? 0) + value; }

function composition(snapshot) {
  const instructionsByKind = {};
  for (const segment of snapshot.promptPlan.segments) add(instructionsByKind, segment.kind, utf8Bytes(segment.content));
  const input = { userText: 0, userImages: 0, userImageBytes: 0, assistantText: 0, toolCallArguments: 0, reasoningItems: 0, toolResultText: 0, toolResultImages: 0, toolResultImageBytes: 0 };
  const toolResultBytesByTool = {};
  for (const message of snapshot.messages) {
    const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : (message.content ?? []);
    for (const block of content) {
      if (block.type === 'text') {
        const bytes = utf8Bytes(block.text ?? '');
        if (message.role === 'user') input.userText += bytes;
        else if (message.role === 'assistant') input.assistantText += bytes;
        else { input.toolResultText += bytes; add(toolResultBytesByTool, message.toolName ?? 'unknown', bytes); }
      } else if (block.type === 'image') {
        const bytes = Number(block.byteLength ?? String(block.data ?? '').length);
        if (message.role === 'toolResult') { input.toolResultImages += 1; input.toolResultImageBytes += bytes; } else { input.userImages += 1; input.userImageBytes += bytes; }
      } else if (block.type === 'toolCall') input.toolCallArguments += utf8Bytes(JSON.stringify(block.arguments ?? {}));
      else if (block.type === 'thinking') input.reasoningItems += 1;
    }
  }
  return {
    instructionsBytes: utf8Bytes(snapshot.promptPlan.systemPrompt ?? snapshot.promptPlan.segments.map((segment) => segment.content).join('\n\n')),
    instructionsByKind,
    toolCount: snapshot.tools.length,
    toolBytes: utf8Bytes(JSON.stringify(snapshot.tools)),
    messageCount: snapshot.messages.length,
    input,
    toolResultBytesByTool,
  };
}

function commonPrefixBytes(left, right) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left.charCodeAt(index) === right.charCodeAt(index)) index += 1;
  return utf8Bytes(left.slice(0, index));
}

/** Where `current` first departs from `previous` in canonical order. */
export function firstDifference(previousItems, currentItems) {
  const previousTotal = previousItems.reduce((sum, item) => sum + item.bytes, 0);
  const currentTotal = currentItems.reduce((sum, item) => sum + item.bytes, 0);
  let shared = 0;
  let index = 0;
  while (index < previousItems.length && index < currentItems.length
    && previousItems[index].region === currentItems[index].region
    && previousItems[index].label === currentItems[index].label
    && previousItems[index].text === currentItems[index].text) {
    shared += previousItems[index].bytes;
    index += 1;
  }
  let diff;
  if (index === previousItems.length) diff = { region: 'none' };
  else {
    const before = previousItems[index];
    const after = currentItems[index];
    if (after && before.region === after.region && before.label === after.label) shared += commonPrefixBytes(before.text, after.text);
    const previousInputCount = previousItems.filter((item) => item.region === 'input').length;
    diff = {
      region: before.region,
      label: before.label,
      itemIndex: index,
      ...(before.region === 'input' ? { fromEnd: previousInputCount - before.inputIndex } : {}),
    };
  }
  return { ...diff, sharedBytes: shared, coveredOfPrevious: previousTotal ? shared / previousTotal : 1, sharedOfCurrent: currentTotal ? shared / currentTotal : 1 };
}

function scopeKind(snapshot) {
  const turn = String(snapshot.turnId ?? '');
  if (turn.startsWith('compaction-handoff')) return 'compaction';
  if (turn.startsWith('permission-review')) return 'permission-review';
  return String(snapshot.sessionId ?? '').includes('--subagent--') ? 'subagent' : 'root';
}

function diffClass(diff) {
  if (diff.region === 'none') return 'append-only';
  if (diff.region === 'input') return diff.fromEnd <= 1 ? 'input:previous-tail' : 'input:earlier-history';
  if (diff.region === 'instructions') return `instructions:${diff.label}`;
  return diff.region;
}

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const ratio = (part, whole) => (whole ? part / whole : null);

/** Profile snapshots grouped by execution scope, in request order. */
export function profileRequests(snapshots) {
  const byScope = new Map();
  for (const snapshot of snapshots) {
    const key = String(snapshot.sessionId ?? 'unknown');
    byScope.set(key, [...(byScope.get(key) ?? []), snapshot]);
  }
  const requests = [];
  for (const [scope, list] of byScope) {
    list.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.callIndex - right.callIndex);
    let previous;
    for (const snapshot of list) {
      const items = canonicalItems(snapshot);
      const usage = snapshot.usage ?? {};
      requests.push({
        scope,
        kind: scopeKind(snapshot),
        turn: snapshot.turnId ?? null,
        callIndex: snapshot.callIndex,
        createdAt: snapshot.createdAt,
        completedAt: snapshot.completedAt ?? null,
        model: snapshot.route?.modelId ?? null,
        cacheEnabled: Boolean(snapshot.cache?.enabled),
        inputTokens: usage.inputTokens ?? null,
        cacheReadTokens: usage.cacheReadTokens ?? null,
        outputTokens: usage.outputTokens ?? null,
        canonicalBytes: items.reduce((sum, item) => sum + item.bytes, 0),
        estimatedTokens: items.reduce((sum, item) => sum + estimateTokens(item.text), 0),
        toolsHash: sha(items[0].text),
        composition: composition(snapshot),
        difference: previous ? firstDifference(previous.items, items) : null,
      });
      previous = { items };
    }
  }
  return { requests, summary: summarize(requests) };
}

function summarizeGroup(rows) {
  const inputTokens = rows.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0);
  const cacheReadTokens = rows.reduce((sum, row) => sum + (row.cacheReadTokens ?? 0), 0);
  const compared = rows.filter((row) => row.difference);
  const differences = {};
  for (const row of compared) add(differences, diffClass(row.difference), 1);
  const toolChanges = compared.filter((row) => row.difference.region === 'tools').length;
  const stableButUncached = compared.filter((row) => row.difference.coveredOfPrevious >= 0.9 && row.inputTokens && ratio(row.cacheReadTokens ?? 0, row.inputTokens) < 0.5).length;
  const share = { instructions: 0, tools: 0, userText: 0, assistantText: 0, toolCallArguments: 0, toolResultText: 0, images: 0 };
  const toolResultBytesByTool = {};
  for (const row of rows) {
    const { input } = row.composition;
    share.instructions += row.composition.instructionsBytes;
    share.tools += row.composition.toolBytes;
    share.userText += input.userText;
    share.assistantText += input.assistantText;
    share.toolCallArguments += input.toolCallArguments;
    share.toolResultText += input.toolResultText;
    share.images += input.userImageBytes + input.toolResultImageBytes;
    for (const [tool, bytes] of Object.entries(row.composition.toolResultBytesByTool)) add(toolResultBytesByTool, tool, bytes);
  }
  const shareTotal = Object.values(share).reduce((sum, value) => sum + value, 0);
  const starts = rows.map((row) => Date.parse(row.createdAt)).filter(Number.isFinite);
  const ends = rows.map((row) => Date.parse(row.completedAt ?? row.createdAt)).filter(Number.isFinite);
  return {
    requests: rows.length,
    scopes: new Set(rows.map((row) => row.scope)).size,
    inputTokens,
    cacheReadTokens,
    cacheReadRatio: ratio(cacheReadTokens, inputTokens),
    averageInputTokens: rows.length ? Math.round(inputTokens / rows.length) : null,
    cacheEnabledRequests: rows.filter((row) => row.cacheEnabled).length,
    firstDifference: differences,
    toolChanges,
    medianCoveredOfPrevious: median(compared.map((row) => row.difference.coveredOfPrevious)),
    stablePrefixButUncached: stableButUncached,
    byteShare: Object.fromEntries(Object.entries(share).map(([key, value]) => [key, ratio(value, shareTotal)])),
    topToolResultBytes: Object.entries(toolResultBytesByTool).sort((left, right) => right[1] - left[1]).slice(0, 8).map(([tool, bytes]) => ({ tool, share: ratio(bytes, share.toolResultText) })),
    maxImagesInRequest: Math.max(0, ...rows.map((row) => row.composition.input.userImages + row.composition.input.toolResultImages)),
    wallClockMs: starts.length ? Math.max(...ends) - Math.min(...starts) : null,
  };
}

function summarize(requests) {
  const kinds = {};
  for (const kind of new Set(requests.map((row) => row.kind))) kinds[kind] = summarizeGroup(requests.filter((row) => row.kind === kind));
  return { all: summarizeGroup(requests), byKind: kinds };
}

const percent = (value) => (value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`);

export function renderMarkdown(summary) {
  const lines = ['| 范围 | 请求 | 输入 token | 缓存读取 | 比例 | 平均输入 | tools 变化 | 相邻请求覆盖前一请求的中位比例 | 前缀稳定但未命中 |', '|---|---|---|---|---|---|---|---|---|'];
  for (const [kind, group] of [['all', summary.all], ...Object.entries(summary.byKind)]) {
    lines.push(`| ${kind} | ${group.requests} | ${group.inputTokens} | ${group.cacheReadTokens} | ${percent(group.cacheReadRatio)} | ${group.averageInputTokens ?? 'n/a'} | ${group.toolChanges} | ${percent(group.medianCoveredOfPrevious)} | ${group.stablePrefixButUncached} |`);
  }
  const all = summary.all;
  lines.push('', `首个差异位置：${Object.entries(all.firstDifference).map(([key, count]) => `${key} ${count}`).join('，') || '无'}`);
  lines.push(`字节占比：${Object.entries(all.byteShare).map(([key, value]) => `${key} ${percent(value)}`).join('，')}`);
  lines.push(`工具返回字节占比前列：${all.topToolResultBytes.map((entry) => `${entry.tool} ${percent(entry.share)}`).join('，') || '无'}`);
  lines.push(`单次请求最多图片：${all.maxImagesInRequest}；首末请求跨度：${all.wallClockMs === null ? 'n/a' : `${Math.round(all.wallClockMs / 1000)}s`}`);
  return lines.join('\n');
}

function main(argv) {
  const roots = [];
  let jsonOut;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--json') jsonOut = argv[++index];
    else roots.push(argv[index]);
  }
  if (!roots.length || (argv.includes('--json') && !jsonOut)) {
    console.error('Usage: node scripts/request-cache-profile.mjs <llm-calls dir>... [--json <file>]');
    process.exit(2);
  }
  const { snapshots, ignoredFiles } = loadSnapshots(roots);
  if (!snapshots.length) throw new Error('No request snapshots found under the given directories.');
  const profile = profileRequests(snapshots);
  if (jsonOut) fs.writeFileSync(jsonOut, `${JSON.stringify({ ignoredFiles, ...profile }, null, 2)}\n`, 'utf8');
  console.log(renderMarkdown(profile.summary));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
