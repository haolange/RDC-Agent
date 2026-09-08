import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDeviceStore } from '../../../stores/deviceStore';
import type { ReplayDeviceEntry } from '@shared/types/device';
import { useI18n } from '../../../i18n';
import { useDynStyle } from '../../../lib/useDynStyle';
import {
  DeviceStatusIcon,
  DeviceTypeIcon,
  getBootstrapSummary,
  STATUS_TEXT_KEYS,
  type DeviceSelectorVariant,
} from './DeviceSelectorParts';
import {
  useDeviceDropdownPosition,
  type DeviceDropdownPosition,
} from './useDeviceDropdownPosition';
import './DeviceSelector.css';

interface DeviceSelectorProps {
  variant?: DeviceSelectorVariant;
  collapsed?: boolean;
}

const DeviceSelectorDropdown: React.FC<{
  menuRef: React.Ref<HTMLDivElement>;
  variant: DeviceSelectorVariant;
  collapsed: boolean;
  dropdownTestId: string;
  dropdownPosition: DeviceDropdownPosition;
  devices: ReplayDeviceEntry[];
  selectedDevice: string;
  onSelect: (device: ReplayDeviceEntry) => void;
}> = ({
  menuRef,
  variant,
  collapsed,
  dropdownTestId,
  dropdownPosition,
  devices,
  selectedDevice,
  onSelect,
}) => {
  const { t } = useI18n();
  const dynStyle = useDynStyle({
    left: `${dropdownPosition.left}px`,
    top: `${dropdownPosition.top}px`,
    width: `${dropdownPosition.width}px`,
    visibility: dropdownPosition.ready ? 'visible' : 'hidden',
  });

  return (
    <div
      ref={menuRef}
      className={`device-selector-dropdown variant-${variant} placement-${dropdownPosition.placement} ${collapsed ? 'collapsed' : ''}`}
      data-testid={dropdownTestId}
      role="listbox"
      {...dynStyle}
    >
      {devices.map((device) => {
        const selectable = device.type === 'local' || device.status === 'connected' || device.status === 'online';
        const bootstrapSummary = getBootstrapSummary(device, t);
        return (
          <button
            key={device.id}
            className={`device-selector-option ${device.id === selectedDevice ? 'is-selected' : ''}`}
            onClick={() => onSelect(device)}
            role="option"
            aria-selected={device.id === selectedDevice}
          >
            <div className="device-selector-option-main">
              <div className="device-option-leading">
                <DeviceTypeIcon type={device.type} />
                <div className="device-option-copy">
                  <span className="device-option-name">{device.label}</span>
                  <span className="device-option-detail">{device.detailText ?? (device.type === 'local' ? t('device.localReplayReady') : t('device.ready'))}</span>
                </div>
              </div>
              <div className="device-option-trailing">
                <DeviceStatusIcon device={device} connectedLabel={t('device.status.connected')} />
                <span className={`device-option-status ${device.status}`}>{t(STATUS_TEXT_KEYS[device.status])}</span>
              </div>
            </div>
            {device.serial && <div className="device-option-meta">{device.serial}</div>}
            {bootstrapSummary && <div className="device-option-bootstrap">{bootstrapSummary}</div>}
            {!selectable && device.lastError && <div className="device-option-error">{device.lastError}</div>}
          </button>
        );
      })}
    </div>
  );
};

export const DeviceSelector: React.FC<DeviceSelectorProps> = ({
  variant = 'sidebar',
  collapsed = false,
}) => {
  const { t } = useI18n();
  const { devices, selectedDevice, setSelectedDevice, startDeviceWatch, stopDeviceWatch, activateDevice } = useDeviceStore();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isUtility = variant === 'utility';
  const dropdownTestId = isUtility ? 'utility-device-selector-dropdown' : 'sidebar-device-selector-dropdown';
  const triggerTestId = isUtility ? 'utility-device-selector-trigger' : 'sidebar-device-selector-trigger';

  const dropdownPosition = useDeviceDropdownPosition({
    isOpen,
    variant,
    collapsed,
    triggerRef,
    menuRef,
  });

  const selectedEntry = devices.find((device) => device.id === selectedDevice) ?? devices[0];
  const selectedSummary = selectedEntry?.type === 'local'
    ? t('device.localReplay')
    : (selectedEntry?.label ?? t('device.noDevice'));
  const utilityLabel = selectedEntry?.type === 'local'
    ? t('device.local')
    : (selectedEntry?.label ?? t('device.noDevice'));
  const selectedStatus = selectedEntry?.type === 'local'
    ? t('device.local')
    : t(STATUS_TEXT_KEYS[selectedEntry?.status ?? 'offline']);
  const triggerTitle = t('device.replayDevice', { summary: selectedSummary });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen) {
      void startDeviceWatch();
      return () => {
        void stopDeviceWatch();
      };
    }

    void stopDeviceWatch();
    return undefined;
  }, [isOpen, startDeviceWatch, stopDeviceWatch]);

  const handleToggleOpen = () => {
    setIsOpen((open) => !open);
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
    <div className={`device-selector-container variant-${variant} ${collapsed ? 'collapsed' : ''}`}>
      <div className="device-selector-group">
        <button
          ref={triggerRef}
          className={isUtility
            ? 'device-selector-trigger device-selector-trigger-utility main-utility-toggle'
            : `device-selector-trigger footer-entry sidebar-footer-entry ${collapsed ? 'collapsed' : ''}`}
          data-testid={triggerTestId}
          onClick={handleToggleOpen}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-label={triggerTitle}
          title={triggerTitle}
        >
          <span className={`device-selector-trigger-icon ${selectedEntry?.type === 'android' ? 'android' : 'local'}`}>
            <DeviceTypeIcon type={selectedEntry?.type ?? 'local'} />
          </span>
          {isUtility ? (
            <>
              <span className="device-selector-utility-label">{utilityLabel}</span>
              <svg
                className={`device-selector-arrow device-selector-arrow-utility ${isOpen ? 'open' : ''}`}
                viewBox="0 0 12 12"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M6 8L1 3h10l-5 5z" />
              </svg>
            </>
          ) : (
            <>
              <span className="footer-entry-main">
                <span className="device-selector-trigger-main">
                  {!collapsed && (
                    <span className="device-selector-copy footer-entry-copy">
                      <span className="device-selector-summary footer-entry-title">{selectedSummary}</span>
                    </span>
                  )}
                </span>
              </span>
              {!collapsed && (
                <span className="device-selector-trigger-meta footer-entry-trailing">
                  <span className={`device-selector-trigger-status footer-entry-status ${selectedEntry?.type === 'local' || selectedEntry?.status === 'connected' || selectedEntry?.status === 'online' ? 'accent' : ''}`}>
                    {selectedStatus}
                  </span>
                  <svg className={`device-selector-arrow footer-entry-chevron ${isOpen ? 'open' : ''}`} viewBox="0 0 12 12" fill="currentColor">
                    <path d="M6 8L1 3h10l-5 5z" />
                  </svg>
                </span>
              )}
            </>
          )}
        </button>
      </div>
      {isOpen && createPortal(
        <DeviceSelectorDropdown
          menuRef={menuRef}
          variant={variant}
          collapsed={collapsed}
          dropdownTestId={dropdownTestId}
          dropdownPosition={dropdownPosition}
          devices={devices}
          selectedDevice={selectedDevice}
          onSelect={(device) => void handleSelect(device)}
        />,
        document.body,
      )}
    </div>
  );
};

export default DeviceSelector;
