import type { UiPreferences } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];
type Expansion = UiPreferences['workProcessExpansion'];

const OPTIONS: Array<{ id: Expansion; label: 'settings.workProcessExpansionLatest' | 'settings.workProcessExpansionAll';
  hint: 'settings.workProcessExpansionLatestHint' | 'settings.workProcessExpansionAllHint' }> = [
  { id: 'latest', label: 'settings.workProcessExpansionLatest', hint: 'settings.workProcessExpansionLatestHint' },
  { id: 'all', label: 'settings.workProcessExpansionAll', hint: 'settings.workProcessExpansionAllHint' },
];

/** A thumbnail of each mode: a short window that keeps the newest steps, or every step laid out. */
function ExpansionThumbnail({ mode }: { mode: Expansion }) {
  const steps = mode === 'latest' ? 3 : 6;
  return (
    <span className={`work-process-expansion-thumb is-${mode}`} aria-hidden="true">
      {Array.from({ length: steps }, (_, index) => <span key={index} className="work-process-expansion-thumb-step" />)}
    </span>
  );
}

/** Two preview cards instead of a segmented control and a paragraph: the picture says what each mode does. */
export function WorkProcessExpansionPicker({ value, onChange, t }: {
  value: Expansion;
  onChange: (value: Expansion) => void;
  t: Translate;
}) {
  return (
    <div className="work-process-expansion-picker" role="radiogroup" aria-label={t('settings.workProcessExpansion')}>
      {OPTIONS.map((option) => (
        <button key={option.id} type="button" role="radio" aria-checked={value === option.id}
          className={`work-process-expansion-card${value === option.id ? ' is-selected' : ''}`}
          data-tooltip={t(option.hint)} onClick={() => onChange(option.id)}>
          <ExpansionThumbnail mode={option.id} />
          <span className="work-process-expansion-label">{t(option.label)}</span>
        </button>
      ))}
    </div>
  );
}
