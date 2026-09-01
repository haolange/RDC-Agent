import type {
  InvestigationArtifactManifest,
  InvestigationRecord,
  WorldState,
} from '@shared/types/renderdocInvestigation';
import { InvestigationError } from './investigationErrors';
import { hashesEqual, sha256Prefixed } from './investigationHash';
import { requireInvestigationKind } from './investigationKindRegistry';
import {
  contentUriFor,
  inferWorldStateId,
  isWorldStateBoundKind,
  manifestUriFor,
  recordKeyOf,
  type InvestigationIndexDocument,
  type InvestigationIndexEntry,
} from './investigationRecordKeys';
import { parseInvestigationRecord } from './investigationRecordSchemas';

export interface InvestigationContentRead {
  text: string;
  hash: string;
  truncated: boolean;
}

export interface VerifiedIndexArtifact {
  entry: InvestigationIndexEntry;
  manifest: InvestigationArtifactManifest;
  record: InvestigationRecord;
  bodyHash: string;
  contentText: string;
}

export function assertTripleContentHash(
  indexHash: string,
  manifestHash: string,
  contentText: string,
  resolverHash?: string,
): string {
  const bodyHash = sha256Prefixed(contentText);
  if (resolverHash && !hashesEqual(bodyHash, resolverHash)) {
    throw new InvestigationError(
      'INVESTIGATION_HASH_MISMATCH',
      'contentRef body hash does not match stored bytes',
    );
  }
  if (
    !hashesEqual(bodyHash, indexHash)
    || !hashesEqual(bodyHash, manifestHash)
    || !hashesEqual(indexHash, manifestHash)
  ) {
    throw new InvestigationError(
      'INVESTIGATION_HASH_MISMATCH',
      'index, manifest, and contentRef hashes must match',
    );
  }
  return bodyHash;
}

export function isReadySourceDriftError(error: unknown): boolean {
  return error instanceof InvestigationError
    && (error.code === 'INVESTIGATION_HASH_MISMATCH' || error.code === 'INVESTIGATION_REF_UNRESOLVED');
}

export function assertInvestigationIndexIntegrity(
  index: InvestigationIndexDocument,
  io: {
    readManifest: (uri: string) => unknown;
    readContent: (uri: string) => InvestigationContentRead;
    parseManifest: (value: unknown) => InvestigationArtifactManifest;
  },
): void {
  const seen = new Set<string>();
  const verified = new Map<string, VerifiedIndexArtifact>();
  for (const entry of index.artifacts) {
    if (seen.has(entry.artifactId)) {
      throw new InvestigationError('INVESTIGATION_INDEX_CORRUPT', `duplicate artifactId ${entry.artifactId}`);
    }
    seen.add(entry.artifactId);
    try {
      verified.set(entry.artifactId, verifyIndexEntry(entry, io));
    } catch (error) {
      throw reraiseIndexIntegrity(error, entry.artifactId);
    }
  }
  for (const item of verified.values()) {
    if (item.manifest.status !== 'ready') continue;
    try {
      assertReadyAgainstVerifiedIndex(item.manifest, item.record, item.contentText, verified);
    } catch (error) {
      throw reraiseIndexIntegrity(error, item.entry.artifactId);
    }
  }
}

export function assertReadyAgainstVerifiedIndex(
  manifest: InvestigationArtifactManifest,
  record: InvestigationRecord,
  contentText: string,
  verified: ReadonlyMap<string, VerifiedIndexArtifact>,
): void {
  const kindEntry = requireInvestigationKind(manifest.kind);
  if (manifest.recordType !== kindEntry.recordType) {
    throw new InvestigationError('INVESTIGATION_READY_DENIED', 'recordType does not match Kind Registry');
  }
  if (manifest.sourceRefs.length < 1) {
    throw new InvestigationError('INVESTIGATION_READY_DENIED', 'ready requires sourceRefs.length >= 1');
  }
  for (const source of manifest.sourceRefs) {
    const resolved = verified.get(source.artifactId);
    if (!resolved) {
      throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `source artifact ${source.artifactId}`, {
        invariantId: 'S-CTX-01',
      });
    }
    if (!hashesEqual(source.expectedHash, resolved.bodyHash)) {
      throw new InvestigationError('INVESTIGATION_HASH_MISMATCH', `source ${source.artifactId} hash mismatch`, {
        invariantId: 'S-CTX-01',
      });
    }
  }
  if (!hashesEqual(manifest.contentHash, sha256Prefixed(contentText))) {
    throw new InvestigationError('INVESTIGATION_READY_DENIED', 'contentHash must equal sha256 of contentRef bytes');
  }
  try {
    parseInvestigationRecord(kindEntry.recordType, JSON.parse(contentText));
  } catch (error) {
    throw new InvestigationError(
      'INVESTIGATION_READY_DENIED',
      error instanceof Error ? error.message : String(error),
    );
  }
  assertReadyWorldStateBinding(manifest, record, verified);
}

function verifyIndexEntry(
  entry: InvestigationIndexEntry,
  io: {
    readManifest: (uri: string) => unknown;
    readContent: (uri: string) => InvestigationContentRead;
    parseManifest: (value: unknown) => InvestigationArtifactManifest;
  },
): VerifiedIndexArtifact {
  if (entry.contentUri !== contentUriFor(entry.artifactId) || entry.manifestUri !== manifestUriFor(entry.artifactId)) {
    throw new InvestigationError(
      'INVESTIGATION_INDEX_CORRUPT',
      `index URI for ${entry.artifactId} does not match the artifact identity`,
    );
  }
  const registered = requireInvestigationKind(entry.kind);
  if (registered.recordType !== entry.recordType) {
    throw new InvestigationError(
      'INVESTIGATION_INDEX_CORRUPT',
      `index recordType for ${entry.artifactId} does not match Kind Registry`,
    );
  }
  const manifest = io.parseManifest(io.readManifest(entry.manifestUri));
  if (
    manifest.artifactId !== entry.artifactId
    || manifest.kind !== entry.kind
    || manifest.recordType !== entry.recordType
    || manifest.contentRef !== entry.contentUri
    || manifest.status !== entry.status
    || !hashesEqual(manifest.contentHash, entry.contentHash)
    || manifest.createdAt !== entry.createdAt
    || (manifest.supersedes ?? undefined) !== (entry.supersedes ?? undefined)
  ) {
    throw new InvestigationError(
      'INVESTIGATION_INDEX_CORRUPT',
      `index entry ${entry.artifactId} does not match its manifest`,
    );
  }
  const content = io.readContent(entry.contentUri);
  if (content.truncated) {
    throw new InvestigationError('INVESTIGATION_INDEX_CORRUPT', `contentRef for ${entry.artifactId} was truncated`);
  }
  const bodyHash = assertTripleContentHash(entry.contentHash, manifest.contentHash, content.text, content.hash);
  const record = parseInvestigationRecord(entry.recordType, JSON.parse(content.text || '{}')) as InvestigationRecord;
  if (recordKeyOf(entry.kind, record) !== entry.recordKey) {
    throw new InvestigationError(
      'INVESTIGATION_INDEX_CORRUPT',
      `index recordKey for ${entry.artifactId} does not match the body`,
    );
  }
  return { entry, manifest, record, bodyHash, contentText: content.text };
}

function assertReadyWorldStateBinding(
  manifest: InvestigationArtifactManifest,
  record: InvestigationRecord,
  verified: ReadonlyMap<string, VerifiedIndexArtifact>,
): void {
  const inferred = inferWorldStateId(manifest.kind, record);
  const bound = manifest.worldStateId;
  if (bound && inferred && bound !== inferred) {
    throw new InvestigationError(
      'INVESTIGATION_READY_DENIED',
      `worldStateId ${bound} does not match record body ${inferred}`,
    );
  }
  if (!isWorldStateBoundKind(manifest.kind)) return;
  const worldStateId = inferred ?? bound;
  if (!worldStateId) {
    throw new InvestigationError('INVESTIGATION_READY_DENIED', 'bound record requires worldStateId');
  }
  if (manifest.kind === 'world_state') {
    if ((record as WorldState).worldStateId !== worldStateId) {
      throw new InvestigationError('INVESTIGATION_READY_DENIED', `worldState ${worldStateId} is not resolvable`);
    }
    return;
  }
  const live = [...verified.values()].some((item) => (
    item.entry.kind === 'world_state'
    && item.entry.status !== 'superseded'
    && item.entry.recordKey === worldStateId
  ));
  if (!live) {
    throw new InvestigationError('INVESTIGATION_READY_DENIED', `worldState ${worldStateId} is not resolvable`);
  }
}

function reraiseIndexIntegrity(error: unknown, artifactId: string): InvestigationError {
  if (
    error instanceof InvestigationError
    && (
      error.code === 'INVESTIGATION_INDEX_CORRUPT'
      || error.code === 'INVESTIGATION_HASH_MISMATCH'
      || error.code === 'INVESTIGATION_READY_DENIED'
      || error.code === 'INVESTIGATION_REF_UNRESOLVED'
    )
  ) {
    return error;
  }
  return new InvestigationError(
    'INVESTIGATION_INDEX_CORRUPT',
    error instanceof Error ? error.message : `index entry ${artifactId} is inconsistent`,
  );
}
