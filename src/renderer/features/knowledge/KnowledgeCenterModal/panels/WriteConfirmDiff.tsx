import type { KnowledgeDiffLine } from '../knowledgeCardDiff';

interface WriteConfirmDiffProps {
  lines: KnowledgeDiffLine[];
}

export function WriteConfirmDiff({ lines }: WriteConfirmDiffProps) {
  return (
    <pre className="knowledge-center-diff" data-testid="knowledge-center-confirm-diff">
      {lines.map((line, index) => (
        <div key={`${line.kind}:${index}`} className={`knowledge-center-diff-line is-${line.kind}`}>
          {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}
          {line.text}
        </div>
      ))}
    </pre>
  );
}
