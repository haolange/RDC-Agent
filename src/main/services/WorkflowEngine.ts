/**
 * WorkflowEngine - 工作流状态机引擎
 * 实现12阶段状态机 + 受控回转机制
 */

import { BrowserWindow } from 'electron';
import type {
  WorkflowStage,
  WorkflowState,
  BacktrackRule,
  BacktrackContext,
  GateResult,
  Blocker,
} from '@shared/types/workflow';
import { MAIN_STAGES } from '@shared/constants/stages';
import { storageAdapter } from './StorageAdapter';
import { nowIso } from '@shared/utils/id';

// 回转规则定义
const BACKTRACK_RULES: BacktrackRule[] = [
  {
    fromStage: 'waiting_for_specialist_brief',
    toStage: 'waiting_for_specialist_brief', // redispatch
    trigger: 'specialist_timeout',
    maxRetries: 3,
    requiresUserConfirmation: false,
  },
  {
    fromStage: 'specialist_briefs_collected',
    toStage: 'waiting_for_specialist_brief',
    trigger: 'skeptic_rejected',
    maxRetries: 2,
    requiresUserConfirmation: true,
  },
  {
    fromStage: 'intake_gate_passed',
    toStage: 'intent_gate_passed',
    trigger: 'triage_low_confidence',
    maxRetries: 1,
    requiresUserConfirmation: true,
  },
];

// 阶段转换规则
const STAGE_TRANSITIONS: Record<WorkflowStage, WorkflowStage[]> = {
  'preflight_pending': ['intent_gate_passed'],
  'intent_gate_passed': ['entry_gate_passed'],
  'entry_gate_passed': ['accepted_intake_initialized'],
  'accepted_intake_initialized': ['intake_gate_passed'],
  'intake_gate_passed': ['waiting_for_specialist_brief'],
  'waiting_for_specialist_brief': ['specialist_briefs_collected', 'validation_blocked'],
  'specialist_briefs_collected': ['expert_investigation_complete', 'waiting_for_specialist_brief'],
  'expert_investigation_complete': ['fix_verification_complete', 'validation_blocked'],
  'fix_verification_complete': ['skeptic_ready', 'validation_blocked'],
  'skeptic_ready': ['curator_ready', 'fix_verification_complete'],
  'curator_ready': ['finalized'],
  'finalized': [],
  'validation_blocked': ['expert_investigation_complete', 'fix_verification_complete'],
  'awaiting_user_input': ['intake_gate_passed', 'waiting_for_specialist_brief'],
};

export class WorkflowEngine {
  private state: WorkflowState | null = null;
  private backtrackCounts: Map<string, number> = new Map();
  private mainWindow: BrowserWindow | null = null;

  /**
   * 设置主窗口引用
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * 获取当前状态
   */
  getState(): WorkflowState | null {
    return this.state;
  }

  /**
   * 加载状态（从存储）
   */
  async loadState(caseId: string, runId: string): Promise<WorkflowState | null> {
    this.state = await storageAdapter.getWorkflowState(caseId, runId);
    return this.state;
  }

  /**
   * 初始化新工作流
   */
  async initialize(input: {
    caseId: string;
    runId: string;
    sessionId: string;
  }): Promise<WorkflowState> {
    this.state = {
      caseId: input.caseId,
      runId: input.runId,
      sessionId: input.sessionId,
      currentStage: 'accepted_intake_initialized',
      previousStages: [],
      entryMode: 'cli',
      backend: 'local',
      orchestrationMode: 'multi_agent',
      coordinationMode: 'staged_handoff',
      blockers: [],
      lastUpdated: nowIso(),
    };

    // 记录初始状态
    await this.recordStageTransition('preflight_pending', 'accepted_intake_initialized');

    return this.state;
  }

  /**
   * 推进到下一阶段
   */
  async advanceStage(): Promise<GateResult> {
    if (!this.state) {
      return this.createErrorResult('NO_ACTIVE_WORKFLOW', 'No active workflow state');
    }

    const currentStage = this.state.currentStage;
    const allowedTransitions = STAGE_TRANSITIONS[currentStage];

    if (!allowedTransitions || allowedTransitions.length === 0) {
      return this.createErrorResult('NO_VALID_TRANSITION', `No valid transition from ${currentStage}`);
    }

    // 选择下一个阶段
    const nextStage = allowedTransitions[0];

    // 执行阶段转换
    const result = await this.transitionTo(nextStage);

    return result;
  }

  /**
   * 转换到指定阶段
   */
  async transitionTo(targetStage: WorkflowStage): Promise<GateResult> {
    if (!this.state) {
      return this.createErrorResult('NO_ACTIVE_WORKFLOW', 'No active workflow state');
    }

    const currentStage = this.state.currentStage;
    const allowedTransitions = STAGE_TRANSITIONS[currentStage];

    // 验证转换是否允许
    if (!allowedTransitions.includes(targetStage)) {
      return this.createErrorResult(
        'INVALID_TRANSITION',
        `Cannot transition from ${currentStage} to ${targetStage}`
      );
    }

    // 记录转换事件
    await this.recordStageTransition(currentStage, targetStage);

    // 更新状态
    const previousStage = this.state.currentStage;
    this.state.previousStages.push(previousStage);
    this.state.currentStage = targetStage;
    this.state.lastUpdated = nowIso();

    // 持久化
    await storageAdapter.updateWorkflowStage(
      this.state.caseId,
      this.state.runId,
      targetStage,
      this.state.blockers
    );

    // 通知UI
    this.notifyStateChanged();

    return {
      stage: targetStage,
      status: 'passed',
      blockers: [],
      refs: [],
      paths: {},
    };
  }

  /**
   * 执行回转
   */
  async backtrack(context: BacktrackContext): Promise<GateResult> {
    if (!this.state) {
      return this.createErrorResult('NO_ACTIVE_WORKFLOW', 'No active workflow state');
    }

    // 查找匹配的回转规则
    const rule = BACKTRACK_RULES.find(
      r => r.fromStage === this.state!.currentStage && r.trigger === context.trigger
    );

    if (!rule) {
      return this.createErrorResult(
        'NO_BACKTRACK_RULE',
        `No backtrack rule for trigger ${context.trigger} from ${this.state.currentStage}`
      );
    }

    // 检查回转次数
    const ruleKey = `${rule.fromStage}-${rule.trigger}`;
    const currentCount = this.backtrackCounts.get(ruleKey) || 0;
    if (currentCount >= rule.maxRetries) {
      return this.createErrorResult(
        'MAX_RETRIES_EXCEEDED',
        `Max retries (${rule.maxRetries}) exceeded for ${rule.trigger}`
      );
    }

    // 如果需要用户确认
    if (rule.requiresUserConfirmation) {
      // TODO: 发送用户确认请求
      // 这里简化处理，直接继续
    }

    // 记录回转事件
    const event = storageAdapter.createActionEvent({
      runId: this.state.runId,
      sessionId: this.state.sessionId,
      agentId: 'rdc-debugger',
      eventType: 'workflow_stage_transition',
      status: 'ok',
      payload: {
        from_stage: this.state.currentStage,
        to_stage: rule.toStage,
        reason: 'controlled_backtrack',
        trigger: context.trigger,
        context: context.details,
      },
    });
    await storageAdapter.appendActionEvent(this.state.sessionId, event);

    // 更新回转计数
    this.backtrackCounts.set(ruleKey, currentCount + 1);

    // 执行转换
    return this.transitionTo(rule.toStage);
  }

  /**
   * 进入阻断状态
   */
  async enterBlockedState(blocker: Blocker): Promise<void> {
    if (!this.state) return;

    this.state.blockers.push(blocker);

    // 如果是critical blocker，进入validation_blocked
    const hasCriticalBlocker = this.state.blockers.some(b => b.code.startsWith('BLOCKED_'));
    if (hasCriticalBlocker && this.state.currentStage !== 'validation_blocked') {
      await this.transitionTo('validation_blocked');
    }
  }

  /**
   * 清除阻断
   */
  async clearBlocker(blockerCode: string): Promise<void> {
    if (!this.state) return;

    this.state.blockers = this.state.blockers.filter(b => b.code !== blockerCode);
    await storageAdapter.updateWorkflowStage(
      this.state.caseId,
      this.state.runId,
      this.state.currentStage,
      this.state.blockers
    );
  }

  /**
   * 检查是否可以进入下一阶段
   */
  canAdvance(): { canAdvance: boolean; reason?: string } {
    if (!this.state) {
      return { canAdvance: false, reason: 'No active workflow' };
    }

    // 检查是否有未解决的blocker
    if (this.state.blockers.length > 0) {
      return { canAdvance: false, reason: 'Has unresolved blockers' };
    }

    // 检查是否在validation_blocked状态
    if (this.state.currentStage === 'validation_blocked') {
      return { canAdvance: false, reason: 'In blocked state' };
    }

    // 检查是否已finalized
    if (this.state.currentStage === 'finalized') {
      return { canAdvance: false, reason: 'Already finalized' };
    }

    return { canAdvance: true };
  }

  /**
   * 获取阶段索引
   */
  getStageIndex(stage: WorkflowStage): number {
    return MAIN_STAGES.indexOf(stage);
  }

  /**
   * 是否在主流程中
   */
  isInMainFlow(): boolean {
    if (!this.state) return false;
    return MAIN_STAGES.includes(this.state.currentStage);
  }

  // ========== 私有方法 ==========

  private async recordStageTransition(
    fromStage: WorkflowStage,
    toStage: WorkflowStage
  ): Promise<void> {
    if (!this.state) return;

    const event = storageAdapter.createActionEvent({
      runId: this.state.runId,
      sessionId: this.state.sessionId,
      agentId: 'rdc-debugger',
      eventType: 'workflow_stage_transition',
      status: 'ok',
      payload: {
        from_stage: fromStage,
        to_stage: toStage,
        timestamp: nowIso(),
      },
    });

    await storageAdapter.appendActionEvent(this.state.sessionId, event);
  }

  private createErrorResult(code: string, reason: string): GateResult {
    return {
      stage: this.state?.currentStage || 'unknown',
      status: 'blocked',
      blockers: [{ code, reason, refs: [], detectedAt: nowIso() }],
      refs: [],
      paths: {},
    };
  }

  private notifyStateChanged(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('workflow:stateChanged', this.state);
      if (this.state) {
        this.mainWindow.webContents.send('workflow:stageChanged', {
          stage: this.state.currentStage,
          blockers: this.state.blockers,
        });
      }
    }
  }
}

// 单例导出
export const workflowEngine = new WorkflowEngine();
