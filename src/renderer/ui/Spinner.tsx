import './Spinner.css';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
}

export function Spinner({ size = 'md' }: SpinnerProps) {
  return (
    <span
      className={`ui-spinner animate-spin${size !== 'md' ? ` is-size-${size}` : ''}`}
      role="status"
      aria-hidden
    />
  );
}
