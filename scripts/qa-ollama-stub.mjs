#!/usr/bin/env node
// Browser QA wire stub: a deterministic, local Ollama-compatible endpoint so a disposable QA instance can
// connect the built-in "Ollama" provider and walk the real Composer, transcript and Work Process without
// credentials or a model. It is QA tooling only (never packaged) and serves just what the product's
// Ollama adapter and discovery call:
//   GET  /api/tags   three installed models, so model lists and pickers show real variety
//   POST /api/show   each model's capabilities (tools, thinking, vision) and trained context length
//   POST /api/chat   NDJSON stream. The capability probe's `capability_check` is answered with a structured
//                    call. An agent turn follows a scenario chosen by a keyword in the latest user message:
//     (default)  thinking → one `glob` call → streamed answer
//     qa:loops   thinking → task_create → commentary + glob → start two Tasks → complete, cancel and block → answer
//     qa:long    fifty model steps of six parallel `glob` / `grep` / `read_file` calls (300 actions) with commentary
//                and thinking every few steps, then a long Markdown answer — the scale of a real investigation
//     qa:plan    (Mission agents) thinking → plan_artifact; the plan gate then pauses the turn. A rejection with
//                feedback returns in the same turn, and the stub submits the next revision with one more step
//     qa:partial  like qa:plan, but the approved execution reports an honest partial result: two checks, then
//                turn_complete(partial); a reassessment (inside the tool result or as a runtime follow-up) gets one
//                more check and the same declaration again, then a reply with a table
//     qa:markdown an answer exercising the Markdown renderer: headings, callout, table, titled and long code, Mermaid,
//                footnote and a project image (docs/frame.png, written by the walkthrough)
//     qa:subagent thinking → tool_search loads `subagent` → one waited delegation to Verifier → answer; the child
//                 (recognised by the delegated task text) declares a completed result through turn_complete
//   An approved plan's execution turn (default scenario with `turn_complete` offered) declares an honest
//   blocked outcome after its `glob`: the workspace has no capture, so the frozen goal cannot finish here.
//   Runtime follow-up prompts ("# Incomplete Approved Obligation", "# Approved Goal Reassessment") continue
//   the scripted turn instead of restarting it.
// Usage: node scripts/qa-ollama-stub.mjs [port]   (default 11434); then connect Settings › Ollama with
// its default Base URL (or http://127.0.0.1:<port>/v1).
import http from 'node:http';

const port = Number(process.argv[2] ?? 11434);
const MODEL = 'qa-stub:4b';
const MODELS = [
  { name: MODEL, capabilities: ['completion', 'tools', 'thinking'], contextLength: 32768 },
  { name: 'qa-vision:12b', capabilities: ['completion', 'tools', 'vision'], contextLength: 131072 },
  { name: 'qa-coder:32b', capabilities: ['completion', 'tools', 'thinking'], contextLength: 262144 },
];
const CHUNK_DELAY_MS = 120;

const THINKING = ['先确认工作区里有哪些文件，', '再决定从哪里开始看。'];
const ANSWER = [
  '我列出了工作区的文件。',
  '\n\n这是 QA 协议桩的固定回复：',
  '它验证流式推理、一次工具调用与最终答复在界面上的顺序与折叠。',
];
const LONG_ANSWER = [
  '## 结论\n\n工作区只有一个 capture，五轮列举结果一致。\n\n',
  ...Array.from({ length: 24 }, (_, index) => `- 第 ${index + 1} 项检查：列举结果与上一轮一致，没有新增或缺失的文件。\n`),
  '\n```text\nvkcube_lavapipe.rdc\n```\n\n',
  '## 下一步\n\n导入这个 capture 后再读取事件树与管线状态。\n',
];
const MARKDOWN_ANSWER = [
  '# 排版样例\n\n这一帧的结论先写在最前面[^1]。\n\n',
  '## 关键发现\n\n### 着色阶段\n\n#### 细节\n\n正文段落使用阅读字号，`inline code` 保持等宽。\n\n',
  '> [!WARNING]\n> 修改着色器前先备份 capture。\n\n',
  '| Pass | 耗时 | 结论 |\n| --- | --- | --- |\n',
  ...Array.from({ length: 12 }, (_, index) => `| Pass ${index + 1} | ${((index + 1) * 0.4).toFixed(1)} ms | 正常 |\n`),
  '\n```hlsl:shaders/lighting.hlsl\nfloat4 main(float4 pos : SV_Position) : SV_Target\n{\n    return saturate(float4(pos.xy / 512.0, 0.5, 1.0));\n}\n```\n\n',
  '```diff\n- float exposure = 1.0;\n+ float exposure = 0.8;\n```\n\n',
  `\`\`\`ts\n${Array.from({ length: 36 }, (_, index) => `const pass${index} = measure(${index});`).join('\n')}\n\`\`\`\n\n`,
  '```mermaid\ngraph LR\n  A[Capture] --> B[Replay]\n  B --> C[Compare]\n```\n\n',
  '![修复前的这一帧](docs/frame.png)\n\n',
  '[^1]: 结论来自同一 capture 的两次回放。\n',
];
const PLAN_STEPS = ['列出事件树并确认唯一的 draw 调用', '读取该调用的管线状态', '用三句话总结这一帧画了什么',
  '对照参考帧复核输出颜色', '记录无法确认的部分和恢复条件'];
/** Revision N of the scripted plan: each revision adds one step, so the CoT card visibly changes. */
const planRevision = (revision) => {
  const steps = PLAN_STEPS.slice(0, Math.min(PLAN_STEPS.length, 2 + revision));
  return {
    title: '定位 vkcube 帧的唯一 draw 调用',
    summary: steps,
    content: `## 目标\n\n确认这一帧只有一次 draw 调用，并说明它画了什么。\n\n## 步骤\n\n${steps.map((item, index) => `${index + 1}. ${item}。`).join('\n')}\n\n## 完成标准\n\n每一步都有回放证据；无法确认的部分单独列出。\n`,
    requiredTaskIds: [],
  };
};
const DELEGATION = {
  profile: 'verifier', mode: 'wait',
  goal: '核对工作区里是否已有可回放的 capture',
  task: '列出工作区文件，确认有没有 .rdc capture，并说明下一步。',
  scope: '只读工作区文件', acceptedFacts: [], hypotheses: [], challengeRefs: [], negativePaths: [], inputArtifactRefs: [],
  outputRequirements: '一句话结论', stopConditions: ['列完文件即停止'], requiredSkillIds: [],
};
const BLOCKED_COMPLETION = {
  disposition: 'blocked',
  result: {
    summary: '工作区里没有 capture，无法定位 draw 调用。',
    outputs: {},
    counterevidence: [],
    unresolved: [{ gap: '定位唯一的 draw 调用并读取管线状态', attempted: '列出了工作区文件，没有找到 capture。', blocker: 'external', resumeWhen: '导入 capture 后' }],
    scope: '只读核对工作区文件',
    sideEffects: [],
    recoveryState: [],
  },
};

const PARTIAL_COMPLETION = {
  disposition: 'partial',
  result: {
    summary: '工作区里的文件已核对；没有 capture，draw 调用和管线状态无法确认。',
    outputs: {},
    counterevidence: [],
    unresolved: [
      { gap: '定位唯一的 draw 调用', attempted: '列出了工作区文件和 docs 目录，没有找到 .rdc。', blocker: 'external', resumeWhen: '导入 capture 后' },
      { gap: '读取 draw 调用的管线状态', attempted: '依赖上一项，尚未开始。', blocker: 'external', resumeWhen: '定位到 draw 调用后' },
    ],
    scope: '只读核对工作区文件',
    sideEffects: [],
    recoveryState: [],
  },
};
const PARTIAL_ANSWER = [
  '## 结论\n\n工作区里没有 capture，这一帧的 draw 调用还无法定位。[Unresolved]\n\n',
  '| 检查 | 结果 |\n| --- | --- |\n| 工作区文件 | 只有 docs/frame.png |\n| capture | 未找到 |\n| 管线状态 | 未开始 |\n\n',
  '## 恢复条件\n\n导入 capture 后，从事件树开始继续。\n',
];

const CHILD_COMPLETION = {
  disposition: 'completed',
  result: {
    summary: '工作区里没有 .rdc capture，需要先导入。',
    outputs: {},
    counterevidence: [],
    unresolved: [],
    scope: '只读核对工作区文件',
    sideEffects: [],
    recoveryState: [],
  },
};

const CHILD_DELAY_MS = 4000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

function json(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}

const message = (fields) => ({ model: MODEL, created_at: new Date().toISOString(), message: { role: 'assistant', content: '', ...fields }, done: false });
const toolCalls = (calls) => message({ tool_calls: calls.map(([name, args]) => ({ function: { name, arguments: args } })) });
const thinking = (lines) => lines.map((text) => message({ thinking: text }));
const text = (lines) => lines.map((content) => message({ content }));

async function streamChat(response, chunks) {
  response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  for (const chunk of chunks) {
    response.write(`${JSON.stringify(chunk)}\n`);
    await sleep(CHUNK_DELAY_MS);
  }
  response.end(`${JSON.stringify({ model: MODEL, created_at: new Date().toISOString(), message: { role: 'assistant', content: '' },
    done: true, done_reason: 'stop', prompt_eval_count: 1200, eval_count: 80 })}\n`);
}

/** Runtime follow-up prompts are Markdown-headed; they continue the scripted turn rather than start a new one. */
const isRuntimeFollowUp = (entry) => typeof entry.content === 'string' && entry.content.startsWith('# ');

/** The latest user message and the tool results that followed it decide where the scripted turn is. */
function turnState(body) {
  const messages = body.messages ?? [];
  const lastUser = messages.map((entry) => entry.role === 'user' && !isRuntimeFollowUp(entry)).lastIndexOf(true);
  const after = messages.slice(lastUser + 1);
  const prompt = typeof messages[lastUser]?.content === 'string' ? messages[lastUser].content : '';
  return {
    scenario: prompt.includes(DELEGATION.task) ? 'qa:subagent-child'
      : ['qa:loops', 'qa:long', 'qa:plan', 'qa:partial', 'qa:subagent', 'qa:markdown'].find((keyword) => prompt.includes(keyword))
        ?? sessionScenario(messages.slice(0, lastUser)) ?? 'default',
    step: after.filter((entry) => entry.role === 'assistant').length,
    toolResults: after.filter((entry) => entry.role === 'tool').map((entry) => String(entry.content ?? '')),
    after,
    planRevisions: messages.filter((entry) => entry.role === 'assistant'
      && (entry.tool_calls ?? []).some((call) => call.function?.name === 'plan_artifact')).length,
  };
}

/**
 * A plan revision and an approved execution arrive as their own user messages without a keyword; the planning
 * message earlier in the session decides which scripted flow they continue.
 */
function sessionScenario(history) {
  const prompts = history.filter((entry) => entry.role === 'user' && !isRuntimeFollowUp(entry)).map((entry) => String(entry.content ?? ''));
  const planning = prompts.findLast((prompt) => prompt.includes('qa:plan') || prompt.includes('qa:partial'));
  return planning?.includes('qa:partial') ? 'qa:partial-flow' : planning ? 'qa:plan-flow' : undefined;
}

function loopsScenario(state, tools) {
  if (state.step === 0 && tools.has('task_create')) {
    return [...thinking(['这次要分三步做，', '先把任务列出来。']), toolCalls([['task_create', { tasks: [
      { subject: '列出工作区文件' }, { subject: '确认 capture 是否已导入' }, { subject: '整理结论' },
    ] }]])];
  }
  if (state.step === 1) return [...text(['先看看工作区里有什么。']), toolCalls([['glob', { pattern: '*' }]])];
  // A Task settles only after it started, so the stub starts two first and settles them a loop later.
  const [first, second, third] = [...state.toolResults.join('\n').matchAll(/Created (\S+?):/g)].map((match) => match[1]);
  if (state.step === 2 && tools.has('task_update') && first && third) {
    return [...thinking(['文件已经列出，', '先开始第一项和第三项。']), toolCalls([
      ['task_update', { taskId: first, status: 'in_progress' }],
      ['task_update', { taskId: third, status: 'in_progress' }],
    ])];
  }
  // Every Task ends settled (done, cancelled, blocked), so the runtime does not ask for another loop.
  if (state.step === 3 && tools.has('task_update') && first && second && third) {
    return [...thinking(['第一项完成了，', '第二项不需要了，第三项要等 capture。']), toolCalls([
      ['task_update', { taskId: first, status: 'completed' }],
      ['task_update', { taskId: second, status: 'cancelled', statusReason: '工作区里没有 capture，这一项不再需要。' }],
      ['task_update', { taskId: third, status: 'blocked', statusReason: '等待 capture 导入后才能整理结论。' }],
    ])];
  }
  return [...thinking(['信息已经够了，', '可以给出结论。']), ...text(ANSWER)];
}

const LONG_STEPS = 50;
/** One step of six parallel reads that mixes the three primitive families a real investigation uses. */
function longStepCalls(step, tools) {
  return Array.from({ length: 6 }, (_, index) => {
    const slot = (step + index) % 3;
    if (slot === 1 && tools.has('grep')) return ['grep', { pattern: index % 2 ? 'draw' : 'pipeline', path: '.' }];
    if (slot === 2 && tools.has('read_file')) return ['read_file', { path: 'docs/notes.md' }];
    return ['glob', { pattern: index % 2 ? '**/*.rdc' : 'docs/*' }];
  });
}

function longScenario(state, tools) {
  if (state.step < LONG_STEPS && tools.has('glob')) {
    const lead = state.step === 0 ? thinking(['需要多轮核对列举结果，', '每轮并行执行。'])
      : state.step % 10 === 0 ? text([`第 ${state.step / 10} 组核对完成，结果与上一组一致，继续下一组。`])
        : state.step % 7 === 0 ? thinking(['这一轮的结果和上一轮相同，', '继续扩大范围。']) : [];
    return [...lead, toolCalls(longStepCalls(state.step, tools))];
  }
  return text(LONG_ANSWER);
}

/** Runtime reassessments arrive either inside a tool result or as a Markdown-headed runtime follow-up. */
const isReassessment = (entry) => typeof entry.content === 'string' && entry.content.includes('Reassessment');
const isDeclaration = (entry) => entry.role === 'tool' && String(entry.content ?? '').includes('Turn completion recorded');

/**
 * The approved execution of qa:partial: two checks, an honest partial declaration, one more check after each
 * reassessment the runtime asks for, then a reply. The stub never invents progress it did not make.
 */
function partialExecution(state, tools) {
  const { after } = state;
  const declarations = after.filter(isDeclaration).length;
  const lastReassessment = after.findLastIndex(isReassessment);
  // A reassessment is answered once the stub has declared again after it; three declarations end the script.
  const pending = lastReassessment >= 0 && declarations < 3 && !after.slice(lastReassessment + 1).some(isDeclaration);
  if (state.toolResults.length === 0) return [...thinking(['先核对工作区里有没有 capture，', '再决定能做到哪一步。']), toolCalls([['glob', { pattern: '*' }]])];
  if (state.toolResults.length === 1) return [...text(['工作区根目录没有 capture，再看看 docs 目录。']), toolCalls([['glob', { pattern: 'docs/*' }], ['glob', { pattern: '**/*.rdc' }]])];
  if (declarations === 0) return [toolCalls([['turn_complete', PARTIAL_COMPLETION]])];
  if (pending) {
    const checkedSince = after.slice(lastReassessment + 1).filter((entry) => entry.role === 'tool' && !isDeclaration(entry)).length;
    if (checkedSince === 0) return [...thinking(['复评要求再确认一次，', '换个范围找 capture。']), toolCalls([['glob', { pattern: '**/*.rdc' }]])];
    return [toolCalls([['turn_complete', PARTIAL_COMPLETION]])];
  }
  return text(PARTIAL_ANSWER);
}

function chatChunks(body) {
  const tools = new Set((body.tools ?? []).map((tool) => tool.function?.name));
  if (tools.has('capability_check')) return [toolCalls([['capability_check', { ok: true }]])];
  const state = turnState(body);
  if (state.scenario === 'qa:loops') return loopsScenario(state, tools);
  if (state.scenario === 'qa:long') return longScenario(state, tools);
  if (state.scenario === 'qa:markdown') return text(MARKDOWN_ANSWER);
  if (state.scenario === 'qa:subagent') {
    // subagent is a deferred tool: load it through tool_search first, then delegate once and answer.
    const delegated = state.toolResults.length >= 2;
    if (!delegated && !tools.has('subagent') && tools.has('tool_search')) {
      return [...thinking(['这件事交给 Verifier 去核对，', '我等它的结论。']), toolCalls([['tool_search', { query: 'subagent' }]])];
    }
    if (!delegated && tools.has('subagent')) return [toolCalls([['subagent', DELEGATION]])];
    return text(['Verifier 核对完了：工作区里没有 capture，需要先导入再继续。']);
  }
  if (state.scenario === 'qa:subagent-child') {
    const declared = state.toolResults.some((result) => result.includes('Turn completion recorded'));
    if (!declared && tools.has('turn_complete')) return [...thinking(['工作区里没有 .rdc 文件，', '结论可以交回。']), toolCalls([['turn_complete', CHILD_COMPLETION]])];
    return text(['工作区里没有 .rdc capture，需要先导入。']);
  }
  const planning = ['qa:plan', 'qa:partial', 'qa:plan-flow', 'qa:partial-flow'].includes(state.scenario);
  // A rejected revision comes back as the plan_artifact result in the same turn; the stub submits the next one.
  const rejected = state.toolResults.at(-1)?.startsWith('rejected\nfeedback:');
  if (planning && tools.has('plan_artifact') && (state.step === 0 || rejected)) {
    const revision = state.planRevisions + 1;
    return [...thinking(revision === 1 ? ['先把调查计划写出来，', '交给用户审阅。'] : ['按反馈修改计划，', '补上复核和未知项的步骤。']),
      toolCalls([['plan_artifact', planRevision(revision)]])];
  }
  if (state.scenario === 'qa:partial-flow' && tools.has('turn_complete')) return partialExecution(state, tools);
  const declared = state.toolResults.some((result) => result.includes('Turn completion recorded'));
  if (tools.has('turn_complete') && state.toolResults.length > 0 && !declared) return [toolCalls([['turn_complete', BLOCKED_COMPLETION]])];
  if (state.toolResults.length > 0 || !tools.has('glob')) return text(ANSWER);
  return [...thinking(THINKING), toolCalls([['glob', { pattern: '*' }]])];
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
    console.log(`[qa-ollama-stub] ${request.method} ${url.pathname}`);
    if (request.method === 'GET' && url.pathname === '/api/tags') {
      return json(response, 200, { models: MODELS.map(({ name }) => ({ name, model: name, details: { family: name.split(':')[0] } })) });
    }
    if (request.method === 'POST' && url.pathname === '/api/show') {
      const body = await readBody(request);
      const model = MODELS.find(({ name }) => name === body.model);
      if (!model) return json(response, 404, { error: `model "${body.model}" not found` });
      const family = model.name.split(':')[0];
      return json(response, 200, {
        capabilities: model.capabilities,
        model_info: { 'general.architecture': family, [`${family}.context_length`]: model.contextLength },
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/chat') {
      const body = await readBody(request);
      const state = turnState(body);
      console.log(`[qa-ollama-stub]   scenario=${state.scenario} step=${state.step} think=${body.think ?? '(unset)'} tools=${(body.tools ?? []).length}`);
      // The delegated child answers after a pause so the running subagent card stays on screen long enough to inspect.
      if (state.scenario === 'qa:subagent-child' && state.step === 0) await sleep(CHILD_DELAY_MS);
      return await streamChat(response, chatChunks(body));
    }
    return json(response, 404, { error: 'not found' });
  } catch (error) {
    return json(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`[qa-ollama-stub] listening on http://127.0.0.1:${port}`));
