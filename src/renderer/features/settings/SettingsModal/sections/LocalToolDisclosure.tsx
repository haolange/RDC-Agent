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
    <details className="settings-local-tool" data-testid={testId} open={defaultOpen}>
      <summary className="settings-local-tool-summary">
        <Icon name={icon} size={16} className="settings-local-tool-icon" />
        <span className="settings-local-tool-copy">
          <span className="settings-local-tool-title">{title}</span>
          <span className="settings-local-tool-description">{description}</span>
        </span>
        <Icon name="chevron-down" size={14} className="settings-local-tool-caret" />
      </summary>
      <div className="settings-local-tool-body">{children}</div>
    </details>
  );
}
