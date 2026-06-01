export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
  testId?: string;
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
  minMenuWidth?: number;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  optionClassName?: string;
}
