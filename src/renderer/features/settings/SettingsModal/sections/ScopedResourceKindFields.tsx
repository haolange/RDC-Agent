import { CANONICAL_HOOK_EVENTS } from '@shared/types/rdcRuntime';
import { MCP_TRANSPORTS } from '@shared/types/mcp';
import { useI18n } from '../../../../i18n';
import { Checkbox } from '../../../../ui/Checkbox';
import { Input } from '../../../../ui/Input';
import { Pill } from '../../../../ui/Pill';
import { Select } from '../../../../ui/Select';
import { Textarea } from '../../../../ui/Textarea';
import { SettingsField } from '../parts';
import { hookEventLabel, mcpTransportLabel, timeoutSeconds } from './resourceLabels';
import type { ResourceFormState } from './scopedResourceForm';

interface KindFieldsProps {
  form: ResourceFormState;
  busy: boolean;
  /** Prefix for the ids that tie labels to their inputs. */
  fieldId: string;
  onChange: (patch: Partial<ResourceFormState>) => void;
}

/** Enum select whose options always include the current value so an unsupported value never gets silently rewritten. */
function enumOptions(
  values: readonly string[],
  current: string,
  label: (value: string) => string,
  unsupportedSuffix: string,
) {
  const options = values.map((value) => ({ value, label: label(value) }));
  if (current && !values.includes(current)) {
    options.unshift({ value: current, label: `${current} ${unsupportedSuffix}` });
  }
  return options;
}

/** An MCP server's name, transport, address or command, arguments and default state. */
export function McpResourceFields({ form, busy, fieldId, onChange }: KindFieldsProps) {
  const { t } = useI18n();
  return (
    <>
      <SettingsField label={t('settings.resourceFieldName')} htmlFor={`${fieldId}-name`}>
        <Input
          id={`${fieldId}-name`}
          value={form.name}
          disabled={busy}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </SettingsField>
      <SettingsField label={t('settings.resourceFieldTransport')}>
        <Select
          dataTestId="settings-mcp-transport"
          ariaLabel={t('settings.resourceFieldTransport')}
          value={form.transport}
          disabled={busy}
          onChange={(value) => onChange({ transport: value })}
          options={enumOptions(
            MCP_TRANSPORTS,
            form.transport,
            (value) => mcpTransportLabel(value, t),
            t('settings.resourceEnumUnsupported'),
          )}
        />
      </SettingsField>
      {form.transport === 'streamable-http' ? (
        <SettingsField
          className="settings-runtime-form-span"
          label={t('settings.resourceFieldUrl')}
          htmlFor={`${fieldId}-url`}
        >
          <Input
            id={`${fieldId}-url`}
            value={form.url}
            disabled={busy}
            placeholder="http://localhost:8123/mcp"
            onChange={(event) => onChange({ url: event.target.value })}
          />
        </SettingsField>
      ) : null}
      <SettingsField
        className="settings-runtime-form-span"
        label={t('settings.resourceFieldCommand')}
        htmlFor={`${fieldId}-command`}
      >
        <Input
          id={`${fieldId}-command`}
          value={form.command}
          disabled={busy}
          onChange={(event) => onChange({ command: event.target.value })}
        />
      </SettingsField>
      <SettingsField className="settings-runtime-form-span" label={t('settings.resourceFieldArgsJson')}>
        <Textarea
          aria-label={t('settings.resourceFieldArgsJson')}
          value={form.argsText}
          disabled={busy}
          onChange={(event) => onChange({ argsText: event.target.value })}
        />
      </SettingsField>
      <Checkbox
        className="settings-field settings-runtime-form-check"
        checked={form.enabled}
        disabled={busy}
        onCheckedChange={(enabled) => onChange({ enabled })}
        label={t('settings.resourceFieldEnabledDefault')}
      />
    </>
  );
}

/** A hook's event, command, arguments, timeout, failure policy and state. */
export function HookResourceFields({ form, busy, fieldId, onChange }: KindFieldsProps) {
  const { t } = useI18n();
  return (
    <>
      <SettingsField label={t('settings.resourceFieldEvent')}>
        <Select
          dataTestId="settings-hook-event"
          ariaLabel={t('settings.resourceFieldEvent')}
          value={form.event}
          disabled={busy}
          onChange={(value) => onChange({ event: value })}
          options={enumOptions(
            CANONICAL_HOOK_EVENTS,
            form.event,
            (value) => hookEventLabel(value, t),
            t('settings.resourceEnumUnsupported'),
          )}
        />
      </SettingsField>
      <SettingsField
        className="settings-runtime-form-span"
        label={t('settings.resourceFieldCommand')}
        htmlFor={`${fieldId}-command`}
      >
        <Input
          id={`${fieldId}-command`}
          value={form.command}
          disabled={busy}
          onChange={(event) => onChange({ command: event.target.value })}
        />
      </SettingsField>
      <SettingsField
        className="settings-runtime-form-span"
        label={t('settings.resourceFieldArgsJson')}
        htmlFor={`${fieldId}-args`}
      >
        <Input
          id={`${fieldId}-args`}
          value={form.argsText}
          disabled={busy}
          onChange={(event) => onChange({ argsText: event.target.value })}
        />
      </SettingsField>
      <SettingsField label={t('settings.resourceFieldTimeout')} htmlFor={`${fieldId}-timeout`}>
        {/* Stored in milliseconds, edited in seconds. */}
        <Input
          id={`${fieldId}-timeout`}
          type="number"
          min={1}
          max={600}
          step={1}
          value={timeoutSeconds(form.timeoutMs)}
          disabled={busy}
          onChange={(event) =>
            onChange({ timeoutMs: event.target.value ? String(Math.round(Number(event.target.value) * 1000)) : '' })
          }
        />
      </SettingsField>
      <SettingsField label={t('settings.resourceFieldFailurePolicy')}>
        <div
          className="settings-choice-group"
          role="radiogroup"
          aria-label={t('settings.resourceFieldFailurePolicy')}
          data-testid="settings-hook-failure-policy"
        >
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
  );
}
