import React, { useId } from 'react';
import { useI18n, type TranslationKey } from '../../../../i18n';
import { Button } from '../../../../ui/Button';
import { Icon } from '../../../../ui/Icon';
import { InlineError } from '../../../../ui/InlineError';
import { Input } from '../../../../ui/Input';
import { Textarea } from '../../../../ui/Textarea';
import { SettingsField } from '../parts';
import { HookResourceFields, McpResourceFields } from './ScopedResourceKindFields';
import { templateResourceId } from './runtimeScopeMutations';
import { resourceDisplayName, type ResourceFormState } from './scopedResourceForm';
import type { ScopedResourceKind } from '@shared/types/rdcRuntime';
import type { ScopeNotice } from './useScopedResourceForm';

const kindLabelKey = (kind: ScopedResourceKind): TranslationKey => `settings.kind.${kind}` as TranslationKey;

export const ScopedResourceEditor: React.FC<{
  kind: ScopedResourceKind;
  scope: 'user' | 'project';
  form: ResourceFormState;
  idLocked: boolean;
  busy: boolean;
  dirty?: boolean;
  /** Validation / save outcome shown inside the editor body. */
  notice?: ScopeNotice | null;
  /** Dialog presentation moves the title and actions into the dialog chrome. */
  showHeader?: boolean;
  onChange: (patch: Partial<ResourceFormState>) => void;
  onSave: () => void;
  onDelete?: () => void;
  onCancel: () => void;
}> = ({
  kind,
  scope,
  form,
  idLocked,
  busy,
  dirty = false,
  notice = null,
  showHeader = true,
  onChange,
  onSave,
  onDelete,
  onCancel,
}) => {
  const { t } = useI18n();
  const fieldId = useId();
  const kindLabel = t(kindLabelKey(kind));
  return (
    <div className="settings-runtime-editor settings-manifest-editor" data-testid="settings-runtime-editor" data-resource-kind={kind}>
      {showHeader ? (
        <div className="settings-manifest-editor-head">
          <div className="settings-section-title">
            {form.id ? resourceDisplayName(kind, form.id, form.body) : t('settings.scopeAdd', { kind: kindLabel })}
            {dirty ? (
              <span className="settings-editor-dirty" data-testid="settings-runtime-editor-dirty">
                {t('settings.unsaved')}
              </span>
            ) : null}
          </div>
          <div className="settings-manifest-editor-actions">
            {onDelete ? <Button variant="danger" disabled={busy} onClick={onDelete}>{t('settings.delete')}</Button> : null}
            <Button variant="ghost" disabled={busy} onClick={onCancel}>{t('settings.cancel')}</Button>
            <Button variant="primary" disabled={busy} onClick={onSave}>{t('settings.scopeSave')}</Button>
          </div>
        </div>
      ) : null}

      <div className="settings-manifest-form-grid settings-runtime-form-grid">
        {kind === 'policy' ? (
          <SettingsField label={t('settings.resourceScope')}>
            <div className="settings-runtime-readonly" data-testid="settings-resource-scope-readonly">
              <span>{scope === 'project' ? t('settings.scopeProject') : t('settings.scopeUser')}</span>
              <span className="settings-runtime-readonly-tag">
                <Icon name="lock" size={12} />
                {t('settings.resourceReadOnly')}
              </span>
            </div>
          </SettingsField>
        ) : null}

        <SettingsField label={t('settings.resourceFieldId')} htmlFor={`${fieldId}-id`}>
          <div className="settings-runtime-id-control">
            <Input id={`${fieldId}-id`} value={form.id} disabled={idLocked || busy} placeholder={templateResourceId(kind)}
              onChange={(event) => onChange({ id: event.target.value })} />
            {idLocked ? (
              <span className="settings-runtime-readonly-tag" data-testid="settings-resource-id-locked">
                <Icon name="lock" size={12} />
                {t('settings.resourceIdLocked')}
              </span>
            ) : null}
          </div>
        </SettingsField>

        {(kind === 'skill' || kind === 'policy' || kind === 'agent') && (
          <SettingsField
            className="settings-runtime-form-span settings-resource-document-field"
            label={kind === 'skill' ? t('settings.resourceFieldSkillMd') : t('settings.resourceFieldContent')}
          >
            <Textarea
              sizing="fill" className="settings-resource-document-input"
              aria-label={kind === 'skill' ? t('settings.resourceFieldSkillMd') : t('settings.resourceFieldContent')}
              value={form.body}
              disabled={busy}
              onChange={(event) => onChange({ body: event.target.value })}
            />
          </SettingsField>
        )}

        {kind === 'mcp' && <McpResourceFields form={form} busy={busy} fieldId={fieldId} onChange={onChange} />}
        {kind === 'hook' && <HookResourceFields form={form} busy={busy} fieldId={fieldId} onChange={onChange} />}
      </div>

      {kind === 'hook' ? (
        <p className="settings-runtime-editor-note">
          <Icon name="warning" size={14} />
          {t('settings.hookRetrustAfterSave')}
        </p>
      ) : null}
      {kind === 'policy' && scope === 'project' ? (
        <p className="settings-runtime-editor-note" data-testid="settings-policy-tighten-note">
          <Icon name="warning" size={14} />
          {t('settings.policyProjectTightenOnly')}
        </p>
      ) : null}
      {notice ? (
        notice.tone === 'error'
          ? <InlineError data-testid="settings-runtime-editor-error" detail={notice.detail}>{notice.message}</InlineError>
          : <p className="settings-runtime-editor-status" role="status"><Icon name="check" size={14} />{notice.message}</p>
      ) : null}
    </div>
  );
};
