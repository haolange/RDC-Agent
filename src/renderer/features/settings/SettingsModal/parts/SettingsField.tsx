import type { ReactNode } from 'react';
import { cn } from '../../../../lib/cn';

export interface SettingsFieldProps {
  label: ReactNode;
  description?: ReactNode;
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
          <label className="settings-field-label" htmlFor={htmlFor}>{label}</label>
        ) : (
          <div className="settings-field-label">{label}</div>
        )}
        {description ? <p className="settings-help-text">{description}</p> : null}
      </div>
      <div className="settings-field-control">{children}</div>
    </div>
  );
}
