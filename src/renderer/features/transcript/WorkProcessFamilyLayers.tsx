import React from 'react';
import { useI18n } from '../../i18n';
import { copyAppText } from '../../hooks/appShellBridge';
import { Button } from '../../ui/Button';
import type { ToolRowModel } from './workProcessToolTypes';
import { WorkProcessHighlightedCode } from './WorkProcessHighlightedCode';
import { WorkProcessImageThumbs } from './WorkProcessImageThumbs';

export const isDedicatedFamily = (family: ToolRowModel['family']): boolean => (
  family === 'interpreter'
  || family === 'memory'
  || family === 'skill'
  || family === 'mcp'
  || family === 'runtime'
);

export const CopyPathButton: React.FC<{ path: string }> = ({ path }) => {
  const { language } = useI18n();
  const [copied, setCopied] = React.useState(false);
  const copyLabel = language === 'zh-CN' ? '复制' : 'Copy';
  const copiedLabel = language === 'zh-CN' ? '已复制' : 'Copied';

  const onCopy = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!path) return;
    await copyAppText(path);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="work-process-tool-card-copy"
      onClick={onCopy}
      aria-label={copied ? copiedLabel : copyLabel}
      title={copied ? copiedLabel : copyLabel}
    >
      {copied ? '✓' : '⧉'}
    </Button>
  );
};

const ChipRow: React.FC<{ chips?: string[] }> = ({ chips }) => {
  if (!chips?.length) return null;
  return (
    <div className="work-process-tool-chips">
      {chips.map((chip) => <span key={chip} className="work-process-path-chip">{chip}</span>)}
    </div>
  );
};

const SampleList: React.FC<{ lines: string[] }> = ({ lines }) => {
  if (lines.length === 0) return null;
  return (
    <ul className="work-process-tool-card-body-list">
      {lines.map((line) => (
        <li key={line} className="work-process-tool-card-body-list-item" title={line}>{line}</li>
      ))}
    </ul>
  );
};

const PathRow: React.FC<{ path: string }> = ({ path }) => (
  <div className="work-process-family-path">
    <code className="work-process-tool-card-path" title={path}>{path}</code>
    <CopyPathButton path={path} />
  </div>
);

const InterpreterBody: React.FC<{ row: ToolRowModel }> = ({ row }) => {
  const code = row.commandText?.trim() || row.bodyText?.trim() || '';
  if (!code && !row.imagePreviews?.length) return null;
  return (
    <div className="work-process-tool-card-body family-interpreter">
      {code ? <WorkProcessHighlightedCode code={code} language="python" collapsed /> : null}
      {row.imagePreviews?.length ? <WorkProcessImageThumbs previews={row.imagePreviews} /> : null}
    </div>
  );
};

const InterpreterDetail: React.FC<{ row: ToolRowModel }> = ({ row }) => {
  const { t } = useI18n();
  const code = row.commandText?.trim() || '';
  const stdout = row.previewLines.join('\n').trim();
  if (!code && !stdout) return null;
  return (
    <div className="work-process-tool-card-detail family-interpreter" data-testid="work-process-tool-preview">
      {code ? <WorkProcessHighlightedCode code={code} language="python" /> : null}
      {stdout ? (
        <div className="work-process-family-stdout">
          <span className="work-process-tool-card-raw-label">{t('chat.workProcessInterpreterStdout')}</span>
          <pre className="work-process-shell-stdout">{stdout}</pre>
        </div>
      ) : null}
    </div>
  );
};

const MemoryBody: React.FC<{ row: ToolRowModel }> = ({ row }) => {
  const sample = row.bodyText?.trim() || row.previewLines[0] || '';
  if (!row.chips?.length && !sample) return null;
  return (
    <div className="work-process-tool-card-body family-memory">
      <ChipRow chips={row.chips} />
      {sample ? <span className="work-process-tool-card-body-text is-summary" title={sample}>{sample}</span> : null}
    </div>
  );
};

const MemoryDetail: React.FC<{ row: ToolRowModel }> = ({ row }) => {
  if (row.previewLines.length === 0) return null;
  return (
    <div className="work-process-tool-card-detail family-memory" data-testid="work-process-tool-preview">
      <ul className="work-process-tool-card-list">
        {row.previewLines.map((line) => (
          <li key={line} className="work-process-tool-card-list-item">{line}</li>
        ))}
      </ul>
    </div>
  );
};

const SkillBody: React.FC<{ row: ToolRowModel }> = ({ row }) => {
  const path = row.pathChip?.trim() || '';
  if (!row.chips?.length && !path) return null;
  return (
    <div className="work-process-tool-card-body family-skill">
      <ChipRow chips={row.chips} />
      {path ? <PathRow path={path} /> : null}
    </div>
  );
};

const SkillDetail: React.FC<{ row: ToolRowModel }> = ({ row }) => {
  const description = row.previewLines[0] || row.bodyText?.trim() || '';
  const path = row.pathChip?.trim() || '';
  if (!description && !path) return null;
  return (
    <div className="work-process-tool-card-detail family-skill" data-testid="work-process-tool-preview">
      {description ? <p className="work-process-tool-card-caption">{description}</p> : null}
      {path ? <PathRow path={path} /> : null}
    </div>
  );
};

const McpBody: React.FC<{ row: ToolRowModel }> = ({ row }) => {
  const summary = row.bodyText?.trim() || row.previewLines[0] || '';
  if (!row.chips?.length && !summary) return null;
  return (
    <div className="work-process-tool-card-body family-mcp">
      <ChipRow chips={row.chips} />
      {summary ? <span className="work-process-tool-card-body-text is-summary" title={summary}>{summary}</span> : null}
    </div>
  );
};

const McpDetail: React.FC<{ row: ToolRowModel }> = ({ row }) => {
  if (row.previewLines.length === 0) return null;
  return (
    <div className="work-process-tool-card-detail family-mcp" data-testid="work-process-tool-preview">
      <pre className="work-process-tool-card-preview">{row.previewLines.join('\n')}</pre>
    </div>
  );
};

const RuntimeBody: React.FC<{ row: ToolRowModel }> = ({ row }) => {
  const path = row.pathChip?.trim() || '';
  const hits = row.bodyLines ?? [];
  if (row.toolName === 'tool_search') {
    return (
      <div className="work-process-tool-card-body family-runtime">
        {row.bodyText ? (
          <span className="work-process-tool-card-body-text is-summary" title={row.bodyText}>{row.bodyText}</span>
        ) : null}
        <SampleList lines={hits.slice(0, 3)} />
      </div>
    );
  }
  if (path) {
    return (
      <div className="work-process-tool-card-body family-runtime">
        <PathRow path={path} />
      </div>
    );
  }
  if (!row.chips?.length && !row.bodyText) return null;
  return (
    <div className="work-process-tool-card-body family-runtime">
      <ChipRow chips={row.chips} />
      {row.bodyText ? (
        <span className="work-process-tool-card-body-text is-summary" title={row.bodyText}>{row.bodyText}</span>
      ) : null}
    </div>
  );
};

const RuntimeDetail: React.FC<{ row: ToolRowModel }> = ({ row }) => {
  if (row.previewLines.length === 0 && !row.pathChip) return null;
  if (row.toolName === 'tool_search') {
    return (
      <div className="work-process-tool-card-detail family-runtime" data-testid="work-process-tool-preview">
        <ul className="work-process-tool-card-list">
          {row.previewLines.map((line) => (
            <li key={line} className="work-process-tool-card-list-item">{line}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="work-process-tool-card-detail family-runtime" data-testid="work-process-tool-preview">
      {row.pathChip ? <PathRow path={row.pathChip} /> : null}
      {row.previewLines.length > 0 ? (
        <pre className="work-process-tool-card-preview">{row.previewLines.join('\n')}</pre>
      ) : null}
    </div>
  );
};

export const FamilyLayerBody: React.FC<{ row: ToolRowModel }> = ({ row }) => {
  if (row.family === 'interpreter') return <InterpreterBody row={row} />;
  if (row.family === 'memory') return <MemoryBody row={row} />;
  if (row.family === 'skill') return <SkillBody row={row} />;
  if (row.family === 'mcp') return <McpBody row={row} />;
  if (row.family === 'runtime') return <RuntimeBody row={row} />;
  return null;
};

export const FamilyLayerDetail: React.FC<{ row: ToolRowModel }> = ({ row }) => {
  if (row.family === 'interpreter') return <InterpreterDetail row={row} />;
  if (row.family === 'memory') return <MemoryDetail row={row} />;
  if (row.family === 'skill') return <SkillDetail row={row} />;
  if (row.family === 'mcp') return <McpDetail row={row} />;
  if (row.family === 'runtime') return <RuntimeDetail row={row} />;
  return null;
};
