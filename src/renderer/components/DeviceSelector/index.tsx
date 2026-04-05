import React, { useEffect, useRef, useState } from 'react';
import { useDeviceStore } from '../../stores/deviceStore';
import type { ReplayDeviceEntry } from '@shared/types/device';
import './DeviceSelector.css';

const DeviceTypeIcon: React.FC<{ type: ReplayDeviceEntry['type'] }> = ({ type }) => {
  if (type === 'local') {
    return (
      <svg className="device-type-icon" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2H8zm0 1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
        <path d="M3 5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-2H9v1H4V7h1V5H3z" />
      </svg>
    );
  }

  return (
    <svg className="device-type-icon" viewBox="0 0 16 16" fill="currentColor">
      <rect x="4" y="1.5" width="8" height="13" rx="1.5" />
      <rect x="6" y="3.25" width="4" height="8" rx="0.75" fill="rgb(var(--color-bg-1))" />
    </svg>
  );
};

const StatusText: Record<ReplayDeviceEntry['status'], string> = {
  offline: 'Offline',
  loading: 'Loading',
  connected: 'Connected',
  online: 'Online',
};

function getBootstrapSummary(device: ReplayDeviceEntry): string | null {
  if (device.type !== 'android' || !device.bootstrap) {
    return null;
  }

  const summary: string[] = [];
  if (device.bootstrap.packageName) {
    summary.push(device.bootstrap.packageName);
  }
  if (device.bootstrap.installMode === 'force_replace') {
    summary.push('APK force replaced');
  } else if (device.bootstrap.installedApk) {
    summary.push('APK installed');
  } else if (device.bootstrap.packageName) {
    summary.push('APK verified');
  }
  if (device.bootstrap.abi) {
    summary.push(device.bootstrap.abi);
  }

  return summary.length > 0 ? summary.join(' · ') : null;
}

const DeviceStatusIcon: React.FC<{ device: ReplayDeviceEntry }> = ({ device }) => {
  if (device.status === 'online') {
    return <span className="device-status-icon online">✓</span>;
  }
  if (device.status === 'connected') {
    return <span className="device-status-icon connected">Connected</span>;
  }
  if (device.status === 'loading') {
    return <span className="device-status-icon loading" aria-hidden="true" />;
  }
  return <span className="device-status-icon offline">✕</span>;
};

export const DeviceSelector: React.FC = () => {
  const { devices, selectedDevice, setSelectedDevice, refreshDevices, activateDevice } = useDeviceStore();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedEntry = devices.find((device) => device.id === selectedDevice) ?? devices[0];
  const selectedSummary = selectedEntry?.type === 'local'
    ? 'Local Replay'
    : (selectedEntry?.label ?? 'No Device');

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggleOpen = () => {
    setIsOpen((open) => !open);
    if (!isOpen) {
      void refreshDevices();
    }
  };

  const handleSelect = async (device: ReplayDeviceEntry) => {
    if (device.type === 'local') {
      setSelectedDevice(device.id);
      setIsOpen(false);
      return;
    }

    if (device.status === 'offline') {
      const activated = await activateDevice(device.id);
      if (activated && (activated.status === 'connected' || activated.status === 'online')) {
        setSelectedDevice(activated.id);
        setIsOpen(false);
      }
      return;
    }

    if (device.status === 'loading') {
      return;
    }

    setSelectedDevice(device.id);
    setIsOpen(false);
  };

  return (
    <div className="device-selector-container" ref={dropdownRef}>
      <div className="device-selector-group">
        <button
          className="device-selector-trigger footer-entry"
          onClick={handleToggleOpen}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
        >
          <div className="device-selector-trigger-main">
            <span className={`device-selector-trigger-icon ${selectedEntry?.type === 'android' ? 'android' : 'local'}`}>
              <DeviceTypeIcon type={selectedEntry?.type ?? 'local'} />
            </span>
            <div className="device-selector-copy footer-entry-copy">
              <span className="device-selector-label footer-entry-label">Replay Device</span>
              <span className="device-selector-summary footer-entry-title">{selectedSummary}</span>
            </div>
          </div>
          <div className="device-selector-trigger-meta">
            <svg className={`device-selector-arrow footer-entry-chevron ${isOpen ? 'open' : ''}`} viewBox="0 0 12 12" fill="currentColor">
              <path d="M6 8L1 3h10l-5 5z" />
            </svg>
          </div>
        </button>

        {isOpen && (
          <div className="device-selector-dropdown" role="listbox">
            {devices.map((device) => {
              const selectable = device.type === 'local' || device.status === 'connected' || device.status === 'online';
              const bootstrapSummary = getBootstrapSummary(device);
              return (
                <button
                  key={device.id}
                  className={`device-selector-option ${device.id === selectedDevice ? 'selected' : ''}`}
                  onClick={() => void handleSelect(device)}
                  role="option"
                  aria-selected={device.id === selectedDevice}
                >
                  <div className="device-selector-option-main">
                    <div className="device-option-leading">
                      <DeviceTypeIcon type={device.type} />
                      <div className="device-option-copy">
                        <span className="device-option-name">{device.label}</span>
                        <span className="device-option-detail">{device.detailText ?? (device.type === 'local' ? 'Local replay ready' : 'Ready')}</span>
                      </div>
                    </div>
                    <div className="device-option-trailing">
                      <DeviceStatusIcon device={device} />
                      <span className={`device-option-status ${device.status}`}>{StatusText[device.status]}</span>
                    </div>
                  </div>
                  {device.serial && <div className="device-option-meta">{device.serial}</div>}
                  {bootstrapSummary && <div className="device-option-bootstrap">{bootstrapSummary}</div>}
                  {!selectable && device.lastError && <div className="device-option-error">{device.lastError}</div>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default DeviceSelector;
