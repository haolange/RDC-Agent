import type { ReactNode } from 'react';
import { cn } from '../../../../lib/cn';
import { HelpTip } from '../../../../ui/HelpTip';

export interface SettingsFieldProps {
  label: ReactNode;
  description?: ReactNode;
  help?: string;
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
  help,
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
        <div className="settings-field-label-row">{htmlFor ? (
          <label className="settings-field-label" htmlFor={htmlFor}>{label}</label>
        ) : (
          <div className="settings-field-label">{label}</div>
        )}
        {help ? <HelpTip label={typeof label === 'string' ? label : help}>{help}</HelpTip> : null}
        </div>
        {description ? <p className="settings-help-text">{description}</p> : null}
      </div>
      <div className="settings-field-control">{children}</div>
    </div>
  );
}
