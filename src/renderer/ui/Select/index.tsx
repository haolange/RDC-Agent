import { useUiLabels } from '../../lib/useUiLabels';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ANCHOR_GAP,
  clamp,
  DEFAULT_MIN_MENU_WIDTH,
  findFirstEnabledIndex,
  findNextEnabledIndex,
  findSelectedEnabledIndex,
  VIEWPORT_MARGIN,
} from './selectUtils';
import { SelectMenu, SelectTrigger } from './SelectPrimitives';
import type { SelectProps } from './types';
import { isTopOverlayLayer, useOverlayLayer } from '../../lib/overlayStack';
import { placeAnchoredSurface } from '../../lib/anchoredSurface';
import './Select.css';

export type { SelectOption } from './types';
export type { SelectProps } from './types';

export const Select: React.FC<SelectProps> = ({
  value,
  options,
  onChange,
  placeholder: suppliedPlaceholder,
  emptyLabel: suppliedEmptyLabel,
  disabled = false,
  dataTestId,
  ariaLabel,
  variant = 'field',
  menuAlign = 'start',
  minMenuWidth = DEFAULT_MIN_MENU_WIDTH,
  className = '',
  triggerClassName = '',
  menuClassName = '',
  optionClassName = '',
}) => {
  const labels = useUiLabels();
  const placeholder = suppliedPlaceholder ?? labels.selectPlaceholder;
  const emptyLabel = suppliedEmptyLabel ?? labels.selectEmpty;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { layerId } = useOverlayLayer(open);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuPosition, setMenuPosition] = useState({
    left: VIEWPORT_MARGIN,
    top: VIEWPORT_MARGIN,
    width: minMenuWidth,
    caretX: 20,
    placement: 'bottom' as 'bottom' | 'top',
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
        caretX: 20,
        placement: 'bottom',
        ready: true,
      });
      return;
    }

    const measuredWidth = Math.max(
      triggerRect.width,
      menuElement?.offsetWidth ?? 0,
      minMenuWidth,
    );
    const { width, left, top, placement } = placeAnchoredSurface(triggerRect,
      { width: measuredWidth, height: menuElement?.offsetHeight ?? 320 },
      { width: viewportWidth, height: viewportHeight }, menuAlign, 'bottom', VIEWPORT_MARGIN, ANCHOR_GAP);
    const tipAnchorX = menuAlign === 'end'
      ? triggerRect.right - 16
      : triggerRect.left + Math.min(20, triggerRect.width / 2);

    setMenuPosition({
      left,
      top,
      width,
      caretX: clamp(tipAnchorX - left, 14, width - 14),
      placement,
      ready: true,
    });
  }, [menuAlign, minMenuWidth]);

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
      if (!isTopOverlayLayer(layerId)) return;
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      closeMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopOverlayLayer(layerId)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
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
  }, [activeIndex, closeMenu, commitSelection, layerId, open, options]);

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

    if (triggerRef.current) resizeObserver?.observe(triggerRef.current);
    document.fonts?.addEventListener('loadingdone', handleViewportChange);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      resizeObserver?.disconnect();
      document.fonts?.removeEventListener('loadingdone', handleViewportChange);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, options, updateMenuPosition, value]);

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || open) {
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
    open ? 'is-open' : '',
    disabled ? 'is-disabled' : '',
    className,
  ].filter(Boolean).join(' ');

  const triggerLabel = selectedOption?.label ?? placeholder;
  const triggerAriaLabel = ariaLabel ?? triggerLabel;
  const triggerSwatchColor = selectedOption?.swatchColor;

  return (
    <div className={rootClassName}>
      <SelectTrigger
        triggerRef={triggerRef}
        variant={variant}
        open={open}
        disabled={disabled}
        dataTestId={dataTestId}
        triggerAriaLabel={triggerAriaLabel}
        triggerLabel={triggerLabel}
        swatchColor={triggerSwatchColor}
        hasSelection={Boolean(selectedOption)}
        triggerClassName={triggerClassName}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      />

      {open && (
        <SelectMenu
          menuRef={menuRef}
          variant={variant}
          dataTestId={dataTestId}
          triggerAriaLabel={triggerAriaLabel}
          menuClassName={menuClassName}
          optionClassName={optionClassName}
          emptyLabel={emptyLabel}
          value={value}
          options={options}
          activeIndex={activeIndex}
          menuPosition={menuPosition}
          onActiveIndexChange={setActiveIndex}
          onCommitSelection={commitSelection}
        />
      )}
    </div>
  );
};

export default Select;
