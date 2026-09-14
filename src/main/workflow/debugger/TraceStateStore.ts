import * as fs from 'fs';
import * as path from 'path';
import type {
  RequestBranch,
  RequestBranchGroup,
  UserRequest,
  UserRequestRevision,
} from '@shared/types/trace';
import { generateEventId, nowIso } from '@shared/utils/id';
import { storageAdapter } from '../../sessions/StorageAdapter';
import { runScopedStore } from './RunScopedStore';

const STORE_FILE = 'agentic-trace-state.json';

export interface TracePersistedState {
  schemaVersion: '1';
  sessionId: string;
  activeBranchId: string;
  userRequests: UserRequest[];
  branches: RequestBranchGroup[];
  updatedAt: string;
}

const defaultState = (sessionId: string): TracePersistedState => ({
  schemaVersion: '1',
  sessionId,
  activeBranchId: 'branch-main',
  userRequests: [],
  branches: [],
  updatedAt: nowIso(),
});

export class TraceStateStore {
  read(sessionId: string): TracePersistedState {
    const filePath = this.resolvePath(sessionId);
    if (!fs.existsSync(filePath)) {
      return defaultState(sessionId);
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<TracePersistedState> & Record<string, unknown>;
      return {
        ...defaultState(sessionId),
        sessionId,
        activeBranchId: typeof parsed.activeBranchId === 'string' ? parsed.activeBranchId : 'branch-main',
        userRequests: parsed.userRequests ?? [],
        branches: parsed.branches ?? [],
      };
    } catch (error) {
      console.error(`[TraceStateStore] Failed to read ${filePath}`, error);
      return defaultState(sessionId);
    }
  }

  write(state: TracePersistedState): TracePersistedState {
    const filePath = this.resolvePath(state.sessionId);
    const nextState: TracePersistedState = {
      ...state,
      updatedAt: nowIso(),
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(nextState, null, 2), 'utf-8');
    return nextState;
  }

  ensureRunRequest(input: {
    sessionId: string;
    runId: string;
    prompt: string;
    traceLaneId: string;
  }): TracePersistedState {
    const state = this.read(input.sessionId);
    if (state.userRequests.some((request) => (
      request.revisions.some((revision) => revision.resultingTraceLaneIds.includes(input.traceLaneId))
    ))) {
      return state;
    }

    const requestId = `request-${input.runId}`;
    const revisionId = `revision-${input.runId}`;
    const branchId = state.activeBranchId || 'branch-main';
    const createdAt = nowIso();
    const revision: UserRequestRevision = {
      id: revisionId,
      requestId,
      branchId,
      prompt: input.prompt,
      createdAt,
      resultingTraceLaneIds: [input.traceLaneId],
    };
    const request: UserRequest = {
      id: requestId,
      sessionId: input.sessionId,
      rootRevisionId: revisionId,
      activeRevisionId: revisionId,
      revisions: [revision],
    };
    const branch: RequestBranch = {
      id: branchId,
      revisionId,
      status: 'active',
      traceLaneIds: [input.traceLaneId],
    };
    const group: RequestBranchGroup = {
      id: `branch-group-${requestId}`,
      rootRequestId: requestId,
      activeBranchId: branchId,
      branches: [branch],
    };

    return this.write({
      ...state,
      activeBranchId: branchId,
      userRequests: [...state.userRequests, request],
      branches: [...state.branches, group],
    });
  }

  createRevision(input: {
    sessionId: string;
    runId: string;
    revisionText: string;
    revisionTraceLaneId: string;
  }): TracePersistedState {
    const state = this.read(input.sessionId);
    const branchGroup = state.branches[0];
    const rootRequest = state.userRequests[0];
    const createdAt = nowIso();
    const branchId = generateEventId('branch');
    const revisionId = generateEventId('revision');
    const requestId = rootRequest?.id ?? `request-${input.runId}`;
    const parentRevisionId = rootRequest?.activeRevisionId;
    const revision: UserRequestRevision = {
      id: revisionId,
      requestId,
      branchId,
      parentRevisionId,
      prompt: input.revisionText,
      createdAt,
      resultingTraceLaneIds: [input.revisionTraceLaneId],
    };

    const nextRequest: UserRequest = rootRequest
      ? {
          ...rootRequest,
          activeRevisionId: revisionId,
          revisions: [...rootRequest.revisions, revision],
        }
      : {
          id: requestId,
          sessionId: input.sessionId,
          rootRevisionId: revisionId,
          activeRevisionId: revisionId,
          revisions: [revision],
        };
    const nextBranch: RequestBranch = {
      id: branchId,
      parentBranchId: state.activeBranchId,
      revisionId,
      status: 'active',
      traceLaneIds: [input.revisionTraceLaneId],
    };
    const nextBranchGroup: RequestBranchGroup = branchGroup
      ? {
          ...branchGroup,
          activeBranchId: branchId,
          branches: branchGroup.branches
            .map((branch): RequestBranch => (
              branch.id === state.activeBranchId ? { ...branch, status: 'inactive' } : branch
            ))
            .concat(nextBranch),
        }
      : {
          id: `branch-group-${requestId}`,
          rootRequestId: requestId,
          activeBranchId: branchId,
          branches: [nextBranch],
        };

    return this.write({
      ...state,
      activeBranchId: branchId,
      userRequests: rootRequest
        ? state.userRequests.map((request) => request.id === rootRequest.id ? nextRequest : request)
        : [...state.userRequests, nextRequest],
      branches: branchGroup
        ? state.branches.map((group) => group.id === branchGroup.id ? nextBranchGroup : group)
        : [...state.branches, nextBranchGroup],
    });
  }

  switchBranch(sessionId: string, branchId: string): TracePersistedState {
    const state = this.read(sessionId);
    const hasBranch = state.branches.some((group) => group.branches.some((branch) => branch.id === branchId));
    if (!hasBranch) {
      return state;
    }

    return this.write({
      ...state,
      activeBranchId: branchId,
      branches: state.branches.map((group) => ({
        ...group,
        activeBranchId: group.branches.some((branch) => branch.id === branchId) ? branchId : group.activeBranchId,
        branches: group.branches.map((branch) => ({
          ...branch,
          status: branch.id === branchId ? 'active' : branch.status === 'active' ? 'inactive' : branch.status,
        })),
      })),
    });
  }

  private resolvePath(sessionId: string): string {
    const session = storageAdapter.readSession(sessionId);
    if (!session) {
      throw new Error(`Session not found for trace state: ${sessionId}`);
    }
    const targetPath = path.resolve(session.sessionPath, STORE_FILE);
    if (!runScopedStore.isPathInside(session.sessionPath, targetPath)) {
      throw new Error(`Trace state escaped session directory: ${targetPath}`);
    }
    return targetPath;
  }
}

export const traceStateStore = new TraceStateStore();


