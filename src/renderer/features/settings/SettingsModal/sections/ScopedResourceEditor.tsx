import React from 'react';
import { CANONICAL_HOOK_EVENTS, type ScopedResourceKind } from '@shared/types/rdcRuntime';
import { MCP_TRANSPORTS } from '@shared/types/mcp';
import { useI18n, type TranslationKey } from '../../../../i18n';
import { Button } from '../../../../ui/Button';
import { Checkbox } from '../../../../ui/Checkbox';
import { Icon } from '../../../../ui/Icon';
import { InlineError } from '../../../../ui/InlineError';
import { Input } from '../../../../ui/Input';
import { Pill } from '../../../../ui/Pill';
import { Select } from '../../../../ui/Select';
import { Textarea } from '../../../../ui/Textarea';
import { SettingsField } from '../parts';
import type { ResourceFormState } from './scopedResourceForm';

const kindLabelKey = (kind: ScopedResourceKind): TranslationKey => `settings.kind.${kind}` as TranslationKey;

/** Enum select whose options always include the current value so an unsupported value never gets silently rewritten. */
function enumOptions(values: readonly string[], current: string, unsupportedSuffix: string) {
  const options = values.map((value) => ({ value, label: value }));
  if (current && !values.includes(current)) {
    options.unshift({ value: current, label: `${current} ${unsupportedSuffix}` });
  }
  return options;
}

export const ScopedResourceEditor: React.FC<{
  kind: ScopedResourceKind;
  scope: 'user' | 'project';
  form: ResourceFormState;
  idLocked: boolean;
  busy: boolean;
  dirty?: boolean;
  /** Validation / save outcome shown inside the editor body. */
  message?: string | null;
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
  message = null,
  showHeader = true,
  onChange,
  onSave,
  onDelete,
  onCancel,
}) => {
  const { t } = useI18n();
  const kindLabel = t(kindLabelKey(kind));
  const isError = Boolean(message) && message !== t('settings.scopeSaved') && message !== t('settings.scopeImported');
  return (
    <div className="settings-runtime-editor settings-manifest-editor" data-testid="settings-runtime-editor" data-resource-kind={kind}>
      {showHeader ? (
        <div className="settings-manifest-editor-head">
          <div className="settings-section-title">
            {form.id || t('settings.scopeAdd', { kind: kindLabel })}
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

        <SettingsField label={t('settings.resourceFieldId')}>
          <div className="settings-runtime-id-control">
            <Input value={form.id} disabled={idLocked || busy} onChange={(event) => onChange({ id: event.target.value })} />
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

        {kind === 'mcp' && (
          <>
            <SettingsField label={t('settings.resourceFieldName')}>
              <Input value={form.name} disabled={busy} onChange={(event) => onChange({ name: event.target.value })} />
            </SettingsField>
            <SettingsField label={t('settings.resourceFieldTransport')}>
              <Select
                dataTestId="settings-mcp-transport"
                ariaLabel={t('settings.resourceFieldTransport')}
                value={form.transport}
                disabled={busy}
                onChange={(value) => onChange({ transport: value })}
                options={enumOptions(MCP_TRANSPORTS, form.transport, t('settings.resourceEnumUnsupported'))}
              />
            </SettingsField>
            {form.transport === 'streamable-http' ? (
              <SettingsField className="settings-runtime-form-span" label={t('settings.resourceFieldUrl')}>
                <Input value={form.url} disabled={busy} placeholder="http://localhost:8123/mcp" onChange={(event) => onChange({ url: event.target.value })} />
              </SettingsField>
            ) : null}
            <SettingsField className="settings-runtime-form-span" label={t('settings.resourceFieldCommand')}>
              <Input value={form.command} disabled={busy} onChange={(event) => onChange({ command: event.target.value })} />
            </SettingsField>
            <SettingsField className="settings-runtime-form-span" label={t('settings.resourceFieldArgsJson')}>
              <Textarea aria-label={t('settings.resourceFieldArgsJson')} value={form.argsText} disabled={busy} onChange={(event) => onChange({ argsText: event.target.value })} />
            </SettingsField>
            <Checkbox
              className="settings-field settings-runtime-form-check"
              checked={form.enabled}
              disabled={busy}
              onCheckedChange={(enabled) => onChange({ enabled })}
              label={t('settings.resourceFieldEnabledDefault')}
            />
          </>
        )}

        {kind === 'hook' && (
          <>
            <SettingsField label={t('settings.resourceFieldEvent')}>
              <Select
                dataTestId="settings-hook-event"
                ariaLabel={t('settings.resourceFieldEvent')}
                value={form.event}
                disabled={busy}
                onChange={(value) => onChange({ event: value })}
                options={enumOptions(CANONICAL_HOOK_EVENTS, form.event, t('settings.resourceEnumUnsupported'))}
              />
            </SettingsField>
            <SettingsField className="settings-runtime-form-span" label={t('settings.resourceFieldCommand')}>
              <Input value={form.command} disabled={busy} onChange={(event) => onChange({ command: event.target.value })} />
            </SettingsField>
            <SettingsField className="settings-runtime-form-span" label={t('settings.resourceFieldArgsJson')}>
              <Input value={form.argsText} disabled={busy} onChange={(event) => onChange({ argsText: event.target.value })} />
            </SettingsField>
            <SettingsField label={t('settings.resourceFieldTimeoutMs')}>
              <Input type="number" min={1000} max={600000} step={1000} value={form.timeoutMs} disabled={busy} onChange={(event) => onChange({ timeoutMs: event.target.value })} />
            </SettingsField>
            <SettingsField label={t('settings.resourceFieldFailurePolicy')}>
              <div className="settings-choice-group" role="radiogroup" aria-label={t('settings.resourceFieldFailurePolicy')} data-testid="settings-hook-failure-policy">
                {(['warn', 'block'] as const).map((policy) => (
                  <Pill
                    key={policy}
                    role="radio"
                    aria-checked={form.failurePolicy === policy}
                    selected={form.failurePolicy === policy}
                    disabled={busy}
                    onClick={() => onChange({ failurePolicy: policy })}
                  >
                    {policy === 'warn' ? t('settings.hookFailureWarn') : t('settings.hookFailureBlock')}
                  </Pill>
                ))}
              </div>
            </SettingsField>
            <Checkbox
              className="settings-field settings-runtime-form-check"
              checked={form.enabled}
              disabled={busy}
              onCheckedChange={(enabled) => onChange({ enabled })}
              label={t('settings.resourceFieldEnabled')}
            />
          </>
        )}
      </div>

      {kind === 'hook' ? (
        <p className="settings-help-text settings-runtime-editor-note">
          <Icon name="warning" size={14} />
          {t('settings.hookRetrustAfterSave')}
        </p>
      ) : null}
      {kind === 'policy' && scope === 'project' ? (
        <p className="settings-help-text settings-runtime-editor-note" data-testid="settings-policy-tighten-note">
          <Icon name="warning" size={14} />
          {t('settings.policyProjectTightenOnly')}
        </p>
      ) : null}
      {message ? (
        isError
          ? <InlineError data-testid="settings-runtime-editor-error">{message}</InlineError>
          : <p className="settings-help-text" role="status">{message}</p>
      ) : null}
    </div>
  );
};
