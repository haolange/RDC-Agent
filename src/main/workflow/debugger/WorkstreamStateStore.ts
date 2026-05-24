import * as fs from 'fs';
import * as path from 'path';
import type {
  PlanStatus,
  RequestBranch,
  RequestBranchGroup,
  UserRequest,
  UserRequestRevision,
} from '@shared/types/workstream';
import { generateEventId, nowIso } from '@shared/utils/id';
import { storageAdapter } from '../../sessions/StorageAdapter';
import { runScopedStore } from './RunScopedStore';

const STORE_FILE = 'agent-workstream-state.json';

export interface WorkstreamPlanRecord {
  planId: string;
  runId: string;
  workstreamId: string;
  status: PlanStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WorkstreamPersistedState {
  schemaVersion: '1';
  sessionId: string;
  activeBranchId: string;
  latestDisplayedPlanId?: string;
  latestAcceptedPlanId?: string;
  userRequests: UserRequest[];
  branches: RequestBranchGroup[];
  plans: WorkstreamPlanRecord[];
  updatedAt: string;
}

const defaultState = (sessionId: string): WorkstreamPersistedState => ({
  schemaVersion: '1',
  sessionId,
  activeBranchId: 'branch-main',
  userRequests: [],
  branches: [],
  plans: [],
  updatedAt: nowIso(),
});

export class WorkstreamStateStore {
  read(sessionId: string): WorkstreamPersistedState {
    const filePath = this.resolvePath(sessionId);
    if (!fs.existsSync(filePath)) {
      return defaultState(sessionId);
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<WorkstreamPersistedState>;
      return {
        ...defaultState(sessionId),
        ...parsed,
        sessionId,
        userRequests: parsed.userRequests ?? [],
        branches: parsed.branches ?? [],
        plans: parsed.plans ?? [],
      };
    } catch (error) {
      console.error(`[WorkstreamStateStore] Failed to read ${filePath}`, error);
      return defaultState(sessionId);
    }
  }

  write(state: WorkstreamPersistedState): WorkstreamPersistedState {
    const filePath = this.resolvePath(state.sessionId);
    const nextState: WorkstreamPersistedState = {
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
    planId?: string;
    workstreamId: string;
  }): WorkstreamPersistedState {
    const state = this.read(input.sessionId);
    if (state.userRequests.some((request) => (
      request.revisions.some((revision) => revision.resultingWorkstreamIds.includes(input.workstreamId))
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
      resultingWorkstreamIds: [input.workstreamId],
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
      workstreamIds: [input.workstreamId],
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
      plans: input.planId
        ? this.upsertPlan(state.plans, {
            planId: input.planId,
            runId: input.runId,
            workstreamId: input.workstreamId,
            status: 'awaiting_approval',
            createdAt,
            updatedAt: createdAt,
          })
        : state.plans,
      latestDisplayedPlanId: input.planId ?? state.latestDisplayedPlanId,
    });
  }

  markPlan(sessionId: string, planId: string, status: PlanStatus): WorkstreamPersistedState {
    const state = this.read(sessionId);
    const now = nowIso();
    return this.write({
      ...state,
      latestDisplayedPlanId: status === 'awaiting_approval' ? planId : state.latestDisplayedPlanId,
      latestAcceptedPlanId: status === 'accepted' ? planId : state.latestAcceptedPlanId,
      plans: state.plans.map((plan) => plan.planId === planId ? { ...plan, status, updatedAt: now } : plan),
    });
  }

  registerPlan(input: {
    sessionId: string;
    planId: string;
    runId: string;
    workstreamId: string;
    status: PlanStatus;
  }): WorkstreamPersistedState {
    const state = this.read(input.sessionId);
    const now = nowIso();
    return this.write({
      ...state,
      latestDisplayedPlanId: input.status === 'awaiting_approval' ? input.planId : state.latestDisplayedPlanId,
      latestAcceptedPlanId: input.status === 'accepted' ? input.planId : state.latestAcceptedPlanId,
      plans: this.upsertPlan(state.plans, {
        planId: input.planId,
        runId: input.runId,
        workstreamId: input.workstreamId,
        status: input.status,
        createdAt: now,
        updatedAt: now,
      }),
    });
  }

  createRevision(input: {
    sessionId: string;
    runId: string;
    previousPlanId: string;
    revisionText: string;
    revisionWorkstreamId: string;
  }): WorkstreamPersistedState {
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
      resultingWorkstreamIds: [input.revisionWorkstreamId],
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
      workstreamIds: [input.revisionWorkstreamId],
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
      latestDisplayedPlanId: undefined,
      userRequests: rootRequest
        ? state.userRequests.map((request) => request.id === rootRequest.id ? nextRequest : request)
        : [...state.userRequests, nextRequest],
      branches: branchGroup
        ? state.branches.map((group) => group.id === branchGroup.id ? nextBranchGroup : group)
        : [...state.branches, nextBranchGroup],
      plans: state.plans.map((plan) => (
        plan.planId === input.previousPlanId
          ? { ...plan, status: 'needs_revision', updatedAt: createdAt }
          : plan
      )),
    });
  }

  switchBranch(sessionId: string, branchId: string): WorkstreamPersistedState {
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

  private upsertPlan(plans: WorkstreamPlanRecord[], plan: WorkstreamPlanRecord): WorkstreamPlanRecord[] {
    const index = plans.findIndex((entry) => entry.planId === plan.planId);
    if (index < 0) {
      return [...plans, plan];
    }
    const next = [...plans];
    next[index] = {
      ...next[index],
      ...plan,
      createdAt: next[index].createdAt,
    };
    return next;
  }

  private resolvePath(sessionId: string): string {
    const session = storageAdapter.readSession(sessionId);
    if (!session) {
      throw new Error(`Session not found for workstream state: ${sessionId}`);
    }
    const targetPath = path.resolve(session.sessionPath, STORE_FILE);
    if (!runScopedStore.isPathInside(session.sessionPath, targetPath)) {
      throw new Error(`Workstream state escaped session directory: ${targetPath}`);
    }
    return targetPath;
  }
}

export const workstreamStateStore = new WorkstreamStateStore();
