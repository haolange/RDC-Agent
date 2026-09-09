import { z } from 'zod';
import type { PromptSegment } from '@shared/types/rdxRuntime';
import { hashScopedResource } from '../runtime/ScopedResourceResolver';
import { charsToTokens } from '@shared/utils/tokens';

const RdxDelegationSchema = z.object({ rdx: z.object({ requiresLease: z.literal(true) }).strict() }).strict();

export function resolveRdxDelegation(extensions?: Record<string, Record<string, boolean>>): { requiresLease: boolean; segments: PromptSegment[] } {
  if (extensions === undefined) return { requiresLease: false, segments: [] };
  const result = RdxDelegationSchema.safeParse(extensions);
  if (!result.success) throw new Error('RDX_LEASE_DELEGATE_DENIED: unsupported domain capability request.');
  const content = '# RDX Lease\n\nA delegated parent RDX lease is required. Operations are serial, limited by the frozen authorization, and the lease must be released when this child settles.';
  return { requiresLease: true, segments: [{
    id: 'delegation:rdx', kind: 'delegation-capsule', scope: 'runtime', sourcePath: 'runtime://rdx/delegation',
    sourceHash: hashScopedResource(content), precedence: 0, content, stability: 'volatile', tokenEstimate: charsToTokens(content.length),
  }] };
}
