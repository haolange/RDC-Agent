import React from 'react';
import type { ToolResultPreview } from '@shared/types/agenticTrace';

export const PreviewView: React.FC<{ preview: ToolResultPreview }> = ({ preview }) => {
  switch (preview.kind) {
    case 'text':
      return <pre className="trace-preview-text">{preview.text}</pre>;
    case 'code':
      return (
        <div className="trace-preview-code">
          {preview.path ? <header>{preview.path}</header> : null}
          <pre><code>{preview.code}</code></pre>
        </div>
      );
    case 'log':
      return (
        <div className="trace-preview-log">
          {preview.stdout ? <pre className="stdout">{preview.stdout}</pre> : null}
          {preview.stderr ? <pre className="stderr">{preview.stderr}</pre> : null}
          {preview.exitCode !== undefined ? <span>exit {preview.exitCode}</span> : null}
        </div>
      );
    case 'diff':
      return <pre className="trace-preview-diff">{preview.unifiedDiff}</pre>;
    case 'image':
      return <img className="trace-preview-image" src={preview.url} alt="" />;
    case 'table':
      return (
        <table className="trace-preview-table">
          <thead><tr>{preview.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {preview.rows.map((row, i) => (
              <tr key={i}>{row.map((cell, j) => <td key={j}>{String(cell)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      );
    case 'json':
      return <pre className="trace-preview-json">{JSON.stringify(preview.value, null, 2)}</pre>;
    case 'artifact':
      return <span className="trace-preview-artifact">Artifact: {preview.artifactId}</span>;
    default:
      return null;
  }
};
