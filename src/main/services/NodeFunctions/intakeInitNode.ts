/**
 * intakeInitNode.ts - Intake Init 阶段节点
 * 创建 case 和 run（通过 StorageAdapter）
 * 初始化 captureInfo
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { GraphState, CaptureInfo, CaptureMetadata } from '../../../shared/types/workflow';
import { storageAdapter } from '../StorageAdapter';
import { BLOCKER_CODES } from '../../../shared/constants/blockers';
import {
  createStageTransitionEvidence,
  createToolExecutionEvidence,
  createArtifact,
  nowIso,
} from './utils';

/** Intake Init 配置 */
export interface IntakeInitConfig {
  /** 是否自动提取 capture 元数据 */
  extractMetadata?: boolean;
}

/**
 * 从 .rdc 文件提取元数据（简化版）
 * 实际实现应该调用 rd.* 工具
 */
async function extractCaptureMetadata(capturePath: string): Promise<CaptureMetadata | null> {
  try {
    const stats = fs.statSync(capturePath);
    
    // 这里应该调用 rd.* 工具获取真实的 capture 元数据
    // 目前返回占位数据
    return {
      api: 'unknown',
      device: 'unknown',
      driverVersion: 'unknown',
      frameCount: 0,
      eventCount: 0,
      captureDate: stats.mtime.toISOString(),
      fileSize: stats.size,
      features: [],
    };
  } catch {
    return null;
  }
}

/**
 * 生成 fileId
 */
function generateFileId(capturePath: string): string {
  const basename = path.basename(capturePath, '.rdc');
  const timestamp = Date.now().toString(36);
  return `capture-${basename}-${timestamp}`;
}

/**
 * Intake Init 节点
 * 初始化 case、run 和 captureInfo
 */
export async function intakeInitNode(
  state: GraphState,
  config: IntakeInitConfig = {}
): Promise<Partial<GraphState>> {
  const evidenceChain: GraphState['evidenceChain'] = [];
  const blockers: GraphState['blockers'] = [...state.blockers];
  const artifacts: GraphState['artifacts'] = [...state.artifacts];
  let captureInfo: CaptureInfo | undefined = state.captureInfo;

  // intake_init 是 intake_gate 的内部准备步骤，不改变对外阶段语义
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage,
      },
      'intake_gate'
    )
  );

  try {
    // 确保 case 目录存在
    const casePath = storageAdapter.getCasePath(state.caseId);
    if (!fs.existsSync(casePath)) {
      fs.mkdirSync(casePath, { recursive: true });
    }

    // 确保 run 目录存在
    const runPath = storageAdapter.getRunPath(state.caseId, state.runId);
    if (!fs.existsSync(runPath)) {
      fs.mkdirSync(runPath, { recursive: true });
    }

    // 创建必要的子目录
    const subdirs = ['artifacts', 'notes', 'reports'];
    for (const subdir of subdirs) {
      const subdirPath = path.join(runPath, subdir);
      if (!fs.existsSync(subdirPath)) {
        fs.mkdirSync(subdirPath, { recursive: true });
      }
    }

    // 初始化 captureInfo（如果提供了 capture 路径）
    if (state.capturePaths && state.capturePaths.length > 0 && !captureInfo) {
      const primaryCapture = state.capturePaths[0];
      
      // 提取元数据
      let metadata: CaptureMetadata | null = null;
      if (config.extractMetadata !== false) {
        metadata = await extractCaptureMetadata(primaryCapture);
      }

      captureInfo = {
        fileId: generateFileId(primaryCapture),
        filePath: primaryCapture,
        metadata: metadata || {
          api: 'unknown',
          device: 'unknown',
          driverVersion: 'unknown',
          frameCount: 0,
          eventCount: 0,
          captureDate: nowIso(),
          fileSize: 0,
          features: [],
        },
      };

      // 记录 capture 信息工件
      const captureArtifact = createArtifact(
        'capture_info',
        path.join(runPath, 'artifacts', 'capture_info.json'),
        'rdc-debugger'
      );
      artifacts.push(captureArtifact);

      // 写入 capture_info.json
      fs.writeFileSync(
        captureArtifact.path,
        JSON.stringify(captureInfo, null, 2),
        'utf-8'
      );
    }

    // 创建 case_input.yaml
    const caseInput = {
      schema_version: '2',
      generated_at: nowIso(),
      session: {
        case_id: state.caseId,
        run_id: state.runId,
        session_id: state.sessionId,
      },
      symptom: {
        description: state.userGoal,
      },
      captures: state.capturePaths.map((p, i) => ({
        capture_id: captureInfo?.fileId || `capture-${i}`,
        capture_role: i === 0 ? 'primary' : 'reference',
        path: p,
      })),
      reference_contract: {
        source_refs: state.capturePaths.length > 1 ? [state.capturePaths[1]] : [],
      },
    };

    const caseInputPath = path.join(runPath, 'case_input.yaml');
    const yaml = await import('yaml');
    fs.writeFileSync(caseInputPath, yaml.stringify(caseInput), 'utf-8');

    // 记录工件
    artifacts.push(
      createArtifact('case_input', caseInputPath, 'rdc-debugger')
    );

    // 记录工具执行
    evidenceChain.push(
      createToolExecutionEvidence(
        { sessionId: state.sessionId, runId: state.runId },
        'intake_init',
        {
          caseId: state.caseId,
          runId: state.runId,
          capturePaths: state.capturePaths,
        },
        { ok: true, data: { casePath, runPath } },
        'rdc-debugger'
      )
    );

    // 记录 intake_init 完成
    evidenceChain.push({
      eventId: randomUUID(),
      eventType: 'intake_init_complete',
      agentId: 'rdc-debugger',
      status: 'ok',
      timestamp: Date.now(),
      payload: {
        caseId: state.caseId,
        runId: state.runId,
        captureInfo: captureInfo
          ? {
              fileId: captureInfo.fileId,
              filePath: captureInfo.filePath,
              metadata: {
                api: captureInfo.metadata.api,
                device: captureInfo.metadata.device,
                fileSize: captureInfo.metadata.fileSize,
              },
            }
          : null,
        artifactCount: artifacts.length,
        sessionId: state.sessionId,
      },
    });

    return {
      currentStage: 'intake_gate',
      stageHistory: [state.currentStage],
      evidenceChain,
      captureInfo,
      artifacts,
      blockers,
      lastUpdated: nowIso(),
    };
  } catch (error) {
    // 记录错误
    evidenceChain.push(
      createToolExecutionEvidence(
        { sessionId: state.sessionId, runId: state.runId },
        'intake_init',
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
      reason: `Intake initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      refs: [],
      detectedAt: nowIso(),
    });

    return {
      currentStage: 'intake_gate',
      stageHistory: [state.currentStage],
      evidenceChain,
      blockers,
      lastUpdated: nowIso(),
    };
  }
}

/**
 * Intake Init 后路由函数
 */
export function routeAfterIntakeInit(state: GraphState): string {
  // 检查是否有阻断器
  const hasCriticalBlocker = state.blockers.some(
    b => !b.resolvedAt && b.code.startsWith('BLOCKED_')
  );

  if (hasCriticalBlocker) {
    return 'blocked';
  }

  // 正常流程：进入 intake_gate
  return 'intake_gate';
}
