import { useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Button, type ButtonSize, type ButtonVariant } from './Button';
import { Chevron } from './Chevron';
import { Menu, type MenuItem } from './Menu';
import './SplitButton.css';

export interface SplitButtonProps {
  /** The one primary action, run by the main segment. */
  label: ReactNode;
  onClick: () => void;
  /** Secondary ways to do the same job (import, duplicate), behind the caret. */
  items: MenuItem[];
  menuLabel: string;
  variant?: Extract<ButtonVariant, 'primary' | 'secondary'>;
  size?: ButtonSize;
  disabled?: boolean;
  className?: string;
  dataTestId?: string;
}

export function SplitButton({
  label, onClick, items, menuLabel, variant = 'primary', size = 'sm', disabled = false, className, dataTestId,
}: SplitButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn('ui-split-button', `is-${variant}`, className)} data-testid={dataTestId}>
      <Button variant={variant} size={size} disabled={disabled} className="ui-split-button-main" onClick={onClick}>{label}</Button>
      <Menu open={open} onOpenChange={setOpen} label={menuLabel} align="end" items={items}
        trigger={(
          <Button variant={variant} size={size} disabled={disabled} className="ui-split-button-caret"
            aria-label={menuLabel} aria-haspopup="menu">
            <Chevron direction="down" />
          </Button>
        )} />
    </div>
  );
}
