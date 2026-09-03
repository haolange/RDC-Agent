export type ArtifactKind =
  | 'capture'
  | 'screenshot'
  | 'shader'
  | 'trace'
  | 'report'
  | 'log'
  | 'data'
  | 'note';

export interface ArtifactRecord {
  artifactId: string;
  runId: string;
  sessionId: string;
  kind: ArtifactKind;
  title: string;
  filePath: string;
  mimeType: string;
  sizeBytes: number;
  sha256?: string;
  taskId?: string;
  evidenceIds: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
