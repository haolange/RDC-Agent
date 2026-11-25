import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z, type ZodType } from 'zod';
import { AppError } from '@shared/errors/appError';
import { sessionArtifactResolver, type SessionArtifactResolver } from '../sessions/artifacts/SessionArtifactResolver';
import { secretStorageService } from '../settings/settings-core/SecretStorageService';
import { canonicalJson } from './RdcOperationCatalog';
import { RdcProcessIdentitySchema } from './RdcProcessIdentity';
import type { InvestigationContentRef } from '@shared/types/renderdocInvestigation';
import type { RdcValidatedEvidence } from './RdcValidatedEvidence';
import type { RdcProcessIdentity } from './RdcProcessIdentity';

export interface RdcExecutionReceipt {
  schemaVersion: 1;
  sessionId: string;
  projectId: string;
  turnId: string;
  toolCallId: string;
  experimentId: string;
  contextId: string;
  leaseVersion: number;
  replaySessionId: string;
  operation: string;
  definitionsFingerprint: string;
  /** Historical receipts remain readable; every new experiment closure requires this proof. */
  processIdentity?: RdcProcessIdentity;
  evidence: RdcValidatedEvidence;
  argsFingerprint: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  resultHash: string;
  startedAt: number;
  completedAt: number;
  exitCode: 0;
}
const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);
const RdcExecutionReceiptSchema: ZodType<RdcExecutionReceipt> = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string(),
  projectId: z.string(),
  turnId: z.string(),
  toolCallId: z.string(),
  experimentId: z.string(),
  contextId: z.string(),
  leaseVersion: z.number(),
  replaySessionId: z.string(),
  operation: z.string(),
  definitionsFingerprint: sha256Hex,
  processIdentity: RdcProcessIdentitySchema.optional(),
  evidence: z.union([
    z.object({ kind: z.literal('measurement'), method: z.enum(['event_durations', 'counters', 'image', 'frame_timing']), conditionsFingerprint: z.string(), values: z.unknown() }),
    z.object({ kind: z.enum(['intervention', 'rollback']), replacementId: z.string() }),
  ]),
  argsFingerprint: z.string(),
  args: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()),
  resultHash: z.string(),
  startedAt: z.number(),
  completedAt: z.number(),
  exitCode: z.literal(0),
});
const SignedReceiptSchema = z.object({ body: z.string(), signature: sha256Hex });

type ReceiptInvalidCode = 'RDC_RECEIPT_INVALID' | 'RDC_LIFECYCLE_RECEIPT_INVALID';

/** The JSON body of a receipt this process signed with `key`; anything unsigned or forged is rejected with `code`. */
export function openSignedRdcReceipt(text: string, key: () => string, code: ReceiptInvalidCode): unknown {
  const signed = SignedReceiptSchema.safeParse(parseReceiptJson(text, code));
  if (!signed.success) throw new AppError(code, 'unsigned content.');
  const expected = createHmac('sha256', key()).update(signed.data.body).digest();
  if (!timingSafeEqual(expected, Buffer.from(signed.data.signature, 'hex'))) throw new AppError(code, 'signature mismatch.');
  return parseReceiptJson(signed.data.body, code);
}

function parseReceiptJson(text: string, code: ReceiptInvalidCode): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AppError(code, 'receipt is not JSON.', { cause: error });
  }
}

const KEY_REF = 'rdc-execution-receipt-signing-v1';
export const rdcDigest = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex');

/** Main-owned key is never part of a tool result, IPC, prompt, or session artifact. */
function signingKey(): string {
  let key = secretStorageService.getSecret(KEY_REF);
  if (!key) {
    if (secretStorageService.hasSecretRecord(KEY_REF)) throw new AppError('RDC_RECEIPT_KEY_UNAVAILABLE', 'existing signing key cannot be decrypted.');
    key = randomBytes(32).toString('hex');
    secretStorageService.setSecret(KEY_REF, key);
  }
  return key;
}
export class RdcExecutionReceipts {
  constructor(
    private readonly resolver: SessionArtifactResolver = sessionArtifactResolver,
    private readonly key: () => string = signingKey,
  ) {}
  prepare(): void { this.key(); }
  write(receipt: RdcExecutionReceipt, signal?: AbortSignal): InvestigationContentRef {
    signal?.throwIfAborted();
    const body = JSON.stringify(receipt);
    const signature = createHmac('sha256', this.key()).update(body).digest('hex');
    const written = this.resolver.write(receipt.sessionId,
      'session://tool-outputs/rdc-receipt-' + randomUUID() + '.json',
      JSON.stringify({ body, signature }), { mimeType: 'application/json', signal });
    return { uri: written.uri, expectedHash: 'sha256:' + written.hash };
  }
  read(sessionId: string, ref: InvestigationContentRef): RdcExecutionReceipt {
    const read = this.resolver.read(sessionId, ref.uri, { expectedHash: ref.expectedHash.replace(/^sha256:/, '') });
    if (read.category !== 'tool-outputs' || read.truncated || !read.text) throw new AppError('RDC_RECEIPT_INVALID', 'incomplete receipt');
    const parsed = RdcExecutionReceiptSchema.safeParse(openSignedRdcReceipt(read.text, this.key, 'RDC_RECEIPT_INVALID'));
    if (!parsed.success) throw new AppError('RDC_RECEIPT_INVALID', `malformed receipt: ${z.prettifyError(parsed.error)}`);
    const receipt = parsed.data;
    if (receipt.sessionId !== sessionId || rdcDigest(receipt.result) !== receipt.resultHash || rdcDigest(receipt.args) !== receipt.argsFingerprint) {
      throw new AppError('RDC_RECEIPT_INVALID', 'ownership or result mismatch');
    }
    return receipt;
  }
}
export const rdcExecutionReceipts = new RdcExecutionReceipts();
