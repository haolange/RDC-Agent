import React, { useState } from 'react';
import type { AgentHandoffDefinition, AgentManifestDefinition, AgentModelOption } from '@shared/types/agentManifest';
import type { TranslationKey, useI18n } from '../../../../i18n';
import { Button } from '../../../../ui/Button';
import { AutosizeTextarea } from '../AutosizeTextarea';
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
  t: Translate;
  onChange: (handoff: AgentHandoffDefinition) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  labelRef: (node: HTMLInputElement | null) => void;
  deleteRef: (node: HTMLButtonElement | null) => void;
}

export const AgentHandoffCard: React.FC<AgentHandoffCardProps> = ({
  index,
  handoff,
  issues,
  targets,
  modelOptions,
  forceShowRequired,
  isFirst,
  isLast,
  t,
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

  return (
    <article
      className="settings-handoff-card"
      data-testid={`settings-agent-handoff-card-${index}`}
      data-invalid={shown ? 'true' : undefined}
    >
      <div className="settings-handoff-card-head">
        <strong className="settings-handoff-card-title">
          {handoff.label.trim() || t('settings.agentHandoffUntitled')}
        </strong>
        <div className="settings-handoff-card-actions">
          <Button variant="ghost" aria-label={t('settings.agentHandoffMoveUp')} disabled={isFirst} onClick={onMoveUp}>↑</Button>
          <Button variant="ghost" aria-label={t('settings.agentHandoffMoveDown')} disabled={isLast} onClick={onMoveDown}>↓</Button>
          <Button variant="danger" ref={deleteRef} onClick={onDelete}>{t('settings.delete')}</Button>
        </div>
      </div>

      <div className="settings-handoff-grid">
        <label className="settings-input-row">
          <span className="settings-field-label">{t('settings.agentHandoffLabel')}</span>
          <input
            ref={labelRef}
            className="input"
            value={handoff.label}
            placeholder={t('settings.agentHandoffLabelPlaceholder')}
            aria-invalid={visible('label').length > 0}
            aria-describedby={visible('label').length > 0 ? errorId('label') : undefined}
            onBlur={() => setTouched((current) => ({ ...current, label: true }))}
            onChange={(event) => patch({ label: event.currentTarget.value })}
          />
          {visible('label').map((issue) => (
            <small key={issue.code} id={errorId('label')} className="settings-handoff-error" role="alert">{errorText(issue)}</small>
          ))}
        </label>

        <label className="settings-input-row">
          <span className="settings-field-label">{t('settings.agentHandoffTarget')}</span>
          <select
            className="input settings-handoff-target-select"
            data-testid={`settings-agent-handoff-target-${index}`}
            value={handoff.agent}
            aria-invalid={visible('agent').length > 0}
            aria-describedby={visible('agent').length > 0 ? errorId('agent') : undefined}
            onBlur={() => setTouched((current) => ({ ...current, agent: true }))}
            onChange={(event) => patch({ agent: event.currentTarget.value })}
          >
            {handoff.agent === '' ? (
              <option value="" disabled hidden>{t('settings.agentHandoffTargetPlaceholder')}</option>
            ) : null}
            {staleTarget ? <option value={handoff.agent}>{handoff.agent}</option> : null}
            {targets.map((agent) => (
              <option key={agent.id} value={agent.id} title={`${agent.name} · ${agent.id}`}>{agent.name}</option>
            ))}
          </select>
          {visible('agent').map((issue) => (
            <small key={issue.code} id={errorId('agent')} className="settings-handoff-error" role="alert">{errorText(issue)}</small>
          ))}
        </label>

        <label className="settings-input-row settings-handoff-prompt">
          <span className="settings-field-label">{t('settings.agentHandoffPrompt')}</span>
          <AutosizeTextarea
            rows={2}
            maxHeight={220}
            className="input"
            value={handoff.prompt}
            placeholder={t('settings.agentHandoffPromptPlaceholder')}
            aria-invalid={visible('prompt').length > 0}
            aria-describedby={visible('prompt').length > 0 ? errorId('prompt') : undefined}
            onBlur={() => setTouched((current) => ({ ...current, prompt: true }))}
            onChange={(event) => patch({ prompt: event.currentTarget.value })}
          />
          {visible('prompt').map((issue) => (
            <small key={issue.code} id={errorId('prompt')} className="settings-handoff-error" role="alert">{errorText(issue)}</small>
          ))}
        </label>
      </div>

      <div className="settings-handoff-model">
        <span className="settings-field-label">{t('settings.agentHandoffModel')}</span>
        <div className="settings-handoff-model-row">
          <AgentModelCascadeSelect
            value={handoff.model ?? ''}
            options={modelOptions}
            onChange={(model) => patch({ model })}
            t={t}
          />
          <Button
            variant="ghost"
            disabled={!handoff.model}
            onClick={() => patch({ model: undefined })}
          >
            {t('settings.agentHandoffModelInherit')}
          </Button>
        </div>
        {visible('model').map((issue) => (
          <small key={issue.code} id={errorId('model')} className="settings-handoff-error" role="alert">{errorText(issue)}</small>
        ))}
      </div>

      <div className="settings-handoff-flags">
        <div className="settings-handoff-flag">
          <label className="settings-checkbox-row compact">
            <input type="checkbox" checked={handoff.send === true} onChange={(event) => patch({ send: event.currentTarget.checked || undefined })} />
            <span>{t('settings.agentHandoffSend')}</span>
          </label>
          <p className="settings-help-text">{t('settings.agentHandoffSendHelp')}</p>
        </div>
        <div className="settings-handoff-flag">
          <label className="settings-checkbox-row compact">
            <input type="checkbox" checked={handoff.showContinueOn === true} onChange={(event) => patch({ showContinueOn: event.currentTarget.checked || undefined })} />
            <span>{t('settings.agentHandoffShowContinueOn')}</span>
          </label>
          <p className="settings-help-text">{t('settings.agentHandoffShowContinueOnHelp')}</p>
        </div>
      </div>
    </article>
  );
};
