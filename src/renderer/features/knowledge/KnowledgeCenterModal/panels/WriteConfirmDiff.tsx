import { useI18n } from '../../../../i18n';
import type { KnowledgeDiffLine } from '../knowledgeCardDiff';

interface WriteConfirmDiffProps {
  lines: KnowledgeDiffLine[];
}

/** Unified before/after diff; the legend names the two sides so `-`/`+` read as 变更前 / 变更后. */
export function WriteConfirmDiff({ lines }: WriteConfirmDiffProps) {
  const { t } = useI18n();
  const removed = lines.filter((line) => line.kind === 'remove').length;
  const added = lines.filter((line) => line.kind === 'add').length;
  return (
    <div className="knowledge-center-diff-block">
      <div className="knowledge-center-diff-legend" aria-hidden="true">
        <span className="is-remove">− {t('knowledgeCenter.diffBefore')} ({removed})</span>
        <span className="is-add">+ {t('knowledgeCenter.diffAfter')} ({added})</span>
      </div>
      <pre className="knowledge-center-diff" data-testid="knowledge-center-confirm-diff">
        {lines.map((line, index) => (
          <div key={`${line.kind}:${index}`} className={`knowledge-center-diff-line is-${line.kind}`}>
            {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}
            {line.text}
          </div>
        ))}
      </pre>
    </div>
  );
}
