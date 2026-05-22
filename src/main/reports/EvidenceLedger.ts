import { nowIso } from '@shared/utils/id';
import type { EvidenceRecord, VerificationResult } from '@shared/types/harness';
import { runScopedStore } from '../workflow/debugger/RunScopedStore';

const EVIDENCE_PATH = 'evidence-ledger.jsonl';
const VERIFICATION_PATH = 'verification_results.jsonl';

export class EvidenceLedger {
  appendEvidence(sessionId: string, runId: string, record: EvidenceRecord): EvidenceRecord {
    this.assertRunBinding(sessionId, runId, record);
    const nextRecord: EvidenceRecord = {
      ...record,
      createdAt: record.createdAt || nowIso(),
    };
    runScopedStore.appendJsonl(sessionId, runId, EVIDENCE_PATH, nextRecord);
    return nextRecord;
  }

  listEvidence(sessionId: string, runId: string): EvidenceRecord[] {
    return runScopedStore.readJsonl<EvidenceRecord>(sessionId, runId, EVIDENCE_PATH);
  }

  findEvidence(sessionId: string, runId: string, evidenceId: string): EvidenceRecord | null {
    return this.listEvidence(sessionId, runId).find((record) => record.evidenceId === evidenceId) ?? null;
  }

  appendVerificationResult(
    sessionId: string,
    runId: string,
    result: VerificationResult,
  ): VerificationResult {
    this.assertRunBinding(sessionId, runId, result);
    const nextResult: VerificationResult = {
      ...result,
      createdAt: result.createdAt || nowIso(),
    };
    runScopedStore.appendJsonl(sessionId, runId, VERIFICATION_PATH, nextResult);
    return nextResult;
  }

  listVerificationResults(sessionId: string, runId: string): VerificationResult[] {
    return runScopedStore.readJsonl<VerificationResult>(sessionId, runId, VERIFICATION_PATH);
  }

  private assertRunBinding(
    sessionId: string,
    runId: string,
    value: { sessionId: string; runId: string },
  ): void {
    if (value.sessionId !== sessionId || value.runId !== runId) {
      throw new Error(`Run binding mismatch for ${value.sessionId}/${value.runId}`);
    }
  }
}

export const evidenceLedger = new EvidenceLedger();
