/**
 * preflightNode.ts - Preflight 阶段节点
 * 验证环境就绪，检查 RDC-Agent-Tools 路径等
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { WorkflowStage, GraphState } from '../../../shared/types/workflow';
import { BLOCKER_CODES } from '../../../shared/constants/blockers';
import { toolBridge } from '../ToolBridge';
import {
  createStageTransitionEvidence,
  createBlocker,
  nowIso,
} from './utils';

/** 节点返回的部分状态更新 */
export interface PreflightNodeResult {
  currentStage: WorkflowStage;
  stageHistory: WorkflowStage[];
  evidenceChain: ReturnType<typeof createStageTransitionEvidence>[];
  blockers: GraphState['blockers'];
  lastUpdated: string;
}

/** Preflight 配置 */
export interface PreflightConfig {
  /** RDC-Agent-Tools 路径 */
  toolsPath?: string;
  /** 是否强制检查 tools 路径 */
  checkToolsPath?: boolean;
}

/**
 * Preflight 节点
 * 验证环境就绪，更新阶段到 preflight
 */
export async function preflightNode(
  state: GraphState,
  config: PreflightConfig = {}
): Promise<Partial<GraphState>> {
  const blockers: GraphState['blockers'] = [];
  const evidenceChain: ReturnType<typeof createStageTransitionEvidence>[] = [];

  // 记录进入 preflight 阶段
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage,
      },
      'preflight'
    )
  );

  // 检查 RDC-Agent-Tools 路径（如果配置要求）
  if (config.checkToolsPath !== false) {
    const toolsPath = config.toolsPath || process.env.RDC_TOOLS_PATH || toolBridge.getToolsPath();
    
    if (!toolsPath) {
      blockers.push(
        createBlocker(
          BLOCKER_CODES.BLOCKED_ENTRY_PREFLIGHT.code,
          'RDC_TOOLS_PATH not set. Please set environment variable or provide toolsPath in config.',
          ['env:RDC_TOOLS_PATH']
        )
      );
    } else if (!fs.existsSync(toolsPath)) {
      blockers.push(
        createBlocker(
          BLOCKER_CODES.BLOCKED_ENTRY_PREFLIGHT.code,
          `RDC-Agent-Tools path does not exist: ${toolsPath}`,
          [toolsPath]
        )
      );
    } else {
      // 检查关键目录结构
      const requiredSubdirs = ['bin', 'lib', 'tools'];
      for (const subdir of requiredSubdirs) {
        const subdirPath = path.join(toolsPath, subdir);
        if (!fs.existsSync(subdirPath)) {
          console.warn(`[preflight] Missing subdirectory: ${subdirPath}`);
        }
      }
    }
  }

  // 检查 capture 文件路径（如果有提供）
  if (state.capturePaths && state.capturePaths.length > 0) {
    for (const capturePath of state.capturePaths) {
      if (!fs.existsSync(capturePath)) {
        blockers.push(
          createBlocker(
            BLOCKER_CODES.BLOCKED_MISSING_CAPTURE.code,
            `Capture file not found: ${capturePath}`,
            [capturePath]
          )
        );
      } else if (!capturePath.endsWith('.rdc')) {
        blockers.push(
          createBlocker(
            BLOCKER_CODES.BLOCKED_CAPTURE_IMPORT_FAILED.code,
            `Invalid capture file format (expected .rdc): ${capturePath}`,
            [capturePath]
          )
        );
      }
    }
  }

  // 记录 preflight 完成
  evidenceChain.push({
    eventId: randomUUID(),
    eventType: 'preflight_complete',
    agentId: 'rdc-debugger',
    status: blockers.length === 0 ? 'ok' : 'blocked',
    timestamp: Date.now(),
    payload: {
      checksPerformed: ['tools_path', 'capture_files'],
      blockersFound: blockers.length,
      runId: state.runId,
      sessionId: state.sessionId,
    },
  });

  return {
    currentStage: 'preflight',
    stageHistory: [state.currentStage],
    evidenceChain,
    blockers: [...state.blockers, ...blockers],
    lastUpdated: nowIso(),
  };
}

/**
 * Preflight 后路由函数
 * 决定下一个节点：intent_gate 或 validation_blocked
 */
export function routeAfterPreflight(state: GraphState): string {
  // 检查是否有阻断器
  const hasCriticalBlocker = state.blockers.some(
    b => !b.resolvedAt && b.code.startsWith('BLOCKED_')
  );

  if (hasCriticalBlocker) {
    return 'blocked';
  }

  // 正常流程：进入 entry_gate
  return 'entry_gate';
}
