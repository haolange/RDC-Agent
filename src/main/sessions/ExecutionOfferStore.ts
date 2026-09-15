import * as path from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { z } from 'zod';
import { EXECUTION_OFFER_SCHEMA, type ExecutionOffer } from '@shared/types/executionOffer';
import type { StorageIo } from './StorageIo';

export const EXECUTION_OFFER_FILE = 'execution-offer.json';
export const REMOVED_HANDOFF_STATE_FILE = 'handoff-state.json';

const ExecutionOfferSchema = z.object({
  schemaVersion: z.literal(EXECUTION_OFFER_SCHEMA),
  sourceAgentId: z.string().trim().min(1),
  targetAgentId: z.string().trim().min(1),
  plan: z.object({
    uri: z.string().trim().min(1),
    hash: z.string().trim().min(1),
  }).strict(),
  requiredSkillIds: z.array(z.string().trim().min(1)),
  label: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  approvedAt: z.number(),
}).strict();

export interface ExecutionOfferHost {
  io: StorageIo;
  sessions: { findSessionLocation(sessionId: string): { sessionPath: string } | null };
}

export function executionOfferMatches(
  offer: ExecutionOffer | null,
  input: { agentId: string; planHash?: string | null; planUri?: string | null },
): offer is ExecutionOffer {
  if (!offer) return false;
  if (offer.targetAgentId !== input.agentId) return false;
  if (input.planHash && offer.plan.hash.replace(/^sha256:/, '') !== input.planHash.replace(/^sha256:/, '')) {
    return false;
  }
  if (input.planUri && offer.plan.uri !== input.planUri) return false;
  return true;
}

export class ExecutionOfferStore {
  constructor(private readonly host: ExecutionOfferHost) {}

  discardRemovedHandoffState(sessionId: string): void {
    const location = this.host.sessions.findSessionLocation(sessionId);
    if (!location) return;
    const filePath = path.join(location.sessionPath, REMOVED_HANDOFF_STATE_FILE);
    if (!existsSync(filePath)) return;
    unlinkSync(filePath);
  }

  read(sessionId: string | null | undefined): ExecutionOffer | null {
    if (!sessionId) return null;
    const filePath = this.offerPath(sessionId);
    return filePath ? this.host.io.readJson(filePath, ExecutionOfferSchema) : null;
  }

  write(sessionId: string, offer: ExecutionOffer): ExecutionOffer {
    const filePath = this.offerPath(sessionId);
    if (!filePath) {
      throw new Error('EXECUTION_OFFER_SESSION_MISSING: session path is required to persist an execution offer.');
    }
    const parsed = ExecutionOfferSchema.parse(offer);
    this.host.io.writeJsonAtomic(filePath, parsed);
    return parsed;
  }

  clear(sessionId: string | null | undefined): void {
    if (!sessionId) return;
    const filePath = this.offerPath(sessionId);
    if (!filePath || !existsSync(filePath)) return;
    unlinkSync(filePath);
  }

  private offerPath(sessionId: string): string | null {
    const location = this.host.sessions.findSessionLocation(sessionId);
    if (!location) return null;
    return path.join(location.sessionPath, EXECUTION_OFFER_FILE);
  }
}
