import { useState } from 'react';
import type { GenerativeUiCanvas, GenerativeUiOuterEvidenceKind, GenerativeUiVersion } from '@shared/types/generativeUi';
import { Button } from '../../ui/Button';
import { useGenerativeUiOuterLoop } from './useGenerativeUiOuterLoop';

interface Props { projectId: string; sessionId: string; canvas: GenerativeUiCanvas | null; version: GenerativeUiVersion | null; onCanvasCreated: (canvasId: string) => Promise<void> }

export function GenerativeUiEvaluationPanel({ projectId, sessionId, canvas, version, onCanvasCreated }: Props) {
  const state = useGenerativeUiOuterLoop(projectId, sessionId);
  const versionClosed = Boolean(version && [1, 2, 3].every((level) => version.verification.some((entry) => entry.level === level && entry.passed)));
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<GenerativeUiOuterEvidenceKind>('use_case');
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [notes, setNotes] = useState('');
  const [expertScore, setExpertScore] = useState('');
  const [blindChoice, setBlindChoice] = useState<'a' | 'b' | 'tie'>('a');
  const [staticReference, setStaticReference] = useState('');
  const [candidateOrder, setCandidateOrder] = useState<'dynamic_first' | 'static_first'>(() => crypto.getRandomValues(new Uint8Array(1))[0] % 2 ? 'dynamic_first' : 'static_first');
  const [benchmarkCaseId, setBenchmarkCaseId] = useState('');

  const submit = async () => {
    const blind = kind === 'blind_preference';
    const outcome = blindChoice === 'tie' ? 'tie'
      : (blindChoice === 'a') === (candidateOrder === 'dynamic_first') ? 'dynamic' : 'static';
    await state.add({ kind, title, source, notes, canvasId: canvas?.canvasId, versionId: version?.versionId,
      blinded: blind || undefined, candidateOrder: blind ? candidateOrder : undefined,
      outcome: blind ? outcome : undefined, staticReference: blind ? staticReference : undefined,
      score: kind === 'expert_review' ? Number(expertScore) : undefined });
    setTitle(''); setSource(''); setNotes(''); setStaticReference(''); setExpertScore(''); setOpen(false);
    setCandidateOrder(crypto.getRandomValues(new Uint8Array(1))[0] % 2 ? 'dynamic_first' : 'static_first');
  };

  return (
    <section className="generative-canvas-evaluation" aria-label="Outer Loop evaluation">
      <button type="button" className="generative-canvas-evaluation-toggle" onClick={() => setOpen((value) => !value)}>
        <span>Outer Loop</span><small>{state.report?.decision === 'v1_ready' ? 'v1 ready' : `${state.report?.gaps.length ?? 0} gaps`}</small>
      </button>
      {open && <div className="generative-canvas-evaluation-body">
        <p>{state.report?.benchmark.successfulCaseCount ?? 0}/{state.report?.benchmark.caseCount ?? 20} benchmark cases passed</p>
        <label>Canonical benchmark<select value={benchmarkCaseId} onChange={(event) => setBenchmarkCaseId(event.target.value)}>
          <option value="">Select a complex case</option>{state.benchmarkCases.map((entry) => <option key={entry.caseId} value={entry.caseId}>{entry.category} · {entry.title}</option>)}
        </select></label>
        <Button variant="secondary" size="sm" disabled={!benchmarkCaseId || state.busy} onClick={() => void state.runBenchmark(benchmarkCaseId).then((result) => result && onCanvasCreated(result.canvas.canvasId))}>
          {state.busy ? 'Running benchmark…' : 'Run benchmark case'}
        </Button>
        <p>{state.evidence.length} evidence records · weekly cadence</p>
        {state.report?.gaps.slice(0, 3).map((gap) => <small key={gap}>{gap}</small>)}
        <label>Evidence type<select value={kind} onChange={(event) => setKind(event.target.value as GenerativeUiOuterEvidenceKind)}>
          <option value="use_case">Real use case</option><option value="competitor_observation">Competitor observation</option>
          <option value="expert_review">Expert review</option><option value="blind_preference">Blind preference result</option>
        </select></label>
        <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>Source / panel ID<input value={source} onChange={(event) => setSource(event.target.value)} /></label>
        {kind === 'blind_preference' && <><small>Record the evaluator's A/B choice from an external blind panel.</small>
          <details><summary>Facilitator assignment — keep hidden from evaluator</summary>
            <p>{candidateOrder === 'dynamic_first' ? 'A = dynamic UI · B = static response' : 'A = static response · B = dynamic UI'}</p>
          </details>
          <label>Evaluator chose<select value={blindChoice} onChange={(event) => setBlindChoice(event.target.value as typeof blindChoice)}>
            <option value="a">Candidate A</option><option value="b">Candidate B</option><option value="tie">Tie</option>
          </select></label>
          <label>Static baseline reference<input value={staticReference} onChange={(event) => setStaticReference(event.target.value)} placeholder="Response URL, artifact ID, or content hash" /></label>
          {!canvas || !version ? <small>Select a generated Canvas version before recording this comparison.</small> : <small>Dynamic artifact: {canvas.canvasId.slice(0, 8)} / {version.versionId.slice(0, 8)}</small>}</>}
        {kind === 'use_case' && (!canvas || !versionClosed) && <small>Select an L1/L2/L3-closed Canvas version before recording a real use case.</small>}
        {kind === 'expert_review' && <label>Expert score (0-100)<input type="number" min="0" max="100" value={expertScore} onChange={(event) => setExpertScore(event.target.value)} /></label>}
        <label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        {state.error && <div role="alert">{state.error}</div>}
        <Button variant="secondary" size="sm" onClick={() => void submit()} disabled={!title.trim() || !source.trim()
          || (kind === 'use_case' && (!canvas || !versionClosed))
          || (kind === 'expert_review' && (!expertScore || !notes.trim()))
          || (kind === 'blind_preference' && (!canvas || !versionClosed || !staticReference.trim()))}>Record evidence</Button>
      </div>}
    </section>
  );
}
