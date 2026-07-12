import type { GenerativeUiCanvas, GenerativeUiEvaluationSummary } from '@shared/types/generativeUi';

export function summarizeGenerativeUiEvidence(canvases: GenerativeUiCanvas[]): GenerativeUiEvaluationSummary {
  const generated = canvases.filter((canvas) => canvas.versions.length > 0 && canvas.stopReason !== 'no_op');
  const versions = generated.flatMap((canvas) => canvas.versions);
  const closed = versions.filter((version) => [1, 2, 3].every((level) => version.verification.some((result) => result.level === level && result.passed)));
  const feedback = canvases.flatMap((canvas) => canvas.feedback);
  const preferenceFeedback = feedback.filter((entry) => entry.preferredOverStatic !== undefined);
  const preferred = preferenceFeedback.filter((entry) => entry.preferredOverStatic).length;
  const iterationTimes = versions.map((version) => version.metrics.planningMs + version.metrics.generationMs + version.metrics.renderMs + version.metrics.verificationMs).sort((a, b) => a - b);
  const median = (values: number[]): number | null => values.length === 0 ? null : values.length % 2 === 1
    ? values[Math.floor(values.length / 2)] : Math.round((values[values.length / 2 - 1] + values[values.length / 2]) / 2);
  const previewReadyTimes = canvases.flatMap((canvas) => canvas.observations)
    .filter((observation) => observation.eventType === 'ready' && Number.isFinite(observation.latencyMs))
    .map((observation) => Math.max(0, Math.round(observation.latencyMs!))).sort((a, b) => a - b);
  const promptToUsableTimes = generated.flatMap((canvas) => {
    const timestamps = canvas.versions.flatMap((version) => {
      const level3 = version.verification.find((entry) => entry.level === 3 && entry.passed);
      const usableAt = version.usableAt ?? level3?.observedAt;
      return usableAt === undefined ? [] : [usableAt];
    });
    return timestamps.length ? [Math.max(0, Math.min(...timestamps) - canvas.createdAt)] : [];
  }).sort((a, b) => a - b);
  const hasFiveClosedLineage = (canvas: GenerativeUiCanvas): boolean => canvas.branches.some((branch) => {
    const byId = new Map(canvas.versions.map((version) => [version.versionId, version]));
    let current = branch.headVersionId ? byId.get(branch.headVersionId) : undefined;
    let count = 0;
    while (current && [1, 2, 3].every((level) => current?.verification.some((result) => result.level === level && result.passed))) {
      count += 1;
      if (count >= 5) return true;
      current = current.parentVersionId ? byId.get(current.parentVersionId) : undefined;
    }
    return false;
  });
  const generationSuccessRate = generated.length ? generated.filter((canvas) => canvas.stopReason === 'success').length / generated.length : 0;
  const loopClosureRate = versions.length ? closed.length / versions.length : 0;
  const dynamicUiPreferenceRate = preferenceFeedback.length ? preferred / preferenceFeedback.length : null;
  return {
    canvasCount: canvases.length, generatedCanvasCount: generated.length,
    successfulCanvasCount: generated.filter((canvas) => canvas.stopReason === 'success').length,
    generationSuccessRate, versionCount: versions.length, closedLoopVersionCount: closed.length, loopClosureRate,
    feedbackCount: feedback.length, dynamicUiPreferredCount: preferred, dynamicUiPreferenceRate, medianIterationMs: median(iterationTimes),
    medianPromptToUsableMs: median(promptToUsableTimes), promptToUsableSampleCount: promptToUsableTimes.length,
    medianPreviewReadyMs: median(previewReadyTimes), previewReadySampleCount: previewReadyTimes.length,
    canvasesWithFiveEffectiveIterations: generated.filter(hasFiveClosedLineage).length,
    runtimeErrorCount: canvases.flatMap((canvas) => canvas.observations).filter((entry) => entry.eventType === 'runtime_error' || entry.eventType === 'unhandled_rejection').length,
    targetStatus: { generationSuccessRate: generationSuccessRate >= 0.85, loopClosureRate: loopClosureRate >= 0.9,
      previewReadyLatency: previewReadyTimes.length ? median(previewReadyTimes)! <= 2_000 : null,
      dynamicUiPreferenceRate: dynamicUiPreferenceRate === null ? null : dynamicUiPreferenceRate >= 0.65 },
  };
}
