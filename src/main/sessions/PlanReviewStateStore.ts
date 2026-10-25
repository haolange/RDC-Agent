import { z } from 'zod';
import * as path from 'node:path';
import {
  PLAN_REVIEW_STATE_SCHEMA,
  type PlanReviewHandoffOption,
  type PlanReviewStateDocument,
  type PlanReviewStatus,
} from '@shared/types/planReview';
import { generateShortId, nowMs } from '@shared/utils/id';
import { storageAdapter } from './StorageAdapter';
import type { StorageIo } from './StorageIo';

const planReviewStateSchema = z.object({
  schemaVersion: z.literal(PLAN_REVIEW_STATE_SCHEMA),
  planId: z.string().trim().min(1),
  ownerTurnId: z.string().trim().min(1).optional(),
  revision: z.number().int().positive(),
  status: z.enum(['awaiting', 'approved', 'rejected', 'superseded', 'cancelled']),
  approvedHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  frozenUri: z.string().regex(/^session:\/\/plans\/plan-.+\.md$/).optional(),
  approvedHandoff: z.object({ label: z.string().trim().min(1), agent: z.string().trim().min(1) }).strict().optional(),
  updatedAt: z.number().int().nonnegative(),
}).strict().superRefine((state, context) => {
  const fields = [state.approvedHash, state.frozenUri, state.approvedHandoff];
  if (state.status === 'approved' ? fields.some(value => value === undefined) : fields.some(value => value !== undefined)) {
    context.addIssue({ code: 'custom', message: 'Approved state requires a complete frozen plan binding; other states cannot carry approval.' });
  }
});

export interface PlanReviewStateHost {
  io: StorageIo;
  sessions: { findSessionLocation(sessionId: string): { sessionPath: string } | null };
}

export interface BeginPlanRevisionResult {
  planId: string;
  revision: number;
  newCycle: boolean;
}

export class PlanReviewStateStore {
  constructor(private readonly host: PlanReviewStateHost = storageAdapter) {}

  getStatePath(sessionId: string): string | null {
    const location = this.host.sessions.findSessionLocation(sessionId);
    if (!location) return null;
    return path.join(location.sessionPath, 'plan-state.json');
  }

  read(sessionId: string): PlanReviewStateDocument | null {
    const filePath = this.getStatePath(sessionId);
    return filePath ? this.host.io.readJson(filePath, planReviewStateSchema) : null;
  }

  beginRevision(sessionId: string, ownerTurnId: string): BeginPlanRevisionResult {
    if (!ownerTurnId.trim()) throw new Error('PLAN_REVIEW_OWNER_REQUIRED: a plan requires its owning turn.');
    const previous = this.read(sessionId);
    const newCycle = !previous || previous.ownerTurnId !== ownerTurnId
      || previous.status === 'approved' || previous.status === 'cancelled';
    const next: PlanReviewStateDocument = {
      schemaVersion: PLAN_REVIEW_STATE_SCHEMA,
      planId: newCycle ? `plan-${generateShortId()}` : previous.planId,
      ownerTurnId,
      revision: newCycle ? 1 : previous.revision + 1,
      status: 'awaiting',
      updatedAt: nowMs(),
    };
    this.write(sessionId, next);
    storageAdapter.executionOffers.clear(sessionId);
    return { planId: next.planId, revision: next.revision, newCycle };
  }

  cancelReview(sessionId: string, ownerTurnId: string, planId: string, revision: number): boolean {
    const current = this.read(sessionId);
    if (!current || current.ownerTurnId !== ownerTurnId || current.planId !== planId
      || current.revision !== revision || current.status !== 'awaiting') return false;
    this.write(sessionId, { ...current, status: 'cancelled', updatedAt: nowMs() });
    storageAdapter.executionOffers.clear(sessionId);
    return true;
  }

  markDecision(
    sessionId: string,
    status: Extract<PlanReviewStatus, 'approved' | 'rejected'>,
    owner: { turnId: string; planId: string; revision: number },
    extras?: { approvedHash?: string; frozenUri?: string; approvedHandoff?: PlanReviewHandoffOption },
  ): PlanReviewStateDocument {
    const current = this.read(sessionId);
    if (!current) {
      throw new Error('PLAN_REVIEW_STATE_MISSING: no live plan review to decide.');
    }
    if (current.ownerTurnId !== owner.turnId || current.planId !== owner.planId
      || current.revision !== owner.revision || current.status !== 'awaiting') {
      throw new Error('PLAN_REVIEW_SCOPE_CHANGED: this review no longer owns the current plan.');
    }
    const next: PlanReviewStateDocument = {
      ...current,
      status,
      approvedHash: extras?.approvedHash,
      frozenUri: extras?.frozenUri,
      approvedHandoff: extras?.approvedHandoff,
      updatedAt: nowMs(),
    };
    this.write(sessionId, next);
    if (status === 'rejected') {
      storageAdapter.executionOffers.clear(sessionId);
    }
    return next;
  }

  private write(sessionId: string, document: PlanReviewStateDocument): void {
    const filePath = this.getStatePath(sessionId);
    if (!filePath) {
      throw new Error(`PLAN_REVIEW_STATE_MISSING: session not found: ${sessionId}`);
    }
    this.host.io.writeJsonAtomic(filePath, planReviewStateSchema.parse(document));
  }
}

export const planReviewStateStore = new PlanReviewStateStore();
