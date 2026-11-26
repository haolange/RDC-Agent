import { AppError } from '@shared/errors/appError';
import type { DelegationTraceHeader } from '@shared/types/delegationTrace';

/** Identifies a child Agent configuration failure at its trusted preparation boundary. */
export class DelegationConfigurationError extends AppError {
  declare readonly code: NonNullable<DelegationTraceHeader['configurationError']>;

  constructor(code: NonNullable<DelegationTraceHeader['configurationError']>, message: string) {
    super(code, message);
    this.name = 'DelegationConfigurationError';
  }
}
