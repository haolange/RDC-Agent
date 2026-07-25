import React, { useEffect, useState } from 'react';
import { useDynStyle } from '../../../lib/useDynStyle';
import type { TerminalDrawerViewModel } from './useTerminalDrawer';

interface TerminalDrawerShellProps {
  vm: TerminalDrawerViewModel;
  toolbar: React.ReactNode;
  body: React.ReactNode;
}

export const TerminalDrawerShell: React.FC<TerminalDrawerShellProps> = ({
  vm,
  toolbar,
  body,
}) => {
  const {
    t,
    terminalHeight,
    isOpen,
    isResizing,
    titleContext,
    handleResizePointerDown,
    handleResizeDoubleClick,
    closeTerminal,
  } = vm;
  const [isVisuallyOpen, setIsVisuallyOpen] = useState(isOpen);

  useEffect(() => {
    if (!isOpen) {
      setIsVisuallyOpen(false);
      return undefined;
    }

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setIsVisuallyOpen(true));
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) {
        window.cancelAnimationFrame(secondFrame);
      }
    };
  }, [isOpen]);

  const terminalDynStyle = useDynStyle({
    '--runtime-terminal-height': `${terminalHeight}px`,
  });

  return (
    <section
      className={`runtime-terminal-workspace ${isVisuallyOpen ? 'open' : ''} ${isResizing ? 'resizing' : ''}`}
      data-testid="runtime-terminal"
      aria-hidden={!isOpen}
      {...terminalDynStyle}
    >
      <div
        className="runtime-terminal-resize-handle"
        data-testid="runtime-terminal-resize-handle"
        aria-hidden="true"
        onPointerDown={handleResizePointerDown}
        onDoubleClick={handleResizeDoubleClick}
      />

      <div className="runtime-terminal-titlebar">
        <div className="runtime-terminal-title-group">
          <div className="runtime-terminal-title">
            <span className="runtime-terminal-title-glyph activity" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span>{t('terminal.title')}</span>
          </div>
          <div className="runtime-terminal-subtitle">{titleContext}</div>
        </div>

        <button
          type="button"
          className="runtime-terminal-close-workspace"
          aria-label={t('terminal.close')}
          onClick={closeTerminal}
        >
          <span className="runtime-terminal-close-mark" aria-hidden="true" />
        </button>
      </div>

      {toolbar}

      <div className="runtime-terminal-workspace-body">
        {body}
      </div>
    </section>
  );
};
