import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GenerativeUiCanvas, GenerativeUiEvaluationSummary, GenerativeUiRuntimeEventDetails, GenerativeUiRuntimeEventType, GenerativeUiSource, GenerativeUiVersion } from '@shared/types/generativeUi';
import { useProjectStore } from '../../stores/projectStore';
import { buildGenerativeUiSandboxDocument } from '@shared/generative-ui/sandboxDocument';

const EMPTY_SOURCE: GenerativeUiSource = { html: '', css: '', javascript: '' };

export function useGenerativeUiCanvas() {
  const project = useProjectStore((state) => state.currentProject);
  const session = useProjectStore((state) => state.currentSession);
  const [canvases, setCanvases] = useState<GenerativeUiCanvas[]>([]);
  const [canvasId, setCanvasId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [source, setSource] = useState<GenerativeUiSource>(EMPTY_SOURCE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<GenerativeUiEvaluationSummary | null>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const lastObservationAt = useRef<Record<string, number>>({});

  const canvas = useMemo(() => canvases.find((entry) => entry.canvasId === canvasId) ?? canvases[0] ?? null, [canvasId, canvases]);
  const version = useMemo<GenerativeUiVersion | null>(() => canvas?.versions.find((entry) => entry.versionId === versionId)
    ?? canvas?.versions.find((entry) => entry.versionId === canvas.branches.find((branch) => branch.branchId === canvas.activeBranchId)?.headVersionId)
    ?? canvas?.versions.at(-1)
    ?? null, [canvas, versionId]);

  const refresh = useCallback(async (preferredCanvasId?: string) => {
    if (!session) {
      setCanvases([]);
      return;
    }
    const next = await window.electronAPI.generativeUi.list(session.sessionId);
    setMetrics(await window.electronAPI.generativeUi.metrics(session.sessionId));
    setCanvases(next);
    setCanvasId((current) => preferredCanvasId
      ?? (current && next.some((entry) => entry.canvasId === current) ? current : next[0]?.canvasId ?? null));
  }, [session]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!version || !canvas || !session) {
      setSource(EMPTY_SOURCE);
      return;
    }
    setVersionId(version.versionId);
    setSource(version.source);
  }, [canvas, session, version?.versionId]);
  const previewDocument = useMemo(() => source.html || source.css || source.javascript
    ? buildGenerativeUiSandboxDocument(source)
    : '', [source]);
  const sourceMatchesVersion = Boolean(version
    && source.html === version.source.html
    && source.css === version.source.css
    && source.javascript === version.source.javascript);
  const previewKey = `${version?.versionId ?? 'new'}:${sourceMatchesVersion ? 'persisted' : 'draft'}`;

  useEffect(() => {
    let telemetryPort: MessagePort | null = null;
    const record = (payload: GenerativeUiRuntimeEventDetails & { eventType?: GenerativeUiRuntimeEventType }) => {
      if (!canvas || !version || !session || !sourceMatchesVersion || !payload.eventType) return;
      const key = `${version.versionId}:${payload.eventType}:${payload.interactionType ?? ''}`;
      const now = Date.now();
      if (now - (lastObservationAt.current[key] ?? 0) < 500) return;
      lastObservationAt.current[key] = now;
      if (payload.eventType === 'interaction' && payload.interactionType === 'click' && payload.message) setSelectedTarget(payload.message);
      void window.electronAPI.generativeUi.observe(session.sessionId, canvas.canvasId, version.versionId, payload.eventType, {
        message: payload.message, interactionType: payload.interactionType, latencyMs: payload.latencyMs,
      }).then(async (next) => {
        setCanvases((entries) => entries.map((entry) => entry.canvasId === next.canvasId ? next : entry));
        setMetrics(await window.electronAPI.generativeUi.metrics(session.sessionId));
      }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== previewRef.current?.contentWindow || telemetryPort || event.data?.source !== 'rdc-generative-ui-channel') return;
      const port = event.ports[0];
      if (!port) return;
      telemetryPort = port;
      port.onmessage = (telemetryEvent) => record(telemetryEvent.data as GenerativeUiRuntimeEventDetails & { eventType?: GenerativeUiRuntimeEventType });
      port.start();
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      telemetryPort?.close();
    };
  }, [canvas?.canvasId, previewDocument, session?.sessionId, sourceMatchesVersion, version?.versionId]);

  const run = useCallback(async () => {
    if (!project || !session || !prompt.trim()) return;
    setBusy(true);
    setError(null);
    setFallback(null);
    try {
      const effectivePrompt = selectedTarget ? `Refine the selected preview element (${selectedTarget}): ${prompt.trim()}` : prompt.trim();
      const result = await window.electronAPI.generativeUi.run({
        projectId: project.projectId,
        sessionId: session.sessionId,
        prompt: effectivePrompt,
        title: canvas?.title ?? prompt.trim().slice(0, 60),
        canvasId: canvas?.canvasId,
        branchId: canvas?.activeBranchId,
        checkpoint: 'after_verification',
        budget: { maxIterations: 5, maxTotalMs: 120_000, maxInputTokens: 80_000, maxOutputTokens: 40_000, maxEstimatedCostUsd: 5, maxStagnantIterations: 2 },
      });
      setCanvasId(result.canvas.canvasId);
      setVersionId(result.version?.versionId ?? null);
      setPrompt('');
      setSelectedTarget(null);
      setFallback(result.fallback?.message ?? null);
      await refresh(result.canvas.canvasId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [canvas, project, prompt, refresh, selectedTarget, session]);

  const saveSource = useCallback(async () => {
    if (!canvas || !session || !version) return;
    setBusy(true);
    setError(null);
    try {
      const next = await window.electronAPI.generativeUi.commit(session.sessionId, {
        canvasId: canvas.canvasId,
        branchId: canvas.activeBranchId,
        parentVersionId: canvas.branches.find((branch) => branch.branchId === canvas.activeBranchId)?.headVersionId ?? null,
        prompt: 'Manual Canvas source edit', spec: version.spec, source,
        reflection: 'User edited source in Canvas.', verification: [],
        runtimePolicy: 'human',
        metrics: { planningMs: 0, generationMs: 0, renderMs: 0, verificationMs: 0 },
      });
      setVersionId(next.versions.at(-1)?.versionId ?? null);
      await refresh(canvas.canvasId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [canvas, refresh, session, source, version]);

  const createBranch = useCallback(async () => {
    if (!canvas || !session) return;
    const name = window.prompt('Branch name');
    if (!name?.trim()) return;
    const next = await window.electronAPI.generativeUi.createBranch(session.sessionId, canvas.canvasId, name, version?.versionId ?? null);
    setCanvases((entries) => entries.map((entry) => entry.canvasId === next.canvasId ? next : entry));
  }, [canvas, session, version]);

  const switchBranch = useCallback(async (branchId: string) => {
    if (!canvas || !session) return;
    const next = await window.electronAPI.generativeUi.switchBranch(session.sessionId, canvas.canvasId, branchId);
    setCanvases((entries) => entries.map((entry) => entry.canvasId === next.canvasId ? next : entry));
    setVersionId(next.branches.find((branch) => branch.branchId === branchId)?.headVersionId ?? null);
  }, [canvas, session]);

  const exportVersion = useCallback(async () => {
    if (!canvas || !session || !version) return;
    const result = await window.electronAPI.generativeUi.export(session.sessionId, canvas.canvasId, version.versionId);
    await window.electronAPI.appShell.openPath(result.filePath);
  }, [canvas, session, version]);

  const submitFeedback = useCallback(async (rating: 1 | 2 | 3 | 4 | 5, usable: boolean, preferredOverStatic: boolean) => {
    if (!canvas || !session || !version) return;
    const next = await window.electronAPI.generativeUi.feedback(session.sessionId, canvas.canvasId, version.versionId, { rating, usable, preferredOverStatic });
    setCanvases((entries) => entries.map((entry) => entry.canvasId === next.canvasId ? next : entry));
    setMetrics(await window.electronAPI.generativeUi.metrics(session.sessionId));
  }, [canvas, session, version]);

  const completeCanvas = useCallback(async () => {
    if (!canvas || !session) return;
    setBusy(true);
    setError(null);
    try {
      const next = await window.electronAPI.generativeUi.stop(session.sessionId, canvas.canvasId, 'success');
      setCanvases((entries) => entries.map((entry) => entry.canvasId === next.canvasId ? next : entry));
      setMetrics(await window.electronAPI.generativeUi.metrics(session.sessionId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [canvas, session]);

  return { project, session, canvases, canvas, version, versionId, prompt, source, previewDocument, previewKey, busy, error, fallback, metrics, selectedTarget,
    previewRef, setCanvasId, setVersionId, setPrompt, setSource, setSelectedTarget, refresh, run, saveSource, createBranch, switchBranch, exportVersion, submitFeedback, completeCanvas };
}
