import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../../../lib/cn';
import { SectionHeader } from '../../../../ui/SectionHeader';

export interface SettingsSectionProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function SettingsSection({
  title,
  description,
  actions,
  children,
  className,
  ...rest
}: SettingsSectionProps) {
  return (
    <div className={cn('settings-block', className)} {...rest}>
      <SectionHeader title={title} description={description} actions={actions} />
      <div className="settings-block-body">{children}</div>
    </div>
  );
}
