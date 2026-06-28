"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const electron = require("electron");
const path = require("path");
const url = require("url");
const child_process = require("child_process");
const fs = require("fs");
const uuid = require("uuid");
const YAML = require("yaml");
const os = require("os");
const crypto = require("crypto");
const node_fs = require("node:fs");
const path$1 = require("node:path");
const node_crypto = require("node:crypto");
const fs$1 = require("fs/promises");
const util = require("util");
const promises = require("dns/promises");
const net = require("net");
const http = require("http");
const https = require("https");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const os__namespace = /* @__PURE__ */ _interopNamespaceDefault(os);
const crypto__namespace = /* @__PURE__ */ _interopNamespaceDefault(crypto);
const path__namespace$1 = /* @__PURE__ */ _interopNamespaceDefault(path$1);
const fs__namespace$1 = /* @__PURE__ */ _interopNamespaceDefault(fs$1);
const net__namespace = /* @__PURE__ */ _interopNamespaceDefault(net);
function generateShortId() {
  return uuid.v4().replace(/-/g, "").slice(0, 12);
}
function generateEventId(prefix = "evt") {
  return `${prefix}-${generateShortId()}-${Date.now()}`;
}
function generateRunId() {
  const random = Math.random().toString(36).slice(2, 6);
  return `run_${random}`;
}
function sanitizeToken(value) {
  const text = value.split("").map((ch) => ch.isAlphanumeric() || ch === "_" || ch === "-" ? ch : "-").join("").replace(/^-+|-+$/g, "");
  return text || "unknown";
}
String.prototype.isAlphanumeric = function() {
  return /^[a-zA-Z0-9]$/.test(this);
};
function nowMs() {
  return Date.now();
}
function nowIso$1() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
const clients = /* @__PURE__ */ new Set();
function writeEvent(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}

`);
}
const rendererEventHub = {
  emit(channel, ...args) {
    const payload = { channel, args };
    for (const client of clients) {
      writeEvent(client, payload);
    }
  },
  connect(response) {
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Private-Network": "true",
      "Cache-Control": "no-store",
      "Content-Type": "text/event-stream; charset=utf-8",
      "Connection": "keep-alive"
    });
    response.write("retry: 1000\n\n");
    clients.add(response);
    const heartbeat = setInterval(() => {
      response.write(":\n\n");
    }, 15e3);
    const disconnect = () => {
      clearInterval(heartbeat);
      clients.delete(response);
    };
    response.on("close", disconnect);
    return disconnect;
  }
};
const APP_LOG_LIMIT = 1e3;
const SESSION_LOG_LIMIT = 500;
class RuntimeLogService {
  appEntries = [];
  sessionEntries = /* @__PURE__ */ new Map();
  log(input) {
    const entry = {
      id: generateEventId("rlog"),
      timestamp: input.timestamp ?? nowMs(),
      scope: input.scope,
      namespace: input.namespace,
      severity: input.severity ?? "info",
      title: input.title,
      summary: input.summary,
      detail: input.detail,
      sessionId: input.sessionId ?? null,
      projectId: input.projectId ?? null,
      runId: input.runId ?? null,
      raw: input.raw ?? null
    };
    this.pushWithLimit(this.appEntries, entry, APP_LOG_LIMIT);
    if (entry.sessionId) {
      const bucket = this.sessionEntries.get(entry.sessionId) ?? [];
      this.pushWithLimit(bucket, entry, SESSION_LOG_LIMIT);
      this.sessionEntries.set(entry.sessionId, bucket);
    }
    this.broadcast(entry);
    return entry;
  }
  list(scope, sessionId) {
    if (scope === "session") {
      if (!sessionId) {
        return [];
      }
      return [...this.sessionEntries.get(sessionId) ?? []];
    }
    return [...this.appEntries];
  }
  pushWithLimit(target, entry, limit) {
    target.push(entry);
    if (target.length > limit) {
      target.splice(0, target.length - limit);
    }
  }
  broadcast(entry) {
    rendererEventHub.emit("runtime:logAppended", entry);
    const windows = electron.BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send("runtime:logAppended", entry);
      }
    }
  }
}
const runtimeLogService = new RuntimeLogService();
const TOP_LEVEL_AGENT_IDS = ["ask", "plan", "edit", "debugger", "analyzer", "optimizer"];
const SAFE_AGENT_PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const DEFAULT_MODEL_ROUTING = {
  ask: { provider: "openrouter", model: "anthropic/claude-3-sonnet" },
  plan: { provider: "openrouter", model: "anthropic/claude-3-sonnet" },
  edit: { provider: "openrouter", model: "anthropic/claude-3-sonnet" },
  debugger: { provider: "openrouter", model: "anthropic/claude-3-opus" },
  analyzer: { provider: "openrouter", model: "anthropic/claude-3-sonnet" },
  optimizer: { provider: "openrouter", model: "anthropic/claude-3-sonnet" }
};
function isTopLevelAgentId(value) {
  return TOP_LEVEL_AGENT_IDS.includes(value);
}
function isSafeAgentProfileId(value) {
  return SAFE_AGENT_PROFILE_ID_PATTERN.test(value);
}
const LEFT_SIDEBAR_DEFAULT_WIDTH = 256;
const LEFT_SIDEBAR_MIN_WIDTH = 220;
const LEFT_SIDEBAR_MAX_WIDTH = 420;
const LEFT_SIDEBAR_COLLAPSED_WIDTH = 0;
const RIGHT_PANEL_DEFAULT_WIDTH = 312;
const RIGHT_PANEL_MIN_WIDTH = 280;
const RIGHT_PANEL_MAX_WIDTH = 520;
const RIGHT_PANEL_COLLAPSED_WIDTH = 0;
const TERMINAL_DEFAULT_HEIGHT = 328;
const TERMINAL_MIN_HEIGHT = 180;
const TERMINAL_MAX_HEIGHT = 720;
const LLM_PROVIDER_CATEGORY_DEFINITIONS = [
  {
    id: "login-authorization",
    label: "Login Authorization",
    description: "Official account login, OAuth, device flow, or account authorization providers."
  },
  {
    id: "official-direct",
    label: "Official Direct API",
    description: "First-party native APIs operated directly by the model vendor."
  },
  {
    id: "cloud-platform",
    label: "Cloud Platform",
    description: "Enterprise cloud platforms that host model APIs through cloud credentials or deployments."
  },
  {
    id: "official-compatible",
    label: "Official Compatible API",
    description: "Vendor-official APIs reached through OpenAI, Anthropic, or similar compatibility protocols."
  },
  {
    id: "coding-token-plan",
    label: "Coding / Token Plan",
    description: "Separate coding plan or token plan products with their own provider entry."
  },
  {
    id: "third-party-compatible",
    label: "Third-party Compatible Endpoint",
    description: "Gateways, routers, relays, and user-provided API endpoints."
  },
  {
    id: "local",
    label: "Local Model Service",
    description: "Local runtimes and localhost services with selectable chat or Responses protocols."
  },
  {
    id: "image",
    label: "Image Capability",
    description: "Image-generation capability entries. This catalog currently keeps them fail-closed."
  }
];
const LLM_PROVIDER_PROTOCOL_DEFINITIONS = [
  {
    id: "OpenAICompatibleChatCompletions",
    label: "OpenAI Chat Completions",
    description: "OpenAI-compatible /v1/chat/completions request and streaming shape."
  },
  {
    id: "OpenAIResponses",
    label: "OpenAI Responses",
    description: "OpenAI Responses API request and streaming shape.",
    responseEndpointHint: "Only choose this when the endpoint explicitly supports /v1/responses."
  },
  {
    id: "AnthropicMessages",
    label: "Anthropic Messages",
    description: "Anthropic-compatible /v1/messages request and streaming shape."
  },
  {
    id: "OpenRouterChatCompletions",
    label: "OpenRouter Chat Completions",
    description: "OpenRouter gateway using OpenAI-style chat completions plus routing headers."
  },
  {
    id: "AzureOpenAIChatCompletions",
    label: "Azure OpenAI Chat Completions",
    description: "Azure OpenAI deployment endpoint with Azure API version and api-key header."
  },
  {
    id: "GoogleGemini",
    label: "Google Gemini",
    description: "Google Generative Language / Gemini generateContent protocol."
  },
  {
    id: "AwsBedrock",
    label: "AWS Bedrock",
    description: "AWS Bedrock model invocation through cloud credentials."
  },
  {
    id: "GoogleVertexAI",
    label: "Google Vertex AI",
    description: "Google Vertex AI model invocation through cloud credentials."
  },
  {
    id: "OllamaOpenAICompatibleChatCompletions",
    label: "Ollama OpenAI Chat Completions",
    description: "Local Ollama OpenAI-compatible chat completions endpoint."
  }
];
const ANTHROPIC_ALIAS_MODELS = ["sonnet", "opus", "haiku"];
const ANTHROPIC_FIRST_PARTY_MODELS = ["sonnet", "opus"];
const CLAUDE_ACCOUNT_MODELS = [
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001"
];
const CHATGPT_ACCOUNT_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-5.1-codex",
  "gpt-5",
  "o4-mini",
  "o3",
  "gpt-4o"
];
const GITHUB_COPILOT_ACCOUNT_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-5.2",
  "gpt-5-mini",
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  "gpt-4.1"
];
const GROK_ACCOUNT_MODELS = [
  "grok-4.3",
  "grok-build-0.1",
  "grok-4",
  "grok-code-fast-1"
];
const GEMINI_ACCOUNT_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.0-flash"
];
const QWEN_ACCOUNT_MODELS = [
  "qwen-plus",
  "qwen-max",
  "qwen3-coder-plus"
];
const OPENAI_CODE_MODELS = ["gpt-5.2", "gpt-4.1", "gpt-5-mini"];
const CAPS_OPENAI_COMPATIBLE = ["chat", "tool-calling", "model-discovery"];
const CAPS_ANTHROPIC = ["chat", "tool-calling", "reasoning", "prompt-cache", "model-discovery"];
const CAPS_GOOGLE_AI_STUDIO = ["chat", "tool-calling", "reasoning", "vision-input", "model-discovery"];
const CAPS_OLLAMA = ["chat", "model-discovery"];
const CAPS_OPENROUTER = ["chat", "model-discovery"];
const CAPS_AZURE_OPENAI = ["chat", "model-discovery"];
const CAPS_OPENAI_FIRST_PARTY = ["chat", "tool-calling", "structured-output", "vision-input", "model-discovery"];
const CAPS_ANTHROPIC_FIRST_PARTY = ["chat", "tool-calling", "reasoning", "prompt-cache", "vision-input", "model-discovery"];
const CAPS_XAI = ["chat", "tool-calling", "vision-input", "model-discovery"];
const CAPS_STATIC_CLOUD = ["chat"];
const OPENAI_RESPONSES_OPTIONS = ["OpenAICompatibleChatCompletions", "OpenAIResponses"];
const LOCAL_PROTOCOL_OPTIONS = ["OllamaOpenAICompatibleChatCompletions", "OpenAIResponses"];
const BUILTIN_LLM_PROVIDER_DEFINITIONS = [
  {
    id: "claude-account",
    protocol: "AnthropicMessages",
    authMode: "account",
    category: "login-authorization",
    modelDiscovery: "account-catalog",
    label: "Claude Account",
    recommendedModels: CLAUDE_ACCOUNT_MODELS,
    docsUrl: "https://claude.ai/",
    accountLoginConfigured: true,
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "chatgpt-account",
    protocol: "OpenAIResponses",
    authMode: "account",
    category: "login-authorization",
    modelDiscovery: "account-catalog",
    label: "ChatGPT Account",
    recommendedModels: CHATGPT_ACCOUNT_MODELS,
    docsUrl: "https://chatgpt.com/",
    accountLoginConfigured: true,
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "github-copilot",
    protocol: "OpenAICompatibleChatCompletions",
    authMode: "account",
    category: "login-authorization",
    modelDiscovery: "account-catalog",
    label: "GitHub Copilot",
    recommendedModels: GITHUB_COPILOT_ACCOUNT_MODELS,
    docsUrl: "https://github.com/features/copilot",
    accountLoginConfigured: true,
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "grok-account",
    protocol: "OpenAICompatibleChatCompletions",
    authMode: "account",
    category: "login-authorization",
    modelDiscovery: "account-catalog",
    label: "Grok Account",
    baseUrl: "https://api.x.ai/v1",
    recommendedModels: GROK_ACCOUNT_MODELS,
    docsUrl: "https://grok.com/",
    accountLoginConfigured: true,
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "gemini-account",
    protocol: "GoogleGemini",
    authMode: "account",
    category: "login-authorization",
    modelDiscovery: "account-catalog",
    label: "Gemini Account",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    recommendedModels: GEMINI_ACCOUNT_MODELS,
    docsUrl: "https://gemini.google.com/",
    accountLoginConfigured: true,
    unavailableReason: "Live Gemini account OAuth requires a stable public account authorization contract; this adapter is unavailable outside automated test mode.",
    capabilities: CAPS_GOOGLE_AI_STUDIO
  },
  {
    id: "qwen-account",
    protocol: "OpenAICompatibleChatCompletions",
    authMode: "account",
    category: "login-authorization",
    modelDiscovery: "account-catalog",
    label: "Qwen Account",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    recommendedModels: QWEN_ACCOUNT_MODELS,
    docsUrl: "https://chat.qwen.ai/",
    accountLoginConfigured: true,
    unavailableReason: "Live Qwen account OAuth requires a stable public account authorization contract; this adapter is unavailable outside automated test mode.",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "openai",
    protocol: "OpenAIResponses",
    authMode: "api-key",
    category: "official-direct",
    modelDiscovery: "openai-compatible",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    recommendedModels: OPENAI_CODE_MODELS,
    docsUrl: "https://platform.openai.com/api-keys",
    capabilities: CAPS_OPENAI_FIRST_PARTY
  },
  {
    id: "openai-eu",
    protocol: "OpenAIResponses",
    authMode: "api-key",
    category: "official-direct",
    modelDiscovery: "openai-compatible",
    label: "OpenAI (EU)",
    baseUrl: "https://eu.api.openai.com/v1",
    recommendedModels: OPENAI_CODE_MODELS,
    docsUrl: "https://platform.openai.com/api-keys",
    capabilities: CAPS_OPENAI_FIRST_PARTY
  },
  {
    id: "openai-us",
    protocol: "OpenAIResponses",
    authMode: "api-key",
    category: "official-direct",
    modelDiscovery: "openai-compatible",
    label: "OpenAI (US)",
    baseUrl: "https://us.api.openai.com/v1",
    recommendedModels: OPENAI_CODE_MODELS,
    docsUrl: "https://platform.openai.com/api-keys",
    capabilities: CAPS_OPENAI_FIRST_PARTY
  },
  {
    id: "anthropic",
    protocol: "AnthropicMessages",
    authMode: "api-key",
    category: "official-direct",
    modelDiscovery: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    recommendedModels: ANTHROPIC_FIRST_PARTY_MODELS,
    docsUrl: "https://platform.claude.com/settings/keys",
    capabilities: CAPS_ANTHROPIC_FIRST_PARTY
  },
  {
    id: "google-ai-studio",
    protocol: "GoogleGemini",
    authMode: "api-key",
    category: "official-direct",
    modelDiscovery: "google-ai-studio",
    label: "Google AI Studio",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    recommendedModels: ["gemini-2.5-pro", "gemini-2.5-flash"],
    docsUrl: "https://aistudio.google.com/app/apikey",
    capabilities: CAPS_GOOGLE_AI_STUDIO
  },
  {
    id: "azure-openai",
    protocol: "AzureOpenAIChatCompletions",
    authMode: "api-key",
    category: "cloud-platform",
    modelDiscovery: "azure-openai",
    label: "Azure OpenAI",
    baseUrl: "",
    baseUrlEditable: true,
    recommendedModels: ["gpt-4.1", "gpt-5-mini"],
    docsUrl: "https://learn.microsoft.com/azure/ai-services/openai/",
    capabilities: CAPS_AZURE_OPENAI
  },
  {
    id: "bedrock",
    protocol: "AwsBedrock",
    authMode: "environment",
    category: "cloud-platform",
    modelDiscovery: "static",
    label: "Amazon Bedrock",
    recommendedModels: ANTHROPIC_ALIAS_MODELS,
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/amazon-bedrock",
    capabilities: CAPS_STATIC_CLOUD
  },
  {
    id: "vertex",
    protocol: "GoogleVertexAI",
    authMode: "environment",
    category: "cloud-platform",
    modelDiscovery: "static",
    label: "Google Vertex AI",
    recommendedModels: ANTHROPIC_ALIAS_MODELS,
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/google-vertex-ai",
    capabilities: CAPS_STATIC_CLOUD
  },
  {
    id: "deepseek",
    protocol: "AnthropicMessages",
    authMode: "api-key",
    category: "official-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/anthropic",
    recommendedModels: ["deepseek-v4-pro", "deepseek-v4-flash"],
    docsUrl: "https://platform.deepseek.com/api_keys",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "bailian",
    protocol: "AnthropicMessages",
    authMode: "api-key",
    category: "official-compatible",
    modelDiscovery: null,
    label: "Alibaba Cloud Bailian",
    recommendedModels: ["qwen3.6-plus", "qwen3-coder-next", "qwen3-coder-plus"],
    docsUrl: "https://bailian.console.aliyun.com/",
    unavailableReason: "The general Bailian API endpoint is not pinned in this catalog. Use Qwen / DashScope or Bailian Coding Plan until a stable official endpoint is configured.",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "qwen",
    protocol: "OpenAICompatibleChatCompletions",
    authMode: "api-key",
    category: "official-compatible",
    modelDiscovery: "openai-compatible",
    label: "Qwen / DashScope",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    recommendedModels: ["qwen-plus", "qwen-max"],
    docsUrl: "https://dashscope.console.aliyun.com/apiKey",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "volcengine",
    protocol: "OpenAICompatibleChatCompletions",
    authMode: "api-key",
    category: "official-compatible",
    modelDiscovery: null,
    label: "Volcengine Ark (Doubao)",
    recommendedModels: ["doubao-seed-1-6", "glm-4.6", "deepseek-v4-pro", "kimi-k2.5"],
    docsUrl: "https://www.volcengine.com/docs/82379/1928262",
    unavailableReason: "The general Volcengine Ark API endpoint is not pinned in this catalog. Use Volcengine Ark Coding Plan until a stable official endpoint is configured.",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "glm-cn",
    protocol: "AnthropicMessages",
    authMode: "api-key",
    category: "official-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Zhipu AI GLM (CN)",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    recommendedModels: ANTHROPIC_ALIAS_MODELS,
    docsUrl: "https://open.bigmodel.cn/",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "glm-global",
    protocol: "AnthropicMessages",
    authMode: "api-key",
    category: "official-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Z.ai GLM (Global)",
    baseUrl: "https://api.z.ai/api/anthropic",
    recommendedModels: ANTHROPIC_ALIAS_MODELS,
    docsUrl: "https://platform.z.ai/",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "minimax-cn",
    protocol: "AnthropicMessages",
    authMode: "api-key",
    category: "official-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "MiniMax (CN)",
    baseUrl: "https://api.minimaxi.com/anthropic",
    recommendedModels: ["MiniMax-M2.7"],
    docsUrl: "https://platform.minimaxi.com/",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "minimax-global",
    protocol: "AnthropicMessages",
    authMode: "api-key",
    category: "official-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "MiniMax (Global)",
    baseUrl: "https://api.minimax.io/anthropic",
    recommendedModels: ["MiniMax-M2.7"],
    docsUrl: "https://platform.minimaxi.com/",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "xiaomi-mimo",
    protocol: "AnthropicMessages",
    authMode: "api-key",
    category: "official-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Xiaomi MiMo",
    baseUrl: "https://api.xiaomimimo.com/anthropic",
    recommendedModels: ["mimo-v2.5-pro"],
    docsUrl: "https://platform.xiaomimimo.com/#/console/api-keys",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "moonshot",
    protocol: "AnthropicMessages",
    authMode: "api-key",
    category: "official-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Kimi / Moonshot AI",
    baseUrl: "https://api.moonshot.cn/anthropic",
    recommendedModels: ["sonnet"],
    docsUrl: "https://platform.moonshot.cn/console/api-keys",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "xai",
    protocol: "OpenAICompatibleChatCompletions",
    authMode: "api-key",
    category: "official-compatible",
    modelDiscovery: "openai-compatible",
    label: "xAI (Grok)",
    baseUrl: "https://api.x.ai/v1",
    recommendedModels: GROK_ACCOUNT_MODELS,
    docsUrl: "https://docs.x.ai/",
    capabilities: CAPS_XAI
  },
  {
    id: "groq",
    protocol: "OpenAICompatibleChatCompletions",
    authMode: "api-key",
    category: "official-compatible",
    modelDiscovery: "openai-compatible",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    recommendedModels: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"],
    docsUrl: "https://console.groq.com/keys",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "mistral",
    protocol: "OpenAICompatibleChatCompletions",
    authMode: "api-key",
    category: "official-compatible",
    modelDiscovery: "openai-compatible",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    recommendedModels: ["mistral-large-latest", "codestral-latest"],
    docsUrl: "https://console.mistral.ai/api-keys/",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "cerebras",
    protocol: "OpenAICompatibleChatCompletions",
    authMode: "api-key",
    category: "official-compatible",
    modelDiscovery: "openai-compatible",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    recommendedModels: ["llama-4-scout-17b-16e-instruct", "qwen-3-coder-480b"],
    docsUrl: "https://cloud.cerebras.ai/",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "kimi-coding-plan",
    protocol: "AnthropicMessages",
    authMode: "api-key",
    category: "coding-token-plan",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Kimi Coding Plan",
    baseUrl: "https://api.kimi.com/coding/v1",
    recommendedModels: ["kimi-for-coding"],
    docsUrl: "https://www.kimi.com/code/docs/en/",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "bailian-coding-plan",
    protocol: "AnthropicMessages",
    authMode: "api-key",
    category: "coding-token-plan",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Alibaba Cloud Bailian Coding Plan",
    baseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
    recommendedModels: ["qwen3.6-plus", "qwen3-coder-next", "qwen3-coder-plus", "kimi-k2.5", "glm-5", "glm-4.7"],
    docsUrl: "https://bailian.console.aliyun.com/",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "volcengine-coding-plan",
    protocol: "AnthropicMessages",
    authMode: "api-key",
    category: "coding-token-plan",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Volcengine Ark Coding Plan",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding",
    recommendedModels: ["doubao-seed-1-6", "glm-4.6", "deepseek-v4-pro", "kimi-k2.5"],
    docsUrl: "https://www.volcengine.com/docs/82379/1928262",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "glm-cn-coding-plan",
    protocol: "AnthropicMessages",
    authMode: "api-key",
    category: "coding-token-plan",
    modelDiscovery: null,
    label: "Zhipu AI GLM Coding Plan (CN)",
    recommendedModels: ["sonnet", "opus", "haiku"],
    docsUrl: "https://open.bigmodel.cn/",
    unavailableReason: "The official GLM CN Coding Plan endpoint is not pinned in this catalog.",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "glm-global-coding-plan",
    protocol: "AnthropicMessages",
    authMode: "api-key",
    category: "coding-token-plan",
    modelDiscovery: null,
    label: "Z.ai GLM Coding Plan (Global)",
    recommendedModels: ["sonnet", "opus", "haiku"],
    docsUrl: "https://platform.z.ai/",
    unavailableReason: "The official GLM Global Coding Plan endpoint is not pinned in this catalog.",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "minimax-cn-coding-plan",
    protocol: "AnthropicMessages",
    authMode: "api-key",
    category: "coding-token-plan",
    modelDiscovery: null,
    label: "MiniMax Coding Plan (CN)",
    recommendedModels: ["MiniMax-M2.7"],
    docsUrl: "https://platform.minimaxi.com/",
    unavailableReason: "The official MiniMax CN Coding Plan endpoint is not pinned in this catalog.",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "minimax-global-coding-plan",
    protocol: "AnthropicMessages",
    authMode: "api-key",
    category: "coding-token-plan",
    modelDiscovery: null,
    label: "MiniMax Coding Plan (Global)",
    recommendedModels: ["MiniMax-M2.7"],
    docsUrl: "https://platform.minimaxi.com/",
    unavailableReason: "The official MiniMax Global Coding Plan endpoint is not pinned in this catalog.",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "xiaomi-mimo-token-plan",
    protocol: "AnthropicMessages",
    authMode: "api-key",
    category: "coding-token-plan",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Xiaomi MiMo Token Plan",
    baseUrl: "https://token-plan-cn.xiaomimimo.com/anthropic",
    recommendedModels: ["mimo-v2.5-pro"],
    docsUrl: "https://platform.xiaomimimo.com/#/console/plan-manage",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "openrouter",
    protocol: "OpenRouterChatCompletions",
    authMode: "api-key",
    category: "third-party-compatible",
    modelDiscovery: "openai-compatible",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    recommendedModels: ["anthropic/claude-haiku-latest", "anthropic/claude-sonnet-4.5", "openai/gpt-5.2"],
    docsUrl: "https://openrouter.ai/keys",
    capabilities: CAPS_OPENROUTER
  },
  {
    id: "custom-endpoint",
    protocol: "OpenAICompatibleChatCompletions",
    authMode: "api-key",
    category: "third-party-compatible",
    modelDiscovery: "openai-compatible",
    label: "Custom OpenAI Endpoint",
    baseUrl: "",
    baseUrlEditable: true,
    protocolEditable: true,
    protocolOptions: OPENAI_RESPONSES_OPTIONS,
    recommendedModels: ["gpt-4.1"],
    docsUrl: "https://platform.openai.com/docs/api-reference",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "anthropic-thirdparty",
    protocol: "AnthropicMessages",
    authMode: "api-key",
    category: "third-party-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Custom Anthropic Endpoint",
    baseUrl: "",
    baseUrlEditable: true,
    recommendedModels: ANTHROPIC_ALIAS_MODELS,
    docsUrl: "https://platform.claude.com/docs/en/api/overview",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "302ai",
    protocol: "OpenAICompatibleChatCompletions",
    authMode: "api-key",
    category: "third-party-compatible",
    modelDiscovery: "openai-compatible",
    label: "302.AI",
    baseUrl: "https://api.302.ai/v1",
    recommendedModels: ["gpt-4o", "claude-3-7-sonnet"],
    docsUrl: "https://302.ai/",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "siliconflow",
    protocol: "OpenAICompatibleChatCompletions",
    authMode: "api-key",
    category: "third-party-compatible",
    modelDiscovery: "openai-compatible",
    label: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    recommendedModels: ["Qwen/Qwen3-32B", "deepseek-ai/DeepSeek-V3"],
    docsUrl: "https://siliconflow.cn/",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "litellm",
    protocol: "AnthropicMessages",
    authMode: "api-key",
    category: "third-party-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "LiteLLM",
    baseUrl: "http://localhost:4000",
    baseUrlEditable: true,
    recommendedModels: ANTHROPIC_ALIAS_MODELS,
    docsUrl: "https://docs.litellm.ai/docs/",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "vercel-ai-gateway",
    protocol: "OpenAICompatibleChatCompletions",
    authMode: "api-key",
    category: "third-party-compatible",
    modelDiscovery: "openai-compatible",
    label: "Vercel AI Gateway",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    recommendedModels: ["openai/gpt-5.2", "anthropic/claude-sonnet-4.5"],
    docsUrl: "https://vercel.com/docs/ai-gateway",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "huggingface",
    protocol: "OpenAICompatibleChatCompletions",
    authMode: "api-key",
    category: "third-party-compatible",
    modelDiscovery: "openai-compatible",
    label: "Hugging Face Router",
    baseUrl: "https://router.huggingface.co/v1",
    recommendedModels: ["openai/gpt-oss-120b", "Qwen/Qwen3-Coder-480B-A35B-Instruct"],
    docsUrl: "https://huggingface.co/settings/tokens",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "manifest",
    protocol: "OpenAICompatibleChatCompletions",
    authMode: "api-key",
    category: "third-party-compatible",
    modelDiscovery: "openai-compatible",
    label: "Manifest",
    baseUrl: "https://app.manifest.build/v1",
    recommendedModels: ["gpt-4.1"],
    docsUrl: "https://app.manifest.build/",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "ollama",
    protocol: "OllamaOpenAICompatibleChatCompletions",
    authMode: "local",
    category: "local",
    modelDiscovery: "ollama-tags",
    label: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    baseUrlEditable: true,
    protocolEditable: true,
    protocolOptions: LOCAL_PROTOCOL_OPTIONS,
    recommendedModels: ["qwen2.5-coder:14b", "llama3.1:8b"],
    docsUrl: "https://ollama.com/download",
    capabilities: CAPS_OLLAMA
  }
];
function isBuiltinProviderId(id) {
  return BUILTIN_LLM_PROVIDER_DEFINITIONS.some((entry) => entry.id === id);
}
function getBuiltinProviderDefinition(id) {
  return BUILTIN_LLM_PROVIDER_DEFINITIONS.find((entry) => entry.id === id) ?? null;
}
function isLlmProviderProtocol(value) {
  return typeof value === "string" && LLM_PROVIDER_PROTOCOL_DEFINITIONS.some((entry) => entry.id === value);
}
function getBuiltinProviderProtocolOptions(id) {
  const definition = getBuiltinProviderDefinition(id);
  if (!definition) {
    return [];
  }
  return definition.protocolOptions?.length ? [...definition.protocolOptions] : [definition.protocol];
}
function resolveBuiltinProviderProtocol(id, candidate) {
  const definition = getBuiltinProviderDefinition(id);
  if (!definition) {
    return null;
  }
  const options = getBuiltinProviderProtocolOptions(id);
  if (definition.protocolEditable && isLlmProviderProtocol(candidate) && options.includes(candidate)) {
    return candidate;
  }
  return definition.protocol;
}
const toModels = (modelIds) => Array.from(new Set(modelIds)).map((modelId) => ({
  id: modelId,
  label: modelId,
  enabled: true
}));
const createBuiltinProviderEntry = (id) => {
  const definition = getBuiltinProviderDefinition(id);
  if (!definition) {
    throw new Error(`Unknown builtin provider: ${id}`);
  }
  const status = definition.unavailableReason ? "unavailable" : "unconfigured";
  return {
    id: definition.id,
    protocol: definition.protocol,
    authMode: definition.authMode,
    category: definition.category,
    modelDiscovery: definition.modelDiscovery,
    label: definition.label,
    enabled: false,
    apiKey: "",
    hasStoredSecret: !definition.unavailableReason && (definition.authMode === "local" || definition.authMode === "environment"),
    baseUrl: definition.baseUrl,
    baseUrlEditable: definition.baseUrlEditable,
    protocolEditable: definition.protocolEditable,
    protocolOptions: getBuiltinProviderProtocolOptions(definition.id),
    models: definition.modelDiscovery === "static" && definition.authMode === "environment" ? toModels(definition.recommendedModels) : toModels([]),
    recommendedModels: definition.recommendedModels,
    docsUrl: definition.docsUrl,
    status,
    accountLoginConfigured: definition.accountLoginConfigured,
    unavailableReason: definition.unavailableReason,
    isConfigured: false,
    capabilities: definition.capabilities ? [...definition.capabilities] : void 0
  };
};
const createBuiltinProviderEntries = () => BUILTIN_LLM_PROVIDER_DEFINITIONS.map((entry) => createBuiltinProviderEntry(entry.id));
const SETTINGS_FILE_NAME = "settings.json";
const LOG_FILE_NAME = "rdc-agent.log";
const sanitizePathSegment = (value) => value.replace(/[^a-zA-Z0-9_-]/g, "-");
const normalizePath = (targetPath) => path.resolve(targetPath);
const isSamePath = (left, right) => {
  const normalizedLeft = normalizePath(left);
  const normalizedRight = normalizePath(right);
  return process.platform === "win32" ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase() : normalizedLeft === normalizedRight;
};
class AppPathService {
  workspaceRootCache = null;
  getUserDataRoot() {
    return normalizePath(process.env.RDC_AGENT_USER_DATA?.trim() || electron.app.getPath("userData"));
  }
  getBootstrapDir() {
    return this.getUserDataRoot();
  }
  getBootstrapPath() {
    return path.join(this.getBootstrapDir(), "workspace-bootstrap.json");
  }
  getDefaultWorkspaceRoot() {
    return normalizePath(process.env.RDC_AGENT_WORKSPACE?.trim() || path.join(this.getUserDataRoot(), "workspace"));
  }
  getWorkspaceRoot() {
    if (this.workspaceRootCache) {
      return this.workspaceRootCache;
    }
    const bootstrapState = this.readBootstrapState();
    const workspaceRoot = normalizePath(bootstrapState.workspaceRoot || this.getDefaultWorkspaceRoot());
    this.workspaceRootCache = workspaceRoot;
    return workspaceRoot;
  }
  getWorkspacePaths(workspaceRoot = this.getWorkspaceRoot()) {
    const root = normalizePath(workspaceRoot);
    const logsPath = path.join(root, "logs");
    return {
      workspaceRoot: root,
      defaultWorkspaceRoot: this.getDefaultWorkspaceRoot(),
      settingsPath: path.join(root, SETTINGS_FILE_NAME),
      logsPath,
      logPath: path.join(logsPath, LOG_FILE_NAME),
      projectsPath: path.join(root, "projects"),
      knowledgePath: path.join(root, "knowledge"),
      migrationOrphansPath: path.join(root, "migration-orphans"),
      profilesPath: path.join(root, "profiles"),
      policiesPath: path.join(root, "policies"),
      skillsPath: path.join(root, "skills"),
      mcpPath: path.join(root, "mcp"),
      patternsPath: path.join(root, "patterns"),
      secretsPath: path.join(root, "secrets"),
      migrationReportsPath: path.join(root, "migration-reports")
    };
  }
  initializeWorkspaceRoot() {
    const bootstrapState = this.readBootstrapState();
    const workspaceRoot = normalizePath(bootstrapState.workspaceRoot || this.getDefaultWorkspaceRoot());
    const paths = this.getWorkspacePaths(workspaceRoot);
    this.ensureWorkspaceStructure(paths);
    this.workspaceRootCache = paths.workspaceRoot;
    this.writeBootstrapState({
      workspaceRoot: paths.workspaceRoot
    });
    return paths;
  }
  setWorkspaceRoot(nextRoot) {
    const currentRoot = this.getWorkspaceRoot();
    const resolvedRoot = normalizePath(nextRoot || this.getDefaultWorkspaceRoot());
    const nextPaths = this.getWorkspacePaths(resolvedRoot);
    this.ensureWorkspaceStructure(nextPaths);
    if (!isSamePath(currentRoot, resolvedRoot)) {
      this.copyWorkspaceData(currentRoot, resolvedRoot);
    }
    this.workspaceRootCache = resolvedRoot;
    this.writeBootstrapState({
      workspaceRoot: resolvedRoot
    });
    return nextPaths;
  }
  resetWorkspaceRoot() {
    return this.setWorkspaceRoot(this.getDefaultWorkspaceRoot());
  }
  getCapturePreviewDir(projectId) {
    const paths = this.getWorkspacePaths();
    return path.join(paths.logsPath, "capture-previews", sanitizePathSegment(projectId || "default"));
  }
  getCapturePreviewPath(projectId, inputId) {
    return path.join(
      this.getCapturePreviewDir(projectId),
      `${sanitizePathSegment(inputId || "capture")}-latest.png`
    );
  }
  readBootstrapState() {
    const bootstrapPath = this.getBootstrapPath();
    try {
      if (fs.existsSync(bootstrapPath)) {
        return JSON.parse(fs.readFileSync(bootstrapPath, "utf8"));
      }
    } catch (error) {
      console.warn("[AppPathService] Failed to read bootstrap state:", error);
    }
    return {};
  }
  writeBootstrapState(state2) {
    const bootstrapPath = this.getBootstrapPath();
    fs.mkdirSync(path.dirname(bootstrapPath), { recursive: true });
    fs.writeFileSync(bootstrapPath, JSON.stringify(state2, null, 2), "utf8");
  }
  ensureWorkspaceStructure(paths) {
    fs.mkdirSync(paths.workspaceRoot, { recursive: true });
    fs.mkdirSync(paths.logsPath, { recursive: true });
    fs.mkdirSync(paths.projectsPath, { recursive: true });
    fs.mkdirSync(paths.knowledgePath, { recursive: true });
    fs.mkdirSync(paths.migrationOrphansPath, { recursive: true });
    fs.mkdirSync(paths.profilesPath, { recursive: true });
    fs.mkdirSync(paths.policiesPath, { recursive: true });
    fs.mkdirSync(paths.skillsPath, { recursive: true });
    fs.mkdirSync(paths.mcpPath, { recursive: true });
    fs.mkdirSync(paths.patternsPath, { recursive: true });
    fs.mkdirSync(paths.secretsPath, { recursive: true });
    fs.mkdirSync(paths.migrationReportsPath, { recursive: true });
  }
  copyWorkspaceData(sourceRoot, targetRoot) {
    if (!sourceRoot || !fs.existsSync(sourceRoot) || isSamePath(sourceRoot, targetRoot)) {
      return;
    }
    const targetPaths = this.getWorkspacePaths(targetRoot);
    this.copyFileIfMissing(path.join(sourceRoot, SETTINGS_FILE_NAME), targetPaths.settingsPath);
    this.copyDirContents(path.join(sourceRoot, "projects"), targetPaths.projectsPath);
    this.copyDirContents(path.join(sourceRoot, "knowledge"), targetPaths.knowledgePath);
    this.copyDirContents(path.join(sourceRoot, "migration-orphans"), targetPaths.migrationOrphansPath);
    this.copyDirContents(path.join(sourceRoot, "profiles"), targetPaths.profilesPath);
    this.copyDirContents(path.join(sourceRoot, "policies"), targetPaths.policiesPath);
    this.copyDirContents(path.join(sourceRoot, "skills"), targetPaths.skillsPath);
    this.copyDirContents(path.join(sourceRoot, "mcp"), targetPaths.mcpPath);
    this.copyDirContents(path.join(sourceRoot, "patterns"), targetPaths.patternsPath);
    this.copyDirContents(path.join(sourceRoot, "secrets"), targetPaths.secretsPath);
    this.copyDirContents(path.join(sourceRoot, "migration-reports"), targetPaths.migrationReportsPath);
    this.copyDirContents(path.join(sourceRoot, "logs"), targetPaths.logsPath);
    this.copyLogFile(path.join(sourceRoot, LOG_FILE_NAME), targetPaths.logPath);
    this.copyLogFile(path.join(sourceRoot, "dev-stdout.log"), targetPaths.logPath);
  }
  copyDirContents(sourceDir, targetDir) {
    if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
      return;
    }
    fs.mkdirSync(targetDir, { recursive: true });
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        this.copyDirContents(sourcePath, targetPath);
        continue;
      }
      this.copyFileIfMissing(sourcePath, targetPath);
    }
  }
  copyLogFile(sourcePath, targetPath) {
    this.copyFileIfMissing(sourcePath, targetPath);
  }
  copyFileIfMissing(sourcePath, targetPath) {
    if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) {
      return;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}
const appPathService = new AppPathService();
const AGENT_ROLES = [...TOP_LEVEL_AGENT_IDS];
const AGENT_DISPLAY_NAMES = {
  ask: "Ask",
  plan: "Plan",
  edit: "Edit",
  debugger: "Debugger",
  analyzer: "Analyzer",
  optimizer: "Optimizer"
};
const AGENT_DESCRIPTIONS = {
  ask: "Read-only agent for codebase questions, clarification, and guidance.",
  plan: "Planning agent for research, questions, handoffs, and implementation plans without direct changes.",
  edit: "General implementation agent for ordinary code and workspace changes with approval policy.",
  debugger: "General executable agent for RDC/RenderDoc investigation and debugging work.",
  analyzer: "General executable agent for evidence analysis, performance triage, and reportable findings.",
  optimizer: "General executable agent for bottleneck analysis, optimization ordering, and validation."
};
const AGENT_CATEGORIES = {
  ask: "orchestrator",
  plan: "orchestrator",
  edit: "orchestrator",
  debugger: "general",
  analyzer: "general",
  optimizer: "general"
};
const AGENT_WRITE_SCOPES = {
  ask: [],
  plan: ["workspace_notes"],
  edit: ["workspace_notes", "session_artifacts", "workspace_reports"],
  debugger: ["workspace_control", "workspace_notes", "session_artifacts", "workspace_reports"],
  analyzer: ["workspace_notes", "session_artifacts", "workspace_reports"],
  optimizer: ["workspace_notes", "session_artifacts", "workspace_reports"]
};
const AGENT_COLORS = {
  ask: "#38c6f4",
  plan: "#8d8bff",
  edit: "#33d1ff",
  debugger: "#33d1ff",
  analyzer: "#8d8bff",
  optimizer: "#4ee3a0"
};
const AGENT_MODES = [
  {
    id: "ask",
    label: "Ask",
    icon: "message-orbit",
    description: "Read-only clarification and guidance",
    accentColor: AGENT_COLORS.ask,
    disabled: false
  },
  {
    id: "plan",
    label: "Plan",
    icon: "route-plan",
    description: "Research, questions, handoff, and implementation planning",
    accentColor: AGENT_COLORS.plan,
    disabled: false
  },
  {
    id: "edit",
    label: "Edit",
    icon: "pencil-edit",
    description: "General implementation agent",
    accentColor: AGENT_COLORS.edit,
    disabled: false
  },
  {
    id: "debugger",
    label: "Debugger",
    icon: "crosshair-bug",
    description: "Executable RDC/RenderDoc debugging agent",
    accentColor: AGENT_COLORS.debugger,
    disabled: false
  },
  {
    id: "analyzer",
    label: "Analyzer",
    icon: "waveform-gauge",
    description: "Executable analysis and evidence agent",
    accentColor: AGENT_COLORS.analyzer,
    disabled: false
  },
  {
    id: "optimizer",
    label: "Optimizer",
    icon: "spark-tuning",
    description: "Executable optimization and validation agent",
    accentColor: AGENT_COLORS.optimizer,
    disabled: false
  }
];
const AGENT_ICON_PRESETS = [
  { id: "message-orbit", label: "Ask" },
  { id: "route-plan", label: "Plan" },
  { id: "pencil-edit", label: "Edit" },
  { id: "crosshair-bug", label: "Debug" },
  { id: "waveform-gauge", label: "Analyze" },
  { id: "spark-tuning", label: "Optimize" },
  { id: "compass", label: "Explore" },
  { id: "terminal", label: "Shell" },
  { id: "shield", label: "Review" },
  { id: "wrench", label: "Build" },
  { id: "search-lens", label: "Search" },
  { id: "nodes", label: "Orchestrate" },
  { id: "memory", label: "Memory" },
  { id: "spark", label: "Create" }
];
function isAgentIconPreset(value) {
  return typeof value === "string" && AGENT_ICON_PRESETS.some((preset) => preset.id === value);
}
const AGENT_MODE_MAP = AGENT_MODES.reduce(
  (accumulator, mode) => {
    accumulator[mode.id] = mode;
    return accumulator;
  },
  {}
);
const canonicalAgentModelId = (providerId, modelId) => providerId.trim() && modelId.trim() ? `${providerId.trim()}:${modelId.trim()}` : "";
const splitCanonicalAgentModelId = (value) => {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    return null;
  }
  const providerId = value.slice(0, separator).trim();
  const modelId = value.slice(separator + 1).trim();
  return providerId && modelId ? { providerId, modelId } : null;
};
const GLOBAL_INSTRUCTIONS_FILE = "global-instructions.md";
const toSlug = (value) => {
  const slug = value.trim().toLowerCase().replace(/['"]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "agent";
};
const fileNameForId = (id) => `${toSlug(id.replace(/_/g, "-"))}.agent.md`;
const idFromFileName = (fileName) => fileName.replace(/\.agent\.md$/u, "");
const safeFileNameForDraft = (draft) => {
  const agentId = draft.id || toSlug(draft.name);
  if (!isSafeAgentProfileId(agentId)) {
    throw new Error(`Invalid agent profile id: ${agentId}`);
  }
  const candidate = draft.fileName && draft.fileName.endsWith(".agent.md") ? path.basename(draft.fileName) : fileNameForId(agentId);
  const candidateId = idFromFileName(candidate);
  return candidateId === agentId && isSafeAgentProfileId(candidateId) ? candidate : fileNameForId(agentId);
};
const readStringArray$1 = (value) => {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
};
const readBoolean = (value, fallback) => typeof value === "boolean" ? value : fallback;
const readHandoffs = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }
  const handoffs = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry;
    const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
    const agent = typeof candidate.agent === "string" ? candidate.agent.trim() : "";
    const prompt = typeof candidate.prompt === "string" ? candidate.prompt.trim() : "";
    if (!label || !agent || !prompt) {
      continue;
    }
    const handoff = {
      label,
      agent,
      prompt
    };
    if (typeof candidate.send === "boolean") {
      handoff.send = candidate.send;
    }
    if (typeof candidate.showContinueOn === "boolean") {
      handoff.showContinueOn = candidate.showContinueOn;
    }
    if (typeof candidate.model === "string" && candidate.model.trim()) {
      handoff.model = candidate.model.trim();
    }
    handoffs.push(handoff);
  }
  return handoffs;
};
const parseAgentMarkdown = (filePath, fallbackId) => {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/u, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(raw);
  const frontmatter = match ? YAML.parse(match[1]) : {};
  const instructions = match ? match[2].trim() : raw.trim();
  const name = typeof frontmatter.name === "string" && frontmatter.name.trim() ? frontmatter.name.trim() : fallbackId;
  return {
    id: fallbackId,
    fileName: path.basename(filePath),
    filePath,
    name,
    description: typeof frontmatter.description === "string" ? frontmatter.description.trim() : "",
    argumentHint: typeof frontmatter["argument-hint"] === "string" ? frontmatter["argument-hint"].trim() : "",
    target: typeof frontmatter.target === "string" ? frontmatter.target.trim() : "rdc-agent",
    models: readStringArray$1(frontmatter.model),
    icon: isAgentIconPreset(frontmatter.icon) ? frontmatter.icon : AGENT_MODE_MAP[fallbackId]?.icon ?? "message-orbit",
    disableModelInvocation: readBoolean(frontmatter["disable-model-invocation"], false),
    userInvocable: readBoolean(frontmatter["user-invocable"], true),
    tools: readStringArray$1(frontmatter.tools),
    skills: readStringArray$1(frontmatter.skills),
    mcpServers: readStringArray$1(frontmatter["mcp-servers"]),
    agents: readStringArray$1(frontmatter.agents),
    handoffs: readHandoffs(frontmatter.handoffs),
    metadata: frontmatter.metadata && typeof frontmatter.metadata === "object" ? frontmatter.metadata : {},
    instructions,
    builtin: false,
    enabled: readBoolean(frontmatter.enabled, true),
    maxTurns: typeof frontmatter["max-turns"] === "number" && frontmatter["max-turns"] > 0 ? frontmatter["max-turns"] : void 0,
    updatedAt: fs.statSync(filePath).mtime.toISOString()
  };
};
const serializeAgentMarkdown = (definition) => {
  const frontmatter = {
    name: definition.name,
    description: definition.description,
    "argument-hint": definition.argumentHint,
    target: definition.target || "rdc-agent",
    model: definition.models,
    icon: isAgentIconPreset(definition.icon) ? definition.icon : "message-orbit",
    "disable-model-invocation": definition.disableModelInvocation,
    "user-invocable": definition.userInvocable,
    enabled: definition.enabled,
    ...definition.maxTurns ? { "max-turns": definition.maxTurns } : {},
    tools: definition.tools,
    skills: definition.skills,
    "mcp-servers": definition.mcpServers,
    agents: definition.agents,
    handoffs: definition.handoffs
  };
  return `---
${YAML.stringify(frontmatter).trim()}
---

${definition.instructions.trim()}
`;
};
const createSeedDefinition = (agentId, routes) => {
  const route = routes.find((entry) => entry.agentId === agentId);
  const model = canonicalAgentModelId(route?.providerId ?? "", route?.modelId ?? "");
  const name = AGENT_DISPLAY_NAMES[agentId];
  const tools = agentId === "ask" ? ["read", "search", "web", "askUser"] : agentId === "plan" ? ["read", "search", "web", "askUser", "agent", "todo", "memory", "planArtifact", "handoff"] : agentId === "edit" ? ["read", "search", "web", "bash", "write", "edit", "askUser", "agent", "todo", "memory", "skill", "mcp"] : ["read", "search", "web", "bash", "askUser", "agent", "todo", "memory", "rdxContext"];
  return {
    id: agentId,
    fileName: fileNameForId(agentId),
    name,
    description: AGENT_DESCRIPTIONS[agentId],
    argumentHint: agentId === "ask" ? "Ask about the current project, capture, or workflow" : "Describe the RenderDoc/RDC investigation goal",
    target: "rdc-agent",
    models: model ? [model] : [],
    icon: AGENT_MODE_MAP[agentId]?.icon ?? "message-orbit",
    disableModelInvocation: false,
    userInvocable: true,
    tools,
    skills: [],
    mcpServers: [],
    agents: agentId === "ask" ? [] : AGENT_ROLES.filter((role) => role !== agentId),
    handoffs: agentId === "plan" ? [
      {
        label: "Start Implementation",
        agent: "edit",
        prompt: "Start implementing the approved plan."
      }
    ] : [],
    metadata: {},
    instructions: `You are ${name}. ${AGENT_DESCRIPTIONS[agentId]}.`,
    enabled: true
  };
};
class AgentManifestService {
  getAgentsDirectory(paths) {
    return path.join(paths.profilesPath, "agents");
  }
  getGlobalInstructionsPath(paths) {
    return path.join(paths.profilesPath, GLOBAL_INSTRUCTIONS_FILE);
  }
  ensureSeedManifests(paths, routes) {
    const directory = this.getAgentsDirectory(paths);
    fs.mkdirSync(directory, { recursive: true });
    const existing = new Set(fs.readdirSync(directory));
    for (const agentId of AGENT_ROLES) {
      const seed = createSeedDefinition(agentId, routes);
      if (!existing.has(seed.fileName)) {
        fs.writeFileSync(path.join(directory, seed.fileName), serializeAgentMarkdown(seed), "utf8");
      }
    }
  }
  getSettings(paths, providers, routes) {
    this.ensureSeedManifests(paths, routes);
    const directoryPath = this.getAgentsDirectory(paths);
    const definitions = fs.readdirSync(directoryPath).filter((entry) => entry.endsWith(".agent.md")).filter((entry) => isSafeAgentProfileId(idFromFileName(entry))).map((entry) => {
      const fullPath = path.join(directoryPath, entry);
      const fallbackId = idFromFileName(entry);
      return parseAgentMarkdown(fullPath, fallbackId);
    }).sort((left, right) => Number(right.userInvocable) - Number(left.userInvocable) || left.name.localeCompare(right.name));
    return {
      directoryPath,
      definitions,
      modelOptions: this.getModelOptions(providers),
      globalInstructions: this.readGlobalInstructions(paths)
    };
  }
  save(paths, drafts, globalInstructions) {
    const directory = this.getAgentsDirectory(paths);
    fs.mkdirSync(directory, { recursive: true });
    for (const draft of drafts) {
      const agentId = draft.id || toSlug(draft.name);
      if (!isSafeAgentProfileId(agentId)) {
        throw new Error(`Invalid agent profile id: ${agentId}`);
      }
      const fileName = safeFileNameForDraft(draft);
      const filePath = path.join(directory, fileName);
      if (draft.delete) {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        continue;
      }
      fs.writeFileSync(filePath, serializeAgentMarkdown({
        ...draft
      }), "utf8");
    }
    if (typeof globalInstructions === "string") {
      fs.writeFileSync(this.getGlobalInstructionsPath(paths), globalInstructions.trim(), "utf8");
    }
  }
  importFile(paths, sourcePath) {
    if (!sourcePath.endsWith(".agent.md")) {
      throw new Error("Only .agent.md files can be imported.");
    }
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new Error(`Agent manifest not found: ${sourcePath}`);
    }
    const directory = this.getAgentsDirectory(paths);
    fs.mkdirSync(directory, { recursive: true });
    const imported = parseAgentMarkdown(sourcePath, path.basename(sourcePath, ".agent.md"));
    if (!isSafeAgentProfileId(imported.id)) {
      throw new Error(`Invalid agent profile id: ${imported.id}`);
    }
    const fileName = fileNameForId(imported.id || imported.name);
    const targetPath = path.join(directory, fileName);
    fs.copyFileSync(sourcePath, targetPath);
    return parseAgentMarkdown(targetPath, idFromFileName(fileName));
  }
  routesFromDefinitions(currentRoutes, definitions, providers) {
    const routeMap = new Map(currentRoutes.map((route) => [route.agentId, route]));
    const routeAgentIds = new Set(AGENT_ROLES);
    for (const definition of definitions) {
      if (definition.delete || !isSafeAgentProfileId(definition.id)) {
        continue;
      }
      routeAgentIds.add(definition.id);
      const model = definition.models.map(splitCanonicalAgentModelId).find((entry) => entry !== null);
      if (!model) {
        routeMap.set(definition.id, {
          agentId: definition.id,
          providerId: "",
          modelId: ""
        });
        continue;
      }
      const provider = providers.find((entry) => entry.id === model.providerId);
      const modelEnabled = provider?.enabled && provider.isConfigured && provider.models.some((entry) => entry.id === model.modelId && entry.enabled !== false);
      if (!modelEnabled) {
        routeMap.set(definition.id, {
          agentId: definition.id,
          providerId: "",
          modelId: ""
        });
        continue;
      }
      routeMap.set(definition.id, {
        agentId: definition.id,
        providerId: model.providerId,
        modelId: model.modelId
      });
    }
    return Array.from(routeAgentIds).map((agentId) => routeMap.get(agentId) ?? {
      agentId,
      providerId: "",
      modelId: ""
    });
  }
  getModelOptions(providers) {
    return providers.flatMap((provider) => provider.models.map((model) => ({
      canonicalId: canonicalAgentModelId(provider.id, model.id),
      providerId: provider.id,
      providerLabel: provider.label,
      modelId: model.id,
      modelLabel: model.label || model.id,
      configured: provider.enabled && provider.isConfigured && model.enabled !== false,
      status: !provider.enabled || !provider.isConfigured ? "provider-unavailable" : model.enabled === false ? "model-disabled" : "ready"
    })));
  }
  readGlobalInstructions(paths) {
    const filePath = this.getGlobalInstructionsPath(paths);
    if (!fs.existsSync(filePath)) {
      return "";
    }
    return fs.readFileSync(filePath, "utf8");
  }
}
const agentManifestService = new AgentManifestService();
const MAIN_STAGES = [
  "preflight",
  "entry_gate",
  "speclist",
  "dispatch",
  "investigate",
  "fix_verify",
  "skepti",
  "curate",
  "finalize"
];
const SPECIAL_STAGES = [
  "blocked"
];
const ALL_STAGES = [...MAIN_STAGES, ...SPECIAL_STAGES];
const STAGE_PHASES = {
  preflight: "planner",
  entry_gate: "planner",
  speclist: "planner",
  dispatch: "generator",
  investigate: "generator",
  fix_verify: "evaluator",
  skepti: "evaluator",
  curate: "evaluator",
  finalize: "evaluator",
  blocked: "evaluator"
};
const normalizeWorkflowStage = (stage) => {
  if (!stage) return "preflight";
  if (ALL_STAGES.includes(stage)) return stage;
  return "preflight";
};
const RETIRED_BUILTIN_MCP_SERVER_IDS$1 = /* @__PURE__ */ new Set(["builtin.rdc-toolbridge"]);
const RETIRED_SKILL_JSON_IDS = /* @__PURE__ */ new Set(["builtin.rdc-context", "builtin.renderdoc-glossary"]);
const MCP_TRANSPORTS = /* @__PURE__ */ new Set(["stdio", "sse", "streamable-http"]);
const TEMPLATE_COPIES = [
  {
    source: ["profiles", "agents"],
    target: (workspaceRoot) => path.join(appPathService.getWorkspacePaths(workspaceRoot).profilesPath, "agents")
  },
  {
    source: ["profiles", "modes"],
    target: (workspaceRoot) => path.join(appPathService.getWorkspacePaths(workspaceRoot).profilesPath, "modes")
  },
  {
    source: ["policies", "stages"],
    target: (workspaceRoot) => path.join(appPathService.getWorkspacePaths(workspaceRoot).policiesPath, "stages")
  },
  {
    source: ["patterns"],
    target: (workspaceRoot) => appPathService.getWorkspacePaths(workspaceRoot).patternsPath
  },
  {
    source: ["skills"],
    target: (workspaceRoot) => appPathService.getWorkspacePaths(workspaceRoot).skillsPath
  },
  {
    source: ["mcp"],
    target: (workspaceRoot) => appPathService.getWorkspacePaths(workspaceRoot).mcpPath
  }
];
function readJsonFile$1(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn("[AgentRuntimeConfigService] Failed to read JSON:", filePath, error);
    return null;
  }
}
function copyDirContentsIfMissing(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    return;
  }
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirContentsIfMissing(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile() || fs.existsSync(targetPath)) {
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}
function toRuntimeId(value, fallback = "custom") {
  const id = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return id || fallback;
}
function titleFromId(id) {
  return id.split(/[-_.]+/).filter(Boolean).map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ") || id;
}
function parseSkillMarkdown(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const id = toRuntimeId(path.basename(filePath, ".md"), "skill");
  const heading = raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const description = raw.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const type = raw.match(/^type:\s*(.+)$/m)?.[1]?.trim();
  return {
    id,
    name: id,
    label: heading || titleFromId(id),
    description,
    source: "workspace",
    enabledByDefault: true,
    path: filePath,
    parameters: {
      markdown: raw,
      ...type ? { type } : {}
    }
  };
}
function normalizeSkillMarkdown(request2, id) {
  const label = request2.label.trim() || titleFromId(id);
  const description = request2.description.trim();
  const input = request2.markdown.trim();
  const withoutHeading = input.replace(/^#\s+.*(?:\r?\n)?/, "");
  const withoutDescription = withoutHeading.replace(/^description:\s*.*(?:\r?\n)?/m, "");
  const body = withoutDescription.trim() || "type: prompt\npromptTemplate: |\n  Describe the reusable workflow or instruction here.";
  return `# ${label}
description: ${description}
${body}
`;
}
function validateWithinDir(filePath, dir) {
  const resolvedDir = path.resolve(dir);
  const resolvedFile = path.resolve(filePath);
  const relative = path.relative(resolvedDir, resolvedFile);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Runtime file path escaped the workspace directory.");
  }
  return resolvedFile;
}
function readEnvLines(env) {
  if (!env) return void 0;
  const entries = Object.entries(env).map(([key, value]) => [key.trim(), String(value)]).filter(([key]) => Boolean(key));
  return entries.length > 0 ? Object.fromEntries(entries) : void 0;
}
class AgentRuntimeConfigService {
  resolveTemplateRoot() {
    const candidates = [
      path.join(electron.app.getAppPath(), "resources", "agent-runtime"),
      path.join(electron.app.getAppPath(), "..", "resources", "agent-runtime"),
      path.join(process.cwd(), "resources", "agent-runtime"),
      path.join(process.resourcesPath ?? "", "resources", "agent-runtime"),
      path.join(process.resourcesPath ?? "", "agent-runtime")
    ].filter(Boolean);
    for (const candidate of candidates) {
      const resolved = path.resolve(candidate);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }
    return path.resolve(candidates[0]);
  }
  ensureScaffold(workspaceRoot = appPathService.getWorkspaceRoot()) {
    const templateRoot = this.resolveTemplateRoot();
    for (const copy of TEMPLATE_COPIES) {
      copyDirContentsIfMissing(path.join(templateRoot, ...copy.source), copy.target(workspaceRoot));
    }
    this.removeRetiredSkillJsonFiles(workspaceRoot);
  }
  listPatterns(workspaceRoot = appPathService.getWorkspaceRoot()) {
    return this.readDescriptors("patterns", workspaceRoot);
  }
  listSkills(workspaceRoot = appPathService.getWorkspaceRoot()) {
    this.ensureScaffold(workspaceRoot);
    const dir = appPathService.getWorkspacePaths(workspaceRoot).skillsPath;
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs.readdirSync(dir).filter((entry) => entry.endsWith(".md")).map((entry) => parseSkillMarkdown(path.join(dir, entry))).filter((entry) => Boolean(entry?.id)).sort((left, right) => left.id.localeCompare(right.id));
  }
  listMcpServers(workspaceRoot = appPathService.getWorkspaceRoot()) {
    return this.readDescriptors("mcp", workspaceRoot).filter((descriptor) => !RETIRED_BUILTIN_MCP_SERVER_IDS$1.has(descriptor.id));
  }
  upsertSkill(request2, workspaceRoot = appPathService.getWorkspaceRoot()) {
    this.ensureScaffold(workspaceRoot);
    const paths = appPathService.getWorkspacePaths(workspaceRoot);
    const nextId = toRuntimeId(request2.id, "skill");
    const targetPath = validateWithinDir(path.join(paths.skillsPath, `${nextId}.md`), paths.skillsPath);
    const previousId = request2.previousId ? toRuntimeId(request2.previousId, nextId) : nextId;
    const previousPath = validateWithinDir(path.join(paths.skillsPath, `${previousId}.md`), paths.skillsPath);
    fs.mkdirSync(paths.skillsPath, { recursive: true });
    fs.writeFileSync(targetPath, normalizeSkillMarkdown(request2, nextId), "utf8");
    if (previousId !== nextId && fs.existsSync(previousPath)) {
      fs.unlinkSync(previousPath);
    }
  }
  deleteSkill(id, workspaceRoot = appPathService.getWorkspaceRoot()) {
    const paths = appPathService.getWorkspacePaths(workspaceRoot);
    const targetPath = validateWithinDir(path.join(paths.skillsPath, `${toRuntimeId(id, "skill")}.md`), paths.skillsPath);
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
  }
  importSkill(filePath, workspaceRoot = appPathService.getWorkspaceRoot()) {
    if (!filePath.endsWith(".md")) {
      throw new Error("Skill import requires a .md file.");
    }
    this.ensureScaffold(workspaceRoot);
    const paths = appPathService.getWorkspacePaths(workspaceRoot);
    const baseId = toRuntimeId(path.basename(filePath, ".md"), "skill");
    const targetPath = this.nextAvailableDescriptorPath(paths.skillsPath, baseId, ".md");
    fs.copyFileSync(filePath, targetPath);
  }
  upsertMcpServer(request2, workspaceRoot = appPathService.getWorkspaceRoot()) {
    this.ensureScaffold(workspaceRoot);
    const paths = appPathService.getWorkspacePaths(workspaceRoot);
    const id = toRuntimeId(request2.id, "mcp-server");
    const transport = MCP_TRANSPORTS.has(request2.transport) ? request2.transport : "stdio";
    const descriptor = {
      id,
      name: request2.name.trim() || titleFromId(id),
      description: request2.description.trim(),
      transport,
      enabledByDefault: request2.enabledByDefault ?? true,
      ...request2.command?.trim() ? { command: request2.command.trim() } : {},
      ...request2.args && request2.args.length > 0 ? { args: request2.args.map((arg) => arg.trim()).filter(Boolean) } : {},
      ...request2.url?.trim() ? { url: request2.url.trim() } : {},
      ...readEnvLines(request2.env) ? { env: readEnvLines(request2.env) } : {}
    };
    const targetPath = validateWithinDir(path.join(paths.mcpPath, `${id}.json`), paths.mcpPath);
    const previousId = request2.previousId ? toRuntimeId(request2.previousId, id) : id;
    const previousPath = validateWithinDir(path.join(paths.mcpPath, `${previousId}.json`), paths.mcpPath);
    fs.mkdirSync(paths.mcpPath, { recursive: true });
    fs.writeFileSync(targetPath, `${JSON.stringify(descriptor, null, 2)}
`, "utf8");
    if (previousId !== id && fs.existsSync(previousPath)) {
      fs.unlinkSync(previousPath);
    }
  }
  deleteMcpServer(id, workspaceRoot = appPathService.getWorkspaceRoot()) {
    const paths = appPathService.getWorkspacePaths(workspaceRoot);
    const targetPath = validateWithinDir(path.join(paths.mcpPath, `${toRuntimeId(id, "mcp-server")}.json`), paths.mcpPath);
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
  }
  importMcpServer(filePath, workspaceRoot = appPathService.getWorkspaceRoot()) {
    if (!filePath.endsWith(".json")) {
      throw new Error("MCP import requires a .json file.");
    }
    this.ensureScaffold(workspaceRoot);
    const parsed = readJsonFile$1(filePath);
    if (!parsed?.id || !MCP_TRANSPORTS.has(parsed.transport)) {
      throw new Error("MCP config is missing id or transport.");
    }
    const paths = appPathService.getWorkspacePaths(workspaceRoot);
    const targetPath = this.nextAvailableDescriptorPath(paths.mcpPath, toRuntimeId(parsed.id, "mcp-server"), ".json");
    fs.copyFileSync(filePath, targetPath);
  }
  readDescriptors(kind, workspaceRoot) {
    this.ensureScaffold(workspaceRoot);
    const paths = appPathService.getWorkspacePaths(workspaceRoot);
    const dir = kind === "patterns" ? paths.patternsPath : paths.mcpPath;
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs.readdirSync(dir).filter((entry) => entry.endsWith(".json")).map((entry) => readJsonFile$1(path.join(dir, entry))).filter((entry) => Boolean(entry?.id)).sort((left, right) => left.id.localeCompare(right.id));
  }
  nextAvailableDescriptorPath(dir, baseId, extension) {
    fs.mkdirSync(dir, { recursive: true });
    let index = 1;
    let candidate = validateWithinDir(path.join(dir, `${baseId}${extension}`), dir);
    while (fs.existsSync(candidate)) {
      index += 1;
      candidate = validateWithinDir(path.join(dir, `${baseId}-${index}${extension}`), dir);
    }
    return candidate;
  }
  removeRetiredSkillJsonFiles(workspaceRoot) {
    const dir = appPathService.getWorkspacePaths(workspaceRoot).skillsPath;
    if (!fs.existsSync(dir)) {
      return;
    }
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(".json")) {
        continue;
      }
      const filePath = path.join(dir, entry);
      const descriptor = readJsonFile$1(filePath);
      if (descriptor?.id && RETIRED_SKILL_JSON_IDS.has(descriptor.id)) {
        fs.unlinkSync(filePath);
      }
    }
  }
}
const agentRuntimeConfigService = new AgentRuntimeConfigService();
const COPILOT_CHAT_COMPLETIONS_FALLBACK_MODELS = [
  "gemini-3-flash-preview",
  "gemini-3.5-flash",
  "gpt-4.1",
  "gpt-4o",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "gpt-5-mini"
];
function isCopilotChatCompletionsUnsupportedModel(modelId) {
  const normalized = modelId.toLowerCase();
  return /^gpt-5\.[3-9](?:-|$)/.test(normalized) || /^gpt-5\.[0-9]+-codex(?:-|$)/.test(normalized);
}
function isEnabledModel(provider, modelId) {
  return provider.models.some((model) => model.enabled !== false && model.id === modelId);
}
function resolveCopilotFallbackModel(routes, provider, agentId) {
  const debuggerRoute = routes.find((entry) => entry.agentId === "debugger");
  const candidates = [
    ...agentId !== "debugger" && debuggerRoute?.providerId === provider.id ? [debuggerRoute.modelId] : [],
    ...COPILOT_CHAT_COMPLETIONS_FALLBACK_MODELS,
    ...provider.models.map((model) => model.id)
  ];
  for (const modelId of candidates) {
    if (modelId && !isCopilotChatCompletionsUnsupportedModel(modelId) && isEnabledModel(provider, modelId)) {
      return modelId;
    }
  }
  return null;
}
function resolveCompatibleAgentRoute(routes, providers, agentId) {
  const route = routes.find((entry) => entry.agentId === agentId) || null;
  if (!route?.providerId || !route.modelId) {
    return { route: null, provider: null };
  }
  const provider = providers.find((entry) => entry.id === route.providerId) || null;
  if (!provider || !provider.enabled || !provider.isConfigured) {
    return { route, provider };
  }
  if (!isEnabledModel(provider, route.modelId)) {
    return { route, provider };
  }
  if (provider.id !== "github-copilot" || !isCopilotChatCompletionsUnsupportedModel(route.modelId)) {
    return { route, provider };
  }
  const fallbackModelId = resolveCopilotFallbackModel(routes, provider, agentId);
  if (!fallbackModelId) {
    return { route, provider };
  }
  return {
    route: {
      ...route,
      modelId: fallbackModelId
    },
    provider,
    requestedModelId: route.modelId,
    remapReason: `${route.modelId} is not available on GitHub Copilot chat completions; using ${fallbackModelId}.`
  };
}
const DEFAULT_MODE_PROFILE_ID = "debugger.default";
const groupToAllowPattern = (group) => {
  if (group === "*") return "*";
  if (group === "primitive") return "primitive.*";
  if (group === "ui") return "ui.*";
  if (group.startsWith("rd.")) return group.endsWith(".*") ? group : `${group}.*`;
  return `rd.${group}.*`;
};
const expandToolPolicy = (policy) => [
  ...policy?.allowTools ?? [],
  ...(policy?.allowGroups ?? []).map(groupToAllowPattern)
].filter(Boolean);
const createFallbackModeProfile = () => ({
  id: DEFAULT_MODE_PROFILE_ID,
  label: "Debugger Production",
  mode: "debugger",
  patternId: "free-agent",
  skillIds: [],
  mcpServerIds: [],
  stagePolicies: {},
  defaultAgentPrompts: {}
});
const createFallbackAgentProfile = (agentId) => {
  const route = isTopLevelAgentId(agentId) ? DEFAULT_MODEL_ROUTING[agentId] : DEFAULT_MODEL_ROUTING.debugger;
  return {
    id: `agent.${agentId}`,
    label: agentId,
    agentId,
    systemPrompt: `You are ${agentId}.`,
    modelProvider: route.provider,
    modelName: route.model,
    temperature: 0.3,
    maxTokens: 4096,
    toolPolicy: { allowTools: [] }
  };
};
const createFallbackStagePolicy = (stage) => ({
  id: `stage.${stage}`,
  label: stage,
  stage,
  phase: STAGE_PHASES[stage],
  toolPolicy: { allowTools: [] }
});
class ExecutionProfileService {
  getModeProfilesPath(workspaceRoot = appPathService.getWorkspaceRoot()) {
    return path.join(appPathService.getWorkspacePaths(workspaceRoot).profilesPath, "modes");
  }
  getAgentProfilesPath(workspaceRoot = appPathService.getWorkspaceRoot()) {
    return path.join(appPathService.getWorkspacePaths(workspaceRoot).profilesPath, "agents");
  }
  getStagePoliciesPath(workspaceRoot = appPathService.getWorkspaceRoot()) {
    return path.join(appPathService.getWorkspacePaths(workspaceRoot).policiesPath, "stages");
  }
  ensureScaffold(workspaceRoot = appPathService.getWorkspaceRoot()) {
    fs.mkdirSync(this.getModeProfilesPath(workspaceRoot), { recursive: true });
    fs.mkdirSync(this.getAgentProfilesPath(workspaceRoot), { recursive: true });
    fs.mkdirSync(this.getStagePoliciesPath(workspaceRoot), { recursive: true });
    agentRuntimeConfigService.ensureScaffold(workspaceRoot);
  }
  normalizeConfiguration(configuration, workspaceRoot = appPathService.getWorkspaceRoot()) {
    this.ensureScaffold(workspaceRoot);
    const availableModeProfiles = this.listModeProfiles(workspaceRoot);
    const hasActiveProfile = availableModeProfiles.some((profile) => profile.id === configuration.activeModeProfileId);
    const availablePatterns = agentRuntimeConfigService.listPatterns(workspaceRoot);
    const availableSkills = agentRuntimeConfigService.listSkills(workspaceRoot);
    const availableMcpServers = agentRuntimeConfigService.listMcpServers(workspaceRoot);
    const patternIds = new Set(availablePatterns.map((pattern) => pattern.id));
    const modePatternBindings = Object.fromEntries(
      Object.entries(configuration.modePatternBindings ?? {}).map(([mode, patternId]) => [mode, patternIds.has(patternId) ? patternId : "free-agent"])
    );
    return {
      ...configuration,
      activeModeProfileId: hasActiveProfile ? configuration.activeModeProfileId : DEFAULT_MODE_PROFILE_ID,
      availableModeProfiles,
      availablePatterns,
      availableSkills,
      availableMcpServers,
      enabledMcpServerIds: configuration.enabledMcpServerIds ?? [],
      modePatternBindings: {
        debugger: patternIds.has(modePatternBindings.debugger) ? modePatternBindings.debugger : "free-agent",
        analyzer: patternIds.has(modePatternBindings.analyzer) ? modePatternBindings.analyzer : "free-agent",
        optimizer: patternIds.has(modePatternBindings.optimizer) ? modePatternBindings.optimizer : "free-agent",
        ...modePatternBindings
      }
    };
  }
  listModeProfiles(workspaceRoot = appPathService.getWorkspaceRoot()) {
    this.ensureScaffold(workspaceRoot);
    return fs.readdirSync(this.getModeProfilesPath(workspaceRoot)).filter((entry) => entry.endsWith(".json")).map((entry) => this.readJson(path.join(this.getModeProfilesPath(workspaceRoot), entry))).filter((profile) => profile !== null).map((profile) => ({ id: profile.id, label: profile.label }));
  }
  resolveAgentRuntimeProfile(settings, stage, agentId) {
    const workspaceRoot = settings.workspace.rootPath;
    this.ensureScaffold(workspaceRoot);
    const modeProfile = this.readJson(
      path.join(this.getModeProfilesPath(workspaceRoot), `${settings.configuration.activeModeProfileId}.json`)
    ) || createFallbackModeProfile();
    const agentPromptId = modeProfile.defaultAgentPrompts[agentId] || `agent.${agentId}`;
    const agentProfile = this.readJson(
      path.join(this.getAgentProfilesPath(workspaceRoot), `${agentId}.json`)
    ) || createFallbackAgentProfile(agentId);
    const stagePolicyId = modeProfile.stagePolicies[stage] || `stage.${stage}`;
    const stagePolicy = this.readJson(
      path.join(this.getStagePoliciesPath(workspaceRoot), `${stage}.json`)
    ) || createFallbackStagePolicy(stage);
    const route = this.resolveAgentRoute(settings.llm.agentRoutes, settings.llm.providers, agentId);
    return {
      agentId,
      systemPrompt: [
        agentProfile.systemPrompt,
        stagePolicy.systemPrompt ? `

Stage Policy:
${stagePolicy.systemPrompt}` : ""
      ].join("").trim(),
      providerId: route?.providerId || "",
      modelId: route?.modelId || "",
      temperature: agentProfile.temperature,
      maxTokens: agentProfile.maxTokens,
      category: isTopLevelAgentId(agentId) ? AGENT_CATEGORIES[agentId] : "general",
      writeScope: isTopLevelAgentId(agentId) ? AGENT_WRITE_SCOPES[agentId] : [],
      stage,
      phase: stagePolicy.phase || STAGE_PHASES[stage],
      toolAllowlist: Array.from(/* @__PURE__ */ new Set([
        ...expandToolPolicy(stagePolicy.toolPolicy),
        ...expandToolPolicy(agentProfile.toolPolicy)
      ])),
      patternId: modeProfile.patternId ?? settings.configuration.modePatternBindings[modeProfile.mode],
      skillIds: Array.from(/* @__PURE__ */ new Set([
        ...modeProfile.skillIds ?? []
      ])),
      mcpServerIds: Array.from(/* @__PURE__ */ new Set([
        ...modeProfile.mcpServerIds ?? [],
        ...settings.configuration.enabledMcpServerIds ?? []
      ])),
      source: {
        modeProfileId: modeProfile.id,
        stagePolicyId,
        agentProfileId: agentPromptId
      }
    };
  }
  getDiagnostics(settings) {
    const diagnostics = [];
    if (!settings.configuration.availableModeProfiles.length) {
      diagnostics.push({
        code: "missing_mode_profile",
        severity: "warning",
        message: "No execution mode profile found. Falling back to debugger.default."
      });
    }
    if (!settings.llm.providers.some((provider) => provider.isConfigured)) {
      diagnostics.push({
        code: "missing_configured_provider",
        severity: "warning",
        message: "No configured provider available for Debugger mode."
      });
    }
    return diagnostics;
  }
  resolveAgentRoute(routes, providers, agentId) {
    const resolution = resolveCompatibleAgentRoute(routes, providers, agentId);
    if (!resolution.route || !resolution.provider) {
      return null;
    }
    const modelExists = resolution.provider.models.some((model) => model.enabled && model.id === resolution.route?.modelId);
    return modelExists ? resolution.route : null;
  }
  readJson(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      console.warn("[ExecutionProfileService] Failed to read JSON:", filePath, error);
      return null;
    }
  }
}
const executionProfileService = new ExecutionProfileService();
const categoryRank = new Map(LLM_PROVIDER_CATEGORY_DEFINITIONS.map((entry, index) => [entry.id, index]));
function toCatalogEntry(provider) {
  return {
    id: provider.id,
    protocol: provider.protocol,
    authMode: provider.authMode,
    category: provider.category,
    label: provider.label,
    baseUrlEditable: provider.baseUrlEditable,
    protocolEditable: provider.protocolEditable,
    protocolOptions: provider.protocolOptions ? [...provider.protocolOptions] : void 0,
    recommendedModels: [...provider.recommendedModels],
    docsUrl: provider.docsUrl,
    accountLoginConfigured: provider.accountLoginConfigured,
    unavailableReason: provider.unavailableReason,
    capabilities: provider.capabilities ? [...provider.capabilities] : void 0
  };
}
function compareProvider(left, right) {
  const leftRank = categoryRank.get(left.category) ?? Number.MAX_SAFE_INTEGER;
  const rightRank = categoryRank.get(right.category) ?? Number.MAX_SAFE_INTEGER;
  const categoryDelta = leftRank - rightRank;
  if (categoryDelta !== 0) {
    return categoryDelta;
  }
  return left.label.localeCompare(right.label, "en", { sensitivity: "base" });
}
class ProviderCatalogService {
  getProviderCatalog() {
    const catalogProviders = BUILTIN_LLM_PROVIDER_DEFINITIONS.map(toCatalogEntry).sort(compareProvider);
    return {
      categories: LLM_PROVIDER_CATEGORY_DEFINITIONS.map((category) => ({ ...category })),
      protocols: LLM_PROVIDER_PROTOCOL_DEFINITIONS.map((protocol) => ({ ...protocol })),
      providers: catalogProviders
    };
  }
}
const providerCatalogService = new ProviderCatalogService();
const PROVIDER_CATEGORIES = LLM_PROVIDER_CATEGORY_DEFINITIONS.map((entry) => entry.id);
const LEGACY_CATEGORY_MAP = {
  account: "login-authorization",
  "openai-compatible": "third-party-compatible",
  "anthropic-compatible": "third-party-compatible",
  "cloud-platform": "cloud-platform",
  local: "local",
  plan: "coding-token-plan",
  image: "image"
};
const LEGACY_PROTOCOL_MAP = {
  openrouter: "OpenRouterChatCompletions",
  "openai-compatible": "OpenAICompatibleChatCompletions",
  anthropic: "AnthropicMessages",
  "google-ai-studio": "GoogleGemini",
  "azure-openai": "AzureOpenAIChatCompletions",
  bedrock: "AwsBedrock",
  vertex: "GoogleVertexAI",
  ollama: "OllamaOpenAICompatibleChatCompletions"
};
function isProviderCategory(value) {
  return typeof value === "string" && PROVIDER_CATEGORIES.includes(value);
}
function legacyCategory(value) {
  return typeof value === "string" ? LEGACY_CATEGORY_MAP[value] ?? null : null;
}
function legacyProtocol(value) {
  return typeof value === "string" ? LEGACY_PROTOCOL_MAP[value] ?? null : null;
}
function normalizeProviderCategory(provider) {
  const id = typeof provider.id === "string" ? provider.id.trim() : "";
  const builtin = id ? BUILTIN_LLM_PROVIDER_DEFINITIONS.find((definition) => definition.id === id) : null;
  if (builtin) {
    return builtin.category;
  }
  if (isProviderCategory(provider.category)) {
    return provider.category;
  }
  const migratedCategory = legacyCategory(provider.category) ?? legacyCategory(provider.catalogGroup);
  if (migratedCategory) {
    return migratedCategory;
  }
  switch (provider.authMode) {
    case "account":
      return "login-authorization";
    case "local":
      return "local";
    case "environment":
      return "cloud-platform";
    default:
      console.warn(
        "[SettingsService] Unable to infer provider category; defaulting to third-party-compatible.",
        { id: provider.id, authMode: provider.authMode, category: provider.category, catalogGroup: provider.catalogGroup }
      );
      return "third-party-compatible";
  }
}
function normalizeProviderProtocol(provider) {
  const id = typeof provider.id === "string" ? provider.id.trim() : "";
  const builtin = id ? getBuiltinProviderDefinition(id) : null;
  if (builtin) {
    const options = getBuiltinProviderProtocolOptions(id);
    if (builtin.protocolEditable && isLlmProviderProtocol(provider.protocol) && options.includes(provider.protocol)) {
      return provider.protocol;
    }
    if (builtin.protocolEditable) {
      const migrated = legacyProtocol(provider.kind);
      if (migrated && options.includes(migrated)) {
        return migrated;
      }
    }
    return builtin.protocol;
  }
  if (isLlmProviderProtocol(provider.protocol)) {
    return provider.protocol;
  }
  const migratedProtocol = legacyProtocol(provider.protocol) ?? legacyProtocol(provider.kind);
  if (migratedProtocol) {
    return migratedProtocol;
  }
  console.warn(
    "[SettingsService] Unable to infer provider protocol; defaulting to OpenAICompatibleChatCompletions.",
    { id: provider.id, protocol: provider.protocol, kind: provider.kind }
  );
  return "OpenAICompatibleChatCompletions";
}
const SECRET_FILE_NAME = "provider-secrets.json";
class SecretStorageService {
  getSecretFilePath(workspaceRoot = appPathService.getWorkspaceRoot()) {
    return path.join(appPathService.getWorkspacePaths(workspaceRoot).secretsPath, SECRET_FILE_NAME);
  }
  readSecretMap(workspaceRoot) {
    const filePath = this.getSecretFilePath(workspaceRoot);
    if (!fs.existsSync(filePath)) {
      return {};
    }
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      console.warn("[SecretStorageService] Failed to read secrets file:", error);
      return {};
    }
  }
  writeSecretMap(secretMap, workspaceRoot) {
    const filePath = this.getSecretFilePath(workspaceRoot);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(secretMap, null, 2), "utf8");
  }
  createProviderSecretRef(providerId) {
    return `provider-${sanitizeToken(providerId)}-api-key`;
  }
  createProviderOAuthSecretRef(providerId) {
    return `provider-${sanitizeToken(providerId)}-oauth`;
  }
  getSecret(secretRef, workspaceRoot) {
    if (!secretRef) {
      return "";
    }
    const secretMap = this.readSecretMap(workspaceRoot);
    const entry = secretMap[secretRef];
    if (!entry) {
      return "";
    }
    try {
      if (entry.encoding === "safeStorage") {
        if (!electron.safeStorage.isEncryptionAvailable()) {
          console.warn("[SecretStorageService] safeStorage is unavailable for secret:", secretRef);
          return "";
        }
        return electron.safeStorage.decryptString(Buffer.from(entry.payload, "base64"));
      }
      return Buffer.from(entry.payload, "base64").toString("utf8");
    } catch (error) {
      console.warn("[SecretStorageService] Failed to decrypt secret:", error);
      return "";
    }
  }
  setSecret(secretRef, plaintext, workspaceRoot) {
    if (!secretRef) {
      return;
    }
    const normalized = plaintext.trim();
    const secretMap = this.readSecretMap(workspaceRoot);
    if (!normalized) {
      delete secretMap[secretRef];
      this.writeSecretMap(secretMap, workspaceRoot);
      return;
    }
    const encryptionAvailable = process.env.RDC_AGENT_TEST_MODE !== "1" && electron.safeStorage.isEncryptionAvailable();
    secretMap[secretRef] = {
      encoding: encryptionAvailable ? "safeStorage" : "base64",
      payload: encryptionAvailable ? electron.safeStorage.encryptString(normalized).toString("base64") : Buffer.from(normalized, "utf8").toString("base64"),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.writeSecretMap(secretMap, workspaceRoot);
  }
  deleteSecret(secretRef, workspaceRoot) {
    if (!secretRef) {
      return;
    }
    const secretMap = this.readSecretMap(workspaceRoot);
    if (!(secretRef in secretMap)) {
      return;
    }
    delete secretMap[secretRef];
    this.writeSecretMap(secretMap, workspaceRoot);
  }
  hasSecret(secretRef, workspaceRoot) {
    return Boolean(secretRef && this.getSecret(secretRef, workspaceRoot));
  }
}
const secretStorageService = new SecretStorageService();
const LEFT_DEFAULTS = {
  width: LEFT_SIDEBAR_DEFAULT_WIDTH,
  min: LEFT_SIDEBAR_MIN_WIDTH,
  max: LEFT_SIDEBAR_MAX_WIDTH,
  collapsedWidth: LEFT_SIDEBAR_COLLAPSED_WIDTH
};
const RIGHT_DEFAULTS = {
  width: RIGHT_PANEL_DEFAULT_WIDTH,
  min: RIGHT_PANEL_MIN_WIDTH,
  max: RIGHT_PANEL_MAX_WIDTH,
  collapsedWidth: RIGHT_PANEL_COLLAPSED_WIDTH
};
const VALID_THEMES = ["dark", "light", "system"];
const VALID_LANGUAGES = ["zh-CN", "en"];
const VALID_FONT_SCALES = ["small", "medium", "large"];
const VALID_PERMISSION_MODES = ["default", "auto-review", "full-access", "custom"];
const RETIRED_BUILTIN_MCP_SERVER_IDS = /* @__PURE__ */ new Set(["builtin.rdc-toolbridge"]);
const EMPTY_PATHS = {
  workspaceRoot: "",
  defaultWorkspaceRoot: "",
  settingsPath: "",
  logsPath: "",
  logPath: "",
  projectsPath: "",
  knowledgePath: "",
  migrationOrphansPath: "",
  profilesPath: "",
  policiesPath: "",
  skillsPath: "",
  mcpPath: "",
  patternsPath: "",
  secretsPath: "",
  migrationReportsPath: ""
};
const DEFAULT_APPEARANCE = {
  theme: "dark",
  language: "zh-CN",
  fontScale: "medium"
};
const DEFAULT_LAYOUT = {
  leftSidebar: {
    collapsed: false,
    width: LEFT_DEFAULTS.width,
    expandedWidth: LEFT_DEFAULTS.width
  },
  rightPanel: {
    collapsed: false,
    width: RIGHT_DEFAULTS.width,
    expandedWidth: RIGHT_DEFAULTS.width
  },
  terminal: {
    height: TERMINAL_DEFAULT_HEIGHT
  }
};
const DEFAULT_PROFILE = {
  nickname: "RDC Operator",
  avatarPath: ""
};
const DEFAULT_CONFIGURATION = {
  activeModeProfileId: "debugger.default",
  enabledMcpServerIds: [],
  modePatternBindings: {
    debugger: "free-agent",
    analyzer: "free-agent",
    optimizer: "free-agent"
  }
};
const DEFAULT_RDX_CLI_INVOKER = {
  enabled: false,
  command: "",
  argsPrefix: [],
  workingDirectory: "",
  env: {},
  timeoutMs: 6e4,
  catalogPath: "",
  jsonMode: "auto"
};
const createDefaultRdxAction = () => ({
  enabled: false,
  command: "",
  args: [],
  workingDirectory: "",
  env: {},
  timeoutMs: 6e4
});
const DEFAULT_RDX_ACTIONS = {
  openCapture: createDefaultRdxAction(),
  connectRemote: createDefaultRdxAction(),
  closeRuntime: createDefaultRdxAction(),
  openPreview: createDefaultRdxAction()
};
const DEFAULT_TOOLING = {
  rdxCli: DEFAULT_RDX_CLI_INVOKER,
  rdxActions: DEFAULT_RDX_ACTIONS
};
const DEFAULT_AGENT_RUNTIME = {
  permissions: {
    mode: "default",
    readableRoots: [],
    writableRoots: [],
    allowedCommandPrefixes: [],
    deniedCommandPrefixes: []
  }
};
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function pickEnum(value, allowed, fallback) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}
function dedupeStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
function sanitizeRuntimeIds(values) {
  return dedupeStrings(
    Array.isArray(values) ? values.filter((value) => typeof value === "string").map((value) => value.trim()) : []
  ).filter((value) => !RETIRED_BUILTIN_MCP_SERVER_IDS.has(value));
}
function sanitizePatternBindings(value) {
  const candidate = value && typeof value === "object" ? value : {};
  const bindings = {};
  for (const [mode, patternId] of Object.entries(candidate)) {
    if (typeof patternId === "string" && patternId.trim()) {
      bindings[mode] = patternId.trim();
    }
  }
  return {
    ...DEFAULT_CONFIGURATION.modePatternBindings ?? {},
    ...bindings
  };
}
function sanitizeStringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean) : [];
}
function sanitizeStringRecord(value) {
  const record = value && typeof value === "object" ? value : {};
  const sanitized = {};
  for (const [key, entry] of Object.entries(record)) {
    const cleanKey = key.trim();
    if (!cleanKey || typeof entry !== "string") {
      continue;
    }
    sanitized[cleanKey] = entry;
  }
  return sanitized;
}
function sanitizeRdxCliInvokerSettings(value, fallback = DEFAULT_RDX_CLI_INVOKER) {
  const candidate = value && typeof value === "object" ? value : {};
  const timeoutMs = typeof candidate.timeoutMs === "number" && Number.isFinite(candidate.timeoutMs) ? clamp(Math.trunc(candidate.timeoutMs), 1e3, 6e5) : fallback.timeoutMs;
  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : fallback.enabled,
    command: typeof candidate.command === "string" ? candidate.command.trim() : fallback.command,
    argsPrefix: sanitizeStringArray(candidate.argsPrefix ?? fallback.argsPrefix),
    workingDirectory: typeof candidate.workingDirectory === "string" ? candidate.workingDirectory.trim() : fallback.workingDirectory,
    env: sanitizeStringRecord(candidate.env ?? fallback.env),
    timeoutMs,
    catalogPath: typeof candidate.catalogPath === "string" ? candidate.catalogPath.trim() : fallback.catalogPath,
    jsonMode: pickEnum(candidate.jsonMode, ["auto", "always"], fallback.jsonMode)
  };
}
function sanitizeRdxShellActionSettings(value, fallback = createDefaultRdxAction()) {
  const candidate = value && typeof value === "object" ? value : {};
  const timeoutMs = typeof candidate.timeoutMs === "number" && Number.isFinite(candidate.timeoutMs) ? clamp(Math.trunc(candidate.timeoutMs), 1e3, 6e5) : fallback.timeoutMs;
  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : fallback.enabled,
    command: typeof candidate.command === "string" ? candidate.command.trim() : fallback.command,
    args: sanitizeStringArray(candidate.args ?? fallback.args),
    workingDirectory: typeof candidate.workingDirectory === "string" ? candidate.workingDirectory.trim() : fallback.workingDirectory,
    env: sanitizeStringRecord(candidate.env ?? fallback.env),
    timeoutMs
  };
}
function sanitizeRdxActionsSettings(value) {
  const candidate = value && typeof value === "object" ? value : {};
  return {
    openCapture: sanitizeRdxShellActionSettings(candidate.openCapture, DEFAULT_RDX_ACTIONS.openCapture),
    connectRemote: sanitizeRdxShellActionSettings(candidate.connectRemote, DEFAULT_RDX_ACTIONS.connectRemote),
    closeRuntime: sanitizeRdxShellActionSettings(candidate.closeRuntime, DEFAULT_RDX_ACTIONS.closeRuntime),
    openPreview: sanitizeRdxShellActionSettings(candidate.openPreview, DEFAULT_RDX_ACTIONS.openPreview)
  };
}
function sanitizeToolingSettings(value) {
  const candidate = value && typeof value === "object" ? value : {};
  return {
    rdxCli: sanitizeRdxCliInvokerSettings(candidate.rdxCli),
    rdxActions: sanitizeRdxActionsSettings(candidate.rdxActions)
  };
}
function sanitizePathList(value) {
  return dedupeStrings(
    sanitizeStringArray(value).map((entry) => path.resolve(expandHomePath(entry)))
  );
}
function expandHomePath(value) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (trimmed === "~") return process.env.USERPROFILE || process.env.HOME || trimmed;
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    const home = process.env.USERPROFILE || process.env.HOME || "";
    return home ? path.join(home, trimmed.slice(2)) : trimmed;
  }
  return trimmed.replace(/^%USERPROFILE%/i, process.env.USERPROFILE || "%USERPROFILE%");
}
function sanitizeAgentPermissionSettings(value, fallback = DEFAULT_AGENT_RUNTIME.permissions) {
  const candidate = value && typeof value === "object" ? value : {};
  return {
    mode: pickEnum(candidate.mode, VALID_PERMISSION_MODES, fallback.mode),
    readableRoots: sanitizePathList(candidate.readableRoots ?? fallback.readableRoots),
    writableRoots: sanitizePathList(candidate.writableRoots ?? fallback.writableRoots),
    allowedCommandPrefixes: sanitizeStringArray(candidate.allowedCommandPrefixes ?? fallback.allowedCommandPrefixes),
    deniedCommandPrefixes: sanitizeStringArray(candidate.deniedCommandPrefixes ?? fallback.deniedCommandPrefixes),
    configPath: typeof candidate.configPath === "string" && candidate.configPath.trim() ? path.resolve(expandHomePath(candidate.configPath.trim())) : void 0
  };
}
function sanitizeAgentRuntimeSettings(value) {
  const candidate = value && typeof value === "object" ? value : {};
  return {
    permissions: sanitizeAgentPermissionSettings(candidate.permissions)
  };
}
function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn("[SettingsService] Failed to read JSON:", filePath, error);
    return null;
  }
}
function isVendorSecretUsable(providerId, secret) {
  const normalized = secret.trim();
  if (!normalized) {
    return false;
  }
  if (providerId === "openrouter") {
    return /^sk-or-/i.test(normalized);
  }
  if (providerId === "openai") {
    return /^sk-/i.test(normalized);
  }
  if (providerId === "anthropic") {
    return /^sk-ant-/i.test(normalized);
  }
  return true;
}
function getResolvedProviderSecret(providerId, secretRef, workspaceRoot) {
  const secret = secretStorageService.getSecret(secretRef, workspaceRoot).trim();
  return isVendorSecretUsable(providerId, secret) ? secret : "";
}
function resolveAccountRuntimeCredential(providerId, workspaceRoot) {
  const raw = secretStorageService.getSecret(secretStorageService.createProviderOAuthSecretRef(providerId), workspaceRoot);
  if (!raw) {
    return { apiKey: "" };
  }
  try {
    const bundle = JSON.parse(raw);
    if (providerId === "github-copilot") {
      return {
        apiKey: bundle.copilotToken ?? "",
        baseUrl: bundle.copilotApiBaseUrl ?? "https://api.githubcopilot.com"
      };
    }
    if (providerId === "chatgpt-account") {
      return {
        apiKey: bundle.accessToken ?? bundle.apiKey ?? "",
        baseUrl: "https://chatgpt.com/backend-api/codex",
        accountId: bundle.accountId
      };
    }
    if (providerId === "grok-account") {
      return {
        apiKey: bundle.accessToken ?? bundle.apiKey ?? "",
        baseUrl: "https://api.x.ai/v1"
      };
    }
    if (providerId === "gemini-account") {
      return {
        apiKey: bundle.accessToken ?? bundle.apiKey ?? "",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta"
      };
    }
    if (providerId === "qwen-account") {
      return {
        apiKey: bundle.accessToken ?? bundle.apiKey ?? "",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1"
      };
    }
    return {
      apiKey: bundle.accessToken ?? "",
      baseUrl: "https://api.anthropic.com/v1"
    };
  } catch {
    return { apiKey: "" };
  }
}
function sanitizeSidebar(input, defaults, fallback) {
  const candidate = input ?? {};
  const expandedWidth = clamp(
    typeof candidate.expandedWidth === "number" ? candidate.expandedWidth : fallback.expandedWidth,
    defaults.min,
    defaults.max
  );
  return {
    collapsed: typeof candidate.collapsed === "boolean" ? candidate.collapsed : fallback.collapsed,
    expandedWidth,
    width: clamp(
      typeof candidate.width === "number" ? candidate.width : fallback.collapsed ? defaults.collapsedWidth : expandedWidth,
      defaults.collapsedWidth,
      defaults.max
    )
  };
}
function sanitizeTerminal(input, fallback = DEFAULT_LAYOUT.terminal) {
  const candidate = input ?? {};
  return {
    height: clamp(
      typeof candidate.height === "number" ? candidate.height : fallback.height,
      TERMINAL_MIN_HEIGHT,
      TERMINAL_MAX_HEIGHT
    )
  };
}
function sanitizeModels(models) {
  const candidates = Array.isArray(models) ? models : [];
  const modelMap = /* @__PURE__ */ new Map();
  for (const entry of candidates) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry;
    const modelId = typeof candidate.id === "string" ? candidate.id.trim() : "";
    if (!modelId || modelMap.has(modelId)) {
      continue;
    }
    modelMap.set(modelId, {
      id: modelId,
      label: typeof candidate.label === "string" && candidate.label.trim() ? candidate.label.trim() : modelId,
      enabled: candidate.enabled !== false,
      contextWindowTokens: typeof candidate.contextWindowTokens === "number" && Number.isFinite(candidate.contextWindowTokens) ? Math.max(0, Math.round(candidate.contextWindowTokens)) : null
    });
  }
  return Array.from(modelMap.values());
}
function createEmptyAgentRoutes() {
  return Object.keys(DEFAULT_MODEL_ROUTING).map((agentId) => ({
    agentId,
    providerId: "",
    modelId: ""
  }));
}
function createDefaultPersistedSettings(workspaceRoot = appPathService.getWorkspaceRoot()) {
  return {
    appearance: DEFAULT_APPEARANCE,
    layout: DEFAULT_LAYOUT,
    profile: DEFAULT_PROFILE,
    workspace: {
      rootPath: workspaceRoot
    },
    tooling: DEFAULT_TOOLING,
    agentRuntime: DEFAULT_AGENT_RUNTIME,
    llm: {
      providers: [],
      agentRoutes: createEmptyAgentRoutes()
    },
    configuration: DEFAULT_CONFIGURATION
  };
}
function createDefaultRuntimeSettings(workspaceRoot = appPathService.getWorkspaceRoot()) {
  const configuration = executionProfileService.normalizeConfiguration({
    activeModeProfileId: DEFAULT_CONFIGURATION.activeModeProfileId || "debugger.default",
    availableModeProfiles: [],
    enabledMcpServerIds: DEFAULT_CONFIGURATION.enabledMcpServerIds ?? [],
    modePatternBindings: DEFAULT_CONFIGURATION.modePatternBindings ?? {},
    availablePatterns: [],
    availableSkills: [],
    availableMcpServers: [],
    lastMigrationReportPath: void 0,
    lastMigrationSummary: [],
    diagnostics: []
  }, workspaceRoot);
  return {
    appearance: DEFAULT_APPEARANCE,
    layout: DEFAULT_LAYOUT,
    profile: DEFAULT_PROFILE,
    workspace: {
      rootPath: workspaceRoot
    },
    tooling: DEFAULT_TOOLING,
    agentRuntime: DEFAULT_AGENT_RUNTIME,
    llm: {
      providers: [],
      agentRoutes: createEmptyAgentRoutes()
    },
    agents: {
      directoryPath: path.join(appPathService.getWorkspacePaths(workspaceRoot).profilesPath, "agents"),
      definitions: [],
      modelOptions: [],
      globalInstructions: ""
    },
    configuration,
    paths: EMPTY_PATHS
  };
}
function sanitizeRoute(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const route = entry;
  if (typeof route.agentId !== "string" || !isSafeAgentProfileId(route.agentId)) {
    return null;
  }
  return {
    agentId: route.agentId,
    providerId: typeof route.providerId === "string" ? normalizeRetiredProviderId(route.providerId.trim()) : "",
    modelId: typeof route.modelId === "string" ? route.modelId.trim() : ""
  };
}
function pickProviderStatus(provider, fallback, canUseProvider, models) {
  if (fallback.status === "unavailable") {
    return "unavailable";
  }
  if (provider.status === "failed") {
    return "failed";
  }
  if ((provider.status === "verified" || provider.isConfigured === true) && canUseProvider && models.length > 0) {
    return "verified";
  }
  return "unconfigured";
}
function isFixtureProvider(provider) {
  const id = typeof provider.id === "string" ? provider.id.trim() : "";
  const baseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl.trim().toLowerCase() : "";
  return /^provider-\d+$/i.test(id) || id === "acme" || id === "vendorx" || baseUrl.includes("example.com") || baseUrl.includes("acme.local") || baseUrl.includes("vendorx.ai");
}
const RETIRED_PROVIDER_ID_IMPORTS = {
  gemini: "vertex",
  kimi: "kimi-coding-plan",
  "kimi-code": "kimi-coding-plan",
  minimax: "minimax-global",
  zai: "glm-global"
};
function normalizeRetiredProviderId(providerId) {
  return RETIRED_PROVIDER_ID_IMPORTS[providerId] ?? providerId;
}
function sanitizeUserProvider(provider, workspaceRoot = appPathService.getWorkspaceRoot()) {
  const incomingId = typeof provider.id === "string" ? provider.id.trim() : "";
  const rawId = normalizeRetiredProviderId(incomingId);
  if (!rawId || !isBuiltinProviderId(rawId)) {
    return null;
  }
  const builtinFallback = createBuiltinProviderEntry(rawId);
  const definition = getBuiltinProviderDefinition(rawId);
  const incomingSecretRef = typeof provider.secretRef === "string" && provider.secretRef.trim() ? provider.secretRef.trim() : void 0;
  const secretRef = incomingId && incomingId !== rawId ? secretStorageService.createProviderSecretRef(rawId) : incomingSecretRef || secretStorageService.createProviderSecretRef(rawId);
  const protocol = normalizeProviderProtocol({ ...provider, id: rawId });
  const models = sanitizeModels(provider.models ?? []);
  const oauthSecretRef = secretStorageService.createProviderOAuthSecretRef(rawId);
  const resolvedSecret = builtinFallback.authMode === "api-key" ? getResolvedProviderSecret(rawId, secretRef, workspaceRoot) : builtinFallback.authMode === "account" ? secretStorageService.getSecret(oauthSecretRef, workspaceRoot) : "";
  const hasStoredSecret = builtinFallback.hasStoredSecret || Boolean(resolvedSecret);
  const canUseProvider = builtinFallback.status !== "unavailable" && (builtinFallback.authMode === "local" || builtinFallback.authMode === "environment" ? true : Boolean(resolvedSecret));
  const status = pickProviderStatus(provider, builtinFallback, canUseProvider, models);
  const enabled = status === "verified" && models.length > 0;
  const label = builtinFallback.label;
  const recommendedModels = builtinFallback.recommendedModels;
  const docsUrl = builtinFallback.docsUrl;
  return {
    id: rawId,
    protocol,
    authMode: builtinFallback.authMode,
    category: normalizeProviderCategory({ ...provider, id: rawId, authMode: builtinFallback.authMode }),
    modelDiscovery: builtinFallback.modelDiscovery,
    label,
    enabled,
    apiKey: "",
    secretRef,
    hasStoredSecret,
    baseUrl: definition?.baseUrlEditable ? typeof provider.baseUrl === "string" ? provider.baseUrl.trim() : definition.baseUrl : definition?.baseUrl,
    baseUrlEditable: definition?.baseUrlEditable,
    protocolEditable: definition?.protocolEditable,
    protocolOptions: builtinFallback.protocolOptions,
    models,
    recommendedModels,
    docsUrl,
    status,
    lastTestedAt: typeof provider.lastTestedAt === "string" ? provider.lastTestedAt : void 0,
    lastModelRefreshAt: typeof provider.lastModelRefreshAt === "string" ? provider.lastModelRefreshAt : void 0,
    lastError: status === "failed" && typeof provider.lastError === "string" ? provider.lastError : void 0,
    accountLoginConfigured: definition?.accountLoginConfigured,
    accountLabel: typeof provider.accountLabel === "string" ? provider.accountLabel : void 0,
    planLabel: typeof provider.planLabel === "string" ? provider.planLabel : void 0,
    oauthExpiresAt: typeof provider.oauthExpiresAt === "string" ? provider.oauthExpiresAt : void 0,
    oauthRefreshAvailable: typeof provider.oauthRefreshAvailable === "boolean" ? provider.oauthRefreshAvailable : void 0,
    unavailableReason: definition?.unavailableReason,
    isConfigured: status === "verified" && models.length > 0 && enabled,
    capabilities: definition?.capabilities ? [...definition.capabilities] : void 0
  };
}
function normalizeUserProviders(providers, workspaceRoot) {
  const persistedProviders = /* @__PURE__ */ new Map();
  for (const entry of Array.isArray(providers) ? providers : []) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const provider = sanitizeUserProvider(entry, workspaceRoot);
    if (!provider || persistedProviders.has(provider.id)) {
      continue;
    }
    persistedProviders.set(provider.id, provider);
  }
  return createBuiltinProviderEntries().map((catalogProvider) => sanitizeUserProvider(persistedProviders.get(catalogProvider.id) ?? catalogProvider, workspaceRoot)).filter((provider) => provider !== null);
}
function hydrateProviderSecrets(providers, workspaceRoot) {
  return providers.map((provider) => {
    const resolvedSecret = provider.authMode === "api-key" ? getResolvedProviderSecret(provider.id, provider.secretRef, workspaceRoot) : provider.authMode === "account" ? secretStorageService.getSecret(secretStorageService.createProviderOAuthSecretRef(provider.id), workspaceRoot) : "";
    const hasStoredSecret = provider.authMode === "local" || provider.authMode === "environment" || Boolean(resolvedSecret);
    const canUseProvider = provider.authMode === "local" || provider.authMode === "environment" ? true : provider.authMode === "api-key" ? Boolean(resolvedSecret) : Boolean(resolvedSecret);
    const status = provider.status === "unavailable" ? "unavailable" : provider.status === "verified" && canUseProvider && provider.models.length > 0 ? "verified" : provider.status === "failed" ? "failed" : "unconfigured";
    const isConfigured = status === "verified" && provider.models.length > 0;
    return {
      ...provider,
      // The renderer only needs to know whether a secret exists.
      // Keep plaintext secrets out of settings:get payloads.
      apiKey: "",
      hasStoredSecret,
      enabled: isConfigured,
      status,
      isConfigured
    };
  });
}
function normalizeUserRoutes(routes, providers) {
  const routeMap = new Map(
    createEmptyAgentRoutes().map((route) => [route.agentId, route])
  );
  for (const route of Array.isArray(routes) ? routes.map(sanitizeRoute) : []) {
    if (!route) {
      continue;
    }
    routeMap.set(route.agentId, route);
  }
  for (const [agentId, incoming] of routeMap.entries()) {
    if (!incoming.providerId || !incoming.modelId) {
      routeMap.set(agentId, { agentId, providerId: "", modelId: "" });
      continue;
    }
    const provider = providers.find((entry) => entry.id === incoming.providerId);
    const isValid = Boolean(
      provider && provider.isConfigured && provider.models.some((model) => model.id === incoming.modelId && model.enabled !== false)
    );
    if (!isValid) {
      routeMap.set(agentId, { agentId, providerId: "", modelId: "" });
    }
  }
  return Array.from(routeMap.values());
}
function parseMigrationSummary(reportPath) {
  if (!reportPath || !fs.existsSync(reportPath)) {
    return [];
  }
  try {
    const content = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    return [...content.fixes ?? [], ...content.warnings ?? []];
  } catch (error) {
    console.warn("[SettingsService] Failed to read migration report:", error);
    return [];
  }
}
class SettingsService {
  initialized = false;
  initialize() {
    const runtimePaths = appPathService.initializeWorkspaceRoot();
    executionProfileService.ensureScaffold(runtimePaths.workspaceRoot);
    const rawPersisted = readJsonFile(runtimePaths.settingsPath);
    const rebuildResult = this.rebuildPersistedSettings(rawPersisted, runtimePaths.workspaceRoot);
    if (rebuildResult.changed || !fs.existsSync(runtimePaths.settingsPath)) {
      this.persistHardRebuild(runtimePaths, rawPersisted, rebuildResult);
    }
    this.initialized = true;
    return this.getAll(runtimePaths);
  }
  ensureInitialized() {
    if (!this.initialized) {
      this.initialize();
    }
  }
  rebuildPersistedSettings(raw, workspaceRoot) {
    const fallback = createDefaultPersistedSettings(workspaceRoot);
    const candidate = raw ?? fallback;
    const fixes = [];
    const warnings = [];
    const persistedRawProviders = Array.isArray(candidate.llm?.providers) ? candidate.llm?.providers : [];
    const persistedRawRoutes = Array.isArray(candidate.llm?.agentRoutes) ? candidate.llm?.agentRoutes : [];
    const rawProviders = persistedRawProviders;
    const rawRoutes = persistedRawRoutes;
    const nextProviders = [];
    for (const entry of rawProviders) {
      if (isFixtureProvider(entry)) {
        fixes.push(`Removed fixture provider ${entry.id}`);
        secretStorageService.deleteSecret(entry.secretRef, workspaceRoot);
        continue;
      }
      const incomingId = typeof entry.id === "string" ? entry.id.trim() : "";
      const rawId = normalizeRetiredProviderId(incomingId);
      if (!rawId) {
        fixes.push("Removed provider with empty id");
        continue;
      }
      if (incomingId && incomingId !== rawId) {
        fixes.push(`Renamed retired provider id ${incomingId} to ${rawId}`);
      }
      const canonicalSecretRef = secretStorageService.createProviderSecretRef(rawId);
      const incomingSecretRef = typeof entry.secretRef === "string" && entry.secretRef.trim() ? entry.secretRef.trim() : void 0;
      const secretRef = incomingId && incomingId !== rawId ? canonicalSecretRef : incomingSecretRef || canonicalSecretRef;
      if (incomingSecretRef && incomingSecretRef !== secretRef) {
        const incomingSecret = secretStorageService.getSecret(incomingSecretRef, workspaceRoot);
        if (incomingSecret.trim()) {
          secretStorageService.setSecret(secretRef, incomingSecret, workspaceRoot);
          secretStorageService.deleteSecret(incomingSecretRef, workspaceRoot);
          fixes.push(`Moved retired provider secret ${incomingId} to ${rawId}`);
        }
      }
      if (entry.apiKey?.trim()) {
        secretStorageService.setSecret(secretRef, entry.apiKey.trim(), workspaceRoot);
        fixes.push(`Migrated plaintext secret for ${rawId}`);
      }
      const sanitized = sanitizeUserProvider({ ...entry, secretRef }, workspaceRoot);
      if (!sanitized) {
        fixes.push(`Removed non-catalog provider ${rawId}`);
        continue;
      }
      if (!nextProviders.some((provider) => provider.id === sanitized.id)) {
        nextProviders.push(sanitized);
      } else {
        fixes.push(`Removed duplicated provider ${sanitized.id}`);
      }
    }
    const catalogProviders = normalizeUserProviders(nextProviders, workspaceRoot);
    const normalizedRoutes = normalizeUserRoutes(rawRoutes, catalogProviders);
    const nextRoutes = normalizedRoutes;
    const incomingRoutes = Array.isArray(rawRoutes) ? rawRoutes.map((entry) => {
      if (entry && typeof entry === "object") {
        const providerId = entry.providerId;
        const incomingProviderId = typeof providerId === "string" ? providerId.trim() : "";
        const normalizedProviderId = normalizeRetiredProviderId(incomingProviderId);
        if (incomingProviderId && incomingProviderId !== normalizedProviderId) {
          const agentId = entry.agentId;
          fixes.push(`Renamed retired route provider id ${incomingProviderId} to ${normalizedProviderId}${typeof agentId === "string" ? ` for ${agentId}` : ""}`);
        }
      }
      return sanitizeRoute(entry);
    }).filter((route) => route !== null) : [];
    for (const route of incomingRoutes) {
      const normalized = nextRoutes.find((entry) => entry.agentId === route.agentId);
      if (!normalized || normalized.providerId !== route.providerId || normalized.modelId !== route.modelId) {
        if (route.providerId || route.modelId) {
          fixes.push(`Cleared invalid route for ${route.agentId}`);
        }
      }
    }
    if (!catalogProviders.some((provider) => provider.isConfigured)) {
      warnings.push("No configured provider available for Debugger mode.");
    }
    const nextSettings = {
      appearance: {
        theme: pickEnum(candidate.appearance?.theme, VALID_THEMES, fallback.appearance?.theme ?? "dark"),
        language: pickEnum(candidate.appearance?.language, VALID_LANGUAGES, fallback.appearance?.language ?? "zh-CN"),
        fontScale: pickEnum(candidate.appearance?.fontScale, VALID_FONT_SCALES, fallback.appearance?.fontScale ?? "medium")
      },
      layout: {
        leftSidebar: sanitizeSidebar(candidate.layout?.leftSidebar, LEFT_DEFAULTS, fallback.layout?.leftSidebar ?? DEFAULT_LAYOUT.leftSidebar),
        rightPanel: sanitizeSidebar(candidate.layout?.rightPanel, RIGHT_DEFAULTS, fallback.layout?.rightPanel ?? DEFAULT_LAYOUT.rightPanel),
        terminal: sanitizeTerminal(candidate.layout?.terminal, fallback.layout?.terminal ?? DEFAULT_LAYOUT.terminal)
      },
      profile: {
        nickname: typeof candidate.profile?.nickname === "string" && candidate.profile.nickname.trim() ? candidate.profile.nickname.trim() : DEFAULT_PROFILE.nickname,
        avatarPath: typeof candidate.profile?.avatarPath === "string" ? candidate.profile.avatarPath : DEFAULT_PROFILE.avatarPath
      },
      workspace: {
        rootPath: candidate.workspace?.rootPath?.trim() || workspaceRoot
      },
      tooling: sanitizeToolingSettings(candidate.tooling ?? fallback.tooling),
      agentRuntime: sanitizeAgentRuntimeSettings(candidate.agentRuntime ?? fallback.agentRuntime),
      llm: {
        providers: catalogProviders.map((provider) => ({ ...provider, apiKey: "" })),
        agentRoutes: nextRoutes
      },
      configuration: {
        activeModeProfileId: candidate.configuration?.activeModeProfileId?.trim() || DEFAULT_CONFIGURATION.activeModeProfileId,
        enabledMcpServerIds: sanitizeRuntimeIds(candidate.configuration?.enabledMcpServerIds),
        modePatternBindings: sanitizePatternBindings(candidate.configuration?.modePatternBindings),
        lastMigrationReportPath: candidate.configuration?.lastMigrationReportPath
      }
    };
    return {
      settings: nextSettings,
      changed: JSON.stringify(candidate) !== JSON.stringify(nextSettings),
      fixes,
      warnings
    };
  }
  normalizePersistedSettings(raw, workspaceRoot) {
    const fallback = createDefaultPersistedSettings(workspaceRoot);
    const candidate = raw ?? fallback;
    const nextProviders = normalizeUserProviders(candidate.llm?.providers, workspaceRoot).map((provider) => ({
      ...provider,
      apiKey: ""
    }));
    const nextRoutes = normalizeUserRoutes(candidate.llm?.agentRoutes, nextProviders);
    return {
      appearance: {
        theme: pickEnum(candidate.appearance?.theme, VALID_THEMES, fallback.appearance?.theme ?? "dark"),
        language: pickEnum(candidate.appearance?.language, VALID_LANGUAGES, fallback.appearance?.language ?? "zh-CN"),
        fontScale: pickEnum(candidate.appearance?.fontScale, VALID_FONT_SCALES, fallback.appearance?.fontScale ?? "medium")
      },
      layout: {
        leftSidebar: sanitizeSidebar(candidate.layout?.leftSidebar, LEFT_DEFAULTS, fallback.layout?.leftSidebar ?? DEFAULT_LAYOUT.leftSidebar),
        rightPanel: sanitizeSidebar(candidate.layout?.rightPanel, RIGHT_DEFAULTS, fallback.layout?.rightPanel ?? DEFAULT_LAYOUT.rightPanel),
        terminal: sanitizeTerminal(candidate.layout?.terminal, fallback.layout?.terminal ?? DEFAULT_LAYOUT.terminal)
      },
      profile: {
        nickname: typeof candidate.profile?.nickname === "string" && candidate.profile.nickname.trim() ? candidate.profile.nickname.trim() : DEFAULT_PROFILE.nickname,
        avatarPath: typeof candidate.profile?.avatarPath === "string" ? candidate.profile.avatarPath : DEFAULT_PROFILE.avatarPath
      },
      workspace: {
        rootPath: candidate.workspace?.rootPath?.trim() || workspaceRoot
      },
      tooling: sanitizeToolingSettings(candidate.tooling ?? fallback.tooling),
      agentRuntime: sanitizeAgentRuntimeSettings(candidate.agentRuntime ?? fallback.agentRuntime),
      llm: {
        providers: nextProviders,
        agentRoutes: nextRoutes
      },
      configuration: {
        activeModeProfileId: candidate.configuration?.activeModeProfileId?.trim() || DEFAULT_CONFIGURATION.activeModeProfileId,
        enabledMcpServerIds: sanitizeRuntimeIds(candidate.configuration?.enabledMcpServerIds),
        modePatternBindings: sanitizePatternBindings(candidate.configuration?.modePatternBindings),
        lastMigrationReportPath: candidate.configuration?.lastMigrationReportPath
      }
    };
  }
  writeMigrationReport(paths, fixes, warnings) {
    const reportPath = path.join(paths.migrationReportsPath, `settings-rebuild-${Date.now()}.json`);
    fs.mkdirSync(paths.migrationReportsPath, { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify({
      generatedAt: nowIso(),
      fixes,
      warnings
    }, null, 2), "utf8");
    return reportPath;
  }
  persistHardRebuild(paths, previous, result) {
    const nextSettings = {
      ...result.settings,
      configuration: {
        ...result.settings.configuration
      }
    };
    if (result.changed && previous && fs.existsSync(paths.settingsPath)) {
      fs.mkdirSync(paths.migrationOrphansPath, { recursive: true });
      const backupPath = path.join(paths.migrationOrphansPath, `settings.backup.${Date.now()}.json`);
      fs.copyFileSync(paths.settingsPath, backupPath);
    }
    if (result.changed && (result.fixes.length > 0 || result.warnings.length > 0)) {
      nextSettings.configuration = {
        ...nextSettings.configuration,
        lastMigrationReportPath: this.writeMigrationReport(paths, result.fixes, result.warnings)
      };
    }
    this.writeSettings(nextSettings, paths.workspaceRoot);
  }
  toRuntimeSettings(persisted, runtimePaths) {
    const workspaceRoot = persisted.workspace?.rootPath?.trim() || appPathService.getWorkspaceRoot();
    const normalized = this.normalizePersistedSettings(persisted, workspaceRoot);
    const hydratedProviders = hydrateProviderSecrets(normalized.llm.providers, workspaceRoot);
    const paths = appPathService.getWorkspacePaths(workspaceRoot);
    const configuration = executionProfileService.normalizeConfiguration({
      activeModeProfileId: normalized.configuration?.activeModeProfileId || DEFAULT_CONFIGURATION.activeModeProfileId || "debugger.default",
      availableModeProfiles: [],
      enabledMcpServerIds: normalized.configuration?.enabledMcpServerIds ?? [],
      modePatternBindings: normalized.configuration?.modePatternBindings ?? DEFAULT_CONFIGURATION.modePatternBindings ?? {},
      availablePatterns: [],
      availableSkills: [],
      availableMcpServers: [],
      lastMigrationReportPath: normalized.configuration?.lastMigrationReportPath,
      lastMigrationSummary: parseMigrationSummary(normalized.configuration?.lastMigrationReportPath),
      diagnostics: []
    }, workspaceRoot);
    const settings = {
      ...createDefaultRuntimeSettings(workspaceRoot),
      appearance: normalized.appearance,
      layout: normalized.layout,
      profile: normalized.profile,
      workspace: {
        rootPath: workspaceRoot
      },
      tooling: normalized.tooling,
      agentRuntime: normalized.agentRuntime,
      llm: {
        providers: hydratedProviders,
        agentRoutes: normalizeUserRoutes(normalized.llm?.agentRoutes ?? createEmptyAgentRoutes(), hydratedProviders)
      },
      agents: agentManifestService.getSettings(paths, hydratedProviders, normalized.llm?.agentRoutes ?? createEmptyAgentRoutes()),
      configuration,
      paths: {
        ...paths,
        ...runtimePaths ?? {}
      }
    };
    settings.configuration.diagnostics = executionProfileService.getDiagnostics(settings);
    return settings;
  }
  writeSettings(settings, workspaceRoot = settings.workspace?.rootPath || appPathService.getWorkspaceRoot()) {
    const filePath = appPathService.getWorkspacePaths(workspaceRoot).settingsPath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), "utf8");
  }
  getAll(runtimePaths) {
    this.ensureInitialized();
    const paths = appPathService.getWorkspacePaths();
    const persisted = readJsonFile(paths.settingsPath) ?? createDefaultPersistedSettings(paths.workspaceRoot);
    return this.toRuntimeSettings(persisted, runtimePaths);
  }
  getProviderSecret(providerId, workspaceRoot = appPathService.getWorkspaceRoot()) {
    this.ensureInitialized();
    const persisted = this.normalizePersistedSettings(
      readJsonFile(appPathService.getWorkspacePaths(workspaceRoot).settingsPath) ?? createDefaultPersistedSettings(workspaceRoot),
      workspaceRoot
    );
    const provider = persisted.llm.providers.find((entry) => entry.id === providerId);
    if (!provider || provider.authMode !== "api-key") {
      return "";
    }
    return getResolvedProviderSecret(provider.id, provider.secretRef, workspaceRoot);
  }
  getProviderOAuthSecret(providerId, workspaceRoot = appPathService.getWorkspaceRoot()) {
    this.ensureInitialized();
    return secretStorageService.getSecret(secretStorageService.createProviderOAuthSecretRef(providerId), workspaceRoot);
  }
  setAll(patch, runtimePaths) {
    this.ensureInitialized();
    const currentRuntime = this.getAll();
    const requestedRoot = patch.workspace?.rootPath?.trim() || currentRuntime.workspace.rootPath || appPathService.getWorkspacePaths().workspaceRoot;
    const nextPaths = appPathService.setWorkspaceRoot(requestedRoot);
    executionProfileService.ensureScaffold(nextPaths.workspaceRoot);
    const currentPersisted = this.normalizePersistedSettings(
      readJsonFile(nextPaths.settingsPath) ?? createDefaultPersistedSettings(nextPaths.workspaceRoot),
      nextPaths.workspaceRoot
    );
    const providerDrafts = (patch.llm?.providers ?? currentPersisted.llm?.providers ?? []).map((provider) => {
      const secretRef = provider.secretRef || secretStorageService.createProviderSecretRef(provider.id);
      const apiKey = provider.apiKey?.trim() ?? "";
      if (provider.authMode === "api-key" && apiKey) {
        secretStorageService.setSecret(secretRef, apiKey, nextPaths.workspaceRoot);
      } else if (provider.authMode === "api-key" && !provider.hasStoredSecret) {
        secretStorageService.deleteSecret(secretRef, nextPaths.workspaceRoot);
      }
      return sanitizeUserProvider({
        ...provider,
        secretRef
      }, nextPaths.workspaceRoot);
    }).filter((provider) => provider !== null);
    const nextProviders = normalizeUserProviders(providerDrafts, nextPaths.workspaceRoot);
    const currentRoutes = normalizeUserRoutes(patch.llm?.agentRoutes ?? currentPersisted.llm?.agentRoutes ?? [], nextProviders);
    if (patch.agents?.definitions) {
      agentManifestService.save(
        nextPaths,
        patch.agents.definitions,
        patch.agents.globalInstructions
      );
    } else if (typeof patch.agents?.globalInstructions === "string") {
      agentManifestService.save(nextPaths, [], patch.agents.globalInstructions);
    }
    const manifestRoutes = patch.agents?.definitions ? agentManifestService.routesFromDefinitions(currentRoutes, patch.agents.definitions, nextProviders) : currentRoutes;
    const nextPersisted = {
      appearance: {
        theme: pickEnum(
          patch.appearance?.theme ?? currentPersisted.appearance?.theme,
          VALID_THEMES,
          DEFAULT_APPEARANCE.theme
        ),
        language: pickEnum(
          patch.appearance?.language ?? currentPersisted.appearance?.language,
          VALID_LANGUAGES,
          DEFAULT_APPEARANCE.language
        ),
        fontScale: pickEnum(
          patch.appearance?.fontScale ?? currentPersisted.appearance?.fontScale,
          VALID_FONT_SCALES,
          DEFAULT_APPEARANCE.fontScale
        )
      },
      layout: {
        leftSidebar: sanitizeSidebar(
          {
            ...currentPersisted.layout?.leftSidebar ?? DEFAULT_LAYOUT.leftSidebar,
            ...patch.layout?.leftSidebar ?? {}
          },
          LEFT_DEFAULTS,
          DEFAULT_LAYOUT.leftSidebar
        ),
        rightPanel: sanitizeSidebar(
          {
            ...currentPersisted.layout?.rightPanel ?? DEFAULT_LAYOUT.rightPanel,
            ...patch.layout?.rightPanel ?? {}
          },
          RIGHT_DEFAULTS,
          DEFAULT_LAYOUT.rightPanel
        ),
        terminal: sanitizeTerminal(
          {
            ...currentPersisted.layout?.terminal ?? DEFAULT_LAYOUT.terminal,
            ...patch.layout?.terminal ?? {}
          },
          DEFAULT_LAYOUT.terminal
        )
      },
      profile: {
        nickname: typeof patch.profile?.nickname === "string" && patch.profile.nickname.trim() ? patch.profile.nickname.trim() : currentPersisted.profile?.nickname || DEFAULT_PROFILE.nickname,
        avatarPath: typeof patch.profile?.avatarPath === "string" ? patch.profile.avatarPath : currentPersisted.profile?.avatarPath || DEFAULT_PROFILE.avatarPath
      },
      workspace: {
        rootPath: nextPaths.workspaceRoot
      },
      tooling: {
        rdxCli: sanitizeRdxCliInvokerSettings({
          ...currentPersisted.tooling?.rdxCli ?? DEFAULT_RDX_CLI_INVOKER,
          ...patch.tooling?.rdxCli ?? {}
        }),
        rdxActions: sanitizeRdxActionsSettings({
          ...currentPersisted.tooling?.rdxActions ?? DEFAULT_RDX_ACTIONS,
          ...patch.tooling?.rdxActions ?? {}
        })
      },
      agentRuntime: {
        permissions: sanitizeAgentPermissionSettings({
          ...currentPersisted.agentRuntime?.permissions ?? DEFAULT_AGENT_RUNTIME.permissions,
          ...patch.agentRuntime?.permissions ?? {}
        })
      },
      llm: {
        providers: nextProviders.map((provider) => ({ ...provider, apiKey: "" })),
        agentRoutes: normalizeUserRoutes(manifestRoutes, nextProviders)
      },
      configuration: {
        activeModeProfileId: patch.configuration?.activeModeProfileId || currentPersisted.configuration?.activeModeProfileId || DEFAULT_CONFIGURATION.activeModeProfileId,
        enabledMcpServerIds: patch.configuration?.enabledMcpServerIds ? sanitizeRuntimeIds(patch.configuration.enabledMcpServerIds) : sanitizeRuntimeIds(currentPersisted.configuration?.enabledMcpServerIds),
        modePatternBindings: patch.configuration?.modePatternBindings ? sanitizePatternBindings(patch.configuration.modePatternBindings) : sanitizePatternBindings(currentPersisted.configuration?.modePatternBindings),
        lastMigrationReportPath: currentPersisted.configuration?.lastMigrationReportPath
      }
    };
    this.writeSettings(nextPersisted, nextPaths.workspaceRoot);
    return this.getAll({
      ...nextPaths,
      ...runtimePaths ?? {}
    });
  }
  saveProviderConnection(providerId, apiKey, models, baseUrl = "", protocolDraft) {
    const current = this.getAll();
    const provider = current.llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id)) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    const discoveredModels = sanitizeModels(models);
    if (discoveredModels.length === 0) {
      throw new Error("该 Provider 暂未返回可用模型");
    }
    const protocol = normalizeProviderProtocol({ id: provider.id, protocol: protocolDraft ?? provider.protocol });
    const timestamp = nowIso();
    const nextProvider = {
      ...provider,
      apiKey: apiKey.trim(),
      protocol,
      enabled: true,
      hasStoredSecret: provider.authMode === "api-key" ? Boolean(apiKey.trim() || provider.hasStoredSecret) : provider.authMode === "local" || provider.authMode === "environment" || provider.hasStoredSecret,
      baseUrl: provider.baseUrlEditable ? baseUrl.trim() || provider.baseUrl : provider.baseUrl,
      models: discoveredModels.map((model) => ({ ...model, enabled: true })),
      status: "verified",
      lastTestedAt: timestamp,
      lastModelRefreshAt: timestamp,
      lastError: void 0,
      isConfigured: true
    };
    return this.setAll({
      llm: {
        providers: current.llm.providers.map((entry) => entry.id === providerId ? nextProvider : entry),
        agentRoutes: current.llm.agentRoutes
      }
    });
  }
  saveProviderAccountConnection(providerId, secretPayload, models, accountSummary = {}) {
    const current = this.getAll();
    const provider = current.llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id) || provider.authMode !== "account") {
      throw new Error(`Unknown account provider: ${providerId}`);
    }
    const discoveredModels = sanitizeModels(models);
    if (discoveredModels.length === 0) {
      throw new Error("Provider returned no usable models");
    }
    secretStorageService.setSecret(
      secretStorageService.createProviderOAuthSecretRef(provider.id),
      secretPayload,
      current.workspace.rootPath
    );
    const timestamp = nowIso();
    const nextProvider = {
      ...provider,
      enabled: true,
      hasStoredSecret: true,
      models: discoveredModels.map((model) => ({ ...model, enabled: true })),
      status: "verified",
      lastTestedAt: timestamp,
      lastModelRefreshAt: timestamp,
      lastError: void 0,
      accountLabel: accountSummary.accountLabel,
      planLabel: accountSummary.planLabel,
      oauthExpiresAt: accountSummary.oauthExpiresAt,
      oauthRefreshAvailable: accountSummary.oauthRefreshAvailable,
      isConfigured: true
    };
    return this.setAll({
      llm: {
        providers: current.llm.providers.map((entry) => entry.id === providerId ? nextProvider : entry),
        agentRoutes: current.llm.agentRoutes
      }
    });
  }
  disconnectProvider(providerId) {
    const current = this.getAll();
    const provider = current.llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id)) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    if (provider.authMode === "api-key") {
      secretStorageService.deleteSecret(provider.secretRef, current.workspace.rootPath);
    } else if (provider.authMode === "account") {
      secretStorageService.deleteSecret(secretStorageService.createProviderOAuthSecretRef(provider.id), current.workspace.rootPath);
    }
    const fallback = createBuiltinProviderEntry(provider.id);
    const nextProvider = {
      ...provider,
      apiKey: "",
      hasStoredSecret: fallback.hasStoredSecret,
      models: [],
      enabled: false,
      status: fallback.status,
      lastError: void 0,
      accountLabel: void 0,
      planLabel: void 0,
      oauthExpiresAt: void 0,
      oauthRefreshAvailable: void 0,
      isConfigured: false
    };
    return this.setAll({
      llm: {
        providers: current.llm.providers.map((entry) => entry.id === providerId ? nextProvider : entry),
        agentRoutes: current.llm.agentRoutes
      }
    });
  }
  getLlmConfig() {
    const settings = this.getAll();
    const providers = settings.llm.providers.filter((provider) => provider.enabled && provider.isConfigured && provider.status === "verified").map((provider) => {
      const accountCredential = provider.authMode === "account" ? resolveAccountRuntimeCredential(provider.id, settings.workspace.rootPath) : { apiKey: "", baseUrl: void 0 };
      return {
        id: provider.id,
        protocol: provider.protocol,
        label: provider.label,
        enabled: provider.enabled,
        apiKey: provider.authMode === "api-key" ? getResolvedProviderSecret(provider.id, provider.secretRef, settings.workspace.rootPath) : provider.authMode === "account" ? accountCredential.apiKey : "",
        baseUrl: accountCredential.baseUrl ?? provider.baseUrl,
        accountId: accountCredential.accountId,
        authMode: provider.authMode,
        models: provider.models.filter((model) => model.enabled).map((model) => model.id),
        docsUrl: provider.docsUrl
      };
    }).filter((provider) => provider.models.length > 0);
    return {
      providers,
      agentRoutes: settings.llm.agentRoutes
    };
  }
  getProviderCatalog() {
    return providerCatalogService.getProviderCatalog();
  }
  hasConfiguredProvider() {
    return this.getAll().llm.providers.some((provider) => provider.isConfigured);
  }
  getSettingsPath() {
    return appPathService.getWorkspacePaths().settingsPath;
  }
}
const settingsService = new SettingsService();
class ShellInvocationService {
  activeProcesses = /* @__PURE__ */ new Map();
  async invoke(request2) {
    const startTime = nowMs();
    const command = request2.command.trim();
    if (!command) {
      return {
        exitCode: 2,
        stdout: "",
        stderr: "RDX CLI command is not configured.",
        duration_ms: nowMs() - startTime
      };
    }
    return new Promise((resolve) => {
      const needsShell = process.platform === "win32" && [".bat", ".cmd"].includes(path.extname(command).toLowerCase());
      const proc = child_process.spawn(command, request2.args ?? [], {
        cwd: request2.cwd || void 0,
        env: {
          ...process.env,
          ...request2.env,
          PYTHONIOENCODING: "utf-8"
        },
        shell: needsShell,
        windowsHide: true
      });
      const procId = generateEventId("proc");
      this.activeProcesses.set(procId, { process: proc, runId: request2.runId });
      let stdout = "";
      let stderr = "";
      let timeoutId = null;
      let settled = false;
      const abortHandler = () => {
        try {
          proc.kill();
        } catch {
        }
      };
      const finalize = (result) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        this.activeProcesses.delete(procId);
        request2.abortSignal?.removeEventListener("abort", abortHandler);
        resolve(result);
      };
      if (request2.timeoutMs) {
        timeoutId = setTimeout(() => {
          abortHandler();
          finalize({
            exitCode: 124,
            stdout,
            stderr: stderr || `Process timeout after ${request2.timeoutMs}ms`,
            duration_ms: nowMs() - startTime
          });
        }, request2.timeoutMs);
      }
      if (request2.abortSignal) {
        if (request2.abortSignal.aborted) {
          abortHandler();
        } else {
          request2.abortSignal.addEventListener("abort", abortHandler, { once: true });
        }
      }
      proc.stdout?.on("data", (data) => {
        stdout += data.toString("utf-8");
      });
      proc.stderr?.on("data", (data) => {
        stderr += data.toString("utf-8");
      });
      proc.on("close", (code) => {
        finalize({
          exitCode: code ?? 0,
          stdout,
          stderr,
          duration_ms: nowMs() - startTime
        });
      });
      proc.on("error", (error) => {
        finalize({
          exitCode: 2,
          stdout,
          stderr: error instanceof Error ? error.message : String(error),
          duration_ms: nowMs() - startTime
        });
      });
    });
  }
  abortRun(runId) {
    for (const { process: process2, runId: activeRunId } of this.activeProcesses.values()) {
      if (activeRunId !== runId) continue;
      try {
        process2.kill();
      } catch {
      }
    }
  }
  terminateAll() {
    for (const active of this.activeProcesses.values()) {
      try {
        active.process.kill();
      } catch {
      }
    }
    this.activeProcesses.clear();
  }
}
const shellInvocationService = new ShellInvocationService();
function resolveRdxBatchInvocation(command, args) {
  if (process.platform !== "win32" || path.basename(command).toLowerCase() !== "rdx.bat") {
    return { command, args };
  }
  const launcherPath = path.join(path.dirname(command), "scripts", "rdx_bat_launcher.ps1");
  if (!fs.existsSync(launcherPath)) {
    return { command, args };
  }
  const psFlags = ["-NoProfile", "-NoLogo", "-ExecutionPolicy", "Bypass"];
  if (args[0]?.toLowerCase() === "--non-interactive") {
    psFlags.push("-NonInteractive");
  }
  return {
    command: path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    args: [...psFlags, "-File", launcherPath, ...args]
  };
}
const substitute = (value, variables) => value.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, key) => {
  const replacement = variables[key];
  return replacement == null ? "" : String(replacement);
});
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const readErrorMessage = (value) => {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (isRecord(value)) {
    const message = value.message ?? value.error_message ?? value.code;
    return typeof message === "string" && message.trim() ? message : void 0;
  }
  return void 0;
};
const parseJsonPayload = (stdout) => {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { data: {} };
  }
  const parsed = JSON.parse(trimmed);
  if (!isRecord(parsed)) {
    throw new Error("RDX action stdout must be a JSON object.");
  }
  if (typeof parsed.ok === "boolean" && ("data" in parsed || "result_kind" in parsed || "error" in parsed)) {
    const envelopeData = isRecord(parsed.data) ? parsed.data : {};
    const data = { ...envelopeData };
    const envelopeContextId = typeof parsed.context_id === "string" && parsed.context_id.trim() ? parsed.context_id.trim() : typeof parsed.contextId === "string" && parsed.contextId.trim() ? parsed.contextId.trim() : void 0;
    if (envelopeContextId && typeof data.context_id !== "string" && typeof data.contextId !== "string") {
      data.context_id = envelopeContextId;
    }
    return {
      data: {
        ...data,
        _rdxEnvelope: parsed
      },
      ok: parsed.ok,
      error: parsed.ok ? void 0 : readErrorMessage(parsed.error)
    };
  }
  return { data: parsed };
};
class RdxShellActionService {
  async runAction(actionId, variables = {}, options = {}) {
    const action = settingsService.getAll().tooling.rdxActions[actionId];
    if (!isActionConfigured(action)) {
      const message = `RDX action "${actionId}" is not configured.`;
      runtimeLogService.log({
        scope: "app",
        namespace: "context",
        severity: "error",
        title: "RDX action unavailable",
        summary: message,
        raw: { actionId }
      });
      return {
        ok: false,
        actionId,
        data: {},
        stdout: "",
        stderr: message,
        exitCode: 2,
        error: message
      };
    }
    const paths = appPathService.getWorkspacePaths();
    const resolvedVariables = {
      workspaceRoot: paths.workspaceRoot,
      logsPath: paths.logsPath,
      projectsPath: paths.projectsPath,
      knowledgePath: paths.knowledgePath,
      ...variables
    };
    const args = action.args.map((arg) => substitute(arg, resolvedVariables));
    const env = Object.fromEntries(
      Object.entries({
        ...action.env,
        ...options.env
      }).map(([key, value]) => [key, substitute(value, resolvedVariables)])
    );
    const command = substitute(action.command, resolvedVariables);
    const invocation = resolveRdxBatchInvocation(command, args);
    const result = await shellInvocationService.invoke({
      command: invocation.command,
      args: invocation.args,
      cwd: action.workingDirectory ? substitute(action.workingDirectory, resolvedVariables) : void 0,
      env,
      timeoutMs: action.timeoutMs,
      abortSignal: options.abortSignal
    });
    let data = {};
    let payloadOk;
    let payloadError;
    let parseError;
    if (result.stdout.trim()) {
      try {
        const parsedPayload = parseJsonPayload(result.stdout);
        data = parsedPayload.data;
        payloadOk = parsedPayload.ok;
        payloadError = parsedPayload.error;
      } catch (error2) {
        parseError = error2 instanceof Error ? error2.message : String(error2);
      }
    }
    const ok = result.exitCode === 0 && !parseError && payloadOk !== false;
    const error = ok ? void 0 : parseError ?? payloadError ?? (result.stderr.trim() || result.stdout.trim() || `RDX action "${actionId}" exited with ${result.exitCode}.`);
    runtimeLogService.log({
      scope: "app",
      namespace: "context",
      severity: ok ? "success" : "error",
      title: ok ? `RDX action ${actionId}` : `RDX action ${actionId} failed`,
      summary: ok ? "Action completed." : error ?? "Action failed.",
      raw: {
        actionId,
        command: action.command,
        args,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr
      }
    });
    return {
      ok,
      actionId,
      data,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      error
    };
  }
}
function isActionConfigured(action) {
  return Boolean(action?.enabled && action.command.trim());
}
const rdxShellActionService = new RdxShellActionService();
function readJsonl(filePath) {
  try {
    if (!fs__namespace.existsSync(filePath)) {
      return [];
    }
    const content = fs__namespace.readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n");
    const results = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        results.push(JSON.parse(trimmed));
      } catch {
        continue;
      }
    }
    return results;
  } catch (error) {
    console.error(`Failed to read JSONL file: ${filePath}`, error);
    return [];
  }
}
function appendJsonl(filePath, data) {
  try {
    const dir = path__namespace.dirname(filePath);
    if (!fs__namespace.existsSync(dir)) {
      fs__namespace.mkdirSync(dir, { recursive: true });
    }
    const serialized = JSON.stringify(data, null, 0);
    if (fs__namespace.existsSync(filePath)) {
      const existing = fs__namespace.readFileSync(filePath, "utf-8");
      if (existing && !existing.endsWith("\n")) {
        fs__namespace.appendFileSync(filePath, "\n", "utf-8");
      }
    }
    fs__namespace.appendFileSync(filePath, `${serialized}
`, "utf-8");
    return true;
  } catch (error) {
    console.error(`Failed to append to JSONL file: ${filePath}`, error);
    return false;
  }
}
function writeJsonl(filePath, items) {
  try {
    const dir = path__namespace.dirname(filePath);
    if (!fs__namespace.existsSync(dir)) {
      fs__namespace.mkdirSync(dir, { recursive: true });
    }
    const lines = items.map((item) => JSON.stringify(item, null, 0));
    fs__namespace.writeFileSync(filePath, `${lines.join("\n")}
`, "utf-8");
    return true;
  } catch (error) {
    console.error(`Failed to write JSONL file: ${filePath}`, error);
    return false;
  }
}
function readYaml(filePath) {
  try {
    if (!fs__namespace.existsSync(filePath)) {
      return null;
    }
    const content = fs__namespace.readFileSync(filePath, "utf-8");
    return YAML.parse(content);
  } catch (error) {
    console.error(`Failed to read YAML file: ${filePath}`, error);
    return null;
  }
}
function writeYaml(filePath, data) {
  try {
    const dir = path__namespace.dirname(filePath);
    if (!fs__namespace.existsSync(dir)) {
      fs__namespace.mkdirSync(dir, { recursive: true });
    }
    const content = YAML.stringify(data, {
      indent: 2,
      lineWidth: 0,
      defaultStringType: "QUOTE_DOUBLE",
      defaultKeyType: "PLAIN"
    });
    fs__namespace.writeFileSync(filePath, content, "utf-8");
    return true;
  } catch (error) {
    console.error(`Failed to write YAML file: ${filePath}`, error);
    return false;
  }
}
class StorageAdapter {
  dataRootPath = "";
  projectsRootPath = "";
  globalKnowledgePath = "";
  migrationOrphansPath = "";
  registryPath = "";
  selectionPath = "";
  constructor() {
    this.syncWorkspacePaths();
  }
  getWorkspacePath() {
    this.syncWorkspacePaths();
    return this.dataRootPath;
  }
  getGlobalKnowledgePath() {
    this.syncWorkspacePaths();
    return this.globalKnowledgePath;
  }
  async initializeWorkspace() {
    this.syncWorkspacePaths();
    this.ensureDir(this.dataRootPath);
    this.ensureDir(this.projectsRootPath);
    this.ensureDir(this.migrationOrphansPath);
    this.ensureRegistry();
    this.ensureSelection();
    this.bootstrapGlobalKnowledge();
  }
  setWorkspaceRoot(workspaceRoot) {
    appPathService.setWorkspaceRoot(workspaceRoot);
    this.syncWorkspacePaths();
  }
  listProjects() {
    return this.readRegistry().projects.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  }
  createProject(rootPath) {
    const normalizedRootPath = path__namespace.resolve(rootPath);
    if (!fs__namespace.existsSync(normalizedRootPath) || !fs__namespace.statSync(normalizedRootPath).isDirectory()) {
      throw new Error(`Project root is not a directory: ${normalizedRootPath}`);
    }
    const registry = this.readRegistry();
    const existing = registry.projects.find((project2) => project2.rootPath === normalizedRootPath);
    if (existing) {
      this.setCurrentProjectId(existing.projectId);
      return existing;
    }
    const projectName = path__namespace.basename(normalizedRootPath) || normalizedRootPath;
    const slug = this.createUniqueProjectSlug(projectName, registry.projects);
    const { resourcePath, knowledgePath, inputsPath } = this.ensureProjectResourceLayout(normalizedRootPath);
    const inputs = this.collectProjectInputs(inputsPath);
    const timestamp = nowMs();
    const project = {
      projectId: `proj_${generateShortId()}`,
      name: projectName,
      rootPath: normalizedRootPath,
      slug,
      resourcePath,
      knowledgePath,
      inputsPath,
      inputs,
      inputsUpdatedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    registry.projects.push(project);
    this.writeRegistry(registry);
    this.ensureDir(this.getProjectDataPath(project));
    this.ensureDir(this.getProjectSessionsRoot(project));
    this.writeProjectMetadata(project);
    this.setCurrentProjectId(project.projectId);
    return project;
  }
  renameProject(projectId, newName) {
    const registry = this.readRegistry();
    const target = registry.projects.find((project) => project.projectId === projectId);
    if (!target) {
      throw new Error(`Project not found: ${projectId}`);
    }
    target.name = newName;
    target.updatedAt = nowMs();
    this.writeRegistry(registry);
    this.writeProjectMetadata(target);
    return target;
  }
  removeProject(projectId) {
    const registry = this.readRegistry();
    const target = registry.projects.find((project) => project.projectId === projectId);
    if (!target) return;
    registry.projects = registry.projects.filter((project) => project.projectId !== projectId);
    this.writeRegistry(registry);
    const projectPath = this.getProjectDataPath(target);
    if (fs__namespace.existsSync(projectPath)) {
      fs__namespace.rmSync(projectPath, { recursive: true, force: true });
    }
    const selection = this.readSelection();
    if (selection.projectId === projectId) {
      selection.projectId = null;
      selection.sessionId = null;
      this.writeSelection(selection);
    }
  }
  removeSession(sessionId) {
    const location = this.findSessionLocation(sessionId);
    if (!location) return;
    if (fs__namespace.existsSync(location.sessionPath)) {
      fs__namespace.rmSync(location.sessionPath, { recursive: true, force: true });
    }
    const selection = this.readSelection();
    if (selection.sessionId === sessionId) {
      selection.sessionId = null;
      this.writeSelection(selection);
    }
    const projectId = location.project.projectId;
    const wasLastSession = location.project.lastSessionId === sessionId;
    if (wasLastSession) {
      const remaining = this.listSessions(projectId);
      this.touchProject(projectId, remaining[0]?.sessionId ?? null);
    } else {
      this.touchProject(projectId);
    }
  }
  getProjectById(projectId) {
    return this.readRegistry().projects.find((project) => project.projectId === projectId) || null;
  }
  listProjectInputs(projectId) {
    const project = this.getProjectById(projectId);
    if (!project) return [];
    return this.refreshProjectInputs(projectId);
  }
  refreshProjectInputs(projectId) {
    const project = this.getProjectById(projectId);
    if (!project) return [];
    const normalizedProject = this.normalizeProjectRecord(project);
    const inputs = this.collectProjectInputs(normalizedProject.inputsPath);
    const nextProject = {
      ...normalizedProject,
      inputs,
      inputsUpdatedAt: nowMs()
    };
    this.persistProject(nextProject);
    return nextProject.inputs;
  }
  importProjectInputs(projectId, filePaths) {
    const project = this.getProjectById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    const normalizedProject = this.normalizeProjectRecord(project);
    this.ensureDir(normalizedProject.inputsPath);
    for (const filePath of filePaths) {
      const sourcePath = path__namespace.resolve(filePath);
      if (!fs__namespace.existsSync(sourcePath) || !fs__namespace.statSync(sourcePath).isFile()) {
        continue;
      }
      if (path__namespace.extname(sourcePath).toLowerCase() !== ".rdc") {
        continue;
      }
      const targetPath = this.resolveImportedInputPath(normalizedProject.inputsPath, path__namespace.basename(sourcePath));
      fs__namespace.copyFileSync(sourcePath, targetPath);
    }
    return this.refreshProjectInputs(projectId);
  }
  listSessions(projectId) {
    const project = this.getProjectById(projectId);
    if (!project) return [];
    return this.reconcileProjectSessionTitles(project).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  createSession(projectId, title, goal = "") {
    const project = this.getProjectById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    const timestamp = nowMs();
    const session = {
      sessionId: `sess_${generateShortId()}`,
      projectId,
      title: this.normalizeSessionTitle(projectId, title),
      goal,
      sessionPath: "",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const sessionPath = path__namespace.join(this.ensureProjectSessionsRoot(project), session.sessionId);
    session.sessionPath = sessionPath;
    this.ensureDir(sessionPath);
    this.ensureDir(path__namespace.join(sessionPath, "attachments"));
    this.ensureDir(path__namespace.join(sessionPath, "timeline"));
    this.ensureDir(path__namespace.join(sessionPath, "runs"));
    this.writeJson(path__namespace.join(sessionPath, "session.json"), session);
    if (!fs__namespace.existsSync(path__namespace.join(sessionPath, "action_chain.jsonl"))) {
      fs__namespace.writeFileSync(path__namespace.join(sessionPath, "action_chain.jsonl"), "", "utf-8");
    }
    if (!fs__namespace.existsSync(path__namespace.join(sessionPath, "conversation.jsonl"))) {
      fs__namespace.writeFileSync(path__namespace.join(sessionPath, "conversation.jsonl"), "", "utf-8");
    }
    if (!fs__namespace.existsSync(path__namespace.join(sessionPath, "attachments.json"))) {
      this.writeJson(path__namespace.join(sessionPath, "attachments.json"), []);
    }
    this.syncSessionEvidence(session.sessionId, session.projectId);
    this.touchProject(project.projectId, session.sessionId, timestamp);
    this.setCurrentProjectId(projectId);
    this.setCurrentSessionId(session.sessionId);
    return session;
  }
  readSession(sessionId) {
    const location = this.findSessionLocation(sessionId);
    if (!location) return null;
    const sessions = this.reconcileProjectSessionTitles(location.project);
    return sessions.find((session) => session.sessionId === sessionId) ?? null;
  }
  updateSession(sessionId, patch) {
    const location = this.findSessionLocation(sessionId);
    if (!location) return null;
    const existing = this.readJson(path__namespace.join(location.sessionPath, "session.json"));
    if (!existing) return null;
    const nextSession = {
      ...this.normalizeSessionRecord(existing, location.sessionPath),
      ...patch,
      sessionId: existing.sessionId,
      projectId: existing.projectId,
      sessionPath: location.sessionPath,
      updatedAt: nowMs()
    };
    this.writeJson(path__namespace.join(location.sessionPath, "session.json"), nextSession);
    this.touchProject(existing.projectId, nextSession.sessionId, nextSession.updatedAt);
    return nextSession;
  }
  listRuns(sessionId) {
    const location = this.findSessionLocation(sessionId);
    if (!location) return [];
    const runsRoot = path__namespace.join(location.sessionPath, "runs");
    if (!fs__namespace.existsSync(runsRoot)) {
      return [];
    }
    return fs__namespace.readdirSync(runsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => this.readPersistedRun(sessionId, entry.name)).filter((run) => run !== null).sort((a, b) => b.startedAt - a.startedAt).map((run) => this.toRunSummary(run));
  }
  getLatestRun(sessionId) {
    return this.listRuns(sessionId)[0] ?? null;
  }
  getCasePath(caseId) {
    const location = this.findSessionLocation(caseId);
    if (!location) {
      throw new Error(`Session not found for case lookup: ${caseId}`);
    }
    return location.sessionPath;
  }
  getRunPath(caseId, runId) {
    const location = this.findSessionLocation(caseId);
    if (!location) {
      throw new Error(`Session not found for run lookup: ${caseId}`);
    }
    return path__namespace.join(location.sessionPath, "runs", runId);
  }
  async createCase(input) {
    const projectId = input.projectId || this.getCurrentProjectId();
    if (!projectId) {
      throw new Error("Project is required before creating a session.");
    }
    if (input.caseId) {
      const existingSession = this.readSession(input.caseId);
      if (existingSession) {
        return existingSession.sessionId;
      }
    }
    const session = this.createSession(
      projectId,
      input.userGoal || input.symptomSummary,
      input.userGoal || input.symptomSummary
    );
    return session.sessionId;
  }
  async readCase(caseId) {
    const session = this.readSession(caseId);
    if (!session) return null;
    return {
      case_id: session.sessionId,
      project_id: session.projectId,
      title: session.title,
      user_goal: session.goal,
      current_run: session.lastRunId ?? null,
      created_at: new Date(session.createdAt).toISOString(),
      updated_at: new Date(session.updatedAt).toISOString()
    };
  }
  async updateCase(caseId, data) {
    const title = typeof data.title === "string" ? data.title : typeof data.symptom_summary === "string" ? data.symptom_summary : void 0;
    const goal = typeof data.user_goal === "string" ? data.user_goal : void 0;
    const lastRunId = typeof data.current_run === "string" ? data.current_run : void 0;
    this.updateSession(caseId, {
      title,
      goal,
      lastRunId
    });
  }
  async createRun(input) {
    const sessionId = input.sessionId || input.caseId;
    const session = this.readSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const runId = input.runId || generateRunId();
    const runPath = this.getRunPath(sessionId, runId);
    this.ensureDir(runPath);
    this.ensureDir(path__namespace.join(runPath, "artifacts"));
    this.ensureDir(path__namespace.join(runPath, "notes"));
    this.ensureDir(path__namespace.join(runPath, "reports"));
    this.ensureDir(path__namespace.join(runPath, "logs"));
    this.ensureDir(path__namespace.join(runPath, "screenshots"));
    this.ensureDir(path__namespace.join(runPath, "checkpoints"));
    const captures = input.captures ? input.captures : input.capturePaths.map((filePath, index) => ({
      id: `cap-${index}`,
      filePath,
      role: index === 0 ? "primary" : "reference",
      backendHint: "local",
      status: "pending"
    }));
    const backend = input.backend || (captures.some((capture) => capture.backendHint === "remote") ? "remote" : "local");
    const startedAt = nowMs();
    const persistedRun = {
      runId,
      turnId: input.turnId,
      projectId: session.projectId,
      sessionId,
      caseId: sessionId,
      mode: input.mode || "debugger",
      goal: input.goal || session.goal,
      captures,
      startedAt,
      status: input.status || "queued",
      lastStage: "preflight",
      backend,
      createdAt: startedAt,
      updatedAt: startedAt,
      runtime: {
        backend,
        entry_mode: "cli",
        context_id: null,
        runtime_owner: null,
        session_id: sessionId,
        workflow_stage: "preflight"
      }
    };
    this.writeRunFiles(persistedRun);
    writeYaml(path__namespace.join(runPath, "capture_refs.yaml"), {
      captures: captures.map((capture, index) => ({
        capture_id: capture.id || `cap-${index}`,
        capture_role: capture.role,
        source_path: capture.filePath
      }))
    });
    writeYaml(path__namespace.join(runPath, "notes", "hypothesis_board.yaml"), {
      hypothesis_board: {
        session_id: sessionId,
        entry_skill: "debugger",
        user_goal: persistedRun.goal,
        intake_state: "handoff_ready",
        current_phase: "intake",
        current_task: "",
        active_owner: "debugger",
        pending_requirements: [],
        blocking_issues: [],
        progress_summary: ["accepted intake complete"],
        next_actions: ["run dispatch_readiness before specialist dispatch"],
        last_updated: nowIso$1(),
        hypotheses: []
      }
    });
    this.updateSession(sessionId, {
      goal: persistedRun.goal,
      lastRunId: runId
    });
    this.syncSessionEvidence(sessionId, session.projectId);
    this.touchProject(session.projectId, sessionId);
    this.setCurrentProjectId(session.projectId);
    this.setCurrentSessionId(sessionId);
    return { runId, sessionId };
  }
  async readRun(caseId, runId) {
    const run = this.readPersistedRun(caseId, runId);
    return run ? run : null;
  }
  async updateRun(caseId, runId, data) {
    const existing = this.readPersistedRun(caseId, runId);
    if (!existing) {
      return;
    }
    const merged = this.deepMerge(
      existing,
      data
    );
    const workflowStage = merged.runtime?.workflow_stage || existing.runtime.workflow_stage;
    merged.runtime = {
      ...existing.runtime,
      ...merged.runtime || {},
      workflow_stage: workflowStage
    };
    merged.lastStage = workflowStage;
    merged.updatedAt = nowMs();
    if (workflowStage === "finalize" && merged.status === "running") {
      merged.status = "completed";
      merged.finishedAt = merged.finishedAt || merged.updatedAt;
    }
    this.writeRunFiles(merged);
    this.updateSession(caseId, {
      lastRunId: runId
    });
    this.syncSessionEvidence(caseId, existing.projectId);
  }
  async writeArtifact(caseId, runId, artifactName, data) {
    const artifactPath = path__namespace.join(this.getRunPath(caseId, runId), "artifacts", artifactName);
    writeYaml(artifactPath, data);
    return artifactPath;
  }
  async readArtifact(caseId, runId, artifactName) {
    const artifactPath = path__namespace.join(this.getRunPath(caseId, runId), "artifacts", artifactName);
    return readYaml(artifactPath);
  }
  getActionChainPath(sessionId) {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for action chain: ${sessionId}`);
    }
    return path__namespace.join(location.sessionPath, "action_chain.jsonl");
  }
  getConversationPath(sessionId) {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for conversation history: ${sessionId}`);
    }
    return path__namespace.join(location.sessionPath, "conversation.jsonl");
  }
  getConversationBranchStatePath(sessionId) {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for conversation branches: ${sessionId}`);
    }
    return path__namespace.join(location.sessionPath, "conversation-branches.json");
  }
  readConversationBranchState(sessionId) {
    const filePath = this.getConversationBranchStatePath(sessionId);
    if (!fs__namespace.existsSync(filePath)) {
      return null;
    }
    return this.readJson(filePath);
  }
  writeConversationBranchState(sessionId, state2) {
    this.writeJson(this.getConversationBranchStatePath(sessionId), state2);
  }
  getSessionAttachmentsDir(sessionId) {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for attachments: ${sessionId}`);
    }
    const attachmentsDir = path__namespace.join(location.sessionPath, "attachments");
    this.ensureDir(attachmentsDir);
    return attachmentsDir;
  }
  getSessionAttachmentsManifestPath(sessionId) {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for attachment manifest: ${sessionId}`);
    }
    return path__namespace.join(location.sessionPath, "attachments.json");
  }
  getSessionEvidencePath(sessionId) {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for session evidence: ${sessionId}`);
    }
    return path__namespace.join(location.sessionPath, "session_evidence.yaml");
  }
  writeSessionPlanArtifact(sessionId, content) {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for plan artifact: ${sessionId}`);
    }
    const artifactsDir = path__namespace.join(location.sessionPath, "artifacts");
    this.ensureDir(artifactsDir);
    const artifactPath = path__namespace.join(artifactsDir, "plan.md");
    fs__namespace.writeFileSync(artifactPath, content, "utf8");
    return artifactPath;
  }
  /**
   * Agent 线程持久化目录：`{sessionPath}/agent-threads/`。
   *
   * Agent 线程保存完整 AgentMessage（含 toolCall/toolResult/usage/stopReason），
   * 作为长生命周期 Agent 跨轮记忆与 session 续接的真实上下文来源。
   * 与 conversation.jsonl（UI 投影源）并存，互不替代。
   */
  getAgentThreadPath(sessionId, agentId) {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for agent thread: ${sessionId}`);
    }
    const threadsDir = path__namespace.join(location.sessionPath, "agent-threads");
    this.ensureDir(threadsDir);
    const safeAgentId = agentId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path__namespace.join(threadsDir, `${safeAgentId}.jsonl`);
  }
  readAgentThread(sessionId, agentId) {
    const threadPath = this.getAgentThreadPath(sessionId, agentId);
    if (!fs__namespace.existsSync(threadPath)) {
      return [];
    }
    return readJsonl(threadPath);
  }
  writeAgentThread(sessionId, agentId, messages) {
    writeJsonl(this.getAgentThreadPath(sessionId, agentId), messages);
  }
  clearAgentThread(sessionId, agentId) {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      return;
    }
    const threadsDir = path__namespace.join(location.sessionPath, "agent-threads");
    if (!fs__namespace.existsSync(threadsDir)) {
      return;
    }
    if (agentId) {
      const safeAgentId = agentId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const threadPath = path__namespace.join(threadsDir, `${safeAgentId}.jsonl`);
      if (fs__namespace.existsSync(threadPath)) {
        fs__namespace.unlinkSync(threadPath);
      }
      return;
    }
    for (const entry of fs__namespace.readdirSync(threadsDir)) {
      if (entry.endsWith(".jsonl")) {
        fs__namespace.unlinkSync(path__namespace.join(threadsDir, entry));
      }
    }
  }
  readConversationHistory(sessionId) {
    const snapshots = readJsonl(this.getConversationPath(sessionId));
    const latestById = /* @__PURE__ */ new Map();
    for (const snapshot of snapshots) {
      const existing = latestById.get(snapshot.id);
      const existingUpdatedAt = existing?.updatedAt ?? existing?.createdAt ?? 0;
      const nextUpdatedAt = snapshot.updatedAt ?? snapshot.createdAt;
      if (!existing || nextUpdatedAt >= existingUpdatedAt) {
        latestById.set(snapshot.id, snapshot);
      }
    }
    return Array.from(latestById.values()).sort((left, right) => left.createdAt - right.createdAt);
  }
  appendConversationMessage(sessionId, message) {
    appendJsonl(this.getConversationPath(sessionId), message);
  }
  writeConversationHistory(sessionId, messages) {
    writeJsonl(this.getConversationPath(sessionId), messages);
    this.updateSession(sessionId, {});
  }
  listSessionAttachments(sessionId) {
    return this.readSessionAttachments(sessionId).slice().sort((left, right) => left.createdAt - right.createdAt);
  }
  importSessionAttachments(sessionId, filePaths) {
    const session = this.readSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const attachmentsDir = this.getSessionAttachmentsDir(sessionId);
    const existing = this.readSessionAttachments(sessionId);
    const imported = [];
    for (const filePath of filePaths) {
      const sourcePath = path__namespace.resolve(filePath);
      if (!fs__namespace.existsSync(sourcePath) || !fs__namespace.statSync(sourcePath).isFile()) {
        continue;
      }
      const targetPath = this.resolveImportedFilePath(attachmentsDir, path__namespace.basename(sourcePath));
      fs__namespace.copyFileSync(sourcePath, targetPath);
      const stats = fs__namespace.statSync(targetPath);
      imported.push({
        attachmentId: `att_${generateShortId()}`,
        sessionId,
        projectId: session.projectId,
        kind: this.inferAttachmentKind(targetPath),
        fileName: path__namespace.basename(targetPath),
        filePath: targetPath,
        mimeType: this.inferMimeType(targetPath),
        size: stats.size,
        createdAt: stats.birthtimeMs || stats.ctimeMs || nowMs()
      });
    }
    if (imported.length > 0) {
      this.writeSessionAttachments(sessionId, existing.concat(imported));
      this.touchProject(session.projectId, session.sessionId);
    }
    return imported;
  }
  readSessionEvidence(sessionId) {
    return readYaml(this.getSessionEvidencePath(sessionId));
  }
  async appendActionEvent(sessionId, event) {
    appendJsonl(this.getActionChainPath(sessionId), event);
    this.updateSession(sessionId, {});
    const session = this.readSession(sessionId);
    if (session) {
      this.syncSessionEvidence(sessionId, session.projectId);
    }
  }
  async readActionChain(sessionId) {
    const actionChainPath = this.getActionChainPath(sessionId);
    return readJsonl(actionChainPath);
  }
  createActionEvent(input) {
    return {
      schema_version: "2",
      event_id: generateEventId("evt"),
      turn_id: input.turnId,
      ts_ms: nowMs(),
      run_id: input.runId,
      session_id: input.sessionId,
      agent_id: input.agentId,
      event_type: input.eventType,
      status: input.status,
      duration_ms: 0,
      refs: input.refs || [],
      payload: input.payload
    };
  }
  async getWorkflowState(caseId, runId) {
    const run = this.readPersistedRun(caseId, runId);
    if (!run) return null;
    return {
      caseId,
      runId,
      sessionId: run.sessionId,
      currentStage: run.runtime.workflow_stage,
      previousStages: [],
      entryMode: run.runtime.entry_mode,
      backend: run.runtime.backend,
      orchestrationMode: "multi_agent",
      coordinationMode: "staged_handoff",
      blockers: [],
      lastUpdated: new Date(run.updatedAt).toISOString()
    };
  }
  async updateWorkflowStage(caseId, runId, stage, blockers = []) {
    const run = this.readPersistedRun(caseId, runId);
    if (!run) return;
    run.runtime.workflow_stage = stage;
    run.lastStage = stage;
    run.updatedAt = nowMs();
    if (stage === "finalize") {
      run.status = "completed";
      run.finishedAt = run.finishedAt || run.updatedAt;
    }
    this.writeRunFiles(run);
    if (blockers.length > 0) {
      const boardPath = path__namespace.join(this.getRunPath(caseId, runId), "notes", "hypothesis_board.yaml");
      const board = readYaml(boardPath) || {};
      const hypothesisBoard = board.hypothesis_board || {};
      hypothesisBoard.blocking_issues = blockers;
      hypothesisBoard.last_updated = nowIso$1();
      board.hypothesis_board = hypothesisBoard;
      writeYaml(boardPath, board);
    }
  }
  getCurrentProjectId() {
    return this.readSelection().projectId;
  }
  setCurrentProjectId(projectId) {
    const selection = this.readSelection();
    selection.projectId = projectId;
    if (!projectId) {
      selection.sessionId = null;
    } else if (selection.sessionId) {
      const selectedSession = this.readSession(selection.sessionId);
      if (!selectedSession || selectedSession.projectId !== projectId) {
        selection.sessionId = null;
      }
    }
    this.writeSelection(selection);
  }
  async getCurrentSessionId() {
    return this.readSelection().sessionId;
  }
  async setCurrentSessionId(sessionId) {
    const selection = this.readSelection();
    selection.sessionId = sessionId;
    if (sessionId) {
      const session = this.readSession(sessionId);
      if (session) {
        selection.projectId = session.projectId;
      }
    }
    this.writeSelection(selection);
  }
  syncSessionEvidence(sessionId, projectId) {
    const latestRun = this.getLatestRun(sessionId);
    const actionEvents = fs__namespace.existsSync(this.getActionChainPath(sessionId)) ? readJsonl(this.getActionChainPath(sessionId)) : [];
    const eventCounts = actionEvents.reduce((acc, event) => {
      acc[event.event_type] = (acc[event.event_type] || 0) + 1;
      return acc;
    }, {});
    const activeBlockers = actionEvents.filter((event) => event.event_type === "blocker").map((event) => ({
      code: String(event.payload.code || "BLOCKER"),
      reason: String(event.payload.reason || event.payload.message || "Blocker"),
      refs: Array.isArray(event.refs) ? event.refs : [],
      detectedAt: new Date(event.ts_ms).toISOString()
    }));
    const verificationSummary = actionEvents.filter((event) => event.event_type === "verification").slice(-5).map((event) => String(event.payload.summary || event.payload.verdict || event.payload.verification_kind || "verification"));
    const reasoningSummaries = actionEvents.filter((event) => event.event_type === "agent_summary").slice(-10).map((event, index) => ({
      summaryId: `summary-${index}-${event.event_id}`,
      stage: normalizeWorkflowStage(String(event.payload.stage || latestRun?.lastStage || "investigate")),
      agentId: String(event.agent_id),
      summary: String(event.payload.summary || event.payload.content || ""),
      evidence: Array.isArray(event.payload.evidence) ? event.payload.evidence.map(String) : [],
      nextStep: String(event.payload.next_step || event.payload.nextStep || ""),
      confidence: typeof event.payload.confidence === "number" ? event.payload.confidence : 0.5,
      createdAt: new Date(event.ts_ms).toISOString()
    }));
    const record = {
      schema_version: "1",
      session_id: sessionId,
      project_id: projectId,
      latest_run_id: latestRun?.runId || null,
      latest_run_status: latestRun?.status || null,
      latest_stage: latestRun?.lastStage || null,
      updated_at: nowIso$1(),
      event_counts: eventCounts,
      active_blockers: activeBlockers,
      verification_summary: verificationSummary,
      reasoning_summaries: reasoningSummaries,
      report_paths: latestRun?.reportPaths || null
    };
    writeYaml(this.getSessionEvidencePath(sessionId), record);
  }
  bootstrapGlobalKnowledge() {
    this.syncWorkspacePaths();
    this.ensureDir(this.globalKnowledgePath);
    this.ensureDir(path__namespace.join(this.globalKnowledgePath, "library"));
    this.ensureDir(path__namespace.join(this.globalKnowledgePath, "spec"));
    const seededMarker = path__namespace.join(this.globalKnowledgePath, ".seeded");
    if (fs__namespace.existsSync(seededMarker)) {
      return;
    }
    const seedPath = path__namespace.join(electron.app.getAppPath(), "resources", "knowledge", "seed");
    if (fs__namespace.existsSync(seedPath)) {
      this.copyDirectoryContents(seedPath, this.globalKnowledgePath, false);
    }
    fs__namespace.writeFileSync(seededMarker, nowIso$1(), "utf-8");
  }
  syncWorkspacePaths() {
    const paths = appPathService.getWorkspacePaths();
    this.dataRootPath = paths.workspaceRoot;
    this.projectsRootPath = paths.projectsPath;
    this.globalKnowledgePath = paths.knowledgePath;
    this.migrationOrphansPath = paths.migrationOrphansPath;
    this.registryPath = path__namespace.join(this.projectsRootPath, "registry.json");
    this.selectionPath = path__namespace.join(this.projectsRootPath, "selection.json");
  }
  ensureRegistry() {
    if (fs__namespace.existsSync(this.registryPath)) {
      return;
    }
    this.writeJson(this.registryPath, {
      schemaVersion: "1",
      projects: []
    });
  }
  ensureSelection() {
    if (fs__namespace.existsSync(this.selectionPath)) {
      return;
    }
    this.writeJson(this.selectionPath, {
      projectId: null,
      sessionId: null
    });
  }
  readRegistry() {
    const registry = this.readJson(this.registryPath) || {
      schemaVersion: "1",
      projects: []
    };
    const normalizedProjects = registry.projects.map((project) => this.normalizeProjectRecord(project));
    const changed = JSON.stringify(normalizedProjects) !== JSON.stringify(registry.projects);
    if (changed) {
      registry.projects = normalizedProjects;
      this.writeRegistry(registry);
    } else {
      registry.projects = normalizedProjects;
    }
    return registry;
  }
  writeRegistry(registry) {
    this.writeJson(this.registryPath, registry);
  }
  readSelection() {
    return this.readJson(this.selectionPath) || {
      projectId: null,
      sessionId: null
    };
  }
  writeSelection(selection) {
    this.writeJson(this.selectionPath, selection);
  }
  writeProjectMetadata(project) {
    const normalizedProject = this.normalizeProjectRecord(project);
    this.ensureDir(this.getProjectDataPath(normalizedProject));
    this.writeJson(path__namespace.join(this.getProjectDataPath(normalizedProject), "project.json"), normalizedProject);
  }
  writeRunFiles(run) {
    const runPath = this.getRunPath(run.sessionId, run.runId);
    this.ensureDir(runPath);
    this.writeJson(path__namespace.join(runPath, "run.json"), run);
    writeYaml(path__namespace.join(runPath, "run.yaml"), {
      run_id: run.runId,
      turn_id: run.turnId,
      session_id: run.sessionId,
      case_id: run.caseId,
      project_id: run.projectId,
      created_at: new Date(run.createdAt).toISOString(),
      updated_at: new Date(run.updatedAt).toISOString(),
      mode: run.mode,
      goal: run.goal,
      status: run.status,
      last_stage: run.lastStage,
      coordination_mode: "staged_handoff",
      orchestration_mode: "multi_agent",
      runtime: run.runtime,
      captures: run.captures
    });
  }
  touchProject(projectId, lastSessionId, updatedAt = nowMs()) {
    const registry = this.readRegistry();
    const nextProjects = registry.projects.map((project2) => {
      if (project2.projectId !== projectId) return project2;
      const nextLastSessionId = lastSessionId === void 0 ? project2.lastSessionId : lastSessionId || void 0;
      return {
        ...project2,
        updatedAt,
        lastSessionId: nextLastSessionId
      };
    });
    registry.projects = nextProjects;
    this.writeRegistry(registry);
    const project = registry.projects.find((item) => item.projectId === projectId);
    if (project) {
      this.writeProjectMetadata(project);
    }
  }
  getProjectDataPath(project) {
    const target = typeof project === "string" ? this.getProjectById(project) : project;
    if (!target) {
      throw new Error(`Project not found: ${project}`);
    }
    return path__namespace.join(this.projectsRootPath, target.slug);
  }
  getProjectSessionsRoot(project) {
    const target = typeof project === "string" ? this.getProjectById(project) : project;
    if (!target) {
      throw new Error(`Project not found: ${project}`);
    }
    return path__namespace.join(target.rootPath, "sessions");
  }
  ensureProjectSessionsRoot(project) {
    const target = typeof project === "string" ? this.getProjectById(project) : project;
    if (!target) {
      throw new Error(`Project not found: ${project}`);
    }
    const sessionsRoot = this.getProjectSessionsRoot(target);
    this.ensureDir(sessionsRoot);
    return sessionsRoot;
  }
  findSessionLocation(sessionId) {
    for (const project of this.listProjects()) {
      const sessionPath = path__namespace.join(this.ensureProjectSessionsRoot(project), sessionId);
      if (fs__namespace.existsSync(path__namespace.join(sessionPath, "session.json"))) {
        return { project, sessionPath };
      }
    }
    return null;
  }
  normalizeSessionRecord(session, sessionPath) {
    const resolvedSessionPath = sessionPath || this.findSessionLocation(session.sessionId)?.sessionPath || session.sessionPath;
    return {
      ...session,
      sessionPath: resolvedSessionPath || ""
    };
  }
  readPersistedRun(sessionId, runId) {
    const runJsonPath = path__namespace.join(this.getRunPath(sessionId, runId), "run.json");
    const runJson = this.readJson(runJsonPath);
    if (runJson) {
      runJson.lastStage = normalizeWorkflowStage(runJson.lastStage);
      runJson.runtime.workflow_stage = normalizeWorkflowStage(runJson.runtime.workflow_stage);
      return runJson;
    }
    const runYaml = readYaml(path__namespace.join(this.getRunPath(sessionId, runId), "run.yaml"));
    if (!runYaml) {
      return null;
    }
    return {
      runId,
      turnId: typeof runYaml.turn_id === "string" ? runYaml.turn_id : void 0,
      projectId: String(runYaml.project_id || ""),
      sessionId,
      caseId: String(runYaml.case_id || sessionId),
      mode: runYaml.mode || "debugger",
      goal: String(runYaml.goal || ""),
      captures: runYaml.captures || [],
      startedAt: Date.parse(String(runYaml.created_at || nowIso$1())),
      finishedAt: runYaml.finished_at ? Date.parse(String(runYaml.finished_at)) : void 0,
      status: runYaml.status || "running",
      lastStage: normalizeWorkflowStage(String(runYaml.last_stage || "preflight")),
      backend: runYaml.runtime?.backend || "local",
      createdAt: Date.parse(String(runYaml.created_at || nowIso$1())),
      updatedAt: Date.parse(String(runYaml.updated_at || runYaml.created_at || nowIso$1())),
      runtime: {
        backend: runYaml.runtime?.backend || "local",
        entry_mode: runYaml.runtime?.entry_mode || "cli",
        context_id: runYaml.runtime?.context_id || null,
        runtime_owner: runYaml.runtime?.runtime_owner || null,
        session_id: String(runYaml.runtime?.session_id || sessionId),
        workflow_stage: normalizeWorkflowStage(runYaml.runtime?.workflow_stage)
      }
    };
  }
  toRunSummary(run) {
    return {
      runId: run.runId,
      turnId: run.turnId,
      projectId: run.projectId,
      sessionId: run.sessionId,
      caseId: run.caseId,
      mode: run.mode,
      goal: run.goal,
      captures: run.captures,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      stoppedAt: run.stoppedAt,
      status: run.status,
      stopReason: run.stopReason,
      lastStage: run.lastStage,
      backend: run.backend,
      reportPaths: run.reportPaths
    };
  }
  normalizeSessionTitle(projectId, title) {
    const normalized = title?.trim();
    if (normalized) {
      return normalized.slice(0, 80);
    }
    const nextIndex = this.getNextDefaultSessionIndex(projectId);
    return `new session ${nextIndex}`;
  }
  getNextDefaultSessionIndex(projectId) {
    const sessions = this.listSessions(projectId);
    const defaultTitlePattern = /^new session (\d+)$/i;
    const usedIndexes = sessions.map((session) => {
      const match = session.title.trim().match(defaultTitlePattern);
      return match ? Number.parseInt(match[1], 10) : null;
    }).filter((value) => value !== null && Number.isInteger(value) && value >= 0);
    if (usedIndexes.length === 0) {
      return 0;
    }
    return Math.max(...usedIndexes) + 1;
  }
  reconcileProjectSessionTitles(project) {
    const storedSessions = this.readProjectSessions(project);
    const normalizedSessions = storedSessions.map(({ session, sessionPath }) => this.normalizeSessionRecord(session, sessionPath));
    const autoGeneratedTitlePattern = /^new session (\d+)$/i;
    const timestampTitlePattern = /^Session \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
    const autoSessions = normalizedSessions.filter((session) => autoGeneratedTitlePattern.test(session.title.trim()) || timestampTitlePattern.test(session.title.trim())).sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        return a.createdAt - b.createdAt;
      }
      return a.sessionId.localeCompare(b.sessionId);
    });
    if (autoSessions.length === 0) {
      return normalizedSessions;
    }
    const nextTitlesBySessionId = /* @__PURE__ */ new Map();
    autoSessions.forEach((session, index) => {
      nextTitlesBySessionId.set(session.sessionId, `new session ${index}`);
    });
    let didRewrite = false;
    const rewrittenBySessionId = /* @__PURE__ */ new Map();
    for (const { sessionPath } of storedSessions) {
      const session = normalizedSessions.find((entry) => entry.sessionPath === sessionPath);
      if (!session) {
        continue;
      }
      const nextTitle = nextTitlesBySessionId.get(session.sessionId);
      if (nextTitle && session.title !== nextTitle) {
        const rewrittenSession = {
          ...session,
          title: nextTitle
        };
        this.writeJson(path__namespace.join(sessionPath, "session.json"), rewrittenSession);
        rewrittenBySessionId.set(session.sessionId, rewrittenSession);
        didRewrite = true;
        continue;
      }
      rewrittenBySessionId.set(session.sessionId, session);
    }
    if (!didRewrite) {
      return normalizedSessions;
    }
    return normalizedSessions.map((session) => rewrittenBySessionId.get(session.sessionId) ?? session);
  }
  readProjectSessions(project) {
    const sessionsRoot = this.ensureProjectSessionsRoot(project);
    if (!fs__namespace.existsSync(sessionsRoot)) {
      return [];
    }
    return fs__namespace.readdirSync(sessionsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
      const sessionPath = path__namespace.join(sessionsRoot, entry.name);
      const session = this.readJson(path__namespace.join(sessionPath, "session.json"));
      return session ? { session, sessionPath } : null;
    }).filter((entry) => entry !== null);
  }
  createUniqueProjectSlug(projectName, existingProjects) {
    const baseSlug = sanitizeToken(projectName.toLowerCase());
    const existingSlugs = new Set(existingProjects.map((project) => project.slug));
    if (!existingSlugs.has(baseSlug)) {
      return baseSlug;
    }
    let counter = 2;
    while (existingSlugs.has(`${baseSlug}-${counter}`)) {
      counter += 1;
    }
    return `${baseSlug}-${counter}`;
  }
  ensureDir(dirPath) {
    if (!fs__namespace.existsSync(dirPath)) {
      fs__namespace.mkdirSync(dirPath, { recursive: true });
    }
  }
  copyDirectoryContents(sourceDir, targetDir, overwrite) {
    if (!fs__namespace.existsSync(sourceDir)) return;
    this.ensureDir(targetDir);
    for (const entry of fs__namespace.readdirSync(sourceDir, { withFileTypes: true })) {
      const sourcePath = path__namespace.join(sourceDir, entry.name);
      const targetPath = path__namespace.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        this.copyDirectoryContents(sourcePath, targetPath, overwrite);
        continue;
      }
      if (!overwrite && fs__namespace.existsSync(targetPath)) {
        continue;
      }
      this.ensureDir(path__namespace.dirname(targetPath));
      fs__namespace.copyFileSync(sourcePath, targetPath);
    }
  }
  readJson(filePath) {
    try {
      if (!fs__namespace.existsSync(filePath)) {
        return null;
      }
      return JSON.parse(fs__namespace.readFileSync(filePath, "utf-8"));
    } catch (error) {
      console.error(`Failed to read JSON file: ${filePath}`, error);
      return null;
    }
  }
  writeJson(filePath, data) {
    this.ensureDir(path__namespace.dirname(filePath));
    fs__namespace.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  }
  deepMerge(base, patch) {
    const output = { ...base };
    for (const [key, value] of Object.entries(patch)) {
      if (Array.isArray(value)) {
        output[key] = value;
        continue;
      }
      if (value && typeof value === "object") {
        const existingValue = output[key];
        output[key] = this.deepMerge(
          existingValue && typeof existingValue === "object" && !Array.isArray(existingValue) ? existingValue : {},
          value
        );
        continue;
      }
      output[key] = value;
    }
    return output;
  }
  persistProject(project) {
    const registry = this.readRegistry();
    registry.projects = registry.projects.map((entry) => entry.projectId === project.projectId ? project : entry);
    this.writeRegistry(registry);
    this.writeProjectMetadata(project);
  }
  buildProjectPaths(rootPath) {
    const resourcePath = path__namespace.join(rootPath, ".resource");
    return {
      resourcePath,
      knowledgePath: path__namespace.join(resourcePath, "knowledge"),
      inputsPath: path__namespace.join(resourcePath, "inputs")
    };
  }
  ensureProjectResourceLayout(rootPath) {
    const paths = this.buildProjectPaths(rootPath);
    this.ensureDir(paths.resourcePath);
    this.ensureDir(paths.knowledgePath);
    this.ensureDir(paths.inputsPath);
    return paths;
  }
  normalizeProjectRecord(project) {
    const rootPath = path__namespace.resolve(project.rootPath);
    const { resourcePath, knowledgePath, inputsPath } = this.ensureProjectResourceLayout(rootPath);
    const inputs = this.collectProjectInputs(inputsPath);
    return {
      ...project,
      rootPath,
      resourcePath,
      knowledgePath,
      inputsPath,
      inputs,
      inputsUpdatedAt: project.inputsUpdatedAt || nowMs()
    };
  }
  collectProjectInputs(inputsPath) {
    if (!fs__namespace.existsSync(inputsPath)) {
      return [];
    }
    const records = [];
    const walk2 = (dirPath) => {
      for (const entry of fs__namespace.readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = path__namespace.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          walk2(fullPath);
          continue;
        }
        if (path__namespace.extname(entry.name).toLowerCase() !== ".rdc") {
          continue;
        }
        const stats = fs__namespace.statSync(fullPath);
        records.push({
          inputId: this.createProjectInputId(inputsPath, fullPath),
          fileName: path__namespace.basename(fullPath),
          filePath: fullPath,
          source: "project_resource",
          discoveredAt: stats.birthtimeMs || stats.ctimeMs || stats.mtimeMs,
          lastModifiedAt: stats.mtimeMs,
          size: stats.size
        });
      }
    };
    walk2(inputsPath);
    return records.sort((a, b) => a.fileName.localeCompare(b.fileName));
  }
  createProjectInputId(inputsPath, filePath) {
    const relativePath = path__namespace.relative(inputsPath, filePath).replace(/[\\/]+/g, "_");
    const sanitized = sanitizeToken(relativePath.toLowerCase().replace(/\.rdc$/i, ""));
    return `input_${sanitized}`;
  }
  resolveImportedInputPath(inputsPath, fileName) {
    const extension = path__namespace.extname(fileName);
    const baseName = path__namespace.basename(fileName, extension);
    let candidate = path__namespace.join(inputsPath, fileName);
    let counter = 2;
    while (fs__namespace.existsSync(candidate)) {
      candidate = path__namespace.join(inputsPath, `${baseName}-${counter}${extension}`);
      counter += 1;
    }
    return candidate;
  }
  readSessionAttachments(sessionId) {
    return this.readJson(this.getSessionAttachmentsManifestPath(sessionId)) ?? [];
  }
  writeSessionAttachments(sessionId, attachments) {
    this.writeJson(this.getSessionAttachmentsManifestPath(sessionId), attachments);
  }
  resolveImportedFilePath(dirPath, fileName) {
    const extension = path__namespace.extname(fileName);
    const baseName = path__namespace.basename(fileName, extension);
    let candidate = path__namespace.join(dirPath, fileName);
    let counter = 2;
    while (fs__namespace.existsSync(candidate)) {
      candidate = path__namespace.join(dirPath, `${baseName}-${counter}${extension}`);
      counter += 1;
    }
    return candidate;
  }
  inferAttachmentKind(filePath) {
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(filePath) ? "image" : "file";
  }
  inferMimeType(filePath) {
    const extension = path__namespace.extname(filePath).toLowerCase();
    const mimeByExtension = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".bmp": "image/bmp",
      ".svg": "image/svg+xml",
      ".pdf": "application/pdf",
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".json": "application/json",
      ".zip": "application/zip",
      ".7z": "application/x-7z-compressed",
      ".log": "text/plain"
    };
    return mimeByExtension[extension] || "application/octet-stream";
  }
}
const storageAdapter = new StorageAdapter();
const POLL_INTERVAL_MS = 5e3;
const ACTIVATE_TIMEOUT_MS = 9e4;
const PREPARED_REMOTE_TTL_MS = 10 * 60 * 1e3;
const LOCAL_DEVICE = {
  id: "local",
  label: "Local",
  type: "local",
  status: "online",
  transport: "local",
  detailText: "Local replay ready"
};
function sanitizeDeviceId(value) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}
function adbUnavailableMessage() {
  return "adb executable not found. Configure RDX_ANDROID_ADB_PATH or install Android platform-tools.";
}
function candidateAdbPaths() {
  const candidates = [];
  const push = (value) => {
    const trimmed = value?.trim();
    if (trimmed) {
      candidates.push(trimmed);
    }
  };
  push(process.env.RDX_ANDROID_ADB_PATH);
  push(process.env.ADB);
  for (const envName of ["ANDROID_SDK_ROOT", "ANDROID_HOME"]) {
    const root = process.env[envName]?.trim();
    if (!root) {
      continue;
    }
    push(path__namespace.join(root, "platform-tools", "adb.exe"));
    push(path__namespace.join(root, "platform-tools", "adb"));
  }
  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (localAppData) {
    push(path__namespace.join(localAppData, "Android", "Sdk", "platform-tools", "adb.exe"));
  }
  return candidates;
}
function resolveAdbExecutable() {
  for (const candidate of candidateAdbPaths()) {
    if (fs__namespace.existsSync(candidate)) {
      return path__namespace.resolve(candidate);
    }
  }
  for (const entry of (process.env.PATH ?? "").split(path__namespace.delimiter)) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    for (const adbName of ["adb.exe", "adb"]) {
      const candidate = path__namespace.join(trimmed, adbName);
      if (fs__namespace.existsSync(candidate)) {
        return path__namespace.resolve(candidate);
      }
    }
  }
  throw new Error(adbUnavailableMessage());
}
function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function normalizeBoolean(value) {
  return typeof value === "boolean" ? value : void 0;
}
function normalizeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function parseAndroidBootstrapMetadata(payload) {
  if (!payload || typeof payload !== "object") {
    return void 0;
  }
  const record = payload;
  const cleanupActions = Array.isArray(record.cleanup_actions) ? record.cleanup_actions.filter((item) => typeof item === "string") : void 0;
  const metadata = {
    packageName: normalizeString(record.package_name),
    activityName: normalizeString(record.activity_name),
    abi: normalizeString(record.abi),
    apkPath: normalizeString(record.apk_path),
    host: normalizeString(record.host),
    port: normalizeNumber(record.port),
    remotePort: normalizeNumber(record.remote_port),
    forwardSpec: normalizeString(record.forward_spec),
    configRemotePath: normalizeString(record.config_remote_path),
    cleanupActions,
    installedApk: normalizeBoolean(record.installed_apk),
    pushedConfig: normalizeBoolean(record.pushed_config),
    startedActivity: normalizeBoolean(record.started_activity),
    createdForward: normalizeBoolean(record.created_forward),
    installMode: record.install_mode === "upgrade" || record.install_mode === "force_replace" ? record.install_mode : void 0,
    installReason: record.install_reason === "fresh_install" || record.install_reason === "mismatched_existing_apk" || record.install_reason === "version_downgrade" || record.install_reason === "signature_mismatch" ? record.install_reason : void 0,
    uninstalledExisting: normalizeBoolean(record.uninstalled_existing)
  };
  return Object.values(metadata).some((value) => value !== void 0) ? metadata : void 0;
}
function parsePersistedAndroidBootstrapMetadata(payload) {
  if (!payload || typeof payload !== "object") {
    return void 0;
  }
  const record = payload;
  const cleanupActions = Array.isArray(record.cleanupActions) ? record.cleanupActions.filter((item) => typeof item === "string") : void 0;
  const metadata = {
    packageName: normalizeString(record.packageName),
    activityName: normalizeString(record.activityName),
    abi: normalizeString(record.abi),
    apkPath: normalizeString(record.apkPath),
    host: normalizeString(record.host),
    port: normalizeNumber(record.port),
    remotePort: normalizeNumber(record.remotePort),
    forwardSpec: normalizeString(record.forwardSpec),
    configRemotePath: normalizeString(record.configRemotePath),
    cleanupActions,
    installedApk: normalizeBoolean(record.installedApk),
    pushedConfig: normalizeBoolean(record.pushedConfig),
    startedActivity: normalizeBoolean(record.startedActivity),
    createdForward: normalizeBoolean(record.createdForward),
    installMode: record.installMode === "upgrade" || record.installMode === "force_replace" ? record.installMode : void 0,
    installReason: record.installReason === "fresh_install" || record.installReason === "mismatched_existing_apk" || record.installReason === "version_downgrade" || record.installReason === "signature_mismatch" ? record.installReason : void 0,
    uninstalledExisting: normalizeBoolean(record.uninstalledExisting)
  };
  return Object.values(metadata).some((value) => value !== void 0) ? metadata : void 0;
}
function parseResumeCacheRecord(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload;
  const deviceId = normalizeString(record.deviceId);
  const serial = normalizeString(record.serial);
  const label = normalizeString(record.label);
  const transport = record.transport === "local" || record.transport === "adb_android" ? record.transport : void 0;
  const lastValidatedAt = normalizeNumber(record.lastValidatedAt);
  if (!deviceId || !serial || !label || !transport || !lastValidatedAt) {
    return null;
  }
  return {
    deviceId,
    serial,
    label,
    transport,
    lastValidatedAt,
    bootstrap: parsePersistedAndroidBootstrapMetadata(record.bootstrap)
  };
}
function hasBootstrapManagedLaunch(bootstrap) {
  return Boolean(
    bootstrap && (bootstrap.startedActivity || bootstrap.installedApk || bootstrap.installMode || bootstrap.uninstalledExisting)
  );
}
function buildBootstrapDetailText(bootstrap) {
  if (!bootstrap) {
    return [];
  }
  const suffix = [];
  if (bootstrap.installMode === "force_replace") {
    suffix.push("APK force replaced");
  } else if (bootstrap.installedApk && bootstrap.installReason === "fresh_install") {
    suffix.push("APK installed");
  } else if (bootstrap.installedApk) {
    suffix.push("APK upgraded");
  } else if (bootstrap.packageName) {
    suffix.push("APK verified");
  }
  if (bootstrap.abi) {
    suffix.push(bootstrap.abi);
  }
  if (bootstrap.forwardSpec) {
    suffix.push(bootstrap.forwardSpec);
  }
  return suffix;
}
function buildRemoteReadyText(bootstrap) {
  const prefix = hasBootstrapManagedLaunch(bootstrap) ? "Started Android RenderDoc and connected" : "Connected to Android RenderDoc server";
  const suffix = buildBootstrapDetailText(bootstrap);
  return suffix.length > 0 ? `${prefix} 路 ${suffix.join(" 路 ")}` : prefix;
}
function applyActivationFailure(device, phase, message, code) {
  return {
    ...device,
    status: "offline",
    detailText: message,
    lastError: message,
    remoteId: void 0,
    activationPhase: phase,
    activationErrorCode: code,
    activationErrorMessage: message,
    activationUpdatedAt: Date.now()
  };
}
function parseAdbDeviceLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("List of devices attached")) {
    return null;
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return null;
  }
  const serial = parts[0];
  const adbState = parts[1];
  const metadata = /* @__PURE__ */ new Map();
  for (const token of parts.slice(2)) {
    const separatorIndex = token.indexOf(":");
    if (separatorIndex > 0) {
      metadata.set(token.slice(0, separatorIndex), token.slice(separatorIndex + 1));
    }
  }
  const model = metadata.get("model");
  const deviceName = metadata.get("device");
  const transportId = metadata.get("transport_id");
  const label = model ?? deviceName ?? serial;
  let detailText = "Ready to connect to Android RenderDoc server";
  let lastError;
  let status = "offline";
  if (adbState === "device") {
    status = "offline";
  } else if (adbState === "offline") {
    detailText = "ADB reports this device as offline.";
    lastError = detailText;
  } else if (adbState === "unauthorized") {
    detailText = "ADB authorization required on the device.";
    lastError = detailText;
  } else {
    detailText = `ADB state: ${adbState}`;
    lastError = detailText;
  }
  if (transportId) {
    detailText = `${detailText}${detailText.endsWith(".") ? "" : "."} transport ${transportId}`;
  }
  return {
    id: `android-${sanitizeDeviceId(serial)}`,
    label,
    serial,
    type: "android",
    status,
    transport: "adb_android",
    detailText,
    lastError,
    lastSeen: Date.now()
  };
}
function readActionString(source, keys) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return void 0;
}
function parseRemoteBootstrap(data) {
  const direct = parseAndroidBootstrapMetadata(data.bootstrap);
  if (direct) {
    return direct;
  }
  const detail = data.detail;
  if (!detail || typeof detail !== "object") {
    return void 0;
  }
  return parseAndroidBootstrapMetadata(detail.bootstrap);
}
class ReplayDeviceService {
  devices = /* @__PURE__ */ new Map([[LOCAL_DEVICE.id, LOCAL_DEVICE]]);
  pollTimer = null;
  mainWindow = null;
  initialized = false;
  refreshPromise = null;
  activationPromises = /* @__PURE__ */ new Map();
  preparedRemotes = /* @__PURE__ */ new Map();
  resumeCache = null;
  setMainWindow(window) {
    this.mainWindow = window;
  }
  async initialize() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    await this.loadResumeCache();
    await this.refreshDevices();
    this.pollTimer = setInterval(() => {
      void this.refreshDevices().catch((error) => {
        console.warn("[ReplayDeviceService] Poll refresh failed:", error);
      });
    }, POLL_INTERVAL_MS);
  }
  dispose() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
  listDevices() {
    return this.getSortedDevices();
  }
  getDeviceById(deviceId) {
    return this.devices.get(deviceId) ?? null;
  }
  async refreshDevices() {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.refreshPromise = this.performRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }
  async activateDevice(deviceId) {
    const existingPromise = this.activationPromises.get(deviceId);
    if (existingPromise) {
      return existingPromise;
    }
    const activationPromise = this.performActivation(deviceId).finally(() => {
      this.activationPromises.delete(deviceId);
    });
    this.activationPromises.set(deviceId, activationPromise);
    return activationPromise;
  }
  peekPreparedRemote(deviceId) {
    const prepared = this.resolvePreparedRemote(deviceId);
    return prepared ? { ...prepared } : null;
  }
  consumePreparedRemote(deviceId) {
    const prepared = this.resolvePreparedRemote(deviceId);
    if (!prepared) {
      return null;
    }
    this.preparedRemotes.delete(deviceId);
    return { ...prepared };
  }
  invalidatePreparedRemote(deviceId) {
    this.preparedRemotes.delete(deviceId);
    const device = this.devices.get(deviceId);
    if (!device || device.type !== "android" || device.status === "offline") {
      return;
    }
    this.updateDevice({
      ...device,
      status: "offline",
      remoteId: void 0,
      detailText: "Ready to connect to Android RenderDoc server",
      lastError: void 0,
      activationPhase: "idle",
      activationErrorCode: void 0,
      activationErrorMessage: void 0,
      activationUpdatedAt: Date.now()
    });
  }
  getResumeCachePath() {
    return path__namespace.join(storageAdapter.getWorkspacePath(), "common", "config", "device_resume.json");
  }
  async loadResumeCache() {
    try {
      const cachePath = this.getResumeCachePath();
      if (!fs__namespace.existsSync(cachePath)) {
        this.resumeCache = null;
        return;
      }
      const content = await fs__namespace.promises.readFile(cachePath, "utf-8");
      const parsed = JSON.parse(content);
      this.resumeCache = parseResumeCacheRecord(parsed.lastDevice);
    } catch (error) {
      console.warn("[ReplayDeviceService] Failed to read device resume cache:", error);
      this.resumeCache = null;
    }
  }
  async persistResumeCache(device, validatedAt) {
    if (device.type !== "android" || !device.serial) {
      return;
    }
    const nextRecord = {
      deviceId: device.id,
      serial: device.serial,
      label: device.label,
      transport: device.transport,
      bootstrap: device.bootstrap,
      lastValidatedAt: validatedAt
    };
    this.resumeCache = nextRecord;
    try {
      const cachePath = this.getResumeCachePath();
      await fs__namespace.promises.mkdir(path__namespace.dirname(cachePath), { recursive: true });
      await fs__namespace.promises.writeFile(
        cachePath,
        JSON.stringify({ lastDevice: nextRecord }, null, 2),
        "utf-8"
      );
    } catch (error) {
      console.warn("[ReplayDeviceService] Failed to persist device resume cache:", error);
    }
  }
  resolvePreparedRemote(deviceId) {
    const prepared = this.preparedRemotes.get(deviceId);
    if (!prepared) {
      return null;
    }
    const currentDevice = this.devices.get(deviceId);
    const expired = Date.now() - prepared.validatedAt > PREPARED_REMOTE_TTL_MS;
    const serialMismatch = Boolean(currentDevice?.serial && currentDevice.serial !== prepared.serial);
    if (expired || serialMismatch) {
      this.preparedRemotes.delete(deviceId);
      return null;
    }
    return prepared;
  }
  shouldPreserveTransientState(device) {
    return device.status !== "offline";
  }
  maybeDecorateFromResumeCache(device) {
    if (device.type !== "android" || !device.serial || !this.resumeCache || this.resumeCache.serial !== device.serial || device.bootstrap) {
      return device;
    }
    return {
      ...device,
      bootstrap: this.resumeCache.bootstrap
    };
  }
  async performRefresh() {
    const detectedDevices = await this.detectAdbDevices();
    const now = Date.now();
    const nextDevices = /* @__PURE__ */ new Map([[LOCAL_DEVICE.id, { ...LOCAL_DEVICE, lastSeen: now }]]);
    const detectedIds = /* @__PURE__ */ new Set(["local"]);
    for (const detected of detectedDevices) {
      const decoratedDevice = this.maybeDecorateFromResumeCache(detected);
      detectedIds.add(decoratedDevice.id);
      const previous = this.devices.get(decoratedDevice.id);
      if (previous && this.shouldPreserveTransientState(previous) && decoratedDevice.lastError === void 0) {
        nextDevices.set(decoratedDevice.id, {
          ...decoratedDevice,
          status: previous.status,
          detailText: previous.detailText ?? decoratedDevice.detailText,
          lastError: previous.lastError,
          remoteId: previous.remoteId,
          bootstrap: previous.bootstrap ?? decoratedDevice.bootstrap,
          activationPhase: previous.activationPhase,
          activationErrorCode: previous.activationErrorCode,
          activationErrorMessage: previous.activationErrorMessage,
          activationUpdatedAt: previous.activationUpdatedAt,
          lastSeen: decoratedDevice.lastSeen ?? previous.lastSeen
        });
      } else if (previous && previous.activationErrorMessage && previous.lastError && decoratedDevice.status === "offline" && decoratedDevice.lastError === void 0) {
        nextDevices.set(decoratedDevice.id, {
          ...decoratedDevice,
          detailText: previous.detailText ?? previous.activationErrorMessage,
          lastError: previous.lastError,
          remoteId: previous.remoteId,
          bootstrap: previous.bootstrap ?? decoratedDevice.bootstrap,
          activationPhase: previous.activationPhase,
          activationErrorCode: previous.activationErrorCode,
          activationErrorMessage: previous.activationErrorMessage,
          activationUpdatedAt: previous.activationUpdatedAt,
          lastSeen: decoratedDevice.lastSeen ?? previous.lastSeen
        });
      } else {
        nextDevices.set(decoratedDevice.id, decoratedDevice);
      }
    }
    for (const [deviceId, device] of this.devices.entries()) {
      if (detectedIds.has(deviceId) || deviceId === "local") {
        continue;
      }
      this.preparedRemotes.delete(deviceId);
      nextDevices.set(deviceId, {
        ...device,
        status: "offline",
        detailText: "ADB device not detected.",
        lastError: "ADB device not detected."
      });
    }
    return this.replaceDevices(nextDevices);
  }
  async detectAdbDevices() {
    try {
      const lines = await this.runAdbCommand(["devices", "-l"]);
      return lines.map((line) => parseAdbDeviceLine(line)).filter((device) => device !== null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const offlineDevices = this.getSortedDevices().filter((device) => device.id !== "local").map((device) => ({
        ...device,
        status: "offline",
        detailText: message,
        lastError: message
      }));
      this.preparedRemotes.clear();
      const fallbackDevices = /* @__PURE__ */ new Map([[LOCAL_DEVICE.id, LOCAL_DEVICE]]);
      for (const device of offlineDevices) {
        fallbackDevices.set(device.id, device);
      }
      return this.replaceDevices(fallbackDevices);
    }
  }
  async performActivation(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new Error(`Replay device ${deviceId} not found.`);
    }
    if (device.type === "local") {
      this.updateDevice({
        ...device,
        status: "online",
        detailText: "Local replay ready",
        lastError: void 0
      });
      return this.devices.get(deviceId);
    }
    this.updateDevice({
      ...device,
      status: "loading",
      detailText: "Connecting to Android RenderDoc...",
      lastError: void 0,
      activationPhase: "connect",
      activationErrorCode: void 0,
      activationErrorMessage: void 0,
      activationUpdatedAt: Date.now()
    });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Timed out while starting the remote server.")), ACTIVATE_TIMEOUT_MS);
    });
    try {
      const activated = await Promise.race([
        this.activateRemoteDevice(deviceId),
        timeoutPromise
      ]);
      this.updateDevice(activated);
      return activated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const currentDevice = this.devices.get(deviceId) ?? device;
      const failedDevice = applyActivationFailure(
        currentDevice,
        currentDevice.activationPhase ?? "connect",
        message,
        currentDevice.activationErrorCode
      );
      this.updateDevice(failedDevice);
      return failedDevice;
    }
  }
  async activateRemoteDevice(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device?.serial) {
      throw new Error("Android device serial is missing.");
    }
    this.updateDevice({
      ...device,
      status: "loading",
      detailText: "Connecting to Android RenderDoc server...",
      lastError: void 0,
      activationPhase: "connect",
      activationUpdatedAt: Date.now()
    });
    const result = await rdxShellActionService.runAction("connectRemote", {
      deviceId: device.id,
      deviceLabel: device.label,
      deviceType: device.type,
      deviceSerial: device.serial,
      transport: device.transport
    });
    if (!result.ok) {
      throw new Error(result.error ?? "RDX connectRemote action failed.");
    }
    const contextId = readActionString(result.data, ["contextId", "context_id", "RDX_CONTEXT_ID"]) ?? device.id;
    const remoteId = readActionString(result.data, ["remoteId", "remote_id", "RDX_REMOTE_ID"]);
    if (!remoteId) {
      throw new Error("RDX connectRemote action result must include remoteId/remote_id.");
    }
    const bootstrap = parseRemoteBootstrap(result.data);
    const validatedAt = Date.now();
    this.preparedRemotes.set(deviceId, {
      deviceId,
      serial: device.serial,
      contextId,
      remoteId,
      validatedAt,
      bootstrap
    });
    await this.persistResumeCache({
      ...device,
      bootstrap
    }, validatedAt);
    return {
      ...device,
      status: "online",
      remoteId,
      bootstrap,
      detailText: buildRemoteReadyText(bootstrap),
      lastError: void 0,
      activationPhase: "ready",
      activationErrorCode: void 0,
      activationErrorMessage: void 0,
      activationUpdatedAt: validatedAt,
      lastSeen: Date.now()
    };
  }
  async runAdbCommand(args) {
    const adbPath = resolveAdbExecutable();
    return new Promise((resolve, reject) => {
      const proc = child_process.spawn(adbPath, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf-8");
      });
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf-8");
      });
      proc.on("error", (error) => {
        reject(error);
      });
      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `adb exited with code ${code ?? -1}.`));
          return;
        }
        resolve(stdout.split(/\r?\n/));
      });
    });
  }
  updateDevice(device) {
    const previous = this.devices.get(device.id);
    this.devices.set(device.id, device);
    if (!previous || previous.status !== device.status || previous.detailText !== device.detailText || previous.activationPhase !== device.activationPhase) {
      runtimeLogService.log({
        scope: "app",
        namespace: "device",
        severity: device.status === "online" ? "success" : device.status === "offline" ? "warning" : device.status === "loading" ? "info" : "info",
        title: device.label,
        summary: `${device.type === "local" ? "Local" : "Android"} Replay Device status: ${device.status}`,
        detail: device.detailText,
        raw: {
          deviceId: device.id,
          status: device.status,
          activationPhase: device.activationPhase ?? null,
          remoteId: device.remoteId ?? null,
          lastError: device.lastError ?? null
        }
      });
    }
    this.broadcast({
      device,
      devices: this.getSortedDevices()
    });
  }
  replaceDevices(nextDevices) {
    const previous = this.getSortedDevices();
    this.devices = nextDevices;
    const devices = this.getSortedDevices();
    const changedDevice = devices.find((device, index) => JSON.stringify(device) !== JSON.stringify(previous[index]));
    const hasLengthChange = previous.length !== devices.length;
    if (changedDevice || hasLengthChange) {
      this.broadcast({
        device: changedDevice ?? devices[0] ?? LOCAL_DEVICE,
        devices
      });
    }
    return devices;
  }
  broadcast(payload) {
    rendererEventHub.emit("device:statusChanged", payload);
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }
    this.mainWindow.webContents.send("device:statusChanged", payload);
  }
  getSortedDevices() {
    const devices = Array.from(this.devices.values());
    return devices.sort((a, b) => {
      if (a.id === "local") return -1;
      if (b.id === "local") return 1;
      return a.label.localeCompare(b.label);
    });
  }
}
const replayDeviceService = new ReplayDeviceService();
class EventStream {
  /**
   * @param isComplete 可选：判断某个事件是否意味着流应当结束。
   *                   返回 true 时会自动调用 `complete(extractResult(event))`。
   * @param extractResult 当 `isComplete` 命中时，从事件中抽取最终结果的函数。
   *                      若未提供，则将事件本身作为结果（要求 `R` 兼容 `T`）。
   */
  constructor(isComplete, extractResult) {
    this.isComplete = isComplete;
    this.extractResult = extractResult;
    this.resultPromise = new Promise((resolve, reject) => {
      this.resultResolve = resolve;
      this.resultReject = reject;
    });
    this.resultPromise.catch(() => {
    });
  }
  isComplete;
  extractResult;
  queue = [];
  waiting = [];
  done = false;
  _error;
  resultResolve;
  resultReject;
  resultPromise;
  resultSettled = false;
  abortController = new AbortController();
  // -------------------------------------------------------------------
  // 生产者 API
  // -------------------------------------------------------------------
  /** 向流中推送一个事件；若有等待中的消费者会直接交付。 */
  push(event) {
    if (this.done) {
      return;
    }
    if (this.waiting.length > 0) {
      const resolver = this.waiting.shift();
      resolver.resolve({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
    if (this.isComplete && this.isComplete(event)) {
      const result = this.extractResult ? this.extractResult(event) : event;
      this.complete(result);
    }
  }
  /** 标记流正常结束，并提供最终结果。 */
  complete(result) {
    if (this.done) {
      return;
    }
    this.done = true;
    if (!this.resultSettled) {
      this.resultSettled = true;
      this.resultResolve(result);
    }
    this.flushWaitingDone();
  }
  /** 标记流以错误结束。 */
  error(err) {
    if (this.done) {
      return;
    }
    this.done = true;
    this._error = err;
    if (!this.resultSettled) {
      this.resultSettled = true;
      this.resultReject(err);
    }
    const waiters = this.waiting.splice(0);
    for (const w of waiters) {
      w.reject(err);
    }
  }
  /** 中止流：发出 abort 信号并以 AbortError 终止。 */
  abort() {
    if (this.done) {
      return;
    }
    if (!this.abortController.signal.aborted) {
      this.abortController.abort();
    }
    const abortErr = new Error("EventStream aborted");
    abortErr.name = "AbortError";
    this.error(abortErr);
  }
  // -------------------------------------------------------------------
  // 消费者 API
  // -------------------------------------------------------------------
  /** AsyncIterable 协议入口，支持 `for await ... of stream`。 */
  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this._error && this.queue.length === 0) {
          return Promise.reject(this._error);
        }
        if (this.queue.length > 0) {
          const value = this.queue.shift();
          return Promise.resolve({ value, done: false });
        }
        if (this.done) {
          return Promise.resolve({
            value: void 0,
            done: true
          });
        }
        return new Promise((resolve, reject) => {
          this.waiting.push({ resolve, reject });
        });
      },
      return: () => {
        if (!this.done) {
          this.abort();
        }
        return Promise.resolve({
          value: void 0,
          done: true
        });
      },
      throw: (err) => {
        if (!this.done) {
          this.error(err instanceof Error ? err : new Error(String(err)));
        }
        return Promise.reject(err);
      }
    };
  }
  /** 等待并获取最终结果。 */
  result() {
    return this.resultPromise;
  }
  // -------------------------------------------------------------------
  // 链式操作
  // -------------------------------------------------------------------
  /**
   * 对每个事件应用 `fn`，返回新的事件流。
   * 最终结果保持原流的 `R`。
   */
  map(fn) {
    const downstream = new EventStream();
    void this.pipeTo(
      downstream,
      (event) => downstream.push(fn(event))
    );
    return downstream;
  }
  /** 过滤事件，返回新的事件流。 */
  filter(fn) {
    const downstream = new EventStream();
    void this.pipeTo(downstream, (event) => {
      if (fn(event)) {
        downstream.push(event);
      }
    });
    return downstream;
  }
  /** 旁路观察事件，不改变流内容。 */
  tap(fn) {
    const downstream = new EventStream();
    void this.pipeTo(downstream, (event) => {
      try {
        fn(event);
      } catch {
      }
      downstream.push(event);
    });
    return downstream;
  }
  // -------------------------------------------------------------------
  // 状态查询
  // -------------------------------------------------------------------
  /** 流是否已结束（无论成功或失败）。 */
  get isDone() {
    return this.done;
  }
  /** 中止信号，便于下游传递给 fetch 等异步 API。 */
  get signal() {
    return this.abortController.signal;
  }
  // -------------------------------------------------------------------
  // 内部辅助
  // -------------------------------------------------------------------
  /** 流结束时清空等待中的消费者，让它们收到 done=true。 */
  flushWaitingDone() {
    const waiters = this.waiting.splice(0);
    for (const w of waiters) {
      w.resolve({ value: void 0, done: true });
    }
  }
  /**
   * 把当前流的事件 / 终止状态转发到 downstream。
   * `onEvent` 决定如何把事件投递到 downstream（map/filter/tap 可定制）。
   */
  async pipeTo(downstream, onEvent) {
    try {
      for await (const event of this) {
        if (downstream.isDone) {
          return;
        }
        onEvent(event);
      }
      try {
        const finalResult = await this.resultPromise;
        downstream.complete(finalResult);
      } catch (err) {
        downstream.error(err instanceof Error ? err : new Error(String(err)));
      }
    } catch (err) {
      downstream.error(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
function agentLoop(pendingMessages, context2, config, providerStrategy, toolExecutor) {
  const stream = new EventStream();
  void runAgentLoop(
    [...pendingMessages],
    context2,
    config,
    providerStrategy,
    toolExecutor,
    stream
  );
  return stream;
}
async function runAgentLoop(pendingMessages, context2, config, providerStrategy, toolExecutor, stream) {
  const newMessages = [];
  const maxTurns = config.maxTurns ?? 100;
  const onExternalAbort = () => {
    if (!stream.isDone) {
      stream.abort();
    }
  };
  if (config.signal) {
    if (config.signal.aborted) {
      stream.abort();
      return;
    }
    config.signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const injectPending = (messages) => {
    for (const msg of messages) {
      context2.messages.push(msg);
      newMessages.push(msg);
      stream.push({ type: "message_start", message: msg });
      stream.push({ type: "message_end", message: msg });
    }
  };
  const injectScheduled = () => {
    const injected = [];
    if (config.backgroundTaskRunner) {
      const notification = config.backgroundTaskRunner.buildNotificationMessage();
      if (notification) {
        injected.push({
          role: "user",
          content: [{ type: "text", text: notification }],
          timestamp: Date.now()
        });
      }
    }
    if (config.cronScheduler) {
      for (const prompt of config.cronScheduler.getPendingPrompts()) {
        injected.push({
          role: "user",
          content: [{ type: "text", text: `<cron_triggered>${prompt}</cron_triggered>` }],
          timestamp: Date.now()
        });
      }
    }
    injectPending(injected);
  };
  try {
    stream.push({ type: "agent_start" });
    let state2 = {
      pending: [...pendingMessages],
      turn: 0,
      transition: "init"
    };
    while (true) {
      if (state2.pending.length > 0) {
        injectPending(state2.pending);
        state2 = { ...state2, pending: [] };
      }
      if (stream.isDone) {
        return;
      }
      state2 = { ...state2, turn: state2.turn + 1 };
      if (state2.turn > maxTurns) {
        break;
      }
      stream.push({ type: "turn_start", turn: state2.turn });
      injectScheduled();
      const { message: assistantMessage } = await streamAssistantResponseWithRecovery(
        context2,
        config,
        providerStrategy,
        stream
      );
      newMessages.push(assistantMessage);
      if (assistantMessage.stopReason !== "toolUse") {
        stream.push({ type: "turn_end", turn: state2.turn, message: assistantMessage });
        const followUps = config.getFollowUpMessages ? config.getFollowUpMessages() : [];
        if (followUps && followUps.length > 0) {
          state2 = { pending: followUps, turn: state2.turn, transition: "follow_up" };
          continue;
        }
        break;
      }
      const toolResults = await executeToolCalls(
        assistantMessage,
        toolExecutor,
        stream,
        config.getSteeringMessages,
        config.maxToolConcurrency
      );
      for (const result of toolResults.results) {
        context2.messages.push(result);
        newMessages.push(result);
      }
      stream.push({
        type: "turn_end",
        turn: state2.turn,
        message: assistantMessage,
        toolResults: toolResults.results
      });
      if (toolResults.steeringMessages && toolResults.steeringMessages.length > 0) {
        state2 = {
          pending: toolResults.steeringMessages,
          turn: state2.turn,
          transition: "steering"
        };
        continue;
      }
      state2 = { pending: [], turn: state2.turn, transition: "next_turn" };
    }
    stream.push({ type: "agent_end", messages: newMessages });
    stream.complete(newMessages);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (!stream.isDone) {
      stream.push({ type: "error", error });
      stream.error(error);
    }
  } finally {
    if (config.signal) {
      config.signal.removeEventListener("abort", onExternalAbort);
    }
  }
}
async function streamAssistantResponseWithRecovery(context2, config, provider, stream) {
  const recovery = config.errorRecovery;
  const CIRCUIT_BREAKER_LIMIT = 3;
  let consecutiveCompactionFailures = 0;
  while (true) {
    try {
      const assistantMessage = await streamAssistantResponse(
        context2,
        config,
        provider,
        stream
      );
      consecutiveCompactionFailures = 0;
      if (recovery && assistantMessage.stopReason === "length") {
        const lengthAction = recovery.decide(null, "length");
        switch (lengthAction.type) {
          case "escalate_tokens": {
            recovery.markEscalated();
            if (config.streamOptions) {
              config.streamOptions.maxTokens = lengthAction.newMaxTokens;
            }
            continue;
          }
          case "continue_prompt": {
            recovery.noteRetryAttempt();
            context2.messages.push({
              role: "user",
              content: [{ type: "text", text: "Continue." }],
              timestamp: Date.now()
            });
            continue;
          }
          case "abort": {
            throw new Error(`[Recovery abort] ${lengthAction.reason}`);
          }
          default: {
            return { message: assistantMessage };
          }
        }
      }
      return { message: assistantMessage };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (!recovery) {
        throw error;
      }
      const action = recovery.decide(error);
      switch (action.type) {
        case "retry": {
          recovery.noteRetryAttempt();
          await sleep$1(action.delayMs);
          continue;
        }
        case "escalate_tokens": {
          recovery.markEscalated();
          if (config.streamOptions) {
            config.streamOptions.maxTokens = action.newMaxTokens;
          }
          continue;
        }
        case "reactive_compact": {
          consecutiveCompactionFailures++;
          if (consecutiveCompactionFailures >= CIRCUIT_BREAKER_LIMIT) {
            throw new Error(
              `[Circuit breaker] ${CIRCUIT_BREAKER_LIMIT} consecutive compaction attempts failed; aborting`
            );
          }
          recovery.markReactiveCompactAttempted();
          if (config.transformContext) {
            context2.messages = await config.transformContext(
              context2.messages,
              stream.signal
            );
          }
          continue;
        }
        case "switch_model": {
          config.model = action.fallbackModel;
          continue;
        }
        case "continue_prompt": {
          recovery.noteRetryAttempt();
          continue;
        }
        case "abort": {
          throw new Error(`[Recovery abort] ${action.reason}`);
        }
      }
    }
  }
}
function sleep$1(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function streamAssistantResponse(context2, config, provider, stream) {
  let messages = context2.messages;
  if (config.transformContext) {
    messages = await config.transformContext(
      [...context2.messages],
      stream.signal
    );
  }
  const llmMessages = config.convertToLlm(messages);
  const llmContext = {
    systemPrompt: context2.systemPrompt,
    messages: llmMessages,
    tools: context2.tools
  };
  const dynamicKey = config.getApiKey ? await config.getApiKey(config.model.provider) : void 0;
  const apiKey = dynamicKey ?? config.streamOptions?.apiKey;
  const streamOptions = {
    ...config.streamOptions ?? {},
    apiKey,
    signal: stream.signal
  };
  const response = provider.stream(config.model, llmContext, streamOptions);
  let partialIndex = -1;
  let finalMessage;
  for await (const event of response) {
    switch (event.type) {
      case "start": {
        partialIndex = context2.messages.length;
        context2.messages.push(event.partial);
        stream.push({ type: "message_start", message: event.partial });
        break;
      }
      case "text_start":
      case "text_delta":
      case "text_end":
      case "thinking_start":
      case "thinking_delta":
      case "thinking_end":
      case "toolcall_start":
      case "toolcall_delta":
      case "toolcall_end": {
        if (partialIndex >= 0) {
          context2.messages[partialIndex] = event.partial;
        }
        stream.push({
          type: "message_update",
          assistantMessageEvent: event,
          message: event.partial
        });
        break;
      }
      case "done": {
        finalMessage = event.message;
        if (partialIndex >= 0) {
          context2.messages[partialIndex] = finalMessage;
        } else {
          context2.messages.push(finalMessage);
          partialIndex = context2.messages.length - 1;
        }
        stream.push({ type: "message_end", message: finalMessage });
        break;
      }
      case "error": {
        finalMessage = event.message;
        if (partialIndex >= 0) {
          context2.messages[partialIndex] = finalMessage;
        } else {
          context2.messages.push(finalMessage);
          partialIndex = context2.messages.length - 1;
        }
        stream.push({ type: "message_end", message: finalMessage });
        break;
      }
      default: {
        stream.push({
          type: "message_update",
          assistantMessageEvent: event,
          message: event.partial
        });
        break;
      }
    }
  }
  if (!finalMessage) {
    finalMessage = await response.result();
    if (partialIndex >= 0) {
      context2.messages[partialIndex] = finalMessage;
    } else {
      context2.messages.push(finalMessage);
    }
  }
  return finalMessage;
}
async function executeToolCalls(assistantMessage, toolExecutor, stream, getSteeringMessages, maxConcurrency) {
  const toolCalls = assistantMessage.content.filter(
    (c) => c.type === "toolCall"
  );
  const results = new Array(toolCalls.length);
  const concurrency = maxConcurrency && maxConcurrency > 1 ? maxConcurrency : 1;
  const executeOne = async (index) => {
    const toolCall = toolCalls[index];
    const startTime = Date.now();
    stream.push({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments
    });
    let result;
    if (toolExecutor) {
      try {
        result = await toolExecutor.execute(
          toolCall,
          stream.signal,
          (partial) => {
            stream.push({
              type: "tool_execution_update",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              partialResult: partial
            });
          }
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result = {
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
          timestamp: Date.now()
        };
      }
    } else {
      result = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          { type: "text", text: `Tool "${toolCall.name}" not available (no executor configured)` }
        ],
        isError: true,
        timestamp: Date.now()
      };
    }
    stream.push({
      type: "tool_execution_end",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result,
      durationMs: Date.now() - startTime
    });
    results[index] = result;
    if (getSteeringMessages && index === 0) {
      const steering = getSteeringMessages();
      if (steering && steering.length > 0) {
        for (let j = 1; j < toolCalls.length; j++) {
          if (!results[j]) {
            const skipped = {
              role: "toolResult",
              toolCallId: toolCalls[j].id,
              toolName: toolCalls[j].name,
              content: [{ type: "text", text: "Skipped due to queued user message" }],
              isError: false,
              timestamp: Date.now()
            };
            stream.push({
              type: "tool_execution_end",
              toolCallId: toolCalls[j].id,
              toolName: toolCalls[j].name,
              result: skipped,
              durationMs: 0
            });
            results[j] = skipped;
          }
        }
        throw { steeringMessages: steering };
      }
    }
  };
  for (let i = 0; i < toolCalls.length; i += concurrency) {
    const batch = [];
    for (let j = i; j < Math.min(i + concurrency, toolCalls.length); j++) {
      batch.push(executeOne(j));
    }
    try {
      await Promise.all(batch);
    } catch (err) {
      if (err && typeof err === "object" && "steeringMessages" in err) {
        const steeringResult = err;
        return {
          results: results.filter(Boolean),
          steeringMessages: steeringResult.steeringMessages
        };
      }
      throw err;
    }
  }
  return { results: results.filter(Boolean) };
}
function defaultConvertToLlm(messages) {
  const result = [];
  for (const msg of messages) {
    if (msg.role === "user" || msg.role === "assistant" || msg.role === "toolResult") {
      result.push(msg);
    }
  }
  return result;
}
class Agent {
  _state;
  _isStreaming = false;
  _subscribers = [];
  _steeringQueue = [];
  _followUpQueue = [];
  _currentStream = null;
  _provider;
  _toolExecutor;
  _options;
  constructor(options) {
    this._options = options;
    this._provider = options.provider;
    this._toolExecutor = options.toolExecutor;
    this._state = {
      systemPrompt: options.initialState.systemPrompt,
      model: options.initialState.model,
      tools: options.initialState.tools,
      messages: options.initialState.messages ? [...options.initialState.messages] : []
    };
  }
  // -------------------------------------------------------------------
  // 状态查询
  // -------------------------------------------------------------------
  /** 当前是否正在流式处理。 */
  get isStreaming() {
    return this._isStreaming;
  }
  /**
   * 获取当前状态快照（浅拷贝；messages 数组本身不可变，但元素仍是引用）。
   */
  get state() {
    return {
      systemPrompt: this._state.systemPrompt,
      model: this._state.model,
      tools: this._state.tools ? [...this._state.tools] : void 0,
      messages: [...this._state.messages]
    };
  }
  /** 获取消息历史。 */
  get messages() {
    return this._state.messages;
  }
  // -------------------------------------------------------------------
  // 订阅
  // -------------------------------------------------------------------
  /**
   * 订阅事件。
   * @returns 解除订阅的函数。
   */
  subscribe(subscriber) {
    this._subscribers.push(subscriber);
    return () => {
      const idx = this._subscribers.indexOf(subscriber);
      if (idx >= 0) {
        this._subscribers.splice(idx, 1);
      }
    };
  }
  // -------------------------------------------------------------------
  // 主流程：prompt / steer / followUp / abort
  // -------------------------------------------------------------------
  /**
   * 发送消息并启动 agent 循环。
   *
   * @param input  字符串或完整 UserMessage。
   * @returns      本次循环新增的所有消息（含 user/assistant/toolResult）。
   * @throws       已在 streaming 状态时抛出。
   */
  async prompt(input) {
    if (this._isStreaming) {
      throw new Error("Agent.prompt: agent is already streaming");
    }
    const userMessage = normalizeUserMessage(input);
    const pending = [userMessage];
    return this.runLoop(pending);
  }
  /**
   * 注入 steering 消息（中断当前工具执行序列）。
   * 只能在 streaming 状态调用；非 streaming 状态会被静默丢弃，避免误注入。
   */
  steer(message) {
    if (!this._isStreaming) {
      return;
    }
    this._steeringQueue.push(normalizeUserMessage(message));
  }
  /**
   * 注入 followUp 消息（agent 内层停止前追加）。
   * 只能在 streaming 状态调用；非 streaming 状态会被静默丢弃。
   */
  followUp(message) {
    if (!this._isStreaming) {
      return;
    }
    this._followUpQueue.push(normalizeUserMessage(message));
  }
  /** 中止当前流；非 streaming 状态时是 no-op。 */
  abort() {
    if (this._currentStream && !this._currentStream.isDone) {
      this._currentStream.abort();
    }
  }
  // -------------------------------------------------------------------
  // 状态变更
  // -------------------------------------------------------------------
  /** 动态更新模型（不影响正在进行的请求；下一轮生效）。 */
  setModel(model) {
    this._state.model = model;
  }
  /** 动态更新工具列表。 */
  setTools(tools) {
    this._state.tools = [...tools];
  }
  /** 动态更新系统提示。 */
  setSystemPrompt(prompt) {
    this._state.systemPrompt = prompt;
  }
  /** 追加消息到历史（不触发循环）。 */
  appendMessage(message) {
    this._state.messages.push(message);
  }
  // -------------------------------------------------------------------
  // 私有：循环执行
  // -------------------------------------------------------------------
  async runLoop(pending) {
    this._isStreaming = true;
    this._steeringQueue = [];
    this._followUpQueue = [];
    const context2 = {
      systemPrompt: this._state.systemPrompt,
      messages: this._state.messages,
      tools: this._state.tools
    };
    const config = this.createLoopConfig();
    const stream = agentLoop(
      pending,
      context2,
      config,
      this._provider,
      this._toolExecutor
    );
    this._currentStream = stream;
    try {
      for await (const event of stream) {
        this.emit(event);
      }
      const result = await stream.result();
      return result;
    } finally {
      this._isStreaming = false;
      this._currentStream = null;
      this._steeringQueue = [];
      this._followUpQueue = [];
    }
  }
  emit(event) {
    const subs = [...this._subscribers];
    for (const sub of subs) {
      try {
        sub(event);
      } catch {
      }
    }
  }
  getSteeringMessages() {
    if (this._steeringQueue.length === 0) {
      return [];
    }
    const mode = this._options.steeringMode ?? "all";
    if (mode === "one-at-a-time") {
      const next = this._steeringQueue.shift();
      return next ? [next] : [];
    }
    const all = this._steeringQueue;
    this._steeringQueue = [];
    return all;
  }
  getFollowUpMessages() {
    if (this._followUpQueue.length === 0) {
      return [];
    }
    const mode = this._options.followUpMode ?? "all";
    if (mode === "one-at-a-time") {
      const next = this._followUpQueue.shift();
      return next ? [next] : [];
    }
    const all = this._followUpQueue;
    this._followUpQueue = [];
    return all;
  }
  createLoopConfig() {
    const opts = this._options;
    return {
      model: this._state.model,
      convertToLlm: opts.convertToLlm ?? defaultConvertToLlm,
      transformContext: opts.transformContext,
      streamOptions: opts.streamOptions,
      getApiKey: opts.getApiKey,
      maxTurns: opts.maxTurns,
      getSteeringMessages: () => this.getSteeringMessages(),
      getFollowUpMessages: () => this.getFollowUpMessages(),
      signal: opts.streamOptions?.signal,
      errorRecovery: opts.errorRecovery
    };
  }
}
function normalizeUserMessage(input) {
  if (typeof input === "string") {
    return {
      role: "user",
      content: input,
      timestamp: Date.now()
    };
  }
  return input;
}
const DEFAULT_TOOL_RESULT_BUDGET = 200 * 1024;
const DEFAULT_MAX_MESSAGES = 50;
const DEFAULT_KEEP_RECENT_TOOL_RESULTS = 3;
const DEFAULT_CONTEXT_RATIO = 0.75;
const DEFAULT_CONTEXT_LIMIT = 1e5;
const SNIP_HEAD = 3;
const TOOL_RESULT_TRUNCATE_HEAD = 2e3;
class ContextManager {
  constructor(config = {}) {
    this.config = config;
  }
  config;
  /**
   * 默认的 convertToLlm 实现：保留三种标准消息。
   */
  convertToLlm(messages) {
    const result = [];
    for (const msg of messages) {
      if (msg.role === "user" || msg.role === "assistant" || msg.role === "toolResult") {
        result.push(msg);
      }
    }
    return result;
  }
  /**
   * 上下文压缩管道（transformContext 实现）。
   * 压缩链路按 budget → snip → micro → full 递进，
   * 每一级都返回新数组，不修改原始数组。
   */
  async compress(messages, model) {
    const tokenLimit = this.resolveTokenLimit(model);
    let result = this.toolResultBudget(messages);
    result = this.snipCompact(result);
    if (this.estimateTokens(result) > tokenLimit) {
      result = this.microCompact(result);
    }
    if (this.estimateTokens(result) > tokenLimit) {
      result = await this.fullCompact(result);
    }
    return result;
  }
  /**
   * 将消息数组分为"压缩摘要"和"活跃对话"两组，返回各组的 token 估算与条数。
   *
   * 判断标准：消息内容包含已知的压缩占位符关键词（来自 snipCompact/microCompact/fullCompact）。
   */
  classifyMessages(messages) {
    const SUMMARY_PATTERNS = ["[snipped ", "[Earlier tool result compacted]", "[Conversation summary:"];
    const isSummaryMessage = (msg) => {
      const content = msg.content;
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((b) => typeof b === "object" && b !== null && "text" in b ? String(b.text) : "").join("") : "";
      return SUMMARY_PATTERNS.some((p) => text.includes(p));
    };
    const summaryMessages = [];
    const conversationMessages = [];
    for (const msg of messages) {
      if (isSummaryMessage(msg)) {
        summaryMessages.push(msg);
      } else {
        conversationMessages.push(msg);
      }
    }
    return {
      summaryTokens: this.estimateTokens(summaryMessages),
      conversationTokens: this.estimateTokens(conversationMessages),
      conversationCount: conversationMessages.filter(
        (m) => m.role === "user" || m.role === "assistant"
      ).length
    };
  }
  /** 估算消息 token 数（优先使用真实 tokenizer）。 */
  estimateTokens(messages) {
    const tokenizer = this.config.tokenizer;
    const modelId = this.config.modelId;
    if (tokenizer) {
      const llmMessages = messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult").map((m) => ({
        role: m.role,
        content: "content" in m ? m.content : void 0
      }));
      return tokenizer.countMessagesTokens(llmMessages, modelId);
    }
    let chars = 0;
    for (const msg of messages) {
      chars += this.estimateMessageChars(msg);
    }
    return Math.ceil(chars / 4);
  }
  // =====================================================================
  // 各级压缩策略
  // =====================================================================
  /** Level 1: 工具结果预算控制。 */
  toolResultBudget(messages) {
    const budget = this.config.toolResultBudget ?? DEFAULT_TOOL_RESULT_BUDGET;
    const entries = [];
    let totalSize = 0;
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === "toolResult") {
        const size = this.toolResultSize(msg);
        entries.push({ index: i, size });
        totalSize += size;
      }
    }
    if (totalSize <= budget) {
      return [...messages];
    }
    const result = messages.slice();
    const sorted = [...entries].sort((a, b) => b.size - a.size);
    for (const entry of sorted) {
      if (totalSize <= budget) break;
      const original = result[entry.index];
      const truncated = this.truncateToolResult(original);
      const newSize = this.toolResultSize(truncated);
      totalSize -= entry.size - newSize;
      result[entry.index] = truncated;
    }
    return result;
  }
  /**
   * Level 2: Snip 压缩（保留头尾，中间替换为占位符）。
   *
   * 不能在 tool_use ↔ tool_result 对中间切断：
   * 如果切口左侧的 assistant 消息含 toolCall，
   * 则把切口往右推一格直到对应的 toolResult 之后。
   */
  snipCompact(messages) {
    const max = this.config.maxMessages ?? DEFAULT_MAX_MESSAGES;
    if (messages.length <= max) {
      return [...messages];
    }
    const head = SNIP_HEAD;
    const tailCount = max - head - 1;
    if (tailCount <= 0) {
      return [...messages];
    }
    let snipStart = head;
    let snipEnd = messages.length - tailCount;
    snipStart = this.adjustSnipStart(messages, snipStart);
    snipEnd = this.adjustSnipEnd(messages, snipEnd);
    if (snipStart >= snipEnd) {
      return [...messages];
    }
    const snippedCount = snipEnd - snipStart;
    if (snippedCount <= 0) {
      return [...messages];
    }
    const placeholder = {
      role: "user",
      content: `[snipped ${snippedCount} messages]`,
      timestamp: Date.now()
    };
    return [
      ...messages.slice(0, snipStart),
      placeholder,
      ...messages.slice(snipEnd)
    ];
  }
  /** Level 3: Micro 压缩（早期工具结果 → 占位符）。 */
  microCompact(messages) {
    const keep = this.config.keepRecentToolResults ?? DEFAULT_KEEP_RECENT_TOOL_RESULTS;
    const toolResultIndices = [];
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === "toolResult") {
        toolResultIndices.push(i);
      }
    }
    if (toolResultIndices.length <= keep) {
      return [...messages];
    }
    const keepFrom = toolResultIndices.length - keep;
    const compactSet = new Set(toolResultIndices.slice(0, keepFrom));
    const result = messages.slice();
    for (const idx of compactSet) {
      const original = result[idx];
      result[idx] = {
        role: "toolResult",
        toolCallId: original.toolCallId,
        toolName: original.toolName,
        content: [
          { type: "text", text: "[Earlier tool result compacted]" }
        ],
        isError: false,
        timestamp: original.timestamp
      };
    }
    return result;
  }
  /** Level 4: Full 压缩（生成摘要替换全部）。 */
  async fullCompact(messages) {
    const tail = messages.slice(-5);
    const summary = this.buildSummary(messages.slice(0, -5));
    if (!summary) {
      return [...tail];
    }
    const summaryMsg = {
      role: "user",
      content: summary,
      timestamp: Date.now()
    };
    return [summaryMsg, ...tail];
  }
  // =====================================================================
  // 辅助
  // =====================================================================
  resolveTokenLimit(model) {
    if (this.config.contextTokenLimit !== void 0) {
      return this.config.contextTokenLimit;
    }
    if (model && model.contextWindow > 0) {
      return Math.floor(model.contextWindow * DEFAULT_CONTEXT_RATIO);
    }
    return DEFAULT_CONTEXT_LIMIT;
  }
  estimateMessageChars(msg) {
    if (msg.role === "user") {
      return this.userContentChars(msg.content);
    }
    if (msg.role === "assistant") {
      return this.assistantContentChars(msg);
    }
    if (msg.role === "toolResult") {
      return this.toolResultSize(msg);
    }
    try {
      return JSON.stringify(msg).length;
    } catch {
      return 0;
    }
  }
  userContentChars(content) {
    if (typeof content === "string") {
      return content.length;
    }
    let total = 0;
    for (const block of content) {
      if (block.type === "text") {
        total += block.text.length;
      } else if (block.type === "image") {
        total += block.data.length;
      }
    }
    return total;
  }
  assistantContentChars(msg) {
    let total = 0;
    for (const block of msg.content) {
      if (block.type === "text") {
        total += block.text.length;
      } else if (block.type === "thinking") {
        total += block.thinking.length;
      } else if (block.type === "toolCall") {
        const tc = block;
        try {
          total += JSON.stringify(tc.arguments).length + tc.name.length;
        } catch {
          total += tc.name.length;
        }
      }
    }
    return total;
  }
  toolResultSize(msg) {
    let total = 0;
    for (const block of msg.content) {
      if (block.type === "text") {
        total += block.text.length;
      } else if (block.type === "image") {
        total += block.data.length;
      }
    }
    return total;
  }
  truncateToolResult(msg) {
    const newContent = [];
    let remaining = TOOL_RESULT_TRUNCATE_HEAD;
    let truncated = false;
    for (const block of msg.content) {
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      if (block.type === "text") {
        if (block.text.length <= remaining) {
          newContent.push({ type: "text", text: block.text });
          remaining -= block.text.length;
        } else {
          newContent.push({
            type: "text",
            text: block.text.slice(0, remaining)
          });
          remaining = 0;
          truncated = true;
        }
      } else {
        truncated = true;
      }
    }
    if (truncated) {
      newContent.push({ type: "text", text: "... truncated" });
    }
    return {
      role: "toolResult",
      toolCallId: msg.toolCallId,
      toolName: msg.toolName,
      content: newContent,
      isError: msg.isError,
      timestamp: msg.timestamp
    };
  }
  /**
   * 调整 snipStart：如果该位置正好是某个 toolResult 但其匹配的
   * assistant.toolCall 在 head 之内，则后移到工具对结束之后。
   */
  adjustSnipStart(messages, start) {
    let s = start;
    while (s < messages.length) {
      const msg = messages[s];
      if (msg.role === "toolResult") {
        s++;
        continue;
      }
      const prev = messages[s - 1];
      if (prev && prev.role === "assistant") {
        const hasToolCall = prev.content.some(
          (c) => c.type === "toolCall"
        );
        if (hasToolCall) {
          s++;
          continue;
        }
      }
      break;
    }
    return s;
  }
  /**
   * 调整 snipEnd：保证不在工具调用对中间切断。
   * 如果 snipEnd 指向 toolResult，则前移到对应 assistant.toolCall 之前。
   */
  adjustSnipEnd(messages, end) {
    let e = end;
    while (e > 0 && e < messages.length) {
      const msg = messages[e];
      if (msg.role === "toolResult") {
        e--;
        continue;
      }
      break;
    }
    return e;
  }
  buildSummary(messages) {
    if (messages.length === 0) return "";
    const userCount = messages.filter((m) => m.role === "user").length;
    const assistantCount = messages.filter(
      (m) => m.role === "assistant"
    ).length;
    const toolResultCount = messages.filter(
      (m) => m.role === "toolResult"
    ).length;
    return `[Conversation summary: ${messages.length} earlier messages compacted (user=${userCount}, assistant=${assistantCount}, toolResult=${toolResultCount}). Earlier context omitted to fit window.]`;
  }
}
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_RECOVERY_RETRIES = 2;
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_ESCALATED_MAX_TOKENS = 16384;
const OVERLOAD_SWITCH_THRESHOLD = 3;
const RETRY_BASE_MS = 1e3;
const RETRY_JITTER_MS = 500;
class ErrorRecovery {
  state;
  maxRetries;
  maxRecoveryRetries;
  defaultMaxTokens;
  escalatedMaxTokens;
  fallbackModel;
  constructor(options) {
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxRecoveryRetries = options.maxRecoveryRetries ?? DEFAULT_MAX_RECOVERY_RETRIES;
    this.defaultMaxTokens = options.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;
    this.escalatedMaxTokens = options.escalatedMaxTokens ?? DEFAULT_ESCALATED_MAX_TOKENS;
    this.fallbackModel = options.fallbackModel;
    this.state = {
      hasEscalated: false,
      recoveryCount: 0,
      consecutiveOverloads: 0,
      hasAttemptedReactiveCompact: false,
      currentModel: options.primaryModel
    };
  }
  /** 分类错误。 */
  classifyError(error) {
    const raw = `${error.message ?? ""} ${error.name ?? ""}`.toLowerCase();
    const status = this.extractStatusCode(error);
    if (raw.includes("context_length_exceeded") || raw.includes("context length") || raw.includes("maximum context length") || raw.includes("prompt") && raw.includes("long") || raw.includes("input") && raw.includes("too") && raw.includes("long")) {
      return "prompt_too_long";
    }
    if (status === 429 || raw.includes("rate") && raw.includes("limit")) {
      return "rate_limit";
    }
    if (status === 529 || status === 503 || raw.includes("overloaded") || raw.includes("service unavailable")) {
      return "overloaded";
    }
    if (status === 401 || status === 403 || raw.includes("unauthorized") || raw.includes("forbidden") || raw.includes("invalid api key") || raw.includes("authentication")) {
      return "auth_error";
    }
    if (raw.includes("econnrefused") || raw.includes("econnreset") || raw.includes("etimedout") || raw.includes("enotfound") || raw.includes("network") || raw.includes("timeout") || raw.includes("aborterror") || raw.includes("socket")) {
      return "network_error";
    }
    if (status !== void 0 && status >= 500 || raw.includes("internal server")) {
      return "server_error";
    }
    return "unknown";
  }
  /** 判断是否为 prompt too long 错误。 */
  isPromptTooLong(error) {
    return this.classifyError(error) === "prompt_too_long";
  }
  /**
   * 决定恢复动作。
   *
   * 优先级见类型声明处的列表（rate → overload → prompt → tokens → auth → network → server）。
   */
  decide(error, stopReason) {
    if (stopReason === "length") {
      if (!this.state.hasEscalated) {
        return {
          type: "escalate_tokens",
          newMaxTokens: this.escalatedMaxTokens
        };
      }
      if (this.state.recoveryCount < this.maxRecoveryRetries) {
        return { type: "continue_prompt" };
      }
      return {
        type: "abort",
        reason: "max_tokens reached and recovery limit exhausted; aborting"
      };
    }
    if (!error) {
      return { type: "abort", reason: "no error and no recoverable stop_reason" };
    }
    const category = this.classifyError(error);
    switch (category) {
      case "rate_limit": {
        if (this.state.recoveryCount >= this.maxRetries) {
          return {
            type: "abort",
            reason: "rate limit retries exhausted"
          };
        }
        return {
          type: "retry",
          delayMs: this.getRetryDelay(this.state.recoveryCount)
        };
      }
      case "overloaded": {
        this.state.consecutiveOverloads += 1;
        if (this.state.consecutiveOverloads >= OVERLOAD_SWITCH_THRESHOLD && this.fallbackModel && this.fallbackModel.id !== this.state.currentModel.id) {
          const fallback = this.fallbackModel;
          this.state.currentModel = fallback;
          this.state.consecutiveOverloads = 0;
          return { type: "switch_model", fallbackModel: fallback };
        }
        if (this.state.recoveryCount >= this.maxRetries) {
          return {
            type: "abort",
            reason: "overloaded retries exhausted and no fallback available"
          };
        }
        return {
          type: "retry",
          delayMs: this.getRetryDelay(this.state.recoveryCount)
        };
      }
      case "prompt_too_long": {
        if (!this.state.hasAttemptedReactiveCompact) {
          return { type: "reactive_compact" };
        }
        return {
          type: "abort",
          reason: "prompt too long even after reactive compact"
        };
      }
      case "max_tokens": {
        if (!this.state.hasEscalated) {
          return {
            type: "escalate_tokens",
            newMaxTokens: this.escalatedMaxTokens
          };
        }
        if (this.state.recoveryCount < this.maxRecoveryRetries) {
          return { type: "continue_prompt" };
        }
        return {
          type: "abort",
          reason: "max_tokens reached and recovery limit exhausted"
        };
      }
      case "auth_error": {
        return {
          type: "abort",
          reason: "authentication failed; check API key"
        };
      }
      case "network_error":
      case "server_error": {
        if (this.state.recoveryCount >= this.maxRetries) {
          return {
            type: "abort",
            reason: `${category} retries exhausted`
          };
        }
        return {
          type: "retry",
          delayMs: this.getRetryDelay(this.state.recoveryCount)
        };
      }
      case "unknown":
      default: {
        return { type: "abort", reason: `unrecoverable error: ${error.message}` };
      }
    }
  }
  /** 计算指数退避（含 0–500ms 抖动）。 */
  getRetryDelay(attempt) {
    const exp = Math.pow(2, Math.max(0, attempt));
    const base = RETRY_BASE_MS * exp;
    const jitter = Math.floor(Math.random() * RETRY_JITTER_MS);
    return base + jitter;
  }
  /** 重置状态（保留 currentModel）。 */
  reset() {
    this.state = {
      hasEscalated: false,
      recoveryCount: 0,
      consecutiveOverloads: 0,
      hasAttemptedReactiveCompact: false,
      currentModel: this.state.currentModel
    };
  }
  /** 获取当前模型。 */
  getCurrentModel() {
    return this.state.currentModel;
  }
  /** 标记升级完成。 */
  markEscalated() {
    this.state.hasEscalated = true;
    this.state.recoveryCount += 1;
  }
  /** 标记 reactive compact 已尝试。 */
  markReactiveCompactAttempted() {
    this.state.hasAttemptedReactiveCompact = true;
    this.state.recoveryCount += 1;
  }
  /** 用于上层在执行重试后递增计数。 */
  noteRetryAttempt() {
    this.state.recoveryCount += 1;
  }
  /** 配置中读取的默认 max_tokens（首次未升级时使用）。 */
  getDefaultMaxTokens() {
    return this.defaultMaxTokens;
  }
  /** 暴露状态快照，便于上层观察 / 测试。 */
  getState() {
    return { ...this.state };
  }
  // -------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------
  extractStatusCode(error) {
    const e = error;
    const direct = e.status ?? e.statusCode;
    if (typeof direct === "number") return direct;
    const response = e.response;
    if (response && typeof response.status === "number") {
      return response.status;
    }
    const match = error.message?.match(/\b(4\d{2}|5\d{2})\b/);
    if (match) {
      const code = Number(match[1]);
      if (!Number.isNaN(code)) return code;
    }
    return void 0;
  }
}
class HandoffController {
  /**
   * 解析并校验 handoff 请求。
   *
   * @param fromAgentId 源 profile（当前活跃 agent）
   * @param toProfile 目标 profile id（agent_handoff 工具的 agent 参数）
   * @param promptOverride 调用方提供的 prompt（缺省时从目标 profile handoffs 定义取）
   * @param labelOverride 调用方提供的 label
   */
  resolve(fromAgentId, toProfile, promptOverride, labelOverride) {
    const target = toProfile.trim();
    if (!target) {
      return { valid: false, reason: "Handoff target profile is empty." };
    }
    const definitions = settingsService.getAll().agents.definitions;
    const targetDef = definitions.find((d) => d.id === target && d.enabled);
    if (!targetDef) {
      return { valid: false, reason: `Target profile "${target}" is not enabled or does not exist.` };
    }
    const sourceDef = definitions.find((d) => d.id === fromAgentId && d.enabled);
    if (sourceDef && sourceDef.handoffs.length > 0) {
      const allowed = sourceDef.handoffs.some((h) => h.agent === target);
      if (!allowed) {
        return {
          valid: false,
          reason: `Profile "${fromAgentId}" does not declare a handoff to "${target}".`
        };
      }
    }
    const declared = sourceDef?.handoffs.find((h) => h.agent === target);
    const prompt = (promptOverride?.trim() || declared?.prompt || `Continue from ${fromAgentId} as ${target}.`).trim();
    const label = (labelOverride?.trim() || declared?.label || `Hand off to ${target}`).trim();
    return {
      valid: true,
      request: { fromAgentId, toProfile: target, prompt, label }
    };
  }
}
const handoffController = new HandoffController();
function toolToDefinition(tool) {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  };
}
let temporaryAllowedPathRoots = [];
async function withTemporaryPathAccess(roots, run) {
  const previous = temporaryAllowedPathRoots;
  temporaryAllowedPathRoots = [
    ...previous,
    ...roots.map((root) => normalizeInputPath(root))
  ];
  try {
    return await run();
  } finally {
    temporaryAllowedPathRoots = previous;
  }
}
function getWorkspaceRoot(context2) {
  if (context2?.projectRootPath) {
    return path__namespace.resolve(context2.projectRootPath);
  }
  const fromEnv = process.env.RDC_WORKSPACE_ROOT?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return path__namespace.resolve(fromEnv);
  }
  return path__namespace.resolve(process.cwd());
}
function normalizeInputPath(input) {
  const trimmed = input.trim();
  if (trimmed === "~") return os__namespace.homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path__namespace.resolve(os__namespace.homedir(), trimmed.slice(2));
  }
  return trimmed.replace(/^%USERPROFILE%/i, os__namespace.homedir());
}
function isWithinRoot$1(target, root) {
  if (root === "*") return true;
  const resolvedRoot = path__namespace.resolve(root);
  const rel = path__namespace.relative(resolvedRoot, target);
  return rel === "" || !rel.startsWith("..") && !path__namespace.isAbsolute(rel);
}
function safeResolvePath(input, root, context2) {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("路径不能为空");
  }
  const workspaceRoot = root ?? getWorkspaceRoot(context2);
  const expandedInput = normalizeInputPath(input);
  const target = path__namespace.isAbsolute(expandedInput) ? path__namespace.resolve(expandedInput) : path__namespace.resolve(workspaceRoot, expandedInput);
  const rel = path__namespace.relative(workspaceRoot, target);
  if ((rel.startsWith("..") || path__namespace.isAbsolute(rel)) && !temporaryAllowedPathRoots.some((root2) => isWithinRoot$1(target, root2))) {
    throw new Error(`路径 "${input}" 超出 workspace (${workspaceRoot})`);
  }
  return target;
}
function truncateOutput(text, maxBytes = 50 * 1024) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return text;
  }
  const head = Math.floor(maxBytes * 0.7);
  const tail = Math.floor(maxBytes * 0.2);
  const omitted = Buffer.byteLength(text, "utf8") - head - tail;
  return text.slice(0, head) + `
... [truncated ${omitted} bytes] ...
` + text.slice(text.length - tail);
}
const MAX_OUTPUT_CHARS = 1e4;
const NOTIFICATION_TAIL_CHARS = 500;
class BackgroundTaskRunner {
  /** 任务表：bgTaskId → BackgroundTask。 */
  tasks = /* @__PURE__ */ new Map();
  /** 子进程引用：bgTaskId → ChildProcess（用于 abort/kill）。 */
  children = /* @__PURE__ */ new Map();
  /**
   * 启动一个后台任务。
   *
   * @param command shell 命令字符串
   * @param cwd 工作目录
   * @param signal 可选的 AbortSignal；触发后会 SIGTERM 子进程
   * @returns 新生成的 bgTaskId
   */
  startBackground(command, cwd, signal) {
    const id = generateBgTaskId();
    const startedAt = Date.now();
    const task = {
      id,
      command,
      cwd,
      status: "running",
      output: "",
      startedAt,
      notified: false
    };
    this.tasks.set(id, task);
    let child;
    try {
      child = child_process.spawn(command, {
        cwd,
        shell: true,
        env: process.env,
        windowsHide: true
      });
    } catch (err) {
      this.markFinished(id, "failed", void 0, formatSpawnError(err));
      return id;
    }
    this.children.set(id, child);
    const appendOutput = (chunk) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const current = this.tasks.get(id);
      if (!current) return;
      const next = current.output + text;
      current.output = next.length > MAX_OUTPUT_CHARS ? next.slice(next.length - MAX_OUTPUT_CHARS) : next;
    };
    child.stdout?.on("data", appendOutput);
    child.stderr?.on("data", appendOutput);
    const onAbort = () => {
      try {
        child.kill("SIGTERM");
      } catch {
      }
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }
    child.on("error", (err) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      const current = this.tasks.get(id);
      if (current) {
        current.output += `
[spawn error] ${err.message}`;
        if (current.output.length > MAX_OUTPUT_CHARS) {
          current.output = current.output.slice(
            current.output.length - MAX_OUTPUT_CHARS
          );
        }
      }
      this.markFinished(id, "failed", void 0);
    });
    child.on("close", (code, sig) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      const finalStatus = code === 0 ? "completed" : "failed";
      const exit = typeof code === "number" ? code : void 0;
      if (sig) {
        const current = this.tasks.get(id);
        if (current) {
          current.output += `
[terminated by signal ${sig}]`;
          if (current.output.length > MAX_OUTPUT_CHARS) {
            current.output = current.output.slice(
              current.output.length - MAX_OUTPUT_CHARS
            );
          }
        }
      }
      this.markFinished(id, finalStatus, exit);
    });
    return id;
  }
  /** 查询任务状态；不存在返回 null。 */
  getStatus(bgTaskId) {
    const task = this.tasks.get(bgTaskId);
    return task ? { ...task } : null;
  }
  /**
   * 获取所有"已完成且尚未通知"的任务，并将其标记为已通知。
   * 返回值是任务快照，调用方可安全持有。
   */
  getCompletedResults() {
    const ready = [];
    for (const task of this.tasks.values()) {
      if (task.status !== "running" && task.notified === false) {
        task.notified = true;
        ready.push({ ...task });
      }
    }
    return ready;
  }
  /**
   * 构造给 Agent 的后台任务完成通知文本。
   * 调用此方法会消费掉所有"未通知的已完成任务"。
   * 如果当前没有待通知任务，返回 null。
   */
  buildNotificationMessage() {
    const finished = this.getCompletedResults();
    if (finished.length === 0) return null;
    const blocks = finished.map((task) => formatNotificationBlock(task));
    return blocks.join("\n");
  }
  /** 列出当前仍在运行的任务快照。 */
  listRunning() {
    const running = [];
    for (const task of this.tasks.values()) {
      if (task.status === "running") {
        running.push({ ...task });
      }
    }
    return running;
  }
  /**
   * 清理已通知的非运行态任务，释放内存。
   * 不会清理仍在运行或尚未通知的任务。
   */
  cleanup() {
    for (const [id, task] of this.tasks) {
      if (task.status !== "running" && task.notified === true) {
        this.tasks.delete(id);
        this.children.delete(id);
      }
    }
  }
  /** 内部：把任务推进到终止态并清理子进程引用。 */
  markFinished(id, status, exitCode, extraOutput) {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.status !== "running") return;
    if (extraOutput) {
      const next = task.output + extraOutput;
      task.output = next.length > MAX_OUTPUT_CHARS ? next.slice(next.length - MAX_OUTPUT_CHARS) : next;
    }
    task.status = status;
    task.exitCode = exitCode;
    task.completedAt = Date.now();
    this.children.delete(id);
  }
}
let singleton = null;
function getBackgroundTaskRunner() {
  if (singleton === null) {
    singleton = new BackgroundTaskRunner();
  }
  return singleton;
}
function generateBgTaskId() {
  const hex = crypto.randomBytes(4).toString("hex");
  return `bg_${Date.now()}_${hex}`;
}
function formatSpawnError(err) {
  if (err instanceof Error) {
    return `[spawn error] ${err.message}`;
  }
  return `[spawn error] ${String(err)}`;
}
function formatNotificationBlock(task) {
  const tail = task.output.length > NOTIFICATION_TAIL_CHARS ? task.output.slice(task.output.length - NOTIFICATION_TAIL_CHARS) : task.output;
  const exitLine = typeof task.exitCode === "number" ? `Exit code: ${task.exitCode}` : `Exit code: (none)`;
  return [
    `<bg_task_completed id="${task.id}">`,
    `Command: ${task.command}`,
    exitLine,
    `Output (last ${NOTIFICATION_TAIL_CHARS} chars):`,
    tail,
    `</bg_task_completed>`
  ].join("\n");
}
path$1.join(".rdc-agent", "cron");
const DEFAULT_TIMEOUT_MS$1 = 12e4;
const MAX_OUTPUT_BYTES$3 = 50 * 1024;
const bashTool = {
  name: "bash",
  label: "终端命令",
  description: "Run a shell command in the workspace directory. Use for file operations, git, build tools, etc. Output is captured (stdout+stderr) and truncated at 50KB.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute"
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 120000)"
      },
      run_in_background: {
        type: "boolean",
        description: "Run the command in the background without waiting for completion"
      }
    },
    required: ["command"]
  },
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: true, sideEffect: "process", category: "system", requiresApproval: true },
  permissionHint: "mutation",
  async execute(_toolCallId, params, signal, onUpdate, context2) {
    const command = params.command;
    const timeoutMs = params.timeout ?? DEFAULT_TIMEOUT_MS$1;
    const cwd = getWorkspaceRoot(context2);
    const startedAt = Date.now();
    if (params.run_in_background === true) {
      const runner = getBackgroundTaskRunner();
      const bgTaskId = runner.startBackground(command, cwd, signal);
      const text = `[Background task ${bgTaskId} started]
Command: ${command}
Result will be delivered via background task notification when complete.`;
      return {
        content: [{ type: "text", text }],
        details: {
          command,
          exitCode: null,
          signal: null,
          durationMs: Date.now() - startedAt,
          truncated: false,
          cwd,
          bgTaskId
        }
      };
    }
    const isWindows = process.platform === "win32";
    const shell = isWindows ? process.env.ComSpec || "cmd.exe" : "/bin/sh";
    const shellArgs = isWindows ? ["/d", "/s", "/c", command] : ["-c", command];
    return await new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let aborted = false;
      const child = child_process.spawn(shell, shellArgs, {
        cwd,
        env: process.env,
        windowsHide: true
      });
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGTERM");
        } catch {
        }
      }, timeoutMs);
      const onAbort = () => {
        aborted = true;
        try {
          child.kill("SIGTERM");
        } catch {
        }
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }
      const emitUpdate = () => {
        if (!onUpdate) return;
        const text = combineOutput(stdout, stderr);
        onUpdate({
          content: [{ type: "text", text: truncateOutput(text, MAX_OUTPUT_BYTES$3) }]
        });
      };
      child.stdout?.on("data", (chunk) => {
        stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        emitUpdate();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        emitUpdate();
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        const text = combineOutput(stdout, stderr) + `
[spawn error] ${err.message}`;
        const truncated = Buffer.byteLength(text, "utf8") > MAX_OUTPUT_BYTES$3;
        resolve({
          content: [
            { type: "text", text: truncateOutput(text, MAX_OUTPUT_BYTES$3) }
          ],
          details: {
            command,
            exitCode: null,
            signal: null,
            durationMs: Date.now() - startedAt,
            truncated,
            cwd
          }
        });
      });
      child.on("close", (code, sig) => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        let combined = combineOutput(stdout, stderr);
        if (timedOut) {
          combined += `
[timeout] command exceeded ${timeoutMs}ms`;
        }
        if (aborted) {
          combined += `
[aborted]`;
        }
        const truncated = Buffer.byteLength(combined, "utf8") > MAX_OUTPUT_BYTES$3;
        resolve({
          content: [
            { type: "text", text: truncateOutput(combined, MAX_OUTPUT_BYTES$3) }
          ],
          details: {
            command,
            exitCode: code,
            signal: sig,
            durationMs: Date.now() - startedAt,
            truncated,
            cwd
          }
        });
      });
    });
  }
};
function combineOutput(stdout, stderr) {
  if (!stderr) return stdout;
  if (!stdout) return stderr;
  return `${stdout}
${stderr}`;
}
const DEFAULT_LIMIT = 2e3;
const MAX_OUTPUT_BYTES$2 = 200 * 1024;
const readFileTool = {
  name: "read_file",
  label: "读取文件",
  description: "Read the contents of a file in the workspace. Supports line offset (1-based) and limit. Default limit is 2000 lines.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Relative or absolute path inside the workspace."
      },
      offset: {
        type: "integer",
        description: "Start line number (1-based, default: 1)."
      },
      limit: {
        type: "integer",
        description: "Maximum number of lines to read (default: 2000)."
      }
    },
    required: ["path"]
  },
  spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: "none", category: "file", requiresApproval: false },
  permissionHint: "readonly",
  async execute(_toolCallId, params, signal, _onUpdate, context2) {
    if (signal?.aborted) {
      throw new Error("Aborted");
    }
    const absolute = safeResolvePath(params.path, void 0, context2);
    const offset = Math.max(1, Math.floor(params.offset ?? 1));
    const limit = Math.max(1, Math.floor(params.limit ?? DEFAULT_LIMIT));
    const raw = await fs__namespace$1.readFile(absolute, "utf8");
    if (signal?.aborted) {
      throw new Error("Aborted");
    }
    const lines = raw.split(/\r?\n/);
    const totalLines = lines.length;
    const startIdx = offset - 1;
    const endIdx = Math.min(totalLines, startIdx + limit);
    const slice = lines.slice(startIdx, endIdx);
    const numbered = slice.map((line, i) => `${String(startIdx + i + 1).padStart(6, " ")}→${line}`).join("\n");
    const text = truncateOutput(numbered, MAX_OUTPUT_BYTES$2);
    const truncated = Buffer.byteLength(numbered, "utf8") > MAX_OUTPUT_BYTES$2 || endIdx < totalLines;
    return {
      content: [{ type: "text", text }],
      details: {
        path: absolute,
        totalLines,
        offset,
        limit,
        truncated
      }
    };
  }
};
const writeFileTool = {
  name: "write_file",
  label: "写入文件",
  description: "Write content to a file inside the workspace. Creates the file (and parent directories) if needed; overwrites if it exists.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Target file path (relative or absolute, must be inside workspace)."
      },
      content: {
        type: "string",
        description: "Full file content to write."
      }
    },
    required: ["path", "content"]
  },
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: false, sideEffect: "filesystem", category: "file", requiresApproval: true },
  permissionHint: "mutation",
  async execute(_toolCallId, params, signal, _onUpdate, context2) {
    if (signal?.aborted) {
      throw new Error("Aborted");
    }
    const absolute = safeResolvePath(params.path, void 0, context2);
    const dir = path__namespace.dirname(absolute);
    let created = true;
    try {
      await fs__namespace$1.access(absolute);
      created = false;
    } catch {
      created = true;
    }
    await fs__namespace$1.mkdir(dir, { recursive: true });
    if (signal?.aborted) {
      throw new Error("Aborted");
    }
    await fs__namespace$1.writeFile(absolute, params.content, "utf8");
    const bytesWritten = Buffer.byteLength(params.content, "utf8");
    const text = `${created ? "Created" : "Overwrote"} ${absolute} (${bytesWritten} bytes)`;
    return {
      content: [{ type: "text", text }],
      details: {
        path: absolute,
        bytesWritten,
        created
      }
    };
  }
};
const editFileTool = {
  name: "edit_file",
  label: "编辑文件",
  description: "Edit a file by replacing old_text with new_text. The old_text must match exactly and appear exactly once in the file.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Target file path (relative or absolute, must be inside workspace)."
      },
      old_text: {
        type: "string",
        description: "The exact text to replace. Must match exactly and uniquely."
      },
      new_text: {
        type: "string",
        description: "The replacement text."
      }
    },
    required: ["path", "old_text", "new_text"]
  },
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: false, sideEffect: "filesystem", category: "file", requiresApproval: true },
  permissionHint: "mutation",
  async execute(_toolCallId, params, signal, _onUpdate, context2) {
    if (signal?.aborted) {
      throw new Error("Aborted");
    }
    if (params.old_text.length === 0) {
      throw new Error("old_text 不能为空");
    }
    if (params.old_text === params.new_text) {
      throw new Error("old_text 与 new_text 相同，无需编辑");
    }
    const absolute = safeResolvePath(params.path, void 0, context2);
    const original = await fs__namespace$1.readFile(absolute, "utf8");
    if (signal?.aborted) {
      throw new Error("Aborted");
    }
    const firstIdx = original.indexOf(params.old_text);
    if (firstIdx < 0) {
      throw new Error("old_text 未在文件中找到");
    }
    const secondIdx = original.indexOf(
      params.old_text,
      firstIdx + params.old_text.length
    );
    if (secondIdx >= 0) {
      throw new Error("old_text 在文件中出现多次，请提供更精确的上下文");
    }
    const updated = original.slice(0, firstIdx) + params.new_text + original.slice(firstIdx + params.old_text.length);
    await fs__namespace$1.writeFile(absolute, updated, "utf8");
    return {
      content: [
        {
          type: "text",
          text: `Edited ${absolute}: replaced 1 occurrence (${params.old_text.length} → ${params.new_text.length} chars).`
        }
      ],
      details: {
        path: absolute,
        oldLength: params.old_text.length,
        newLength: params.new_text.length,
        occurrence: 1,
        delta: params.new_text.length - params.old_text.length
      }
    };
  }
};
const MAX_RESULTS = 1e3;
const DEFAULT_IGNORED_DIRS$1 = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "out",
  "release",
  "dist",
  ".qoder",
  ".tmp",
  "test-results",
  ".codex"
]);
const globTool = {
  name: "glob",
  label: "文件搜索",
  description: "Search for files matching a glob pattern in the workspace. Supports *, **, ?, {a,b}, and [abc].",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: 'Glob pattern, e.g. "src/**/*.ts" or "**/*.{json,md}".'
      },
      cwd: {
        type: "string",
        description: "Optional sub-directory inside the workspace to search from (default: workspace root)."
      }
    },
    required: ["pattern"]
  },
  spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: "none", category: "search", requiresApproval: false },
  permissionHint: "readonly",
  async execute(_toolCallId, params, signal, _onUpdate, context2) {
    if (signal?.aborted) {
      throw new Error("Aborted");
    }
    const workspaceRoot = getWorkspaceRoot(context2);
    const externalPattern = params.cwd ? null : splitExternalPattern(params.pattern);
    const baseDir = params.cwd ? safeResolvePath(params.cwd, workspaceRoot, context2) : externalPattern ? safeResolvePath(externalPattern.baseDir, workspaceRoot, context2) : workspaceRoot;
    const pattern = externalPattern?.pattern ?? params.pattern;
    const regex = compileGlob(pattern);
    const matches = [];
    let truncated = false;
    await walk(baseDir, baseDir, async (relPath) => {
      if (signal?.aborted) {
        throw new Error("Aborted");
      }
      const normalized = relPath.split(path__namespace.sep).join("/");
      if (regex.test(normalized)) {
        if (matches.length >= MAX_RESULTS) {
          truncated = true;
          return false;
        }
        matches.push(normalized);
      }
      return true;
    });
    matches.sort();
    const text = matches.length === 0 ? `(no matches for pattern "${pattern}")` : matches.join("\n") + (truncated ? `
... [truncated at ${MAX_RESULTS}]` : "");
    return {
      content: [{ type: "text", text }],
      details: {
        pattern,
        cwd: baseDir,
        matched: matches.length,
        truncated
      }
    };
  }
};
function expandUserPath(value) {
  const trimmed = value.trim();
  if (trimmed === "~") return os__namespace.homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path__namespace.resolve(os__namespace.homedir(), trimmed.slice(2));
  }
  return trimmed.replace(/^%USERPROFILE%/i, os__namespace.homedir());
}
function splitExternalPattern(pattern) {
  const expanded = expandUserPath(pattern);
  if (!path__namespace.isAbsolute(expanded)) return null;
  const wildcardIndex = expanded.search(/[*?{[]/);
  if (wildcardIndex < 0) {
    return {
      baseDir: path__namespace.dirname(expanded),
      pattern: path__namespace.basename(expanded)
    };
  }
  const sepIndex = Math.max(expanded.lastIndexOf("/", wildcardIndex), expanded.lastIndexOf("\\", wildcardIndex));
  const baseDir = sepIndex > 0 ? expanded.slice(0, sepIndex) : path__namespace.parse(expanded).root;
  const normalizedPattern = expanded.slice(sepIndex + 1).replace(/\\/g, "/");
  return {
    baseDir,
    pattern: normalizedPattern || "*"
  };
}
function compileGlob(pattern) {
  let i = 0;
  let out = "^";
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 3;
          continue;
        }
        out += ".*";
        i += 2;
        continue;
      }
      out += "[^/]*";
      i++;
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      i++;
      continue;
    }
    if (ch === "{") {
      const end = pattern.indexOf("}", i);
      if (end < 0) {
        out += escapeReg(ch);
        i++;
        continue;
      }
      const parts = pattern.slice(i + 1, end).split(",").map((p) => p.trim()).filter(Boolean);
      if (parts.length === 0) {
        out += escapeReg(ch);
        i++;
        continue;
      }
      out += "(?:" + parts.map((p) => compileGlob(p).source.replace(/^\^|\$$/g, "")).join("|") + ")";
      i = end + 1;
      continue;
    }
    if (ch === "[") {
      const end = pattern.indexOf("]", i);
      if (end < 0) {
        out += escapeReg(ch);
        i++;
        continue;
      }
      out += pattern.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    out += escapeReg(ch);
    i++;
  }
  out += "$";
  return new RegExp(out);
}
function escapeReg(ch) {
  if (/[.+^$()|\\]/.test(ch)) return "\\" + ch;
  return ch;
}
async function walk(root, current, visit) {
  let entries;
  try {
    entries = await fs__namespace$1.readdir(current, { withFileTypes: true });
  } catch {
    return true;
  }
  for (const entry of entries) {
    const abs = path__namespace.join(current, entry.name);
    if (entry.isDirectory()) {
      if (DEFAULT_IGNORED_DIRS$1.has(entry.name)) {
        continue;
      }
      const cont = await walk(root, abs, visit);
      if (!cont) return false;
    } else if (entry.isFile()) {
      const rel = path__namespace.relative(root, abs);
      const cont = await visit(rel);
      if (!cont) return false;
    }
  }
  return true;
}
const DEFAULT_MAX_MATCHES = 200;
const MAX_OUTPUT_BYTES$1 = 120 * 1024;
const DEFAULT_IGNORED_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "out",
  "release",
  "dist",
  ".qoder",
  ".tmp",
  "test-results",
  ".codex"
]);
const grepTool = {
  name: "grep",
  label: "Search Text",
  description: "Search text files in the workspace using a JavaScript regular expression or plain text pattern.",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Text or JavaScript regular expression to search for."
      },
      path: {
        type: "string",
        description: "Optional file or directory inside the workspace. Defaults to workspace root."
      },
      caseSensitive: {
        type: "boolean",
        description: "Whether matching is case-sensitive. Defaults to false."
      },
      maxMatches: {
        type: "integer",
        description: "Maximum matching lines to return. Defaults to 200."
      }
    },
    required: ["pattern"]
  },
  spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: "none", category: "search", requiresApproval: false },
  permissionHint: "readonly",
  async execute(_toolCallId, params, signal, _onUpdate, context2) {
    throwIfAborted$1(signal);
    const workspaceRoot = getWorkspaceRoot(context2);
    const root = params.path ? safeResolvePath(params.path, workspaceRoot, context2) : workspaceRoot;
    const maxMatches = Math.max(1, Math.min(1e3, Math.floor(params.maxMatches ?? DEFAULT_MAX_MATCHES)));
    const regex = compilePattern(params.pattern, params.caseSensitive === true);
    const matches = [];
    const matchedFiles = /* @__PURE__ */ new Set();
    let truncated = false;
    const stat = await fs__namespace$1.stat(root);
    if (stat.isFile()) {
      await searchFile(root, workspaceRoot, regex, matches, matchedFiles, maxMatches, signal);
    } else if (stat.isDirectory()) {
      await walkAndSearch(root, workspaceRoot, regex, matches, matchedFiles, maxMatches, signal);
    } else {
      throw new Error(`Unsupported path type: ${root}`);
    }
    if (matches.length >= maxMatches) {
      truncated = true;
    }
    const rawText = matches.length > 0 ? matches.join("\n") : `(no matches for pattern "${params.pattern}")`;
    const text = truncateOutput(rawText, MAX_OUTPUT_BYTES$1);
    truncated = truncated || Buffer.byteLength(rawText, "utf8") > MAX_OUTPUT_BYTES$1;
    return {
      content: [{ type: "text", text }],
      details: {
        pattern: params.pattern,
        root,
        matchedFiles: matchedFiles.size,
        matchedLines: matches.length,
        truncated
      }
    };
  }
};
function compilePattern(pattern, caseSensitive) {
  if (!pattern || !pattern.trim()) {
    throw new Error("pattern cannot be empty");
  }
  try {
    return new RegExp(pattern, caseSensitive ? "g" : "gi");
  } catch {
    return new RegExp(escapeRegExp(pattern), caseSensitive ? "g" : "gi");
  }
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
async function walkAndSearch(current, workspaceRoot, regex, matches, matchedFiles, maxMatches, signal) {
  throwIfAborted$1(signal);
  const entries = await fs__namespace$1.readdir(current, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (matches.length >= maxMatches) return;
    const absolute = path__namespace.join(current, entry.name);
    if (entry.isDirectory()) {
      if (!DEFAULT_IGNORED_DIRS.has(entry.name)) {
        await walkAndSearch(absolute, workspaceRoot, regex, matches, matchedFiles, maxMatches, signal);
      }
    } else if (entry.isFile()) {
      await searchFile(absolute, workspaceRoot, regex, matches, matchedFiles, maxMatches, signal);
    }
  }
}
async function searchFile(absolute, workspaceRoot, regex, matches, matchedFiles, maxMatches, signal) {
  throwIfAborted$1(signal);
  if (matches.length >= maxMatches) return;
  const buffer = await fs__namespace$1.readFile(absolute).catch(() => null);
  if (!buffer || buffer.includes(0)) return;
  const text = buffer.toString("utf8");
  const rel = path__namespace.relative(workspaceRoot, absolute).split(path__namespace.sep).join("/");
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length && matches.length < maxMatches; index += 1) {
    regex.lastIndex = 0;
    if (regex.test(lines[index])) {
      matchedFiles.add(rel);
      matches.push(`${rel}:${index + 1}: ${lines[index]}`);
    }
  }
}
function throwIfAborted$1(signal) {
  if (signal?.aborted) {
    throw new Error("Aborted");
  }
}
const execFileAsync = util.promisify(child_process.execFile);
const MAX_OUTPUT_BYTES = 64 * 1024;
async function runGit(cwd, args) {
  try {
    const result = await execFileAsync("git", ["-c", "core.quotepath=false", ...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: MAX_OUTPUT_BYTES * 2,
      windowsHide: true
    });
    return {
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? "")
    };
  } catch (error) {
    const err = error;
    const output = [String(err.stdout ?? "").trim(), String(err.stderr ?? "").trim(), err.message].filter(Boolean).join("\n");
    throw new Error(output);
  }
}
async function resolveGitRoot(workspaceRoot) {
  const output = await runGit(workspaceRoot, ["rev-parse", "--show-toplevel"]);
  return path.resolve(output.stdout.trim());
}
function validateGitPath(input) {
  const value = String(input ?? "").trim().replace(/\\/g, "/");
  if (!value || value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    throw new Error(`Invalid git path: ${input}`);
  }
  if (value.split("/").includes("..")) {
    throw new Error(`Invalid git path: ${input}`);
  }
  return value;
}
function createResult(cwd, args, output) {
  return {
    content: [{ type: "text", text: truncateOutput(output || "No output.", MAX_OUTPUT_BYTES) }],
    details: { cwd, args }
  };
}
async function executeGit(args, contextRoot) {
  const gitRoot = await resolveGitRoot(contextRoot);
  const output = await runGit(gitRoot, args);
  const text = [output.stdout.trim(), output.stderr.trim()].filter(Boolean).join("\n");
  return createResult(gitRoot, args, text);
}
const gitStatusTool = {
  name: "git_status",
  label: "Git status",
  description: "Show git status for the current project repository.",
  parameters: {
    type: "object",
    properties: {
      short: { type: "boolean", description: "Use concise porcelain output. Defaults to true." }
    }
  },
  spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: "none", category: "system", requiresApproval: false },
  permissionHint: "readonly",
  async execute(_toolCallId, params, _signal, _onUpdate, context2) {
    const root = getWorkspaceRoot(context2);
    const args = params.short === false ? ["status", "-sb"] : ["status", "--porcelain=v1", "-b", "-uall"];
    return executeGit(args, root);
  }
};
const gitDiffTool = {
  name: "git_diff",
  label: "Git diff",
  description: "Show git diff for the current project repository.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Optional repository-relative path." },
      staged: { type: "boolean", description: "Show staged diff." },
      stat: { type: "boolean", description: "Show diff stat instead of patch." }
    }
  },
  spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: "none", category: "system", requiresApproval: false },
  permissionHint: "readonly",
  async execute(_toolCallId, params, _signal, _onUpdate, context2) {
    const root = getWorkspaceRoot(context2);
    const args = ["diff"];
    if (params.stat) args.push("--stat");
    if (params.staged) args.push("--cached");
    if (params.path) args.push("--", validateGitPath(params.path));
    return executeGit(args, root);
  }
};
const gitLogTool = {
  name: "git_log",
  label: "Git log",
  description: "Show recent git commits for the current project repository.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "integer", description: "Maximum commits to show, 1-50. Defaults to 10." }
    }
  },
  spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: "none", category: "system", requiresApproval: false },
  permissionHint: "readonly",
  async execute(_toolCallId, params, _signal, _onUpdate, context2) {
    const root = getWorkspaceRoot(context2);
    const limit = Math.max(1, Math.min(50, Math.floor(params.limit ?? 10)));
    return executeGit(["log", "--oneline", `-${limit}`], root);
  }
};
const gitAddTool = {
  name: "git_add",
  label: "Git add",
  description: "Stage a repository-relative path in the current project repository.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Repository-relative file or directory path to stage." }
    },
    required: ["path"]
  },
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: false, sideEffect: "filesystem", category: "system", requiresApproval: true },
  permissionHint: "mutation",
  async execute(_toolCallId, params, _signal, _onUpdate, context2) {
    const root = getWorkspaceRoot(context2);
    return executeGit(["add", "--", validateGitPath(params.path)], root);
  }
};
const gitUnstageTool = {
  name: "git_unstage",
  label: "Git unstage",
  description: "Unstage a repository-relative path in the current project repository.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Repository-relative file or directory path to unstage." }
    },
    required: ["path"]
  },
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: false, sideEffect: "filesystem", category: "system", requiresApproval: true },
  permissionHint: "mutation",
  async execute(_toolCallId, params, _signal, _onUpdate, context2) {
    const root = getWorkspaceRoot(context2);
    return executeGit(["restore", "--staged", "--", validateGitPath(params.path)], root);
  }
};
const gitCommitTool = {
  name: "git_commit",
  label: "Git commit",
  description: "Create a git commit from staged changes in the current project repository.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "Commit message." }
    },
    required: ["message"]
  },
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: false, sideEffect: "filesystem", category: "system", requiresApproval: true },
  permissionHint: "mutation",
  async execute(_toolCallId, params, _signal, _onUpdate, context2) {
    const message = String(params.message ?? "").trim();
    if (!message) {
      throw new Error("Commit message is required.");
    }
    const root = getWorkspaceRoot(context2);
    return executeGit(["commit", "-m", message], root);
  }
};
const MAX_RESPONSE_BYTES = 160 * 1024;
const REQUEST_TIMEOUT_MS$2 = 12e3;
const SEARCH_BASE_URL = process.env.RDC_AGENT_WEB_SEARCH_URL || "https://s.jina.ai/";
const webFetchTool = {
  name: "web_fetch",
  label: "Fetch Web Page",
  description: "Fetch a public HTTP(S) URL as read-only text. Localhost, private networks, and oversized responses are blocked.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Public http or https URL to fetch."
      }
    },
    required: ["url"]
  },
  spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: "network", category: "web", requiresApproval: false },
  permissionHint: "readonly",
  async execute(_toolCallId, params, signal) {
    return fetchPublicText(params.url, signal);
  }
};
const webSearchTool = {
  name: "web_search",
  label: "Search Web",
  description: "Search the public web using the configured read-only search endpoint and return text results with source links.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query. Do not include secrets or private file contents."
      }
    },
    required: ["query"]
  },
  spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: "network", category: "web", requiresApproval: false },
  permissionHint: "readonly",
  async execute(_toolCallId, params, signal) {
    if (!params.query || !params.query.trim()) {
      throw new Error("query cannot be empty");
    }
    const base = SEARCH_BASE_URL.endsWith("/") ? SEARCH_BASE_URL : `${SEARCH_BASE_URL}/`;
    return fetchPublicText(`${base}${encodeURIComponent(params.query.trim())}`, signal);
  }
};
async function fetchPublicText(rawUrl, signal) {
  const url2 = await assertPublicHttpUrl(rawUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS$2);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(url2, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/plain,text/markdown,text/html,application/json;q=0.9,*/*;q=0.5",
        "User-Agent": "RDC-Agent/AskReadonlyWebTool"
      }
    });
    const finalUrl = await assertPublicHttpUrl(response.url);
    const arrayBuffer = await response.arrayBuffer();
    const bytes = arrayBuffer.byteLength;
    const limited = arrayBuffer.slice(0, MAX_RESPONSE_BYTES);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(limited);
    const truncated = bytes > MAX_RESPONSE_BYTES;
    const output = [
      `URL: ${finalUrl}`,
      `Status: ${response.status} ${response.statusText}`,
      truncated ? `[truncated at ${MAX_RESPONSE_BYTES} bytes]` : "",
      "",
      truncateOutput(text, MAX_RESPONSE_BYTES)
    ].filter(Boolean).join("\n");
    return {
      content: [{ type: "text", text: output }],
      details: {
        url: finalUrl,
        status: response.status,
        bytes,
        truncated
      }
    };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abort);
  }
}
async function assertPublicHttpUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Blocked non-HTTP URL: ${parsed.protocol}`);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error(`Blocked local host: ${hostname || "(empty)"}`);
  }
  if (isPrivateIp(hostname)) {
    throw new Error(`Blocked private network address: ${hostname}`);
  }
  const addresses = await promises.lookup(hostname, { all: true }).catch(() => []);
  for (const address of addresses) {
    if (isPrivateIp(address.address)) {
      throw new Error(`Blocked private network address: ${address.address}`);
    }
  }
  return parsed.toString();
}
function isPrivateIp(value) {
  const ipVersion = net__namespace.isIP(value);
  if (ipVersion === 4) {
    const parts = value.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return true;
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224;
  }
  if (ipVersion === 6) {
    const normalized = value.toLowerCase();
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }
  return false;
}
const deleteFileTool = {
  name: "delete_file",
  label: "删除文件",
  description: "Delete a file inside the workspace. Returns whether the file existed before deletion.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Relative or absolute path inside the workspace." }
    },
    required: ["path"]
  },
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: true, sideEffect: "filesystem", category: "file", requiresApproval: true },
  permissionHint: "destructive",
  async execute(_toolCallId, params, signal, _onUpdate, context2) {
    if (signal?.aborted) throw new Error("Aborted");
    const absolute = safeResolvePath(params.path, void 0, context2);
    let existed = false;
    try {
      await fs__namespace$1.access(absolute);
      existed = true;
    } catch {
    }
    if (existed) {
      await fs__namespace$1.unlink(absolute);
    }
    return {
      content: [{ type: "text", text: `${existed ? "Deleted" : "Did not exist"}: ${absolute}` }],
      details: { path: absolute, existed }
    };
  }
};
const moveFileTool = {
  name: "move_file",
  label: "移动文件",
  description: "Move or rename a file inside the workspace. Creates parent directories if needed.",
  parameters: {
    type: "object",
    properties: {
      source: { type: "string", description: "Source file path (relative or absolute inside workspace)." },
      destination: { type: "string", description: "Destination file path (relative or absolute inside workspace)." }
    },
    required: ["source", "destination"]
  },
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: false, sideEffect: "filesystem", category: "file", requiresApproval: true },
  permissionHint: "mutation",
  async execute(_toolCallId, params, signal, _onUpdate, context2) {
    if (signal?.aborted) throw new Error("Aborted");
    const src = safeResolvePath(params.source, void 0, context2);
    const dest = safeResolvePath(params.destination, void 0, context2);
    const destDir = path__namespace.dirname(dest);
    await fs__namespace$1.mkdir(destDir, { recursive: true });
    let overwritten = false;
    try {
      await fs__namespace$1.access(dest);
      overwritten = true;
    } catch {
    }
    await fs__namespace$1.rename(src, dest);
    return {
      content: [{ type: "text", text: `Moved ${src} → ${dest}${overwritten ? " (overwrote existing)" : ""}` }],
      details: { source: src, destination: dest, overwritten }
    };
  }
};
const copyFileTool = {
  name: "copy_file",
  label: "复制文件",
  description: "Copy a file inside the workspace. Creates parent directories if needed.",
  parameters: {
    type: "object",
    properties: {
      source: { type: "string", description: "Source file path (relative or absolute inside workspace)." },
      destination: { type: "string", description: "Destination file path (relative or absolute inside workspace)." }
    },
    required: ["source", "destination"]
  },
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: false, sideEffect: "filesystem", category: "file", requiresApproval: true },
  permissionHint: "mutation",
  async execute(_toolCallId, params, signal, _onUpdate, context2) {
    if (signal?.aborted) throw new Error("Aborted");
    const src = safeResolvePath(params.source, void 0, context2);
    const dest = safeResolvePath(params.destination, void 0, context2);
    const destDir = path__namespace.dirname(dest);
    await fs__namespace$1.mkdir(destDir, { recursive: true });
    let overwritten = false;
    try {
      await fs__namespace$1.access(dest);
      overwritten = true;
    } catch {
    }
    await fs__namespace$1.copyFile(src, dest);
    const stat = await fs__namespace$1.stat(src);
    return {
      content: [{ type: "text", text: `Copied ${src} → ${dest}${overwritten ? " (overwrote existing)" : ""} (${stat.size} bytes)` }],
      details: { source: src, destination: dest, overwritten, bytes: stat.size }
    };
  }
};
const searchCodebaseTool = {
  name: "search_codebase",
  label: "语义搜索代码库",
  description: "Search the codebase using semantic meaning (not exact text). Useful for finding logic by intent when you do not know exact file names.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "High-level description of what you are looking for." },
      limit: { type: "integer", description: "Maximum results to return (default: 10)." }
    },
    required: ["query"]
  },
  spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: "none", category: "search", requiresApproval: false },
  permissionHint: "readonly",
  async execute(_toolCallId, params) {
    const limit = Math.max(1, Math.min(50, Math.floor(params.limit ?? 10)));
    const query = params.query.trim();
    if (!query) {
      return { content: [{ type: "text", text: "Query is empty." }], details: { query, results: [] } };
    }
    const results = [
      `Semantic search for "${query}" is not yet indexed.`,
      "Consider using grep (exact regex) or glob (file patterns) for now."
    ];
    return {
      content: [{ type: "text", text: results.slice(0, limit).join("\n") }],
      details: { query, results: results.slice(0, limit) }
    };
  }
};
const askUserTool = {
  name: "ask_user_question",
  label: "询问用户",
  description: "Ask the user a clarifying question. Use when requirements are ambiguous or you need confirmation before a destructive action.",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "The question to present to the user." }
    },
    required: ["question"]
  },
  spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: "none", category: "system", requiresApproval: false },
  permissionHint: "readonly",
  async execute(_toolCallId, params) {
    const question = params.question.trim();
    if (!question) {
      return { content: [{ type: "text", text: "Question is empty." }], isError: true, details: { question } };
    }
    return {
      content: [{ type: "text", text: `[Agent asks] ${question}` }],
      details: { question }
    };
  }
};
const notebookEditTool = {
  name: "notebook_edit",
  label: "编辑 Notebook",
  description: "Edit a single cell in a Jupyter-like notebook file (JSON .ipynb).",
  parameters: {
    type: "object",
    properties: {
      notebook_path: { type: "string", description: "Path to the .ipynb file inside the workspace." },
      cell_index: { type: "integer", description: "Zero-based index of the cell to edit." },
      new_source: { type: "string", description: "New source content for the cell." }
    },
    required: ["notebook_path", "cell_index", "new_source"]
  },
  spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: false, sideEffect: "filesystem", category: "file", requiresApproval: true },
  permissionHint: "mutation",
  async execute(_toolCallId, params, signal, _onUpdate, context2) {
    if (signal?.aborted) throw new Error("Aborted");
    const absolute = safeResolvePath(params.notebook_path, void 0, context2);
    const raw = await fs__namespace$1.readFile(absolute, "utf8");
    const notebook = JSON.parse(raw);
    if (!Array.isArray(notebook.cells)) {
      throw new Error("Invalid notebook: missing cells array");
    }
    const idx = params.cell_index;
    if (idx < 0 || idx >= notebook.cells.length) {
      throw new Error(`Cell index ${idx} out of range (0..${notebook.cells.length - 1})`);
    }
    const cell = notebook.cells[idx];
    const oldSource = Array.isArray(cell.source) ? cell.source.join("") : String(cell.source);
    cell.source = params.new_source;
    await fs__namespace$1.writeFile(absolute, JSON.stringify(notebook, null, 2), "utf8");
    return {
      content: [{ type: "text", text: `Edited cell ${idx} in ${absolute}` }],
      details: { notebook_path: absolute, cell_index: idx, old_length: oldSource.length, new_length: params.new_source.length }
    };
  }
};
function getPrimitiveTools() {
  return [
    bashTool,
    readFileTool,
    writeFileTool,
    editFileTool,
    globTool,
    grepTool,
    gitStatusTool,
    gitDiffTool,
    gitLogTool,
    gitAddTool,
    gitUnstageTool,
    gitCommitTool,
    webFetchTool,
    webSearchTool,
    deleteFileTool,
    moveFileTool,
    copyFileTool,
    searchCodebaseTool,
    askUserTool,
    notebookEditTool
  ];
}
function createToolSearchTool(getAllTools) {
  return {
    name: "tool_search",
    label: "Search Tools",
    description: "Search for available tools by name, description, category, or permission. Returns matching tools with their schemas.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (partial name or description match)" },
        category: { type: "string", description: "Filter by category (file, search, system, comm, web, task)" },
        requires_approval: { type: "boolean", description: "Filter by whether the tool requires approval" }
      },
      required: []
    },
    spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: "none", category: "search", requiresApproval: false },
    permissionHint: "readonly",
    async execute(_id, params) {
      const p = params;
      const query = p.query?.toLowerCase() ?? "";
      const category = p.category?.toLowerCase() ?? "";
      const requiresApproval = p.requires_approval;
      const all = getAllTools();
      let matches = all;
      if (query) {
        matches = matches.filter(
          (t) => t.name.toLowerCase().includes(query) || t.description.toLowerCase().includes(query)
        );
      }
      if (category) {
        matches = matches.filter((t) => t.spec?.category === category);
      }
      if (requiresApproval !== void 0) {
        matches = matches.filter((t) => (t.spec?.requiresApproval ?? false) === requiresApproval);
      }
      const text = matches.length > 0 ? `Found ${matches.length} tools:
${matches.map((m) => `  - ${m.name}${m.spec ? ` [${m.spec.category}]` : ""}`).join("\n")}` : "No matching tools found.";
      return {
        content: [{ type: "text", text }],
        isError: false
      };
    }
  };
}
class FileTaskStore {
  tasksDir;
  dirEnsured = false;
  constructor(tasksDir) {
    this.tasksDir = path__namespace.resolve(tasksDir);
  }
  taskPath(taskId) {
    return path__namespace.join(this.tasksDir, `${taskId}.json`);
  }
  async ensureDir() {
    if (this.dirEnsured) return;
    await fs__namespace$1.mkdir(this.tasksDir, { recursive: true });
    this.dirEnsured = true;
  }
  async loadTask(taskId) {
    try {
      const raw = await fs__namespace$1.readFile(this.taskPath(taskId), "utf8");
      const parsed = JSON.parse(raw);
      return normalizeTaskRecord(parsed);
    } catch (err) {
      if (err.code === "ENOENT") return null;
      return null;
    }
  }
  async saveTask(task) {
    await this.ensureDir();
    await fs__namespace$1.writeFile(this.taskPath(task.id), JSON.stringify(task, null, 2), "utf8");
  }
  async listTasks() {
    await this.ensureDir();
    let entries;
    try {
      entries = await fs__namespace$1.readdir(this.tasksDir);
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
    const files = entries.filter((name) => name.startsWith("task_") && name.endsWith(".json")).sort();
    const tasks = [];
    for (const file of files) {
      const id = file.slice(0, -".json".length);
      const task = await this.loadTask(id);
      if (task) tasks.push(task);
    }
    return tasks;
  }
  async deleteTask(taskId) {
    try {
      await fs__namespace$1.unlink(this.taskPath(taskId));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
}
class MemoryTaskStore {
  store = /* @__PURE__ */ new Map();
  async loadTask(taskId) {
    return this.store.get(taskId) ?? null;
  }
  async saveTask(task) {
    this.store.set(task.id, { ...task });
  }
  async listTasks() {
    return Array.from(this.store.values()).map((t) => ({ ...t }));
  }
  async deleteTask(taskId) {
    this.store.delete(taskId);
  }
}
function normalizeTaskRecord(parsed) {
  if (!parsed || typeof parsed.id !== "string" || typeof parsed.subject !== "string") {
    return null;
  }
  return {
    id: parsed.id,
    subject: parsed.subject,
    description: typeof parsed.description === "string" ? parsed.description : "",
    status: parsed.status === "in_progress" || parsed.status === "completed" || parsed.status === "deleted" ? parsed.status : "pending",
    owner: typeof parsed.owner === "string" ? parsed.owner : void 0,
    blockedBy: Array.isArray(parsed.blockedBy) ? parsed.blockedBy.filter((x) => typeof x === "string") : [],
    blocks: Array.isArray(parsed.blocks) ? parsed.blocks.filter((x) => typeof x === "string") : [],
    activeForm: typeof parsed.activeForm === "string" ? parsed.activeForm : void 0,
    metadata: parsed.metadata && typeof parsed.metadata === "object" ? parsed.metadata : void 0,
    createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
    updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now()
  };
}
class TaskRegistry {
  /** 存储后端（FileTaskStore 落盘 / MemoryTaskStore 内存）。 */
  store;
  /** 任务变更回调（create/update 后触发，用于 emit task.created/updated 事件）。 */
  onTaskChange;
  /**
   * 构造一个任务注册表。
   *
   * @param storeOrDir TaskStore 实例，或任务文件目录（兼容旧签名，内部建 FileTaskStore）。
   */
  constructor(storeOrDir = ".tasks") {
    this.store = typeof storeOrDir === "string" ? new FileTaskStore(storeOrDir) : storeOrDir;
  }
  // ── 公共接口 ──────────────────────────────────────────────
  /**
   * 创建一个新任务。
   *
   * - 自动生成唯一 ID；
   * - 若指定了 `blockedBy`，会在那些上游任务的 `blocks` 列表中追加当前 ID；
   *   找不到的上游 ID 会被忽略（保留在 `blockedBy` 中，由 `canStart` 视作未完成）。
   *
   * @param subject 任务标题（动作型）。
   * @param options 可选参数。
   * @returns 新创建的任务记录。
   */
  async createTask(subject, options = {}) {
    if (typeof subject !== "string" || subject.trim().length === 0) {
      throw new Error("subject 不能为空");
    }
    const now = Date.now();
    const id = this.generateId();
    const blockedBy = dedupe(options.blockedBy ?? []);
    const task = {
      id,
      subject: subject.trim(),
      description: options.description ?? "",
      status: "pending",
      owner: options.owner,
      blockedBy,
      blocks: [],
      activeForm: options.activeForm,
      metadata: options.metadata ? { ...options.metadata } : void 0,
      createdAt: now,
      updatedAt: now
    };
    await this.saveTask(task);
    for (const upstreamId of blockedBy) {
      await this.linkBlocks(upstreamId, id);
    }
    this.onTaskChange?.({ type: "created", task });
    return task;
  }
  /**
   * 更新现有任务。
   *
   * - 简单字段（status / subject / description / activeForm / owner）直接覆盖；
   * - `addBlockedBy` / `addBlocks` 为增量追加（自动去重，且会同步另一端的反向链接）；
   * - `metadata` 为浅合并（传入 `null` 不会删除已有 key，请显式传入新对象）；
   * - 任何更新都会刷新 `updatedAt`。
   *
   * 当 `status` 被切换为 `completed` 时，调用方可通过 {@link getUnblockedTasks}
   * 查询哪些下游任务因此被解锁。
   *
   * @param taskId 任务 ID。
   * @param updates 更新字段。
   * @returns 更新后的任务记录。
   * @throws 如果任务不存在。
   */
  async updateTask(taskId, updates) {
    const task = await this.loadTask(taskId);
    if (!task) {
      throw new Error(`任务不存在：${taskId}`);
    }
    if (updates.status !== void 0) task.status = updates.status;
    if (updates.subject !== void 0) task.subject = updates.subject;
    if (updates.description !== void 0) {
      task.description = updates.description;
    }
    if (updates.activeForm !== void 0) task.activeForm = updates.activeForm;
    if (updates.owner !== void 0) task.owner = updates.owner;
    if (updates.metadata !== void 0) {
      task.metadata = { ...task.metadata ?? {}, ...updates.metadata };
    }
    if (updates.addBlockedBy && updates.addBlockedBy.length > 0) {
      const added = appendUnique(task.blockedBy, updates.addBlockedBy);
      for (const upstreamId of added) {
        await this.linkBlocks(upstreamId, task.id);
      }
    }
    if (updates.addBlocks && updates.addBlocks.length > 0) {
      const added = appendUnique(task.blocks, updates.addBlocks);
      for (const downstreamId of added) {
        await this.linkBlockedBy(downstreamId, task.id);
      }
    }
    task.updatedAt = Date.now();
    await this.saveTask(task);
    this.onTaskChange?.({ type: "updated", task });
    return task;
  }
  /**
   * 读取单个任务。
   *
   * @param taskId 任务 ID。
   * @returns 任务记录；不存在时返回 `null`。
   */
  async getTask(taskId) {
    return this.loadTask(taskId);
  }
  /**
   * 列出所有任务（按 ID 升序）。
   */
  async listTasks() {
    return this.store.listTasks();
  }
  /**
   * 物理删除任务（不同于 updateTask status='deleted' 的软删除）。
   * 主要用于 subagent 结束后清理内存 task。
   */
  async deleteTask(taskId) {
    await this.store.deleteTask(taskId);
  }
  /**
   * 判断任务是否可以开始。
   *
   * - 所有 `blockedBy` 中的上游任务必须存在且状态为 `completed`；
   * - 上游缺失（文件不存在）视为未完成 → 仍处于阻塞状态。
   *
   * @param taskId 任务 ID。
   * @returns 任务存在且可启动时返回 `true`。
   */
  async canStart(taskId) {
    const task = await this.loadTask(taskId);
    if (!task) return false;
    for (const depId of task.blockedBy) {
      const dep = await this.loadTask(depId);
      if (!dep || dep.status !== "completed") return false;
    }
    return true;
  }
  /**
   * 查找因 `completedTaskId` 完成而被解锁的下游任务。
   *
   * 解锁条件：
   *  - 下游任务状态为 `pending`；
   *  - 下游任务的 `blockedBy` 包含 `completedTaskId`；
   *  - 下游任务的所有 `blockedBy` 此刻都已完成（即 `canStart` 为真）。
   *
   * @param completedTaskId 刚完成的任务 ID。
   * @returns 被解锁的下游任务记录列表（可能为空）。
   */
  async getUnblockedTasks(completedTaskId) {
    const all = await this.listTasks();
    const unblocked = [];
    for (const task of all) {
      if (task.status !== "pending") continue;
      if (!task.blockedBy.includes(completedTaskId)) continue;
      if (await this.canStart(task.id)) {
        unblocked.push(task);
      }
    }
    return unblocked;
  }
  // ── 私有辅助 ──────────────────────────────────────────────
  /** 生成任务 ID。 */
  generateId() {
    return `task_${Date.now()}_${crypto__namespace.randomBytes(3).toString("hex")}`;
  }
  /** 把任务写入存储（委托 TaskStore）。 */
  async saveTask(task) {
    await this.store.saveTask(task);
  }
  /** 从存储读取任务；缺失返回 `null`（委托 TaskStore）。 */
  async loadTask(taskId) {
    return this.store.loadTask(taskId);
  }
  /** 在上游任务的 `blocks` 中追加 `downstreamId`（若上游存在）。 */
  async linkBlocks(upstreamId, downstreamId) {
    const upstream = await this.loadTask(upstreamId);
    if (!upstream) return;
    if (upstream.blocks.includes(downstreamId)) return;
    upstream.blocks = [...upstream.blocks, downstreamId];
    upstream.updatedAt = Date.now();
    await this.saveTask(upstream);
  }
  /** 在下游任务的 `blockedBy` 中追加 `upstreamId`（若下游存在）。 */
  async linkBlockedBy(downstreamId, upstreamId) {
    const downstream = await this.loadTask(downstreamId);
    if (!downstream) return;
    if (downstream.blockedBy.includes(upstreamId)) return;
    downstream.blockedBy = [...downstream.blockedBy, upstreamId];
    downstream.updatedAt = Date.now();
    await this.saveTask(downstream);
  }
}
function dedupe(arr) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const item of arr) {
    if (typeof item !== "string" || item.length === 0) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}
function appendUnique(target, incoming) {
  const existing = new Set(target);
  const added = [];
  for (const item of incoming) {
    if (typeof item !== "string" || item.length === 0) continue;
    if (existing.has(item)) continue;
    existing.add(item);
    target.push(item);
    added.push(item);
  }
  return added;
}
const ALLOWED_STATUS = [
  "pending",
  "in_progress",
  "completed",
  "deleted"
];
function createTaskTools(registry) {
  return [
    createTaskCreateTool(registry),
    createTaskUpdateTool(registry),
    createTaskGetTool(registry),
    createTaskListTool(registry),
    createTaskStopTool(registry)
  ];
}
function createTaskCreateTool(registry) {
  return {
    name: "task_create",
    label: "Create Task",
    description: "Create a new task for tracking work progress",
    parameters: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          description: "Brief imperative title"
        },
        description: {
          type: "string",
          description: "Detailed description"
        },
        activeForm: {
          type: "string",
          description: "Present continuous form for spinner"
        },
        blockedBy: {
          type: "array",
          items: { type: "string" },
          description: "Task IDs that block this"
        }
      },
      required: ["subject"]
    },
    permissionHint: "readonly",
    async execute(_toolCallId, params, signal) {
      throwIfAborted(signal);
      const subject = readString$2(params, "subject", true);
      const description = readString$2(params, "description", false);
      const activeForm = readString$2(params, "activeForm", false);
      const blockedBy = readStringArray(params, "blockedBy");
      const task = await registry.createTask(subject, {
        description,
        activeForm,
        blockedBy
      });
      const depsText = blockedBy && blockedBy.length > 0 ? ` (blockedBy: ${blockedBy.join(", ")})` : "";
      const text = `Created ${task.id}: ${task.subject}${depsText}`;
      return {
        content: [{ type: "text", text }],
        details: { id: task.id }
      };
    }
  };
}
function createTaskUpdateTool(registry) {
  return {
    name: "task_update",
    label: "Update Task",
    description: "Update an existing task status or details",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed", "deleted"]
        },
        subject: { type: "string" },
        description: { type: "string" },
        activeForm: { type: "string" },
        owner: { type: "string" },
        addBlockedBy: { type: "array", items: { type: "string" } },
        addBlocks: { type: "array", items: { type: "string" } },
        metadata: { type: "object" }
      },
      required: ["taskId"]
    },
    permissionHint: "readonly",
    async execute(_toolCallId, params, signal) {
      throwIfAborted(signal);
      const taskId = readString$2(params, "taskId", true);
      const status = readEnum(params, "status", ALLOWED_STATUS);
      const subject = readString$2(params, "subject", false);
      const description = readString$2(params, "description", false);
      const activeForm = readString$2(params, "activeForm", false);
      const owner = readString$2(params, "owner", false);
      const addBlockedBy = readStringArray(params, "addBlockedBy");
      const addBlocks = readStringArray(params, "addBlocks");
      const metadata = params.metadata && typeof params.metadata === "object" ? params.metadata : void 0;
      const updated = await registry.updateTask(taskId, {
        status,
        subject,
        description,
        activeForm,
        owner,
        addBlockedBy,
        addBlocks,
        metadata
      });
      let unblocked = [];
      if (status === "completed") {
        unblocked = await registry.getUnblockedTasks(updated.id);
      }
      const lines = [
        `Updated ${updated.id}: ${updated.subject} [${updated.status}]`
      ];
      if (unblocked.length > 0) {
        lines.push(
          `Unblocked: ${unblocked.map((t) => `${t.id} (${t.subject})`).join(", ")}`
        );
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          id: updated.id,
          status: updated.status,
          unblocked: unblocked.map((t) => t.id)
        }
      };
    }
  };
}
function createTaskGetTool(registry) {
  return {
    name: "task_get",
    label: "Get Task",
    description: "Get full details of a specific task",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string" }
      },
      required: ["taskId"]
    },
    permissionHint: "readonly",
    async execute(_toolCallId, params, signal) {
      throwIfAborted(signal);
      const taskId = readString$2(params, "taskId", true);
      const task = await registry.getTask(taskId);
      if (!task) {
        return {
          content: [{ type: "text", text: `Task not found: ${taskId}` }],
          details: { id: taskId, found: false }
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
        details: { id: task.id, found: true }
      };
    }
  };
}
function createTaskListTool(registry) {
  return {
    name: "task_list",
    label: "List Tasks",
    description: "List all tasks with their current status",
    parameters: {
      type: "object",
      properties: {}
    },
    permissionHint: "readonly",
    async execute(_toolCallId, _params, signal) {
      throwIfAborted(signal);
      const tasks = await registry.listTasks();
      if (tasks.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No tasks. Use task_create to add some."
            }
          ],
          details: { count: 0 }
        };
      }
      const lines = tasks.map(formatTaskLine);
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { count: tasks.length }
      };
    }
  };
}
function createTaskStopTool(registry) {
  return {
    name: "task_stop",
    label: "Stop Task",
    description: "Stop a running task (set status to deleted)",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "ID of the task to stop" }
      },
      required: ["taskId"]
    },
    permissionHint: "readonly",
    async execute(_toolCallId, params, signal) {
      throwIfAborted(signal);
      const taskId = readString$2(params, "taskId", true);
      const task = await registry.getTask(taskId);
      if (!task) {
        return {
          content: [{ type: "text", text: `Task not found: ${taskId}` }],
          details: { id: taskId }
        };
      }
      await registry.updateTask(taskId, { status: "deleted" });
      return {
        content: [{ type: "text", text: `Stopped ${taskId}: ${task.subject}` }],
        details: { id: taskId }
      };
    }
  };
}
function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new Error("Aborted");
  }
}
function readString$2(params, key, required) {
  const value = params[key];
  if (value === void 0 || value === null || value === "") {
    if (required) throw new Error(`参数 "${key}" 不能为空`);
    return void 0;
  }
  if (typeof value !== "string") {
    throw new Error(`参数 "${key}" 必须是字符串`);
  }
  return value;
}
function readStringArray(params, key) {
  const value = params[key];
  if (value === void 0 || value === null) return void 0;
  if (!Array.isArray(value)) {
    throw new Error(`参数 "${key}" 必须是字符串数组`);
  }
  const out = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      throw new Error(`参数 "${key}" 中存在非法元素`);
    }
    out.push(item);
  }
  return out;
}
function readEnum(params, key, allowed) {
  const value = params[key];
  if (value === void 0 || value === null || value === "") return void 0;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(
      `参数 "${key}" 必须是以下之一：${allowed.join(", ")}`
    );
  }
  return value;
}
function formatTaskLine(task) {
  const icon = STATUS_ICON[task.status] ?? "?";
  const owner = task.owner ? ` [${task.owner}]` : "";
  const deps = task.blockedBy.length > 0 ? ` (blockedBy: ${task.blockedBy.join(", ")})` : "";
  return `  ${icon} ${task.id}: ${task.subject} [${task.status}]${owner}${deps}`;
}
const STATUS_ICON = {
  pending: "○",
  in_progress: "●",
  completed: "✓",
  deleted: "✗"
};
class StdioRpcClient {
  constructor(proc) {
    this.proc = proc;
    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk) => this.onData(chunk));
    proc.on("exit", () => this.onClose(new Error("MCP process exited")));
    proc.on("error", (err) => this.onClose(err));
  }
  proc;
  nextId = 1;
  buffer = "";
  pending = /* @__PURE__ */ new Map();
  closed = false;
  onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof msg.id === "number" && this.pending.has(msg.id)) {
        const entry = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) {
          entry.reject(
            new Error(`MCP error ${msg.error.code}: ${msg.error.message}`)
          );
        } else {
          entry.resolve(msg.result);
        }
      }
    }
  }
  onClose(err) {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) {
      entry.reject(err);
    }
    this.pending.clear();
  }
  /** 发送 JSON-RPC 请求并等待响应。 */
  request(method, params, timeoutMs) {
    if (this.closed) {
      return Promise.reject(new Error("MCP connection is closed"));
    }
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request "${method}" timed out`));
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        }
      });
      try {
        this.proc.stdin?.write(payload);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
  /** 发送 JSON-RPC 通知（无响应）。 */
  notify(method, params) {
    if (this.closed) return;
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";
    try {
      this.proc.stdin?.write(payload);
    } catch {
    }
  }
  close() {
    this.onClose(new Error("MCP client closed"));
  }
}
class SseRpcClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }
  baseUrl;
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  closed = false;
  abortController = new AbortController();
  /** 启动 SSE 连接。 */
  async connect(_timeoutMs) {
    const response = await fetch(this.baseUrl, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      signal: this.abortController.signal
    });
    if (!response.ok || !response.body) {
      throw new Error(`SSE connect failed: ${response.status} ${response.statusText}`);
    }
    void this.readSseStream(response.body);
  }
  async readSseStream(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const rawLine of lines) {
          const line = rawLine.trimEnd();
          if (line === "") {
            if (currentEvent) {
              this.processEvent(currentEvent);
              currentEvent = "";
            }
            continue;
          }
          if (line.startsWith("data: ")) {
            currentEvent += line.slice(6);
          }
        }
      }
    } catch (err) {
      if (!this.closed) {
        this.onClose(
          err instanceof Error ? err : new Error(String(err))
        );
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
      }
    }
    if (currentEvent) {
      this.processEvent(currentEvent);
    }
  }
  processEvent(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof msg.id === "number" && this.pending.has(msg.id)) {
      const entry = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) {
        entry.reject(
          new Error(`MCP error ${msg.error.code}: ${msg.error.message}`)
        );
      } else {
        entry.resolve(msg.result);
      }
    }
  }
  onClose(err) {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) {
      entry.reject(err);
    }
    this.pending.clear();
  }
  /** 通过 HTTP POST 发送 JSON-RPC 请求。 */
  async request(method, params, timeoutMs) {
    if (this.closed) {
      return Promise.reject(new Error("SSE connection is closed"));
    }
    const id = this.nextId++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(this.baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal
      });
      if (!res.ok) {
        throw new Error(`SSE POST ${res.status} ${res.statusText}`);
      }
      const body = await res.json();
      if (body.error) {
        throw new Error(
          `MCP error ${body.error.code}: ${body.error.message}`
        );
      }
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  }
  /** 发送通知（fire-and-forget POST）。 */
  notify(method, params) {
    if (this.closed) return;
    fetch(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params })
    }).catch(() => {
    });
  }
  close() {
    this.abortController.abort();
    this.onClose(new Error("SSE client closed"));
  }
}
class MCPAgentTool {
  constructor(manager, tool) {
    this.manager = manager;
    this.name = tool.prefixedName;
    this.description = tool.description;
    this.parameters = tool.inputSchema;
  }
  manager;
  name;
  description;
  parameters;
  permissionHint = "mutation";
  async execute(_toolCallId, args) {
    return this.manager.executeTool(this.name, args);
  }
}
const DEFAULT_TIMEOUT_MS = 3e4;
function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}
function buildPrefixedName(serverName, toolName) {
  return `mcp__${sanitizeName(serverName)}__${sanitizeName(toolName)}`;
}
class MCPManager {
  connections = /* @__PURE__ */ new Map();
  discoveredTools = /* @__PURE__ */ new Map();
  /** 连接到 MCP 服务器，返回该服务器发现的 prefixedName 列表。 */
  async connect(config) {
    if (this.connections.has(config.name)) {
      throw new Error(`MCP server "${config.name}" already connected`);
    }
    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (config.type === "stdio") {
      if (!config.command) {
        throw new Error(
          `MCP stdio server "${config.name}" missing command`
        );
      }
      const proc = child_process.spawn(config.command, config.args ?? [], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...config.env ?? {} }
      });
      proc.stderr?.setEncoding("utf8");
      proc.stderr?.on("data", (chunk) => {
        console.warn(`[MCP:${config.name}] ${chunk.trimEnd()}`);
      });
      const rpc = new StdioRpcClient(proc);
      const conn = {
        config,
        tools: [],
        process: proc,
        rpc
      };
      try {
        await rpc.request(
          "initialize",
          {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "rdc-agent", version: "0.1.0" }
          },
          timeoutMs
        );
        rpc.notify("notifications/initialized", {});
        const listResult = await rpc.request(
          "tools/list",
          {},
          timeoutMs
        );
        const rawTools = Array.isArray(listResult?.tools) ? listResult.tools : [];
        conn.tools = rawTools.map(
          (t) => this.toDiscoveredTool(config.name, t)
        );
      } catch (err) {
        rpc.close();
        try {
          proc.kill();
        } catch {
        }
        throw err;
      }
      this.connections.set(config.name, conn);
      this.registerTools(conn.tools);
      return conn.tools.map((t) => t.prefixedName);
    }
    if (config.type === "http") {
      if (!config.url) {
        throw new Error(`MCP http server "${config.name}" missing url`);
      }
      const conn = { config, tools: [] };
      await this.httpRpc(
        config.url,
        "initialize",
        {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "rdc-agent", version: "0.1.0" }
        },
        timeoutMs
      );
      const listResult = await this.httpRpc(
        config.url,
        "tools/list",
        {},
        timeoutMs
      );
      const rawTools = Array.isArray(listResult?.tools) ? listResult.tools : [];
      conn.tools = rawTools.map(
        (t) => this.toDiscoveredTool(config.name, t)
      );
      this.connections.set(config.name, conn);
      this.registerTools(conn.tools);
      return conn.tools.map((t) => t.prefixedName);
    }
    if (config.type === "sse") {
      if (!config.url) {
        throw new Error(`MCP sse server "${config.name}" missing url`);
      }
      const sseRpc = new SseRpcClient(config.url);
      const conn = { config, tools: [], rpcSse: sseRpc };
      try {
        await sseRpc.connect(timeoutMs);
        await sseRpc.request(
          "initialize",
          {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "rdc-agent", version: "0.1.0" }
          },
          timeoutMs
        );
        sseRpc.notify("notifications/initialized", {});
        const listResult = await sseRpc.request(
          "tools/list",
          {},
          timeoutMs
        );
        const rawTools = Array.isArray(listResult?.tools) ? listResult.tools : [];
        conn.tools = rawTools.map(
          (t) => this.toDiscoveredTool(config.name, t)
        );
      } catch (err) {
        sseRpc.close();
        throw err;
      }
      this.connections.set(config.name, conn);
      this.registerTools(conn.tools);
      return conn.tools.map((t) => t.prefixedName);
    }
    if (config.type === "streamable-http") {
      if (!config.url) {
        throw new Error(`MCP streamable-http server "${config.name}" missing url`);
      }
      const conn = { config, tools: [] };
      await this.streamableHttpRpc(
        config.url,
        "initialize",
        {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "rdc-agent", version: "0.1.0" }
        },
        timeoutMs
      );
      const listResult = await this.streamableHttpRpc(
        config.url,
        "tools/list",
        {},
        timeoutMs
      );
      const rawTools = Array.isArray(listResult?.tools) ? listResult.tools : [];
      conn.tools = rawTools.map(
        (t) => this.toDiscoveredTool(config.name, t)
      );
      this.connections.set(config.name, conn);
      this.registerTools(conn.tools);
      return conn.tools.map((t) => t.prefixedName);
    }
    throw new Error(`Unsupported MCP transport type: ${String(config.type)}`);
  }
  /** 断开 MCP 服务器。 */
  async disconnect(serverName) {
    const conn = this.connections.get(serverName);
    if (!conn) return;
    this.connections.delete(serverName);
    for (const t of conn.tools) {
      this.discoveredTools.delete(t.prefixedName);
    }
    if (conn.rpc) {
      conn.rpc.close();
    }
    if (conn.rpcSse) {
      conn.rpcSse.close();
    }
    if (conn.process) {
      try {
        conn.process.kill();
      } catch {
      }
    }
  }
  /** 断开所有服务器。 */
  async disconnectAll() {
    const names = Array.from(this.connections.keys());
    await Promise.all(names.map((n) => this.disconnect(n)));
  }
  /** 列出已连接的服务器。 */
  listServers() {
    return Array.from(this.connections.keys());
  }
  /** 获取所有发现的工具（带 mcp__ 前缀）。 */
  getDiscoveredTools() {
    return Array.from(this.discoveredTools.values());
  }
  /** 获取工具定义列表（用于发给 LLM）。 */
  getToolDefinitions() {
    return this.getDiscoveredTools().map((t) => ({
      name: t.prefixedName,
      description: t.description,
      parameters: t.inputSchema
    }));
  }
  /** 将发现的工具转换为 AgentTool 实例。 */
  getAgentTools() {
    return this.getDiscoveredTools().map(
      (t) => new MCPAgentTool(this, t)
    );
  }
  /** 执行 MCP 工具。 */
  async executeTool(prefixedName, args) {
    const parsed = this.parsePrefixedName(prefixedName);
    if (!parsed) {
      return {
        content: [
          {
            type: "text",
            text: `Invalid MCP tool name: ${prefixedName}`
          }
        ],
        isError: true
      };
    }
    const conn = this.findConnectionByServer(parsed.serverName);
    if (!conn) {
      return {
        content: [
          {
            type: "text",
            text: `MCP server "${parsed.serverName}" not connected`
          }
        ],
        isError: true
      };
    }
    const tool = conn.tools.find((t) => t.prefixedName === prefixedName);
    if (!tool) {
      return {
        content: [
          {
            type: "text",
            text: `MCP tool "${prefixedName}" not found on server "${parsed.serverName}"`
          }
        ],
        isError: true
      };
    }
    const timeoutMs = conn.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    try {
      let result;
      if (conn.config.type === "stdio") {
        if (!conn.rpc) {
          throw new Error("stdio rpc client not initialized");
        }
        result = await conn.rpc.request(
          "tools/call",
          { name: tool.originalName, arguments: args },
          timeoutMs
        );
      } else if (conn.config.type === "sse") {
        if (!conn.rpcSse) {
          throw new Error("sse rpc client not initialized");
        }
        result = await conn.rpcSse.request(
          "tools/call",
          { name: tool.originalName, arguments: args },
          timeoutMs
        );
      } else {
        if (!conn.config.url) {
          throw new Error("server url missing");
        }
        result = await this.httpRpc(
          conn.config.url,
          "tools/call",
          { name: tool.originalName, arguments: args },
          timeoutMs
        );
      }
      return this.normalizeToolResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `MCP execute error: ${message}` }],
        isError: true
      };
    }
  }
  /** 检查是否为 MCP 工具（按前缀判断）。 */
  isMCPTool(toolName) {
    return toolName.startsWith("mcp__");
  }
  /** 从前缀名称解析服务器和工具名。 */
  parsePrefixedName(prefixedName) {
    if (!prefixedName.startsWith("mcp__")) return null;
    const rest = prefixedName.slice("mcp__".length);
    const sepIdx = rest.indexOf("__");
    if (sepIdx <= 0 || sepIdx === rest.length - 2) return null;
    const serverName = rest.slice(0, sepIdx);
    const toolName = rest.slice(sepIdx + 2);
    if (!serverName || !toolName) return null;
    return { serverName, toolName };
  }
  // -------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------
  toDiscoveredTool(serverName, raw) {
    const originalName = typeof raw.name === "string" ? raw.name : "unnamed_tool";
    const description = typeof raw.description === "string" ? raw.description : "";
    const inputSchema = raw.inputSchema && typeof raw.inputSchema === "object" ? raw.inputSchema : { type: "object", properties: {} };
    return {
      serverName,
      originalName,
      prefixedName: buildPrefixedName(serverName, originalName),
      description,
      inputSchema
    };
  }
  registerTools(tools) {
    for (const t of tools) {
      this.discoveredTools.set(t.prefixedName, t);
    }
  }
  /** 从 sanitized server name 反查连接。 */
  findConnectionByServer(sanitizedServerName) {
    for (const conn of this.connections.values()) {
      if (sanitizeName(conn.config.name) === sanitizedServerName) {
        return conn;
      }
    }
    return void 0;
  }
  /** 把 MCP tools/call 返回结果归一化为 AgentToolResult。 */
  normalizeToolResult(raw) {
    if (!raw || typeof raw !== "object") {
      return {
        content: [{ type: "text", text: String(raw ?? "") }],
        isError: false
      };
    }
    const obj = raw;
    const isError = obj.isError === true;
    const content = [];
    if (Array.isArray(obj.content)) {
      for (const block of obj.content) {
        if (!block || typeof block !== "object") continue;
        const b = block;
        if (b.type === "text" && typeof b.text === "string") {
          content.push({ type: "text", text: b.text });
        } else if (b.type === "image" && typeof b.data === "string" && typeof b.mimeType === "string") {
          content.push({
            type: "image",
            data: b.data,
            mimeType: b.mimeType
          });
        } else {
          content.push({ type: "text", text: JSON.stringify(b) });
        }
      }
    }
    if (content.length === 0) {
      content.push({ type: "text", text: JSON.stringify(obj) });
    }
    return { content, isError };
  }
  /** http 模式下发送 JSON-RPC 请求。 */
  async httpRpc(url2, method, params, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const id = Date.now() + Math.floor(Math.random() * 1e3);
      const res = await fetch(url2, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal
      });
      if (!res.ok) {
        throw new Error(`MCP HTTP ${res.status} ${res.statusText}`);
      }
      const body = await res.json();
      if (body.error) {
        throw new Error(
          `MCP error ${body.error.code}: ${body.error.message}`
        );
      }
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  }
  /** streamable-http 模式：POST + 流式 NDJSON 响应。 */
  async streamableHttpRpc(url2, method, params, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const id = Date.now() + Math.floor(Math.random() * 1e3);
      const res = await fetch(url2, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson"
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal
      });
      if (!res.ok) {
        throw new Error(`MCP streamable-http ${res.status} ${res.statusText}`);
      }
      if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const msg = JSON.parse(trimmed);
            if (msg.error) {
              throw new Error(`MCP error ${msg.error.code}: ${msg.error.message}`);
            }
            if (typeof msg.id === "number" || typeof msg.id === "string") {
              return msg.result;
            }
          }
        }
        if (buffer.trim()) {
          const msg = JSON.parse(buffer.trim());
          return msg.result;
        }
      }
      const body = await res.json();
      if (body.error) {
        throw new Error(`MCP error ${body.error.code}: ${body.error.message}`);
      }
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  }
}
class SkillEngine {
  /**
   * 执行技能。
   *
   * - prompt 技能：将展开后的提示作为系统消息注入 agent；
   * - tool 技能：返回工具定义供外部注册；
   * - workflow 技能：依次执行每个 step。
   */
  async execute(manifest, params, _context) {
    switch (manifest.type) {
      case "prompt": {
        const expanded = this.expandTemplate(
          manifest.promptTemplate ?? manifest.description,
          params
        );
        return {
          success: true,
          message: expanded,
          data: { prompt: expanded }
        };
      }
      case "tool": {
        const toolNames = (manifest.tools ?? []).map((t) => t.name);
        return {
          success: true,
          message: `Skill "${manifest.name}" provides tools: ${toolNames.join(", ")}`,
          data: { tools: manifest.tools }
        };
      }
      case "workflow": {
        const steps = manifest.steps ?? [];
        const outputs = [];
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const expanded = this.expandTemplate(step.prompt, params);
          outputs.push(`[Step ${i + 1}] ${expanded}`);
        }
        return {
          success: true,
          message: `Workflow "${manifest.name}" completed ${steps.length} steps.`,
          data: { steps: outputs }
        };
      }
      default:
        return {
          success: false,
          message: `Unknown skill type: ${manifest.type}`
        };
    }
  }
  /** 简单的模板展开：将 {{key}} 替换为 params[key]。 */
  expandTemplate(template, params) {
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
      return params[key] ?? `{{${key}}}`;
    });
  }
}
const EMPTY_USAGE = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
class AssistantStreamBuilder {
  stream;
  blocks = [];
  modelId;
  providerId;
  usage = { ...EMPTY_USAGE };
  started = false;
  finished = false;
  constructor(stream, modelId, providerId) {
    this.stream = stream;
    this.modelId = modelId;
    this.providerId = providerId;
  }
  /** 推送 `start` 事件并初始化 partial。 */
  start() {
    if (this.started) return;
    this.started = true;
    this.stream.push({ type: "start", partial: this.snapshot("stop") });
  }
  /** 累积一段文本到指定 contentIndex；首次出现会自动发 `text_start`。 */
  appendText(index, delta) {
    if (!delta) return;
    let block = this.blocks[index];
    if (!block || block.kind !== "text") {
      block = { kind: "text", index, text: "", closed: false };
      this.blocks[index] = block;
      this.stream.push({
        type: "text_start",
        contentIndex: index,
        partial: this.snapshot("stop")
      });
    }
    block.text += delta;
    this.stream.push({
      type: "text_delta",
      contentIndex: index,
      delta,
      partial: this.snapshot("stop")
    });
  }
  /** 显式结束某个文本块，发 `text_end` 事件。 */
  endText(index) {
    const block = this.blocks[index];
    if (!block || block.kind !== "text" || block.closed) return;
    block.closed = true;
    this.stream.push({
      type: "text_end",
      contentIndex: index,
      content: block.text,
      partial: this.snapshot("stop")
    });
  }
  /** 累积一段 thinking。 */
  appendThinking(index, delta) {
    if (!delta) return;
    let block = this.blocks[index];
    if (!block || block.kind !== "thinking") {
      block = { kind: "thinking", index, text: "", closed: false };
      this.blocks[index] = block;
      this.stream.push({
        type: "thinking_start",
        contentIndex: index,
        partial: this.snapshot("stop")
      });
    }
    block.text += delta;
    this.stream.push({
      type: "thinking_delta",
      contentIndex: index,
      delta,
      partial: this.snapshot("stop")
    });
  }
  endThinking(index) {
    const block = this.blocks[index];
    if (!block || block.kind !== "thinking" || block.closed) return;
    block.closed = true;
    this.stream.push({
      type: "thinking_end",
      contentIndex: index,
      content: block.text,
      partial: this.snapshot("stop")
    });
  }
  /** 初始化或更新一个 tool_call 块（不发 delta）。 */
  ensureToolCall(index, id, name) {
    let block = this.blocks[index];
    if (!block || block.kind !== "tool") {
      block = {
        kind: "tool",
        index,
        id: id || `call_${index}`,
        name: name || "",
        argsBuffer: "",
        closed: false
      };
      this.blocks[index] = block;
      this.stream.push({
        type: "toolcall_start",
        contentIndex: index,
        partial: this.snapshot("stop")
      });
    } else {
      if (id && !block.id.startsWith("call_")) ;
      else if (id) {
        block.id = id;
      }
      if (name && !block.name) {
        block.name = name;
      }
    }
  }
  /** 累积一段 tool_call 参数（原始 JSON 字符串增量）。 */
  appendToolCallArgs(index, delta) {
    if (!delta) return;
    const block = this.blocks[index];
    if (!block || block.kind !== "tool") return;
    block.argsBuffer += delta;
    this.stream.push({
      type: "toolcall_delta",
      contentIndex: index,
      delta,
      partial: this.snapshot("stop")
    });
  }
  /** 结束 tool_call，解析 args，发 `toolcall_end`。 */
  endToolCall(index) {
    const block = this.blocks[index];
    if (!block || block.kind !== "tool" || block.closed) return;
    block.closed = true;
    const toolCall = {
      type: "toolCall",
      id: block.id,
      name: block.name,
      arguments: parseJsonSafely(block.argsBuffer)
    };
    this.stream.push({
      type: "toolcall_end",
      contentIndex: index,
      toolCall,
      partial: this.snapshot("stop")
    });
  }
  /** 设置或合并 usage 信息。 */
  setUsage(partial) {
    this.usage = {
      inputTokens: partial.inputTokens ?? this.usage.inputTokens,
      outputTokens: partial.outputTokens ?? this.usage.outputTokens,
      totalTokens: partial.totalTokens ?? (partial.inputTokens ?? this.usage.inputTokens) + (partial.outputTokens ?? this.usage.outputTokens),
      cost: partial.cost ?? this.usage.cost
    };
  }
  /** 完成流：关闭所有未关闭块，推 `done` 事件并 complete。 */
  done(reason) {
    if (this.finished) return;
    this.finished = true;
    for (let i = 0; i < this.blocks.length; i += 1) {
      const block = this.blocks[i];
      if (!block || block.closed) continue;
      if (block.kind === "text") this.endText(i);
      else if (block.kind === "thinking") this.endThinking(i);
      else this.endToolCall(i);
    }
    const message = this.snapshot(reason);
    this.stream.push({ type: "done", reason, message });
  }
  /** 标记错误：推 `error` 事件，并以错误结束 stream。 */
  fail(error, reason = "error") {
    if (this.finished) return;
    this.finished = true;
    const message = this.snapshot(reason);
    this.stream.push({ type: "error", error, message });
    this.stream.error(error);
  }
  /** 是否已经结束。 */
  get isFinished() {
    return this.finished;
  }
  // -----------------------------------------------------------------
  // 内部
  // -----------------------------------------------------------------
  snapshot(reason) {
    const content = [];
    for (const block of this.blocks) {
      if (!block) continue;
      if (block.kind === "text") {
        const item = { type: "text", text: block.text };
        content.push(item);
      } else if (block.kind === "thinking") {
        const item = { type: "thinking", thinking: block.text };
        content.push(item);
      } else {
        const item = {
          type: "toolCall",
          id: block.id,
          name: block.name,
          arguments: parseJsonSafely(block.argsBuffer)
        };
        content.push(item);
      }
    }
    return {
      role: "assistant",
      content,
      model: this.modelId,
      provider: this.providerId,
      usage: { ...this.usage },
      stopReason: reason,
      timestamp: Date.now()
    };
  }
}
function parseJsonSafely(raw) {
  if (!raw || !raw.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return { value: parsed };
  } catch {
    return { _raw: raw };
  }
}
async function* parseSSE(response, signal) {
  if (!response.body) {
    throw new Error("parseSSE: response.body is null");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) {
        break;
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, "");
        if (!line.startsWith("data:")) {
          continue;
        }
        const data = line.slice(5).trimStart();
        if (data === "[DONE]") {
          return;
        }
        if (data.length === 0) {
          continue;
        }
        yield data;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
    }
  }
}
async function* parseJsonLines(response, signal) {
  if (!response.body) {
    throw new Error("parseJsonLines: response.body is null");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) {
        break;
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }
        yield line;
      }
    }
    const tail = buffer.trim();
    if (tail) {
      yield tail;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
    }
  }
}
class ProviderHttpError extends Error {
  status;
  providerApi;
  bodyText;
  constructor(providerApi, status, message, bodyText) {
    super(`[${providerApi}] HTTP ${status}: ${message}`);
    this.name = "ProviderHttpError";
    this.providerApi = providerApi;
    this.status = status;
    this.bodyText = bodyText;
  }
}
async function ensureOk(response, providerApi) {
  if (response.ok) {
    return;
  }
  let bodyText;
  try {
    bodyText = await response.text();
  } catch {
    bodyText = void 0;
  }
  const snippet = bodyText ? bodyText.slice(0, 500) : response.statusText || "request failed";
  throw new ProviderHttpError(providerApi, response.status, snippet, bodyText);
}
function composeAbortSignals(external, internal) {
  const controller = new AbortController();
  const onAbort = (reason) => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };
  if (internal.aborted) {
    onAbort(internal.reason);
  } else {
    internal.addEventListener("abort", () => onAbort(internal.reason), { once: true });
  }
  if (external) {
    if (external.aborted) {
      onAbort(external.reason);
    } else {
      external.addEventListener("abort", () => onAbort(external.reason), { once: true });
    }
  }
  return {
    signal: controller.signal,
    dispose: () => {
    }
  };
}
function normalizeError(err) {
  if (err instanceof Error) return err;
  return new Error(String(err));
}
const DEFAULT_BASE_URL$4 = "https://api.anthropic.com/v1";
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";
const PROVIDER_API$4 = "anthropic-messages";
let AnthropicProvider$1 = class AnthropicProvider {
  api = PROVIDER_API$4;
  defaultBaseUrl;
  defaultApiKey;
  anthropicVersion;
  defaultHeaders;
  capabilities;
  constructor(options = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? DEFAULT_BASE_URL$4).replace(/\/+$/, "");
    this.defaultApiKey = options.apiKey;
    this.anthropicVersion = options.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION;
    this.defaultHeaders = { ...options.headers ?? {} };
    this.capabilities = {
      streaming: true,
      nativeToolCalling: true,
      structuredOutput: false,
      vision: true,
      reasoning: true,
      parallelToolCalls: true,
      ...options.capabilities ?? {}
    };
  }
  getCapabilities() {
    return { ...this.capabilities };
  }
  stream(model, context2, options = {}) {
    const stream = new EventStream(
      (event) => event.type === "done",
      (event) => event.message
    );
    const builder = new AssistantStreamBuilder(stream, model.id, model.provider);
    const baseUrl = (options.baseUrl ?? this.defaultBaseUrl).replace(/\/+$/, "");
    const apiKey = options.apiKey ?? this.defaultApiKey;
    void this.run(stream, builder, model, context2, options, baseUrl, apiKey);
    return stream;
  }
  async run(stream, builder, model, context2, options, baseUrl, apiKey) {
    const composed = composeAbortSignals(options.signal, stream.signal);
    try {
      builder.start();
      if (!apiKey) {
        throw new ProviderHttpError(PROVIDER_API$4, 401, "missing apiKey for Anthropic provider");
      }
      const body = this.buildRequestBody(model, context2, options);
      const url2 = `${baseUrl}/messages`;
      const response = await fetch(url2, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": this.anthropicVersion,
          ...this.defaultHeaders
        },
        body: JSON.stringify(body),
        signal: composed.signal
      });
      await ensureOk(response, PROVIDER_API$4);
      let stopReason = null;
      let inputTokens = 0;
      let outputTokens = 0;
      for await (const data of parseSSE(response, composed.signal)) {
        if (composed.signal.aborted) break;
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        switch (event.type) {
          case "message_start": {
            const evt = event;
            inputTokens = evt.message.usage?.input_tokens ?? inputTokens;
            outputTokens = evt.message.usage?.output_tokens ?? outputTokens;
            builder.setUsage({ inputTokens, outputTokens });
            break;
          }
          case "content_block_start": {
            const evt = event;
            const block = evt.content_block;
            if (block.type === "text") {
              if (block.text) builder.appendText(evt.index, block.text);
            } else if (block.type === "thinking") {
              if (block.thinking) builder.appendThinking(evt.index, block.thinking);
            } else if (block.type === "tool_use") {
              builder.ensureToolCall(evt.index, block.id, block.name);
              if (block.input && typeof block.input === "object" && Object.keys(block.input).length > 0) {
                builder.appendToolCallArgs(evt.index, JSON.stringify(block.input));
              }
            }
            break;
          }
          case "content_block_delta": {
            const evt = event;
            if (evt.delta.type === "text_delta") {
              builder.appendText(evt.index, evt.delta.text);
            } else if (evt.delta.type === "thinking_delta") {
              builder.appendThinking(evt.index, evt.delta.thinking);
            } else if (evt.delta.type === "input_json_delta") {
              builder.appendToolCallArgs(evt.index, evt.delta.partial_json);
            }
            break;
          }
          case "content_block_stop": {
            const evt = event;
            builder.endText(evt.index);
            builder.endThinking(evt.index);
            builder.endToolCall(evt.index);
            break;
          }
          case "message_delta": {
            const evt = event;
            if (evt.delta.stop_reason) stopReason = evt.delta.stop_reason;
            if (typeof evt.usage?.output_tokens === "number") {
              outputTokens = evt.usage.output_tokens;
              builder.setUsage({ inputTokens, outputTokens });
            }
            break;
          }
          case "message_stop": {
            break;
          }
          case "error": {
            const evt = event;
            throw new Error(`anthropic ${evt.error.type}: ${evt.error.message}`);
          }
          default:
            break;
        }
      }
      builder.done(mapStopReason(stopReason));
    } catch (err) {
      const error = normalizeError(err);
      builder.fail(error, error.name === "AbortError" ? "aborted" : "error");
    } finally {
    }
  }
  buildRequestBody(model, context2, options) {
    const { system, messages } = toAnthropicMessages(context2);
    const body = {
      model: model.id,
      messages,
      stream: true,
      max_tokens: options.maxTokens ?? model.maxTokens ?? 4096
    };
    if (system) body.system = system;
    if (typeof options.temperature === "number") body.temperature = options.temperature;
    if (typeof options.topP === "number") body.top_p = options.topP;
    const thinking = toAnthropicThinking$1(options.reasoningBudget, options.reasoningVisibility);
    if (thinking) body.thinking = thinking;
    if (context2.tools && context2.tools.length > 0) {
      body.tools = context2.tools.map(toAnthropicTool);
    }
    return body;
  }
};
function toAnthropicThinking$1(budget, reasoningVisibility) {
  const wantsSummarized = reasoningVisibility === "summary-events";
  if (!wantsSummarized && (!budget || budget === "auto")) return void 0;
  const thinking = {
    type: "enabled",
    budget_tokens: budget === "low" ? 1024 : budget === "medium" ? 4096 : budget === "high" ? 8192 : 4096
  };
  if (wantsSummarized) {
    thinking.display = "summarized";
  }
  return thinking;
}
function toAnthropicMessages(context2) {
  const messages = [];
  for (const message of context2.messages) {
    messages.push(...convertMessage$4(message));
  }
  return {
    system: context2.systemPrompt && context2.systemPrompt.trim() ? context2.systemPrompt : void 0,
    messages
  };
}
function convertMessage$4(message) {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return [{ role: "user", content: [{ type: "text", text: message.content }] }];
    }
    const blocks = [];
    for (const block of message.content) {
      if (block.type === "text") {
        blocks.push({ type: "text", text: block.text });
      } else if (block.type === "image") {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: block.mimeType, data: block.data }
        });
      }
    }
    return [{ role: "user", content: blocks }];
  }
  if (message.role === "assistant") {
    const blocks = [];
    for (const block of message.content) {
      if (block.type === "text") {
        blocks.push({ type: "text", text: block.text });
      } else if (block.type === "toolCall") {
        blocks.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.arguments ?? {}
        });
      }
    }
    return [{ role: "assistant", content: blocks }];
  }
  const textBlocks = [];
  for (const block of message.content) {
    if (block.type === "text") textBlocks.push({ type: "text", text: block.text });
  }
  return [
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: textBlocks,
          is_error: message.isError || void 0
        }
      ]
    }
  ];
}
function toAnthropicTool(tool) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters
  };
}
function mapStopReason(reason) {
  switch (reason) {
    case "end_turn":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "toolUse";
    case "stop_sequence":
      return "stop";
    default:
      return "stop";
  }
}
const DEFAULT_BASE_URL$3 = "https://generativelanguage.googleapis.com";
const PROVIDER_API$3 = "google-gemini";
class GeminiProvider {
  api = PROVIDER_API$3;
  defaultBaseUrl;
  defaultApiKey;
  defaultHeaders;
  capabilities;
  constructor(options = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? DEFAULT_BASE_URL$3).replace(/\/+$/, "");
    this.defaultApiKey = options.apiKey;
    this.defaultHeaders = { ...options.headers ?? {} };
    this.capabilities = {
      streaming: true,
      nativeToolCalling: true,
      structuredOutput: true,
      vision: true,
      reasoning: true,
      parallelToolCalls: true,
      ...options.capabilities ?? {}
    };
  }
  getCapabilities() {
    return { ...this.capabilities };
  }
  stream(model, context2, options = {}) {
    const stream = new EventStream(
      (event) => event.type === "done",
      (event) => event.message
    );
    const builder = new AssistantStreamBuilder(stream, model.id, model.provider);
    const baseUrl = (options.baseUrl ?? this.defaultBaseUrl).replace(/\/+$/, "");
    const apiKey = options.apiKey ?? this.defaultApiKey;
    void this.run(stream, builder, model, context2, options, baseUrl, apiKey);
    return stream;
  }
  async run(stream, builder, model, context2, options, baseUrl, apiKey) {
    const composed = composeAbortSignals(options.signal, stream.signal);
    try {
      builder.start();
      if (!apiKey) {
        throw new ProviderHttpError(PROVIDER_API$3, 401, "missing apiKey for Gemini provider");
      }
      const body = this.buildRequestBody(context2, options);
      const versionedBase = baseUrl.includes("/v1beta") || baseUrl.includes("/v1") ? baseUrl : `${baseUrl}/v1beta`;
      const url2 = `${versionedBase}/models/${encodeURIComponent(model.id)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url2, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.defaultHeaders
        },
        body: JSON.stringify(body),
        signal: composed.signal
      });
      await ensureOk(response, PROVIDER_API$3);
      const TEXT_INDEX2 = 0;
      const THINKING_INDEX = 1;
      let toolCallCounter = 0;
      let finishReason = null;
      for await (const data of parseSSE(response, composed.signal)) {
        if (composed.signal.aborted) break;
        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.usageMetadata) {
          builder.setUsage({
            inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
            outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
            totalTokens: chunk.usageMetadata.totalTokenCount ?? (chunk.usageMetadata.promptTokenCount ?? 0) + (chunk.usageMetadata.candidatesTokenCount ?? 0)
          });
        }
        const candidate = chunk.candidates?.[0];
        if (!candidate) continue;
        const parts = candidate.content?.parts ?? [];
        for (const part of parts) {
          if ("text" in part && typeof part.text === "string") {
            const textPart = part;
            if (textPart.thought) {
              builder.appendThinking(THINKING_INDEX, textPart.text);
            } else {
              builder.appendText(TEXT_INDEX2, textPart.text);
            }
            continue;
          }
          if ("functionCall" in part) {
            const fc = part.functionCall;
            const slot = 2 + toolCallCounter;
            toolCallCounter += 1;
            const callId = `gemini-call-${Date.now()}-${slot}`;
            builder.ensureToolCall(slot, callId, fc.name);
            const args = JSON.stringify(fc.args ?? {});
            builder.appendToolCallArgs(slot, args);
            builder.endToolCall(slot);
          }
        }
        if (candidate.finishReason) {
          finishReason = candidate.finishReason;
        }
      }
      builder.done(mapFinishReason$2(finishReason, toolCallCounter > 0));
    } catch (err) {
      const error = normalizeError(err);
      builder.fail(error, error.name === "AbortError" ? "aborted" : "error");
    } finally {
    }
  }
  buildRequestBody(context2, options) {
    const { systemInstruction, contents } = toGeminiContents(context2);
    const body = { contents };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }
    const generationConfig = {};
    if (typeof options.temperature === "number") generationConfig.temperature = options.temperature;
    if (typeof options.topP === "number") generationConfig.topP = options.topP;
    if (typeof options.maxTokens === "number") generationConfig.maxOutputTokens = options.maxTokens;
    if (options.reasoningBudget && options.reasoningBudget !== "auto") {
      generationConfig.thinkingConfig = {
        thinkingBudget: options.reasoningBudget === "low" ? 1024 : options.reasoningBudget === "medium" ? 4096 : 8192
      };
    }
    if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;
    if (context2.tools && context2.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: context2.tools.map(toGeminiTool)
        }
      ];
    }
    return body;
  }
}
function toGeminiContents(context2) {
  const contents = [];
  for (const message of context2.messages) {
    contents.push(...convertMessage$3(message));
  }
  return {
    systemInstruction: context2.systemPrompt && context2.systemPrompt.trim() ? context2.systemPrompt : void 0,
    contents
  };
}
function convertMessage$3(message) {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return [{ role: "user", parts: [{ text: message.content }] }];
    }
    const parts = [];
    for (const block of message.content) {
      if (block.type === "text") {
        parts.push({ text: block.text });
      } else if (block.type === "image") {
        parts.push({
          inlineData: { mimeType: block.mimeType, data: block.data }
        });
      }
    }
    return [{ role: "user", parts }];
  }
  if (message.role === "assistant") {
    const parts = [];
    for (const block of message.content) {
      if (block.type === "text") {
        parts.push({ text: block.text });
      } else if (block.type === "toolCall") {
        parts.push({
          functionCall: { name: block.name, args: block.arguments ?? {} }
        });
      }
    }
    return [{ role: "model", parts }];
  }
  const textBlocks = [];
  for (const block of message.content) {
    if (block.type === "text") textBlocks.push(block.text);
  }
  return [
    {
      role: "user",
      parts: [
        {
          functionResponse: {
            name: message.toolName,
            response: { content: textBlocks.join("\n"), isError: message.isError || void 0 }
          }
        }
      ]
    }
  ];
}
function toGeminiTool(tool) {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  };
}
function mapFinishReason$2(reason, hadToolCall) {
  if (hadToolCall && (!reason || reason === "STOP")) return "toolUse";
  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
      return "error";
    default:
      return "stop";
  }
}
const DEFAULT_BASE_URL$2 = "http://localhost:11434";
const PROVIDER_API$2 = "ollama";
class OllamaProvider {
  api = PROVIDER_API$2;
  defaultBaseUrl;
  defaultApiKey;
  defaultHeaders;
  capabilities;
  constructor(options = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? DEFAULT_BASE_URL$2).replace(/\/+$/, "");
    this.defaultApiKey = options.apiKey;
    this.defaultHeaders = { ...options.headers ?? {} };
    this.capabilities = {
      streaming: true,
      nativeToolCalling: true,
      structuredOutput: true,
      vision: false,
      reasoning: false,
      parallelToolCalls: false,
      ...options.capabilities ?? {}
    };
  }
  getCapabilities() {
    return { ...this.capabilities };
  }
  stream(model, context2, options = {}) {
    const stream = new EventStream(
      (event) => event.type === "done",
      (event) => event.message
    );
    const builder = new AssistantStreamBuilder(stream, model.id, model.provider);
    const baseUrl = (options.baseUrl ?? this.defaultBaseUrl).replace(/\/+$/, "");
    const apiKey = options.apiKey ?? this.defaultApiKey;
    void this.run(stream, builder, model, context2, options, baseUrl, apiKey);
    return stream;
  }
  async run(stream, builder, model, context2, options, baseUrl, apiKey) {
    const composed = composeAbortSignals(options.signal, stream.signal);
    try {
      builder.start();
      const body = this.buildRequestBody(model, context2, options);
      const url2 = `${baseUrl}/api/chat`;
      const headers = {
        "Content-Type": "application/json",
        ...this.defaultHeaders
      };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const response = await fetch(url2, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: composed.signal
      });
      await ensureOk(response, PROVIDER_API$2);
      const TEXT_INDEX2 = 0;
      const THINKING_INDEX = 1;
      let toolCallCounter = 0;
      let doneReason = null;
      let lastChunk = null;
      for await (const line of parseJsonLines(response, composed.signal)) {
        if (composed.signal.aborted) break;
        let chunk;
        try {
          chunk = JSON.parse(line);
        } catch {
          continue;
        }
        lastChunk = chunk;
        const message = chunk.message;
        if (message) {
          if (typeof message.thinking === "string" && message.thinking.length > 0) {
            builder.appendThinking(THINKING_INDEX, message.thinking);
          }
          if (typeof message.content === "string" && message.content.length > 0) {
            builder.appendText(TEXT_INDEX2, message.content);
          }
          if (Array.isArray(message.tool_calls)) {
            for (const tc of message.tool_calls) {
              const fn = tc.function;
              if (!fn || !fn.name) continue;
              const slot = 2 + toolCallCounter;
              toolCallCounter += 1;
              const callId = `ollama-call-${Date.now()}-${slot}`;
              builder.ensureToolCall(slot, callId, fn.name);
              const argsRaw = typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {});
              builder.appendToolCallArgs(slot, argsRaw);
              builder.endToolCall(slot);
            }
          }
        }
        if (chunk.done) {
          doneReason = chunk.done_reason ?? "stop";
          if (typeof chunk.prompt_eval_count === "number" || typeof chunk.eval_count === "number") {
            builder.setUsage({
              inputTokens: chunk.prompt_eval_count ?? 0,
              outputTokens: chunk.eval_count ?? 0,
              totalTokens: (chunk.prompt_eval_count ?? 0) + (chunk.eval_count ?? 0)
            });
          }
          break;
        }
      }
      if (!doneReason && lastChunk?.done_reason) {
        doneReason = lastChunk.done_reason;
      }
      builder.done(mapDoneReason(doneReason, toolCallCounter > 0));
    } catch (err) {
      const error = normalizeError(err);
      builder.fail(error, error.name === "AbortError" ? "aborted" : "error");
    } finally {
    }
  }
  buildRequestBody(model, context2, options) {
    const messages = toOllamaMessages(context2);
    const body = {
      model: model.id,
      messages,
      stream: true
    };
    const optionsBlock = {};
    if (typeof options.temperature === "number") optionsBlock.temperature = options.temperature;
    if (typeof options.topP === "number") optionsBlock.top_p = options.topP;
    if (typeof options.maxTokens === "number") optionsBlock.num_predict = options.maxTokens;
    if (Object.keys(optionsBlock).length > 0) body.options = optionsBlock;
    if (context2.tools && context2.tools.length > 0) {
      body.tools = context2.tools.map(toOllamaTool);
    }
    return body;
  }
}
function toOllamaMessages(context2) {
  const out = [];
  if (context2.systemPrompt && context2.systemPrompt.trim()) {
    out.push({ role: "system", content: context2.systemPrompt });
  }
  for (const message of context2.messages) {
    out.push(...convertMessage$2(message));
  }
  return out;
}
function convertMessage$2(message) {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return [{ role: "user", content: message.content }];
    }
    const texts = [];
    const images = [];
    for (const block of message.content) {
      if (block.type === "text") texts.push(block.text);
      else if (block.type === "image") images.push(block.data);
    }
    const out = { role: "user", content: texts.join("\n") };
    if (images.length > 0) out.images = images;
    return [out];
  }
  if (message.role === "assistant") {
    const texts = [];
    const toolCalls = [];
    for (const block of message.content) {
      if (block.type === "text") texts.push(block.text);
      else if (block.type === "toolCall") {
        toolCalls.push({
          function: { name: block.name, arguments: block.arguments ?? {} }
        });
      }
    }
    const out = { role: "assistant", content: texts.join("") };
    if (toolCalls.length > 0) out.tool_calls = toolCalls;
    return [out];
  }
  const textBlocks = [];
  for (const block of message.content) {
    if (block.type === "text") textBlocks.push(block.text);
  }
  return [
    {
      role: "tool",
      content: textBlocks.join("\n"),
      tool_name: message.toolName
    }
  ];
}
function toOllamaTool(tool) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  };
}
function mapDoneReason(reason, hadToolCall) {
  if (hadToolCall && (!reason || reason === "stop")) return "toolUse";
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "load":
    case null:
    case void 0:
      return "stop";
    default:
      return "stop";
  }
}
const DEFAULT_BASE_URL$1 = "https://api.openai.com/v1";
const PROVIDER_API$1 = "openai-compatible";
let OpenAICompatibleProvider$1 = class OpenAICompatibleProvider {
  api = PROVIDER_API$1;
  defaultBaseUrl;
  defaultApiKey;
  defaultHeaders;
  capabilities;
  constructor(options = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? DEFAULT_BASE_URL$1).replace(/\/+$/, "");
    this.defaultApiKey = options.apiKey;
    this.defaultHeaders = { ...options.headers ?? {} };
    this.capabilities = {
      streaming: true,
      nativeToolCalling: true,
      structuredOutput: true,
      vision: true,
      reasoning: false,
      parallelToolCalls: true,
      ...options.capabilities ?? {}
    };
  }
  getCapabilities() {
    return { ...this.capabilities };
  }
  stream(model, context2, options = {}) {
    const stream = new EventStream(
      (event) => event.type === "done",
      (event) => event.message
    );
    const builder = new AssistantStreamBuilder(stream, model.id, model.provider);
    const baseUrl = (options.baseUrl ?? this.defaultBaseUrl).replace(/\/+$/, "");
    const apiKey = options.apiKey ?? this.defaultApiKey;
    void this.run(stream, builder, model, context2, options, baseUrl, apiKey);
    return stream;
  }
  async run(stream, builder, model, context2, options, baseUrl, apiKey) {
    const externalSignal = options.signal;
    const internalSignal = stream.signal;
    const composed = composeAbortSignals(externalSignal, internalSignal);
    try {
      builder.start();
      if (!apiKey) {
        throw new ProviderHttpError(PROVIDER_API$1, 401, "missing apiKey for OpenAI-compatible provider");
      }
      const body = this.buildRequestBody(model, context2, options);
      const url2 = `${baseUrl}/chat/completions`;
      const response = await fetch(url2, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...this.defaultHeaders
        },
        body: JSON.stringify(body),
        signal: composed.signal
      });
      await ensureOk(response, PROVIDER_API$1);
      let finishReason = null;
      const TEXT_INDEX2 = 0;
      const THINKING_INDEX = 1;
      const TOOL_INDEX_BASE2 = 2;
      for await (const data of parseSSE(response, composed.signal)) {
        if (composed.signal.aborted) break;
        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.usage) {
          builder.setUsage({
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens: chunk.usage.total_tokens ?? (chunk.usage.prompt_tokens ?? 0) + (chunk.usage.completion_tokens ?? 0)
          });
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? {};
        const reasoningDelta = delta.reasoning_content ?? delta.reasoning;
        if (typeof reasoningDelta === "string" && reasoningDelta.length > 0) {
          builder.appendThinking(THINKING_INDEX, reasoningDelta);
        }
        if (typeof delta.content === "string" && delta.content.length > 0) {
          builder.appendText(TEXT_INDEX2, delta.content);
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const callIndex = typeof tc.index === "number" ? tc.index : 0;
            const slot = TOOL_INDEX_BASE2 + callIndex;
            builder.ensureToolCall(slot, tc.id ?? "", tc.function?.name ?? "");
            const args = tc.function?.arguments;
            if (typeof args === "string" && args.length > 0) {
              builder.appendToolCallArgs(slot, args);
            }
          }
        }
        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }
      builder.done(mapFinishReason$1(finishReason));
    } catch (err) {
      const error = normalizeError(err);
      builder.fail(error, error.name === "AbortError" ? "aborted" : "error");
    } finally {
    }
  }
  buildRequestBody(model, context2, options) {
    const messages = toOpenAIMessages(context2);
    const body = {
      model: model.id,
      messages,
      stream: true
    };
    if (typeof options.temperature === "number") body.temperature = options.temperature;
    if (typeof options.topP === "number") body.top_p = options.topP;
    if (options.reasoningBudget && options.reasoningBudget !== "auto") {
      body.reasoning_effort = options.reasoningBudget;
    }
    const maxTokens = options.maxTokens ?? model.maxTokens;
    if (typeof maxTokens === "number" && maxTokens > 0) body.max_tokens = maxTokens;
    if (context2.tools && context2.tools.length > 0) {
      body.tools = context2.tools.map(toOpenAITool);
      body.tool_choice = "auto";
    }
    body.stream_options = { include_usage: true };
    return body;
  }
};
function toOpenAIMessages(context2) {
  const out = [];
  if (context2.systemPrompt && context2.systemPrompt.trim()) {
    out.push({ role: "system", content: context2.systemPrompt });
  }
  for (const message of context2.messages) {
    out.push(...convertMessage$1(message));
  }
  return out;
}
function convertMessage$1(message) {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return [{ role: "user", content: message.content }];
    }
    const parts = [];
    for (const block of message.content) {
      if (block.type === "text") {
        parts.push({ type: "text", text: block.text });
      } else if (block.type === "image") {
        parts.push({
          type: "image_url",
          image_url: { url: `data:${block.mimeType};base64,${block.data}` }
        });
      }
    }
    return [{ role: "user", content: parts }];
  }
  if (message.role === "assistant") {
    const text = [];
    const toolCalls = [];
    for (const block of message.content) {
      if (block.type === "text") text.push(block.text);
      else if (block.type === "toolCall") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.arguments ?? {})
          }
        });
      }
    }
    const out = {
      role: "assistant",
      content: text.length > 0 ? text.join("") : null
    };
    if (toolCalls.length > 0) out.tool_calls = toolCalls;
    return [out];
  }
  const textBlocks = [];
  for (const block of message.content) {
    if (block.type === "text") textBlocks.push(block.text);
  }
  return [
    {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: textBlocks.join("\n")
    }
  ];
}
function toOpenAITool(tool) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  };
}
function mapFinishReason$1(reason) {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
    case "function_call":
      return "toolUse";
    case "content_filter":
      return "error";
    default:
      return "stop";
  }
}
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const PROVIDER_API = "openai-responses";
const TEXT_INDEX = 0;
const REASONING_INDEX = 1;
const TOOL_INDEX_BASE = 2;
class OpenAIResponsesProvider {
  api = PROVIDER_API;
  defaultBaseUrl;
  defaultApiKey;
  accountId;
  defaultHeaders;
  capabilities;
  constructor(options = {}) {
    this.defaultBaseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.defaultApiKey = options.apiKey;
    this.accountId = options.accountId?.trim() || void 0;
    this.defaultHeaders = { ...options.headers ?? {} };
    this.capabilities = {
      streaming: true,
      nativeToolCalling: true,
      structuredOutput: true,
      vision: true,
      reasoning: true,
      parallelToolCalls: true,
      ...options.capabilities ?? {}
    };
  }
  getCapabilities() {
    return { ...this.capabilities };
  }
  stream(model, context2, options = {}) {
    const stream = new EventStream(
      (event) => event.type === "done",
      (event) => event.message
    );
    const builder = new AssistantStreamBuilder(stream, model.id, model.provider);
    const baseUrl = (options.baseUrl ?? this.defaultBaseUrl).replace(/\/+$/, "");
    const apiKey = options.apiKey ?? this.defaultApiKey;
    void this.run(stream, builder, model, context2, options, baseUrl, apiKey);
    return stream;
  }
  async run(stream, builder, model, context2, options, baseUrl, apiKey) {
    const composed = composeAbortSignals(options.signal, stream.signal);
    try {
      builder.start();
      if (!apiKey) {
        throw new ProviderHttpError(PROVIDER_API, 401, "missing apiKey for OpenAI Responses provider");
      }
      const response = await fetch(createResponsesUrl(baseUrl), {
        method: "POST",
        headers: this.createHeaders(apiKey),
        body: JSON.stringify(buildRequestBody(model, context2, options)),
        signal: composed.signal
      });
      await ensureOk(response, PROVIDER_API);
      const toolSlotsByItemId = /* @__PURE__ */ new Map();
      const toolArgBuffers = /* @__PURE__ */ new Map();
      let sawToolCall = false;
      let finishReason = "stop";
      for await (const data of parseSSE(response, composed.signal)) {
        if (composed.signal.aborted) break;
        const event = parseJsonObject(data);
        if (!event) continue;
        const eventType = readString$1(event.type);
        switch (eventType) {
          case "response.output_text.delta": {
            const delta = readString$1(event.delta) || readString$1(event.text);
            if (delta) builder.appendText(TEXT_INDEX, delta);
            break;
          }
          case "response.output_text.done":
            builder.endText(TEXT_INDEX);
            break;
          case "response.reasoning_summary_text.delta": {
            const delta = readString$1(event.delta) || readString$1(event.text);
            if (delta) builder.appendThinking(REASONING_INDEX, delta);
            break;
          }
          case "response.reasoning_summary_text.done":
            builder.endThinking(REASONING_INDEX);
            break;
          case "response.output_item.added": {
            const outputIndex = readNumber(event.output_index) ?? 0;
            const item = readRecord(event.item);
            if (readString$1(item?.type) === "function_call") {
              const slot = TOOL_INDEX_BASE + outputIndex;
              const itemId = readString$1(item?.id);
              if (itemId) toolSlotsByItemId.set(itemId, slot);
              sawToolCall = true;
              builder.ensureToolCall(
                slot,
                readString$1(item?.call_id) || readString$1(item?.id) || "",
                readString$1(item?.name) || ""
              );
            }
            break;
          }
          case "response.function_call_arguments.delta": {
            const slot = resolveToolSlot(event, toolSlotsByItemId);
            const delta = readString$1(event.delta);
            if (slot !== null && delta) {
              toolArgBuffers.set(slot, `${toolArgBuffers.get(slot) ?? ""}${delta}`);
              builder.appendToolCallArgs(slot, delta);
            }
            break;
          }
          case "response.function_call_arguments.done": {
            const slot = resolveToolSlot(event, toolSlotsByItemId);
            const args = readString$1(event.arguments);
            if (slot !== null && args && !toolArgBuffers.get(slot)) {
              toolArgBuffers.set(slot, args);
              builder.appendToolCallArgs(slot, args);
            }
            if (slot !== null) builder.endToolCall(slot);
            break;
          }
          case "response.output_item.done": {
            const outputIndex = readNumber(event.output_index) ?? 0;
            const item = readRecord(event.item);
            if (readString$1(item?.type) === "function_call") {
              const slot = TOOL_INDEX_BASE + outputIndex;
              const itemId = readString$1(item?.id);
              if (itemId) toolSlotsByItemId.set(itemId, slot);
              sawToolCall = true;
              builder.ensureToolCall(
                slot,
                readString$1(item?.call_id) || readString$1(item?.id) || "",
                readString$1(item?.name) || ""
              );
              const args = readString$1(item?.arguments);
              if (args && !toolArgBuffers.get(slot)) {
                toolArgBuffers.set(slot, args);
                builder.appendToolCallArgs(slot, args);
              }
              builder.endToolCall(slot);
            }
            break;
          }
          case "response.completed": {
            const completed = readRecord(event.response);
            if (completed) {
              applyCompletedResponse(builder, completed);
              finishReason = completed.status === "incomplete" ? "length" : sawToolCall ? "toolUse" : "stop";
            }
            break;
          }
          case "response.incomplete":
            finishReason = "length";
            break;
          case "response.failed": {
            const failed = readRecord(event.response);
            const error = readRecord(failed?.error);
            throw new ProviderHttpError(
              PROVIDER_API,
              502,
              readString$1(error?.message) || "OpenAI Responses request failed"
            );
          }
          case "error":
            throw new ProviderHttpError(PROVIDER_API, 502, readString$1(event.message) || "OpenAI Responses stream error");
          default:
            break;
        }
      }
      builder.done(finishReason);
    } catch (err) {
      const error = normalizeError(err);
      builder.fail(error, error.name === "AbortError" ? "aborted" : "error");
    } finally {
    }
  }
  createHeaders(apiKey) {
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...this.defaultHeaders
    };
    if (this.accountId) {
      headers["chatgpt-account-id"] = this.accountId;
    }
    return headers;
  }
}
function createResponsesUrl(baseUrl) {
  return baseUrl.endsWith("/responses") ? baseUrl : `${baseUrl}/responses`;
}
function buildRequestBody(model, context2, options) {
  const body = {
    model: model.id,
    input: toResponsesInput$1(context2),
    stream: true,
    store: false,
    parallel_tool_calls: true
  };
  if (context2.systemPrompt?.trim()) {
    body.instructions = context2.systemPrompt.trim();
  }
  if (typeof options.temperature === "number") body.temperature = options.temperature;
  if (typeof options.topP === "number") body.top_p = options.topP;
  if (options.reasoningBudget && options.reasoningBudget !== "auto") {
    body.reasoning = { effort: options.reasoningBudget };
  } else if (options.reasoningVisibility === "summary-events") {
    body.reasoning = { effort: "medium" };
  }
  if (options.reasoningVisibility === "summary-events") {
    const reasoning = body.reasoning && typeof body.reasoning === "object" ? body.reasoning : {};
    body.reasoning = { ...reasoning, summary: "auto" };
  }
  const maxTokens = options.maxTokens ?? model.maxTokens;
  if (typeof maxTokens === "number" && maxTokens > 0) {
    body.max_output_tokens = maxTokens;
  }
  if (context2.tools && context2.tools.length > 0) {
    body.tools = context2.tools.map(toResponsesTool);
    body.tool_choice = "auto";
  }
  return body;
}
function toResponsesInput$1(context2) {
  const items = [];
  for (const message of context2.messages) {
    items.push(...convertMessage(message));
  }
  return items;
}
function convertMessage(message) {
  if (message.role === "user") {
    return [toInputMessage("user", message.content)];
  }
  if (message.role === "assistant") {
    const items = [];
    const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
    if (text) {
      items.push({ role: "assistant", content: text, type: "message" });
    }
    for (const block of message.content) {
      if (block.type === "toolCall") {
        items.push({
          type: "function_call",
          call_id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.arguments ?? {}),
          status: "completed"
        });
      }
    }
    return items;
  }
  const output = message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
  return [{
    type: "function_call_output",
    call_id: message.toolCallId,
    output
  }];
}
function toInputMessage(role, content) {
  if (typeof content === "string") {
    return { role, content, type: "message" };
  }
  const parts = content.flatMap((block) => {
    if (block.type === "text") {
      return [{ type: "input_text", text: block.text ?? "" }];
    }
    if (block.type === "image" && block.data && block.mimeType) {
      return [{ type: "input_image", image_url: `data:${block.mimeType};base64,${block.data}` }];
    }
    return [];
  });
  return { role, content: parts.length > 0 ? parts : [{ type: "input_text", text: "" }], type: "message" };
}
function toResponsesTool(tool) {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  };
}
function applyCompletedResponse(builder, payload) {
  if (payload.usage) {
    builder.setUsage({
      inputTokens: payload.usage.input_tokens ?? 0,
      outputTokens: payload.usage.output_tokens ?? 0,
      totalTokens: payload.usage.total_tokens ?? (payload.usage.input_tokens ?? 0) + (payload.usage.output_tokens ?? 0)
    });
  }
}
function resolveToolSlot(event, toolSlotsByItemId) {
  const itemId = readString$1(event.item_id);
  if (itemId && toolSlotsByItemId.has(itemId)) {
    return toolSlotsByItemId.get(itemId) ?? null;
  }
  const outputIndex = readNumber(event.output_index);
  return outputIndex === null ? null : TOOL_INDEX_BASE + outputIndex;
}
function parseJsonObject(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function readRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function readString$1(value) {
  return typeof value === "string" ? value : "";
}
function readNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
const CONFIGURED_PROVIDER_API = "rdc-agent-configured-provider";
function encodeAgentModel(providerId, modelId) {
  return {
    id: `${providerId}::${modelId}`,
    name: modelId,
    provider: providerId,
    api: CONFIGURED_PROVIDER_API,
    contextWindow: 128e3,
    maxTokens: 4096,
    reasoning: false,
    vision: false
  };
}
function decodeAgentModel(model) {
  const marker = "::";
  const idx = model.id.indexOf(marker);
  if (idx > 0) {
    return {
      providerId: model.id.slice(0, idx),
      modelId: model.id.slice(idx + marker.length)
    };
  }
  return {
    providerId: model.provider,
    modelId: model.id
  };
}
function requireProviderProtocol(provider) {
  if (!provider.protocol) {
    throw new Error(`Provider ${provider.id} has no configured protocol.`);
  }
  return provider.protocol;
}
function normalizeLocalBaseUrl(baseUrl) {
  return baseUrl?.replace(/\/v1\/?$/i, "");
}
function toRuntimeApi(protocol) {
  switch (protocol) {
    case "AnthropicMessages":
      return "anthropic-messages";
    case "GoogleGemini":
      return "google-gemini";
    case "OllamaOpenAICompatibleChatCompletions":
      return "ollama";
    case "OpenAIResponses":
      return "openai-responses";
    case "OpenAICompatibleChatCompletions":
    case "OpenRouterChatCompletions":
      return "openai-compatible";
    case "AzureOpenAIChatCompletions":
      return "azure-openai";
    case "AwsBedrock":
      return "bedrock";
    case "GoogleVertexAI":
      return "vertex";
    default:
      return protocol;
  }
}
function createProviderStrategy(provider, protocol) {
  switch (protocol) {
    case "AnthropicMessages":
      return new AnthropicProvider$1({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl
      });
    case "GoogleGemini":
      return new GeminiProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl
      });
    case "OllamaOpenAICompatibleChatCompletions":
      return new OllamaProvider({
        apiKey: provider.apiKey || void 0,
        baseUrl: normalizeLocalBaseUrl(provider.baseUrl)
      });
    case "OpenRouterChatCompletions":
      return new OpenAICompatibleProvider$1({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        headers: {
          "HTTP-Referer": "https://rdcagent.local",
          "X-Title": "RDC-Agent"
        }
      });
    case "OpenAICompatibleChatCompletions":
      return new OpenAICompatibleProvider$1({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl
      });
    case "OpenAIResponses":
      return new OpenAIResponsesProvider({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        accountId: provider.accountId
      });
    case "AzureOpenAIChatCompletions":
    case "AwsBedrock":
    case "GoogleVertexAI":
    default:
      throw new Error(`Provider protocol "${protocol}" is not available in the agent runtime provider path.`);
  }
}
function missingProviderStream(error) {
  const stream = new EventStream(
    (event) => event.type === "done",
    (event) => event.message
  );
  queueMicrotask(() => {
    stream.error(error);
  });
  return stream;
}
class ConfiguredRuntimeProvider {
  api = CONFIGURED_PROVIDER_API;
  getCapabilities() {
    return {
      streaming: true,
      nativeToolCalling: true,
      structuredOutput: true,
      vision: true,
      reasoning: true,
      parallelToolCalls: true
    };
  }
  stream(model, context2, options = {}) {
    const decoded = decodeAgentModel(model);
    const llmConfig = settingsService.getLlmConfig();
    const provider = llmConfig.providers.find((entry) => entry.id === decoded.providerId);
    if (!provider) {
      return missingProviderStream(new Error(`No verified configured provider is available for ${decoded.providerId}.`));
    }
    if (!provider.models.includes(decoded.modelId)) {
      return missingProviderStream(new Error(`Model ${decoded.providerId}/${decoded.modelId} is not enabled for agent runtime.`));
    }
    let protocol;
    try {
      protocol = requireProviderProtocol(provider);
    } catch (error) {
      return missingProviderStream(error instanceof Error ? error : new Error(String(error)));
    }
    const runtimeBaseUrl = protocol === "OllamaOpenAICompatibleChatCompletions" ? normalizeLocalBaseUrl(provider.baseUrl) : provider.baseUrl;
    const runtimeModel = {
      ...model,
      id: decoded.modelId,
      name: decoded.modelId,
      provider: decoded.providerId,
      api: toRuntimeApi(protocol)
    };
    let strategy;
    try {
      strategy = createProviderStrategy(provider, protocol);
    } catch (error) {
      return missingProviderStream(error instanceof Error ? error : new Error(String(error)));
    }
    return strategy.stream(runtimeModel, context2, {
      ...options,
      apiKey: provider.apiKey,
      baseUrl: runtimeBaseUrl
    });
  }
}
const configuredRuntimeProvider = new ConfiguredRuntimeProvider();
const INDEX_FILENAME = "MEMORY.md";
function slugify(name) {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    try {
      meta[key] = JSON.parse(value);
    } catch {
      meta[key] = value.replace(/^['"]|['"]$/g, "");
    }
  }
  return { meta, body: match[2].trim() };
}
function serializeFrontmatterValue(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
function buildMemoryFile(record) {
  const lines = ["---"];
  lines.push(`id: ${serializeFrontmatterValue(record.id)}`);
  lines.push(`name: ${serializeFrontmatterValue(record.name)}`);
  lines.push(`description: ${serializeFrontmatterValue(record.description)}`);
  lines.push(`type: ${serializeFrontmatterValue(record.type)}`);
  if (record.tags && record.tags.length > 0) {
    lines.push(`tags: ${JSON.stringify(record.tags)}`);
  }
  lines.push(`createdAt: ${record.createdAt}`);
  lines.push(`updatedAt: ${record.updatedAt}`);
  lines.push("---");
  lines.push("");
  lines.push(record.content.trim());
  lines.push("");
  return lines.join("\n");
}
class MemoryStore {
  memoryDir;
  /**
   * @param memoryDir 记忆文件所在目录。建议传入绝对路径（例如
   *                  `path.join(workspaceRoot, '.rdc-agent', 'memory')`）。
   */
  constructor(memoryDir) {
    this.memoryDir = memoryDir;
  }
  /**
   * 获取存储目录路径。
   */
  getMemoryDir() {
    return this.memoryDir;
  }
  /**
   * 写入一条新的记忆，并重建索引。
   *
   * - ID 由 `mem_${Date.now()}_${hex}` 生成；
   * - 文件名采用 slug 化的 `name`，重复写入会覆盖同名文件并保留原始 `createdAt`。
   */
  async writeMemory(input) {
    await this.ensureDir();
    const slug = slugify(input.name);
    if (!slug) {
      throw new Error(`MemoryStore.writeMemory: 无法将 name="${input.name}" 转为有效 slug`);
    }
    const filePath = path__namespace$1.join(this.memoryDir, `${slug}.md`);
    const now = Date.now();
    let existing = null;
    try {
      existing = await this.parseMemoryFile(filePath);
    } catch {
      existing = null;
    }
    const record = {
      id: existing?.id ?? `mem_${now}_${node_crypto.randomBytes(4).toString("hex")}`,
      name: slug,
      description: input.description,
      type: input.type,
      content: input.content,
      tags: input.tags,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    await node_fs.promises.writeFile(filePath, buildMemoryFile(record), "utf8");
    await this.rebuildIndex();
    return record;
  }
  /**
   * 删除指定 slug 名称的记忆文件，并重建索引。
   * @returns 是否真的删除成功（文件不存在时返回 false）。
   */
  async deleteMemory(name) {
    const slug = slugify(name);
    if (!slug) return false;
    const filePath = path__namespace$1.join(this.memoryDir, `${slug}.md`);
    try {
      await node_fs.promises.unlink(filePath);
    } catch (err) {
      const code = err.code;
      if (code === "ENOENT") return false;
      throw err;
    }
    await this.rebuildIndex();
    return true;
  }
  /**
   * 按 slug 名称读取单条记忆。
   * @returns 不存在或无法解析时返回 `null`。
   */
  async getMemory(name) {
    const slug = slugify(name);
    if (!slug) return null;
    const filePath = path__namespace$1.join(this.memoryDir, `${slug}.md`);
    try {
      return await this.parseMemoryFile(filePath);
    } catch (err) {
      const code = err.code;
      if (code === "ENOENT") return null;
      return null;
    }
  }
  /**
   * 列出全部记忆（不含 `MEMORY.md` 索引文件），按 name 排序返回。
   */
  async listMemories() {
    await this.ensureDir();
    let entries = [];
    try {
      entries = await node_fs.promises.readdir(this.memoryDir);
    } catch {
      return [];
    }
    const records = [];
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      if (entry === INDEX_FILENAME) continue;
      const filePath = path__namespace$1.join(this.memoryDir, entry);
      try {
        const record = await this.parseMemoryFile(filePath);
        records.push(record);
      } catch {
      }
    }
    records.sort((a, b) => a.name.localeCompare(b.name));
    return records;
  }
  /**
   * 根据当前目录下所有记忆文件重建 `MEMORY.md` 索引。
   */
  async rebuildIndex() {
    await this.ensureDir();
    const records = await this.listMemories();
    const lines = records.map(
      (record) => `- [${record.name}](${record.name}.md) — ${record.description}`
    );
    const indexPath = path__namespace$1.join(this.memoryDir, INDEX_FILENAME);
    const content = lines.length > 0 ? `${lines.join("\n")}
` : "";
    await node_fs.promises.writeFile(indexPath, content, "utf8");
  }
  /**
   * 返回 `MEMORY.md` 当前内容，便于注入 system prompt。
   * 文件缺失时返回空字符串。
   */
  async getIndexContent() {
    const indexPath = path__namespace$1.join(this.memoryDir, INDEX_FILENAME);
    try {
      const text = await node_fs.promises.readFile(indexPath, "utf8");
      return text.trim();
    } catch {
      return "";
    }
  }
  /**
   * 解析单个记忆文件为 `MemoryRecord`。
   * 缺失字段会被赋予合理默认值（保证向前兼容）。
   */
  async parseMemoryFile(filePath) {
    const raw = await node_fs.promises.readFile(filePath, "utf8");
    const { meta, body } = parseFrontmatter(raw);
    const fallbackName = path__namespace$1.basename(filePath, ".md");
    const name = typeof meta.name === "string" && meta.name ? meta.name : fallbackName;
    const description = typeof meta.description === "string" ? meta.description : body.split(/\r?\n/)[0] ?? "";
    const rawType = typeof meta.type === "string" ? meta.type : "user";
    const type = ["user", "feedback", "project", "reference"].includes(rawType) ? rawType : "user";
    const tags = Array.isArray(meta.tags) ? meta.tags.filter((item) => typeof item === "string") : void 0;
    const createdAt = typeof meta.createdAt === "number" ? meta.createdAt : Number(meta.createdAt) || Date.now();
    const updatedAt = typeof meta.updatedAt === "number" ? meta.updatedAt : Number(meta.updatedAt) || createdAt;
    const id = typeof meta.id === "string" && meta.id ? meta.id : `mem_${createdAt}_${node_crypto.randomBytes(4).toString("hex")}`;
    return {
      id,
      name,
      description,
      type,
      content: body,
      tags,
      createdAt,
      updatedAt
    };
  }
  /**
   * 确保记忆目录存在。
   */
  async ensureDir() {
    await node_fs.promises.mkdir(this.memoryDir, { recursive: true });
  }
}
const MAX_DIALOGUE_CHARS = 4e3;
function extractJsonArray(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function isValidType(value) {
  return value === "user" || value === "feedback" || value === "project" || value === "reference";
}
function normalizeExtracted(item) {
  if (!item || typeof item !== "object") return null;
  const record = item;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  const rawType = record.type;
  const content = typeof record.content === "string" ? record.content : typeof record.body === "string" ? record.body : "";
  if (!name || !description || !content.trim()) return null;
  const type = isValidType(rawType) ? rawType : "user";
  return { name, description, type, content: content.trim() };
}
class MemoryExtractor {
  memoryStore;
  queryLlm;
  constructor(options) {
    this.memoryStore = options.memoryStore;
    this.queryLlm = options.queryLlm;
  }
  /**
   * 从对话中抽取候选记忆。
   *
   * @param messages       原始对话（不含已压缩过的摘要），仅取最近若干条；
   * @param existingMemories  已存在的记忆，用于去重 + 提供 LLM 上下文。
   *                          若调用方未传入，会自动从 store 读取。
   */
  async extractFromConversation(messages, existingMemories) {
    const recent = messages.slice(-10);
    const dialogue = recent.map((msg) => {
      const content = typeof msg.content === "string" ? msg.content.trim() : "";
      if (!content) return "";
      return `${msg.role}: ${content}`;
    }).filter((line) => line.length > 0).join("\n");
    if (!dialogue.trim()) return [];
    const existing = existingMemories ?? await this.memoryStore.listMemories();
    const existingDesc = existing.length > 0 ? existing.map((m) => `- ${m.name}: ${m.description}`).join("\n") : "(none)";
    const prompt = `Extract user preferences, constraints, or project facts from this dialogue.
Return a JSON array. Each item: {name, type, description, content}.
- name: short kebab-case identifier (e.g. 'user-preference-tabs')
- type: one of 'user' (user preference), 'feedback' (guidance), 'project' (project fact), 'reference' (external pointer)
- description: one-line summary for index lookup
- content: full detail in markdown
If nothing new or already covered by existing memories, return [].

Existing memories:
${existingDesc}

Dialogue:
${dialogue.slice(0, MAX_DIALOGUE_CHARS)}`;
    let response;
    try {
      response = await this.queryLlm(prompt);
    } catch {
      return [];
    }
    const items = extractJsonArray(response);
    if (!items) return [];
    const existingNames = new Set(existing.map((m) => m.name));
    const seenNames = /* @__PURE__ */ new Set();
    const results = [];
    for (const raw of items) {
      const normalized = normalizeExtracted(raw);
      if (!normalized) continue;
      if (existingNames.has(normalized.name)) continue;
      if (seenNames.has(normalized.name)) continue;
      seenNames.add(normalized.name);
      results.push(normalized);
    }
    return results;
  }
}
const MAX_CATALOG_CHARS = 16e3;
const DEFAULT_THRESHOLD = 10;
function parseConsolidatePlan(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { merge: [], delete: [] };
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return { merge: [], delete: [] };
  }
  if (!parsed || typeof parsed !== "object") return { merge: [], delete: [] };
  const obj = parsed;
  const merge = [];
  if (Array.isArray(obj.merge)) {
    for (const group of obj.merge) {
      if (!Array.isArray(group)) continue;
      const names = group.filter((n) => typeof n === "string" && n.trim().length > 0);
      if (names.length < 2) continue;
      merge.push(names);
    }
  }
  const deleteList = Array.isArray(obj.delete) ? obj.delete.filter((n) => typeof n === "string" && n.trim().length > 0) : [];
  return { merge, delete: deleteList };
}
class MemoryConsolidator {
  memoryStore;
  queryLlm;
  threshold;
  constructor(options) {
    this.memoryStore = options.memoryStore;
    this.queryLlm = options.queryLlm;
    this.threshold = options.threshold ?? DEFAULT_THRESHOLD;
  }
  /**
   * 是否需要触发整理：当前记忆条数 ≥ 阈值。
   */
  async shouldConsolidate() {
    const all = await this.memoryStore.listMemories();
    return all.length >= this.threshold;
  }
  /**
   * 执行整理流程。整理失败或 LLM 不返回有效计划时，原样返回空操作结果。
   */
  async consolidate() {
    const all = await this.memoryStore.listMemories();
    const empty = {
      merged: [],
      deleted: [],
      kept: all.map((m) => m.name)
    };
    if (all.length === 0) return empty;
    const catalog = all.map(
      (record) => `## ${record.name}
description: ${record.description}
type: ${record.type}
${record.content}`
    ).join("\n\n").slice(0, MAX_CATALOG_CHARS);
    const prompt = `Consolidate the following memory entries. Rules:
1. Merge duplicates or strongly overlapping entries into one.
2. Remove outdated or contradicted entries.
3. Preserve important user preferences above all.
Return ONLY a JSON object of the shape:
{ "merge": [["nameA", "nameB"]], "delete": ["nameC"] }
Each merge group lists the names to combine; the first name will be reused as the merged record name.
If no change is needed, return { "merge": [], "delete": [] }.

Memories:
${catalog}`;
    let response;
    try {
      response = await this.queryLlm(prompt);
    } catch {
      return empty;
    }
    const plan = parseConsolidatePlan(response);
    const byName = new Map(all.map((m) => [m.name, m]));
    const merged = [];
    const deleted = [];
    for (const group of plan.merge) {
      const sources = group.map((name) => byName.get(name)).filter((m) => Boolean(m));
      if (sources.length < 2) continue;
      const target = sources[0];
      const mergedContent = sources.map((m) => `### ${m.name}
${m.description}

${m.content}`).join("\n\n---\n\n");
      const mergedTags = Array.from(
        new Set(sources.flatMap((m) => m.tags ?? []).filter((t) => t))
      );
      await this.memoryStore.writeMemory({
        name: target.name,
        description: target.description,
        type: target.type,
        content: mergedContent,
        tags: mergedTags.length > 0 ? mergedTags : void 0
      });
      for (const source of sources.slice(1)) {
        const ok = await this.memoryStore.deleteMemory(source.name);
        if (ok) {
          merged.push(source.name);
          byName.delete(source.name);
        }
      }
    }
    for (const name of plan.delete) {
      if (!byName.has(name)) continue;
      const ok = await this.memoryStore.deleteMemory(name);
      if (ok) {
        deleted.push(name);
        byName.delete(name);
      }
    }
    await this.memoryStore.rebuildIndex();
    const final = await this.memoryStore.listMemories();
    return {
      merged,
      deleted,
      kept: final.map((m) => m.name)
    };
  }
}
const NATIVE_TOOL_PROTOCOLS = /* @__PURE__ */ new Set([
  "AnthropicMessages",
  "OpenAIResponses",
  "OpenAICompatibleChatCompletions",
  "OpenRouterChatCompletions",
  "GoogleGemini",
  "OllamaOpenAICompatibleChatCompletions"
]);
const STREAMING_PROTOCOLS = /* @__PURE__ */ new Set([
  "AnthropicMessages",
  "OpenAIResponses",
  "OpenAICompatibleChatCompletions",
  "OpenRouterChatCompletions",
  "GoogleGemini",
  "OllamaOpenAICompatibleChatCompletions"
]);
const PROTOCOL_REASONING_DELIVERY = {
  OpenAIResponses: "summary-only",
  AnthropicMessages: "summary-only",
  GoogleGemini: "stream-full",
  OllamaOpenAICompatibleChatCompletions: "stream-full",
  OpenAICompatibleChatCompletions: "stream-full",
  OpenRouterChatCompletions: "stream-full"
};
function readProviderProtocol(provider) {
  if (!provider) {
    return null;
  }
  return provider.protocol ?? null;
}
function hasCapability(provider, capability) {
  return Boolean(provider?.capabilities?.includes(capability));
}
function resolveReasoningDelivery(provider, protocol) {
  if (!provider || !protocol || !hasCapability(provider, "reasoning")) {
    return "none";
  }
  return PROTOCOL_REASONING_DELIVERY[protocol] ?? "stream-full";
}
function reasoningDeliveryToStreamVisibility(delivery) {
  if (delivery === "summary-only") return "summary-events";
  if (delivery === "hidden") return "hidden";
  return "none";
}
function disabledCapability(providerId, modelId) {
  return {
    providerId,
    modelId,
    toolCallingMode: "disabled",
    reasoningVisibility: "none",
    reasoningDelivery: "none",
    supportsStreaming: false,
    supportsToolResults: false
  };
}
function resolveAgentRouteCapability(provider, modelId) {
  const providerId = provider?.id ?? "";
  if (!provider || !provider.enabled || !provider.isConfigured || provider.status !== "verified") {
    return disabledCapability(providerId, modelId);
  }
  if (!hasCapability(provider, "chat")) {
    return disabledCapability(provider.id, modelId);
  }
  const protocol = readProviderProtocol(provider);
  if (!protocol) {
    return disabledCapability(provider.id, modelId);
  }
  const supportsStreaming = STREAMING_PROTOCOLS.has(protocol);
  const runtimeHasNativeTools = NATIVE_TOOL_PROTOCOLS.has(protocol);
  let toolCallingMode = "text-only";
  if (hasCapability(provider, "tool-calling") && runtimeHasNativeTools) {
    toolCallingMode = "native-structured";
  } else if (!supportsStreaming) {
    toolCallingMode = "disabled";
  }
  const reasoningDelivery = resolveReasoningDelivery(provider, protocol);
  const reasoningVisibility = reasoningDeliveryToStreamVisibility(reasoningDelivery);
  return {
    providerId: provider.id,
    modelId,
    toolCallingMode,
    reasoningVisibility,
    reasoningDelivery,
    supportsStreaming,
    supportsToolResults: toolCallingMode === "native-structured"
  };
}
function describeRouteCapabilityDiagnostic(capability, availableToolCount) {
  if (availableToolCount <= 0 || capability.toolCallingMode === "native-structured") {
    return null;
  }
  if (capability.toolCallingMode === "disabled") {
    return `Current route ${capability.providerId}/${capability.modelId} is not available for structured agent tools. Tools were not registered and no textual tool calls will be executed.`;
  }
  return `Current route ${capability.providerId}/${capability.modelId} is text-only for agent tools. Tools were not registered and textual tool calls will not be executed.`;
}
function buildSharedAgentEvent(type, payload, context2) {
  return {
    id: generateEventId("agent-event"),
    type,
    timestamp: nowMs(),
    runId: context2.runId,
    turnId: context2.turnId,
    sessionId: context2.sessionId ?? null,
    agentId: context2.agentId,
    stage: context2.stage,
    phase: context2.phase,
    payload
  };
}
function buildDiagnosticAgentEvent(context2, input) {
  return buildSharedAgentEvent(
    "diagnostic",
    {
      code: input.code,
      severity: input.severity,
      message: input.message,
      technicalMessage: input.technicalMessage
    },
    context2
  );
}
function mentionsTextualToolCall(text) {
  return /(?:tool\s*call|function\s*call|工具调用|调用工具)\s*[:：]\s*[\w.-]+\s*\(/i.test(text);
}
function translateCoreToSharedAgentEvent(event, context2) {
  switch (event.type) {
    case "agent_start": {
      return buildSharedAgentEvent(
        "run.started",
        {
          mode: context2.mode ?? "debugger",
          patternId: context2.patternId,
          providerId: context2.providerId ?? "",
          modelId: context2.modelId ?? "",
          toolAllowlist: context2.toolAllowlist ?? [],
          routeCapability: context2.routeCapability
        },
        context2
      );
    }
    case "agent_end": {
      const text = extractAssistantText(event.messages);
      return buildSharedAgentEvent(
        "run.completed",
        {
          status: "complete",
          text
        },
        context2
      );
    }
    case "message_update": {
      const ev = event.assistantMessageEvent;
      if (ev.type === "text_delta") {
        return buildSharedAgentEvent("assistant.delta", { text: ev.delta }, context2);
      }
      if (ev.type === "thinking_delta") {
        return buildSharedAgentEvent("assistant.thinking_delta", { text: ev.delta }, context2);
      }
      if (ev.type === "thinking_end") {
        return buildSharedAgentEvent("assistant.thinking_end", { text: ev.content }, context2);
      }
      if (ev.type === "thinking_start") {
        return null;
      }
      if (ev.type === "toolcall_end") {
        return buildSharedAgentEvent(
          "tool.requested",
          {
            toolCall: {
              id: ev.toolCall.id,
              name: ev.toolCall.name,
              arguments: ev.toolCall.arguments
            }
          },
          context2
        );
      }
      return null;
    }
    case "message_end": {
      if (event.message.role === "assistant") {
        const text = extractAssistantTextFromContent(event.message.content);
        const thinkingText = extractAssistantThinkingFromContent(event.message.content);
        return buildSharedAgentEvent(
          "assistant.completed",
          {
            text,
            thinkingText: thinkingText || void 0,
            usage: event.message.usage ? {
              inputTokens: event.message.usage.inputTokens,
              outputTokens: event.message.usage.outputTokens
            } : void 0
          },
          context2
        );
      }
      return null;
    }
    case "tool_execution_start": {
      return buildSharedAgentEvent(
        "tool.started",
        {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args
        },
        context2
      );
    }
    case "tool_execution_end": {
      const sharedResult = toolResultToSharedResult(event.result, event.durationMs);
      const approvalReason = getApprovalRequiredReason(event.result);
      if (approvalReason) {
        return buildSharedAgentEvent(
          "approval.requested",
          {
            approvalId: `approval-${event.toolCallId}`,
            title: `Approve ${event.toolName}`,
            status: "pending",
            reason: approvalReason,
            kind: "tool",
            toolCallId: event.toolCallId,
            toolName: event.toolName
          },
          context2
        );
      }
      const denialReason = getPolicyDenialReason(event.result);
      if (denialReason) {
        return buildSharedAgentEvent(
          "tool.denied",
          {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            reason: denialReason,
            result: sharedResult
          },
          context2
        );
      }
      return buildSharedAgentEvent(
        "tool.completed",
        {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: sharedResult
        },
        context2
      );
    }
    case "approval_requested": {
      return buildSharedAgentEvent(
        "approval.requested",
        {
          approvalId: `approval-${event.toolCallId}`,
          title: `Approve ${event.toolName}`,
          status: "pending",
          reason: `Approval required before ${event.toolName} can run.`,
          kind: "tool",
          toolCallId: event.toolCallId,
          toolName: event.toolName
        },
        context2
      );
    }
    case "approval_resolved": {
      return buildSharedAgentEvent(
        "approval.answered",
        {
          approvalId: `approval-${event.toolCallId}`,
          title: `Approve ${event.toolCallId}`,
          status: event.approved ? "approved" : "rejected",
          kind: "tool",
          toolCallId: event.toolCallId
        },
        context2
      );
    }
    case "error": {
      return buildSharedAgentEvent(
        "run.failed",
        {
          status: "failed",
          error: event.error.message || String(event.error)
        },
        context2
      );
    }
    default:
      return null;
  }
}
function getApprovalRequiredReason(result) {
  if (!result.isError) return null;
  const message = extractToolResultText(result);
  return message.toLowerCase().includes("approval required") ? message : null;
}
function getPolicyDenialReason(result) {
  if (!result.isError) return null;
  const message = extractToolResultText(result);
  return message.toLowerCase().includes("policy denied") ? message : null;
}
function extractToolResultText(result) {
  return result.content.filter((block) => block.type === "text").map((block) => block.text).join("");
}
function extractAssistantText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      return extractAssistantTextFromContent(msg.content);
    }
  }
  return "";
}
function extractAssistantTextFromContent(content) {
  return content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
}
function extractAssistantThinkingFromContent(content) {
  return content.filter((block) => block.type === "thinking").map((block) => block.thinking ?? "").join("");
}
function toolResultToSharedResult(result, durationMs) {
  if (result.isError) {
    return {
      ok: false,
      data: {},
      artifacts: [],
      error: {
        code: "AGENT_TOOL_FAILED",
        message: extractToolResultText(result) || "Tool execution failed.",
        category: "execution"
      },
      duration_ms: durationMs,
      trace_id: result.toolCallId
    };
  }
  return {
    ok: true,
    data: {
      content: result.content
    },
    artifacts: [],
    duration_ms: durationMs,
    trace_id: result.toolCallId
  };
}
const normalizeOption = (value) => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
};
const normalizeQuestion = (value) => {
  const text = value.trim();
  return text || "The agent needs user input before continuing.";
};
const keyFor$1 = (turnId, toolCallId) => `${turnId}::${toolCallId}`;
class AgentUserInputRequestService {
  pending = /* @__PURE__ */ new Map();
  async request(input) {
    const turnId = input.turnId?.trim();
    if (!turnId) {
      throw new Error("ask_user requires an active conversation turn.");
    }
    const toolCallId = input.toolCallId.trim();
    if (!toolCallId) {
      throw new Error("ask_user requires a tool call id.");
    }
    const key = keyFor$1(turnId, toolCallId);
    this.cancelPending(key, "Superseded by a new user input request.");
    const question = normalizeQuestion(input.question);
    const options = (input.options ?? []).map(normalizeOption).filter((entry) => Boolean(entry));
    const approvalId = `ask-user-${toolCallId}`;
    return new Promise((resolve, reject) => {
      const pending = {
        agentId: input.agentId,
        sessionId: input.sessionId ?? null,
        turnId,
        toolCallId,
        approvalId,
        question,
        options,
        context: input.context,
        onEvent: input.onEvent,
        resolve,
        reject,
        signal: input.signal
      };
      if (input.signal) {
        if (input.signal.aborted) {
          reject(new Error("User input request was cancelled."));
          return;
        }
        pending.abortListener = () => {
          this.cancelPending(key, "User input request was cancelled.");
        };
        input.signal.addEventListener("abort", pending.abortListener, { once: true });
      }
      this.pending.set(key, pending);
      this.emit(pending, "approval.requested", {
        approvalId,
        title: "User input requested",
        status: "pending",
        kind: "ask_user",
        toolCallId,
        toolName: "ask_user",
        question,
        options
      });
    });
  }
  answer(input) {
    const answer = input.answer.trim();
    if (!answer) {
      return { success: false, error: "Answer cannot be empty." };
    }
    const pending = this.pending.get(keyFor$1(input.turnId, input.toolCallId));
    if (!pending) {
      return { success: false, error: "No pending user input request was found for this turn." };
    }
    if (input.sessionId && pending.sessionId && input.sessionId !== pending.sessionId) {
      return { success: false, error: "Pending user input request belongs to a different session." };
    }
    this.deletePending(pending);
    this.emit(pending, "approval.answered", {
      approvalId: pending.approvalId,
      title: "User input answered",
      status: "approved",
      kind: "ask_user",
      toolCallId: pending.toolCallId,
      toolName: "ask_user",
      question: pending.question,
      answer
    });
    pending.resolve(answer);
    return { success: true };
  }
  cancelTurn(turnId) {
    if (!turnId) return;
    for (const [key, pending] of Array.from(this.pending.entries())) {
      if (pending.turnId === turnId) {
        this.cancelPending(key, "User input request was cancelled.");
      }
    }
  }
  cancelPending(key, reason) {
    const pending = this.pending.get(key);
    if (!pending) return;
    this.deletePending(pending);
    this.emit(pending, "approval.answered", {
      approvalId: pending.approvalId,
      title: "User input cancelled",
      status: "cancelled",
      kind: "ask_user",
      toolCallId: pending.toolCallId,
      toolName: "ask_user",
      question: pending.question,
      answer: reason
    });
    pending.reject(new Error(reason));
  }
  deletePending(pending) {
    this.pending.delete(keyFor$1(pending.turnId, pending.toolCallId));
    if (pending.abortListener && pending.signal) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
  }
  emit(pending, type, payload) {
    pending.onEvent?.(buildSharedAgentEvent(type, payload, pending.context));
  }
}
const agentUserInputRequestService = new AgentUserInputRequestService();
const READ_ONLY_FILE_TOOLS = /* @__PURE__ */ new Set(["read_file", "glob", "grep"]);
const MUTATION_TOOLS = /* @__PURE__ */ new Set(["write_file", "edit_file"]);
const NETWORK_TOOL_NAMES = /* @__PURE__ */ new Set(["web_fetch", "web_search"]);
const DEFAULT_ROUTINE_COMMAND_PREFIXES = [
  "dir",
  "ls",
  "type",
  "cat",
  "pwd",
  "head",
  "tail",
  "findstr",
  "find ",
  "where",
  "echo",
  "git status",
  "git diff",
  "git show",
  "git log",
  "rg",
  "node scripts/check-",
  "npm run check:",
  "npm run typecheck"
];
const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bdel\b/i,
  /\berase\b/i,
  /\bmove\b/i,
  /\bcopy\b/i,
  /\bren\b/i,
  /\brename\b/i,
  /\bset-content\b/i,
  /\badd-content\b/i,
  /\bremove-item\b/i,
  /\binvoke-webrequest\b/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bssh\b/i,
  /\bscp\b/i,
  /\bformat\b/i,
  /\bshutdown\b/i,
  /\breg\b/i,
  />\s*[^&|]/,
  />>/
];
function normalizeToolName$1(name) {
  return name.trim().toLowerCase().replace(/[.-]/g, "_");
}
function expandPath(value) {
  const trimmed = value.trim();
  if (trimmed === "~") return os__namespace.homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path__namespace.resolve(os__namespace.homedir(), trimmed.slice(2));
  }
  return trimmed.replace(/^%USERPROFILE%/i, os__namespace.homedir());
}
function resolveConfiguredRoot(value) {
  return path__namespace.resolve(expandPath(value));
}
function resolveToolTarget(value, workspaceRoot) {
  const expanded = expandPath(value);
  return path__namespace.isAbsolute(expanded) ? path__namespace.resolve(expanded) : path__namespace.resolve(workspaceRoot, expanded);
}
function isWithinRoot(target, root) {
  if (root === "*") return true;
  const rel = path__namespace.relative(path__namespace.resolve(root), path__namespace.resolve(target));
  return rel === "" || !rel.startsWith("..") && !path__namespace.isAbsolute(rel);
}
function isInsideWorkspace(target, workspaceRoot) {
  return isWithinRoot(target, workspaceRoot);
}
function extractStringArg(toolCall, key) {
  const value = toolCall.arguments[key];
  return typeof value === "string" ? value.trim() : "";
}
function inferPathTargetFromGlobPattern(pattern) {
  const expanded = expandPath(pattern);
  if (!path__namespace.isAbsolute(expanded)) return "";
  const wildcardIndex = expanded.search(/[*?{[]/);
  if (wildcardIndex < 0) return expanded;
  const sepIndex = Math.max(expanded.lastIndexOf("/", wildcardIndex), expanded.lastIndexOf("\\", wildcardIndex));
  return sepIndex > 0 ? expanded.slice(0, sepIndex) : path__namespace.parse(expanded).root;
}
function extractPathTargets(toolName, toolCall) {
  if (toolName === "read_file" || toolName === "write_file" || toolName === "edit_file") {
    const filePath = extractStringArg(toolCall, "path");
    return filePath ? [filePath] : [];
  }
  if (toolName === "glob" || toolName === "grep") {
    const cwd = extractStringArg(toolCall, "cwd") || extractStringArg(toolCall, "path");
    if (cwd) return [cwd];
    const patternTarget = toolName === "glob" ? inferPathTargetFromGlobPattern(extractStringArg(toolCall, "pattern")) : "";
    return patternTarget ? [patternTarget] : [];
  }
  return [];
}
function commandUsesExternalPath(command, workspaceRoot, roots) {
  const normalized = command.replace(/\\/g, "/");
  const home = os__namespace.homedir().replace(/\\/g, "/");
  const workspace = workspaceRoot.replace(/\\/g, "/");
  const mentionsHome = normalized.includes("~/") || normalized.toLowerCase().includes(home.toLowerCase());
  const mentionsOtherRoot = roots.some((root) => normalized.toLowerCase().includes(root.replace(/\\/g, "/").toLowerCase()));
  const absoluteMentions = [
    ...normalized.matchAll(/[A-Za-z]:\/[^\s"'|&;]+/g),
    ...normalized.matchAll(/\/(?:Users|home|Desktop|tmp|var|etc|opt)\/[^\s"'|&;]*/g),
    ...normalized.matchAll(/(^|\s)\/(?=\s|$)/g)
  ].map((match) => match[0].trim()).filter(Boolean);
  const mentionsExternalAbsolutePath = absoluteMentions.some((candidate) => !candidate.toLowerCase().startsWith(workspace.toLowerCase()));
  if (!mentionsHome && !mentionsOtherRoot && !mentionsExternalAbsolutePath) return false;
  return !normalized.toLowerCase().includes(workspace.toLowerCase());
}
function isCommandDeniedByRule(command, permissions) {
  const normalized = command.trim().toLowerCase();
  return permissions.deniedCommandPrefixes.some((prefix) => normalized.startsWith(prefix.trim().toLowerCase()));
}
function isCommandAllowedByRule(command, permissions) {
  const normalized = command.trim().toLowerCase();
  return permissions.allowedCommandPrefixes.some((prefix) => normalized.startsWith(prefix.trim().toLowerCase()));
}
function isRoutineCommand(command, permissions) {
  if (isCommandAllowedByRule(command, permissions)) return true;
  const normalized = command.trim().toLowerCase();
  return DEFAULT_ROUTINE_COMMAND_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}
function isDangerousCommand(command) {
  return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}
function isRuleExpired(rule) {
  return rule.expiresAt !== void 0 && rule.expiresAt < Date.now();
}
function matchPersistedRule(toolName, rules) {
  return rules.find((rule) => {
    if (isRuleExpired(rule)) return false;
    const normalizedRule = normalizeToolName$1(rule.toolName);
    return normalizedRule === toolName || normalizedRule === "*";
  });
}
function denied(reason, risk = "high") {
  return { action: "deny", reason, risk, temporaryPathRoots: [] };
}
function request(mode, reason, risk, temporaryPathRoots = []) {
  if (mode === "auto-review") {
    return { action: "auto_review", reason, risk, temporaryPathRoots };
  }
  return { action: "ask_user", reason, risk, temporaryPathRoots };
}
class AgentPermissionPolicyService {
  evaluate(input) {
    const settings = settingsService.getAll();
    const permissions = settings.agentRuntime.permissions;
    const mode = permissions.mode;
    const toolName = normalizeToolName$1(input.toolCall.name);
    const workspaceRoot = path__namespace.resolve(
      input.projectRootPath || settings.workspace.rootPath || process.cwd()
    );
    if (mode === "full-access") {
      return { action: "allow", risk: "low", temporaryPathRoots: ["*"] };
    }
    const persistedRules = permissions.persistedRules ?? [];
    const matchedRule = matchPersistedRule(toolName, persistedRules);
    if (matchedRule?.decision === "allow") {
      return { action: "allow", risk: "low", temporaryPathRoots: [] };
    }
    if (matchedRule?.decision === "deny") {
      return denied(`持久化规则拒绝了工具 "${input.toolCall.name}"。`);
    }
    if (isCommandDeniedByRule(extractStringArg(input.toolCall, "command"), permissions)) {
      return denied("Custom policy denied this command prefix.");
    }
    const configuredReadableRoots = permissions.readableRoots.map(resolveConfiguredRoot);
    const configuredWritableRoots = permissions.writableRoots.map(resolveConfiguredRoot);
    if (READ_ONLY_FILE_TOOLS.has(toolName)) {
      const targets = extractPathTargets(toolName, input.toolCall).map((target) => resolveToolTarget(target, workspaceRoot));
      const externalTargets = targets.filter((target) => !isInsideWorkspace(target, workspaceRoot));
      if (externalTargets.length === 0) {
        return { action: "allow", risk: "low", temporaryPathRoots: [] };
      }
      const allowedTargets = externalTargets.filter((target) => configuredReadableRoots.some((root) => isWithinRoot(target, root)));
      if (allowedTargets.length === externalTargets.length) {
        return { action: "allow", risk: "low", temporaryPathRoots: allowedTargets };
      }
      return request(
        mode,
        `Read access is outside the workspace: ${externalTargets.join(", ")}`,
        "medium",
        externalTargets
      );
    }
    if (toolName === "bash") {
      const command = extractStringArg(input.toolCall, "command");
      if (!command) return denied("Shell command is empty.", "medium");
      if (isCommandAllowedByRule(command, permissions)) {
        return { action: "allow", risk: "low", temporaryPathRoots: [] };
      }
      if (isDangerousCommand(command)) {
        return request(mode, `Shell command requires review: ${command}`, "high");
      }
      if (commandUsesExternalPath(command, workspaceRoot, configuredReadableRoots)) {
        return request(mode, `Shell command references paths outside the workspace: ${command}`, "medium");
      }
      if (isRoutineCommand(command, permissions)) {
        return { action: "allow", risk: "low", temporaryPathRoots: [] };
      }
      return request(mode, `Shell command is not in the routine command set: ${command}`, "medium");
    }
    if (MUTATION_TOOLS.has(toolName) || input.tool.permissionHint === "mutation" || input.tool.permissionHint === "destructive") {
      const targets = extractPathTargets(toolName, input.toolCall).map((target) => resolveToolTarget(target, workspaceRoot));
      const externalTargets = targets.filter((target) => !isInsideWorkspace(target, workspaceRoot));
      if (mode === "custom" && externalTargets.length > 0) {
        const allowedTargets = externalTargets.filter((target) => configuredWritableRoots.some((root) => isWithinRoot(target, root)));
        if (allowedTargets.length === externalTargets.length) {
          return { action: "allow", risk: "medium", temporaryPathRoots: allowedTargets };
        }
      }
      return request(
        mode,
        externalTargets.length > 0 ? `Write access is outside the workspace: ${externalTargets.join(", ")}` : `Tool "${input.toolCall.name}" can modify workspace files.`,
        "high",
        externalTargets
      );
    }
    if (NETWORK_TOOL_NAMES.has(toolName) && mode !== "custom") {
      return request(mode, `Network tool "${input.toolCall.name}" requires approval in the current permission mode.`, "medium");
    }
    return { action: "allow", risk: "low", temporaryPathRoots: [] };
  }
}
const agentPermissionPolicyService = new AgentPermissionPolicyService();
const keyFor = (turnId, approvalId) => `${turnId}::${approvalId}`;
class AgentToolApprovalRequestService {
  pending = /* @__PURE__ */ new Map();
  async request(input) {
    const turnId = input.turnId?.trim();
    if (!turnId) {
      throw new Error("Tool approval requires an active conversation turn.");
    }
    const approvalId = `tool-approval-${input.toolCallId}`;
    const key = keyFor(turnId, approvalId);
    this.cancelPending(key, "Superseded by a new approval request.");
    return new Promise((resolve, reject) => {
      const pending = {
        ...input,
        sessionId: input.sessionId ?? null,
        turnId,
        approvalId,
        resolve,
        reject
      };
      if (input.signal) {
        if (input.signal.aborted) {
          reject(new Error("Tool approval request was cancelled."));
          return;
        }
        pending.abortListener = () => {
          this.cancelPending(key, "Tool approval request was cancelled.");
        };
        input.signal.addEventListener("abort", pending.abortListener, { once: true });
      }
      this.pending.set(key, pending);
      this.emit(pending, "approval.requested", {
        approvalId,
        title: `Approve ${input.toolName}`,
        status: "pending",
        reason: input.reason,
        kind: "tool",
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        question: input.reason,
        options: ["Approve once", "Deny"],
        risk: input.risk
      });
    });
  }
  autoReview(input) {
    const approved = input.risk === "low";
    const approvalId = `auto-review-${input.toolCallId}`;
    const synthetic = {
      ...input,
      sessionId: input.sessionId ?? null,
      turnId: input.turnId?.trim() || "auto-review",
      approvalId,
      resolve: () => void 0,
      reject: () => void 0
    };
    this.emit(synthetic, "approval.requested", {
      approvalId,
      title: `Auto-review ${input.toolName}`,
      status: "pending",
      reason: input.reason,
      kind: "tool",
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      risk: input.risk,
      reviewer: "auto_review"
    });
    this.emit(synthetic, "approval.answered", {
      approvalId,
      title: `Auto-review ${input.toolName}`,
      status: approved ? "approved" : "rejected",
      reason: input.reason,
      kind: "tool",
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      answer: approved ? "Auto-review approved this low-risk action." : "Auto-review denied this action. Use a safer workspace-scoped path or switch permissions.",
      risk: input.risk,
      reviewer: "auto_review"
    });
    return approved;
  }
  answer(input) {
    const pending = this.pending.get(keyFor(input.turnId, input.approvalId));
    if (!pending) {
      return { success: false, error: "No pending approval request was found for this turn." };
    }
    if (input.sessionId && pending.sessionId && input.sessionId !== pending.sessionId) {
      return { success: false, error: "Pending approval request belongs to a different session." };
    }
    this.deletePending(pending);
    this.emit(pending, "approval.answered", {
      approvalId: pending.approvalId,
      title: `Approve ${pending.toolName}`,
      status: input.approved ? "approved" : "rejected",
      reason: pending.reason,
      kind: "tool",
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      answer: input.approved ? "已批准一次" : "用户已拒绝",
      risk: pending.risk
    });
    pending.resolve(input.approved);
    return { success: true };
  }
  cancelTurn(turnId) {
    if (!turnId) return;
    for (const [key, pending] of Array.from(this.pending.entries())) {
      if (pending.turnId === turnId) {
        this.cancelPending(key, "Tool approval request was cancelled.");
      }
    }
  }
  cancelPending(key, reason) {
    const pending = this.pending.get(key);
    if (!pending) return;
    this.deletePending(pending);
    this.emit(pending, "approval.answered", {
      approvalId: pending.approvalId,
      title: `Approve ${pending.toolName}`,
      status: "cancelled",
      reason: pending.reason,
      kind: "tool",
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      answer: reason,
      risk: pending.risk
    });
    pending.reject(new Error(reason));
  }
  deletePending(pending) {
    this.pending.delete(keyFor(pending.turnId, pending.approvalId));
    if (pending.abortListener && pending.signal) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
  }
  emit(pending, type, payload) {
    pending.onEvent?.(buildSharedAgentEvent(type, payload, pending.context));
  }
}
const agentToolApprovalRequestService = new AgentToolApprovalRequestService();
let currentRuntimeContext = null;
function setRdxRuntimeContext(runtimeContext) {
  currentRuntimeContext = runtimeContext ? { ...runtimeContext, raw: { ...runtimeContext.raw } } : null;
}
function getRdxRuntimeContext() {
  return currentRuntimeContext ? { ...currentRuntimeContext, raw: { ...currentRuntimeContext.raw } } : null;
}
const COPILOT_EDITOR_HEADERS = {
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0"
};
const COPILOT_WIRE_HEADERS = {
  ...COPILOT_EDITOR_HEADERS,
  "Copilot-Integration-Id": "vscode-chat"
};
const describeUnsupportedProtocol = (providerId, protocol) => {
  const value = typeof protocol === "string" && protocol.trim() ? protocol.trim() : "missing";
  return `Provider ${providerId} uses unsupported protocol "${value}".`;
};
const toContentBlocks = (messages) => messages.map((message) => {
  if (typeof message.content === "string") {
    return { role: message.role, content: message.content };
  }
  const content = message.content.map((block) => {
    if (block.type === "text") {
      return { type: "text", text: block.text };
    }
    if (block.type === "image" && block.source) {
      return {
        type: "image_url",
        image_url: {
          url: `data:${block.source.media_type};base64,${block.source.data}`
        }
      };
    }
    return { type: "text", text: "" };
  });
  return { role: message.role, content };
});
const normalizeOpenRouterBaseUrl = (baseUrl) => {
  const trimmed = (baseUrl || "https://openrouter.ai/api/v1").trim().replace(/\/+$/, "");
  if (/^https:\/\/openrouter\.ai\/api$/i.test(trimmed)) {
    return `${trimmed}/v1`;
  }
  return trimmed;
};
const appendQueryParam$1 = (url2, key, value) => {
  const separator = url2.includes("?") ? "&" : "?";
  return `${url2}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
};
const extractMessageContent = (payload) => {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const message = payload.message ?? null;
  const messageContent = message?.content;
  if (typeof messageContent === "string" && messageContent.trim()) {
    return messageContent;
  }
  if (Array.isArray(messageContent) && messageContent.length > 0) {
    return messageContent;
  }
  if (messageContent && typeof messageContent === "object") {
    return JSON.stringify(messageContent);
  }
  const stringFallbacks = [
    message?.output_text,
    message?.reasoning_content,
    message?.reasoning,
    message?.refusal,
    payload.text,
    payload.output_text
  ];
  for (const candidate of stringFallbacks) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return "";
};
const toResponsesInput = (messages) => messages.map((message) => ({
  role: message.role === "assistant" || message.role === "system" ? message.role : "user",
  content: typeof message.content === "string" ? message.content : JSON.stringify(message.content)
}));
const toOpenAiTools = (tools) => {
  if (!tools?.length) {
    return void 0;
  }
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema
    }
  }));
};
const toResponsesTools = (tools) => {
  if (!tools?.length) {
    return void 0;
  }
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema
  }));
};
const toOpenAiReasoningEffort = (budget) => {
  if (budget === "low" || budget === "medium" || budget === "high") {
    return budget;
  }
  return void 0;
};
const toAnthropicThinking = (budget) => {
  if (!budget || budget === "auto") {
    return void 0;
  }
  const budgetTokens = budget === "low" ? 1024 : budget === "medium" ? 4096 : 8192;
  return { type: "enabled", budget_tokens: budgetTokens };
};
const toGoogleThinkingConfig = (budget) => {
  if (!budget || budget === "auto") {
    return void 0;
  }
  return { thinkingBudget: budget === "low" ? 1024 : budget === "medium" ? 4096 : 8192 };
};
const extractResponsesText = (payload) => {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const record = payload;
  if (typeof record.output_text === "string") {
    return record.output_text;
  }
  const output = Array.isArray(record.output) ? record.output : [];
  const chunks = [];
  for (const item of output) {
    const itemRecord = item && typeof item === "object" ? item : {};
    const content = Array.isArray(itemRecord.content) ? itemRecord.content : [];
    for (const block of content) {
      const blockRecord = block && typeof block === "object" ? block : {};
      const text = typeof blockRecord.text === "string" ? blockRecord.text : typeof blockRecord.output_text === "string" ? blockRecord.output_text : "";
      if (text) {
        chunks.push(text);
      }
    }
  }
  if (chunks.length > 0) {
    return chunks.join("");
  }
  const fallback = extractMessageContent(payload);
  return typeof fallback === "string" ? fallback : JSON.stringify(fallback);
};
const extractResponsesUsage = (payload) => {
  const record = payload && typeof payload === "object" ? payload : {};
  const usage = record.usage && typeof record.usage === "object" ? record.usage : {};
  const input = usage.input_tokens ?? usage.prompt_tokens;
  const output = usage.output_tokens ?? usage.completion_tokens;
  return {
    inputTokens: typeof input === "number" ? input : 0,
    outputTokens: typeof output === "number" ? output : 0
  };
};
const createAccumulator = (model) => ({
  id: `stream-${Date.now()}`,
  model,
  content: "",
  toolCalls: [],
  inputTokens: 0,
  outputTokens: 0,
  stopReason: "end_turn"
});
const ensureToolCall = (toolCalls, index, id) => {
  while (toolCalls.length <= index) {
    toolCalls.push({
      id: id || `tool-call-${index}`,
      name: "",
      argumentsText: ""
    });
  }
  const existing = toolCalls[index];
  if (id && !existing.id) {
    existing.id = id;
  }
  return existing;
};
const parseToolArguments = (argumentsText) => {
  if (!argumentsText.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(argumentsText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
  }
  return {
    raw: argumentsText
  };
};
const buildResponseFromAccumulator = (accumulator) => {
  const toolCalls = accumulator.toolCalls.filter((toolCall) => toolCall.id || toolCall.name || toolCall.argumentsText).map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.name,
    arguments: parseToolArguments(toolCall.argumentsText)
  }));
  return {
    id: accumulator.id,
    model: accumulator.model,
    content: accumulator.content,
    toolCalls: toolCalls.length > 0 ? toolCalls : void 0,
    usage: {
      inputTokens: accumulator.inputTokens,
      outputTokens: accumulator.outputTokens
    },
    stopReason: accumulator.stopReason
  };
};
const emitTextChunk = (text, onChunk) => {
  if (!text) {
    return;
  }
  onChunk({
    type: "text-delta",
    text
  });
};
const emitToolCallDelta = (toolCall, onChunk) => {
  onChunk({
    type: "tool-call-delta",
    toolCall
  });
};
const emitFallbackChunks = (text, onChunk) => {
  const chunks = text.split(/(?<=[.!?。！？\n])|(?<=,|，)\s+/).map((chunk) => chunk.trim()).filter(Boolean);
  if (chunks.length === 0 && text) {
    emitTextChunk(text, onChunk);
    return;
  }
  for (const chunk of chunks) {
    emitTextChunk(chunk, onChunk);
  }
};
const tryParseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
const mapFinishReason = (finishReason) => {
  if (finishReason === "tool_calls" || finishReason === "tool_use") {
    return "tool_use";
  }
  if (finishReason === "length" || finishReason === "max_tokens") {
    return "max_tokens";
  }
  return "end_turn";
};
const readSseStream = async (response, onEvent) => {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Streaming response body is unavailable.");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines = [];
  const flush = () => {
    if (dataLines.length === 0) {
      eventName = "message";
      return;
    }
    const payload = dataLines.join("\n");
    dataLines = [];
    onEvent(eventName, payload);
    eventName = "message";
  };
  for (; ; ) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const line = rawLine.replace(/\r$/, "");
      if (!line) {
        flush();
      } else if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
      newlineIndex = buffer.indexOf("\n");
    }
    if (done) {
      break;
    }
  }
  if (buffer.trim()) {
    const line = buffer.replace(/\r$/, "");
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  flush();
};
class BaseStreamingProvider {
  name;
  constructor(name) {
    this.name = name;
  }
  async streamChat(request2, onChunk) {
    try {
      const response = await this.performStreamingChat(request2, onChunk);
      onChunk({ type: "done" });
      return response;
    } catch (error) {
      if (request2.signal?.aborted) {
        throw error;
      }
      const fallbackResponse = await this.chat(request2);
      const fallbackText = typeof fallbackResponse.content === "string" ? fallbackResponse.content : JSON.stringify(fallbackResponse.content);
      emitFallbackChunks(fallbackText, onChunk);
      onChunk({ type: "done" });
      return fallbackResponse;
    }
  }
}
class OpenRouterProvider extends BaseStreamingProvider {
  apiKey = "";
  baseUrl = "https://openrouter.ai/api/v1";
  models = [];
  constructor(name) {
    super(name);
  }
  configure(config) {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = normalizeOpenRouterBaseUrl(config.baseUrl || "https://openrouter.ai/api/v1");
    this.models = config.models;
  }
  async chat(request2) {
    const model = request2.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://rdcagent.local",
        "X-Title": "RdcAgent"
      },
      signal: request2.signal,
      body: JSON.stringify({
        model,
        messages: toContentBlocks(request2.messages),
        max_tokens: request2.maxTokens || 4096,
        temperature: request2.temperature ?? 0.7,
        reasoning_effort: toOpenAiReasoningEffort(request2.reasoningBudget),
        tools: toOpenAiTools(request2.tools),
        response_format: request2.responseFormat ? { type: request2.responseFormat } : void 0,
        stream: false
      })
    });
    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} - ${await response.text()}`);
    }
    const data = await response.json();
    const choice = data.choices?.[0];
    const content = extractMessageContent(choice);
    return {
      id: data.id || `or-${Date.now()}`,
      model: data.model || model,
      content,
      toolCalls: choice?.message?.tool_calls,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0
      },
      stopReason: mapFinishReason(choice?.finish_reason)
    };
  }
  async performStreamingChat(request2, onChunk) {
    const model = request2.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://rdcagent.local",
        "X-Title": "RdcAgent"
      },
      signal: request2.signal,
      body: JSON.stringify({
        model,
        messages: toContentBlocks(request2.messages),
        max_tokens: request2.maxTokens || 4096,
        temperature: request2.temperature ?? 0.7,
        reasoning_effort: toOpenAiReasoningEffort(request2.reasoningBudget),
        tools: toOpenAiTools(request2.tools),
        response_format: request2.responseFormat ? { type: request2.responseFormat } : void 0,
        stream: true
      })
    });
    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} - ${await response.text()}`);
    }
    const accumulator = createAccumulator(model);
    await readSseStream(response, (_eventName, data) => {
      if (!data || data === "[DONE]") {
        return;
      }
      const payload = tryParseJson(data);
      if (!payload) {
        return;
      }
      accumulator.id = String(payload.id || accumulator.id);
      accumulator.model = String(payload.model || accumulator.model);
      const choice = payload.choices?.[0];
      const delta = choice?.delta ?? {};
      const text = typeof delta.content === "string" ? delta.content : "";
      if (text) {
        accumulator.content += text;
        emitTextChunk(text, onChunk);
      }
      const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const toolCallDelta of toolCalls) {
        const index = typeof toolCallDelta.index === "number" ? toolCallDelta.index : 0;
        const functionDelta = typeof toolCallDelta.function === "object" && toolCallDelta.function ? toolCallDelta.function : {};
        const toolCall = ensureToolCall(
          accumulator.toolCalls,
          index,
          typeof toolCallDelta.id === "string" ? toolCallDelta.id : void 0
        );
        if (typeof functionDelta.name === "string") {
          toolCall.name = functionDelta.name;
        }
        if (typeof functionDelta.arguments === "string") {
          toolCall.argumentsText += functionDelta.arguments;
        }
        emitToolCallDelta({
          id: toolCall.id,
          name: toolCall.name,
          argumentsText: toolCall.argumentsText
        }, onChunk);
      }
      accumulator.stopReason = mapFinishReason(
        typeof choice?.finish_reason === "string" ? choice.finish_reason : void 0
      );
    });
    return buildResponseFromAccumulator(accumulator);
  }
  async isAvailable() {
    return Boolean(this.apiKey);
  }
  getModels() {
    return this.models;
  }
}
class OpenAICompatibleProvider2 extends BaseStreamingProvider {
  apiKey = "";
  baseUrl = "https://api.openai.com/v1";
  models = [];
  requireApiKey = true;
  constructor(name, requireApiKey = true) {
    super(name);
    this.requireApiKey = requireApiKey;
  }
  configure(config) {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl || this.baseUrl).trim().replace(/\/+$/, "");
    this.models = config.models;
  }
  createHeaders() {
    const headers = {
      "Content-Type": "application/json"
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }
  createChatCompletionsUrl() {
    return `${this.baseUrl}/chat/completions`;
  }
  describeApiError(status, text) {
    return `${this.name} API error: ${status} - ${text}`;
  }
  async chat(request2) {
    const model = request2.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const response = await fetch(this.createChatCompletionsUrl(), {
      method: "POST",
      headers: this.createHeaders(),
      signal: request2.signal,
      body: JSON.stringify({
        model,
        messages: toContentBlocks(request2.messages),
        max_tokens: request2.maxTokens || 4096,
        temperature: request2.temperature ?? 0.7,
        reasoning_effort: toOpenAiReasoningEffort(request2.reasoningBudget),
        tools: toOpenAiTools(request2.tools),
        response_format: request2.responseFormat ? { type: request2.responseFormat } : void 0
      })
    });
    if (!response.ok) {
      throw new Error(this.describeApiError(response.status, await response.text()));
    }
    const data = await response.json();
    const choice = data.choices?.[0];
    const content = extractMessageContent(choice);
    return {
      id: data.id || `${this.name}-${Date.now()}`,
      model: data.model || model,
      content,
      toolCalls: choice?.message?.tool_calls,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0
      },
      stopReason: mapFinishReason(choice?.finish_reason)
    };
  }
  async performStreamingChat(request2, onChunk) {
    const model = request2.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const response = await fetch(this.createChatCompletionsUrl(), {
      method: "POST",
      headers: this.createHeaders(),
      signal: request2.signal,
      body: JSON.stringify({
        model,
        messages: toContentBlocks(request2.messages),
        max_tokens: request2.maxTokens || 4096,
        temperature: request2.temperature ?? 0.7,
        reasoning_effort: toOpenAiReasoningEffort(request2.reasoningBudget),
        tools: toOpenAiTools(request2.tools),
        response_format: request2.responseFormat ? { type: request2.responseFormat } : void 0,
        stream: true
      })
    });
    if (!response.ok) {
      throw new Error(this.describeApiError(response.status, await response.text()));
    }
    const accumulator = createAccumulator(model);
    await readSseStream(response, (_eventName, data) => {
      if (!data || data === "[DONE]") {
        return;
      }
      const payload = tryParseJson(data);
      if (!payload) {
        return;
      }
      accumulator.id = String(payload.id || accumulator.id);
      accumulator.model = String(payload.model || accumulator.model);
      const choice = payload.choices?.[0];
      const delta = choice?.delta ?? {};
      const text = typeof delta.content === "string" ? delta.content : "";
      if (text) {
        accumulator.content += text;
        emitTextChunk(text, onChunk);
      }
      const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const toolCallDelta of toolCalls) {
        const index = typeof toolCallDelta.index === "number" ? toolCallDelta.index : 0;
        const functionDelta = typeof toolCallDelta.function === "object" && toolCallDelta.function ? toolCallDelta.function : {};
        const toolCall = ensureToolCall(
          accumulator.toolCalls,
          index,
          typeof toolCallDelta.id === "string" ? toolCallDelta.id : void 0
        );
        if (typeof functionDelta.name === "string") {
          toolCall.name = functionDelta.name;
        }
        if (typeof functionDelta.arguments === "string") {
          toolCall.argumentsText += functionDelta.arguments;
        }
        emitToolCallDelta({
          id: toolCall.id,
          name: toolCall.name,
          argumentsText: toolCall.argumentsText
        }, onChunk);
      }
      accumulator.stopReason = mapFinishReason(
        typeof choice?.finish_reason === "string" ? choice.finish_reason : void 0
      );
    });
    return buildResponseFromAccumulator(accumulator);
  }
  async isAvailable() {
    return this.requireApiKey ? Boolean(this.apiKey) : true;
  }
  getModels() {
    return this.models;
  }
}
class ChatGptAccountProvider extends BaseStreamingProvider {
  accessToken = "";
  baseUrl = "https://chatgpt.com/backend-api/codex";
  accountId;
  models = [];
  constructor(name) {
    super(name);
  }
  configure(config) {
    this.accessToken = config.apiKey.trim();
    this.baseUrl = (config.baseUrl || this.baseUrl).trim().replace(/\/+$/, "");
    this.accountId = config.accountId?.trim() || void 0;
    this.models = config.models;
  }
  createHeaders() {
    const headers = {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json"
    };
    if (this.accountId) {
      headers["chatgpt-account-id"] = this.accountId;
    }
    return headers;
  }
  createResponsesUrl() {
    return this.baseUrl.endsWith("/responses") ? this.baseUrl : `${this.baseUrl}/responses`;
  }
  createBody(request2, model, stream) {
    const body = {
      model,
      input: toResponsesInput(request2.messages),
      max_output_tokens: request2.maxTokens || 4096,
      temperature: request2.temperature ?? 0.7,
      stream
    };
    const reasoningEffort = toOpenAiReasoningEffort(request2.reasoningBudget);
    if (reasoningEffort) {
      body.reasoning = { effort: reasoningEffort };
    }
    if (request2.responseFormat) {
      body.text = { format: { type: request2.responseFormat } };
    }
    const tools = toResponsesTools(request2.tools);
    if (tools) {
      body.tools = tools;
      body.tool_choice = "auto";
    }
    return body;
  }
  async chat(request2) {
    const model = request2.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const response = await fetch(this.createResponsesUrl(), {
      method: "POST",
      headers: this.createHeaders(),
      signal: request2.signal,
      body: JSON.stringify(this.createBody(request2, model, false))
    });
    if (!response.ok) {
      throw new Error(`ChatGPT Account API error: ${response.status} - ${await response.text()}`);
    }
    const payload = await response.json();
    return {
      id: typeof payload.id === "string" ? payload.id : `${this.name}-${Date.now()}`,
      model: typeof payload.model === "string" ? payload.model : model,
      content: extractResponsesText(payload),
      usage: extractResponsesUsage(payload),
      stopReason: mapFinishReason(typeof payload.status === "string" ? payload.status : void 0)
    };
  }
  async performStreamingChat(request2, onChunk) {
    const model = request2.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const response = await fetch(this.createResponsesUrl(), {
      method: "POST",
      headers: this.createHeaders(),
      signal: request2.signal,
      body: JSON.stringify(this.createBody(request2, model, true))
    });
    if (!response.ok) {
      throw new Error(`ChatGPT Account API error: ${response.status} - ${await response.text()}`);
    }
    const accumulator = createAccumulator(model);
    await readSseStream(response, (eventName, data) => {
      if (!data || data === "[DONE]") {
        return;
      }
      const payload = tryParseJson(data);
      if (!payload) {
        return;
      }
      const eventType = typeof payload.type === "string" ? payload.type : eventName;
      if (typeof payload.id === "string") {
        accumulator.id = payload.id;
      }
      if (typeof payload.model === "string") {
        accumulator.model = payload.model;
      }
      if (eventType.includes("output_text.delta")) {
        const text = typeof payload.delta === "string" ? payload.delta : typeof payload.text === "string" ? payload.text : "";
        if (text) {
          accumulator.content += text;
          emitTextChunk(text, onChunk);
        }
      }
      if (eventType.includes("completed")) {
        const completed = payload.response && typeof payload.response === "object" ? payload.response : payload;
        if (!accumulator.content) {
          accumulator.content = extractResponsesText(completed);
        }
        if (typeof completed.id === "string") {
          accumulator.id = completed.id;
        }
        if (typeof completed.model === "string") {
          accumulator.model = completed.model;
        }
        const usage = extractResponsesUsage(completed);
        accumulator.inputTokens = usage.inputTokens;
        accumulator.outputTokens = usage.outputTokens;
      }
    });
    return buildResponseFromAccumulator(accumulator);
  }
  async isAvailable() {
    return Boolean(this.accessToken);
  }
  getModels() {
    return this.models;
  }
}
class GitHubCopilotProvider extends OpenAICompatibleProvider2 {
  constructor(name) {
    super(name, true);
  }
  createHeaders() {
    return {
      ...super.createHeaders(),
      ...COPILOT_WIRE_HEADERS
    };
  }
  describeApiError(status, text) {
    if (status === 401) {
      return `GitHub Copilot account token was rejected. Sign in again or check token policy. ${text}`;
    }
    if (status === 403) {
      return `GitHub Copilot access was blocked by license, organization, or policy settings. ${text}`;
    }
    return `GitHub Copilot API error: ${status} - ${text}`;
  }
}
class AzureOpenAIProvider extends OpenAICompatibleProvider2 {
  createHeaders() {
    return {
      "api-key": this.apiKey,
      "Content-Type": "application/json"
    };
  }
  createChatCompletionsUrl() {
    const base = this.baseUrl.endsWith("/chat/completions") ? this.baseUrl : `${this.baseUrl}/chat/completions`;
    return appendQueryParam$1(base, "api-version", "2024-10-21");
  }
}
class GoogleAiStudioProvider extends BaseStreamingProvider {
  apiKey = "";
  baseUrl = "https://generativelanguage.googleapis.com/v1beta";
  models = [];
  useBearerAuth = false;
  constructor(name) {
    super(name);
  }
  configure(config) {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl || this.baseUrl).trim().replace(/\/+$/, "");
    this.models = config.models;
    this.useBearerAuth = config.authMode === "account";
  }
  createGenerateContentUrl(model) {
    const base = `${this.baseUrl}/models/${model}:generateContent`;
    return this.useBearerAuth ? base : appendQueryParam$1(base, "key", this.apiKey);
  }
  createHeaders() {
    return {
      ...this.useBearerAuth ? { Authorization: `Bearer ${this.apiKey}` } : {},
      "Content-Type": "application/json"
    };
  }
  async chat(request2) {
    const model = request2.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const response = await fetch(this.createGenerateContentUrl(model), {
      method: "POST",
      headers: this.createHeaders(),
      signal: request2.signal,
      body: JSON.stringify({
        contents: request2.messages.filter((message) => message.role !== "system").map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: typeof message.content === "string" ? message.content : JSON.stringify(message.content) }]
        })),
        generationConfig: {
          maxOutputTokens: request2.maxTokens || 4096,
          temperature: request2.temperature ?? 0.7,
          thinkingConfig: toGoogleThinkingConfig(request2.reasoningBudget)
        },
        systemInstruction: request2.messages.some((message) => message.role === "system") ? {
          parts: request2.messages.filter((message) => message.role === "system").map((message) => ({ text: typeof message.content === "string" ? message.content : JSON.stringify(message.content) }))
        } : void 0
      })
    });
    if (!response.ok) {
      throw new Error(`Google AI Studio API error: ${response.status} - ${await response.text()}`);
    }
    const data = await response.json();
    const text = Array.isArray(data.candidates?.[0]?.content?.parts) ? data.candidates[0].content.parts.map((part) => typeof part.text === "string" ? part.text : "").join("") : "";
    return {
      id: data.responseId || `google-ai-studio-${Date.now()}`,
      model,
      content: text,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount || 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount || 0
      },
      stopReason: "end_turn"
    };
  }
  async performStreamingChat(request2, onChunk) {
    const response = await this.chat(request2);
    const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    emitTextChunk(text, onChunk);
    return response;
  }
  async isAvailable() {
    return Boolean(this.apiKey);
  }
  getModels() {
    return this.models;
  }
}
class AnthropicProvider2 extends BaseStreamingProvider {
  apiKey = "";
  baseUrl = "https://api.anthropic.com/v1";
  models = [];
  useBearerAuth = false;
  constructor(name) {
    super(name);
  }
  configure(config) {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl || "https://api.anthropic.com/v1").trim().replace(/\/+$/, "");
    this.models = config.models;
    this.useBearerAuth = config.authMode === "account";
  }
  createHeaders() {
    return {
      ...this.useBearerAuth ? { Authorization: `Bearer ${this.apiKey}` } : { "x-api-key": this.apiKey },
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    };
  }
  async chat(request2) {
    const model = request2.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const systemMessage = request2.messages.find((message) => message.role === "system");
    const otherMessages = request2.messages.filter((message) => message.role !== "system");
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: this.createHeaders(),
      signal: request2.signal,
      body: JSON.stringify({
        model,
        max_tokens: request2.maxTokens || 4096,
        thinking: toAnthropicThinking(request2.reasoningBudget),
        system: typeof systemMessage?.content === "string" ? systemMessage.content : void 0,
        messages: otherMessages.map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content
        }))
      })
    });
    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} - ${await response.text()}`);
    }
    const data = await response.json();
    return {
      id: data.id || `anthropic-${Date.now()}`,
      model: data.model || model,
      content: data.content?.[0]?.text || "",
      usage: {
        inputTokens: data.usage?.input_tokens || 0,
        outputTokens: data.usage?.output_tokens || 0
      },
      stopReason: mapFinishReason(data.stop_reason)
    };
  }
  async performStreamingChat(request2, onChunk) {
    const model = request2.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const systemMessage = request2.messages.find((message) => message.role === "system");
    const otherMessages = request2.messages.filter((message) => message.role !== "system");
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: this.createHeaders(),
      signal: request2.signal,
      body: JSON.stringify({
        model,
        max_tokens: request2.maxTokens || 4096,
        thinking: toAnthropicThinking(request2.reasoningBudget),
        stream: true,
        system: typeof systemMessage?.content === "string" ? systemMessage.content : void 0,
        messages: otherMessages.map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content
        }))
      })
    });
    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} - ${await response.text()}`);
    }
    const accumulator = createAccumulator(model);
    await readSseStream(response, (eventName, data) => {
      if (!data) {
        return;
      }
      const payload = tryParseJson(data);
      if (!payload) {
        return;
      }
      if (eventName === "message_start") {
        const message = payload.message;
        accumulator.id = String(message?.id || accumulator.id);
        accumulator.model = String(message?.model || accumulator.model);
        const usage = message?.usage;
        accumulator.inputTokens = typeof usage?.input_tokens === "number" ? usage.input_tokens : accumulator.inputTokens;
      }
      if (eventName === "content_block_delta") {
        const delta = payload.delta;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          accumulator.content += delta.text;
          emitTextChunk(delta.text, onChunk);
        }
      }
      if (eventName === "message_delta") {
        const delta = payload.delta;
        const usage = payload.usage;
        accumulator.outputTokens = typeof usage?.output_tokens === "number" ? usage.output_tokens : accumulator.outputTokens;
        accumulator.stopReason = mapFinishReason(
          typeof delta?.stop_reason === "string" ? delta.stop_reason : void 0
        );
      }
    });
    return buildResponseFromAccumulator(accumulator);
  }
  async isAvailable() {
    return Boolean(this.apiKey);
  }
  getModels() {
    return this.models;
  }
}
class UnsupportedProtocolProvider {
  name;
  error;
  constructor(providerId, protocol) {
    this.name = providerId;
    this.error = new Error(describeUnsupportedProtocol(providerId, protocol));
  }
  async chat() {
    throw this.error;
  }
  async streamChat() {
    throw this.error;
  }
  async isAvailable() {
    return true;
  }
  getModels() {
    return [];
  }
}
const createProviderByProtocol = (providerConfig) => {
  const protocol = providerConfig.protocol;
  if (providerConfig.id === "github-copilot") {
    return protocol === "OpenAICompatibleChatCompletions" ? new GitHubCopilotProvider(providerConfig.id) : new UnsupportedProtocolProvider(providerConfig.id, protocol);
  }
  switch (protocol) {
    case "OpenRouterChatCompletions":
      return new OpenRouterProvider(providerConfig.id);
    case "AnthropicMessages":
      return new AnthropicProvider2(providerConfig.id);
    case "OpenAIResponses":
      return new ChatGptAccountProvider(providerConfig.id);
    case "OpenAICompatibleChatCompletions":
      return new OpenAICompatibleProvider2(providerConfig.id, true);
    case "OllamaOpenAICompatibleChatCompletions":
      return new OpenAICompatibleProvider2(providerConfig.id, false);
    case "GoogleGemini":
      return new GoogleAiStudioProvider(providerConfig.id);
    case "AzureOpenAIChatCompletions":
      return new AzureOpenAIProvider(providerConfig.id);
    case "AwsBedrock":
    case "GoogleVertexAI":
    default:
      return new UnsupportedProtocolProvider(providerConfig.id, protocol);
  }
};
class LLMAdapter {
  providers = /* @__PURE__ */ new Map();
  configure(config) {
    this.providers.clear();
    for (const providerConfig of config.providers) {
      const provider = createProviderByProtocol(providerConfig);
      if ("configure" in provider && typeof provider.configure === "function") {
        provider.configure(providerConfig);
      }
      this.providers.set(providerConfig.id, {
        config: providerConfig,
        provider
      });
    }
  }
  async chat(request2, providerId) {
    const resolvedProviderId = providerId?.trim();
    if (!resolvedProviderId) {
      throw new Error("No explicit LLM provider was supplied for this request.");
    }
    const runtimeProvider = this.providers.get(resolvedProviderId);
    if (!runtimeProvider) {
      throw new Error(`Provider not found: ${resolvedProviderId}`);
    }
    if (!runtimeProvider.config.enabled) {
      throw new Error(`Provider disabled: ${resolvedProviderId}`);
    }
    if (!await runtimeProvider.provider.isAvailable()) {
      throw new Error(`Provider not configured: ${resolvedProviderId}`);
    }
    return runtimeProvider.provider.chat(request2);
  }
  async streamChat(request2, onChunk, providerId) {
    const resolvedProviderId = providerId?.trim();
    if (!resolvedProviderId) {
      throw new Error("No explicit LLM provider was supplied for this request.");
    }
    const runtimeProvider = this.providers.get(resolvedProviderId);
    if (!runtimeProvider) {
      throw new Error(`Provider not found: ${resolvedProviderId}`);
    }
    if (!runtimeProvider.config.enabled) {
      throw new Error(`Provider disabled: ${resolvedProviderId}`);
    }
    if (!await runtimeProvider.provider.isAvailable()) {
      throw new Error(`Provider not configured: ${resolvedProviderId}`);
    }
    return runtimeProvider.provider.streamChat(request2, onChunk);
  }
  async testConnection(providerId) {
    const runtimeProvider = this.providers.get(providerId);
    if (!runtimeProvider) {
      return { success: false, error: `Provider not found: ${providerId}` };
    }
    try {
      const available = await runtimeProvider.provider.isAvailable();
      return { success: available, error: available ? void 0 : "Provider not configured" };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
  getAvailableModels(providerId) {
    return this.providers.get(providerId)?.config.models || [];
  }
  getDefaultProvider() {
    return "";
  }
}
const llmAdapter = new LLMAdapter();
const REQUEST_TIMEOUT_MS$1 = 2e4;
const CHATGPT_CALLBACK_PORT = 1455;
const CHATGPT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const GITHUB_COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";
const GROK_AUTH_DEVICE_ENDPOINT = "https://auth.x.ai/oauth2/device/code";
const GROK_AUTH_TOKEN_ENDPOINT = "https://auth.x.ai/oauth2/token";
const GROK_AUTH_USERINFO_ENDPOINT = "https://auth.x.ai/oauth2/userinfo";
const GROK_AUTH_REVOKE_ENDPOINT = "https://auth.x.ai/oauth2/revoke";
const GROK_API_BASE_URL = "https://api.x.ai/v1";
const GROK_OAUTH_SCOPE = "openid profile email offline_access api:access";
const GROK_OAUTH_CLIENT_ID_ENV_KEYS = [
  "RDC_AGENT_GROK_OAUTH_CLIENT_ID",
  "GROK_OAUTH_CLIENT_ID",
  "XAI_OAUTH_CLIENT_ID"
];
const pendingFlows = /* @__PURE__ */ new Map();
const isAccountProviderId = (providerId) => providerId === "claude-account" || providerId === "chatgpt-account" || providerId === "github-copilot" || providerId === "grok-account" || providerId === "gemini-account" || providerId === "qwen-account";
const isUnimplementedAccountProviderId = (providerId) => providerId === "gemini-account" || providerId === "qwen-account";
const resolveGrokOAuthClientId = (draft) => {
  const cleanDraft = draft?.trim();
  if (cleanDraft) {
    return { clientId: cleanDraft, source: "draft" };
  }
  for (const key of GROK_OAUTH_CLIENT_ID_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) {
      return { clientId: value, source: "env" };
    }
  }
  return {};
};
const isTestMode$1 = () => process.env.RDC_AGENT_TEST_MODE === "1";
const base64Url = (buffer) => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const createPkce = () => {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
};
const appendParams = (baseUrl, params) => {
  const url2 = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url2.searchParams.set(key, value);
  }
  return url2.toString();
};
const normalizeAccountModels = (values) => {
  const models = /* @__PURE__ */ new Map();
  for (const value of values) {
    const record = value && typeof value === "object" ? value : null;
    const id = typeof value === "string" ? value.trim() : typeof record?.id === "string" ? record.id.trim() : typeof record?.name === "string" ? record.name.trim() : "";
    if (!id || !isAgentRoutableAccountModel(id) || models.has(id)) {
      continue;
    }
    models.set(id, {
      id,
      label: typeof record?.display_name === "string" && record.display_name.trim() ? record.display_name.trim() : id,
      enabled: true
    });
  }
  return Array.from(models.values()).sort((left, right) => left.id.localeCompare(right.id));
};
const readString = (value) => typeof value === "string" && value.trim() ? value.trim() : void 0;
const parseJwtPayload = (token) => {
  const payload = token?.split(".")[1];
  if (!payload) {
    return null;
  }
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};
const extractChatGptAccountId = (idToken) => {
  const claims = parseJwtPayload(idToken);
  if (!claims) {
    return void 0;
  }
  const authClaim = claims["https://api.openai.com/auth"];
  const authRecord = authClaim && typeof authClaim === "object" && !Array.isArray(authClaim) ? authClaim : {};
  const organizations = Array.isArray(claims.organizations) ? claims.organizations : [];
  const firstOrganization = organizations[0] && typeof organizations[0] === "object" ? organizations[0] : {};
  return readString(authRecord.chatgpt_account_id) ?? readString(authRecord.account_id) ?? readString(claims["https://api.openai.com/auth.chatgpt_account_id"]) ?? readString(claims.chatgpt_account_id) ?? readString(claims.account_id) ?? readString(firstOrganization.id);
};
const createAccountCatalogModels = (providerId) => {
  const definition = getBuiltinProviderDefinition(providerId);
  const seen = /* @__PURE__ */ new Set();
  return (definition?.recommendedModels ?? []).map((modelId) => modelId.trim()).filter((modelId) => {
    if (!modelId || seen.has(modelId) || !isAgentRoutableAccountModel(modelId)) {
      return false;
    }
    seen.add(modelId);
    return true;
  }).map((modelId) => ({
    id: modelId,
    label: modelId,
    enabled: true
  }));
};
const mergeAccountModels = (...groups) => {
  const models = /* @__PURE__ */ new Map();
  for (const group of groups) {
    for (const model of group) {
      if (!models.has(model.id) && isAgentRoutableAccountModel(model.id)) {
        models.set(model.id, model);
      }
    }
  }
  return Array.from(models.values());
};
const isAgentRoutableAccountModel = (modelId) => {
  const normalized = modelId.toLowerCase();
  return !(normalized.includes("embedding") || normalized.includes("moderation") || normalized.includes("rerank") || normalized.includes("whisper") || normalized.includes("tts") || normalized.includes("dall-e") || normalized.includes("image") || normalized.includes("audio") || normalized.includes("realtime") || normalized.includes("transcribe"));
};
const parseProviderError$1 = (error) => {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Connection test timed out.";
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Provider connection failed.";
};
const isExpiringSoon = (expiresAt) => {
  if (!expiresAt) {
    return false;
  }
  const timestamp = new Date(expiresAt).getTime();
  return Number.isFinite(timestamp) && timestamp <= Date.now() + 6e4;
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const canRefreshBundle = (bundle) => {
  if (bundle.providerId === "grok-account") {
    return Boolean(bundle.refreshToken && bundle.clientId);
  }
  return Boolean(bundle.refreshToken || bundle.providerId === "github-copilot" && bundle.accessToken);
};
const fetchJson = async (url2, init) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS$1);
  try {
    const response = await fetch(url2, {
      ...init,
      signal: controller.signal
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const message = payload && typeof payload === "object" && typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
      throw new Error(message);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
};
const fetchOAuthJson = async (url2, init) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS$1);
  try {
    const response = await fetch(url2, {
      ...init,
      signal: controller.signal
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok && !(payload && typeof payload === "object" && typeof payload.error === "string")) {
      throw new Error(`HTTP ${response.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
};
const createFormBody = (params) => new URLSearchParams(params).toString();
const parseModels = (payload) => {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const data = payload.data ?? payload.models;
  return Array.isArray(data) ? normalizeAccountModels(data) : [];
};
const parseCopilotModels = (payload) => {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const data = payload.data ?? payload.models;
  if (!Array.isArray(data)) {
    return [];
  }
  return normalizeAccountModels(data.filter((value) => {
    const record = value && typeof value === "object" ? value : null;
    const policy = record?.policy && typeof record.policy === "object" && !Array.isArray(record.policy) ? record.policy : null;
    const state2 = typeof policy?.state === "string" ? policy.state.toLowerCase() : "";
    return !state2 || state2 === "enabled";
  }));
};
class ProviderAccountAuthService {
  async startLogin(request2) {
    const providerId = request2.providerId;
    if (!isAccountProviderId(providerId)) {
      return this.status(providerId, "Provider does not support account login.");
    }
    if (providerId === "claude-account") {
      return this.startClaudeLogin();
    }
    if (providerId === "chatgpt-account") {
      return this.startChatGptLogin();
    }
    if (providerId === "github-copilot") {
      return this.startGitHubCopilotLogin();
    }
    if (providerId === "grok-account") {
      return this.startGrokLogin(request2.oauthClientId);
    }
    return this.startUnimplementedAccountLogin(providerId);
  }
  async finishLogin(request2) {
    if (!isAccountProviderId(request2.providerId)) {
      return this.status(request2.providerId, "Provider does not support account login.");
    }
    const flow = this.findFlow(request2.providerId, request2.flowId);
    if (!flow) {
      return this.status(request2.providerId, "Login flow expired or was not started.", "failed");
    }
    try {
      if (request2.providerId === "claude-account") {
        const bundle = await this.exchangeClaudeCode(flow, request2.code?.trim() ?? "");
        return await this.persistAccount(request2.providerId, bundle);
      }
      if (request2.providerId === "chatgpt-account") {
        const bundle = await this.exchangeChatGptCode(flow, request2.code?.trim() ?? "");
        return await this.persistAccount(request2.providerId, bundle);
      }
      if (isUnimplementedAccountProviderId(request2.providerId)) {
        const bundle = this.exchangeUnimplementedAccountCode(flow, request2.code?.trim() ?? "");
        return await this.persistAccount(request2.providerId, bundle);
      }
      if (request2.providerId === "github-copilot") {
        const bundle = await this.pollGitHubDevice(flow);
        return await this.persistAccount(request2.providerId, bundle);
      }
      if (request2.providerId === "grok-account") {
        const bundle = await this.pollGrokDevice(flow);
        return await this.persistAccount(request2.providerId, bundle);
      }
      return this.status(request2.providerId, "Provider does not support account login.", "failed");
    } catch (error) {
      flow.error = parseProviderError$1(error);
      return this.status(request2.providerId, flow.error, "failed");
    }
  }
  async test(providerId) {
    if (!isAccountProviderId(providerId)) {
      return this.status(providerId, "Provider does not support account login.");
    }
    const bundle = this.readBundle(providerId);
    if (!bundle) {
      return this.status(providerId, "Account is not connected.");
    }
    try {
      const activeBundle = await this.refreshBundleIfNeeded(bundle);
      const models = await this.discoverModels(activeBundle);
      if (models.length === 0) {
        throw new Error("Account provider returned no usable models.");
      }
      settingsService.saveProviderAccountConnection(
        providerId,
        JSON.stringify(activeBundle),
        models,
        {
          accountLabel: activeBundle.accountLabel,
          planLabel: activeBundle.planLabel,
          oauthExpiresAt: activeBundle.expiresAt,
          oauthRefreshAvailable: canRefreshBundle(activeBundle)
        }
      );
      return this.status(providerId);
    } catch (error) {
      return this.status(providerId, parseProviderError$1(error), "failed");
    }
  }
  async ensureRuntimeCredentials(providerId) {
    if (!isAccountProviderId(providerId)) {
      return;
    }
    const bundle = this.readBundle(providerId);
    if (!bundle) {
      throw new Error("Account is not connected.");
    }
    if (providerId === "github-copilot" && !bundle.accessToken) {
      throw new Error("GitHub Copilot account access token is missing. Sign in again.");
    }
    const activeBundle = await this.refreshBundleIfNeeded(bundle);
    if (JSON.stringify(activeBundle) === JSON.stringify(bundle)) {
      return;
    }
    const models = await this.discoverModels(activeBundle);
    settingsService.saveProviderAccountConnection(
      providerId,
      JSON.stringify(activeBundle),
      models,
      {
        accountLabel: activeBundle.accountLabel,
        planLabel: activeBundle.planLabel,
        oauthExpiresAt: activeBundle.expiresAt,
        oauthRefreshAvailable: canRefreshBundle(activeBundle)
      }
    );
  }
  status(providerId, message, forcedState) {
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
    const isAccount = isAccountProviderId(providerId);
    const flow = isAccount ? this.findFlow(providerId) : null;
    const connected = Boolean(provider?.isConfigured && provider.status === "verified");
    const grokClientIdSource = providerId === "grok-account" ? flow?.clientId ? "draft" : connected && this.readBundle("grok-account")?.clientId ? "stored" : resolveGrokOAuthClientId().source : void 0;
    const state2 = forcedState ?? (connected ? "connected" : flow?.error ? "failed" : flow ? "pending" : isAccount ? "signed-out" : "unavailable");
    const pendingMessage = providerId === "github-copilot" ? "Waiting for GitHub authorization." : providerId === "grok-account" ? "Waiting for xAI authorization." : "Waiting for authorization.";
    return {
      providerId,
      state: state2,
      available: isAccount,
      connected,
      message: message ?? flow?.error ?? (connected ? "Connected" : flow ? pendingMessage : "Not connected"),
      error: forcedState === "failed" ? message : flow?.error,
      accountLabel: provider?.accountLabel,
      planLabel: provider?.planLabel,
      expiresAt: provider?.oauthExpiresAt,
      authUrl: flow?.authUrl,
      verificationUri: flow?.verificationUri,
      userCode: flow?.userCode,
      requiresCodeInput: Boolean(flow?.providerId === "claude-account" || flow && isUnimplementedAccountProviderId(flow.providerId)),
      requiresClientId: providerId === "grok-account" && !connected && !grokClientIdSource,
      clientIdSource: grokClientIdSource,
      models: provider?.models ?? []
    };
  }
  logout(providerId) {
    if (isAccountProviderId(providerId)) {
      const bundle = providerId === "grok-account" ? this.readBundle("grok-account") : null;
      this.clearFlows(providerId);
      if (bundle) {
        void this.revokeGrokBundle(bundle);
      }
      settingsService.disconnectProvider(providerId);
    }
    return this.status(providerId);
  }
  startClaudeLogin() {
    const { verifier, challenge } = createPkce();
    const state2 = crypto.randomUUID();
    const flow = {
      providerId: "claude-account",
      flowId: crypto.randomUUID(),
      state: state2,
      codeVerifier: verifier,
      authUrl: appendParams("https://claude.ai/oauth/authorize", {
        code: "true",
        client_id: CLAUDE_CLIENT_ID,
        response_type: "code",
        redirect_uri: "https://console.anthropic.com/oauth/code/callback",
        scope: "org:create_api_key user:profile user:inference",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: state2
      }),
      expiresAt: Date.now() + 10 * 60 * 1e3
    };
    this.setFlow(flow);
    void this.openExternal(flow.authUrl);
    return this.status(flow.providerId);
  }
  async startChatGptLogin() {
    const { verifier, challenge } = createPkce();
    const state2 = crypto.randomUUID();
    const flow = {
      providerId: "chatgpt-account",
      flowId: crypto.randomUUID(),
      state: state2,
      codeVerifier: verifier,
      authUrl: appendParams("https://auth.openai.com/oauth/authorize", {
        client_id: CHATGPT_CLIENT_ID,
        response_type: "code",
        redirect_uri: `http://localhost:${CHATGPT_CALLBACK_PORT}/auth/callback`,
        scope: "openid profile email offline_access",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: state2,
        codex_cli_simplified_flow: "true",
        id_token_add_organizations: "true"
      }),
      expiresAt: Date.now() + 10 * 60 * 1e3
    };
    this.setFlow(flow);
    await this.startChatGptCallbackServer(flow);
    void this.openExternal(flow.authUrl);
    return this.status(flow.providerId);
  }
  async startGitHubCopilotLogin() {
    const payload = await fetchJson("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_id: GITHUB_COPILOT_CLIENT_ID,
        scope: "read:user"
      })
    });
    const flow = {
      providerId: "github-copilot",
      flowId: crypto.randomUUID(),
      state: crypto.randomUUID(),
      deviceCode: payload.device_code,
      userCode: payload.user_code,
      verificationUri: payload.verification_uri,
      intervalSeconds: payload.interval ?? 5,
      expiresAt: Date.now() + (payload.expires_in ?? 900) * 1e3
    };
    this.setFlow(flow);
    if (flow.verificationUri) {
      void this.openExternal(flow.verificationUri);
    }
    void this.pollGitHubDevice(flow).then((bundle) => this.persistAccount("github-copilot", bundle)).catch((error) => {
      flow.error = parseProviderError$1(error);
    });
    return this.status(flow.providerId);
  }
  async startGrokLogin(oauthClientId) {
    const resolved = resolveGrokOAuthClientId(oauthClientId);
    if (!resolved.clientId) {
      return this.status(
        "grok-account",
        "Grok OAuth client id is required. Enter an OAuth client id or set RDC_AGENT_GROK_OAUTH_CLIENT_ID.",
        "failed"
      );
    }
    try {
      const payload = await fetchJson(GROK_AUTH_DEVICE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: createFormBody({
          client_id: resolved.clientId,
          scope: GROK_OAUTH_SCOPE
        })
      });
      if (!payload.device_code || !payload.user_code || !payload.verification_uri) {
        throw new Error("xAI OAuth did not return a complete device authorization payload.");
      }
      const flow = {
        providerId: "grok-account",
        flowId: crypto.randomUUID(),
        state: crypto.randomUUID(),
        deviceCode: payload.device_code,
        userCode: payload.user_code,
        verificationUri: payload.verification_uri,
        authUrl: payload.verification_uri_complete ?? payload.verification_uri,
        intervalSeconds: payload.interval ?? 5,
        clientId: resolved.clientId,
        expiresAt: Date.now() + (payload.expires_in ?? 900) * 1e3
      };
      this.setFlow(flow);
      void this.openExternal(flow.authUrl);
      void this.pollGrokDevice(flow).then((bundle) => this.persistAccount("grok-account", bundle)).catch((error) => {
        flow.error = parseProviderError$1(error);
      });
      return this.status(flow.providerId);
    } catch (error) {
      return this.status("grok-account", parseProviderError$1(error), "failed");
    }
  }
  startUnimplementedAccountLogin(providerId) {
    const definition = getBuiltinProviderDefinition(providerId);
    const flow = {
      providerId,
      flowId: crypto.randomUUID(),
      state: crypto.randomUUID(),
      authUrl: definition?.docsUrl,
      expiresAt: Date.now() + 10 * 60 * 1e3
    };
    this.setFlow(flow);
    void this.openExternal(flow.authUrl);
    return this.status(
      flow.providerId,
      isTestMode$1() ? "Test-only account authorization flow started." : "Live account OAuth is not configured for this provider; automated test-mode verification is the only available path."
    );
  }
  async exchangeClaudeCode(flow, code) {
    if (!code || !flow.codeVerifier) {
      throw new Error("Authorization code is required.");
    }
    const payload = await fetchJson("https://platform.claude.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "RDC-Agent"
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: CLAUDE_CLIENT_ID,
        code,
        redirect_uri: "https://console.anthropic.com/oauth/code/callback",
        code_verifier: flow.codeVerifier,
        state: flow.state
      })
    });
    if (!payload.access_token) {
      throw new Error("Claude OAuth did not return an access token.");
    }
    return {
      providerId: "claude-account",
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1e3).toISOString(),
      accountLabel: "Claude Account",
      planLabel: payload.scope
    };
  }
  async exchangeChatGptCode(flow, code) {
    if (!code || !flow.codeVerifier) {
      throw new Error("Authorization code is required.");
    }
    const tokenPayload = await fetchJson("https://auth.openai.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CHATGPT_CLIENT_ID,
        code,
        redirect_uri: `http://localhost:${CHATGPT_CALLBACK_PORT}/auth/callback`,
        code_verifier: flow.codeVerifier
      }).toString()
    });
    if (!tokenPayload.access_token) {
      throw new Error("OpenAI OAuth did not return an access token.");
    }
    return {
      providerId: "chatgpt-account",
      accessToken: tokenPayload.access_token,
      refreshToken: tokenPayload.refresh_token,
      apiKey: tokenPayload.access_token,
      idToken: tokenPayload.id_token,
      accountId: extractChatGptAccountId(tokenPayload.id_token),
      expiresAt: new Date(Date.now() + (tokenPayload.expires_in ?? 3600) * 1e3).toISOString(),
      accountLabel: "ChatGPT Account"
    };
  }
  async pollGitHubDevice(flow) {
    if (!flow.deviceCode) {
      throw new Error("GitHub device code is missing.");
    }
    let intervalSeconds = flow.intervalSeconds ?? 5;
    let delayBeforePoll = !isTestMode$1();
    for (; ; ) {
      if (Date.now() > flow.expiresAt) {
        throw new Error("GitHub authorization code expired.");
      }
      if (delayBeforePoll) {
        await wait(intervalSeconds * 1e3);
      }
      delayBeforePoll = true;
      const payload = await fetchJson("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          client_id: GITHUB_COPILOT_CLIENT_ID,
          device_code: flow.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code"
        })
      });
      if (payload.error === "authorization_pending") {
        delete flow.error;
        continue;
      }
      if (payload.error === "slow_down") {
        delete flow.error;
        intervalSeconds += 5;
        continue;
      }
      if (payload.error) {
        throw new Error(payload.error);
      }
      if (!payload.access_token) {
        throw new Error("GitHub OAuth did not return an access token.");
      }
      const copilot = await fetchJson("https://api.github.com/copilot_internal/v2/token", {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `token ${payload.access_token}`,
          ...COPILOT_EDITOR_HEADERS
        }
      });
      if (!copilot.token) {
        throw new Error("GitHub Copilot did not return an API token.");
      }
      return {
        providerId: "github-copilot",
        accessToken: payload.access_token,
        copilotToken: copilot.token,
        copilotApiBaseUrl: copilot.endpoints?.api ?? "https://api.githubcopilot.com",
        expiresAt: copilot.expires_at ? new Date(copilot.expires_at * 1e3).toISOString() : void 0,
        accountLabel: "GitHub Copilot"
      };
    }
  }
  async pollGrokDevice(flow) {
    if (!flow.deviceCode || !flow.clientId) {
      throw new Error("Grok device authorization is missing client or device code.");
    }
    let intervalSeconds = flow.intervalSeconds ?? 5;
    let delayBeforePoll = !isTestMode$1();
    for (; ; ) {
      if (Date.now() > flow.expiresAt) {
        throw new Error("Grok authorization code expired.");
      }
      if (delayBeforePoll) {
        await wait(intervalSeconds * 1e3);
      }
      delayBeforePoll = true;
      const payload = await fetchOAuthJson(GROK_AUTH_TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: createFormBody({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          client_id: flow.clientId,
          device_code: flow.deviceCode
        })
      });
      if (payload.error === "authorization_pending") {
        delete flow.error;
        continue;
      }
      if (payload.error === "slow_down") {
        delete flow.error;
        intervalSeconds += 5;
        continue;
      }
      if (payload.error) {
        throw new Error(payload.error_description ?? payload.error);
      }
      if (!payload.access_token) {
        throw new Error("xAI OAuth did not return an access token.");
      }
      const account = await this.fetchGrokUserInfo(payload.access_token);
      return {
        providerId: "grok-account",
        accessToken: payload.access_token,
        apiKey: payload.access_token,
        refreshToken: payload.refresh_token,
        idToken: payload.id_token,
        clientId: flow.clientId,
        accountId: account.accountId,
        expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1e3).toISOString(),
        accountLabel: account.accountLabel ?? "Grok Account",
        planLabel: "xAI OAuth"
      };
    }
  }
  async fetchGrokUserInfo(accessToken) {
    try {
      const payload = await fetchJson(GROK_AUTH_USERINFO_ENDPOINT, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      const record = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
      return {
        accountId: readString(record.sub),
        accountLabel: readString(record.email) ?? readString(record.name) ?? readString(record.preferred_username) ?? readString(record.sub)
      };
    } catch {
      return {};
    }
  }
  exchangeUnimplementedAccountCode(flow, code) {
    if (!isUnimplementedAccountProviderId(flow.providerId)) {
      throw new Error("Provider is not an unimplemented account adapter.");
    }
    if (!isTestMode$1()) {
      const definition = getBuiltinProviderDefinition(flow.providerId);
      throw new Error(definition?.unavailableReason ?? "Live account OAuth is not configured for this provider.");
    }
    if (!code) {
      throw new Error("Authorization code is required.");
    }
    return {
      providerId: flow.providerId,
      accessToken: `test-${flow.providerId}-${flow.state}`,
      apiKey: `test-${flow.providerId}-${flow.state}`,
      expiresAt: new Date(Date.now() + 3600 * 1e3).toISOString(),
      accountLabel: getBuiltinProviderDefinition(flow.providerId)?.label ?? flow.providerId,
      planLabel: "Test account"
    };
  }
  async persistAccount(providerId, bundle) {
    const models = await this.discoverModels(bundle);
    if (models.length === 0) {
      throw new Error("Account provider returned no usable models.");
    }
    settingsService.saveProviderAccountConnection(
      providerId,
      JSON.stringify(bundle),
      models,
      {
        accountLabel: bundle.accountLabel,
        planLabel: bundle.planLabel,
        oauthExpiresAt: bundle.expiresAt,
        oauthRefreshAvailable: canRefreshBundle(bundle)
      }
    );
    this.clearFlows(providerId);
    return this.status(providerId);
  }
  async refreshBundleIfNeeded(bundle) {
    if (bundle.providerId !== "github-copilot" && !isExpiringSoon(bundle.expiresAt)) {
      return bundle;
    }
    if (bundle.providerId === "github-copilot") {
      if (!bundle.accessToken) {
        return bundle;
      }
      const copilot = await fetchJson("https://api.github.com/copilot_internal/v2/token", {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `token ${bundle.accessToken}`,
          ...COPILOT_EDITOR_HEADERS
        }
      });
      if (!copilot.token) {
        throw new Error("GitHub Copilot did not return an API token.");
      }
      return {
        ...bundle,
        copilotToken: copilot.token,
        copilotApiBaseUrl: copilot.endpoints?.api ?? bundle.copilotApiBaseUrl ?? "https://api.githubcopilot.com",
        expiresAt: copilot.expires_at ? new Date(copilot.expires_at * 1e3).toISOString() : bundle.expiresAt
      };
    }
    if (bundle.providerId === "grok-account") {
      if (!bundle.refreshToken || !bundle.clientId) {
        return bundle;
      }
      const payload2 = await fetchOAuthJson(GROK_AUTH_TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: createFormBody({
          grant_type: "refresh_token",
          client_id: bundle.clientId,
          refresh_token: bundle.refreshToken
        })
      });
      if (payload2.error) {
        throw new Error(payload2.error_description ?? payload2.error);
      }
      if (!payload2.access_token) {
        throw new Error("xAI OAuth refresh did not return an access token.");
      }
      return {
        ...bundle,
        accessToken: payload2.access_token,
        apiKey: payload2.access_token,
        idToken: payload2.id_token ?? bundle.idToken,
        refreshToken: payload2.refresh_token ?? bundle.refreshToken,
        expiresAt: new Date(Date.now() + (payload2.expires_in ?? 3600) * 1e3).toISOString()
      };
    }
    if (isUnimplementedAccountProviderId(bundle.providerId)) {
      return bundle;
    }
    if (!bundle.refreshToken) {
      return bundle;
    }
    if (bundle.providerId === "claude-account") {
      const payload2 = await fetchJson("https://platform.claude.com/v1/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "RDC-Agent"
        },
        body: JSON.stringify({
          grant_type: "refresh_token",
          client_id: CLAUDE_CLIENT_ID,
          refresh_token: bundle.refreshToken
        })
      });
      if (!payload2.access_token) {
        throw new Error("Claude OAuth refresh did not return an access token.");
      }
      return {
        ...bundle,
        accessToken: payload2.access_token,
        refreshToken: payload2.refresh_token ?? bundle.refreshToken,
        expiresAt: new Date(Date.now() + (payload2.expires_in ?? 3600) * 1e3).toISOString(),
        planLabel: payload2.scope ?? bundle.planLabel
      };
    }
    const payload = await fetchJson("https://auth.openai.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CHATGPT_CLIENT_ID,
        refresh_token: bundle.refreshToken
      }).toString()
    });
    if (!payload.access_token) {
      throw new Error("OpenAI OAuth refresh did not return an access token.");
    }
    return {
      ...bundle,
      accessToken: payload.access_token,
      apiKey: payload.access_token,
      idToken: payload.id_token ?? bundle.idToken,
      accountId: extractChatGptAccountId(payload.id_token) ?? bundle.accountId,
      refreshToken: payload.refresh_token ?? bundle.refreshToken,
      expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1e3).toISOString()
    };
  }
  async discoverModels(bundle) {
    if (bundle.providerId === "chatgpt-account" || bundle.providerId === "claude-account" || isUnimplementedAccountProviderId(bundle.providerId)) {
      return createAccountCatalogModels(bundle.providerId);
    }
    if (bundle.providerId === "grok-account") {
      const token = bundle.accessToken ?? bundle.apiKey;
      if (!token) {
        throw new Error("Grok account access token is missing. Sign in again.");
      }
      const payload2 = await fetchJson(`${GROK_API_BASE_URL}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      return parseModels(payload2);
    }
    if (bundle.providerId === "github-copilot") {
      const catalogModels = createAccountCatalogModels(bundle.providerId);
      const baseUrl = (bundle.copilotApiBaseUrl ?? "https://api.githubcopilot.com").replace(/\/+$/, "");
      try {
        const payload2 = await fetchJson(`${baseUrl}/models`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${bundle.copilotToken}`,
            "Content-Type": "application/json",
            ...COPILOT_WIRE_HEADERS
          }
        });
        return mergeAccountModels(catalogModels, parseCopilotModels(payload2));
      } catch {
        return catalogModels;
      }
    }
    const payload = await fetchJson("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bundle.apiKey ?? bundle.accessToken}`
      }
    });
    return parseModels(payload);
  }
  async revokeGrokBundle(bundle) {
    if (bundle.providerId !== "grok-account" || !bundle.clientId) {
      return;
    }
    const token = bundle.refreshToken ?? bundle.accessToken ?? bundle.apiKey;
    if (!token) {
      return;
    }
    try {
      await fetchOAuthJson(GROK_AUTH_REVOKE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: createFormBody({
          client_id: bundle.clientId,
          token,
          token_type_hint: bundle.refreshToken ? "refresh_token" : "access_token"
        })
      });
    } catch {
    }
  }
  readBundle(providerId) {
    const raw = settingsService.getProviderOAuthSecret(providerId);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      return parsed.providerId === providerId ? parsed : null;
    } catch {
      return null;
    }
  }
  findFlow(providerId, flowId) {
    for (const flow of pendingFlows.values()) {
      if (flow.providerId === providerId && (!flowId || flow.flowId === flowId) && Date.now() <= flow.expiresAt) {
        return flow;
      }
    }
    return null;
  }
  setFlow(flow) {
    this.clearFlows(flow.providerId);
    pendingFlows.set(flow.flowId, flow);
  }
  clearFlows(providerId) {
    for (const [flowId, flow] of pendingFlows.entries()) {
      if (flow.providerId === providerId) {
        this.closeFlowServer(flow);
        pendingFlows.delete(flowId);
      }
    }
  }
  closeFlowServer(flow) {
    const server2 = flow.server;
    if (!server2) {
      return;
    }
    delete flow.server;
    if (server2.listening) {
      server2.close();
    }
  }
  startChatGptCallbackServer(flow) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const server2 = http.createServer((request2, response) => {
        const url2 = new URL(request2.url ?? "/", `http://localhost:${CHATGPT_CALLBACK_PORT}`);
        if (url2.pathname !== "/auth/callback" || url2.searchParams.get("state") !== flow.state) {
          response.writeHead(400, { "Content-Type": "text/plain" });
          response.end("Invalid OAuth callback.");
          return;
        }
        const code = url2.searchParams.get("code") ?? "";
        void this.finishLogin({ providerId: flow.providerId, flowId: flow.flowId, code }).then(() => {
          response.writeHead(200, { "Content-Type": "text/html" });
          response.end("<html><body>RDC Agent sign-in complete. You can return to the app.</body></html>");
        }).catch((error) => {
          response.writeHead(500, { "Content-Type": "text/plain" });
          response.end(parseProviderError$1(error));
        }).finally(() => {
          this.closeFlowServer(flow);
        });
      });
      flow.server = server2;
      server2.on("error", (error) => {
        flow.error = parseProviderError$1(error);
        this.closeFlowServer(flow);
        pendingFlows.delete(flow.flowId);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      server2.listen(CHATGPT_CALLBACK_PORT, "127.0.0.1", () => {
        settled = true;
        resolve();
      });
    });
  }
  async openExternal(url2) {
    if (!url2 || isTestMode$1()) {
      return;
    }
    await electron.shell.openExternal(url2);
  }
}
const providerAccountAuthService = new ProviderAccountAuthService();
const BLOCKER_CODES = {
  BLOCKED_LLM_ROUTE_MISSING: {
    code: "BLOCKED_LLM_ROUTE_MISSING"
  },
  BLOCKED_LLM_PROVIDER_MISSING: {
    code: "BLOCKED_LLM_PROVIDER_MISSING"
  },
  BLOCKED_LLM_SECRET_MISSING: {
    code: "BLOCKED_LLM_SECRET_MISSING"
  },
  BLOCKED_LLM_MODEL_MISSING: {
    code: "BLOCKED_LLM_MODEL_MISSING"
  },
  BLOCKED_LLM_PROVIDER_UNAVAILABLE: {
    code: "BLOCKED_LLM_PROVIDER_UNAVAILABLE"
  },
  BLOCKED_LLM_REQUEST_FAILED: {
    code: "BLOCKED_LLM_REQUEST_FAILED"
  }
};
class WorkflowProjectionPublisher {
  publish(channel, ...args) {
    rendererEventHub.emit(channel, ...args);
    for (const window of electron.BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, ...args);
      }
    }
  }
  publishWorkflowState(state2) {
    this.publish("workflow:stateChanged", state2);
    this.publish("workflow:stageChanged", {
      stage: state2.currentStage,
      blockers: state2.blockers
    });
  }
  publishRunStatus(payload) {
    this.publish("workflow:runStatusChanged", payload);
  }
  publishRunUsage(usage) {
    this.publish("workflow:runUsageChanged", usage);
  }
  publishTraceProjectionChanged(sessionId, presentation) {
    this.publish("trace:projectionChanged", {
      sessionId,
      presentation
    });
  }
  publishEvidenceEvent(event) {
    this.publish("evidence:eventAdded", event);
  }
  publishConversationEvent(event) {
    this.publish("conversation:event", event);
  }
  publishAgentStatus(state2) {
    this.publish("agent:statusChanged", state2);
  }
  publishAgentMessage(message) {
    this.publish("agent:message", message);
  }
}
const workflowProjectionPublisher = new WorkflowProjectionPublisher();
class DebuggerLlmBlockerError extends Error {
  blocker;
  constructor(blocker) {
    super(blocker.reason);
    this.name = "DebuggerLlmBlockerError";
    this.blocker = blocker;
  }
}
function makeBlocker(code, reason, refs = []) {
  return {
    code,
    reason,
    refs,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function extractTextContent(content) {
  if (typeof content === "string") {
    return content.trim();
  }
  return content.map((block) => {
    if (block.type === "text") {
      return block.text || "";
    }
    if (block.type === "tool_result") {
      return block.content || "";
    }
    return "";
  }).join("\n").trim();
}
const charsToTokens$1 = (chars) => Math.ceil(chars / 4);
function buildScaledBreakdown(raw, occupiedTokens, contextWindowTokens) {
  if (!raw || raw.length === 0) {
    return null;
  }
  const estimateSum = raw.reduce((acc, entry) => acc + entry.tokens, 0);
  const scaleFactor = estimateSum > 0 && occupiedTokens > 0 ? occupiedTokens / estimateSum : 1;
  const scaled = raw.map((entry) => ({
    id: entry.id,
    tokens: Math.max(0, Math.round(entry.tokens * scaleFactor)),
    ...entry.count !== void 0 ? { count: entry.count } : {}
  }));
  if (contextWindowTokens) {
    scaled.push({ id: "free", tokens: Math.max(0, contextWindowTokens - occupiedTokens) });
  }
  return scaled;
}
function extractBalancedJsonFragment(text, opening) {
  const start = text.indexOf(opening);
  if (start < 0) {
    return null;
  }
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === opening) {
      depth += 1;
      continue;
    }
    if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return null;
}
function extractJsonCandidate(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("LLM response was empty");
  }
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
  }
  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    const candidate = fencedMatch[1].trim();
    JSON.parse(candidate);
    return candidate;
  }
  const balancedObject = extractBalancedJsonFragment(trimmed, "{");
  if (balancedObject) {
    JSON.parse(balancedObject);
    return balancedObject;
  }
  const balancedArray = extractBalancedJsonFragment(trimmed, "[");
  if (balancedArray) {
    JSON.parse(balancedArray);
    return balancedArray;
  }
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    const candidate = trimmed.slice(objectStart, objectEnd + 1);
    JSON.parse(candidate);
    return candidate;
  }
  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    const candidate = trimmed.slice(arrayStart, arrayEnd + 1);
    JSON.parse(candidate);
    return candidate;
  }
  throw new Error("LLM response did not contain valid JSON");
}
function shouldRetryStructuredLlmError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /LLM response was empty|did not contain valid JSON|Unexpected non-whitespace character after JSON|OpenRouter API error: 5\d\d|timed out|timeout/i.test(message);
}
function readRouteProtocol(route) {
  return route.provider.protocol ?? null;
}
function shouldUseNativeJsonObject(route) {
  const protocol = readRouteProtocol(route);
  const modelId = route.modelId.toLowerCase();
  if (!protocol || protocol === "AnthropicMessages") {
    return false;
  }
  if (/moonshot|kimi/.test(modelId)) {
    return false;
  }
  return true;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
class DebuggerLlmService {
  runSummaries = /* @__PURE__ */ new Map();
  resetRunSummary(runId) {
    this.runSummaries.delete(runId);
    this.broadcastRunUsage(runId);
  }
  getRunSummary(runId) {
    const summary = this.runSummaries.get(runId);
    if (!summary) {
      return null;
    }
    return {
      ...summary,
      routesUsed: summary.routesUsed.map((entry) => ({ ...entry }))
    };
  }
  getRunContextUsage(runId) {
    const summary = this.runSummaries.get(runId);
    if (!summary) {
      return null;
    }
    const settings = settingsService.getAll();
    const provider = settings.llm.providers.find((entry) => entry.id === summary.providerId);
    const model = provider?.models.find((entry) => entry.id === summary.modelId) ?? null;
    const contextWindowTokens = typeof model?.contextWindowTokens === "number" && model.contextWindowTokens > 0 ? model.contextWindowTokens : null;
    const totalTokens = summary.totalInputTokens + summary.totalOutputTokens;
    const occupiedTokens = summary.lastOccupiedTokens ?? 0;
    return {
      runId,
      providerId: summary.providerId,
      modelId: summary.modelId,
      inputTokens: summary.totalInputTokens,
      outputTokens: summary.totalOutputTokens,
      totalTokens,
      contextWindowTokens,
      usagePercent: contextWindowTokens ? Math.min(100, Math.max(0, Math.round(occupiedTokens / contextWindowTokens * 100))) : 0,
      hasConfiguredContextWindow: Boolean(contextWindowTokens),
      occupiedTokens,
      breakdown: buildScaledBreakdown(summary.lastPromptBreakdown ?? null, occupiedTokens, contextWindowTokens),
      snapshotAt: summary.lastSnapshotAt ?? null
    };
  }
  /**
   * 记录一次 agent loop turn 的真实窗口占用与分类快照，并广播给 UI。
   *
   * agent 主循环不经过 {@link call}，其用量由 provider 在 `message_end` 上报；
   * 这里把它并入同一份 runSummaries，使上下文环 / 分类查看器拿到权威数据。
   * `inputTokens` 为最近一次 prompt 的真实占用；分类中对话量取占用量减去
   * 系统提示与工具定义的估算余量（字符/4 口径），保证各段之和锚定到权威占用。
   */
  recordAgentTurnUsage(params) {
    const key = params.runId ?? params.sessionId;
    if (!key) {
      return;
    }
    const existing = this.runSummaries.get(key) ?? {
      providerId: params.providerId,
      modelId: params.modelId,
      successfulCallCount: 0,
      failedCallCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      firstRequestId: void 0,
      routesUsed: []
    };
    existing.providerId = existing.providerId || params.providerId;
    existing.modelId = existing.modelId || params.modelId;
    existing.successfulCallCount += 1;
    existing.totalInputTokens += params.inputTokens;
    existing.totalOutputTokens += params.outputTokens;
    existing.lastOccupiedTokens = params.inputTokens;
    if (params.precomputedBreakdown && params.precomputedBreakdown.length > 0) {
      existing.lastPromptBreakdown = params.precomputedBreakdown;
    } else {
      const systemTokens = charsToTokens$1((params.systemPrompt ?? "").length);
      const toolChars = params.toolDefinitions ? JSON.stringify(params.toolDefinitions).length : 0;
      const toolTokens = charsToTokens$1(toolChars);
      const conversationTokens = Math.max(0, params.inputTokens - systemTokens - toolTokens);
      existing.lastPromptBreakdown = [
        { id: "system_prompt", tokens: systemTokens },
        { id: "tool_definitions", tokens: toolTokens, count: params.toolCount },
        { id: "conversation", tokens: conversationTokens }
      ];
    }
    existing.lastSnapshotAt = Date.now();
    this.runSummaries.set(key, existing);
    this.broadcastRunUsage(key);
  }
  async refreshAccountRuntimeCredentials(route) {
    if (route.provider.authMode !== "account") {
      return;
    }
    await providerAccountAuthService.ensureRuntimeCredentials(route.providerId);
  }
  getRouteBlockers(agentIds, stage, settings = settingsService.getAll()) {
    const blockers = [];
    const seen = /* @__PURE__ */ new Set();
    for (const agentId of agentIds) {
      try {
        this.resolveRoute(agentId, stage, settings);
      } catch (error) {
        if (!(error instanceof DebuggerLlmBlockerError)) {
          throw error;
        }
        const key = `${error.blocker.code}:${agentId}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        blockers.push(error.blocker);
      }
    }
    return blockers;
  }
  resolveRoute(agentId, stage, settings = settingsService.getAll()) {
    const requestedRoute = settings.llm.agentRoutes.find((entry) => entry.agentId === agentId);
    const resolution = resolveCompatibleAgentRoute(settings.llm.agentRoutes, settings.llm.providers, agentId);
    const route = resolution.route;
    if (!route?.providerId || !route.modelId) {
      throw new DebuggerLlmBlockerError(makeBlocker(
        BLOCKER_CODES.BLOCKED_LLM_ROUTE_MISSING.code,
        `${agentId} is not bound to a provider/model route.`,
        [`agent:${agentId}`]
      ));
    }
    const provider = resolution.provider ?? settings.llm.providers.find((entry) => entry.id === route.providerId);
    if (!provider || !provider.enabled) {
      throw new DebuggerLlmBlockerError(makeBlocker(
        BLOCKER_CODES.BLOCKED_LLM_PROVIDER_MISSING.code,
        `${agentId} route points to an unavailable provider: ${route.providerId}.`,
        [`agent:${agentId}`, `provider:${route.providerId}`]
      ));
    }
    const model = provider.models.find((entry) => entry.enabled && entry.id === route.modelId);
    if (!model) {
      throw new DebuggerLlmBlockerError(makeBlocker(
        BLOCKER_CODES.BLOCKED_LLM_MODEL_MISSING.code,
        `${agentId} route points to a disabled or missing model: ${route.modelId}.`,
        [`agent:${agentId}`, `provider:${provider.id}`, `model:${route.modelId}`]
      ));
    }
    const secret = provider.authMode === "local" ? "local-provider" : provider.authMode === "environment" ? "environment-provider" : provider.authMode === "account" ? settingsService.getProviderOAuthSecret(provider.id, settings.workspace.rootPath) : settingsService.getProviderSecret(provider.id, settings.workspace.rootPath);
    if (!secret.trim()) {
      throw new DebuggerLlmBlockerError(makeBlocker(
        BLOCKER_CODES.BLOCKED_LLM_SECRET_MISSING.code,
        `${agentId} route provider is missing a usable secret: ${provider.id}.`,
        [`agent:${agentId}`, `provider:${provider.id}`]
      ));
    }
    return {
      agentId,
      stage,
      provider,
      providerId: provider.id,
      modelId: route.modelId,
      requestedModelId: resolution.requestedModelId ?? requestedRoute?.modelId,
      remapReason: resolution.remapReason
    };
  }
  async call(context2, request2) {
    const settings = settingsService.getAll();
    const route = this.resolveRoute(context2.agentId, context2.stage, settings);
    if (process.env.RDC_AGENT_TEST_MODE === "1") {
      const response = {
        id: `test-llm-${Date.now()}`,
        model: route.modelId,
        content: "",
        usage: {
          inputTokens: 0,
          outputTokens: 0
        },
        stopReason: "end_turn"
      };
      const text = "";
      await this.recordCall(context2, route, response, "ok", "test-mode llm stub");
      return {
        route,
        response,
        text
      };
    }
    await this.refreshAccountRuntimeCredentials(route);
    llmAdapter.configure(settingsService.getLlmConfig());
    try {
      const response = await llmAdapter.chat({
        ...request2,
        model: route.modelId
      }, route.providerId);
      const text = extractTextContent(response.content);
      await this.recordCall(context2, route, response, "ok", text || `${route.providerId}/${route.modelId}`);
      return {
        route,
        response,
        text
      };
    } catch (error) {
      await this.recordFailure(context2, route, error instanceof Error ? error.message : String(error));
      throw this.toRuntimeError(route, error);
    }
  }
  async callStructured(input) {
    if (process.env.RDC_AGENT_TEST_MODE === "1" && input.testValue !== void 0) {
      const settings2 = settingsService.getAll();
      const route2 = this.resolveRoute(input.agentId, input.stage, settings2);
      const response = {
        id: `test-llm-${Date.now()}`,
        model: route2.modelId,
        content: JSON.stringify(input.testValue),
        usage: {
          inputTokens: 0,
          outputTokens: 0
        },
        stopReason: "end_turn"
      };
      const text = JSON.stringify(input.testValue);
      const summary = input.auditSummary ? input.auditSummary(input.testValue, text) : text;
      await this.recordCall(input, route2, response, "ok", summary);
      return {
        data: input.testValue,
        call: {
          route: route2,
          response,
          text
        }
      };
    }
    const settings = settingsService.getAll();
    const route = this.resolveRoute(input.agentId, input.stage, settings);
    await this.refreshAccountRuntimeCredentials(route);
    llmAdapter.configure(settingsService.getLlmConfig());
    const useNativeJsonObject = shouldUseNativeJsonObject(route);
    let lastError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const response = await llmAdapter.chat({
          messages: input.messages,
          model: route.modelId,
          maxTokens: input.maxTokens,
          temperature: input.temperature,
          responseFormat: useNativeJsonObject ? "json_object" : void 0
        }, route.providerId);
        const text = extractTextContent(response.content);
        const data = input.parse(text);
        const summary = input.auditSummary ? input.auditSummary(data, text) : text || `${route.providerId}/${route.modelId}`;
        await this.recordCall(input, route, response, "ok", summary);
        return {
          data,
          call: {
            route,
            response,
            text
          }
        };
      } catch (error) {
        lastError = error;
        if (attempt < 3 && shouldRetryStructuredLlmError(error)) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        await this.recordFailure(
          input,
          route,
          error instanceof Error ? error.message : String(error)
        );
        throw this.toRuntimeError(route, error);
      }
    }
    await this.recordFailure(
      input,
      route,
      lastError instanceof Error ? lastError.message : String(lastError)
    );
    throw this.toRuntimeError(route, lastError);
  }
  parseJson(text) {
    return JSON.parse(extractJsonCandidate(text));
  }
  toRuntimeError(route, error) {
    const message = error instanceof Error ? error.message : String(error);
    const providerUnavailable = /provider not found|provider disabled|provider not configured|no llm provider configured/i.test(message);
    const code = providerUnavailable ? BLOCKER_CODES.BLOCKED_LLM_PROVIDER_UNAVAILABLE.code : BLOCKER_CODES.BLOCKED_LLM_REQUEST_FAILED.code;
    return new DebuggerLlmBlockerError(makeBlocker(
      code,
      `${route.agentId} failed to call ${route.providerId}/${route.modelId}: ${message}`,
      [`agent:${route.agentId}`, `provider:${route.providerId}`, `model:${route.modelId}`]
    ));
  }
  async recordCall(context2, route, response, status, summary) {
    this.updateRunSummary(context2, route, response, status);
    runtimeLogService.log({
      scope: context2.sessionId ? "session" : "app",
      namespace: "llm",
      severity: status === "ok" ? "success" : "error",
      title: `${route.agentId} -> ${route.providerId}/${route.modelId}`,
      summary,
      detail: response.id ? `request=${response.id}` : void 0,
      sessionId: context2.sessionId ?? null,
      runId: context2.runId ?? null,
      raw: {
        agentId: route.agentId,
        stage: route.stage,
        providerId: route.providerId,
        modelId: route.modelId,
        requestedModelId: route.requestedModelId,
        remapReason: route.remapReason,
        requestId: response.id,
        usage: response.usage
      }
    });
    if (!context2.sessionId || !context2.runId) {
      return;
    }
    const event = storageAdapter.createActionEvent({
      runId: context2.runId,
      sessionId: context2.sessionId,
      agentId: route.agentId,
      eventType: "llm_call",
      status,
      payload: {
        agentId: route.agentId,
        stage: route.stage,
        providerId: route.providerId,
        modelId: route.modelId,
        requestedModelId: route.requestedModelId,
        remapReason: route.remapReason,
        requestId: response.id,
        usage: response.usage,
        summary
      }
    });
    await this.appendBroadcastEvent(context2.sessionId, event);
  }
  async recordFailure(context2, route, errorMessage) {
    this.updateRunSummary(context2, route, null, "error");
    runtimeLogService.log({
      scope: context2.sessionId ? "session" : "app",
      namespace: "llm",
      severity: "error",
      title: `${route.agentId} -> ${route.providerId}/${route.modelId}`,
      summary: errorMessage,
      sessionId: context2.sessionId ?? null,
      runId: context2.runId ?? null,
      raw: {
        agentId: route.agentId,
        stage: route.stage,
        providerId: route.providerId,
        modelId: route.modelId,
        requestedModelId: route.requestedModelId,
        remapReason: route.remapReason
      }
    });
    if (!context2.sessionId || !context2.runId) {
      return;
    }
    const event = storageAdapter.createActionEvent({
      runId: context2.runId,
      sessionId: context2.sessionId,
      agentId: route.agentId,
      eventType: "llm_call",
      status: "error",
      payload: {
        agentId: route.agentId,
        stage: route.stage,
        providerId: route.providerId,
        modelId: route.modelId,
        requestedModelId: route.requestedModelId,
        remapReason: route.remapReason,
        summary: errorMessage
      }
    });
    await this.appendBroadcastEvent(context2.sessionId, event);
  }
  updateRunSummary(context2, route, response, status) {
    if (!context2.runId) {
      return;
    }
    const existing = this.runSummaries.get(context2.runId) ?? {
      providerId: route.providerId,
      modelId: route.modelId,
      successfulCallCount: 0,
      failedCallCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      firstRequestId: void 0,
      routesUsed: []
    };
    existing.providerId = existing.providerId || route.providerId;
    existing.modelId = existing.modelId || route.modelId;
    if (status === "ok") {
      existing.successfulCallCount += 1;
      if (!existing.firstRequestId && response?.id) {
        existing.firstRequestId = response.id;
      }
      existing.totalInputTokens += response?.usage.inputTokens ?? 0;
      existing.totalOutputTokens += response?.usage.outputTokens ?? 0;
    } else {
      existing.failedCallCount += 1;
    }
    existing.routesUsed.push({
      agentId: route.agentId,
      stage: route.stage,
      providerId: route.providerId,
      modelId: route.modelId,
      requestId: response?.id,
      status
    });
    this.runSummaries.set(context2.runId, existing);
    this.broadcastRunUsage(context2.runId);
  }
  broadcastRunUsage(runId) {
    const usage = this.getRunContextUsage(runId);
    if (!usage) {
      return;
    }
    workflowProjectionPublisher.publishRunUsage(usage);
  }
  async appendBroadcastEvent(sessionId, event) {
    await storageAdapter.appendActionEvent(sessionId, event);
    workflowProjectionPublisher.publishEvidenceEvent(event);
  }
}
const debuggerLlmService = new DebuggerLlmService();
const ASK_READONLY_TOOL_ALLOWLIST = [
  "read_file",
  "glob",
  "grep",
  "task_list",
  "web_fetch",
  "web_search",
  "git_status",
  "git_diff",
  "git_log",
  "tool_search",
  "memory_read"
];
const CANONICAL_TOOL_EXPANSIONS = {
  read: ["read_file"],
  search: ["glob", "grep"],
  web: ["web_fetch", "web_search"],
  git: ["git_status", "git_diff", "git_log", "git_add", "git_unstage", "git_commit"],
  bash: ["bash"],
  write: ["write_file"],
  edit: ["edit_file"],
  askUser: ["ask_user"],
  "vscode/askQuestions": ["ask_user"],
  agent: ["agent_handoff"],
  handoff: ["agent_handoff"],
  task: ["task_create", "task_update", "task_get", "task_list"],
  memory: ["memory_read"],
  planArtifact: ["plan_artifact"],
  artifact: ["plan_artifact"],
  "vscode/memory": ["memory_read"],
  skill: ["skills", "skill_run"],
  skills: ["skills", "skill_run"],
  mcp: ["mcp", "mcp__*"],
  MCP: ["mcp", "mcp__*"],
  tool_search: ["tool_search"],
  rdxContext: ["rdx_context"],
  rdx: ["rdx_context"]
};
const RUNTIME_TOOL_ALIASES = {
  read: "read_file",
  read_file: "read_file",
  search: "grep",
  glob: "glob",
  grep: "grep",
  web: "web_fetch",
  web_fetch: "web_fetch",
  web_search: "web_search",
  git: "git_status",
  git_status: "git_status",
  git_diff: "git_diff",
  git_log: "git_log",
  git_add: "git_add",
  git_unstage: "git_unstage",
  git_commit: "git_commit",
  bash: "bash",
  write: "write_file",
  write_file: "write_file",
  edit: "edit_file",
  edit_file: "edit_file",
  task_create: "task_create",
  task_update: "task_update",
  task_get: "task_get",
  task_list: "task_list",
  askUser: "ask_user",
  ask_user: "ask_user",
  "vscode/askQuestions": "ask_user",
  agent: "agent_handoff",
  handoff: "agent_handoff",
  agent_handoff: "agent_handoff",
  subagent: "subagent",
  memory: "memory_read",
  memory_read: "memory_read",
  memory_write: "memory_write",
  memory_delete: "memory_delete",
  planArtifact: "plan_artifact",
  artifact: "plan_artifact",
  plan_artifact: "plan_artifact",
  "vscode/memory": "memory_read",
  skill: "skills",
  skills: "skills",
  skill_run: "skill_run",
  mcp: "mcp",
  MCP: "mcp",
  rdxContext: "rdx_context",
  rdx: "rdx_context",
  rdx_context: "rdx_context"
};
const ASK_DENIED_TOOL_PREFIXES = ["rd.", "mcp.", "mcp__"];
const ASK_DENIED_TOOLS = /* @__PURE__ */ new Set([
  "bash",
  "write",
  "write_file",
  "edit",
  "edit_file",
  "remove",
  "delete",
  "git_add",
  "git_unstage",
  "git_commit",
  "task_create",
  "task_update",
  "rdx_context"
]);
const EXECUTABLE_AGENT_TOOL_ALLOWLIST = [
  ...ASK_READONLY_TOOL_ALLOWLIST,
  "bash",
  "write_file",
  "edit_file",
  "ask_user",
  "agent_handoff",
  "subagent",
  "task_create",
  "task_update",
  "task_get",
  "task_list",
  "memory_read",
  "memory_write",
  "memory_delete",
  "plan_artifact",
  "skills",
  "skill_run",
  "mcp",
  "mcp__*",
  "rdx_context",
  "git_add",
  "git_unstage",
  "git_commit",
  "tool_search"
];
const SHADER_EDIT_TOOLS = ["rd.shader.edit_and_replace", "rd.macro.shader_hotfix_validate"];
function resolveAgentToolAllowlist(agentId, stage) {
  const settings = settingsService.getAll();
  const runtimeProfile = executionProfileService.resolveAgentRuntimeProfile(settings, stage || "investigate", agentId);
  const manifest = settings.agents.definitions.find((definition) => definition.id === agentId && definition.enabled);
  const profileTools = manifest ? manifest.tools.flatMap(expandCanonicalToolToken) : runtimeProfile.toolAllowlist?.length ? runtimeProfile.toolAllowlist.flatMap(expandCanonicalToolToken) : agentId === "ask" ? ASK_READONLY_TOOL_ALLOWLIST : isTopLevelAgentId(agentId) ? EXECUTABLE_AGENT_TOOL_ALLOWLIST : [];
  if (agentId === "ask") {
    return Array.from(new Set(profileTools.filter((toolName) => !isDeniedAskTool(toolName, normalizeToolName(toolName)))));
  }
  return Array.from(new Set(profileTools));
}
function isToolAllowedForAgent(toolName, agentId, stage) {
  const normalizedToolName = normalizeToolName(toolName);
  if (SHADER_EDIT_TOOLS.includes(normalizedToolName)) {
    return false;
  }
  if (agentId === "ask" && isDeniedAskTool(toolName, normalizedToolName)) {
    return false;
  }
  const allowlist = resolveAgentToolAllowlist(agentId, stage);
  for (const pattern of allowlist) {
    const normalizedPattern = normalizeToolName(pattern);
    if (normalizedPattern === "*" || normalizedPattern === normalizedToolName) {
      return true;
    }
    if (normalizedPattern.endsWith(".*") && normalizedToolName.startsWith(normalizedPattern.slice(0, -1))) {
      return true;
    }
    if (normalizedPattern.endsWith("*") && normalizedToolName.startsWith(normalizedPattern.slice(0, -1))) {
      return true;
    }
  }
  return false;
}
function normalizeToolName(toolName) {
  return RUNTIME_TOOL_ALIASES[toolName] ?? toolName;
}
function expandCanonicalToolToken(toolName) {
  return CANONICAL_TOOL_EXPANSIONS[toolName] ?? [normalizeToolName(toolName)];
}
function isDeniedAskTool(originalToolName, normalizedToolName) {
  if (ASK_DENIED_TOOLS.has(originalToolName) || ASK_DENIED_TOOLS.has(normalizedToolName)) {
    return true;
  }
  return ASK_DENIED_TOOL_PREFIXES.some((prefix) => originalToolName.startsWith(prefix) || normalizedToolName.startsWith(prefix));
}
const charsToTokens = (chars) => Math.ceil(chars / 4);
class AgentOrchestrator {
  agentStates = /* @__PURE__ */ new Map();
  agentConfigs = /* @__PURE__ */ new Map();
  agentSlots = /* @__PURE__ */ new Map();
  mcpManager = new MCPManager();
  connectedMcpServerIds = /* @__PURE__ */ new Set();
  failedMcpServers = /* @__PURE__ */ new Map();
  skillEngine = new SkillEngine();
  memoryStoreInstance = null;
  memoryExtractorInstance = null;
  memoryConsolidatorInstance = null;
  /** 内联提取频率控制：每 N 轮触发一次，避免每轮 LLM 调用开销。 */
  memoryExtractTurnCounter = 0;
  static MEMORY_EXTRACT_INTERVAL = 3;
  /**
   * 当前 turn 的事件下沉（subagent 工具执行时读取，把子 agent 事件桥接到父 trace）。
   * 单进程串行，无并发问题；runAgentTurn 设置，turn 结束清理。
   */
  currentTurnEventSink = null;
  /**
   * 待处理的 handoff 请求（agent_handoff 工具成功时设置，
   * ConversationService turn 结束后 consume，实现 session 级 profile 切换）。
   */
  pendingHandoff = null;
  constructor() {
    this.initializeAgents();
  }
  setMainWindow(_window) {
  }
  initializeAgents() {
    for (const role of AGENT_ROLES) {
      this.ensureAgentState(role);
      this.agentConfigs.set(role, this.createDefaultAgentConfig(role));
    }
  }
  ensureAgentState(agentId) {
    const existing = this.agentStates.get(agentId);
    if (existing) {
      return existing;
    }
    const state2 = {
      agentId,
      status: "idle",
      lastActivity: nowIso$1()
    };
    this.agentStates.set(agentId, state2);
    return state2;
  }
  createDefaultAgentConfig(agentId) {
    const fallbackAgentId = isTopLevelAgentId(agentId) ? agentId : "edit";
    const defaultRouting = DEFAULT_MODEL_ROUTING[fallbackAgentId];
    return {
      agentId,
      systemPrompt: "",
      modelProvider: defaultRouting.provider,
      modelName: defaultRouting.model,
      temperature: 0.7,
      maxTokens: 4096,
      category: this.getAgentCategory(agentId),
      writeScope: this.getAgentWriteScopes(agentId)
    };
  }
  getOrCreateAgentConfig(agentId) {
    this.ensureAgentState(agentId);
    const existing = this.agentConfigs.get(agentId);
    if (existing) {
      return existing;
    }
    const config = this.createDefaultAgentConfig(agentId);
    this.agentConfigs.set(agentId, config);
    return config;
  }
  getAgentCategory(role) {
    return isTopLevelAgentId(role) ? AGENT_CATEGORIES[role] : "general";
  }
  getAgentWriteScopes(role) {
    return isTopLevelAgentId(role) ? AGENT_WRITE_SCOPES[role] : ["workspace_notes"];
  }
  getAgentState(agentId) {
    return this.agentStates.get(agentId) || null;
  }
  getAllAgentStates() {
    return Array.from(this.agentStates.values());
  }
  configureAgent(agentId, config) {
    const existing = this.getOrCreateAgentConfig(agentId);
    this.agentConfigs.set(agentId, { ...existing, ...config });
  }
  getAgentConfig(agentId) {
    return this.agentConfigs.get(agentId) || null;
  }
  applyLlmConfig(config) {
    const routeMap = new Map(config.agentRoutes.map((route) => [route.agentId, route]));
    for (const [agentId, agentConfig] of this.agentConfigs.entries()) {
      const fallbackAgentId = isTopLevelAgentId(agentId) ? agentId : "edit";
      const fallback = DEFAULT_MODEL_ROUTING[fallbackAgentId];
      const route = routeMap.get(agentId);
      this.agentConfigs.set(agentId, {
        ...agentConfig,
        modelProvider: route ? route.providerId : fallback.provider,
        modelName: route ? route.modelId : fallback.model
      });
    }
  }
  getToolsForRole(agentId) {
    return resolveAgentToolAllowlist(agentId);
  }
  isToolAllowedForRole(toolName, agentId) {
    return isToolAllowedForAgent(toolName, agentId);
  }
  // -------------------------------------------------------------------
  // Main entry points: workflow run turn / profile turn.
  // -------------------------------------------------------------------
  async sendMessage(agentId, content, context2, options) {
    const fallbackConfig = this.getOrCreateAgentConfig(agentId);
    this.updateAgentStatus(agentId, "thinking");
    try {
      let runtimeProfile = this.resolveRuntimeProfile(agentId, context2?.stageId);
      await this.refreshAccountRuntimeCredentials(runtimeProfile.providerId);
      runtimeProfile = this.resolveRuntimeProfile(agentId, context2?.stageId);
      const config = {
        ...fallbackConfig,
        systemPrompt: runtimeProfile.systemPrompt,
        modelProvider: runtimeProfile.providerId,
        modelName: runtimeProfile.modelId,
        temperature: runtimeProfile.temperature ?? fallbackConfig.temperature,
        maxTokens: runtimeProfile.maxTokens ?? fallbackConfig.maxTokens
      };
      const systemPrompt = this.systemPromptForAgent(agentId, config.systemPrompt);
      await this.recordMessage(agentId, "user", content, context2);
      const stub = this.createTestModeStub(agentId, content);
      const responseText = stub ? await this.streamTestModeStub(stub, options) : await this.runAgentTurn({
        agentId,
        content,
        systemPrompt,
        providerId: config.modelProvider,
        modelId: config.modelName,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        mode: this.modeForAgent(agentId),
        patternId: this.patternForAgent(agentId),
        stage: context2?.stageId,
        runId: context2?.runId,
        sessionId: context2?.sessionId ?? null,
        turnId: context2?.turnId,
        toolAllowlist: resolveAgentToolAllowlist(agentId, context2?.stageId),
        options,
        projectRootPath: context2?.projectRootPath ?? null,
        projectId: context2?.projectId ?? null
      });
      const finalContent = await this.finalizeRecordedAssistantMessage(
        agentId,
        responseText,
        responseText,
        context2
      );
      this.updateAgentStatus(agentId, "complete");
      return finalContent;
    } catch (error) {
      this.updateAgentStatus(agentId, "error");
      throw error;
    }
  }
  async sendProfileMessage(agentId, content, options) {
    const fallbackConfig = this.getOrCreateAgentConfig(agentId);
    this.updateAgentStatus(agentId, "thinking");
    try {
      let settings = settingsService.getAll();
      let routeMap = new Map(settings.llm.agentRoutes.map((route2) => [route2.agentId, route2]));
      const routeAgentId = options?.routeAgentId ?? agentId;
      let route = routeMap.get(routeAgentId);
      if (route?.providerId) {
        await this.refreshAccountRuntimeCredentials(route.providerId);
        settings = settingsService.getAll();
        routeMap = new Map(settings.llm.agentRoutes.map((entry) => [entry.agentId, entry]));
        route = routeMap.get(routeAgentId);
      }
      const config = {
        ...fallbackConfig,
        modelProvider: route?.providerId || fallbackConfig.modelProvider,
        modelName: route?.modelId || fallbackConfig.modelName,
        systemPrompt: options?.systemPrompt || fallbackConfig.systemPrompt,
        temperature: options?.temperature ?? fallbackConfig.temperature,
        maxTokens: options?.maxTokens ?? fallbackConfig.maxTokens
      };
      if (process.env.RDC_AGENT_TEST_MODE === "1") {
        const finalStub = await this.createProfileTestResponse(agentId, content, options);
        this.updateAgentStatus(agentId, "complete");
        return finalStub;
      }
      const toolAllowlist = resolveAgentToolAllowlist(agentId, options?.stage && options.stage !== "report" ? options.stage : void 0);
      const responseText = await this.runAgentTurn({
        agentId,
        content,
        systemPrompt: this.systemPromptForAgent(agentId, config.systemPrompt),
        providerId: config.modelProvider,
        modelId: config.modelName,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        mode: this.modeForAgent(agentId),
        patternId: options?.patternId ?? this.patternForAgent(agentId),
        stage: options?.stage ?? "investigate",
        runId: void 0,
        sessionId: options?.sessionId ?? null,
        turnId: options?.turnId,
        toolAllowlist,
        options,
        projectRootPath: options?.projectRootPath ?? null,
        projectId: options?.projectId ?? null,
        promptMetrics: options?.promptMetrics
      });
      runtimeLogService.log({
        scope: options?.sessionId ? "session" : "app",
        namespace: "agent",
        severity: "info",
        title: `${this.getAgentDisplayName(agentId)} profile turn`,
        summary: responseText.slice(0, 160) || "Empty message.",
        sessionId: options?.sessionId,
        raw: {
          agentId,
          providerId: config.modelProvider,
          modelId: config.modelName
        }
      });
      this.updateAgentStatus(agentId, "complete");
      return responseText;
    } catch (error) {
      this.updateAgentStatus(agentId, "error");
      throw error;
    }
  }
  // -------------------------------------------------------------------
  // Subagent（串行派生隔离 Context）
  // -------------------------------------------------------------------
  /**
   * 派生子 agent 执行任务（串行，父阻塞等待）。
   *
   * 对标 claude-code AgentTool：独立 context/message thread、filtered tools、
   * 独立 permission context。子 agent 事件桥接为 `subagent.*` 事件上抛父 trace。
   * 结果回传 = 函数返回值（不用 mailbox/队列）。
   *
   * @returns 子 agent 最终 assistant 文本。
   */
  async runSubagent(input) {
    const subagentId = generateEventId("subagent");
    const subagentSessionId = input.parentSessionId ? `${input.parentSessionId}::subagent::${subagentId}` : null;
    input.parentOnEvent?.({
      id: generateEventId("agent-event"),
      type: "subagent.started",
      timestamp: nowMs(),
      sessionId: input.parentSessionId ?? null,
      agentId: input.parentAgentId,
      payload: {
        subagentId,
        profile: input.targetProfile,
        parentToolCallId: input.parentToolCallId,
        text: input.task
      }
    });
    const definition = settingsService.getAll().agents.definitions.find((d) => d.id === input.targetProfile && d.enabled);
    const systemPrompt = definition?.instructions?.trim() || this.systemPromptForAgent(input.targetProfile);
    let resultText = "";
    let resultStatus = "complete";
    try {
      resultText = await this.sendProfileMessage(
        input.targetProfile,
        input.task,
        {
          sessionId: subagentSessionId ?? void 0,
          stage: "investigate",
          patternId: "subagent",
          projectRootPath: input.projectRootPath,
          projectId: input.projectId,
          systemPrompt,
          onEvent: (event) => {
            if (event.type === "assistant.delta") {
              const delta = event.payload;
              if (delta.text) {
                input.parentOnEvent?.({
                  id: generateEventId("agent-event"),
                  type: "subagent.delta",
                  timestamp: nowMs(),
                  sessionId: input.parentSessionId ?? null,
                  agentId: input.parentAgentId,
                  payload: {
                    subagentId,
                    profile: input.targetProfile,
                    parentToolCallId: input.parentToolCallId,
                    text: delta.text
                  }
                });
              }
            }
          }
        }
      );
    } catch (error) {
      resultStatus = "failed";
      resultText = error instanceof Error ? error.message : String(error);
    }
    input.parentOnEvent?.({
      id: generateEventId("agent-event"),
      type: "subagent.completed",
      timestamp: nowMs(),
      sessionId: input.parentSessionId ?? null,
      agentId: input.parentAgentId,
      payload: {
        subagentId,
        profile: input.targetProfile,
        parentToolCallId: input.parentToolCallId,
        text: resultText,
        status: resultStatus
      }
    });
    return resultText;
  }
  /**
   * 创建 subagent 工具（task / agent），注入父 agent 工具集。
   *
   * - `task`：派生通用 explore 子 agent（对标 claude-code Task 工具）。
   * - `agent`：按指定 profile 派生子 agent。
   */
  createSubagentTools(parentAgentId, sessionId) {
    const orchestrator = this;
    const runSubagentTool = {
      name: "subagent",
      label: "Subagent",
      description: 'Delegate a sub-task to an isolated sub-agent. The sub-agent runs to completion (serial, not parallel) and returns its final answer. Use profile to target a specific agent profile (defaults to "ask" read-only).',
      parameters: {
        type: "object",
        required: ["task"],
        properties: {
          task: { type: "string", description: "The task description for the sub-agent." },
          profile: { type: "string", description: 'Target profile id. Defaults to "ask" (read-only).' }
        }
      },
      permissionHint: "readonly",
      async execute(toolCallId, args, _signal) {
        const targetProfile = typeof args.profile === "string" && args.profile.trim() ? args.profile.trim() : "ask";
        const result = await orchestrator.runSubagent({
          parentAgentId,
          parentToolCallId: toolCallId,
          targetProfile,
          task: args.task,
          parentSessionId: sessionId ?? null,
          parentOnEvent: orchestrator.currentTurnEventSink?.onEvent,
          projectRootPath: orchestrator.currentTurnEventSink?.projectRootPath ?? null,
          projectId: orchestrator.currentTurnEventSink?.projectId ?? null
        });
        return {
          content: [{ type: "text", text: result || "(sub-agent returned empty output)" }],
          details: { subagentId: toolCallId, profile: targetProfile, status: "complete" }
        };
      }
    };
    return [runSubagentTool];
  }
  getOrCreateAgentSlot(agentId, providerId, modelId, systemPrompt, tools = [], toolExecutor = this.createToolExecutor(agentId, [], void 0), streamOptions, turnSignature = "", sessionId) {
    const slotKey = this.agentSlotKey(sessionId, agentId);
    const toolSignature = this.createToolSignature(tools);
    const existing = this.agentSlots.get(slotKey);
    if (existing && existing.providerId === providerId && existing.modelId === modelId && existing.systemPrompt === systemPrompt && existing.toolSignature === toolSignature && existing.turnSignature === turnSignature && !existing.agent.isStreaming) {
      return existing;
    }
    const persistedMessages = sessionId ? storageAdapter.readAgentThread(sessionId, agentId) : [];
    const agentModel = encodeAgentModel(providerId, modelId);
    const contextManager = new ContextManager({
      modelId,
      contextTokenLimit: Math.floor(agentModel.contextWindow * 0.75),
      toolResultBudget: 200 * 1024,
      keepRecentToolResults: 3
    });
    const errorRecovery = new ErrorRecovery({ primaryModel: agentModel });
    const agent = new Agent({
      initialState: {
        model: agentModel,
        systemPrompt,
        tools,
        messages: persistedMessages
      },
      provider: configuredRuntimeProvider,
      toolExecutor,
      streamOptions,
      maxTurns: this.resolveMaxTurns(agentId),
      // transformContext：长对话接近窗口上限时自动压缩历史。
      transformContext: (messages) => contextManager.compress(messages, agentModel),
      // errorRecovery：provider 错误后自动恢复（重试/提额/压缩/中止）。
      errorRecovery
    });
    const slot = { agent, contextManager, providerId, modelId, systemPrompt, toolSignature, turnSignature };
    this.agentSlots.set(slotKey, slot);
    return slot;
  }
  /** 复合 slot key：`${sessionId}::${agentId}`，使 Agent 按 session+profile 隔离。 */
  agentSlotKey(sessionId, agentId) {
    return sessionId ? `${sessionId}::${agentId}` : `__no_session__::${agentId}`;
  }
  /**
   * 解析 Agent 的工具执行轮数上限。
   *
   * 优先用 `.agent.md` frontmatter 的 `max-turns`；
   * 未配置时按 profile 默认：edit/debugger/optimizer=50，ask/plan/analyzer=25。
   */
  resolveMaxTurns(agentId) {
    const manifest = settingsService.getAll().agents.definitions.find((definition) => definition.id === agentId && definition.enabled);
    if (manifest?.maxTurns && manifest.maxTurns > 0) {
      return manifest.maxTurns;
    }
    if (agentId === "edit" || agentId === "debugger" || agentId === "optimizer") {
      return 50;
    }
    return 25;
  }
  // =====================================================================
  // Memory 引擎（持久记忆 + 内联提取 + consolidation）
  // =====================================================================
  /** 共享 MemoryStore 单例（懒构造，workspacePath 就绪后实例化）。 */
  get memoryStore() {
    if (!this.memoryStoreInstance) {
      const memoryDir = path__namespace.join(storageAdapter.getWorkspacePath(), ".rdc-agent", "memory");
      this.memoryStoreInstance = new MemoryStore(memoryDir);
    }
    return this.memoryStoreInstance;
  }
  /**
   * 读取 memory 索引内容（MEMORY.md），供 system prompt 注入。
   * 失败时返回空串，不阻塞 prompt 组装。
   */
  async getMemoryIndex() {
    try {
      return await this.memoryStore.getIndexContent();
    } catch {
      return "";
    }
  }
  /** Memory 面板用：列出全部记忆摘要。 */
  async listMemoriesForUi() {
    try {
      const all = await this.memoryStore.listMemories();
      return all.map((m) => ({ name: m.name, description: m.description, type: m.type, updatedAt: m.updatedAt }));
    } catch {
      return [];
    }
  }
  /** Memory 面板用：读取单条记忆详情。 */
  async getMemoryForUi(name) {
    try {
      const record = await this.memoryStore.getMemory(name);
      if (!record) return null;
      return {
        name: record.name,
        description: record.description,
        type: record.type,
        content: record.content,
        tags: record.tags,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      };
    } catch {
      return null;
    }
  }
  /** Memory 面板用：写入记忆。 */
  async writeMemoryForUi(request2) {
    try {
      const record = await this.memoryStore.writeMemory(request2);
      return { success: true, name: record.name };
    } catch (error) {
      return { success: false, name: request2.name, error: error instanceof Error ? error.message : String(error) };
    }
  }
  /** Memory 面板用：删除记忆。 */
  async deleteMemoryForUi(name) {
    try {
      const deleted = await this.memoryStore.deleteMemory(name);
      return { success: deleted };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  /**
   * 消费待处理的 handoff 请求（agent_handoff 工具成功时设置）。
   *
   * ConversationService 在 profile turn 完成后调用：若有 pendingHandoff，
   * emit handoff.requested 事件 + 持久化到 session，下次消息自动用新 profile。
   * 读取后清除（一次性消费）。
   */
  consumePendingHandoff() {
    const handoff = this.pendingHandoff;
    this.pendingHandoff = null;
    return handoff;
  }
  /** 共享 MemoryExtractor（依赖 queryLlm 适配器）。 */
  get memoryExtractor() {
    if (!this.memoryExtractorInstance) {
      this.memoryExtractorInstance = new MemoryExtractor({
        memoryStore: this.memoryStore,
        queryLlm: (prompt) => this.queryLlmForMemory(prompt)
      });
    }
    return this.memoryExtractorInstance;
  }
  /** 共享 MemoryConsolidator（阈值默认 10）。 */
  get memoryConsolidator() {
    if (!this.memoryConsolidatorInstance) {
      this.memoryConsolidatorInstance = new MemoryConsolidator({
        memoryStore: this.memoryStore,
        queryLlm: (prompt) => this.queryLlmForMemory(prompt)
      });
    }
    return this.memoryConsolidatorInstance;
  }
  /**
   * Memory 提取/整合用的 LLM 适配器。
   *
   * 取 ask agent 的 route（或首个 agentRoute）作主模型，
   * 通过 configuredRuntimeProvider.stream 发起单轮非流式调用。
   * 失败时抛错，由 MemoryExtractor/MemoryConsolidator 的 try/catch 兜底返回空结果。
   */
  async queryLlmForMemory(prompt) {
    const settings = settingsService.getAll();
    const route = settings.llm.agentRoutes.find((entry) => entry.agentId === "ask") ?? settings.llm.agentRoutes[0];
    if (!route) {
      throw new Error("No agent route available for memory LLM adapter.");
    }
    const model = encodeAgentModel(route.providerId, route.modelId);
    const stream = configuredRuntimeProvider.stream(model, {
      messages: [{ role: "user", content: prompt, timestamp: Date.now() }]
    });
    const assistant = await stream.result();
    return assistant.content.filter((block) => block.type === "text").map((block) => block.text).join("");
  }
  createToolSignature(tools) {
    return tools.map((tool) => tool.name).sort().join("|");
  }
  resolveRuntimeTools(agentId, toolAllowlist, stage, sessionId) {
    const availableTools = /* @__PURE__ */ new Map();
    for (const tool of getPrimitiveTools()) {
      availableTools.set(normalizeToolName(tool.name), tool);
    }
    for (const tool of this.createTaskRuntimeTools()) {
      availableTools.set(normalizeToolName(tool.name), tool);
    }
    const rdxContextTool = this.createRdxContextTool();
    availableTools.set(rdxContextTool.name, rdxContextTool);
    for (const tool of this.createWorkbenchTools(agentId, sessionId)) {
      availableTools.set(normalizeToolName(tool.name), tool);
    }
    for (const tool of this.mcpManager.getAgentTools()) {
      availableTools.set(normalizeToolName(tool.name), tool);
    }
    const toolSearchTool = createToolSearchTool(() => Array.from(availableTools.values()));
    availableTools.set(normalizeToolName(toolSearchTool.name), toolSearchTool);
    const definitions = [];
    const toolMap = /* @__PURE__ */ new Map();
    for (const tool of availableTools.values()) {
      if (!this.matchesToolAllowlist(tool.name, toolAllowlist)) continue;
      if (!this.isAllowedForRuntime(agentId, tool.name, stage)) continue;
      const normalized = normalizeToolName(tool.name);
      if (!toolMap.has(normalized)) {
        toolMap.set(normalized, tool);
        definitions.push(toolToDefinition(tool));
      }
    }
    return { definitions, toolMap };
  }
  matchesToolAllowlist(toolName, toolAllowlist) {
    const normalizedToolName = normalizeToolName(toolName);
    return toolAllowlist.some((entry) => {
      const normalizedEntry = normalizeToolName(entry);
      if (normalizedEntry === "*" || normalizedEntry === normalizedToolName) {
        return true;
      }
      if (normalizedEntry.endsWith(".*") && normalizedToolName.startsWith(normalizedEntry.slice(0, -1))) {
        return true;
      }
      if (normalizedEntry.endsWith("*") && normalizedToolName.startsWith(normalizedEntry.slice(0, -1))) {
        return true;
      }
      return false;
    });
  }
  createToolExecutor(agentId, toolAllowlist, stage, sessionId, runtimeContext) {
    const tools = this.resolveRuntimeTools(agentId, toolAllowlist, stage, sessionId).toolMap;
    return {
      execute: async (toolCall, signal, onUpdate) => {
        const normalizedName = normalizeToolName(toolCall.name);
        if (!this.isAllowedForRuntime(agentId, toolCall.name, stage) || !tools.has(normalizedName)) {
          return this.createPolicyDeniedToolResult(toolCall, agentId);
        }
        const tool = tools.get(normalizedName);
        if (!tool) {
          return this.createPolicyDeniedToolResult(toolCall, agentId);
        }
        if (normalizedName === "ask_user") {
          return this.executeAskUserTool(toolCall, agentId, runtimeContext, signal);
        }
        const permissionDecision = agentPermissionPolicyService.evaluate({ agentId, tool, toolCall, projectRootPath: runtimeContext?.projectRootPath ?? null });
        if (permissionDecision.action === "deny") {
          return this.createPolicyDeniedToolResult(toolCall, agentId, permissionDecision.reason);
        }
        if (permissionDecision.action === "ask_user") {
          if (!runtimeContext?.eventContext || !runtimeContext.turnId) {
            return this.createApprovalRequiredToolResult(toolCall, agentId, permissionDecision.reason ?? "Tool approval requires an active conversation turn.");
          }
          const approved = await agentToolApprovalRequestService.request({
            agentId,
            sessionId: runtimeContext.sessionId ?? null,
            turnId: runtimeContext.turnId,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            reason: permissionDecision.reason ?? `Tool "${toolCall.name}" requires approval.`,
            risk: permissionDecision.risk,
            context: runtimeContext.eventContext,
            onEvent: runtimeContext.onEvent,
            signal
          });
          if (!approved) {
            return this.createPolicyDeniedToolResult(toolCall, agentId, "User denied this tool call.");
          }
        }
        if (permissionDecision.action === "auto_review") {
          if (!runtimeContext?.eventContext || !runtimeContext.turnId) {
            return this.createPolicyDeniedToolResult(toolCall, agentId, "Auto-review requires an active conversation turn.");
          }
          const approved = agentToolApprovalRequestService.autoReview({
            agentId,
            sessionId: runtimeContext.sessionId ?? null,
            turnId: runtimeContext.turnId,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            reason: permissionDecision.reason ?? `Tool "${toolCall.name}" requires review.`,
            risk: permissionDecision.risk,
            context: runtimeContext.eventContext,
            onEvent: runtimeContext.onEvent,
            signal
          });
          if (!approved) {
            return this.createPolicyDeniedToolResult(toolCall, agentId, "Auto-review denied this tool call.");
          }
        }
        try {
          const projectRootPath = runtimeContext?.projectRootPath ?? null;
          const toolContext = {
            workspaceRoot: projectRootPath ?? getWorkspaceRoot(),
            projectRootPath,
            projectId: runtimeContext?.projectId ?? null,
            sessionId: runtimeContext?.sessionId ?? null
          };
          const result = await withTemporaryPathAccess(
            permissionDecision.temporaryPathRoots,
            () => tool.execute(toolCall.id, toolCall.arguments, signal, onUpdate, toolContext)
          );
          return this.agentToolResultToMessage(toolCall, result);
        } catch (error) {
          return {
            role: "toolResult",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
            isError: true,
            timestamp: Date.now()
          };
        }
      }
    };
  }
  isAllowedForRuntime(agentId, toolName, stage) {
    const workflowStage = stage === "report" ? void 0 : stage;
    return isToolAllowedForAgent(toolName, agentId, workflowStage);
  }
  async executeAskUserTool(toolCall, agentId, runtimeContext, signal) {
    try {
      const args = toolCall.arguments ?? {};
      const question = typeof args.question === "string" && args.question.trim() ? args.question.trim() : "The agent needs user input before continuing.";
      const optionArgs = args.options;
      const rawChoices = Array.isArray(args.choices) ? args.choices : Array.isArray(optionArgs) ? optionArgs : [];
      const options = rawChoices.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
      if (!runtimeContext?.eventContext || !runtimeContext.turnId) {
        throw new Error("ask_user requires an active conversation interaction bridge.");
      }
      const answer = await agentUserInputRequestService.request({
        agentId,
        sessionId: runtimeContext.sessionId ?? null,
        turnId: runtimeContext.turnId,
        toolCallId: toolCall.id,
        question,
        options,
        context: runtimeContext.eventContext,
        onEvent: runtimeContext.onEvent,
        signal
      });
      return {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text: `User answered: ${answer}` }],
        isError: false,
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
        timestamp: Date.now()
      };
    }
  }
  createPolicyDeniedToolResult(toolCall, agentId, reason) {
    return {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{
        type: "text",
        text: reason || `Policy denied tool "${toolCall.name}" for ${agentId}.`
      }],
      isError: true,
      timestamp: Date.now()
    };
  }
  createApprovalRequiredToolResult(toolCall, agentId, reason) {
    return {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{
        type: "text",
        text: `Approval required for tool "${toolCall.name}" before it can run for ${agentId}. ${reason} No changes were made.`
      }],
      isError: true,
      timestamp: Date.now()
    };
  }
  agentToolResultToMessage(toolCall, result) {
    return {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: result.content,
      isError: result.isError === true,
      timestamp: Date.now()
    };
  }
  createTaskRuntimeTools() {
    const isSubagent = this.currentTurnEventSink?.sessionId?.includes("::subagent::") ?? false;
    const store = isSubagent ? new MemoryTaskStore() : new FileTaskStore(path__namespace.join(storageAdapter.getWorkspacePath(), ".tasks"));
    const registry = new TaskRegistry(store);
    registry.onTaskChange = ({ type, task }) => {
      const sink = this.currentTurnEventSink;
      if (!sink?.onEvent) return;
      sink.onEvent({
        id: generateEventId("agent-event"),
        type: type === "created" ? "task.created" : "task.updated",
        timestamp: nowMs(),
        sessionId: sink.sessionId ?? null,
        agentId: sink.agentId,
        payload: {
          taskId: task.id,
          title: task.subject,
          status: task.status
        }
      });
    };
    return createTaskTools(registry);
  }
  createRdxContextTool() {
    return {
      name: "rdx_context",
      label: "RDX Context",
      description: "Read the current stable RDX runtime context captured by configured shell actions.",
      parameters: {
        type: "object",
        properties: {}
      },
      permissionHint: "readonly",
      async execute() {
        const runtimeContext = getRdxRuntimeContext();
        if (!runtimeContext) {
          return {
            content: [{ type: "text", text: "No RDX runtime context is currently available." }],
            details: { available: false }
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(runtimeContext, null, 2) }],
          details: { available: true }
        };
      }
    };
  }
  createWorkbenchTools(agentId, sessionId) {
    return [
      this.createAskUserTool(agentId),
      this.createAgentHandoffTool(agentId),
      this.createMemoryReadTool(sessionId),
      this.createMemoryWriteTool(),
      this.createMemoryDeleteTool(),
      this.createPlanArtifactTool(sessionId),
      this.createSkillsCatalogTool(),
      this.createSkillRunTool(agentId, sessionId),
      this.createMcpCatalogTool(),
      ...this.createSubagentTools(agentId, sessionId)
    ];
  }
  createAskUserTool(agentId) {
    return {
      name: "ask_user",
      label: "Ask User",
      description: "Ask the user for a decision or missing information. Use this when progress depends on user input.",
      parameters: {
        type: "object",
        required: ["question"],
        properties: {
          question: { type: "string", description: "The concise question to ask the user." },
          choices: {
            type: "array",
            items: { type: "string" },
            description: "Optional short mutually exclusive choices."
          }
        }
      },
      permissionHint: "readonly",
      async execute(_toolCallId, args) {
        const question = typeof args.question === "string" && args.question.trim() ? args.question.trim() : "The agent needs user input before continuing.";
        const choices = Array.isArray(args.choices) ? args.choices.filter((entry) => typeof entry === "string" && entry.trim().length > 0) : [];
        return {
          content: [{ type: "text", text: "ask_user requires the conversation interaction bridge." }],
          isError: true,
          details: { agentId, question, choices }
        };
      }
    };
  }
  createAgentHandoffTool(agentId) {
    const orchestrator = this;
    return {
      name: "agent_handoff",
      label: "Agent Handoff",
      description: "Request a handoff to another agent profile. The runtime validates the target against the current profile handoffs and prepares the receiving prompt. The actual profile switch is applied by the orchestrator after this turn.",
      parameters: {
        type: "object",
        required: ["agent"],
        properties: {
          agent: { type: "string", description: "Target agent profile id, such as edit, debugger, analyzer, or optimizer." },
          label: { type: "string", description: "Short handoff label. Defaults to the declared handoff label." },
          prompt: { type: "string", description: "Implementation or specialist prompt for the receiving agent. Defaults to the declared handoff prompt." }
        }
      },
      permissionHint: "readonly",
      async execute(_toolCallId, args) {
        const toProfile = typeof args.agent === "string" ? args.agent.trim() : "";
        const resolved = handoffController.resolve(
          agentId,
          toProfile,
          typeof args.prompt === "string" ? args.prompt : void 0,
          typeof args.label === "string" ? args.label : void 0
        );
        if (!resolved.valid || !resolved.request) {
          return {
            content: [{
              type: "text",
              text: `Handoff rejected: ${resolved.reason ?? "unknown reason"}`
            }],
            isError: true,
            details: { fromAgentId: agentId, toAgentId: toProfile, label: "", prompt: "", valid: false }
          };
        }
        const { toProfile: target, label, prompt } = resolved.request;
        orchestrator.pendingHandoff = {
          fromAgentId: agentId,
          toProfile: target,
          prompt,
          label,
          sessionId: orchestrator.currentTurnEventSink?.sessionId ?? null
        };
        return {
          content: [{
            type: "text",
            text: `Handoff prepared from ${agentId} to ${target}: ${label}
${prompt}`
          }],
          details: { fromAgentId: agentId, toAgentId: target, label, prompt, valid: true }
        };
      }
    };
  }
  createPlanArtifactTool(sessionId) {
    return {
      name: "plan_artifact",
      label: "Write Plan Artifact",
      description: "Write or replace the current session plan artifact. This cannot edit arbitrary workspace files.",
      parameters: {
        type: "object",
        required: ["content"],
        properties: {
          title: { type: "string", description: "Optional plan title." },
          content: { type: "string", description: "Plan content to persist for this session." }
        }
      },
      permissionHint: "session_mutation",
      async execute(_toolCallId, args) {
        if (!sessionId) {
          return {
            content: [{ type: "text", text: "No active session is available for a plan artifact." }],
            isError: true,
            details: { sessionId: null }
          };
        }
        const body = typeof args.content === "string" ? args.content.trim() : "";
        if (!body) {
          return {
            content: [{ type: "text", text: "Plan artifact content is required." }],
            isError: true,
            details: { sessionId }
          };
        }
        const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : "Agent Plan";
        const artifactPath = storageAdapter.writeSessionPlanArtifact(sessionId, `# ${title}

${body}
`);
        return {
          content: [{ type: "text", text: `Plan artifact saved: ${artifactPath}` }],
          details: { sessionId, artifactPath }
        };
      }
    };
  }
  createMemoryReadTool(sessionId) {
    const store = this.memoryStore;
    return {
      name: "memory_read",
      label: "Read Memory",
      description: "Read persisted memories from the workspace memory store. Supports optional name lookup or keyword filter.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Optional exact memory name to read in full." },
          query: { type: "string", description: "Optional case-insensitive filter over name/description/content." },
          limit: { type: "number", description: "Maximum entries to return, default 8." }
        }
      },
      permissionHint: "readonly",
      async execute(_toolCallId, args) {
        const rawLimit = typeof args.limit === "number" && Number.isFinite(args.limit) ? args.limit : 8;
        const limit = Math.max(1, Math.min(20, Math.floor(rawLimit)));
        if (typeof args.name === "string" && args.name.trim()) {
          const record = await store.getMemory(args.name.trim());
          if (!record) {
            return {
              content: [{ type: "text", text: `No memory named "${args.name}" was found.` }],
              details: { sessionId: sessionId ?? null, count: 0 }
            };
          }
          return {
            content: [{
              type: "text",
              text: `# ${record.name}

${record.description}

${record.content}`
            }],
            details: { sessionId: sessionId ?? null, count: 1 }
          };
        }
        const all = await store.listMemories();
        const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
        const candidates = query ? all.filter((entry) => entry.name.toLowerCase().includes(query) || entry.description.toLowerCase().includes(query) || entry.content.toLowerCase().includes(query)) : all;
        const entries = candidates.slice(0, limit).map((entry) => `- ${entry.name} (${entry.type}): ${entry.description}`);
        return {
          content: [{
            type: "text",
            text: entries.length > 0 ? `Memory index (${candidates.length} total):
${entries.join("\n")}` : "No matching memories were found."
          }],
          details: { sessionId: sessionId ?? null, count: entries.length }
        };
      }
    };
  }
  createMemoryWriteTool() {
    const store = this.memoryStore;
    const validTypes = /* @__PURE__ */ new Set(["user", "feedback", "project", "reference"]);
    return {
      name: "memory_write",
      label: "Write Memory",
      description: "Persist a new memory to the workspace memory store. type must be one of: user, feedback, project, reference.",
      parameters: {
        type: "object",
        required: ["name", "description", "type", "content"],
        properties: {
          name: { type: "string", description: "Kebab-case memory name (unique key)." },
          description: { type: "string", description: "One-line summary." },
          type: { type: "string", description: "user | feedback | project | reference" },
          content: { type: "string", description: "Full Markdown body." },
          tags: { type: "array", items: { type: "string" } }
        }
      },
      permissionHint: "mutation",
      async execute(_toolCallId, args) {
        const type = validTypes.has(args.type) ? args.type : "project";
        const record = await store.writeMemory({
          name: args.name.trim(),
          description: args.description.trim(),
          type,
          content: args.content,
          tags: Array.isArray(args.tags) ? args.tags : void 0
        });
        return {
          content: [{ type: "text", text: `Memory saved: ${record.name} (${record.type})` }],
          details: { name: record.name, created: true }
        };
      }
    };
  }
  createMemoryDeleteTool() {
    const store = this.memoryStore;
    return {
      name: "memory_delete",
      label: "Delete Memory",
      description: "Delete a memory by name from the workspace memory store.",
      parameters: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Memory name to delete." }
        }
      },
      permissionHint: "mutation",
      async execute(_toolCallId, args) {
        const deleted = await store.deleteMemory(args.name.trim());
        return {
          content: [{
            type: "text",
            text: deleted ? `Memory deleted: ${args.name}` : `No memory named "${args.name}" was found.`
          }],
          details: { name: args.name, deleted }
        };
      }
    };
  }
  createSkillsCatalogTool() {
    return {
      name: "skills",
      label: "List Skills",
      description: "List reusable skills configured for the current workspace.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional case-insensitive filter." }
        }
      },
      permissionHint: "readonly",
      async execute(_toolCallId, args) {
        const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
        const skills = agentRuntimeConfigService.listSkills().filter((skill) => !query || `${skill.id} ${skill.name} ${skill.label} ${skill.description}`.toLowerCase().includes(query));
        const lines = skills.map((skill) => `${skill.id}: ${skill.label || skill.name} (${skill.source})`);
        return {
          content: [{ type: "text", text: lines.length > 0 ? lines.join("\n") : "No configured skills matched the query." }],
          details: { count: skills.length }
        };
      }
    };
  }
  createSkillRunTool(agentId, sessionId) {
    const orchestrator = this;
    return {
      name: "skill_run",
      label: "Run Skill",
      description: "Execute a configured reusable skill by id or name. Context skills return live workspace/session context.",
      parameters: {
        type: "object",
        required: ["skill_id"],
        properties: {
          skill_id: { type: "string", description: "Skill id or name, for example rdc-context." },
          params: {
            type: "object",
            description: "Skill parameters. Values are converted to strings for prompt skills.",
            additionalProperties: true
          }
        }
      },
      permissionHint: "readonly",
      async execute(_toolCallId, args) {
        const skillKey = typeof args.skill_id === "string" ? args.skill_id.trim() : "";
        if (!skillKey) {
          return {
            content: [{ type: "text", text: "skill_id is required." }],
            isError: true,
            details: { skillId: "", agentId }
          };
        }
        const skills = orchestrator.getAvailableSkillDescriptors();
        const skill = skills.find((entry) => entry.id === skillKey || entry.name === skillKey);
        if (!skill) {
          return {
            content: [{ type: "text", text: `Skill is not configured: ${skillKey}` }],
            isError: true,
            details: { skillId: skillKey, agentId }
          };
        }
        if (skill.id === "rdc-context" || skill.name === "rdc-context") {
          const session = sessionId ? storageAdapter.readSession(sessionId) : null;
          const project = session?.projectId ? storageAdapter.getProjectById(session.projectId) : null;
          const runtimeContext = getRdxRuntimeContext();
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                skill: skill.id,
                agentId,
                session,
                project,
                rdxRuntimeContext: runtimeContext
              }, null, 2)
            }],
            details: { skillId: skill.id, agentId }
          };
        }
        const params = orchestrator.stringifySkillParams(args.params);
        const manifest = {
          name: skill.name,
          description: skill.description,
          type: "prompt",
          promptTemplate: skill.description
        };
        const result = await orchestrator.skillEngine.execute(manifest, params, {
          agentOrchestrator: orchestrator,
          workspaceRoot: storageAdapter.getWorkspacePath(),
          sessionId: sessionId ?? void 0
        });
        return {
          content: [{ type: "text", text: result.message }],
          isError: !result.success,
          details: { skillId: skill.id, agentId }
        };
      }
    };
  }
  createMcpCatalogTool() {
    return {
      name: "mcp",
      label: "List MCP Services",
      description: "List MCP services configured for the current workspace.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional case-insensitive filter." }
        }
      },
      permissionHint: "readonly",
      async execute(_toolCallId, args) {
        const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
        const servers = agentRuntimeConfigService.listMcpServers().filter((server2) => !query || `${server2.id} ${server2.name} ${server2.description}`.toLowerCase().includes(query));
        const lines = servers.map((server2) => `${server2.id}: ${server2.name} (${server2.transport})${server2.enabledByDefault ? "" : " - disabled by default"}`);
        return {
          content: [{ type: "text", text: lines.length > 0 ? lines.join("\n") : "No configured MCP services matched the query." }],
          details: { count: servers.length }
        };
      }
    };
  }
  getAvailableSkillDescriptors() {
    return agentRuntimeConfigService.listSkills();
  }
  stringifySkillParams(params) {
    if (!params) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(params).map(([key, value]) => [
        key,
        typeof value === "string" ? value : JSON.stringify(value)
      ])
    );
  }
  getEnabledMcpDescriptors(agentId) {
    const settings = settingsService.getAll();
    const manifest = settings.agents.definitions.find((entry) => entry.id === agentId && entry.enabled);
    const enabledIds = /* @__PURE__ */ new Set([
      ...settings.configuration.enabledMcpServerIds ?? [],
      ...manifest?.mcpServers ?? []
    ]);
    if (enabledIds.size === 0) {
      return [];
    }
    return agentRuntimeConfigService.listMcpServers().filter((server2) => enabledIds.has(server2.id) || enabledIds.has(server2.name));
  }
  async ensureMcpConnections(agentId) {
    const errors = [];
    for (const descriptor of this.getEnabledMcpDescriptors(agentId)) {
      if (this.connectedMcpServerIds.has(descriptor.id)) {
        continue;
      }
      if (this.failedMcpServers.has(descriptor.id)) {
        errors.push(`${descriptor.id}: ${this.failedMcpServers.get(descriptor.id)}`);
        continue;
      }
      try {
        await this.mcpManager.connect(this.toMcpServerConfig(descriptor));
        this.connectedMcpServerIds.add(descriptor.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.failedMcpServers.set(descriptor.id, message);
        errors.push(`${descriptor.id}: ${message}`);
      }
    }
    return errors;
  }
  toMcpServerConfig(descriptor) {
    return {
      name: descriptor.id,
      type: descriptor.transport,
      command: descriptor.command,
      args: descriptor.args,
      url: descriptor.url,
      env: descriptor.env
    };
  }
  // -------------------------------------------------------------------
  // 单轮 Agent 执行
  // -------------------------------------------------------------------
  async runAgentTurn(input) {
    if (!input.providerId || !input.modelId) {
      throw new Error("No provider/model route is configured for this agent.");
    }
    const settings = settingsService.getAll();
    const routeProvider = settings.llm.providers.find((entry) => entry.id === input.providerId);
    const routeCapability = resolveAgentRouteCapability(routeProvider, input.modelId);
    const mcpConnectionErrors = await this.ensureMcpConnections(input.agentId);
    const runtimeTools = this.resolveRuntimeTools(input.agentId, input.toolAllowlist, input.stage, input.sessionId);
    const activeToolDefinitions = routeCapability.toolCallingMode === "native-structured" ? runtimeTools.definitions : [];
    const activeToolAllowlist = activeToolDefinitions.map((tool) => tool.name);
    const sharedEventContext = {
      agentId: input.agentId,
      runId: input.runId,
      turnId: input.turnId,
      sessionId: input.sessionId ?? null,
      stage: input.stage,
      mode: input.mode,
      patternId: input.patternId,
      providerId: input.providerId,
      modelId: input.modelId,
      toolAllowlist: activeToolAllowlist,
      routeCapability
    };
    this.currentTurnEventSink = {
      onEvent: input.options?.onEvent,
      sessionId: input.sessionId ?? null,
      projectRootPath: input.projectRootPath ?? null,
      projectId: input.projectId ?? null,
      agentId: input.agentId
    };
    const toolExecutor = this.createToolExecutor(input.agentId, activeToolAllowlist, input.stage, input.sessionId, {
      sessionId: input.sessionId ?? null,
      turnId: input.turnId,
      eventContext: sharedEventContext,
      onEvent: input.options?.onEvent,
      projectRootPath: input.projectRootPath ?? null,
      projectId: input.projectId ?? null
    });
    const streamOptions = {
      maxTokens: input.maxTokens,
      temperature: input.temperature,
      reasoningBudget: input.options?.reasoningBudget,
      reasoningVisibility: routeCapability.reasoningVisibility,
      signal: input.options?.signal
    };
    const routeDiagnostic = describeRouteCapabilityDiagnostic(routeCapability, runtimeTools.definitions.length);
    if (mcpConnectionErrors.length > 0) {
      input.options?.onEvent?.(buildDiagnosticAgentEvent(sharedEventContext, {
        code: "mcp_connection_failed",
        severity: "warning",
        message: "One or more configured MCP servers could not be connected. MCP tools are unavailable for this turn.",
        technicalMessage: mcpConnectionErrors.join("\n")
      }));
    }
    if (routeDiagnostic) {
      input.options?.onEvent?.(buildDiagnosticAgentEvent(sharedEventContext, {
        code: "route_tool_calling_unsupported",
        severity: routeCapability.toolCallingMode === "disabled" ? "error" : "warning",
        message: routeDiagnostic,
        technicalMessage: JSON.stringify(routeCapability)
      }));
    }
    const slot = this.getOrCreateAgentSlot(
      input.agentId,
      input.providerId,
      input.modelId,
      input.systemPrompt,
      activeToolDefinitions,
      toolExecutor,
      streamOptions,
      input.turnId ?? "",
      input.sessionId
    );
    const userMessage = {
      role: "user",
      content: input.content,
      timestamp: nowMs()
    };
    let responseText = "";
    let sawStructuredToolCall = false;
    const unsubscribe = slot.agent.subscribe((event) => {
      if (event.type === "message_update") {
        const ev = event.assistantMessageEvent;
        if (ev.type === "text_delta" && typeof ev.delta === "string") {
          input.options?.onChunk?.(ev.delta);
        }
        if (ev.type === "toolcall_end") {
          sawStructuredToolCall = true;
        }
      }
      if (event.type === "message_end" && event.message.role === "assistant") {
        responseText = event.message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
        if (event.message.usage) {
          const isMcpDef = (d) => d.name.startsWith("mcp__");
          const isSubagentDef = (d) => d.name === "subagent";
          const mcpDefs = activeToolDefinitions.filter(isMcpDef);
          const subagentDefs = activeToolDefinitions.filter(isSubagentDef);
          const systemDefs = activeToolDefinitions.filter((d) => !isMcpDef(d) && !isSubagentDef(d));
          const pm = input.promptMetrics;
          const systemPromptChars = pm ? pm.system_prompt : input.systemPrompt.length;
          const rulesChars = pm?.rules ?? 0;
          const memoryChars = pm?.memory_files ?? 0;
          const compressionStats = slot.contextManager.classifyMessages(
            slot.agent.messages
          );
          const precomputedBreakdown = [
            { id: "system_prompt", tokens: charsToTokens(systemPromptChars) },
            ...rulesChars > 0 ? [{ id: "rules", tokens: charsToTokens(rulesChars) }] : [],
            ...memoryChars > 0 ? [{ id: "memory_files", tokens: charsToTokens(memoryChars) }] : [],
            { id: "system_tools", tokens: charsToTokens(JSON.stringify(systemDefs).length), count: systemDefs.length },
            { id: "mcp_tools", tokens: charsToTokens(JSON.stringify(mcpDefs).length), count: mcpDefs.length },
            { id: "subagent_definitions", tokens: charsToTokens(JSON.stringify(subagentDefs).length), count: subagentDefs.length },
            ...compressionStats.summaryTokens > 0 ? [{ id: "summarized_conversation", tokens: compressionStats.summaryTokens }] : [],
            { id: "conversation", tokens: compressionStats.conversationTokens, count: compressionStats.conversationCount }
          ];
          debuggerLlmService.recordAgentTurnUsage({
            runId: input.runId,
            sessionId: input.sessionId,
            providerId: input.providerId,
            modelId: input.modelId,
            inputTokens: event.message.usage.inputTokens,
            outputTokens: event.message.usage.outputTokens,
            precomputedBreakdown
          });
        }
        if (!sawStructuredToolCall && !responseText.trim()) {
          input.options?.onEvent?.(buildDiagnosticAgentEvent(sharedEventContext, {
            code: "empty_response_without_tool_call",
            severity: "warning",
            message: "Provider returned an empty assistant message without a structured tool call."
          }));
        } else if (!sawStructuredToolCall && mentionsTextualToolCall(responseText)) {
          input.options?.onEvent?.(buildDiagnosticAgentEvent(sharedEventContext, {
            code: "textual_tool_call_not_executed",
            severity: "warning",
            message: "The model wrote a textual tool call, but no structured provider tool call was returned. No tool was executed.",
            technicalMessage: responseText.slice(0, 1200)
          }));
        }
      }
      const sharedEvent = translateCoreToSharedAgentEvent(event, sharedEventContext);
      if (sharedEvent) {
        input.options?.onEvent?.(sharedEvent);
      }
    });
    let abortListener = null;
    if (input.options?.signal) {
      if (input.options.signal.aborted) {
        unsubscribe();
        throw new DOMException("Aborted", "AbortError");
      }
      abortListener = () => slot.agent.abort();
      input.options.signal.addEventListener("abort", abortListener, { once: true });
    }
    try {
      await slot.agent.prompt(userMessage);
      return responseText;
    } finally {
      unsubscribe();
      if (abortListener && input.options?.signal) {
        input.options.signal.removeEventListener("abort", abortListener);
      }
      agentUserInputRequestService.cancelTurn(input.turnId);
      agentToolApprovalRequestService.cancelTurn(input.turnId);
      this.currentTurnEventSink = null;
      if (input.sessionId) {
        try {
          storageAdapter.writeAgentThread(input.sessionId, input.agentId, [...slot.agent.messages]);
        } catch (error) {
          console.error(`[AgentOrchestrator] writeAgentThread failed for ${input.sessionId}::${input.agentId}:`, error);
        }
      }
      this.memoryExtractTurnCounter += 1;
      if (this.memoryExtractTurnCounter % AgentOrchestrator.MEMORY_EXTRACT_INTERVAL === 0 && slot.agent.messages.length > 0) {
        void this.extractMemoriesFromTurn(slot.agent.messages).catch((error) => {
          console.error("[AgentOrchestrator] memory extraction failed:", error);
        });
      }
    }
  }
  /**
   * 内联提取：将 turn 的消息转为宽松消息类型喂给 MemoryExtractor，
   * 候选经 dedup 后 writeMemory，再按需触发 consolidation。
   *
   * messages 接收 core AgentMessage（Agent.messages 产物），仅提取 role/content。
   */
  async extractMemoriesFromTurn(messages) {
    const recent = messages.slice(-10).map((msg) => ({
      role: msg.role,
      content: typeof msg.content === "string" ? msg.content : Array.isArray(msg.content) ? msg.content.filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("") : ""
    }));
    const candidates = await this.memoryExtractor.extractFromConversation(recent);
    for (const candidate of candidates) {
      try {
        await this.memoryStore.writeMemory(candidate);
      } catch (error) {
        console.error("[AgentOrchestrator] writeMemory failed for", candidate.name, error);
      }
    }
    try {
      if (await this.memoryConsolidator.shouldConsolidate()) {
        await this.memoryConsolidator.consolidate();
      }
    } catch (error) {
      console.error("[AgentOrchestrator] memory consolidation failed:", error);
    }
  }
  async streamTestModeStub(stub, options) {
    const midpoint = Math.max(1, Math.ceil(stub.length / 2));
    const firstChunk = stub.slice(0, midpoint);
    const secondChunk = stub.slice(midpoint);
    if (firstChunk) {
      options?.onChunk?.(firstChunk);
      await Promise.resolve();
    }
    if (secondChunk) {
      options?.onChunk?.(secondChunk);
      await Promise.resolve();
    }
    return stub;
  }
  // -------------------------------------------------------------------
  // 辅助：profile / system prompt / status
  // -------------------------------------------------------------------
  resolveRuntimeProfile(agentId, stage) {
    const settings = settingsService.getAll();
    return executionProfileService.resolveAgentRuntimeProfile(settings, stage || "investigate", agentId);
  }
  async refreshAccountRuntimeCredentials(providerId) {
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
    if (provider?.authMode !== "account") {
      return;
    }
    await providerAccountAuthService.ensureRuntimeCredentials(providerId);
    const llmConfig = settingsService.getLlmConfig();
    llmAdapter.configure(llmConfig);
    this.applyLlmConfig(llmConfig);
  }
  modeForAgent(agentId) {
    if (agentId === "plan") {
      return "ask";
    }
    return isTopLevelAgentId(agentId) ? agentId : "edit";
  }
  patternForAgent(_agentId) {
    return "free-agent";
  }
  systemPromptForAgent(agentId, prompt) {
    if (prompt) {
      return prompt;
    }
    const topLevelAgentId = isTopLevelAgentId(agentId) ? agentId : null;
    return topLevelAgentId ? `You are the ${AGENT_DISPLAY_NAMES[topLevelAgentId]}. ${AGENT_DESCRIPTIONS[topLevelAgentId]}` : `You are ${agentId}. Follow the active .agent.md profile and report evidence clearly.`;
  }
  getAgentDisplayName(agentId) {
    const definition = settingsService.getAll().agents.definitions.find((entry) => entry.id === agentId);
    return definition?.name || (isTopLevelAgentId(agentId) ? AGENT_DISPLAY_NAMES[agentId] : agentId);
  }
  async finalizeRecordedAssistantMessage(agentId, streamedContent, fallbackContent, context2) {
    const finalContent = streamedContent || fallbackContent;
    await this.recordMessage(agentId, "assistant", finalContent, context2);
    return finalContent;
  }
  updateAgentStatus(agentId, status) {
    const state2 = this.ensureAgentState(agentId);
    if (state2) {
      state2.status = status;
      state2.lastActivity = nowIso$1();
      runtimeLogService.log({
        scope: "app",
        namespace: "agent",
        severity: status === "error" ? "error" : status === "complete" ? "success" : "info",
        title: this.getAgentDisplayName(agentId),
        summary: `Status changed to ${status}.`,
        raw: {
          agentId,
          status
        }
      });
      this.notifyAgentStateChanged(state2);
    }
  }
  async recordMessage(agentId, role, content, context2) {
    if (!context2?.sessionId) return;
    const message = {
      id: generateEventId("msg"),
      agentId,
      role,
      content,
      timestamp: nowMs()
    };
    if (context2.runId) {
      await storageAdapter.appendActionEvent(context2.sessionId, storageAdapter.createActionEvent({
        runId: context2.runId,
        sessionId: context2.sessionId,
        agentId,
        eventType: role === "user" ? "user_message" : role === "assistant" ? "agent_summary" : "system",
        status: role === "system" ? "warning" : "ok",
        turnId: context2.turnId,
        payload: {
          role,
          content,
          message_id: message.id
        }
      }));
    }
    this.notifyMessage(message, context2?.sessionId);
  }
  notifyAgentStateChanged(state2) {
    workflowProjectionPublisher.publishAgentStatus(state2);
  }
  notifyMessage(message, sessionId) {
    runtimeLogService.log({
      scope: sessionId ? "session" : "app",
      namespace: "agent",
      severity: message.role === "system" ? "warning" : "info",
      title: this.getAgentDisplayName(message.agentId),
      summary: message.content.slice(0, 120) || "Empty message.",
      sessionId,
      raw: {
        agentId: message.agentId,
        role: message.role,
        messageId: message.id,
        content: message.content
      },
      timestamp: message.timestamp
    });
    workflowProjectionPublisher.publishAgentMessage(message);
  }
  // -------------------------------------------------------------------
  // 测试模式 / Stub
  // -------------------------------------------------------------------
  createTestModeStub(agentId, content) {
    if (process.env.RDC_AGENT_TEST_MODE !== "1") {
      return null;
    }
    let userMessage = content;
    try {
      const parsed = JSON.parse(content);
      userMessage = parsed.effective_user_message || parsed.user_message || content;
    } catch {
      userMessage = content;
    }
    if (userMessage.includes("__RDC_AGENT_E2E_FORCE_LLM_FAILURE__")) {
      throw new Error("E2E forced profile LLM request failure");
    }
    const lower = userMessage.toLowerCase();
    let stub = agentId === "ask" ? "Ask is ready. I can inspect readonly context, search files or public pages, and explain next steps without starting a Debugger run." : `${this.getAgentDisplayName(agentId)} is ready. Describe the goal and I can use the configured tools for this turn.`;
    if (/ue4|unreal/i.test(userMessage)) {
      stub = "UE4 is Unreal Engine 4, commonly involved in graphics debugging around materials, post-processing, shaders, and render passes.";
    } else if (/hello|hi/i.test(userMessage)) {
      stub = agentId === "ask" ? "Hello. I can clarify the issue, explain capability boundaries, or guide you to open a .rdc capture without starting RenderDoc execution." : "Hello. I can run as a general executable agent using the tools enabled by this agent profile.";
    } else if (/start|execute|debug|analy[sz]e/.test(lower)) {
      stub = "Received. I will handle this as a normal agent turn using the configured tools and runtime context.";
    }
    return stub;
  }
  async createProfileTestResponse(agentId, content, options) {
    let userMessage = content;
    try {
      const parsed = JSON.parse(content);
      userMessage = parsed.effective_user_message || parsed.user_message || content;
    } catch {
      userMessage = content;
    }
    if (userMessage.includes("__RDC_AGENT_E2E_FORCE_LLM_FAILURE__")) {
      throw new Error("E2E forced profile LLM request failure");
    }
    const lower = userMessage.toLowerCase();
    let stub = agentId === "ask" ? "I can inspect readonly context, search files or public pages, explain boundaries, or guide you to open a .rdc capture without starting a Debugger run." : "I can help scope the target and execute configured tools directly within this agent turn.";
    if (/ue4|unreal/i.test(userMessage)) {
      stub = "UE4 is Unreal Engine 4. In RDC-Agent it is usually relevant to render pass, material, post-process, and shader debugging context.";
    } else if (/hello|hi|你好|您好/i.test(userMessage)) {
      stub = agentId === "ask" ? "Hello. I can clarify the issue, explain capability boundaries, or guide you to open a .rdc capture without starting RenderDoc execution." : "Hello. I can run as a general executable agent using the tools enabled by this agent profile.";
    } else if (/start|execute|debug|analy[sz]e/.test(lower)) {
      stub = "Received. I will handle this as a normal agent turn using the configured tools and runtime context.";
    }
    if (agentId === "ask" && userMessage.includes("__RDC_AGENT_E2E_ASK_READONLY_TOOL__")) {
      const toolCallId = generateEventId("e2e-tool");
      this.emitProfileTestEvent("tool.started", {
        toolCallId,
        toolName: "grep",
        args: { pattern: "ConversationService", path: "src/main/conversation" }
      }, options);
      this.emitProfileTestEvent("tool.completed", {
        toolCallId,
        toolName: "grep",
        result: {
          ok: true,
          data: {
            content: [
              {
                type: "text",
                text: "src/main/conversation/ConversationService.ts: Ask readonly trace is visible."
              }
            ]
          },
          artifacts: [],
          duration_ms: 1,
          trace_id: toolCallId
        }
      }, options);
      stub = "I searched the workspace with grep and found the Ask conversation code path. No Debugger run was created.";
    } else if (agentId === "ask" && userMessage.includes("__RDC_AGENT_E2E_ASK_DENY_WRITE__")) {
      const toolCallId = generateEventId("e2e-tool");
      this.emitProfileTestEvent("tool.started", {
        toolCallId,
        toolName: "write_file",
        args: { path: "should-not-exist.txt" }
      }, options);
      this.emitProfileTestEvent("tool.denied", {
        toolCallId,
        toolName: "write_file",
        reason: "Policy denied: ask can only use readonly tools.",
        result: {
          ok: false,
          data: {},
          artifacts: [],
          error: {
            code: "AGENT_TOOL_POLICY_DENIED",
            message: "Policy denied: ask can only use readonly tools.",
            category: "policy"
          },
          duration_ms: 1,
          trace_id: toolCallId
        }
      }, options);
      stub = "I cannot write files in Ask mode. Ask can inspect and search, but mutation requires the appropriate execution flow.";
    }
    const finalStub = stub;
    if (options?.onChunk) {
      const midpoint = Math.max(1, Math.ceil(finalStub.length / 2));
      options.onChunk(finalStub.slice(0, midpoint));
      await Promise.resolve();
      options.onChunk(finalStub.slice(midpoint));
    }
    return finalStub;
  }
  emitProfileTestEvent(type, payload, options) {
    options?.onEvent?.({
      id: generateEventId("agent-event"),
      type,
      timestamp: nowMs(),
      turnId: options.turnId,
      sessionId: options.sessionId ?? null,
      stage: options.stage,
      payload
    });
  }
}
const agentOrchestrator = new AgentOrchestrator();
class RunScopedStore {
  getRunRoot(sessionId, runId) {
    return storageAdapter.getRunPath(sessionId, runId);
  }
  readJson(sessionId, runId, relativePath, fallback) {
    const filePath = this.resolveRunPath(sessionId, runId, relativePath);
    if (!fs__namespace.existsSync(filePath)) {
      return fallback;
    }
    try {
      return JSON.parse(fs__namespace.readFileSync(filePath, "utf-8"));
    } catch (error) {
      console.error(`[RunScopedStore] Failed to read ${filePath}`, error);
      return fallback;
    }
  }
  writeJson(sessionId, runId, relativePath, data) {
    const filePath = this.resolveRunPath(sessionId, runId, relativePath);
    fs__namespace.mkdirSync(path__namespace.dirname(filePath), { recursive: true });
    fs__namespace.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    return filePath;
  }
  readJsonl(sessionId, runId, relativePath) {
    return readJsonl(this.resolveRunPath(sessionId, runId, relativePath));
  }
  writeJsonl(sessionId, runId, relativePath, items) {
    const filePath = this.resolveRunPath(sessionId, runId, relativePath);
    writeJsonl(filePath, items);
    return filePath;
  }
  appendJsonl(sessionId, runId, relativePath, item) {
    const items = this.readJsonl(sessionId, runId, relativePath);
    items.push(item);
    return this.writeJsonl(sessionId, runId, relativePath, items);
  }
  resolveRunPath(sessionId, runId, relativePath) {
    const runRoot = this.getRunRoot(sessionId, runId);
    const targetPath = path__namespace.resolve(runRoot, relativePath);
    if (!this.isPathInside(runRoot, targetPath)) {
      throw new Error(`Run-scoped write escaped run directory: ${relativePath}`);
    }
    return targetPath;
  }
  isPathInside(rootPath, targetPath) {
    const relative = path__namespace.relative(path__namespace.resolve(rootPath), path__namespace.resolve(targetPath));
    return relative === "" || !relative.startsWith("..") && !path__namespace.isAbsolute(relative);
  }
}
const runScopedStore = new RunScopedStore();
const STORE_PATH = "artifact_store.json";
class ArtifactStore {
  read(sessionId, runId) {
    return runScopedStore.readJson(
      sessionId,
      runId,
      STORE_PATH,
      {
        schemaVersion: "1",
        runId,
        sessionId,
        artifacts: [],
        updatedAt: nowIso$1()
      }
    );
  }
  list(sessionId, runId) {
    return this.read(sessionId, runId).artifacts;
  }
  get(sessionId, runId, artifactId) {
    return this.list(sessionId, runId).find((artifact) => artifact.artifactId === artifactId) ?? null;
  }
  register(sessionId, runId, record) {
    this.assertRunBinding(sessionId, runId, record);
    const scopedPath = this.resolveArtifactPath(sessionId, runId, record.filePath);
    const stat = fs__namespace.existsSync(scopedPath) ? fs__namespace.statSync(scopedPath) : null;
    const now = nowIso$1();
    const nextRecord = {
      ...record,
      filePath: scopedPath,
      sizeBytes: stat?.size ?? record.sizeBytes,
      createdAt: record.createdAt || now,
      updatedAt: now
    };
    const snapshot = this.read(sessionId, runId);
    const existingIndex = snapshot.artifacts.findIndex((artifact) => artifact.artifactId === record.artifactId);
    const artifacts = [...snapshot.artifacts];
    if (existingIndex >= 0) {
      artifacts[existingIndex] = {
        ...artifacts[existingIndex],
        ...nextRecord,
        createdAt: artifacts[existingIndex].createdAt
      };
    } else {
      artifacts.push(nextRecord);
    }
    this.write({
      ...snapshot,
      artifacts,
      updatedAt: now
    });
    return existingIndex >= 0 ? artifacts[existingIndex] : nextRecord;
  }
  write(snapshot) {
    runScopedStore.writeJson(snapshot.sessionId, snapshot.runId, STORE_PATH, snapshot);
  }
  resolveArtifactPath(sessionId, runId, filePath) {
    const runRoot = runScopedStore.getRunRoot(sessionId, runId);
    const resolvedPath = path__namespace.isAbsolute(filePath) ? path__namespace.resolve(filePath) : path__namespace.resolve(runRoot, "artifacts", filePath);
    if (!runScopedStore.isPathInside(runRoot, resolvedPath)) {
      throw new Error(`Artifact path escaped run directory: ${filePath}`);
    }
    return resolvedPath;
  }
  assertRunBinding(sessionId, runId, value) {
    if (value.sessionId !== sessionId || value.runId !== runId) {
      throw new Error(`Run binding mismatch for ${value.sessionId}/${value.runId}`);
    }
  }
}
const artifactStore = new ArtifactStore();
const EVIDENCE_PATH = "evidence-ledger.jsonl";
const VERIFICATION_PATH = "verification_results.jsonl";
class EvidenceLedger {
  appendEvidence(sessionId, runId, record) {
    this.assertRunBinding(sessionId, runId, record);
    const nextRecord = {
      ...record,
      createdAt: record.createdAt || nowIso$1()
    };
    runScopedStore.appendJsonl(sessionId, runId, EVIDENCE_PATH, nextRecord);
    return nextRecord;
  }
  listEvidence(sessionId, runId) {
    return runScopedStore.readJsonl(sessionId, runId, EVIDENCE_PATH);
  }
  findEvidence(sessionId, runId, evidenceId) {
    return this.listEvidence(sessionId, runId).find((record) => record.evidenceId === evidenceId) ?? null;
  }
  appendVerificationResult(sessionId, runId, result) {
    this.assertRunBinding(sessionId, runId, result);
    const nextResult = {
      ...result,
      createdAt: result.createdAt || nowIso$1()
    };
    runScopedStore.appendJsonl(sessionId, runId, VERIFICATION_PATH, nextResult);
    return nextResult;
  }
  listVerificationResults(sessionId, runId) {
    return runScopedStore.readJsonl(sessionId, runId, VERIFICATION_PATH);
  }
  assertRunBinding(sessionId, runId, value) {
    if (value.sessionId !== sessionId || value.runId !== runId) {
      throw new Error(`Run binding mismatch for ${value.sessionId}/${value.runId}`);
    }
  }
}
const evidenceLedger = new EvidenceLedger();
const BOARD_PATH = "task-board.json";
class TaskBoard {
  read(sessionId, runId) {
    return runScopedStore.readJson(
      sessionId,
      runId,
      BOARD_PATH,
      {
        schemaVersion: "1",
        runId,
        sessionId,
        tasks: [],
        mutations: [],
        updatedAt: nowIso$1()
      }
    );
  }
  listTasks(sessionId, runId) {
    return this.read(sessionId, runId).tasks;
  }
  getTask(sessionId, runId, taskId) {
    return this.read(sessionId, runId).tasks.find((task) => task.taskId === taskId) ?? null;
  }
  upsertTask(sessionId, runId, task) {
    this.assertRunBinding(sessionId, runId, task);
    const snapshot = this.read(sessionId, runId);
    const existingIndex = snapshot.tasks.findIndex((item) => item.taskId === task.taskId);
    const nextTask = {
      ...task,
      updatedAt: nowIso$1()
    };
    const tasks = [...snapshot.tasks];
    if (existingIndex >= 0) {
      tasks[existingIndex] = {
        ...tasks[existingIndex],
        ...nextTask,
        createdAt: tasks[existingIndex].createdAt
      };
    } else {
      tasks.push(nextTask);
    }
    this.write({
      ...snapshot,
      tasks,
      updatedAt: nowIso$1()
    });
    return existingIndex >= 0 ? tasks[existingIndex] : nextTask;
  }
  mutateTask(sessionId, runId, mutation) {
    this.assertRunBinding(sessionId, runId, mutation);
    const snapshot = this.read(sessionId, runId);
    const task = snapshot.tasks.find((item) => item.taskId === mutation.taskId);
    if (!task) {
      throw new Error(`Harness task not found: ${mutation.taskId}`);
    }
    const updatedTask = {
      ...task,
      ...mutation.patch,
      taskId: task.taskId,
      runId,
      sessionId,
      createdAt: task.createdAt,
      updatedAt: nowIso$1(),
      completedAt: mutation.patch.status === "completed" ? nowIso$1() : mutation.patch.completedAt
    };
    this.write({
      ...snapshot,
      tasks: snapshot.tasks.map((item) => item.taskId === task.taskId ? updatedTask : item),
      mutations: [
        ...snapshot.mutations,
        {
          ...mutation,
          mutationId: mutation.mutationId || generateEventId("task-mutation"),
          reason: mutation.reason,
          createdAt: mutation.createdAt || nowIso$1()
        }
      ],
      updatedAt: nowIso$1()
    });
    return updatedTask;
  }
  write(snapshot) {
    runScopedStore.writeJson(snapshot.sessionId, snapshot.runId, BOARD_PATH, snapshot);
  }
  assertRunBinding(sessionId, runId, value) {
    if (value.sessionId !== sessionId || value.runId !== runId) {
      throw new Error(`Run binding mismatch for ${value.sessionId}/${value.runId}`);
    }
  }
}
const taskBoard = new TaskBoard();
const PLAN_PATH = "plan_contract.json";
const CONTEXT_PACKETS_PATH = "context_packets.jsonl";
const RESULT_CARDS_PATH = "agent_result_cards.jsonl";
const CAPSULE_PATH = "run_capsule.json";
class ContextService {
  readPlanContract(sessionId, runId) {
    return runScopedStore.readJson(sessionId, runId, PLAN_PATH, null);
  }
  writePlanContract(sessionId, runId, contract) {
    this.assertRunBinding(sessionId, runId, contract);
    const nextContract = {
      ...contract,
      updatedAt: nowIso$1()
    };
    runScopedStore.writeJson(sessionId, runId, PLAN_PATH, nextContract);
    return nextContract;
  }
  appendContextPacket(sessionId, runId, packet) {
    this.assertRunBinding(sessionId, runId, packet);
    const nextPacket = {
      ...packet,
      packetId: packet.packetId || generateEventId("context-packet"),
      createdAt: packet.createdAt || nowIso$1()
    };
    runScopedStore.appendJsonl(sessionId, runId, CONTEXT_PACKETS_PATH, nextPacket);
    return nextPacket;
  }
  listContextPackets(sessionId, runId) {
    return runScopedStore.readJsonl(sessionId, runId, CONTEXT_PACKETS_PATH);
  }
  appendAgentResultCard(sessionId, runId, card) {
    this.assertRunBinding(sessionId, runId, card);
    const now = nowIso$1();
    const nextCard = {
      ...card,
      cardId: card.cardId || generateEventId("agent-result-card"),
      createdAt: card.createdAt || now,
      updatedAt: now
    };
    runScopedStore.appendJsonl(sessionId, runId, RESULT_CARDS_PATH, nextCard);
    return nextCard;
  }
  listAgentResultCards(sessionId, runId) {
    return runScopedStore.readJsonl(sessionId, runId, RESULT_CARDS_PATH);
  }
  buildRunCapsule(sessionId, runId) {
    const now = nowIso$1();
    return {
      schemaVersion: "1",
      capsuleId: generateEventId("run-capsule"),
      runId,
      sessionId,
      planContract: this.readPlanContract(sessionId, runId) ?? void 0,
      contextPackets: this.listContextPackets(sessionId, runId),
      tasks: taskBoard.listTasks(sessionId, runId),
      evidence: evidenceLedger.listEvidence(sessionId, runId),
      artifacts: artifactStore.list(sessionId, runId),
      verificationResults: evidenceLedger.listVerificationResults(sessionId, runId),
      agentResultCards: this.listAgentResultCards(sessionId, runId),
      createdAt: now,
      updatedAt: now
    };
  }
  writeRunCapsule(sessionId, runId) {
    const capsule = this.buildRunCapsule(sessionId, runId);
    runScopedStore.writeJson(sessionId, runId, CAPSULE_PATH, capsule);
    return capsule;
  }
  assertRunBinding(sessionId, runId, value) {
    if (value.sessionId !== sessionId || value.runId !== runId) {
      throw new Error(`Run binding mismatch for ${value.sessionId}/${value.runId}`);
    }
  }
}
const contextService = new ContextService();
const STORE_FILE = "agentic-trace-state.json";
const defaultState = (sessionId) => ({
  schemaVersion: "1",
  sessionId,
  activeBranchId: "branch-main",
  userRequests: [],
  branches: [],
  plans: [],
  updatedAt: nowIso$1()
});
class TraceStateStore {
  read(sessionId) {
    const filePath = this.resolvePath(sessionId);
    if (!fs__namespace.existsSync(filePath)) {
      return defaultState(sessionId);
    }
    try {
      const parsed = JSON.parse(fs__namespace.readFileSync(filePath, "utf-8"));
      return {
        ...defaultState(sessionId),
        ...parsed,
        sessionId,
        userRequests: parsed.userRequests ?? [],
        branches: parsed.branches ?? [],
        plans: parsed.plans ?? []
      };
    } catch (error) {
      console.error(`[TraceStateStore] Failed to read ${filePath}`, error);
      return defaultState(sessionId);
    }
  }
  write(state2) {
    const filePath = this.resolvePath(state2.sessionId);
    const nextState = {
      ...state2,
      updatedAt: nowIso$1()
    };
    fs__namespace.mkdirSync(path__namespace.dirname(filePath), { recursive: true });
    fs__namespace.writeFileSync(filePath, JSON.stringify(nextState, null, 2), "utf-8");
    return nextState;
  }
  ensureRunRequest(input) {
    const state2 = this.read(input.sessionId);
    if (state2.userRequests.some((request22) => request22.revisions.some((revision2) => revision2.resultingTraceLaneIds.includes(input.traceLaneId)))) {
      return state2;
    }
    const requestId = `request-${input.runId}`;
    const revisionId = `revision-${input.runId}`;
    const branchId = state2.activeBranchId || "branch-main";
    const createdAt = nowIso$1();
    const revision = {
      id: revisionId,
      requestId,
      branchId,
      prompt: input.prompt,
      createdAt,
      resultingTraceLaneIds: [input.traceLaneId]
    };
    const request2 = {
      id: requestId,
      sessionId: input.sessionId,
      rootRevisionId: revisionId,
      activeRevisionId: revisionId,
      revisions: [revision]
    };
    const branch = {
      id: branchId,
      revisionId,
      status: "active",
      traceLaneIds: [input.traceLaneId]
    };
    const group = {
      id: `branch-group-${requestId}`,
      rootRequestId: requestId,
      activeBranchId: branchId,
      branches: [branch]
    };
    return this.write({
      ...state2,
      activeBranchId: branchId,
      userRequests: [...state2.userRequests, request2],
      branches: [...state2.branches, group],
      plans: input.planId ? this.upsertPlan(state2.plans, {
        planId: input.planId,
        runId: input.runId,
        traceLaneId: input.traceLaneId,
        status: "awaiting_approval",
        createdAt,
        updatedAt: createdAt
      }) : state2.plans,
      latestDisplayedPlanId: input.planId ?? state2.latestDisplayedPlanId
    });
  }
  markPlan(sessionId, planId, status) {
    const state2 = this.read(sessionId);
    const now = nowIso$1();
    return this.write({
      ...state2,
      latestDisplayedPlanId: status === "awaiting_approval" ? planId : state2.latestDisplayedPlanId,
      latestAcceptedPlanId: status === "accepted" ? planId : state2.latestAcceptedPlanId,
      plans: state2.plans.map((plan) => plan.planId === planId ? { ...plan, status, updatedAt: now } : plan)
    });
  }
  registerPlan(input) {
    const state2 = this.read(input.sessionId);
    const now = nowIso$1();
    return this.write({
      ...state2,
      latestDisplayedPlanId: input.status === "awaiting_approval" ? input.planId : state2.latestDisplayedPlanId,
      latestAcceptedPlanId: input.status === "accepted" ? input.planId : state2.latestAcceptedPlanId,
      plans: this.upsertPlan(state2.plans, {
        planId: input.planId,
        runId: input.runId,
        traceLaneId: input.traceLaneId,
        status: input.status,
        createdAt: now,
        updatedAt: now
      })
    });
  }
  createRevision(input) {
    const state2 = this.read(input.sessionId);
    const branchGroup = state2.branches[0];
    const rootRequest = state2.userRequests[0];
    const createdAt = nowIso$1();
    const branchId = generateEventId("branch");
    const revisionId = generateEventId("revision");
    const requestId = rootRequest?.id ?? `request-${input.runId}`;
    const parentRevisionId = rootRequest?.activeRevisionId;
    const revision = {
      id: revisionId,
      requestId,
      branchId,
      parentRevisionId,
      prompt: input.revisionText,
      createdAt,
      resultingTraceLaneIds: [input.revisionTraceLaneId]
    };
    const nextRequest = rootRequest ? {
      ...rootRequest,
      activeRevisionId: revisionId,
      revisions: [...rootRequest.revisions, revision]
    } : {
      id: requestId,
      sessionId: input.sessionId,
      rootRevisionId: revisionId,
      activeRevisionId: revisionId,
      revisions: [revision]
    };
    const nextBranch = {
      id: branchId,
      parentBranchId: state2.activeBranchId,
      revisionId,
      status: "active",
      traceLaneIds: [input.revisionTraceLaneId]
    };
    const nextBranchGroup = branchGroup ? {
      ...branchGroup,
      activeBranchId: branchId,
      branches: branchGroup.branches.map((branch) => branch.id === state2.activeBranchId ? { ...branch, status: "inactive" } : branch).concat(nextBranch)
    } : {
      id: `branch-group-${requestId}`,
      rootRequestId: requestId,
      activeBranchId: branchId,
      branches: [nextBranch]
    };
    return this.write({
      ...state2,
      activeBranchId: branchId,
      latestDisplayedPlanId: void 0,
      userRequests: rootRequest ? state2.userRequests.map((request2) => request2.id === rootRequest.id ? nextRequest : request2) : [...state2.userRequests, nextRequest],
      branches: branchGroup ? state2.branches.map((group) => group.id === branchGroup.id ? nextBranchGroup : group) : [...state2.branches, nextBranchGroup],
      plans: state2.plans.map((plan) => plan.planId === input.previousPlanId ? { ...plan, status: "needs_revision", updatedAt: createdAt } : plan)
    });
  }
  switchBranch(sessionId, branchId) {
    const state2 = this.read(sessionId);
    const hasBranch = state2.branches.some((group) => group.branches.some((branch) => branch.id === branchId));
    if (!hasBranch) {
      return state2;
    }
    return this.write({
      ...state2,
      activeBranchId: branchId,
      branches: state2.branches.map((group) => ({
        ...group,
        activeBranchId: group.branches.some((branch) => branch.id === branchId) ? branchId : group.activeBranchId,
        branches: group.branches.map((branch) => ({
          ...branch,
          status: branch.id === branchId ? "active" : branch.status === "active" ? "inactive" : branch.status
        }))
      }))
    });
  }
  upsertPlan(plans, plan) {
    const index = plans.findIndex((entry) => entry.planId === plan.planId);
    if (index < 0) {
      return [...plans, plan];
    }
    const next = [...plans];
    next[index] = {
      ...next[index],
      ...plan,
      createdAt: next[index].createdAt
    };
    return next;
  }
  resolvePath(sessionId) {
    const session = storageAdapter.readSession(sessionId);
    if (!session) {
      throw new Error(`Session not found for trace state: ${sessionId}`);
    }
    const targetPath = path__namespace.resolve(session.sessionPath, STORE_FILE);
    if (!runScopedStore.isPathInside(session.sessionPath, targetPath)) {
      throw new Error(`Trace state escaped session directory: ${targetPath}`);
    }
    return targetPath;
  }
}
const traceStateStore = new TraceStateStore();
class TraceRunStore {
  runsDir;
  constructor(traceRoot) {
    this.runsDir = path.join(traceRoot, "runs");
    fs.mkdirSync(this.runsDir, { recursive: true });
  }
  runPath(runId) {
    return path.join(this.runsDir, `${runId}.json`);
  }
  save(run) {
    fs.writeFileSync(this.runPath(run.runId), JSON.stringify(run, null, 2), "utf-8");
  }
  get(runId) {
    const file = this.runPath(runId);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  }
  list() {
    if (!fs.existsSync(this.runsDir)) return [];
    return fs.readdirSync(this.runsDir).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(fs.readFileSync(path.join(this.runsDir, name), "utf-8"))).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }
}
class TraceEventStore {
  eventsDir;
  seqCounters = /* @__PURE__ */ new Map();
  constructor(traceRoot) {
    this.eventsDir = path.join(traceRoot, "events");
    fs.mkdirSync(this.eventsDir, { recursive: true });
  }
  eventsPath(runId) {
    return path.join(this.eventsDir, `${runId}.jsonl`);
  }
  nextSeq(runId) {
    const current = this.seqCounters.get(runId);
    if (current !== void 0) {
      const next = current + 1;
      this.seqCounters.set(runId, next);
      return next;
    }
    const events = this.getEvents(runId);
    const seq = events.length > 0 ? Math.max(...events.map((e) => e.seq)) + 1 : 1;
    this.seqCounters.set(runId, seq);
    return seq;
  }
  append(runId, type, payload, visibility = "user") {
    const event = {
      eventId: generateEventId("trace"),
      runId,
      seq: this.nextSeq(runId),
      timestamp: nowIso$1(),
      type,
      payload,
      visibility
    };
    appendJsonl(this.eventsPath(runId), event);
    return event;
  }
  getEvents(runId, afterSeq = 0) {
    return readJsonl(this.eventsPath(runId)).filter((event) => event.seq > afterSeq).sort((a, b) => a.seq - b.seq);
  }
  exportRun(runId) {
    const runStore = new TraceRunStore(path.dirname(this.eventsDir));
    return {
      run: runStore.get(runId),
      events: this.getEvents(runId)
    };
  }
  replaceEvents(runId, events) {
    writeJsonl(this.eventsPath(runId), events);
    this.seqCounters.set(runId, events.length > 0 ? Math.max(...events.map((e) => e.seq)) : 0);
  }
}
const PRIMITIVE_MANIFESTS = [
  {
    toolName: "file.read",
    displayName: "读取文件",
    category: "file",
    renderer: { key: "tool.file.read", defaultCollapsed: true, supportsPreview: true, supportsRawJson: true }
  },
  {
    toolName: "bash",
    displayName: "运行命令",
    category: "shell",
    renderer: { key: "tool.shell.run", defaultCollapsed: false, supportsPreview: true, supportsRawJson: true },
    safety: { requiresApproval: true, riskLevel: "medium", redactedFields: ["env", "token", "secret"] }
  },
  {
    toolName: "grep",
    displayName: "搜索内容",
    category: "code",
    renderer: { key: "tool.code.search", defaultCollapsed: true, supportsPreview: true, supportsRawJson: true }
  },
  {
    toolName: "glob",
    displayName: "搜索文件",
    category: "file",
    renderer: { key: "tool.file.search", defaultCollapsed: true, supportsPreview: true, supportsRawJson: true }
  }
];
const categoryFromNamespace = (toolName) => {
  if (toolName.startsWith("rd.capture.") || toolName.startsWith("rd.replay.")) return "domain";
  if (toolName.startsWith("rd.pipeline.") || toolName.startsWith("rd.event.")) return "domain";
  if (toolName.startsWith("rd.texture.") || toolName.startsWith("rd.shader.")) return "domain";
  if (toolName.startsWith("rd.")) return "domain";
  return "unknown";
};
const displayNameFromTool = (toolName, description) => {
  if (description) {
    const short = description.split(/[。.!?\n]/)[0]?.trim();
    if (short && short.length <= 32) return short;
  }
  const segment = toolName.split(".").pop() || toolName;
  return segment.replace(/_/g, " ");
};
class ToolManifestRegistry {
  manifests = /* @__PURE__ */ new Map();
  constructor() {
    for (const manifest of PRIMITIVE_MANIFESTS) {
      this.manifests.set(manifest.toolName, manifest);
    }
  }
  loadFromCatalog(catalogPath) {
    if (!fs.existsSync(catalogPath)) return;
    const raw = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
    for (const tool of raw.tools ?? []) {
      if (this.manifests.has(tool.name)) continue;
      this.manifests.set(tool.name, {
        toolName: tool.name,
        displayName: displayNameFromTool(tool.name, tool.description),
        category: categoryFromNamespace(tool.name),
        description: tool.description,
        renderer: {
          key: "tool.domain.rd",
          defaultCollapsed: true,
          supportsPreview: true,
          supportsRawJson: true,
          supportsArtifacts: true
        }
      });
    }
  }
  get(toolName) {
    return this.manifests.get(toolName) ?? {
      toolName,
      displayName: displayNameFromTool(toolName),
      category: categoryFromNamespace(toolName),
      renderer: {
        key: "tool.unknown",
        defaultCollapsed: true,
        supportsPreview: true,
        supportsRawJson: true
      }
    };
  }
  list() {
    return [...this.manifests.values()];
  }
}
const toolManifestRegistry = new ToolManifestRegistry();
const firstLine$1 = (value, fallback) => {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  return text.trim().split(/\r?\n/)[0]?.trim() || fallback;
};
class ToolResultNormalizer {
  fromToolCallResult(toolName, result) {
    const data = result.data;
    const summary = result.ok ? firstLine$1(data, `${toolName} 完成`) : firstLine$1(result.error?.message ?? result.error, `${toolName} 失败`);
    if (typeof data === "string") {
      return { summary, preview: { kind: "text", text: data }, raw: result };
    }
    if (data && typeof data === "object") {
      const record = data;
      if (typeof record.stdout === "string" || typeof record.stderr === "string") {
        return {
          summary,
          preview: {
            kind: "log",
            stdout: String(record.stdout ?? ""),
            stderr: String(record.stderr ?? ""),
            exitCode: typeof record.exitCode === "number" ? record.exitCode : void 0
          },
          raw: result
        };
      }
      if (typeof record.code === "string") {
        return {
          summary,
          preview: {
            kind: "code",
            code: record.code,
            language: typeof record.language === "string" ? record.language : void 0,
            path: typeof record.path === "string" ? record.path : void 0
          },
          raw: result
        };
      }
      return { summary, preview: { kind: "json", value: data }, raw: result };
    }
    return { summary, raw: result };
  }
  fromActionEvent(event) {
    const toolName = String(event.payload.tool_name || event.payload.toolName || "tool");
    const summary = firstLine$1(
      event.payload.summary ?? event.payload.result ?? event.payload.error ?? event.payload.data,
      toolName
    );
    const payload = event.payload;
    if (typeof payload.data === "string") {
      return { summary, preview: { kind: "text", text: payload.data }, raw: payload };
    }
    if (payload.data && typeof payload.data === "object") {
      return { summary, preview: { kind: "json", value: payload.data }, raw: payload };
    }
    return { summary, preview: { kind: "text", text: summary }, raw: payload };
  }
}
const toolResultNormalizer = new ToolResultNormalizer();
const toIso$1 = (value, fallback = nowIso$1()) => {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  return fallback;
};
const traceStatusFromAction = (event) => {
  if (event.status === "error" || event.status === "fail" || event.status === "timeout") return "failed";
  if (event.status === "sent" || event.status === "entered") return "running";
  if (event.status === "blocked") return "skipped";
  return "succeeded";
};
const parseReasoningPacket = (text) => {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.content) return parsed;
  } catch {
    return null;
  }
  return null;
};
class TraceEventEmitter {
  constructor(store) {
    this.store = store;
  }
  store;
  emitPhaseStarted(runId, phaseId, title) {
    return this.store.append(runId, "phase.started", { phaseId, title });
  }
  emitPhaseCompleted(runId, phaseId) {
    return this.store.append(runId, "phase.completed", { phaseId });
  }
  emitTaskFrame(runId, userRequest, constraints) {
    const node = {
      id: generateEventId("task"),
      runId,
      kind: "task_frame",
      title: "本次任务",
      userRequest,
      constraints,
      seq: 0,
      createdAt: nowIso$1(),
      visibility: "user",
      status: "succeeded"
    };
    return this.store.append(runId, "node.created", node);
  }
  emitThoughtFromText(runId, text, nodeId) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const packet = parseReasoningPacket(trimmed);
    const node = {
      id: nodeId ?? generateEventId("thought"),
      runId,
      kind: "thought_summary",
      mode: packet?.mode,
      intent: packet?.content ?? trimmed,
      rationale: packet?.hypothesis,
      nextAction: packet?.nextAction,
      confidence: packet?.confidence,
      seq: 0,
      createdAt: nowIso$1(),
      visibility: "user",
      status: "succeeded"
    };
    return this.store.append(runId, "node.created", node);
  }
  emitToolFromActionEvent(runId, event) {
    const toolName = String(event.payload.tool_name || event.payload.toolName || "tool");
    const manifest = toolManifestRegistry.get(toolName);
    const normalized = toolResultNormalizer.fromActionEvent(event);
    const node = {
      id: event.event_id,
      runId,
      kind: "tool_action",
      toolCallId: event.event_id,
      toolName,
      displayName: manifest.displayName,
      category: manifest.category,
      purpose: typeof event.payload.purpose === "string" ? event.payload.purpose : void 0,
      inputPreview: typeof event.payload.target === "string" ? event.payload.target : void 0,
      outputPreview: normalized.summary,
      preview: normalized.preview,
      rawInput: event.payload,
      rawOutput: normalized.raw,
      durationMs: event.duration_ms,
      status: traceStatusFromAction(event),
      seq: 0,
      createdAt: toIso$1(event.ts_ms),
      visibility: "user"
    };
    const type = node.status === "failed" ? "tool.failed" : "tool.completed";
    const traceEvent = this.store.append(runId, type, node);
    if (normalized.observations?.length) {
      for (const obs of normalized.observations) {
        this.store.append(runId, "node.created", { ...obs, runId });
      }
    }
    return traceEvent;
  }
  emitSubAgent(runId, event) {
    const node = {
      id: event.event_id,
      runId,
      kind: "sub_agent",
      subRunId: String(event.payload.subRunId || event.event_id),
      agentName: String(event.payload.targetAgent || event.agent_id || "Sub Agent"),
      title: String(event.payload.targetAgent || event.agent_id || "子 Agent"),
      inputSummary: typeof event.payload.objective === "string" ? event.payload.objective : void 0,
      status: traceStatusFromAction(event),
      seq: 0,
      createdAt: toIso$1(event.ts_ms),
      visibility: "user"
    };
    return this.store.append(runId, "node.created", node);
  }
  emitFinalResponse(runId, content, format = "markdown") {
    const node = {
      id: generateEventId("final"),
      runId,
      kind: "final_response",
      content,
      format,
      seq: 0,
      createdAt: nowIso$1(),
      visibility: "user",
      status: "succeeded"
    };
    return this.store.append(runId, "run.completed", node);
  }
  emitObservation(runId, title, facts) {
    const node = {
      id: generateEventId("obs"),
      runId,
      kind: "observation",
      title,
      facts,
      seq: 0,
      createdAt: nowIso$1(),
      visibility: "user",
      status: "succeeded"
    };
    return this.store.append(runId, "node.created", node);
  }
  emitFromAgentEvent(runId, event) {
    if (event.type === "assistant.completed") {
      const payload = event.payload;
      return payload.text ? this.emitThoughtFromText(runId, payload.text) : null;
    }
    if (event.type === "tool.completed") {
      const payload = event.payload;
      if (!payload.toolName) return null;
      const manifest = toolManifestRegistry.get(payload.toolName);
      const node = {
        id: event.id,
        runId,
        kind: "tool_action",
        toolCallId: event.id,
        toolName: payload.toolName,
        displayName: manifest.displayName,
        category: manifest.category,
        outputPreview: typeof payload.result?.data === "string" ? payload.result.data.slice(0, 120) : void 0,
        status: payload.result?.ok === false ? "failed" : "succeeded",
        seq: 0,
        createdAt: toIso$1(event.timestamp),
        visibility: "user"
      };
      return this.store.append(runId, "tool.completed", node);
    }
    if (event.type === "run.failed") {
      const payload = event.payload;
      const node = {
        id: generateEventId("error"),
        runId,
        kind: "error",
        title: "执行失败",
        message: payload.error || "未知错误",
        recoverable: true,
        seq: 0,
        createdAt: toIso$1(event.timestamp),
        visibility: "user",
        status: "failed"
      };
      return this.store.append(runId, "run.failed", node);
    }
    return null;
  }
  /**
   * 处理 Agent Runtime 核心 AgentEvent（来自 `agent-runtime/core/types`）。
   * 该方法与 {@link emitFromAgentEvent} 分别服务 core runtime 与 shared IPC event 输入。
   *
   * 映射规则：
   *  - `tool_execution_start` → `node.created` + `ToolActionNode (running)`
   *  - `tool_execution_end`   → `tool.completed` 或 `tool.failed` + `ToolActionNode`
   *  - `message_end`(assistant) → 若包含 text 则 emit `ThoughtSummaryNode`
   *  - `error`                 → `run.failed` + `ErrorNode`
   *  - `agent_end`             → 不直接 emit（最终回复由 Workflow 层 emitFinalResponse 决定）
   *  - 其他 lifecycle 事件（agent_start/turn_start/turn_end/message_start/
   *    message_update/tool_execution_update/context_compact）当前不落 trace，
   *    保持 JSONL 体积稳定。
   */
  emitFromCoreAgentEvent(runId, event) {
    if (event.type === "tool_execution_start") {
      return this.emitCoreToolStarted(runId, event.toolCallId, event.toolName, event.args);
    }
    if (event.type === "tool_execution_end") {
      return this.emitCoreToolCompleted(
        runId,
        event.toolCallId,
        event.toolName,
        event.result,
        event.durationMs
      );
    }
    if (event.type === "message_end") {
      if (event.message.role !== "assistant") return null;
      const text = this.extractAssistantText(event.message);
      return text ? this.emitThoughtFromText(runId, text) : null;
    }
    if (event.type === "error") {
      const node = {
        id: generateEventId("error"),
        runId,
        kind: "error",
        title: "执行失败",
        message: event.error?.message || "未知错误",
        recoverable: true,
        seq: 0,
        createdAt: nowIso$1(),
        visibility: "user",
        status: "failed"
      };
      return this.store.append(runId, "run.failed", node);
    }
    return null;
  }
  emitCoreToolStarted(runId, toolCallId, toolName, args) {
    const manifest = toolManifestRegistry.get(toolName);
    const node = {
      id: toolCallId,
      runId,
      kind: "tool_action",
      toolCallId,
      toolName,
      displayName: manifest.displayName,
      category: manifest.category,
      inputPreview: this.previewJson(args, 200),
      rawInput: args,
      status: "running",
      seq: 0,
      createdAt: nowIso$1(),
      visibility: "user"
    };
    return this.store.append(runId, "node.created", node);
  }
  emitCoreToolCompleted(runId, toolCallId, toolName, result, durationMs) {
    const manifest = toolManifestRegistry.get(toolName);
    const failed = Boolean(result.isError);
    const node = {
      id: toolCallId,
      runId,
      kind: "tool_action",
      toolCallId,
      toolName,
      displayName: manifest.displayName,
      category: manifest.category,
      outputPreview: this.previewJson(result.content, 200),
      rawOutput: result.content,
      durationMs,
      status: failed ? "failed" : "succeeded",
      seq: 0,
      createdAt: nowIso$1(),
      visibility: "user"
    };
    const type = failed ? "tool.failed" : "tool.completed";
    return this.store.append(runId, type, node);
  }
  extractAssistantText(message) {
    const content = message?.content;
    if (!Array.isArray(content)) return "";
    const parts = [];
    for (const block of content) {
      if (block && typeof block === "object" && block.type === "text") {
        const text = block.text;
        if (typeof text === "string") parts.push(text);
      }
    }
    return parts.join("").trim();
  }
  previewJson(value, max) {
    if (value == null) return void 0;
    try {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return text.length > max ? `${text.slice(0, max)}…` : text;
    } catch {
      return void 0;
    }
  }
  synthesizeFromConversation(runId, messages) {
    const events = [];
    for (const message of messages) {
      if (message.role === "assistant" && message.content.trim()) {
        const evt = this.emitThoughtFromText(runId, message.content);
        if (evt) events.push(evt);
      }
    }
    return events;
  }
}
const isTraceNode = (payload) => typeof payload === "object" && payload !== null && "kind" in payload && "id" in payload;
class TraceTreeBuilder {
  build(events, profile) {
    const nodes = [];
    let currentPhase = null;
    let seq = 0;
    const pushNode = (node, parentId) => {
      const withMeta = {
        ...node,
        seq: seq++,
        parentId: node.parentId,
        visibility: node.visibility ?? "user"
      };
      if (currentPhase && node.kind !== "phase_group" && node.kind !== "task_frame") {
        currentPhase.children.push(withMeta);
      } else {
        nodes.push(withMeta);
      }
    };
    const openPhase = (phaseId, title) => {
      if (currentPhase) {
        currentPhase.status = "succeeded";
        nodes.push(currentPhase);
      }
      currentPhase = {
        id: generateEventId("phase"),
        runId: events[0]?.runId ?? "",
        kind: "phase_group",
        title,
        phase: profile.phases.find((p) => p.phaseId === phaseId)?.phaseId ?? "custom",
        children: [],
        status: "running",
        seq: seq++,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        visibility: "user"
      };
    };
    const closePhase = () => {
      if (currentPhase) {
        currentPhase.status = "succeeded";
        nodes.push(currentPhase);
        currentPhase = null;
      }
    };
    for (const event of events) {
      if (event.visibility === "internal") continue;
      if (event.type === "phase.started") {
        const payload = event.payload;
        openPhase(payload.phaseId ?? "custom", payload.title ?? "执行阶段");
        continue;
      }
      if (event.type === "phase.completed") {
        closePhase();
        continue;
      }
      if (event.type === "node.created" || event.type === "node.updated") {
        if (isTraceNode(event.payload)) {
          const node = event.payload;
          if (node.kind === "phase_group") {
            closePhase();
            currentPhase = { ...node, children: node.kind === "phase_group" ? node.children : [] };
            continue;
          }
          pushNode(node);
        }
        continue;
      }
      if (event.type === "tool.started" || event.type === "tool.completed" || event.type === "tool.failed") {
        if (isTraceNode(event.payload)) {
          pushNode(event.payload);
        }
        continue;
      }
      if (event.type === "run.failed" || event.type === "run.cancelled") {
        if (isTraceNode(event.payload)) {
          pushNode(event.payload);
        }
        continue;
      }
      if (event.type === "run.completed") {
        closePhase();
        if (isTraceNode(event.payload)) {
          pushNode(event.payload);
        }
      }
    }
    closePhase();
    return nodes;
  }
  flatten(nodes) {
    const result = [];
    const walk2 = (node) => {
      result.push(node);
      if (node.kind === "phase_group") {
        for (const child of node.children) {
          walk2(child);
        }
      }
      if (node.kind === "sub_agent" && node.children) {
        for (const child of node.children ?? []) {
          walk2(child);
        }
      }
    };
    for (const node of nodes) walk2(node);
    return result;
  }
}
const traceTreeBuilder = new TraceTreeBuilder();
const rendererForNode = (node, manifest) => {
  switch (node.kind) {
    case "task_frame":
      return "task_frame";
    case "thought_summary":
      return "thought_summary";
    case "plan":
      return "plan";
    case "phase_group":
      return "phase_group";
    case "tool_action":
      return manifest?.renderer.key ?? `tool.${node.category}`;
    case "observation":
      return "observation";
    case "finding":
      return "finding";
    case "artifact":
      return `artifact.${node.artifactKind}`;
    case "approval":
      return "approval";
    case "error":
      return "error";
    case "sub_agent":
      return "sub_agent";
    case "final_response":
      return "final_response";
    default:
      return "unknown";
  }
};
const titleForNode = (node) => {
  switch (node.kind) {
    case "task_frame":
      return node.title || "本次任务";
    case "thought_summary":
      return node.intent.slice(0, 80);
    case "tool_action":
      return node.displayName;
    case "plan":
      return node.title || "执行计划";
    case "phase_group":
      return node.title;
    case "observation":
      return node.title;
    case "finding":
      return node.title;
    case "artifact":
      return node.title;
    case "approval":
      return node.title;
    case "error":
      return node.title;
    case "sub_agent":
      return node.title;
    case "final_response":
      return "最终回答";
    default:
      return node.kind;
  }
};
const projectChild = (node, profile, collapsedRun) => {
  const manifest = node.kind === "tool_action" ? toolManifestRegistry.get(node.toolName) : void 0;
  const timelineNode = {
    nodeId: node.id,
    sourceNodeIds: [node.id],
    renderer: rendererForNode(node, manifest),
    title: titleForNode(node),
    status: node.kind === "approval" ? node.status === "approved" ? "succeeded" : node.status === "rejected" ? "failed" : "waiting_approval" : node.status,
    collapsedByDefault: node.kind === "tool_action" ? manifest?.renderer.defaultCollapsed ?? true : node.kind === "thought_summary" ? collapsedRun : false,
    importance: node.kind === "task_frame" || node.kind === "final_response" ? "high" : "normal",
    payload: node
  };
  if (node.kind === "phase_group") {
    const phase = node;
    timelineNode.children = phase.children.map((child) => projectChild(child, profile, collapsedRun));
    timelineNode.collapsedByDefault = collapsedRun || (profile.phases.find((p) => p.phaseId === phase.phase)?.defaultCollapsed ?? false);
  }
  return timelineNode;
};
class ProjectionBuilder {
  build(run, nodes, profile) {
    const collapsedRun = run.status === "succeeded" || run.status === "failed" || run.status === "cancelled";
    const timelineNodes = nodes.filter((node) => node.kind !== "phase_group" || node.children.length > 0).map((node) => projectChild(node, profile, collapsedRun));
    return {
      runId: run.runId,
      title: run.title ?? run.userRequest.slice(0, 60),
      status: run.status,
      nodes: timelineNodes
    };
  }
}
const projectionBuilder = new ProjectionBuilder();
const BASELINE_PHASES = [
  { phaseId: "understand", displayName: "理解任务" },
  { phaseId: "work", displayName: "执行工作" },
  { phaseId: "summarize", displayName: "总结结果" }
];
const PLAN_PHASES = [
  { phaseId: "understand", displayName: "理解目标" },
  { phaseId: "research", displayName: "研究约束" },
  { phaseId: "handoff", displayName: "准备交接" }
];
const createTraceAgentProfile = (agentId) => ({
  agentType: agentId,
  displayName: AGENT_DISPLAY_NAMES[agentId],
  description: AGENT_DESCRIPTIONS[agentId],
  version: "1.0.0",
  phases: agentId === "plan" ? PLAN_PHASES : BASELINE_PHASES,
  tools: [],
  ui: {
    defaultLayout: "timeline",
    showPlanByDefault: agentId === "plan",
    showThoughtSummaryByDefault: false,
    showRawToolName: false,
    defaultCollapseLevel: "summary"
  }
});
const TRACE_AGENT_PROFILES = AGENT_ROLES.map((agentId) => [
  agentId,
  createTraceAgentProfile(agentId)
]);
class AgentProfileRegistry {
  profiles = new Map(TRACE_AGENT_PROFILES);
  get(agentType) {
    return this.profiles.get(agentType) ?? createTraceAgentProfile("debugger");
  }
  getForMode(mode) {
    return this.get(mode);
  }
}
const agentProfileRegistry = new AgentProfileRegistry();
const toIso = (value, fallback = nowIso$1()) => {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  return fallback;
};
const firstLine = (value, fallback) => {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  return text.trim().split(/\r?\n/)[0]?.trim() || fallback;
};
const runStatusFromSummary = (run, planStatus) => {
  if (planStatus === "awaiting_approval" || run.status === "awaiting_approval") return "waiting_approval";
  if (run.status === "failed" || run.status === "interrupted") return "failed";
  if (run.status === "cancelled") return "cancelled";
  if (run.status === "completed") return "succeeded";
  return "running";
};
const mapRunPlanStatus = (run) => {
  if (run.status === "failed" || run.status === "interrupted") return "failed";
  if (run.status === "completed") return "executed";
  if (run.status === "awaiting_approval") return "awaiting_approval";
  return "accepted";
};
const progressStatusFromTask = (task) => {
  if (task.status === "in_progress") return "running";
  if (task.status === "completed") return "completed";
  if (task.status === "blocked" || task.status === "rejected") return "blocked";
  if (task.status === "cancelled") return "cancelled";
  return "pending";
};
const artifactTypeFromRecord = (record) => {
  if (record.kind === "report") return "report";
  if (record.kind === "screenshot") return "visual_report";
  if (record.kind === "trace" || record.kind === "data") return "evidence_bundle";
  return "other";
};
class TraceService {
  traceRoot;
  runStore;
  eventStore;
  emitter;
  constructor() {
    this.traceRoot = path.join(appPathService.getWorkspaceRoot(), ".rdc-agent", "trace");
    this.runStore = new TraceRunStore(this.traceRoot);
    this.eventStore = new TraceEventStore(this.traceRoot);
    this.emitter = new TraceEventEmitter(this.eventStore);
  }
  getRun(runId) {
    return this.runStore.get(runId);
  }
  getEvents(runId, afterSeq = 0) {
    return this.eventStore.getEvents(runId, afterSeq);
  }
  exportRun(runId) {
    return this.eventStore.exportRun(runId);
  }
  async getSession(sessionId) {
    try {
      const session = storageAdapter.readSession(sessionId);
      if (!session) {
        return { success: false, error: `Session not found: ${sessionId}` };
      }
      const presentation = await this.buildPresentation(sessionId);
      return { success: true, presentation };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  async buildPresentation(sessionId) {
    const state2 = traceStateStore.read(sessionId);
    const conversations = storageAdapter.readConversationHistory(sessionId);
    const events = await storageAdapter.readActionChain(sessionId);
    return this.buildPresentationFromData(
      sessionId,
      storageAdapter.listRuns(sessionId),
      conversations,
      events,
      state2
    );
  }
  async buildPresentationFromData(sessionId, runs, conversations, events, state2) {
    const runViewModels = [];
    const progress = [];
    const artifacts = [];
    const context2 = [];
    const rawAuditRefs = events.slice(-20).map((event) => ({
      id: event.event_id,
      label: event.event_type,
      eventId: event.event_id,
      runId: event.run_id,
      sessionId,
      ref: `raw-${event.event_id}`
    }));
    let mode = "ask";
    for (const run of runs) {
      const runEvents = events.filter((e) => e.run_id === run.runId).sort((a, b) => a.ts_ms - b.ts_ms);
      const planStatus = mapRunPlanStatus(run);
      const branchId = state2.activeBranchId || "branch-main";
      const agentType = run.mode ?? "debugger";
      mode = agentType;
      const profile = agentProfileRegistry.getForMode(agentType);
      const userPrompt = this.userPromptForRun(conversations, run.runId) || runEvents.find((e) => e.event_type === "user_message")?.payload?.content || "调试任务";
      const runId = run.runId;
      let agentRun = this.runStore.get(runId);
      if (!agentRun) {
        agentRun = {
          runId,
          agentType,
          userRequest: String(userPrompt),
          status: runStatusFromSummary(run, planStatus),
          createdAt: toIso(run.startedAt),
          updatedAt: toIso(run.finishedAt ?? run.startedAt)
        };
        this.runStore.save(agentRun);
      } else {
        agentRun.status = runStatusFromSummary(run, planStatus);
        agentRun.updatedAt = toIso(run.finishedAt ?? Date.now());
        this.runStore.save(agentRun);
      }
      const existingRunEvents = this.eventStore.getEvents(runId);
      const existingNodeIds = new Set(
        existingRunEvents.flatMap((traceEvent) => {
          const ids = [];
          if (traceEvent.type === "run.completed") ids.push(`__final__:${runId}`);
          const payloadId = traceEvent.payload?.id;
          if (payloadId) ids.push(payloadId);
          return ids;
        })
      );
      const existingPhaseStarts = new Set(
        existingRunEvents.filter((traceEvent) => traceEvent.type === "phase.started").map((traceEvent) => traceEvent.payload.phaseId).filter((phaseId) => Boolean(phaseId))
      );
      const existingPhaseCompletions = new Set(
        existingRunEvents.filter((traceEvent) => traceEvent.type === "phase.completed").map((traceEvent) => traceEvent.payload.phaseId).filter((phaseId) => Boolean(phaseId))
      );
      const phaseTitle = (phaseId) => profile.phases.find((phase) => phase.phaseId === phaseId)?.displayName ?? phaseId;
      const startPhase = (phaseId) => {
        if (existingPhaseStarts.has(phaseId)) return;
        this.emitter.emitPhaseStarted(runId, phaseId, phaseTitle(phaseId));
        existingPhaseStarts.add(phaseId);
      };
      const completePhase = (phaseId) => {
        if (!existingPhaseStarts.has(phaseId) || existingPhaseCompletions.has(phaseId)) return;
        this.emitter.emitPhaseCompleted(runId, phaseId);
        existingPhaseCompletions.add(phaseId);
      };
      const hasTaskFrame = existingRunEvents.some(
        (traceEvent) => traceEvent.payload?.kind === "task_frame"
      );
      if (!hasTaskFrame) {
        this.emitter.emitTaskFrame(runId, String(userPrompt));
      }
      startPhase("understand");
      for (const msg of conversations.filter((m) => m.runId === runId && m.role === "assistant")) {
        const thoughtId = `thought-${msg.id}`;
        if (msg.content.trim() && !existingNodeIds.has(thoughtId)) {
          this.emitter.emitThoughtFromText(runId, msg.content, thoughtId);
          existingNodeIds.add(thoughtId);
        }
      }
      for (const event of runEvents) {
        if (existingNodeIds.has(event.event_id)) continue;
        if (event.event_type === "tool_execution") {
          completePhase("understand");
          completePhase("plan");
          startPhase("execute");
          this.emitter.emitToolFromActionEvent(runId, event);
        } else if (event.event_type === "dispatch") {
          completePhase("understand");
          completePhase("plan");
          startPhase("execute");
          this.emitter.emitSubAgent(runId, event);
        } else if (event.event_type === "agent_summary") {
          completePhase("understand");
          completePhase("plan");
          startPhase("execute");
          this.emitter.emitThoughtFromText(runId, String(event.payload.summary || event.payload.content || ""));
        }
        existingNodeIds.add(event.event_id);
      }
      const finalContent = this.finalContentForRun(run, runEvents, conversations, runId);
      if (finalContent && !existingNodeIds.has(`__final__:${runId}`)) {
        completePhase("understand");
        completePhase("plan");
        completePhase("execute");
        startPhase("summarize");
        this.emitter.emitFinalResponse(runId, finalContent);
        completePhase("summarize");
        existingNodeIds.add(`__final__:${runId}`);
      }
      const traceEvents = this.eventStore.getEvents(runId);
      const nodes = traceTreeBuilder.build(traceEvents, profile);
      const timeline = projectionBuilder.build(agentRun, nodes, profile);
      runViewModels.push({ run: agentRun, timeline });
      const traceExecutionId = `ws-${runId}-execution`;
      progress.push(...this.mapProgress(sessionId, runId, branchId, traceExecutionId));
      artifacts.push(...this.mapArtifacts(sessionId, runId, branchId, traceExecutionId, runEvents));
      context2.push(...this.mapContext(sessionId, runId, branchId, traceExecutionId, run));
    }
    for (const turn of this.groupAskTurns(conversations)) {
      if (turn.messages.some((m) => m.runId)) continue;
      const runId = `ask-${turn.turnId}`;
      const userPrompt = turn.userMessage?.content.trim() || "Ask";
      const assistant = turn.assistantMessages.slice(-1)[0];
      const status = assistant?.status === "error" ? "failed" : assistant?.status === "stopped" ? "cancelled" : !assistant || assistant.status === "streaming" || assistant.status === "draft" ? "running" : "succeeded";
      let agentRun = this.runStore.get(runId) ?? {
        runId,
        agentType: "ask",
        userRequest: userPrompt,
        status,
        createdAt: toIso(turn.createdAt),
        updatedAt: toIso(turn.completedAt)
      };
      agentRun.status = status;
      this.runStore.save(agentRun);
      const existingAskEvents = this.eventStore.getEvents(runId);
      const existingAskNodeIds = new Set(
        existingAskEvents.flatMap((traceEvent) => {
          const ids = [];
          if (traceEvent.type === "run.completed") ids.push(`__final__:${runId}`);
          const payloadId = traceEvent.payload?.id;
          if (payloadId) ids.push(payloadId);
          return ids;
        })
      );
      const hasAskTaskFrame = existingAskEvents.some(
        (traceEvent) => traceEvent.payload?.kind === "task_frame"
      );
      if (!hasAskTaskFrame) {
        this.emitter.emitTaskFrame(runId, userPrompt);
      }
      for (const msg of turn.assistantMessages) {
        const thoughtId = `thought-${msg.id}`;
        if (msg.content.trim() && !existingAskNodeIds.has(thoughtId)) {
          this.emitter.emitThoughtFromText(runId, msg.content, thoughtId);
          existingAskNodeIds.add(thoughtId);
        }
      }
      if (assistant?.content.trim() && !existingAskNodeIds.has(`__final__:${runId}`) && status !== "running") {
        this.emitter.emitFinalResponse(runId, assistant.content);
      }
      const profile = agentProfileRegistry.get("ask");
      const nodes = traceTreeBuilder.build(this.eventStore.getEvents(runId), profile);
      runViewModels.push({
        run: agentRun,
        timeline: projectionBuilder.build(agentRun, nodes, profile)
      });
    }
    const rightPanel = this.buildRightPanel(progress, artifacts, context2, runViewModels);
    return {
      sessionId,
      activeBranchId: state2.activeBranchId || "branch-main",
      mode,
      runs: runViewModels.sort((a, b) => Date.parse(a.run.createdAt) - Date.parse(b.run.createdAt)),
      rightPanel,
      branchNavigator: null,
      rawAuditRefs,
      updatedAt: nowIso$1()
    };
  }
  async buildConversationPresentation(sessionId, conversations) {
    const state2 = storageAdapter.readSession(sessionId) ? traceStateStore.read(sessionId) : {
      schemaVersion: "1",
      sessionId,
      activeBranchId: "branch-main",
      userRequests: [],
      branches: [],
      plans: [],
      updatedAt: nowIso$1()
    };
    const events = [];
    return this.buildPresentationFromData(sessionId, [], conversations, events, state2);
  }
  userPromptForRun(conversations, runId) {
    const userMsg = conversations.find((m) => m.runId === runId && m.role === "user");
    return userMsg?.content.trim();
  }
  finalContentForRun(run, events, conversations, runId) {
    if (run.status === "awaiting_approval") {
      return null;
    }
    if (run.status === "completed") {
      const report = events.find((e) => e.event_type === "report_published");
      if (report) return firstLine(report.payload.summary, "调试执行已完成，报告已生成。");
      const assistant = conversations.filter((m) => m.runId === runId && m.role === "assistant").slice(-1)[0];
      if (assistant?.content.trim()) return assistant.content;
      return "调试执行已完成。";
    }
    if (run.status === "failed" || run.status === "interrupted") {
      return "执行失败，请查看错误详情与 raw trace。";
    }
    if (run.status === "cancelled") return "任务已取消。";
    return null;
  }
  mapProgress(sessionId, runId, branchId, traceLaneId) {
    return taskBoard.listTasks(sessionId, runId).map((task, index) => ({
      id: task.taskId,
      sessionId,
      traceLaneId,
      branchId,
      title: task.title,
      status: progressStatusFromTask(task),
      order: index,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
      source: task.source === "plan" ? "plan" : "runtime",
      linkedEventIds: task.evidenceRefs,
      blockerSummary: task.blockerRefs.join(", ") || void 0
    }));
  }
  mapArtifacts(sessionId, runId, branchId, traceLaneId, runEvents) {
    const registered = artifactStore.list(sessionId, runId).map((record) => ({
      id: record.artifactId,
      sessionId,
      traceLaneId,
      branchId,
      sourceEventId: record.evidenceIds[0],
      type: artifactTypeFromRecord(record),
      status: "ready",
      displayName: record.title,
      taskTitle: record.taskId,
      path: record.filePath,
      rawRef: `artifact:${record.artifactId}`,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    }));
    const reports = runEvents.filter((e) => e.event_type === "report_published").flatMap((event) => {
      const records = [];
      for (const key of ["markdownPath", "htmlPath", "jsonPath"]) {
        const value = event.payload[key];
        if (typeof value !== "string" || !value.trim()) continue;
        records.push({
          id: `${event.event_id}-${key}`,
          sessionId,
          traceLaneId,
          branchId,
          sourceEventId: event.event_id,
          type: key === "htmlPath" ? "visual_report" : "report",
          status: "ready",
          displayName: value.split(/[\\/]/).filter(Boolean).pop() || value,
          path: value,
          rawRef: `raw-${event.event_id}`,
          createdAt: toIso(event.ts_ms),
          updatedAt: toIso(event.ts_ms)
        });
      }
      return records;
    });
    return [...registered, ...reports];
  }
  mapContext(sessionId, runId, branchId, traceLaneId, run) {
    const packets = contextService.listContextPackets(sessionId, runId);
    const captureContext = run.captures.map((capture) => ({
      id: `context-capture-${capture.id}`,
      sessionId,
      traceLaneId,
      branchId,
      kind: "capture",
      label: capture.filePath.split(/[\\/]/).filter(Boolean).pop() || capture.filePath,
      summary: capture.filePath,
      importance: "decisive",
      firstObservedAt: toIso(run.startedAt),
      lastObservedAt: toIso(run.finishedAt ?? run.startedAt),
      detailsRef: capture.filePath
    }));
    const packetContext = packets.map((packet) => ({
      id: `context-${packet.packetId}`,
      sessionId,
      traceLaneId,
      branchId,
      kind: packet.kind === "capture" ? "capture" : packet.kind === "tool_result" ? "source" : "file",
      label: packet.title,
      summary: packet.summary,
      importance: packet.evidenceIds.length > 0 ? "cited" : packet.kind === "plan" ? "important" : "normal",
      firstObservedAt: packet.createdAt,
      lastObservedAt: packet.createdAt,
      sourceEventIds: packet.evidenceIds,
      artifactIds: packet.artifactIds,
      detailsRef: packet.refs[0]
    }));
    return [...captureContext, ...packetContext];
  }
  buildRightPanel(progress, artifacts, context2, runs) {
    const activeRunIds = new Set(runs.filter((r) => r.run.status === "running" || r.run.status === "waiting_approval").map((r) => r.run.runId));
    const activeTraceLaneIds = new Set([...activeRunIds].flatMap((id) => [`ws-${id}-plan`, `ws-${id}-execution`, id]));
    return {
      progress: {
        current: progress.filter((t) => activeTraceLaneIds.has(t.traceLaneId) && ["running", "blocked", "pending", "reopened"].includes(t.status)),
        history: progress.filter((t) => ["completed", "cancelled"].includes(t.status))
      },
      artifacts: {
        current: artifacts.slice(-6),
        previous: artifacts.slice(0, Math.max(0, artifacts.length - 6))
      },
      context: {
        groups: ["capture", "file", "source", "capability"].map((kind) => {
          const all = context2.filter((r) => r.kind === kind);
          return { kind, important: all.filter((r) => r.importance !== "normal"), all };
        })
      }
    };
  }
  groupAskTurns(messages) {
    const groups = /* @__PURE__ */ new Map();
    for (const message of messages) {
      const turnId = message.turnId || message.id;
      const group = groups.get(turnId) ?? {
        turnId,
        createdAt: message.createdAt,
        completedAt: message.updatedAt ?? message.createdAt,
        messages: [],
        assistantMessages: []
      };
      group.createdAt = Math.min(group.createdAt, message.createdAt);
      group.completedAt = Math.max(group.completedAt, message.updatedAt ?? message.createdAt);
      group.messages.push(message);
      if (message.role === "user" && (!group.userMessage || message.createdAt < group.userMessage.createdAt)) {
        group.userMessage = message;
      }
      if (message.role === "assistant") group.assistantMessages.push(message);
      groups.set(turnId, group);
    }
    return Array.from(groups.values()).sort((a, b) => a.createdAt - b.createdAt);
  }
}
const traceService = new TraceService();
class RunExecutionService {
  activeRuns = /* @__PURE__ */ new Map();
  startRun(context2, executor) {
    const existing = this.activeRuns.get(context2.runId);
    if (existing) {
      return existing;
    }
    const abortController = new AbortController();
    const controller = {
      ...context2,
      startedAt: Date.now(),
      abortController
    };
    controller.promise = executor(abortController.signal).finally(() => {
      const active = this.activeRuns.get(context2.runId);
      if (active?.abortController === abortController) {
        this.activeRuns.delete(context2.runId);
      }
    });
    this.activeRuns.set(context2.runId, controller);
    return controller;
  }
  listActiveRuns() {
    return Array.from(this.activeRuns.values()).map((run) => ({
      runId: run.runId,
      sessionId: run.sessionId,
      projectId: run.projectId,
      startedAt: run.startedAt,
      stage: run.stage
    }));
  }
  getAbortSignal(runId) {
    return this.activeRuns.get(runId)?.abortController.signal ?? null;
  }
  updateStage(runId, stage) {
    const active = this.activeRuns.get(runId);
    if (!active) {
      return;
    }
    active.stage = stage;
  }
  isAbortRequested(runId) {
    return this.activeRuns.get(runId)?.abortController.signal.aborted ?? false;
  }
  stopRun(runId) {
    const active = this.activeRuns.get(runId);
    if (!active) {
      return false;
    }
    active.abortController.abort();
    return true;
  }
  async stopAll() {
    const runIds = Array.from(this.activeRuns.keys());
    runIds.forEach((runId) => this.stopRun(runId));
    await Promise.allSettled(
      runIds.map((runId) => this.activeRuns.get(runId)?.promise)
    );
  }
}
const runExecutionService = new RunExecutionService();
class DebuggerRuntime {
  async recoverInterruptedRuns() {
    await Promise.resolve();
  }
  getTraceProjection(sessionId) {
    return traceService.getSession(sessionId);
  }
  async switchTraceBranch(sessionId, branchId) {
    const projection = await traceService.getSession(sessionId);
    return {
      ...projection,
      activeBranchId: branchId
    };
  }
  async exportTraceSession(sessionId, _options) {
    return {
      success: false,
      sessionId,
      error: "Trace session export is not available without an active workflow run."
    };
  }
  stopRun(runId) {
    const stopped = runExecutionService.stopRun(runId);
    return stopped ? { success: true } : { success: false, error: "No active run." };
  }
  getWorkflowState(sessionId, runId) {
    const run = runId ? storageAdapter.listRuns(sessionId).find((entry) => entry.runId === runId) ?? null : storageAdapter.getLatestRun(sessionId);
    if (!run) {
      return null;
    }
    const activeRun = runExecutionService.listActiveRuns().find((entry) => entry.runId === run.runId);
    return {
      caseId: run.caseId,
      runId: run.runId,
      sessionId: run.sessionId,
      currentStage: activeRun?.stage ?? run.lastStage ?? "investigate",
      previousStages: [],
      entryMode: "cli",
      backend: "local",
      orchestrationMode: "multi_agent",
      coordinationMode: "staged_handoff",
      blockers: [],
      harnessTasks: [],
      reasoningSummaries: [],
      lastUpdated: nowIso$1()
    };
  }
  resolveAgentToolAllowlist(agentId, stage) {
    return resolveAgentToolAllowlist(agentId, stage);
  }
  isToolAllowedForAgent(toolName, agentId, stage) {
    return isToolAllowedForAgent(toolName, agentId, stage);
  }
}
const debuggerRuntime = new DebuggerRuntime();
const EMPTY_NAMESPACES = {
  capture: { description: "", groups: [] },
  session: { description: "", groups: [] },
  event: { description: "", groups: [] },
  replay: { description: "", groups: [] },
  pipeline: { description: "", groups: [] },
  shader: { description: "", groups: [] },
  texture: { description: "", groups: [] },
  resource: { description: "", groups: [] },
  export: { description: "", groups: [] },
  remote: { description: "", groups: [] },
  core: { description: "", groups: [] },
  macro: { description: "", groups: [] },
  vfs: { description: "", groups: [] }
};
const EMPTY_CATALOG = {
  schema_version: "unconfigured",
  tool_count: 0,
  tools: [],
  namespaces: EMPTY_NAMESPACES
};
const RECOMMENDED_SPECIALISTS = [
  "triage_agent",
  "capture_repro_agent",
  "pass_graph_pipeline_agent",
  "pixel_forensics_agent",
  "shader_ir_agent",
  "skeptic_agent",
  "curator_agent"
];
class RdxCliInvokerService {
  constructor(shell = shellInvocationService) {
    this.shell = shell;
  }
  shell;
  catalog = null;
  catalogPath = null;
  traceListeners = /* @__PURE__ */ new Set();
  getSettings() {
    return settingsService.getAll().tooling.rdxCli;
  }
  createRuntimeMetadata(settings = this.getSettings(), catalog) {
    const catalogPath = settings.catalogPath.trim();
    return {
      source: settings.enabled && settings.command.trim() ? "configured" : "unconfigured",
      command: settings.command.trim(),
      workingDirectory: settings.workingDirectory.trim(),
      version: null,
      catalog: {
        path: catalogPath,
        exists: catalogPath ? fs.existsSync(catalogPath) : false,
        schemaVersion: catalog?.schema_version ?? null,
        generatedAt: catalog?.generated_at ?? null,
        toolCount: catalog?.tool_count ?? (Array.isArray(catalog?.tools) ? catalog.tools.length : null)
      }
    };
  }
  getAvailabilityFailure(settings = this.getSettings()) {
    if (!settings.enabled) {
      return "RDX CLI invoker is disabled. Configure it in Settings.";
    }
    if (!settings.command.trim()) {
      return "RDX CLI command is not configured.";
    }
    const command = settings.command.trim();
    if ((path.isAbsolute(command) || command.includes(path.sep) || command.includes("/")) && !fs.existsSync(command)) {
      return `RDX CLI command not found: ${command}`;
    }
    return void 0;
  }
  isAvailable() {
    return this.getAvailabilityFailure() === void 0;
  }
  getRuntimeMetadata() {
    return this.createRuntimeMetadata(this.getSettings(), this.catalog ?? void 0);
  }
  async loadCatalog() {
    const settings = this.getSettings();
    const catalogPath = settings.catalogPath.trim();
    if (!catalogPath) {
      this.catalog = { ...EMPTY_CATALOG, runtime: this.createRuntimeMetadata(settings) };
      this.catalogPath = null;
      return this.catalog;
    }
    if (this.catalog && this.catalogPath === catalogPath) {
      return this.catalog;
    }
    if (!fs.existsSync(catalogPath)) {
      this.catalog = { ...EMPTY_CATALOG, runtime: this.createRuntimeMetadata(settings) };
      this.catalogPath = catalogPath;
      return this.catalog;
    }
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
    this.catalog = {
      ...catalog,
      runtime: this.createRuntimeMetadata(settings, catalog)
    };
    this.catalogPath = catalogPath;
    return this.catalog;
  }
  async getRuntimeSummary() {
    const settings = this.getSettings();
    const catalog = await this.loadCatalog();
    const namespaceCounts = /* @__PURE__ */ new Map();
    for (const tool of catalog.tools ?? []) {
      namespaceCounts.set(tool.namespace, (namespaceCounts.get(tool.namespace) ?? 0) + 1);
    }
    const unavailableReason = this.getAvailabilityFailure(settings);
    const namespaces = Array.from(namespaceCounts.entries()).map(([namespace, toolCount]) => ({
      namespace: `rd.${namespace}.*`,
      toolCount,
      available: !unavailableReason
    }));
    return {
      runtime: this.createRuntimeMetadata(settings, catalog),
      cli: {
        available: !unavailableReason,
        unavailableReason
      },
      namespaces,
      recommendedSpecialists: RECOMMENDED_SPECIALISTS
    };
  }
  normalizeCliArgs(args) {
    const normalized = [];
    for (let index = 0; index < args.length; index += 1) {
      const current = args[index];
      normalized.push(current === "--context-id" ? "--daemon-context" : current);
    }
    return normalized;
  }
  buildCommandArgs(settings, command, args) {
    const normalized = this.normalizeCliArgs(args);
    const globalArgs = [];
    const commandArgs = [];
    for (let index = 0; index < normalized.length; index += 1) {
      const current = normalized[index];
      if (current === "--daemon-context") {
        const value = normalized[index + 1];
        if (value) {
          globalArgs.push(current, value);
          index += 1;
          continue;
        }
      }
      commandArgs.push(current);
    }
    return [
      ...settings.argsPrefix,
      ...globalArgs,
      command,
      ...commandArgs
    ];
  }
  async executeCLI(command, args = [], options = {}) {
    const startTime = nowMs();
    const settings = this.getSettings();
    const unavailableReason = this.getAvailabilityFailure(settings);
    if (unavailableReason) {
      return {
        exitCode: 2,
        stdout: "",
        stderr: unavailableReason,
        duration_ms: nowMs() - startTime
      };
    }
    const invocation = resolveRdxBatchInvocation(
      settings.command,
      this.buildCommandArgs(settings, command, args)
    );
    return this.shell.invoke({
      command: invocation.command,
      args: invocation.args,
      cwd: options.cwd || settings.workingDirectory || void 0,
      env: {
        ...settings.env,
        ...options.env
      },
      timeoutMs: options.timeout ?? settings.timeoutMs,
      runId: options.runId,
      abortSignal: options.abortSignal
    });
  }
  onInvocationTrace(listener) {
    this.traceListeners.add(listener);
    return () => {
      this.traceListeners.delete(listener);
    };
  }
  emitInvocationTrace(request2, result) {
    const trace = {
      traceId: result.trace_id || generateEventId("tool-trace"),
      turnId: request2.turnId,
      toolName: request2.toolName,
      args: request2.args,
      result,
      timestamp: nowMs(),
      contextId: request2.contextId ?? "",
      runtimeOwner: request2.runtimeOwner ?? "",
      ownerLeaseId: request2.ownerLeaseId
    };
    for (const listener of this.traceListeners) {
      listener(trace);
    }
  }
  async call(request2) {
    const startTime = nowMs();
    let response;
    try {
      const cliArgs = [request2.toolName];
      const effectiveArgs = {
        ...request2.args || {}
      };
      if (request2.contextId && effectiveArgs["context_id"] === void 0) {
        effectiveArgs["context_id"] = request2.contextId;
      }
      if (request2.runtimeOwner && effectiveArgs["runtime_owner"] === void 0) {
        effectiveArgs["runtime_owner"] = request2.runtimeOwner;
      }
      if (request2.ownerLeaseId && effectiveArgs["owner_lease_id"] === void 0) {
        effectiveArgs["owner_lease_id"] = request2.ownerLeaseId;
      }
      if (Object.keys(effectiveArgs).length > 0) {
        cliArgs.push("--args-json", JSON.stringify(effectiveArgs));
      }
      if (request2.contextId) {
        cliArgs.push("--daemon-context", request2.contextId);
      }
      const result = await this.executeCLI("call", cliArgs, {
        timeout: this.getSettings().timeoutMs,
        runId: request2.runId,
        abortSignal: request2.abortSignal
      });
      if (result.stdout.trim()) {
        let parsed = null;
        try {
          parsed = JSON.parse(result.stdout);
        } catch {
          if (result.exitCode === 0) {
            response = {
              ok: true,
              data: { raw: result.stdout },
              duration_ms: nowMs() - startTime,
              trace_id: generateEventId("tool")
            };
            this.emitInvocationTrace(request2, response);
            return response;
          }
        }
        if (parsed) {
          if (parsed.ok === false) {
            const errObj = parsed.error ?? {};
            response = {
              ok: false,
              data: null,
              artifacts: [],
              error: {
                code: errObj.code ?? "TOOL_ERROR",
                message: errObj.message ?? "RDX CLI returned ok:false",
                category: errObj.category ?? "execution",
                details: errObj.details ?? void 0
              },
              duration_ms: nowMs() - startTime,
              trace_id: generateEventId("tool")
            };
            this.emitInvocationTrace(request2, response);
            return response;
          }
          response = {
            ok: true,
            data: parsed.data ?? parsed,
            artifacts: parsed.artifacts,
            duration_ms: nowMs() - startTime,
            trace_id: generateEventId("tool")
          };
          this.emitInvocationTrace(request2, response);
          return response;
        }
      }
      response = {
        ok: false,
        data: null,
        artifacts: [],
        error: {
          code: "CLI_ERROR",
          message: result.stderr.trim() || `Exit code: ${result.exitCode}`,
          category: "execution",
          details: {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode
          }
        },
        duration_ms: nowMs() - startTime,
        trace_id: generateEventId("tool")
      };
      this.emitInvocationTrace(request2, response);
      return response;
    } catch (error) {
      response = {
        ok: false,
        data: null,
        artifacts: [],
        error: {
          code: "EXECUTION_ERROR",
          message: error instanceof Error ? error.message : String(error),
          category: "internal"
        },
        duration_ms: nowMs() - startTime,
        trace_id: generateEventId("tool")
      };
      this.emitInvocationTrace(request2, response);
      return response;
    }
  }
  abortRun(runId) {
    this.shell.abortRun(runId);
  }
  terminateAll() {
    this.shell.terminateAll();
  }
}
const rdxCliInvokerService = new RdxCliInvokerService();
class SessionResumeService {
  /** 获取可恢复的会话状态。若无历史会话，返回 null。 */
  async getResumableSession() {
    try {
      const sessionId = await storageAdapter.getCurrentSessionId();
      if (!sessionId) return null;
      const session = storageAdapter.readSession(sessionId);
      if (!session) return null;
      const projectId = session.projectId;
      const latestRun = storageAdapter.getLatestRun(sessionId);
      const runningStatuses = ["running", "awaiting_input", "awaiting_approval"];
      const unfinishedRuns = storageAdapter.listRuns(sessionId).filter(
        (r) => runningStatuses.includes(r.status)
      );
      const runResumable = unfinishedRuns.length > 0;
      return {
        sessionId,
        projectId,
        runId: latestRun?.runId ?? null,
        runResumable,
        lastMessagePreview: session.title ?? void 0
      };
    } catch {
      return null;
    }
  }
  /** 获取会话的对话历史（用于恢复时加载到 UI）。 */
  async getSessionHistory(sessionId) {
    try {
      return storageAdapter.readConversationHistory(sessionId);
    } catch {
      return null;
    }
  }
}
const sessionResumeService = new SessionResumeService();
function registerAgentHandlers(context2) {
  const { state: state2 } = context2;
  electron.ipcMain.handle("agent:sendMessage", async (_event, agentId, content) => {
    try {
      let runContext;
      if (state2.currentSessionId) {
        const currentRun = state2.currentRunId ? storageAdapter.listRuns(state2.currentSessionId).find((run) => run.runId === state2.currentRunId) : storageAdapter.getLatestRun(state2.currentSessionId);
        if (currentRun) {
          runContext = {
            caseId: currentRun.caseId,
            runId: currentRun.runId,
            sessionId: currentRun.sessionId
          };
        }
      }
      const currentProjectId = storageAdapter.getCurrentProjectId();
      if (currentProjectId) {
        runContext = {
          ...runContext,
          projectId: currentProjectId,
          projectRootPath: storageAdapter.getProjectById(currentProjectId)?.rootPath ?? null
        };
      }
      const response = await agentOrchestrator.sendMessage(agentId, content, runContext, {
        signal: (runContext?.runId ? runExecutionService.getAbortSignal(runContext.runId) : null) ?? void 0
      });
      return { response };
    } catch (error) {
      return {
        response: void 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  electron.ipcMain.handle("agent:getState", async (_event, agentId) => {
    return agentOrchestrator.getAgentState(agentId);
  });
  electron.ipcMain.handle("agent:getAllStates", async () => {
    return agentOrchestrator.getAllAgentStates();
  });
  electron.ipcMain.handle("agent:configure", async (_event, agentId, config) => {
    try {
      agentOrchestrator.configureAgent(agentId, config);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
}
function registerMemoryHandlers(_context) {
  electron.ipcMain.handle("memory:list", async () => {
    const memories = await agentOrchestrator.listMemoriesForUi();
    return { memories };
  });
  electron.ipcMain.handle("memory:get", async (_event, name) => {
    const memory = await agentOrchestrator.getMemoryForUi(name);
    return { memory };
  });
  electron.ipcMain.handle("memory:write", async (_event, request2) => {
    return agentOrchestrator.writeMemoryForUi(request2);
  });
  electron.ipcMain.handle("memory:delete", async (_event, name) => {
    return agentOrchestrator.deleteMemoryForUi(name);
  });
}
function registerCaptureDeviceHandlers(context2) {
  const { state: state2 } = context2;
  electron.ipcMain.handle("context:get", async () => {
    return rdxSessionService.snapshotContext();
  });
  electron.ipcMain.handle("context:openHumanPreview", async (_event, request2) => {
    try {
      const contextSnapshot = await rdxSessionService.openHumanPreviewWindow(request2);
      context2.broadcastToRenderer("context:changed", contextSnapshot);
      const preview = contextSnapshot.humanPreview;
      return {
        success: preview?.status === "open" || preview?.status === "opening",
        contextSnapshot,
        error: preview?.lastError
      };
    } catch (error) {
      const contextSnapshot = rdxSessionService.snapshotContext();
      return {
        success: false,
        contextSnapshot,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  electron.ipcMain.handle("context:closeHumanPreview", async () => {
    try {
      const contextSnapshot = await rdxSessionService.closeHumanPreviewWindow();
      context2.broadcastToRenderer("context:changed", contextSnapshot);
      return {
        success: contextSnapshot.humanPreview?.status === "closed",
        contextSnapshot,
        error: contextSnapshot.humanPreview?.lastError
      };
    } catch (error) {
      const contextSnapshot = rdxSessionService.snapshotContext();
      return {
        success: false,
        contextSnapshot,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  electron.ipcMain.handle("capture:list", async () => {
    return { captures: rdxSessionService.getCaptureDescriptors() };
  });
  electron.ipcMain.handle(
    "capture:openProjectInput",
    async (_event, request2) => {
      try {
        runtimeLogService.log({
          scope: state2.currentSessionId ? "session" : "app",
          namespace: "capture",
          severity: "info",
          title: "Open project input",
          summary: `开始打开 ${request2.inputId}。`,
          detail: request2.filePath,
          sessionId: state2.currentSessionId,
          projectId: request2.projectId,
          runId: state2.currentRunId,
          raw: {
            inputId: request2.inputId,
            replayDeviceId: request2.replayDeviceId,
            filePath: request2.filePath
          }
        });
        const input = storageAdapter.listProjectInputs(request2.projectId).find((entry) => entry.inputId === request2.inputId && entry.filePath === request2.filePath);
        if (!input) {
          return { success: false, error: `Project input not found: ${request2.inputId}` };
        }
        const replayDevice = replayDeviceService.getDeviceById(request2.replayDeviceId);
        if (!replayDevice) {
          return { success: false, error: `Replay device not found: ${request2.replayDeviceId}` };
        }
        const openedCapture = await rdxSessionService.openProjectInput({
          projectId: request2.projectId,
          inputId: input.inputId,
          filePath: input.filePath,
          replayDevice
        });
        const contextSnapshot = rdxSessionService.snapshotContext();
        context2.broadcastToRenderer("capture:openedStateChanged", openedCapture);
        context2.broadcastToRenderer("context:changed", contextSnapshot);
        runtimeLogService.log({
          scope: state2.currentSessionId ? "session" : "app",
          namespace: "capture",
          severity: "success",
          title: "Project input opened",
          summary: `${input.fileName} 已打开。`,
          detail: openedCapture.preview?.source === "framebuffer_screenshot" ? "预览来源：framebuffer" : openedCapture.preview?.source === "capture_thumbnail" ? "预览来源：thumbnail" : openedCapture.previewError?.code ? `当前无可用预览：${openedCapture.previewError.code}` : "当前无可用预览",
          sessionId: state2.currentSessionId,
          projectId: request2.projectId,
          runId: state2.currentRunId,
          raw: {
            openedCapture,
            contextSnapshot
          }
        });
        return { success: true, openedCapture, contextSnapshot };
      } catch (err) {
        runtimeLogService.log({
          scope: state2.currentSessionId ? "session" : "app",
          namespace: "capture",
          severity: "error",
          title: "Project input open failed",
          summary: err instanceof Error ? err.message : String(err),
          sessionId: state2.currentSessionId,
          projectId: request2.projectId,
          runId: state2.currentRunId,
          raw: {
            inputId: request2.inputId,
            replayDeviceId: request2.replayDeviceId,
            filePath: request2.filePath
          }
        });
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );
  electron.ipcMain.handle("capture:getOpenedState", async () => {
    return rdxSessionService.snapshotOpenedCapture();
  });
  electron.ipcMain.handle("capture:clearOpenedState", async () => {
    await rdxSessionService.closeOrReplaceOpenedCapture();
    context2.broadcastToRenderer("capture:openedStateChanged", null);
    context2.broadcastToRenderer("context:changed", rdxSessionService.snapshotContext());
    runtimeLogService.log({
      scope: state2.currentSessionId ? "session" : "app",
      namespace: "capture",
      severity: "info",
      title: "Opened capture cleared",
      summary: "当前打开的 capture 已清理。",
      sessionId: state2.currentSessionId,
      projectId: state2.currentProjectId,
      runId: state2.currentRunId
    });
    return { success: true };
  });
  electron.ipcMain.handle("capture:select", async (_event, captureId) => {
    try {
      await rdxSessionService.switchActiveCapture(captureId);
      context2.broadcastToRenderer("capture:statusChanged", { captureId, status: "selected" });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  electron.ipcMain.handle("device:list", async () => {
    return replayDeviceService.listDevices();
  });
  electron.ipcMain.handle("device:refresh", async () => {
    return replayDeviceService.refreshDevices();
  });
  electron.ipcMain.handle("device:activate", async (_event, deviceId) => {
    return replayDeviceService.activateDevice(deviceId);
  });
}
class CommandRegistry {
  commands = /* @__PURE__ */ new Map();
  /** 注册一个命令。同名命令会被覆盖（最后注册者胜出）。 */
  register(command) {
    this.commands.set(command.name, command);
    if (command.aliases) {
      for (const alias of command.aliases) {
        if (!this.commands.has(alias)) {
          this.commands.set(alias, command);
        }
      }
    }
  }
  /** 注销一个命令。 */
  unregister(name) {
    const cmd = this.commands.get(name);
    if (!cmd) return;
    this.commands.delete(name);
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        const existing = this.commands.get(alias);
        if (existing === cmd) {
          this.commands.delete(alias);
        }
      }
    }
  }
  /** 根据名称查找命令（支持别名）。 */
  resolve(name) {
    return this.commands.get(name);
  }
  /** 列出所有命令（去重，按主名称）。 */
  list(category) {
    const seen = /* @__PURE__ */ new Set();
    const result = [];
    for (const cmd of this.commands.values()) {
      if (seen.has(cmd.id)) continue;
      seen.add(cmd.id);
      if (category && cmd.category !== category) continue;
      result.push({
        id: cmd.id,
        name: cmd.name,
        description: cmd.description,
        aliases: cmd.aliases ?? [],
        category: cmd.category
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }
  /** 解析原始输入并执行命令。 */
  async execute(request2) {
    const raw = request2.input.trim();
    if (!raw.startsWith("/")) {
      return {
        success: false,
        message: 'Input does not start with "/"'
      };
    }
    const parts = raw.slice(1).split(/\s+/);
    const commandName = parts[0];
    const args = parts.slice(1);
    const cmd = this.resolve(commandName);
    if (!cmd) {
      return {
        success: false,
        message: `Unknown command: /${commandName}. Type /help to see available commands.`
      };
    }
    const context2 = {
      sessionId: request2.context?.sessionId,
      projectId: request2.context?.projectId,
      workspaceRoot: request2.context?.workspaceRoot,
      agentId: request2.context?.agentId,
      currentMode: request2.context?.currentMode,
      currentModelId: request2.context?.currentModelId,
      currentTheme: request2.context?.currentTheme
    };
    try {
      return await cmd.execute(args, context2);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `Command /${commandName} failed: ${message}`
      };
    }
  }
}
const helpCommand = {
  id: "help",
  name: "help",
  description: "List all available commands or get details for a specific command",
  aliases: ["h", "?"],
  category: "system",
  async execute(args) {
    const registry = getRegistry();
    const all = registry.list();
    if (args.length > 0) {
      const cmd = registry.resolve(args[0]);
      if (!cmd) {
        return {
          success: false,
          message: `Unknown command: /${args[0]}`
        };
      }
      const aliases = cmd.aliases?.length ? ` (aliases: ${cmd.aliases.join(", ")})` : "";
      return {
        success: true,
        message: `**/${cmd.name}**${aliases} — ${cmd.category}
${cmd.description}`
      };
    }
    const byCategory = /* @__PURE__ */ new Map();
    for (const c of all) {
      const group = byCategory.get(c.category) ?? [];
      group.push(`/${c.name} — ${c.description}`);
      byCategory.set(c.category, group);
    }
    let output = `**Available Commands** (${all.length} total)

`;
    for (const [cat, lines] of byCategory) {
      output += `**${cat}**
${lines.map((l) => `  ${l}`).join("\n")}

`;
    }
    output += "Type `/help <command>` for details.";
    return { success: true, message: output };
  }
};
const clearCommand = {
  id: "clear",
  name: "clear",
  description: "Clear the current conversation history",
  aliases: ["cls"],
  category: "system",
  async execute(_args, ctx) {
    const sessionId = ctx.sessionId ?? "";
    return {
      success: Boolean(sessionId),
      message: sessionId ? "Clearing conversation history..." : "No active session. Open or create a session before clearing history.",
      uiAction: { type: "clear-session", payload: { sessionId } }
    };
  }
};
const configCommand = {
  id: "config",
  name: "config",
  description: "Open settings or view/modify a configuration value",
  category: "system",
  async execute(args) {
    return {
      success: true,
      message: "Opening Settings...",
      uiAction: { type: "open-settings", payload: args[0] ? { section: args[0] } : void 0 }
    };
  }
};
const modelCommand = {
  id: "model",
  name: "model",
  description: "View or switch the current LLM model",
  category: "navigation",
  async execute(args, ctx) {
    if (args.length === 0) {
      return {
        success: true,
        message: `Current model: ${ctx.currentModelId ?? "not configured"}`
      };
    }
    return {
      success: true,
      message: `Switching model to: ${args[0]}`,
      uiAction: { type: "switch-model", payload: { modelId: args[0] } }
    };
  }
};
const projectCommand = {
  id: "project",
  name: "project",
  description: "Manage projects (list, create, switch, rename, delete)",
  aliases: ["prj"],
  category: "navigation",
  async execute(args, ctx) {
    const action = args[0] ?? "list";
    switch (action) {
      case "list":
        return { success: true, message: "Projects: (list from ProjectStore)" };
      case "create":
        return { success: true, message: `Creating project: ${args[1] ?? "unnamed"}` };
      case "switch":
        return { success: true, message: `Switched to project: ${args[1] ?? ctx.projectId}` };
      default:
        return { success: true, message: `Project ${action}: current = ${ctx.projectId ?? "none"}` };
    }
  }
};
const sessionCommand = {
  id: "session",
  name: "session",
  description: "Manage sessions (list, create, rename, delete, resume)",
  aliases: ["sess"],
  category: "navigation",
  async execute(args, ctx) {
    const action = args[0] ?? "list";
    switch (action) {
      case "list":
        return { success: true, message: "Sessions: (list from SessionStore)" };
      case "new":
        return { success: true, message: "Creating new session..." };
      case "rename":
        return { success: true, message: `Renamed session to: ${args[1] ?? "untitled"}` };
      case "resume":
        return { success: true, message: `Resuming session: ${args[1] ?? ctx.sessionId}` };
      default:
        return { success: true, message: `Session ${action}: current = ${ctx.sessionId ?? "none"}` };
    }
  }
};
const workspaceCommand = {
  id: "workspace",
  name: "workspace",
  description: "View or change the workspace root directory",
  aliases: ["ws", "cd"],
  category: "navigation",
  async execute(args, ctx) {
    if (args.length === 0) {
      return {
        success: true,
        message: `Current workspace: ${ctx.workspaceRoot ?? "not set"}`
      };
    }
    return {
      success: true,
      message: `Workspace changed to: ${args[0]}`,
      uiAction: { type: "change-workspace", payload: { path: args[0] } }
    };
  }
};
const toolsCommand = {
  id: "tools",
  name: "tools",
  description: "List available tools or get tool details",
  aliases: ["tool"],
  category: "debug",
  async execute(args) {
    if (args.length > 0) {
      return {
        success: true,
        message: `Tool "${args[0]}": (details from ToolCatalog)`
      };
    }
    return {
      success: true,
      message: "Available tools: bash, read_file, write_file, edit_file, delete_file, move_file, copy_file, glob, grep, search_codebase, web_fetch, web_search, ask_user, notebook_edit, task_create, task_update, task_get, task_list, task_stop, mcp, skill"
    };
  }
};
const mcpCommand = {
  id: "mcp",
  name: "mcp",
  description: "Manage MCP server connections (list, connect, disconnect)",
  category: "system",
  async execute(args) {
    const action = args[0] ?? "list";
    switch (action) {
      case "list":
        return { success: true, message: "Connected MCP servers: (list from MCPManager)" };
      case "connect":
        return { success: true, message: `Connecting MCP server: ${args[1] ?? "unnamed"}` };
      case "disconnect":
        return { success: true, message: `Disconnected MCP server: ${args[1] ?? "unnamed"}` };
      default:
        return { success: true, message: `MCP ${action} — use: list, connect <name>, disconnect <name>` };
    }
  }
};
const skillsCommand = {
  id: "skills",
  name: "skills",
  description: "List available Markdown Skills or run one by id",
  aliases: ["skill"],
  category: "workflow",
  async execute(args, context2) {
    const skills = agentRuntimeConfigService.listSkills(context2.workspaceRoot);
    if (args.length === 0) {
      const lines = skills.map((skill2) => {
        const summary = skill2.description ? ` - ${skill2.description}` : "";
        return `- ${skill2.id}: ${skill2.label || skill2.name}${summary}`;
      });
      return {
        success: true,
        message: lines.length > 0 ? lines.join("\n") : "No Markdown Skills are available in this workspace.",
        data: { skills }
      };
    }
    const action = args[0];
    if (action === "run") {
      const skillId = args[1] ?? "";
      return {
        success: true,
        message: `Running skill: ${skillId || "unnamed"}...`,
        uiAction: { type: "run-skill", payload: { skillId } }
      };
    }
    const skill = skills.find((entry) => entry.id === action || entry.name === action || entry.label === action);
    if (!skill) {
      return {
        success: false,
        message: `Skill is not configured: ${action}`
      };
    }
    return {
      success: true,
      message: `${skill.id}: ${skill.label || skill.name}
${skill.description || "No description."}`,
      data: { skill }
    };
  }
};
const planCommand = {
  id: "plan",
  name: "plan",
  description: "Switch to the Plan profile to research and design an implementation plan before editing",
  category: "workflow",
  async execute() {
    return {
      success: true,
      message: "Switched to the Plan profile. Describe your task and I will research, ask questions, and write a plan before handing off to implementation.",
      uiAction: { type: "switch-mode", payload: { agentId: "plan" } }
    };
  }
};
const testCommand = {
  id: "test",
  name: "test",
  description: "Run tests or view test status",
  category: "debug",
  async execute(_args) {
    return {
      success: true,
      message: "Test runner: Use `npm test` to run unit tests, or `npm run typecheck` for type checking."
    };
  }
};
const exportCommand = {
  id: "export",
  name: "export",
  description: "Export the current conversation to Markdown or JSON",
  category: "workflow",
  async execute(args, ctx) {
    const sessionId = ctx.sessionId ?? "";
    const formatArg = args[0] ?? "markdown";
    const format = formatArg === "json" ? "json" : "markdown";
    return {
      success: Boolean(sessionId),
      message: sessionId ? `Exporting session ${sessionId} as ${format}...` : "No active session. Open or create a session before exporting history.",
      uiAction: { type: "export-session", payload: { sessionId, format } }
    };
  }
};
const statusCommand = {
  id: "status",
  name: "status",
  description: "Show system status and diagnostic information",
  aliases: ["st", "debug", "diag"],
  category: "debug",
  async execute(_args, ctx) {
    const info = {
      sessionId: ctx.sessionId ?? "none",
      projectId: ctx.projectId ?? "none",
      workspaceRoot: ctx.workspaceRoot ?? "none",
      agentId: ctx.agentId ?? "none",
      currentMode: ctx.currentMode ?? "none",
      currentModelId: ctx.currentModelId ?? "none",
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    };
    const lines = Object.entries(info).map(([k, v]) => `  ${k}: ${v}`);
    return {
      success: true,
      message: `**System Status**
${lines.join("\n")}`
    };
  }
};
const agentsCommand = {
  id: "agents",
  name: "agents",
  description: "List available agent profiles or switch to a specific agent",
  aliases: ["agent"],
  category: "workflow",
  async execute(args) {
    if (args.length === 0) {
      return {
        success: true,
        message: "Available agents: ask, plan, edit, debugger, analyzer, optimizer (from AgentManifestService)"
      };
    }
    const target = args[0];
    return {
      success: true,
      message: `Switched to agent: ${target}`,
      uiAction: { type: "switch-mode", payload: { agentId: target } }
    };
  }
};
const versionCommand = {
  id: "version",
  name: "version",
  description: "Show application version information",
  aliases: ["v"],
  category: "system",
  async execute() {
    return {
      success: true,
      message: `RDC Agent v1.0.0
Electron: ${process.versions.electron ?? "N/A"}
Node: ${process.version}
Chrome: ${process.versions.chrome ?? "N/A"}`
    };
  }
};
const undoCommand = {
  id: "undo",
  name: "undo",
  description: "Undo the last user message and its assistant response",
  category: "session",
  async execute(_args, ctx) {
    const sessionId = ctx.sessionId ?? "";
    return {
      success: Boolean(sessionId),
      message: sessionId ? "Undoing last conversation turn..." : "No active session. Open or create a session before undoing history.",
      uiAction: { type: "undo-session", payload: { sessionId } },
      invalidateStores: ["conversation"]
    };
  }
};
const compactCommand = {
  id: "compact",
  name: "compact",
  description: "Compact the conversation context to fit within token budget",
  category: "session",
  async execute(_args, ctx) {
    const sessionId = ctx.sessionId ?? "";
    return {
      success: Boolean(sessionId),
      message: sessionId ? "Compacting conversation context..." : "No active session. Open or create a session before compacting history.",
      uiAction: { type: "compact-session", payload: { sessionId } }
    };
  }
};
const resumeCommand = {
  id: "resume",
  name: "resume",
  description: "Resume a previously interrupted session",
  aliases: ["res"],
  category: "session",
  async execute(args, ctx) {
    const sessionId = args[0] ?? ctx.sessionId ?? "";
    return {
      success: true,
      message: args.length === 0 ? "Resuming latest interrupted session..." : `Resuming session: ${args[0]}`,
      uiAction: { type: "resume-session", payload: { sessionId } }
    };
  }
};
const summaryCommand = {
  id: "summary",
  name: "summary",
  description: "Summarize and compact the current conversation history",
  aliases: ["sum"],
  category: "session",
  async execute(_args, ctx) {
    const sessionId = ctx.sessionId ?? "";
    return {
      success: Boolean(sessionId),
      message: sessionId ? "Summarizing conversation history..." : "No active session. Open or create a session before summarizing.",
      uiAction: { type: "compact-session", payload: { sessionId } }
    };
  }
};
const costCommand = {
  id: "cost",
  name: "cost",
  description: "Show persisted run statistics and cost availability for the current session",
  category: "debug",
  async execute(_args, ctx) {
    const sessionId = ctx.sessionId;
    if (!sessionId) {
      return {
        success: true,
        message: "No active session. Open or create a session to track cost."
      };
    }
    const runs = storageAdapter.listRuns(sessionId);
    if (runs.length === 0) {
      return {
        success: true,
        message: `Session ${sessionId} has no runs yet.`
      };
    }
    const completed = runs.filter((run) => run.status === "completed").length;
    const failed = runs.filter((run) => run.status === "failed").length;
    const active = runs.filter((run) => ["queued", "planning", "awaiting_input", "awaiting_approval", "running", "stopping"].includes(run.status)).length;
    const lastRun = runs[0];
    const lines = [
      `Session: ${sessionId}`,
      `Runs: ${runs.length} total, ${completed} completed, ${failed} failed, ${active} active`,
      `Last run: ${lastRun.runId} (${lastRun.status}) started ${new Date(lastRun.startedAt).toISOString()}`,
      "",
      "Token totals and estimated cost are projected live during active runs.",
      "Historical per-run token cost is not persisted yet, so this command does not fabricate a total."
    ];
    return { success: true, message: lines.join("\n") };
  }
};
const usageCommand = {
  id: "usage",
  name: "usage",
  description: "Show persisted run and live usage availability for the current session",
  category: "debug",
  async execute(_args, ctx) {
    const sessionId = ctx.sessionId;
    if (!sessionId) {
      return {
        success: true,
        message: "No active session. Open or create a session to track usage."
      };
    }
    const runs = storageAdapter.listRuns(sessionId);
    if (runs.length === 0) {
      return {
        success: true,
        message: `Session ${sessionId} has no runs yet.`
      };
    }
    const byStatus = /* @__PURE__ */ new Map();
    for (const run of runs) {
      byStatus.set(run.status, (byStatus.get(run.status) ?? 0) + 1);
    }
    const statusLines = [...byStatus.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([status, count]) => `  ${status}: ${count}`);
    const lines = [
      `Session: ${sessionId}`,
      `Runs: ${runs.length}`,
      "By status:",
      ...statusLines,
      "",
      "Current-run token usage is available through workflow:getRunUsage while a run is active.",
      "Historical token and API-call counts are not persisted per run yet."
    ];
    return { success: true, message: lines.join("\n") };
  }
};
const PERMISSION_MODES = /* @__PURE__ */ new Set(["default", "auto-review", "full-access", "custom"]);
const permissionsCommand = {
  id: "permissions",
  name: "permissions",
  description: "View or change the current permission mode",
  aliases: ["perm"],
  category: "system",
  async execute(args, ctx) {
    if (args.length === 0) {
      return {
        success: true,
        message: `Current permission mode: default
Agent: ${ctx.agentId ?? "none"}`
      };
    }
    const mode = args[0];
    if (!PERMISSION_MODES.has(mode)) {
      return {
        success: false,
        message: "Permission mode must be default, auto-review, full-access, or custom."
      };
    }
    return {
      success: true,
      message: `Switching permission mode to: ${mode}`,
      uiAction: { type: "switch-permissions", payload: { mode } }
    };
  }
};
const THEMES = /* @__PURE__ */ new Set(["dark", "light", "system"]);
const themeCommand = {
  id: "theme",
  name: "theme",
  description: "Switch application theme (dark/light/system)",
  category: "system",
  async execute(args, ctx) {
    if (args.length === 0) {
      return {
        success: true,
        message: `Current theme: ${ctx.currentTheme ?? "system"}`
      };
    }
    const theme = args[0];
    if (!THEMES.has(theme)) {
      return {
        success: false,
        message: "Theme must be dark, light, or system."
      };
    }
    return {
      success: true,
      message: `Switching theme to: ${theme}`,
      uiAction: { type: "switch-theme", payload: { theme } }
    };
  }
};
let _registry = null;
function getRegistry() {
  if (!_registry) {
    _registry = new CommandRegistry();
    registerBuiltins(_registry);
  }
  return _registry;
}
function registerBuiltins(registry) {
  const builtins = [
    helpCommand,
    clearCommand,
    configCommand,
    modelCommand,
    projectCommand,
    sessionCommand,
    workspaceCommand,
    toolsCommand,
    mcpCommand,
    skillsCommand,
    planCommand,
    testCommand,
    exportCommand,
    statusCommand,
    agentsCommand,
    versionCommand,
    undoCommand,
    compactCommand,
    resumeCommand,
    summaryCommand,
    costCommand,
    usageCommand,
    permissionsCommand,
    themeCommand
  ];
  for (const cmd of builtins) {
    registry.register(cmd);
  }
}
class CommandService {
  constructor(registry) {
    this.registry = registry;
  }
  registry;
  async execute(request2) {
    const result = await this.registry.execute(request2);
    let systemMessage;
    if (result.systemMessage || result.message) {
      systemMessage = this.buildSystemMessage(result, request2);
    }
    return { result, systemMessage };
  }
  buildSystemMessage(result, request2) {
    const ctx = request2.context;
    const commandName = request2.input.trim().slice(1).split(/\s+/)[0];
    const now = Date.now();
    return {
      id: `cmd-${now}-${Math.random().toString(36).slice(2, 8)}`,
      turnId: `cmd-turn-${now}`,
      sessionId: ctx?.sessionId ?? null,
      projectId: ctx?.projectId ?? null,
      role: "system",
      content: result.systemMessage ?? result.message,
      status: result.success ? "complete" : "error",
      createdAt: now,
      updatedAt: now,
      workTrace: {
        status: result.success ? "complete" : "error",
        summary: result.message,
        blocks: [
          {
            id: `cmd-block-${now}`,
            kind: "command",
            title: `/${commandName}`,
            status: result.success ? "complete" : "error",
            summary: result.message,
            detail: result.data ? JSON.stringify(result.data, null, 2) : void 0,
            toolCalls: [],
            startedAt: now,
            completedAt: now
          }
        ],
        updatedAt: now
      }
    };
  }
}
let commandService = null;
function getCommandService() {
  if (!commandService) {
    commandService = new CommandService(getRegistry());
  }
  return commandService;
}
function registerCommandHandlers() {
  electron.ipcMain.handle("command:list", (_event, category) => {
    const registry = getRegistry();
    return { commands: registry.list(category) };
  });
  electron.ipcMain.handle("command:execute", async (_event, request2) => {
    const service = getCommandService();
    return service.execute(request2);
  });
}
const ROOT_BRANCH_ID = "branch-root";
const AGENT_WORKBENCH_TOOL_CATALOG = [
  {
    id: "read_file",
    label: "Read File",
    permission: "readonly",
    inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } },
    resultSummary: "Returns text content from a workspace file.",
    icon: "file-text",
    approvalRequired: false
  },
  {
    id: "glob",
    label: "Glob",
    permission: "readonly",
    inputSchema: { type: "object", required: ["pattern"], properties: { pattern: { type: "string" } } },
    resultSummary: "Lists workspace paths matching a glob pattern.",
    icon: "folder-search",
    approvalRequired: false
  },
  {
    id: "grep",
    label: "Grep",
    permission: "readonly",
    inputSchema: { type: "object", required: ["pattern"], properties: { pattern: { type: "string" }, path: { type: "string" } } },
    resultSummary: "Returns matching text locations from workspace files.",
    icon: "search",
    approvalRequired: false
  },
  {
    id: "web_fetch",
    label: "Web Fetch",
    permission: "readonly",
    inputSchema: { type: "object", required: ["url"], properties: { url: { type: "string" } } },
    resultSummary: "Fetches public HTTP(S) page text.",
    icon: "globe",
    approvalRequired: false
  },
  {
    id: "web_search",
    label: "Web Search",
    permission: "readonly",
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" } } },
    resultSummary: "Searches public web results.",
    icon: "search-check",
    approvalRequired: false
  },
  {
    id: "bash",
    label: "Shell",
    permission: "approval",
    inputSchema: { type: "object", required: ["command"], properties: { command: { type: "string" } } },
    resultSummary: "Runs an approved workspace command and returns stdout/stderr.",
    icon: "terminal",
    approvalRequired: true
  },
  {
    id: "write_file",
    label: "Write File",
    permission: "mutation",
    inputSchema: { type: "object", required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } } },
    resultSummary: "Writes a workspace file after policy approval.",
    icon: "file-plus",
    approvalRequired: true
  },
  {
    id: "edit_file",
    label: "Edit File",
    permission: "mutation",
    inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" }, patch: { type: "string" } } },
    resultSummary: "Edits a workspace file after policy approval.",
    icon: "pencil",
    approvalRequired: true
  },
  {
    id: "task_list",
    label: "Tasks",
    permission: "readonly",
    inputSchema: { type: "object", properties: {} },
    resultSummary: "Summarizes current task or plan state.",
    icon: "list-checks",
    approvalRequired: false
  },
  {
    id: "task_create",
    label: "Create Task",
    permission: "mutation",
    inputSchema: {
      type: "object",
      required: ["subject"],
      properties: {
        subject: { type: "string" },
        description: { type: "string" },
        activeForm: { type: "string" },
        blockedBy: { type: "array", items: { type: "string" } }
      }
    },
    resultSummary: "Creates a private agent task record in workspace user space.",
    icon: "list-plus",
    approvalRequired: false
  },
  {
    id: "task_update",
    label: "Update Task",
    permission: "mutation",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: {
        taskId: { type: "string" },
        status: { type: "string" },
        subject: { type: "string" },
        description: { type: "string" }
      }
    },
    resultSummary: "Updates status or metadata for a private agent task record.",
    icon: "list-todo",
    approvalRequired: false
  },
  {
    id: "task_get",
    label: "Get Task",
    permission: "readonly",
    inputSchema: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" } } },
    resultSummary: "Reads a private agent task record by id.",
    icon: "list",
    approvalRequired: false
  },
  {
    id: "ask_user",
    label: "Ask User",
    permission: "approval",
    inputSchema: { type: "object", required: ["question"], properties: { question: { type: "string" }, choices: { type: "array", items: { type: "string" } } } },
    resultSummary: "Surfaces a decision or missing information request.",
    icon: "message-question",
    approvalRequired: false
  },
  {
    id: "agent_handoff",
    label: "Agent Handoff",
    permission: "readonly",
    inputSchema: { type: "object", required: ["prompt"], properties: { agent: { type: "string" }, label: { type: "string" }, prompt: { type: "string" } } },
    resultSummary: "Creates an implementation or specialist handoff summary.",
    icon: "route",
    approvalRequired: false
  },
  {
    id: "memory_read",
    label: "Memory",
    permission: "readonly",
    inputSchema: { type: "object", properties: { name: { type: "string" }, query: { type: "string" }, limit: { type: "number" } } },
    resultSummary: "Reads persisted workspace memories by name or keyword filter.",
    icon: "brain",
    approvalRequired: false
  },
  {
    id: "memory_write",
    label: "Write Memory",
    permission: "mutation",
    inputSchema: {
      type: "object",
      required: ["name", "description", "type", "content"],
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        type: { type: "string" },
        content: { type: "string" },
        tags: { type: "array", items: { type: "string" } }
      }
    },
    resultSummary: "Persists a new memory (user/feedback/project/reference) to the workspace store.",
    icon: "brain",
    approvalRequired: false
  },
  {
    id: "memory_delete",
    label: "Delete Memory",
    permission: "mutation",
    inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
    resultSummary: "Deletes a memory by name from the workspace store.",
    icon: "brain",
    approvalRequired: true
  },
  {
    id: "plan_artifact",
    label: "Plan Artifact",
    permission: "mutation",
    inputSchema: { type: "object", required: ["content"], properties: { title: { type: "string" }, content: { type: "string" } } },
    resultSummary: "Writes the current plan to the active session artifact.",
    icon: "file-check",
    approvalRequired: false
  },
  {
    id: "skills",
    label: "Skills",
    permission: "readonly",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    resultSummary: "Lists configured reusable skills.",
    icon: "sparkles",
    approvalRequired: false
  },
  {
    id: "mcp",
    label: "MCP",
    permission: "readonly",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    resultSummary: "Lists configured MCP services.",
    icon: "plug",
    approvalRequired: false
  },
  {
    id: "rdx_context",
    label: "RDX Context",
    permission: "readonly",
    inputSchema: { type: "object", properties: {} },
    resultSummary: "Reads current RDC/RDX runtime context.",
    icon: "monitor-dot",
    approvalRequired: false
  }
];
const AGENT_WORKBENCH_COMMAND_CATALOG = [
  {
    command: "/help",
    label: "Help",
    description: "Show available profile commands and tool boundaries.",
    relatedTools: [],
    permission: "readonly"
  },
  {
    command: "/compact",
    label: "Compact",
    description: "Request context compaction when the profile can manage context.",
    relatedTools: ["memory_read"],
    permission: "readonly"
  },
  {
    command: "/context",
    label: "Context",
    description: "Summarize current project, session, captures, and available context.",
    relatedTools: ["read_file", "memory_read", "rdx_context"],
    permission: "readonly"
  },
  {
    command: "/memory",
    label: "Memory",
    description: "Inspect profile-accessible memory.",
    relatedTools: ["memory_read", "plan_artifact", "task_list"],
    permission: "readonly"
  },
  {
    command: "/agents",
    label: "Agents",
    description: "List profiles and handoff options visible to the current profile.",
    relatedTools: ["agent_handoff"],
    permission: "readonly"
  },
  {
    command: "/skills",
    label: "Skills",
    description: "List configured skills visible to the current profile.",
    relatedTools: ["skills"],
    permission: "readonly"
  },
  {
    command: "/mcp",
    label: "MCP",
    description: "List configured MCP services visible to the current profile.",
    relatedTools: ["mcp"],
    permission: "readonly"
  },
  {
    command: "/status",
    label: "Status",
    description: "Summarize runtime, route, tool, and capture status.",
    relatedTools: ["task_list", "task_get", "rdx_context"],
    permission: "readonly"
  },
  {
    command: "/model",
    label: "Model",
    description: "Show the active model route for this profile.",
    relatedTools: [],
    permission: "readonly"
  }
];
const sectionIdentity = (context2) => {
  const { agentLabel, agentDescription } = context2.profile;
  return [
    `# Identity`,
    `You are ${agentLabel}. ${agentDescription}`,
    ``,
    `Core directives:`,
    `- Act, don't explain. Prefer tool invocations over narration.`,
    `- Show concise visible work summaries and tool results only. Do not reveal hidden chain-of-thought.`,
    `- Keep output minimal. Surface only what the user needs.`,
    `- Use tools to read, write, and verify; never guess when a tool can confirm.`
  ].join("\n");
};
const sectionProfileInstructions = (context2) => {
  const base = context2.profile.baseInstructions?.trim();
  const global = context2.profile.globalInstructions?.trim();
  if (!base && !global) {
    return null;
  }
  const parts = [`# Profile Instructions`];
  if (base) {
    parts.push(``, base);
  }
  if (global) {
    parts.push(``, `## Global Instructions`, global);
  }
  return parts.join("\n");
};
const sectionCapabilities = () => {
  return [
    `# Capabilities`,
    `- Read and write files in the workspace.`,
    `- Execute commands via the available shell tooling.`,
    `- Search code semantically and by exact pattern.`,
    `- Manage tasks, plans, and intermediate artifacts.`
  ].join("\n");
};
const sectionTools = (context2) => {
  if (!context2.tools || context2.tools.length === 0) {
    return null;
  }
  const lines = context2.tools.map((name) => `- ${name}`);
  return [`# Available Tools`, ...lines].join("\n");
};
const sectionWorkspace = (context2) => {
  const platform = process.platform ?? "unknown";
  const shell = process.env.SHELL ?? process.env.ComSpec ?? "unknown";
  return [
    `# Working Directory`,
    `The current project root is ${context2.workDir}. Use it as the default base for relative file paths, search roots, and shell working directory.`,
    `Platform: ${platform}`,
    `Shell: ${shell}`,
    `Model: ${context2.model.provider}/${context2.model.name}`,
    `Mode: ${context2.mode}`
  ].join("\n");
};
const sectionRouteCapability = (context2) => {
  const cap = context2.routeCapability;
  if (cap.toolCallingMode === "native-structured") {
    return [
      `# Route Capability`,
      `Route Capability: native structured tool calling is enabled for ${cap.providerId}/${cap.modelId}.`,
      `When a tool is needed, use only the provider structured tool/function-call channel.`,
      `Do not write textual tool-call syntax in the assistant message.`
    ].join("\n");
  }
  return [
    `# Route Capability`,
    `Route Capability: ${cap.toolCallingMode} for ${cap.providerId}/${cap.modelId}.`,
    `This route cannot execute runtime tools in the current agent loop.`,
    `Do not invent tool calls, tool results, file reads, searches, or command output.`,
    `If you need runtime information, explain what information is missing and why.`
  ].join("\n");
};
const sectionPermission = (context2) => {
  const ps = context2.permissionSettings;
  const mode = ps.mode;
  const lines = [
    `# Runtime Permission Policy`,
    `Current permission mode: ${mode}.`
  ];
  switch (mode) {
    case "full-access":
      lines.push(
        "Readable roots: entire local machine.",
        "Writable roots: entire local machine.",
        "Use read_file with absolute paths for files outside the current project root.",
        "Do not claim inability to read or write a local path without attempting the tool first.",
        "You may also access files outside this project root using absolute paths when calling read_file, glob, grep, or shell commands."
      );
      break;
    case "auto-review":
      lines.push(
        "Readable roots: current project workspace; external read paths are auto-reviewed and usually denied at medium risk.",
        "Writable roots: current project workspace; external write paths are auto-reviewed and usually denied at medium or high risk.",
        "When external access is needed, ask the user to switch to Default or Full access, or add readableRoots in Custom mode settings.",
        "If policy may deny the path, still attempt read_file with an absolute path so the runtime can record the review outcome."
      );
      break;
    case "custom":
      lines.push(
        `Readable roots: current project workspace plus ${formatConfiguredRoots(
          ps.readableRoots,
          "no extra configured paths"
        )}.`,
        `Writable roots: current project workspace plus ${formatConfiguredRoots(
          ps.writableRoots,
          "no extra configured paths"
        )}.`,
        "Configured readableRoots and writableRoots in settings are allowed without extra approval.",
        "For other external paths, runtime approval rules still apply based on the closest matching policy.",
        "When policy allows access, use read_file with absolute paths and do not refuse without attempting the tool."
      );
      break;
    default:
      lines.push(
        "Readable roots: current project workspace; external paths require one-time user approval.",
        "Writable roots: current project workspace; external paths require one-time user approval.",
        "When the user asks for a file outside the project, call read_file with its absolute path and wait for runtime approval if prompted.",
        "Do not refuse or guess file contents without attempting the tool first.",
        "External files, network access, file mutation, destructive shell commands, and unrecognized commands may pause for user approval."
      );
      break;
  }
  lines.push(
    "Routine local inspection commands can run when the runtime policy allows them.",
    "When policy allows external access, use read_file with absolute paths instead of claiming the file is unreachable.",
    "If the runtime denies or requests approval, do not route around the decision with guessed paths or textual tool calls.",
    "When you report a file path, use the absolute path that the tool actually resolved. Do not claim a path that differs from the tool result."
  );
  return lines.join("\n");
};
function formatConfiguredRoots(roots, fallback) {
  return roots.length > 0 ? roots.join(", ") : fallback;
}
const sectionCatalog = (context2) => {
  if (context2.routeCapability.toolCallingMode !== "native-structured") {
    return null;
  }
  const allowedNames = context2.allowedToolNames ?? context2.tools ?? [];
  const allowed = new Set(allowedNames);
  const toolLines = AGENT_WORKBENCH_TOOL_CATALOG.filter((tool) => allowed.has(tool.id)).map((tool) => `- ${tool.id}: ${tool.label}; permission=${tool.permission}; approval=${tool.approvalRequired ? "required" : "not required"}; result=${tool.resultSummary}`);
  const commandLines = AGENT_WORKBENCH_COMMAND_CATALOG.map((command) => `- ${command.command}: ${command.description}${command.relatedTools.length ? ` Uses: ${command.relatedTools.join(", ")}` : ""}.`);
  return [
    "# Runtime Catalog",
    "Only use tools exposed to this profile by the runtime. Slash commands are intent hints and never bypass profile permissions.",
    "",
    "Allowed tools:",
    ...toolLines.length > 0 ? toolLines : ["- None."],
    "",
    "Slash commands:",
    ...commandLines
  ].join("\n");
};
const sectionMemory = (context2) => {
  const hasIndex = typeof context2.memoryIndex === "string" && context2.memoryIndex.trim().length > 0;
  const hasRelevant = Array.isArray(context2.relevantMemories) && context2.relevantMemories.length > 0;
  if (!hasIndex && !hasRelevant) {
    return null;
  }
  const parts = [`# Memory`];
  if (hasIndex) {
    parts.push(``, `Available memories:`, context2.memoryIndex.trim());
  }
  if (hasRelevant) {
    parts.push(``, `Relevant memories:`);
    for (const mem of context2.relevantMemories) {
      parts.push(``, mem.trim());
    }
  }
  return parts.join("\n");
};
const sectionRules = (context2) => {
  const lines = [
    `# Rules`,
    `- Do not modify files unrelated to the current task.`,
    `- Do not delete files or perform irreversible actions without explicit confirmation.`,
    `- Minimize output: avoid re-stating tool results, prefer next actions.`,
    `- When uncertain, prefer reading existing code over guessing.`,
    `- Respect the runtime permission policy for workspace boundaries; use absolute paths when policy allows external access.`,
    `- Do not claim a file is unreachable without attempting read_file when policy permits.`
  ];
  const userRules = context2.userRules?.trim();
  if (userRules && userRules.length > 0) {
    lines.push(``, `## User Rules`, userRules);
  }
  return lines.join("\n");
};
const sectionContext = (context2) => {
  const hasSkills = Array.isArray(context2.skills) && context2.skills.length > 0;
  const hasCustom = Array.isArray(context2.customSections) && context2.customSections.length > 0;
  if (!hasSkills && !hasCustom) {
    return null;
  }
  const parts = [`# Context`];
  if (hasSkills) {
    parts.push(``, `Loaded skills:`);
    for (const name of context2.skills) {
      parts.push(`- ${name}`);
    }
  }
  if (hasCustom) {
    for (const section of context2.customSections) {
      const title = section.title?.trim() || "Custom";
      const content = section.content?.trim() ?? "";
      parts.push(``, `## ${title}`, content);
    }
  }
  return parts.join("\n");
};
const DEFAULT_SECTIONS = [
  sectionIdentity,
  sectionProfileInstructions,
  sectionCapabilities,
  sectionTools,
  sectionWorkspace,
  sectionRouteCapability,
  sectionPermission,
  sectionCatalog,
  sectionMemory,
  sectionRules,
  sectionContext
];
const DEFAULT_STATIC_SECTION_COUNT = 8;
const DYNAMIC_BOUNDARY = "\n<!-- DYNAMIC_CONTENT_BELOW -->\n";
const MAX_CACHE_ENTRIES = 10;
class PromptAssembler {
  sections;
  staticSectionCount;
  enableCache;
  cache;
  constructor(options = {}) {
    this.sections = options.sections ?? DEFAULT_SECTIONS;
    this.staticSectionCount = Math.max(
      0,
      Math.min(
        options.staticSectionCount ?? DEFAULT_STATIC_SECTION_COUNT,
        this.sections.length
      )
    );
    this.enableCache = options.enableCache ?? true;
    this.cache = /* @__PURE__ */ new Map();
  }
  /**
   * 组装完整的 system prompt。
   *
   * @param context 段落函数所需的运行期上下文。
   * @returns 拼装好的 system prompt 字符串。
   */
  assembleSystemPrompt(context2) {
    if (this.enableCache) {
      const key = this.computeCacheKey(context2, "full");
      const cached = this.cache.get(key);
      if (cached !== void 0) {
        return cached;
      }
      const prompt = this.renderFull(context2);
      this.storeInCache(key, prompt);
      return prompt;
    }
    return this.renderFull(context2);
  }
  /**
   * 仅返回静态前缀（包含末尾的 {@link DYNAMIC_BOUNDARY}）。
   *
   * 用于上层提前发起 prompt cache warm-up：
   * 即便后续动态段落变化，前缀依然命中缓存。
   */
  getStaticPrefix(context2) {
    if (this.enableCache) {
      const key = this.computeCacheKey(context2, "prefix");
      const cached = this.cache.get(key);
      if (cached !== void 0) {
        return cached;
      }
      const prefix = this.renderStaticPrefix(context2);
      this.storeInCache(key, prefix);
      return prefix;
    }
    return this.renderStaticPrefix(context2);
  }
  /**
   * 主动清除全部缓存。
   *
   * 当外部依赖（如可用工具集合、规则集）发生变化但 context 字段未变时，
   * 调用方应显式调用本方法以避免命中过期缓存。
   */
  invalidateCache() {
    this.cache.clear();
  }
  /**
   * 测量各语义分段的字符数，用于上下文窗口 breakdown 的 token 估算。
   *
   * 不触发缓存；调用时需保证 context 与 assembleSystemPrompt 所用的 context 一致。
   */
  measureSections(context2) {
    const rulesText = sectionRules(context2) ?? "";
    const memoryText = sectionMemory(context2) ?? "";
    const fullPrompt = this.assembleSystemPrompt(context2);
    const dynamicChars = rulesText.length + memoryText.length;
    return {
      system_prompt: Math.max(0, fullPrompt.length - dynamicChars),
      rules: rulesText.length,
      memory_files: memoryText.length
    };
  }
  /** 渲染完整 prompt（不使用缓存）。 */
  renderFull(context2) {
    const groups = this.collectGroups(context2);
    const parts = [];
    if (groups.staticParts.length > 0) {
      parts.push(groups.staticParts.join("\n\n"));
    }
    if (groups.dynamicParts.length > 0) {
      const dynamic = groups.dynamicParts.join("\n\n");
      if (parts.length > 0) {
        return parts[0] + DYNAMIC_BOUNDARY + dynamic;
      }
      return dynamic;
    }
    return parts.join("");
  }
  /** 渲染静态前缀（不使用缓存），始终以 {@link DYNAMIC_BOUNDARY} 结尾。 */
  renderStaticPrefix(context2) {
    const groups = this.collectGroups(context2);
    const staticText = groups.staticParts.join("\n\n");
    return staticText + DYNAMIC_BOUNDARY;
  }
  /** 调用所有段落函数并按静态/动态分组，跳过返回 null 或空白的段落。 */
  collectGroups(context2) {
    const staticParts = [];
    const dynamicParts = [];
    for (let i = 0; i < this.sections.length; i += 1) {
      const section = this.sections[i];
      const text = section(context2);
      if (text === null || text === void 0) {
        continue;
      }
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        continue;
      }
      if (i < this.staticSectionCount) {
        staticParts.push(trimmed);
      } else {
        dynamicParts.push(trimmed);
      }
    }
    return { staticParts, dynamicParts };
  }
  /** 计算缓存 key：context 序列化后的 SHA-256，附带类型后缀。 */
  computeCacheKey(context2, kind) {
    const serialized = JSON.stringify(context2, replacerForStableKeys);
    const hash = node_crypto.createHash("sha256").update(serialized ?? "").digest("hex");
    return `${kind}:${hash}`;
  }
  /** 写入缓存，超出上限时按插入序淘汰最旧条目。 */
  storeInCache(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, value);
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (oldest.done) {
        break;
      }
      this.cache.delete(oldest.value);
    }
  }
}
function replacerForStableKeys(_key, value) {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value;
    const sorted = {};
    for (const k of Object.keys(record).sort()) {
      sorted[k] = record[k];
    }
    return sorted;
  }
  return value;
}
const sortByCreatedAt = (left, right) => {
  if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
  const leftUpdated = left.updatedAt ?? left.createdAt;
  const rightUpdated = right.updatedAt ?? right.createdAt;
  return leftUpdated - rightUpdated;
};
function createDefaultBranchState(sessionId) {
  return {
    sessionId,
    rootBranchId: ROOT_BRANCH_ID,
    activeLeafBranchId: ROOT_BRANCH_ID,
    forks: []
  };
}
function normalizeBranchId(branchId) {
  return branchId?.trim() || ROOT_BRANCH_ID;
}
function resolveVisibleConversationMessages(allMessages, branchState) {
  if (!branchState || branchState.forks.length === 0) {
    return allMessages.filter((message) => normalizeBranchId(message.branchId) === ROOT_BRANCH_ID).sort(sortByCreatedAt);
  }
  return collectBranchPath(
    branchState.rootBranchId,
    allMessages,
    branchState.forks,
    0
  );
}
function collectBranchPath(branchId, allMessages, forks, minCreatedAt) {
  const branchMessages = allMessages.filter((message) => normalizeBranchId(message.branchId) === branchId && message.createdAt > minCreatedAt).sort(sortByCreatedAt);
  const forkCandidates = forks.map((fork2) => {
    const anchor2 = allMessages.find((message) => message.id === fork2.anchorMessageId);
    if (!anchor2 || normalizeBranchId(anchor2.branchId) !== branchId) return null;
    if (anchor2.createdAt <= minCreatedAt) return null;
    return { fork: fork2, anchor: anchor2 };
  }).filter((entry) => entry !== null).sort((left, right) => left.anchor.createdAt - right.anchor.createdAt);
  const nextFork = forkCandidates[0];
  if (!nextFork) {
    return branchMessages;
  }
  const { fork, anchor } = nextFork;
  const beforeFork = branchMessages.filter((message) => message.createdAt < anchor.createdAt);
  const activeBranch = fork.branches.find((entry) => entry.branchId === fork.activeBranchId);
  if (!activeBranch) {
    return beforeFork;
  }
  const activeAnchor = allMessages.find((message) => message.id === activeBranch.anchorUserMessageId);
  if (!activeAnchor) {
    return beforeFork;
  }
  const turnMessages = allMessages.filter((message) => message.turnId === activeAnchor.turnId && normalizeBranchId(message.branchId) === activeBranch.branchId).sort(sortByCreatedAt);
  if (turnMessages.length === 0) {
    return beforeFork;
  }
  const turnEnd = Math.max(...turnMessages.map((message) => message.updatedAt ?? message.createdAt));
  const suffix = collectBranchPath(activeBranch.branchId, allMessages, forks, turnEnd);
  return [...beforeFork, ...turnMessages, ...suffix];
}
function resolveThinkingPresentation(reasoningDelivery, hasThinking) {
  if (!hasThinking || !reasoningDelivery || reasoningDelivery === "none" || reasoningDelivery === "hidden") {
    return "none";
  }
  if (reasoningDelivery === "summary-only") return "summary";
  return "full";
}
function resolveConversationAgentId(requestedMode, requestedAgentId) {
  if (requestedAgentId && resolveEnabledAgentDefinition(requestedAgentId)) {
    return requestedAgentId;
  }
  if (requestedMode !== "ask" && resolveEnabledAgentDefinition(requestedMode)) {
    return requestedMode;
  }
  return "ask";
}
const ACTIVE_RUN_STATUSES = [
  "planning",
  "awaiting_input",
  "awaiting_approval",
  "queued",
  "running",
  "stopping"
];
function isActiveRun(run) {
  return Boolean(run && ACTIVE_RUN_STATUSES.includes(run.status));
}
function createWorkBlock(id, title, stage, kind = "reasoning") {
  return {
    id,
    kind,
    title,
    stage,
    status: "pending",
    toolCalls: [],
    startedAt: nowMs()
  };
}
function createDraftWorkTrace(summary, blocks = []) {
  return {
    status: "running",
    summary,
    blocks,
    updatedAt: nowMs()
  };
}
function cloneTrace(trace) {
  return trace ? {
    ...trace,
    blocks: trace.blocks.map((block) => ({
      ...block,
      toolCalls: block.toolCalls.map((toolCall) => ({ ...toolCall }))
    }))
  } : {
    status: "idle",
    blocks: [],
    updatedAt: nowMs()
  };
}
function upsertWorkBlock(trace, blockId, patch) {
  const nextTrace = cloneTrace(trace);
  const blockIndex = nextTrace.blocks.findIndex((block) => block.id === blockId);
  if (blockIndex >= 0) {
    nextTrace.blocks[blockIndex] = {
      ...nextTrace.blocks[blockIndex],
      ...patch,
      toolCalls: patch.toolCalls ? patch.toolCalls.map((toolCall) => ({ ...toolCall })) : nextTrace.blocks[blockIndex].toolCalls.map((toolCall) => ({ ...toolCall }))
    };
  } else {
    nextTrace.blocks.push({
      ...createWorkBlock(blockId, patch.title || blockId, patch.stage, patch.kind),
      ...patch,
      kind: patch.kind ?? "reasoning",
      toolCalls: patch.toolCalls ? patch.toolCalls.map((toolCall) => ({ ...toolCall })) : []
    });
  }
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}
function finalizeTrace(trace, status, summary) {
  const nextTrace = cloneTrace(trace);
  const terminalBlockStatus = status === "complete" ? "complete" : status === "error" || status === "stopped" ? "error" : null;
  if (terminalBlockStatus) {
    const terminalAt = nowMs();
    nextTrace.blocks = nextTrace.blocks.map((block) => {
      const blockStatus = block.status === "pending" || block.status === "running" ? terminalBlockStatus : block.status;
      const blockCompletedAt = block.completedAt ?? terminalAt;
      return {
        ...block,
        status: blockStatus,
        completedAt: blockCompletedAt,
        toolCalls: block.toolCalls.map((toolCall) => {
          if (toolCall.status !== "pending" && toolCall.status !== "running") {
            return { ...toolCall };
          }
          return {
            ...toolCall,
            status: terminalBlockStatus,
            completedAt: toolCall.completedAt ?? terminalAt,
            error: terminalBlockStatus === "error" ? toolCall.error ?? "Run ended before this tool call completed." : toolCall.error
          };
        })
      };
    });
  }
  nextTrace.status = status;
  nextTrace.summary = summary ?? nextTrace.summary;
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}
function upsertRuntimeToolCall(trace, patch, options) {
  const nextTrace = cloneTrace(trace);
  const blockMeta = getRuntimeToolBlockMeta(patch.toolName, options?.segmentId);
  const blockId = blockMeta.id;
  let block = nextTrace.blocks.find((entry) => entry.id === blockId);
  if (!block) {
    block = createWorkBlock(blockId, blockMeta.title, blockMeta.stage, blockMeta.kind);
    block.status = "running";
    nextTrace.blocks.push(block);
  }
  if (options?.segmentId && blockId === options.segmentId) {
    applySegmentNarrationFields(
      block,
      options.segmentSummary,
      options.segmentThinking,
      options.segmentThinkingPresentation
    );
  }
  const toolIndex = block.toolCalls.findIndex((toolCall) => toolCall.id === patch.id);
  if (toolIndex >= 0) {
    block.toolCalls[toolIndex] = {
      ...block.toolCalls[toolIndex],
      ...patch
    };
  } else {
    block.toolCalls.push({
      id: patch.id,
      toolName: patch.toolName,
      status: patch.status ?? "pending",
      argsPreview: patch.argsPreview,
      resultPreview: patch.resultPreview,
      error: patch.error,
      startedAt: patch.startedAt ?? nowMs(),
      completedAt: patch.completedAt
    });
  }
  if (block.toolCalls.length > 0 && block.toolCalls.every((toolCall) => toolCall.status === "complete" || toolCall.status === "error")) {
    block.status = block.toolCalls.some((toolCall) => toolCall.status === "error") ? "error" : "complete";
    block.completedAt = nowMs();
  }
  nextTrace.status = "running";
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}
function applySegmentNarrationFields(block, narration, thinking, thinkingPresentation) {
  const nextNarration = narration?.trim();
  const nextThinking = thinking?.trim();
  if (nextNarration && (!block.summary || nextNarration.length >= block.summary.length)) {
    block.summary = nextNarration;
  }
  if (nextThinking && (!block.detail || nextThinking.length >= block.detail.length)) {
    block.detail = nextThinking;
    const presentation = thinkingPresentation ?? resolveThinkingPresentation(void 0, true);
    if (presentation !== "none") {
      block.thinkingPresentation = presentation;
    }
  }
}
function upsertSegmentNarration(trace, segmentId, narration, thinking, thinkingPresentation) {
  const nextTrace = cloneTrace(trace);
  let block = nextTrace.blocks.find((entry) => entry.id === segmentId);
  if (!block) {
    block = createWorkBlock(segmentId, "工具调用", "tool", "tool");
    block.status = "running";
    nextTrace.blocks.push(block);
  }
  applySegmentNarrationFields(block, narration, thinking, thinkingPresentation);
  nextTrace.status = "running";
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}
function getRuntimeToolBlockMeta(toolName, segmentId) {
  const normalizedToolName = normalizeToolName(toolName);
  if (normalizedToolName === "ask_user") {
    return {
      id: "runtime-user-input",
      title: "请求用户决策",
      stage: "decision",
      kind: "user_input"
    };
  }
  if (normalizedToolName === "agent_handoff") {
    return {
      id: "runtime-handoff",
      title: "准备交接",
      stage: "handoff",
      kind: "handoff"
    };
  }
  return {
    id: segmentId ?? "runtime-tools",
    title: "工具调用",
    stage: "tool",
    kind: "tool"
  };
}
const isSegmentTool = (toolName) => {
  const normalized = normalizeToolName(toolName);
  return normalized !== "ask_user" && normalized !== "agent_handoff";
};
function summarizeRuntimePayload(payload) {
  if ("message" in payload && typeof payload.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }
  if ("text" in payload && typeof payload.text === "string" && payload.text.trim()) {
    return payload.text.trim().slice(0, 240);
  }
  if ("error" in payload && typeof payload.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }
  if ("title" in payload && typeof payload.title === "string" && payload.title.trim()) {
    return payload.title.trim();
  }
  return "";
}
function makeConversationMessage(role, content, options) {
  const createdAt = nowMs();
  return {
    id: generateEventId(role === "user" ? "msgu" : role === "assistant" ? "msga" : "msgs"),
    turnId: options.turnId,
    sessionId: options.sessionId ?? null,
    projectId: options.projectId ?? null,
    runId: options.runId ?? null,
    modeContext: options.modeContext,
    role,
    agentId: options.agentId,
    content,
    status: options.status ?? (role === "assistant" ? "draft" : "complete"),
    updatedAt: createdAt,
    workTrace: options.workTrace ?? null,
    diagnostic: options.diagnostic ?? null,
    attachments: options.attachments,
    branchId: options.branchId ?? ROOT_BRANCH_ID,
    forkId: options.forkId,
    variantIndex: options.variantIndex,
    createdAt
  };
}
function resolveEnabledAgentDefinition(agentId) {
  return settingsService.getAll().agents.definitions.find((entry) => entry.id === agentId && entry.enabled) ?? null;
}
function getAgentLabel(agentId) {
  const definition = resolveEnabledAgentDefinition(agentId);
  return definition?.name || (isTopLevelAgentId(agentId) ? AGENT_DISPLAY_NAMES[agentId] : agentId);
}
function getAgentDescription(agentId) {
  const definition = resolveEnabledAgentDefinition(agentId);
  return definition?.description || (isTopLevelAgentId(agentId) ? AGENT_DESCRIPTIONS[agentId] : "Workspace agent profile.");
}
function redactTechnicalMessage(error) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/(Bearer\s+)[^\s"'`,;)}]+/gi, "$1[redacted]").replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret)["'\s:=]+)[^"',;\s)}]+/gi, "$1[redacted]").slice(0, 1200);
}
function createConversationDiagnostic(input) {
  return {
    code: input.code,
    severity: input.severity,
    userMessage: input.userMessage,
    agentId: input.agentId,
    providerId: input.providerId,
    modelId: input.modelId,
    adapterId: input.adapterId,
    technicalMessage: input.technicalMessage
  };
}
function resolveAgentRoutePreflight(agentId, fallbackAgentId) {
  const settings = settingsService.getAll();
  const primaryRoute = settings.llm.agentRoutes.find((entry) => entry.agentId === agentId);
  const fallbackRoute = void 0;
  const route = primaryRoute?.providerId && primaryRoute.modelId ? primaryRoute : fallbackRoute;
  const routeAgentId = route?.agentId ?? agentId;
  const label = getAgentLabel(agentId);
  if (!route?.providerId || !route.modelId) {
    return {
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: "CONVERSATION_LLM_ROUTE_MISSING",
        severity: "warning",
        userMessage: `当前 ${label} 链路还没绑定可用模型。请在 Settings 中为 \`${agentId}\` 选择 provider 和 model route。`
      })
    };
  }
  const provider = settings.llm.providers.find((entry) => entry.id === route.providerId);
  if (!provider || !provider.enabled || !provider.isConfigured) {
    return {
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: "CONVERSATION_LLM_PROVIDER_UNAVAILABLE",
        severity: "error",
        userMessage: `当前 ${label} 链路的 provider 不可用：${route.providerId}。请检查该服务商的连接状态、账号或密钥后重试。`,
        providerId: route.providerId,
        modelId: route.modelId,
        technicalMessage: provider?.lastError ?? provider?.unavailableReason
      })
    };
  }
  if (provider.status !== "verified") {
    return {
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: "CONVERSATION_LLM_PROVIDER_UNAVAILABLE",
        severity: "error",
        userMessage: `Current ${label} route provider is not verified: ${route.providerId}. Verify the provider in Settings before running agent tools.`,
        providerId: route.providerId,
        modelId: route.modelId,
        technicalMessage: provider.lastError ?? provider.unavailableReason
      })
    };
  }
  const model = provider.models.find((entry) => entry.id === route.modelId);
  if (!model?.enabled) {
    return {
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: "CONVERSATION_LLM_ROUTE_MISSING",
        severity: "warning",
        userMessage: `当前 ${label} 链路的模型不可用：${route.providerId}/${route.modelId}。请在 Settings 中刷新模型列表或重新选择 route。`,
        providerId: route.providerId,
        modelId: route.modelId
      })
    };
  }
  return {
    ok: true,
    agentId,
    routeAgentId,
    providerId: route.providerId,
    modelId: route.modelId,
    routeCapability: resolveAgentRouteCapability(provider, route.modelId)
  };
}
function recordLlmDiagnostic(context2, diagnostic) {
  runtimeLogService.log({
    scope: context2.session?.sessionId ? "session" : "app",
    namespace: "llm",
    severity: diagnostic.severity === "error" ? "error" : "warning",
    title: `${diagnostic.agentId ?? "debugger"} -> ${diagnostic.providerId ?? "route missing"}${diagnostic.modelId ? `/${diagnostic.modelId}` : ""}`,
    summary: diagnostic.userMessage,
    detail: diagnostic.technicalMessage,
    sessionId: context2.session?.sessionId ?? null,
    projectId: context2.projectId,
    runId: isActiveRun(context2.currentRun) ? context2.currentRun.runId : null,
    raw: {
      code: diagnostic.code,
      agentId: diagnostic.agentId,
      providerId: diagnostic.providerId,
      modelId: diagnostic.modelId,
      adapterId: diagnostic.adapterId
    }
  });
}
function createRequestFailedDiagnostic(route, error) {
  const label = getAgentLabel(route.agentId);
  return createConversationDiagnostic({
    agentId: route.agentId,
    code: "CONVERSATION_LLM_REQUEST_FAILED",
    severity: "error",
    userMessage: `模型请求失败：${label} 当前使用 ${route.providerId}/${route.modelId}，但服务商请求没有成功。请检查该账号、模型权限、额度或网络状态后重试。`,
    providerId: route.providerId,
    modelId: route.modelId,
    technicalMessage: redactTechnicalMessage(error)
  });
}
class ConversationService {
  activeTurns = /* @__PURE__ */ new Map();
  promptAssembler = new PromptAssembler();
  /**
   * 待处理的 handoff（sessionId → {toProfile, prompt}）。
   *
   * agent_handoff 工具成功后由 AgentOrchestrator.consumePendingHandoff 消费并存入此 map，
   * 下次该 session 消息时优先用 toProfile 并把 prompt 前置到用户消息。
   * 内存维护（不持久化），session 重启后丢失（handoff 是即时意图）。
   */
  pendingHandoffs = /* @__PURE__ */ new Map();
  async getHistory(sessionId) {
    const allMessages = storageAdapter.readConversationHistory(sessionId);
    const branchState = storageAdapter.readConversationBranchState(sessionId);
    return {
      messages: resolveVisibleConversationMessages(allMessages, branchState),
      branchState
    };
  }
  async clearHistory(sessionId) {
    storageAdapter.writeConversationHistory(sessionId, []);
    this.publishConversationTrace(sessionId, [], sessionId);
    return [];
  }
  async undoLastTurn(sessionId) {
    const history = storageAdapter.readConversationHistory(sessionId);
    const lastUserMessage = history.slice().reverse().find((message) => message.role === "user");
    if (!lastUserMessage) {
      return history;
    }
    const nextHistory = history.filter((message) => message.turnId !== lastUserMessage.turnId);
    storageAdapter.writeConversationHistory(sessionId, nextHistory);
    this.publishConversationTrace(sessionId, nextHistory, sessionId);
    return nextHistory;
  }
  async compactHistory(sessionId) {
    const history = storageAdapter.readConversationHistory(sessionId);
    const keepCount = 6;
    if (history.length <= keepCount + 1) {
      return history;
    }
    const head = history.slice(0, -keepCount);
    const tail = history.slice(-keepCount);
    const compactedAt = nowMs();
    const summaryMessage = {
      id: `compact-${compactedAt}`,
      turnId: `compact-turn-${compactedAt}`,
      sessionId,
      projectId: tail[0]?.projectId ?? head[0]?.projectId ?? null,
      role: "system",
      content: `Context compacted: ${head.length} earlier messages summarized. User messages: ${head.filter((message) => message.role === "user").length}; assistant messages: ${head.filter((message) => message.role === "assistant").length}; system messages: ${head.filter((message) => message.role === "system").length}.`,
      status: "complete",
      createdAt: compactedAt,
      updatedAt: compactedAt,
      workTrace: {
        status: "complete",
        summary: `Compacted ${head.length} earlier messages.`,
        blocks: [],
        updatedAt: compactedAt
      }
    };
    const nextHistory = [summaryMessage, ...tail];
    storageAdapter.writeConversationHistory(sessionId, nextHistory);
    this.publishConversationTrace(sessionId, nextHistory, sessionId);
    return nextHistory;
  }
  async cancelActiveTurn(request2 = {}) {
    const candidates = Array.from(this.activeTurns.values()).filter((turn) => !request2.turnId || turn.turnId === request2.turnId).filter((turn) => !request2.sessionId || turn.sessionId === request2.sessionId).sort((left, right) => right.startedAt - left.startedAt);
    const target = candidates[0];
    if (!target) {
      return { success: false, error: "No active conversation turn." };
    }
    target.stop();
    return {
      success: true,
      cancelledTurnId: target.turnId
    };
  }
  answerUserInput(request2) {
    return agentUserInputRequestService.answer(request2);
  }
  answerToolApproval(request2) {
    return agentToolApprovalRequestService.answer(request2);
  }
  registerActiveTurn(turn) {
    this.activeTurns.set(turn.turnId, turn);
  }
  clearActiveTurn(turnId, controller) {
    const active = this.activeTurns.get(turnId);
    if (active?.abortController === controller) {
      this.activeTurns.delete(turnId);
    }
  }
  async sendMessage(input) {
    const trimmed = input.message.trim();
    const context2 = await this.resolveContext(input);
    return this.startProfileTurn(context2, input.mode, input.agentId ?? null, trimmed, input.attachments ?? []);
  }
  async rewriteFromMessage(input) {
    const trimmed = input.message.trim();
    const context2 = await this.resolveContext(input);
    const sessionId = input.sessionId ?? context2.session?.sessionId ?? null;
    if (!sessionId) {
      return this.startProfileTurn(context2, input.mode, input.agentId ?? null, trimmed, input.attachments ?? []);
    }
    const history = storageAdapter.readConversationHistory(sessionId);
    const targetIndex = history.findIndex((message) => message.id === input.messageId);
    const targetMessage = targetIndex >= 0 ? history[targetIndex] : null;
    if (!targetMessage || targetMessage.role !== "user") {
      throw new Error("Can only edit and resend an existing user message.");
    }
    const downstreamTurnIds = new Set(
      history.slice(targetIndex + 1).map((message) => message.turnId)
    );
    for (const activeTurn of Array.from(this.activeTurns.values())) {
      if (activeTurn.sessionId === sessionId && downstreamTurnIds.has(activeTurn.turnId)) {
        activeTurn.stop();
      }
    }
    let branchState = storageAdapter.readConversationBranchState(sessionId) ?? createDefaultBranchState(sessionId);
    const targetBranchId = normalizeBranchId(targetMessage.branchId);
    const forkId = targetMessage.forkId ?? targetMessage.id;
    const anchorMessageId = branchState.forks.find((fork2) => fork2.forkId === forkId)?.anchorMessageId ?? targetMessage.id;
    let fork = branchState.forks.find((entry) => entry.forkId === forkId);
    if (!fork) {
      fork = {
        forkId,
        anchorMessageId,
        activeBranchId: targetBranchId,
        branches: [{
          branchId: targetBranchId,
          parentBranchId: null,
          variantIndex: targetMessage.variantIndex ?? 0,
          anchorUserMessageId: targetMessage.id,
          rootTurnId: targetMessage.turnId
        }]
      };
      branchState.forks.push(fork);
      if (!targetMessage.forkId) {
        targetMessage.forkId = forkId;
        targetMessage.variantIndex = targetMessage.variantIndex ?? 0;
        storageAdapter.appendConversationMessage(sessionId, {
          ...targetMessage,
          updatedAt: nowMs()
        });
      }
    } else if (!fork.branches.some((branch) => branch.anchorUserMessageId === targetMessage.id)) {
      const variantIndex2 = targetMessage.variantIndex ?? fork.branches.length;
      if (!fork.branches.some((branch) => branch.variantIndex === variantIndex2)) {
        fork.branches.push({
          branchId: targetBranchId,
          parentBranchId: fork.branches[0]?.parentBranchId ?? null,
          variantIndex: variantIndex2,
          anchorUserMessageId: targetMessage.id,
          rootTurnId: targetMessage.turnId
        });
      }
    }
    const newBranchId = generateEventId("branch");
    const variantIndex = fork.branches.length;
    fork.branches.push({
      branchId: newBranchId,
      parentBranchId: targetBranchId,
      variantIndex,
      anchorUserMessageId: "",
      rootTurnId: ""
    });
    fork.activeBranchId = newBranchId;
    branchState.activeLeafBranchId = newBranchId;
    storageAdapter.writeConversationBranchState(sessionId, branchState);
    const updatedContext = {
      ...context2,
      session: storageAdapter.readSession(sessionId) ?? context2.session
    };
    return this.startProfileTurn(
      updatedContext,
      input.mode,
      input.agentId ?? null,
      trimmed,
      input.attachments ?? [],
      {
        branchId: newBranchId,
        forkId,
        variantIndex
      },
      fork
    );
  }
  async switchConversationBranch(input) {
    const branchState = storageAdapter.readConversationBranchState(input.sessionId);
    if (!branchState) {
      return { success: false, messages: [], error: "No conversation branch state found." };
    }
    const fork = branchState.forks.find((entry) => entry.forkId === input.forkId);
    const branch = fork?.branches.find((entry) => entry.branchId === input.branchId);
    if (!fork || !branch) {
      return { success: false, messages: [], error: "Invalid conversation branch selection." };
    }
    fork.activeBranchId = input.branchId;
    branchState.activeLeafBranchId = input.branchId;
    storageAdapter.writeConversationBranchState(input.sessionId, branchState);
    const allMessages = storageAdapter.readConversationHistory(input.sessionId);
    const visibleMessages = resolveVisibleConversationMessages(allMessages, branchState);
    const tracePresentation = await traceService.buildConversationPresentation(input.sessionId, visibleMessages);
    workflowProjectionPublisher.publishTraceProjectionChanged(input.sessionId, tracePresentation);
    this.publishConversationTrace(input.sessionId, visibleMessages, input.sessionId);
    return {
      success: true,
      messages: visibleMessages,
      branchState,
      tracePresentation
    };
  }
  async resolveContext(input) {
    const projectId = input.projectId ?? input.fallbackProjectId ?? storageAdapter.getCurrentProjectId() ?? null;
    const persistedSessionId = await storageAdapter.getCurrentSessionId();
    const resolvedSessionId = input.sessionId ?? input.fallbackSessionId ?? persistedSessionId ?? null;
    const session = resolvedSessionId ? storageAdapter.readSession(resolvedSessionId) : null;
    const currentRun = resolvedSessionId ? storageAdapter.listRuns(resolvedSessionId).find((entry) => entry.runId === (input.currentRunId ?? input.fallbackRunId)) ?? storageAdapter.getLatestRun(resolvedSessionId) : null;
    const projectInputs = projectId ? storageAdapter.listProjectInputs(projectId) : [];
    const openedCapture = rdxSessionService.snapshotOpenedCapture();
    const activeOpenedCapture = openedCapture?.projectId === projectId && openedCapture.status === "open" ? openedCapture : null;
    const replayDevice = replayDeviceService.getDeviceById(input.replayDeviceId || "local") ?? replayDeviceService.getDeviceById("local");
    return {
      projectId,
      session,
      currentRun,
      projectInputs,
      openedCapture: activeOpenedCapture,
      openedCapturePath: activeOpenedCapture?.filePath ?? null,
      replayDevice
    };
  }
  async startProfileTurn(context2, requestedMode, requestedAgentId, rawMessage, pendingAttachments, branchContext, forkToUpdate) {
    let workingSession = context2.session;
    if (!workingSession && context2.projectId) {
      workingSession = storageAdapter.createSession(context2.projectId, rawMessage.slice(0, 80));
    }
    let effectiveMessage = rawMessage;
    let handoffProfile = null;
    if (workingSession) {
      const pending = this.pendingHandoffs.get(workingSession.sessionId);
      if (pending && resolveEnabledAgentDefinition(pending.toProfile)) {
        handoffProfile = pending.toProfile;
        this.pendingHandoffs.delete(workingSession.sessionId);
        effectiveMessage = `${pending.prompt}

---
用户消息：${rawMessage}`;
      }
    }
    const conversationAgentId = handoffProfile ?? resolveConversationAgentId(requestedMode, requestedAgentId);
    const turnId = generateEventId("turn");
    const sessionIdForBranch = workingSession?.sessionId ?? null;
    let branchState = sessionIdForBranch ? storageAdapter.readConversationBranchState(sessionIdForBranch) : null;
    if (sessionIdForBranch && !branchState) {
      branchState = createDefaultBranchState(sessionIdForBranch);
      storageAdapter.writeConversationBranchState(sessionIdForBranch, branchState);
    }
    const branchId = branchContext?.branchId ?? branchState?.activeLeafBranchId ?? ROOT_BRANCH_ID;
    const importedAttachments = workingSession ? storageAdapter.importSessionAttachments(
      workingSession.sessionId,
      pendingAttachments.map((entry) => entry.sourcePath)
    ) : [];
    const userMessage = makeConversationMessage("user", rawMessage, {
      turnId,
      sessionId: workingSession?.sessionId ?? null,
      projectId: context2.projectId,
      runId: isActiveRun(context2.currentRun) ? context2.currentRun.runId : null,
      modeContext: requestedMode,
      attachments: importedAttachments,
      status: "complete",
      branchId,
      forkId: branchContext?.forkId,
      variantIndex: branchContext?.variantIndex
    });
    if (forkToUpdate && sessionIdForBranch && branchState) {
      const pendingBranch = forkToUpdate.branches.find((entry) => entry.branchId === branchId);
      if (pendingBranch) {
        pendingBranch.anchorUserMessageId = userMessage.id;
        pendingBranch.rootTurnId = turnId;
      }
      forkToUpdate.activeBranchId = branchId;
      branchState.activeLeafBranchId = branchId;
      storageAdapter.writeConversationBranchState(sessionIdForBranch, branchState);
    } else if (sessionIdForBranch && branchState && branchContext?.branchId) {
      branchState.activeLeafBranchId = branchContext.branchId;
      storageAdapter.writeConversationBranchState(sessionIdForBranch, branchState);
    }
    const assistantDraftMessage = makeConversationMessage("assistant", "", {
      turnId,
      sessionId: workingSession?.sessionId ?? null,
      projectId: context2.projectId,
      runId: isActiveRun(context2.currentRun) ? context2.currentRun.runId : null,
      modeContext: requestedMode,
      agentId: conversationAgentId,
      status: "streaming",
      workTrace: createDraftWorkTrace(),
      branchId
    });
    this.persistConversationSnapshot(workingSession?.sessionId ?? null, userMessage);
    this.persistConversationSnapshot(workingSession?.sessionId ?? null, assistantDraftMessage);
    const traceSessionId = workingSession?.sessionId ?? this.ephemeralTraceSessionId(turnId);
    const tracePresentation = await traceService.buildConversationPresentation(
      traceSessionId,
      [userMessage, assistantDraftMessage]
    );
    workflowProjectionPublisher.publishTraceProjectionChanged(traceSessionId, tracePresentation);
    this.publishConversationTrace(traceSessionId, [userMessage, assistantDraftMessage], workingSession?.sessionId ?? null);
    void this.completeProfileTurn({
      context: {
        ...context2,
        session: workingSession
      },
      requestedMode,
      requestedAgentId: conversationAgentId,
      rawMessage: effectiveMessage,
      importedAttachments,
      userMessage,
      assistantDraftMessage
    });
    return {
      session: workingSession,
      mode: "talk",
      userMessage,
      assistantDraftMessage,
      executionTransition: { action: "none" },
      runUpdate: null,
      tracePresentation,
      errorViewModel: null
    };
  }
  async completeProfileTurn(input) {
    let assistantMessage = input.assistantDraftMessage;
    const sessionId = input.context.session?.sessionId ?? null;
    const traceSessionId = sessionId ?? this.ephemeralTraceSessionId(input.assistantDraftMessage.turnId);
    const abortController = new AbortController();
    const conversationAgentId = input.requestedAgentId;
    const agentLabel = getAgentLabel(conversationAgentId);
    const commitAssistantMessage = (type, patch) => {
      if (abortController.signal.aborted && patch.status !== "stopped") {
        return;
      }
      assistantMessage = {
        ...assistantMessage,
        ...patch,
        updatedAt: nowMs()
      };
      this.persistConversationSnapshot(sessionId, assistantMessage);
      this.emitConversationEvent({
        type,
        sessionId: sessionId ?? "",
        turnId: assistantMessage.turnId,
        message: assistantMessage
      });
      this.publishConversationTrace(traceSessionId, [input.userMessage, assistantMessage], sessionId);
    };
    const commitStoppedMessage = () => {
      commitAssistantMessage("message_completed", {
        status: "stopped",
        content: assistantMessage.content || "当前请求已停止。",
        workTrace: finalizeTrace(
          upsertWorkBlock(assistantMessage.workTrace, "assistant-output", {
            status: "complete",
            summary: "用户已停止当前请求。",
            completedAt: nowMs()
          }),
          "stopped",
          "请求已停止"
        )
      });
    };
    this.registerActiveTurn({
      turnId: assistantMessage.turnId,
      sessionId,
      startedAt: nowMs(),
      abortController,
      stop: () => {
        if (!abortController.signal.aborted) {
          abortController.abort();
          commitStoppedMessage();
        }
      }
    });
    const commitVisibleAssistantText = () => {
      commitAssistantMessage("message_patched", {
        status: "streaming",
        content: visibleResponse
      });
    };
    const withWorkTrace = (workTrace) => ({ workTrace });
    let rawResponse = "";
    let visibleResponse = "";
    let currentSegmentText = "";
    let currentSegmentThinking = "";
    let segmentSeq = 1;
    let segmentHasTools = false;
    let pendingNewSegment = false;
    const currentSegmentId = () => `runtime-segment-${segmentSeq}`;
    let errorViewModel = null;
    let llmDiagnostic = null;
    const routePreflight = resolveAgentRoutePreflight(conversationAgentId);
    const segmentThinkingPresentation = () => routePreflight.ok ? resolveThinkingPresentation(routePreflight.routeCapability.reasoningDelivery, Boolean(currentSegmentThinking.trim())) : "none";
    const currentSegmentOptions = () => ({
      segmentId: currentSegmentId(),
      segmentSummary: currentSegmentText.trim() || void 0,
      segmentThinking: currentSegmentThinking.trim() || void 0,
      segmentThinkingPresentation: segmentThinkingPresentation()
    });
    if (!routePreflight.ok) {
      llmDiagnostic = routePreflight.diagnostic;
      errorViewModel = {
        code: llmDiagnostic.code,
        message: llmDiagnostic.userMessage,
        technicalMessage: llmDiagnostic.technicalMessage
      };
      rawResponse = llmDiagnostic.userMessage;
      visibleResponse = llmDiagnostic.userMessage;
      recordLlmDiagnostic(input.context, llmDiagnostic);
      commitVisibleAssistantText();
      commitAssistantMessage("message_patched", {
        ...withWorkTrace(upsertWorkBlock(assistantMessage.workTrace, "runtime-route-diagnostic", {
          kind: "diagnostic",
          status: llmDiagnostic.severity === "error" ? "error" : "complete",
          title: "模型路由诊断",
          stage: "preflight",
          summary: llmDiagnostic.userMessage,
          detail: llmDiagnostic.technicalMessage,
          completedAt: nowMs()
        }))
      });
    } else {
      try {
        const definition = resolveEnabledAgentDefinition(conversationAgentId);
        const promptDefinition = {
          agentId: conversationAgentId,
          agentLabel,
          agentDescription: getAgentDescription(conversationAgentId),
          baseInstructions: definition?.instructions,
          globalInstructions: settingsService.getAll().agents.globalInstructions
        };
        const allowedToolNames = resolveAgentToolAllowlist(conversationAgentId, "investigate").map((toolName) => normalizeToolName(toolName));
        const projectRootPath = input.context.projectId ? storageAdapter.getProjectById(input.context.projectId)?.rootPath ?? null : null;
        const memoryIndex = await agentOrchestrator.getMemoryIndex();
        const promptContext = {
          workDir: projectRootPath ?? "",
          tools: allowedToolNames,
          memoryIndex: memoryIndex || void 0,
          model: {
            provider: routePreflight.routeCapability.providerId,
            name: routePreflight.routeCapability.modelId
          },
          mode: this.modeForProfile(conversationAgentId),
          profile: promptDefinition,
          routeCapability: routePreflight.routeCapability,
          permissionSettings: settingsService.getAll().agentRuntime.permissions,
          allowedToolNames
        };
        const systemPrompt = this.promptAssembler.assembleSystemPrompt(promptContext);
        const promptMetrics = this.promptAssembler.measureSections(promptContext);
        const responseText = await agentOrchestrator.sendProfileMessage(
          conversationAgentId,
          input.rawMessage,
          {
            sessionId: input.context.session?.sessionId,
            turnId: assistantMessage.turnId,
            stage: "investigate",
            patternId: "free-agent",
            projectRootPath,
            projectId: input.context.projectId,
            systemPrompt,
            promptMetrics,
            maxTokens: 1200,
            temperature: 0.35,
            signal: abortController.signal,
            onEvent: (event) => {
              this.emitConversationEvent({
                type: "agent_event",
                sessionId: sessionId ?? "",
                turnId: assistantMessage.turnId,
                event
              });
              if (event.type === "run.started") {
                const payload = event.payload;
                const details = [
                  payload.providerId && payload.modelId ? `Model: ${payload.providerId} / ${payload.modelId}` : "",
                  Array.isArray(payload.toolAllowlist) && payload.toolAllowlist.length > 0 ? `Tools: ${payload.toolAllowlist.join(", ")}` : ""
                ].filter(Boolean).join("\n");
                commitAssistantMessage("message_patched", {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, "runtime-run", {
                    kind: "reasoning",
                    title: "启动 Agent Loop",
                    stage: "preflight",
                    status: "running",
                    summary: `${agentLabel} 已进入模型与工具循环。`,
                    detail: details || void 0,
                    startedAt: nowMs()
                  })
                });
              }
              if (event.type === "assistant.delta") {
                const chunk = typeof event.payload.text === "string" ? event.payload.text : "";
                if (chunk) {
                  if (pendingNewSegment) {
                    segmentSeq += 1;
                    currentSegmentText = "";
                    currentSegmentThinking = "";
                    segmentHasTools = false;
                    pendingNewSegment = false;
                    visibleResponse = "";
                  }
                  rawResponse += chunk;
                  currentSegmentText += chunk;
                  visibleResponse = currentSegmentText;
                  commitVisibleAssistantText();
                }
              }
              if (event.type === "assistant.thinking_delta") {
                const chunk = typeof event.payload.text === "string" ? event.payload.text : "";
                if (chunk) {
                  currentSegmentThinking += chunk;
                  commitAssistantMessage("message_patched", {
                    workTrace: upsertSegmentNarration(
                      assistantMessage.workTrace,
                      currentSegmentId(),
                      void 0,
                      currentSegmentThinking,
                      segmentThinkingPresentation()
                    )
                  });
                }
              }
              if (event.type === "assistant.thinking_end") {
                const text = typeof event.payload.text === "string" ? event.payload.text.trim() : "";
                if (text && text.length >= currentSegmentThinking.length) {
                  currentSegmentThinking = text;
                  commitAssistantMessage("message_patched", {
                    workTrace: upsertSegmentNarration(
                      assistantMessage.workTrace,
                      currentSegmentId(),
                      void 0,
                      currentSegmentThinking,
                      segmentThinkingPresentation()
                    )
                  });
                }
              }
              if (event.type === "diagnostic") {
                const payload = event.payload;
                const summary = typeof payload.message === "string" && payload.message ? payload.message : "Received runtime diagnostic.";
                if (payload.code === "MODEL_THINKING_STARTED" || payload.code === "MODEL_THINKING_COMPLETED") {
                  return;
                }
                commitAssistantMessage("message_patched", {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, `runtime-diagnostic-${payload.code ?? "runtime"}`, {
                    kind: "diagnostic",
                    status: payload.severity === "error" ? "error" : "complete",
                    title: "Runtime diagnostic",
                    summary,
                    completedAt: nowMs()
                  })
                });
              }
              if (event.type === "tool.requested") {
                const payload = event.payload;
                if (payload.toolCall?.id && payload.toolCall.name) {
                  const segmented = isSegmentTool(String(payload.toolCall.name));
                  if (segmented) segmentHasTools = true;
                  commitAssistantMessage("message_patched", {
                    workTrace: upsertRuntimeToolCall(assistantMessage.workTrace, {
                      id: String(payload.toolCall.id),
                      toolName: String(payload.toolCall.name),
                      status: "pending",
                      argsPreview: JSON.stringify(payload.toolCall.arguments ?? {}).slice(0, 600),
                      startedAt: nowMs()
                    }, segmented ? currentSegmentOptions() : void 0)
                  });
                }
              }
              if (event.type === "tool.started") {
                const segmented = isSegmentTool(String(event.payload.toolName));
                if (segmented) segmentHasTools = true;
                commitAssistantMessage("message_patched", {
                  workTrace: upsertRuntimeToolCall(assistantMessage.workTrace, {
                    id: String(event.payload.toolCallId),
                    toolName: String(event.payload.toolName),
                    status: "running",
                    argsPreview: JSON.stringify(event.payload.args ?? {}).slice(0, 600),
                    startedAt: nowMs()
                  }, segmented ? currentSegmentOptions() : void 0)
                });
              }
              if (event.type === "tool.denied") {
                const reason = typeof event.payload.reason === "string" ? event.payload.reason : "Profile policy denied this tool call.";
                const segmentedDenied = isSegmentTool(String(event.payload.toolName));
                if (segmentedDenied) segmentHasTools = true;
                commitAssistantMessage("message_patched", {
                  workTrace: upsertRuntimeToolCall(assistantMessage.workTrace, {
                    id: String(event.payload.toolCallId),
                    toolName: String(event.payload.toolName),
                    status: "error",
                    resultPreview: JSON.stringify(event.payload.result ?? { reason }).slice(0, 800),
                    error: reason,
                    completedAt: nowMs()
                  }, segmentedDenied ? currentSegmentOptions() : void 0)
                });
              }
              if (event.type === "approval.requested") {
                const payload = event.payload;
                const approvalId = payload.approvalId ?? `approval-${payload.toolCallId ?? "runtime"}`;
                const toolCallId = String(payload.toolCallId ?? approvalId);
                const toolName = String(payload.toolName ?? "approval");
                if (payload.kind === "ask_user" || normalizeToolName(toolName) === "ask_user") {
                  const question = typeof payload.question === "string" && payload.question ? payload.question : typeof payload.reason === "string" && payload.reason ? payload.reason : "The agent needs user input before continuing.";
                  commitAssistantMessage("message_patched", {
                    workTrace: upsertRuntimeToolCall(assistantMessage.workTrace, {
                      id: toolCallId,
                      toolName: "ask_user",
                      status: "running",
                      argsPreview: JSON.stringify({
                        question,
                        choices: Array.isArray(payload.options) ? payload.options : []
                      }).slice(0, 600),
                      startedAt: nowMs()
                    })
                  });
                  return;
                }
                const reason = typeof payload.reason === "string" && payload.reason ? payload.reason : "This action requires user approval before it can run.";
                const traceWithTool = upsertRuntimeToolCall(assistantMessage.workTrace, {
                  id: toolCallId,
                  toolName,
                  status: "running",
                  resultPreview: reason
                }, currentSegmentOptions());
                commitAssistantMessage("message_patched", {
                  workTrace: upsertWorkBlock(traceWithTool, `runtime-approval-${approvalId}`, {
                    kind: "approval",
                    title: "请求批准",
                    stage: "decision",
                    status: "running",
                    summary: reason,
                    detail: JSON.stringify({
                      approvalId,
                      toolCallId,
                      toolName,
                      risk: payload.risk,
                      reviewer: payload.reviewer
                    }, null, 2)
                  })
                });
              }
              if (event.type === "approval.answered") {
                const payload = event.payload;
                const approvalId = payload.approvalId ?? "runtime";
                if (payload.kind === "ask_user" || normalizeToolName(String(payload.toolName ?? "")) === "ask_user") {
                  const failed = payload.status === "rejected" || payload.status === "cancelled";
                  const answerText = payload.answer === void 0 || payload.answer === null ? "" : typeof payload.answer === "string" ? payload.answer.trim() : String(payload.answer).trim();
                  commitAssistantMessage("message_patched", {
                    workTrace: upsertRuntimeToolCall(assistantMessage.workTrace, {
                      id: String(payload.toolCallId ?? approvalId),
                      toolName: "ask_user",
                      status: failed ? "error" : "running",
                      resultPreview: failed ? String(payload.answer ?? "User input request was cancelled.") : answerText || "User answered.",
                      error: failed ? String(payload.answer ?? "User input request was cancelled.") : void 0,
                      completedAt: failed ? nowMs() : void 0
                    })
                  });
                  return;
                }
                commitAssistantMessage("message_patched", {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, `runtime-approval-${approvalId}`, {
                    kind: "approval",
                    title: "审批结果",
                    stage: "decision",
                    status: payload.status === "rejected" || payload.status === "cancelled" ? "error" : "complete",
                    summary: `审批状态：${payload.status ?? "answered"}`,
                    detail: payload.answer === void 0 ? void 0 : JSON.stringify(payload.answer).slice(0, 800),
                    completedAt: nowMs()
                  })
                });
              }
              if (event.type === "tool.completed") {
                const result = event.payload.result;
                const isAskUserTool = normalizeToolName(String(event.payload.toolName)) === "ask_user";
                const toolCallPatch = {
                  id: String(event.payload.toolCallId),
                  toolName: String(event.payload.toolName),
                  status: result?.ok ? "complete" : "error",
                  error: result?.ok ? void 0 : result?.error?.message,
                  completedAt: nowMs()
                };
                if (!(isAskUserTool && result?.ok)) {
                  toolCallPatch.resultPreview = JSON.stringify(event.payload.result ?? {}).slice(0, 800);
                }
                const segmentedCompleted = isSegmentTool(String(event.payload.toolName));
                commitAssistantMessage("message_patched", {
                  workTrace: upsertRuntimeToolCall(
                    assistantMessage.workTrace,
                    toolCallPatch,
                    segmentedCompleted ? currentSegmentOptions() : void 0
                  )
                });
              }
              if (event.type === "task.created" || event.type === "task.updated") {
                const payload = event.payload;
                commitAssistantMessage("message_patched", {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, "runtime-tasks", {
                    kind: "subagent",
                    title: "任务状态",
                    stage: "tool",
                    status: payload.status === "failed" ? "error" : "complete",
                    summary: `${payload.title ?? payload.taskId ?? "Task"}${payload.status ? `：${payload.status}` : ""}`,
                    completedAt: nowMs()
                  })
                });
              }
              if (event.type === "subagent.started") {
                const payload = event.payload;
                commitAssistantMessage("message_patched", {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, `subagent-${payload.subagentId}`, {
                    kind: "subagent",
                    title: `子 Agent：${payload.profile}`,
                    stage: "tool",
                    status: "running",
                    summary: payload.text?.slice(0, 200) ?? ""
                  })
                });
              }
              if (event.type === "subagent.delta") {
                const payload = event.payload;
                commitAssistantMessage("message_patched", {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, `subagent-${payload.subagentId}`, {
                    kind: "subagent",
                    title: `子 Agent`,
                    stage: "tool",
                    status: "running",
                    summary: payload.text ? payload.text.slice(-200) : void 0
                  })
                });
              }
              if (event.type === "subagent.completed") {
                const payload = event.payload;
                commitAssistantMessage("message_patched", {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, `subagent-${payload.subagentId}`, {
                    kind: "subagent",
                    title: `子 Agent：${payload.profile}`,
                    stage: "tool",
                    status: payload.status === "failed" ? "error" : "complete",
                    summary: payload.text?.slice(0, 500) ?? "",
                    detail: payload.text,
                    completedAt: nowMs()
                  })
                });
              }
              if (event.type === "assistant.completed") {
                const payload = event.payload;
                const narration = typeof payload.text === "string" ? payload.text.trim() : "";
                const thinking = (typeof payload.thinkingText === "string" ? payload.thinkingText.trim() : "") || currentSegmentThinking.trim();
                if (thinking) {
                  currentSegmentThinking = thinking;
                }
                if (narration || thinking) {
                  commitAssistantMessage("message_patched", {
                    workTrace: upsertSegmentNarration(
                      assistantMessage.workTrace,
                      currentSegmentId(),
                      narration || void 0,
                      thinking || void 0,
                      thinking ? segmentThinkingPresentation() : void 0
                    )
                  });
                }
                if (segmentHasTools) {
                  pendingNewSegment = true;
                }
                commitAssistantMessage("message_patched", {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, "assistant-output", {
                    kind: "output",
                    title: "生成最终回答",
                    stage: "respond",
                    status: "complete",
                    summary: "最终回答已生成。",
                    completedAt: nowMs()
                  })
                });
              }
              if (event.type === "run.completed") {
                commitAssistantMessage("message_patched", {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, "runtime-run", {
                    kind: "reasoning",
                    title: "Agent Loop 完成",
                    stage: "respond",
                    status: "complete",
                    summary: "模型与工具循环已完成。",
                    completedAt: nowMs()
                  })
                });
              }
              if (event.type === "run.failed" || event.type === "run.cancelled") {
                const failed = event.type === "run.failed";
                commitAssistantMessage("message_patched", {
                  workTrace: upsertWorkBlock(assistantMessage.workTrace, `runtime-${event.type}`, {
                    kind: "diagnostic",
                    title: failed ? "Agent Loop 失败" : "Agent Loop 已取消",
                    stage: "respond",
                    status: failed ? "error" : "complete",
                    summary: summarizeRuntimePayload(event.payload) || (failed ? "Agent Loop 失败。" : "Agent Loop 已取消。"),
                    completedAt: nowMs()
                  })
                });
              }
            }
          }
        );
        if (!rawResponse) {
          rawResponse = responseText;
        }
      } catch (error) {
        llmDiagnostic = createRequestFailedDiagnostic(routePreflight, error);
        errorViewModel = {
          code: llmDiagnostic.code,
          message: llmDiagnostic.userMessage,
          technicalMessage: llmDiagnostic.technicalMessage
        };
        rawResponse = llmDiagnostic.userMessage;
        visibleResponse = llmDiagnostic.userMessage;
        currentSegmentText = llmDiagnostic.userMessage;
        recordLlmDiagnostic(input.context, llmDiagnostic);
        commitVisibleAssistantText();
      }
    }
    if (abortController.signal.aborted) {
      this.clearActiveTurn(assistantMessage.turnId, abortController);
      return;
    }
    const assistantContent = (currentSegmentText.trim() || rawResponse || visibleResponse).trim();
    visibleResponse = assistantContent;
    const isRouteMissingDiagnostic = llmDiagnostic?.code === "CONVERSATION_LLM_ROUTE_MISSING";
    const finalStatus = errorViewModel && !isRouteMissingDiagnostic ? "error" : "complete";
    const traceStatus = errorViewModel && !isRouteMissingDiagnostic ? "error" : "complete";
    if (abortController.signal.aborted) {
      this.clearActiveTurn(assistantMessage.turnId, abortController);
      return;
    }
    const outputSummary = llmDiagnostic ? llmDiagnostic.code === "CONVERSATION_LLM_REQUEST_FAILED" ? "模型请求失败，已记录诊断。" : "模型链路不可用，已给出配置诊断。" : "最终回答已生成。";
    commitAssistantMessage(finalStatus === "error" ? "message_errored" : "message_completed", {
      status: finalStatus,
      content: assistantContent,
      diagnostic: llmDiagnostic,
      ...withWorkTrace(finalizeTrace(
        upsertWorkBlock(assistantMessage.workTrace, "assistant-output", {
          kind: "output",
          status: finalStatus === "error" ? "error" : "complete",
          summary: outputSummary,
          detail: llmDiagnostic?.technicalMessage,
          completedAt: nowMs()
        }),
        traceStatus,
        llmDiagnostic ? finalStatus === "error" ? "回复失败" : "等待模型配置" : "回复已完成"
      ))
    });
    if (finalStatus !== "error" && input.context.session) {
      const handoff = agentOrchestrator.consumePendingHandoff();
      if (handoff && handoff.toProfile && resolveEnabledAgentDefinition(handoff.toProfile)) {
        this.pendingHandoffs.set(input.context.session.sessionId, {
          toProfile: handoff.toProfile,
          prompt: handoff.prompt
        });
        this.emitConversationEvent({
          type: "agent_event",
          sessionId: input.context.session.sessionId,
          turnId: assistantMessage.turnId,
          event: {
            id: generateEventId("agent-event"),
            type: "handoff.requested",
            timestamp: nowMs(),
            sessionId: input.context.session.sessionId,
            agentId: handoff.fromAgentId,
            payload: {
              fromAgentId: handoff.fromAgentId,
              toProfile: handoff.toProfile,
              prompt: handoff.prompt,
              label: handoff.label
            }
          }
        });
      }
    }
    this.clearActiveTurn(assistantMessage.turnId, abortController);
  }
  persistConversationSnapshot(sessionId, message) {
    if (sessionId) {
      storageAdapter.appendConversationMessage(sessionId, message);
    }
  }
  emitConversationEvent(event) {
    workflowProjectionPublisher.publishConversationEvent(event);
  }
  publishTraceProjection(sessionId) {
    if (!sessionId) {
      return;
    }
    void traceService.getSession(sessionId).then((result) => {
      if (result.success && result.presentation) {
        workflowProjectionPublisher.publishTraceProjectionChanged(sessionId, result.presentation);
      }
    }).catch((error) => {
      console.error("[ConversationService] Failed to publish trace projection:", error);
    });
  }
  publishConversationTrace(traceSessionId, messages, persistedSessionId) {
    if (persistedSessionId) {
      this.publishTraceProjection(persistedSessionId);
      return;
    }
    void traceService.buildConversationPresentation(traceSessionId, messages).then((presentation) => {
      workflowProjectionPublisher.publishTraceProjectionChanged(traceSessionId, presentation);
    });
  }
  ephemeralTraceSessionId(turnId) {
    return `conversation-${turnId}`;
  }
  /**
   * 将 agentId 映射为 PromptContext.mode。
   *
   * Plan 归入 ask（ReadOnly 变体），非顶层 agent 归入 edit；
   * 与 AgentOrchestrator.modeForAgent 保持一致语义。
   */
  modeForProfile(agentId) {
    if (agentId === "plan" || agentId === "ask") {
      return "ask";
    }
    if (agentId === "debugger") {
      return "debugger";
    }
    if (agentId === "analyzer") {
      return "analyzer";
    }
    if (agentId === "optimizer") {
      return "optimizer";
    }
    if (agentId === "edit") {
      return "edit";
    }
    return "edit";
  }
}
const conversationService = new ConversationService();
function registerConversationHandlers(context2) {
  const { state: state2 } = context2;
  electron.ipcMain.handle("conversation:sendMessage", async (_event, request2) => {
    const result = await conversationService.sendMessage({
      ...request2,
      fallbackProjectId: state2.currentProjectId,
      fallbackSessionId: state2.currentSessionId,
      fallbackRunId: state2.currentRunId
    });
    if (result.session?.projectId) {
      state2.currentProjectId = result.session.projectId;
    }
    if (result.session?.sessionId) {
      state2.currentSessionId = result.session.sessionId;
      await storageAdapter.setCurrentSessionId(result.session.sessionId);
    }
    if (result.runUpdate?.runId) {
      state2.currentRunId = result.runUpdate.runId;
    }
    return result;
  });
  electron.ipcMain.handle("conversation:rewriteFromMessage", async (_event, request2) => {
    const result = await conversationService.rewriteFromMessage({
      ...request2,
      fallbackProjectId: state2.currentProjectId,
      fallbackSessionId: state2.currentSessionId,
      fallbackRunId: state2.currentRunId
    });
    if (result.session?.projectId) {
      state2.currentProjectId = result.session.projectId;
    }
    if (result.session?.sessionId) {
      state2.currentSessionId = result.session.sessionId;
      await storageAdapter.setCurrentSessionId(result.session.sessionId);
    }
    if (result.runUpdate?.runId) {
      state2.currentRunId = result.runUpdate.runId;
    }
    return result;
  });
  electron.ipcMain.handle("conversation:getHistory", async (_event, sessionId) => {
    if (!sessionId) {
      return { messages: [], branchState: null };
    }
    return conversationService.getHistory(sessionId);
  });
  electron.ipcMain.handle("conversation:switchBranch", async (_event, request2) => {
    return conversationService.switchConversationBranch(request2);
  });
  electron.ipcMain.handle("conversation:clearHistory", async (_event, sessionId) => {
    if (!sessionId) {
      return { success: false, messages: [], error: "No session selected." };
    }
    try {
      return { success: true, messages: await conversationService.clearHistory(sessionId) };
    } catch (error) {
      return { success: false, messages: [], error: error instanceof Error ? error.message : String(error) };
    }
  });
  electron.ipcMain.handle("conversation:undoLastTurn", async (_event, sessionId) => {
    if (!sessionId) {
      return { success: false, messages: [], error: "No session selected." };
    }
    try {
      return { success: true, messages: await conversationService.undoLastTurn(sessionId) };
    } catch (error) {
      return { success: false, messages: [], error: error instanceof Error ? error.message : String(error) };
    }
  });
  electron.ipcMain.handle("conversation:compactHistory", async (_event, sessionId) => {
    if (!sessionId) {
      return { success: false, messages: [], error: "No session selected." };
    }
    try {
      return { success: true, messages: await conversationService.compactHistory(sessionId) };
    } catch (error) {
      return { success: false, messages: [], error: error instanceof Error ? error.message : String(error) };
    }
  });
  electron.ipcMain.handle("conversation:cancelActiveTurn", async (_event, request2) => {
    return conversationService.cancelActiveTurn(request2);
  });
  electron.ipcMain.handle("conversation:answerUserInput", async (_event, request2) => {
    return conversationService.answerUserInput(request2);
  });
  electron.ipcMain.handle("conversation:answerToolApproval", async (_event, request2) => {
    return conversationService.answerToolApproval(request2);
  });
}
const STALE_RECOVERABLE_RUN_STATUSES = [
  "planning",
  "queued",
  "running",
  "stopping"
];
async function recoverStaleRunOnSelection(run) {
  if (!run || !STALE_RECOVERABLE_RUN_STATUSES.includes(run.status)) {
    return run;
  }
  const isActive = runExecutionService.listActiveRuns().some((activeRun) => activeRun.runId === run.runId);
  if (isActive) {
    return run;
  }
  await storageAdapter.updateRun(run.sessionId, run.runId, {
    status: "interrupted",
    stopReason: "Recovered after app restart",
    stoppedAt: Date.now(),
    finishedAt: Date.now()
  });
  return storageAdapter.getLatestRun(run.sessionId);
}
function registerProjectSessionHandlers(context2) {
  const { state: state2 } = context2;
  electron.ipcMain.handle("project:list", async () => {
    return { projects: storageAdapter.listProjects() };
  });
  electron.ipcMain.handle("project:add", async (_event, rootPath) => {
    try {
      const project = storageAdapter.createProject(rootPath);
      await context2.selectCurrentProject(project.projectId);
      return { success: true, project };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  electron.ipcMain.handle("project:select", async (_event, projectId) => {
    try {
      const selection = await context2.selectCurrentProject(projectId);
      if (!selection.project) {
        return { success: false, error: `Project not found: ${projectId}` };
      }
      return {
        success: true,
        project: selection.project,
        currentSession: selection.currentSession,
        currentRun: selection.currentRun
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  electron.ipcMain.handle("project:rename", async (_event, projectId, newName) => {
    try {
      const project = storageAdapter.renameProject(projectId, newName);
      return { success: true, project };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  electron.ipcMain.handle("project:remove", async (_event, projectId) => {
    try {
      storageAdapter.removeProject(projectId);
      if (state2.currentProjectId === projectId) {
        state2.currentProjectId = null;
        state2.currentSessionId = null;
        state2.currentRunId = null;
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  electron.ipcMain.handle("project:inputs:list", async (_event, projectId) => {
    return { inputs: storageAdapter.listProjectInputs(projectId) };
  });
  electron.ipcMain.handle("project:inputs:refresh", async (_event, projectId) => {
    const inputs = storageAdapter.refreshProjectInputs(projectId);
    context2.broadcastToRenderer("project:inputsChanged", { projectId, inputs });
    return { inputs };
  });
  electron.ipcMain.handle("project:inputs:import", async (_event, projectId) => {
    const result = await electron.dialog.showOpenDialog({
      filters: [{ name: "RenderDoc Capture", extensions: ["rdc"] }],
      properties: ["openFile", "multiSelections"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, inputs: storageAdapter.listProjectInputs(projectId) };
    }
    const inputs = storageAdapter.importProjectInputs(projectId, result.filePaths);
    context2.broadcastToRenderer("project:inputsChanged", { projectId, inputs });
    return { success: true, inputs };
  });
  electron.ipcMain.handle("project:inputs:importPaths", async (_event, projectId, filePaths) => {
    try {
      const inputs = storageAdapter.importProjectInputs(projectId, filePaths ?? []);
      context2.broadcastToRenderer("project:inputsChanged", { projectId, inputs });
      return { success: true, inputs };
    } catch (error) {
      return {
        success: false,
        inputs: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  electron.ipcMain.handle("session:list", async (_event, projectId) => {
    const resolvedProjectId = projectId || state2.currentProjectId;
    if (!resolvedProjectId) {
      return { sessions: [] };
    }
    return { sessions: storageAdapter.listSessions(resolvedProjectId) };
  });
  electron.ipcMain.handle("session:create", async (_event, projectId, title) => {
    try {
      const session = storageAdapter.createSession(projectId, title);
      state2.currentProjectId = session.projectId;
      state2.currentSessionId = session.sessionId;
      state2.currentRunId = null;
      await storageAdapter.setCurrentSessionId(session.sessionId);
      return { success: true, session };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  electron.ipcMain.handle("session:rename", async (_event, id, title) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      return { success: false, error: "Session 名称不能为空。" };
    }
    const session = storageAdapter.updateSession(id, { title: trimmedTitle });
    if (!session) {
      return { success: false, error: `Session not found: ${id}` };
    }
    return { success: true, session };
  });
  electron.ipcMain.handle("session:remove", async (_event, id) => {
    const session = storageAdapter.readSession(id);
    if (!session) {
      return { success: false, error: `Session not found: ${id}` };
    }
    const runs = storageAdapter.listRuns(id);
    const activeRun = runs.find((run) => ["queued", "running", "stopping"].includes(run.status));
    if (activeRun) {
      runExecutionService.stopRun(activeRun.runId);
      rdxCliInvokerService.abortRun(activeRun.runId);
      await context2.setRunLifecycleState(id, activeRun.runId, {
        status: "cancelled",
        lastStage: activeRun.lastStage,
        stopReason: "Session removed",
        stoppedAt: Date.now(),
        finishedAt: Date.now()
      });
    }
    storageAdapter.removeSession(id);
    const remainingSessions = storageAdapter.listSessions(session.projectId);
    const nextSession = remainingSessions[0] || null;
    let nextRun = null;
    if (state2.currentSessionId === id) {
      state2.currentSessionId = nextSession?.sessionId || null;
      state2.currentRunId = nextSession?.lastRunId || null;
      state2.currentProjectId = session.projectId;
      if (state2.currentSessionId) {
        await storageAdapter.setCurrentSessionId(state2.currentSessionId);
        nextRun = storageAdapter.getLatestRun(state2.currentSessionId);
      } else {
        await storageAdapter.setCurrentSessionId(null);
        storageAdapter.setCurrentProjectId(session.projectId);
      }
    }
    return { success: true, nextSession, nextRun };
  });
  electron.ipcMain.handle("session:select", async (_event, id) => {
    const session = storageAdapter.readSession(id);
    if (!session) {
      return { success: false, error: `Session not found: ${id}` };
    }
    state2.currentSessionId = id;
    state2.currentProjectId = session.projectId;
    const currentRun = await recoverStaleRunOnSelection(storageAdapter.getLatestRun(id));
    state2.currentRunId = currentRun?.runId || session.lastRunId || null;
    await storageAdapter.setCurrentSessionId(id);
    return {
      success: true,
      session,
      currentRun
    };
  });
  electron.ipcMain.handle("session:attachments:list", async (_event, sessionId) => {
    return {
      attachments: storageAdapter.listSessionAttachments(sessionId)
    };
  });
  electron.ipcMain.handle("session:outputs:list", async (_event, sessionId, runId) => {
    if (!sessionId) {
      return { outputs: [] };
    }
    return {
      outputs: await context2.buildSessionOutputs(sessionId, runId)
    };
  });
  electron.ipcMain.handle("session:attachments:import", async (_event, sessionId, filePaths) => {
    try {
      return {
        success: true,
        attachments: storageAdapter.importSessionAttachments(sessionId, filePaths ?? [])
      };
    } catch (error) {
      return {
        success: false,
        attachments: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  electron.ipcMain.handle("run:list", async (_event, sessionId) => {
    return { runs: storageAdapter.listRuns(sessionId) };
  });
}
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;
function resolvePowerShellPath() {
  const systemRoot = process.env.SystemRoot?.trim() || process.env.windir?.trim() || "C:\\Windows";
  const candidates = [
    path__namespace.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    path__namespace.join(systemRoot, "Sysnative", "WindowsPowerShell", "v1.0", "powershell.exe")
  ];
  const resolved = candidates.find((candidate) => fs__namespace.existsSync(candidate));
  return resolved ?? "powershell.exe";
}
function isDirectory(targetPath) {
  try {
    return fs__namespace.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}
function resolveTerminalCwd(requestedCwd) {
  const candidates = [
    requestedCwd?.trim(),
    storageAdapter.getWorkspacePath(),
    electron.app.getPath("userData"),
    process.cwd()
  ].filter((candidate) => Boolean(candidate));
  for (const candidate of candidates) {
    const resolved = path__namespace.resolve(candidate);
    if (isDirectory(resolved)) {
      return resolved;
    }
  }
  return process.cwd();
}
function buildTabTitle(cwd) {
  return `PowerShell: ${cwd}`;
}
class TerminalSessionService {
  tabs = /* @__PURE__ */ new Map();
  listTabs() {
    return Array.from(this.tabs.values()).map((entry) => entry.record).sort((left, right) => left.createdAt - right.createdAt);
  }
  createTab(options) {
    const cwd = resolveTerminalCwd(options?.cwd);
    const tabId = `term_${generateShortId()}`;
    const shellPath = resolvePowerShellPath();
    const child = child_process.spawn(shellPath, ["-NoLogo"], {
      cwd,
      stdio: "pipe",
      windowsHide: true,
      env: {
        ...process.env,
        TERM: "xterm-256color"
      }
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const record = {
      tabId,
      kind: "shell",
      title: buildTabTitle(cwd),
      cwd,
      status: "running",
      createdAt: nowMs(),
      sessionId: options?.sessionId ?? null,
      projectId: options?.projectId ?? null,
      runId: options?.runId ?? null
    };
    const tabState = {
      record,
      process: child,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS
    };
    child.stdout.on("data", (chunk) => {
      this.broadcastData({ tabId, data: chunk });
    });
    child.stderr.on("data", (chunk) => {
      this.broadcastData({ tabId, data: chunk });
    });
    child.on("error", (error) => {
      const current = this.tabs.get(tabId);
      if (!current) {
        return;
      }
      current.record = {
        ...current.record,
        status: "exited",
        exitCode: null
      };
      this.broadcastData({
        tabId,
        data: `\r
[terminal failed to start: ${error.message}]\r
`
      });
      this.broadcastExit({ tabId, exitCode: null });
      this.broadcastTabsChanged();
    });
    child.on("close", (exitCode) => {
      const current = this.tabs.get(tabId);
      if (!current) {
        return;
      }
      current.record = {
        ...current.record,
        status: "exited",
        exitCode
      };
      this.broadcastExit({ tabId, exitCode });
      this.broadcastTabsChanged();
    });
    this.tabs.set(tabId, tabState);
    this.broadcastTabsChanged();
    return record;
  }
  closeTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return this.listTabs();
    }
    if (tab.record.status === "running") {
      tab.process.stdin.write("exit\r\n");
      tab.process.kill();
    }
    this.tabs.delete(tabId);
    this.broadcastTabsChanged();
    return this.listTabs();
  }
  activateTab(_tabId) {
    return this.listTabs();
  }
  write(tabId, data) {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.record.status !== "running") {
      return;
    }
    tab.process.stdin.write(data);
  }
  resize(tabId, cols, rows) {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return;
    }
    tab.cols = cols;
    tab.rows = rows;
  }
  disposeAll() {
    for (const tabId of Array.from(this.tabs.keys())) {
      this.closeTab(tabId);
    }
  }
  broadcastData(payload) {
    rendererEventHub.emit("terminal:data", payload);
    for (const win of electron.BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("terminal:data", payload);
      }
    }
  }
  broadcastExit(payload) {
    rendererEventHub.emit("terminal:exit", payload);
    for (const win of electron.BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("terminal:exit", payload);
      }
    }
  }
  broadcastTabsChanged() {
    const tabs = this.listTabs();
    rendererEventHub.emit("terminal:tabsChanged", { tabs });
    for (const win of electron.BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("terminal:tabsChanged", { tabs });
      }
    }
  }
}
const terminalSessionService = new TerminalSessionService();
function registerRuntimeTerminalHandlers() {
  electron.ipcMain.handle("runtimeLog:list", async (_event, request2) => {
    return {
      entries: runtimeLogService.list(request2.scope, request2.sessionId)
    };
  });
  electron.ipcMain.handle("terminal:listTabs", async () => {
    return {
      tabs: terminalSessionService.listTabs()
    };
  });
  electron.ipcMain.handle("terminal:createTab", async (_event, request2) => {
    try {
      const tab = terminalSessionService.createTab(request2);
      return {
        success: true,
        tab,
        tabs: terminalSessionService.listTabs()
      };
    } catch (error) {
      return {
        success: false,
        tabs: terminalSessionService.listTabs(),
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  electron.ipcMain.handle("terminal:closeTab", async (_event, tabId) => {
    try {
      return {
        success: true,
        tabs: terminalSessionService.closeTab(tabId)
      };
    } catch (error) {
      return {
        success: false,
        tabs: terminalSessionService.listTabs(),
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  electron.ipcMain.handle("terminal:activateTab", async (_event, tabId) => {
    return {
      success: true,
      tabs: terminalSessionService.activateTab(tabId)
    };
  });
  electron.ipcMain.handle("terminal:write", async (_event, tabId, data) => {
    try {
      terminalSessionService.write(tabId, data);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  electron.ipcMain.handle("terminal:resize", async (_event, tabId, cols, rows) => {
    try {
      terminalSessionService.resize(tabId, cols, rows);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
}
const REQUEST_TIMEOUT_MS = 2e4;
function normalizeDiscoveredModels(values, filterModelId = () => true) {
  const models = /* @__PURE__ */ new Map();
  for (const value of values) {
    const id = typeof value === "string" ? value.trim() : value && typeof value === "object" && typeof value.id === "string" ? value.id.trim() : value && typeof value === "object" && typeof value.name === "string" ? value.name.trim() : "";
    if (!id || isDeprecatedModel(id) || !filterModelId(id) || models.has(id)) {
      continue;
    }
    const label = value && typeof value === "object" && typeof value.display_name === "string" ? value.display_name.trim() || id : id;
    models.set(id, {
      id,
      label,
      enabled: true
    });
  }
  return Array.from(models.values()).sort((left, right) => left.id.localeCompare(right.id));
}
function parseProviderError(error) {
  if (error instanceof ProviderConnectionError) {
    return error.message;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return "连接测试超时，请稍后重试";
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "连接测试失败";
}
class ProviderConnectionError extends Error {
}
const isDeprecatedModel = (modelId) => {
  const normalized = modelId.toLowerCase();
  return normalized.includes("deprecated") || normalized.startsWith("gpt-3.5") || normalized.startsWith("claude-2") || normalized.startsWith("claude-instant");
};
const isAgentRoutableOpenAiModel = (modelId) => {
  const normalized = modelId.toLowerCase();
  return !(normalized.includes("embedding") || normalized.includes("moderation") || normalized.includes("rerank") || normalized.includes("whisper") || normalized.includes("tts") || normalized.includes("dall-e") || normalized.includes("image") || normalized.includes("audio") || normalized.includes("realtime") || normalized.includes("transcribe") || normalized.includes("computer-use"));
};
const requireModels = (models) => {
  if (models.length === 0) {
    throw new ProviderConnectionError("Provider 暂未返回可用于 Agent 路由的模型");
  }
  return models;
};
const toStaticModels = (modelIds) => requireModels(
  normalizeDiscoveredModels(modelIds)
);
const getJson = async (url2, init) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url2, {
      ...init,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new ProviderConnectionError(formatHttpError(response.status));
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};
const formatHttpError = (status) => {
  if (status === 401 || status === 403) {
    return "API Key 无效或权限不足";
  }
  if (status === 404) {
    return "模型发现端点不可用";
  }
  if (status >= 500) {
    return "Provider 服务暂时不可用";
  }
  return `连接测试失败（HTTP ${status}）`;
};
const appendPath = (baseUrl, path2) => `${baseUrl.trim().replace(/\/+$/, "")}/${path2.replace(/^\/+/, "")}`;
const appendQueryParam = (url2, key, value) => {
  const separator = url2.includes("?") ? "&" : "?";
  return `${url2}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
};
const parseModelsPayload = (strategy, payload) => {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload;
  if (strategy === "ollama-tags") {
    return Array.isArray(record.models) ? normalizeDiscoveredModels(record.models) : [];
  }
  if (strategy === "google-ai-studio") {
    const googleModels = Array.isArray(record.models) ? record.models : [];
    return normalizeDiscoveredModels(
      googleModels.filter((value) => {
        const methods = value && typeof value === "object" ? value.supportedGenerationMethods : null;
        return !Array.isArray(methods) || methods.includes("generateContent");
      }).map((value) => {
        if (value && typeof value === "object" && typeof value.name === "string") {
          return {
            ...value,
            id: value.name.replace(/^models\//, "")
          };
        }
        return value;
      }),
      isAgentRoutableOpenAiModel
    );
  }
  return Array.isArray(record.data) ? normalizeDiscoveredModels(record.data, isAgentRoutableOpenAiModel) : [];
};
const createTinyAnthropicProbeBody = (modelId) => JSON.stringify({
  model: modelId,
  max_tokens: 1,
  messages: [{ role: "user", content: "ping" }]
});
const createTinyOpenAiProbeBody = (modelId) => JSON.stringify({
  model: modelId,
  max_tokens: 1,
  messages: [{ role: "user", content: "ping" }]
});
class ProviderConnectionService {
  async testProviderDraft(request2) {
    try {
      const provider = this.resolveProviderProtocol(this.getProvider(request2.providerId), request2.protocol);
      const models = await this.discoverModels(
        provider,
        request2.apiKey?.trim() ?? "",
        request2.baseUrl?.trim() ?? ""
      );
      return {
        success: true,
        provider,
        models
      };
    } catch (error) {
      return {
        success: false,
        models: [],
        error: parseProviderError(error)
      };
    }
  }
  async connectProvider(request2) {
    try {
      const provider = this.resolveProviderProtocol(this.getProvider(request2.providerId), request2.protocol);
      const apiKey = request2.apiKey?.trim() ?? "";
      const baseUrl = request2.baseUrl?.trim() ?? "";
      const models = await this.discoverModels(provider, apiKey, baseUrl);
      const nextSettings = settingsService.saveProviderConnection(provider.id, apiKey, models, baseUrl, provider.protocol);
      const nextProvider = nextSettings.llm.providers.find((entry) => entry.id === provider.id);
      return {
        success: true,
        provider: nextProvider,
        models
      };
    } catch (error) {
      return {
        success: false,
        models: [],
        error: parseProviderError(error)
      };
    }
  }
  async refreshProviderModels(providerId) {
    try {
      const provider = this.getProvider(providerId);
      if (provider.authMode === "account") {
        const status = await providerAccountAuthService.test(provider.id);
        if (!status.connected) {
          throw new ProviderConnectionError(status.error || status.message || "Account provider is not connected");
        }
        const nextProvider2 = settingsService.getAll().llm.providers.find((entry) => entry.id === provider.id);
        return {
          success: true,
          provider: nextProvider2,
          models: nextProvider2?.models ?? []
        };
      }
      const models = await this.discoverModels(provider, "", "");
      const nextSettings = settingsService.saveProviderConnection(provider.id, "", models, "", provider.protocol);
      const nextProvider = nextSettings.llm.providers.find((entry) => entry.id === provider.id);
      return {
        success: true,
        provider: nextProvider,
        models
      };
    } catch (error) {
      return {
        success: false,
        models: [],
        error: parseProviderError(error)
      };
    }
  }
  disconnectProvider(providerId) {
    try {
      const nextSettings = settingsService.disconnectProvider(providerId);
      const provider = nextSettings.llm.providers.find((entry) => entry.id === providerId);
      return {
        success: true,
        provider,
        models: []
      };
    } catch (error) {
      return {
        success: false,
        models: [],
        error: parseProviderError(error)
      };
    }
  }
  startProviderAccountLogin(request2) {
    return providerAccountAuthService.startLogin(request2);
  }
  finishProviderAccountLogin(request2) {
    return providerAccountAuthService.finishLogin(request2);
  }
  getProviderAccountStatus(providerId) {
    return providerAccountAuthService.status(providerId);
  }
  logoutProviderAccount(providerId) {
    return providerAccountAuthService.logout(providerId);
  }
  getProvider(providerId) {
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id)) {
      throw new ProviderConnectionError("未知 Provider");
    }
    return provider;
  }
  resolveProviderProtocol(provider, protocolDraft) {
    const protocol = resolveBuiltinProviderProtocol(provider.id, protocolDraft ?? provider.protocol);
    if (!protocol) {
      throw new ProviderConnectionError(`Provider ${provider.id} is not in the built-in catalog.`);
    }
    return protocol === provider.protocol ? provider : { ...provider, protocol };
  }
  async discoverModels(provider, apiKeyDraft, baseUrlDraft) {
    if (provider.authMode === "account") {
      throw new ProviderConnectionError("Account providers must be tested through the account login flow.");
    }
    const definition = getBuiltinProviderDefinition(provider.id);
    if (provider.unavailableReason) {
      throw new ProviderConnectionError(provider.unavailableReason);
    }
    if (!definition?.modelDiscovery) {
      throw new ProviderConnectionError("Provider 缺少模型发现配置");
    }
    const apiKey = provider.authMode === "api-key" ? apiKeyDraft || settingsService.getProviderSecret(provider.id) : "";
    if (provider.authMode === "api-key" && !apiKey) {
      throw new ProviderConnectionError("请输入 API Key");
    }
    const strategy = definition.modelDiscovery;
    if (strategy === "static") {
      return toStaticModels(definition.recommendedModels);
    }
    const baseUrl = (baseUrlDraft || provider.baseUrl || definition.baseUrl || "").trim().replace(/\/+$/, "");
    if (!baseUrl) {
      throw new ProviderConnectionError("请填写 Provider Base URL");
    }
    if (provider.id === "kimi-coding-plan") {
      return this.validateCodingPlanModels(apiKey, baseUrl, definition.recommendedModels);
    }
    if (strategy === "anthropic-candidate-validation") {
      return this.validateAnthropicCandidateModels(provider, apiKey, baseUrl, definition.recommendedModels);
    }
    if (strategy === "azure-openai") {
      return this.validateAzureCandidateModels(apiKey, baseUrl, definition.recommendedModels);
    }
    if (strategy === "google-ai-studio") {
      const payload2 = await getJson(appendQueryParam(appendPath(baseUrl, "/models"), "key", apiKey), {
        method: "GET"
      });
      return requireModels(parseModelsPayload(strategy, payload2));
    }
    const url2 = strategy === "ollama-tags" ? appendPath(new URL(baseUrl).origin, "/api/tags") : appendPath(baseUrl, "/models");
    const headers = this.createHeaders(provider, apiKey);
    const payload = await getJson(url2, {
      method: "GET",
      headers
    });
    return requireModels(parseModelsPayload(strategy, payload));
  }
  async validateAnthropicCandidateModels(provider, apiKey, baseUrl, modelIds) {
    const validModels = [];
    const url2 = appendPath(baseUrl, "/messages");
    const headers = this.createHeaders(provider, apiKey);
    for (const modelId of modelIds) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const response = await fetch(url2, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json"
          },
          signal: controller.signal,
          body: createTinyAnthropicProbeBody(modelId)
        });
        clearTimeout(timeout);
        if (response.ok) {
          validModels.push(modelId);
        }
      } catch {
      }
    }
    return toStaticModels(validModels);
  }
  async validateCodingPlanModels(apiKey, baseUrl, modelIds) {
    const payload = await getJson(appendPath(baseUrl, "/models"), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });
    const availableModelIds = new Set(
      parseModelsPayload("openai-compatible", payload).map((model) => model.id)
    );
    return toStaticModels(modelIds.filter((modelId) => availableModelIds.has(modelId)));
  }
  async validateAzureCandidateModels(apiKey, baseUrl, modelIds) {
    const validModels = [];
    const chatUrl = appendQueryParam(
      baseUrl.endsWith("/chat/completions") ? baseUrl : appendPath(baseUrl, "/chat/completions"),
      "api-version",
      "2024-10-21"
    );
    for (const modelId of modelIds) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const response = await fetch(chatUrl, {
          method: "POST",
          headers: {
            "api-key": apiKey,
            "Content-Type": "application/json"
          },
          signal: controller.signal,
          body: createTinyOpenAiProbeBody(modelId)
        });
        clearTimeout(timeout);
        if (response.ok) {
          validModels.push(modelId);
        }
      } catch {
      }
    }
    return toStaticModels(validModels);
  }
  createHeaders(provider, apiKey) {
    if (provider.authMode === "local") {
      return {};
    }
    if (provider.protocol === "AnthropicMessages") {
      return {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      };
    }
    return {
      Authorization: `Bearer ${apiKey}`
    };
  }
}
const providerConnectionService = new ProviderConnectionService();
function registerSettingsLlmHandlers(context2) {
  electron.ipcMain.handle("llm:configure", async (_event, config) => {
    llmAdapter.configure(config);
    return;
  });
  electron.ipcMain.handle("llm:testConnection", async (_event, provider) => {
    return llmAdapter.testConnection(provider);
  });
  electron.ipcMain.handle("llm:getAvailableModels", async (_event, provider) => {
    return llmAdapter.getAvailableModels(provider);
  });
  electron.ipcMain.handle("llm:testProviderDraft", async (_event, request2) => {
    return providerConnectionService.testProviderDraft(request2);
  });
  electron.ipcMain.handle("llm:connectProvider", async (_event, request2) => {
    const result = await providerConnectionService.connectProvider(request2);
    if (result.success) {
      context2.applyCurrentLlmConfig();
    }
    return result;
  });
  electron.ipcMain.handle("llm:refreshProviderModels", async (_event, providerId) => {
    const result = await providerConnectionService.refreshProviderModels(providerId);
    if (result.success) {
      context2.applyCurrentLlmConfig();
    }
    return result;
  });
  electron.ipcMain.handle("llm:disconnectProvider", async (_event, providerId) => {
    const result = providerConnectionService.disconnectProvider(providerId);
    if (result.success) {
      context2.applyCurrentLlmConfig();
    }
    return result;
  });
  electron.ipcMain.handle("llm:startProviderAccountLogin", async (_event, request2) => {
    return providerConnectionService.startProviderAccountLogin(request2);
  });
  electron.ipcMain.handle("llm:getProviderAccountStatus", async (_event, providerId) => {
    const result = providerConnectionService.getProviderAccountStatus(providerId);
    if (result.connected) {
      context2.applyCurrentLlmConfig();
    }
    return result;
  });
  electron.ipcMain.handle("llm:finishProviderAccountLogin", async (_event, request2) => {
    const result = await providerConnectionService.finishProviderAccountLogin(request2);
    if (result.connected) {
      context2.applyCurrentLlmConfig();
    }
    return result;
  });
  electron.ipcMain.handle("llm:logoutProviderAccount", async (_event, providerId) => {
    const result = providerConnectionService.logoutProviderAccount(providerId);
    context2.applyCurrentLlmConfig();
    return result;
  });
  electron.ipcMain.handle("settings:get", async () => {
    const paths = appPathService.getWorkspacePaths();
    return settingsService.getAll({
      workspaceRoot: paths.workspaceRoot,
      defaultWorkspaceRoot: paths.defaultWorkspaceRoot,
      settingsPath: paths.settingsPath,
      logsPath: paths.logsPath,
      logPath: paths.logPath,
      projectsPath: paths.projectsPath,
      knowledgePath: paths.knowledgePath,
      migrationOrphansPath: paths.migrationOrphansPath,
      profilesPath: paths.profilesPath,
      policiesPath: paths.policiesPath,
      secretsPath: paths.secretsPath,
      migrationReportsPath: paths.migrationReportsPath
    });
  });
  electron.ipcMain.handle("settings:getProviderCatalog", async () => {
    return settingsService.getProviderCatalog();
  });
  electron.ipcMain.handle("settings:getProviderSecret", async (_event, providerId) => {
    const paths = appPathService.getWorkspacePaths();
    return settingsService.getProviderSecret(providerId, paths.workspaceRoot);
  });
  electron.ipcMain.handle("settings:importAgentManifest", async (_event, filePath) => {
    const paths = appPathService.getWorkspacePaths();
    agentManifestService.importFile(paths, filePath);
    return settingsService.getAll(paths);
  });
  electron.ipcMain.handle("settings:upsertSkill", async (_event, request2) => {
    const paths = appPathService.getWorkspacePaths();
    agentRuntimeConfigService.upsertSkill(request2, paths.workspaceRoot);
    return settingsService.getAll(paths);
  });
  electron.ipcMain.handle("settings:deleteSkill", async (_event, skillId) => {
    const paths = appPathService.getWorkspacePaths();
    agentRuntimeConfigService.deleteSkill(skillId, paths.workspaceRoot);
    return settingsService.getAll(paths);
  });
  electron.ipcMain.handle("settings:importSkill", async (_event, filePath) => {
    const paths = appPathService.getWorkspacePaths();
    agentRuntimeConfigService.importSkill(filePath, paths.workspaceRoot);
    return settingsService.getAll(paths);
  });
  electron.ipcMain.handle("settings:upsertMcpServer", async (_event, request2) => {
    const paths = appPathService.getWorkspacePaths();
    agentRuntimeConfigService.upsertMcpServer(request2, paths.workspaceRoot);
    return settingsService.getAll(paths);
  });
  electron.ipcMain.handle("settings:deleteMcpServer", async (_event, serverId) => {
    const paths = appPathService.getWorkspacePaths();
    agentRuntimeConfigService.deleteMcpServer(serverId, paths.workspaceRoot);
    return settingsService.getAll(paths);
  });
  electron.ipcMain.handle("settings:importMcpServer", async (_event, filePath) => {
    const paths = appPathService.getWorkspacePaths();
    agentRuntimeConfigService.importMcpServer(filePath, paths.workspaceRoot);
    return settingsService.getAll(paths);
  });
  electron.ipcMain.handle("settings:set", async (_event, settings) => {
    const nextSettings = settingsService.setAll(settings, appPathService.getWorkspacePaths());
    storageAdapter.setWorkspaceRoot(nextSettings.workspace.rootPath);
    await storageAdapter.initializeWorkspace();
    await context2.initializeIpcState();
    context2.applyCurrentLlmConfig();
    return nextSettings;
  });
}
const AVATAR_MIME_BY_EXTENSION = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp"
};
function getAvatarMimeType(filePath) {
  return AVATAR_MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? null;
}
function isSameFilePath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32" ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase() : normalizedLeft === normalizedRight;
}
function copyAvatarToWorkspace(sourcePath) {
  const mimeType = getAvatarMimeType(sourcePath);
  if (!mimeType || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    return null;
  }
  const paths = appPathService.getWorkspacePaths();
  const avatarDir = path.join(paths.profilesPath, "avatar");
  const extension = path.extname(sourcePath).toLowerCase();
  const avatarPath = path.join(avatarDir, `profile-avatar${extension}`);
  fs.mkdirSync(avatarDir, { recursive: true });
  if (!isSameFilePath(sourcePath, avatarPath)) {
    fs.copyFileSync(sourcePath, avatarPath);
  }
  return avatarPath;
}
function readAvatarDataUrl(avatarPath) {
  const mimeType = getAvatarMimeType(avatarPath);
  if (!mimeType || !fs.existsSync(avatarPath) || !fs.statSync(avatarPath).isFile()) {
    return null;
  }
  const content = fs.readFileSync(avatarPath);
  return `data:${mimeType};base64,${content.toString("base64")}`;
}
function getSenderWindow(event) {
  const sender = event.sender;
  return sender ? electron.BrowserWindow.fromWebContents(sender) : null;
}
function registerShellHandlers() {
  electron.ipcMain.handle("dialog:selectRdcFiles", async () => {
    const result = await electron.dialog.showOpenDialog({
      filters: [{ name: "RenderDoc Capture", extensions: ["rdc"] }],
      properties: ["openFile", "multiSelections"]
    });
    return result.canceled ? null : result.filePaths;
  });
  electron.ipcMain.handle("dialog:selectFiles", async () => {
    const result = await electron.dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"]
    });
    return result.canceled ? null : result.filePaths;
  });
  electron.ipcMain.handle("dialog:selectDirectory", async () => {
    const result = await electron.dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : result.filePaths[0];
  });
  electron.ipcMain.handle("window:minimize", async (event) => {
    getSenderWindow(event)?.minimize();
  });
  electron.ipcMain.handle("window:toggleMaximize", async (event) => {
    const window = getSenderWindow(event);
    if (!window) return false;
    if (window.isMaximized()) {
      window.unmaximize();
      return false;
    }
    window.maximize();
    return true;
  });
  electron.ipcMain.handle("window:close", async (event) => {
    getSenderWindow(event)?.close();
  });
  electron.ipcMain.handle("window:isMaximized", async (event) => {
    return getSenderWindow(event)?.isMaximized() ?? false;
  });
  electron.ipcMain.handle("app:getMeta", async () => {
    return {
      version: electron.app.getVersion(),
      productName: electron.app.getName(),
      systemTheme: electron.nativeTheme.shouldUseDarkColors ? "dark" : "light",
      testMode: process.env.RDC_AGENT_TEST_MODE === "1"
    };
  });
  electron.ipcMain.handle("app:selectAvatar", async () => {
    const result = await electron.dialog.showOpenDialog({
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
      properties: ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    try {
      return copyAvatarToWorkspace(result.filePaths[0]);
    } catch (error) {
      console.warn("[IPC] Failed to import avatar:", error);
      return null;
    }
  });
  electron.ipcMain.handle("app:getAvatarDataUrl", async (_event, avatarPath) => {
    if (!avatarPath) {
      return null;
    }
    try {
      return readAvatarDataUrl(avatarPath);
    } catch (error) {
      console.warn("[IPC] Failed to read avatar:", error);
      return null;
    }
  });
  electron.ipcMain.handle("app:openPath", async (_event, targetPath) => {
    if (!targetPath) return { success: false, error: "path is required" };
    try {
      const stats = fs.existsSync(targetPath) ? fs.statSync(targetPath) : null;
      if (stats?.isDirectory()) {
        await electron.shell.openPath(targetPath);
      } else {
        electron.shell.showItemInFolder(targetPath);
      }
    } catch {
      electron.shell.showItemInFolder(targetPath);
    }
    return { success: true };
  });
  electron.ipcMain.handle("app:copyText", async (_event, text) => {
    electron.clipboard.writeText(text ?? "");
    return { success: true };
  });
}
const ACTION_ARTIFACT_KEYS = [
  "artifactPath",
  "artifact_path",
  "filePath",
  "file_path",
  "imagePath",
  "image_path",
  "outputPath",
  "output_path",
  "reportPath",
  "report_path",
  "savedPath",
  "saved_path",
  "path"
];
function inferMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const table = {
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".log": "text/plain",
    ".json": "application/json",
    ".html": "text/html",
    ".htm": "text/html",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".csv": "text/csv"
  };
  return table[extension];
}
function readFileTimestamps(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return {};
    }
    return {
      sizeBytes: stat.size,
      createdAt: stat.birthtimeMs,
      updatedAt: stat.mtimeMs
    };
  } catch {
    return {};
  }
}
function parseTimestamp(value) {
  if (typeof value === "number") {
    return value;
  }
  if (!value) {
    return void 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : void 0;
}
function outputKey(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
function addSessionOutput(outputs, seen, output) {
  const key = outputKey(output.filePath);
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  outputs.push(output);
}
function isLikelyFilePath(value) {
  return /[\\/]/.test(value) || /\.(md|txt|log|json|html?|png|jpe?g|webp|gif|csv)$/i.test(value);
}
function collectActionArtifactPaths(value, results = /* @__PURE__ */ new Set()) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectActionArtifactPaths(entry, results));
    return results;
  }
  if (!value || typeof value !== "object") {
    return results;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && ACTION_ARTIFACT_KEYS.includes(key) && isLikelyFilePath(entry)) {
      results.add(entry);
      continue;
    }
    if (entry && typeof entry === "object") {
      collectActionArtifactPaths(entry, results);
    }
  }
  return results;
}
function resolveActionArtifactPath(sessionId, runId, filePath) {
  if (path.isAbsolute(filePath)) {
    return path.resolve(filePath);
  }
  try {
    return path.resolve(storageAdapter.getRunPath(sessionId, runId), filePath);
  } catch {
    return path.resolve(filePath);
  }
}
async function buildSessionOutputs(sessionId, runId) {
  const outputs = [];
  const seen = /* @__PURE__ */ new Set();
  const targetRuns = runId ? storageAdapter.listRuns(sessionId).filter((run) => run.runId === runId) : storageAdapter.listRuns(sessionId);
  for (const attachment of storageAdapter.listSessionAttachments(sessionId)) {
    addSessionOutput(outputs, seen, {
      id: attachment.attachmentId,
      kind: "attachment",
      title: attachment.fileName,
      fileName: attachment.fileName,
      filePath: attachment.filePath,
      source: "session attachment",
      mimeType: attachment.mimeType,
      sizeBytes: attachment.size,
      createdAt: attachment.createdAt,
      updatedAt: attachment.createdAt
    });
  }
  for (const run of targetRuns) {
    const reportEntries = [
      { id: "markdown", title: "report.md", filePath: run.reportPaths?.markdownPath },
      { id: "json", title: "report.json", filePath: run.reportPaths?.jsonPath },
      { id: "html", title: "visual_report.html", filePath: run.reportPaths?.htmlPath }
    ].filter((entry) => Boolean(entry.filePath));
    for (const report of reportEntries) {
      addSessionOutput(outputs, seen, {
        id: `${run.runId}:report:${report.id}`,
        kind: "report",
        title: report.title,
        fileName: path.basename(report.filePath),
        filePath: report.filePath,
        source: "run report",
        runId: run.runId,
        mimeType: inferMimeType(report.filePath),
        ...readFileTimestamps(report.filePath)
      });
    }
    for (const artifact of artifactStore.list(sessionId, run.runId)) {
      addSessionOutput(outputs, seen, {
        id: artifact.artifactId,
        kind: "artifact",
        title: artifact.title || path.basename(artifact.filePath),
        fileName: path.basename(artifact.filePath),
        filePath: artifact.filePath,
        source: "artifact store",
        runId: artifact.runId,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
        createdAt: parseTimestamp(artifact.createdAt),
        updatedAt: parseTimestamp(artifact.updatedAt)
      });
    }
  }
  const targetRunIds = new Set(targetRuns.map((run) => run.runId));
  try {
    const actionEvents = await storageAdapter.readActionChain(sessionId);
    for (const event of actionEvents) {
      if (runId && !targetRunIds.has(event.run_id)) {
        continue;
      }
      const artifactPaths = collectActionArtifactPaths(event.payload);
      for (const artifactPath of artifactPaths) {
        const resolvedPath = resolveActionArtifactPath(sessionId, event.run_id, artifactPath);
        addSessionOutput(outputs, seen, {
          id: `${event.event_id}:${outputKey(resolvedPath)}`,
          kind: "action_artifact",
          title: path.basename(resolvedPath),
          fileName: path.basename(resolvedPath),
          filePath: resolvedPath,
          source: event.event_type,
          runId: event.run_id,
          mimeType: inferMimeType(resolvedPath),
          createdAt: event.ts_ms,
          updatedAt: event.ts_ms,
          ...readFileTimestamps(resolvedPath)
        });
      }
    }
  } catch {
  }
  return outputs.sort((left, right) => (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0));
}
function registerToolEvidenceHandlers(context2) {
  const { state: state2 } = context2;
  electron.ipcMain.handle("tool:getCatalog", async () => {
    try {
      return await rdxCliInvokerService.loadCatalog();
    } catch {
      return { tools: [], namespaces: {} };
    }
  });
  electron.ipcMain.handle("tool:getRuntimeSummary", async () => {
    return rdxCliInvokerService.getRuntimeSummary();
  });
  electron.ipcMain.handle("evidence:getChain", async () => {
    const sessionId = await storageAdapter.getCurrentSessionId();
    if (!sessionId) {
      return { sessionId: "", runId: "", events: [], isValid: true };
    }
    const events = await storageAdapter.readActionChain(sessionId);
    return {
      sessionId,
      runId: state2.currentRunId || storageAdapter.getLatestRun(sessionId)?.runId || "",
      events,
      isValid: true
    };
  });
  electron.ipcMain.handle("evidence:getEvents", async (_event, eventType) => {
    const sessionId = await storageAdapter.getCurrentSessionId();
    if (!sessionId) return [];
    const events = await storageAdapter.readActionChain(sessionId);
    if (eventType) {
      return events.filter((event) => event.event_type === eventType);
    }
    return events;
  });
}
function registerWorkflowHandlers(context2) {
  const { state: state2 } = context2;
  electron.ipcMain.handle("workflow:getState", async () => {
    if (!state2.currentSessionId) {
      return null;
    }
    try {
      return await debuggerRuntime.getWorkflowState(state2.currentSessionId, state2.currentRunId || void 0);
    } catch (error) {
      console.error("[IPC] Failed to get workflow state:", error);
      return null;
    }
  });
  electron.ipcMain.handle("workflow:resume", async (_event, sessionId) => {
    try {
      if (sessionId) {
        state2.currentSessionId = sessionId;
        await storageAdapter.setCurrentSessionId(sessionId);
        state2.currentRunId = storageAdapter.getLatestRun(sessionId)?.runId || null;
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  electron.ipcMain.handle("workflow:stop", async (_event, runId) => {
    const targetRunId = runId || state2.currentRunId;
    if (!targetRunId) {
      return { success: false, error: "No active run." };
    }
    const result = await debuggerRuntime.stopRun(targetRunId);
    context2.broadcastToRenderer("capture:openedStateChanged", null);
    context2.broadcastToRenderer("context:changed", rdxSessionService.snapshotContext());
    return result;
  });
  electron.ipcMain.handle("workflow:getRunUsage", async (_event, runId, sessionId) => {
    const targetKey = runId || state2.currentRunId || sessionId;
    if (!targetKey) {
      return { usage: null };
    }
    return {
      usage: debuggerLlmService.getRunContextUsage(targetKey)
    };
  });
  electron.ipcMain.handle("workflow:listRuns", async () => {
    if (!state2.currentSessionId) {
      return { runs: [] };
    }
    return { runs: storageAdapter.listRuns(state2.currentSessionId) };
  });
  electron.ipcMain.handle("workflow:listActiveRuns", async () => {
    return { runs: runExecutionService.listActiveRuns() };
  });
}
function registerTraceHandlers(context2) {
  const { state: state2 } = context2;
  electron.ipcMain.handle("trace:getRun", async (_event, runId) => {
    const run = traceService.getRun(runId);
    return { run };
  });
  electron.ipcMain.handle("trace:getEvents", async (_event, runId, afterSeq) => {
    return { events: traceService.getEvents(runId, afterSeq ?? 0) };
  });
  electron.ipcMain.handle("trace:getProjection", async (_event, sessionId) => {
    const targetSessionId = sessionId || state2.currentSessionId;
    if (!targetSessionId) {
      return { success: false, error: "No active session." };
    }
    return debuggerRuntime.getTraceProjection(targetSessionId);
  });
  electron.ipcMain.handle("trace:exportRun", async (_event, runId) => {
    return traceService.exportRun(runId);
  });
  electron.ipcMain.handle("trace:switchBranch", async (_event, sessionId, branchId) => {
    return debuggerRuntime.switchTraceBranch(sessionId, branchId);
  });
  electron.ipcMain.handle("trace:exportSession", async (_event, sessionId, options) => {
    return debuggerRuntime.exportTraceSession(sessionId, options);
  });
}
const invokeHandlers = /* @__PURE__ */ new Map();
let registryInstalled = false;
function installIpcInvokeRegistry() {
  if (registryInstalled) {
    return;
  }
  const nativeHandle = electron.ipcMain.handle.bind(electron.ipcMain);
  electron.ipcMain.handle = ((channel, listener) => {
    invokeHandlers.set(channel, listener);
    nativeHandle(channel, listener);
  });
  registryInstalled = true;
}
function createBrowserInvokeEvent() {
  const sender = electron.BrowserWindow.getFocusedWindow()?.webContents ?? electron.BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())?.webContents;
  return {
    sender
  };
}
async function invokeRegisteredIpcChannel(channel, args = []) {
  const handler = invokeHandlers.get(channel);
  if (!handler) {
    throw new Error(`No IPC handler registered for ${channel}`);
  }
  return handler(createBrowserInvokeEvent(), ...args);
}
const state = {
  currentSessionId: null,
  currentProjectId: null,
  currentRunId: null
};
let toolTraceSubscribed = false;
let nativeThemeSubscribed = false;
async function initializeIpcState() {
  try {
    state.currentSessionId = await storageAdapter.getCurrentSessionId();
    state.currentProjectId = storageAdapter.getCurrentProjectId();
    state.currentRunId = state.currentSessionId ? storageAdapter.getLatestRun(state.currentSessionId)?.runId || null : null;
  } catch (error) {
    console.warn("[IPC] Failed to restore current session id:", error);
    state.currentSessionId = null;
    state.currentProjectId = null;
    state.currentRunId = null;
  }
  await debuggerRuntime.recoverInterruptedRuns();
  try {
    const resumable = await sessionResumeService.getResumableSession();
    if (resumable && resumable.sessionId) {
      state.currentSessionId = resumable.sessionId;
      state.currentProjectId = resumable.projectId;
      state.currentRunId = resumable.runId;
    }
  } catch {
  }
}
function broadcastToRenderer(channel, ...args) {
  rendererEventHub.emit(channel, ...args);
  const windows = electron.BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  }
}
function broadcastRunStatusChanged(payload) {
  broadcastToRenderer("workflow:runStatusChanged", payload);
}
function applyCurrentLlmConfig() {
  const llmConfig = settingsService.getLlmConfig();
  llmAdapter.configure(llmConfig);
  agentOrchestrator.applyLlmConfig(llmConfig);
}
async function appendActionEvent(event) {
  await storageAdapter.appendActionEvent(event.session_id, event);
  broadcastToRenderer("evidence:eventAdded", event);
}
async function setRunLifecycleState(sessionId, runId, patch) {
  const updatePayload = {
    status: patch.status
  };
  if (patch.lastStage) {
    updatePayload.lastStage = patch.lastStage;
    updatePayload.runtime = {
      workflow_stage: patch.lastStage
    };
  }
  if (patch.stopReason) {
    updatePayload.stopReason = patch.stopReason;
  }
  if (patch.stoppedAt) {
    updatePayload.stoppedAt = patch.stoppedAt;
  }
  if (patch.finishedAt) {
    updatePayload.finishedAt = patch.finishedAt;
  }
  await storageAdapter.updateRun(sessionId, runId, updatePayload);
  broadcastRunStatusChanged({
    runId,
    sessionId,
    status: patch.status,
    lastStage: patch.lastStage,
    stopReason: patch.stopReason
  });
}
async function selectCurrentProject(projectId) {
  if (!projectId) {
    state.currentProjectId = null;
    state.currentSessionId = null;
    state.currentRunId = null;
    storageAdapter.setCurrentProjectId(null);
    return {
      project: null,
      currentSession: null,
      currentRun: null
    };
  }
  const project = storageAdapter.getProjectById(projectId);
  if (!project) {
    return {
      project: null,
      currentSession: null,
      currentRun: null
    };
  }
  state.currentProjectId = projectId;
  const selectedSession = state.currentSessionId ? storageAdapter.readSession(state.currentSessionId) : null;
  if (!selectedSession || selectedSession.projectId !== projectId) {
    state.currentSessionId = null;
    state.currentRunId = null;
    await storageAdapter.setCurrentSessionId(null);
  } else {
    state.currentRunId = selectedSession.lastRunId || state.currentRunId;
  }
  storageAdapter.setCurrentProjectId(projectId);
  return {
    project,
    currentSession: selectedSession?.projectId === projectId ? selectedSession : null,
    currentRun: state.currentSessionId ? storageAdapter.getLatestRun(state.currentSessionId) : null
  };
}
const context = {
  state,
  broadcastToRenderer,
  broadcastRunStatusChanged,
  applyCurrentLlmConfig,
  setRunLifecycleState,
  selectCurrentProject,
  buildSessionOutputs,
  initializeIpcState
};
function registerToolTraceBridge() {
  if (toolTraceSubscribed) {
    return;
  }
  rdxCliInvokerService.onInvocationTrace((trace) => {
    broadcastToRenderer("tool:executionComplete", trace);
    if (state.currentSessionId && state.currentRunId) {
      void appendActionEvent(storageAdapter.createActionEvent({
        runId: state.currentRunId,
        sessionId: state.currentSessionId,
        agentId: trace.runtimeOwner || "debugger",
        eventType: "tool_execution",
        status: trace.result.ok ? "ok" : "error",
        turnId: trace.turnId,
        payload: {
          tool_name: trace.toolName,
          args: trace.args,
          result: trace.result.ok ? "success" : "failed",
          error: trace.result.error,
          trace_id: trace.traceId
        }
      }));
    }
    runtimeLogService.log({
      scope: state.currentSessionId ? "session" : "app",
      namespace: "tool",
      severity: trace.result.ok ? "success" : "error",
      title: trace.toolName,
      summary: trace.result.ok ? "工具调用已完成。" : trace.result.error?.message ?? "工具调用失败。",
      detail: trace.result.duration_ms ? `${trace.result.duration_ms}ms` : void 0,
      sessionId: state.currentSessionId,
      projectId: state.currentProjectId,
      runId: state.currentRunId,
      raw: {
        args: trace.args,
        result: trace.result,
        contextId: trace.contextId,
        runtimeOwner: trace.runtimeOwner,
        ownerLeaseId: trace.ownerLeaseId ?? null
      },
      timestamp: trace.timestamp
    });
  });
  toolTraceSubscribed = true;
}
function preloadLlmConfig() {
  try {
    applyCurrentLlmConfig();
    console.log("[IPC] Loaded persisted LLM config");
  } catch (err) {
    console.warn("[IPC] Failed to preload LLM config:", err);
  }
}
function registerNativeThemeBridge() {
  if (nativeThemeSubscribed) {
    return;
  }
  electron.nativeTheme.on("updated", () => {
    broadcastToRenderer("app:themeChanged", electron.nativeTheme.shouldUseDarkColors ? "dark" : "light");
  });
  nativeThemeSubscribed = true;
}
function registerIPCHandlers() {
  installIpcInvokeRegistry();
  registerToolTraceBridge();
  preloadLlmConfig();
  registerShellHandlers();
  registerConversationHandlers(context);
  registerWorkflowHandlers(context);
  registerProjectSessionHandlers(context);
  registerRuntimeTerminalHandlers();
  registerCaptureDeviceHandlers(context);
  registerAgentHandlers(context);
  registerMemoryHandlers();
  registerCommandHandlers();
  registerToolEvidenceHandlers(context);
  registerSettingsLlmHandlers(context);
  registerTraceHandlers(context);
  registerNativeThemeBridge();
}
function setMainWindow(window) {
  replayDeviceService.setMainWindow(window);
  agentOrchestrator.setMainWindow(window);
}
async function stopAllActiveRuns() {
  await runExecutionService.stopAll();
}
const DEFAULT_RUNTIME_OWNER = "rdc-agent";
const emptyPreviewLoadResult = () => ({
  preview: null,
  error: null,
  attempts: []
});
class RdxSessionService {
  contextId = null;
  runtimeOwner = null;
  ownerLeaseId = null;
  captures = [];
  activeCaptureId = null;
  deviceLabel = "Local";
  replayDevice = null;
  remoteStatus = "disconnected";
  openedCapture = null;
  runtimeContext = null;
  humanPreview = {
    status: "closed",
    updatedAt: Date.now()
  };
  async openProjectInput(request2) {
    await this.closeOrReplaceOpenedCapture();
    let replayDevice = request2.replayDevice;
    const isRemoteReplay = replayDevice.type === "android";
    if (isRemoteReplay) {
      replayDevice = await this.ensureReplayDeviceReady(replayDevice);
    }
    const preparedRemote = isRemoteReplay ? replayDeviceService.peekPreparedRemote(replayDevice.id) : null;
    const capture = {
      id: request2.inputId,
      filePath: request2.filePath,
      role: "primary",
      backendHint: isRemoteReplay ? "remote" : "local",
      status: "pending"
    };
    this.captures = [capture];
    this.activeCaptureId = capture.id;
    this.replayDevice = replayDevice;
    this.deviceLabel = replayDevice.label;
    this.remoteStatus = "disconnected";
    let resultData;
    if (isRemoteReplay) {
      if (!preparedRemote?.contextId || !preparedRemote.remoteId) {
        capture.status = "error";
        this.captures = [capture];
        this.remoteStatus = "error";
        throw new Error("Remote replay requires a prepared remote context and remoteId.");
      }
      resultData = await this.openRemoteProjectInput(request2, replayDevice, preparedRemote);
    } else {
      const result = await rdxShellActionService.runAction("openCapture", {
        projectId: request2.projectId,
        inputId: request2.inputId,
        filePath: request2.filePath,
        capturePath: request2.filePath,
        deviceId: replayDevice.id,
        deviceLabel: replayDevice.label,
        deviceType: replayDevice.type,
        deviceSerial: replayDevice.serial,
        deviceRemoteId: replayDevice.remoteId,
        remoteId: preparedRemote?.remoteId ?? replayDevice.remoteId,
        remoteContextId: preparedRemote?.contextId,
        backend: "local"
      }, {
        env: this.buildRuntimeContextEnv()
      });
      if (!result.ok) {
        capture.status = "error";
        this.captures = [capture];
        this.remoteStatus = "error";
        throw new Error(result.error ?? "RDX openCapture action failed.");
      }
      resultData = result.data;
    }
    const runtimeContext = this.extractRuntimeContext(resultData, {
      backend: isRemoteReplay ? "remote" : "local",
      deviceId: replayDevice.id,
      deviceLabel: replayDevice.label
    });
    this.applyRuntimeContext(runtimeContext);
    const captureIndex = this.captures.findIndex((item) => item.id === capture.id);
    this.captures[captureIndex] = {
      ...this.captures[captureIndex],
      captureFileId: runtimeContext.captureFileId,
      status: "open",
      sessionId: runtimeContext.replaySessionId,
      replaySessionId: runtimeContext.replaySessionId,
      contextId: runtimeContext.contextId
    };
    const previewResult = this.previewFromActionData(resultData);
    const openedCapture = this.createOpenedCaptureState(
      request2.projectId,
      request2.inputId,
      request2.filePath,
      replayDevice,
      previewResult
    );
    this.openedCapture = openedCapture;
    this.broadcastContextChanged();
    return openedCapture;
  }
  async openRemoteProjectInput(request2, replayDevice, preparedRemote) {
    const runIdBase = `remote-open-${request2.inputId}-${Date.now()}`;
    const openFile = await rdxCliInvokerService.call({
      toolName: "rd.capture.open_file",
      args: {
        file_path: request2.filePath,
        read_only: true
      },
      contextId: preparedRemote.contextId,
      runId: `${runIdBase}-file`
    });
    if (!openFile.ok) {
      throw new Error(this.formatToolError("rd.capture.open_file", openFile));
    }
    const captureFileId = this.readString(openFile.data ?? {}, ["captureFileId", "capture_file_id"]);
    if (!captureFileId) {
      throw new Error("rd.capture.open_file did not return capture_file_id.");
    }
    const openReplay = await rdxCliInvokerService.call({
      toolName: "rd.capture.open_replay",
      args: {
        capture_file_id: captureFileId,
        options: {
          remote_id: preparedRemote.remoteId
        }
      },
      contextId: preparedRemote.contextId,
      runId: `${runIdBase}-replay`
    });
    if (!openReplay.ok) {
      throw new Error(this.formatToolError("rd.capture.open_replay", openReplay));
    }
    const replaySessionId = this.readString(openReplay.data ?? {}, ["replaySessionId", "replay_session_id", "sessionId", "session_id"]);
    if (!replaySessionId) {
      throw new Error("rd.capture.open_replay did not return session_id.");
    }
    const setFrame = await rdxCliInvokerService.call({
      toolName: "rd.replay.set_frame",
      args: {
        session_id: replaySessionId,
        frame_index: 0
      },
      contextId: preparedRemote.contextId,
      runId: `${runIdBase}-frame`
    });
    if (!setFrame.ok) {
      throw new Error(this.formatToolError("rd.replay.set_frame", setFrame));
    }
    const getContext = await rdxCliInvokerService.call({
      toolName: "rd.session.get_context",
      args: {},
      contextId: preparedRemote.contextId,
      runId: `${runIdBase}-context`
    });
    if (!getContext.ok) {
      throw new Error(this.formatToolError("rd.session.get_context", getContext));
    }
    const contextData = getContext.data ?? {};
    const runtime = this.readRecord(contextData, ["runtime"]);
    const activeEventId = this.readNumber(setFrame.data ?? {}, ["activeEventId", "active_event_id"]) ?? this.readNumber(openReplay.data ?? {}, ["activeEventId", "active_event_id"]);
    return {
      context_id: preparedRemote.contextId,
      capture_file_id: captureFileId,
      capture_path: request2.filePath,
      session_id: replaySessionId,
      replay_session_id: replaySessionId,
      active_event_id: activeEventId,
      backend: "remote",
      device_id: replayDevice.id,
      device_label: replayDevice.label,
      remote_id: preparedRemote.remoteId,
      remote_status: "online",
      runtime: runtime ?? {},
      _rdxRemoteOpen: {
        openFile,
        openReplay,
        setFrame,
        getContext
      }
    };
  }
  async closeOrReplaceOpenedCapture() {
    const previousCapture = this.openedCapture;
    await this.teardownRuntime();
    this.resetRuntimeState(previousCapture);
    if (previousCapture) {
      runtimeLogService.log({
        scope: "app",
        namespace: "capture",
        severity: "info",
        title: "Capture replaced",
        summary: `${previousCapture.inputId} 的打开态已清理。`,
        projectId: previousCapture.projectId,
        raw: previousCapture
      });
    }
  }
  async openHumanPreviewWindow(request2 = {}) {
    const replaySessionId = request2.sessionId || this.snapshotContext().sessionId;
    if (!this.contextId || !this.runtimeOwner || !this.ownerLeaseId || !replaySessionId) {
      this.setHumanPreview({
        status: "unavailable",
        sessionId: replaySessionId || void 0,
        lastError: "Runtime context, owner lease, or replay session is not available."
      });
      return this.snapshotContext();
    }
    this.setHumanPreview({
      status: "opening",
      sessionId: replaySessionId
    });
    const result = await rdxShellActionService.runAction("openPreview", {
      sessionId: replaySessionId,
      replaySessionId,
      contextId: this.contextId,
      runtimeOwner: this.runtimeOwner,
      ownerLeaseId: this.ownerLeaseId
    }, {
      env: this.buildRuntimeContextEnv()
    });
    if (!result.ok) {
      const message = result.error ?? "RDX openPreview action failed.";
      this.setHumanPreview({
        status: "error",
        sessionId: replaySessionId,
        lastError: message
      });
      runtimeLogService.log({
        scope: "app",
        namespace: "context",
        severity: "warning",
        title: "Human preview unavailable",
        summary: message,
        raw: { result }
      });
      return this.snapshotContext();
    }
    this.setHumanPreview(this.extractHumanPreview({ data: result.data }, "open", replaySessionId));
    return this.snapshotContext();
  }
  async closeHumanPreviewWindow() {
    this.setHumanPreview({ status: "closed" });
    return this.snapshotContext();
  }
  async switchActiveCapture(captureId) {
    const capture = this.captures.find((item) => item.id === captureId);
    if (!capture) {
      throw new Error(`Capture ${captureId} not found`);
    }
    if (capture.status === "pending") {
      throw new Error(`Capture ${captureId} has not been opened by a configured RDX shell action.`);
    }
    this.activeCaptureId = captureId;
  }
  async ensureReplayDeviceReady(device) {
    if (device.type === "local") {
      return device;
    }
    const currentDevice = replayDeviceService.getDeviceById(device.id) ?? device;
    if (currentDevice.type === "local") {
      return currentDevice;
    }
    const preparedRemote = replayDeviceService.peekPreparedRemote(currentDevice.id);
    if (["connected", "online"].includes(currentDevice.status) && preparedRemote?.contextId && preparedRemote.remoteId) {
      return currentDevice;
    }
    const activatedDevice = await replayDeviceService.activateDevice(currentDevice.id);
    if (activatedDevice.type === "local" || !["connected", "online"].includes(activatedDevice.status)) {
      throw new Error(
        activatedDevice.activationErrorMessage ?? activatedDevice.lastError ?? `Failed to connect Replay Device ${activatedDevice.label}.`
      );
    }
    return activatedDevice;
  }
  extractRuntimeContext(data, fallback) {
    const contextId = this.readString(data, ["contextId", "context_id", "RDX_CONTEXT_ID"]);
    if (!contextId) {
      throw new Error("RDX action result must include contextId/context_id.");
    }
    const runtimeOwner = this.readString(data, ["runtimeOwner", "runtime_owner", "RDX_RUNTIME_OWNER"]) ?? DEFAULT_RUNTIME_OWNER;
    const ownerLeaseId = this.readString(data, ["ownerLeaseId", "owner_lease_id", "RDX_OWNER_LEASE_ID"]) ?? `${DEFAULT_RUNTIME_OWNER}:${contextId}`;
    return {
      contextId,
      runtimeOwner,
      ownerLeaseId,
      replaySessionId: this.readString(data, ["replaySessionId", "replay_session_id", "sessionId", "session_id"]),
      captureFileId: this.readString(data, ["captureFileId", "capture_file_id"]),
      captureId: this.readString(data, ["captureId", "capture_id"]),
      backend: this.readString(data, ["backend"]) === "remote" ? "remote" : fallback.backend,
      deviceId: this.readString(data, ["deviceId", "device_id"]) ?? fallback.deviceId,
      deviceLabel: this.readString(data, ["deviceLabel", "device_label"]) ?? fallback.deviceLabel,
      remoteId: this.readString(data, ["remoteId", "remote_id"]),
      remoteStatus: this.normalizeRemoteStatus(this.readString(data, ["remoteStatus", "remote_status"])),
      updatedAt: Date.now(),
      raw: data
    };
  }
  applyRuntimeContext(runtimeContext) {
    this.runtimeContext = runtimeContext;
    setRdxRuntimeContext(runtimeContext);
    this.contextId = runtimeContext.contextId;
    this.runtimeOwner = runtimeContext.runtimeOwner;
    this.ownerLeaseId = runtimeContext.ownerLeaseId;
    this.remoteStatus = runtimeContext.remoteStatus ?? (runtimeContext.backend === "remote" ? "online" : "disconnected");
    this.deviceLabel = runtimeContext.deviceLabel ?? this.deviceLabel;
  }
  buildRuntimeContextEnv() {
    if (!this.runtimeContext) {
      return {};
    }
    return {
      RDX_CONTEXT_ID: this.runtimeContext.contextId,
      RDX_RUNTIME_OWNER: this.runtimeContext.runtimeOwner,
      RDX_OWNER_LEASE_ID: this.runtimeContext.ownerLeaseId,
      RDX_REPLAY_SESSION_ID: this.runtimeContext.replaySessionId ?? "",
      RDX_CAPTURE_FILE_ID: this.runtimeContext.captureFileId ?? ""
    };
  }
  previewFromActionData(data) {
    const imagePath = this.readString(data, ["previewImagePath", "preview_image_path", "imagePath", "image_path"]);
    if (!imagePath) {
      return emptyPreviewLoadResult();
    }
    const preview = this.createPreviewFromPath(
      imagePath,
      this.readString(data, ["previewSource", "preview_source"]) === "capture_thumbnail" ? "capture_thumbnail" : "framebuffer_screenshot",
      this.readNumber(data, ["previewWidth", "preview_width", "width"]),
      this.readNumber(data, ["previewHeight", "preview_height", "height"])
    );
    return {
      preview,
      error: preview ? null : {
        message: `RDX action returned an unreadable preview image: ${imagePath}`,
        code: "preview_image_unreadable",
        attempts: []
      },
      attempts: preview ? [{
        source: preview.source,
        status: "success",
        imagePath: preview.imagePath
      }] : [{
        source: "framebuffer_screenshot",
        status: "failed",
        imagePath,
        message: `RDX action returned an unreadable preview image: ${imagePath}`,
        code: "preview_image_unreadable"
      }]
    };
  }
  readString(source, keys) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
    return void 0;
  }
  readRecord(source, keys) {
    for (const key of keys) {
      const value = source[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
      }
    }
    return void 0;
  }
  formatToolError(toolName, result) {
    const message = result.error?.message ?? (result.data ? JSON.stringify(result.data) : "") ?? "RDX tool call failed.";
    return `${toolName} failed: ${message}`;
  }
  readNumber(source, keys) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return void 0;
  }
  normalizeRemoteStatus(value) {
    return value === "connected" || value === "online" || value === "disconnected" || value === "error" ? value : void 0;
  }
  snapshotContext() {
    const activeCapture = this.captures.find((capture) => capture.id === this.activeCaptureId);
    return {
      contextId: this.contextId ?? "",
      sessionId: activeCapture?.sessionId ?? "",
      backend: activeCapture?.backendHint ?? "local",
      remoteStatus: this.replayDevice?.type === "android" ? this.remoteStatus : void 0,
      runtimeOwner: this.runtimeOwner ?? "",
      ownerLeaseId: this.ownerLeaseId ?? "",
      captureDescriptors: [...this.captures],
      activeCapture: this.activeCaptureId ?? "",
      deviceLabel: this.deviceLabel,
      humanPreview: { ...this.humanPreview },
      runtimeContext: this.runtimeContext ? { ...this.runtimeContext } : null
    };
  }
  snapshotOpenedCapture() {
    return this.openedCapture ? { ...this.openedCapture } : null;
  }
  clearOpenedCapture() {
    this.openedCapture = null;
  }
  getCaptureDescriptors() {
    return [...this.captures];
  }
  getContextId() {
    return this.contextId;
  }
  getRuntimeOwner() {
    return this.runtimeOwner;
  }
  getOwnerLeaseId() {
    return this.ownerLeaseId;
  }
  setHumanPreview(patch) {
    this.humanPreview = {
      ...patch,
      updatedAt: patch.updatedAt ?? Date.now()
    };
    this.broadcastContextChanged();
  }
  broadcastContextChanged() {
    const snapshot = this.snapshotContext();
    rendererEventHub.emit("context:changed", snapshot);
    for (const window of electron.BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("context:changed", snapshot);
      }
    }
  }
  extractHumanPreview(result, fallbackStatus, fallbackSessionId) {
    const preview = result.data?.preview && typeof result.data.preview === "object" ? result.data.preview : {};
    const enabled = typeof preview.enabled === "boolean" ? preview.enabled : fallbackStatus === "open";
    const status = fallbackStatus === "closed" ? "closed" : enabled ? "open" : "error";
    const sessionId = this.readPreviewString(preview, ["session_id", "current_session_id", "bound_session_id"]) ?? this.readPreviewString(result.data, ["current_session_id", "session_id"]) ?? fallbackSessionId;
    const boundEventId = this.readPreviewNumber(preview, ["active_event_id", "bound_event_id", "event_id"]) ?? this.readPreviewNumber(result.data, ["active_event_id", "bound_event_id", "event_id"]);
    const lastError = this.readPreviewError(preview) ?? this.readPreviewError(result.data) ?? (enabled || fallbackStatus === "closed" ? void 0 : "Preview is not enabled.");
    return {
      status,
      sessionId,
      boundEventId,
      lastError
    };
  }
  readPreviewString(source, keys) {
    if (!source) {
      return void 0;
    }
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
    return void 0;
  }
  readPreviewNumber(source, keys) {
    if (!source) {
      return void 0;
    }
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return void 0;
  }
  readPreviewError(source) {
    if (!source) {
      return void 0;
    }
    const direct = source.last_error ?? source.error ?? source.error_message;
    if (typeof direct === "string" && direct.trim()) {
      return direct;
    }
    if (direct && typeof direct === "object") {
      const message = direct.message;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }
    return void 0;
  }
  createOpenedCaptureState(projectId, inputId, filePath, replayDevice, previewResult) {
    const activeCapture = this.captures.find((capture) => capture.id === this.activeCaptureId) ?? this.captures[0];
    return {
      projectId,
      inputId,
      filePath,
      captureId: activeCapture?.id ?? inputId,
      captureFileId: activeCapture?.captureFileId,
      sessionId: activeCapture?.sessionId ?? "",
      contextId: this.contextId ?? "",
      replaySessionId: activeCapture?.replaySessionId ?? "",
      backend: activeCapture?.backendHint ?? "local",
      deviceId: replayDevice.id,
      deviceLabel: replayDevice.label,
      status: activeCapture?.status === "error" ? "error" : "open",
      openedAt: Date.now(),
      preview: previewResult.preview,
      previewError: previewResult.error,
      previewAttempts: previewResult.attempts,
      runtimeContext: this.runtimeContext ? { ...this.runtimeContext } : null
    };
  }
  createPreviewFromPath(imagePath, source, fallbackWidth, fallbackHeight, metadata = {}) {
    const normalizedPath = path.resolve(imagePath);
    if (!fs.existsSync(normalizedPath)) {
      return null;
    }
    const image = electron.nativeImage.createFromPath(normalizedPath);
    if (image.isEmpty()) {
      return null;
    }
    const size = image.isEmpty() ? { width: 0, height: 0 } : image.getSize();
    const resolvedWidth = size.width || fallbackWidth || 0;
    const resolvedHeight = size.height || fallbackHeight || 0;
    if (resolvedWidth <= 0 || resolvedHeight <= 0) {
      return null;
    }
    return {
      imagePath: normalizedPath,
      imageUrl: image.toDataURL(),
      width: resolvedWidth,
      height: resolvedHeight,
      source,
      ...metadata,
      updatedAt: Date.now()
    };
  }
  async teardownRuntime() {
    if (this.runtimeContext) {
      const result = await rdxShellActionService.runAction("closeRuntime", {
        contextId: this.runtimeContext.contextId,
        runtimeOwner: this.runtimeContext.runtimeOwner,
        ownerLeaseId: this.runtimeContext.ownerLeaseId,
        replaySessionId: this.runtimeContext.replaySessionId,
        captureFileId: this.runtimeContext.captureFileId,
        captureId: this.runtimeContext.captureId
      }, {
        env: this.buildRuntimeContextEnv()
      });
      if (!result.ok) {
        runtimeLogService.log({
          scope: "app",
          namespace: "context",
          severity: "warning",
          title: "RDX runtime close warning",
          summary: result.error ?? "closeRuntime action failed.",
          raw: result
        });
      }
      return;
    }
    if (this.humanPreview.status !== "closed") {
      await this.closeHumanPreviewWindow().catch((error) => {
        runtimeLogService.log({
          scope: "app",
          namespace: "context",
          severity: "warning",
          title: "Human preview teardown warning",
          summary: error instanceof Error ? error.message : String(error)
        });
      });
    }
  }
  resetRuntimeState(previousCapture) {
    this.openedCapture = null;
    this.contextId = null;
    this.runtimeOwner = null;
    this.ownerLeaseId = null;
    this.captures = [];
    this.activeCaptureId = null;
    this.deviceLabel = "Local";
    this.replayDevice = null;
    this.remoteStatus = "disconnected";
    this.runtimeContext = null;
    setRdxRuntimeContext(null);
    this.humanPreview = {
      status: "closed",
      updatedAt: Date.now()
    };
    if (previousCapture) {
      this.openedCapture = null;
    }
  }
}
let server = null;
let bridgeUrl = null;
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};
function setCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Private-Network", "true");
}
function sendJson(response, statusCode, payload) {
  setCors(response);
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
async function checkDevRenderer(url$1) {
  return new Promise((resolveCheck) => {
    const target = new url.URL(url$1);
    const requestImpl = target.protocol === "https:" ? https.request : http.request;
    const request2 = requestImpl(
      {
        method: "GET",
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        timeout: 1500
      },
      (response) => {
        response.resume();
        const ok = Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 400);
        resolveCheck({
          ok,
          url: url$1,
          ...ok ? {} : { error: response.statusCode ? `HTTP ${response.statusCode}` : "Missing status code" }
        });
      }
    );
    request2.on("timeout", () => {
      request2.destroy(new Error("Timed out while connecting to the dev renderer"));
    });
    request2.on("error", (error) => {
      resolveCheck({ ok: false, url: url$1, error: error.message });
    });
    request2.end();
  });
}
async function readJsonBody(request2) {
  const chunks = [];
  for await (const chunk of request2) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf-8").trim();
  return text ? JSON.parse(text) : {};
}
function redirectToDevRenderer(response, rendererUrl, bridgeOrigin) {
  const target = new url.URL(rendererUrl);
  target.searchParams.set("rdcBridgeOrigin", bridgeOrigin);
  response.writeHead(302, {
    Location: target.toString(),
    "Cache-Control": "no-store"
  });
  response.end();
}
function serveStatic(response, rendererRoot, requestPath) {
  const relativePath = requestPath === "/app" || requestPath === "/app/" ? "index.html" : requestPath.replace(/^\/app\/?/, "").replace(/^\//, "");
  const requestedPath = path.normalize(path.join(rendererRoot, relativePath || "index.html"));
  const root = path.resolve(rendererRoot);
  const fallbackIndex = path.join(root, "index.html");
  const filePath = requestedPath.startsWith(root) && fs.existsSync(requestedPath) && fs.statSync(requestedPath).isFile() ? requestedPath : fallbackIndex;
  if (!fs.existsSync(filePath)) {
    sendJson(response, 404, { success: false, error: "Renderer build output not found" });
    return;
  }
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": contentTypes[path.extname(filePath)] ?? "application/octet-stream"
  });
  fs.createReadStream(filePath).pipe(response);
}
async function handleRequest(options, request2, response) {
  if (!request2.url) {
    sendJson(response, 400, { success: false, error: "Missing URL" });
    return;
  }
  if (request2.method === "OPTIONS") {
    setCors(response);
    response.writeHead(204);
    response.end();
    return;
  }
  const bridgeOrigin = bridgeUrl ?? "http://127.0.0.1";
  const url$1 = new url.URL(request2.url, bridgeOrigin);
  if (url$1.pathname === "/api/settings/providers/catalog" && request2.method === "GET") {
    const catalog = await invokeRegisteredIpcChannel("settings:getProviderCatalog");
    sendJson(response, 200, catalog);
    return;
  }
  if (url$1.pathname === "/health" && request2.method === "GET") {
    const renderer = options.devRendererUrl ? await checkDevRenderer(options.devRendererUrl) : { ok: fs.existsSync(path.join(options.rendererRoot, "index.html")), url: null };
    sendJson(response, 200, {
      ok: renderer.ok,
      productName: "RDC-Agent",
      mode: "browser-app-session",
      bridgeUrl,
      renderer
    });
    return;
  }
  if (url$1.pathname === "/invoke" && request2.method === "POST") {
    void readJsonBody(request2).then(async (body) => {
      const payload = body;
      if (typeof payload.channel !== "string") {
        sendJson(response, 400, { success: false, error: "channel must be a string" });
        return;
      }
      const args = Array.isArray(payload.args) ? payload.args : [];
      const result = await invokeRegisteredIpcChannel(payload.channel, args);
      sendJson(response, 200, { success: true, result });
    }).catch((error) => {
      sendJson(response, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });
    return;
  }
  if (url$1.pathname === "/events" && request2.method === "GET") {
    rendererEventHub.connect(response);
    return;
  }
  if (url$1.pathname === "/app" || url$1.pathname.startsWith("/app/")) {
    if (options.devRendererUrl) {
      const renderer = await checkDevRenderer(options.devRendererUrl);
      if (!renderer.ok) {
        sendJson(response, 503, {
          success: false,
          error: "Dev renderer is not reachable",
          renderer
        });
        return;
      }
      redirectToDevRenderer(response, options.devRendererUrl, bridgeOrigin);
      return;
    }
    serveStatic(response, options.rendererRoot, url$1.pathname);
    return;
  }
  if (!options.devRendererUrl && (url$1.pathname.startsWith("/assets/") || url$1.pathname === "/favicon.ico")) {
    serveStatic(response, options.rendererRoot, url$1.pathname);
    return;
  }
  sendJson(response, 404, { success: false, error: "Not found" });
}
async function startBrowserAppBridge(options) {
  if (server && bridgeUrl) {
    return bridgeUrl;
  }
  const preferredPort = options.preferredPort ?? Number(process.env.RDC_AGENT_BROWSER_BRIDGE_PORT || 5127);
  server = http.createServer((request2, response) => {
    void handleRequest(options, request2, response).catch((error) => {
      sendJson(response, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  });
  await new Promise((resolveListen, rejectListen) => {
    const activeServer = server;
    if (!activeServer) {
      rejectListen(new Error("Browser app bridge server was not created"));
      return;
    }
    const listen = (port2) => {
      activeServer.once("error", (error) => {
        if (error.code === "EADDRINUSE" && port2 !== 0) {
          listen(0);
          return;
        }
        rejectListen(error);
      });
      activeServer.listen(port2, "127.0.0.1", () => resolveListen());
    };
    listen(preferredPort);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : preferredPort;
  bridgeUrl = `http://127.0.0.1:${port}`;
  globalThis.__RDC_AGENT_BROWSER_BRIDGE_URL__ = bridgeUrl;
  console.log(`[BrowserAppBridge] Browser app session: ${bridgeUrl}/app`);
  return bridgeUrl;
}
async function stopBrowserAppBridge() {
  const activeServer = server;
  server = null;
  bridgeUrl = null;
  delete globalThis.__RDC_AGENT_BROWSER_BRIDGE_URL__;
  if (!activeServer) {
    return;
  }
  await new Promise((resolveClose) => activeServer.close(() => resolveClose()));
}
const rdxSessionService = new RdxSessionService();
const __dirname$1 = path__namespace.dirname(url.fileURLToPath(require("url").pathToFileURL(__filename).href));
const configuredUserDataPath = process.env.RDC_AGENT_USER_DATA?.trim();
if (configuredUserDataPath) {
  electron.app.commandLine.appendSwitch("user-data-dir", configuredUserDataPath);
  electron.app.setPath("userData", configuredUserDataPath);
} else {
  electron.app.setPath("userData", path__namespace.join(electron.app.getPath("appData"), "rdc-agent"));
}
const isDev = process.env.NODE_ENV === "development" && process.env.RDC_AGENT_TEST_MODE !== "1";
const isSettingsRebuildOnly = process.env.RDC_AGENT_REBUILD_SETTINGS_ONLY === "1";
const isTestMode = process.env.RDC_AGENT_TEST_MODE === "1";
const isHeadlessMode = process.env.RDC_AGENT_HEADLESS === "1";
const hasSingleInstanceLock = isSettingsRebuildOnly || electron.app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  console.log("[RDC-Agent] Another instance is already running. Reusing the existing instance.");
  electron.app.exit(0);
}
if (isTestMode || isHeadlessMode) {
  electron.app.disableHardwareAcceleration();
  electron.app.commandLine.appendSwitch("disable-gpu");
  electron.app.commandLine.appendSwitch("disable-gpu-compositing");
  electron.app.commandLine.appendSwitch("in-process-gpu");
}
let mainWindow = null;
let headlessKeepAliveTimer = null;
let headlessKeepAliveWindow = null;
const allowedNavigationOrigins = /* @__PURE__ */ new Set();
electron.app.on("second-instance", () => {
  if (isHeadlessMode) {
    console.log("[RDC-Agent] Headless instance already running; ignoring duplicate startup.");
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
});
function registerAllowedOrigin(url2) {
  try {
    allowedNavigationOrigins.add(new URL(url2).origin);
  } catch {
  }
}
function emitWindowMaximizedState() {
  if (!mainWindow) return;
  rendererEventHub.emit("window:maximized-changed", mainWindow.isMaximized());
  mainWindow.webContents.send("window:maximized-changed", mainWindow.isMaximized());
}
function getDevRendererUrl() {
  const configuredUrl = process.env["ELECTRON_RENDERER_URL"] || "http://127.0.0.1:5173";
  const rendererUrl = new URL(configuredUrl);
  if (rendererUrl.hostname === "localhost") {
    rendererUrl.hostname = "127.0.0.1";
  }
  return rendererUrl.toString();
}
async function openRdcFiles() {
  const result = await electron.dialog.showOpenDialog({
    filters: [
      { name: "RenderDoc Capture", extensions: ["rdc"] }
    ],
    properties: ["openFile", "multiSelections"]
  });
  if (!result.canceled && result.filePaths.length > 0) {
    runtimeLogService.log({
      scope: "app",
      namespace: "system",
      severity: "info",
      title: "Open files",
      summary: `已选择 ${result.filePaths.length} 个外部 .rdc 文件。`,
      raw: {
        filePaths: result.filePaths
      }
    });
    rendererEventHub.emit("file:open", result.filePaths);
    mainWindow?.webContents.send("file:open", result.filePaths);
  }
}
function setupKeyboardShortcuts(window) {
  window.webContents.on("before-input-event", async (event, input) => {
    const commandOrControl = input.control || input.meta;
    if (!commandOrControl || input.type !== "keyDown") return;
    const key = input.key.toLowerCase();
    if (key === "o") {
      event.preventDefault();
      await openRdcFiles();
      return;
    }
    if (key === "n") {
      event.preventDefault();
      rendererEventHub.emit("case:new");
      window.webContents.send("case:new");
      return;
    }
    if (key === ",") {
      event.preventDefault();
      rendererEventHub.emit("settings:open");
      window.webContents.send("settings:open");
    }
  });
}
function createMainWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 360,
    minHeight: 640,
    title: "RdcAgent - RenderDoc Debug Agent",
    show: false,
    webPreferences: {
      preload: path__namespace.join(__dirname$1, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    },
    // Window chrome.
    frame: false,
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    backgroundColor: "#08080c"
  });
  if (isDev) {
    const rendererUrl = getDevRendererUrl();
    registerAllowedOrigin(rendererUrl);
    mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadFile(path__namespace.join(__dirname$1, "../renderer/index.html"));
  }
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.on("maximize", emitWindowMaximizedState);
  mainWindow.on("unmaximize", emitWindowMaximizedState);
  mainWindow.on("enter-full-screen", emitWindowMaximizedState);
  mainWindow.on("leave-full-screen", emitWindowMaximizedState);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log("[RendererConsole]", { level, message, line, sourceId });
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("[RendererLoadFailed]", { errorCode, errorDescription, validatedURL });
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[RendererProcessGone]", details);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url: url2 }) => {
    if (url2.startsWith("http://") || url2.startsWith("https://")) {
      electron.shell.openExternal(url2);
    }
    return { action: "deny" };
  });
  setMainWindow(mainWindow);
  setupKeyboardShortcuts(mainWindow);
  setupMenu();
}
function setupMenu() {
  if (process.platform === "darwin") {
    const template = [
      { role: "appMenu" },
      {
        label: "File",
        submenu: [
          {
            label: "Open .rdc File",
            accelerator: "CmdOrCtrl+O",
            click: async () => openRdcFiles()
          },
          {
            label: "New Case",
            accelerator: "CmdOrCtrl+N",
            click: () => {
              rendererEventHub.emit("case:new");
              mainWindow?.webContents.send("case:new");
            }
          },
          {
            label: "Settings",
            accelerator: "CmdOrCtrl+,",
            click: () => {
              rendererEventHub.emit("settings:open");
              mainWindow?.webContents.send("settings:open");
            }
          },
          { type: "separator" },
          { role: "close" }
        ]
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" }
        ]
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "togglefullscreen" }
        ]
      },
      {
        label: "Help",
        submenu: [
          {
            label: "Documentation",
            click: () => {
              electron.shell.openExternal("https://github.com/rdc-agent/docs");
            }
          },
          {
            label: "Report Issue",
            click: () => {
              electron.shell.openExternal("https://github.com/rdc-agent/issues");
            }
          }
        ]
      }
    ];
    electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate(template));
    return;
  }
  electron.Menu.setApplicationMenu(null);
}
electron.app.whenReady().then(async () => {
  const settings = settingsService.initialize();
  if (isSettingsRebuildOnly) {
    console.log("[SettingsRebuildOnly]", JSON.stringify({
      workspaceRoot: settings.workspace.rootPath,
      settingsPath: settings.paths.settingsPath,
      providerIds: settings.llm.providers.map((provider) => provider.id)
    }));
    electron.app.exit(0);
    return;
  }
  await storageAdapter.initializeWorkspace();
  runtimeLogService.log({
    scope: "app",
    namespace: "system",
    severity: "info",
    title: "App ready",
    summary: "RDC Agent 主进程已启动。",
    raw: {
      workspaceRoot: storageAdapter.getWorkspacePath()
    }
  });
  registerIPCHandlers();
  await initializeServices();
  const bridgeUrl2 = await startBrowserAppBridge({
    devRendererUrl: isDev ? getDevRendererUrl() : null,
    rendererRoot: path__namespace.join(__dirname$1, "../renderer")
  });
  runtimeLogService.log({
    scope: "app",
    namespace: "system",
    severity: "success",
    title: "Browser app session ready",
    summary: `浏览器真实会话入口已启动：${bridgeUrl2}/app`,
    raw: { bridgeUrl: bridgeUrl2 }
  });
  if (isHeadlessMode) {
    headlessKeepAliveWindow = new electron.BrowserWindow({
      width: 1,
      height: 1,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false
      }
    });
    headlessKeepAliveWindow.loadURL("about:blank").catch(() => {
    });
    headlessKeepAliveWindow.on("closed", () => {
      headlessKeepAliveWindow = null;
    });
    headlessKeepAliveTimer = setInterval(() => {
    }, 6e4);
    console.log(`[BrowserAppBridge] Headless mode enabled. Open ${bridgeUrl2}/app`);
  } else {
    createMainWindow();
  }
  electron.app.on("activate", () => {
    if (!isHeadlessMode && electron.BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});
electron.app.on("window-all-closed", () => {
  if (isHeadlessMode) {
    return;
  }
  replayDeviceService.dispose();
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.app.on("before-quit", (event) => {
  if (isHeadlessMode) {
    event.preventDefault();
    return;
  }
  if (headlessKeepAliveWindow && !headlessKeepAliveWindow.isDestroyed()) {
    headlessKeepAliveWindow.destroy();
    headlessKeepAliveWindow = null;
  }
  if (headlessKeepAliveTimer) {
    clearInterval(headlessKeepAliveTimer);
    headlessKeepAliveTimer = null;
  }
  void stopAllActiveRuns();
  void stopBrowserAppBridge();
  replayDeviceService.dispose();
  if (isTestMode) {
    const forceExitTimer = setTimeout(() => electron.app.exit(0), 100);
    forceExitTimer.unref?.();
  }
});
electron.app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    const isAllowedDevOrigin = allowedNavigationOrigins.has(parsedUrl.origin);
    if (!isAllowedDevOrigin && parsedUrl.protocol !== "file:") {
      event.preventDefault();
    }
  });
});
async function initializeServices() {
  try {
    const hasConfiguredProvider = settingsService.hasConfiguredProvider();
    console.log("[Main] SettingsService initialized, hasConfiguredProvider:", hasConfiguredProvider);
    await rdxCliInvokerService.loadCatalog();
    console.log("[Main] RDX CLI invoker initialized");
    runtimeLogService.log({
      scope: "app",
      namespace: "system",
      severity: "success",
      title: "RDX CLI invoker ready",
      summary: "RDX CLI invoker 诊断已加载。"
    });
    await initializeIpcState();
    console.log("[Main] DebuggerRuntime initialized");
    await replayDeviceService.initialize();
    console.log("[Main] ReplayDeviceService initialized");
    runtimeLogService.log({
      scope: "app",
      namespace: "system",
      severity: "success",
      title: "Services ready",
      summary: "主进程服务初始化完成。"
    });
  } catch (error) {
    console.error("[Main] Failed to initialize services:", error);
    runtimeLogService.log({
      scope: "app",
      namespace: "system",
      severity: "error",
      title: "Service init failed",
      summary: error instanceof Error ? error.message : String(error)
    });
  }
}
function getMainWindow() {
  return mainWindow;
}
exports.getMainWindow = getMainWindow;
exports.rdxSessionService = rdxSessionService;
