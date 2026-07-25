import { useEffect, useRef, useState } from 'react';
import { useDynStyle } from '../lib/useDynStyle';
import './ColorField.css';

export interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  testId: string;
  className?: string;
  fallbackHex?: string;
  /** `inline` = stacked label + compact chip (Agents look strip). Default = label | control grid (Appearance). */
  layout?: 'grid' | 'inline';
}

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function ColorField({
  label,
  value,
  onChange,
  testId,
  className = '',
  fallbackHex = '#33d1ff',
  layout = 'grid',
}: ColorFieldProps) {
  const colorInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commitHex = (raw: string) => {
    const next = raw.trim().toLowerCase();
    if (HEX_PATTERN.test(next)) onChange(next);
  };

  const classes = [
    'color-field',
    layout === 'inline' ? 'color-field--inline' : 'color-field--grid',
    className,
  ].filter(Boolean).join(' ');
  const swatchStyle = useDynStyle({ '--color-field-swatch-bg': value });

  return (
    <label className={classes}>
      <span className="settings-field-label color-field-label">{label}</span>
      <span className="color-field-control">
        <button
          type="button"
          className="color-field-swatch"
          {...swatchStyle}
          data-testid={`${testId}-swatch`}
          aria-label={label}
          onClick={() => colorInputRef.current?.click()}
        />
        <input
          ref={colorInputRef}
          type="color"
          className="color-field-native"
          value={HEX_PATTERN.test(value) ? value : fallbackHex}
          data-testid={testId}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
          tabIndex={-1}
          aria-hidden="true"
        />
        <input
          type="text"
          className="color-field-hex input"
          value={draft}
          spellCheck={false}
          data-testid={`${testId}-hex`}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            commitHex(next);
          }}
          onBlur={() => {
            if (!HEX_PATTERN.test(draft.trim())) setDraft(value);
          }}
        />
      </span>
    </label>
  );
}
