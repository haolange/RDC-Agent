import type { DelegationTraceHeader } from '@shared/types/delegationTrace';

/** Identifies a child Agent configuration failure at its trusted preparation boundary. */
export class DelegationConfigurationError extends Error {
  constructor(readonly code: NonNullable<DelegationTraceHeader['configurationError']>, message: string) {
    super(message);
    this.name = 'DelegationConfigurationError';
  }
}
