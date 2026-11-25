import type { PolicyApprovalFloor } from '../agent-runtime/permissions/PolicyCompiler';
import type { EffectiveResourceStatus, ResourceScope, ScopedResourceKind } from '@shared/types/rdcRuntime';

export interface ResourceProvenance {
  scope: ResourceScope;
  sourcePath: string;
  sourceHash: string;
  overriddenSource?: Omit<ResourceProvenance, 'overriddenSource'>;
}

export interface ScopedResourceCandidate<T> {
  id: string;
  kind: ScopedResourceKind;
  scope: ResourceScope;
  sourcePath: string;
  value: T;
  enabled?: boolean;
  invalid?: boolean;
  invalidReason?: string;
}

export interface ResolvedResource<T> {
  id: string;
  kind: ScopedResourceKind;
  value: T;
  enabled: boolean;
  effectiveStatus: EffectiveResourceStatus;
  provenance: ResourceProvenance;
}

export interface ScopedResourceCatalog<T = unknown> {
  resources: Array<ResolvedResource<T>>;
  diagnostics: Array<{
    code: string;
    severity: 'warning' | 'error';
    message: string;
    sourcePath?: string;
  }>;
}

export interface ScopedInstructionSource {
  id: string;
  scope: 'user' | 'project';
  sourcePath: string;
  sourceHash: string;
  content: string;
  byteLength: number;
  precedence: number;
}

export interface ScopedInstructionResolution {
  sources: ScopedInstructionSource[];
  totalBytes: number;
  diagnostics: Array<{
    code: string;
    severity: 'warning' | 'error';
    message: string;
    sourcePath?: string;
  }>;
}

export interface RestrictivePolicy {
  deniedTools?: string[];
  approval?: 'none' | 'destructive' | 'mutation' | 'all';
  /** Optional per-tool approval floor; keys are normalized tool names. */
  approvalFloorByTool?: Record<string, PolicyApprovalFloor>;
  limits?: Record<string, number>;
}
