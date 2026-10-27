import { z } from 'zod';
import type { RdcTurnBinding } from './RdcTurnBindings';

export const RdcDiscoverySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('search'), query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(20).default(8) }).strict(),
  z.object({ kind: z.literal('describe'), operation: z.string().regex(/^rd[.][a-z_]+[.][a-z0-9_]+$/) }).strict(),
  z.object({ kind: z.literal('list'), limit: z.number().int().min(1).max(20).default(20),
    cursor: z.object({ offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
  }).strict(),
]);
export const RdcShellInputSchema = z.union([
  z.object({ operation: z.string().regex(/^rd[.][a-z_]+[.][a-z0-9_]+$/), args: z.record(z.string(), z.unknown()), experimentId: z.string().trim().min(1).max(128).optional() }).strict(),
  z.object({ discovery: RdcDiscoverySchema }).strict(),
]);
export type RdcShellInput = z.infer<typeof RdcShellInputSchema>;

/** Catalog-dependent query validation is identical at approval and execution. */
export function assertRdcDiscovery(request: z.infer<typeof RdcDiscoverySchema>, binding: RdcTurnBinding): void {
  if (request.kind === 'describe' && !binding.definitions.some(item => item.name === request.operation)) {
    throw new Error('RDC_EXECUTION_DENIED: unknown operation.');
  }
  if (request.kind === 'list' && request.cursor) {
    if (request.cursor.fingerprint !== binding.definitionsFingerprint) throw new Error('RDC_DISCOVERY_CURSOR: frozen catalog fingerprint mismatch.');
    if (request.cursor.offset > binding.definitions.length) throw new Error('RDC_DISCOVERY_CURSOR: offset is outside the frozen catalog.');
  }
}

/** Validate the same exclusive input before classification and before execution. */
export function parseShellRdcInput(params: { command?: unknown; rdc?: unknown }): RdcShellInput | null {
  const hasCommand = typeof params.command === 'string' && params.command.trim().length > 0;
  const hasRdc = params.rdc !== undefined;
  if (hasCommand === hasRdc || (params.command !== undefined && !hasCommand)) {
    throw new Error('SHELL_INPUT: provide exactly one of command or rdc.');
  }
  return hasRdc ? RdcShellInputSchema.parse(params.rdc) : null;
}
