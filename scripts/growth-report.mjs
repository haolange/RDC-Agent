#!/usr/bin/env node
// Net line growth by kind between a base commit and HEAD, for the CI summary. It reports and never fails.
//   RDC_DIFF_BASE=<sha> node scripts/growth-report.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const base = process.env.RDC_DIFF_BASE || 'HEAD~1';
const KINDS = [
  [
    'test',
    (file) =>
      /\.test\.tsx?$/u.test(file) || /(^|\/)testing\//u.test(file) || file.startsWith('scripts/visual-diff/scenarios/'),
  ],
  ['production', (file) => /^src\//u.test(file)],
  ['docs', (file) => file.startsWith('docs/') || file.endsWith('.md')],
  ['scripts', (file) => file.startsWith('scripts/') || file.startsWith('.github/')],
  ['resources', (file) => file.startsWith('resources/')],
  ['other', () => true],
];

const totals = new Map(KINDS.map(([kind]) => [kind, { added: 0, removed: 0 }]));
const numstat = execFileSync('git', ['diff', '--numstat', `${base}...HEAD`], { encoding: 'utf8' });
for (const line of numstat.split('\n').filter(Boolean)) {
  const [added, removed, file] = line.split('\t');
  if (added === '-') continue;
  const [kind] = KINDS.find(([, matches]) => matches(file));
  const entry = totals.get(kind);
  entry.added += Number(added);
  entry.removed += Number(removed);
}

const rows = [...totals]
  .filter(([, { added, removed }]) => added || removed)
  .map(
    ([kind, { added, removed }]) =>
      `| ${kind} | +${added} | -${removed} | ${added - removed >= 0 ? '+' : ''}${added - removed} |`,
  );
const report = [
  `### Growth since ${base.slice(0, 12)}`,
  '',
  '| kind | added | removed | net |',
  '|---|---:|---:|---:|',
  ...rows,
  '',
].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
console.log(report);
