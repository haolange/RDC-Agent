import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { InvestigationContentRef } from '@shared/types/renderdocInvestigation';
import { sessionArtifactResolver, type SessionArtifactResolver } from '../sessions/SessionArtifactResolver';
import type { RdcValidatedEvidence } from './RdcValidatedEvidence';
import { canonicalJson } from './RdcOperationCatalog';
import { secretStorageService } from '../settings/SecretStorageService';

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
  evidence: RdcValidatedEvidence;
  argsFingerprint: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  resultHash: string;
  startedAt: number;
  completedAt: number;
  exitCode: 0;
}
const KEY_REF = 'rdc-execution-receipt-signing-v1';
export const rdcDigest = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex');

/** Main-owned key is never part of a tool result, IPC, prompt, or session artifact. */
function signingKey(): string {
  let key = secretStorageService.getSecret(KEY_REF);
  if (!key) {
    if (secretStorageService.hasSecretRecord(KEY_REF)) throw new Error('RDC_RECEIPT_KEY_UNAVAILABLE: existing signing key cannot be decrypted.');
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
    if (read.category !== 'tool-outputs' || read.truncated || !read.text) throw new Error('RDC_RECEIPT_INVALID: incomplete receipt');
    const signed = JSON.parse(read.text) as { body?: unknown; signature?: unknown };
    if (typeof signed.body !== 'string' || typeof signed.signature !== 'string' || !/^[a-f0-9]{64}$/.test(signed.signature)) {
      throw new Error('RDC_RECEIPT_INVALID: unsigned content');
    }
    const expected = createHmac('sha256', this.key()).update(signed.body).digest();
    if (!timingSafeEqual(expected, Buffer.from(signed.signature, 'hex'))) throw new Error('RDC_RECEIPT_INVALID: signature mismatch');
    const receipt = JSON.parse(signed.body) as RdcExecutionReceipt;
    if (!receipt.evidence || !['measurement', 'intervention', 'rollback'].includes(receipt.evidence.kind)
      || !/^[a-f0-9]{64}$/.test(receipt.definitionsFingerprint) || receipt.schemaVersion !== 1 || receipt.sessionId !== sessionId || receipt.exitCode !== 0
      || rdcDigest(receipt.result) !== receipt.resultHash || rdcDigest(receipt.args) !== receipt.argsFingerprint) {
      throw new Error('RDC_RECEIPT_INVALID: ownership or result mismatch');
    }
    return receipt;
  }
}
export const rdcExecutionReceipts = new RdcExecutionReceipts();
