import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../lib/cn';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { Input, type InputSize } from './Input';
import './SearchField.css';

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  inputSize?: InputSize;
  error?: boolean;
  onClear?: () => void;
  clearLabel?: string;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  {
    inputSize = 'md',
    error = false,
    onClear,
    clearLabel = 'Clear search',
    className,
    value,
    disabled,
    ...rest
  },
  ref,
) {
  const hasValue = typeof value === 'string' ? value.length > 0 : value != null;
  return (
    <div className={cn('ui-search-field', hasValue && onClear && 'has-clear', className)}>
      <Icon name="search" size={14} className="ui-search-field-icon" />
      <Input
        ref={ref}
        type="search"
        inputSize={inputSize}
        error={error}
        value={value}
        disabled={disabled}
        {...rest}
      />
      {hasValue && onClear ? (
        <IconButton
          label={clearLabel}
          size="sm"
          className="ui-search-field-clear"
          disabled={disabled}
          onClick={onClear}
        >
          <Icon name="close" size={12} />
        </IconButton>
      ) : null}
    </div>
  );
});
