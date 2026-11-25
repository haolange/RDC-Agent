import React from 'react';
import { useI18n } from '../i18n';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import type { WorkbenchSetupStep } from '../hooks/useWorkbenchSetup';
import './SetupChecklist.css';

/**
 * The first-run checklist, drawn from live configuration. Finished steps fold into one checked line; the first open
 * step explains itself and carries the primary action, later open steps show their title and their own action.
 */
export const SetupChecklist: React.FC<{ steps: WorkbenchSetupStep[] }> = ({ steps }) => {
  const { t } = useI18n();
  const done = steps.filter((step) => step.done);
  const activeId = steps.find((step) => !step.done)?.id;
  return (
    <section className="setup-checklist" aria-labelledby="setup-checklist-title" data-testid="setup-checklist">
      <h2 id="setup-checklist-title" className="setup-checklist-title">
        {t('setup.title', { done: done.length, total: steps.length })}
      </h2>
      {done.length > 0 ? (
        <p className="setup-checklist-done" data-testid="setup-checklist-done">
          <Icon name="check" size={14} />
          {done.map((step) => (
            <span key={step.id} className="setup-checklist-done-item" data-state="done" data-testid={`setup-step-${step.id}`}>
              {t(`setup.${step.id}.doneTitle`)}
            </span>
          ))}
        </p>
      ) : null}
      <ol className="setup-checklist-steps">
        {steps.map((step, index) => {
          if (step.done) return null;
          const state = step.id === activeId ? 'active' : 'pending';
          return (
            <li key={step.id} className="setup-checklist-step" data-state={state} data-testid={`setup-step-${step.id}`}>
              <span className="setup-checklist-index" aria-hidden="true">{index + 1}</span>
              <div className="setup-checklist-copy">
                <span className="setup-checklist-step-title">{t(`setup.${step.id}.title`)}</span>
                {state === 'active' ? <span className="setup-checklist-step-body">{t(`setup.${step.id}.body`)}</span> : null}
                <Button variant={state === 'active' ? 'primary' : 'secondary'} size="sm" onClick={step.act}>
                  {t(`setup.${step.id}.action`)}
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
};
