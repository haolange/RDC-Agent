/**
 * intakeGateNode.ts - Intake Gate 阶段节点
 * 委托 HarnessController 执行 IntakeGate 检查
 * 验证数据完整性
 */

import * as fs from 'fs';
import * as path from 'path';
import type { GraphState } from '../../../shared/types/workflow';
import { storageAdapter } from '../StorageAdapter';
import { harnessController } from '../HarnessController';
import { BLOCKER_CODES } from '../../../shared/constants/blockers';
import {
  createStageTransitionEvidence,
  createToolExecutionEvidence,
  nowIso,
} from './utils';

/** Intake Gate 配置 */
export interface IntakeGateConfig {
  /** 是否强制要求 fix_reference */
  requireFixReference?: boolean;
}

/**
 * 读取 case_input.yaml
 */
async function readCaseInput(
  caseId: string,
  runId: string
): Promise<Record<string, unknown> | null> {
  try {
    const runPath = storageAdapter.getRunPath(caseId, runId);
    const caseInputPath = path.join(runPath, 'case_input.yaml');
    
    if (!fs.existsSync(caseInputPath)) {
      return null;
    }

    const content = fs.readFileSync(caseInputPath, 'utf-8');
    const yaml = await import('yaml');
    return yaml.parse(content);
  } catch {
    return null;
  }
}

/**
 * 读取 capture_refs
 */
function extractCaptureRefs(
  caseInput: Record<string, unknown> | null
): Array<{ capture_id: string; capture_role: string }> {
  if (!caseInput) return [];

  const captures = caseInput.captures as Array<{ capture_id: string; capture_role: string; path: string }>;
  if (!Array.isArray(captures)) return [];

  return captures.map(c => ({
    capture_id: c.capture_id,
    capture_role: c.capture_role,
  }));
}

/**
 * Intake Gate 节点
 * 执行 IntakeGate 检查
 */
export async function intakeGateNode(
  state: GraphState,
  config: IntakeGateConfig = {}
): Promise<Partial<GraphState>> {
  const evidenceChain: GraphState['evidenceChain'] = [];
  const blockers: GraphState['blockers'] = [...state.blockers];

  // 记录进入 intake_gate 阶段
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage,
      },
      'intake_gate_passed'
    )
  );

  try {
    // 读取 case_input
    const caseInput = await readCaseInput(state.caseId, state.runId);
    const captureRefs = extractCaptureRefs(caseInput);

    // 调用 HarnessController 执行 IntakeGate 检查
    const gateResult = await harnessController.executeIntakeGate(
      state.caseId,
      state.runId,
      {
        caseInput: caseInput || {},
        captureRefs,
      }
    );

    // 记录 Gate 执行结果
    evidenceChain.push(
      createToolExecutionEvidence(
        { sessionId: state.sessionId, runId: state.runId },
        'intake_gate_check',
        {
          caseId: state.caseId,
          runId: state.runId,
          captureRefCount: captureRefs.length,
        },
        {
          ok: gateResult.status === 'passed',
          data: { stage: gateResult.stage, status: gateResult.status },
        },
        'rdc-debugger'
      )
    );

    // 处理 Gate 结果中的 blockers
    if (gateResult.blockers && gateResult.blockers.length > 0) {
      for (const blocker of gateResult.blockers) {
        // 避免重复添加相同的 blocker
        const exists = blockers.some(b => b.code === blocker.code && !b.resolvedAt);
        if (!exists) {
          blockers.push({
            ...blocker,
            detectedAt: blocker.detectedAt || nowIso(),
          });
        }
      }
    }

    // 额外的 fix_reference 检查（如果配置要求）
    if (config.requireFixReference !== false) {
      const referenceContract = caseInput?.reference_contract as Record<string, unknown> | undefined;
      if (!referenceContract || !referenceContract.source_refs) {
        const exists = blockers.some(
          b => b.code === BLOCKER_CODES.BLOCKED_MISSING_FIX_REFERENCE.code && !b.resolvedAt
        );
        if (!exists) {
          blockers.push({
            code: BLOCKER_CODES.BLOCKED_MISSING_FIX_REFERENCE.code,
            reason: BLOCKER_CODES.BLOCKED_MISSING_FIX_REFERENCE.description,
            refs: [],
            detectedAt: nowIso(),
          });
        }
      }
    }

    // 验证 capture 文件仍然可访问
    if (state.capturePaths) {
      for (const capturePath of state.capturePaths) {
        if (!fs.existsSync(capturePath)) {
          const exists = blockers.some(
            b => b.code === BLOCKER_CODES.BLOCKED_MISSING_CAPTURE.code && b.refs.includes(capturePath)
          );
          if (!exists) {
            blockers.push({
              code: BLOCKER_CODES.BLOCKED_MISSING_CAPTURE.code,
              reason: `Capture file no longer accessible: ${capturePath}`,
              refs: [capturePath],
              detectedAt: nowIso(),
            });
          }
        }
      }
    }

    // 记录 intake_gate 完成
    evidenceChain.push({
      eventId: crypto.randomUUID(),
      eventType: 'intake_gate_complete',
      agentId: 'rdc-debugger',
      status: gateResult.status,
      timestamp: Date.now(),
      payload: {
        stage: gateResult.stage,
        status: gateResult.status,
        blockerCount: blockers.filter(b => !b.resolvedAt).length,
        refs: gateResult.refs,
        runId: state.runId,
        sessionId: state.sessionId,
      },
    });

    return {
      currentStage: 'intake_gate_passed',
      stageHistory: [state.currentStage],
      evidenceChain,
      blockers,
      lastUpdated: nowIso(),
    };
  } catch (error) {
    // 记录错误
    evidenceChain.push(
      createToolExecutionEvidence(
        { sessionId: state.sessionId, runId: state.runId },
        'intake_gate_check',
        { caseId: state.caseId, runId: state.runId },
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        'rdc-debugger'
      )
    );

    // 添加阻断器
    blockers.push({
      code: BLOCKER_CODES.BLOCKED_INTAKE_GATE_REQUIRED.code,
      reason: `Intake gate check failed: ${error instanceof Error ? error.message : String(error)}`,
      refs: [],
      detectedAt: nowIso(),
    });

    return {
      currentStage: 'intake_gate_passed',
      stageHistory: [state.currentStage],
      evidenceChain,
      blockers,
      lastUpdated: nowIso(),
    };
  }
}

/**
 * Intake Gate 后路由函数
 */
export function routeAfterIntakeGate(state: GraphState): string {
  // 检查是否有阻断器
  const hasCriticalBlocker = state.blockers.some(
    b => !b.resolvedAt && b.code.startsWith('BLOCKED_')
  );

  if (hasCriticalBlocker) {
    return 'validation_blocked';
  }

  // 正常流程：进入 specialist_dispatch
  return 'specialist_dispatch';
}
