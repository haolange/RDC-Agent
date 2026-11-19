import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { InvestigationContentRef } from '@shared/types/renderdocInvestigation';
import { sessionArtifactResolver, type SessionArtifactResolver } from '../sessions/artifacts/SessionArtifactResolver';
import { secretStorageService } from '../settings/settings-core/SecretStorageService';
import { parseRdcProcessIdentity } from './RdcProcessIdentity';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const fingerprint = z.string().regex(/^[a-f0-9]{24}$/);
const id = z.string().min(1).max(2048);
const reference = z.object({ uri: id, expectedHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict();
const native = z.object({ contextId: id, leaseVersion: z.number().int().positive(), replaySessionId: id,
  captureFileId: id, eventId: z.number().int().nonnegative(), processIdentity: z.unknown(), replacementCount: z.number().int().nonnegative(), replacementFingerprint: hash }).strict();
const point = z.object({ inputId: id, contentSha256: hash, deviceId: id, native,
  target: z.object({ textureId: id, outputSlot: z.number().int().nonnegative().nullable() }).strict().nullable(),
  isFinalOutput: z.boolean() }).strict();
const destination = z.object({ inputId: id, contentSha256: hash, deviceId: id }).strict();
const recovery = z.object({ cause: z.object({ operation: id, argsFingerprint: hash,
  code: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/) }).strict(), observed: native }).strict();
const base = { schemaVersion: z.literal(1), sessionId: id, projectId: id, turnId: id, operationId: id,
  planUri: id, planHash: hash, recordedAt: z.number().int().nonnegative() };
const receiptSchema = z.discriminatedUnion('event', [
  z.object({ ...base, event: z.literal('baseline'), original: point.nullable() }).strict(),
  z.object({ ...base, event: z.literal('resolved'), baseline: reference, observed: point.nullable() }).strict(),
  z.object({ ...base, event: z.literal('intent'), original: point.nullable(), from: point.nullable(), destination: destination.nullable(), recovery: recovery.optional() }).strict(),
  z.object({ ...base, event: z.literal('daemon-stopped'), intent: reference, contextId: id, stopped: z.literal(true) }).strict(),
  z.object({ ...base, event: z.literal('transition'), intent: reference, from: point.nullable(), to: point.nullable(),
    previousFingerprint: fingerprint, runtimeFingerprint: fingerprint, daemonStopped: reference.optional(), restored: z.boolean() }).strict(),
  z.object({ ...base, event: z.literal('position-restored'), intent: reference, from: point, to: point, runtimeFingerprint: fingerprint }).strict(),
  z.object({ ...base, event: z.literal('failed'), intent: reference, code: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/) }).strict(),
]);
export type RdcLifecycleReceipt = z.infer<typeof receiptSchema>;
export type RdcLifecyclePoint = z.infer<typeof point>;

/** A replay restart may change native IDs; the saved user position must still match. */
export function sameRdcLifecyclePosition(left: RdcLifecyclePoint | null, right: RdcLifecyclePoint | null): boolean {
  return left === null || right === null ? left === right
    : left.inputId === right.inputId && left.contentSha256 === right.contentSha256 && left.deviceId === right.deviceId
      && left.native.eventId === right.native.eventId && left.native.replacementCount === right.native.replacementCount
      && left.native.replacementFingerprint === right.native.replacementFingerprint
      && left.isFinalOutput === right.isFinalOutput && JSON.stringify(left.target) === JSON.stringify(right.target);
}

const KEY_REF = 'rdc-lifecycle-receipt-signing-v1';
function signingKey(): string {
  let key = secretStorageService.getSecret(KEY_REF);
  if (!key) {
    if (secretStorageService.hasSecretRecord(KEY_REF)) throw new Error('RDC_RECEIPT_KEY_UNAVAILABLE: lifecycle signing key cannot be decrypted.');
    key = randomBytes(32).toString('hex');
    secretStorageService.setSecret(KEY_REF, key);
  }
  return key;
}

/** Session artifacts contain only identities and signed host observations, never executable settings. */
export class RdcLifecycleReceipts {
  constructor(private readonly resolver: SessionArtifactResolver = sessionArtifactResolver, private readonly key: () => string = signingKey) {}
  prepare(): void { this.key(); }
  write(input: RdcLifecycleReceipt): InvestigationContentRef {
    const receipt = receiptSchema.parse(input);
    for (const value of receipt.event === 'baseline' ? [receipt.original] : receipt.event === 'resolved' ? [receipt.observed]
      : receipt.event === 'intent' ? [receipt.original, receipt.from]
      : receipt.event === 'transition' || receipt.event === 'position-restored' ? [receipt.from, receipt.to] : []) {
      if (value) parseRdcProcessIdentity(value.native.processIdentity);
    }
    if (receipt.event === 'intent' && receipt.recovery) parseRdcProcessIdentity(receipt.recovery.observed.processIdentity);
    const body = JSON.stringify(receipt);
    const signature = createHmac('sha256', this.key()).update(body).digest('hex');
    const written = this.resolver.write(receipt.sessionId, `session://tool-outputs/rdc-lifecycle-${randomUUID()}.json`,
      JSON.stringify({ body, signature }), { mimeType: 'application/json' });
    return { uri: written.uri, expectedHash: `sha256:${written.hash}` };
  }
  read(sessionId: string, ref: InvestigationContentRef): RdcLifecycleReceipt {
    reference.parse(ref);
    const source = this.resolver.read(sessionId, ref.uri, { expectedHash: ref.expectedHash.slice(7) });
    if (source.category !== 'tool-outputs' || source.truncated || !source.text) throw new Error('RDC_LIFECYCLE_RECEIPT_INVALID: incomplete receipt.');
    const signed = JSON.parse(source.text) as { body?: unknown; signature?: unknown };
    if (typeof signed.body !== 'string' || typeof signed.signature !== 'string' || !/^[a-f0-9]{64}$/.test(signed.signature)) {
      throw new Error('RDC_LIFECYCLE_RECEIPT_INVALID: unsigned content.');
    }
    const expected = createHmac('sha256', this.key()).update(signed.body).digest();
    if (!timingSafeEqual(expected, Buffer.from(signed.signature, 'hex'))) throw new Error('RDC_LIFECYCLE_RECEIPT_INVALID: signature mismatch.');
    const receipt = receiptSchema.parse(JSON.parse(signed.body));
    if (receipt.sessionId !== sessionId) throw new Error('RDC_LIFECYCLE_RECEIPT_INVALID: foreign session.');
    for (const value of receipt.event === 'baseline' ? [receipt.original] : receipt.event === 'resolved' ? [receipt.observed]
      : receipt.event === 'intent' ? [receipt.original, receipt.from]
      : receipt.event === 'transition' || receipt.event === 'position-restored' ? [receipt.from, receipt.to] : []) {
      if (value) parseRdcProcessIdentity(value.native.processIdentity);
    }
    if (receipt.event === 'intent' && receipt.recovery) parseRdcProcessIdentity(receipt.recovery.observed.processIdentity);
    return receipt;
  }

  /** Reconstruct unresolved user positions from signed session artifacts, without resuming execution. */
  pending(sessionId: string, projectId: string): { baseline: Extract<RdcLifecycleReceipt, { event: 'baseline' }>; ref: InvestigationContentRef; count: number;
    identities: Array<{ contextId: string; processIdentity: ReturnType<typeof parseRdcProcessIdentity>; stopped: boolean }> } | null {
    const values = this.resolver.list(sessionId, 'tool-outputs')
      .filter(uri => /^session:\/\/tool-outputs\/rdc-lifecycle-[0-9a-f-]+\.json$/iu.test(uri))
      .map(uri => {
        const source = this.resolver.read(sessionId, uri);
        if (source.truncated) throw new Error('RDC_LIFECYCLE_RECEIPT_INVALID: incomplete receipt.');
        const ref = { uri, expectedHash: `sha256:${source.hash}` };
        return { ref, value: this.read(sessionId, ref) };
      }).filter(item => item.value.projectId === projectId);
    const baselines = values.filter((item): item is typeof item & { value: Extract<RdcLifecycleReceipt, { event: 'baseline' }> } => item.value.event === 'baseline');
    const resolved = values.filter((item): item is typeof item & { value: Extract<RdcLifecycleReceipt, { event: 'resolved' }> } => item.value.event === 'resolved');
    const outstanding = baselines.filter(item => !resolved.some(candidate => {
      const record = candidate.value; const original = item.value;
      return JSON.stringify(record.baseline) === JSON.stringify(item.ref) && record.turnId === original.turnId
        && record.planUri === original.planUri && record.planHash === original.planHash && record.recordedAt >= original.recordedAt
        && sameRdcLifecyclePosition(record.observed, original.original);
    })).sort((a, b) => a.value.recordedAt - b.value.recordedAt || a.value.operationId.localeCompare(b.value.operationId));
    if (!outstanding.length) return null;
    const first = outstanding[0]; const baseline = first.value;
    const relevant = values.filter(item => item.value.turnId === baseline.turnId && item.value.planHash === baseline.planHash
      && item.value.planUri === baseline.planUri);
    const identities = new Map<string, { contextId: string; processIdentity: ReturnType<typeof parseRdcProcessIdentity>; stopped: boolean }>();
    const add = (snapshot: z.infer<typeof native> | null | undefined) => {
      if (!snapshot) return;
      const processIdentity = parseRdcProcessIdentity(snapshot.processIdentity);
      const key = JSON.stringify([snapshot.contextId, processIdentity]);
      if (!identities.has(key)) identities.set(key, { contextId: snapshot.contextId, processIdentity, stopped: false });
    };
    for (const { value } of relevant) {
      if (value.event === 'baseline') add(value.original?.native);
      if (value.event === 'intent') { add(value.original?.native); add(value.from?.native); add(value.recovery?.observed); }
      if (value.event === 'transition' || value.event === 'position-restored') { add(value.from?.native); add(value.to?.native); }
    }
    for (const { value } of relevant) {
      if (value.event !== 'daemon-stopped') continue;
      const intent = relevant.find(item => JSON.stringify(item.ref) === JSON.stringify(value.intent))?.value;
      if (intent?.event !== 'intent' || intent.operationId !== value.operationId || intent.from?.native.contextId !== value.contextId
        || intent.recordedAt > value.recordedAt) continue;
      const key = JSON.stringify([value.contextId, parseRdcProcessIdentity(intent.from.native.processIdentity)]);
      const identity = identities.get(key); if (identity) identity.stopped = true;
    }
    return { baseline, ref: first.ref, count: outstanding.length, identities: [...identities.values()] };
  }
}
export const rdcLifecycleReceipts = new RdcLifecycleReceipts();
