/**
 * StorageAdapter - 存储适配�?
 * 负责管理workspace目录结构和文件读�?
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { readYaml, writeYaml } from '@shared/utils/yaml';
import { readJsonl, appendJsonl } from '@shared/utils/jsonl';
import {
  generateCaseId,
  generateRunId,
  generateSessionId,
  generateEventId,
  nowIso,
  nowMs,
} from '@shared/utils/id';
import type { WorkflowState, WorkflowStage, Blocker } from '@shared/types/workflow';
import type { ActionEvent } from '@shared/types/evidence';

export class StorageAdapter {
  private workspacePath: string;

  constructor() {
    // 确定workspace路径
    if (app.isPackaged) {
      this.workspacePath = path.join(path.dirname(app.getPath('exe')), 'workspace');
    } else {
      // 开发模�?
      this.workspacePath = path.join(app.getAppPath(), 'workspace');
    }
  }

  /**
   * 获取workspace路径
   */
  getWorkspacePath(): string {
    return this.workspacePath;
  }

  /**
   * 初始化workspace目录结构
   */
  async initializeWorkspace(): Promise<void> {
    const dirs = [
      this.workspacePath,
      path.join(this.workspacePath, 'cases'),
      path.join(this.workspacePath, 'common', 'knowledge', 'library', 'sessions'),
      path.join(this.workspacePath, 'common', 'knowledge', 'library', 'bugcards'),
      path.join(this.workspacePath, 'common', 'knowledge', 'library', 'bugfull'),
      path.join(this.workspacePath, 'common', 'knowledge', 'spec', 'objects', 'taxonomy'),
      path.join(this.workspacePath, 'common', 'knowledge', 'spec', 'objects', 'sops'),
      path.join(this.workspacePath, 'common', 'knowledge', 'spec', 'registry'),
      path.join(this.workspacePath, 'common', 'config'),
      path.join(this.workspacePath, 'common', 'skills'),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }
    }
  }

  // ========== Case 管理 ==========

  /**
   * 获取case目录路径
   */
  getCasePath(caseId: string): string {
    return path.join(this.workspacePath, 'cases', caseId);
  }

  /**
   * 创建新的case
   */
  async createCase(input: {
    caseId?: string;
    userGoal: string;
    symptomSummary: string;
  }): Promise<string> {
    const caseId = input.caseId || generateCaseId();
    const casePath = this.getCasePath(caseId);

    // 创建case目录结构
    const dirs = [
      casePath,
      path.join(casePath, 'artifacts'),
      path.join(casePath, 'inputs', 'captures'),
      path.join(casePath, 'inputs', 'references'),
      path.join(casePath, 'runs'),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }
    }

    // 创建case.yaml
    const caseData = {
      case_id: caseId,
      created_at: nowIso(),
      user_goal: input.userGoal,
      symptom_summary: input.symptomSummary,
      current_run: null,
    };
    await writeYaml(path.join(casePath, 'case.yaml'), caseData);

    return caseId;
  }

  /**
   * 读取case数据
   */
  async readCase(caseId: string): Promise<Record<string, unknown> | null> {
    const casePath = path.join(this.getCasePath(caseId), 'case.yaml');
    return readYaml(casePath);
  }

  /**
   * 更新case数据
   */
  async updateCase(caseId: string, data: Record<string, unknown>): Promise<void> {
    const existing = await this.readCase(caseId) || {};
    const casePath = path.join(this.getCasePath(caseId), 'case.yaml');
    await writeYaml(casePath, { ...existing, ...data, updated_at: nowIso() });
  }

  // ========== Run 管理 ==========

  /**
   * 获取run目录路径
   */
  getRunPath(caseId: string, runId: string): string {
    return path.join(this.getCasePath(caseId), 'runs', runId);
  }

  /**
   * 创建新的run
   */
  async createRun(input: {
    caseId: string;
    runId?: string;
    sessionId?: string;
    capturePaths: string[];
  }): Promise<{ runId: string; sessionId: string }> {
    const runId = input.runId || generateRunId();
    const sessionId = input.sessionId || generateSessionId(input.caseId, runId);
    const runPath = this.getRunPath(input.caseId, runId);

    // 创建run目录结构
    const dirs = [
      runPath,
      path.join(runPath, 'artifacts'),
      path.join(runPath, 'artifacts', 'runtime_batons'),
      path.join(runPath, 'artifacts', 'capability_tokens'),
      path.join(runPath, 'artifacts', 'runtime_locks'),
      path.join(runPath, 'notes'),
      path.join(runPath, 'screenshots'),
      path.join(runPath, 'reports'),
      path.join(runPath, 'logs'),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }
    }

    // 创建run.yaml
    const runData = {
      run_id: runId,
      session_id: sessionId,
      case_id: input.caseId,
      created_at: nowIso(),
      coordination_mode: 'staged_handoff',
      orchestration_mode: 'multi_agent',
      runtime: {
        backend: 'local',
        entry_mode: 'cli',
        context_id: 'ctx-orchestrator',
        runtime_owner: 'rdc-debugger',
        session_id: sessionId,
        workflow_stage: 'accepted_intake_initialized',
      },
    };
    await writeYaml(path.join(runPath, 'run.yaml'), runData);

    // 创建capture_refs.yaml
    const captureRefs = {
      captures: input.capturePaths.map((p, i) => ({
        capture_id: `cap-${i === 0 ? 'anomalous' : i === 1 ? 'baseline' : 'fixed'}-${String(i + 1).padStart(3, '0')}`,
        capture_role: i === 0 ? 'anomalous' : i === 1 ? 'baseline' : 'fixed',
        source_path: p,
      })),
    };
    await writeYaml(path.join(runPath, 'capture_refs.yaml'), captureRefs);

    // 创建hypothesis_board.yaml
    const hypothesisBoard = {
      hypothesis_board: {
        session_id: sessionId,
        entry_skill: 'rdc-debugger',
        user_goal: '',
        intake_state: 'handoff_ready',
        current_phase: 'intake',
        current_task: '',
        active_owner: 'rdc-debugger',
        pending_requirements: [],
        blocking_issues: [],
        progress_summary: ['accepted intake complete'],
        next_actions: ['run dispatch_readiness before specialist dispatch'],
        last_updated: nowIso(),
        hypotheses: [],
      },
    };
    await writeYaml(path.join(runPath, 'notes', 'hypothesis_board.yaml'), hypothesisBoard);

    // 更新case的current_run
    await this.updateCase(input.caseId, { current_run: runId });

    // 创建session marker
    const sessionMarkerPath = path.join(
      this.workspacePath,
      'common',
      'knowledge',
      'library',
      'sessions',
      '.current_session'
    );
    await fs.promises.writeFile(sessionMarkerPath, `${sessionId}\n`, 'utf-8');

    return { runId, sessionId };
  }

  /**
   * 读取run数据
   */
  async readRun(caseId: string, runId: string): Promise<Record<string, unknown> | null> {
    const runPath = path.join(this.getRunPath(caseId, runId), 'run.yaml');
    return readYaml(runPath);
  }

  /**
   * 更新run数据
   */
  async updateRun(caseId: string, runId: string, data: Record<string, unknown>): Promise<void> {
    const existing = await this.readRun(caseId, runId) || {};
    const runPath = path.join(this.getRunPath(caseId, runId), 'run.yaml');
    await writeYaml(runPath, { ...existing, ...data, updated_at: nowIso() });
  }

  // ========== Artifact 管理 ==========

  /**
   * 写入artifact
   */
  async writeArtifact(
    caseId: string,
    runId: string,
    artifactName: string,
    data: unknown
  ): Promise<string> {
    const artifactPath = path.join(this.getRunPath(caseId, runId), 'artifacts', artifactName);
    await writeYaml(artifactPath, data);
    return artifactPath;
  }

  /**
   * 读取artifact
   */
  async readArtifact(
    caseId: string,
    runId: string,
    artifactName: string
  ): Promise<Record<string, unknown> | null> {
    const artifactPath = path.join(this.getRunPath(caseId, runId), 'artifacts', artifactName);
    return readYaml(artifactPath);
  }

  // ========== Action Chain ==========

  /**
   * 获取action_chain路径
   */
  getActionChainPath(sessionId: string): string {
    return path.join(
      this.workspacePath,
      'common',
      'knowledge',
      'library',
      'sessions',
      sessionId,
      'action_chain.jsonl'
    );
  }

  /**
   * 追加事件到action_chain
   */
  async appendActionEvent(sessionId: string, event: ActionEvent): Promise<void> {
    const chainPath = this.getActionChainPath(sessionId);
    const dir = path.dirname(chainPath);
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }
    await appendJsonl(chainPath, event);
  }

  /**
   * 读取action_chain
   */
  async readActionChain(sessionId: string): Promise<ActionEvent[]> {
    const chainPath = this.getActionChainPath(sessionId);
    return readJsonl<ActionEvent>(chainPath);
  }

  /**
   * 创建新的事件
   */
  createActionEvent(input: {
    runId: string;
    sessionId: string;
    agentId: string;
    eventType: ActionEvent['event_type'];
    status: ActionEvent['status'];
    payload: Record<string, unknown>;
    refs?: string[];
  }): ActionEvent {
    return {
      schema_version: '2',
      event_id: generateEventId('evt'),
      ts_ms: nowMs(),
      run_id: input.runId,
      session_id: input.sessionId,
      agent_id: input.agentId,
      event_type: input.eventType,
      status: input.status,
      duration_ms: 0,
      refs: input.refs || [],
      payload: input.payload,
    };
  }

  // ========== Workflow State ==========

  /**
   * 获取workflow状�?
   */
  async getWorkflowState(caseId: string, runId: string): Promise<WorkflowState | null> {
    const runData = await this.readRun(caseId, runId);
    if (!runData) return null;

    const runtime = runData.runtime as Record<string, unknown> || {};

    return {
      caseId,
      runId,
      sessionId: runtime.session_id as string || '',
      currentStage: (runtime.workflow_stage as WorkflowStage) || 'preflight_pending',
      previousStages: [],
      entryMode: (runtime.entry_mode as 'cli' | 'mcp') || 'cli',
      backend: (runtime.backend as 'local' | 'remote') || 'local',
      orchestrationMode: 'multi_agent',
      coordinationMode: 'staged_handoff',
      blockers: [],
      lastUpdated: nowIso(),
    };
  }

  /**
   * 更新workflow状�?
   */
  async updateWorkflowStage(
    caseId: string,
    runId: string,
    stage: WorkflowStage,
    blockers: Blocker[] = []
  ): Promise<void> {
    await this.updateRun(caseId, runId, {
      runtime: {
        workflow_stage: stage,
      },
    });

    // 如果有blockers，更新hypothesis_board
    if (blockers.length > 0) {
      const boardPath = path.join(this.getRunPath(caseId, runId), 'notes', 'hypothesis_board.yaml');
      const board = readYaml(boardPath) as Record<string, unknown> || {};
      if (board.hypothesis_board) {
        (board.hypothesis_board as Record<string, unknown>).blocking_issues = blockers;
        (board.hypothesis_board as Record<string, unknown>).last_updated = nowIso();
        await writeYaml(boardPath, board);
      }
    }
  }

  // ========== Session Marker ==========

  /**
   * 获取当前session ID
   */
  async getCurrentSessionId(): Promise<string | null> {
    const markerPath = path.join(
      this.workspacePath,
      'common',
      'knowledge',
      'library',
      'sessions',
      '.current_session'
    );
    if (!fs.existsSync(markerPath)) return null;
    const content = await fs.promises.readFile(markerPath, 'utf-8');
    const sessionId = content.trim();
    return sessionId || null;
  }

  /**
   * 设置当前session ID
   */
  async setCurrentSessionId(sessionId: string): Promise<void> {
    const markerPath = path.join(
      this.workspacePath,
      'common',
      'knowledge',
      'library',
      'sessions',
      '.current_session'
    );
    const dir = path.dirname(markerPath);
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }
    await fs.promises.writeFile(markerPath, `${sessionId}\n`, 'utf-8');
  }
}

// 单例导出
export const storageAdapter = new StorageAdapter();

