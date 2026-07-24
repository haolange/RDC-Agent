import React from 'react';
import DropdownSelect from '../../../../ui/DropdownSelect';
import type { SessionContextPanelViewModel } from './useSessionContextPanel';

interface SessionContextQuickEntryProps {
  vm: SessionContextPanelViewModel;
}

export const SessionContextQuickEntry: React.FC<SessionContextQuickEntryProps> = ({ vm }) => {
  const {
    t,
    projectInputs,
    captureOptions,
    selectedInputId,
    setSelectedInputId,
    openingId,
    currentRun,
    handleOpen,
    replayDeviceSummary,
    selectedDeviceEntry,
  } = vm;

  if (projectInputs.length === 0) {
    return <div className="panel-empty">{t('control.sessionContextNoCapture')}</div>;
  }

  const isLocalDevice = selectedDeviceEntry?.type !== 'android';

  return (
    <div className="session-context-quick-entry-body">
      <div className="session-context-device-row" data-testid="session-context-replay-device">
        <span className="session-context-label">{t('control.sessionContextDevice')}</span>
        <span className="session-context-device-value">{replayDeviceSummary}</span>
      </div>
      {isLocalDevice ? (
        <div className="session-context-device-hint" role="note">
          {t('control.sessionContextAndroidCaptureHint')}
        </div>
      ) : null}
      <div className="session-context-picker-row">
        <DropdownSelect
          value={selectedInputId}
          options={captureOptions}
          onChange={setSelectedInputId}
          placeholder={t('control.sessionContextPickerPlaceholder')}
          emptyLabel={t('control.sessionContextNoCapture')}
          dataTestId="session-context-capture-select"
          ariaLabel={t('control.sessionContextPickerLabel')}
          className="session-context-capture-select"
          triggerClassName="session-context-capture-select-trigger"
          menuClassName="session-context-capture-select-menu"
          optionClassName="session-context-capture-select-option"
        />
        <button
          type="button"
          className="panel-action-btn session-context-open-btn"
          data-testid="session-context-open-selected"
          onClick={() => void handleOpen(selectedInputId)}
          disabled={!selectedInputId || Boolean(currentRun) || openingId === selectedInputId}
        >
          <span>{openingId === selectedInputId ? t('control.captureOpening') : t('control.captureOpen')}</span>
        </button>
      </div>
    </div>
  );
};
