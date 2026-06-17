export type GitFileChangeKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'unmerged'
  | 'typechange'
  | 'unknown';

export interface GitStatusFile {
  path: string;
  originalPath?: string;
  indexStatus: string;
  workingTreeStatus: string;
  kind: GitFileChangeKind;
  staged: boolean;
  unstaged: boolean;
}

export interface GitStatusSummary {
  projectId: string;
  rootPath: string;
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  clean: boolean;
  files: GitStatusFile[];
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
}

export interface GitDiffRequest {
  path?: string;
  staged?: boolean;
  maxBytes?: number;
}

export interface GitDiffResult {
  success: boolean;
  rootPath?: string;
  stat?: string;
  patch?: string;
  truncated?: boolean;
  error?: string;
}

export interface GitPathRequest {
  path: string;
}

export interface GitCommitRequest {
  message: string;
}

export interface GitActionResult {
  success: boolean;
  status?: GitStatusSummary;
  output?: string;
  error?: string;
}
