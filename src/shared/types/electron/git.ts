import type {
  GitActionResult,
  GitCommitRequest,
  GitDiffRequest,
  GitDiffResult,
  GitPathRequest,
} from '../git';

export interface GitApi {
  getStatus: () => Promise<GitActionResult>;
  getDiff: (request?: GitDiffRequest) => Promise<GitDiffResult>;
  stage: (request: GitPathRequest) => Promise<GitActionResult>;
  stageAll: () => Promise<GitActionResult>;
  unstage: (request: GitPathRequest) => Promise<GitActionResult>;
  unstageAll: () => Promise<GitActionResult>;
  commit: (request: GitCommitRequest) => Promise<GitActionResult>;
}
