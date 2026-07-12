import type { GenerativeUiVersion } from '@shared/types/generativeUi';
import { summarizeVersionChanges } from './versionChangeSummary';

interface Props { version: GenerativeUiVersion; parent?: GenerativeUiVersion }

export function GenerativeUiVersionChanges({ version, parent }: Props) {
  const changes = summarizeVersionChanges(version, parent);
  const specChanges = changes.components.added.length + changes.components.removed.length
    + changes.interactions.added.length + changes.interactions.removed.length;
  return <div className="generative-canvas-changes" aria-label="Version changes">
    <header><strong>{parent ? 'Changes from parent' : 'Initial version'}</strong><small>{version.prompt}</small></header>
    <div className="generative-canvas-change-summary">
      {changes.source.map((entry) => <div key={entry.kind}>
        <strong>{entry.kind === 'javascript' ? 'JS' : entry.kind.toUpperCase()}</strong>
        <span className="added">+{entry.added}</span><span className="removed">−{entry.removed}</span>
      </div>)}
    </div>
    {changes.source.flatMap((entry) => entry.samples.map((sample) => ({ ...sample, source: entry.kind }))).slice(0, 8).map((sample, index) =>
      <code key={`${sample.source}-${sample.kind}-${index}`} className={sample.kind}><span>{sample.kind === 'added' ? '+' : '−'} {sample.source}</span>{sample.text}</code>)}
    <section><strong>Spec changes</strong>
      {!specChanges && <p>No component or interaction contract changes.</p>}
      {!!changes.components.added.length && <p><span className="added">Components added:</span> {changes.components.added.join(', ')}</p>}
      {!!changes.components.removed.length && <p><span className="removed">Components removed:</span> {changes.components.removed.join(', ')}</p>}
      {!!changes.interactions.added.length && <p><span className="added">Interactions added:</span> {changes.interactions.added.join(', ')}</p>}
      {!!changes.interactions.removed.length && <p><span className="removed">Interactions removed:</span> {changes.interactions.removed.join(', ')}</p>}
    </section>
  </div>;
}
