import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { expect, test } from '@playwright/test';
import { AppContext, closeApp, launchApp } from './helpers/electron-app';
import type { ConversationMessage } from '../src/shared/types/conversation';
import type { ActionEvent } from '../src/shared/types/evidence';
import type { DebugPlan, WorkflowState } from '../src/shared/types/workflow';

let ctx: AppContext;

const BASE_TIME = Date.UTC(2026, 4, 3, 9, 21, 0);
const PRODUCT_FLOW_SESSION_DIR = 'D:\\Utility\\DebugTest\\custom\\sessions\\session-rdc-debugger-product-flow';

interface PngPixelStats {
  averageLuma: number;
  nonBlackRatio: number;
  sampledPixels: number;
}

const parsePngStats = (buffer: Buffer, region?: { x: number; y: number; width: number; height: number }): PngPixelStats => {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const chunks: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      if (data[8] !== 8) {
        throw new Error(`Unsupported PNG bit depth: ${data[8]}`);
      }
    } else if (type === 'IDAT') {
      chunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!width || !height || !channels) {
    throw new Error(`Unsupported PNG format: ${width}x${height}, colorType=${colorType}`);
  }

  const inflated = zlib.inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let sourceOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const rowStart = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[sourceOffset + x];
      const left = x >= channels ? pixels[rowStart + x - channels] : 0;
      const up = y > 0 ? pixels[rowStart + x - stride] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[rowStart + x - stride - channels] : 0;
      let value = raw;
      if (filter === 1) {
        value = raw + left;
      } else if (filter === 2) {
        value = raw + up;
      } else if (filter === 3) {
        value = raw + Math.floor((left + up) / 2);
      } else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else if (filter !== 0) {
        throw new Error(`Unsupported PNG filter: ${filter}`);
      }
      pixels[rowStart + x] = value & 0xff;
    }
    sourceOffset += stride;
  }

  const bounds = region ?? { x: 0, y: 0, width, height };
  const x0 = Math.max(0, Math.floor(bounds.x));
  const y0 = Math.max(0, Math.floor(bounds.y));
  const x1 = Math.min(width, Math.ceil(bounds.x + bounds.width));
  const y1 = Math.min(height, Math.ceil(bounds.y + bounds.height));
  let totalLuma = 0;
  let nonBlack = 0;
  let sampledPixels = 0;

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const pixelOffset = y * stride + x * channels;
      const red = pixels[pixelOffset];
      const green = pixels[pixelOffset + 1];
      const blue = pixels[pixelOffset + 2];
      const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      totalLuma += luma;
      if (red > 22 || green > 22 || blue > 22) {
        nonBlack += 1;
      }
      sampledPixels += 1;
    }
  }

  return {
    averageLuma: sampledPixels > 0 ? totalLuma / sampledPixels : 0,
    nonBlackRatio: sampledPixels > 0 ? nonBlack / sampledPixels : 0,
    sampledPixels,
  };
};

const expectScreenshotNotBlack = async (
  page: AppContext['page'],
  screenshotPath: string,
  region?: { x: number; y: number; width: number; height: number },
) => {
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  const buffer = await page.screenshot({ path: screenshotPath, fullPage: false });
  const stats = parsePngStats(buffer, region);
  expect(stats.sampledPixels).toBeGreaterThan(10_000);
  expect(stats.averageLuma).toBeGreaterThan(8);
  expect(stats.nonBlackRatio).toBeGreaterThan(0.035);
  return stats;
};

const setElectronWindowSize = async (appContext: AppContext, width: number, height: number) => {
  await appContext.app.evaluate(({ BrowserWindow }, size) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    mainWindow.setSize(size.width, size.height);
  }, { width, height });
  await appContext.page.waitForTimeout(350);
};

const readJsonFile = <T,>(filePath: string): T => JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;

const readJsonlFile = <T,>(filePath: string): T[] => fs.readFileSync(filePath, 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as T);

const validateProductFlowFixture = () => {
  expect(fs.existsSync(PRODUCT_FLOW_SESSION_DIR)).toBe(true);
  const actionEvents = readJsonlFile<ActionEvent>(path.join(PRODUCT_FLOW_SESSION_DIR, 'action_chain.jsonl'));
  const messages = readJsonlFile<ConversationMessage>(path.join(PRODUCT_FLOW_SESSION_DIR, 'conversation.jsonl'));
  const artifactStore = readJsonFile<{
    artifacts: Array<{ filePath: string; sizeBytes: number }>;
  }>(path.join(PRODUCT_FLOW_SESSION_DIR, 'runs', 'run-rdc-debugger-product-flow', 'artifact_store.json'));

  expect(messages.length).toBeGreaterThan(0);
  expect(actionEvents.some((event) => event.event_type === 'ask_user_question')).toBe(false);

  for (const artifact of artifactStore.artifacts) {
    expect(fs.statSync(artifact.filePath).size).toBe(artifact.sizeBytes);
  }

  const serializedMessages = messages.map((message) => message.content).join('\n');
  const serializedEvents = actionEvents.map((event) => JSON.stringify(event.payload)).join('\n');
  const eventToolNames = actionEvents
    .filter((event) => event.event_type === 'tool_execution')
    .map((event) => String(event.payload.tool_name || event.payload.toolName));

  expect(serializedMessages).toContain('D:\\Utility\\Test RDC Files\\眼睛泪腺白点.rdc');
  expect(serializedMessages).toContain('Event ID 6152');
  expect(serializedMessages).toContain('resolution_mode: audited_execution');
  expect(serializedMessages).toContain('execution_driver: rdc-execute');
  expect(serializedMessages).toContain('baseline_policy: predicate_only');
  expect(serializedEvents).toContain('audited_execution');
  expect(eventToolNames).toEqual(expect.arrayContaining([
    'read_file',
    'grep_search',
    'file_search',
    'list_dir',
    'runSubagent.triage-taxonomy',
    'runSubagent.capture-repro',
  ]));
};

async function seedTimelineScenario(page: AppContext['page'], projectRoot: string) {
  fs.mkdirSync(path.join(projectRoot, '.resource', 'inputs'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'reports'), { recursive: true });
  const capturePath = path.join(projectRoot, '.resource', 'inputs', 'MessageFlow_Reference.rdc');
  const reportPath = path.join(projectRoot, 'reports', 'message_flow_spec.md');
  fs.writeFileSync(capturePath, 'fixture', 'utf8');
  fs.writeFileSync(reportPath, '# Message Flow Spec\n', 'utf8');

  const turnId = 'turn-message-flow';
  const runId = 'run-message-flow';
  const sessionId = 'session-message-flow';

  const messages: ConversationMessage[] = [
    {
      id: 'user-message-flow',
      turnId,
      sessionId,
      projectId: 'project-message-flow',
      runId,
      modeContext: 'debugger',
      role: 'user',
      content: '请分析我自研 Agent 的消息流结构，并给出可复刻的设计方案。',
      status: 'complete',
      attachments: [{
        attachmentId: 'attachment-reference',
        sessionId,
        projectId: 'project-message-flow',
        kind: 'file',
        fileName: 'MessageFlow_Reference.rdc',
        filePath: capturePath,
        mimeType: 'application/octet-stream',
        size: 1600,
        createdAt: BASE_TIME,
      }],
      createdAt: BASE_TIME,
    },
    {
      id: 'assistant-message-flow',
      turnId,
      sessionId,
      projectId: 'project-message-flow',
      runId,
      modeContext: 'debugger',
      role: 'assistant',
      agentId: 'rdc-debugger',
      content: [
        '建议把真实 reasoning trace、工具结果、证据和产物收敛到可展开的思考轨迹。',
        '默认只显示轻量折叠标签，展开后再查看本轮 Agent 轨迹。',
        '没有真实轨迹数据时，消息区只显示正常回答气泡。',
      ].join('\n'),
      status: 'complete',
      updatedAt: BASE_TIME + 124_000,
      reasoningTrace: {
        status: 'complete',
        updatedAt: BASE_TIME + 58_000,
        steps: [{
          id: 'inspect-reference',
          title: 'InspectReference（读取参考资料）',
          stage: 'investigate',
          status: 'complete',
          summary: '读取参考图和设计文档。',
          detail: '输入包含 source_uploads 与设计文档。',
          toolCalls: [{
            id: 'tool-inspect-reference',
            toolName: 'InspectReference',
            status: 'complete',
            argsPreview: '{ "source": "user_uploads", "type": ["image", "doc"] }',
            resultPreview: '读取 2 张图片、1 个文档，共提取 12 条结构信息。',
            startedAt: BASE_TIME + 32_000,
            completedAt: BASE_TIME + 33_200,
          }],
          startedAt: BASE_TIME + 31_000,
          completedAt: BASE_TIME + 33_200,
        }],
      },
      attachments: [],
      createdAt: BASE_TIME + 124_000,
    },
  ];

  const events: ActionEvent[] = [
    {
      schema_version: '1',
      event_id: 'event-web-search',
      turn_id: turnId,
      ts_ms: BASE_TIME + 50_000,
      run_id: runId,
      session_id: sessionId,
      agent_id: 'rdc-debugger',
      event_type: 'tool_execution',
      status: 'ok',
      duration_ms: 3600,
      refs: [],
      payload: {
        tool_name: 'WebSearch',
        args: { query: 'agent message flow execution timeline' },
        result: { summary: '找到结构化 timeline 和 progressive disclosure 参考。' },
      },
    },
    {
      schema_version: '1',
      event_id: 'event-tool-agent',
      turn_id: turnId,
      ts_ms: BASE_TIME + 64_000,
      run_id: runId,
      session_id: sessionId,
      agent_id: 'pass_graph_pipeline_agent',
      event_type: 'specialist_summary',
      status: 'ok',
      duration_ms: 28_400,
      refs: [],
      payload: {
        summary: 'ToolCall 必须结构化，RawDetail 默认折叠。',
      },
    },
    {
      schema_version: '1',
      event_id: 'event-structure-agent',
      turn_id: turnId,
      ts_ms: BASE_TIME + 66_000,
      run_id: runId,
      session_id: sessionId,
      agent_id: 'shader_ir_agent',
      event_type: 'specialist_summary',
      status: 'ok',
      duration_ms: 31_700,
      refs: [],
      payload: {
        summary: 'SubAgentGroup 应属于 Phase 内部的 Group。',
      },
    },
    {
      schema_version: '1',
      event_id: 'event-interaction-agent',
      turn_id: turnId,
      ts_ms: BASE_TIME + 70_000,
      run_id: runId,
      session_id: sessionId,
      agent_id: 'skeptic_agent',
      event_type: 'specialist_summary',
      status: 'warning',
      duration_ms: 22_800,
      refs: [],
      payload: {
        summary: '部分失败交互样例缺失，需要继续验证。',
      },
    },
    {
      schema_version: '1',
      event_id: 'event-report',
      turn_id: turnId,
      ts_ms: BASE_TIME + 112_000,
      run_id: runId,
      session_id: sessionId,
      agent_id: 'curator_agent',
      event_type: 'report_published',
      status: 'ok',
      duration_ms: 2100,
      refs: [],
      payload: {
        markdownPath: reportPath,
      },
    },
  ];

  const workflowState: WorkflowState = {
    caseId: 'case-message-flow',
    runId,
    sessionId,
    currentStage: 'finalize',
    previousStages: ['preflight', 'entry_gate', 'intake_gate', 'plan', 'dispatch', 'investigate'],
    entryMode: 'cli',
    backend: 'local',
    orchestrationMode: 'multi_agent',
    coordinationMode: 'staged_handoff',
    blockers: [],
    planReadiness: 'strict_ready',
    approvalState: 'approved',
    debugPlan: {
      planId: 'plan-message-flow',
      planReadiness: 'strict_ready',
      strictReady: true,
      userGoal: '分析自研 Agent 的消息流结构，输出可复刻设计方案。',
      targetCapture: {
        captureId: 'capture-reference',
        fileName: 'MessageFlow_Reference.rdc',
        filePath: capturePath,
      },
      targetFrameOrEvent: null,
      scope: '只调整消息区思考轨迹展示，不改变 composer 和 right rail。',
      referenceContract: {
        taskSources: ['Agent与用户交互的信息流设计.md'],
        referenceCaptures: [capturePath],
        acceptanceNotes: ['SubAgentGroup 必须位于 Phase 内部。'],
      },
      verificationContract: {
        requiresFixValidation: true,
        requiresScreenshotEvidence: true,
        requiresShaderInspection: false,
        requiresPixelEvidence: false,
        requiresBaselineComparison: false,
        targetEventIds: [],
        successCriteria: ['消息区显示可折叠 thinking label，并保留真实工具、证据和产物。'],
      },
      expectedDeliverables: ['timeline_schema.json', 'message_flow_spec.md', 'ui_mock_v1.png'],
      blockers: [],
      missingInfo: [],
      recommendedSpecialists: ['pass_graph_pipeline_agent', 'shader_ir_agent', 'skeptic_agent'],
      notes: ['真实 trace/event 数据驱动消息区思考轨迹。'],
      createdAt: new Date(BASE_TIME).toISOString(),
      updatedAt: new Date(BASE_TIME + 12_000).toISOString(),
    },
    harnessTasks: [
      {
        taskId: 'task-tool-chain',
        runId,
        sessionId,
        title: 'Tool Chain Agent',
        intent: 'investigation',
        objective: '提取工具调用和结果结构。',
        status: 'completed',
        priority: 'high',
        owner: 'pass_graph_pipeline_agent',
        stage: 'investigate',
        dependsOn: [],
        evidenceRefs: ['event-web-search'],
        artifactRefs: [],
        blockerRefs: [],
        source: 'plan',
        userApproval: 'not_required',
        acceptanceCriteria: ['ToolCall 节点可展开。'],
        createdAt: new Date(BASE_TIME + 40_000).toISOString(),
        updatedAt: new Date(BASE_TIME + 76_000).toISOString(),
        completedAt: new Date(BASE_TIME + 76_000).toISOString(),
      },
      {
        taskId: 'task-interaction',
        runId,
        sessionId,
        title: 'Interaction Agent',
        intent: 'verification',
        objective: '验证展开、折叠、证据跳转和失败过滤。',
        status: 'blocked',
        priority: 'normal',
        owner: 'skeptic_agent',
        stage: 'fix_verify',
        dependsOn: [],
        evidenceRefs: [],
        artifactRefs: [],
        blockerRefs: [],
        source: 'plan',
        userApproval: 'not_required',
        acceptanceCriteria: ['失败状态必须可见。'],
        createdAt: new Date(BASE_TIME + 42_000).toISOString(),
        updatedAt: new Date(BASE_TIME + 80_000).toISOString(),
      },
    ],
    reasoningSummaries: [
      {
        summaryId: 'summary-structure',
        stage: 'investigate',
        agentId: 'shader_ir_agent',
        summary: '梳理 thinking label、展开 area、工具、证据和产物的展示关系。',
        evidence: ['event-structure-agent'],
        nextStep: '合并结构结论。',
        confidence: 0.95,
        createdAt: new Date(BASE_TIME + 88_000).toISOString(),
      },
    ],
    recoveryState: null,
    lastUpdated: new Date(BASE_TIME + 124_000).toISOString(),
  };

  await page.evaluate(async ({ rootPath, nextMessages, nextEvents, nextWorkflowState, nextSessionId, nextRunId, nextBaseTime }) => {
    const electronAPI = (window as Window & {
      electronAPI: {
        project: {
          add: (nextRootPath: string) => Promise<{
            success: boolean;
            project?: {
              projectId: string;
              inputs: unknown[];
            } & Record<string, unknown>;
            error?: string;
          }>;
        };
      };
    }).electronAPI;
    const projectResult = await electronAPI.project.add(rootPath);
    if (!projectResult.success || !projectResult.project) {
      throw new Error(projectResult.error || 'Failed to create project');
    }

    (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        seedWorkbenchState: (state: unknown) => void;
      };
    }).__RDC_AGENT_E2E__?.seedWorkbenchState({
      projects: [projectResult.project],
      sessions: [],
      currentProject: projectResult.project,
      currentSession: null,
      rightRailTarget: 'project',
      currentRun: {
        runId: nextRunId,
        turnId: 'turn-message-flow',
        sessionId: nextSessionId,
        projectId: projectResult.project.projectId,
        caseId: 'case-message-flow',
        goal: 'Message flow alignment',
        captures: [],
        startedAt: nextBaseTime,
        finishedAt: nextBaseTime + 124000,
        status: 'completed',
        mode: 'debugger',
        lastStage: 'finalize',
        backend: 'local',
      },
      contextSnapshot: null,
      captures: [],
      projectInputs: projectResult.project.inputs,
      openedCapture: null,
      conversationMessages: nextMessages,
      timeline: [],
      actionEvents: nextEvents,
      workflowState: nextWorkflowState,
      runs: [],
    });
  }, {
    rootPath: projectRoot,
    nextMessages: messages,
    nextEvents: events,
    nextWorkflowState: workflowState,
    nextSessionId: sessionId,
    nextRunId: runId,
    nextBaseTime: BASE_TIME,
  });
}

async function seedProductFlowFixture(page: AppContext['page']) {
  const session = readJsonFile<{
    sessionId: string;
    projectId: string;
    title: string;
    goal: string;
    sessionPath: string;
    createdAt: number;
    updatedAt: number;
  }>(path.join(PRODUCT_FLOW_SESSION_DIR, 'session.json'));
  const run = readJsonFile<{
    runId: string;
    turnId: string;
    projectId: string;
    sessionId: string;
    caseId: string;
    mode: 'debugger';
    goal: string;
    captures: Array<{
      id: string;
      filePath: string;
      role: 'primary';
      backendHint: 'local';
      status: 'open';
      sessionId: string;
      replaySessionId: string;
      contextId: string;
    }>;
    startedAt: number;
    finishedAt: number;
    status: 'completed';
    lastStage: string;
    backend: 'local';
  }>(path.join(PRODUCT_FLOW_SESSION_DIR, 'runs', 'run-rdc-debugger-product-flow', 'run.json'));
  const capsule = readJsonFile<{
    plan: DebugPlan['presentation'];
    tasks: WorkflowState['harnessTasks'];
  }>(path.join(PRODUCT_FLOW_SESSION_DIR, 'runs', run.runId, 'run_capsule.json'));
  const events = readJsonlFile<ActionEvent>(path.join(PRODUCT_FLOW_SESSION_DIR, 'action_chain.jsonl'));
  const messages = readJsonlFile<ConversationMessage>(path.join(PRODUCT_FLOW_SESSION_DIR, 'conversation.jsonl'));
  const openedCapture = (events.find((event) => event.event_type === 'context_snapshot')?.payload as {
    openedCapture?: unknown;
  } | undefined)?.openedCapture ?? null;
  const captureFileName = path.basename(run.captures[0]?.filePath ?? 'Character_EyeSpark_Desktop.rdc');
  const project = {
    projectId: session.projectId,
    name: 'custom',
    rootPath: 'D:\\Utility\\DebugTest\\custom',
    slug: 'custom',
    resourcePath: 'D:\\Utility\\DebugTest\\custom\\.resource',
    knowledgePath: 'D:\\Utility\\DebugTest\\custom\\.resource\\knowledge',
    inputsPath: 'D:\\Utility\\DebugTest\\custom\\.resource\\inputs',
    inputs: [{
      inputId: 'input_character_eyespark_desktop',
      fileName: captureFileName,
      filePath: run.captures[0]?.filePath,
      source: 'project_resource',
      discoveredAt: session.createdAt,
      lastModifiedAt: session.createdAt,
      size: 1024,
    }],
    inputsUpdatedAt: session.createdAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastSessionId: session.sessionId,
  };
  const debugPlan: DebugPlan = {
    planId: 'plan-copilot-audited-execution',
    planReadiness: 'strict_ready',
    strictReady: true,
    userGoal: run.goal,
    targetCapture: {
      captureId: run.captures[0]?.id ?? 'cap_character_eyespark_desktop',
      fileName: captureFileName,
      filePath: run.captures[0]?.filePath ?? '',
    },
    targetFrameOrEvent: {
      scope: 'event',
      eventId: 6152,
      eventLabel: 'Event 6152',
    },
    scope: 'Copilot-aligned audited execution contract for Event 6152 lacrimal highlight inspection',
    referenceContract: {
      taskSources: ['Copilot title_logs.json'],
      referenceCaptures: [captureFileName],
      acceptanceNotes: ['Debugger produces an auditable plan; rdc-execute owns runtime replay.'],
    },
    verificationContract: {
      requiresFixValidation: true,
      requiresScreenshotEvidence: true,
      requiresShaderInspection: true,
      requiresPixelEvidence: true,
      requiresBaselineComparison: false,
      targetEventIds: [6152],
      successCriteria: capsule.plan?.sections.find((section) => section.id === 'test-plan')?.body ?? [],
    },
    presentation: capsule.plan,
    expectedDeliverables: ['report.md', 'report.json', 'visual_report.html'],
    blockers: [],
    missingInfo: [],
    recommendedSpecialists: ['pass_graph_pipeline_agent', 'pixel_value_forensics_agent', 'shader_ir_agent', 'report_knowledge_curator_agent'] as DebugPlan['recommendedSpecialists'],
    notes: capsule.plan?.sections.find((section) => section.id === 'assumptions')?.body ?? [],
    createdAt: '2026-05-23T14:36:20.000Z',
    updatedAt: '2026-05-23T14:39:00.000Z',
  };
  const workflowState: WorkflowState = {
    caseId: run.caseId,
    runId: run.runId,
    sessionId: run.sessionId,
    currentStage: 'finalize',
    previousStages: ['preflight', 'entry_gate', 'intake_gate', 'plan', 'dispatch', 'investigate', 'fix_verify', 'curate'],
    entryMode: 'cli',
    backend: 'local',
    orchestrationMode: 'multi_agent',
    coordinationMode: 'staged_handoff',
    blockers: [],
    planReadiness: 'strict_ready',
    approvalState: 'approved',
    debugPlan,
    harnessTasks: capsule.tasks ?? [],
    pendingQuestions: null,
    reasoningSummaries: [{
      summaryId: 'summary-product-flow',
      stage: 'finalize',
      agentId: 'curator_agent',
      summary: 'Copilot action_plan、helper brief、报告产物和任务板均已进入 Debugger 主链。',
      evidence: ['evt-report-published'],
      nextStep: '等待用户查看 action_plan 和报告产物。',
      confidence: 0.86,
      createdAt: '2026-05-23T14:38:30.000Z',
    }],
    recoveryState: null,
    lastUpdated: '2026-05-23T14:39:00.000Z',
  };

  await page.evaluate(({ project, session, run, messages, events, workflowState, openedCapture }) => {
    const hook = (window as Window & {
      __RDC_AGENT_E2E__?: {
        seedWorkbenchState: (state: Record<string, unknown>) => void;
      };
    }).__RDC_AGENT_E2E__;
    if (!hook) {
      throw new Error('Missing E2E state hook');
    }
    hook.seedWorkbenchState({
      projects: [project],
      sessions: [session],
      currentProject: project,
      currentSession: session,
      rightRailTarget: 'session',
      currentRun: run,
      currentRunUsage: null,
      contextSnapshot: null,
      captures: run.captures,
      projectInputs: project.inputs,
      openedCapture,
      conversationMessages: messages,
      timeline: [],
      actionEvents: events,
      workflowState,
      runs: [run],
    });
  }, { project, session, run, messages, events, workflowState, openedCapture });

  await page.waitForTimeout(500);
  await page.evaluate(({ messages, events, workflowState }) => {
    const hook = (window as Window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => Record<string, unknown>;
        seedWorkbenchState: (state: Record<string, unknown>) => void;
      };
    }).__RDC_AGENT_E2E__;
    if (!hook) {
      throw new Error('Missing E2E state hook');
    }
    hook.seedWorkbenchState({
      ...hook.getWorkbenchState(),
      conversationMessages: messages,
      actionEvents: events,
      workflowState,
    });
  }, { messages, events, workflowState });
}

function createRestoredStartupFixture(tempDir: string): { userDataDir: string; workspaceDir: string } {
  const userDataDir = path.join(tempDir, 'restored-userData');
  const workspaceDir = path.join(tempDir, 'restored-workspace');
  const projectRoot = path.join(tempDir, 'restored-project');
  const projectId = 'proj_restored_black_screen';
  const sessionId = 'sess_restored_black_screen';
  const createdAt = BASE_TIME + 300_000;
  const inputPath = path.join(projectRoot, '.resource', 'inputs', 'Character_EyeSpark_Desktop.rdc');
  const sessionPath = path.join(projectRoot, 'sessions', sessionId);

  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, 'projects', 'custom'), { recursive: true });
  fs.mkdirSync(path.dirname(inputPath), { recursive: true });
  fs.mkdirSync(sessionPath, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'workspace-bootstrap.json'), JSON.stringify({
    workspaceRoot: workspaceDir,
    legacyMigrationCompleted: true,
  }, null, 2), 'utf8');
  fs.writeFileSync(inputPath, 'fixture-capture', 'utf8');

  const project = {
    projectId,
    name: 'TestProject',
    rootPath: projectRoot,
    slug: 'custom',
    resourcePath: path.join(projectRoot, '.resource'),
    knowledgePath: path.join(projectRoot, '.resource', 'knowledge'),
    inputsPath: path.join(projectRoot, '.resource', 'inputs'),
    inputs: [{
      inputId: 'input_character_eyespark_desktop',
      fileName: 'Character_EyeSpark_Desktop.rdc',
      filePath: inputPath,
      source: 'project_resource',
      discoveredAt: createdAt,
      lastModifiedAt: createdAt,
      size: 1647684424,
    }],
    inputsUpdatedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
    lastSessionId: sessionId,
  };

  const session = {
    sessionId,
    projectId,
    title: 'new session 0',
    goal: '',
    sessionPath,
    createdAt,
    updatedAt: createdAt,
  };

  const turnId = 'turn-restored-chat';
  const assistantId = 'msga-restored-chat';
  const userMessage: ConversationMessage = {
    id: 'msgu-restored-chat',
    turnId,
    sessionId,
    projectId,
    runId: null,
    modeContext: 'debugger',
    role: 'user',
    content: 'hello',
    status: 'complete',
    updatedAt: createdAt + 1,
    reasoningTrace: null,
    attachments: [],
    createdAt: createdAt + 1,
  };
  const assistantBase: ConversationMessage = {
    id: assistantId,
    turnId,
    sessionId,
    projectId,
    runId: null,
    modeContext: 'debugger',
    role: 'assistant',
    agentId: 'rdc-debugger',
    content: '',
    status: 'streaming',
    updatedAt: createdAt + 2,
    reasoningTrace: {
      status: 'running',
      summary: 'Thinking',
      steps: [
        {
          id: 'cowork-route',
          title: 'Check context and route',
          stage: 'intake_gate',
          status: 'running',
          toolCalls: [],
          startedAt: createdAt + 2,
        },
      ],
      updatedAt: createdAt + 2,
    },
    attachments: [],
    createdAt: createdAt + 2,
  };
  const assistantFinal: ConversationMessage = {
    ...assistantBase,
    content: 'Hello, I can help analyze the current RenderDoc capture when you are ready.',
    status: 'complete',
    updatedAt: createdAt + 4,
    reasoningTrace: {
      status: 'complete',
      summary: 'Reply complete',
      steps: assistantBase.reasoningTrace?.steps.map((step) => ({
        ...step,
        status: 'complete',
        completedAt: createdAt + 4,
      })) ?? [],
      updatedAt: createdAt + 4,
    },
  };

  fs.writeFileSync(path.join(workspaceDir, 'projects', 'registry.json'), JSON.stringify({
    schemaVersion: '1',
    projects: [project],
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(workspaceDir, 'projects', 'selection.json'), JSON.stringify({
    projectId,
    sessionId,
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(workspaceDir, 'projects', 'custom', 'project.json'), JSON.stringify(project, null, 2), 'utf8');
  fs.writeFileSync(path.join(sessionPath, 'session.json'), JSON.stringify(session, null, 2), 'utf8');
  fs.writeFileSync(path.join(sessionPath, 'attachments.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(sessionPath, 'action_chain.jsonl'), '', 'utf8');
  fs.writeFileSync(
    path.join(sessionPath, 'conversation.jsonl'),
    [userMessage, assistantBase, { ...assistantBase, content: 'Hello', updatedAt: createdAt + 3 }, assistantFinal]
      .map((message) => JSON.stringify(message))
      .join('\n')
      .concat('\n'),
    'utf8',
  );

  return { userDataDir, workspaceDir };
}

test.beforeEach(async () => {
  ctx = await launchApp();
});

test.afterEach(async () => {
  await closeApp(ctx);
});

test('renders compact agentic transcript with real evidence, tools, and artifacts', async () => {
  const projectRoot = path.join(ctx.tempDir, 'message-flow-project');
  await seedTimelineScenario(ctx.page, projectRoot);

  await expect(ctx.page.locator('[data-testid="agent-message-timeline"]')).toBeVisible();
  await expect(ctx.page.locator('[data-testid="agent-timeline-user-message"]')).toContainText('请分析我自研 Agent');
  await expect(ctx.page.locator('[data-testid="agent-thinking-trace"]')).toHaveCount(0);
  await expect(ctx.page.locator('[data-testid="assistant-reasoning-toggle"]')).toHaveCount(0);
  await expect(ctx.page.locator('[data-testid="agent-thinking-area"]')).toHaveCount(0);
  await expect(ctx.page.locator('[data-testid="agent-timeline-assistant-message"]')).toContainText('可展开的思考轨迹');
  await expect(ctx.page.locator('[data-testid="agent-message-timeline"]')).not.toContainText('MessageFlow Analyst');
  await expect(ctx.page.locator('[data-testid="agent-message-timeline"]')).not.toContainText('Phase 1');
  await expect(ctx.page.locator('[data-testid="agent-message-timeline"]')).not.toContainText('Phase 2');
  await expect(ctx.page.locator('[data-testid="agent-message-timeline"]')).not.toContainText('Merge');
  await expect(ctx.page.locator('[data-testid="agent-timeline-group"]').first()).toContainText('Agent 活动');
  await expect(ctx.page.locator('[data-testid="agent-timeline-tool-call"]').first()).toContainText('InspectReference');
  const artifactSection = ctx.page.locator('[data-testid="agent-timeline-artifacts"]').first();
  await artifactSection.locator('button[aria-expanded="false"]').click();
  await expect(ctx.page.locator('[data-testid="agent-timeline-artifact-grid"]')).toContainText('message_flow_spec.md');
  await expect(ctx.page.locator('textarea.chat-input')).toBeVisible();

  const fullPageScreenshotPath = path.join(process.cwd(), 'test-results', 'agent-message-timeline-fullpage.png');
  await expectScreenshotNotBlack(ctx.page, fullPageScreenshotPath);

  const screenshotPath = path.join(process.cwd(), 'test-results', 'agent-message-timeline-pass.png');
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await ctx.page.locator('[data-testid="agent-message-timeline"]').screenshot({ path: screenshotPath });
  expect(fs.statSync(screenshotPath).size).toBeGreaterThan(20_000);

  await ctx.page.locator('[data-testid="agent-timeline-assistant-message"]').evaluate((element) => {
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
  });
  const finalAnswerBox = await ctx.page.locator('[data-testid="agent-timeline-assistant-message"]').boundingBox();
  const composerBox = await ctx.page.locator('textarea.chat-input').boundingBox();
  expect(finalAnswerBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(finalAnswerBox!.y + Math.min(finalAnswerBox!.height, 180)).toBeLessThan(composerBox!.y);

  const focusedScreenshotPath = path.join(process.cwd(), 'test-results', 'agent-message-timeline-final-visible.png');
  await expectScreenshotNotBlack(ctx.page, focusedScreenshotPath);

  const firstTool = ctx.page.locator('[data-testid="agent-timeline-tool-call"]').first();
  await expect(firstTool).toContainText('InspectReference');
  await expect(firstTool).not.toContainText('source');
  await firstTool.locator('button[aria-expanded="false"]').click();
  await expect(firstTool).toContainText('source');

  const evidenceGroup = ctx.page.locator('[data-testid="agent-timeline-group"]').filter({ hasText: '证据' }).first();
  await evidenceGroup.locator('button[aria-expanded="false"]').click();
  await expect(ctx.page.locator('[data-testid="agent-timeline-evidence-source"]').first()).toBeVisible();

  const filteredScreenshotPath = path.join(process.cwd(), 'test-results', 'agent-message-timeline-filtered.png');
  await ctx.page.locator('[data-testid="agent-message-timeline"]').screenshot({ path: filteredScreenshotPath });
  expect(fs.statSync(filteredScreenshotPath).size).toBeGreaterThan(12_000);
});

test('renders fixed Debugger product-flow session as compact main-chain transcript', async () => {
  validateProductFlowFixture();
  await setElectronWindowSize(ctx, 1720, 980);
  await seedProductFlowFixture(ctx.page);

  const page = ctx.page;
  const transcript = page.locator('[data-testid="agent-message-timeline"]');
  await expect(transcript).toBeVisible();
  await expect(page.locator('[data-testid="chat-messages"] [data-testid="plan-intake-panel"]')).toBeVisible();
  await expect(page.locator('.main-input-bar [data-testid="plan-intake-panel"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="task-board"]')).toBeVisible();

  const planCard = page.locator('[data-testid="plan-intake-panel"]');
  await expect(planCard.locator('.plan-document-card')).toHaveClass(/collapsed/);
  await expect(planCard).toContainText('RDC-Debugger audited execution plan');
  await expect(planCard).toContainText('audited_execution');
  await page.locator('[data-testid="plan-collapse-toggle"]').click();
  await expect(planCard.locator('.plan-document-card')).toHaveClass(/expanded/);
  await expect(planCard).toContainText('Action Plan');
  await expect(planCard).toContainText('Execution Route');
  await expect(planCard).toContainText('Test Plan');
  await expect(planCard).toContainText('Assumptions');
  await page.locator('[data-testid="plan-collapse-toggle"]').click();
  await expect(planCard.locator('.plan-document-card')).toHaveClass(/collapsed/);
  await expect(planCard.locator('[data-testid="plan-approve-button"]')).toHaveCount(0);

  await expect(page.locator('[data-testid="ask-user-question-card"]')).toHaveCount(0);
  await expect(transcript.locator('[data-testid="agent-timeline-tool-call"]').filter({ hasText: 'ui.ask_user_question' })).toHaveCount(0);
  await expect(transcript).toContainText('D:\\Utility\\Test RDC Files\\眼睛泪腺白点.rdc');
  await expect(transcript).toContainText('resolution_mode: audited_execution');
  await expect(transcript).toContainText('execution_readiness: ready');
  await expect(transcript).toContainText('execution_driver: rdc-execute');
  await expect(transcript).toContainText('target_event_id: 6152');
  await expect(transcript).toContainText('baseline_policy: predicate_only');
  await expect(transcript.locator('[data-testid="assistant-code-block"]').filter({ hasText: 'resolution_mode' })).toBeVisible();
  await expect(page.locator('[data-testid="conversation-assistant-card"]').filter({ hasText: '计划已批准' })).toHaveCount(0);
  await expect(page.locator('[data-testid="conversation-assistant-card"]').filter({ hasText: '正在检查' })).toHaveCount(0);
  await expect(page.locator('[data-testid="agent-thinking-trace"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="assistant-reasoning-toggle"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="agent-thinking-area"]')).toHaveCount(0);

  const contextGroup = transcript.locator('[data-testid="agent-timeline-group"]').filter({ hasText: /Reviewed|Searched|Explored/ }).first();
  await expect(contextGroup).toBeVisible();
  await expect(contextGroup).not.toContainText('system-config.yaml');
  await contextGroup.locator('button[aria-expanded="false"]').click();
  await expect(contextGroup).toContainText(/read_file|grep_search|file_search|list_dir/);

  const helperBrief = transcript.locator('[data-testid="agent-timeline-tool-call"]').filter({ hasText: 'runSubagent.triage-taxonomy' }).first();
  await expect(helperBrief).toBeVisible();
  await expect(helperBrief).not.toContainText('symptom_tags');
  await helperBrief.locator('button[aria-expanded="false"]').click();
  await expect(helperBrief).toContainText('symptom_tags');
  await expect(transcript.locator('[data-testid="agent-timeline-tool-call"]').filter({ hasText: 'runSubagent.capture-repro' })).toBeVisible();
  await expect(page.locator('[data-testid="task-board"]')).toContainText('Open capture through local rdx');
  await expect(page.locator('[data-testid="task-board"]')).toContainText('Anchor Event 6152');
  await expect(page.locator('[data-testid="task-board"]')).toContainText('Audit shader / IBL / specular inputs');

  const railAlignment = await page.evaluate(() => {
    const rail = document.querySelector('[data-testid="agent-message-timeline"]');
    const userRow = document.querySelector('[data-testid="agent-timeline-user-message"]');
    const userBubble = document.querySelector('[data-testid="conversation-user-brief"]');
    const assistantRow = document.querySelector('[data-testid="agent-timeline-assistant-message"]');
    if (!(rail instanceof HTMLElement)
      || !(userRow instanceof HTMLElement)
      || !(userBubble instanceof HTMLElement)
      || !(assistantRow instanceof HTMLElement)) {
      return null;
    }
    const railRect = rail.getBoundingClientRect();
    const userRowRect = userRow.getBoundingClientRect();
    const userBubbleRect = userBubble.getBoundingClientRect();
    const assistantRect = assistantRow.getBoundingClientRect();
    return {
      userRowRight: Math.abs(railRect.right - userRowRect.right),
      userBubbleRight: Math.abs(railRect.right - userBubbleRect.right),
      assistantLeft: Math.abs(assistantRect.left - railRect.left),
    };
  });
  expect(railAlignment).not.toBeNull();
  expect(railAlignment?.userRowRight ?? 99).toBeLessThanOrEqual(4);
  expect(railAlignment?.userBubbleRight ?? 99).toBeLessThanOrEqual(52);
  expect(railAlignment?.assistantLeft ?? 99).toBeLessThanOrEqual(4);

  const wideScreenshotPath = path.join(process.cwd(), 'test-results', 'product-flow-1720x980.png');
  await expectScreenshotNotBlack(page, wideScreenshotPath);
  await setElectronWindowSize(ctx, 1280, 800);
  const narrowScreenshotPath = path.join(process.cwd(), 'test-results', 'product-flow-1280x800.png');
  await expectScreenshotNotBlack(page, narrowScreenshotPath);
});

test('restored real-session startup renders the shared message flow and is not black', async () => {
  const tempDir = ctx.tempDir;
  await closeApp(ctx, { cleanup: false });

  const { userDataDir, workspaceDir } = createRestoredStartupFixture(tempDir);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  ctx = await launchApp({
    tempDir,
    userDataDir,
    workspaceDir,
    onConsole: (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    },
    onPageError: (error) => {
      pageErrors.push(error.message);
    },
  });

  await expect(ctx.page.locator('.app-titlebar')).toBeVisible();
  await expect(ctx.page.locator('.app-body')).toBeVisible();
  await expect(ctx.page.locator('[data-testid="agent-chat"]')).toBeVisible();
  await expect(ctx.page.locator('textarea.chat-input')).toBeVisible();

  await expect.poll(async () => ctx.page.evaluate(() => (
    (window as Window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => {
          currentProject: { name: string } | null;
          currentSession: { sessionId: string } | null;
          conversationMessages: Array<{ id: string; role: string; content: string }>;
        };
      };
    }).__RDC_AGENT_E2E__?.getWorkbenchState() ?? null
  ))).toMatchObject({
    currentProject: { name: 'TestProject' },
    currentSession: { sessionId: 'sess_restored_black_screen' },
  });

  await expect(ctx.page.locator('[data-testid="agent-message-timeline"]')).toBeVisible();
  await expect(ctx.page.locator('[data-testid="agent-timeline-user-message"]')).toContainText('hello');
  await expect(ctx.page.locator('[data-testid="agent-timeline-toolbar"]')).toHaveCount(0);
  await expect(ctx.page.locator('[data-testid="agent-timeline-assistant-message"]')).toContainText('Hello, I can help');
  await expect(ctx.page.locator('[data-testid="agent-message-timeline"]')).not.toContainText('MessageFlow Analyst');
  await expect(ctx.page.locator('[data-testid="agent-message-timeline"]')).not.toContainText('Phase 1');
  await expect(ctx.page.locator('[data-testid="agent-message-timeline"]')).not.toContainText('Merge');
  await expect(ctx.page.locator('[data-testid="agent-timeline-subagent-group"]')).toHaveCount(0);
  await expect(ctx.page.locator('[data-testid="agent-timeline-tool-call"]')).toHaveCount(0);
  await expect(ctx.page.locator('[data-testid="agent-timeline-merge"]')).toHaveCount(0);

  const messageCounts = await ctx.page.evaluate(() => {
    const state = (window as Window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => {
          conversationMessages: Array<{ id: string; role: string; content: string }>;
        };
      };
    }).__RDC_AGENT_E2E__?.getWorkbenchState();
    return {
      total: state?.conversationMessages.length ?? 0,
      assistant: state?.conversationMessages.filter((message) => message.role === 'assistant').length ?? 0,
    };
  });
  expect(messageCounts).toEqual({ total: 2, assistant: 1 });

  const screenshotPath = path.join(process.cwd(), 'test-results', 'restored-startup-not-black.png');
  await expectScreenshotNotBlack(ctx.page, screenshotPath);
  const viewport = ctx.page.viewportSize();
  if (viewport) {
    const centerStats = parsePngStats(
      fs.readFileSync(screenshotPath),
      {
        x: viewport.width * 0.2,
        y: viewport.height * 0.2,
        width: viewport.width * 0.6,
        height: viewport.height * 0.55,
      },
    );
    expect(centerStats.averageLuma).toBeGreaterThan(8);
    expect(centerStats.nonBlackRatio).toBeGreaterThan(0.035);
  }

  const fatalConsoleErrors = consoleErrors.filter((message) =>
    /uncaught|cannot read|failed to load resource|react|typeerror|referenceerror/i.test(message));
  expect(pageErrors).toEqual([]);
  expect(fatalConsoleErrors).toEqual([]);
});
