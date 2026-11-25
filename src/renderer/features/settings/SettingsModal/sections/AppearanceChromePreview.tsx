import { useMemo } from 'react';
import { compileThemeChrome } from '@shared/theme/compiler';
import { useDynStyle } from '../../../../lib/useDynStyle';
import { useI18n } from '../../../../i18n';
import type { ThemeChromeConfig, ThemeVariant } from '@shared/types/settings';

function useChromeVars(chrome: ThemeChromeConfig, variant: ThemeVariant) {
  const palette = useMemo(() => compileThemeChrome(chrome, variant), [chrome, variant]);
  return useDynStyle({
    '--ap-surface': `rgb(${palette['--color-bg-2']})`,
    '--ap-sidebar': `rgb(${palette['--color-bg-1']})`,
    '--ap-ink': `rgb(${palette['--color-text-primary']})`,
    '--ap-secondary': `rgb(${palette['--color-text-secondary']})`,
    '--ap-accent': `rgb(${palette['--color-accent-ink']})`,
    '--ap-on-accent': `rgb(${palette['--color-text-on-accent']})`,
    '--font-sans': palette['--font-sans'] ?? 'var(--font-sans-default)',
    '--font-mono': palette['--font-mono'] ?? 'var(--font-mono-default)',
  });
}

export function AppearanceChromePreview(props: {
  chrome: ThemeChromeConfig;
  variant: ThemeVariant;
  'data-testid': string;
  description?: string;
}) {
  const { t } = useI18n();
  const chromeStyle = useChromeVars(props.chrome, props.variant);
  return (
    <span
      className="appearance-preview-pane"
      {...chromeStyle}
      data-testid={props['data-testid']}
      role={props.description ? 'img' : undefined}
      aria-label={props.description}
      aria-hidden={props.description ? undefined : true}
    >
      <span className="appearance-preview-side">
        <span>{t('settings.general')}</span>
        <span className="appearance-preview-nav">{t('settings.appearance')}</span>
      </span>
      <span className="appearance-preview-main">
        <strong>{t('settings.appearanceCodeFont')}</strong>
        <code>float4 color;</code>
        <span className="appearance-preview-cta">{t('settings.edit')}</span>
      </span>
    </span>
  );
}
