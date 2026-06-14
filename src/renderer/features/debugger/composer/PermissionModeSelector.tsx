import React, { useState } from 'react';
import type { AgentPermissionMode } from '@shared/types/settings';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';

const PERMISSION_MODES: Array<{
  id: AgentPermissionMode;
  label: string;
  description: string;
}> = [
  {
    id: 'default',
    label: 'Default',
    description: 'Workspace routine actions run; external or risky actions ask first.',
  },
  {
    id: 'auto-review',
    label: 'Auto-review',
    description: 'Risky actions are reviewed by policy before they continue.',
  },
  {
    id: 'full-access',
    label: 'Full access',
    description: 'Trusted mode for direct local file and command access.',
  },
  {
    id: 'custom',
    label: 'Custom(config.toml)',
    description: 'Use configured roots and command allow or deny lists.',
  },
];

export const PermissionModeSelector: React.FC<{
  disabled?: boolean;
}> = ({ disabled = false }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const mode = useAppSettingsStore((state) => state.settings.agentRuntime?.permissions?.mode ?? 'default');
  const setMode = useAppSettingsStore((state) => state.setAgentPermissionMode);
  const current = PERMISSION_MODES.find((entry) => entry.id === mode) ?? PERMISSION_MODES[0];

  const selectMode = async (nextMode: AgentPermissionMode) => {
    if (nextMode === mode || busy) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await setMode(nextMode);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer-permission-menu">
      <button
        type="button"
        className={`composer-permission-pill ${open ? 'open' : ''}`}
        data-testid="composer-permission-pill"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || busy}
        title={current.description}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="composer-permission-pill-icon" aria-hidden="true">
          {mode === 'full-access' ? 'FA' : mode === 'auto-review' ? 'AR' : mode === 'custom' ? 'CU' : 'DF'}
        </span>
        <span className="composer-permission-pill-label">{current.label}</span>
        <span className="composer-permission-pill-caret" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {open ? (
        <div className="composer-permission-popup" role="menu">
          {PERMISSION_MODES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`composer-permission-menu-item ${entry.id === mode ? 'active' : ''}`}
              role="menuitemradio"
              aria-checked={entry.id === mode}
              disabled={busy}
              onClick={() => void selectMode(entry.id)}
            >
              <span className="composer-permission-menu-label">{entry.label}</span>
              <span className="composer-permission-menu-desc">{entry.description}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
