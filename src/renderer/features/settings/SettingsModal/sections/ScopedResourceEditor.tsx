import React from 'react';
import type { ScopedResourceKind } from '@shared/types/rdxRuntime';
import { useI18n, type TranslationKey } from '../../../../i18n';
import { Button } from '../../../../ui/Button';
import { Input } from '../../../../ui/Input';
import { Select } from '../../../../ui/Select';
import { AutosizeTextarea } from '../AutosizeTextarea';
import { SettingsField } from '../parts';
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
          <Button variant="primary" disabled={busy} onClick={onSave}>{t('settings.scopeSave')}</Button>
          {onDelete ? <Button variant="danger" disabled={busy} onClick={onDelete}>{t('settings.delete')}</Button> : null}
          <Button variant="ghost" disabled={busy} onClick={onCancel}>{t('settings.cancel')}</Button>
        </div>
      </div>

      <div className="settings-manifest-form-grid settings-runtime-form-grid">
        <SettingsField label={t('settings.resourceFieldId')}>
          <Input value={form.id} disabled={idLocked || busy} onChange={(event) => onChange({ id: event.target.value })} />
        </SettingsField>

        {(kind === 'skill' || kind === 'policy' || kind === 'agent') && (
          <SettingsField
            className="settings-runtime-form-span"
            label={kind === 'skill' ? t('settings.resourceFieldSkillMd') : t('settings.resourceFieldContent')}
          >
            <AutosizeTextarea
              maxHeight={420}
              className="input settings-agent-instructions"
              value={form.body}
              disabled={busy}
              onChange={(event) => onChange({ body: event.target.value })}
            />
          </SettingsField>
        )}

        {kind === 'mcp' && (
          <>
            <SettingsField label={t('settings.resourceFieldName')}>
              <Input value={form.name} disabled={busy} onChange={(event) => onChange({ name: event.target.value })} />
            </SettingsField>
            <SettingsField label={t('settings.resourceFieldTransport')}>
              <Input value={form.transport} disabled={busy} onChange={(event) => onChange({ transport: event.target.value })} />
            </SettingsField>
            <SettingsField className="settings-runtime-form-span" label={t('settings.resourceFieldCommand')}>
              <Input value={form.command} disabled={busy} onChange={(event) => onChange({ command: event.target.value })} />
            </SettingsField>
            <SettingsField className="settings-runtime-form-span" label={t('settings.resourceFieldArgsJson')}>
              <AutosizeTextarea maxHeight={160} className="input" value={form.argsText} disabled={busy} onChange={(event) => onChange({ argsText: event.target.value })} />
            </SettingsField>
            <label className="settings-field settings-runtime-form-check">
              <input type="checkbox" checked={form.enabled} disabled={busy} onChange={(event) => onChange({ enabled: event.target.checked })} />
              <span>{t('settings.resourceFieldEnabledDefault')}</span>
            </label>
          </>
        )}

        {kind === 'hook' && (
          <>
            <SettingsField label={t('settings.resourceFieldEvent')}>
              <Input value={form.event} disabled={busy} onChange={(event) => onChange({ event: event.target.value })} />
            </SettingsField>
            <SettingsField label={t('settings.resourceFieldCommand')}>
              <Input value={form.command} disabled={busy} onChange={(event) => onChange({ command: event.target.value })} />
            </SettingsField>
            <SettingsField className="settings-runtime-form-span" label={t('settings.resourceFieldArgs')}>
              <Input value={form.argsText} disabled={busy} onChange={(event) => onChange({ argsText: event.target.value })} />
            </SettingsField>
            <SettingsField label={t('settings.resourceFieldTimeoutMs')}>
              <Input value={form.timeoutMs} disabled={busy} onChange={(event) => onChange({ timeoutMs: event.target.value })} />
            </SettingsField>
            <SettingsField label={t('settings.resourceFieldFailurePolicy')}>
              <Select
                dataTestId="settings-hook-failure-policy"
                ariaLabel={t('settings.resourceFieldFailurePolicy')}
                value={form.failurePolicy}
                disabled={busy}
                onChange={(value) => onChange({ failurePolicy: value === 'block' ? 'block' : 'warn' })}
                options={[
                  { value: 'warn', label: t('settings.hookFailureWarn') },
                  { value: 'block', label: t('settings.hookFailureBlock') },
                ]}
              />
            </SettingsField>
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
