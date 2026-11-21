import { cn } from '../../../../lib/cn';
import { HelpTip } from '../../../../ui/HelpTip';
import type { ReactNode } from 'react';

export interface SettingsFieldProps {
  label: ReactNode;
  /** What the field means; shown behind the help tip beside the label, never as a line under it. */
  help?: ReactNode;
  /**
   * A risk the user must see before changing the field (full access, deleting data…). The only explanation that stays
   * on the page; settings keep at most a handful of these.
   */
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
  help,
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
        <div className="settings-field-label-row">{htmlFor ? (
          <label className="settings-field-label" htmlFor={htmlFor}>{label}</label>
        ) : (
          <div className="settings-field-label">{label}</div>
        )}
        {help ? <HelpTip label={typeof label === 'string' ? label : ''}>{help}</HelpTip> : null}
        </div>
        {warning ? <p className="settings-field-warning">{warning}</p> : null}
      </div>
      <div className="settings-field-control">{children}</div>
    </div>
  );
}
