import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM gate script without type declarations
import { runForbiddenCheck } from '../../../scripts/lib/forbiddenSourceRules.mjs';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

function fixtureRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-forbidden-'));
  roots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), content);
  }
  return root;
}

describe('forbidden source rules', () => {
  it('fails on any hit of a forbidden rule or hard-forbidden structure, and passes a clean tree', () => {
    const rules = [{ id: 'demo.forbidden.legacy', file: 'src/main', pattern: 'LegacyResolver', probe: 'walk-pattern', note: 'retired' }];
    const dirty = fixtureRepo({
      'src/main/a.ts': 'export class LegacyResolver {}\n',
      'src/main/b.ts': "export const tool = { name: 'knowledge_write' };\n",
    });
    const result = runForbiddenCheck({ name: 'demo', repoRoot: dirty, rules });
    expect(result.ok).toBe(false);
    expect(result.errors.map((error: string) => error.split(' ')[0]).sort()).toEqual(['demo.forbidden.legacy', 'hard.knowledge.autonomy-tool']);

    const clean = fixtureRepo({ 'src/main/a.ts': 'export const ok = 1;\n' });
    expect(runForbiddenCheck({ name: 'demo', repoRoot: clean, rules })).toMatchObject({ ok: true, errors: [] });
  });
});
