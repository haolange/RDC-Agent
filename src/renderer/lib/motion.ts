/** The OS asks for less motion: overlays leave at once and scrolling jumps instead of gliding. */
export const prefersReducedMotion = (): boolean => typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The behavior for every programmatic scrollIntoView / scrollTo that would glide. `check:ui-contract` rejects a literal
 * smooth behavior anywhere else, so reduced motion covers each one.
 */
export const motionScrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? 'instant' : 'smooth');
