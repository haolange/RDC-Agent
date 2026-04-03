import React from 'react';
import { useLayoutStore } from '../../stores/layoutStore';
import { AGENT_MODES } from '../../../shared/constants/agents';
import { useI18n } from '../../i18n';
import './ModeSelector.css';

export const ModeSelector: React.FC = () => {
  const { t } = useI18n();
  const currentMode = useLayoutStore((state) => state.currentMode);
  const setCurrentMode = useLayoutStore((state) => state.setCurrentMode);
  const activeIndex = Math.max(AGENT_MODES.findIndex((mode) => mode.id === currentMode), 0);

  return (
    <div className="mode-segmented" role="tablist" aria-label="Agent modes">
      <div
        className="mode-segmented-indicator"
        aria-hidden="true"
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
      />
      {AGENT_MODES.map((mode) => (
        <button
          key={mode.id}
          type="button"
          role="tab"
          aria-selected={currentMode === mode.id}
          className={`mode-segmented-item ${currentMode === mode.id ? 'active' : ''}`}
          onClick={() => setCurrentMode(mode.id)}
        >
          {t(`mode.${mode.id}`)}
        </button>
      ))}
    </div>
  );
};

export default ModeSelector;
