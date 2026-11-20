#!/usr/bin/env node
// Browser QA wire stub: a deterministic, local Ollama-compatible endpoint so a disposable QA instance can
// connect the built-in "Ollama" provider and walk the real Composer, transcript and Work Process without
// credentials or a model. It is QA tooling only (never packaged) and serves just what the product's
// Ollama adapter and discovery call:
//   GET  /api/tags   one installed model
//   POST /api/show   its capabilities (tools, thinking) and trained context length
//   POST /api/chat   NDJSON stream; the capability probe's `capability_check` is answered with a structured
//                    call, and an agent turn is scripted as: streamed thinking → one `glob` call → (after
//                    the tool result) a streamed answer.
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
const toolCall = (name, args) => message({ tool_calls: [{ function: { name, arguments: args } }] });

async function streamChat(response, chunks) {
  response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  for (const chunk of chunks) {
    response.write(`${JSON.stringify(chunk)}\n`);
    await sleep(CHUNK_DELAY_MS);
  }
  response.end(`${JSON.stringify({ model: MODEL, created_at: new Date().toISOString(), message: { role: 'assistant', content: '' },
    done: true, done_reason: 'stop', prompt_eval_count: 1200, eval_count: 80 })}\n`);
}

function chatChunks(body) {
  const tools = (body.tools ?? []).map((tool) => tool.function?.name);
  if (tools.includes('capability_check')) return [toolCall('capability_check', { ok: true })];
  if (body.messages?.at(-1)?.role === 'tool') return ANSWER.map((content) => message({ content }));
  const thinking = THINKING.map((text) => message({ thinking: text }));
  if (!tools.includes('glob')) return [...thinking, ...ANSWER.map((content) => message({ content }))];
  return [...thinking, toolCall('glob', { pattern: '*' })];
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
      console.log(`[qa-ollama-stub]   think=${body.think ?? '(unset)'} tools=${(body.tools ?? []).length}`);
      return streamChat(response, chatChunks(body));
    }
    return json(response, 404, { error: 'not found' });
  } catch (error) {
    return json(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`[qa-ollama-stub] listening on http://127.0.0.1:${port}`));
