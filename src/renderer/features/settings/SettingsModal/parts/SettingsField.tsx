import { cn } from '../../../../lib/cn';
import type { ReactNode } from 'react';

export interface SettingsFieldCopyProps {
  label: ReactNode;
  /** One sentence on what the field changes, in secondary body text under the label. */
  description?: ReactNode;
  /** A risk the user must see before changing the field (full access, deleting data…). */
  warning?: ReactNode;
  htmlFor?: string;
  /** Lets a group of controls that is not one labelable element name itself after this label. */
  labelId?: string;
}

/** A field's label, description and warning; layouts that place several controls per field compose it directly. */
export function SettingsFieldCopy({ label, description, warning, htmlFor, labelId }: SettingsFieldCopyProps) {
  return (
    <div className="settings-field-copy">
      {htmlFor ? (
        <label id={labelId} className="settings-field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <div id={labelId} className="settings-field-label">
          {label}
        </div>
      )}
      {description ? <p className="settings-field-description">{description}</p> : null}
      {warning ? <p className="settings-field-warning">{warning}</p> : null}
    </div>
  );
}

export interface SettingsFieldProps extends Omit<SettingsFieldCopyProps, 'labelId'> {
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
      <SettingsFieldCopy label={label} description={description} warning={warning} htmlFor={htmlFor} />
      <div className="settings-field-control">{children}</div>
    </div>
  );
}
