export interface SpinnerProps {
  className?: string;
  label?: string;
}

export function Spinner({ className = '', label = 'Loading' }: SpinnerProps) {
  return (
    <span
      className={`ui-spinner animate-spin ${className}`.trim()}
      role="status"
      aria-label={label}
    />
  );
}
