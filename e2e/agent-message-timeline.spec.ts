import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { expect, test } from '@playwright/test';
import { AppContext, closeApp, launchApp } from './helpers/electron-app';
import type { ConversationMessage } from '../src/shared/types/conversation';
import type { ActionEvent } from '../src/shared/types/evidence';
import type { WorkflowState } from '../src/shared/types/workflow';

let ctx: AppContext;

const BASE_TIME = Date.UTC(2026, 4, 3, 9, 21, 0);

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

test('renders collapsible thinking trace with real evidence, tools, and artifacts', async () => {
  const projectRoot = path.join(ctx.tempDir, 'message-flow-project');
  await seedTimelineScenario(ctx.page, projectRoot);

  await expect(ctx.page.locator('[data-testid="agent-message-timeline"]')).toBeVisible();
  await expect(ctx.page.locator('[data-testid="agent-timeline-user-message"]')).toContainText('请分析我自研 Agent');
  await expect(ctx.page.locator('[data-testid="agent-thinking-trace"]')).toContainText('部分完成');
  await expect(ctx.page.locator('[data-testid="agent-thinking-area"]')).toHaveCount(0);
  await expect(ctx.page.locator('[data-testid="agent-timeline-assistant-message"]')).toContainText('可展开的思考轨迹');
  await expect(ctx.page.locator('[data-testid="agent-message-timeline"]')).not.toContainText('MessageFlow Analyst');
  await expect(ctx.page.locator('[data-testid="agent-message-timeline"]')).not.toContainText('Phase 1');
  await expect(ctx.page.locator('[data-testid="agent-message-timeline"]')).not.toContainText('Phase 2');
  await expect(ctx.page.locator('[data-testid="agent-message-timeline"]')).not.toContainText('Merge');
  await ctx.page.locator('[data-testid="agent-thinking-trace"] button[aria-expanded="false"]').click();
  await expect(ctx.page.locator('[data-testid="agent-thinking-area"]')).toBeVisible();
  await expect(ctx.page.locator('[data-testid="agent-timeline-group"]').first()).toContainText('思考');
  await expect(ctx.page.locator('[data-testid="agent-timeline-tool-call"]').first()).toContainText('InspectReference');
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

  await expect(ctx.page.locator('[data-testid="agent-timeline-evidence-source"]').first()).toBeVisible();

  await ctx.page.locator('[data-testid="agent-thinking-trace"] > button[aria-expanded="true"]').click();
  await expect(ctx.page.locator('[data-testid="agent-thinking-area"]')).toHaveCount(0);

  const filteredScreenshotPath = path.join(process.cwd(), 'test-results', 'agent-message-timeline-filtered.png');
  await ctx.page.locator('[data-testid="agent-message-timeline"]').screenshot({ path: filteredScreenshotPath });
  expect(fs.statSync(filteredScreenshotPath).size).toBeGreaterThan(12_000);
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
