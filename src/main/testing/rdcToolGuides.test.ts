import { mkdtempSync, mkdirSync, cpSync, appendFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('checks generated guides in an independent checkout and still rejects stale content', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rdc-guide-checkout-'));
  const repo = path.resolve(import.meta.dirname, '../../..');
  const inputs = ['scripts/generate-rdc-tool-guides.mjs', 'scripts/fidelity/rdc-tool-guide-catalog.json',
    'resources/agent-runtime/rdc-tool-guide-members.json'];
  const members = JSON.parse(readFileSync(path.join(repo, inputs[2]), 'utf8')) as { guides: Record<string, { skillId: string }> };
  const references = Object.values(members.guides).map(({ skillId }) => `resources/agent-runtime/skills/${skillId}/references/tools.md`);
  try {
    for (const input of [...inputs, ...references]) {
      const target = path.join(root, input);
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(repo, input), target);
    }
    const check = () => spawnSync(process.execPath, [path.join(root, inputs[0]), '--check'], { cwd: root, encoding: 'utf8', windowsHide: true });
    const fresh = check();
    expect(fresh.stderr).toBe('');
    expect(fresh.status).toBe(0);
    appendFileSync(path.join(root, references[0]), '\nStale generated content\n');
    const stale = check();
    expect(stale.status).not.toBe(0);
    expect(stale.stderr).toContain('stale generated reference');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
