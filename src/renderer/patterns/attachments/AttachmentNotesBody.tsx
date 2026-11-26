import { useI18n } from '../../i18n';
import { CopyDiagnosticsButton } from '../CopyDiagnostics';
import type { AttachmentNotes } from './attachmentItem';

export function AttachmentNotesBody({ notes }: { notes: AttachmentNotes }) {
  const { t, language } = useI18n();
  const { intent, region, documentLocation, timeRange, comparison } = notes.material;
  const percentage = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 2 });
  const seconds = new Intl.NumberFormat(language, { style: 'unit', unit: 'second', maximumFractionDigits: 3 });
  return (
    <div className="attachment-notes-body">
      <p>{t('attachment.notesSource')}</p>
      {intent ? <p>{intent}</p> : null}
      <dl>
        {documentLocation ? (
          <>
            <dt>{t('attachment.documentLocation')}</dt>
            <dd>{documentLocation}</dd>
          </>
        ) : null}
        {region ? (
          <>
            <dt>{t('attachment.imageRegion')}</dt>
            <dd>
              {t('attachment.regionValues', {
                x: percentage.format(region.x),
                y: percentage.format(region.y),
                width: percentage.format(region.width),
                height: percentage.format(region.height),
              })}
            </dd>
          </>
        ) : null}
        {timeRange ? (
          <>
            <dt>{t('attachment.timeRange')}</dt>
            <dd>
              {t('attachment.timeRangeValues', {
                start: seconds.format(timeRange.startSeconds),
                end: seconds.format(timeRange.endSeconds),
              })}
            </dd>
          </>
        ) : null}
        {comparison ? (
          <>
            <dt>{t(`attachment.comparison.${comparison.role}`)}</dt>
            <dd>
              {comparison.group}
              <p>{comparison.conditions}</p>
            </dd>
          </>
        ) : null}
        {notes.relatedNames?.length ? (
          <>
            <dt>{t('attachment.relatedFiles')}</dt>
            <dd>
              <ul>
                {notes.relatedNames.map((name, index) => (
                  <li key={`${index}:${name}`}>{name}</li>
                ))}
              </ul>
            </dd>
          </>
        ) : null}
      </dl>
      {notes.sourceHash ? (
        <CopyDiagnosticsButton facts={[{ label: t('attachment.fingerprint'), value: notes.sourceHash }]} />
      ) : null}
    </div>
  );
}
