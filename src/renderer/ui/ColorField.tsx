import { useEffect, useId, useState } from 'react';
import { useDynStyle } from '../lib/useDynStyle';
import { ColorPickerSurface } from './ColorPickerSurface';
import { Popover } from './Popover';
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
  /** Accessible names for the picker surfaces. */
  areaLabel: string;
  hueLabel: string;
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
  areaLabel,
  hueLabel,
}: ColorFieldProps) {
  const labelId = useId();
  const [open, setOpen] = useState(false);
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
  const resolved = HEX_PATTERN.test(value) ? value.toLowerCase() : fallbackHex;

  return (
    <div className={classes}>
      <span id={labelId} className="settings-field-label color-field-label">{label}</span>
      <span className="color-field-control">
        <Popover
          open={open}
          onOpenChange={setOpen}
          align="start"
          className="color-field-popover"
          trigger={(
            <button
              type="button"
              className="color-field-swatch"
              {...swatchStyle}
              data-testid={`${testId}-swatch`}
              aria-labelledby={labelId}
            />
          )}
        >
          <ColorPickerSurface
            value={resolved}
            onChange={onChange}
            testId={testId}
            areaLabel={areaLabel}
            hueLabel={hueLabel}
          />
        </Popover>
        <input
          type="text"
          className="color-field-hex input"
          aria-labelledby={labelId}
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
    </div>
  );
}
