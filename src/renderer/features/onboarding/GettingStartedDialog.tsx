import { useState } from 'react';
import { useI18n } from '../../i18n';
import { TaskDialog } from '../../ui/TaskDialog';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { GuideIllustration } from './GuideIllustration';
import './GettingStartedDialog.css';

const steps = ['welcome', 'model', 'project', 'rdc'] as const;

/** Informational walkthrough. Business configuration remains in the existing workbench. */
export function GettingStartedDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const current = steps[step];
  return (
    <TaskDialog open title={t('onboarding.title')} description={t('onboarding.subtitle')}
      onClose={onClose} closeLabel={t('onboarding.close')} size="lg" className="getting-started"
      dataTestId="getting-started" footer={<>
        <Button onClick={() => setStep(step - 1)} disabled={step === 0}>{t('onboarding.previous')}</Button>
        <span className="getting-started-counter" aria-live="polite">{step + 1} / {steps.length}</span>
        <Button variant="primary" onClick={() => step === steps.length - 1 ? onClose() : setStep(step + 1)}>
          {t(step === steps.length - 1 ? 'onboarding.finish' : 'onboarding.next')}
        </Button>
      </>}>
      <nav className="getting-started-steps" aria-label={t('onboarding.steps')}>
        {steps.map((id, index) => <Button key={id} variant={index === step ? 'secondary' : 'ghost'}
          className={index === step ? 'is-selected' : ''} aria-current={index === step ? 'step' : undefined}
          onClick={() => setStep(index)}><span className="getting-started-step-number">{index + 1}</span>{t(`onboarding.${id}.title`)}</Button>)}
      </nav>
      <section key={current} className="getting-started-page" aria-labelledby={`getting-started-${current}`}>
        <div className="getting-started-copy">
          <p className="getting-started-eyebrow">{t(`onboarding.${current}.eyebrow`)}</p>
          <h3 id={`getting-started-${current}`}>{t(`onboarding.${current}.headline`)}</h3>
          <p className="getting-started-summary">{t(`onboarding.${current}.body`)}</p>
          <ol className="getting-started-instructions">
            {(['first', 'second', 'third'] as const).map((item, index) => <li key={item}>
              <span className="getting-started-instruction-number" aria-hidden="true">{index + 1}</span>
              <span>{t(`onboarding.${current}.${item}`)}</span>
            </li>)}
          </ol>
          {current === 'rdc' && <a className="getting-started-download" href="https://github.com/haolange/RDC-Tool/releases"
            target="_blank" rel="noreferrer">{t('onboarding.download')}<Icon name="external" size={14} /></a>}
          <div className="getting-started-outcome">
            <Icon name="check" size={18} />
            <div><strong>{t('onboarding.outcome')}</strong><p>{t(`onboarding.${current}.outcome`)}</p></div>
          </div>
        </div>
        <GuideIllustration step={current} />
      </section>
    </TaskDialog>
  );
}
