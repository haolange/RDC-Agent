import React, { useMemo, useState } from 'react';
import { useI18n } from '../../../i18n';
import { Button } from '../../../ui/Button';
import { MessageMarkdown } from '../AgentChat/MessageMarkdown';

const PREVIEW_CHAR_LIMIT = 1200;

interface PlanArtifactPreviewProps {
  markdown: string;
}

/**
 * Plan artifact 会话内 markdown 预览：默认可折叠；超长内容截断并提供展开。
 */
export const PlanArtifactPreview: React.FC<PlanArtifactPreviewProps> = ({ markdown }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const trimmed = markdown.trim();
  const needsTruncate = trimmed.length > PREVIEW_CHAR_LIMIT;
  const visibleMarkdown = useMemo(() => {
    if (!needsTruncate || expanded) return trimmed;
    return `${trimmed.slice(0, PREVIEW_CHAR_LIMIT).trimEnd()}\n\n…`;
  }, [expanded, needsTruncate, trimmed]);

  if (!trimmed) return null;

  return (
    <div className="trace-plan-preview" data-testid="trace-plan-preview">
      <button
        type="button"
        className="trace-plan-preview-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`trace-plan-preview-chevron ${open ? 'is-open' : ''}`} aria-hidden="true">▸</span>
        <span>{t('control.tracePlanPreview')}</span>
      </button>
      {open ? (
        <div className="trace-plan-preview-body">
          <div className={`trace-plan-preview-markdown ${needsTruncate && !expanded ? 'is-truncated' : ''}`}>
            <MessageMarkdown content={visibleMarkdown} />
          </div>
          {needsTruncate ? (
            <Button
              variant="ghost"
              size="sm"
              className="trace-plan-preview-expand"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? t('control.tracePlanPreviewCollapse') : t('control.tracePlanPreviewExpand')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default PlanArtifactPreview;
