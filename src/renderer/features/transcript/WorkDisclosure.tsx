import React from 'react';

export const FadingPreview: React.FC<{ text: string }> = ({ text }) => {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = React.useState(false);
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setClipped(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);
  return <span ref={ref} className={`work-disclosure-preview${clipped ? ' is-clipped' : ''}`}>{text}</span>;
};

export const WorkDisclosure: React.FC<{
  title: string; preview?: string; open: boolean; onToggle: () => void;
  children: React.ReactNode; meta?: string; disabled?: boolean; variant?: 'section' | 'secondary-card' | 'inline';
  bodyClassName?: string;
}> = ({ title, preview = '', open, onToggle, children, meta, disabled, variant = 'section', bodyClassName }) => {
  const contentId = React.useId();
  const heading = <><span className="work-disclosure-label">{title}</span>
    {!open || disabled ? <FadingPreview text={preview} /> : <span className="work-disclosure-meta">{meta}</span>}
    {!disabled ? <span className={`work-process-row-caret${open ? ' is-open' : ''}`} aria-hidden="true" /> : null}</>;
  return <section className={`work-disclosure variant-${variant}${open ? ' is-open' : ''}`}>
    {disabled ? <div className="work-disclosure-header is-disabled">{heading}</div>
      : <button type="button" className="work-disclosure-header" aria-expanded={open}
        aria-controls={contentId} onClick={onToggle}>{heading}</button>}
    {open && !disabled ? <div id={contentId} className={`work-disclosure-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>{children}</div> : null}
  </section>;
};
