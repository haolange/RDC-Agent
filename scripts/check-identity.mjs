import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const failures = [];
const visit = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { visit(file); continue; }
    if (!entry.name.endsWith('.md') || entry.name === 'acceptance-ledger.md') continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/u);
    lines.forEach((line, i) => {
      if (!line.includes('Breaking:') && /rdx-tools|`rdx`|bin\/rdx|RDX CLI/u.test(line)) failures.push(`${path.relative(root, file)}:${i + 1}`);
    });
  }
};
visit(path.join(root, 'docs'));
visit(path.join(root, 'resources', 'agent-runtime'));
for (const file of ['README.md', 'README.en.md', 'AGENTS.md', 'DESIGN.md']) {
  if (/rdx-tools|`rdx`|RDX CLI/u.test(fs.readFileSync(path.join(root, file), 'utf8'))) failures.push(file);
}
if (failures.length) throw new Error(`Retired product identity: ${failures.join(', ')}`);
console.log('[identity] RDC-Agent identity passed');
