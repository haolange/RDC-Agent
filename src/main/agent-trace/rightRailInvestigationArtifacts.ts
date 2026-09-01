import { bareInvestigationHash, type InvestigationArtifactManifest, type InvestigationRecordType } from '@shared/types/renderdocInvestigation';
import type { InvestigationArtifactRow, InvestigationArtifactsPanelViewModel } from '@shared/types/trace';
import { hashesEqual } from '../investigation/investigationHash';
import { investigationArtifactService } from '../investigation/InvestigationArtifactService';
import { collectSupersedeChain, type InvestigationIndexEntry } from '../investigation/investigationRecordKeys';

const ROW_LIMIT = 50;
const FALLBACK_MISSION = 'debugger' as const;

export interface InvestigationArtifactsSource {
  listForProjection(sessionId: string): InvestigationIndexEntry[];
  listManifests(sessionId: string): Map<string, InvestigationArtifactManifest | null>;
}

const emptyArtifacts = (): InvestigationArtifactsPanelViewModel => ({
  rows: [],
  supersededCount: 0,
  truncatedCount: 0,
});

const hashShort = (value: string): string => {
  const bare = bareInvestigationHash(value);
  return bare ? `sha256:${bare.slice(0, 12)}` : '';
};

const collectSuperseded = (entries: InvestigationIndexEntry[]): Set<string> => {
  const superseded = new Set<string>();
  for (const entry of entries) {
    if (entry.status === 'superseded') superseded.add(entry.artifactId);
    if (entry.supersedes) {
      for (const id of collectSupersedeChain(entries, entry.supersedes)) superseded.add(id);
    }
  }
  return superseded;
};

const toRow = (
  entry: InvestigationIndexEntry,
  manifest: InvestigationArtifactManifest | null,
): InvestigationArtifactRow => {
  const degraded = !manifest || !hashesEqual(manifest.contentHash, entry.contentHash);
  return {
    artifactId: entry.artifactId,
    kind: entry.kind,
    recordType: (manifest?.recordType ?? entry.recordType) as InvestigationRecordType,
    status: entry.status,
    mission: manifest?.mission ?? FALLBACK_MISSION,
    title: degraded ? '' : manifest.title,
    createdAt: entry.createdAt,
    contentHashShort: hashShort(manifest?.contentHash || entry.contentHash),
    sourceRefCount: manifest?.sourceRefs.length ?? 0,
    worldStateId: manifest?.worldStateId,
    degraded,
  };
};

export function mapRightRailInvestigationArtifacts(
  sessionId: string,
  source: InvestigationArtifactsSource = investigationArtifactService,
): InvestigationArtifactsPanelViewModel {
  try {
    const entries = source.listForProjection(sessionId).slice().sort((left, right) => {
      const time = left.createdAt.localeCompare(right.createdAt);
      return time !== 0 ? time : left.artifactId.localeCompare(right.artifactId);
    });
    const manifests = source.listManifests(sessionId);
    const superseded = collectSuperseded(entries);
    const visible = entries.filter((entry) => !superseded.has(entry.artifactId));
    const truncatedCount = Math.max(0, visible.length - ROW_LIMIT);
    return {
      rows: visible.slice(-ROW_LIMIT).map((entry) => toRow(entry, manifests.get(entry.artifactId) ?? null)),
      supersededCount: superseded.size,
      truncatedCount,
    };
  } catch {
    return emptyArtifacts();
  }
}
