import { z } from 'zod';
import { charsToTokens } from '@shared/utils/tokens';
import { AppError } from '@shared/errors/appError';
import { hashScopedResource } from '../runtime/ScopedResourceResolver';
import type { PromptSegment } from '@shared/types/rdcRuntime';

const RdcDelegationSchema = z.object({ rdc: z.object({ requiresLease: z.literal(true) }).strict() }).strict();

export function resolveRdcDelegation(extensions?: Record<string, Record<string, boolean>>): {
  requiresLease: boolean;
  segments: PromptSegment[];
} {
  if (extensions === undefined) return { requiresLease: false, segments: [] };
  const result = RdcDelegationSchema.safeParse(extensions);
  if (!result.success) throw new AppError('RDC_LEASE_DELEGATE_DENIED', 'unsupported domain capability request.');
  const content =
    '# RDC Lease\n\nA delegated parent RDC lease is required. Operations are serial, limited by the frozen authorization, and the lease must be released when this child settles.';
  return {
    requiresLease: true,
    segments: [
      {
        id: 'delegation:rdc',
        kind: 'delegation-capsule',
        scope: 'runtime',
        sourcePath: 'runtime://rdc/delegation',
        sourceHash: hashScopedResource(content),
        precedence: 0,
        content,
        stability: 'volatile',
        tokenEstimate: charsToTokens(content.length),
      },
    ],
  };
}
