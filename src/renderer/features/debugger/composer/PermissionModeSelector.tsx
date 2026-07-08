import React, { useState } from 'react';
import type { AgentPermissionMode } from '@shared/types/settings';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';

const PERMISSION_MODES: Array<{
  id: AgentPermissionMode;
  label: string;
  labelZh: string;
  description: string;
  descriptionZh: string;
}> = [
  {
    id: 'default',
    label: 'Default',
    labelZh: '默认',
    description: 'Workspace routine actions run; external or risky actions ask first.',
    descriptionZh: '工作区常规操作直接执行，外部或高风险操作先询问',
  },
  {
    id: 'auto-review',
    label: 'Auto-review',
    labelZh: '自动审查',
    description: 'Risky actions are reviewed by policy before they continue.',
    descriptionZh: '低风险操作自动通过，高风险操作自动拦截',
  },
  {
    id: 'full-access',
    label: 'Full access',
    labelZh: '完全访问',
    description: 'Trusted mode for direct local file and command access.',
    descriptionZh: '信任模式，所有操作直接放行（类 Yolo）',
  },
  {
    id: 'custom',
    label: 'Custom',
    labelZh: '自定义',
    description: 'Use local access roots from the current app settings.',
    descriptionZh: '按当前应用设置里的访问根目录执行',
  },
];

export const PermissionModeSelector: React.FC = () => {
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
        disabled={busy}
        title={`当前模式：${current.labelZh}（${current.descriptionZh}）`}
        onClick={() => setOpen((value) => !value)}
      >
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
              <span className="composer-permission-menu-desc">{entry.descriptionZh}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
