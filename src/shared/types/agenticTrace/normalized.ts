import type { ArtifactRef } from './base';
import type { FindingNode, ObservationNode } from './nodes';
import type { ToolResultPreview } from './previews';

export interface NormalizedToolResult {
  summary: string;
  preview?: ToolResultPreview;
  observations?: ObservationNode[];
  findings?: FindingNode[];
  artifacts?: ArtifactRef[];
  raw?: unknown;
}
