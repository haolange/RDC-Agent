import { useState } from 'react';
import { Button } from '../../ui/Button';
import { useGenerativeUiCanvas } from './useGenerativeUiCanvas';
import './GenerativeUiCanvas.css';
import { GenerativeUiEvaluationPanel } from './GenerativeUiEvaluationPanel';
import { GenerativeUiVersionChanges } from './GenerativeUiVersionChanges';

type SourceTab = 'html' | 'css' | 'javascript' | 'console' | 'changes';

export function GenerativeUiCanvas() {
  const state = useGenerativeUiCanvas();
  const [sourceTab, setSourceTab] = useState<SourceTab>('html');

  if (!state.project || !state.session) {
    return <div className="generative-canvas-empty"><h2>Canvas</h2><p>Open a project and session to create an interactive UI.</p></div>;
  }

  return (
    <section className="generative-canvas" data-testid="generative-ui-canvas">
      <header className="generative-canvas-header">
        <div>
          <span className="generative-canvas-eyebrow">Generative UI</span>
          <h1>{state.canvas?.title ?? 'New Canvas'}</h1>
        </div>
        <div className="generative-canvas-actions">
          {state.metrics && <span className="generative-canvas-score" title="Session loop closure rate">{Math.round(state.metrics.loopClosureRate * 100)}% loops</span>}
          {state.metrics?.medianPreviewReadyMs !== null && state.metrics?.medianPreviewReadyMs !== undefined
            && <span className="generative-canvas-score" title="Median measured sandbox-ready latency">{state.metrics.medianPreviewReadyMs}ms preview</span>}
          {state.metrics?.medianPromptToUsableMs !== null && state.metrics?.medianPromptToUsableMs !== undefined
            && <span className="generative-canvas-score" title="Median initial prompt to first L3-usable version">{state.metrics.medianPromptToUsableMs}ms usable</span>}
          <Button variant="secondary" size="sm" onClick={() => void state.createBranch()} disabled={!state.version || state.busy}>New branch</Button>
          <Button variant="secondary" size="sm" onClick={() => void state.saveSource()} disabled={!state.version || state.busy}>Save version</Button>
          <Button variant="secondary" size="sm" onClick={() => void state.exportVersion()} disabled={!state.version || state.busy}>Export HTML</Button>
          <Button variant="primary" size="sm" onClick={() => void state.completeCanvas()} disabled={!state.version || state.busy || state.canvas?.stopReason === 'success'}>Mark complete</Button>
        </div>
      </header>

      <div className="generative-canvas-prompt">
        <textarea value={state.prompt} onChange={(event) => state.setPrompt(event.target.value)}
          placeholder={state.canvas ? 'Describe the next refinement…' : 'Describe the interactive experience to generate…'} />
        <Button variant="primary" onClick={() => void state.run()} disabled={state.busy || !state.prompt.trim()}>
          {state.busy ? 'Generating…' : state.canvas ? 'Refine' : 'Generate'}
        </Button>
        {state.selectedTarget && <button type="button" className="generative-canvas-selection" onClick={() => state.setSelectedTarget(null)} title="Clear selected preview target">Target: {state.selectedTarget} ×</button>}
      </div>
      {state.error && <div className="generative-canvas-error" role="alert">{state.error}</div>}
      {state.fallback && <div className="generative-canvas-fallback" role="status">{state.fallback}</div>}

      <div className="generative-canvas-body">
        <aside className="generative-canvas-history">
          <label>Canvas</label>
          <select value={state.canvas?.canvasId ?? ''} onChange={(event) => state.setCanvasId(event.target.value)}>
            {state.canvases.map((canvas) => <option key={canvas.canvasId} value={canvas.canvasId}>{canvas.title}</option>)}
          </select>
          <label>Branch</label>
          <select value={state.canvas?.activeBranchId ?? ''} onChange={(event) => void state.switchBranch(event.target.value)}>
            {state.canvas?.branches.map((branch) => <option key={branch.branchId} value={branch.branchId}>{branch.name}</option>)}
          </select>
          <label>Versions</label>
          <div className="generative-canvas-version-list">
            {[...(state.canvas?.versions.filter((entry) => entry.branchId === state.canvas?.activeBranchId) ?? [])].reverse().map((version, index, versions) => (
              <button type="button" key={version.versionId} className={version.versionId === state.version?.versionId ? 'active' : ''}
                onClick={() => state.setVersionId(version.versionId)}>
                <span>v{versions.length - index}</span>
                <small>{new Date(version.createdAt).toLocaleTimeString()}</small>
              </button>
            ))}
          </div>
          {state.version && (
            <div className="generative-canvas-metrics">
              <span>{state.version.verification.filter((entry) => entry.passed).length}/{state.version.verification.length} checks</span>
              <span>{state.version.metrics.inputTokens ?? 0} in · {state.version.metrics.outputTokens ?? 0} out</span>
              <span>{state.canvas?.observations.filter((entry) => entry.versionId === state.version?.versionId).length ?? 0} runtime events</span>
              <span>{state.version.metrics.renderMs}ms preview ready</span>
              <div className="generative-canvas-feedback" aria-label="Rate this version">
                <button type="button" onClick={() => void state.submitFeedback(5, true, true)} title="Prefer this interactive UI">Prefer UI</button>
                <button type="button" onClick={() => void state.submitFeedback(2, false, false)} title="Prefer a static answer">Prefer text</button>
              </div>
            </div>
          )}
          <GenerativeUiEvaluationPanel projectId={state.project.projectId} sessionId={state.session.sessionId} canvas={state.canvas} version={state.version} onCanvasCreated={state.refresh} />
        </aside>

        <main className="generative-canvas-preview">
          <div className="generative-canvas-pane-title"><span>Preview</span><small>Sandboxed · no network</small></div>
          {state.previewDocument ? (
            <iframe key={state.previewKey} ref={state.previewRef} title="Generative UI preview" sandbox="allow-scripts" srcDoc={state.previewDocument} />
          ) : (
            <div className="generative-canvas-preview-empty">Your generated interface will run here.</div>
          )}
        </main>

        <aside className="generative-canvas-editor">
          <div className="generative-canvas-tabs">
            {(['html', 'css', 'javascript', 'console', 'changes'] as SourceTab[]).map((tab) => (
              <button type="button" key={tab} className={sourceTab === tab ? 'active' : ''} onClick={() => setSourceTab(tab)}>{tab === 'javascript' ? 'JS' : tab.toUpperCase()}</button>
            ))}
          </div>
          {sourceTab === 'changes' && state.version ? <GenerativeUiVersionChanges version={state.version}
            parent={state.canvas?.versions.find((entry) => entry.versionId === state.version?.parentVersionId)} /> : sourceTab === 'console' ? <div className="generative-canvas-console" aria-label="Preview console">
            {(state.canvas?.observations.filter((entry) => entry.versionId === state.version?.versionId) ?? []).map((entry) =>
              <div key={entry.observationId} className={entry.eventType.includes('error') || entry.eventType === 'unhandled_rejection' ? 'error' : ''}>
                <time>{new Date(entry.observedAt).toLocaleTimeString()}</time><strong>{entry.eventType}</strong><span>{entry.message ?? entry.interactionType ?? '—'}</span>
              </div>)}
            {!state.canvas?.observations.some((entry) => entry.versionId === state.version?.versionId) && <p>No preview events yet.</p>}
          </div> : sourceTab !== 'changes' ? <textarea aria-label={`${sourceTab} source`} spellCheck={false} value={state.source[sourceTab]}
            onChange={(event) => state.setSource({ ...state.source, [sourceTab]: event.target.value })} /> : null}
          {state.version?.reflection && <div className="generative-canvas-reflection"><strong>Reflection</strong><p>{state.version.reflection}</p></div>}
        </aside>
      </div>
    </section>
  );
}
