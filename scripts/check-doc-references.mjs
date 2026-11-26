#!/usr/bin/env node
// Documentation references must point at things that exist: repository paths in backticks or relative
// Markdown links, and IPC channel names in IPC context. Code is referenced by file and symbol name, never by
// line number (`file.ts:120`), because line numbers drift with every edit and formatting pass. Lines that
// state something must not exist (禁止 / 不存在 / 已删除 / 已移除 / removed / retired) are exempt, since
// naming a retired path is their point. The acceptance ledger is a historical record and is not checked.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEGATED = /禁止|不存在|已删除|已移除|不得恢复|不再|removed|retired|deleted/i;
const IPC_CONTEXT = /IPC|channel|通道|广播|订阅|push|handler|事件/i;

function walk(directory, out = []) {
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.posix.join(directory, entry.name);
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) walk(relative, out);
    else out.push(relative);
  }
  return out;
}

const documents = [
  'AGENTS.md',
  'ARCHITECTURE.md',
  'DESIGN.md',
  ...walk('docs').filter((file) => file.endsWith('.md') && !file.endsWith('acceptance-ledger.md')),
  ...walk('src').filter((file) => file.endsWith('README.md')),
];
const channelSource = fs.readFileSync(path.join(root, 'src/shared/renderer-api/channels.ts'), 'utf8');
const channels = new Set(
  [...channelSource.matchAll(/['"]([a-z][A-Za-z]+:[A-Za-z:.-]+)['"]/g)].map((match) => match[1]),
);
const channelNamespaces = new Set([...channels].map((channel) => channel.split(':')[0]));

const problems = [];
for (const document of documents) {
  const lines = fs.readFileSync(path.join(root, document), 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (NEGATED.test(line)) return;
    const where = `${document}:${index + 1}`;
    for (const match of line.matchAll(
      /`((?:src|scripts|docs|resources|designs|\.github)\/[A-Za-z0-9_./\-[\]]+?)(?::(\d+)(?:-(\d+))?)?`/g,
    )) {
      const target = match[1].replace(/[.,]$/, '');
      if (/[*{}<>]/.test(target)) continue;
      if (!fs.existsSync(path.join(root, target))) problems.push(`${where} missing path ${target}`);
      else if (match[2]) problems.push(`${where} ${target}:${match[2]} names a line number; name the symbol instead`);
    }
    for (const match of line.matchAll(/`([A-Za-z0-9_.-]+\.(?:ts|tsx|mjs|cjs|css|json|py)):(\d+)(?:-(\d+))?/g)) {
      problems.push(`${where} ${match[1]}:${match[2]} names a line number; name the symbol instead`);
    }
    for (const match of line.matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)(?:#[^)]*)?\)/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(document), match[1]));
      if (!target.startsWith('..') && !fs.existsSync(path.join(root, target)))
        problems.push(`${where} broken link ${match[1]}`);
    }
    if (IPC_CONTEXT.test(line)) {
      for (const match of line.matchAll(/`([a-z][A-Za-z]+:[a-z][A-Za-z]+(?::[A-Za-z]+)?)`/g)) {
        const channel = match[1];
        if (channelNamespaces.has(channel.split(':')[0]) && !channels.has(channel))
          problems.push(`${where} unknown IPC channel ${channel}`);
      }
    }
  });
}

if (problems.length) {
  console.error(`[doc-references] ${problems.length} stale reference(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`[doc-references] OK (${documents.length} documents)`);
