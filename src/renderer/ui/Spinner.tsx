import './Spinner.css';

export interface SpinnerProps {
  className?: string;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function Spinner({ className = '', label = 'Loading', size = 'md' }: SpinnerProps) {
  return (
    <span
      className={`ui-spinner animate-spin${size !== 'md' ? ` is-size-${size}` : ''}${className ? ` ${className}` : ''}`}
      role="status"
      aria-label={label}
    />
  );
}
