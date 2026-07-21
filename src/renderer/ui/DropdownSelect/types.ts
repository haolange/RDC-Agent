export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
  testId?: string;
  /** When set, renders a leading Aa swatch in the option (and on the trigger when selected). */
  swatchColor?: string;
}

export interface DropdownSelectProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  dataTestId: string;
  ariaLabel?: string;
  variant?: 'field' | 'inline';
  /** Menu edge aligned to the trigger: `start` = left, `end` = right (extends left when wider). */
  menuAlign?: 'start' | 'end';
  minMenuWidth?: number;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  optionClassName?: string;
}
