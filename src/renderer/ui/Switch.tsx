import type { InputHTMLAttributes } from 'react';
import './Switch.css';

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
}

/**
 * Design-system switch (track + thumb). Prefer over bare checkboxes for binary preferences.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  className = '',
  disabled,
  id,
  ...rest
}: SwitchProps) {
  const classes = ['ui-switch', className].filter(Boolean).join(' ');

  return (
    <label className={classes} data-checked={checked ? 'true' : 'false'}>
      <input
        {...rest}
        id={id}
        type="checkbox"
        role="switch"
        className="ui-switch-input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.currentTarget.checked)}
      />
      <span className="ui-switch-track" aria-hidden="true" />
      {label ? <span className="ui-switch-label">{label}</span> : null}
    </label>
  );
}
