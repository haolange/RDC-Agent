import fs from 'fs';
import path from 'path';
import type { ScopedInstructionResolution, ScopedInstructionSource } from '@shared/types/rdcRuntime';
import { hashScopedResource } from './ScopedResourceResolver';

const DEFAULT_INSTRUCTION_BUDGET = 64 * 1024;

const isWithinRoot = (candidate: string, root: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const realPathIfPresent = (candidate: string): string =>
  fs.existsSync(candidate) ? fs.realpathSync.native(candidate) : path.resolve(candidate);

export class ScopedInstructionResolver {
  resolveForPaths(input: {
    userInstructionsPath: string;
    projectRoot: string;
    activePaths: string[];
    byteBudget?: number;
  }): ScopedInstructionResolution {
    const diagnostics: ScopedInstructionResolution['diagnostics'] = [];
    const sources: ScopedInstructionSource[] = [];
    const budget = input.byteBudget ?? DEFAULT_INSTRUCTION_BUDGET;
    const projectRoot = path.resolve(input.projectRoot);
    const realProjectRoot = realPathIfPresent(projectRoot);
    const candidates: Array<{ scope: 'user' | 'project'; sourcePath: string }> = [];

    if (fs.existsSync(input.userInstructionsPath)) {
      candidates.push({ scope: 'user', sourcePath: path.resolve(input.userInstructionsPath) });
    }

    const projectInstructionPaths = new Set<string>();
    const rootInstruction = path.join(projectRoot, 'RDC.md');
    if (fs.existsSync(rootInstruction)) projectInstructionPaths.add(rootInstruction);

    for (const activePath of input.activePaths) {
      const resolved = path.resolve(activePath);
      const lexicalTarget = fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? path.dirname(resolved) : resolved;
      const realTarget = realPathIfPresent(lexicalTarget);
      if (!isWithinRoot(realTarget, realProjectRoot)) {
        diagnostics.push({
          code: 'instructions.path.outside-project',
          severity: 'error',
          message: `Instruction target is outside the project: ${activePath}`,
          sourcePath: activePath,
        });
        continue;
      }

      const relative = path.relative(projectRoot, lexicalTarget);
      const parts = relative ? relative.split(path.sep).filter(Boolean) : [];
      let current = projectRoot;
      for (const part of parts) {
        current = path.join(current, part);
        const instructionPath = path.join(current, 'RDC.md');
        if (fs.existsSync(instructionPath)) projectInstructionPaths.add(instructionPath);
      }
    }

    Array.from(projectInstructionPaths)
      .sort((left, right) => {
        const leftDepth = path.relative(projectRoot, left).split(path.sep).length;
        const rightDepth = path.relative(projectRoot, right).split(path.sep).length;
        return leftDepth - rightDepth || left.localeCompare(right);
      })
      .forEach((sourcePath) => candidates.push({ scope: 'project', sourcePath }));

    let totalBytes = 0;
    candidates.forEach((candidate, index) => {
      const realSourcePath = realPathIfPresent(candidate.sourcePath);
      if (candidate.scope === 'project' && !isWithinRoot(realSourcePath, realProjectRoot)) {
        diagnostics.push({
          code: 'instructions.source.symlink-escape',
          severity: 'error',
          message: `RDC.md resolves outside the project: ${candidate.sourcePath}`,
          sourcePath: candidate.sourcePath,
        });
        return;
      }
      const content = fs.readFileSync(candidate.sourcePath, 'utf8').replace(/^\uFEFF/u, '').trim();
      if (!content) return;
      const byteLength = Buffer.byteLength(content, 'utf8');
      if (totalBytes + byteLength > budget) {
        diagnostics.push({
          code: 'instructions.budget.exceeded',
          severity: 'error',
          message: `Instruction budget ${budget} bytes would be exceeded by ${candidate.sourcePath}.`,
          sourcePath: candidate.sourcePath,
        });
        return;
      }
      totalBytes += byteLength;
      sources.push({
        id: `${candidate.scope}:${path.relative(candidate.scope === 'project' ? projectRoot : path.dirname(candidate.sourcePath), candidate.sourcePath) || 'RDC.md'}`,
        scope: candidate.scope,
        sourcePath: candidate.sourcePath,
        sourceHash: hashScopedResource(content),
        content,
        byteLength,
        precedence: index,
      });
    });

    return { sources, totalBytes, diagnostics };
  }
}

export const scopedInstructionResolver = new ScopedInstructionResolver();
