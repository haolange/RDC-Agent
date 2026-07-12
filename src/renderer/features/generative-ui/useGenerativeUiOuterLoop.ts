import { useCallback, useEffect, useState } from 'react';
import type { AddGenerativeUiOuterEvidenceRequest, GenerativeUiBenchmarkCase, GenerativeUiOuterEvidence, GenerativeUiOuterLoopReport } from '@shared/types/generativeUi';

export function useGenerativeUiOuterLoop(projectId: string, sessionId: string | undefined) {
  const [evidence, setEvidence] = useState<GenerativeUiOuterEvidence[]>([]);
  const [report, setReport] = useState<GenerativeUiOuterLoopReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [benchmarkCases, setBenchmarkCases] = useState<GenerativeUiBenchmarkCase[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!sessionId) { setEvidence([]); setReport(null); return; }
    const [nextEvidence, nextReport, benchmark] = await Promise.all([
      window.electronAPI.generativeUi.evidenceList(sessionId),
      window.electronAPI.generativeUi.outerReport(sessionId),
      window.electronAPI.generativeUi.benchmarkList(),
    ]);
    setEvidence(nextEvidence);
    setReport(nextReport);
    setBenchmarkCases(benchmark.cases);
  }, [sessionId]);

  useEffect(() => { void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))); }, [refresh]);

  const add = useCallback(async (request: AddGenerativeUiOuterEvidenceRequest) => {
    if (!sessionId) return;
    setError(null);
    try {
      await window.electronAPI.generativeUi.evidenceAdd(sessionId, request);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    }
  }, [refresh, sessionId]);

  const runBenchmark = useCallback(async (caseId: string) => {
    if (!sessionId) return null;
    setBusy(true); setError(null);
    try { const result = await window.electronAPI.generativeUi.benchmarkRun(projectId, sessionId, caseId); await refresh(); return result; }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return null; }
    finally { setBusy(false); }
  }, [projectId, refresh, sessionId]);

  return { evidence, report, error, benchmarkCases, busy, add, runBenchmark };
}
