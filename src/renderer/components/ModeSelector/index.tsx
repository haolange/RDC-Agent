import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLayoutStore } from '../../stores/layoutStore';
import { AGENT_MODES } from '../../../shared/constants/agents';
import type { AgentMode } from '../../../shared/types/layout';
import './ModeSelector.css';

const ModeIcons: Record<string, React.ReactNode> = {
  bug: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <path d="M21 12c0 4.418-4.03 8-9 8s-9-3.582-9-8" />
      <path d="M3 12h18" />
      <path d="M12 2v18" />
      <circle cx="9" cy="10" r="1" fill="currentColor" />
      <circle cx="15" cy="10" r="1" fill="currentColor" />
    </svg>
  ),
  chart: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </svg>
  ),
  zap: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
};

interface DropdownPosition {
  left: number;
  bottom: number;
  width: number;
}

export const ModeSelector: React.FC = () => {
  const { currentMode, setCurrentMode } = useLayoutStore();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const currentModeConfig = AGENT_MODES.find((mode) => mode.id === currentMode);

  useEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      setPosition({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 8,
        width: Math.max(rect.width, 240),
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener('mousedown', handlePointerDown);
    }

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleModeSelect = (modeId: AgentMode, disabled: boolean) => {
    if (disabled) return;
    setCurrentMode(modeId);
    setIsOpen(false);
  };

  const dropdown = isOpen && position
    ? createPortal(
      <div
        ref={menuRef}
        className="mode-selector-dropdown mode-selector-dropdown-portal"
        role="listbox"
        style={{
          left: position.left,
          bottom: position.bottom,
          minWidth: position.width,
        }}
      >
        <div className="mode-selector-dropdown-inner">
          {AGENT_MODES.map((mode) => (
            <button
              key={mode.id}
              className={`mode-selector-item ${mode.disabled ? 'disabled' : ''} ${currentMode === mode.id ? 'active' : ''}`}
              onClick={() => handleModeSelect(mode.id, mode.disabled)}
              disabled={mode.disabled}
              role="option"
              aria-selected={currentMode === mode.id}
            >
              <span className="mode-item-icon">{ModeIcons[mode.icon]}</span>
              <span className="mode-item-content">
                <span className="mode-item-label">{mode.label}</span>
                <span className="mode-item-description">{mode.description}</span>
              </span>
              {mode.disabled && <span className="mode-item-badge">Coming Soon</span>}
            </button>
          ))}
        </div>
      </div>,
      document.body,
    )
    : null;

  return (
    <>
      <div className="mode-selector" ref={triggerRef}>
        <button
          className="mode-selector-trigger"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
        >
          <span className="mode-selector-icon">
            {currentModeConfig && ModeIcons[currentModeConfig.icon]}
          </span>
          <span className="mode-selector-label">{currentModeConfig?.label || 'Debugger'}</span>
          <span className={`mode-selector-arrow ${isOpen ? 'open' : ''}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </span>
        </button>
      </div>
      {dropdown}
    </>
  );
};

export default ModeSelector;
