import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../../../lib/cn';
import { Panel } from '../../../../ui/Panel';
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
    <Panel
      className={cn('settings-block', className)}
      header={<SectionHeader title={title} description={description} actions={actions} />}
      {...rest}
    >
      {children}
    </Panel>
  );
}
