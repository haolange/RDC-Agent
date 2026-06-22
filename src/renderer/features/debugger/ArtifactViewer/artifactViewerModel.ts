import type { ActionEvent } from '@shared/types/evidence';

export type FileType = 'yaml' | 'json' | 'md' | 'image' | 'other';

export interface ViewerArtifactRecord {
  id: string;
  name: string;
  path: string;
  type: FileType;
  size?: number;
  modified: number;
  payload: Record<string, unknown>;
}

export const inferFileType = (path: string): FileType => {
  const extension = path.split('.').pop()?.toLowerCase();
  if (!extension) return 'other';
  if (extension === 'yaml' || extension === 'yml') return 'yaml';
  if (extension === 'json' || extension === 'jsonl') return 'json';
  if (extension === 'md') return 'md';
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(extension)) return 'image';
  return 'other';
};

export const getArtifactPath = (event: ActionEvent): string => String(
  event.payload.path
  || event.payload.artifact_path
  || event.payload.output_path
  || event.payload.url
  || event.payload.artifact_name
  || 'unknown-artifact',
);

export const getArtifactName = (path: string): string => {
  const name = path.split(/[/\\]/).pop();
  return name || path;
};

export const formatFileSize = (size?: number): string => {
  if (!size) return '--';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export const formatDate = (timestamp: number): string => new Date(timestamp).toLocaleString('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
