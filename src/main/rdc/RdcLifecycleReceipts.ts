import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@shared/errors/appError';
import { sessionArtifactResolver, type SessionArtifactResolver } from '../sessions/artifacts/SessionArtifactResolver';
import { secretStorageService } from '../settings/settings-core/SecretStorageService';
import { openSignedRdcReceipt } from './RdcExecutionReceipts';
import { RdcProcessIdentitySchema, type RdcProcessIdentity } from './RdcProcessIdentity';
import { RdcRecoveryObservationSchema } from './RdcContextStatus';
import { RdcRecoveryClassificationSchema, RdcRecoveryLostWorkerSchema } from './RdcRecoveryClassification';
import type { InvestigationContentRef } from '@shared/types/renderdocInvestigation';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const fingerprint = z.string().regex(/^[a-f0-9]{24}$/);
const id = z.string().min(1).max(2048);
const reference = z.object({ uri: id, expectedHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict();
const native = z
  .object({
    contextId: id,
    leaseVersion: z.number().int().positive(),
    replaySessionId: id,
    captureFileId: id,
    eventId: z.number().int().nonnegative(),
    processIdentity: RdcProcessIdentitySchema,
    replacementCount: z.number().int().nonnegative(),
    replacementFingerprint: hash,
  })
  .strict();
const point = z
  .object({
    inputId: id,
    contentSha256: hash,
    deviceId: id,
    native,
    target: z.object({ textureId: id, outputSlot: z.number().int().nonnegative().nullable() }).strict().nullable(),
    isFinalOutput: z.boolean(),
  })
  .strict();
const destination = z.object({ inputId: id, contentSha256: hash, deviceId: id }).strict();
const recovery = z
  .object({
    cause: z
      .object({ operation: id, argsFingerprint: hash, code: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/) })
      .strict(),
    observed: RdcRecoveryObservationSchema,
    classification: RdcRecoveryClassificationSchema,
  })
  .strict();
/**
 * What a recovery transition lost with the old replay process. Nothing here was rolled back: debug handles of the old
 * replay session are invalid, open experiments were interrupted by the infrastructure (their earlier receipts stay
 * bound to the old process identity, so a new baseline is required), and replacements are gone with the process.
 */
const lostWithProcess = z.strictObject({
  debugHandles: z.strictObject({ replaySessionId: id, invalidated: z.literal('all') }),
  experiments: z.array(
    z.strictObject({
      experimentId: id,
      status: z.enum(['running', 'polluted']),
      disposition: z.literal('interrupted-by-infrastructure'),
    }),
  ),
  replacementsAtLastVerified: z.strictObject({
    count: z.number().int().nonnegative(),
    fingerprint: hash,
    rolledBack: z.literal(false),
  }),
  workers: z.array(RdcRecoveryLostWorkerSchema),
  newBaselineRequired: z.literal(true),
});
export type RdcLostWithProcess = z.infer<typeof lostWithProcess>;
const base = {
  sessionId: id,
  projectId: id,
  turnId: id,
  operationId: id,
  planUri: id,
  planHash: hash,
  recordedAt: z.number().int().nonnegative(),
};
const receiptSchema = z.discriminatedUnion('event', [
  z.object({ ...base, event: z.literal('baseline'), original: point.nullable() }).strict(),
  z.object({ ...base, event: z.literal('resolved'), baseline: reference, observed: point.nullable() }).strict(),
  z
    .object({
      ...base,
      event: z.literal('intent'),
      original: point.nullable(),
      from: point.nullable(),
      destination: destination.nullable(),
      recovery: recovery.optional(),
    })
    .strict(),
  z
    .object({ ...base, event: z.literal('daemon-stopped'), intent: reference, contextId: id, stopped: z.literal(true) })
    .strict(),
  z
    .object({
      ...base,
      event: z.literal('transition'),
      intent: reference,
      from: point.nullable(),
      to: point.nullable(),
      previousFingerprint: fingerprint,
      runtimeFingerprint: fingerprint,
      daemonStopped: reference.optional(),
      restored: z.boolean(),
      lostWithProcess: lostWithProcess.optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      event: z.literal('position-restored'),
      intent: reference,
      from: point,
      to: point,
      runtimeFingerprint: fingerprint,
    })
    .strict(),
  z
    .object({
      ...base,
      event: z.literal('failed'),
      intent: reference,
      code: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
    })
    .strict(),
]);
export type RdcLifecycleReceipt = z.infer<typeof receiptSchema>;
export type RdcLifecyclePoint = z.infer<typeof point>;

/** A replay restart may change native IDs; the saved user position must still match. */
export function sameRdcLifecyclePosition(left: RdcLifecyclePoint | null, right: RdcLifecyclePoint | null): boolean {
  return left === null || right === null
    ? left === right
    : left.inputId === right.inputId &&
        left.contentSha256 === right.contentSha256 &&
        left.deviceId === right.deviceId &&
        left.native.eventId === right.native.eventId &&
        left.native.replacementCount === right.native.replacementCount &&
        left.native.replacementFingerprint === right.native.replacementFingerprint &&
        left.isFinalOutput === right.isFinalOutput &&
        JSON.stringify(left.target) === JSON.stringify(right.target);
}

const KEY_REF = 'rdc-lifecycle-receipt-signing';
function signingKey(): string {
  let key = secretStorageService.getSecret(KEY_REF);
  if (!key) {
    if (secretStorageService.hasSecretRecord(KEY_REF))
      throw new AppError('RDC_RECEIPT_KEY_UNAVAILABLE', 'lifecycle signing key cannot be decrypted.');
    key = randomBytes(32).toString('hex');
    secretStorageService.setSecret(KEY_REF, key);
  }
  return key;
}

/** Session artifacts contain only identities and signed host observations, never executable settings. */
export class RdcLifecycleReceipts {
  constructor(
    private readonly resolver: SessionArtifactResolver = sessionArtifactResolver,
    private readonly key: () => string = signingKey,
  ) {}
  prepare(): void {
    this.key();
  }
  write(input: RdcLifecycleReceipt): InvestigationContentRef {
    const receipt = receiptSchema.parse(input);
    const body = JSON.stringify(receipt);
    const signature = createHmac('sha256', this.key()).update(body).digest('hex');
    const written = this.resolver.write(
      receipt.sessionId,
      `session://tool-outputs/rdc-lifecycle-${randomUUID()}.json`,
      JSON.stringify({ body, signature }),
      { mimeType: 'application/json' },
    );
    return { uri: written.uri, expectedHash: `sha256:${written.hash}` };
  }
  read(sessionId: string, ref: InvestigationContentRef): RdcLifecycleReceipt {
    reference.parse(ref);
    const source = this.resolver.read(sessionId, ref.uri, { expectedHash: ref.expectedHash.slice(7) });
    if (source.category !== 'tool-outputs' || source.truncated || !source.text)
      throw new AppError('RDC_LIFECYCLE_RECEIPT_INVALID', 'incomplete receipt.');
    const parsed = receiptSchema.safeParse(
      openSignedRdcReceipt(source.text, this.key, 'RDC_LIFECYCLE_RECEIPT_INVALID'),
    );
    if (!parsed.success)
      throw new AppError('RDC_LIFECYCLE_RECEIPT_INVALID', `malformed receipt: ${z.prettifyError(parsed.error)}`);
    const receipt = parsed.data;
    if (receipt.sessionId !== sessionId) throw new AppError('RDC_LIFECYCLE_RECEIPT_INVALID', 'foreign session.');
    return receipt;
  }

  /**
   * Recovery attempts on one approved input, content and device across every turn of the session: each signed recovery
   * intent is an attempt, and `failed` counts the attempts whose signed failed receipt names that intent.
   */
  /** Recoveries this turn started on the destination; a refused classification signs no intent and is not one. */
  recoveryAttempts(
    sessionId: string,
    projectId: string,
    destination: { inputId: string; contentSha256: string; deviceId: string },
    turnId: string,
  ): { attempts: number; failed: number } {
    const values = this.readAll(sessionId, projectId);
    const intents = values.filter(
      ({ value }) =>
        value.event === 'intent' &&
        !!value.recovery &&
        value.turnId === turnId &&
        value.destination?.inputId === destination.inputId &&
        value.destination.contentSha256 === destination.contentSha256 &&
        value.destination.deviceId === destination.deviceId,
    );
    const refs = new Set(intents.map(({ ref }) => JSON.stringify(ref)));
    const failed = values.filter(({ value }) => value.event === 'failed' && refs.has(JSON.stringify(value.intent)));
    return { attempts: intents.length, failed: failed.length };
  }

  private readAll(
    sessionId: string,
    projectId: string,
  ): Array<{ ref: InvestigationContentRef; value: RdcLifecycleReceipt }> {
    return this.resolver
      .list(sessionId, 'tool-outputs')
      .filter((uri) => /^session:\/\/tool-outputs\/rdc-lifecycle-[0-9a-f-]+\.json$/iu.test(uri))
      .map((uri) => {
        const source = this.resolver.read(sessionId, uri);
        if (source.truncated) throw new AppError('RDC_LIFECYCLE_RECEIPT_INVALID', 'incomplete receipt.');
        const ref = { uri, expectedHash: `sha256:${source.hash}` };
        return { ref, value: this.read(sessionId, ref) };
      })
      .filter((item) => item.value.projectId === projectId);
  }

  /** Reconstruct unresolved user positions from signed session artifacts, without resuming execution. */
  pending(
    sessionId: string,
    projectId: string,
  ): {
    baseline: Extract<RdcLifecycleReceipt, { event: 'baseline' }>;
    ref: InvestigationContentRef;
    count: number;
    identities: Array<{ contextId: string; processIdentity: RdcProcessIdentity; stopped: boolean }>;
    /** The most recent position main observed and signed in this chain. */
    latest: RdcLifecyclePoint | null;
  } | null {
    const values = this.readAll(sessionId, projectId);
    const baselines = values.filter(
      (item): item is typeof item & { value: Extract<RdcLifecycleReceipt, { event: 'baseline' }> } =>
        item.value.event === 'baseline',
    );
    const resolved = values.filter(
      (item): item is typeof item & { value: Extract<RdcLifecycleReceipt, { event: 'resolved' }> } =>
        item.value.event === 'resolved',
    );
    const outstanding = baselines
      .filter(
        (item) =>
          !resolved.some((candidate) => {
            const record = candidate.value;
            const original = item.value;
            return (
              JSON.stringify(record.baseline) === JSON.stringify(item.ref) &&
              record.turnId === original.turnId &&
              record.planUri === original.planUri &&
              record.planHash === original.planHash &&
              record.recordedAt >= original.recordedAt &&
              sameRdcLifecyclePosition(record.observed, original.original)
            );
          }),
      )
      .sort(
        (a, b) => a.value.recordedAt - b.value.recordedAt || a.value.operationId.localeCompare(b.value.operationId),
      );
    if (!outstanding.length) return null;
    const first = outstanding[0];
    const baseline = first.value;
    // The chain spans every later turn of the same plan: a turn that adopts the record keeps signing under its own id.
    const relevant = values.filter(
      (item) =>
        item.value.recordedAt >= baseline.recordedAt &&
        item.value.planHash === baseline.planHash &&
        item.value.planUri === baseline.planUri,
    );
    const identities = new Map<string, { contextId: string; processIdentity: RdcProcessIdentity; stopped: boolean }>();
    const add = (snapshot: z.infer<typeof native> | null | undefined) => {
      if (!snapshot) return;
      const key = JSON.stringify([snapshot.contextId, snapshot.processIdentity]);
      if (!identities.has(key))
        identities.set(key, {
          contextId: snapshot.contextId,
          processIdentity: snapshot.processIdentity,
          stopped: false,
        });
    };
    for (const { value } of relevant) {
      if (value.event === 'baseline') add(value.original?.native);
      if (value.event === 'intent') {
        add(value.original?.native);
        add(value.from?.native);
        // A worker that was live when recovery looked may still hold the context if recovery stopped early.
        const seen = value.recovery?.observed;
        const live =
          seen?.daemon.state === 'alive' && seen.worker.state === 'alive'
            ? RdcProcessIdentitySchema.safeParse({
                status: 'available',
                daemon: { pid: seen.daemon.pid, start_generation: seen.daemon.start_generation },
                worker: { pid: seen.worker.pid, start_generation: seen.worker.start_generation },
              })
            : null;
        if (value.from && live?.success) add({ ...value.from.native, processIdentity: live.data });
      }
      if (value.event === 'transition' || value.event === 'position-restored') {
        add(value.from?.native);
        add(value.to?.native);
      }
    }
    for (const { value } of relevant) {
      if (value.event !== 'daemon-stopped') continue;
      const intent = relevant.find((item) => JSON.stringify(item.ref) === JSON.stringify(value.intent))?.value;
      if (
        intent?.event !== 'intent' ||
        intent.operationId !== value.operationId ||
        intent.from?.native.contextId !== value.contextId ||
        intent.recordedAt > value.recordedAt
      )
        continue;
      const key = JSON.stringify([value.contextId, intent.from.native.processIdentity]);
      const identity = identities.get(key);
      if (identity) identity.stopped = true;
    }
    return {
      baseline,
      ref: first.ref,
      count: outstanding.length,
      identities: [...identities.values()],
      latest: latestSignedPoint(relevant.map((item) => item.value)),
    };
  }
}

function latestSignedPoint(receipts: readonly RdcLifecycleReceipt[]): RdcLifecyclePoint | null {
  let latest: { at: number; point: RdcLifecyclePoint } | null = null;
  for (const value of receipts) {
    const point =
      value.event === 'baseline'
        ? value.original
        : value.event === 'intent'
          ? value.from
          : value.event === 'transition' || value.event === 'position-restored'
            ? value.to
            : null;
    if (point && (!latest || value.recordedAt >= latest.at)) latest = { at: value.recordedAt, point };
  }
  return latest?.point ?? null;
}
export const rdcLifecycleReceipts = new RdcLifecycleReceipts();
