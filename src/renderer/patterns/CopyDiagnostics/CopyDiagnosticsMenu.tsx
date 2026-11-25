import { useState } from 'react';
import { useI18n } from '../../i18n';
import { useCopyFeedback } from '../../ui/CopyButton';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/IconButton';
import { Menu } from '../../ui/Menu';
import { useCopyDiagnostics, type DiagnosticFact } from './useCopyDiagnostics';

/** Object-level diagnostics live with the owner's secondary actions. */
export function CopyDiagnosticsMenu({ facts, label, testId }: {
  facts: readonly DiagnosticFact[];
  label?: string;
  testId?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { copied, copy } = useCopyFeedback(useCopyDiagnostics(facts));
  const triggerLabel = label ?? t('app.moreActions');
  return (
    <Menu open={open} onOpenChange={setOpen} align="end" label={triggerLabel}
      trigger={<IconButton size="sm" label={triggerLabel} aria-haspopup="menu"
        data-tooltip={copied ? t('app.copied') : triggerLabel} data-testid={testId && `${testId}-menu`}>
        <Icon name={copied ? 'check' : 'more'} size={16} />
      </IconButton>}
      items={[{ id: 'copy', testId, label: t('app.copyDiagnostics'), onSelect: () => void copy() }]}
    />
  );
}
