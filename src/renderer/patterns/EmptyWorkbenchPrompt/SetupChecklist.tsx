import React from 'react';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import type { WorkbenchSetupStep } from '../../hooks/useWorkbenchSetup';
import './SetupChecklist.css';

/** The first-run checklist, drawn from live configuration; the first open step carries the primary action. */
export const SetupChecklist: React.FC<{ steps: WorkbenchSetupStep[] }> = ({ steps }) => {
  const { t } = useI18n();
  const done = steps.filter((step) => step.done).length;
  const activeId = steps.find((step) => !step.done)?.id;
  return (
    <section className="setup-checklist" aria-labelledby="setup-checklist-title" data-testid="setup-checklist">
      <h2 id="setup-checklist-title" className="setup-checklist-title">
        {t('setup.title', { done, total: steps.length })}
      </h2>
      <ol className="setup-checklist-steps">
        {steps.map((step, index) => {
          const state = step.done ? 'done' : step.id === activeId ? 'active' : 'pending';
          return (
            <li key={step.id} className="setup-checklist-step" data-state={state} data-testid={`setup-step-${step.id}`}>
              <span className="setup-checklist-index" aria-hidden="true">
                {step.done ? <Icon name="check" size={12} /> : index + 1}
              </span>
              <div className="setup-checklist-copy">
                <span className="setup-checklist-step-title">{t(`setup.${step.id}.${step.done ? 'doneTitle' : 'title'}`)}</span>
                <span className="setup-checklist-step-body">{t(`setup.${step.id}.${step.done ? 'doneBody' : 'body'}`)}</span>
                {!step.done ? (
                  <Button variant={state === 'active' ? 'primary' : 'secondary'} size="sm" onClick={step.act}>
                    {t(`setup.${step.id}.action`)}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
};
