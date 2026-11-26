#!/usr/bin/env node
// Outcome eval: grades a finished investigation against objective answers read from a real replay.
//   node scripts/eval-investigation.mjs --print-prompt [--lang en] [--tasks <file>]
//   node scripts/eval-investigation.mjs <session-directory> [--tasks <file>] [--min-score <0..1>]
//   node scripts/eval-investigation.mjs --faux [--tasks <file>]
//   node scripts/eval-investigation.mjs --self-test
// A session is graded on three things:
//   answers     the last completed assistant message plus any InvestigationReport records; each task reads its own
//               `Q<n>:` line;
//   tool calls  every `requiredToolCalls` entry of the suite matches a call in session-context.jsonl (same tool name,
//               arguments containing the listed ones) whose result is not an error;
//   evidence    every observed source claim a report concludes from cites an EvidenceRecord of the session, and every
//               Evidence artifactRef resolves to a session artifact with the recorded hash.
// --faux runs one investigation turn through the agent runtime with a scripted provider and a recorded native replay
// (src/main/testing/investigationFauxEval.test.ts, the suite's `faux.replay`) and grades the session it commits; CI
// runs it with --self-test. Grading a real-model session needs a model and a replayable capture: run the prompt in
// the app (any provider), then point this at the session directory.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const taskFile = option('--tasks', path.join(here, 'evals', 'vkcube-lavapipe.json'));
const suite = JSON.parse(fs.readFileSync(taskFile, 'utf8'));

/** `Q<n>: answer` lines; the last one per question wins, so a model may draft and then settle. */
function answerLines(text) {
  const answers = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.replace(/[*`]/g, '').match(/^\s*(Q\d+)\s*[:：]\s*(.+)$/i);
    if (match) answers.set(match[1].toUpperCase(), match[2].trim());
  }
  return answers;
}

/** Rebuild the message fields used by the evaluator from the append-only conversation journal. */
function latestCompletedAssistant(records) {
  const messages = new Map();
  for (const record of records) {
    if (record.op === 'delta') {
      const previous = messages.get(record.id);
      if (!previous) throw new Error(`conversation delta has no preceding message: ${record.id}`);
      messages.set(record.id, { ...previous, ...record.patch, id: previous.id, updatedAt: record.updatedAt });
      continue;
    }
    const previous = messages.get(record.id);
    if (!previous || (record.updatedAt ?? record.createdAt) >= (previous.updatedAt ?? previous.createdAt)) {
      messages.set(record.id, record);
    }
  }
  return [...messages.values()]
    .sort((left, right) => left.createdAt - right.createdAt)
    .filter((message) => message.role === 'assistant' && message.status === 'complete')
    .at(-1);
}

export function grade(text, tasks = suite.tasks) {
  const answers = answerLines(text);
  const results = tasks.map((task) => {
    const answer = answers.get(task.id) ?? '';
    const passed = Boolean(answer) && task.accept.some((pattern) => new RegExp(pattern, 'iu').test(answer));
    return { id: task.id, name: task.name, expected: task.expected, answer: answer || '(no answer line)', passed };
  });
  return { score: results.filter((result) => result.passed).length / results.length, results };
}

/**
 * Evidence grading (S-EVIDENCE-01): every observed claim a report concludes from must cite Evidence the session
 * actually recorded. `records` are the investigation record bodies found under the session directory.
 */
export function gradeEvidence(records, refResolves = () => true) {
  const evidence = new Set();
  const claims = new Map();
  const reports = [];
  const danglingRefs = [];
  for (const record of records) {
    for (const item of [record, ...(Array.isArray(record.items) ? record.items : [])]) {
      if (typeof item.evidenceId === 'string') {
        evidence.add(item.evidenceId);
        for (const ref of item.artifactRefs ?? [])
          if (!refResolves(ref.uri, ref.expectedHash)) danglingRefs.push(`${item.evidenceId} -> ${ref.uri}`);
      }
      if (typeof item.claimId === 'string') claims.set(item.claimId, item);
    }
    if (record.reportContract) reports.push(record);
  }
  const uncited = [];
  for (const report of reports) {
    for (const claim of report.claims ?? []) {
      for (const entry of claim.compactProvenance ?? []) {
        const source = claims.get(entry.sourceClaimId);
        if (source?.epistemic !== 'observed') continue;
        if (!(source.evidenceIds ?? []).some((id) => evidence.has(id))) uncited.push(source.claimId);
      }
    }
  }
  return { reports: reports.length, uncited: [...new Set(uncited)], danglingRefs };
}

/** `arguments` contains `expected`: every listed key matches, recursively; arrays and scalars compare whole. */
function containsArgs(actual, expected) {
  if (expected === null || typeof expected !== 'object' || Array.isArray(expected))
    return JSON.stringify(actual) === JSON.stringify(expected);
  return (
    actual !== null &&
    typeof actual === 'object' &&
    Object.entries(expected).every(([key, value]) => containsArgs(actual[key], value))
  );
}

/**
 * Tool-call grading: each required call (tool name plus the arguments it must contain) was made in a committed turn
 * and its result was not an error. `entries` are the session-context.jsonl turn entries.
 */
export function gradeToolCalls(entries, required = suite.requiredToolCalls ?? []) {
  const messages = entries.flatMap((entry) => entry.messages ?? []);
  const failed = new Set(
    messages.filter((message) => message.role === 'toolResult' && message.isError).map((message) => message.toolCallId),
  );
  const answered = new Set(
    messages.filter((message) => message.role === 'toolResult').map((message) => message.toolCallId),
  );
  const calls = messages
    .filter((message) => message.role === 'assistant' && Array.isArray(message.content))
    .flatMap((message) => message.content.filter((block) => block.type === 'toolCall'));
  const missing = required.filter(
    (expected) =>
      !calls.some(
        (call) =>
          call.name === expected.name &&
          containsArgs(call.arguments, expected.args ?? {}) &&
          answered.has(call.id) &&
          !failed.has(call.id),
      ),
  );
  return {
    calls: calls.length,
    missing: missing.map((expected) => `${expected.name} ${JSON.stringify(expected.args ?? {})}`),
  };
}

/** session://<area>/<path> is stored at <session>/session-artifacts/<area>/<path>; the hash is the bytes' SHA-256. */
function sessionRefResolver(directory) {
  return (uri, expectedHash) => {
    const match = /^session:\/\/([^/]+)\/(.+)$/.exec(uri ?? '');
    if (!match || match[2].split('/').includes('..')) return false;
    const file = path.join(directory, 'session-artifacts', match[1], match[2]);
    if (!fs.existsSync(file)) return false;
    const hash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    return String(expectedHash ?? '').replace(/^sha256:/, '') === hash;
  };
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readSessionRecords(directory) {
  const records = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.json')) {
        try {
          const record = JSON.parse(fs.readFileSync(full, 'utf8'));
          if (record && typeof record === 'object' && !Array.isArray(record)) records.push(record);
        } catch {
          /* not a JSON record */
        }
      }
    }
  };
  walk(directory);
  return records;
}

function readSessionText(directory) {
  const history = path.join(directory, 'conversation.jsonl');
  if (!fs.existsSync(history)) throw new Error(`no conversation.jsonl in ${directory}`);
  const records = fs
    .readFileSync(history, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const finalMessage = latestCompletedAssistant(records);
  if (!finalMessage) throw new Error(`no completed assistant message in ${history}`);
  const finalAnswer = finalMessage.content;
  const reports = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.json')) {
        try {
          const record = JSON.parse(fs.readFileSync(full, 'utf8'));
          if (record?.recordType === 'InvestigationReport' || record?.reportContract)
            reports.push(JSON.stringify(record));
        } catch {
          /* not a JSON record */
        }
      }
    }
  };
  walk(directory);
  return [finalAnswer, ...reports].join('\n');
}

function report(result) {
  for (const item of result.results) {
    console.log(
      `${item.passed ? 'PASS' : 'FAIL'}  ${item.id} ${item.name}: ${item.answer}${item.passed ? '' : `  (expected ${item.expected})`}`,
    );
  }
  console.log(
    `[eval:${suite.id}] score ${(result.score * 100).toFixed(0)}% (${result.results.filter((item) => item.passed).length}/${result.results.length})`,
  );
}

/** Grades one session directory on answers, required tool calls and evidence; true when it passes. */
function gradeSession(directory, minScore) {
  const result = grade(readSessionText(directory));
  report(result);
  const tools = gradeToolCalls(readJsonl(path.join(directory, 'session-context.jsonl')));
  console.log(
    `[eval:${suite.id}] tool calls: ${tools.calls} made, ${tools.missing.length} required call(s) missing or failed${tools.missing.length ? ` (${tools.missing.join('; ')})` : ''}`,
  );
  const evidence = gradeEvidence(readSessionRecords(directory), sessionRefResolver(directory));
  console.log(
    `[eval:${suite.id}] evidence: ${evidence.reports} report(s), ${evidence.uncited.length} observed source claim(s) without recorded evidence${evidence.uncited.length ? ` (${evidence.uncited.join(', ')})` : ''}, ${evidence.danglingRefs.length} unresolved evidence ref(s)${evidence.danglingRefs.length ? ` (${evidence.danglingRefs.join(', ')})` : ''}`,
  );
  return (
    result.score >= minScore &&
    tools.missing.length === 0 &&
    evidence.uncited.length === 0 &&
    evidence.danglingRefs.length === 0 &&
    evidence.reports > 0
  );
}

/** The faux turn commits its session into a temporary directory, graded like a real one and then removed. */
function runFaux() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-eval-faux-'));
  try {
    const run = spawnSync(
      process.execPath,
      ['node_modules/vitest/vitest.mjs', 'run', 'src/main/testing/investigationFauxEval.test.ts'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, RDC_EVAL_FAUX_OUT: directory, RDC_EVAL_TASKS: path.resolve(taskFile) },
        timeout: 120_000,
      },
    );
    if (run.status !== 0) {
      console.error(`${run.stdout ?? ''}${run.stderr ?? ''}`.slice(-4000));
      throw new Error('the faux investigation turn failed');
    }
    return gradeSession(directory, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function selfTest() {
  const answer =
    '分析过程……\nQ1: EID 11\nQ2: 36 个顶点\nQ3: B8G8R8A8_UNORM，500×500\nQ4: 6\nQ5: 事件 14（vkQueuePresentKHR）\nQ6: 顶点着色器与像素着色器（VS、PS）';
  const right = grade(answer);
  const wrong = grade('Q1: 12\nQ2: 24\nQ3: R8G8B8A8_UNORM 1920x1080\nQ4: 7\nQ5: 13\nQ6: compute');
  const rebuilt = latestCompletedAssistant([
    { id: 'assistant', role: 'assistant', status: 'streaming', content: '', createdAt: 1, updatedAt: 1 },
    { op: 'delta', id: 'assistant', patch: { content: 'partial' }, updatedAt: 2 },
    { op: 'delta', id: 'assistant', patch: { content: answer, status: 'complete' }, updatedAt: 3 },
  ]);
  if (right.score !== 1 || wrong.score !== 0 || grade(rebuilt?.content ?? '').score !== 1) {
    report(right);
    report(wrong);
    return false;
  }
  const observed = (claimId, evidenceIds) => ({ claimId, epistemic: 'observed', evidenceIds });
  const conclusion = (sourceClaimId) => ({ reportContract: {}, claims: [{ compactProvenance: [{ sourceClaimId }] }] });
  const cited = gradeEvidence([{ evidenceId: 'ev-1' }, observed('c-1', ['ev-1']), conclusion('c-1')]);
  const dangling = gradeEvidence(
    [
      {
        items: [{ evidenceId: 'ev-2', artifactRefs: [{ uri: 'session://tool-outputs/gone.json', expectedHash: 'x' }] }],
      },
      observed('c-2', ['ev-missing']),
      conclusion('c-2'),
    ],
    () => false,
  );
  if (
    cited.uncited.length !== 0 ||
    cited.reports !== 1 ||
    dangling.uncited.join() !== 'c-2' ||
    dangling.danglingRefs.join() !== 'ev-2 -> session://tool-outputs/gone.json'
  ) {
    console.error('[eval] evidence grading self-test failed', { cited, dangling });
    return false;
  }
  const required = [{ name: 'rdc_probe', args: { args: { action: 'event_list' } } }];
  const turn = (isError) => [
    {
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 't1',
              name: 'rdc_probe',
              arguments: { action: 'probe', args: { action: 'event_list' } },
            },
          ],
        },
        { role: 'toolResult', toolCallId: 't1', isError },
      ],
    },
  ];
  if (
    gradeToolCalls(turn(false), required).missing.length !== 0 ||
    gradeToolCalls(turn(true), required).missing.length !== 1 ||
    gradeToolCalls([], required).missing.length !== 1
  ) {
    console.error('[eval] tool-call grading self-test failed');
    return false;
  }
  return true;
}

if (args.includes('--print-prompt')) {
  console.log(suite.prompt[option('--lang', 'zh-CN')] ?? suite.prompt.en);
} else if (args.includes('--self-test')) {
  if (!selfTest()) process.exit(1);
  console.log('[eval] self-test OK');
} else if (args.includes('--faux')) {
  if (!runFaux()) process.exit(1);
  console.log('[eval] faux investigation OK');
} else {
  const directory = args.find(
    (arg) => !arg.startsWith('--') && arg !== option('--tasks') && arg !== option('--min-score'),
  );
  if (!directory)
    throw new Error('usage: eval-investigation.mjs <session-directory> | --faux | --print-prompt | --self-test');
  process.exit(gradeSession(directory, Number(option('--min-score', '0'))) ? 0 : 1);
}
