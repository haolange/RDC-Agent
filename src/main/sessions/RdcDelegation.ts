import { z } from 'zod';
import type { PromptSegment } from '@shared/types/rdcRuntime';
import { hashScopedResource } from '../runtime/ScopedResourceResolver';
import { charsToTokens } from '@shared/utils/tokens';

const RdcDelegationSchema = z.object({ rdc: z.object({ requiresLease: z.literal(true) }).strict() }).strict();

export function resolveRdcDelegation(extensions?: Record<string, Record<string, boolean>>): { requiresLease: boolean; segments: PromptSegment[] } {
  if (extensions === undefined) return { requiresLease: false, segments: [] };
  const result = RdcDelegationSchema.safeParse(extensions);
  if (!result.success) throw new Error('RDC_LEASE_DELEGATE_DENIED: unsupported domain capability request.');
  const content = '# RDC Lease\n\nA delegated parent RDC lease is required. Operations are serial, limited by the frozen authorization, and the lease must be released when this child settles.';
  return { requiresLease: true, segments: [{
    id: 'delegation:rdc', kind: 'delegation-capsule', scope: 'runtime', sourcePath: 'runtime://rdc/delegation',
    sourceHash: hashScopedResource(content), precedence: 0, content, stability: 'volatile', tokenEstimate: charsToTokens(content.length),
  }] };
}
