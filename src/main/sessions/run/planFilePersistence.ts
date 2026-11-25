import fs from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import { AppError } from '@shared/errors/appError';
import { storageIo } from '../store/sessionStores';
import type { ProjectPlanFrontmatter } from '@shared/types/planReview';
import type { StorageIo } from '../store/StorageIo';

export function assertPlanWritePath(targetPath: string): string {
  if (!path.isAbsolute(targetPath)) throw new AppError('PLAN_TARGET_INVALID', 'absolute path required.');
  const target = path.resolve(targetPath);
  let current = target;
  while (current) {
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new AppError('PLAN_TARGET_INVALID', 'links are not permitted.');
      if (current === target && !stat.isFile()) throw new AppError('PLAN_TARGET_INVALID', 'expected a file.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return target;
}

export function composeProjectPlan(markdown: string, fields: ProjectPlanFrontmatter): string {
  return '---\n' + stringify(fields) + '---\n\n' + markdown;
}

export function writePlanFile(targetPath: string, document: string, io: StorageIo = storageIo): void {
  const target = assertPlanWritePath(targetPath);
  const original = fs.existsSync(target) ? fs.readFileSync(target) : null;
  io.writeUtf8Atomic(target, document);
  try {
    if (!fs.readFileSync(target).equals(Buffer.from(document, 'utf8'))) throw new AppError('PLAN_WRITE_VERIFY_FAILED');
  } catch (error) {
    if (original) io.writeBytesAtomic(target, original);
    else fs.unlinkSync(target);
    throw error;
  }
}
