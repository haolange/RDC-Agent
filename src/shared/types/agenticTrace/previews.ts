export interface TextPreview {
  kind: 'text';
  text: string;
}

export interface CodePreview {
  kind: 'code';
  language?: string;
  code: string;
  path?: string;
  startLine?: number;
  endLine?: number;
}

export interface LogPreview {
  kind: 'log';
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

export interface DiffPreview {
  kind: 'diff';
  path: string;
  unifiedDiff: string;
}

export interface ImagePreview {
  kind: 'image';
  url: string;
  width?: number;
  height?: number;
}

export interface TablePreview {
  kind: 'table';
  columns: string[];
  rows: unknown[][];
}

export interface JsonPreview {
  kind: 'json';
  value: unknown;
}

export interface ArtifactPreview {
  kind: 'artifact';
  artifactId: string;
}

export type ToolResultPreview =
  | TextPreview
  | CodePreview
  | LogPreview
  | DiffPreview
  | ImagePreview
  | TablePreview
  | JsonPreview
  | ArtifactPreview;
