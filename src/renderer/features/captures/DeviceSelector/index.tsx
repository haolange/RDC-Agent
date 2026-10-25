import { Button } from '../../../ui/Button';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDeviceStore } from '../../../stores/deviceStore';
import type { ReplayDeviceEntry } from '@shared/types/device';
import { useI18n } from '../../../i18n';
import { useDynStyle } from '../../../lib/useDynStyle';
import { isTopOverlayLayer, useOverlayLayer } from '../../../lib/overlayStack';
import {
  DeviceStatusIcon,
  DeviceTypeIcon,
  getBootstrapSummary,
  STATUS_TEXT_KEYS,
} from './DeviceSelectorParts';
import {
  useDeviceDropdownPosition,
  type DeviceDropdownPosition,
} from './useDeviceDropdownPosition';
import './DeviceSelector.css';

const DeviceSelectorDropdown: React.FC<{
  menuRef: React.Ref<HTMLDivElement>;
  dropdownTestId: string;
  dropdownPosition: DeviceDropdownPosition;
  devices: ReplayDeviceEntry[];
  selectedDevice: string;
  onSelect: (device: ReplayDeviceEntry) => void;
}> = ({
  menuRef,
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
      className={`device-selector-dropdown placement-${dropdownPosition.placement}`}
      data-testid={dropdownTestId}
      role="listbox"
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="option"]:not(:disabled)'));
        if (!options.length) return;
        const current = options.indexOf(document.activeElement as HTMLButtonElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
          : (current + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
        event.preventDefault(); options[index]?.focus({ preventScroll: true });
      }}
      {...dynStyle}
    >
      {devices.map((device) => {
        const selectable = device.status !== 'loading';
        const bootstrapSummary = getBootstrapSummary(device, t);
        return (
          <Button variant="ghost" size="sm"
            key={device.id}
            className={`device-selector-option ${device.id === selectedDevice ? 'is-selected' : ''}`}
            onClick={() => onSelect(device)}
            role="option"
            disabled={!selectable}
            aria-selected={device.id === selectedDevice}
          >
            <div className="device-selector-option-main">
              <div className="device-option-leading">
                <DeviceTypeIcon type={device.type} />
                <div className="device-option-copy">
                  <span className="device-option-name">{device.type === 'local' ? t('device.local') : device.label}</span>
                  {device.type !== 'local' && device.detailText ? <span className="device-option-detail">{device.detailText}</span> : null}
                </div>
              </div>
              <div className="device-option-trailing">
                <DeviceStatusIcon device={device} connectedLabel={t('device.status.connected')} />
                <span className={`device-option-status ${device.status}`}>{t(STATUS_TEXT_KEYS[device.status])}</span>
              </div>
            </div>
            {device.serial && device.status !== 'connected' && <div className="device-option-meta">{device.serial}</div>}
            {bootstrapSummary && <div className="device-option-bootstrap">{bootstrapSummary}</div>}
            {!selectable && device.lastError && <div className="device-option-error">{device.lastError}</div>}
          </Button>
        );
      })}
    </div>
  );
};

export const DeviceSelector: React.FC = () => {
  const { t } = useI18n();
  const { devices, selectedDevice, setSelectedDevice, startDeviceWatch, stopDeviceWatch } = useDeviceStore();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { layerId } = useOverlayLayer(isOpen);
  const dropdownTestId = 'utility-device-selector-dropdown';
  const triggerTestId = 'utility-device-selector-trigger';

  const dropdownPosition = useDeviceDropdownPosition({
    isOpen,
    triggerRef,
    menuRef,
  });

  const selectedEntry = devices.find((device) => device.id === selectedDevice) ?? devices[0];
  const selectedSummary = selectedEntry?.type === 'local'
    ? t('device.localReplay')
    : (selectedEntry?.label ?? t('device.noDevice'));
  const selectedName = selectedEntry?.type === 'local'
    ? t('device.local')
    : (selectedEntry?.label ?? t('device.noDevice'));
  const utilityLabel = t('device.nextRequestShort', { summary: selectedName });
  const triggerTitle = t('device.nextRequestDevice', { summary: selectedSummary });

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isTopOverlayLayer(layerId)) return;
      event.preventDefault(); event.stopPropagation();
      setIsOpen(false); triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen, layerId]);

  useEffect(() => {
    if (isOpen) menuRef.current?.querySelector<HTMLButtonElement>('button[aria-selected="true"]:not(:disabled), button[role="option"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [isOpen]);

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

  const handleSelect = (device: ReplayDeviceEntry) => {
    if (device.status === 'loading') return;
    // Opening a capture creates the owning context and connects the selected device.
    setSelectedDevice(device.id);
    setIsOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className="device-selector-container">
      <div className="device-selector-group">
        <Button variant="ghost" size="sm"
          ref={triggerRef}
          className="device-selector-trigger device-selector-trigger-utility main-utility-toggle"
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
        </Button>
      </div>
      {isOpen && createPortal(
        <DeviceSelectorDropdown
          menuRef={menuRef}
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
