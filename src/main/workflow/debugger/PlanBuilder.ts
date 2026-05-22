import path from 'path';
import type { AgentRole } from '@shared/types/agent';
import type {
  AskUserPrompt,
  AskUserQuestion,
  Blocker,
  DebugPlan,
  PlanReadiness,
  VerificationContract,
} from '@shared/types/workflow';
import { BLOCKER_CODES } from '@shared/constants/blockers';
import { nowIso } from '@shared/utils/id';
import type { CaptureDescriptor } from '@shared/types/session';
import type { ResolvedIntakeContext } from './IntakeContextResolver';

export interface PlanBuildResult {
  debugPlan: DebugPlan;
  pendingQuestions: AskUserPrompt | null;
  blockers: Blocker[];
}

function makeBlocker(code: string, reason: string, refs: string[] = []): Blocker {
  return {
    code,
    reason,
    refs,
    detectedAt: nowIso(),
  };
}

function makeCaptureQuestion(captures: CaptureDescriptor[]): AskUserQuestion {
  const options = captures.slice(0, 4).map((capture) => ({
    id: capture.id,
    label: path.basename(capture.filePath),
    description: capture.filePath,
  }));

  while (options.length < 4) {
    options.push({
      id: `option-${options.length + 1}`,
      label: `选项 ${options.length + 1}`,
      description: '使用自由输入指定更准确的 capture。',
    });
  }

  return {
    id: 'target_capture',
    prompt: '当前有多个可用 capture，选择本次 Debugger 主链要分析的目标。',
    recommendedOptionId: options[0]?.id,
    options: [
      options[0],
      options[1],
      options[2],
      options[3],
    ],
    freeformPlaceholder: '输入更准确的 .rdc 文件名',
  };
}

function buildVerificationContract(goalText: string, eventId?: number): VerificationContract {
  const lower = goalText.toLowerCase();
  return {
    requiresFixValidation: /验证|verify|fix/.test(goalText),
    requiresScreenshotEvidence: /framebuffer|screenshot|截图|多模态/.test(lower + goalText),
    requiresShaderInspection: /shader|ibl|漏光|light|亮点/.test(lower + goalText),
    requiresPixelEvidence: /pixel|像素|亮点|白点/.test(lower + goalText),
    requiresBaselineComparison: /baseline|compare|对比|比较/.test(lower + goalText),
    targetEventIds: eventId ? [eventId] : [],
    successCriteria: [
      '结论必须有真实 rd.* 工具证据支撑。',
      '必须给出 verification 结果，并说明 fix 是否成立。',
      '最终发布 report.md、report.json 和 visual_report.html。',
    ],
  };
}

function recommendSpecialists(goalText: string, captures: CaptureDescriptor[], backend: 'local' | 'remote'): AgentRole[] {
  const specialists: AgentRole[] = ['triage_agent', 'pass_graph_pipeline_agent', 'pixel_forensics_agent', 'shader_ir_agent'];
  if (captures.length > 1 || /baseline|compare|对比|比较/.test(goalText)) {
    specialists.splice(1, 0, 'capture_repro_agent');
  }
  if (backend === 'remote') {
    specialists.push('driver_device_agent');
  }
  return Array.from(new Set(specialists));
}

export class PlanBuilder {
  build(resolved: ResolvedIntakeContext): PlanBuildResult {
    const blockers: Blocker[] = [];
    const questions: AskUserQuestion[] = [];
    const targetCapture = resolved.primaryCaptureId
      ? resolved.captures.find((capture) => capture.id === resolved.primaryCaptureId) ?? null
      : resolved.captures.length === 1
        ? resolved.captures[0]
        : null;
    const explicitEventId = resolved.explicitEventId;

    if (resolved.captures.length === 0) {
      blockers.push(makeBlocker(
        BLOCKER_CODES.BLOCKED_MISSING_CAPTURE.code,
        '当前 project 中没有可用于 Debugger 的 capture。',
      ));
    }

    if (!targetCapture && resolved.captures.length > 1) {
      questions.push(makeCaptureQuestion(resolved.captures));
    }

    const verificationContract = buildVerificationContract(resolved.goalText, explicitEventId);
    const missingInfo: string[] = [];
    if (!targetCapture) {
      missingInfo.push('target_capture');
    }

    const targetFrameOrEvent = explicitEventId
      ? {
          scope: 'event' as const,
          eventId: explicitEventId,
          eventLabel: `Event ${explicitEventId}`,
        }
      : {
          scope: 'frame' as const,
          frameIndex: 0,
          eventLabel: 'Frame 0 default scope',
        };

    let planReadiness: PlanReadiness = 'discovering';
    if (blockers.length > 0) {
      planReadiness = 'blocked';
    } else if (questions.length > 0) {
      planReadiness = 'needs_user_input';
    } else {
      planReadiness = 'strict_ready';
    }

    const debugPlan: DebugPlan = {
      planId: `plan-${Date.now()}`,
      planReadiness,
      strictReady: planReadiness === 'strict_ready',
      userGoal: resolved.goalText,
      targetCapture: targetCapture
        ? {
            captureId: targetCapture.id,
            fileName: path.basename(targetCapture.filePath),
            filePath: targetCapture.filePath,
          }
        : null,
      targetFrameOrEvent,
      scope: explicitEventId ? 'Anchor on the explicit event first, then expand to nearby pipeline and framebuffer evidence.' : 'Start from the frame and narrow down to the first bad event.',
      referenceContract: {
        taskSources: resolved.taskSources,
        referenceCaptures: resolved.captures.slice(1).map((capture) => capture.filePath),
        acceptanceNotes: [
          '只在 debug_plan.strict_ready 且用户批准后进入执行。',
          '报告需要覆盖 root cause、verification 和 deliverables。',
        ],
      },
      verificationContract,
      expectedDeliverables: [
        'report.md',
        'report.json',
        'visual_report.html',
      ],
      blockers,
      missingInfo,
      recommendedSpecialists: recommendSpecialists(resolved.goalText, resolved.captures, resolved.backend),
      notes: [
        resolved.taskFilePath ? `Task source: ${resolved.taskFilePath}` : 'Task source: inline prompt',
        resolved.intakeContext.openedCapturePath ? `Opened capture: ${resolved.intakeContext.openedCapturePath}` : 'No opened capture reused',
        resolved.intakeContext.providerId && resolved.intakeContext.modelId
          ? `LLM route: ${resolved.intakeContext.providerId}/${resolved.intakeContext.modelId}`
          : 'LLM route missing; execution must stay blocked until an explicit provider/model route is configured.',
      ],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    const pendingQuestions = questions.length > 0
      ? {
          promptId: `ask-${Date.now()}`,
          title: '补齐执行关键缺口',
          summary: '以下信息会直接影响执行路径，请先确认。',
          questions,
          createdAt: nowIso(),
        }
      : null;

    return {
      debugPlan,
      pendingQuestions,
      blockers,
    };
  }
}

export const planBuilder = new PlanBuilder();
