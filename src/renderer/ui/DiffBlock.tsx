import { collapseUnchanged, type DiffLine } from '@shared/utils/lineDiff';
import './DiffBlock.css';

export interface DiffBlockProps {
  lines: DiffLine[];
  /** Names the `-` side, e.g. "Before" or "Builtin". */
  beforeLabel: string;
  /** Names the `+` side, e.g. "After" or "Your override". */
  afterLabel: string;
  dataTestId?: string;
  /** Folds unchanged runs, keeping this many lines around each change; names a folded run. */
  fold?: { context: number; label: (count: number) => string };
}

/** Unified line diff; the legend names both sides so `-` / `+` read as the caller's labels. */
export function DiffBlock({ lines, beforeLabel, afterLabel, dataTestId, fold }: DiffBlockProps) {
  const removed = lines.filter((line) => line.kind === 'remove').length;
  const added = lines.filter((line) => line.kind === 'add').length;
  const rows = fold ? collapseUnchanged(lines, fold.context) : lines;
  return (
    <div className="ui-diff-block">
      <div className="ui-diff-legend" aria-hidden="true">
        <span className="is-remove">
          − {beforeLabel} ({removed})
        </span>
        <span className="is-add">
          + {afterLabel} ({added})
        </span>
      </div>
      <pre className="ui-diff scrollbar-thin" data-testid={dataTestId} tabIndex={0}>
        {rows.map((line, index) =>
          line.kind === 'gap' ? (
            <div key={`gap:${index}`} className="ui-diff-line is-gap">
              {fold?.label(line.count)}
            </div>
          ) : (
            <div key={`${line.kind}:${index}`} className={`ui-diff-line is-${line.kind}`}>
              {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}
              {line.text}
            </div>
          ),
        )}
      </pre>
    </div>
  );
}
