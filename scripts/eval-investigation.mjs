#!/usr/bin/env node
// Outcome eval: grades a finished investigation against objective answers read from a real replay.
// It needs no model: run the task's prompt in the app (any provider), then point this at the session.
//   node scripts/eval-investigation.mjs --print-prompt [--lang en] [--tasks <file>]
//   node scripts/eval-investigation.mjs <session-directory> [--tasks <file>] [--min-score <0..1>]
//   node scripts/eval-investigation.mjs --self-test
// The answer text is the session's last completed assistant message plus any InvestigationReport records
// under the session directory; each task reads its own `Q<n>:` line. Not part of CI.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
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
  return [...messages.values()].sort((left, right) => left.createdAt - right.createdAt)
    .filter((message) => message.role === 'assistant' && message.status === 'complete').at(-1);
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

function readSessionText(directory) {
  const history = path.join(directory, 'conversation.jsonl');
  if (!fs.existsSync(history)) throw new Error(`no conversation.jsonl in ${directory}`);
  const records = fs.readFileSync(history, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
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
          if (record?.recordType === 'InvestigationReport' || record?.reportContract) reports.push(JSON.stringify(record));
        } catch { /* not a JSON record */ }
      }
    }
  };
  walk(directory);
  return [finalAnswer, ...reports].join('\n');
}

function report(result) {
  for (const item of result.results) {
    console.log(`${item.passed ? 'PASS' : 'FAIL'}  ${item.id} ${item.name}: ${item.answer}${item.passed ? '' : `  (expected ${item.expected})`}`);
  }
  console.log(`[eval:${suite.id}] score ${(result.score * 100).toFixed(0)}% (${result.results.filter((item) => item.passed).length}/${result.results.length})`);
}

if (args.includes('--print-prompt')) {
  console.log(suite.prompt[option('--lang', 'zh-CN')] ?? suite.prompt.en);
} else if (args.includes('--self-test')) {
  const answer = '分析过程……\nQ1: EID 11\nQ2: 36 个顶点\nQ3: B8G8R8A8_UNORM，500×500\nQ4: 6\nQ5: 事件 14（vkQueuePresentKHR）\nQ6: 顶点着色器与像素着色器（VS、PS）';
  const right = grade(answer);
  const wrong = grade('Q1: 12\nQ2: 24\nQ3: R8G8B8A8_UNORM 1920x1080\nQ4: 7\nQ5: 13\nQ6: compute');
  const rebuilt = latestCompletedAssistant([
    { id: 'assistant', role: 'assistant', status: 'streaming', content: '', createdAt: 1, updatedAt: 1 },
    { op: 'delta', id: 'assistant', patch: { content: 'partial' }, updatedAt: 2 },
    { op: 'delta', id: 'assistant', patch: { content: answer, status: 'complete' }, updatedAt: 3 },
  ]);
  if (right.score !== 1 || wrong.score !== 0 || grade(rebuilt?.content ?? '').score !== 1) {
    report(right); report(wrong); process.exit(1);
  }
  console.log('[eval] self-test OK');
} else {
  const directory = args.find((arg) => !arg.startsWith('--') && arg !== option('--tasks') && arg !== option('--min-score'));
  if (!directory) throw new Error('usage: eval-investigation.mjs <session-directory> | --print-prompt | --self-test');
  const result = grade(readSessionText(directory));
  report(result);
  process.exit(result.score >= Number(option('--min-score', '0')) ? 0 : 1);
}
