/**
 * Canonical knowledge read-root resolution for prepareTurn.
 *
 * Frozen onto EffectiveRuntimePlan.knowledgeReadRoots. Policy and executor
 * may grant these roots only to read_file / read_image / glob / grep.
 * Missing / non-directory candidates are omitted. A root that is itself a
 * symlink or junction is omitted and reported as a diagnostic.
 */

import * as fs from 'fs';
import * as path from 'path';

export const KNOWLEDGE_READ_FILE_TOOLS = new Set(['read_file', 'read_image', 'glob', 'grep']);

export type KnowledgeReadRootSkipReason =
  | 'missing'
  | 'not-directory'
  | 'symlink-or-junction'
  | 'realpath-failed';

export interface KnowledgeReadRootDiagnostic {
  candidate: string;
  reason: KnowledgeReadRootSkipReason;
  message: string;
}

export interface KnowledgeReadRootResolution {
  roots: string[];
  diagnostics: KnowledgeReadRootDiagnostic[];
}

export interface ResolveKnowledgeReadRootsInput {
  userKnowledgePath: string;
  projectKnowledgePath?: string | null;
}

export function isKnowledgeReadFileTool(toolName: string): boolean {
  return KNOWLEDGE_READ_FILE_TOOLS.has(toolName.trim().toLowerCase().replace(/[.-]/g, '_'));
}

export function pathIdentityKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.normalize('NFC').toLowerCase() : resolved;
}

function skip(
  candidate: string,
  reason: KnowledgeReadRootSkipReason,
  message: string,
): KnowledgeReadRootDiagnostic {
  return { candidate, reason, message };
}

function considerCandidate(
  candidate: string,
  diagnostics: KnowledgeReadRootDiagnostic[],
): string | null {
  const resolved = path.resolve(candidate);
  if (!fs.existsSync(resolved)) {
    return null;
  }

  let lexicalStat: fs.Stats;
  try {
    lexicalStat = fs.lstatSync(resolved);
  } catch (error) {
    diagnostics.push(skip(
      resolved,
      'realpath-failed',
      `KNOWLEDGE_READ_ROOT_SKIPPED: cannot stat knowledge root ${resolved}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ));
    return null;
  }

  if (lexicalStat.isSymbolicLink()) {
    diagnostics.push(skip(
      resolved,
      'symlink-or-junction',
      `KNOWLEDGE_READ_ROOT_SKIPPED: refusing symlink/junction knowledge root ${resolved}.`,
    ));
    return null;
  }
  if (!lexicalStat.isDirectory()) {
    return null;
  }

  try {
    const real = fs.realpathSync.native
      ? fs.realpathSync.native(resolved)
      : fs.realpathSync(resolved);
    const realStat = fs.lstatSync(real);
    if (realStat.isSymbolicLink()) {
      diagnostics.push(skip(
        resolved,
        'symlink-or-junction',
        `KNOWLEDGE_READ_ROOT_SKIPPED: refusing symlink/junction knowledge root ${resolved}.`,
      ));
      return null;
    }
    if (!fs.statSync(real).isDirectory()) {
      return null;
    }
    return path.resolve(real);
  } catch (error) {
    diagnostics.push(skip(
      resolved,
      'realpath-failed',
      `KNOWLEDGE_READ_ROOT_SKIPPED: cannot realpath knowledge root ${resolved}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ));
    return null;
  }
}

/**
 * Resolve user + project knowledge directories into existing, real directories.
 * Canonical order is user then project. Duplicate identities (8.3 / case) collapse.
 */
export function resolveKnowledgeReadRoots(
  input: ResolveKnowledgeReadRootsInput,
): KnowledgeReadRootResolution {
  const diagnostics: KnowledgeReadRootDiagnostic[] = [];
  const roots: string[] = [];
  const seen = new Set<string>();

  for (const candidate of [input.userKnowledgePath, input.projectKnowledgePath]) {
    if (!candidate?.trim()) continue;
    const root = considerCandidate(candidate, diagnostics);
    if (!root) continue;
    const key = pathIdentityKey(root);
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push(root);
  }

  return { roots, diagnostics };
}
