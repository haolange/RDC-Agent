#!/usr/bin/env node
// Browser QA wire stub: a deterministic, local Ollama-compatible endpoint so a disposable QA instance can
// connect the built-in "Ollama" provider and walk the real Composer, transcript and Work Process without
// credentials or a model. It is QA tooling only (never packaged) and serves just what the product's
// Ollama adapter and discovery call:
//   GET  /api/tags   one installed model
//   POST /api/show   its capabilities (tools, thinking) and trained context length
//   POST /api/chat   NDJSON stream. The capability probe's `capability_check` is answered with a structured
//                    call. An agent turn follows a scenario chosen by a keyword in the latest user message:
//     (default)  thinking → one `glob` call → streamed answer
//     qa:loops   thinking → task_create → commentary + glob → start two Tasks → complete, cancel and block → answer
//     qa:long    five model steps of six parallel `glob` calls each, then a long Markdown answer
//     qa:plan    (Mission agents) thinking → plan_artifact; the plan gate then pauses the turn
//   An approved plan's execution turn (default scenario with `turn_complete` offered) declares an honest
//   blocked outcome after its `glob`: the workspace has no capture, so the frozen goal cannot finish here.
//   Runtime follow-up prompts ("# Incomplete Approved Obligation", "# Approved Goal Reassessment") continue
//   the scripted turn instead of restarting it.
// Usage: node scripts/qa-ollama-stub.mjs [port]   (default 11434); then connect Settings › Ollama with
// its default Base URL (or http://127.0.0.1:<port>/v1).
import http from 'node:http';

const port = Number(process.argv[2] ?? 11434);
const MODEL = 'qa-stub:4b';
const CONTEXT_LENGTH = 32768;
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
const PLAN = {
  title: '定位 vkcube 帧的唯一 draw 调用',
  summary: ['列出事件树并确认唯一的 draw 调用', '读取该调用的管线状态', '用三句话总结这一帧画了什么'],
  content: '## 目标\n\n确认这一帧只有一次 draw 调用，并说明它画了什么。\n\n## 步骤\n\n1. 列出事件树。\n2. 读取 draw 调用的管线状态。\n3. 汇总结论。\n',
  requiredTaskIds: [],
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
    scenario: ['qa:loops', 'qa:long', 'qa:plan'].find((keyword) => prompt.includes(keyword)) ?? 'default',
    step: after.filter((entry) => entry.role === 'assistant').length,
    toolResults: after.filter((entry) => entry.role === 'tool').map((entry) => String(entry.content ?? '')),
  };
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

function longScenario(state, tools) {
  if (state.step < 5 && tools.has('glob')) {
    const calls = Array.from({ length: 6 }, (_, index) => ['glob', { pattern: index % 2 ? '*.rdc' : '*' }]);
    return [...(state.step === 0 ? thinking(['需要多轮核对列举结果，', '每轮并行执行。']) : []), toolCalls(calls)];
  }
  return text(LONG_ANSWER);
}

function chatChunks(body) {
  const tools = new Set((body.tools ?? []).map((tool) => tool.function?.name));
  if (tools.has('capability_check')) return [toolCalls([['capability_check', { ok: true }]])];
  const state = turnState(body);
  if (state.scenario === 'qa:loops') return loopsScenario(state, tools);
  if (state.scenario === 'qa:long') return longScenario(state, tools);
  if (state.scenario === 'qa:plan' && tools.has('plan_artifact') && state.step === 0) {
    return [...thinking(['先把调查计划写出来，', '交给用户审阅。']), toolCalls([['plan_artifact', PLAN]])];
  }
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
      return json(response, 200, { models: [{ name: MODEL, model: MODEL, details: { family: 'qa-stub' } }] });
    }
    if (request.method === 'POST' && url.pathname === '/api/show') {
      const body = await readBody(request);
      if (body.model !== MODEL) return json(response, 404, { error: `model "${body.model}" not found` });
      return json(response, 200, {
        capabilities: ['completion', 'tools', 'thinking'],
        model_info: { 'general.architecture': 'qa-stub', 'qa-stub.context_length': CONTEXT_LENGTH },
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/chat') {
      const body = await readBody(request);
      const state = turnState(body);
      console.log(`[qa-ollama-stub]   scenario=${state.scenario} step=${state.step} think=${body.think ?? '(unset)'} tools=${(body.tools ?? []).length}`);
      return await streamChat(response, chatChunks(body));
    }
    return json(response, 404, { error: 'not found' });
  } catch (error) {
    return json(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`[qa-ollama-stub] listening on http://127.0.0.1:${port}`));
