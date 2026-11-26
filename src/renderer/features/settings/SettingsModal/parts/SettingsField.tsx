import { cn } from '../../../../lib/cn';
import type { ReactNode } from 'react';

export interface SettingsFieldProps {
  label: ReactNode;
  /** One sentence on what the field changes, in secondary body text under the label. */
  description?: ReactNode;
  /** A risk the user must see before changing the field (full access, deleting data…). */
  warning?: ReactNode;
  htmlFor?: string;
  search?: string;
  testId?: string;
  layout?: 'stack' | 'row';
  children: ReactNode;
  className?: string;
}

export function SettingsField({
  label,
  description,
  warning,
  htmlFor,
  search,
  testId,
  layout = 'stack',
  children,
  className,
}: SettingsFieldProps) {
  return (
    <div
      className={cn('settings-field', layout === 'row' && 'is-row', className)}
      data-settings-search={search}
      data-testid={testId}
    >
      <div className="settings-field-copy">
        {htmlFor ? (
          <label className="settings-field-label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <div className="settings-field-label">{label}</div>
        )}
        {description ? <p className="settings-field-description">{description}</p> : null}
        {warning ? <p className="settings-field-warning">{warning}</p> : null}
      </div>
      <div className="settings-field-control">{children}</div>
    </div>
  );
}
