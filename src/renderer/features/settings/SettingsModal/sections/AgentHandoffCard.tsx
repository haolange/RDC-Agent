import React, { useState } from 'react';
import type { AgentHandoffDefinition, AgentManifestDefinition, AgentModelOption } from '@shared/types/agentManifest';
import type { TranslationKey, useI18n } from '../../../../i18n';
import { Checkbox } from '../../../../ui/Checkbox';
import { Icon } from '../../../../ui/Icon';
import { IconButton } from '../../../../ui/IconButton';
import { Input } from '../../../../ui/Input';
import { Select } from '../../../../ui/Select';
import { AutosizeTextarea } from '../AutosizeTextarea';
import { SettingsField } from '../parts';
import { AgentModelCascadeSelect } from './AgentModelCascadeSelect';
import {
  AGENT_HANDOFF_ISSUE_KEYS,
  IMMEDIATE_HANDOFF_ISSUE_CODES,
  persistAgentHandoff,
  type AgentHandoffIssue,
} from './agentHandoffValidation';

type Translate = ReturnType<typeof useI18n>['t'];
type Field = AgentHandoffIssue['field'];

interface AgentHandoffCardProps {
  index: number;
  handoff: AgentHandoffDefinition;
  issues: AgentHandoffIssue[];
  targets: AgentManifestDefinition[];
  modelOptions: AgentModelOption[];
  forceShowRequired: boolean;
  isFirst: boolean;
  isLast: boolean;
  expanded: boolean;
  t: Translate;
  onToggle: () => void;
  onChange: (handoff: AgentHandoffDefinition) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  labelRef: (node: HTMLInputElement | null) => void;
  deleteRef: (node: HTMLButtonElement | null) => void;
}

/** One handoff rule: a collapsible numbered card; only one card is expanded at a time. */
export const AgentHandoffCard: React.FC<AgentHandoffCardProps> = ({
  index,
  handoff,
  issues,
  targets,
  modelOptions,
  forceShowRequired,
  isFirst,
  isLast,
  expanded,
  t,
  onToggle,
  onChange,
  onMoveUp,
  onMoveDown,
  onDelete,
  labelRef,
  deleteRef,
}) => {
  const [touched, setTouched] = useState<Record<Field, boolean>>({
    label: false,
    agent: false,
    prompt: false,
    model: false,
  });
  const visible = (field: Field) => issues.filter((issue) => (
    issue.field === field
    && (forceShowRequired || IMMEDIATE_HANDOFF_ISSUE_CODES.has(issue.code) || touched[field])
  ));
  const patch = (partial: Partial<AgentHandoffDefinition>) => onChange(persistAgentHandoff({ ...handoff, ...partial }));
  const staleTarget = Boolean(handoff.agent) && !targets.some((agent) => agent.id === handoff.agent);
  const shown = issues.some((issue) => visible(issue.field).includes(issue));
  const errorId = (field: Field) => `settings-handoff-error-${field}-${index}`;
  const errorText = (issue: AgentHandoffIssue) => t(
    AGENT_HANDOFF_ISSUE_KEYS[issue.code] as TranslationKey,
    issue.code === 'target-unknown' || issue.code === 'target-disabled' || issue.code === 'model-invalid'
      ? { id: issue.field === 'model' ? (handoff.model ?? '') : handoff.agent }
      : undefined,
  );
  const renderErrors = (field: Field) => visible(field).map((issue) => (
    <small key={issue.code} id={errorId(field)} className="settings-handoff-error" role="alert">{errorText(issue)}</small>
  ));
  const targetName = targets.find((agent) => agent.id === handoff.agent)?.name || handoff.agent;
  const bodyId = `settings-handoff-body-${index}`;

  return (
    <article
      className={`settings-handoff-card${expanded ? ' is-expanded' : ''}`}
      data-testid={`settings-agent-handoff-card-${index}`}
      data-invalid={shown ? 'true' : undefined}
    >
      <div className="settings-handoff-card-head">
        <button
          type="button"
          className="settings-handoff-card-toggle"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <span className="settings-handoff-card-index">{index + 1}</span>
          <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} />
          <strong className="settings-handoff-card-title">
            {handoff.label.trim() || t('settings.agentHandoffUntitled')}
          </strong>
          {!expanded && targetName ? <small className="settings-handoff-card-target">→ {targetName}</small> : null}
          {shown ? <Icon name="warning" size={14} className="settings-handoff-card-warning" /> : null}
        </button>
        <div className="settings-handoff-card-actions">
          <IconButton label={t('settings.agentHandoffMoveUp')} size="sm" disabled={isFirst} onClick={onMoveUp}>
            <Icon name="arrow-up" size={14} />
          </IconButton>
          <IconButton label={t('settings.agentHandoffMoveDown')} size="sm" disabled={isLast} onClick={onMoveDown}>
            <Icon name="arrow-down" size={14} />
          </IconButton>
          <IconButton label={t('settings.delete')} size="sm" className="settings-handoff-delete" ref={deleteRef} onClick={onDelete}>
            <Icon name="trash" size={14} />
          </IconButton>
        </div>
      </div>

      <div id={bodyId} className="settings-handoff-card-body" hidden={!expanded}>
        <SettingsField label={t('settings.agentHandoffLabel')} layout="row">
          <Input
            ref={labelRef}
            value={handoff.label}
            placeholder={t('settings.agentHandoffLabelPlaceholder')}
            aria-invalid={visible('label').length > 0}
            aria-describedby={visible('label').length > 0 ? errorId('label') : undefined}
            onBlur={() => setTouched((current) => ({ ...current, label: true }))}
            onChange={(event) => patch({ label: event.currentTarget.value })}
          />
          {renderErrors('label')}
        </SettingsField>

        <SettingsField label={t('settings.agentHandoffTarget')} layout="row">
          <Select
            dataTestId={`settings-agent-handoff-target-${index}`}
            ariaLabel={t('settings.agentHandoffTarget')}
            value={handoff.agent}
            placeholder={t('settings.agentHandoffTargetPlaceholder')}
            onChange={(value) => {
              setTouched((current) => ({ ...current, agent: true }));
              patch({ agent: value });
            }}
            options={[
              ...(staleTarget ? [{ value: handoff.agent, label: `${handoff.agent} ${t('settings.resourceEnumUnsupported')}` }] : []),
              ...targets.map((agent) => ({ value: agent.id, label: agent.name })),
            ]}
          />
          {renderErrors('agent')}
        </SettingsField>

        <SettingsField label={t('settings.agentHandoffPrompt')} layout="row" className="settings-handoff-prompt">
          <AutosizeTextarea
            rows={3}
            maxHeight={220}
            className="input"
            value={handoff.prompt}
            placeholder={t('settings.agentHandoffPromptPlaceholder')}
            aria-invalid={visible('prompt').length > 0}
            aria-describedby={visible('prompt').length > 0 ? errorId('prompt') : undefined}
            onBlur={() => setTouched((current) => ({ ...current, prompt: true }))}
            onChange={(event) => patch({ prompt: event.currentTarget.value })}
          />
          {renderErrors('prompt')}
        </SettingsField>

        <SettingsField label={t('settings.agentHandoffModel')} layout="row">
          <AgentModelCascadeSelect
            value={handoff.model ?? ''}
            options={modelOptions}
            inherit={{
              label: targetName
                ? t('settings.agentHandoffModelInheritNamed', { name: targetName })
                : t('settings.agentHandoffModelInherit'),
              description: t('settings.agentHandoffModelInheritHint'),
            }}
            onChange={(model) => patch({ model: model || undefined })}
            t={t}
          />
          {renderErrors('model')}
        </SettingsField>

        <SettingsField label={t('settings.agentHandoffSend')} layout="row">
          <Checkbox
            checked={handoff.send === true}
            onCheckedChange={(checked) => patch({ send: checked || undefined })}
            label={t('settings.agentHandoffSendHelp')}
          />
        </SettingsField>
        <SettingsField label={t('settings.agentHandoffShowContinueOn')} layout="row">
          <Checkbox
            checked={handoff.showContinueOn === true}
            onCheckedChange={(checked) => patch({ showContinueOn: checked || undefined })}
            label={t('settings.agentHandoffShowContinueOnHelp')}
          />
        </SettingsField>
      </div>
    </article>
  );
};
