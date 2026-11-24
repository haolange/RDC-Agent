import { Details } from '../../../../ui/Details';
import { Icon, type IconName } from '../../../../ui/Icon';
import type { ReactNode } from 'react';

interface LocalToolDisclosureProps {
  icon: IconName;
  title: string;
  description: string;
  status: string;
  testId: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

/**
 * Machine-local tool with its draft state visible while options are collapsed.
 */
export function LocalToolDisclosure({
  icon,
  title,
  description,
  status,
  testId,
  children,
  defaultOpen = false,
}: LocalToolDisclosureProps) {
  return (
    <Details className="settings-local-tool" data-testid={testId} open={defaultOpen} summaryClassName="settings-local-tool-summary" summary={<>
        <Icon name={icon} size={16} className="settings-local-tool-icon" />
        <span className="settings-local-tool-title">
          {title}
          <span className="settings-section-description">{description}</span>
        </span>
        <span className="settings-local-tool-status">{status}</span>
      </>}>
      <div className="settings-local-tool-body">{children}</div>
    </Details>
  );
}
