import { cn } from '../lib/cn';
import './Skeleton.css';

export type SkeletonShape = 'line' | 'row' | 'card' | 'block';

export interface SkeletonProps {
  shape?: SkeletonShape;
  /** How many placeholders to stack; text lines end on a shorter line so they read as a paragraph. */
  count?: number;
  className?: string;
}

/** Loading placeholder with the shape of the content to come; never paired with a "Loading…" sentence. */
export function Skeleton({ shape = 'line', count = 1, className }: SkeletonProps) {
  return (
    <div className={cn('ui-skeleton-stack', `is-shape-${shape}`, className)} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => <span key={index} className="ui-skeleton" />)}
    </div>
  );
}
