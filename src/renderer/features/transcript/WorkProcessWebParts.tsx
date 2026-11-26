import React from 'react';
import { useI18n } from '../../i18n';
import { formatBytes } from '../../lib/formatBytes';
import { FaviconImage } from '../../patterns/FaviconImage';
import { ActiveSignalText } from '../../ui/ActiveSignalText';
import { Icon } from '../../ui/Icon';
import { useScopedWorkDisclosure } from './ScopedWorkDisclosure';
import { WorkCardHeader } from './WorkCardHeader';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';
import { isTrackActivity } from './workProcessTrack';
import { webGroupHeadline } from './workProcessHeadline';
import type { WorkProcessRow, WorkProcessWebPage } from './workProcessTypes';
import type { ToolRowModel } from './workProcessToolTypes';

const pageLabel = (page: WorkProcessWebPage) => page.title?.trim() || page.domain;

/**
 * One line of page pills (favicon + title). It never wraps or counts what is left: pills that do not fit run past the
 * edge and fade out from 70% of the width. Search results that a later read opened stay bright; the rest dim a step.
 */
export const WebPillStrip: React.FC<{
  pages: readonly WorkProcessWebPage[];
  marksRead?: boolean;
  showDomains?: boolean;
}> = ({ pages, marksRead = false, showDomains = false }) => {
  const { t } = useI18n();
  return (
    <div className="work-process-web-pills" data-testid="work-process-web-pills">
      {pages.map((page, index) => {
        const label = showDomains ? page.domain : pageLabel(page);
        const tooltip =
          page.state === 'failed'
            ? t('chat.webPageFailed', { page: pageLabel(page) })
            : [page.title, page.url].filter(Boolean).join('\n') || page.domain;
        const className = `work-process-web-pill is-${page.state}${marksRead && !page.read ? ' is-unread' : ''}`;
        const content = (
          <>
            {page.state === 'failed' ? (
              <Icon name="warning" size={14} className="work-process-web-pill-mark" />
            ) : (
              <FaviconImage domain={page.domain} />
            )}
            <span className="work-process-web-pill-label">{label}</span>
          </>
        );
        return page.url && page.state !== 'pending' ? (
          <a
            key={`${page.url}:${index}`}
            className={className}
            href={page.url}
            target="_blank"
            rel="noreferrer noopener"
            data-tooltip={tooltip}
            onClick={(event) => event.stopPropagation()}
          >
            {content}
          </a>
        ) : (
          <span key={`${page.domain}:${index}`} className={className} tabIndex={0} data-tooltip={tooltip}>
            {content}
          </span>
        );
      })}
    </div>
  );
};

/** The expanded list: every page with its title, address and first lines; reads also show their HTTP facts. */
export const WebPageList: React.FC<{ pages: readonly WorkProcessWebPage[]; meta?: ToolRowModel['webMeta'] }> = ({
  pages,
  meta,
}) => {
  const { t, language } = useI18n();
  const facts = [
    meta?.status !== undefined ? t('chat.webPageStatus', { status: meta.status }) : '',
    meta?.bytes !== undefined ? t('chat.webPageSize', { size: formatBytes(meta.bytes, language) }) : '',
  ].filter(Boolean);
  return (
    <ul className="work-process-web-list" data-testid="work-process-tool-preview">
      {pages.map((page, index) => (
        <li key={`${page.url ?? page.domain}:${index}`} className={`work-process-web-item is-${page.state}`}>
          <FaviconImage domain={page.domain} />
          <div className="work-process-web-item-copy">
            {page.url ? (
              <a
                className="work-process-web-item-title"
                href={page.url}
                target="_blank"
                rel="noreferrer noopener"
                onClick={(event) => event.stopPropagation()}
              >
                {pageLabel(page)}
              </a>
            ) : (
              <span className="work-process-web-item-title">{pageLabel(page)}</span>
            )}
            <span className="work-process-web-item-url">{page.url ?? page.domain}</span>
            {page.snippet ? <p className="work-process-web-item-snippet">{page.snippet}</p> : null}
            {facts.length > 0 && pages.length === 1 ? (
              <span className="work-process-web-item-facts">{facts.join(' · ')}</span>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
};

/**
 * Consecutive reads as one card: "读取了 N 个网页", one pill per page, the whole span as its duration. Expanded, each
 * read is its own header-only card whose details and raw receipt open one level further down.
 */
export const WebGroupRow: React.FC<{
  row: Extract<WorkProcessRow, { type: 'webGroup' }>;
  renderMember: (member: ToolRowModel) => React.ReactNode;
}> = ({ row, renderMember }) => {
  const { t } = useI18n();
  const [expanded, toggle] = useScopedWorkDisclosure(`web-group-${row.id}`, false);
  const headline = webGroupHeadline(row, t);
  return (
    <li
      className={`work-process-step is-appear status-${row.status} kind-tool family-web`}
      data-testid="work-process-web-group"
    >
      <WorkProcessRailIcon row={row} />
      <div className="work-process-step-content">
        <div
          className={`work-process-tool-card status-${row.status}${expanded ? ' is-expanded' : ''} is-expandable`}
          data-testid="work-process-tool-card"
          data-family="web"
          data-locate
        >
          <WorkCardHeader
            onClick={(event) => {
              event.preventDefault();
              toggle();
            }}
            expanded={expanded}
            title={headline}
            duration={row.duration}
            icon={<Icon name="web-fetch" className="work-process-icon work-process-tool-card-icon" />}
            titleContent={
              <ActiveSignalText active={isTrackActivity(row)} tone="info">
                {headline}
              </ActiveSignalText>
            }
          />
          <div className="work-process-tool-card-body family-web">
            <WebPillStrip pages={row.pages} />
          </div>
          {expanded ? (
            <div className="work-process-tool-card-expand">
              <ol className="work-process-steps work-process-web-group-members">{row.members.map(renderMember)}</ol>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
};
