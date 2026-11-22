import { Button } from '../../../../ui/Button';
import { Checkbox } from '../../../../ui/Checkbox';
import { InlineError } from '../../../../ui/InlineError';
import { Input } from '../../../../ui/Input';
import { Select } from '../../../../ui/Select';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { useI18n } from '../../../../i18n';
import { knowledgeCardKey } from '../knowledgeImportExportModel';
import type { KnowledgeExportFormat, KnowledgeExportScope } from '@shared/types/knowledgeExport';
import type { KnowledgeSpace } from '@shared/types/knowledge';
import type { useKnowledgeExport } from '../useKnowledgeExport';

interface ExportKnowledgeDialogProps {
  exporter: ReturnType<typeof useKnowledgeExport>;
  spaces: KnowledgeSpace[];
}

export function ExportKnowledgeDialog({ exporter, spaces }: ExportKnowledgeDialogProps) {
  const { t } = useI18n();

  const scopeOptions: Array<{ id: KnowledgeExportScope; label: string }> = [
    { id: 'selected', label: t('knowledgeCenter.exportScopePicked', { count: exporter.counts.selected }) },
    { id: 'filtered', label: t('knowledgeCenter.exportScopeFiltered', { count: exporter.counts.filtered }) },
    { id: 'space', label: t('knowledgeCenter.exportScopeSpace') },
  ];

  const formatOptions: Array<{ id: KnowledgeExportFormat; label: string }> = [
    { id: 'package', label: t('knowledgeCenter.exportFormatPackage') },
    { id: 'markdown', label: t('knowledgeCenter.exportFormatMarkdown') },
  ];

  const radioGroup = <T extends string>(
    name: string,
    options: Array<{ id: T; label: string }>,
    value: T,
    onChange: (next: T) => void,
    legend: string,
  ) => (
    <fieldset className="knowledge-export-group">
      <legend>{legend}</legend>
      {options.map((option) => (
        <label key={option.id} className="knowledge-export-option">
          <input
            type="radio"
            name={name}
            checked={value === option.id}
            disabled={exporter.busy}
            data-testid={`knowledge-export-${name}-${option.id}`}
            onChange={() => onChange(option.id)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );

  return (
    <TaskDialog
      open={exporter.open}
      size="sm"
      title={t('knowledgeCenter.exportTitle')}
      onClose={exporter.close}
      closeLabel={t('knowledgeCenter.confirmCancel')}
      busy={exporter.busy}
      dataTestId="knowledge-center-export"
      footer={exporter.result ? (
        <Button variant="primary" onClick={exporter.close}>{t('knowledgeCenter.importDone')}</Button>
      ) : (
        <>
          <Button variant="ghost" disabled={exporter.busy} onClick={exporter.close}>
            {t('knowledgeCenter.confirmCancel')}
          </Button>
          <Button
            variant="primary"
            disabled={exporter.busy || exporter.pendingCount === 0}
            data-testid="knowledge-center-export-run"
            onClick={() => void exporter.run()}
          >
            {t('knowledgeCenter.exportRun')}
          </Button>
        </>
      )}
    >
      {exporter.result ? (
        <div className="knowledge-export-result" data-testid="knowledge-center-export-result">
          <p>{t('knowledgeCenter.exportDone', { count: exporter.result.cardCount })}</p>
          {exporter.result.excludedCount > 0 ? (
            <p className="knowledge-write-hint">
              {t('knowledgeCenter.exportExcluded', { count: exporter.result.excludedCount })}
            </p>
          ) : null}
          <p className="knowledge-export-file">{exporter.result.targetPath.split(/[\\/]/).pop()}</p>
        </div>
      ) : (
        <>
          {radioGroup(
            'scope',
            scopeOptions,
            exporter.scope,
            exporter.setScope,
            t('knowledgeCenter.exportScope'),
          )}

          {exporter.scope === 'selected' ? (
            <div className="knowledge-export-picker" data-testid="knowledge-center-export-picker">
              <div className="knowledge-export-picker-bar">
                <Input
                  value={exporter.pickerQuery}
                  onChange={(event) => exporter.setPickerQuery(event.target.value)}
                  placeholder={t('knowledgeCenter.exportPickerSearch')}
                  aria-label={t('knowledgeCenter.exportPickerSearch')}
                  disabled={exporter.busy}
                />
                <Button variant="ghost" size="sm" disabled={exporter.busy || exporter.pickable.length === 0} onClick={exporter.pickAll}>
                  {t('knowledgeCenter.exportPickAll')}
                </Button>
                <Button variant="ghost" size="sm" disabled={exporter.busy || exporter.picked.size === 0} onClick={exporter.clearPicked}>
                  {t('knowledgeCenter.exportPickNone')}
                </Button>
              </div>
              <ul className="knowledge-export-picker-list">
                {exporter.pickable.map((card) => (
                  <li key={knowledgeCardKey(card)}>
                    <Checkbox
                      checked={exporter.picked.has(knowledgeCardKey(card))}
                      disabled={exporter.busy}
                      onCheckedChange={() => exporter.togglePicked(card)}
                      label={card.title}
                    />
                  </li>
                ))}
                {exporter.pickable.length === 0 ? <li className="knowledge-export-picker-empty">{t('knowledgeCenter.exportPickerEmpty')}</li> : null}
              </ul>
            </div>
          ) : null}

          {exporter.scope === 'space' ? (
            <label className="knowledge-center-field">
              <span>{t('knowledgeCenter.importTargetSpace')}</span>
              <Select
                dataTestId="knowledge-center-export-space"
                ariaLabel={t('knowledgeCenter.importTargetSpace')}
                value={exporter.spaceId}
                disabled={exporter.busy}
                onChange={exporter.setSpaceId}
                options={spaces.map((space) => ({ value: space.spaceId, label: space.kind === 'user' ? t('knowledgeCenter.userSpace') : space.label }))}
              />
            </label>
          ) : null}

          {radioGroup(
            'format',
            formatOptions,
            exporter.format,
            exporter.setFormat,
            t('knowledgeCenter.exportFormat'),
          )}

          <p className="knowledge-write-hint">{t('knowledgeCenter.exportLocationHint')}</p>
          {exporter.error ? <InlineError>{exporter.error}</InlineError> : null}
        </>
      )}
    </TaskDialog>
  );
}
