import React from 'react';
import type { ScopedResourceKind } from '@shared/types/rdxRuntime';
import { useI18n, type TranslationKey } from '../../../../i18n';
import { AutosizeTextarea } from '../AutosizeTextarea';
import type { ResourceFormState } from './scopedResourceForm';

const kindLabelKey = (kind: ScopedResourceKind): TranslationKey => `settings.kind.${kind}` as TranslationKey;

export const ScopedResourceEditor: React.FC<{
  kind: ScopedResourceKind;
  form: ResourceFormState;
  idLocked: boolean;
  busy: boolean;
  onChange: (patch: Partial<ResourceFormState>) => void;
  onSave: () => void;
  onDelete?: () => void;
  onCancel: () => void;
}> = ({ kind, form, idLocked, busy, onChange, onSave, onDelete, onCancel }) => {
  const { t } = useI18n();
  const kindLabel = t(kindLabelKey(kind));
  return (
    <div className="settings-runtime-editor settings-manifest-editor" data-testid="settings-runtime-editor">
      <div className="settings-manifest-editor-head">
        <div className="settings-section-title">{form.id || t('settings.scopeAdd', { kind: kindLabel })}</div>
        <div className="settings-manifest-editor-actions">
          <button type="button" className="button button-primary" disabled={busy} onClick={onSave}>{t('settings.scopeSave')}</button>
          {onDelete ? <button type="button" className="button button-danger" disabled={busy} onClick={onDelete}>{t('settings.delete')}</button> : null}
          <button type="button" className="button button-ghost" disabled={busy} onClick={onCancel}>{t('settings.cancel')}</button>
        </div>
      </div>

      <div className="settings-manifest-form-grid settings-runtime-form-grid">
        <label className="settings-field">
          <span className="settings-field-label">{t('settings.resourceFieldId')}</span>
          <input className="input" value={form.id} disabled={idLocked || busy} onChange={(event) => onChange({ id: event.target.value })} />
        </label>

        {(kind === 'skill' || kind === 'policy' || kind === 'agent') && (
          <label className="settings-field settings-runtime-form-span">
            <span className="settings-field-label">
              {kind === 'skill' ? t('settings.resourceFieldSkillMd') : t('settings.resourceFieldContent')}
            </span>
            <AutosizeTextarea
              maxHeight={420}
              className="input settings-agent-instructions"
              value={form.body}
              disabled={busy}
              onChange={(event) => onChange({ body: event.target.value })}
            />
          </label>
        )}

        {kind === 'mcp' && (
          <>
            <label className="settings-field">
              <span className="settings-field-label">{t('settings.resourceFieldName')}</span>
              <input className="input" value={form.name} disabled={busy} onChange={(event) => onChange({ name: event.target.value })} />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">{t('settings.resourceFieldTransport')}</span>
              <input className="input" value={form.transport} disabled={busy} onChange={(event) => onChange({ transport: event.target.value })} />
            </label>
            <label className="settings-field settings-runtime-form-span">
              <span className="settings-field-label">{t('settings.resourceFieldCommand')}</span>
              <input className="input" value={form.command} disabled={busy} onChange={(event) => onChange({ command: event.target.value })} />
            </label>
            <label className="settings-field settings-runtime-form-span">
              <span className="settings-field-label">{t('settings.resourceFieldArgsJson')}</span>
              <AutosizeTextarea maxHeight={160} className="input" value={form.argsText} disabled={busy} onChange={(event) => onChange({ argsText: event.target.value })} />
            </label>
            <label className="settings-field settings-runtime-form-check">
              <input type="checkbox" checked={form.enabled} disabled={busy} onChange={(event) => onChange({ enabled: event.target.checked })} />
              <span>{t('settings.resourceFieldEnabledDefault')}</span>
            </label>
          </>
        )}

        {kind === 'hook' && (
          <>
            <label className="settings-field">
              <span className="settings-field-label">{t('settings.resourceFieldEvent')}</span>
              <input className="input" value={form.event} disabled={busy} onChange={(event) => onChange({ event: event.target.value })} />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">{t('settings.resourceFieldCommand')}</span>
              <input className="input" value={form.command} disabled={busy} onChange={(event) => onChange({ command: event.target.value })} />
            </label>
            <label className="settings-field settings-runtime-form-span">
              <span className="settings-field-label">{t('settings.resourceFieldArgs')}</span>
              <input className="input" value={form.argsText} disabled={busy} onChange={(event) => onChange({ argsText: event.target.value })} />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">{t('settings.resourceFieldTimeoutMs')}</span>
              <input className="input" value={form.timeoutMs} disabled={busy} onChange={(event) => onChange({ timeoutMs: event.target.value })} />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">{t('settings.resourceFieldFailurePolicy')}</span>
              <select className="input" value={form.failurePolicy} disabled={busy} onChange={(event) => onChange({ failurePolicy: event.target.value === 'block' ? 'block' : 'warn' })}>
                <option value="warn">{t('settings.hookFailureWarn')}</option>
                <option value="block">{t('settings.hookFailureBlock')}</option>
              </select>
            </label>
            <label className="settings-field settings-runtime-form-check">
              <input type="checkbox" checked={form.enabled} disabled={busy} onChange={(event) => onChange({ enabled: event.target.checked })} />
              <span>{t('settings.resourceFieldEnabled')}</span>
            </label>
          </>
        )}
      </div>
    </div>
  );
};
