import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import './DropdownSelect.css';

const VIEWPORT_MARGIN = 16;
const ANCHOR_GAP = 8;
const DEFAULT_MIN_MENU_WIDTH = 180;

const clamp = (value: number, min: number, max: number): number => {
  if (max < min) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
};

const normalizeTestIdSegment = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'option';
};

const findFirstEnabledIndex = (options: DropdownOption[]): number =>
  options.findIndex((option) => !option.disabled);

const findSelectedEnabledIndex = (options: DropdownOption[], value: string): number =>
  options.findIndex((option) => option.value === value && !option.disabled);

const findNextEnabledIndex = (
  options: DropdownOption[],
  startIndex: number,
  direction: 1 | -1,
): number => {
  if (options.length === 0) {
    return -1;
  }

  let nextIndex = startIndex;
  for (let step = 0; step < options.length; step += 1) {
    nextIndex = (nextIndex + direction + options.length) % options.length;
    if (!options[nextIndex]?.disabled) {
      return nextIndex;
    }
  }

  return -1;
};

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
  testId?: string;
}

interface DropdownSelectProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  dataTestId: string;
  ariaLabel?: string;
  variant?: 'field' | 'inline';
  minMenuWidth?: number;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  optionClassName?: string;
}

export const DropdownSelect: React.FC<DropdownSelectProps> = ({
  value,
  options,
  onChange,
  placeholder = 'Select',
  emptyLabel = 'No options available',
  disabled = false,
  dataTestId,
  ariaLabel,
  variant = 'field',
  minMenuWidth = DEFAULT_MIN_MENU_WIDTH,
  className = '',
  triggerClassName = '',
  menuClassName = '',
  optionClassName = '',
}) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuPosition, setMenuPosition] = useState({
    left: VIEWPORT_MARGIN,
    top: VIEWPORT_MARGIN,
    width: minMenuWidth,
    ready: false,
  });

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );

  const resolveInitialIndex = useCallback(() => {
    const selectedIndex = findSelectedEnabledIndex(options, value);
    if (selectedIndex >= 0) {
      return selectedIndex;
    }
    return findFirstEnabledIndex(options);
  }, [options, value]);

  const updateMenuPosition = useCallback(() => {
    const triggerRect = triggerRef.current?.getBoundingClientRect();
    const menuElement = menuRef.current;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (!triggerRect) {
      setMenuPosition({
        left: VIEWPORT_MARGIN,
        top: VIEWPORT_MARGIN,
        width: minMenuWidth,
        ready: true,
      });
      return;
    }

    const measuredWidth = Math.max(
      triggerRect.width,
      menuElement?.offsetWidth ?? 0,
      minMenuWidth,
    );
    const width = Math.min(measuredWidth, viewportWidth - VIEWPORT_MARGIN * 2);
    const menuHeight = menuElement?.offsetHeight ?? 320;
    const maxLeft = viewportWidth - width - VIEWPORT_MARGIN;
    const maxTop = viewportHeight - menuHeight - VIEWPORT_MARGIN;
    const preferredTop = triggerRect.bottom + ANCHOR_GAP;
    const fallbackTop = triggerRect.top - menuHeight - ANCHOR_GAP;
    const topCandidate = preferredTop <= maxTop ? preferredTop : fallbackTop;

    setMenuPosition({
      left: clamp(triggerRect.left, VIEWPORT_MARGIN, maxLeft),
      top: clamp(topCandidate, VIEWPORT_MARGIN, maxTop),
      width,
      ready: true,
    });
  }, [minMenuWidth]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setMenuPosition((current) => ({ ...current, ready: false }));
  }, []);

  const commitSelection = useCallback((nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    triggerRef.current?.focus();
  }, [onChange]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      closeMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        triggerRef.current?.focus();
        return;
      }

      if (event.key === 'Tab') {
        closeMenu();
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((current) => findNextEnabledIndex(options, current < 0 ? -1 : current, 1));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((current) => {
          const startIndex = current < 0 ? options.length : current;
          return findNextEnabledIndex(options, startIndex, -1);
        });
        return;
      }

      if (event.key === 'Enter' || event.key === ' ') {
        if (activeIndex < 0) {
          return;
        }
        event.preventDefault();
        const option = options[activeIndex];
        if (option && !option.disabled) {
          commitSelection(option.value);
        }
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeIndex, closeMenu, commitSelection, open, options]);

  useEffect(() => {
    if (!open) {
      setActiveIndex(-1);
      return;
    }
    setActiveIndex(resolveInitialIndex());
  }, [open, resolveInitialIndex]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    updateMenuPosition();

    const handleViewportChange = () => {
      updateMenuPosition();
    };

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => updateMenuPosition())
      : null;

    if (menuRef.current && resizeObserver) {
      resizeObserver.observe(menuRef.current);
    }

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, options, updateMenuPosition, value]);

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) {
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(resolveInitialIndex());
    }
  };

  const rootClassName = [
    'dropdown-select',
    `variant-${variant}`,
    open ? 'open' : '',
    disabled ? 'disabled' : '',
    className,
  ].filter(Boolean).join(' ');

  const triggerLabel = selectedOption?.label ?? placeholder;
  const triggerAriaLabel = ariaLabel ?? triggerLabel;

  return (
    <div className={rootClassName}>
      <button
        ref={triggerRef}
        type="button"
        className={[
          'dropdown-select-trigger',
          `variant-${variant}`,
          selectedOption ? '' : 'placeholder',
          triggerClassName,
        ].filter(Boolean).join(' ')}
        data-testid={dataTestId}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={triggerAriaLabel}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="dropdown-select-trigger-label">{triggerLabel}</span>
        <span className={`dropdown-select-trigger-caret ${open ? 'open' : ''}`} aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          className={[
            'dropdown-select-menu',
            `variant-${variant}`,
            menuClassName,
          ].filter(Boolean).join(' ')}
          data-testid={`${dataTestId}-menu`}
          role="listbox"
          aria-label={triggerAriaLabel}
          style={{
            left: menuPosition.left,
            top: menuPosition.top,
            width: menuPosition.width,
            visibility: menuPosition.ready ? 'visible' : 'hidden',
          }}
        >
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
                    optionClassName,
                  ].filter(Boolean).join(' ')}
                  data-testid={optionTestId}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled ? 'true' : 'false'}
                  disabled={option.disabled}
                  onMouseEnter={() => {
                    if (!option.disabled) {
                      setActiveIndex(index);
                    }
                  }}
                  onClick={() => {
                    if (!option.disabled) {
                      commitSelection(option.value);
                    }
                  }}
                >
                  <span className="dropdown-select-option-label">{option.label}</span>
                  {isSelected && <span className="dropdown-select-option-check">●</span>}
                </button>
              );
            })
          )}
        </div>,
        document.body,
      )}
    </div>
  );
};

export default DropdownSelect;
