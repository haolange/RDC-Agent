import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { ScopedInstructionResolver } from './ScopedInstructionResolver';

const roots: string[] = [];
const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-instructions-'));
  roots.push(root);
  return root;
};

afterEach(() => {
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

describe('ScopedInstructionResolver', () => {
  it('loads user then root-to-target project instructions exactly once', () => {
    const root = makeRoot();
    const user = path.join(root, 'user-RDC.md');
    const project = path.join(root, 'project');
    const nested = path.join(project, 'src', 'feature');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(user, 'user');
    fs.writeFileSync(path.join(project, 'RDC.md'), 'root');
    fs.writeFileSync(path.join(project, 'src', 'RDC.md'), 'src');
    fs.writeFileSync(path.join(nested, 'RDC.md'), 'feature');

    const result = new ScopedInstructionResolver().resolveForPaths({
      userInstructionsPath: user,
      projectRoot: project,
      activePaths: [nested, path.join(nested, 'file.ts')],
    });

    expect(result.sources.map((source) => source.content)).toEqual(['user', 'root', 'src', 'feature']);
    expect(result.diagnostics).toEqual([]);
  });

  it('reports paths outside the project and visible budget failures', () => {
    const root = makeRoot();
    const project = path.join(root, 'project');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'RDC.md'), '0123456789');
    const resolver = new ScopedInstructionResolver();
    const result = resolver.resolveForPaths({
      userInstructionsPath: path.join(root, 'missing.md'),
      projectRoot: project,
      activePaths: [root],
      byteBudget: 4,
    });
    expect(result.sources).toEqual([]);
    expect(result.diagnostics.map((entry) => entry.code)).toEqual([
      'instructions.path.outside-project',
      'instructions.budget.exceeded',
    ]);
  });
});
