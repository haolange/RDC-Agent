import React from 'react';
import { createPortal } from 'react-dom';
import { normalizeTestIdSegment } from './dropdownSelectUtils';
import type { DropdownOption } from './types';

function AaSwatch(props: { color: string; className?: string }) {
  return (
    <span
      className={['dropdown-select-swatch', props.className].filter(Boolean).join(' ')}
      style={{ background: props.color }}
      aria-hidden="true"
    >
      Aa
    </span>
  );
}

function CheckIcon() {
  return (
    <svg
      className="dropdown-select-option-check-icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

interface DropdownSelectTriggerProps {
  triggerRef: React.Ref<HTMLButtonElement>;
  variant: 'field' | 'inline';
  open: boolean;
  disabled: boolean;
  dataTestId: string;
  triggerAriaLabel: string;
  triggerLabel: string;
  swatchColor?: string;
  hasSelection: boolean;
  triggerClassName: string;
  onClick: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

export const DropdownSelectTrigger: React.FC<DropdownSelectTriggerProps> = ({
  triggerRef,
  variant,
  open,
  disabled,
  dataTestId,
  triggerAriaLabel,
  triggerLabel,
  swatchColor,
  hasSelection,
  triggerClassName,
  onClick,
  onKeyDown,
}) => (
  <button
    ref={triggerRef}
    type="button"
    className={[
      'dropdown-select-trigger',
      `variant-${variant}`,
      hasSelection ? '' : 'placeholder',
      swatchColor ? 'has-swatch' : '',
      triggerClassName,
    ].filter(Boolean).join(' ')}
    data-testid={dataTestId}
    disabled={disabled}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={triggerAriaLabel}
    onClick={onClick}
    onKeyDown={onKeyDown}
  >
    <span className="dropdown-select-trigger-main">
      {swatchColor ? <AaSwatch color={swatchColor} /> : null}
      <span className="dropdown-select-trigger-label">{triggerLabel}</span>
    </span>
    <span className={`dropdown-select-trigger-caret ${open ? 'open' : ''}`} aria-hidden="true">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </span>
  </button>
);

interface DropdownSelectMenuProps {
  menuRef: React.Ref<HTMLDivElement>;
  variant: 'field' | 'inline';
  dataTestId: string;
  triggerAriaLabel: string;
  menuClassName: string;
  optionClassName: string;
  emptyLabel: string;
  value: string;
  options: DropdownOption[];
  activeIndex: number;
  menuPosition: {
    left: number;
    top: number;
    width: number;
    caretX: number;
    placement: 'bottom' | 'top';
    ready: boolean;
  };
  onActiveIndexChange: (index: number) => void;
  onCommitSelection: (nextValue: string) => void;
}

export const DropdownSelectMenu: React.FC<DropdownSelectMenuProps> = ({
  menuRef,
  variant,
  dataTestId,
  triggerAriaLabel,
  menuClassName,
  optionClassName,
  emptyLabel,
  value,
  options,
  activeIndex,
  menuPosition,
  onActiveIndexChange,
  onCommitSelection,
}) => createPortal(
  <div
    ref={menuRef}
    className={[
      'dropdown-select-menu',
      `variant-${variant}`,
      `placement-${menuPosition.placement}`,
      menuClassName,
    ].filter(Boolean).join(' ')}
    data-testid={`${dataTestId}-menu`}
    data-placement={menuPosition.placement}
    role="listbox"
    aria-label={triggerAriaLabel}
    style={{
      left: menuPosition.left,
      top: menuPosition.top,
      width: menuPosition.width,
      ['--dropdown-caret-x']: `${menuPosition.caretX}px`,
      visibility: menuPosition.ready ? 'visible' : 'hidden',
    } as React.CSSProperties}
  >
    <span className="dropdown-select-menu-caret" aria-hidden="true" />
    <div className="dropdown-select-menu-panel">
      {options.length === 0 ? (
        <div className="dropdown-select-empty">{emptyLabel}</div>
      ) : (
        options.map((option, index) => {
          const optionTestId = option.testId
            ?? `${dataTestId}-option-${normalizeTestIdSegment(option.value)}`;
          const isSelected = option.value === value;
          const isActive = index === activeIndex;

          return (
            <button
              key={`${option.value}-${index}`}
              type="button"
              className={[
                'dropdown-select-option',
                isSelected ? 'selected' : '',
                isActive ? 'active' : '',
                option.disabled ? 'disabled' : '',
                option.swatchColor ? 'has-swatch' : '',
                optionClassName,
              ].filter(Boolean).join(' ')}
              data-testid={optionTestId}
              role="option"
              aria-selected={isSelected}
              aria-disabled={option.disabled ? 'true' : 'false'}
              disabled={option.disabled}
              onMouseEnter={() => {
                if (!option.disabled) {
                  onActiveIndexChange(index);
                }
              }}
              onClick={() => {
                if (!option.disabled) {
                  onCommitSelection(option.value);
                }
              }}
            >
              <span className="dropdown-select-option-main">
                {option.swatchColor ? <AaSwatch color={option.swatchColor} /> : null}
                <span className="dropdown-select-option-label">{option.label}</span>
              </span>
              {isSelected ? (
                <span className="dropdown-select-option-check">
                  <CheckIcon />
                </span>
              ) : null}
            </button>
          );
        })
      )}
    </div>
  </div>,
  document.body,
);
