import { cn } from '../../../../lib/cn';
import { SectionHeader } from '../../../../ui/SectionHeader';
import type { HTMLAttributes, ReactNode } from 'react';

export interface SettingsSectionProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  variant?: 'rows';
  children: ReactNode;
}

export function SettingsSection({
  title,
  description,
  actions,
  variant,
  children,
  className,
  ...rest
}: SettingsSectionProps) {
  return (
    <div className={cn('settings-block', variant === 'rows' && 'is-rows', className)} {...rest}>
      <SectionHeader title={title} description={description} actions={actions} />
      <div className="settings-block-body">{children}</div>
    </div>
  );
}
