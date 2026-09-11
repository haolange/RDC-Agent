import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Icon } from './Icon';
import './Checkbox.css';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  trailing?: ReactNode;
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  trailing,
  className,
  disabled,
  id,
  ...rest
}: CheckboxProps) {
  return (
    <label className={cn('ui-checkbox', disabled && 'is-disabled', className)}>
      <input
        {...rest}
        id={id}
        type="checkbox"
        className="ui-checkbox-input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.currentTarget.checked)}
      />
      <span className="ui-checkbox-box" aria-hidden="true">
        {checked ? <Icon name="check" size={12} /> : null}
      </span>
      {label ? <span className="ui-checkbox-label">{label}</span> : null}
      {trailing ? <span className="ui-checkbox-trailing">{trailing}</span> : null}
    </label>
  );
}
