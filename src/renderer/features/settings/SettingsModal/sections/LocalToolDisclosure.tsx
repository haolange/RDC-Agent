import { Details } from '../../../../ui/Details';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../../../ui/Icon';

interface LocalToolDisclosureProps {
  icon: IconName;
  title: string;
  description: string;
  testId: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

/**
 * Compact summary row for a machine-local tool. Collapsed by default so the
 * Tools page reads as a short list instead of three stacked forms.
 */
export function LocalToolDisclosure({
  icon,
  title,
  description,
  testId,
  children,
  defaultOpen = false,
}: LocalToolDisclosureProps) {
  return (
    <Details className="settings-local-tool" data-testid={testId} open={defaultOpen} summaryClassName="settings-local-tool-summary" summary={<>
        <Icon name={icon} size={16} className="settings-local-tool-icon" />
        <span className="settings-local-tool-copy">
          <span className="settings-local-tool-title">{title}</span>
          <span className="settings-local-tool-description">{description}</span>
        </span>

       </>}>
      <div className="settings-local-tool-body">{children}</div>
    </Details>
  );
}
