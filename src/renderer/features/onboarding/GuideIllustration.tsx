import { useI18n } from '../../i18n';
import './GuideIllustration.css';

const illustrations = {
  welcome: new URL('./assets/welcome.png', import.meta.url).href,
  model: new URL('./assets/model.png', import.meta.url).href,
  project: new URL('./assets/project.png', import.meta.url).href,
  rdc: new URL('./assets/rdc.png', import.meta.url).href,
};

/** Local teaching artwork, never a projection of live configuration state. */
export function GuideIllustration({ step }: { step: keyof typeof illustrations }) {
  const { t } = useI18n();
  return <figure className={`guide-illustration is-${step}`}>
    <div className="guide-illustration-header">
      <span>{t('onboarding.example')}</span><span>{t('onboarding.notLive')}</span>
    </div>
    <div className="guide-illustration-stage">
      <img src={illustrations[step]} alt={t(`onboarding.${step}.alt`)} width={1536} height={1024} />
      {[1, 2, 3].map((number) => <span key={number} aria-hidden="true"
        className={`guide-illustration-pin is-pin-${number}`}>{number}</span>)}
    </div>
    <figcaption className="guide-illustration-legend">
      {(['first', 'second', 'third'] as const).map((item, index) => <div key={item}>
        <span className="guide-illustration-index" aria-hidden="true">0{index + 1}</span>
        <span>{t(`onboarding.${step}.${item}Label`)}</span>
      </div>)}
    </figcaption>
  </figure>;
}
