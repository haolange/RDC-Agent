import {
  resolveInvestigationKind,
  type InvestigationArtifactKind,
  type InvestigationKindRegistryEntry,
} from '@shared/types/renderdocInvestigation';
import { InvestigationError } from './investigationErrors';

export function requireInvestigationKind(kind: string): InvestigationKindRegistryEntry {
  const resolved = resolveInvestigationKind(kind);
  if (!resolved) {
    throw new InvestigationError('INVESTIGATION_KIND_UNKNOWN', `unregistered kind "${kind}"`);
  }
  return resolved;
}

export function isInvestigationArtifactKind(value: string): value is InvestigationArtifactKind {
  return resolveInvestigationKind(value) != null;
}
