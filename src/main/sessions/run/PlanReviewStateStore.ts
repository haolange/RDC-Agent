import * as path from 'node:path';
import { z } from 'zod';
import { generateShortId, nowMs } from '@shared/utils/id';
import { AppError } from '@shared/errors/appError';
import { executionOfferStore, sessionRecordStore, storageIo } from '../store/sessionStores';
import type { StorageIo } from '../../runtime/StorageIo';
import type { PlanReviewHandoffIdentity, PlanReviewStatus } from '@shared/types/planReview';

export const PLAN_REVIEW_STATE_SCHEMA = '1' as const;

export interface PlanReviewStateDocument {
  schemaVersion: typeof PLAN_REVIEW_STATE_SCHEMA;
  planId: string;
  /** Absence means ownership is unproven; never infer it from the active session. */
  ownerTurnId?: string;
  revision: number;
  status: PlanReviewStatus;
  approvedHash?: string;
  frozenUri?: string;
  approvedHandoff?: PlanReviewHandoffIdentity;
  updatedAt: number;
}

const planReviewStateSchema = z
  .object({
    schemaVersion: z.literal(PLAN_REVIEW_STATE_SCHEMA),
    planId: z.string().trim().min(1),
    ownerTurnId: z.string().trim().min(1).optional(),
    revision: z.number().int().positive(),
    status: z.enum(['awaiting', 'approved', 'rejected', 'superseded', 'cancelled']),
    approvedHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    frozenUri: z
      .string()
      .regex(/^session:\/\/plans\/plan-.+\.md$/)
      .optional(),
    approvedHandoff: z
      .object({ label: z.string().trim().min(1), agent: z.string().trim().min(1) })
      .strict()
      .optional(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((state, context) => {
    const fields = [state.approvedHash, state.frozenUri, state.approvedHandoff];
    if (
      state.status === 'approved'
        ? fields.some((value) => value === undefined)
        : fields.some((value) => value !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Approved state requires a complete frozen plan binding; other states cannot carry approval.',
      });
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
  constructor(private readonly host: PlanReviewStateHost) {}

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
    if (!ownerTurnId.trim()) throw new AppError('PLAN_REVIEW_OWNER_REQUIRED', 'a plan requires its owning turn.');
    const previous = this.read(sessionId);
    const newCycle =
      !previous ||
      previous.ownerTurnId !== ownerTurnId ||
      previous.status === 'approved' ||
      previous.status === 'cancelled';
    const next: PlanReviewStateDocument = {
      schemaVersion: PLAN_REVIEW_STATE_SCHEMA,
      planId: newCycle ? `plan-${generateShortId()}` : previous.planId,
      ownerTurnId,
      revision: newCycle ? 1 : previous.revision + 1,
      status: 'awaiting',
      updatedAt: nowMs(),
    };
    this.write(sessionId, next);
    executionOfferStore.clear(sessionId);
    return { planId: next.planId, revision: next.revision, newCycle };
  }

  cancelReview(sessionId: string, ownerTurnId: string, planId: string, revision: number): boolean {
    const current = this.read(sessionId);
    if (
      !current ||
      current.ownerTurnId !== ownerTurnId ||
      current.planId !== planId ||
      current.revision !== revision ||
      current.status !== 'awaiting'
    )
      return false;
    this.write(sessionId, { ...current, status: 'cancelled', updatedAt: nowMs() });
    executionOfferStore.clear(sessionId);
    return true;
  }

  reopenReview(sessionId: string, ownerTurnId: string, planId: string, revision: number): void {
    const current = this.read(sessionId);
    if (
      !current ||
      current.ownerTurnId !== ownerTurnId ||
      current.planId !== planId ||
      current.revision !== revision ||
      current.status !== 'cancelled'
    )
      throw new AppError('PLAN_REVIEW_SCOPE_CHANGED', 'plan cannot be reopened.');
    this.write(sessionId, { ...current, status: 'awaiting', updatedAt: nowMs() });
  }

  /** The live review this owner is deciding; anything else means the decision is late. */
  assertAwaiting(
    sessionId: string,
    owner: { turnId: string; planId: string; revision: number },
  ): PlanReviewStateDocument {
    const current = this.read(sessionId);
    if (!current) {
      throw new AppError('PLAN_REVIEW_STATE_MISSING', 'no live plan review to decide.');
    }
    if (
      current.ownerTurnId !== owner.turnId ||
      current.planId !== owner.planId ||
      current.revision !== owner.revision ||
      current.status !== 'awaiting'
    ) {
      throw new AppError('PLAN_REVIEW_SCOPE_CHANGED', 'this review no longer owns the current plan.');
    }
    return current;
  }

  markRejected(
    sessionId: string,
    owner: { turnId: string; planId: string; revision: number },
  ): PlanReviewStateDocument {
    const next: PlanReviewStateDocument = {
      ...this.assertAwaiting(sessionId, owner),
      status: 'rejected',
      updatedAt: nowMs(),
    };
    this.write(sessionId, next);
    executionOfferStore.clear(sessionId);
    return next;
  }

  /** Writes a whole document: the approval transaction's commit step, and its rollback to the pre-image. */
  replace(sessionId: string, document: PlanReviewStateDocument): void {
    this.write(sessionId, document);
  }

  private write(sessionId: string, document: PlanReviewStateDocument): void {
    const filePath = this.getStatePath(sessionId);
    if (!filePath) {
      throw new AppError('PLAN_REVIEW_STATE_MISSING', `session not found: ${sessionId}`);
    }
    this.host.io.writeJsonAtomic(filePath, planReviewStateSchema.parse(document));
  }
}

/** The host resolves on use, so the store always reads through the shared session stores. */
export const planReviewStateStore = new PlanReviewStateStore({
  get io() {
    return storageIo;
  },
  get sessions() {
    return sessionRecordStore;
  },
});
