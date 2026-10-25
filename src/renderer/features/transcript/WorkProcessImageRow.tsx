import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ToolRowModel } from './workProcessToolTypes';
import { useI18n } from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../../ui/Button';
import { WorkCardHeader } from './WorkCardHeader';
import { WorkProcessIcon } from './WorkProcessIcons';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';
import { WorkProcessImageThumbs } from './WorkProcessImageThumbs';
import { CopyPathButton } from './WorkProcessFamilyLayers';
import { RawPanel } from './WorkProcessToolCardParts';
import { useScopedWorkDisclosure } from './ScopedWorkDisclosure';

export function WorkProcessImageRow({ row, renderToolDetail }: {
  row: ToolRowModel; renderToolDetail?: (row: ToolRowModel) => ReactNode;
}) {
  const { t } = useI18n();
  const scope = useProjectStore(state => state.currentSession?.sessionId);
  const calls = row.imageCalls ?? [row];
  const count = calls.reduce((total, call) => total + Math.max(1, call.imagePreviews?.length ?? 0), 0);
  const [expanded, toggle] = useScopedWorkDisclosure(`images-${row.id}`, false);
  const [limit, setLimit] = useState(20);
  const extra = useRef<HTMLDivElement>(null);
  const detailsId = useId();
  const focusExtra = useRef(false);
  useEffect(() => { setLimit(20); focusExtra.current = false; }, [scope, row.id]);
  useEffect(() => {
    if (expanded && focusExtra.current) { extra.current?.focus(); focusExtra.current = false; }
  }, [expanded]);
  const images = calls.flatMap(call => call.imagePreviews?.length ? call.imagePreviews : [null]);
  const initial = images.slice(0, 4);
  const previews = initial.flatMap(preview => preview ? [preview] : []);
  const showMore = () => { focusExtra.current = true; if (!expanded) toggle(); else extra.current?.focus(); };
  return <li className="work-process-step kind-tool family-image" data-testid="work-process-image-group">
    <WorkProcessRailIcon variant="step" status="complete" />
    <div className="work-process-step-content">
      <div className={`work-process-tool-card${expanded ? ' is-expanded' : ''}`}>
        <WorkCardHeader icon={<WorkProcessIcon icon="imageRead" className="work-process-tool-card-icon" />}
          title={t('chat.imagesViewed', { count })} duration={row.duration} expanded={expanded} controls={detailsId} onClick={toggle} />
        <div className="work-process-image-summary">
          <WorkProcessImageThumbs previews={previews} />
          {initial.some(preview => !preview) ? <span className="work-process-image-unavailable">{t('chat.imageMissingReference')}</span> : null}
          {count > 4 ? <Button variant="ghost" size="sm" onClick={showMore}
            aria-label={t('chat.imagesShowMore', { count: count - 4 })}>+{count - 4}</Button> : null}
        </div>
        {expanded ? <div id={detailsId} className="work-process-image-details">
          <div ref={extra} tabIndex={-1} className="work-process-image-additional">
            <WorkProcessImageThumbs previews={images.slice(4, limit).flatMap(preview => preview ? [preview] : [])} />
          </div>
          {calls.slice(0, limit).map(call => {
            const name = call.imagePreviews?.map(preview => preview.fileName).join(', ') || call.target;
            const path = call.pathChip || call.target;
            return <div key={call.id} className="work-process-image-receipt" data-image-call-id={call.id}>
              <span className="work-process-image-name">{name}{call.duration ? ` · ${call.duration}` : ''}</span>
              {path ? <div className="work-process-family-path"><code className="work-process-tool-card-path">{path}</code>
                <CopyPathButton path={path} /></div> : null}
              {!call.imagePreviews?.length ? <p>{t('chat.imageMissingReference')}</p> : null}
              <RawPanel row={call} />
              {renderToolDetail?.(call)}
            </div>;
          })}
          {Math.max(calls.length, images.length) > limit ? <Button variant="ghost" size="sm"
            onClick={() => setLimit(value => value + 20)}>{t('chat.imagesLoadMore')}</Button> : null}
        </div> : null}
      </div>
    </div>
  </li>;
}
