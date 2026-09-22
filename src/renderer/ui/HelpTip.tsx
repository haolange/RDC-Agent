import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Popover } from './Popover';
import './HelpTip.css';

export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const enter = () => { clearTimeout(timer.current); setOpen(true); };
  const leave = () => { timer.current = setTimeout(() => setOpen(false), 150); };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Popover open={open} onOpenChange={setOpen} className="ui-help-tip" trigger={
      <Button variant="ghost" size="sm" className="ui-help-tip-trigger" aria-label={label}
        aria-describedby={open ? id : undefined} onMouseEnter={enter} onMouseLeave={leave}
        onFocus={enter} onBlur={() => setOpen(false)}
        onClick={(event) => { event.preventDefault(); enter(); }}>
        <span aria-hidden="true">ⓘ</span>
      </Button>
    }>
      <div id={id} onMouseEnter={enter} onMouseLeave={leave}>{children}</div>
    </Popover>
  );
}
