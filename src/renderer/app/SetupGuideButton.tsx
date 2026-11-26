import { useState } from 'react';
import { useWorkbenchSetup } from '../hooks/useWorkbenchSetup';
import { useI18n } from '../i18n';
import { SetupChecklist } from '../patterns/SetupChecklist';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import './SetupGuideButton.css';
import { PlainButton } from '../ui/PlainButton';

/**
 * The title-bar「?」reopens the first-run checklist at any time. It reads the same live configuration as the empty
 * workbench, so it shows what is still missing (or that everything is ready); a step's action closes it first.
 */
export function SetupGuideButton() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const steps = useWorkbenchSetup().map((step) => ({
    ...step,
    act: () => {
      setOpen(false);
      step.act();
    },
  }));
  const label = t('setup.reopen');
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="setup-guide-popover"
      trigger={
        <PlainButton
          className={`main-utility-toggle${open ? ' is-active' : ''}`}
          data-testid="titlebar-setup-guide"
          aria-label={label}
          data-tooltip={label}
        >
          <Icon name="help" />
        </PlainButton>
      }
    >
      <SetupChecklist steps={steps} />
    </Popover>
  );
}
