/**
 * HarnessController - Harness控制器
 * 核心改进：从"结尾审计器"升级为"过程控制器"
 * 实现：前置Gate层 + 运行时监控层
 */

import type {
  WorkflowStage,
  GateResult,
  Blocker,
} from '@shared/types/workflow';
import type { ActionEvent } from '@shared/types/evidence';
// 导入新 Session 类型（Task 1 已完成）
import type { CaptureDescriptor } from '@shared/types/session';
import type { ReplayDeviceEntry } from '@shared/types/device';
import { storageAdapter } from './StorageAdapter';
// 导入 settingsService（Task 6 已完成）
import { settingsService } from './SettingsService';
import { debuggerLlmService } from './DebuggerLlmService';
import { nowIso, nowMs } from '@shared/utils/id';

// Gate输入类型
interface EntryGateInput {
  capturePaths: string[];
  platform: string;
  entryMode: 'cli' | 'mcp';
  backend: 'local' | 'remote';
  // 新增字段（Task 4c）
  mode?: 'debugger' | 'analyzer' | 'optimizer';
  captures?: CaptureDescriptor[];
  replayDevice?: ReplayDeviceEntry;
}

interface IntakeGateInput {
  caseInput: Record<string, unknown>;
  captureRefs: Array<{ capture_id: string; capture_role: string }>;
}

interface DispatchGateInput {
  targetAgent: string;
  objective: string;
  orchestrationMode: string;
}

interface VerifyGateInput {
  fixVerificationData: Record<string, unknown>;
}

/**
 * HarnessController - 过程控制器
 */
export class HarnessController {
  private _enabled: boolean = true;

  /**
   * 检查控制器是否启用
   */
  isEnabled(): boolean {
    return this._enabled;
  }

  /**
   * 启用/禁用控制器
   */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
  }

  // ========== 前置Gate层 ==========

  /**
   * EntryGate - 入口闸门
   * 检查：.rdc文件存在性、平台模式、环境配置
   */
  async executeEntryGate(input: EntryGateInput): Promise<GateResult> {
    const blockers: Blocker[] = [];

    // 检查capture文件
    if (!input.capturePaths || input.capturePaths.length === 0) {
      blockers.push(this.createBlocker('BLOCKED_MISSING_CAPTURE', 'No .rdc capture files provided'));
    }

    // 检查capture文件是否存在
    for (const capturePath of input.capturePaths || []) {
      const fs = await import('fs');
      if (!fs.existsSync(capturePath)) {
        blockers.push(this.createBlocker(
          'BLOCKED_CAPTURE_IMPORT_FAILED',
          `Capture file not found: ${capturePath}`,
          [capturePath]
        ));
      }
    }

    // 检查平台模式支持
    if (input.backend === 'remote') {
      // Remote模式额外检查
      // TODO: 添加remote前置检查
    }
  
    // === Task 4c: LLM Key 检查（仅 debugger 模式）===
    // Debugger 模式需要 LLM 可用；Analyzer/Optimizer 占位页不要求 LLM
    if (input.mode === 'debugger') {
      if (!settingsService.hasConfiguredProvider()) {
        blockers.push(this.createBlocker(
          'LLM_KEY_MISSING',
          'At least one configured provider is required for Debugger mode',
          ['settings:models']
        ));
      }

      blockers.push(...debuggerLlmService.getRouteBlockers(['rdc-debugger'], 'plan'));
    }
    // Analyzer/Optimizer 模式不要求 LLM key（当前为占位页）
  
    // === Task 4c: Remote Capture Blocker ===
    // 检查是否有 remote capture 但缺少 remote device/配置
    if (input.captures && input.captures.length > 0) {
      const hasRemoteCapture = input.captures.some(c => c.backendHint === 'remote');
      if (hasRemoteCapture && (!input.replayDevice || input.replayDevice.type === 'local' || input.replayDevice.status !== 'online')) {
        blockers.push(this.createBlocker(
          'REMOTE_CONFIG_MISSING',
          'Remote capture requires an online Replay Device',
          []
        ));
      }
    }
  
    return this.createGateResult('entry_gate', blockers);
  }

  /**
   * IntakeGate - Intake闸门
   * 检查：数据完整性、参照契约
   */
  async executeIntakeGate(caseId: string, runId: string, input: IntakeGateInput): Promise<GateResult> {
    const blockers: Blocker[] = [];

    // 检查case_input完整性
    const requiredFields = ['session', 'symptom', 'captures'];
    for (const field of requiredFields) {
      if (!input.caseInput[field]) {
        blockers.push(this.createBlocker(
          'BLOCKED_INTAKE_GATE_REQUIRED',
          `Missing required field in case_input: ${field}`
        ));
      }
    }

    // 检查capture_refs
    if (!input.captureRefs || input.captureRefs.length === 0) {
      blockers.push(this.createBlocker(
        'BLOCKED_INTAKE_GATE_REQUIRED',
        'No capture references defined'
      ));
    }

    // 检查fix_reference（改进：强制要求）
    const referenceContract = input.caseInput.reference_contract as Record<string, unknown>;
    if (!referenceContract || !referenceContract.source_refs) {
      blockers.push(this.createBlocker(
        'BLOCKED_MISSING_FIX_REFERENCE',
        'Missing fix_reference for verification. Provide description + comparison/baseline .rdc'
      ));
    }

    // 写入intake_gate.yaml
    await storageAdapter.writeArtifact(caseId, runId, 'intake_gate.yaml', {
      schema_version: '2',
      generated_at: nowIso(),
      status: blockers.length === 0 ? 'passed' : 'blocked',
      checks: requiredFields.map(f => ({
        id: `check_${f}`,
        result: input.caseInput[f] ? 'pass' : 'fail',
      })),
      blocking_codes: blockers.map(b => b.code),
    });

    return this.createGateResult('intake_gate', blockers);
  }

  /**
   * DispatchGate - 分派闸门
   * 检查：模式一致性、执行证据
   */
  async executeDispatchGate(_caseId: string, _runId: string, input: DispatchGateInput): Promise<GateResult> {
    const blockers: Blocker[] = [];

    // 检查orchestration_mode
    if (input.orchestrationMode === 'multi_agent') {
      // 检查是否有之前的dispatch证据
      const sessionId = await storageAdapter.getCurrentSessionId();
      if (sessionId) {
        const events = await storageAdapter.readActionChain(sessionId);
        const dispatchEvents = events.filter(e => e.event_type === 'dispatch');

        if (dispatchEvents.length === 0) {
          // 这是第一次dispatch，允许通过
        } else {
          // 检查之前的dispatch是否已完成
          const pendingDispatch = dispatchEvents.find(e => e.status === 'sent');
          if (pendingDispatch) {
            blockers.push(this.createBlocker(
              'BLOCKED_SPECIALIST_FEEDBACK_TIMEOUT',
              'Previous dispatch still pending feedback',
              [pendingDispatch.event_id]
            ));
          }
        }
      }
    }

    // 检查target_agent有效性
    const validAgents = [
      'triage_agent', 'capture_repro_agent', 'pass_graph_pipeline_agent',
      'pixel_forensics_agent', 'shader_ir_agent', 'driver_device_agent',
      'skeptic_agent', 'curator_agent',
    ];
    if (!validAgents.includes(input.targetAgent)) {
      blockers.push(this.createBlocker(
        'BLOCKED_UNKNOWN_SPECIALIST',
        `Unknown specialist: ${input.targetAgent}`,
        [input.targetAgent]
      ));
    }

    return this.createGateResult('dispatch_gate', blockers);
  }

  /**
   * VerifyGate - 验证闸门
   * 检查：fix_verification schema完整性
   */
  async executeVerifyGate(_caseId: string, _runId: string, input: VerifyGateInput): Promise<GateResult> {
    const blockers: Blocker[] = [];

    // 检查必需字段
    const requiredFields = [
      'verdict',
      'verification_mode',
      'verification_confidence',
      'structural_verification',
      'semantic_verification',
      'overall_result',
    ];

    for (const field of requiredFields) {
      if (input.fixVerificationData[field] === undefined) {
        blockers.push(this.createBlocker(
          'BLOCKED_FIX_VERIFICATION_FAILED',
          `Missing required field in fix_verification: ${field}`
        ));
      }
    }

    // 检查structural_verification
    const structural = input.fixVerificationData.structural_verification as Record<string, unknown>;
    if (structural && structural.status !== 'passed') {
      blockers.push(this.createBlocker(
        'BLOCKED_FIX_VERIFICATION_FAILED',
        'Structural verification failed'
      ));
    }

    // 检查semantic_verification
    const semantic = input.fixVerificationData.semantic_verification as Record<string, unknown>;
    if (semantic && semantic.status === 'fallback_only') {
      // 允许但记录警告
      console.warn('Semantic verification is fallback_only');
    }

    return this.createGateResult('verify_gate', blockers);
  }

  // ========== 运行时监控层 ==========

  /**
   * 模式一致性检查
   * 验证声明的multi_agent是否有dispatch证据
   */
  async checkModeConsistency(caseId: string, runId: string): Promise<{
    isConsistent: boolean;
    issues: string[];
  }> {
    const issues: string[] = [];

    // 读取runtime_topology
    const topology = await storageAdapter.readArtifact(caseId, runId, 'runtime_topology.yaml');
    if (!topology) {
      issues.push('runtime_topology.yaml not found');
      return { isConsistent: false, issues };
    }

    const orchestrationMode = (topology as Record<string, unknown>).orchestration_mode;

    if (orchestrationMode === 'multi_agent') {
      // 检查dispatch证据
      const sessionId = await storageAdapter.getCurrentSessionId();
      if (sessionId) {
        const events = await storageAdapter.readActionChain(sessionId);
        const dispatchEvents = events.filter(e => e.event_type === 'dispatch');

        if (dispatchEvents.length === 0) {
          issues.push('multi_agent declared but no dispatch events found');
        }
      }
    }

    return { isConsistent: issues.length === 0, issues };
  }

  /**
   * Stage推进校验
   * 验证workflow_stage是否与action_chain一致
   */
  async validateStageConsistency(caseId: string, runId: string): Promise<{
    isConsistent: boolean;
    currentStage: WorkflowStage | null;
    expectedStage: WorkflowStage | null;
  }> {
    const runData = await storageAdapter.readRun(caseId, runId);
    if (!runData) {
      return { isConsistent: false, currentStage: null, expectedStage: null };
    }

    const runtime = runData.runtime as Record<string, unknown>;
    const declaredStage = runtime?.workflow_stage as WorkflowStage;

    // 从action_chain推断期望的stage
    const sessionId = await storageAdapter.getCurrentSessionId();
    if (!sessionId) {
      return { isConsistent: true, currentStage: declaredStage, expectedStage: declaredStage };
    }

    const events = await storageAdapter.readActionChain(sessionId);
    const stageEvents = events.filter(e => e.event_type === 'workflow_stage_transition');

    if (stageEvents.length === 0) {
      return { isConsistent: true, currentStage: declaredStage, expectedStage: declaredStage };
    }

    // 获取最新的stage
    const lastStageEvent = stageEvents[stageEvents.length - 1];
    const expectedStage = lastStageEvent.payload?.to_stage as WorkflowStage;

    return {
      isConsistent: declaredStage === expectedStage,
      currentStage: declaredStage,
      expectedStage,
    };
  }

  /**
   * 工具执行包装器
   * 所有live rd.*调用必须经过此包装器，自动写入action_chain
   */
  async wrapToolExecution(input: {
    toolName: string;
    args: Record<string, unknown>;
    agentId: string;
    sessionId: string;
    runId: string;
    turnId?: string;
    execute: () => Promise<{ ok: boolean; data?: unknown; error?: unknown }>;
  }): Promise<{ ok: boolean; data?: unknown; error?: unknown }> {
    const startTime = nowMs();

    // 执行工具
    const result = await input.execute();

    const duration = nowMs() - startTime;

    // 记录到action_chain
    const event: ActionEvent = {
      schema_version: '2',
      event_id: `evt-tool-${nowMs()}`,
      turn_id: input.turnId,
      ts_ms: startTime,
      run_id: input.runId,
      session_id: input.sessionId,
      agent_id: input.agentId,
      event_type: 'tool_execution',
      status: result.ok ? 'ok' : 'error',
      duration_ms: duration,
      refs: [],
      payload: {
        tool_name: input.toolName,
        args: input.args,
        result: result.ok ? 'success' : 'failed',
        data: result.ok ? result.data : undefined,
        artifacts: result.ok ? (result as { artifacts?: unknown }).artifacts : undefined,
        error: result.error,
      },
    };

    await storageAdapter.appendActionEvent(input.sessionId, event);

    return result;
  }

  /**
   * 早期Blocker检测
   * 实时检测blocking_issues，而非等到final audit
   */
  async detectEarlyBlockers(caseId: string, runId: string): Promise<{
    hasBlockers: boolean;
    blockers: Blocker[];
  }> {
    const blockers: Blocker[] = [];

    // 检查hypothesis_board中的blocking_issues
    const runPath = storageAdapter.getRunPath(caseId, runId);
    const fs = await import('fs');
    const boardPath = `${runPath}/notes/hypothesis_board.yaml`;

    if (fs.existsSync(boardPath)) {
      const yaml = await import('yaml');
      const content = await fs.promises.readFile(boardPath, 'utf-8');
      const board = yaml.parse(content);

      if (board?.hypothesis_board?.blocking_issues) {
        for (const issue of board.hypothesis_board.blocking_issues) {
          blockers.push(this.createBlocker(
            issue.code || 'BLOCKER_DETECTED',
            issue.reason || 'Blocking issue detected',
            issue.refs || []
          ));
        }
      }
    }

    // 检查freeze_state
    const freezePath = `${runPath}/artifacts/freeze_state.yaml`;
    if (fs.existsSync(freezePath)) {
      const yaml = await import('yaml');
      const content = await fs.promises.readFile(freezePath, 'utf-8');
      const freeze = yaml.parse(content);

      if (freeze?.status === 'frozen') {
        blockers.push(this.createBlocker(
          'BLOCKED_FREEZE_STATE_ACTIVE',
          'Run is frozen due to process deviation',
          freeze.blocking_codes || []
        ));
      }
    }

    return { hasBlockers: blockers.length > 0, blockers };
  }

  // ========== 辅助方法 ==========

  private createBlocker(code: string, reason: string, refs: string[] = []): Blocker {
    return {
      code,
      reason,
      refs,
      detectedAt: nowIso(),
    };
  }

  private createGateResult(stage: string, blockers: Blocker[]): GateResult {
    return {
      stage,
      status: blockers.length === 0 ? 'passed' : 'blocked',
      blockers,
      refs: [],
      paths: {},
    };
  }
}

// 单例导出
export const harnessController = new HarnessController();



