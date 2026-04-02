/**
 * entryGateNode.ts - Entry Gate 阶段节点
 * 委托 HarnessController 执行 EntryGate 检查
 * 检查 .rdc 文件存在性、平台兼容性
 */

import type { GraphState } from '../../../shared/types/workflow';
import { harnessController } from '../HarnessController';
import { BLOCKER_CODES } from '../../../shared/constants/blockers';
import {
  createStageTransitionEvidence,
  createToolExecutionEvidence,
  nowIso,
} from './utils';

/** Entry Gate 配置 */
export interface EntryGateConfig {
  /** 是否执行平台兼容性检查 */
  checkPlatform?: boolean;
  /** 目标平台 */
  platform?: string;
}

/**
 * Entry Gate 节点
 * 执行 EntryGate 检查
 */
export async function entryGateNode(
  state: GraphState,
  config: EntryGateConfig = {}
): Promise<Partial<GraphState>> {
  const evidenceChain: GraphState['evidenceChain'] = [];
  const blockers: GraphState['blockers'] = [...state.blockers];

  // 记录进入 entry_gate 阶段
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage,
      },
      'entry_gate_passed'
    )
  );

  try {
    // 调用 HarnessController 执行 EntryGate 检查
    const gateResult = await harnessController.executeEntryGate({
      capturePaths: state.capturePaths,
      platform: config.platform || 'windows',
      entryMode: state.entryMode,
      backend: state.backend,
    });

    // 记录 Gate 执行结果
    evidenceChain.push(
      createToolExecutionEvidence(
        { sessionId: state.sessionId, runId: state.runId },
        'entry_gate_check',
        {
          capturePaths: state.capturePaths,
          platform: config.platform,
          entryMode: state.entryMode,
          backend: state.backend,
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

    // 记录 entry_gate 完成
    evidenceChain.push({
      eventId: crypto.randomUUID(),
      eventType: 'entry_gate_complete',
      agentId: 'rdc-debugger',
      status: gateResult.status,
      timestamp: Date.now(),
      payload: {
        stage: gateResult.stage,
        status: gateResult.status,
        blockerCount: gateResult.blockers.length,
        refs: gateResult.refs,
        paths: gateResult.paths,
        runId: state.runId,
        sessionId: state.sessionId,
      },
    });

    // 平台兼容性检查（如果配置要求）
    if (config.checkPlatform !== false && state.backend === 'remote') {
      // 远程模式额外检查
      const platformBlockers = await checkPlatformCompatibility(
        state.capturePaths,
        config.platform || 'windows'
      );
      blockers.push(...platformBlockers);
    }

    return {
      currentStage: 'entry_gate_passed',
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
        'entry_gate_check',
        { capturePaths: state.capturePaths },
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        'rdc-debugger'
      )
    );

    // 添加阻断器
    blockers.push({
      code: BLOCKER_CODES.BLOCKED_ENTRY_PREFLIGHT.code,
      reason: `Entry gate check failed: ${error instanceof Error ? error.message : String(error)}`,
      refs: [],
      detectedAt: nowIso(),
    });

    return {
      currentStage: 'entry_gate_passed',
      stageHistory: [state.currentStage],
      evidenceChain,
      blockers,
      lastUpdated: nowIso(),
    };
  }
}

/**
 * 检查平台兼容性
 */
async function checkPlatformCompatibility(
  _capturePaths: string[],
  targetPlatform: string
): Promise<GraphState['blockers']> {
  const blockers: GraphState['blockers'] = [];

  // TODO: 实现平台兼容性检查
  // 1. 检查 capture 文件的平台元数据
  // 2. 验证目标平台支持
  // 3. 检查驱动版本兼容性

  // 目前仅做占位实现
  if (targetPlatform === 'unsupported_platform') {
    blockers.push({
      code: BLOCKER_CODES.BLOCKED_PLATFORM_MODE_UNSUPPORTED.code,
      reason: `Platform ${targetPlatform} is not supported`,
      refs: [],
      detectedAt: nowIso(),
    });
  }

  return blockers;
}

/**
 * Entry Gate 后路由函数
 */
export function routeAfterEntryGate(state: GraphState): string {
  // 检查是否有阻断器
  const hasCriticalBlocker = state.blockers.some(
    b => !b.resolvedAt && b.code.startsWith('BLOCKED_')
  );

  if (hasCriticalBlocker) {
    return 'validation_blocked';
  }

  // 正常流程：进入 intake_init
  return 'intake_init';
}
