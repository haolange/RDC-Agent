"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const electron = require("electron");
const path = require("path");
const url = require("url");
const child_process = require("child_process");
const fs = require("fs");
const uuid = require("uuid");
const yaml = require("yaml");
const crypto = require("crypto");
require("node:fs");
const path$1 = require("node:path");
require("node:crypto");
const fs$1 = require("fs/promises");
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
const fs__namespace$1 = /* @__PURE__ */ _interopNamespaceDefault(fs$1);
const net__namespace = /* @__PURE__ */ _interopNamespaceDefault(net);
function generateId() {
  return uuid.v4();
}
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
const DEFAULT_MODEL_ROUTING = {
  "ask_agent": { provider: "openrouter", model: "anthropic/claude-3-sonnet" },
  "rdc-debugger": { provider: "openrouter", model: "anthropic/claude-3-opus" },
  "triage_agent": { provider: "openrouter", model: "anthropic/claude-3-sonnet" },
  "capture_repro_agent": { provider: "openrouter", model: "anthropic/claude-3-sonnet" },
  "pass_graph_pipeline_agent": { provider: "openrouter", model: "anthropic/claude-3-sonnet" },
  "pixel_forensics_agent": { provider: "openrouter", model: "google/gemini-pro-1.5" },
  "shader_ir_agent": { provider: "openrouter", model: "anthropic/claude-3-sonnet" },
  "driver_device_agent": { provider: "openrouter", model: "anthropic/claude-3-sonnet" },
  "skeptic_agent": { provider: "openrouter", model: "openai/gpt-4o" },
  "curator_agent": { provider: "openrouter", model: "anthropic/claude-3-sonnet" }
};
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
const BUILTIN_LLM_PROVIDER_DEFINITIONS = [
  {
    id: "302ai",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "openai-compatible",
    modelDiscovery: "openai-compatible",
    label: "302.AI",
    baseUrl: "https://api.302.ai/v1",
    recommendedModels: ["gpt-4o", "claude-3-7-sonnet"],
    docsUrl: "https://302.ai/",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "azure-openai",
    kind: "azure-openai",
    authMode: "api-key",
    catalogGroup: "cloud-platform",
    modelDiscovery: "azure-openai",
    label: "Azure OpenAI",
    baseUrl: "",
    baseUrlEditable: true,
    recommendedModels: ["gpt-4.1", "gpt-5-mini"],
    docsUrl: "https://learn.microsoft.com/azure/ai-services/openai/",
    capabilities: CAPS_AZURE_OPENAI
  },
  {
    id: "bailian",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "anthropic-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Alibaba Cloud Bailian",
    baseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
    recommendedModels: ["qwen3.6-plus", "qwen3-coder-next", "qwen3-coder-plus", "kimi-k2.5", "glm-5", "glm-4.7"],
    docsUrl: "https://bailian.console.aliyun.com/",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "anthropic",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "anthropic-compatible",
    modelDiscovery: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    recommendedModels: ANTHROPIC_FIRST_PARTY_MODELS,
    docsUrl: "https://platform.claude.com/settings/keys",
    capabilities: CAPS_ANTHROPIC_FIRST_PARTY
  },
  {
    id: "anthropic-thirdparty",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "anthropic-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Anthropic-compatible Endpoint",
    baseUrl: "",
    baseUrlEditable: true,
    recommendedModels: ANTHROPIC_ALIAS_MODELS,
    docsUrl: "https://platform.claude.com/docs/en/api/overview",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "cerebras",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "openai-compatible",
    modelDiscovery: "openai-compatible",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    recommendedModels: ["llama-4-scout-17b-16e-instruct", "qwen-3-coder-480b"],
    docsUrl: "https://cloud.cerebras.ai/",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "bedrock",
    kind: "bedrock",
    authMode: "environment",
    catalogGroup: "cloud-platform",
    modelDiscovery: "static",
    label: "Amazon Bedrock",
    recommendedModels: ANTHROPIC_ALIAS_MODELS,
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/amazon-bedrock",
    capabilities: CAPS_STATIC_CLOUD
  },
  {
    id: "custom-endpoint",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "openai-compatible",
    modelDiscovery: "openai-compatible",
    label: "OpenAI-compatible Endpoint",
    baseUrl: "",
    baseUrlEditable: true,
    recommendedModels: ["gpt-4.1"],
    docsUrl: "https://platform.openai.com/docs/api-reference",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "claude-account",
    kind: "anthropic",
    authMode: "account",
    catalogGroup: "account",
    modelDiscovery: "account-catalog",
    label: "Claude Account",
    recommendedModels: CLAUDE_ACCOUNT_MODELS,
    docsUrl: "https://claude.ai/",
    accountLoginConfigured: true,
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "chatgpt-account",
    kind: "openai-compatible",
    authMode: "account",
    catalogGroup: "account",
    modelDiscovery: "account-catalog",
    label: "ChatGPT Account",
    recommendedModels: CHATGPT_ACCOUNT_MODELS,
    docsUrl: "https://chatgpt.com/",
    accountLoginConfigured: true,
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "deepseek",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "anthropic-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/anthropic",
    recommendedModels: ["deepseek-v4-pro", "deepseek-v4-flash"],
    docsUrl: "https://platform.deepseek.com/api_keys",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "github-copilot",
    kind: "openai-compatible",
    authMode: "account",
    catalogGroup: "account",
    modelDiscovery: "account-catalog",
    label: "GitHub Copilot",
    recommendedModels: GITHUB_COPILOT_ACCOUNT_MODELS,
    docsUrl: "https://github.com/features/copilot",
    accountLoginConfigured: true,
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "grok-account",
    kind: "openai-compatible",
    authMode: "account",
    catalogGroup: "account",
    modelDiscovery: "account-catalog",
    label: "Grok Account",
    baseUrl: "https://api.x.ai/v1",
    recommendedModels: GROK_ACCOUNT_MODELS,
    docsUrl: "https://grok.com/",
    accountLoginConfigured: true,
    unavailableReason: "Live Grok account OAuth requires a stable public account authorization contract; this adapter is mock-verifiable until that contract is configured.",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "gemini-account",
    kind: "google-ai-studio",
    authMode: "account",
    catalogGroup: "account",
    modelDiscovery: "account-catalog",
    label: "Gemini Account",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    recommendedModels: GEMINI_ACCOUNT_MODELS,
    docsUrl: "https://gemini.google.com/",
    accountLoginConfigured: true,
    unavailableReason: "Live Gemini account OAuth requires a stable public account authorization contract; this adapter is mock-verifiable until that contract is configured.",
    capabilities: CAPS_GOOGLE_AI_STUDIO
  },
  {
    id: "qwen-account",
    kind: "openai-compatible",
    authMode: "account",
    catalogGroup: "account",
    modelDiscovery: "account-catalog",
    label: "Qwen Account",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    recommendedModels: QWEN_ACCOUNT_MODELS,
    docsUrl: "https://chat.qwen.ai/",
    accountLoginConfigured: true,
    unavailableReason: "Live Qwen account OAuth requires a stable public account authorization contract; this adapter is mock-verifiable until that contract is configured.",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "google-ai-studio",
    kind: "google-ai-studio",
    authMode: "api-key",
    catalogGroup: "openai-compatible",
    modelDiscovery: "google-ai-studio",
    label: "Google AI Studio",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    recommendedModels: ["gemini-2.5-pro", "gemini-2.5-flash"],
    docsUrl: "https://aistudio.google.com/app/apikey",
    capabilities: CAPS_GOOGLE_AI_STUDIO
  },
  {
    id: "groq",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "openai-compatible",
    modelDiscovery: "openai-compatible",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    recommendedModels: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"],
    docsUrl: "https://console.groq.com/keys",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "glm-cn",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "anthropic-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Zhipu AI GLM (CN)",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    recommendedModels: ["sonnet", "opus", "haiku"],
    docsUrl: "https://open.bigmodel.cn/",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "glm-global",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "anthropic-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Z.ai GLM (Global)",
    baseUrl: "https://api.z.ai/api/anthropic",
    recommendedModels: ["sonnet", "opus", "haiku"],
    docsUrl: "https://platform.z.ai/",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "huggingface",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "openai-compatible",
    modelDiscovery: "openai-compatible",
    label: "Hugging Face",
    baseUrl: "https://router.huggingface.co/v1",
    recommendedModels: ["openai/gpt-oss-120b", "Qwen/Qwen3-Coder-480B-A35B-Instruct"],
    docsUrl: "https://huggingface.co/settings/tokens",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "vertex",
    kind: "vertex",
    authMode: "environment",
    catalogGroup: "cloud-platform",
    modelDiscovery: "static",
    label: "Google Vertex AI",
    recommendedModels: ANTHROPIC_ALIAS_MODELS,
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/google-vertex-ai",
    capabilities: CAPS_STATIC_CLOUD
  },
  {
    id: "kimi-code",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "anthropic-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Kimi Code",
    baseUrl: "https://api.kimi.com/coding/v1",
    recommendedModels: ["kimi-for-coding"],
    docsUrl: "https://www.kimi.com/code/docs/en/",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "litellm",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "anthropic-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "LiteLLM",
    baseUrl: "http://localhost:4000",
    recommendedModels: ANTHROPIC_ALIAS_MODELS,
    docsUrl: "https://docs.litellm.ai/docs/",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "manifest",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "openai-compatible",
    modelDiscovery: "openai-compatible",
    label: "Manifest",
    baseUrl: "https://app.manifest.build/v1",
    recommendedModels: ["gpt-4.1"],
    docsUrl: "https://app.manifest.build/",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "minimax-cn",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "anthropic-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "MiniMax (CN)",
    baseUrl: "https://api.minimaxi.com/anthropic",
    recommendedModels: ["MiniMax-M2.7"],
    docsUrl: "https://platform.minimaxi.com/",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "minimax-global",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "anthropic-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "MiniMax (Global)",
    baseUrl: "https://api.minimax.io/anthropic",
    recommendedModels: ["MiniMax-M2.7"],
    docsUrl: "https://platform.minimaxi.com/",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "mistral",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "openai-compatible",
    modelDiscovery: "openai-compatible",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    recommendedModels: ["mistral-large-latest", "codestral-latest"],
    docsUrl: "https://console.mistral.ai/api-keys/",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "moonshot",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "anthropic-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Kimi / Moonshot AI",
    baseUrl: "https://api.moonshot.cn/anthropic",
    recommendedModels: ["sonnet"],
    docsUrl: "https://platform.moonshot.cn/console/api-keys",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "openrouter",
    kind: "openrouter",
    authMode: "api-key",
    catalogGroup: "openai-compatible",
    modelDiscovery: "openai-compatible",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    recommendedModels: ["anthropic/claude-haiku-latest", "anthropic/claude-sonnet-4.5", "openai/gpt-5.2"],
    docsUrl: "https://openrouter.ai/keys",
    capabilities: CAPS_OPENROUTER
  },
  {
    id: "openai",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "openai-compatible",
    modelDiscovery: "openai-compatible",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    recommendedModels: OPENAI_CODE_MODELS,
    docsUrl: "https://platform.openai.com/api-keys",
    capabilities: CAPS_OPENAI_FIRST_PARTY
  },
  {
    id: "openai-eu",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "openai-compatible",
    modelDiscovery: "openai-compatible",
    label: "OpenAI (EU)",
    baseUrl: "https://eu.api.openai.com/v1",
    recommendedModels: OPENAI_CODE_MODELS,
    docsUrl: "https://platform.openai.com/api-keys",
    capabilities: CAPS_OPENAI_FIRST_PARTY
  },
  {
    id: "openai-us",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "openai-compatible",
    modelDiscovery: "openai-compatible",
    label: "OpenAI (US)",
    baseUrl: "https://us.api.openai.com/v1",
    recommendedModels: OPENAI_CODE_MODELS,
    docsUrl: "https://platform.openai.com/api-keys",
    capabilities: CAPS_OPENAI_FIRST_PARTY
  },
  {
    id: "qwen",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "openai-compatible",
    modelDiscovery: "openai-compatible",
    label: "Qwen / DashScope",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    recommendedModels: ["qwen-plus", "qwen-max"],
    docsUrl: "https://dashscope.console.aliyun.com/apiKey",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "siliconflow",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "openai-compatible",
    modelDiscovery: "openai-compatible",
    label: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    recommendedModels: ["Qwen/Qwen3-32B", "deepseek-ai/DeepSeek-V3"],
    docsUrl: "https://siliconflow.cn/",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "volcengine",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "anthropic-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Volcengine Ark (Doubao)",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding",
    recommendedModels: ["doubao-seed-1-6", "glm-4.6", "deepseek-v4-pro", "kimi-k2.5"],
    docsUrl: "https://www.volcengine.com/docs/82379/1928262",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "vercel-ai-gateway",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "openai-compatible",
    modelDiscovery: "openai-compatible",
    label: "Vercel AI Gateway",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    recommendedModels: ["openai/gpt-5.2", "anthropic/claude-sonnet-4.5"],
    docsUrl: "https://vercel.com/docs/ai-gateway",
    capabilities: CAPS_OPENAI_COMPATIBLE
  },
  {
    id: "xai",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "openai-compatible",
    modelDiscovery: "openai-compatible",
    label: "xAI (Grok)",
    baseUrl: "https://api.x.ai/v1",
    recommendedModels: ["grok-4.3", "grok-4"],
    docsUrl: "https://docs.x.ai/",
    capabilities: CAPS_XAI
  },
  {
    id: "xiaomi-mimo",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "anthropic-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Xiaomi MiMo",
    baseUrl: "https://api.xiaomimimo.com/anthropic",
    recommendedModels: ["mimo-v2.5-pro"],
    docsUrl: "https://platform.xiaomimimo.com/#/console/api-keys",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "xiaomi-mimo-token-plan",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "anthropic-compatible",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Xiaomi MiMo Token Plan",
    baseUrl: "https://token-plan-cn.xiaomimimo.com/anthropic",
    recommendedModels: ["mimo-v2.5-pro"],
    docsUrl: "https://platform.xiaomimimo.com/#/console/plan-manage",
    capabilities: CAPS_ANTHROPIC
  },
  {
    id: "ollama",
    kind: "ollama",
    authMode: "local",
    catalogGroup: "local",
    modelDiscovery: "ollama-tags",
    label: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
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
  return {
    id: definition.id,
    kind: definition.kind,
    authMode: definition.authMode,
    catalogGroup: definition.catalogGroup,
    modelDiscovery: definition.modelDiscovery,
    label: definition.label,
    enabled: false,
    apiKey: "",
    hasStoredSecret: definition.authMode === "local" || definition.authMode === "environment",
    baseUrl: definition.baseUrl,
    baseUrlEditable: definition.baseUrlEditable,
    models: definition.modelDiscovery === "static" && definition.authMode === "environment" ? toModels(definition.recommendedModels) : toModels([]),
    recommendedModels: definition.recommendedModels,
    docsUrl: definition.docsUrl,
    status: "unconfigured",
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
const MAIN_STAGES = [
  "preflight",
  "entry_gate",
  "intake_gate",
  "plan",
  "speclist",
  "dispatch",
  "investigate",
  "fix_verify",
  "skepti",
  "curate",
  "finalize"
];
const SPECIAL_STAGES = [
  "blocked",
  "awaiting_user_input"
];
const ALL_STAGES = [...MAIN_STAGES, ...SPECIAL_STAGES];
const STAGE_PHASES = {
  preflight: "planner",
  entry_gate: "planner",
  intake_gate: "planner",
  plan: "planner",
  speclist: "planner",
  dispatch: "generator",
  investigate: "generator",
  fix_verify: "evaluator",
  skepti: "evaluator",
  curate: "evaluator",
  finalize: "evaluator",
  blocked: "evaluator",
  awaiting_user_input: "planner"
};
const LEGACY_STAGE_MIGRATION = {
  preflight_pending: "preflight",
  intent_gate_passed: "plan",
  entry_gate_passed: "entry_gate",
  accepted_intake_initialized: "intake_gate",
  intake_gate_passed: "intake_gate",
  waiting_for_specialist_brief: "dispatch",
  specialist_briefs_collected: "dispatch",
  expert_investigation_complete: "investigate",
  fix_verification_complete: "fix_verify",
  skeptic_ready: "skepti",
  curator_ready: "curate",
  finalized: "finalize",
  validation_blocked: "blocked"
};
const normalizeWorkflowStage = (stage) => {
  if (!stage) {
    return "preflight";
  }
  if (ALL_STAGES.includes(stage)) {
    return stage;
  }
  return LEGACY_STAGE_MIGRATION[stage] || "preflight";
};
const AGENT_ROLES = [
  "ask_agent",
  "rdc-debugger",
  "triage_agent",
  "capture_repro_agent",
  "pass_graph_pipeline_agent",
  "pixel_forensics_agent",
  "shader_ir_agent",
  "driver_device_agent",
  "skeptic_agent",
  "curator_agent"
];
const AGENT_DISPLAY_NAMES = {
  "ask_agent": "Ask",
  "rdc-debugger": "RDC Debugger",
  "triage_agent": "Triage Agent",
  "capture_repro_agent": "Capture Repro Agent",
  "pass_graph_pipeline_agent": "Pass Graph Agent",
  "pixel_forensics_agent": "Pixel Forensics Agent",
  "shader_ir_agent": "Shader IR Agent",
  "driver_device_agent": "Driver Device Agent",
  "skeptic_agent": "Skeptic Agent",
  "curator_agent": "Curator Agent"
};
const AGENT_DESCRIPTIONS = {
  "ask_agent": "Non-executing assistant for clarification, capability explanation, and Open capture guidance",
  "rdc-debugger": "Main orchestrator responsible for workflow coordination, gates, and stage progression",
  "triage_agent": "Symptom classification and SOP recommendation",
  "capture_repro_agent": "Capture quality verification and baseline establishment",
  "pass_graph_pipeline_agent": "Render pass and pipeline dependency analysis",
  "pixel_forensics_agent": "Pixel-level evidence collection and first-bad event localization",
  "shader_ir_agent": "Shader source and IR evidence analysis",
  "driver_device_agent": "Cross-device attribution and platform-specific checks",
  "skeptic_agent": "Evidence chain challenger and weak claim detector",
  "curator_agent": "Final report generation and knowledge library curation"
};
const AGENT_CATEGORIES = {
  "ask_agent": "orchestrator",
  "rdc-debugger": "orchestrator",
  "triage_agent": "investigator",
  "capture_repro_agent": "investigator",
  "pass_graph_pipeline_agent": "investigator",
  "pixel_forensics_agent": "investigator",
  "shader_ir_agent": "investigator",
  "driver_device_agent": "investigator",
  "skeptic_agent": "verifier",
  "curator_agent": "reporter"
};
const INVESTIGATOR_AGENTS = [
  "triage_agent",
  "capture_repro_agent",
  "pass_graph_pipeline_agent",
  "pixel_forensics_agent",
  "shader_ir_agent",
  "driver_device_agent"
];
const VERIFIER_AGENTS = ["skeptic_agent"];
const REPORTER_AGENTS = ["curator_agent"];
const AGENT_WRITE_SCOPES = {
  "ask_agent": [],
  "rdc-debugger": ["workspace_control"],
  "triage_agent": ["workspace_notes"],
  "capture_repro_agent": ["workspace_notes"],
  "pass_graph_pipeline_agent": ["workspace_notes"],
  "pixel_forensics_agent": ["workspace_notes"],
  "shader_ir_agent": ["workspace_notes"],
  "driver_device_agent": ["workspace_notes"],
  "skeptic_agent": ["session_signoff"],
  "curator_agent": ["workspace_reports", "session_artifacts", "knowledge_library"]
};
const AGENT_MODES = [
  {
    id: "ask",
    label: "Ask",
    icon: "message-orbit",
    description: "澄清目标并引导打开 Capture",
    accentColor: "#38c6f4",
    disabled: false
  },
  {
    id: "debugger",
    label: "Debugger",
    icon: "crosshair-bug",
    description: "定位异常与验证修复",
    accentColor: "#33d1ff",
    disabled: false
  },
  {
    id: "analyzer",
    label: "Analyzer",
    icon: "waveform-gauge",
    description: "拆解现象并收敛证据",
    accentColor: "#8d8bff",
    disabled: false
  },
  {
    id: "optimizer",
    label: "Optimizer",
    icon: "spark-tuning",
    description: "判断瓶颈与优化顺序",
    accentColor: "#4ee3a0",
    disabled: false
  }
];
AGENT_MODES.reduce(
  (accumulator, mode) => {
    accumulator[mode.id] = mode;
    return accumulator;
  },
  {}
);
const RETIRED_BUILTIN_MCP_SERVER_IDS$1 = /* @__PURE__ */ new Set(["builtin.rdc-toolbridge"]);
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
  }
  listPatterns(workspaceRoot = appPathService.getWorkspaceRoot()) {
    return this.readDescriptors("patterns", workspaceRoot);
  }
  listSkills(workspaceRoot = appPathService.getWorkspaceRoot()) {
    return this.readDescriptors("skills", workspaceRoot);
  }
  listMcpServers(workspaceRoot = appPathService.getWorkspaceRoot()) {
    return this.readDescriptors("mcp", workspaceRoot).filter((descriptor) => !RETIRED_BUILTIN_MCP_SERVER_IDS$1.has(descriptor.id));
  }
  readDescriptors(kind, workspaceRoot) {
    this.ensureScaffold(workspaceRoot);
    const paths = appPathService.getWorkspacePaths(workspaceRoot);
    const dir = kind === "patterns" ? paths.patternsPath : kind === "skills" ? paths.skillsPath : paths.mcpPath;
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs.readdirSync(dir).filter((entry) => entry.endsWith(".json")).map((entry) => readJsonFile$1(path.join(dir, entry))).filter((entry) => Boolean(entry?.id)).sort((left, right) => left.id.localeCompare(right.id));
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
  const debuggerRoute = routes.find((entry) => entry.agentId === "rdc-debugger");
  const candidates = [
    ...agentId !== "rdc-debugger" && debuggerRoute?.providerId === provider.id ? [debuggerRoute.modelId] : [],
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
  patternId: "plan-generate-verify",
  skillIds: [],
  mcpServerIds: [],
  stagePolicies: {},
  defaultAgentPrompts: {}
});
const createFallbackAgentProfile = (agentId) => {
  const route = DEFAULT_MODEL_ROUTING[agentId];
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
      enabledSkillIds: configuration.enabledSkillIds ?? [],
      enabledMcpServerIds: configuration.enabledMcpServerIds ?? [],
      modePatternBindings: {
        debugger: patternIds.has(modePatternBindings.debugger) ? modePatternBindings.debugger : "plan-generate-verify",
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
      category: AGENT_CATEGORIES[agentId],
      writeScope: AGENT_WRITE_SCOPES[agentId],
      stage,
      phase: stagePolicy.phase || STAGE_PHASES[stage],
      toolAllowlist: Array.from(/* @__PURE__ */ new Set([
        ...expandToolPolicy(stagePolicy.toolPolicy),
        ...expandToolPolicy(agentProfile.toolPolicy)
      ])),
      patternId: modeProfile.patternId ?? settings.configuration.modePatternBindings[modeProfile.mode],
      skillIds: Array.from(/* @__PURE__ */ new Set([
        ...modeProfile.skillIds ?? [],
        ...settings.configuration.enabledSkillIds ?? []
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
const CATALOG_GROUPS = [
  "account",
  "openai-compatible",
  "anthropic-compatible",
  "cloud-platform",
  "local",
  "image"
];
function normalizeProviderCatalogGroup(provider) {
  const current = provider.catalogGroup;
  if (typeof current === "string" && CATALOG_GROUPS.includes(current)) {
    return current;
  }
  const id = typeof provider.id === "string" ? provider.id.trim() : "";
  if (id) {
    const builtinDef = BUILTIN_LLM_PROVIDER_DEFINITIONS.find((def) => def.id === id);
    if (builtinDef) {
      return builtinDef.catalogGroup;
    }
  }
  switch (provider.authMode) {
    case "account":
      return "account";
    case "local":
      return "local";
    case "environment":
      return "cloud-platform";
    default:
      console.warn(
        "[SettingsService] Unable to infer catalogGroup for provider; defaulting to openai-compatible.",
        { id, authMode: provider.authMode, catalogGroup: current }
      );
      return "openai-compatible";
  }
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
const KNOWN_AGENT_IDS = new Set(Object.keys(DEFAULT_MODEL_ROUTING));
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
  enabledSkillIds: [],
  enabledMcpServerIds: [],
  modePatternBindings: {
    debugger: "plan-generate-verify",
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
const DEFAULT_TOOLING = {
  rdxCli: DEFAULT_RDX_CLI_INVOKER
};
const DEFAULT_PROVIDER_SEEDS = [
  {
    id: "deepseek",
    apiKey: "sk-15c018cd2a76442183e3cc5da3dbbaf9",
    models: [
      { id: "deepseek-chat", label: "DeepSeek Chat", enabled: true },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner", enabled: true }
    ]
  },
  {
    id: "openrouter",
    apiKey: "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",
    models: [
      { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4", enabled: true },
      { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", enabled: true }
    ]
  },
  {
    id: "xai",
    apiKey: "xai-93ENKTaQFwLRfblG6OHJlOzSDm2uPCryuBidXgs0iuBNQksYVYsJ9eRMUik1Elc9tbdZRl9b5VCSCcPs",
    models: [
      { id: "grok-4", label: "Grok 4", enabled: true },
      { id: "grok-4.3", label: "Grok 4.3", enabled: true }
    ]
  },
  {
    id: "google-ai-studio",
    apiKey: "AIzaSyDmcuv1H2TpaBSamaBJti3IkYkTLXZnC9o",
    models: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", enabled: true },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", enabled: true }
    ]
  },
  {
    id: "kimi-code",
    apiKey: "sk-kimi-vz1tEHOOmhDximg0Zer0wZNS5eOcuSOIHq1FTl8YNkHkd2KvGbgWMAwJRxj5VKw8",
    models: [
      { id: "kimi-coding", label: "Kimi Coding", enabled: true }
    ]
  }
];
const DEFAULT_AGENT_ROUTE_SEEDS = [
  { agentId: "ask_agent", providerId: "deepseek", modelId: "deepseek-chat" },
  { agentId: "rdc-debugger", providerId: "deepseek", modelId: "deepseek-chat" }
];
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
function sanitizeToolingSettings(value) {
  const candidate = value && typeof value === "object" ? value : {};
  return {
    rdxCli: sanitizeRdxCliInvokerSettings(candidate.rdxCli)
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
    enabledSkillIds: DEFAULT_CONFIGURATION.enabledSkillIds ?? [],
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
    llm: {
      providers: [],
      agentRoutes: createEmptyAgentRoutes()
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
  if (typeof route.agentId !== "string" || !KNOWN_AGENT_IDS.has(route.agentId)) {
    return null;
  }
  return {
    agentId: route.agentId,
    providerId: typeof route.providerId === "string" ? normalizeRetiredProviderId(route.providerId.trim()) : "",
    modelId: typeof route.modelId === "string" ? route.modelId.trim() : ""
  };
}
function pickProviderStatus(provider, fallback, canUseProvider, models) {
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
  kimi: "kimi-code",
  "kimi-coding-plan": "kimi-code",
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
  const kind = builtinFallback.kind;
  const models = sanitizeModels(provider.models ?? []);
  const oauthSecretRef = secretStorageService.createProviderOAuthSecretRef(rawId);
  const resolvedSecret = builtinFallback.authMode === "api-key" ? getResolvedProviderSecret(rawId, secretRef, workspaceRoot) : builtinFallback.authMode === "account" ? secretStorageService.getSecret(oauthSecretRef, workspaceRoot) : "";
  const hasStoredSecret = builtinFallback.authMode === "local" || builtinFallback.authMode === "environment" || Boolean(resolvedSecret);
  const canUseProvider = builtinFallback.authMode === "local" || builtinFallback.authMode === "environment" ? true : builtinFallback.authMode === "api-key" ? Boolean(resolvedSecret) : Boolean(resolvedSecret);
  const status = pickProviderStatus(provider, builtinFallback, canUseProvider, models);
  const enabled = status === "verified" && models.length > 0;
  const label = builtinFallback.label;
  const recommendedModels = builtinFallback.recommendedModels;
  const docsUrl = builtinFallback.docsUrl;
  return {
    id: rawId,
    kind,
    authMode: builtinFallback.authMode,
    catalogGroup: normalizeProviderCatalogGroup({ ...provider, id: rawId, authMode: builtinFallback.authMode }),
    modelDiscovery: builtinFallback.modelDiscovery,
    label,
    enabled,
    apiKey: "",
    secretRef,
    hasStoredSecret,
    baseUrl: definition?.baseUrlEditable ? typeof provider.baseUrl === "string" ? provider.baseUrl.trim() : definition.baseUrl : definition?.baseUrl,
    baseUrlEditable: definition?.baseUrlEditable,
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
    isConfigured: status === "verified" && models.length > 0 && enabled
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
  const routeMap = /* @__PURE__ */ new Map();
  for (const route of Array.isArray(routes) ? routes.map(sanitizeRoute) : []) {
    if (!route) {
      continue;
    }
    routeMap.set(route.agentId, route);
  }
  return createEmptyAgentRoutes().map((route) => {
    const incoming = routeMap.get(route.agentId);
    if (!incoming?.providerId || !incoming.modelId) {
      return route;
    }
    const provider = providers.find((entry) => entry.id === incoming.providerId);
    const isValid = Boolean(
      provider && provider.isConfigured && provider.models.some((model) => model.id === incoming.modelId && model.enabled !== false)
    );
    return isValid ? incoming : route;
  });
}
function buildSeededDefaults(workspaceRoot, seedIds = new Set(DEFAULT_PROVIDER_SEEDS.map((seed) => seed.id))) {
  const providers = [];
  for (const seed of DEFAULT_PROVIDER_SEEDS) {
    if (!seedIds.has(seed.id)) {
      continue;
    }
    const fallback = createBuiltinProviderEntry(seed.id);
    if (fallback.authMode !== "api-key") {
      continue;
    }
    const secretRef = secretStorageService.createProviderSecretRef(seed.id);
    secretStorageService.setSecret(secretRef, seed.apiKey, workspaceRoot);
    const sanitized = sanitizeUserProvider({
      id: seed.id,
      models: seed.models,
      status: "verified",
      isConfigured: true,
      secretRef
    }, workspaceRoot);
    if (sanitized) {
      providers.push(sanitized);
    }
  }
  return {
    providers,
    routes: DEFAULT_AGENT_ROUTE_SEEDS.map((route) => ({ ...route }))
  };
}
function isProviderConfiguredForSeed(provider) {
  return Boolean(
    provider && provider.isConfigured && provider.status === "verified" && provider.models.some((model) => model.enabled !== false)
  );
}
function mergeDefaultAgentRoutes(routes, providers) {
  const routeMap = new Map(routes.map((route) => [route.agentId, route]));
  let changed = false;
  for (const seedRoute of DEFAULT_AGENT_ROUTE_SEEDS) {
    const currentRoute = routeMap.get(seedRoute.agentId);
    const currentProvider = providers.find((provider) => provider.id === currentRoute?.providerId);
    const currentRouteValid = Boolean(
      currentRoute && currentProvider?.isConfigured && currentProvider.models.some((model) => model.id === currentRoute.modelId && model.enabled !== false)
    );
    if (!currentRouteValid) {
      routeMap.set(seedRoute.agentId, { ...seedRoute });
      changed = true;
    }
  }
  return changed ? routes.map((route) => routeMap.get(route.agentId) ?? route) : routes;
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
    const normalizedBeforeSeed = normalizeUserProviders(nextProviders, workspaceRoot);
    const seedIdsToRepair = new Set(DEFAULT_PROVIDER_SEEDS.filter((seed) => !isProviderConfiguredForSeed(normalizedBeforeSeed.find((existing) => existing.id === seed.id))).map((seed) => seed.id));
    const providersToSeed = buildSeededDefaults(workspaceRoot, seedIdsToRepair).providers;
    if (providersToSeed.length > 0) {
      fixes.push(`Seeded ${providersToSeed.length} default LLM providers`);
    }
    const catalogProviders = normalizeUserProviders(
      [
        ...nextProviders.filter((existing) => !providersToSeed.some((seeded) => seeded.id === existing.id)),
        ...providersToSeed
      ],
      workspaceRoot
    );
    const normalizedRoutes = normalizeUserRoutes(rawRoutes, catalogProviders);
    const nextRoutes = mergeDefaultAgentRoutes(normalizedRoutes, catalogProviders);
    if (JSON.stringify(normalizedRoutes) !== JSON.stringify(nextRoutes)) {
      fixes.push("Seeded default agent routes");
    }
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
      llm: {
        providers: catalogProviders.map((provider) => ({ ...provider, apiKey: "" })),
        agentRoutes: nextRoutes
      },
      configuration: {
        activeModeProfileId: candidate.configuration?.activeModeProfileId?.trim() || DEFAULT_CONFIGURATION.activeModeProfileId,
        enabledSkillIds: sanitizeRuntimeIds(candidate.configuration?.enabledSkillIds),
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
      llm: {
        providers: nextProviders,
        agentRoutes: nextRoutes
      },
      configuration: {
        activeModeProfileId: candidate.configuration?.activeModeProfileId?.trim() || DEFAULT_CONFIGURATION.activeModeProfileId,
        enabledSkillIds: sanitizeRuntimeIds(candidate.configuration?.enabledSkillIds),
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
      enabledSkillIds: normalized.configuration?.enabledSkillIds ?? [],
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
      llm: {
        providers: hydratedProviders,
        agentRoutes: normalizeUserRoutes(normalized.llm?.agentRoutes ?? createEmptyAgentRoutes(), hydratedProviders)
      },
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
        })
      },
      llm: {
        providers: nextProviders.map((provider) => ({ ...provider, apiKey: "" })),
        agentRoutes: normalizeUserRoutes(patch.llm?.agentRoutes ?? currentPersisted.llm?.agentRoutes ?? [], nextProviders)
      },
      configuration: {
        activeModeProfileId: patch.configuration?.activeModeProfileId || currentPersisted.configuration?.activeModeProfileId || DEFAULT_CONFIGURATION.activeModeProfileId,
        enabledSkillIds: patch.configuration?.enabledSkillIds ? sanitizeRuntimeIds(patch.configuration.enabledSkillIds) : sanitizeRuntimeIds(currentPersisted.configuration?.enabledSkillIds),
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
  saveProviderConnection(providerId, apiKey, models, baseUrl = "") {
    const current = this.getAll();
    const provider = current.llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id)) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    const discoveredModels = sanitizeModels(models);
    if (discoveredModels.length === 0) {
      throw new Error("该 Provider 暂未返回可用模型");
    }
    const timestamp = nowIso();
    const nextProvider = {
      ...provider,
      apiKey: apiKey.trim(),
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
        kind: provider.kind,
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
  async invoke(request) {
    const startTime = nowMs();
    const command = request.command.trim();
    if (!command) {
      return {
        exitCode: 2,
        stdout: "",
        stderr: "RDX CLI command is not configured.",
        duration_ms: nowMs() - startTime
      };
    }
    return new Promise((resolve) => {
      const proc = child_process.spawn(command, request.args ?? [], {
        cwd: request.cwd || void 0,
        env: {
          ...process.env,
          ...request.env,
          PYTHONIOENCODING: "utf-8"
        },
        shell: true,
        windowsHide: true
      });
      const procId = generateEventId("proc");
      this.activeProcesses.set(procId, { process: proc, runId: request.runId });
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
        request.abortSignal?.removeEventListener("abort", abortHandler);
        resolve(result);
      };
      if (request.timeoutMs) {
        timeoutId = setTimeout(() => {
          abortHandler();
          finalize({
            exitCode: 124,
            stdout,
            stderr: stderr || `Process timeout after ${request.timeoutMs}ms`,
            duration_ms: nowMs() - startTime
          });
        }, request.timeoutMs);
      }
      if (request.abortSignal) {
        if (request.abortSignal.aborted) {
          abortHandler();
        } else {
          request.abortSignal.addEventListener("abort", abortHandler, { once: true });
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
    return this.shell.invoke({
      command: settings.command,
      args: this.buildCommandArgs(settings, command, args),
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
  emitInvocationTrace(request, result) {
    const trace = {
      traceId: result.trace_id || generateEventId("tool-trace"),
      turnId: request.turnId,
      toolName: request.toolName,
      args: request.args,
      result,
      timestamp: nowMs(),
      contextId: request.contextId ?? "",
      runtimeOwner: request.runtimeOwner ?? "",
      ownerLeaseId: request.ownerLeaseId
    };
    for (const listener of this.traceListeners) {
      listener(trace);
    }
  }
  async call(request) {
    const startTime = nowMs();
    let response;
    try {
      const cliArgs = [request.toolName];
      const effectiveArgs = {
        ...request.args || {}
      };
      if (request.contextId && effectiveArgs["context_id"] === void 0) {
        effectiveArgs["context_id"] = request.contextId;
      }
      if (request.runtimeOwner && effectiveArgs["runtime_owner"] === void 0) {
        effectiveArgs["runtime_owner"] = request.runtimeOwner;
      }
      if (request.ownerLeaseId && effectiveArgs["owner_lease_id"] === void 0) {
        effectiveArgs["owner_lease_id"] = request.ownerLeaseId;
      }
      if (Object.keys(effectiveArgs).length > 0) {
        cliArgs.push("--args-json", JSON.stringify(effectiveArgs));
      }
      if (request.contextId) {
        cliArgs.push("--daemon-context", request.contextId);
      }
      const result = await this.executeCLI("call", cliArgs, {
        timeout: this.getSettings().timeoutMs,
        runId: request.runId,
        abortSignal: request.abortSignal
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
            this.emitInvocationTrace(request, response);
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
            this.emitInvocationTrace(request, response);
            return response;
          }
          response = {
            ok: true,
            data: parsed.data ?? parsed,
            artifacts: parsed.artifacts,
            duration_ms: nowMs() - startTime,
            trace_id: generateEventId("tool")
          };
          this.emitInvocationTrace(request, response);
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
      this.emitInvocationTrace(request, response);
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
      this.emitInvocationTrace(request, response);
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
    return yaml.parse(content);
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
    const content = yaml.stringify(data, {
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
    this.touchProject(location.project.projectId);
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
    writeYaml(path__namespace.join(runPath, "notes", "debug_plan.yaml"), {
      debug_plan: null,
      pending_questions: null,
      approval_state: "not_requested"
    });
    writeYaml(path__namespace.join(runPath, "notes", "hypothesis_board.yaml"), {
      hypothesis_board: {
        session_id: sessionId,
        entry_skill: "rdc-debugger",
        user_goal: persistedRun.goal,
        intake_state: "handoff_ready",
        current_phase: "intake",
        current_task: "",
        active_owner: "rdc-debugger",
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
  getDebugPlanPath(sessionId, runId) {
    return path__namespace.join(this.getRunPath(sessionId, runId), "notes", "debug_plan.yaml");
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
  readDebugPlan(sessionId, runId) {
    const payload = readYaml(this.getDebugPlanPath(sessionId, runId));
    return payload?.debug_plan ?? null;
  }
  writeDebugPlan(sessionId, runId, debugPlan) {
    const existing = this.readPlanSnapshot(sessionId, runId);
    writeYaml(this.getDebugPlanPath(sessionId, runId), {
      debug_plan: debugPlan,
      pending_questions: existing?.pending_questions ?? null,
      approval_state: existing?.approval_state ?? "not_requested",
      intake_context: existing?.intake_context
    });
    const session = this.readSession(sessionId);
    if (session) {
      this.syncSessionEvidence(sessionId, session.projectId);
    }
  }
  readPlanSnapshot(sessionId, runId) {
    return readYaml(this.getDebugPlanPath(sessionId, runId));
  }
  writePlanSnapshot(sessionId, runId, snapshot) {
    writeYaml(this.getDebugPlanPath(sessionId, runId), snapshot);
    const session = this.readSession(sessionId);
    if (session) {
      this.syncSessionEvidence(sessionId, session.projectId);
    }
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
    const debugPlan = latestRun ? this.readDebugPlan(sessionId, latestRun.runId) : null;
    const activeBlockers = actionEvents.filter((event) => event.event_type === "blocker").map((event) => ({
      code: String(event.payload.code || "BLOCKER"),
      reason: String(event.payload.reason || event.payload.message || "Blocker"),
      refs: Array.isArray(event.refs) ? event.refs : [],
      detectedAt: new Date(event.ts_ms).toISOString()
    }));
    const verificationSummary = actionEvents.filter((event) => event.event_type === "verification").slice(-5).map((event) => String(event.payload.summary || event.payload.verdict || event.payload.verification_kind || "verification"));
    const reasoningSummaries = actionEvents.filter((event) => event.event_type === "agent_summary").slice(-10).map((event, index) => ({
      summaryId: `summary-${index}-${event.event_id}`,
      stage: normalizeWorkflowStage(String(event.payload.stage || latestRun?.lastStage || "plan")),
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
      debug_plan: debugPlan ? {
        plan_id: debugPlan.planId,
        readiness: debugPlan.planReadiness,
        strict_ready: debugPlan.strictReady,
        target_capture: debugPlan.targetCapture?.fileName || null,
        target_scope: debugPlan.targetFrameOrEvent?.scope || null,
        deliverables: debugPlan.expectedDeliverables
      } : null,
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
      return {
        ...project2,
        updatedAt,
        lastSessionId: lastSessionId || project2.lastSessionId
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
function parseToolError(result, fallbackMessage) {
  return {
    message: result.error?.message ?? fallbackMessage,
    code: result.error?.code
  };
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
      activationPhase: "daemon",
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
    await this.ensureDaemonReady();
    this.updateDevice({
      ...device,
      status: "loading",
      detailText: "Allocating remote context...",
      lastError: void 0,
      activationPhase: "context",
      activationUpdatedAt: Date.now()
    });
    let contextId = `ctx-device-${sanitizeDeviceId(device.serial)}-${generateShortId()}`;
    const contextResult = await rdxCliInvokerService.call({
      toolName: "rd.session.create_context",
      args: { context_id: contextId }
    });
    if (!contextResult.ok) {
      if (contextResult.error?.message?.includes("Context limit exceeded")) {
        const reusableContextId = await this.resolveReusableContextId();
        if (reusableContextId) {
          contextId = reusableContextId;
        } else {
          const parsedError = parseToolError(contextResult, "Failed to create a replay device context.");
          throw new Error(parsedError.message);
        }
      } else {
        const parsedError = parseToolError(contextResult, "Failed to create a replay device context.");
        throw new Error(parsedError.message);
      }
    }
    this.updateDevice({
      ...device,
      status: "loading",
      detailText: "Initializing remote capability...",
      lastError: void 0,
      activationPhase: "init",
      activationUpdatedAt: Date.now()
    });
    const initResult = await rdxCliInvokerService.call({
      toolName: "rd.core.init",
      args: {},
      contextId
    });
    if (!initResult.ok) {
      const parsedError = parseToolError(initResult, "Failed to initialize remote capability.");
      throw new Error(parsedError.message);
    }
    this.updateDevice({
      ...device,
      status: "loading",
      detailText: "Connecting to Android RenderDoc server...",
      lastError: void 0,
      activationPhase: "connect",
      activationUpdatedAt: Date.now()
    });
    const connectResult = await rdxCliInvokerService.call({
      toolName: "rd.remote.connect",
      args: {
        timeout_ms: 5e3,
        options: {
          transport: "adb_android",
          device_serial: device.serial
        }
      },
      contextId
    });
    if (!connectResult.ok) {
      const parsedError = parseToolError(connectResult, "Failed to connect to the Android RenderDoc server.");
      throw new Error(parsedError.message);
    }
    const remoteId = typeof connectResult.data?.remote_id === "string" ? connectResult.data.remote_id : void 0;
    if (!remoteId) {
      throw new Error("Remote connect did not return a remote_id.");
    }
    const bootstrap = parseAndroidBootstrapMetadata(
      connectResult.data?.detail && typeof connectResult.data.detail === "object" ? connectResult.data.detail.bootstrap : void 0
    );
    this.updateDevice({
      ...device,
      status: "connected",
      remoteId,
      bootstrap,
      detailText: buildRemoteReadyText(bootstrap),
      lastError: void 0,
      activationPhase: "ping",
      activationErrorCode: void 0,
      activationErrorMessage: void 0,
      activationUpdatedAt: Date.now(),
      lastSeen: Date.now()
    });
    const pingResult = await rdxCliInvokerService.call({
      toolName: "rd.remote.ping",
      args: { remote_id: remoteId },
      contextId
    });
    if (!pingResult.ok) {
      const parsedError = parseToolError(pingResult, "Remote server ping failed.");
      throw new Error(parsedError.message);
    }
    this.updateDevice({
      ...device,
      status: "connected",
      remoteId,
      bootstrap,
      detailText: buildRemoteReadyText(bootstrap),
      lastError: void 0,
      activationPhase: "targets",
      activationUpdatedAt: Date.now(),
      lastSeen: Date.now()
    });
    const targetsResult = await rdxCliInvokerService.call({
      toolName: "rd.remote.list_targets",
      args: { remote_id: remoteId },
      contextId
    });
    if (!targetsResult.ok) {
      const parsedError = parseToolError(targetsResult, "Remote target discovery failed.");
      throw new Error(parsedError.message);
    }
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
  async ensureDaemonReady() {
    const statusResult = await rdxCliInvokerService.executeCLI("daemon", ["status"]);
    if (statusResult.exitCode === 0) {
      try {
        const parsed = JSON.parse(statusResult.stdout);
        if (parsed.data?.running === true) {
          return;
        }
      } catch {
        return;
      }
    }
    const startResult = await rdxCliInvokerService.executeCLI("daemon", ["start"]);
    if (startResult.exitCode !== 0) {
      const stderr = startResult.stderr.trim();
      throw new Error(stderr || "Failed to start the rdx daemon.");
    }
  }
  async resolveReusableContextId() {
    const daemonResult = await rdxCliInvokerService.executeCLI("daemon", ["start"]);
    if (daemonResult.exitCode !== 0 || !daemonResult.stdout.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(daemonResult.stdout);
      return parsed.data?.state?.context_id ?? null;
    } catch {
      return null;
    }
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
  try {
    stream.push({ type: "agent_start" });
    let turn = 0;
    let pending = pendingMessages;
    outer: while (true) {
      for (const msg of pending) {
        context2.messages.push(msg);
        newMessages.push(msg);
        stream.push({ type: "message_start", message: msg });
        stream.push({ type: "message_end", message: msg });
      }
      pending = [];
      while (true) {
        if (stream.isDone) {
          return;
        }
        turn++;
        if (turn > maxTurns) {
          break outer;
        }
        stream.push({ type: "turn_start", turn });
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
              content: [
                {
                  type: "text",
                  text: `<cron_triggered>${prompt}</cron_triggered>`
                }
              ],
              timestamp: Date.now()
            });
          }
        }
        for (const msg of injected) {
          context2.messages.push(msg);
          newMessages.push(msg);
          stream.push({ type: "message_start", message: msg });
          stream.push({ type: "message_end", message: msg });
        }
        const assistantMessage = await streamAssistantResponse(
          context2,
          config,
          providerStrategy,
          stream
        );
        newMessages.push(assistantMessage);
        if (assistantMessage.stopReason !== "toolUse") {
          stream.push({
            type: "turn_end",
            turn,
            message: assistantMessage
          });
          break;
        }
        const toolResults = await executeToolCalls(
          assistantMessage,
          toolExecutor,
          stream,
          config.getSteeringMessages
        );
        for (const result of toolResults.results) {
          context2.messages.push(result);
          newMessages.push(result);
        }
        stream.push({
          type: "turn_end",
          turn,
          message: assistantMessage,
          toolResults: toolResults.results
        });
        if (toolResults.steeringMessages && toolResults.steeringMessages.length > 0) {
          pending = toolResults.steeringMessages;
          for (const msg of pending) {
            context2.messages.push(msg);
            newMessages.push(msg);
            stream.push({ type: "message_start", message: msg });
            stream.push({ type: "message_end", message: msg });
          }
          pending = [];
        }
      }
      const followUps = config.getFollowUpMessages ? config.getFollowUpMessages() : [];
      if (!followUps || followUps.length === 0) {
        break;
      }
      pending = followUps;
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
async function executeToolCalls(assistantMessage, toolExecutor, stream, getSteeringMessages) {
  const toolCalls = assistantMessage.content.filter(
    (c) => c.type === "toolCall"
  );
  const results = [];
  for (let i = 0; i < toolCalls.length; i++) {
    const toolCall = toolCalls[i];
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
          {
            type: "text",
            text: `Tool "${toolCall.name}" not available (no executor configured)`
          }
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
    results.push(result);
    if (getSteeringMessages) {
      const steering = getSteeringMessages();
      if (steering && steering.length > 0) {
        for (let j = i + 1; j < toolCalls.length; j++) {
          const skipped = {
            role: "toolResult",
            toolCallId: toolCalls[j].id,
            toolName: toolCalls[j].name,
            content: [
              { type: "text", text: "Skipped due to queued user message" }
            ],
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
          results.push(skipped);
        }
        return { results, steeringMessages: steering };
      }
    }
  }
  return { results };
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
      signal: opts.streamOptions?.signal
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
function toolToDefinition(tool) {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  };
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
function getWorkspaceRoot() {
  const fromEnv = process.env.RDC_WORKSPACE_ROOT?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return path__namespace.resolve(fromEnv);
  }
  return path__namespace.resolve(process.cwd());
}
function safeResolvePath(input, root) {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("路径不能为空");
  }
  const workspaceRoot = root ?? getWorkspaceRoot();
  const target = path__namespace.isAbsolute(input) ? path__namespace.resolve(input) : path__namespace.resolve(workspaceRoot, input);
  const rel = path__namespace.relative(workspaceRoot, target);
  if (rel.startsWith("..") || path__namespace.isAbsolute(rel)) {
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
const DEFAULT_TIMEOUT_MS = 12e4;
const MAX_OUTPUT_BYTES$2 = 50 * 1024;
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
  permissionHint: "mutation",
  async execute(_toolCallId, params, signal, onUpdate) {
    const command = params.command;
    const timeoutMs = params.timeout ?? DEFAULT_TIMEOUT_MS;
    const cwd = getWorkspaceRoot();
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
          content: [{ type: "text", text: truncateOutput(text, MAX_OUTPUT_BYTES$2) }]
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
        const truncated = Buffer.byteLength(text, "utf8") > MAX_OUTPUT_BYTES$2;
        resolve({
          content: [
            { type: "text", text: truncateOutput(text, MAX_OUTPUT_BYTES$2) }
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
        const truncated = Buffer.byteLength(combined, "utf8") > MAX_OUTPUT_BYTES$2;
        resolve({
          content: [
            { type: "text", text: truncateOutput(combined, MAX_OUTPUT_BYTES$2) }
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
const MAX_OUTPUT_BYTES$1 = 200 * 1024;
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
  permissionHint: "readonly",
  async execute(_toolCallId, params, signal) {
    if (signal?.aborted) {
      throw new Error("Aborted");
    }
    const absolute = safeResolvePath(params.path);
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
    const text = truncateOutput(numbered, MAX_OUTPUT_BYTES$1);
    const truncated = Buffer.byteLength(numbered, "utf8") > MAX_OUTPUT_BYTES$1 || endIdx < totalLines;
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
  permissionHint: "mutation",
  async execute(_toolCallId, params, signal) {
    if (signal?.aborted) {
      throw new Error("Aborted");
    }
    const absolute = safeResolvePath(params.path);
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
  permissionHint: "mutation",
  async execute(_toolCallId, params, signal) {
    if (signal?.aborted) {
      throw new Error("Aborted");
    }
    if (params.old_text.length === 0) {
      throw new Error("old_text 不能为空");
    }
    if (params.old_text === params.new_text) {
      throw new Error("old_text 与 new_text 相同，无需编辑");
    }
    const absolute = safeResolvePath(params.path);
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
  permissionHint: "readonly",
  async execute(_toolCallId, params, signal) {
    if (signal?.aborted) {
      throw new Error("Aborted");
    }
    const workspaceRoot = getWorkspaceRoot();
    const baseDir = params.cwd ? safeResolvePath(params.cwd, workspaceRoot) : workspaceRoot;
    const regex = compileGlob(params.pattern);
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
    const text = matches.length === 0 ? `(no matches for pattern "${params.pattern}")` : matches.join("\n") + (truncated ? `
... [truncated at ${MAX_RESULTS}]` : "");
    return {
      content: [{ type: "text", text }],
      details: {
        pattern: params.pattern,
        cwd: baseDir,
        matched: matches.length,
        truncated
      }
    };
  }
};
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
const MAX_OUTPUT_BYTES = 120 * 1024;
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
  permissionHint: "readonly",
  async execute(_toolCallId, params, signal) {
    throwIfAborted(signal);
    const workspaceRoot = getWorkspaceRoot();
    const root = params.path ? safeResolvePath(params.path, workspaceRoot) : workspaceRoot;
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
    const text = truncateOutput(rawText, MAX_OUTPUT_BYTES);
    truncated = truncated || Buffer.byteLength(rawText, "utf8") > MAX_OUTPUT_BYTES;
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
  throwIfAborted(signal);
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
  throwIfAborted(signal);
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
function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new Error("Aborted");
  }
}
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
function getPrimitiveTools() {
  return [
    bashTool,
    readFileTool,
    writeFileTool,
    editFileTool,
    globTool,
    grepTool,
    webFetchTool,
    webSearchTool
  ];
}
const COPILOT_EDITOR_HEADERS = {
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0"
};
const COPILOT_WIRE_HEADERS = {
  ...COPILOT_EDITOR_HEADERS,
  "Copilot-Integration-Id": "vscode-chat"
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
  async streamChat(request, onChunk) {
    try {
      const response = await this.performStreamingChat(request, onChunk);
      onChunk({ type: "done" });
      return response;
    } catch (error) {
      if (request.signal?.aborted) {
        throw error;
      }
      const fallbackResponse = await this.chat(request);
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
  async chat(request) {
    const model = request.model?.trim();
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
      signal: request.signal,
      body: JSON.stringify({
        model,
        messages: toContentBlocks(request.messages),
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        reasoning_effort: toOpenAiReasoningEffort(request.reasoningBudget),
        tools: toOpenAiTools(request.tools),
        response_format: request.responseFormat ? { type: request.responseFormat } : void 0,
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
  async performStreamingChat(request, onChunk) {
    const model = request.model?.trim();
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
      signal: request.signal,
      body: JSON.stringify({
        model,
        messages: toContentBlocks(request.messages),
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        reasoning_effort: toOpenAiReasoningEffort(request.reasoningBudget),
        tools: toOpenAiTools(request.tools),
        response_format: request.responseFormat ? { type: request.responseFormat } : void 0,
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
class OpenAICompatibleProvider extends BaseStreamingProvider {
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
  async chat(request) {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const response = await fetch(this.createChatCompletionsUrl(), {
      method: "POST",
      headers: this.createHeaders(),
      signal: request.signal,
      body: JSON.stringify({
        model,
        messages: toContentBlocks(request.messages),
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        reasoning_effort: toOpenAiReasoningEffort(request.reasoningBudget),
        tools: toOpenAiTools(request.tools),
        response_format: request.responseFormat ? { type: request.responseFormat } : void 0
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
  async performStreamingChat(request, onChunk) {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const response = await fetch(this.createChatCompletionsUrl(), {
      method: "POST",
      headers: this.createHeaders(),
      signal: request.signal,
      body: JSON.stringify({
        model,
        messages: toContentBlocks(request.messages),
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        reasoning_effort: toOpenAiReasoningEffort(request.reasoningBudget),
        tools: toOpenAiTools(request.tools),
        response_format: request.responseFormat ? { type: request.responseFormat } : void 0,
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
  createBody(request, model, stream) {
    return {
      model,
      input: toResponsesInput(request.messages),
      max_output_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
      stream
    };
  }
  async chat(request) {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const response = await fetch(this.createResponsesUrl(), {
      method: "POST",
      headers: this.createHeaders(),
      signal: request.signal,
      body: JSON.stringify(this.createBody(request, model, false))
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
  async performStreamingChat(request, onChunk) {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const response = await fetch(this.createResponsesUrl(), {
      method: "POST",
      headers: this.createHeaders(),
      signal: request.signal,
      body: JSON.stringify(this.createBody(request, model, true))
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
class GitHubCopilotProvider extends OpenAICompatibleProvider {
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
class AzureOpenAIProvider extends OpenAICompatibleProvider {
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
  async chat(request) {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const response = await fetch(this.createGenerateContentUrl(model), {
      method: "POST",
      headers: this.createHeaders(),
      signal: request.signal,
      body: JSON.stringify({
        contents: request.messages.filter((message) => message.role !== "system").map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: typeof message.content === "string" ? message.content : JSON.stringify(message.content) }]
        })),
        generationConfig: {
          maxOutputTokens: request.maxTokens || 4096,
          temperature: request.temperature ?? 0.7,
          thinkingConfig: toGoogleThinkingConfig(request.reasoningBudget)
        },
        systemInstruction: request.messages.some((message) => message.role === "system") ? {
          parts: request.messages.filter((message) => message.role === "system").map((message) => ({ text: typeof message.content === "string" ? message.content : JSON.stringify(message.content) }))
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
  async performStreamingChat(request, onChunk) {
    const response = await this.chat(request);
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
class AnthropicProvider extends BaseStreamingProvider {
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
  async chat(request) {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const systemMessage = request.messages.find((message) => message.role === "system");
    const otherMessages = request.messages.filter((message) => message.role !== "system");
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: this.createHeaders(),
      signal: request.signal,
      body: JSON.stringify({
        model,
        max_tokens: request.maxTokens || 4096,
        thinking: toAnthropicThinking(request.reasoningBudget),
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
  async performStreamingChat(request, onChunk) {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const systemMessage = request.messages.find((message) => message.role === "system");
    const otherMessages = request.messages.filter((message) => message.role !== "system");
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: this.createHeaders(),
      signal: request.signal,
      body: JSON.stringify({
        model,
        max_tokens: request.maxTokens || 4096,
        thinking: toAnthropicThinking(request.reasoningBudget),
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
const createProviderByKind = (providerId, kind) => {
  if (providerId === "chatgpt-account") {
    return new ChatGptAccountProvider(providerId);
  }
  if (providerId === "github-copilot") {
    return new GitHubCopilotProvider(providerId);
  }
  if (kind === "openrouter") {
    return new OpenRouterProvider(providerId);
  }
  if (kind === "anthropic") {
    return new AnthropicProvider(providerId);
  }
  if (kind === "ollama") {
    return new OpenAICompatibleProvider(providerId, false);
  }
  if (kind === "google-ai-studio") {
    return new GoogleAiStudioProvider(providerId);
  }
  if (kind === "azure-openai") {
    return new AzureOpenAIProvider(providerId);
  }
  return new OpenAICompatibleProvider(providerId, true);
};
class LLMAdapter {
  providers = /* @__PURE__ */ new Map();
  configure(config) {
    this.providers.clear();
    for (const providerConfig of config.providers) {
      const provider = createProviderByKind(providerConfig.id, providerConfig.kind);
      if ("configure" in provider && typeof provider.configure === "function") {
        provider.configure(providerConfig);
      }
      this.providers.set(providerConfig.id, {
        config: providerConfig,
        provider
      });
    }
  }
  async chat(request, providerId) {
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
    return runtimeProvider.provider.chat(request);
  }
  async streamChat(request, onChunk, providerId) {
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
    return runtimeProvider.provider.streamChat(request, onChunk);
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
function encodeAgentModel(providerId, modelId) {
  return {
    id: `${providerId}::${modelId}`,
    name: modelId,
    provider: providerId,
    api: "rdc-agent-llm-adapter",
    contextWindow: 0,
    maxTokens: 0,
    reasoning: false,
    vision: false
  };
}
function decodeAgentModel(model) {
  const [providerPart, ...modelParts] = model.id.split("::");
  if (modelParts.length === 0) {
    return { providerId: model.provider, modelId: model.id };
  }
  return { providerId: providerPart || model.provider, modelId: modelParts.join("::") };
}
function messagesToLlm(systemPrompt, messages) {
  const result = [];
  if (systemPrompt && systemPrompt.trim()) {
    result.push({ role: "system", content: systemPrompt });
  }
  for (const msg of messages) {
    if (msg.role === "user") {
      result.push({ role: "user", content: typeof msg.content === "string" ? msg.content : userContentToText(msg.content) });
    } else if (msg.role === "assistant") {
      result.push({ role: "assistant", content: assistantContentToText(msg.content) });
    } else if (msg.role === "toolResult") {
      result.push({
        role: "tool",
        content: msg.content.map((block) => block.type === "text" ? block.text : "").join("\n")
      });
    }
  }
  return result;
}
function toolsToLlm(tools) {
  if (!tools?.length) return void 0;
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: normalizeToolInputSchema(tool.parameters)
  }));
}
function normalizeToolInputSchema(schema) {
  const properties = {};
  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    properties[key] = {
      type: typeof value.type === "string" ? value.type : "string",
      description: typeof value.description === "string" ? value.description : "",
      enum: Array.isArray(value.enum) ? value.enum.map(String) : void 0
    };
  }
  return {
    type: "object",
    properties,
    required: schema.required
  };
}
function userContentToText(content) {
  return content.map((block) => block.type === "text" && typeof block.text === "string" ? block.text : "").join("");
}
function assistantContentToText(content) {
  const parts = [];
  for (const block of content) {
    if (block.type === "text") {
      parts.push(block.text);
    } else if (block.type === "thinking") {
      continue;
    } else if (block.type === "toolCall") {
      parts.push(`[tool ${block.name} requested]`);
    }
  }
  return parts.join("");
}
class LLMAdapterProvider {
  api = "rdc-agent-llm-adapter";
  getCapabilities() {
    return {
      streaming: true,
      nativeToolCalling: false,
      structuredOutput: false,
      vision: false,
      reasoning: false,
      parallelToolCalls: false
    };
  }
  stream(model, context2, options) {
    const { providerId, modelId } = decodeAgentModel(model);
    const stream = new EventStream(
      (event) => event.type === "done" || event.type === "error",
      (event) => event.message
    );
    const builder = new AssistantStreamBuilder(stream, model.id, providerId);
    const toolIndexes = /* @__PURE__ */ new Map();
    let sawTextDelta = false;
    builder.start();
    const llmRequest = {
      messages: messagesToLlm(context2.systemPrompt, context2.messages),
      model: modelId,
      maxTokens: options?.maxTokens,
      temperature: options?.temperature,
      tools: toolsToLlm(context2.tools),
      reasoningBudget: options?.reasoningBudget,
      signal: options?.signal
    };
    const onChunk = (chunk) => {
      if (stream.isDone) return;
      if (chunk.type === "text-delta") {
        sawTextDelta = true;
        builder.appendText(0, chunk.text);
      } else if (chunk.type === "tool-call-delta") {
        const toolCall = chunk.toolCall;
        const id = toolCall.id || `tool-call-${toolIndexes.size}`;
        let entry = toolIndexes.get(id);
        if (!entry) {
          entry = { index: toolIndexes.size + 1, argumentsText: "" };
          toolIndexes.set(id, entry);
        }
        builder.ensureToolCall(entry.index, id, toolCall.name ?? "");
        if (typeof toolCall.argumentsText === "string") {
          const delta = toolCall.argumentsText.startsWith(entry.argumentsText) ? toolCall.argumentsText.slice(entry.argumentsText.length) : toolCall.argumentsText;
          entry.argumentsText = toolCall.argumentsText;
          builder.appendToolCallArgs(entry.index, delta);
        }
      }
    };
    void this.runStream(llmRequest, providerId, builder, stream, onChunk, () => sawTextDelta, toolIndexes);
    return stream;
  }
  async runStream(request, providerId, builder, stream, onChunk, hasStreamedText, streamedToolIndexes) {
    try {
      const response = await llmAdapter.streamChat(request, onChunk, providerId);
      if (stream.isDone) return;
      if (!hasStreamedText() && typeof response.content === "string" && response.content) {
        builder.appendText(0, response.content);
      }
      appendFinalToolCalls(builder, response.toolCalls, streamedToolIndexes);
      builder.setUsage({
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        totalTokens: response.usage.inputTokens + response.usage.outputTokens
      });
      builder.done(mapStopReason(response.stopReason));
    } catch (error) {
      if (stream.isDone) return;
      const err = error instanceof Error ? error : new Error(String(error));
      builder.fail(err);
    }
  }
}
function appendFinalToolCalls(builder, toolCalls, streamedToolIndexes) {
  if (!toolCalls?.length) return;
  toolCalls.forEach((toolCall, index) => {
    const existing = streamedToolIndexes.get(toolCall.id);
    const contentIndex = existing?.index ?? index + 1;
    if (existing) {
      builder.endToolCall(contentIndex);
      return;
    }
    builder.ensureToolCall(contentIndex, toolCall.id, toolCall.name);
    builder.appendToolCallArgs(contentIndex, JSON.stringify(toolCall.arguments ?? {}));
    builder.endToolCall(contentIndex);
  });
}
function mapStopReason(reason) {
  if (reason === "tool_use") return "toolUse";
  if (reason === "max_tokens") return "length";
  return "stop";
}
const llmAdapterProvider = new LLMAdapterProvider();
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
          toolAllowlist: context2.toolAllowlist ?? []
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
      if (ev.type === "thinking_start") {
        return buildSharedAgentEvent(
          "diagnostic",
          {
            code: "MODEL_THINKING_STARTED",
            severity: "info",
            message: "模型已进入 provider reasoning / thinking 阶段；仅展示可见工作轨迹，不展示隐藏思维链。"
          },
          context2
        );
      }
      if (ev.type === "thinking_end") {
        return buildSharedAgentEvent(
          "diagnostic",
          {
            code: "MODEL_THINKING_COMPLETED",
            severity: "info",
            message: "模型 reasoning / thinking 阶段已结束。"
          },
          context2
        );
      }
      return null;
    }
    case "message_end": {
      if (event.message.role === "assistant") {
        const text = event.message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
        return buildSharedAgentEvent(
          "assistant.completed",
          {
            text,
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
      return msg.content.filter((block) => block.type === "text").map((block) => block.text).join("");
    }
  }
  return "";
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
const REQUEST_TIMEOUT_MS$1 = 2e4;
const CHATGPT_CALLBACK_PORT = 1455;
const CHATGPT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const GITHUB_COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";
const pendingFlows = /* @__PURE__ */ new Map();
const isAccountProviderId = (providerId) => providerId === "claude-account" || providerId === "chatgpt-account" || providerId === "github-copilot" || providerId === "grok-account" || providerId === "gemini-account" || providerId === "qwen-account";
const isMockableAccountProviderId = (providerId) => providerId === "grok-account" || providerId === "gemini-account" || providerId === "qwen-account";
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
const canRefreshBundle = (bundle) => Boolean(bundle.refreshToken || bundle.providerId === "github-copilot" && bundle.accessToken);
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
  async startLogin(providerId) {
    if (!isAccountProviderId(providerId)) {
      return this.status(providerId, "Provider does not support account login.");
    }
    if (providerId === "claude-account") {
      return this.startClaudeLogin();
    }
    if (providerId === "chatgpt-account") {
      return this.startChatGptLogin();
    }
    if (isMockableAccountProviderId(providerId)) {
      return this.startMockableAccountLogin(providerId);
    }
    return this.startGitHubCopilotLogin();
  }
  async finishLogin(request) {
    if (!isAccountProviderId(request.providerId)) {
      return this.status(request.providerId, "Provider does not support account login.");
    }
    const flow = this.findFlow(request.providerId, request.flowId);
    if (!flow) {
      return this.status(request.providerId, "Login flow expired or was not started.", "failed");
    }
    try {
      if (request.providerId === "claude-account") {
        const bundle2 = await this.exchangeClaudeCode(flow, request.code?.trim() ?? "");
        return await this.persistAccount(request.providerId, bundle2);
      }
      if (request.providerId === "chatgpt-account") {
        const bundle2 = await this.exchangeChatGptCode(flow, request.code?.trim() ?? "");
        return await this.persistAccount(request.providerId, bundle2);
      }
      if (isMockableAccountProviderId(request.providerId)) {
        const bundle2 = this.exchangeMockableAccountCode(flow, request.code?.trim() ?? "");
        return await this.persistAccount(request.providerId, bundle2);
      }
      const bundle = await this.pollGitHubDevice(flow);
      return await this.persistAccount(request.providerId, bundle);
    } catch (error) {
      flow.error = parseProviderError$1(error);
      return this.status(request.providerId, flow.error, "failed");
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
    const state2 = forcedState ?? (flow?.error ? "failed" : flow ? "pending" : connected ? "connected" : isAccount ? "signed-out" : "unavailable");
    const pendingMessage = providerId === "github-copilot" ? "Waiting for GitHub authorization." : isAccount && flow && isMockableAccountProviderId(providerId) ? "Waiting for mockable account authorization." : "Waiting for authorization.";
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
      requiresCodeInput: Boolean(flow?.providerId === "claude-account" || flow && isMockableAccountProviderId(flow.providerId)),
      models: provider?.models ?? []
    };
  }
  logout(providerId) {
    if (isAccountProviderId(providerId)) {
      this.clearFlows(providerId);
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
  startMockableAccountLogin(providerId) {
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
      isTestMode$1() ? "Mockable account authorization flow started." : "Live account OAuth is not yet configured for this provider; mock verification is available in test mode."
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
  exchangeMockableAccountCode(flow, code) {
    if (!isMockableAccountProviderId(flow.providerId)) {
      throw new Error("Provider is not a mockable account adapter.");
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
      accessToken: `mock-${flow.providerId}-${flow.state}`,
      apiKey: `mock-${flow.providerId}-${flow.state}`,
      expiresAt: new Date(Date.now() + 3600 * 1e3).toISOString(),
      accountLabel: getBuiltinProviderDefinition(flow.providerId)?.label ?? flow.providerId,
      planLabel: "Mock account"
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
    if (isMockableAccountProviderId(bundle.providerId)) {
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
    if (bundle.providerId === "chatgpt-account" || bundle.providerId === "claude-account" || isMockableAccountProviderId(bundle.providerId)) {
      return createAccountCatalogModels(bundle.providerId);
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
      const server2 = http.createServer((request, response) => {
        const url2 = new URL(request.url ?? "/", `http://localhost:${CHATGPT_CALLBACK_PORT}`);
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
const ASK_READONLY_TOOL_ALLOWLIST = [
  "read_file",
  "glob",
  "grep",
  "task_list",
  "web_fetch",
  "web_search"
];
const TOOL_ALIASES = {
  "primitive.read": "read_file",
  "primitive.glob": "glob",
  "primitive.grep": "grep",
  "primitive.webFetch": "web_fetch",
  "primitive.webSearch": "web_search",
  "primitive.task.list": "task_list",
  "task.list": "task_list",
  "fs.read": "read_file",
  "fs.glob": "glob",
  "fs.grep": "grep"
};
const ASK_DENIED_TOOL_PREFIXES = ["rd.", "mcp."];
const ASK_DENIED_TOOLS = /* @__PURE__ */ new Set([
  "bash",
  "primitive.bash",
  "write",
  "write_file",
  "primitive.write",
  "edit",
  "edit_file",
  "primitive.edit",
  "remove",
  "delete",
  "task_create",
  "task_update"
]);
const DEBUG_AGENT_SHELL_TOOL_ALLOWLIST = [
  ...ASK_READONLY_TOOL_ALLOWLIST,
  "bash"
];
const SPECIALIST_TOOL_BINDINGS = {
  ask_agent: ASK_READONLY_TOOL_ALLOWLIST,
  triage_agent: DEBUG_AGENT_SHELL_TOOL_ALLOWLIST,
  capture_repro_agent: DEBUG_AGENT_SHELL_TOOL_ALLOWLIST,
  pass_graph_pipeline_agent: DEBUG_AGENT_SHELL_TOOL_ALLOWLIST,
  pixel_forensics_agent: DEBUG_AGENT_SHELL_TOOL_ALLOWLIST,
  shader_ir_agent: DEBUG_AGENT_SHELL_TOOL_ALLOWLIST,
  driver_device_agent: DEBUG_AGENT_SHELL_TOOL_ALLOWLIST,
  skeptic_agent: DEBUG_AGENT_SHELL_TOOL_ALLOWLIST,
  curator_agent: DEBUG_AGENT_SHELL_TOOL_ALLOWLIST,
  "rdc-debugger": DEBUG_AGENT_SHELL_TOOL_ALLOWLIST
};
const SHADER_EDIT_TOOLS = ["rd.shader.edit_and_replace", "rd.macro.shader_hotfix_validate"];
function resolveAgentToolAllowlist(agentId, stage) {
  const settings = settingsService.getAll();
  const runtimeProfile = executionProfileService.resolveAgentRuntimeProfile(settings, stage || "investigate", agentId);
  if (runtimeProfile.toolAllowlist?.length) {
    const normalizedProfileTools = runtimeProfile.toolAllowlist.map(normalizeToolName);
    return agentId === "ask_agent" ? Array.from(new Set(normalizedProfileTools)) : Array.from(/* @__PURE__ */ new Set([...normalizedProfileTools.filter((toolName) => !toolName.startsWith("rd.")), "bash"]));
  }
  return SPECIALIST_TOOL_BINDINGS[agentId] ?? [];
}
function isToolAllowedForAgent(toolName, agentId, stage) {
  const normalizedToolName = normalizeToolName(toolName);
  if (SHADER_EDIT_TOOLS.includes(normalizedToolName)) {
    return false;
  }
  if (agentId === "ask_agent" && isDeniedAskTool(toolName, normalizedToolName)) {
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
  }
  return false;
}
function normalizeToolName(toolName) {
  return TOOL_ALIASES[toolName] ?? toolName;
}
function isDeniedAskTool(originalToolName, normalizedToolName) {
  if (ASK_DENIED_TOOLS.has(originalToolName) || ASK_DENIED_TOOLS.has(normalizedToolName)) {
    return true;
  }
  return ASK_DENIED_TOOL_PREFIXES.some((prefix) => originalToolName.startsWith(prefix) || normalizedToolName.startsWith(prefix));
}
const EXECUTE_PATTERN$1 = /start|execute|debug|analy[sz]e|开始|启动|执行|正式分析|开始调试|调试/i;
class AgentOrchestrator {
  agentStates = /* @__PURE__ */ new Map();
  agentConfigs = /* @__PURE__ */ new Map();
  agentSlots = /* @__PURE__ */ new Map();
  constructor() {
    this.initializeAgents();
  }
  setMainWindow(_window) {
  }
  initializeAgents() {
    for (const role of AGENT_ROLES) {
      this.agentStates.set(role, {
        agentId: role,
        status: "idle",
        lastActivity: nowIso$1()
      });
      const defaultRouting = DEFAULT_MODEL_ROUTING[role];
      this.agentConfigs.set(role, {
        agentId: role,
        systemPrompt: "",
        modelProvider: defaultRouting.provider,
        modelName: defaultRouting.model,
        temperature: 0.7,
        maxTokens: 4096,
        category: this.getAgentCategory(role),
        writeScope: this.getAgentWriteScopes(role)
      });
    }
  }
  getAgentCategory(role) {
    if (role === "ask_agent" || role === "rdc-debugger") return "orchestrator";
    if (INVESTIGATOR_AGENTS.includes(role)) return "investigator";
    if (VERIFIER_AGENTS.includes(role)) return "verifier";
    if (REPORTER_AGENTS.includes(role)) return "reporter";
    return "investigator";
  }
  getAgentWriteScopes(role) {
    if (role === "ask_agent") return [];
    if (role === "rdc-debugger") return ["workspace_control"];
    if (INVESTIGATOR_AGENTS.includes(role)) return ["workspace_notes"];
    if (role === "skeptic_agent") return ["session_signoff"];
    if (role === "curator_agent") return ["workspace_reports", "session_artifacts", "knowledge_library"];
    return [];
  }
  getAgentState(agentId) {
    return this.agentStates.get(agentId) || null;
  }
  getAllAgentStates() {
    return Array.from(this.agentStates.values());
  }
  configureAgent(agentId, config) {
    const existing = this.agentConfigs.get(agentId);
    if (existing) {
      this.agentConfigs.set(agentId, { ...existing, ...config });
    }
  }
  getAgentConfig(agentId) {
    return this.agentConfigs.get(agentId) || null;
  }
  applyLlmConfig(config) {
    const routeMap = new Map(config.agentRoutes.map((route) => [route.agentId, route]));
    for (const [agentId, agentConfig] of this.agentConfigs.entries()) {
      const fallback = DEFAULT_MODEL_ROUTING[agentId];
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
  // 主入口：sendMessage / sendCoworkMessage
  // -------------------------------------------------------------------
  async sendMessage(agentId, content, context2, options) {
    const fallbackConfig = this.agentConfigs.get(agentId);
    if (!fallbackConfig) {
      throw new Error(`Agent not found: ${agentId}`);
    }
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
        options
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
  async sendCoworkMessage(agentId, content, options) {
    const fallbackConfig = this.agentConfigs.get(agentId);
    if (!fallbackConfig) {
      throw new Error(`Agent not found: ${agentId}`);
    }
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
        const finalStub = await this.createCoworkTestResponse(agentId, content, options);
        this.updateAgentStatus(agentId, "complete");
        return finalStub;
      }
      const userPrompt = options?.promptOverride ?? content;
      const toolAllowlist = resolveAgentToolAllowlist(agentId, options?.stage && options.stage !== "cowork" && options.stage !== "report" ? options.stage : void 0);
      const responseText = await this.runAgentTurn({
        agentId,
        content: userPrompt,
        systemPrompt: this.systemPromptForAgent(agentId, config.systemPrompt),
        providerId: config.modelProvider,
        modelId: config.modelName,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        mode: this.modeForAgent(agentId),
        patternId: options?.patternId ?? this.patternForAgent(agentId),
        stage: options?.stage ?? "cowork",
        runId: void 0,
        sessionId: options?.sessionId ?? null,
        turnId: options?.turnId,
        toolAllowlist,
        options,
        // cowork 每次调用都是独立轮次，不复用缓存 Agent。
        useFreshAgent: true
      });
      runtimeLogService.log({
        scope: options?.sessionId ? "session" : "app",
        namespace: "agent",
        severity: "info",
        title: `${AGENT_DISPLAY_NAMES[agentId] || agentId} cowork turn`,
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
  // Agent 实例池
  // -------------------------------------------------------------------
  getOrCreateAgentSlot(agentId, providerId, modelId, systemPrompt, tools = [], toolExecutor = this.createToolExecutor(agentId, [], void 0), streamOptions) {
    const existing = this.agentSlots.get(agentId);
    if (existing && existing.providerId === providerId && existing.modelId === modelId && existing.systemPrompt === systemPrompt && !existing.agent.isStreaming) {
      return existing;
    }
    const agent = new Agent({
      initialState: {
        model: encodeAgentModel(providerId, modelId),
        systemPrompt,
        tools,
        messages: []
      },
      provider: llmAdapterProvider,
      toolExecutor,
      streamOptions,
      maxTurns: 8
    });
    const slot = { agent, providerId, modelId, systemPrompt };
    this.agentSlots.set(agentId, slot);
    return slot;
  }
  /** 创建一个全新的 Agent slot（不进入缓存）。适用于 cowork 这种一次性调用。 */
  createFreshAgentSlot(providerId, modelId, systemPrompt, tools = [], toolExecutor = this.createToolExecutor("ask_agent", [], void 0), streamOptions) {
    const agent = new Agent({
      initialState: {
        model: encodeAgentModel(providerId, modelId),
        systemPrompt,
        tools,
        messages: []
      },
      provider: llmAdapterProvider,
      toolExecutor,
      streamOptions,
      maxTurns: 4
    });
    return { agent, providerId, modelId, systemPrompt };
  }
  resolveRuntimeTools(agentId, toolAllowlist, stage) {
    const availableTools = /* @__PURE__ */ new Map();
    for (const tool of getPrimitiveTools()) {
      availableTools.set(normalizeToolName(tool.name), tool);
    }
    const taskListTool = this.createReadonlyTaskListTool();
    availableTools.set(taskListTool.name, taskListTool);
    const definitions = [];
    const toolMap = /* @__PURE__ */ new Map();
    for (const name of toolAllowlist) {
      const normalized = normalizeToolName(name);
      const tool = availableTools.get(normalized);
      if (!tool) continue;
      if (!this.isAllowedForRuntime(agentId, tool.name, stage)) continue;
      if (!toolMap.has(tool.name)) {
        toolMap.set(tool.name, tool);
        definitions.push(toolToDefinition(tool));
      }
    }
    return { definitions, toolMap };
  }
  createToolExecutor(agentId, toolAllowlist, stage) {
    const tools = this.resolveRuntimeTools(agentId, toolAllowlist, stage).toolMap;
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
        try {
          const result = await tool.execute(toolCall.id, toolCall.arguments, signal, onUpdate);
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
    const workflowStage = stage === "cowork" || stage === "report" ? void 0 : stage;
    return isToolAllowedForAgent(toolName, agentId, workflowStage);
  }
  createPolicyDeniedToolResult(toolCall, agentId) {
    return {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{
        type: "text",
        text: `Policy denied tool "${toolCall.name}" for ${agentId}. Ask mode only allows read-only tools.`
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
  createReadonlyTaskListTool() {
    return {
      name: "task_list",
      label: "List Tasks",
      description: "List current conversation tasks without creating or modifying any task records.",
      parameters: {
        type: "object",
        properties: {}
      },
      permissionHint: "readonly",
      async execute() {
        return {
          content: [{ type: "text", text: "No formal Debugger run tasks are active in Ask mode." }],
          details: { count: 0 }
        };
      }
    };
  }
  // -------------------------------------------------------------------
  // 单轮 Agent 执行
  // -------------------------------------------------------------------
  async runAgentTurn(input) {
    if (!input.providerId || !input.modelId) {
      throw new Error("No provider/model route is configured for this agent.");
    }
    const runtimeTools = this.resolveRuntimeTools(input.agentId, input.toolAllowlist, input.stage);
    const toolExecutor = this.createToolExecutor(input.agentId, input.toolAllowlist, input.stage);
    const streamOptions = {
      maxTokens: input.maxTokens,
      temperature: input.temperature,
      reasoningBudget: input.options?.reasoningBudget,
      signal: input.options?.signal
    };
    const slot = input.useFreshAgent ? this.createFreshAgentSlot(
      input.providerId,
      input.modelId,
      input.systemPrompt,
      runtimeTools.definitions,
      toolExecutor,
      streamOptions
    ) : this.getOrCreateAgentSlot(
      input.agentId,
      input.providerId,
      input.modelId,
      input.systemPrompt,
      runtimeTools.definitions,
      toolExecutor,
      streamOptions
    );
    const userMessage = {
      role: "user",
      content: input.content,
      timestamp: nowMs()
    };
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
      toolAllowlist: input.toolAllowlist
    };
    let responseText = "";
    const unsubscribe = slot.agent.subscribe((event) => {
      if (event.type === "message_update") {
        const ev = event.assistantMessageEvent;
        if (ev.type === "text_delta" && typeof ev.delta === "string") {
          input.options?.onChunk?.(ev.delta);
        }
      }
      if (event.type === "message_end" && event.message.role === "assistant") {
        responseText = event.message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
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
    return agentId === "ask_agent" ? "ask" : "debugger";
  }
  patternForAgent(agentId) {
    return agentId === "ask_agent" ? "free-agent" : "plan-generate-verify";
  }
  systemPromptForAgent(agentId, prompt) {
    return prompt || `You are the ${AGENT_DISPLAY_NAMES[agentId]}. ${AGENT_DESCRIPTIONS[agentId]}`;
  }
  async finalizeRecordedAssistantMessage(agentId, streamedContent, fallbackContent, context2) {
    const finalContent = streamedContent || fallbackContent;
    await this.recordMessage(agentId, "assistant", finalContent, context2);
    return finalContent;
  }
  updateAgentStatus(agentId, status) {
    const state2 = this.agentStates.get(agentId);
    if (state2) {
      state2.status = status;
      state2.lastActivity = nowIso$1();
      runtimeLogService.log({
        scope: "app",
        namespace: "agent",
        severity: status === "error" ? "error" : status === "complete" ? "success" : "info",
        title: AGENT_DISPLAY_NAMES[agentId] || agentId,
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
      title: AGENT_DISPLAY_NAMES[message.agentId] || message.agentId,
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
    if (userMessage.includes("__RDC_AGENT_E2E_FORCE_COWORK_LLM_FAILURE__")) {
      throw new Error("E2E forced cowork LLM request failure");
    }
    const lower = userMessage.toLowerCase();
    let stub = agentId === "ask_agent" ? "Ask is ready. I can inspect readonly context, search files or public pages, and explain next steps without starting a Debugger run." : "Debugger is ready. Describe the symptom and capture context; I will prepare a plan before execution.";
    if (/ue4|unreal/i.test(userMessage)) {
      stub = "UE4 is Unreal Engine 4, commonly involved in graphics debugging around materials, post-processing, shaders, and render passes.";
    } else if (/hello|hi/i.test(userMessage)) {
      stub = agentId === "ask_agent" ? "Hello. I can clarify the issue, explain capability boundaries, or guide you to open a .rdc capture without starting RenderDoc execution." : "Hello. In Debugger mode I will generate an execution plan first, then wait for approval before running the strict workflow.";
    } else if (/start|execute|debug|analy[sz]e/.test(lower)) {
      stub = "Received. I will prepare the formal debugging plan first, then move into the strict execution flow only when conditions are met.";
    }
    const intent = /start|execute|debug|analy[sz]e/.test(lower) ? "execute" : "talk";
    return `${stub}
<control>{"intent":"${intent}","safe_to_start":${intent === "execute" ? "true" : "false"}}</control>`;
  }
  async createCoworkTestResponse(agentId, content, options) {
    let userMessage = content;
    try {
      const parsed = JSON.parse(content);
      userMessage = parsed.effective_user_message || parsed.user_message || content;
    } catch {
      userMessage = content;
    }
    if (userMessage.includes("__RDC_AGENT_E2E_FORCE_COWORK_LLM_FAILURE__")) {
      throw new Error("E2E forced cowork LLM request failure");
    }
    const lower = userMessage.toLowerCase();
    const wantsExecution = EXECUTE_PATTERN$1.test(userMessage);
    let stub = agentId === "ask_agent" ? "I can inspect readonly context, search files or public pages, explain boundaries, or guide you to open a .rdc capture without starting a Debugger run." : "I can help scope the debugging target, or prepare a formal Debugger plan when you are ready to execute.";
    if (/ue4|unreal/i.test(userMessage)) {
      stub = "UE4 is Unreal Engine 4. In RDC-Agent it is usually relevant to render pass, material, post-process, and shader debugging context.";
    } else if (/hello|hi|你好|您好/i.test(userMessage)) {
      stub = agentId === "ask_agent" ? "Hello. I can clarify the issue, explain capability boundaries, or guide you to open a .rdc capture without starting RenderDoc execution." : "Hello. In Debugger mode I prepare an execution plan first, then wait for approval before running the debugging workflow.";
    } else if (wantsExecution || EXECUTE_PATTERN$1.test(lower)) {
      stub = "Received. I will prepare the formal debugging plan first, then move into the strict execution flow only when conditions are met.";
    }
    if (agentId === "ask_agent" && userMessage.includes("__RDC_AGENT_E2E_ASK_READONLY_TOOL__")) {
      const toolCallId = generateEventId("e2e-tool");
      this.emitCoworkTestEvent("tool.started", {
        toolCallId,
        toolName: "grep",
        args: { pattern: "ConversationService", path: "src/main/conversation" }
      }, options);
      this.emitCoworkTestEvent("tool.completed", {
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
    } else if (agentId === "ask_agent" && userMessage.includes("__RDC_AGENT_E2E_ASK_DENY_WRITE__")) {
      const toolCallId = generateEventId("e2e-tool");
      this.emitCoworkTestEvent("tool.started", {
        toolCallId,
        toolName: "write_file",
        args: { path: "should-not-exist.txt" }
      }, options);
      this.emitCoworkTestEvent("tool.denied", {
        toolCallId,
        toolName: "write_file",
        reason: "Policy denied: ask_agent can only use readonly tools.",
        result: {
          ok: false,
          data: {},
          artifacts: [],
          error: {
            code: "AGENT_TOOL_POLICY_DENIED",
            message: "Policy denied: ask_agent can only use readonly tools.",
            category: "policy"
          },
          duration_ms: 1,
          trace_id: toolCallId
        }
      }, options);
      stub = "I cannot write files in Ask mode. Ask can inspect and search, but mutation requires the appropriate execution flow.";
    }
    const finalStub = `${stub}
<control>{"intent":"${wantsExecution ? "execute" : "talk"}","safe_to_start":${wantsExecution ? "true" : "false"}}</control>`;
    if (options?.onChunk) {
      const midpoint = Math.max(1, Math.ceil(finalStub.length / 2));
      options.onChunk(finalStub.slice(0, midpoint));
      await Promise.resolve();
      options.onChunk(finalStub.slice(midpoint));
    }
    return finalStub;
  }
  emitCoworkTestEvent(type, payload, options) {
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
const BLOCKER_CODES = {
  // Capture相关
  BLOCKED_MISSING_CAPTURE: {
    code: "BLOCKED_MISSING_CAPTURE",
    category: "capture",
    severity: "critical",
    description: "Missing .rdc capture file",
    resolution: "Provide a valid .rdc file path"
  },
  BLOCKED_CAPTURE_IMPORT_FAILED: {
    code: "BLOCKED_CAPTURE_IMPORT_FAILED",
    category: "capture",
    severity: "critical",
    description: "Failed to import capture file"
  },
  // Gate相关
  BLOCKED_ENTRY_PREFLIGHT: {
    code: "BLOCKED_ENTRY_PREFLIGHT",
    category: "gate",
    severity: "critical",
    description: "Entry preflight check failed"
  },
  BLOCKED_PLATFORM_MODE_UNSUPPORTED: {
    code: "BLOCKED_PLATFORM_MODE_UNSUPPORTED",
    category: "gate",
    severity: "critical",
    description: "Platform mode not supported"
  },
  BLOCKED_INTAKE_GATE_REQUIRED: {
    code: "BLOCKED_INTAKE_GATE_REQUIRED",
    category: "gate",
    severity: "critical",
    description: "Intake gate check failed"
  },
  BLOCKED_RUNTIME_TOPOLOGY_REQUIRED: {
    code: "BLOCKED_RUNTIME_TOPOLOGY_REQUIRED",
    category: "gate",
    severity: "critical",
    description: "Runtime topology check failed"
  },
  BLOCKED_REQUIRED_ARTIFACT_MISSING: {
    code: "BLOCKED_REQUIRED_ARTIFACT_MISSING",
    category: "gate",
    severity: "critical",
    description: "Required artifact is missing"
  },
  BLOCKED_LLM_ROUTE_MISSING: {
    code: "BLOCKED_LLM_ROUTE_MISSING",
    category: "gate",
    severity: "critical",
    description: "Agent route is missing a provider/model binding",
    resolution: "Bind the required agent to a provider/model in Settings -> Agent Routing"
  },
  BLOCKED_LLM_PROVIDER_MISSING: {
    code: "BLOCKED_LLM_PROVIDER_MISSING",
    category: "gate",
    severity: "critical",
    description: "Configured LLM provider cannot be resolved or is disabled",
    resolution: "Enable a valid provider for the bound agent route"
  },
  BLOCKED_LLM_SECRET_MISSING: {
    code: "BLOCKED_LLM_SECRET_MISSING",
    category: "gate",
    severity: "critical",
    description: "Configured LLM provider is missing a valid secret",
    resolution: "Save a valid provider secret in Settings -> Models"
  },
  BLOCKED_LLM_MODEL_MISSING: {
    code: "BLOCKED_LLM_MODEL_MISSING",
    category: "gate",
    severity: "critical",
    description: "Configured LLM model cannot be resolved for the provider route",
    resolution: "Enable the bound model for the provider in Settings -> Models"
  },
  // Runtime相关
  BLOCKED_RUNTIME_OWNER_CONFLICT: {
    code: "BLOCKED_RUNTIME_OWNER_CONFLICT",
    category: "runtime",
    severity: "critical",
    description: "Runtime owner conflict detected"
  },
  BLOCKED_RUNTIME_LOCK_EXPIRED: {
    code: "BLOCKED_RUNTIME_LOCK_EXPIRED",
    category: "runtime",
    severity: "warning",
    description: "Runtime lock has expired"
  },
  BLOCKED_CAPABILITY_TOKEN_EXPIRED: {
    code: "BLOCKED_CAPABILITY_TOKEN_EXPIRED",
    category: "runtime",
    severity: "warning",
    description: "Capability token has expired"
  },
  BLOCKED_LLM_PROVIDER_UNAVAILABLE: {
    code: "BLOCKED_LLM_PROVIDER_UNAVAILABLE",
    category: "runtime",
    severity: "critical",
    description: "Configured LLM provider is unavailable at runtime",
    resolution: "Check provider base URL, connectivity, and account availability"
  },
  BLOCKED_LLM_REQUEST_FAILED: {
    code: "BLOCKED_LLM_REQUEST_FAILED",
    category: "runtime",
    severity: "critical",
    description: "Runtime LLM request failed",
    resolution: "Inspect the recorded provider/model/request failure and fix the provider configuration before retrying"
  },
  // Specialist相关
  BLOCKED_SPECIALIST_FEEDBACK_TIMEOUT: {
    code: "BLOCKED_SPECIALIST_FEEDBACK_TIMEOUT",
    category: "specialist",
    severity: "critical",
    description: "Specialist feedback timeout",
    resolution: "Redispatch or skip investigation"
  },
  BLOCKED_UNKNOWN_SPECIALIST: {
    code: "BLOCKED_UNKNOWN_SPECIALIST",
    category: "specialist",
    severity: "critical",
    description: "Unknown specialist agent"
  },
  BLOCKED_SINGLE_AGENT_MODE_NO_DISPATCH: {
    code: "BLOCKED_SINGLE_AGENT_MODE_NO_DISPATCH",
    category: "specialist",
    severity: "info",
    description: "Single agent mode - no dispatch allowed"
  },
  // Verification相关
  BLOCKED_FIX_VERIFICATION_FAILED: {
    code: "BLOCKED_FIX_VERIFICATION_FAILED",
    category: "verification",
    severity: "critical",
    description: "Fix verification failed"
  },
  BLOCKED_SKEPTIC_SIGNOFF_REQUIRED: {
    code: "BLOCKED_SKEPTIC_SIGNOFF_REQUIRED",
    category: "verification",
    severity: "critical",
    description: "Skeptic signoff required"
  },
  BLOCKED_SHADER_REPLACEMENT_OBSERVABILITY: {
    code: "BLOCKED_SHADER_REPLACEMENT_OBSERVABILITY",
    category: "verification",
    severity: "warning",
    description: "Shader replacement observability blocked"
  },
  // Process相关
  PROCESS_DEVIATION_MAIN_AGENT_OVERREACH: {
    code: "PROCESS_DEVIATION_MAIN_AGENT_OVERREACH",
    category: "process",
    severity: "critical",
    description: "Main agent overreach during specialist brief"
  },
  BLOCKED_FREEZE_STATE_ACTIVE: {
    code: "BLOCKED_FREEZE_STATE_ACTIVE",
    category: "process",
    severity: "critical",
    description: "Run is frozen due to process deviation"
  },
  // 新增：修复参照缺失
  BLOCKED_MISSING_FIX_REFERENCE: {
    code: "BLOCKED_MISSING_FIX_REFERENCE",
    category: "gate",
    severity: "critical",
    description: "Missing fix reference for verification",
    resolution: "Provide fix_reference (description + comparison/baseline .rdc)"
  }
};
const TASK_FILE_PATTERN$1 = /([A-Za-z]:[\\/][^\r\n"]+?\.txt)/g;
const CAPTURE_FILE_PATTERN = /([A-Za-z0-9_.-]+\.rdc)/gi;
const EVENT_ID_PATTERN = /event\s*id\s*(?:是|:)?\s*(\d+)/i;
function firstMatch(pattern, value) {
  const match = pattern.exec(value);
  pattern.lastIndex = 0;
  return match?.[1];
}
function parseTaskFilePath(goal) {
  const match = goal.match(TASK_FILE_PATTERN$1);
  return match?.[0] ? path.resolve(match[0]) : void 0;
}
function parseCaptureFileName(text) {
  const match = text.match(CAPTURE_FILE_PATTERN);
  return match?.[0];
}
function parseEventId(text) {
  const raw = firstMatch(EVENT_ID_PATTERN, text);
  if (!raw) {
    return void 0;
  }
  const eventId = Number(raw);
  return Number.isFinite(eventId) ? eventId : void 0;
}
function inferBackend(goal, requestMode) {
  if (requestMode !== "debugger") {
    return "local";
  }
  return /\bremote\b|远端|安卓|android/i.test(goal) ? "remote" : "local";
}
function createCaptureDescriptor(input, backend) {
  return {
    id: input.inputId,
    filePath: input.filePath,
    role: "primary",
    backendHint: backend,
    status: "pending"
  };
}
function chooseFallbackReplayDevice(preferred) {
  if (preferred) {
    return preferred;
  }
  const devices = replayDeviceService.listDevices();
  const local = devices.find((device) => device.type === "local");
  return local || {
    id: "local",
    label: "Local",
    type: "local",
    status: "online",
    transport: "local",
    detailText: "Local replay ready"
  };
}
class IntakeContextResolver {
  resolve(request) {
    const project = storageAdapter.getProjectById(request.projectId);
    if (!project) {
      throw new Error(`Project not found: ${request.projectId}`);
    }
    const session = request.sessionId ? storageAdapter.readSession(request.sessionId) : null;
    const taskFilePath = parseTaskFilePath(request.goal);
    const taskFileContent = taskFilePath && fs.existsSync(taskFilePath) ? fs.readFileSync(taskFilePath, "utf-8") : void 0;
    const goalText = [request.goal, taskFileContent].filter(Boolean).join("\n\n").trim();
    const explicitCaptureFileName = parseCaptureFileName(goalText);
    const explicitEventId = parseEventId(goalText);
    const backend = inferBackend(goalText, request.mode);
    const projectInputs = storageAdapter.listProjectInputs(project.projectId);
    const openedCapture = rdxSessionService.snapshotOpenedCapture();
    const currentSettings = settingsService.getAll();
    const debuggerRoute = currentSettings.llm.agentRoutes.find((route) => route.agentId === "rdc-debugger");
    const requestCaptures = request.captures ?? [];
    let captures = requestCaptures.length > 0 ? requestCaptures.map((capture) => ({ ...capture })) : projectInputs.map((input) => createCaptureDescriptor(input, backend));
    if (explicitCaptureFileName) {
      const exactFromRequest = captures.find((capture) => path.basename(capture.filePath) === explicitCaptureFileName);
      if (!exactFromRequest) {
        const matchedInput = projectInputs.find((input) => input.fileName === explicitCaptureFileName);
        if (matchedInput) {
          captures = [createCaptureDescriptor(matchedInput, backend)];
        }
      } else {
        captures = captures.map((capture) => ({
          ...capture,
          role: path.basename(capture.filePath) === explicitCaptureFileName ? "primary" : capture.role,
          backendHint: backend
        }));
      }
    }
    const primaryCapture = captures.find((capture) => {
      if (request.primaryCaptureId) {
        return capture.id === request.primaryCaptureId;
      }
      if (explicitCaptureFileName) {
        return path.basename(capture.filePath) === explicitCaptureFileName;
      }
      if (openedCapture) {
        return capture.filePath === openedCapture.filePath;
      }
      return captures.length === 1;
    }) || null;
    const replayDevice = chooseFallbackReplayDevice(request.replayDevice);
    const taskSources = taskFilePath ? [taskFilePath] : [];
    return {
      intakeContext: {
        taskFilePath,
        taskFileContent,
        effectiveGoal: goalText || request.goal,
        discoveredProjectRoot: project.rootPath,
        openedCaptureId: openedCapture?.captureId ?? null,
        openedCapturePath: openedCapture?.filePath ?? null,
        availableCaptureIds: captures.map((capture) => capture.id),
        providerId: debuggerRoute?.providerId || void 0,
        modelId: debuggerRoute?.modelId,
        replayDeviceId: replayDevice.id,
        replayDeviceLabel: replayDevice.label
      },
      project,
      session,
      goalText: goalText || request.goal,
      taskFilePath,
      taskFileContent,
      explicitCaptureFileName,
      explicitEventId,
      captures: captures.map((capture) => ({
        ...capture,
        backendHint: capture.backendHint || backend
      })),
      primaryCaptureId: primaryCapture?.id,
      replayDevice,
      backend,
      taskSources,
      projectInputs
    };
  }
}
const intakeContextResolver = new IntakeContextResolver();
function makeBlocker$1(code, reason, refs = []) {
  return {
    code,
    reason,
    refs,
    detectedAt: nowIso$1()
  };
}
function makeCaptureQuestion(captures) {
  const options = captures.slice(0, 4).map((capture) => ({
    id: capture.id,
    label: path.basename(capture.filePath),
    description: capture.filePath
  }));
  while (options.length < 4) {
    options.push({
      id: `option-${options.length + 1}`,
      label: `选项 ${options.length + 1}`,
      description: "使用自由输入指定更准确的 capture。"
    });
  }
  return {
    id: "target_capture",
    prompt: "当前有多个可用 capture，选择本次 Debugger 主链要分析的目标。",
    recommendedOptionId: options[0]?.id,
    options: [
      options[0],
      options[1],
      options[2],
      options[3]
    ],
    freeformPlaceholder: "输入更准确的 .rdc 文件名"
  };
}
function buildVerificationContract(goalText, eventId) {
  const lower = goalText.toLowerCase();
  return {
    requiresFixValidation: /验证|verify|fix/.test(goalText),
    requiresScreenshotEvidence: /framebuffer|screenshot|截图|多模态/.test(lower + goalText),
    requiresShaderInspection: /shader|ibl|漏光|light|亮点/.test(lower + goalText),
    requiresPixelEvidence: /pixel|像素|亮点|白点/.test(lower + goalText),
    requiresBaselineComparison: /baseline|compare|对比|比较/.test(lower + goalText),
    targetEventIds: eventId ? [eventId] : [],
    successCriteria: [
      "结论必须有真实 rd.* 工具证据支撑。",
      "必须给出 verification 结果，并说明 fix 是否成立。",
      "最终发布 report.md、report.json 和 visual_report.html。"
    ]
  };
}
function recommendSpecialists(goalText, captures, backend) {
  const specialists = ["triage_agent", "pass_graph_pipeline_agent", "pixel_forensics_agent", "shader_ir_agent"];
  if (captures.length > 1 || /baseline|compare|对比|比较/.test(goalText)) {
    specialists.splice(1, 0, "capture_repro_agent");
  }
  if (backend === "remote") {
    specialists.push("driver_device_agent");
  }
  return Array.from(new Set(specialists));
}
function buildDebugPlanPresentation(debugPlan) {
  const sections = [
    {
      id: "goal",
      title: "目标",
      body: [debugPlan.userGoal]
    },
    {
      id: "scope",
      title: "范围",
      body: [
        debugPlan.targetCapture ? `Capture: ${debugPlan.targetCapture.fileName}` : "Capture: 等待确认",
        debugPlan.targetFrameOrEvent?.eventLabel ? `入口: ${debugPlan.targetFrameOrEvent.eventLabel}` : debugPlan.scope,
        debugPlan.scope
      ].filter(Boolean)
    },
    {
      id: "deliverables",
      title: "交付物",
      body: debugPlan.expectedDeliverables
    },
    {
      id: "test-plan",
      title: "Test Plan",
      body: debugPlan.verificationContract.successCriteria
    },
    {
      id: "assumptions",
      title: "Assumptions",
      body: [
        ...debugPlan.referenceContract.acceptanceNotes,
        ...debugPlan.notes
      ]
    }
  ];
  if (debugPlan.missingInfo.length > 0) {
    sections.push({
      id: "missing-info",
      title: "Missing Info",
      body: debugPlan.missingInfo
    });
  }
  if (debugPlan.blockers.length > 0) {
    sections.push({
      id: "blockers",
      title: "Blockers",
      body: debugPlan.blockers.map((blocker) => blocker.reason)
    });
  }
  return {
    title: "执行前调试计划",
    sections: sections.filter((section) => section.body.length > 0)
  };
}
class PlanBuilder {
  build(resolved) {
    const blockers = [];
    const questions = [];
    const targetCapture = resolved.primaryCaptureId ? resolved.captures.find((capture) => capture.id === resolved.primaryCaptureId) ?? null : resolved.captures.length === 1 ? resolved.captures[0] : null;
    const explicitEventId = resolved.explicitEventId;
    if (resolved.captures.length === 0) {
      blockers.push(makeBlocker$1(
        BLOCKER_CODES.BLOCKED_MISSING_CAPTURE.code,
        "当前 project 中没有可用于 Debugger 的 capture。"
      ));
    }
    if (!targetCapture && resolved.captures.length > 1) {
      questions.push(makeCaptureQuestion(resolved.captures));
    }
    const verificationContract = buildVerificationContract(resolved.goalText, explicitEventId);
    const missingInfo = [];
    if (!targetCapture) {
      missingInfo.push("target_capture");
    }
    const targetFrameOrEvent = explicitEventId ? {
      scope: "event",
      eventId: explicitEventId,
      eventLabel: `Event ${explicitEventId}`
    } : {
      scope: "frame",
      frameIndex: 0,
      eventLabel: "Frame 0 default scope"
    };
    let planReadiness = "discovering";
    if (blockers.length > 0) {
      planReadiness = "blocked";
    } else if (questions.length > 0) {
      planReadiness = "needs_user_input";
    } else {
      planReadiness = "strict_ready";
    }
    const debugPlanBase = {
      planId: `plan-${Date.now()}`,
      planReadiness,
      strictReady: planReadiness === "strict_ready",
      userGoal: resolved.goalText,
      targetCapture: targetCapture ? {
        captureId: targetCapture.id,
        fileName: path.basename(targetCapture.filePath),
        filePath: targetCapture.filePath
      } : null,
      targetFrameOrEvent,
      scope: explicitEventId ? "Anchor on the explicit event first, then expand to nearby pipeline and framebuffer evidence." : "Start from the frame and narrow down to the first bad event.",
      referenceContract: {
        taskSources: resolved.taskSources,
        referenceCaptures: resolved.captures.slice(1).map((capture) => capture.filePath),
        acceptanceNotes: [
          "只在 debug_plan.strict_ready 且用户批准后进入执行。",
          "报告需要覆盖 root cause、verification 和 deliverables。"
        ]
      },
      verificationContract,
      expectedDeliverables: [
        "report.md",
        "report.json",
        "visual_report.html"
      ],
      blockers,
      missingInfo,
      recommendedSpecialists: recommendSpecialists(resolved.goalText, resolved.captures, resolved.backend),
      notes: [
        resolved.taskFilePath ? `Task source: ${resolved.taskFilePath}` : "Task source: inline prompt",
        resolved.intakeContext.openedCapturePath ? `Opened capture: ${resolved.intakeContext.openedCapturePath}` : "No opened capture reused",
        resolved.intakeContext.providerId && resolved.intakeContext.modelId ? `LLM route: ${resolved.intakeContext.providerId}/${resolved.intakeContext.modelId}` : "LLM route missing; execution must stay blocked until an explicit provider/model route is configured."
      ],
      createdAt: nowIso$1(),
      updatedAt: nowIso$1()
    };
    const debugPlan = {
      ...debugPlanBase,
      presentation: buildDebugPlanPresentation(debugPlanBase)
    };
    const pendingQuestions = questions.length > 0 ? {
      promptId: `ask-${Date.now()}`,
      title: "补齐执行关键缺口",
      summary: "以下信息会直接影响执行路径，请先确认。",
      questions,
      createdAt: nowIso$1()
    } : null;
    return {
      debugPlan,
      pendingQuestions,
      blockers
    };
  }
}
const planBuilder = new PlanBuilder();
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
function shouldUseNativeJsonObject(route) {
  const providerKind = route.provider.kind;
  const modelId = route.modelId.toLowerCase();
  if (providerKind === "anthropic") {
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
    return {
      runId,
      providerId: summary.providerId,
      modelId: summary.modelId,
      inputTokens: summary.totalInputTokens,
      outputTokens: summary.totalOutputTokens,
      totalTokens,
      contextWindowTokens,
      usagePercent: contextWindowTokens ? Math.min(100, Math.max(0, Math.round(totalTokens / contextWindowTokens * 100))) : 0,
      hasConfiguredContextWindow: Boolean(contextWindowTokens)
    };
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
  async call(context2, request) {
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
        ...request,
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
class HarnessController {
  _enabled = true;
  /**
   * 检查控制器是否启用
   */
  isEnabled() {
    return this._enabled;
  }
  /**
   * 启用/禁用控制器
   */
  setEnabled(enabled) {
    this._enabled = enabled;
  }
  // ========== 前置Gate层 ==========
  /**
   * EntryGate - 入口闸门
   * 检查：.rdc文件存在性、平台模式、环境配置
   */
  async executeEntryGate(input) {
    const blockers = [];
    if (!input.capturePaths || input.capturePaths.length === 0) {
      blockers.push(this.createBlocker("BLOCKED_MISSING_CAPTURE", "No .rdc capture files provided"));
    }
    for (const capturePath of input.capturePaths || []) {
      const fs2 = await import("fs");
      if (!fs2.existsSync(capturePath)) {
        blockers.push(this.createBlocker(
          "BLOCKED_CAPTURE_IMPORT_FAILED",
          `Capture file not found: ${capturePath}`,
          [capturePath]
        ));
      }
    }
    if (input.backend === "remote") ;
    if (input.mode === "debugger") {
      if (!settingsService.hasConfiguredProvider()) {
        blockers.push(this.createBlocker(
          "LLM_KEY_MISSING",
          "At least one configured provider is required for Debugger mode",
          ["settings:models"]
        ));
      }
      blockers.push(...debuggerLlmService.getRouteBlockers(["rdc-debugger"], "plan"));
    }
    if (input.captures && input.captures.length > 0) {
      const hasRemoteCapture = input.captures.some((c) => c.backendHint === "remote");
      if (hasRemoteCapture && (!input.replayDevice || input.replayDevice.type === "local" || input.replayDevice.status !== "online")) {
        blockers.push(this.createBlocker(
          "REMOTE_CONFIG_MISSING",
          "Remote capture requires an online Replay Device",
          []
        ));
      }
    }
    return this.createGateResult("entry_gate", blockers);
  }
  /**
   * IntakeGate - Intake闸门
   * 检查：数据完整性、参照契约
   */
  async executeIntakeGate(caseId, runId, input) {
    const blockers = [];
    const requiredFields = ["session", "symptom", "captures"];
    for (const field of requiredFields) {
      if (!input.caseInput[field]) {
        blockers.push(this.createBlocker(
          "BLOCKED_INTAKE_GATE_REQUIRED",
          `Missing required field in case_input: ${field}`
        ));
      }
    }
    if (!input.captureRefs || input.captureRefs.length === 0) {
      blockers.push(this.createBlocker(
        "BLOCKED_INTAKE_GATE_REQUIRED",
        "No capture references defined"
      ));
    }
    const referenceContract = input.caseInput.reference_contract;
    if (!referenceContract || !referenceContract.source_refs) {
      blockers.push(this.createBlocker(
        "BLOCKED_MISSING_FIX_REFERENCE",
        "Missing fix_reference for verification. Provide description + comparison/baseline .rdc"
      ));
    }
    await storageAdapter.writeArtifact(caseId, runId, "intake_gate.yaml", {
      schema_version: "2",
      generated_at: nowIso$1(),
      status: blockers.length === 0 ? "passed" : "blocked",
      checks: requiredFields.map((f) => ({
        id: `check_${f}`,
        result: input.caseInput[f] ? "pass" : "fail"
      })),
      blocking_codes: blockers.map((b) => b.code)
    });
    return this.createGateResult("intake_gate", blockers);
  }
  /**
   * DispatchGate - 分派闸门
   * 检查：模式一致性、执行证据
   */
  async executeDispatchGate(_caseId, _runId, input) {
    const blockers = [];
    if (input.orchestrationMode === "multi_agent") {
      const sessionId = await storageAdapter.getCurrentSessionId();
      if (sessionId) {
        const events = await storageAdapter.readActionChain(sessionId);
        const dispatchEvents = events.filter((e) => e.event_type === "dispatch");
        if (dispatchEvents.length === 0) ;
        else {
          const pendingDispatch = dispatchEvents.find((e) => e.status === "sent");
          if (pendingDispatch) {
            blockers.push(this.createBlocker(
              "BLOCKED_SPECIALIST_FEEDBACK_TIMEOUT",
              "Previous dispatch still pending feedback",
              [pendingDispatch.event_id]
            ));
          }
        }
      }
    }
    const validAgents = [
      "triage_agent",
      "capture_repro_agent",
      "pass_graph_pipeline_agent",
      "pixel_forensics_agent",
      "shader_ir_agent",
      "driver_device_agent",
      "skeptic_agent",
      "curator_agent"
    ];
    if (!validAgents.includes(input.targetAgent)) {
      blockers.push(this.createBlocker(
        "BLOCKED_UNKNOWN_SPECIALIST",
        `Unknown specialist: ${input.targetAgent}`,
        [input.targetAgent]
      ));
    }
    return this.createGateResult("dispatch_gate", blockers);
  }
  /**
   * VerifyGate - 验证闸门
   * 检查：fix_verification schema完整性
   */
  async executeVerifyGate(_caseId, _runId, input) {
    const blockers = [];
    const requiredFields = [
      "verdict",
      "verification_mode",
      "verification_confidence",
      "structural_verification",
      "semantic_verification",
      "overall_result"
    ];
    for (const field of requiredFields) {
      if (input.fixVerificationData[field] === void 0) {
        blockers.push(this.createBlocker(
          "BLOCKED_FIX_VERIFICATION_FAILED",
          `Missing required field in fix_verification: ${field}`
        ));
      }
    }
    const structural = input.fixVerificationData.structural_verification;
    if (structural && structural.status !== "passed") {
      blockers.push(this.createBlocker(
        "BLOCKED_FIX_VERIFICATION_FAILED",
        "Structural verification failed"
      ));
    }
    const semantic = input.fixVerificationData.semantic_verification;
    if (semantic && semantic.status === "fallback_only") {
      console.warn("Semantic verification is fallback_only");
    }
    return this.createGateResult("verify_gate", blockers);
  }
  // ========== 运行时监控层 ==========
  /**
   * 模式一致性检查
   * 验证声明的multi_agent是否有dispatch证据
   */
  async checkModeConsistency(caseId, runId) {
    const issues = [];
    const topology = await storageAdapter.readArtifact(caseId, runId, "runtime_topology.yaml");
    if (!topology) {
      issues.push("runtime_topology.yaml not found");
      return { isConsistent: false, issues };
    }
    const orchestrationMode = topology.orchestration_mode;
    if (orchestrationMode === "multi_agent") {
      const sessionId = await storageAdapter.getCurrentSessionId();
      if (sessionId) {
        const events = await storageAdapter.readActionChain(sessionId);
        const dispatchEvents = events.filter((e) => e.event_type === "dispatch");
        if (dispatchEvents.length === 0) {
          issues.push("multi_agent declared but no dispatch events found");
        }
      }
    }
    return { isConsistent: issues.length === 0, issues };
  }
  /**
   * Stage推进校验
   * 验证workflow_stage是否与action_chain一致
   */
  async validateStageConsistency(caseId, runId) {
    const runData = await storageAdapter.readRun(caseId, runId);
    if (!runData) {
      return { isConsistent: false, currentStage: null, expectedStage: null };
    }
    const runtime = runData.runtime;
    const declaredStage = runtime?.workflow_stage;
    const sessionId = await storageAdapter.getCurrentSessionId();
    if (!sessionId) {
      return { isConsistent: true, currentStage: declaredStage, expectedStage: declaredStage };
    }
    const events = await storageAdapter.readActionChain(sessionId);
    const stageEvents = events.filter((e) => e.event_type === "workflow_stage_transition");
    if (stageEvents.length === 0) {
      return { isConsistent: true, currentStage: declaredStage, expectedStage: declaredStage };
    }
    const lastStageEvent = stageEvents[stageEvents.length - 1];
    const expectedStage = lastStageEvent.payload?.to_stage;
    return {
      isConsistent: declaredStage === expectedStage,
      currentStage: declaredStage,
      expectedStage
    };
  }
  /**
   * 工具执行包装器
   * 所有live rd.*调用必须经过此包装器，自动写入action_chain
   */
  async wrapToolExecution(input) {
    const startTime = nowMs();
    const result = await input.execute();
    const duration = nowMs() - startTime;
    const event = {
      schema_version: "2",
      event_id: `evt-tool-${nowMs()}`,
      turn_id: input.turnId,
      ts_ms: startTime,
      run_id: input.runId,
      session_id: input.sessionId,
      agent_id: input.agentId,
      event_type: "tool_execution",
      status: result.ok ? "ok" : "error",
      duration_ms: duration,
      refs: [],
      payload: {
        tool_name: input.toolName,
        args: input.args,
        result: result.ok ? "success" : "failed",
        data: result.ok ? result.data : void 0,
        artifacts: result.ok ? result.artifacts : void 0,
        error: result.error
      }
    };
    await storageAdapter.appendActionEvent(input.sessionId, event);
    return result;
  }
  /**
   * 早期Blocker检测
   * 实时检测blocking_issues，而非等到final audit
   */
  async detectEarlyBlockers(caseId, runId) {
    const blockers = [];
    const runPath = storageAdapter.getRunPath(caseId, runId);
    const fs2 = await import("fs");
    const boardPath = `${runPath}/notes/hypothesis_board.yaml`;
    if (fs2.existsSync(boardPath)) {
      const yaml2 = await import("yaml");
      const content = await fs2.promises.readFile(boardPath, "utf-8");
      const board = yaml2.parse(content);
      if (board?.hypothesis_board?.blocking_issues) {
        for (const issue of board.hypothesis_board.blocking_issues) {
          blockers.push(this.createBlocker(
            issue.code || "BLOCKER_DETECTED",
            issue.reason || "Blocking issue detected",
            issue.refs || []
          ));
        }
      }
    }
    const freezePath = `${runPath}/artifacts/freeze_state.yaml`;
    if (fs2.existsSync(freezePath)) {
      const yaml2 = await import("yaml");
      const content = await fs2.promises.readFile(freezePath, "utf-8");
      const freeze = yaml2.parse(content);
      if (freeze?.status === "frozen") {
        blockers.push(this.createBlocker(
          "BLOCKED_FREEZE_STATE_ACTIVE",
          "Run is frozen due to process deviation",
          freeze.blocking_codes || []
        ));
      }
    }
    return { hasBlockers: blockers.length > 0, blockers };
  }
  // ========== 辅助方法 ==========
  createBlocker(code, reason, refs = []) {
    return {
      code,
      reason,
      refs,
      detectedAt: nowIso$1()
    };
  }
  createGateResult(stage, blockers) {
    return {
      stage,
      status: blockers.length === 0 ? "passed" : "blocked",
      blockers,
      refs: [],
      paths: {}
    };
  }
}
const harnessController = new HarnessController();
function toStringArray$1(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}
function toNumber(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}
function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
function summarizePayloadData(value) {
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value;
  const summary = {};
  for (const [key, entry] of Object.entries(record).slice(0, 8)) {
    if (Array.isArray(entry)) {
      summary[key] = `array(${entry.length})`;
      continue;
    }
    if (entry && typeof entry === "object") {
      summary[key] = `object(${Object.keys(entry).length})`;
      continue;
    }
    summary[key] = entry;
  }
  return summary;
}
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function formatPixel(value) {
  const pixel = asRecord(value);
  const x = pixel.x;
  const y = pixel.y;
  const rgba = [pixel.r, pixel.g, pixel.b, pixel.a].map((entry) => typeof entry === "number" ? entry : null);
  if (rgba.some((entry) => entry === null)) {
    return null;
  }
  return `Pixel(${x ?? "?"},${y ?? "?"}) RGBA=${rgba.join(",")}`;
}
function describePayloadEvidence(toolName, data) {
  const record = asRecord(data);
  if (toolName === "rd.export.screenshot") {
    const nameInfo = asRecord(record.name_info);
    return [
      `Screenshot ${record.width ?? "?"}x${record.height ?? "?"}`,
      `event=${record.resolved_event_id ?? record.requested_event_id ?? "?"}`,
      `target=${record.texture_id ?? nameInfo.resource_id ?? "unknown"}`,
      `format=${record.texture_format ?? "unknown"}`,
      record.fallback_reason ? `fallback=${record.fallback_reason}` : "",
      Array.isArray(record.summary_degraded_reasons) ? `degraded=${record.summary_degraded_reasons.join(",")}` : ""
    ].filter(Boolean).join("; ");
  }
  if (toolName === "rd.macro.explain_pixel") {
    const history = Array.isArray(record.history) ? record.history : [];
    return `${record.explanation ?? "Pixel explanation available"} History events=${history.map((entry) => asRecord(entry).event_id).filter(Boolean).join(",") || history.length}`;
  }
  if (toolName === "rd.texture.get_pixel_value") {
    const pixel = formatPixel(record.pixel);
    return [
      pixel ?? "Pixel value readback available",
      `texture=${record.texture_id ?? "unknown"}`,
      `event=${record.resolved_event_id ?? "?"}`,
      Array.isArray(record.summary_degraded_reasons) ? `degraded=${record.summary_degraded_reasons.join(",")}` : ""
    ].filter(Boolean).join("; ");
  }
  if (toolName === "rd.texture.get_pixel_history") {
    const history = Array.isArray(record.history) ? record.history : [];
    return `Pixel history on ${record.texture_id ?? "unknown"} has ${history.length} modifications: ${history.map((entry) => asRecord(entry).event_id).filter(Boolean).join(",") || "none"}.`;
  }
  if (toolName === "rd.pipeline.get_state_summary") {
    const summary = asRecord(record.summary);
    const shaders = Array.isArray(summary.shaders) ? summary.shaders.map((entry) => {
      const shader = asRecord(entry);
      return `${shader.stage}:${shader.resource_id}`;
    }).join(", ") : "";
    const target = asRecord(summary.selected_visual_target);
    return [
      `Pipeline api=${summary.api ?? "unknown"}`,
      shaders ? `shaders=${shaders}` : "",
      `bindings=${summary.binding_count ?? "?"}`,
      target.texture_id ? `visual_target=${target.texture_id}` : "",
      target.fallback_reason ? `fallback=${target.fallback_reason}` : ""
    ].filter(Boolean).join("; ");
  }
  if (toolName === "rd.pipeline.get_output_targets") {
    const framebuffer = asRecord(record.framebuffer);
    const target = asRecord(framebuffer.selected_visual_target);
    return [
      `Framebuffer render_targets=${Array.isArray(framebuffer.render_targets) ? framebuffer.render_targets.length : "?"}`,
      target.texture_id ? `visual_target=${target.texture_id}` : "",
      target.texture_format ? `format=${target.texture_format}` : "",
      target.fallback_reason ? `fallback=${target.fallback_reason}` : ""
    ].filter(Boolean).join("; ");
  }
  if (toolName === "rd.pipeline.get_resource_bindings") {
    const bindings = Array.isArray(record.bindings) ? record.bindings : [];
    const first = bindings.slice(0, 5).map((entry) => {
      const binding = asRecord(entry);
      return `${binding.type}@${binding.set_or_space}:${binding.binding}=${binding.resource_id}`;
    });
    return `Resource bindings ${bindings.length}: ${first.join(", ")}`;
  }
  if (toolName.startsWith("rd.pipeline.get_shader")) {
    const shader = asRecord(record.shader);
    return `Shader ${shader.stage ?? "unknown"} ${shader.shader_id ?? "unknown"} entry=${shader.entry ?? "unknown"}`;
  }
  return null;
}
function findStringFieldDeep(value, keys, seen = /* @__PURE__ */ new Set()) {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (seen.has(value)) {
    return null;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findStringFieldDeep(item, keys, seen);
      if (nested) {
        return nested;
      }
    }
    return null;
  }
  const record = value;
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key]) {
      return record[key];
    }
  }
  for (const nestedValue of Object.values(record)) {
    const nested = findStringFieldDeep(nestedValue, keys, seen);
    if (nested) {
      return nested;
    }
  }
  return null;
}
function getActiveEventId(debugPlan) {
  return debugPlan.targetFrameOrEvent?.eventId;
}
function getFrameIndex(debugPlan) {
  return debugPlan.targetFrameOrEvent?.frameIndex;
}
function pngDimensions(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}
async function fileToImageBlock(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const data = await fs.promises.readFile(filePath);
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: "image/png",
      data: data.toString("base64")
    }
  };
}
class SpecialistRecipeRunner {
  async prepareSurface(context2) {
    const existingSnapshot = rdxSessionService.snapshotContext();
    const existingCapture = rdxSessionService.getCaptureDescriptors().find((capture) => capture.id === context2.debugPlan.targetCapture?.captureId || capture.filePath === context2.targetCapturePath);
    const existingReplaySessionId = existingCapture?.sessionId || existingCapture?.replaySessionId || existingSnapshot.sessionId || await this.resolveReplaySessionId(context2);
    if (existingReplaySessionId) {
      const frameIndex2 = getFrameIndex(context2.debugPlan);
      if (typeof frameIndex2 === "number") {
        await this.callTool(
          "rd.replay.set_frame",
          {
            session_id: existingReplaySessionId,
            frame_index: frameIndex2
          },
          "triage_agent",
          context2
        );
      }
      const eventId2 = getActiveEventId(context2.debugPlan);
      if (typeof eventId2 === "number") {
        await this.callTool(
          "rd.event.set_active",
          {
            session_id: existingReplaySessionId,
            event_id: eventId2
          },
          "triage_agent",
          context2
        );
      }
      await this.openHumanPreviewSafe(existingReplaySessionId);
      return {
        captureFileId: existingCapture?.captureFileId || existingCapture?.id || context2.debugPlan.targetCapture?.captureId || "target_capture",
        replaySessionId: existingReplaySessionId
      };
    }
    const openCapture = await this.callTool(
      "rd.capture.open_file",
      {
        file_path: context2.targetCapturePath
      },
      "triage_agent",
      context2
    );
    const captureFileId = typeof openCapture.data?.capture_file_id === "string" ? openCapture.data.capture_file_id : context2.debugPlan.targetCapture?.captureId;
    if (!openCapture.ok || !captureFileId) {
      throw new Error(openCapture.error?.message || `Failed to open target capture. capture_id=${String(captureFileId || "")} data_keys=${Object.keys(openCapture.data || {}).join(",") || "none"}`);
    }
    const openReplay = await this.callTool(
      "rd.capture.open_replay",
      {
        capture_file_id: captureFileId
      },
      "triage_agent",
      context2
    );
    const replaySessionId = typeof openReplay.data?.session_id === "string" ? openReplay.data.session_id : typeof openReplay.data?.replay_session_id === "string" ? openReplay.data.replay_session_id : await this.resolveReplaySessionId(context2);
    if (!openReplay.ok || !replaySessionId) {
      throw new Error(openReplay.error?.message || `Failed to open replay session. data_keys=${Object.keys(openReplay.data || {}).join(",") || "none"}`);
    }
    const frameIndex = getFrameIndex(context2.debugPlan);
    if (typeof frameIndex === "number") {
      await this.callTool(
        "rd.replay.set_frame",
        {
          session_id: replaySessionId,
          frame_index: frameIndex
        },
        "triage_agent",
        context2
      );
    }
    const eventId = getActiveEventId(context2.debugPlan);
    if (typeof eventId === "number") {
      await this.callTool(
        "rd.event.set_active",
        {
          session_id: replaySessionId,
          event_id: eventId
        },
        "triage_agent",
        context2
      );
    }
    await this.openHumanPreviewSafe(replaySessionId);
    return {
      captureFileId: String(captureFileId),
      replaySessionId: String(replaySessionId)
    };
  }
  async run(agentId, context2, surface) {
    if (agentId === "triage_agent") {
      return this.runTriage(context2, surface);
    }
    if (agentId === "capture_repro_agent") {
      return this.runCaptureRepro(context2, surface);
    }
    if (agentId === "pass_graph_pipeline_agent") {
      return this.runPassGraph(context2, surface);
    }
    if (agentId === "pixel_forensics_agent") {
      return this.runPixelForensics(context2, surface);
    }
    if (agentId === "shader_ir_agent") {
      return this.runShaderIr(context2, surface);
    }
    if (agentId === "driver_device_agent") {
      return this.runDriverDevice(context2);
    }
    throw new Error(`Unsupported specialist recipe: ${agentId}`);
  }
  async openHumanPreviewSafe(sessionId) {
    await rdxSessionService.openHumanPreviewWindow({ sessionId }).catch(() => void 0);
  }
  async runTriage(context2, surface) {
    const eventId = getActiveEventId(context2.debugPlan);
    const payloads = [];
    const info = await this.callTool("rd.capture.get_info", {
      capture_file_id: surface.captureFileId
    }, "triage_agent", context2);
    payloads.push(this.toPayload("rd.capture.get_info", info));
    const frame = await this.callTool("rd.replay.get_frame_info", {
      session_id: surface.replaySessionId
    }, "triage_agent", context2);
    payloads.push(this.toPayload("rd.replay.get_frame_info", frame));
    if (typeof eventId === "number") {
      const action = await this.callTool("rd.event.get_action_details", {
        session_id: surface.replaySessionId,
        event_id: eventId
      }, "triage_agent", context2);
      payloads.push(this.toPayload("rd.event.get_action_details", action));
      const parentChain = await this.callTool("rd.event.get_parent_chain", {
        session_id: surface.replaySessionId,
        event_id: eventId
      }, "triage_agent", context2);
      payloads.push(this.toPayload("rd.event.get_parent_chain", parentChain));
      const markerStack = await this.callTool("rd.event.get_marker_stack", {
        session_id: surface.replaySessionId,
        event_id: eventId
      }, "triage_agent", context2);
      payloads.push(this.toPayload("rd.event.get_marker_stack", markerStack));
    }
    const summary = await this.callTool("rd.macro.summarize_frame", {
      session_id: surface.replaySessionId
    }, "triage_agent", context2);
    payloads.push(this.toPayload("rd.macro.summarize_frame", summary));
    return this.finishRecipe("triage_agent", context2, payloads, [
      "Capture metadata",
      "Frame summary",
      eventId ? `Event ${eventId}` : "Frame-level scope"
    ]);
  }
  async runCaptureRepro(context2, surface) {
    const payloads = [];
    const listFrames = await this.callTool("rd.capture.list_frames", {
      capture_file_id: surface.captureFileId
    }, "capture_repro_agent", context2);
    payloads.push(this.toPayload("rd.capture.list_frames", listFrames));
    const screenshotPath = path.join(context2.outputRoot, "screenshots", "capture_repro.png");
    const screenshot = await this.callTool("rd.export.screenshot", {
      session_id: surface.replaySessionId,
      output_path: screenshotPath,
      file_format: "png",
      include_alpha: true
    }, "capture_repro_agent", context2);
    payloads.push(this.toPayload("rd.export.screenshot", screenshot));
    return this.finishRecipe("capture_repro_agent", context2, payloads, [
      "Frame list",
      "Reference screenshot"
    ]);
  }
  async runPassGraph(context2, surface) {
    const eventId = getActiveEventId(context2.debugPlan);
    const payloads = [];
    const stageState = await this.callTool("rd.pipeline.get_state_summary", {
      session_id: surface.replaySessionId,
      event_id: eventId,
      include_bindings: true,
      include_shaders: true
    }, "pass_graph_pipeline_agent", context2);
    payloads.push(this.toPayload("rd.pipeline.get_state_summary", stageState));
    const outputTargets = await this.callTool("rd.pipeline.get_output_targets", {
      session_id: surface.replaySessionId,
      event_id: eventId
    }, "pass_graph_pipeline_agent", context2);
    payloads.push(this.toPayload("rd.pipeline.get_output_targets", outputTargets));
    const bindings = await this.callTool("rd.pipeline.get_resource_bindings", {
      session_id: surface.replaySessionId,
      stage: "ps"
    }, "pass_graph_pipeline_agent", context2);
    payloads.push(this.toPayload("rd.pipeline.get_resource_bindings", bindings));
    if (typeof eventId === "number" && eventId > 1) {
      const diff = await this.callTool("rd.event.diff_pipeline_state", {
        session_id: surface.replaySessionId,
        event_a: Math.max(1, eventId - 1),
        event_b: eventId,
        scope: "full",
        include_unchanged: false
      }, "pass_graph_pipeline_agent", context2);
      payloads.push(this.toPayload("rd.event.diff_pipeline_state", diff));
    }
    return this.finishRecipe("pass_graph_pipeline_agent", context2, payloads, [
      "Pipeline summary",
      "Output targets",
      "Binding diff"
    ]);
  }
  async runPixelForensics(context2, surface) {
    const payloads = [];
    const screenshotPath = path.join(context2.outputRoot, "screenshots", "pixel_forensics.png");
    const screenshot = await this.callTool("rd.export.screenshot", {
      session_id: surface.replaySessionId,
      output_path: screenshotPath,
      file_format: "png",
      include_alpha: true
    }, "pixel_forensics_agent", context2);
    payloads.push(this.toPayload("rd.export.screenshot", screenshot));
    const point = await this.locatePixelFocus(screenshotPath, context2);
    const resolvedTextureId = typeof screenshot.data?.texture_id === "string" ? screenshot.data.texture_id : void 0;
    const explain = await this.callTool("rd.macro.explain_pixel", {
      session_id: surface.replaySessionId,
      x: point.x,
      y: point.y,
      target: resolvedTextureId ?? "auto",
      verbosity: "medium"
    }, "pixel_forensics_agent", context2);
    payloads.push(this.toPayload("rd.macro.explain_pixel", explain));
    if (resolvedTextureId) {
      const pixelValue = await this.callTool("rd.texture.get_pixel_value", {
        session_id: surface.replaySessionId,
        texture_id: resolvedTextureId,
        x: point.x,
        y: point.y,
        mip: 0,
        slice: 0,
        sample: 0,
        as_type: "float"
      }, "pixel_forensics_agent", context2);
      payloads.push(this.toPayload("rd.texture.get_pixel_value", pixelValue));
      const pixelHistory = await this.callTool("rd.texture.get_pixel_history", {
        session_id: surface.replaySessionId,
        texture_id: resolvedTextureId,
        x: point.x,
        y: point.y,
        mip: 0,
        slice: 0,
        sample: 0,
        include_shaders: true
      }, "pixel_forensics_agent", context2);
      payloads.push(this.toPayload("rd.texture.get_pixel_history", pixelHistory));
    }
    return this.finishRecipe("pixel_forensics_agent", context2, payloads, [
      `Pixel focus ${point.x},${point.y}`,
      "Framebuffer screenshot",
      "Pixel explanation"
    ], [screenshotPath]);
  }
  async runShaderIr(context2, surface) {
    const eventId = getActiveEventId(context2.debugPlan);
    const payloads = [];
    let shaderId;
    let shaderStage = "ps";
    for (const stage of ["ps", "cs", "vs"]) {
      const shader = await this.callTool("rd.pipeline.get_shader", {
        session_id: surface.replaySessionId,
        event_id: eventId,
        stage
      }, "shader_ir_agent", context2);
      payloads.push(this.toPayload(`rd.pipeline.get_shader:${stage}`, shader));
      const candidateShaderId = typeof shader.data?.shader_id === "string" ? shader.data.shader_id : typeof shader.data?.resource_id === "string" ? shader.data.resource_id : void 0;
      if (candidateShaderId) {
        shaderId = candidateShaderId;
        shaderStage = stage;
        break;
      }
    }
    if (shaderId) {
      const source = await this.callTool("rd.shader.get_source", {
        session_id: surface.replaySessionId,
        shader_id: shaderId,
        prefer_original: true
      }, "shader_ir_agent", context2);
      payloads.push(this.toPayload("rd.shader.get_source", source));
      const disassembly = await this.callTool("rd.shader.get_disassembly", {
        session_id: surface.replaySessionId,
        shader_id: shaderId,
        stage: shaderStage,
        event_id: eventId
      }, "shader_ir_agent", context2);
      payloads.push(this.toPayload("rd.shader.get_disassembly", disassembly));
      const reflection = await this.callTool("rd.shader.get_reflection", {
        session_id: surface.replaySessionId,
        shader_id: shaderId,
        stage: shaderStage,
        event_id: eventId,
        include_bindings: true,
        include_constant_blocks: true
      }, "shader_ir_agent", context2);
      payloads.push(this.toPayload("rd.shader.get_reflection", reflection));
    }
    return this.finishRecipe("shader_ir_agent", context2, payloads, [
      shaderId ? `Shader ${shaderId}` : "Shader lookup attempted",
      `Stage ${shaderStage}`
    ]);
  }
  async runDriverDevice(context2) {
    const payloads = [];
    const contextSnapshot = await this.callTool("rd.session.get_context", {
      context_id: context2.contextId
    }, "driver_device_agent", context2);
    payloads.push(this.toPayload("rd.session.get_context", contextSnapshot));
    const ping = await this.callTool("rd.remote.ping", {
      remote_id: "current"
    }, "driver_device_agent", context2);
    payloads.push(this.toPayload("rd.remote.ping", ping));
    return this.finishRecipe("driver_device_agent", context2, payloads, [
      "Runtime context",
      "Remote status probe"
    ]);
  }
  async callTool(toolName, args, agentId, context2) {
    const result = await harnessController.wrapToolExecution({
      toolName,
      args,
      agentId,
      sessionId: context2.sessionId,
      runId: context2.runId,
      turnId: context2.turnId,
      execute: () => rdxCliInvokerService.call({
        toolName,
        args: {
          ...args,
          context_id: context2.contextId,
          runtime_owner: context2.runtimeOwner,
          owner_lease_id: context2.ownerLeaseId
        },
        contextId: context2.contextId,
        turnId: context2.turnId,
        runtimeOwner: context2.runtimeOwner,
        ownerLeaseId: context2.ownerLeaseId,
        runId: context2.runId,
        abortSignal: context2.signal
      })
    });
    return {
      ok: result.ok,
      data: result.data,
      error: result.error,
      artifacts: [],
      duration_ms: 0
    };
  }
  async resolveReplaySessionId(context2) {
    for (const toolName of ["rd.session.get_context", "rd.session.list_sessions", "rd.core.get_capabilities"]) {
      const result = await this.callTool(toolName, {}, "triage_agent", context2);
      if (!result.ok) {
        continue;
      }
      const replaySessionId = findStringFieldDeep(result.data, [
        "current_session_id",
        "selected_session_id",
        "session_id",
        "replay_session_id"
      ]);
      if (replaySessionId) {
        return replaySessionId;
      }
    }
    return null;
  }
  toPayload(toolName, result) {
    return {
      toolName,
      ok: result.ok,
      data: result.data,
      error: result.error?.message
    };
  }
  async locatePixelFocus(screenshotPath, context2) {
    const dims = pngDimensions(screenshotPath);
    if (!dims) {
      return { x: 0, y: 0 };
    }
    const fallbackPoint = {
      x: Math.max(0, Math.min(dims.width - 1, Math.round(dims.width * 0.5))),
      y: Math.max(0, Math.min(dims.height - 1, Math.round(dims.height * 0.5)))
    };
    const imageBlock = await fileToImageBlock(screenshotPath);
    if (!imageBlock) {
      return fallbackPoint;
    }
    try {
      const { data } = await debuggerLlmService.callStructured({
        agentId: "pixel_forensics_agent",
        stage: "dispatch",
        sessionId: context2.sessionId,
        runId: context2.runId,
        messages: [
          {
            role: "system",
            content: "You are a graphics debugging assistant. Return JSON only with keys normalized_x, normalized_y, reason. Coordinates must be floats between 0 and 1 for the suspicious bright white highlight most relevant to the debugging task."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Task: ${context2.debugPlan.userGoal}
Find the suspicious bright white highlight that should be investigated first.`
              },
              imageBlock
            ]
          }
        ],
        maxTokens: 300,
        temperature: 0.1,
        parse: (text) => debuggerLlmService.parseJson(text),
        testValue: {
          normalized_x: 0.5,
          normalized_y: 0.5,
          reason: "test-mode center point"
        },
        auditSummary: (payload) => payload.reason
      });
      return {
        x: Math.max(0, Math.min(dims.width - 1, Math.round(clamp01(toNumber(data.normalized_x, 0.5)) * dims.width))),
        y: Math.max(0, Math.min(dims.height - 1, Math.round(clamp01(toNumber(data.normalized_y, 0.5)) * dims.height)))
      };
    } catch {
      return fallbackPoint;
    }
  }
  async finishRecipe(agentId, context2, payloads, evidence, extraArtifacts = []) {
    const agentRoot = path.join(context2.outputRoot, "notes");
    fs.mkdirSync(agentRoot, { recursive: true });
    const artifactPath = path.join(agentRoot, `${agentId}.json`);
    fs.writeFileSync(artifactPath, JSON.stringify(payloads, null, 2), "utf-8");
    const successfulTools = payloads.filter((payload) => payload.ok);
    const failedTools = payloads.filter((payload) => !payload.ok);
    const condensedPayloads = payloads.map((payload) => ({
      toolName: payload.toolName,
      ok: payload.ok,
      data: summarizePayloadData(payload.data),
      error: payload.error
    }));
    const deterministicSummary = {
      summary: [
        `${agentId} collected ${successfulTools.length} successful tool results.`,
        ...successfulTools.map((payload) => describePayloadEvidence(payload.toolName, payload.data) ?? payload.toolName).slice(0, 4).map((line) => `- ${line}`),
        ...failedTools.length > 0 ? [`Failed tools: ${failedTools.map((payload) => payload.toolName).join(", ")}`] : []
      ].join("\n"),
      evidence: [
        ...evidence,
        ...successfulTools.map((payload) => describePayloadEvidence(payload.toolName, payload.data)).filter((line) => Boolean(line))
      ],
      next_step: this.getNextStep(agentId),
      confidence: successfulTools.length > 0 ? 0.72 : 0.35
    };
    let llmSummary;
    try {
      const structuredResult = await debuggerLlmService.callStructured({
        agentId,
        stage: "dispatch",
        sessionId: context2.sessionId,
        runId: context2.runId,
        messages: [
          {
            role: "system",
            content: "You are a RenderDoc debugging specialist. Return compact JSON only with keys summary, evidence, next_step, confidence. Keep summary to at most two sentences, evidence to at most three short strings, and confidence between 0 and 1. Do not include markdown fences or extra commentary."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  `Agent: ${agentId}`,
                  `Goal: ${context2.debugPlan.userGoal}`,
                  `Evidence anchors: ${evidence.join(" | ") || "N/A"}`,
                  `Successful tools: ${successfulTools.map((payload) => payload.toolName).join(", ") || "none"}`,
                  `Failed tools: ${failedTools.map((payload) => `${payload.toolName}: ${payload.error || "failed"}`).join(" | ") || "none"}`,
                  `Condensed tool payloads JSON: ${JSON.stringify(condensedPayloads)}`
                ].join("\n")
              }
            ]
          }
        ],
        maxTokens: 220,
        temperature: 0.1,
        parse: (text) => debuggerLlmService.parseJson(text),
        testValue: deterministicSummary,
        auditSummary: (payload) => payload.summary
      });
      llmSummary = structuredResult.data;
    } catch {
      try {
        const fallbackResult = await debuggerLlmService.call({
          agentId,
          stage: "dispatch",
          sessionId: context2.sessionId,
          runId: context2.runId
        }, {
          messages: [
            {
              role: "system",
              content: "You are a RenderDoc debugging specialist. Reply with one or two concise sentences only. Summarize the most important finding from the provided tool evidence and what should be checked next."
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: [
                    `Agent: ${agentId}`,
                    `Goal: ${context2.debugPlan.userGoal}`,
                    `Evidence anchors: ${evidence.join(" | ") || "N/A"}`,
                    `Successful tools: ${successfulTools.map((payload) => payload.toolName).join(", ") || "none"}`,
                    `Failed tools: ${failedTools.map((payload) => `${payload.toolName}: ${payload.error || "failed"}`).join(" | ") || "none"}`
                  ].join("\n")
                }
              ]
            }
          ],
          maxTokens: 160,
          temperature: 0.1
        });
        const fallbackSummary = fallbackResult.text.trim();
        llmSummary = fallbackSummary ? {
          summary: fallbackSummary,
          evidence,
          next_step: this.getNextStep(agentId),
          confidence: deterministicSummary.confidence
        } : deterministicSummary;
      } catch {
        llmSummary = deterministicSummary;
      }
    }
    const reasoningSummary = {
      summaryId: `${agentId}-${Date.now()}`,
      stage: "dispatch",
      agentId,
      summary: llmSummary.summary,
      evidence: toStringArray$1(llmSummary.evidence).length > 0 ? toStringArray$1(llmSummary.evidence) : evidence,
      nextStep: llmSummary.next_step || this.getNextStep(agentId),
      confidence: toNumber(llmSummary.confidence, deterministicSummary.confidence),
      createdAt: nowIso$1()
    };
    return {
      agentId,
      brief: reasoningSummary.summary,
      reasoningSummary,
      artifacts: [artifactPath, ...extraArtifacts],
      evidenceRefs: reasoningSummary.evidence,
      payloads
    };
  }
  getNextStep(agentId) {
    if (agentId === "triage_agent") {
      return "Use triage evidence to decide which pipeline, pixel, and shader investigations should continue.";
    }
    if (agentId === "pixel_forensics_agent") {
      return "Correlate the suspicious pixel evidence with pipeline and shader state.";
    }
    if (agentId === "shader_ir_agent") {
      return "Validate whether shader logic matches the visual artifact and proposed fix.";
    }
    return "Feed this specialist evidence into the orchestrator investigation summary.";
  }
}
const specialistRecipeRunner = new SpecialistRecipeRunner();
class DeterministicSpecialistExecutor {
  prepareSurface(context2) {
    return specialistRecipeRunner.prepareSurface(context2);
  }
  run(specialist, context2, surface) {
    return specialistRecipeRunner.run(specialist, context2, surface);
  }
}
const deterministicSpecialistExecutor = new DeterministicSpecialistExecutor();
const escapeHtml = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
class ReportBundleService {
  publish(input) {
    const reportsDir = path.join(
      input.projectRoot,
      "sessions",
      input.sessionId,
      "runs",
      input.runId,
      "reports"
    );
    fs.mkdirSync(reportsDir, { recursive: true });
    const markdownPath = path.join(reportsDir, "report.md");
    const jsonPath = path.join(reportsDir, "report.json");
    const htmlPath = path.join(reportsDir, "visual_report.html");
    const payload = {
      sessionId: input.sessionId,
      runId: input.runId,
      goal: input.goal,
      eventCount: input.eventCount ?? 0,
      artifactPaths: input.artifactPaths ?? [],
      evidenceSummary: input.evidenceSummary ?? input.report.evidenceSummary,
      verificationSummary: input.verificationSummary ?? [],
      llmExecution: input.llmExecution ?? null,
      report: input.report
    };
    fs.writeFileSync(markdownPath, this.buildMarkdown(payload), "utf8");
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
    fs.writeFileSync(htmlPath, this.buildHtml(payload), "utf8");
    return {
      reportsDir,
      markdownPath,
      jsonPath,
      htmlPath
    };
  }
  buildMarkdown(payload) {
    const lines = [
      `# ${payload.report.title}`,
      "",
      "## Task Goal",
      payload.goal || "N/A",
      "",
      "## Summary",
      payload.report.summary || "N/A",
      "",
      "## Root Cause",
      payload.report.rootCause || "N/A",
      "",
      "## Fix Verification",
      payload.report.fixDescription || "N/A",
      "",
      "## Evidence Summary",
      ...payload.evidenceSummary.length > 0 ? payload.evidenceSummary.map((item) => `- ${item}`) : ["- N/A"],
      "",
      "## Verification Notes",
      ...payload.verificationSummary.length > 0 ? payload.verificationSummary.map((item) => `- ${item}`) : ["- N/A"],
      "",
      "## LLM Execution",
      ...payload.llmExecution ? [
        `- Provider ID: ${payload.llmExecution.providerId}`,
        `- Model ID: ${payload.llmExecution.modelId}`,
        `- Successful Calls: ${payload.llmExecution.successfulCallCount}`,
        `- Failed Calls: ${payload.llmExecution.failedCallCount}`,
        `- First Request ID: ${payload.llmExecution.firstRequestId || "N/A"}`,
        `- Token Usage: input=${payload.llmExecution.totalInputTokens}, output=${payload.llmExecution.totalOutputTokens}`
      ] : ["- N/A"],
      "",
      "## Recommendations",
      ...payload.report.recommendations.length > 0 ? payload.report.recommendations.map((item) => `- ${item}`) : ["- N/A"],
      "",
      "## Run Metadata",
      `- Session ID: ${payload.sessionId}`,
      `- Run ID: ${payload.runId}`,
      `- Event Count: ${payload.eventCount}`,
      `- Confidence: ${payload.report.confidence}`,
      "",
      "## Related Artifacts",
      ...payload.artifactPaths.length > 0 ? payload.artifactPaths.map((item) => `- ${item}`) : ["- N/A"],
      ""
    ];
    return lines.join("\n");
  }
  buildHtml(payload) {
    const evidenceItems = (payload.evidenceSummary.length > 0 ? payload.evidenceSummary : ["N/A"]).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    const verificationItems = (payload.verificationSummary.length > 0 ? payload.verificationSummary : ["N/A"]).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    const recommendationItems = (payload.report.recommendations.length > 0 ? payload.report.recommendations : ["N/A"]).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    const artifactItems = (payload.artifactPaths.length > 0 ? payload.artifactPaths : ["N/A"]).map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join("");
    const llmItems = payload.llmExecution ? [
      `<li>Provider ID: <code>${escapeHtml(payload.llmExecution.providerId)}</code></li>`,
      `<li>Model ID: <code>${escapeHtml(payload.llmExecution.modelId)}</code></li>`,
      `<li>Successful Calls: ${payload.llmExecution.successfulCallCount}</li>`,
      `<li>Failed Calls: ${payload.llmExecution.failedCallCount}</li>`,
      `<li>First Request ID: <code>${escapeHtml(payload.llmExecution.firstRequestId || "N/A")}</code></li>`,
      `<li>Token Usage: input=${payload.llmExecution.totalInputTokens}, output=${payload.llmExecution.totalOutputTokens}</li>`
    ].join("") : "<li>N/A</li>";
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(payload.report.title)}</title>
  <style>
    :root {
      --bg: #0d1117;
      --panel: #161b22;
      --muted: #8b949e;
      --text: #e6edf3;
      --accent: #4cc2ff;
      --border: #30363d;
      --success: #3fb950;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "PingFang SC", sans-serif;
      background: radial-gradient(circle at top, #162234, var(--bg) 55%);
      color: var(--text);
    }
    .page {
      max-width: 1120px;
      margin: 0 auto;
      padding: 32px 24px 48px;
    }
    .hero, .section {
      background: color-mix(in srgb, var(--panel) 92%, black);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 20px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
    }
    .eyebrow {
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: 12px;
      margin-bottom: 8px;
    }
    h1, h2 { margin: 0 0 12px; }
    p { line-height: 1.6; color: var(--text); }
    .meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }
    .meta-item {
      background: rgba(255,255,255,0.02);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px;
    }
    .meta-item .label {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 6px;
    }
    .meta-item .value {
      color: var(--text);
      font-weight: 600;
      word-break: break-word;
    }
    ul { margin: 0; padding-left: 20px; }
    li { margin: 8px 0; color: var(--text); }
    .confidence {
      color: var(--success);
      font-weight: 700;
    }
    code {
      font-family: "JetBrains Mono", Consolas, monospace;
      color: #9cdcfe;
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <div class="eyebrow">RDC Agent Report</div>
      <h1>${escapeHtml(payload.report.title)}</h1>
      <p>${escapeHtml(payload.report.summary || "N/A")}</p>
      <div class="meta">
        <div class="meta-item"><div class="label">Session</div><div class="value">${escapeHtml(payload.sessionId)}</div></div>
        <div class="meta-item"><div class="label">Run</div><div class="value">${escapeHtml(payload.runId)}</div></div>
        <div class="meta-item"><div class="label">Events</div><div class="value">${payload.eventCount}</div></div>
        <div class="meta-item"><div class="label">Confidence</div><div class="value confidence">${escapeHtml(String(payload.report.confidence))}</div></div>
      </div>
    </section>
    <section class="section">
      <div class="eyebrow">Task Goal</div>
      <p>${escapeHtml(payload.goal || "N/A")}</p>
    </section>
    <section class="section">
      <div class="eyebrow">Root Cause</div>
      <p>${escapeHtml(payload.report.rootCause || "N/A")}</p>
    </section>
    <section class="section">
      <div class="eyebrow">Fix Verification</div>
      <p>${escapeHtml(payload.report.fixDescription || "N/A")}</p>
    </section>
    <section class="section">
      <div class="eyebrow">Evidence Summary</div>
      <ul>${evidenceItems}</ul>
    </section>
    <section class="section">
      <div class="eyebrow">Verification Notes</div>
      <ul>${verificationItems}</ul>
    </section>
    <section class="section">
      <div class="eyebrow">LLM Execution</div>
      <ul>${llmItems}</ul>
    </section>
    <section class="section">
      <div class="eyebrow">Recommendations</div>
      <ul>${recommendationItems}</ul>
    </section>
    <section class="section">
      <div class="eyebrow">Artifacts</div>
      <ul>${artifactItems}</ul>
    </section>
  </main>
</body>
</html>`;
  }
}
const reportBundleService = new ReportBundleService();
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
const mapTaskStatus = (status) => {
  if (status === "in_progress") return "running";
  if (status === "rejected") return "failed";
  return status;
};
class MultiAgentWorkflowEngine {
  constructor(listTasksForRun = () => []) {
    this.listTasksForRun = listTasksForRun;
  }
  listTasksForRun;
  createDebuggerGraph(input) {
    return {
      id: `debugger-serial-${input.runId}`,
      runId: input.runId,
      mode: "debugger",
      execution: "serial",
      status: this.resolveGraphStatus(input.tasks),
      tasks: input.tasks.map((task) => ({
        id: task.taskId,
        title: task.title,
        status: mapTaskStatus(task.status),
        ownerAgentId: task.owner === "harness" ? "rdc-debugger" : task.owner,
        stage: task.stage,
        dependsOn: task.dependsOn
      }))
    };
  }
  readDebuggerGraph(sessionId, runId) {
    return this.createDebuggerGraph({
      runId,
      sessionId,
      tasks: this.listTasksForRun(sessionId, runId)
    });
  }
  assertSerialExecution(graph) {
    if (graph.execution !== "serial") {
      throw new Error(`Debugger workflow must be serial: ${graph.id}`);
    }
    const runningTasks = graph.tasks.filter((task) => task.status === "running");
    if (runningTasks.length > 1) {
      throw new Error(`Debugger workflow has concurrent running tasks: ${runningTasks.map((task) => task.id).join(", ")}`);
    }
  }
  resolveGraphStatus(tasks) {
    if (tasks.some((task) => task.status === "in_progress")) return "running";
    if (tasks.some((task) => task.status === "rejected")) return "failed";
    if (tasks.some((task) => task.status === "cancelled")) return "cancelled";
    if (tasks.length > 0 && tasks.every((task) => task.status === "completed")) return "completed";
    return "pending";
  }
}
const multiAgentWorkflowEngine = new MultiAgentWorkflowEngine(
  taskBoard.listTasks.bind(taskBoard)
);
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
    if (state2.userRequests.some((request2) => request2.revisions.some((revision2) => revision2.resultingTraceLaneIds.includes(input.traceLaneId)))) {
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
    const request = {
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
      userRequests: [...state2.userRequests, request],
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
      userRequests: rootRequest ? state2.userRequests.map((request) => request.id === rootRequest.id ? nextRequest : request) : [...state2.userRequests, nextRequest],
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
  emitPlan(runId, debugPlan) {
    const node = {
      id: `plan-${debugPlan.planId}`,
      runId,
      kind: "plan",
      title: debugPlan.presentation?.title || "Debugger Plan",
      steps: (debugPlan.presentation?.sections ?? []).map((section, index) => ({
        id: section.id || `step-${index}`,
        title: section.title,
        description: section.body.join("\n"),
        status: "pending"
      })),
      seq: 0,
      createdAt: debugPlan.createdAt,
      visibility: "user",
      status: "succeeded"
    };
    if (node.steps.length === 0) {
      node.steps = [
        { id: "goal", title: "目标", description: debugPlan.userGoal, status: "pending" },
        { id: "scope", title: "执行路线", description: debugPlan.scope, status: "pending" }
      ];
    }
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
const debuggerAgentProfile = {
  agentType: "debugger",
  displayName: "Debugger Agent",
  description: "RenderDoc capture debugging agent",
  version: "1.0.0",
  phases: [
    { phaseId: "understand", displayName: "理解任务" },
    { phaseId: "plan", displayName: "制定计划" },
    { phaseId: "search", displayName: "搜索定位" },
    { phaseId: "inspect", displayName: "检查分析" },
    { phaseId: "modify", displayName: "修改验证" },
    { phaseId: "execute", displayName: "执行工具" },
    { phaseId: "verify", displayName: "验证结果" },
    { phaseId: "summarize", displayName: "总结报告" }
  ],
  tools: [],
  ui: {
    defaultLayout: "timeline",
    showPlanByDefault: true,
    showThoughtSummaryByDefault: true,
    showRawToolName: false,
    defaultCollapseLevel: "summary"
  }
};
const askAgentProfile = {
  agentType: "ask",
  displayName: "Ask Agent",
  version: "1.0.0",
  phases: [
    { phaseId: "understand", displayName: "理解问题" },
    { phaseId: "summarize", displayName: "回答总结" }
  ],
  tools: [],
  ui: {
    defaultLayout: "timeline",
    showPlanByDefault: false,
    showThoughtSummaryByDefault: true,
    showRawToolName: false,
    defaultCollapseLevel: "summary"
  }
};
class AgentProfileRegistry {
  profiles = /* @__PURE__ */ new Map([
    ["ask", askAgentProfile],
    ["debugger", debuggerAgentProfile],
    ["analyzer", { ...debuggerAgentProfile, agentType: "analyzer", displayName: "Analyzer Agent" }],
    ["optimizer", { ...debuggerAgentProfile, agentType: "optimizer", displayName: "Optimizer Agent" }]
  ]);
  get(agentType) {
    return this.profiles.get(agentType) ?? debuggerAgentProfile;
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
const mapPlanStatus = (approvalState, run) => {
  if (run.status === "failed" || run.status === "interrupted") return "failed";
  if (run.status === "completed") return "executed";
  if (approvalState === "approved") return "accepted";
  if (approvalState === "pending_user" || run.status === "awaiting_approval") return "awaiting_approval";
  if (approvalState === "rejected") return "needs_revision";
  return "draft";
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
    const catalogCandidates = [
      path.join(process.cwd(), "resources", "tools", "spec", "tool_catalog.json"),
      path.join(electron.app.getAppPath(), "resources", "tools", "spec", "tool_catalog.json")
    ];
    for (const catalogPath of catalogCandidates) {
      if (require("fs").existsSync(catalogPath)) {
        toolManifestRegistry.loadFromCatalog(catalogPath);
        break;
      }
    }
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
    let latestApproval = null;
    let mode = "ask";
    for (const run of runs) {
      const snapshot = storageAdapter.readPlanSnapshot(sessionId, run.runId);
      const runEvents = events.filter((e) => e.run_id === run.runId).sort((a, b) => a.ts_ms - b.ts_ms);
      const planStatus = mapPlanStatus(snapshot?.approval_state, run);
      const branchId = state2.activeBranchId || "branch-main";
      const agentType = run.mode ?? "debugger";
      mode = agentType;
      const profile = agentProfileRegistry.getForMode(agentType);
      const userPrompt = this.userPromptForRun(conversations, run.runId) || snapshot?.debug_plan?.userGoal || runEvents.find((e) => e.event_type === "user_message")?.payload?.content || "调试任务";
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
      if (snapshot?.debug_plan && !existingRunEvents.some((e) => e.payload?.kind === "plan")) {
        completePhase("understand");
        startPhase("plan");
        this.emitter.emitPlan(runId, snapshot.debug_plan);
        completePhase("plan");
      }
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
      const tracePlanId = `ws-${runId}-plan`;
      const traceExecutionId = `ws-${runId}-execution`;
      progress.push(...this.mapProgress(sessionId, runId, branchId, traceExecutionId));
      artifacts.push(...this.mapArtifacts(sessionId, runId, branchId, traceExecutionId, runEvents));
      context2.push(...this.mapContext(sessionId, runId, branchId, traceExecutionId, run));
      if (planStatus === "awaiting_approval" && snapshot?.debug_plan) {
        latestApproval = {
          planId: snapshot.debug_plan.planId,
          runId,
          traceLaneId: tracePlanId,
          status: "awaiting_approval",
          title: snapshot.debug_plan.presentation?.title || "Debugger Plan",
          summary: snapshot.debug_plan.userGoal,
          canApprove: true,
          canRequestRevision: true
        };
      }
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
      approval: latestApproval,
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
const KNOWN_AGENT_ROLES = /* @__PURE__ */ new Set([
  "rdc-debugger",
  "triage_agent",
  "capture_repro_agent",
  "pass_graph_pipeline_agent",
  "pixel_forensics_agent",
  "shader_ir_agent",
  "driver_device_agent",
  "skeptic_agent",
  "curator_agent"
]);
function latestStageHistory(events) {
  return events.filter((event) => event.event_type === "workflow_stage_transition").map((event) => normalizeWorkflowStage(String(event.payload.toStage || "preflight")));
}
function dedupeBlockers(blockers) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const blocker of blockers) {
    const key = `${blocker.code}:${blocker.reason}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(blocker);
  }
  return result;
}
function toStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}
function toConfidence(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}
function toRecommendedSpecialists(value, fallback) {
  const parsed = toStringArray(value).filter((entry) => KNOWN_AGENT_ROLES.has(entry));
  return parsed.length > 0 ? Array.from(new Set(parsed)) : fallback;
}
const ASK_USER_TOOL_NAME = "ui.ask_user_question";
const buildAskUserQuestionTraceQuestions = (prompt) => prompt.questions.map((question) => ({
  questionId: question.id,
  prompt: question.prompt,
  recommendedOptionId: question.recommendedOptionId,
  options: question.options.map((option) => ({
    optionId: option.id,
    label: option.label,
    description: option.description
  })),
  freeformPlaceholder: question.freeformPlaceholder
}));
const buildAskUserAnswerSummary = (prompt, answers) => {
  if (!prompt) {
    return `已回答 ${answers.length} 个问题。`;
  }
  const lines = answers.map((answer) => {
    const question = prompt.questions.find((entry) => entry.id === answer.questionId);
    const option = question?.options.find((entry) => entry.id === answer.selectedOptionId);
    const value = answer.freeformText?.trim() || option?.label || answer.selectedOptionId || "未选择";
    return question ? `${question.prompt} -> ${value}` : `${answer.questionId} -> ${value}`;
  });
  return lines.length > 0 ? `已回答 ${lines.length} 个问题：
${lines.join("\n")}` : "用户未提供回答。";
};
class DebugWorkflowService {
  async startPlan(request) {
    try {
      const resolved = intakeContextResolver.resolve(request);
      const caseId = request.sessionId || await storageAdapter.createCase({
        caseId: request.sessionId,
        projectId: request.projectId,
        userGoal: resolved.goalText,
        symptomSummary: resolved.goalText
      });
      const { runId, sessionId } = await storageAdapter.createRun({
        caseId,
        turnId: request.turnId,
        capturePaths: resolved.captures.map((capture) => capture.filePath),
        mode: request.mode,
        goal: resolved.goalText,
        captures: resolved.captures,
        backend: resolved.backend,
        status: "planning"
      });
      debuggerLlmService.resetRunSummary(runId);
      const basePlan = planBuilder.build(resolved);
      let debugPlan = basePlan.debugPlan;
      let pendingQuestions = basePlan.pendingQuestions;
      const blockers = [...basePlan.blockers];
      if (blockers.length === 0) {
        blockers.push(...debuggerLlmService.getRouteBlockers(
          this.getRequiredRouteAgents(debugPlan, resolved.backend),
          "plan"
        ));
      }
      if (blockers.length === 0) {
        try {
          debugPlan = await this.generatePlanWithLlm({
            sessionId,
            runId,
            resolvedGoal: resolved.goalText,
            basePlan: debugPlan
          });
          blockers.push(...debuggerLlmService.getRouteBlockers(
            this.getRequiredRouteAgents(debugPlan, resolved.backend),
            "plan"
          ));
        } catch (error) {
          blockers.push(this.normalizeLlmBlocker(error, BLOCKER_CODES.BLOCKED_LLM_REQUEST_FAILED.code));
        }
      }
      debugPlan = {
        ...debugPlan,
        blockers: dedupeBlockers([...debugPlan.blockers, ...blockers]),
        strictReady: Boolean(debugPlan.targetCapture) && dedupeBlockers([...debugPlan.blockers, ...blockers]).length === 0 && !pendingQuestions,
        planReadiness: blockers.length > 0 ? "blocked" : pendingQuestions ? "needs_user_input" : "strict_ready",
        updatedAt: nowIso$1()
      };
      const approvalState = debugPlan.strictReady ? "pending_user" : "not_requested";
      storageAdapter.writePlanSnapshot(sessionId, runId, {
        debug_plan: debugPlan,
        pending_questions: pendingQuestions,
        approval_state: approvalState,
        intake_context: resolved.intakeContext
      });
      this.seedHarnessPlan({
        sessionId,
        runId,
        mode: request.mode,
        captures: resolved.captures,
        debugPlan,
        pendingQuestions
      });
      await storageAdapter.updateRun(sessionId, runId, {
        status: blockers.length > 0 ? "failed" : pendingQuestions ? "awaiting_input" : "awaiting_approval",
        lastStage: blockers.length > 0 ? "plan" : pendingQuestions ? "awaiting_user_input" : "plan",
        runtime: {
          workflow_stage: blockers.length > 0 ? "plan" : pendingQuestions ? "awaiting_user_input" : "plan"
        }
      });
      await this.appendActionEvent(sessionId, storageAdapter.createActionEvent({
        runId,
        sessionId,
        agentId: "rdc-debugger",
        eventType: "user_message",
        status: "ok",
        payload: {
          role: "user",
          content: resolved.goalText,
          source: resolved.taskFilePath ? "task_file" : "prompt"
        }
      }));
      for (const [fromStage, toStage] of [
        ["preflight", "entry_gate"],
        ["entry_gate", "intake_gate"],
        ["intake_gate", "plan"]
      ]) {
        await this.appendActionEvent(sessionId, storageAdapter.createActionEvent({
          runId,
          sessionId,
          agentId: "rdc-debugger",
          eventType: "workflow_stage_transition",
          status: "ok",
          payload: {
            fromStage,
            toStage
          }
        }));
      }
      if (pendingQuestions) {
        await this.appendActionEvent(sessionId, storageAdapter.createActionEvent({
          runId,
          sessionId,
          agentId: "rdc-debugger",
          eventType: "tool_execution",
          status: "sent",
          payload: {
            tool_name: ASK_USER_TOOL_NAME,
            phase: "request",
            prompt_id: pendingQuestions.promptId,
            title: pendingQuestions.title,
            summary: pendingQuestions.summary,
            question_count: pendingQuestions.questions.length,
            questions: buildAskUserQuestionTraceQuestions(pendingQuestions)
          }
        }));
        await this.appendActionEvent(sessionId, storageAdapter.createActionEvent({
          runId,
          sessionId,
          agentId: "rdc-debugger",
          eventType: "blocker",
          status: "blocked",
          payload: {
            code: "ASK_USER_REQUIRED",
            reason: "Plan requires structured user answers before execution can start.",
            prompt_id: pendingQuestions.promptId
          }
        }));
      }
      for (const blocker of blockers) {
        await this.appendActionEvent(sessionId, storageAdapter.createActionEvent({
          runId,
          sessionId,
          agentId: "rdc-debugger",
          eventType: "blocker",
          status: "blocked",
          payload: {
            code: blocker.code,
            reason: blocker.reason,
            refs: blocker.refs
          }
        }));
      }
      this.emitWorkflowState(await this.getWorkflowState(sessionId, runId));
      return {
        success: true,
        runId,
        sessionId,
        caseId,
        currentStage: blockers.length > 0 ? "plan" : pendingQuestions ? "awaiting_user_input" : "plan",
        status: blockers.length > 0 ? "failed" : pendingQuestions ? "awaiting_input" : "awaiting_approval",
        planStatus: debugPlan.planReadiness,
        pendingQuestions,
        debugPlanSummary: debugPlan
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  async getPlan(runId) {
    const location = this.findRun(runId);
    if (!location) {
      return { success: false, error: `Run not found: ${runId}` };
    }
    const snapshot = storageAdapter.readPlanSnapshot(location.session.sessionId, runId);
    return {
      success: true,
      runId,
      sessionId: location.session.sessionId,
      debugPlan: snapshot?.debug_plan ?? null,
      pendingQuestions: snapshot?.pending_questions ?? null,
      approvalState: snapshot?.approval_state ?? "not_requested"
    };
  }
  async submitQuestions(runId, answers) {
    const location = this.findRun(runId);
    if (!location) {
      return { success: false, error: `Run not found: ${runId}` };
    }
    const snapshot = storageAdapter.readPlanSnapshot(location.session.sessionId, runId);
    if (!snapshot?.debug_plan) {
      return { success: false, error: "No plan snapshot available." };
    }
    const pendingQuestionsBeforeSubmit = snapshot.pending_questions;
    const nextPlan = {
      ...snapshot.debug_plan,
      updatedAt: nowIso$1(),
      blockers: snapshot.debug_plan.blockers.filter((blocker) => blocker.code !== "ASK_USER_REQUIRED")
    };
    for (const answer of answers) {
      if (answer.questionId !== "target_capture") {
        continue;
      }
      const projectInputs = storageAdapter.listProjectInputs(location.session.projectId);
      const matchedInput = projectInputs.find((input) => input.inputId === answer.selectedOptionId || input.fileName === answer.freeformText?.trim());
      if (matchedInput) {
        nextPlan.targetCapture = {
          captureId: matchedInput.inputId,
          fileName: matchedInput.fileName,
          filePath: matchedInput.filePath
        };
        nextPlan.missingInfo = nextPlan.missingInfo.filter((item) => item !== "target_capture");
      }
    }
    nextPlan.blockers = dedupeBlockers([
      ...nextPlan.blockers,
      ...debuggerLlmService.getRouteBlockers(
        this.getRequiredRouteAgents(nextPlan, location.run.backend),
        "plan"
      )
    ]);
    nextPlan.strictReady = Boolean(nextPlan.targetCapture) && nextPlan.blockers.length === 0;
    nextPlan.planReadiness = nextPlan.blockers.length > 0 ? "blocked" : nextPlan.strictReady ? "strict_ready" : "needs_user_input";
    nextPlan.presentation = buildDebugPlanPresentation(nextPlan);
    const previousBlockerKeys = new Set(snapshot.debug_plan.blockers.map((blocker) => `${blocker.code}:${blocker.reason}`));
    const newBlockers = nextPlan.blockers.filter((blocker) => !previousBlockerKeys.has(`${blocker.code}:${blocker.reason}`));
    const nextStatus = nextPlan.blockers.length > 0 ? "failed" : nextPlan.strictReady ? "awaiting_approval" : "awaiting_input";
    const nextStage = nextPlan.blockers.length > 0 || nextPlan.strictReady ? "plan" : "awaiting_user_input";
    storageAdapter.writePlanSnapshot(location.session.sessionId, runId, {
      ...snapshot,
      debug_plan: nextPlan,
      pending_questions: nextPlan.strictReady || nextPlan.blockers.length > 0 ? null : snapshot.pending_questions,
      approval_state: nextPlan.blockers.length > 0 ? "not_requested" : nextPlan.strictReady ? "pending_user" : snapshot.approval_state
    });
    await storageAdapter.updateRun(location.session.sessionId, runId, {
      status: nextStatus,
      lastStage: nextStage,
      runtime: {
        workflow_stage: nextStage
      }
    });
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId,
      sessionId: location.session.sessionId,
      agentId: "rdc-debugger",
      eventType: "user_message",
      status: "ok",
      payload: {
        role: "user",
        content: JSON.stringify(answers),
        source: "ask_user_answers"
      }
    }));
    if (pendingQuestionsBeforeSubmit) {
      await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
        runId,
        sessionId: location.session.sessionId,
        agentId: "rdc-debugger",
        eventType: "tool_execution",
        status: "completed",
        payload: {
          tool_name: ASK_USER_TOOL_NAME,
          phase: "answer",
          prompt_id: pendingQuestionsBeforeSubmit.promptId,
          title: pendingQuestionsBeforeSubmit.title,
          summary: pendingQuestionsBeforeSubmit.summary,
          question_count: pendingQuestionsBeforeSubmit.questions.length,
          questions: buildAskUserQuestionTraceQuestions(pendingQuestionsBeforeSubmit),
          answers,
          answerSummary: buildAskUserAnswerSummary(pendingQuestionsBeforeSubmit, answers)
        }
      }));
    }
    for (const blocker of newBlockers) {
      await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
        runId,
        sessionId: location.session.sessionId,
        agentId: "rdc-debugger",
        eventType: "blocker",
        status: "blocked",
        payload: {
          code: blocker.code,
          reason: blocker.reason,
          refs: blocker.refs
        }
      }));
    }
    this.emitRunStatus(location.session.sessionId, runId, nextStatus, nextStage);
    this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, runId));
    await this.appendAssistantConversationMessage(
      location.session.sessionId,
      runId,
      nextPlan.strictReady ? "收到，执行前置条件已经补齐。你现在可以批准这份计划，我再进入正式调试。" : nextPlan.blockers.length > 0 ? nextPlan.blockers[0]?.reason || "当前还不能进入正式调试。" : "收到，我已经更新了计划输入，不过还需要你继续补全剩余信息。"
    );
    return {
      success: true,
      runId,
      sessionId: location.session.sessionId,
      debugPlan: nextPlan,
      pendingQuestions: nextPlan.strictReady || nextPlan.blockers.length > 0 ? null : snapshot.pending_questions,
      approvalState: nextPlan.blockers.length > 0 ? "not_requested" : nextPlan.strictReady ? "pending_user" : snapshot.approval_state
    };
  }
  async approvePlan(runId) {
    const location = this.findRun(runId);
    if (!location) {
      return { success: false, error: `Run not found: ${runId}` };
    }
    const snapshot = storageAdapter.readPlanSnapshot(location.session.sessionId, runId);
    if (!snapshot?.debug_plan) {
      return { success: false, error: "No plan snapshot available." };
    }
    if (!snapshot.debug_plan.strictReady) {
      return { success: false, error: "Plan is not strict ready." };
    }
    const routeBlockers = debuggerLlmService.getRouteBlockers(
      this.getRequiredRouteAgents(snapshot.debug_plan, location.run.backend),
      "dispatch"
    );
    if (routeBlockers.length > 0) {
      const blockedPlan = {
        ...snapshot.debug_plan,
        blockers: dedupeBlockers([...snapshot.debug_plan.blockers, ...routeBlockers]),
        strictReady: false,
        planReadiness: "blocked",
        updatedAt: nowIso$1()
      };
      storageAdapter.writePlanSnapshot(location.session.sessionId, runId, {
        ...snapshot,
        debug_plan: blockedPlan,
        approval_state: "not_requested"
      });
      for (const blocker of routeBlockers) {
        await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
          runId,
          sessionId: location.session.sessionId,
          agentId: "rdc-debugger",
          eventType: "blocker",
          status: "blocked",
          payload: {
            code: blocker.code,
            reason: blocker.reason,
            refs: blocker.refs
          }
        }));
      }
      await storageAdapter.updateRun(location.session.sessionId, runId, {
        status: "failed",
        lastStage: "plan",
        runtime: {
          workflow_stage: "plan"
        }
      });
      this.emitRunStatus(location.session.sessionId, runId, "failed", "plan");
      this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, runId));
      return {
        success: false,
        error: routeBlockers.map((blocker) => blocker.reason).join(" | "),
        debugPlan: blockedPlan,
        approvalState: "not_requested"
      };
    }
    storageAdapter.writePlanSnapshot(location.session.sessionId, runId, {
      ...snapshot,
      approval_state: "approved",
      pending_questions: null
    });
    traceStateStore.markPlan(location.session.sessionId, snapshot.debug_plan.planId, "accepted");
    this.applyTaskMutation(location.session.sessionId, runId, "plan", "completed", "User approved the Debugger plan.");
    this.applyTaskMutation(location.session.sessionId, runId, "speclist", "in_progress", "Task breakdown started after plan approval.");
    contextService.writeRunCapsule(location.session.sessionId, runId);
    await this.appendUserConversationMessage(
      location.session.sessionId,
      runId,
      "同意执行"
    );
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId,
      sessionId: location.session.sessionId,
      agentId: "user",
      eventType: "user_confirmation",
      status: "ok",
      payload: {
        planId: snapshot.debug_plan.planId,
        label: "同意执行"
      }
    }));
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId,
      sessionId: location.session.sessionId,
      agentId: "rdc-debugger",
      eventType: "workflow_stage_transition",
      status: "ok",
      payload: {
        fromStage: "plan",
        toStage: "dispatch"
      }
    }));
    await storageAdapter.updateRun(location.session.sessionId, runId, {
      status: "running",
      lastStage: "dispatch",
      runtime: {
        workflow_stage: "dispatch"
      }
    });
    this.emitRunStatus(location.session.sessionId, runId, "running", "dispatch");
    this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, runId));
    await this.appendAssistantConversationMessage(
      location.session.sessionId,
      runId,
      "计划已批准，我现在开始正式调试，并按证据链推进后续分析。"
    );
    runExecutionService.startRun({
      runId,
      sessionId: location.session.sessionId,
      projectId: location.run.projectId
    }, (signal) => this.executeApprovedRun(location, snapshot.debug_plan, signal));
    return {
      success: true,
      runId,
      sessionId: location.session.sessionId,
      debugPlan: snapshot.debug_plan,
      pendingQuestions: null,
      approvalState: "approved"
    };
  }
  async getTraceProjection(sessionId) {
    return traceService.getSession(sessionId);
  }
  async requestPlanRevision(runId, revisionText) {
    const location = this.findRun(runId);
    if (!location) {
      return { success: false, error: `Run not found: ${runId}` };
    }
    const trimmedRevision = revisionText.trim();
    if (!trimmedRevision) {
      return { success: false, error: "Revision text is required." };
    }
    const snapshot = storageAdapter.readPlanSnapshot(location.session.sessionId, runId);
    if (!snapshot?.debug_plan) {
      return { success: false, error: "No plan snapshot available." };
    }
    const previousPlanId = snapshot.debug_plan.planId;
    const { runId: nextRunId, sessionId } = await storageAdapter.createRun({
      caseId: location.session.sessionId,
      turnId: location.run.turnId,
      capturePaths: location.run.captures.map((capture) => capture.filePath),
      mode: location.run.mode,
      goal: `${location.run.goal}

修改建议：${trimmedRevision}`,
      captures: location.run.captures,
      backend: location.run.backend,
      status: "awaiting_approval"
    });
    const nextPlan = {
      ...snapshot.debug_plan,
      planId: generateEventId("plan"),
      userGoal: `${snapshot.debug_plan.userGoal}

修改建议：${trimmedRevision}`,
      notes: [...snapshot.debug_plan.notes, `用户修改建议：${trimmedRevision}`],
      presentation: buildDebugPlanPresentation({
        ...snapshot.debug_plan,
        userGoal: `${snapshot.debug_plan.userGoal}

修改建议：${trimmedRevision}`,
        notes: [...snapshot.debug_plan.notes, `用户修改建议：${trimmedRevision}`]
      }),
      createdAt: nowIso$1(),
      updatedAt: nowIso$1()
    };
    traceStateStore.createRevision({
      sessionId,
      runId: nextRunId,
      previousPlanId,
      revisionText: trimmedRevision,
      revisionTraceLaneId: `ws-${nextRunId}-plan`
    });
    storageAdapter.writePlanSnapshot(sessionId, nextRunId, {
      ...snapshot,
      debug_plan: nextPlan,
      pending_questions: null,
      approval_state: "pending_user"
    });
    this.seedHarnessPlan({
      sessionId,
      runId: nextRunId,
      mode: location.run.mode,
      captures: location.run.captures,
      debugPlan: nextPlan,
      pendingQuestions: null
    });
    traceStateStore.registerPlan({
      sessionId,
      runId: nextRunId,
      planId: nextPlan.planId,
      traceLaneId: `ws-${nextRunId}-plan`,
      status: "awaiting_approval"
    });
    await storageAdapter.updateRun(location.session.sessionId, runId, {
      status: "interrupted",
      stopReason: "Plan revision requested",
      stoppedAt: Date.now(),
      finishedAt: Date.now()
    });
    await storageAdapter.updateRun(sessionId, nextRunId, {
      status: "awaiting_approval",
      lastStage: "plan",
      runtime: {
        workflow_stage: "plan"
      }
    });
    await this.appendUserConversationMessage(
      location.session.sessionId,
      runId,
      `修改建议：${trimmedRevision}`
    );
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId,
      sessionId: location.session.sessionId,
      agentId: "user",
      eventType: "user_revision_requested",
      status: "ok",
      payload: {
        planId: previousPlanId,
        prompt: trimmedRevision,
        nextRunId,
        nextPlanId: nextPlan.planId
      }
    }));
    await this.appendActionEvent(sessionId, storageAdapter.createActionEvent({
      runId: nextRunId,
      sessionId,
      agentId: "rdc-debugger",
      eventType: "user_message",
      status: "ok",
      payload: {
        role: "user",
        content: trimmedRevision,
        source: "plan_revision",
        previousPlanId
      }
    }));
    await this.appendAssistantConversationMessage(
      sessionId,
      nextRunId,
      "我已根据修改建议生成新的计划，请重新确认后再进入正式执行。"
    );
    this.emitRunStatus(location.session.sessionId, runId, "interrupted", location.run.lastStage, "Plan revision requested");
    this.emitRunStatus(sessionId, nextRunId, "awaiting_approval", "plan");
    this.emitWorkflowState(await this.getWorkflowState(sessionId, nextRunId));
    const traceProjection = await this.getTraceProjection(sessionId);
    return {
      ...traceProjection,
      runId: nextRunId,
      planId: nextPlan.planId,
      branchId: traceProjection.presentation?.activeBranchId
    };
  }
  async switchTraceBranch(sessionId, branchId) {
    traceStateStore.switchBranch(sessionId, branchId);
    const traceProjection = await this.getTraceProjection(sessionId);
    return {
      ...traceProjection,
      activeBranchId: traceProjection.presentation?.activeBranchId
    };
  }
  async exportTraceSession(sessionId, options = {}) {
    try {
      const session = storageAdapter.readSession(sessionId);
      if (!session) {
        return { success: false, error: `Session not found: ${sessionId}` };
      }
      const traceProjection = await this.getTraceProjection(sessionId);
      if (!traceProjection.success) {
        return { success: false, error: traceProjection.error };
      }
      const exportDir = path.join(session.sessionPath, "exports");
      fs__namespace.mkdirSync(exportDir, { recursive: true });
      const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
      const summaryPath = path.join(exportDir, `agentic-trace-summary-${stamp}.json`);
      fs__namespace.writeFileSync(summaryPath, JSON.stringify({
        schemaVersion: "1",
        exportedAt: nowIso$1(),
        includeAllBranches: options.includeAllBranches ?? true,
        presentation: traceProjection.presentation
      }, null, 2), "utf-8");
      let rawTracePath;
      if (options.includeRawTrace !== false) {
        rawTracePath = path.join(exportDir, `agentic-trace-raw-trace-${stamp}.jsonl`);
        const events = await storageAdapter.readActionChain(sessionId);
        fs__namespace.writeFileSync(rawTracePath, `${events.map((event) => JSON.stringify(event)).join("\n")}
`, "utf-8");
      }
      return {
        success: true,
        sessionId,
        summaryPath,
        rawTracePath,
        bundlePath: summaryPath
      };
    } catch (error) {
      return { success: false, sessionId, error: error instanceof Error ? error.message : String(error) };
    }
  }
  async restartRun(runId) {
    const location = this.findRun(runId);
    if (!location) {
      return { success: false, error: `Run not found: ${runId}` };
    }
    const snapshot = storageAdapter.readPlanSnapshot(location.session.sessionId, runId);
    if (!snapshot?.debug_plan?.strictReady) {
      return { success: false, error: "Cannot restart without a strict-ready plan." };
    }
    const { runId: nextRunId, sessionId } = await storageAdapter.createRun({
      caseId: location.session.sessionId,
      capturePaths: location.run.captures.map((capture) => capture.filePath),
      mode: location.run.mode,
      goal: location.run.goal,
      captures: location.run.captures,
      backend: location.run.backend,
      status: "awaiting_approval"
    });
    storageAdapter.writePlanSnapshot(sessionId, nextRunId, {
      ...snapshot,
      approval_state: "pending_user",
      pending_questions: null,
      debug_plan: {
        ...snapshot.debug_plan,
        updatedAt: nowIso$1()
      }
    });
    await storageAdapter.updateRun(location.session.sessionId, runId, {
      status: "interrupted",
      stopReason: "Restarted from stale run",
      stoppedAt: Date.now(),
      finishedAt: Date.now()
    });
    this.emitWorkflowState(await this.getWorkflowState(sessionId, nextRunId));
    await this.appendAssistantConversationMessage(
      sessionId,
      nextRunId,
      "我已经为你重建了一次可继续的调试运行。确认计划后，我会从新的 run 继续推进。"
    );
    return {
      success: true,
      runId: nextRunId,
      sessionId,
      debugPlan: snapshot.debug_plan,
      pendingQuestions: null,
      approvalState: "pending_user"
    };
  }
  async stopRun(runId) {
    const location = this.findRun(runId);
    if (!location) {
      return { success: false, error: `Run not found: ${runId}` };
    }
    const active = runExecutionService.stopRun(runId);
    rdxCliInvokerService.abortRun(runId);
    await rdxSessionService.closeOrReplaceOpenedCapture();
    await storageAdapter.updateRun(location.session.sessionId, runId, {
      status: active && process.env.RDC_AGENT_TEST_MODE !== "1" ? "stopping" : "cancelled",
      stopReason: "Stopped by user",
      stoppedAt: Date.now(),
      finishedAt: active && process.env.RDC_AGENT_TEST_MODE !== "1" ? void 0 : Date.now()
    });
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId,
      sessionId: location.session.sessionId,
      agentId: "rdc-debugger",
      eventType: "blocker",
      status: "warning",
      payload: {
        code: "RUN_STOPPED",
        reason: "Run stopped by user request."
      }
    }));
    this.emitRunStatus(
      location.session.sessionId,
      runId,
      active && process.env.RDC_AGENT_TEST_MODE !== "1" ? "stopping" : "cancelled",
      location.run.lastStage,
      "Stopped by user"
    );
    this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, runId));
    return { success: true };
  }
  async getWorkflowState(sessionId, runId) {
    const run = runId ? storageAdapter.listRuns(sessionId).find((entry) => entry.runId === runId) || null : storageAdapter.getLatestRun(sessionId);
    if (!run) {
      return {
        caseId: sessionId,
        runId: "",
        sessionId,
        currentStage: "preflight",
        previousStages: [],
        entryMode: "cli",
        backend: "local",
        orchestrationMode: "multi_agent",
        coordinationMode: "staged_handoff",
        blockers: [],
        lastUpdated: nowIso$1()
      };
    }
    const events = await storageAdapter.readActionChain(sessionId);
    const runEvents = events.filter((event) => event.run_id === run.runId);
    const snapshot = storageAdapter.readPlanSnapshot(sessionId, run.runId);
    const blockers = runEvents.filter((event) => event.event_type === "blocker").map((event) => ({
      code: String(event.payload.code || "BLOCKER"),
      reason: String(event.payload.reason || event.payload.message || "Blocker"),
      refs: Array.isArray(event.payload.refs) ? event.payload.refs.map(String) : [],
      detectedAt: new Date(event.ts_ms).toISOString()
    }));
    const reasoningSummaries = runEvents.filter((event) => event.event_type === "agent_summary").map((event) => ({
      summaryId: event.event_id,
      stage: normalizeWorkflowStage(String(event.payload.stage || run.lastStage)),
      agentId: String(event.agent_id),
      summary: String(event.payload.summary || event.payload.content || ""),
      evidence: Array.isArray(event.payload.evidence) ? event.payload.evidence.map(String) : [],
      nextStep: String(event.payload.next_step || event.payload.nextStep || ""),
      confidence: typeof event.payload.confidence === "number" ? event.payload.confidence : 0.5,
      createdAt: new Date(event.ts_ms).toISOString()
    }));
    return {
      caseId: run.caseId,
      runId: run.runId,
      sessionId,
      currentStage: normalizeWorkflowStage(run.lastStage),
      previousStages: latestStageHistory(runEvents),
      entryMode: "cli",
      backend: run.backend,
      orchestrationMode: "multi_agent",
      coordinationMode: "staged_handoff",
      blockers,
      planReadiness: snapshot?.debug_plan?.strictReady ? "ready_for_approval" : snapshot?.debug_plan?.planReadiness,
      approvalState: snapshot?.approval_state,
      debugPlan: snapshot?.debug_plan ?? null,
      harnessTasks: taskBoard.listTasks(sessionId, run.runId),
      pendingQuestions: snapshot?.pending_questions ?? null,
      reasoningSummaries,
      recoveryState: run.status === "interrupted" ? {
        recoveredAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : void 0,
        recoveryReason: run.stopReason
      } : null,
      lastUpdated: nowIso$1()
    };
  }
  async recoverInterruptedRuns() {
    const projects = storageAdapter.listProjects();
    for (const project of projects) {
      const sessions = storageAdapter.listSessions(project.projectId);
      for (const session of sessions) {
        const runs = storageAdapter.listRuns(session.sessionId);
        for (const run of runs) {
          if (!["running", "queued", "planning", "stopping"].includes(run.status)) {
            continue;
          }
          if (runExecutionService.listActiveRuns().some((active) => active.runId === run.runId)) {
            continue;
          }
          await storageAdapter.updateRun(session.sessionId, run.runId, {
            status: "interrupted",
            stopReason: "Recovered after app restart",
            stoppedAt: Date.now(),
            finishedAt: Date.now()
          });
          await this.appendActionEvent(session.sessionId, storageAdapter.createActionEvent({
            runId: run.runId,
            sessionId: session.sessionId,
            agentId: "rdc-debugger",
            eventType: "blocker",
            status: "warning",
            payload: {
              code: "STALE_RUN_RECOVERED",
              reason: "Run was marked interrupted during app startup recovery."
            }
          }));
        }
      }
    }
  }
  seedHarnessPlan(input) {
    const now = nowIso$1();
    const tasks = this.createHarnessTasks(input.sessionId, input.runId, input.debugPlan, now);
    for (const task of tasks) {
      taskBoard.upsertTask(input.sessionId, input.runId, task);
    }
    const taskGraph = multiAgentWorkflowEngine.createDebuggerGraph({
      runId: input.runId,
      sessionId: input.sessionId,
      tasks
    });
    multiAgentWorkflowEngine.assertSerialExecution(taskGraph);
    const planContract = {
      schemaVersion: "1",
      planId: input.debugPlan.planId,
      runId: input.runId,
      sessionId: input.sessionId,
      mode: input.mode,
      goal: input.debugPlan.userGoal,
      status: input.pendingQuestions ? "blocked" : input.debugPlan.strictReady ? "ready" : input.debugPlan.blockers.length > 0 ? "blocked" : "pending",
      captures: input.captures ?? [],
      tasks,
      verificationContract: {
        contractId: `${input.debugPlan.planId}-verification`,
        runId: input.runId,
        sessionId: input.sessionId,
        requiredMethods: this.getRequiredVerificationMethods(input.debugPlan),
        targetRefs: [
          input.debugPlan.targetCapture?.captureId,
          input.debugPlan.targetCapture?.filePath,
          input.debugPlan.targetFrameOrEvent?.eventLabel
        ].filter((entry) => Boolean(entry)),
        successCriteria: input.debugPlan.verificationContract.successCriteria,
        evidenceRequirements: [
          input.debugPlan.verificationContract.requiresScreenshotEvidence ? "screenshot" : "",
          input.debugPlan.verificationContract.requiresShaderInspection ? "shader" : "",
          input.debugPlan.verificationContract.requiresPixelEvidence ? "pixel" : "",
          input.debugPlan.verificationContract.requiresBaselineComparison ? "baseline" : ""
        ].filter(Boolean),
        blockerCodes: input.debugPlan.blockers.map((blocker) => blocker.code),
        createdAt: now,
        updatedAt: now
      },
      questionRequests: input.pendingQuestions ? input.pendingQuestions.questions.map((question) => ({
        questionId: question.id,
        runId: input.runId,
        sessionId: input.sessionId,
        prompt: question.prompt,
        reason: input.pendingQuestions.summary,
        options: question.options.map((option) => ({
          optionId: option.id,
          label: option.label,
          description: option.description
        })),
        allowFreeform: Boolean(question.freeformPlaceholder),
        requestedBy: "harness",
        createdAt: input.pendingQuestions.createdAt
      })) : [],
      questionAnswers: [],
      revisions: [],
      capabilityProfiles: [],
      createdAt: now,
      updatedAt: now
    };
    contextService.writePlanContract(input.sessionId, input.runId, planContract);
    contextService.appendContextPacket(input.sessionId, input.runId, {
      packetId: generateEventId("context-packet"),
      runId: input.runId,
      sessionId: input.sessionId,
      kind: "plan",
      source: "harness",
      title: "Debugger plan contract",
      summary: input.debugPlan.scope,
      content: JSON.stringify({
        goal: input.debugPlan.userGoal,
        targetCapture: input.debugPlan.targetCapture,
        targetFrameOrEvent: input.debugPlan.targetFrameOrEvent,
        deliverables: input.debugPlan.expectedDeliverables,
        taskGraph
      }),
      refs: planContract.verificationContract.targetRefs,
      taskIds: tasks.map((task) => task.taskId),
      evidenceIds: [],
      artifactIds: [],
      createdAt: now
    });
    contextService.writeRunCapsule(input.sessionId, input.runId);
    return planContract;
  }
  createHarnessTasks(sessionId, runId, debugPlan, createdAt) {
    const base = {
      runId,
      sessionId,
      priority: "normal",
      dependsOn: [],
      evidenceRefs: [],
      artifactRefs: [],
      blockerRefs: [],
      source: "plan",
      userApproval: "not_required",
      createdAt,
      updatedAt: createdAt
    };
    return [
      {
        ...base,
        taskId: "plan",
        title: "Plan",
        intent: "context",
        objective: debugPlan.scope,
        status: debugPlan.blockers.length > 0 ? "blocked" : "pending",
        owner: "rdc-debugger",
        stage: "plan",
        acceptanceCriteria: ["Target capture, scope, specialists, deliverables, and verification criteria are explicit."]
      },
      {
        ...base,
        taskId: "speclist",
        title: "Task breakdown",
        intent: "hypothesis",
        objective: "Seed the Debugger task board from the approved plan.",
        status: "pending",
        owner: "rdc-debugger",
        stage: "speclist",
        dependsOn: ["plan"],
        acceptanceCriteria: debugPlan.expectedDeliverables
      },
      {
        ...base,
        taskId: "dispatch",
        title: "Specialist dispatch",
        intent: "investigation",
        objective: `Dispatch ${debugPlan.recommendedSpecialists.length || 1} Debugger investigation lane(s).`,
        status: "pending",
        owner: "rdc-debugger",
        stage: "dispatch",
        dependsOn: ["speclist"],
        acceptanceCriteria: ["Every selected specialist returns an AgentResultCard with evidence references."]
      },
      {
        ...base,
        taskId: "investigate",
        title: "Evidence investigation",
        intent: "investigation",
        objective: debugPlan.targetFrameOrEvent?.eventLabel ?? debugPlan.scope,
        status: "pending",
        owner: "rdc-debugger",
        stage: "investigate",
        dependsOn: ["dispatch"],
        acceptanceCriteria: ["Investigation summary is grounded in EvidenceLedger records."]
      },
      {
        ...base,
        taskId: "fix_verify",
        title: "Verification",
        intent: "verification",
        objective: "Validate the leading finding against the verification contract.",
        status: "pending",
        owner: "skeptic_agent",
        stage: "fix_verify",
        dependsOn: ["investigate"],
        acceptanceCriteria: debugPlan.verificationContract.successCriteria
      },
      {
        ...base,
        taskId: "curate",
        title: "Curation",
        intent: "report",
        objective: "Publish a report bundle grounded in accepted evidence.",
        status: "pending",
        owner: "curator_agent",
        stage: "curate",
        dependsOn: ["fix_verify"],
        acceptanceCriteria: debugPlan.expectedDeliverables
      }
    ];
  }
  getRequiredVerificationMethods(debugPlan) {
    const methods = /* @__PURE__ */ new Set(["tool", "llm_review"]);
    if (debugPlan.verificationContract.requiresScreenshotEvidence) methods.add("screenshot");
    if (debugPlan.verificationContract.requiresPixelEvidence) methods.add("pixel");
    if (debugPlan.verificationContract.requiresShaderInspection) methods.add("shader");
    if (debugPlan.verificationContract.requiresBaselineComparison) methods.add("baseline");
    return Array.from(methods);
  }
  applyTaskMutation(sessionId, runId, taskId, status, reason, refs = {}) {
    const existing = taskBoard.getTask(sessionId, runId, taskId);
    if (!existing) {
      return;
    }
    taskBoard.mutateTask(sessionId, runId, {
      mutationId: generateEventId("task-mutation"),
      taskId,
      runId,
      sessionId,
      type: status === "completed" ? "update_status" : "update_status",
      actor: "harness",
      patch: {
        status,
        evidenceRefs: refs.evidenceRefs ?? existing.evidenceRefs,
        artifactRefs: refs.artifactRefs ?? existing.artifactRefs,
        blockerRefs: refs.blockerRefs ?? existing.blockerRefs,
        completedAt: status === "completed" ? nowIso$1() : existing.completedAt
      },
      reason,
      requiresUserApproval: false,
      createdAt: nowIso$1()
    });
    multiAgentWorkflowEngine.assertSerialExecution(
      multiAgentWorkflowEngine.readDebuggerGraph(sessionId, runId)
    );
  }
  persistAgentResult(sessionId, runId, result) {
    const artifactIds = result.artifacts.map((artifactPath) => {
      const artifactId = generateEventId("artifact");
      const record = {
        artifactId,
        runId,
        sessionId,
        kind: artifactPath.toLowerCase().endsWith(".png") ? "screenshot" : "data",
        title: `${result.agentId} artifact`,
        filePath: artifactPath,
        mimeType: artifactPath.toLowerCase().endsWith(".png") ? "image/png" : "application/json",
        sizeBytes: 0,
        taskId: "dispatch",
        evidenceIds: [],
        metadata: {
          agentId: result.agentId
        },
        createdAt: nowIso$1(),
        updatedAt: nowIso$1()
      };
      artifactStore.register(sessionId, runId, record);
      return artifactId;
    });
    const evidenceId = generateEventId("evidence");
    const evidenceRecord = {
      evidenceId,
      runId,
      sessionId,
      kind: "analysis",
      title: `${result.agentId} finding`,
      summary: result.reasoningSummary.summary,
      refs: result.reasoningSummary.evidence,
      taskId: "dispatch",
      agentId: result.agentId,
      artifactIds,
      strength: result.reasoningSummary.confidence >= 0.75 ? "strong" : "supporting",
      metadata: {
        nextStep: result.reasoningSummary.nextStep,
        confidence: result.reasoningSummary.confidence
      },
      createdAt: nowIso$1()
    };
    evidenceLedger.appendEvidence(sessionId, runId, evidenceRecord);
    const card = {
      cardId: generateEventId("agent-card"),
      runId,
      sessionId,
      agentId: result.agentId,
      taskId: "dispatch",
      status: "completed",
      summary: result.reasoningSummary.summary,
      evidenceIds: [evidenceId],
      artifactIds,
      verificationResultIds: [],
      nextActions: [result.reasoningSummary.nextStep].filter(Boolean),
      createdAt: nowIso$1(),
      updatedAt: nowIso$1()
    };
    const storedCard = contextService.appendAgentResultCard(sessionId, runId, card);
    contextService.writeRunCapsule(sessionId, runId);
    return storedCard;
  }
  persistVerificationResult(sessionId, runId, debugPlan, verification, skeptic, evidenceIds) {
    const rejected = skeptic.payload.verdict === "rejected";
    const verificationResult = {
      resultId: generateEventId("verification"),
      contractId: `${debugPlan.planId}-verification`,
      runId,
      sessionId,
      status: rejected ? "failed" : verification.status === "ok" ? "passed" : "inconclusive",
      proposedRoute: rejected ? "generator" : "curator",
      method: "llm_review",
      summary: String(skeptic.payload.summary || verification.payload.summary || ""),
      failedCriteria: rejected ? debugPlan.verificationContract.successCriteria : [],
      evidenceGaps: rejected ? ["Verifier rejected the available evidence chain."] : [],
      rejectedClaims: rejected ? [String(verification.payload.summary || "Rejected verification claim")] : [],
      taskMutations: rejected ? [{
        mutationId: generateEventId("task-mutation"),
        taskId: "fix_verify",
        runId,
        sessionId,
        type: "update_status",
        actor: "skeptic_agent",
        patch: {
          status: "blocked",
          blockerRefs: ["SKEPTIC_REJECTED"]
        },
        reason: String(skeptic.payload.summary || "Skeptic rejected the evidence chain."),
        requiresUserApproval: false,
        createdAt: nowIso$1()
      }] : [],
      evidenceIds,
      artifactIds: [],
      blockers: rejected ? ["SKEPTIC_REJECTED"] : [],
      confidence: rejected ? 0.35 : verification.status === "ok" ? 0.82 : 0.64,
      loopCount: 0,
      createdAt: nowIso$1()
    };
    evidenceLedger.appendVerificationResult(sessionId, runId, verificationResult);
    contextService.writeRunCapsule(sessionId, runId);
    return verificationResult;
  }
  async executeApprovedRun(location, debugPlan, signal) {
    const project = storageAdapter.getProjectById(location.run.projectId);
    if (!project || !debugPlan.targetCapture) {
      throw new Error("Project or target capture is missing.");
    }
    if (process.env.RDC_AGENT_TEST_MODE === "1") {
      await this.executeMockRun(location, debugPlan, signal, project.rootPath);
      return;
    }
    const resolved = intakeContextResolver.resolve({
      projectId: location.run.projectId,
      sessionId: location.session.sessionId,
      mode: location.run.mode,
      goal: location.run.goal,
      captures: location.run.captures
    });
    const captures = location.run.captures.length > 0 ? location.run.captures : [{
      id: debugPlan.targetCapture.captureId,
      filePath: debugPlan.targetCapture.filePath,
      role: "primary",
      backendHint: location.run.backend,
      status: "pending"
    }];
    try {
      const routeBlockers = debuggerLlmService.getRouteBlockers(
        this.getRequiredRouteAgents(debugPlan, location.run.backend),
        "dispatch"
      );
      if (routeBlockers.length > 0) {
        throw { blocker: routeBlockers[0] };
      }
      await rdxSessionService.bootstrap({
        projectId: location.run.projectId,
        sessionId: location.session.sessionId,
        mode: location.run.mode,
        goal: location.run.goal,
        captures,
        primaryCaptureId: debugPlan.targetCapture.captureId,
        replayDevice: resolved.replayDevice
      });
      const runtimeContext = {
        runId: location.run.runId,
        turnId: location.run.turnId,
        sessionId: location.session.sessionId,
        caseId: location.run.caseId,
        contextId: rdxSessionService.getContextId() || "",
        runtimeOwner: rdxSessionService.getRuntimeOwner() || "",
        ownerLeaseId: rdxSessionService.getOwnerLeaseId() || "",
        debugPlan,
        targetCapturePath: debugPlan.targetCapture.filePath,
        outputRoot: storageAdapter.getRunPath(location.session.sessionId, location.run.runId),
        signal
      };
      if (!runtimeContext.contextId || !runtimeContext.runtimeOwner || !runtimeContext.ownerLeaseId) {
        throw new Error("Runtime context is incomplete after bootstrap.");
      }
      await storageAdapter.updateRun(location.session.sessionId, location.run.runId, {
        captures: rdxSessionService.getCaptureDescriptors(),
        runtime: {
          context_id: runtimeContext.contextId,
          runtime_owner: runtimeContext.runtimeOwner,
          workflow_stage: "dispatch"
        }
      });
      const surface = await deterministicSpecialistExecutor.prepareSurface(runtimeContext);
      this.applyTaskMutation(location.session.sessionId, location.run.runId, "speclist", "completed", "Task board seeded for the approved plan.");
      this.applyTaskMutation(location.session.sessionId, location.run.runId, "dispatch", "in_progress", "Specialist dispatch started.");
      contextService.appendContextPacket(location.session.sessionId, location.run.runId, {
        packetId: generateEventId("context-packet"),
        runId: location.run.runId,
        sessionId: location.session.sessionId,
        kind: "handoff",
        source: "harness",
        title: "Specialist dispatch context",
        summary: debugPlan.scope,
        content: JSON.stringify({
          targetCapture: debugPlan.targetCapture,
          targetFrameOrEvent: debugPlan.targetFrameOrEvent,
          specialists: debugPlan.recommendedSpecialists
        }),
        refs: [debugPlan.targetCapture.filePath],
        taskIds: ["dispatch"],
        evidenceIds: [],
        artifactIds: [],
        createdAt: nowIso$1()
      });
      const specialistResults = [];
      for (const specialist of debugPlan.recommendedSpecialists) {
        if (signal.aborted) {
          throw new Error(`Run aborted: ${location.run.runId}`);
        }
        await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
          runId: location.run.runId,
          sessionId: location.session.sessionId,
          agentId: "rdc-debugger",
          eventType: "dispatch",
          status: "sent",
          payload: {
            targetAgent: specialist,
            objective: `Investigate ${debugPlan.scope}`
          }
        }));
        const result = await deterministicSpecialistExecutor.run(specialist, runtimeContext, surface);
        specialistResults.push(result);
        this.persistAgentResult(location.session.sessionId, location.run.runId, result);
        await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
          runId: location.run.runId,
          sessionId: location.session.sessionId,
          agentId: specialist,
          eventType: "agent_summary",
          status: "ok",
          payload: {
            stage: "dispatch",
            summary: result.reasoningSummary.summary,
            evidence: result.reasoningSummary.evidence,
            next_step: result.reasoningSummary.nextStep,
            confidence: result.reasoningSummary.confidence,
            artifacts: result.artifacts
          }
        }));
      }
      this.applyTaskMutation(location.session.sessionId, location.run.runId, "dispatch", "completed", "Specialist dispatch completed.");
      await this.persistInvestigationAndReport(location, debugPlan, runtimeContext, surface.replaySessionId, specialistResults);
    } catch (error) {
      const aborted = signal.aborted;
      const blocker = aborted ? {
        code: "RUN_STOPPED",
        reason: "Run stopped by user.",
        refs: [],
        detectedAt: nowIso$1()
      } : this.normalizeLlmBlocker(error, "RUN_FAILED");
      await storageAdapter.updateRun(location.session.sessionId, location.run.runId, {
        status: aborted ? "cancelled" : "failed",
        stopReason: aborted ? "Stopped by user" : blocker.reason,
        stoppedAt: Date.now(),
        finishedAt: Date.now()
      });
      await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
        runId: location.run.runId,
        sessionId: location.session.sessionId,
        agentId: "rdc-debugger",
        eventType: "blocker",
        status: aborted ? "warning" : "error",
        payload: {
          code: blocker.code,
          reason: blocker.reason,
          refs: blocker.refs
        }
      }));
      await this.appendAssistantConversationMessage(
        location.session.sessionId,
        location.run.runId,
        aborted ? "本轮调试已停止。" : `执行失败：${blocker.reason}`,
        aborted ? "stopped" : "error"
      );
      this.emitRunStatus(
        location.session.sessionId,
        location.run.runId,
        aborted ? "cancelled" : "failed",
        location.run.lastStage,
        blocker.reason
      );
      this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, location.run.runId));
    } finally {
      await rdxSessionService.closeOrReplaceOpenedCapture();
    }
  }
  async executeMockRun(location, debugPlan, signal, projectRoot) {
    const slowRun = /stop-test|slow-run/i.test(debugPlan.userGoal);
    const specialistAgents = debugPlan.recommendedSpecialists.length > 0 ? debugPlan.recommendedSpecialists : ["triage_agent", "pixel_forensics_agent", "shader_ir_agent"];
    this.applyTaskMutation(location.session.sessionId, location.run.runId, "speclist", "completed", "Mock task board seeded.");
    this.applyTaskMutation(location.session.sessionId, location.run.runId, "dispatch", "in_progress", "Mock specialist dispatch started.");
    for (const specialist of specialistAgents) {
      if (signal.aborted) {
        throw new Error(`Run aborted: ${location.run.runId}`);
      }
      await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
        runId: location.run.runId,
        sessionId: location.session.sessionId,
        agentId: "rdc-debugger",
        eventType: "dispatch",
        status: "sent",
        payload: {
          targetAgent: specialist,
          objective: `Mock investigate ${debugPlan.scope}`
        }
      }));
      await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
        runId: location.run.runId,
        sessionId: location.session.sessionId,
        agentId: specialist,
        eventType: "tool_execution",
        status: "ok",
        payload: {
          tool_name: `mock.${specialist}.tool`,
          result: "success"
        }
      }));
      await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
        runId: location.run.runId,
        sessionId: location.session.sessionId,
        agentId: specialist,
        eventType: "agent_summary",
        status: "ok",
        payload: {
          stage: "dispatch",
          summary: `${specialist} completed deterministic mock analysis.`,
          evidence: [`mock:${specialist}`],
          next_step: "Continue through the debugger main chain.",
          confidence: 0.7
        }
      }));
      const evidenceId = generateEventId("evidence");
      evidenceLedger.appendEvidence(location.session.sessionId, location.run.runId, {
        evidenceId,
        runId: location.run.runId,
        sessionId: location.session.sessionId,
        kind: "analysis",
        title: `${specialist} mock finding`,
        summary: `${specialist} completed deterministic mock analysis.`,
        refs: [`mock:${specialist}`],
        taskId: "dispatch",
        agentId: specialist,
        artifactIds: [],
        strength: "supporting",
        metadata: {
          confidence: 0.7
        },
        createdAt: nowIso$1()
      });
      contextService.appendAgentResultCard(location.session.sessionId, location.run.runId, {
        cardId: generateEventId("agent-card"),
        runId: location.run.runId,
        sessionId: location.session.sessionId,
        agentId: specialist,
        taskId: "dispatch",
        status: "completed",
        summary: `${specialist} completed deterministic mock analysis.`,
        evidenceIds: [evidenceId],
        artifactIds: [],
        verificationResultIds: [],
        nextActions: ["Continue through the debugger main chain."],
        createdAt: nowIso$1(),
        updatedAt: nowIso$1()
      });
    }
    this.applyTaskMutation(location.session.sessionId, location.run.runId, "dispatch", "completed", "Mock specialist dispatch completed.");
    this.applyTaskMutation(location.session.sessionId, location.run.runId, "investigate", "completed", "Mock investigation completed.");
    this.applyTaskMutation(location.session.sessionId, location.run.runId, "fix_verify", "completed", "Mock verification completed.");
    if (slowRun) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, 1800);
        signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(new Error(`Run aborted: ${location.run.runId}`));
        }, { once: true });
      });
    }
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      agentId: "rdc-debugger",
      eventType: "verification",
      status: "ok",
      payload: {
        verification_kind: "fix_verify",
        verdict: "passed",
        summary: "Deterministic mock verification passed."
      }
    }));
    const report = {
      title: `Mock Debugger Report - ${debugPlan.targetCapture?.fileName || "capture"}`,
      summary: "Deterministic mock execution completed through the debugger main chain.",
      rootCause: "Mock root cause for deterministic E2E coverage.",
      fixDescription: "Mock fix validated for deterministic E2E coverage.",
      evidenceSummary: specialistAgents.map((agent) => `mock:${agent}`),
      recommendations: ["Use live mode for full RenderDoc-backed execution."],
      confidence: 0.75,
      generatedAt: nowIso$1(),
      curatorAgentId: "curator_agent"
    };
    const bundle = reportBundleService.publish({
      projectRoot,
      sessionId: location.session.sessionId,
      runId: location.run.runId,
      goal: debugPlan.userGoal,
      report,
      evidenceSummary: report.evidenceSummary,
      verificationSummary: ["Deterministic mock verification passed."],
      eventCount: (await storageAdapter.readActionChain(location.session.sessionId)).filter((event) => event.run_id === location.run.runId).length,
      artifactPaths: [],
      llmExecution: debuggerLlmService.getRunSummary(location.run.runId)
    });
    await storageAdapter.updateRun(location.session.sessionId, location.run.runId, {
      status: "completed",
      finishedAt: Date.now(),
      lastStage: "finalize",
      reportPaths: bundle,
      runtime: {
        workflow_stage: "finalize"
      }
    });
    this.applyTaskMutation(location.session.sessionId, location.run.runId, "curate", "completed", "Mock report bundle published.");
    contextService.writeRunCapsule(location.session.sessionId, location.run.runId);
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      agentId: "curator_agent",
      eventType: "report_published",
      status: "ok",
      payload: {
        markdownPath: bundle.markdownPath,
        jsonPath: bundle.jsonPath,
        htmlPath: bundle.htmlPath
      }
    }));
    await this.appendAssistantConversationMessage(
      location.session.sessionId,
      location.run.runId,
      `调试报告已生成：${bundle.htmlPath || bundle.markdownPath || "reports ready"}`
    );
    this.emitRunStatus(location.session.sessionId, location.run.runId, "completed", "finalize");
    this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, location.run.runId));
  }
  async persistInvestigationAndReport(location, debugPlan, runtimeContext, replaySessionId, specialistResults) {
    this.applyTaskMutation(location.session.sessionId, location.run.runId, "investigate", "in_progress", "Investigation synthesis started.");
    await storageAdapter.updateRun(location.session.sessionId, location.run.runId, {
      lastStage: "investigate",
      runtime: {
        workflow_stage: "investigate"
      }
    });
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      agentId: "rdc-debugger",
      eventType: "workflow_stage_transition",
      status: "ok",
      payload: {
        fromStage: "dispatch",
        toStage: "investigate"
      }
    }));
    const investigationSummary = await this.buildInvestigationSummary(location, debugPlan, specialistResults);
    const investigationEvidenceId = generateEventId("evidence");
    evidenceLedger.appendEvidence(location.session.sessionId, location.run.runId, {
      evidenceId: investigationEvidenceId,
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      kind: "analysis",
      title: "Debugger investigation summary",
      summary: investigationSummary.summary,
      refs: investigationSummary.evidence,
      taskId: "investigate",
      agentId: "rdc-debugger",
      artifactIds: [],
      strength: investigationSummary.confidence >= 0.75 ? "strong" : "supporting",
      metadata: {
        nextStep: investigationSummary.nextStep,
        confidence: investigationSummary.confidence
      },
      createdAt: nowIso$1()
    });
    this.applyTaskMutation(
      location.session.sessionId,
      location.run.runId,
      "investigate",
      "completed",
      "Investigation summary recorded in EvidenceLedger.",
      { evidenceRefs: [investigationEvidenceId] }
    );
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      agentId: "rdc-debugger",
      eventType: "agent_summary",
      status: "ok",
      payload: {
        stage: "investigate",
        summary: investigationSummary.summary,
        evidence: investigationSummary.evidence,
        next_step: investigationSummary.nextStep,
        confidence: investigationSummary.confidence
      }
    }));
    this.applyTaskMutation(location.session.sessionId, location.run.runId, "fix_verify", "in_progress", "Verification started.");
    const verification = await this.executeVerification(runtimeContext, replaySessionId, investigationSummary);
    await storageAdapter.updateRun(location.session.sessionId, location.run.runId, {
      lastStage: "fix_verify",
      runtime: {
        workflow_stage: "fix_verify"
      }
    });
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      agentId: "rdc-debugger",
      eventType: "verification",
      status: verification.status,
      payload: verification.payload
    }));
    const skeptic = await this.executeSkepticReview(location, debugPlan, investigationSummary, verification);
    const verificationResult = this.persistVerificationResult(
      location.session.sessionId,
      location.run.runId,
      debugPlan,
      verification,
      skeptic,
      [investigationEvidenceId]
    );
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      agentId: "skeptic_agent",
      eventType: "verification",
      status: skeptic.status,
      payload: skeptic.payload
    }));
    if (skeptic.payload.verdict === "rejected") {
      this.applyTaskMutation(
        location.session.sessionId,
        location.run.runId,
        "fix_verify",
        "blocked",
        String(skeptic.payload.summary || "Skeptic rejected the evidence chain."),
        { evidenceRefs: verificationResult.evidenceIds }
      );
      await storageAdapter.updateRun(location.session.sessionId, location.run.runId, {
        status: "failed",
        stopReason: String(skeptic.payload.summary || "Skeptic rejected the evidence chain."),
        stoppedAt: Date.now(),
        finishedAt: Date.now(),
        lastStage: "fix_verify",
        runtime: {
          workflow_stage: "fix_verify"
        }
      });
      this.emitRunStatus(
        location.session.sessionId,
        location.run.runId,
        "failed",
        "fix_verify",
        String(skeptic.payload.summary || "Skeptic rejected the evidence chain.")
      );
      this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, location.run.runId));
      return;
    }
    this.applyTaskMutation(
      location.session.sessionId,
      location.run.runId,
      "fix_verify",
      "completed",
      "Verifier accepted the evidence chain.",
      { evidenceRefs: verificationResult.evidenceIds }
    );
    this.applyTaskMutation(location.session.sessionId, location.run.runId, "curate", "in_progress", "Curator report generation started.");
    const project = storageAdapter.getProjectById(location.run.projectId);
    if (!project) {
      throw new Error(`Project not found: ${location.run.projectId}`);
    }
    const report = await this.buildReport(location, debugPlan, investigationSummary, verification, skeptic);
    const llmExecution = debuggerLlmService.getRunSummary(location.run.runId);
    const bundle = reportBundleService.publish({
      projectRoot: project.rootPath,
      sessionId: location.session.sessionId,
      runId: location.run.runId,
      goal: debugPlan.userGoal,
      report,
      evidenceSummary: investigationSummary.evidence,
      verificationSummary: [
        String(verification.payload.summary),
        String(skeptic.payload.summary)
      ],
      eventCount: (await storageAdapter.readActionChain(location.session.sessionId)).filter((event) => event.run_id === location.run.runId).length,
      artifactPaths: specialistResults.flatMap((result) => result.artifacts),
      llmExecution
    });
    await storageAdapter.updateRun(location.session.sessionId, location.run.runId, {
      status: "completed",
      finishedAt: Date.now(),
      lastStage: "finalize",
      reportPaths: bundle,
      runtime: {
        workflow_stage: "finalize"
      }
    });
    this.applyTaskMutation(location.session.sessionId, location.run.runId, "curate", "completed", "Report bundle published.");
    contextService.writeRunCapsule(location.session.sessionId, location.run.runId);
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      agentId: "curator_agent",
      eventType: "report_published",
      status: "ok",
      payload: {
        markdownPath: bundle.markdownPath,
        jsonPath: bundle.jsonPath,
        htmlPath: bundle.htmlPath
      }
    }));
    await this.appendAssistantConversationMessage(
      location.session.sessionId,
      location.run.runId,
      `调试报告已生成：${bundle.htmlPath || bundle.markdownPath || "reports ready"}`
    );
    this.emitRunStatus(location.session.sessionId, location.run.runId, "completed", "finalize");
    this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, location.run.runId));
  }
  async buildInvestigationSummary(location, debugPlan, specialistResults) {
    const evidence = specialistResults.flatMap((result) => result.reasoningSummary.evidence);
    const evidenceHighlights = evidence.slice(0, 8);
    const specialistBriefs = specialistResults.map((result) => result.reasoningSummary.summary).filter(Boolean).slice(0, 4);
    const selectedPixel = evidence.find((entry) => /RGBA=/.test(entry));
    const visualTarget = evidence.find((entry) => /visual_target=|target=ResourceId/.test(entry));
    const degradedBinding = evidence.find((entry) => /fallback=|degraded=/.test(entry));
    const deterministic = {
      summary: [
        `Investigation synthesized ${specialistResults.length} specialist briefs around ${debugPlan.targetCapture?.fileName || "the target capture"} and ${debugPlan.targetFrameOrEvent?.eventLabel || "the active frame"}.`,
        selectedPixel ? `Selected pixel evidence: ${selectedPixel}` : "",
        visualTarget ? `Visual target evidence: ${visualTarget}` : ""
      ].filter(Boolean).join(" "),
      evidence,
      next_step: degradedBinding ? "Re-run with a precise bright-pixel coordinate or a valid swapchain target to turn the degraded visual evidence into a direct fix validation." : "Validate the leading root-cause hypothesis against verification contract and skeptic review.",
      confidence: specialistResults.length > 1 ? 0.74 : 0.58,
      root_cause: [
        `The strongest current evidence localizes the issue to ${debugPlan.targetFrameOrEvent?.eventLabel || "the active frame"} on ${debugPlan.targetCapture?.fileName || "the target capture"}.`,
        selectedPixel ? `The sampled focus pixel did not itself prove an overbright shader output: ${selectedPixel}.` : "",
        degradedBinding ? `The capture evidence is degraded by ${degradedBinding}, so the report should treat the IBL/leak hypothesis as unconfirmed until the exact bright coordinate or swapchain target is available.` : ""
      ].filter(Boolean).join(" "),
      recommendations: [
        ...specialistBriefs,
        ...evidenceHighlights,
        "Preserve the generated screenshots and specialist notes for regression tracking."
      ]
    };
    let data = deterministic;
    try {
      const result = await debuggerLlmService.callStructured({
        agentId: "rdc-debugger",
        stage: "investigate",
        sessionId: location.session.sessionId,
        runId: location.run.runId,
        messages: [
          {
            role: "system",
            content: "You are the RDC Debugger orchestrator. Return JSON only with keys summary, evidence, next_step, confidence, root_cause, recommendations. Ground every field in the provided specialist evidence."
          },
          {
            role: "user",
            content: JSON.stringify({
              goal: debugPlan.userGoal,
              targetCapture: debugPlan.targetCapture,
              targetFrameOrEvent: debugPlan.targetFrameOrEvent,
              specialistResults: specialistResults.map((result2) => result2.reasoningSummary)
            })
          }
        ],
        maxTokens: 700,
        temperature: 0.2,
        parse: (text) => debuggerLlmService.parseJson(text),
        testValue: deterministic,
        auditSummary: (payload) => payload.summary
      });
      data = result.data;
    } catch {
      data = deterministic;
    }
    return {
      summaryId: `rdc-debugger-${Date.now()}`,
      stage: "investigate",
      agentId: "rdc-debugger",
      summary: data.summary,
      evidence: toStringArray(data.evidence).length > 0 ? toStringArray(data.evidence) : evidence,
      nextStep: data.next_step,
      confidence: toConfidence(data.confidence, deterministic.confidence),
      createdAt: nowIso$1()
    };
  }
  async executeVerification(runtimeContext, replaySessionId, investigationSummary) {
    const verificationScreenshot = path.join(runtimeContext.outputRoot, "screenshots", "verification.png");
    await harnessController.wrapToolExecution({
      toolName: "rd.export.screenshot",
      args: {
        session_id: replaySessionId,
        output_path: verificationScreenshot,
        file_format: "png",
        include_alpha: true
      },
      agentId: "rdc-debugger",
      sessionId: runtimeContext.sessionId,
      runId: runtimeContext.runId,
      turnId: runtimeContext.turnId,
      execute: () => rdxCliInvokerService.call({
        toolName: "rd.export.screenshot",
        args: {
          session_id: replaySessionId,
          output_path: verificationScreenshot,
          file_format: "png",
          include_alpha: true,
          context_id: runtimeContext.contextId,
          runtime_owner: runtimeContext.runtimeOwner,
          owner_lease_id: runtimeContext.ownerLeaseId
        },
        contextId: runtimeContext.contextId,
        turnId: runtimeContext.turnId,
        runtimeOwner: runtimeContext.runtimeOwner,
        ownerLeaseId: runtimeContext.ownerLeaseId,
        runId: runtimeContext.runId,
        abortSignal: runtimeContext.signal
      })
    });
    return {
      status: runtimeContext.debugPlan.verificationContract.requiresFixValidation ? "warning" : "ok",
      payload: {
        verification_kind: "fix_verify",
        verdict: runtimeContext.debugPlan.verificationContract.requiresFixValidation ? "evidence_consistent_warning" : "passed",
        summary: runtimeContext.debugPlan.verificationContract.requiresFixValidation ? "Verification completed with real framebuffer evidence, but shader hotfix replay remained best-effort only." : "Verification completed with real framebuffer evidence.",
        screenshot_path: verificationScreenshot,
        evidence: investigationSummary.evidence
      }
    };
  }
  async executeSkepticReview(location, debugPlan, investigationSummary, verification) {
    const deterministic = {
      verdict: verification.status === "ok" ? "approved" : "approved_with_warning",
      summary: verification.status === "ok" ? "Skeptic accepted the evidence chain." : "Skeptic accepted the evidence chain but flagged verification as best-effort."
    };
    let data = deterministic;
    try {
      const result = await debuggerLlmService.callStructured({
        agentId: "skeptic_agent",
        stage: "skeptic",
        sessionId: location.session.sessionId,
        runId: location.run.runId,
        messages: [
          {
            role: "system",
            content: "You are the skeptic agent. Return JSON only with keys verdict and summary. Verdict must be one of approved, approved_with_warning, rejected. Reject only when the evidence chain is not strong enough to support publication."
          },
          {
            role: "user",
            content: JSON.stringify({
              goal: debugPlan.userGoal,
              investigationSummary,
              verification
            })
          }
        ],
        maxTokens: 400,
        temperature: 0.1,
        parse: (text) => debuggerLlmService.parseJson(text),
        testValue: deterministic,
        auditSummary: (payload) => payload.summary
      });
      data = result.data;
    } catch {
      data = deterministic;
    }
    return {
      status: data.verdict === "approved" ? "ok" : "warning",
      payload: {
        verification_kind: "skeptic_review",
        verdict: data.verdict,
        summary: data.summary
      }
    };
  }
  async buildReport(location, debugPlan, investigationSummary, verification, skeptic) {
    const deterministic = {
      title: `Debugger Report - ${debugPlan.targetCapture?.fileName || "capture"}`,
      summary: investigationSummary.summary,
      root_cause: investigationSummary.summary,
      fix_description: String(verification.payload.summary),
      evidence_summary: investigationSummary.evidence,
      recommendations: [
        "Review the highlighted pipeline/shader evidence before landing a permanent fix.",
        "Keep the generated screenshot and specialist notes together with the report for regression tracking."
      ],
      confidence: investigationSummary.confidence
    };
    let data = deterministic;
    try {
      const result = await debuggerLlmService.callStructured({
        agentId: "curator_agent",
        stage: "curate",
        sessionId: location.session.sessionId,
        runId: location.run.runId,
        messages: [
          {
            role: "system",
            content: "You are the curator agent. Return JSON only with keys title, summary, root_cause, fix_description, evidence_summary, recommendations, confidence. Summaries must stay grounded in the verified evidence chain and skeptic outcome."
          },
          {
            role: "user",
            content: JSON.stringify({
              goal: debugPlan.userGoal,
              investigationSummary,
              verification,
              skeptic
            })
          }
        ],
        maxTokens: 900,
        temperature: 0.2,
        parse: (text) => debuggerLlmService.parseJson(text),
        testValue: deterministic,
        auditSummary: (payload) => payload.summary
      });
      data = result.data;
    } catch {
      data = deterministic;
    }
    return {
      title: data.title,
      summary: data.summary,
      rootCause: data.root_cause,
      fixDescription: data.fix_description,
      evidenceSummary: toStringArray(data.evidence_summary),
      recommendations: toStringArray(data.recommendations),
      confidence: toConfidence(data.confidence, deterministic.confidence),
      generatedAt: nowIso$1(),
      curatorAgentId: "curator_agent"
    };
  }
  getRequiredRouteAgents(debugPlan, backend) {
    const required = /* @__PURE__ */ new Set([
      "rdc-debugger",
      "skeptic_agent",
      "curator_agent",
      ...debugPlan.recommendedSpecialists
    ]);
    if (backend === "remote") {
      required.add("driver_device_agent");
    }
    return Array.from(required);
  }
  normalizePlanPresentation(value, fallback) {
    if (!value || typeof value.title !== "string" || !Array.isArray(value.sections)) {
      return fallback;
    }
    const sections = value.sections.map((section, index) => ({
      id: String(section.id || section.title || `section-${index + 1}`),
      title: String(section.title || "").trim(),
      body: toStringArray(section.body)
    })).filter((section) => section.title && section.body.length > 0);
    if (!value.title.trim() || sections.length === 0) {
      return fallback;
    }
    return {
      title: value.title.trim(),
      sections
    };
  }
  async generatePlanWithLlm(input) {
    const deterministic = {
      scope: input.basePlan.scope,
      notes: input.basePlan.notes,
      recommended_specialists: input.basePlan.recommendedSpecialists,
      verification_focus: input.basePlan.verificationContract.successCriteria,
      presentation: input.basePlan.presentation ?? buildDebugPlanPresentation(input.basePlan)
    };
    let data = deterministic;
    try {
      const result = await debuggerLlmService.callStructured({
        agentId: "rdc-debugger",
        stage: "plan",
        sessionId: input.sessionId,
        runId: input.runId,
        messages: [
          {
            role: "system",
            content: "You are the RDC Debugger planner. Return JSON only with keys scope, notes, recommended_specialists, verification_focus, presentation. presentation must contain title and sections; each section has id, title, body string array. Keep the plan grounded in the provided intake facts and do not invent unsupported captures or event ids."
          },
          {
            role: "user",
            content: JSON.stringify({
              goal: input.resolvedGoal,
              basePlan: input.basePlan
            })
          }
        ],
        maxTokens: 700,
        temperature: 0.2,
        parse: (text) => debuggerLlmService.parseJson(text),
        testValue: deterministic,
        auditSummary: (payload) => payload.scope
      });
      data = result.data;
    } catch {
      data = deterministic;
    }
    return {
      ...input.basePlan,
      scope: data.scope || input.basePlan.scope,
      notes: Array.from(/* @__PURE__ */ new Set([
        ...input.basePlan.notes,
        ...toStringArray(data.notes),
        ...toStringArray(data.verification_focus).map((item) => `Verification focus: ${item}`)
      ])),
      recommendedSpecialists: toRecommendedSpecialists(data.recommended_specialists, input.basePlan.recommendedSpecialists),
      presentation: this.normalizePlanPresentation(data.presentation, input.basePlan.presentation ?? buildDebugPlanPresentation(input.basePlan)),
      updatedAt: nowIso$1()
    };
  }
  normalizeLlmBlocker(error, fallbackCode) {
    if (error && typeof error === "object" && "blocker" in error) {
      const blocker = error.blocker;
      if (blocker) {
        return blocker;
      }
    }
    return {
      code: fallbackCode,
      reason: error instanceof Error ? error.message : String(error),
      refs: [],
      detectedAt: nowIso$1()
    };
  }
  async appendActionEvent(sessionId, event) {
    if (!event.turn_id && event.run_id) {
      const location = this.findRun(event.run_id);
      if (location?.run.turnId) {
        event.turn_id = location.run.turnId;
      }
    }
    await storageAdapter.appendActionEvent(sessionId, event);
    workflowProjectionPublisher.publishEvidenceEvent(event);
    this.publishTraceProjection(sessionId);
  }
  async appendUserConversationMessage(sessionId, runId, content) {
    const runLocation = this.findRun(runId || "");
    const message = {
      id: generateEventId("msgu"),
      turnId: runLocation?.run.turnId || generateEventId("turn"),
      sessionId,
      projectId: runLocation?.session.projectId ?? null,
      runId,
      modeContext: runLocation?.run.mode ?? "debugger",
      role: "user",
      content,
      status: "complete",
      attachments: [],
      updatedAt: nowMs(),
      reasoningTrace: null,
      createdAt: nowMs()
    };
    storageAdapter.appendConversationMessage(sessionId, message);
    this.emitConversationEvent({
      type: "message_completed",
      sessionId,
      turnId: message.turnId,
      message
    });
    this.publishTraceProjection(sessionId);
  }
  async appendAssistantConversationMessage(sessionId, runId, content, status = "complete") {
    const runLocation = this.findRun(runId || "");
    const message = {
      id: generateEventId("msga"),
      turnId: runLocation?.run.turnId || generateEventId("turn"),
      sessionId,
      projectId: runLocation?.session.projectId ?? null,
      runId,
      modeContext: runLocation?.run.mode ?? "debugger",
      role: "assistant",
      agentId: "rdc-debugger",
      content,
      status,
      updatedAt: nowMs(),
      reasoningTrace: null,
      createdAt: nowMs()
    };
    storageAdapter.appendConversationMessage(sessionId, message);
    this.emitConversationEvent({
      type: status === "error" ? "message_errored" : "message_completed",
      sessionId,
      turnId: message.turnId,
      message
    });
  }
  findRun(runId) {
    const projects = storageAdapter.listProjects();
    for (const project of projects) {
      const sessions = storageAdapter.listSessions(project.projectId);
      for (const session of sessions) {
        const run = storageAdapter.listRuns(session.sessionId).find((entry) => entry.runId === runId);
        if (run) {
          return { session, run };
        }
      }
    }
    return null;
  }
  emitWorkflowState(state2) {
    workflowProjectionPublisher.publishWorkflowState(state2);
    this.publishTraceProjection(state2.sessionId);
  }
  emitRunStatus(sessionId, runId, status, lastStage, stopReason) {
    workflowProjectionPublisher.publishRunStatus({
      sessionId,
      runId,
      status,
      lastStage,
      stopReason
    });
    if (["completed", "failed", "cancelled", "interrupted"].includes(status)) {
      this.publishTraceProjection(sessionId);
    }
  }
  emitConversationEvent(event) {
    workflowProjectionPublisher.publishConversationEvent(event);
  }
  publishTraceProjection(sessionId) {
    void traceService.getSession(sessionId).then((result) => {
      if (result.success && result.presentation) {
        workflowProjectionPublisher.publishTraceProjectionChanged(sessionId, result.presentation);
      }
    }).catch((error) => {
      console.error("[WorkflowProjectionPublisher] Failed to publish trace projection:", error);
    });
  }
}
const debugWorkflowService = new DebugWorkflowService();
class DebuggerRuntime {
  recoverInterruptedRuns() {
    return debugWorkflowService.recoverInterruptedRuns();
  }
  startPlan(request) {
    return debugWorkflowService.startPlan(request);
  }
  requestStartFromConversation(request) {
    const { source: _source, message: _message, ...startRequest } = request;
    return this.startPlan(startRequest);
  }
  getPlan(runId) {
    return debugWorkflowService.getPlan(runId);
  }
  submitQuestions(runId, answers) {
    return debugWorkflowService.submitQuestions(runId, answers);
  }
  approvePlan(runId) {
    return debugWorkflowService.approvePlan(runId);
  }
  getTraceProjection(sessionId) {
    return debugWorkflowService.getTraceProjection(sessionId);
  }
  requestPlanRevision(runId, revisionText) {
    return debugWorkflowService.requestPlanRevision(runId, revisionText);
  }
  switchTraceBranch(sessionId, branchId) {
    return debugWorkflowService.switchTraceBranch(sessionId, branchId);
  }
  exportTraceSession(sessionId, options) {
    return debugWorkflowService.exportTraceSession(sessionId, options);
  }
  restartRun(runId) {
    return debugWorkflowService.restartRun(runId);
  }
  stopRun(runId) {
    return debugWorkflowService.stopRun(runId);
  }
  getWorkflowState(sessionId, runId) {
    return debugWorkflowService.getWorkflowState(sessionId, runId);
  }
  resolveAgentToolAllowlist(agentId, stage) {
    return resolveAgentToolAllowlist(agentId, stage);
  }
  isToolAllowedForAgent(toolName, agentId, stage) {
    return isToolAllowedForAgent(toolName, agentId, stage);
  }
}
const debuggerRuntime = new DebuggerRuntime();
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
function registerCaptureDeviceHandlers(context2) {
  const { state: state2 } = context2;
  electron.ipcMain.handle("context:get", async () => {
    return rdxSessionService.snapshotContext();
  });
  electron.ipcMain.handle("context:openHumanPreview", async (_event, request) => {
    try {
      const contextSnapshot = await rdxSessionService.openHumanPreviewWindow(request);
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
    async (_event, request) => {
      try {
        runtimeLogService.log({
          scope: state2.currentSessionId ? "session" : "app",
          namespace: "capture",
          severity: "info",
          title: "Open project input",
          summary: `开始打开 ${request.inputId}。`,
          detail: request.filePath,
          sessionId: state2.currentSessionId,
          projectId: request.projectId,
          runId: state2.currentRunId,
          raw: {
            inputId: request.inputId,
            replayDeviceId: request.replayDeviceId,
            filePath: request.filePath
          }
        });
        const input = storageAdapter.listProjectInputs(request.projectId).find((entry) => entry.inputId === request.inputId && entry.filePath === request.filePath);
        if (!input) {
          return { success: false, error: `Project input not found: ${request.inputId}` };
        }
        const replayDevice = replayDeviceService.getDeviceById(request.replayDeviceId);
        if (!replayDevice) {
          return { success: false, error: `Replay device not found: ${request.replayDeviceId}` };
        }
        const openedCapture = await rdxSessionService.openProjectInput({
          projectId: request.projectId,
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
          projectId: request.projectId,
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
          projectId: request.projectId,
          runId: state2.currentRunId,
          raw: {
            inputId: request.inputId,
            replayDeviceId: request.replayDeviceId,
            filePath: request.filePath
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
const EXECUTE_PATTERN = /开始|启动|执行|正式分析|正式调试|本地调试|local\s*模式调试|模式调试|直接分析|现在分析|run\b|start\b|debug\b|analy[sz]e\b|帮我调试|请.*调试|开始调试|开始分析/i;
const TASK_FILE_PATTERN = /([A-Za-z]:[\\/][^\r\n"]+\.(txt|md))/i;
const CONTROL_OPEN_TAG = "<control>";
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
function trimPathLabel(value) {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || value;
}
function createReasoningStep(id, title, stage) {
  return {
    id,
    title,
    stage,
    status: "pending",
    toolCalls: [],
    startedAt: nowMs()
  };
}
function createDraftReasoningTrace(summary, steps) {
  return {
    status: "running",
    summary,
    steps,
    updatedAt: nowMs()
  };
}
function cloneTrace(trace) {
  return trace ? {
    ...trace,
    steps: trace.steps.map((step) => ({
      ...step,
      toolCalls: step.toolCalls.map((toolCall) => ({ ...toolCall }))
    }))
  } : {
    status: "idle",
    steps: [],
    updatedAt: nowMs()
  };
}
function upsertTraceStep(trace, stepId, patch) {
  const nextTrace = cloneTrace(trace);
  const stepIndex = nextTrace.steps.findIndex((step) => step.id === stepId);
  if (stepIndex >= 0) {
    nextTrace.steps[stepIndex] = {
      ...nextTrace.steps[stepIndex],
      ...patch,
      toolCalls: patch.toolCalls ? patch.toolCalls.map((toolCall) => ({ ...toolCall })) : nextTrace.steps[stepIndex].toolCalls.map((toolCall) => ({ ...toolCall }))
    };
  } else {
    nextTrace.steps.push({
      ...createReasoningStep(stepId, patch.title || stepId, patch.stage),
      ...patch,
      toolCalls: patch.toolCalls ? patch.toolCalls.map((toolCall) => ({ ...toolCall })) : []
    });
  }
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}
function finalizeTrace(trace, status, summary) {
  const nextTrace = cloneTrace(trace);
  nextTrace.status = status;
  nextTrace.summary = summary ?? nextTrace.summary;
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}
function upsertRuntimeToolCall(trace, patch) {
  const nextTrace = cloneTrace(trace);
  const stepId = "runtime-tools";
  let step = nextTrace.steps.find((entry) => entry.id === stepId);
  if (!step) {
    step = createReasoningStep(stepId, "Runtime tool trace", "cowork");
    step.status = "running";
    nextTrace.steps.push(step);
  }
  const toolIndex = step.toolCalls.findIndex((toolCall) => toolCall.id === patch.id);
  if (toolIndex >= 0) {
    step.toolCalls[toolIndex] = {
      ...step.toolCalls[toolIndex],
      ...patch
    };
  } else {
    step.toolCalls.push({
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
  if (step.toolCalls.length > 0 && step.toolCalls.every((toolCall) => toolCall.status === "complete" || toolCall.status === "error")) {
    step.status = step.toolCalls.some((toolCall) => toolCall.status === "error") ? "error" : "complete";
    step.completedAt = nowMs();
  }
  nextTrace.status = "running";
  nextTrace.updatedAt = nowMs();
  return nextTrace;
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
    reasoningTrace: options.reasoningTrace ?? null,
    diagnostic: options.diagnostic ?? null,
    attachments: options.attachments,
    createdAt
  };
}
function composeMessageForAgent(entry) {
  const attachmentLines = (entry.attachments ?? []).map((attachment) => `- ${attachment.fileName}`);
  if (attachmentLines.length === 0) {
    return entry.content;
  }
  const suffix = `

Attached files:
${attachmentLines.join("\n")}`;
  return entry.content ? `${entry.content}${suffix}` : `Attached files:
${attachmentLines.join("\n")}`;
}
function stripControlBlock(text) {
  return text.replace(/<control>\s*[\s\S]*?<\/control>/i, "").trim();
}
function parseControlBlock(text) {
  const match = text.match(/<control>\s*([\s\S]*?)\s*<\/control>/i);
  if (!match?.[1]) {
    return null;
  }
  try {
    const parsed = JSON.parse(match[1]);
    const intent = parsed.intent;
    if (intent !== "talk" && intent !== "intake" && intent !== "execute") {
      return null;
    }
    return {
      intent,
      safe_to_start: parsed.safe_to_start === true,
      needs_project: parsed.needs_project === true,
      needs_capture: parsed.needs_capture === true,
      needs_target_capture: parsed.needs_target_capture === true,
      needs_route: parsed.needs_route === true,
      reason: typeof parsed.reason === "string" ? parsed.reason : void 0
    };
  } catch {
    return null;
  }
}
function resolveTaskFileContext(message) {
  const match = message.match(TASK_FILE_PATTERN);
  const taskFilePath = match?.[1] ? path.resolve(match[1]) : null;
  if (!taskFilePath || !fs.existsSync(taskFilePath) || !fs.statSync(taskFilePath).isFile()) {
    return {
      taskFilePath: null,
      taskFileContent: null,
      effectiveMessage: message
    };
  }
  const taskFileContent = fs.readFileSync(taskFilePath, "utf-8").trim();
  return {
    taskFilePath,
    taskFileContent,
    effectiveMessage: [message, taskFileContent].filter(Boolean).join("\n\n")
  };
}
function buildCoworkPrompt(context2, history, mode, message, attachments) {
  const resolvedTaskFile = resolveTaskFileContext(message);
  const recentHistory = history.slice(-6).map((entry) => ({
    role: entry.role,
    content: entry.content
  }));
  return JSON.stringify({
    requested_mode: mode,
    requested_mode_label: mode === "ask" ? "Ask" : mode === "debugger" ? "Debugger" : mode === "analyzer" ? "Analyzer" : "Optimizer",
    user_message: message,
    effective_user_message: resolvedTaskFile.effectiveMessage,
    task_file_path: resolvedTaskFile.taskFilePath,
    task_file_content: resolvedTaskFile.taskFileContent,
    current_project_id: context2.projectId,
    current_session_id: context2.session?.sessionId ?? null,
    active_run_id: isActiveRun(context2.currentRun) ? context2.currentRun.runId : null,
    opened_capture: context2.openedCapturePath,
    project_inputs: context2.projectInputs.slice(0, 8).map((entry) => entry.fileName),
    incoming_attachments: attachments.map((entry) => ({
      file_name: entry.fileName,
      kind: entry.kind,
      mime_type: entry.mimeType
    })),
    recent_history: recentHistory
  }, null, 2);
}
function buildAskSystemPrompt() {
  return [
    "你是 RDC-Agent 的 Ask 助手，工作模式是只读 agentic 协作。",
    "要求：",
    "1. 正常回答用户问题，语气简洁；可以澄清目标、检索上下文、读取或搜索当前 workspace 内文本文件，也可以访问公开 HTTP(S) 页面。",
    "2. 只允许使用只读工具：read_file、glob、grep、task_list、web_fetch、web_search；不要请求 bash、write_file、edit_file、remove 或 task_create/update。",
    "3. 不要自称 RDC Debugger，不要暗示已经开始 RenderDoc 调试，也不要假装分析过 capture。",
    "4. 如果用户要求正式调试或执行分析，只提示需要在应用内 Open capture 并切换到 Debugger；Ask 模式不能创建正式 run。",
    "5. 可以展示可见工作轨迹和工具轨迹，但不要输出隐藏 chain-of-thought。",
    "6. 如果需要输出 control JSON，也必须 safe_to_start=false，除非后端路由已经确认进入 Debugger 执行链。"
  ].join("\n");
}
function buildDebuggerCoworkSystemPrompt() {
  return [
    "你是 RDC Debugger，一个面向 RenderDoc 调试场景的 Cowork Agent。",
    "要求：",
    "1. 始终先用自然中文正常回复用户，不要像审批流或工单流。",
    "2. 如果用户问通用知识、产品能力、技术概念，直接回答，不要强行转成调试执行，也不要在普通寒暄中自我介绍成 RDC Debugger。",
    "3. 没有正式进入调试 run 前，不要假装自己已经分析过 capture。",
    "4. Ask 是非执行入口；只有 requested_mode 是 Debugger、用户明确表达“现在开始正式调试/执行分析”，且应用内已有 opened_capture 时，才把 intent 标成 execute。",
    "5. 回复正文结束后，必须额外附加一个 <control>{...}</control> 块，control JSON 只允许包含 intent, safe_to_start, needs_project, needs_capture, needs_target_capture, needs_route, reason。",
    "6. 如果你不确定，就把 intent 设为 talk 或 intake，safe_to_start 设为 false。",
    "7. 控制块不要在正文里解释给用户。",
    "8. requested_mode 表示当前 UI 模式，Ask 只做澄清与引导，Debugger 偏重定位与排障，Analyzer 偏重拆解与证据整理，Optimizer 偏重瓶颈判断与优化建议；回答结构要随 mode 调整。"
  ].join("\n");
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
function getConversationAgentLabel(agentId) {
  return agentId === "ask_agent" ? "Ask" : "rdc-debugger";
}
function resolveAgentRoutePreflight(agentId, fallbackAgentId) {
  const settings = settingsService.getAll();
  const primaryRoute = settings.llm.agentRoutes.find((entry) => entry.agentId === agentId);
  const fallbackRoute = fallbackAgentId ? settings.llm.agentRoutes.find((entry) => entry.agentId === fallbackAgentId) : void 0;
  const route = primaryRoute?.providerId && primaryRoute.modelId ? primaryRoute : fallbackRoute;
  const routeAgentId = route?.agentId ?? agentId;
  const label = getConversationAgentLabel(agentId);
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
    modelId: route.modelId
  };
}
function resolveDebuggerRoutePreflight() {
  return resolveAgentRoutePreflight("rdc-debugger");
}
function hasUsableDebuggerRoute() {
  return resolveDebuggerRoutePreflight().ok;
}
function recordCoworkLlmDiagnostic(context2, diagnostic) {
  runtimeLogService.log({
    scope: context2.session?.sessionId ? "session" : "app",
    namespace: "llm",
    severity: diagnostic.severity === "error" ? "error" : "warning",
    title: `${diagnostic.agentId ?? "rdc-debugger"} -> ${diagnostic.providerId ?? "route missing"}${diagnostic.modelId ? `/${diagnostic.modelId}` : ""}`,
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
  const label = getConversationAgentLabel(route.agentId);
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
function extractRequestedCaptureName(message) {
  const match = message.match(/([^\s"'“”‘’]+\.rdc)/i);
  return match?.[1] ? trimPathLabel(match[1].replace(/[，。；,;]+$/, "")) : null;
}
function shouldStartDebuggerFromMessage(message) {
  if (!EXECUTE_PATTERN.test(message)) {
    return false;
  }
  return /\.rdc\b/i.test(message) || /event\s*id|事件\s*id|Event\s*\d+/i.test(message) || /帮我调试|请调试|开始调试|正式分析|直接过去看|定位根因|完整\s*report/i.test(message);
}
function captureDescriptorFromOpenedCapture(openedCapture) {
  const normalizedPath = path.resolve(openedCapture.filePath);
  return {
    id: openedCapture.captureId || openedCapture.inputId,
    filePath: normalizedPath,
    captureFileId: openedCapture.captureFileId,
    role: "primary",
    backendHint: openedCapture.backend,
    status: openedCapture.status,
    sessionId: openedCapture.sessionId,
    replaySessionId: openedCapture.replaySessionId,
    contextId: openedCapture.contextId
  };
}
function resolveOpenedCaptureDescriptor(context2) {
  return context2.openedCapture?.status === "open" ? captureDescriptorFromOpenedCapture(context2.openedCapture) : null;
}
function resolveCaptureGuards(message, context2) {
  if (resolveOpenedCaptureDescriptor(context2)) {
    return { ready: true };
  }
  const requestedCaptureName = extractRequestedCaptureName(message);
  if (requestedCaptureName) {
    return {
      ready: false,
      needsCapture: true,
      reason: `我看到你提到了 ${requestedCaptureName}，但正式 Debugger 只能使用应用内已经 Open 的 .rdc Capture。请先在 Capture Library 打开该 capture，再进入执行模式。`
    };
  }
  return {
    ready: false,
    needsCapture: true,
    reason: "我可以先帮你梳理问题，但正式 Debugger 执行需要先在应用内 Open 一个 .rdc Capture。仅在 prompt 中写路径不会创建 runtime context。"
  };
}
function buildWorkflowUpgradeReply(result) {
  if (!result.success) {
    return result.error ? `我刚才尝试进入正式调试，但没有成功：${result.error}` : "我刚才尝试进入正式调试，但没有成功。";
  }
  if (result.debugPlanSummary?.blockers?.length) {
    const blocker = result.debugPlanSummary.blockers[0];
    if (blocker?.code === "BLOCKED_LLM_ROUTE_MISSING" || blocker?.code === "BLOCKED_LLM_PROVIDER_MISSING" || blocker?.code === "BLOCKED_LLM_SECRET_MISSING" || blocker?.code === "BLOCKED_LLM_MODEL_MISSING" || blocker?.code === "BLOCKED_LLM_PROVIDER_UNAVAILABLE") {
      return "当前调试链路还没绑定可用模型，所以我不能开始正式执行；不过我可以先帮你确认问题范围和所需 capture。";
    }
    if (blocker?.code === "BLOCKED_MISSING_CAPTURE") {
      return "我可以先帮你梳理问题，但正式分析需要一个 .rdc capture。你可以先描述现象，或者直接打开一个 capture。";
    }
    return blocker?.reason || "当前还不能进入正式调试。";
  }
  if (result.pendingQuestions?.questions.some((question) => question.id === "target_capture")) {
    return "我已经开始整理正式执行计划了，不过当前还需要你明确这次要分析的 capture。";
  }
  if (result.status === "awaiting_approval") {
    return "我已经整理好正式执行计划了。你先确认下方计划卡片，批准后我再进入严格调试流程。";
  }
  return "正式调试入口已准备完成，后续状态会在计划卡和运行记录中更新。";
}
function computeVisibleAssistantText(raw) {
  const controlIndex = raw.indexOf(CONTROL_OPEN_TAG);
  if (controlIndex >= 0) {
    return raw.slice(0, controlIndex);
  }
  let partialMatchLength = 0;
  for (let index = CONTROL_OPEN_TAG.length - 1; index > 0; index -= 1) {
    if (raw.endsWith(CONTROL_OPEN_TAG.slice(0, index))) {
      partialMatchLength = index;
      break;
    }
  }
  return partialMatchLength > 0 ? raw.slice(0, raw.length - partialMatchLength) : raw;
}
class ConversationService {
  activeTurns = /* @__PURE__ */ new Map();
  async getHistory(sessionId) {
    return storageAdapter.readConversationHistory(sessionId);
  }
  async cancelActiveTurn(request = {}) {
    const candidates = Array.from(this.activeTurns.values()).filter((turn) => !request.turnId || turn.turnId === request.turnId).filter((turn) => !request.sessionId || turn.sessionId === request.sessionId).sort((left, right) => right.startedAt - left.startedAt);
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
    const context2 = await this.resolveContext(input);
    if (isActiveRun(context2.currentRun)) {
      return this.startActiveDebugTurn(context2, input.mode, input.message.trim(), input.attachments ?? []);
    }
    return this.startCoworkTurn(context2, input.mode, input.message.trim(), input.attachments ?? []);
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
  async startActiveDebugTurn(context2, requestedMode, rawMessage, pendingAttachments) {
    const turnId = generateEventId("turn");
    const attachments = context2.session ? storageAdapter.importSessionAttachments(
      context2.session.sessionId,
      pendingAttachments.map((entry) => entry.sourcePath)
    ) : [];
    const userMessage = makeConversationMessage("user", rawMessage, {
      turnId,
      sessionId: context2.session?.sessionId ?? null,
      projectId: context2.projectId,
      runId: context2.currentRun?.runId ?? null,
      modeContext: requestedMode,
      attachments,
      status: "complete"
    });
    const assistantDraftMessage = makeConversationMessage("assistant", "", {
      turnId,
      sessionId: context2.session?.sessionId ?? null,
      projectId: context2.projectId,
      runId: context2.currentRun?.runId ?? null,
      modeContext: requestedMode,
      agentId: "rdc-debugger",
      status: "streaming",
      reasoningTrace: createDraftReasoningTrace("正在思考", [
        createReasoningStep("active-debug-reply", "生成调试回复", "investigate")
      ])
    });
    this.persistConversationSnapshot(context2.session?.sessionId ?? null, userMessage);
    this.persistConversationSnapshot(context2.session?.sessionId ?? null, assistantDraftMessage);
    this.publishTraceProjection(context2.session?.sessionId ?? null);
    void this.completeActiveDebugTurn({
      context: context2,
      requestedMode,
      userMessage,
      assistantDraftMessage
    });
    return {
      session: context2.session,
      mode: "active_debug",
      userMessage,
      assistantDraftMessage,
      executionTransition: { action: "none" },
      runUpdate: context2.currentRun,
      errorViewModel: null
    };
  }
  async completeActiveDebugTurn(input) {
    let assistantMessage = input.assistantDraftMessage;
    const sessionId = input.context.session?.sessionId ?? null;
    const traceSessionId = sessionId ?? this.ephemeralTraceSessionId(input.assistantDraftMessage.turnId);
    const abortController = new AbortController();
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
        reasoningTrace: finalizeTrace(
          upsertTraceStep(assistantMessage.reasoningTrace, "active-debug-reply", {
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
    commitAssistantMessage("message_patched", {
      reasoningTrace: upsertTraceStep(
        assistantMessage.reasoningTrace,
        "active-debug-reply",
        {
          title: "生成调试回复",
          stage: "investigate",
          status: "running",
          summary: "Debugger 正在结合当前 run 上下文生成回复。",
          startedAt: nowMs()
        }
      )
    });
    try {
      const responseText = await agentOrchestrator.sendMessage(
        "rdc-debugger",
        composeMessageForAgent(input.userMessage),
        {
          caseId: input.context.session?.sessionId,
          runId: input.context.currentRun?.runId ?? void 0,
          sessionId: input.context.session?.sessionId ?? void 0,
          turnId: assistantMessage.turnId
        },
        {
          onChunk: (chunk) => {
            commitAssistantMessage("message_patched", {
              status: "streaming",
              content: `${assistantMessage.content}${chunk}`
            });
          },
          signal: abortController.signal
        }
      );
      commitAssistantMessage("message_completed", {
        status: "complete",
        content: responseText,
        reasoningTrace: finalizeTrace(
          upsertTraceStep(
            assistantMessage.reasoningTrace,
            "active-debug-reply",
            {
              status: "complete",
              summary: "调试回复已生成。",
              completedAt: nowMs()
            }
          ),
          "complete",
          "回复已完成"
        )
      });
    } catch (error) {
      const routePreflight = resolveDebuggerRoutePreflight();
      const diagnostic = routePreflight.ok ? createRequestFailedDiagnostic(routePreflight, error) : routePreflight.diagnostic;
      recordCoworkLlmDiagnostic(input.context, diagnostic);
      const message = diagnostic.userMessage;
      commitAssistantMessage("message_errored", {
        status: "error",
        content: assistantMessage.content || message,
        diagnostic,
        reasoningTrace: finalizeTrace(
          upsertTraceStep(
            assistantMessage.reasoningTrace,
            "active-debug-reply",
            {
              status: "error",
              summary: message,
              detail: diagnostic.technicalMessage,
              completedAt: nowMs()
            }
          ),
          "error",
          "回复生成失败"
        )
      });
    } finally {
      this.clearActiveTurn(assistantMessage.turnId, abortController);
    }
  }
  async startCoworkTurn(context2, requestedMode, rawMessage, pendingAttachments) {
    let workingSession = context2.session;
    if (!workingSession && context2.projectId) {
      workingSession = storageAdapter.createSession(context2.projectId, rawMessage.slice(0, 80));
    }
    const turnId = generateEventId("turn");
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
      status: "complete"
    });
    const assistantDraftMessage = makeConversationMessage("assistant", "", {
      turnId,
      sessionId: workingSession?.sessionId ?? null,
      projectId: context2.projectId,
      runId: isActiveRun(context2.currentRun) ? context2.currentRun.runId : null,
      modeContext: requestedMode,
      agentId: requestedMode === "ask" ? "ask_agent" : "rdc-debugger",
      status: "streaming",
      reasoningTrace: createDraftReasoningTrace(
        requestedMode === "ask" ? "正在执行只读协作" : "正在思考",
        [
          createReasoningStep("cowork-route", "检查上下文与路由", "intake_gate"),
          createReasoningStep(
            "cowork-reply",
            requestedMode === "ask" ? "生成只读协作回复" : "生成协作回复",
            "plan"
          )
        ]
      )
    });
    if (!context2.projectId && EXECUTE_PATTERN.test(rawMessage)) {
      const assistantMessage = {
        ...assistantDraftMessage,
        content: "我可以先帮你梳理问题，不过正式调试要先选一个项目。选好项目后，你可以继续描述现象，或者直接打开一个 .rdc capture。",
        status: "complete",
        updatedAt: nowMs()
      };
      const traceSessionId2 = this.ephemeralTraceSessionId(turnId);
      const tracePresentation2 = await traceService.buildConversationPresentation(
        traceSessionId2,
        [userMessage, assistantMessage]
      );
      workflowProjectionPublisher.publishTraceProjectionChanged(traceSessionId2, tracePresentation2);
      this.publishConversationTrace(traceSessionId2, [userMessage, assistantMessage], null);
      return {
        session: null,
        mode: "talk",
        userMessage,
        assistantDraftMessage: assistantMessage,
        executionTransition: { action: "none" },
        runUpdate: null,
        tracePresentation: tracePresentation2,
        errorViewModel: null
      };
    }
    this.persistConversationSnapshot(workingSession?.sessionId ?? null, userMessage);
    this.persistConversationSnapshot(workingSession?.sessionId ?? null, assistantDraftMessage);
    const traceSessionId = workingSession?.sessionId ?? this.ephemeralTraceSessionId(turnId);
    const tracePresentation = await traceService.buildConversationPresentation(
      traceSessionId,
      [userMessage, assistantDraftMessage]
    );
    workflowProjectionPublisher.publishTraceProjectionChanged(traceSessionId, tracePresentation);
    this.publishConversationTrace(traceSessionId, [userMessage, assistantDraftMessage], workingSession?.sessionId ?? null);
    void this.completeCoworkTurn({
      context: {
        ...context2,
        session: workingSession
      },
      requestedMode,
      rawMessage,
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
  async completeCoworkTurn(input) {
    let assistantMessage = input.assistantDraftMessage;
    const sessionId = input.context.session?.sessionId ?? null;
    const traceSessionId = sessionId ?? this.ephemeralTraceSessionId(input.assistantDraftMessage.turnId);
    const abortController = new AbortController();
    const conversationAgentId = input.requestedMode === "ask" ? "ask_agent" : "rdc-debugger";
    const showCoworkReasoning = true;
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
        reasoningTrace: finalizeTrace(
          upsertTraceStep(assistantMessage.reasoningTrace, "cowork-reply", {
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
    let systemAppendix = "";
    const commitVisibleAssistantText = () => {
      commitAssistantMessage("message_patched", {
        status: "streaming",
        content: `${visibleResponse}${systemAppendix}`
      });
    };
    const appendSystemAppendix = (text) => {
      if (!text) {
        return;
      }
      systemAppendix += text;
      commitVisibleAssistantText();
    };
    const withCoworkReasoning = (reasoningTrace) => ({ reasoningTrace });
    {
      commitAssistantMessage("message_patched", {
        reasoningTrace: upsertTraceStep(assistantMessage.reasoningTrace, "cowork-route", {
          status: "running",
          summary: input.requestedMode === "ask" ? "正在检查项目上下文、只读工具权限与模型路由。" : "正在检查项目、capture 与调试路由。",
          startedAt: nowMs()
        })
      });
    }
    const history = input.context.session ? storageAdapter.readConversationHistory(input.context.session.sessionId).filter((entry) => entry.id !== assistantMessage.id) : [];
    let rawResponse = "";
    let visibleResponse = "";
    let errorViewModel = null;
    let llmDiagnostic = null;
    const taskFileContext = resolveTaskFileContext(input.rawMessage);
    const effectiveMessage = taskFileContext.effectiveMessage;
    const explicitFormalDebugRequest = shouldStartDebuggerFromMessage(effectiveMessage);
    const explicitDebuggerRequest = input.requestedMode === "debugger" && explicitFormalDebugRequest;
    const askModeFormalDebugRequest = input.requestedMode === "ask" && explicitFormalDebugRequest;
    const explicitDebuggerCaptureGuard = explicitDebuggerRequest ? resolveCaptureGuards(effectiveMessage, input.context) : null;
    const askModeCaptureGuard = askModeFormalDebugRequest ? resolveCaptureGuards(effectiveMessage, input.context) : null;
    const routePreflight = conversationAgentId === "ask_agent" ? resolveAgentRoutePreflight("ask_agent", "rdc-debugger") : resolveDebuggerRoutePreflight();
    if (askModeFormalDebugRequest) {
      rawResponse = [
        askModeCaptureGuard?.ready ? "当前 Ask 不会直接创建正式 run。Capture 已经 Open；如需执行，请切换到 Debugger 后发送，我会先生成执行前计划。" : askModeCaptureGuard?.reason || "正式 Debugger 执行需要先在应用内 Open 一个 .rdc Capture。",
        '<control>{"intent":"intake","safe_to_start":false,"needs_capture":true}</control>'
      ].join("\n");
      visibleResponse = stripControlBlock(rawResponse);
      commitVisibleAssistantText();
      commitAssistantMessage("message_patched", {
        ...withCoworkReasoning(upsertTraceStep(assistantMessage.reasoningTrace, "cowork-reply", {
          status: "complete",
          summary: "Ask 模式保留为非执行入口，已提示用户通过 Open 和 Debugger 模式进入计划。",
          completedAt: nowMs()
        }))
      });
    } else if (explicitDebuggerRequest && explicitDebuggerCaptureGuard && !explicitDebuggerCaptureGuard.ready) {
      rawResponse = [
        explicitDebuggerCaptureGuard.reason || "正式 Debugger 执行需要先在应用内 Open 一个 .rdc Capture。",
        '<control>{"intent":"intake","safe_to_start":false,"needs_capture":true}</control>'
      ].join("\n");
      visibleResponse = stripControlBlock(rawResponse);
      commitVisibleAssistantText();
      commitAssistantMessage("message_patched", {
        ...withCoworkReasoning(upsertTraceStep(assistantMessage.reasoningTrace, "cowork-reply", {
          status: "complete",
          summary: "已拦截正式 Debugger 请求，等待应用内 Open capture。",
          completedAt: nowMs()
        }))
      });
    } else if (explicitDebuggerRequest && !routePreflight.ok && routePreflight.diagnostic.code !== "CONVERSATION_LLM_ROUTE_MISSING") {
      llmDiagnostic = routePreflight.diagnostic;
      errorViewModel = {
        code: llmDiagnostic.code,
        message: llmDiagnostic.userMessage,
        technicalMessage: llmDiagnostic.technicalMessage
      };
      rawResponse = llmDiagnostic.userMessage;
      visibleResponse = llmDiagnostic.userMessage;
      recordCoworkLlmDiagnostic(input.context, llmDiagnostic);
      commitVisibleAssistantText();
    } else if (explicitDebuggerRequest) {
      if (!routePreflight.ok) {
        llmDiagnostic = routePreflight.diagnostic;
        recordCoworkLlmDiagnostic(input.context, llmDiagnostic);
      }
      rawResponse = [
        "已识别为 Debugger 执行请求。我会先生成执行前计划，等待你确认后再进入正式调试。",
        '<control>{"intent":"execute","safe_to_start":true}</control>'
      ].join("\n");
      visibleResponse = stripControlBlock(rawResponse);
      commitVisibleAssistantText();
      commitAssistantMessage("message_patched", {
        ...withCoworkReasoning(upsertTraceStep(assistantMessage.reasoningTrace, "cowork-reply", {
          status: "complete",
          summary: "已识别为正式 Debugger 任务，准备生成执行前计划。",
          completedAt: nowMs()
        }))
      });
    } else if (!routePreflight.ok) {
      llmDiagnostic = routePreflight.diagnostic;
      errorViewModel = {
        code: llmDiagnostic.code,
        message: llmDiagnostic.userMessage,
        technicalMessage: llmDiagnostic.technicalMessage
      };
      rawResponse = llmDiagnostic.userMessage;
      visibleResponse = llmDiagnostic.userMessage;
      recordCoworkLlmDiagnostic(input.context, llmDiagnostic);
      commitVisibleAssistantText();
    } else {
      try {
        if (showCoworkReasoning) {
          commitAssistantMessage("message_patched", {
            reasoningTrace: upsertTraceStep(assistantMessage.reasoningTrace, "cowork-reply", {
              status: "running",
              summary: input.requestedMode === "ask" ? `正在通过 ${routePreflight.providerId}/${routePreflight.modelId} 生成只读协作回复。` : `正在通过 ${routePreflight.providerId}/${routePreflight.modelId} 生成协作回复。`,
              startedAt: nowMs()
            })
          });
        }
        const coworkPrompt = buildCoworkPrompt(
          input.context,
          history,
          input.requestedMode,
          input.rawMessage,
          input.importedAttachments
        );
        const responseText = await agentOrchestrator.sendCoworkMessage(
          conversationAgentId,
          input.rawMessage,
          {
            sessionId: input.context.session?.sessionId,
            turnId: assistantMessage.turnId,
            stage: "cowork",
            patternId: input.requestedMode === "debugger" ? "plan-generate-verify" : "free-agent",
            systemPrompt: conversationAgentId === "ask_agent" ? buildAskSystemPrompt() : buildDebuggerCoworkSystemPrompt(),
            maxTokens: 1200,
            temperature: 0.35,
            signal: abortController.signal,
            promptOverride: coworkPrompt,
            onEvent: (event) => {
              this.emitConversationEvent({
                type: "agent_event",
                sessionId: sessionId ?? "",
                turnId: assistantMessage.turnId,
                event
              });
              if (event.type === "assistant.delta") {
                const chunk = typeof event.payload.text === "string" ? event.payload.text : "";
                rawResponse += chunk;
                const nextVisible = computeVisibleAssistantText(rawResponse);
                if (nextVisible.length > visibleResponse.length) {
                  visibleResponse = nextVisible;
                  commitVisibleAssistantText();
                }
              }
              if (event.type === "diagnostic") {
                const payload = event.payload;
                const summary = typeof payload.message === "string" && payload.message ? payload.message : "收到运行时诊断。";
                commitAssistantMessage("message_patched", {
                  reasoningTrace: upsertTraceStep(assistantMessage.reasoningTrace, `cowork-diagnostic-${payload.code ?? "runtime"}`, {
                    status: payload.severity === "error" ? "error" : "complete",
                    title: "运行时诊断",
                    summary,
                    completedAt: nowMs()
                  })
                });
              }
              if (event.type === "tool.started") {
                commitAssistantMessage("message_patched", {
                  reasoningTrace: upsertRuntimeToolCall(assistantMessage.reasoningTrace, {
                    id: String(event.payload.toolCallId),
                    toolName: String(event.payload.toolName),
                    status: "running",
                    argsPreview: JSON.stringify(event.payload.args ?? {}).slice(0, 600),
                    startedAt: nowMs()
                  })
                });
              }
              if (event.type === "tool.denied") {
                const reason = typeof event.payload.reason === "string" ? event.payload.reason : "Ask 只读策略拒绝了该工具调用。";
                commitAssistantMessage("message_patched", {
                  reasoningTrace: upsertRuntimeToolCall(assistantMessage.reasoningTrace, {
                    id: String(event.payload.toolCallId),
                    toolName: String(event.payload.toolName),
                    status: "error",
                    resultPreview: JSON.stringify(event.payload.result ?? { reason }).slice(0, 800),
                    error: reason,
                    completedAt: nowMs()
                  })
                });
              }
              if (event.type === "tool.completed") {
                const result = event.payload.result;
                commitAssistantMessage("message_patched", {
                  reasoningTrace: upsertRuntimeToolCall(assistantMessage.reasoningTrace, {
                    id: String(event.payload.toolCallId),
                    toolName: String(event.payload.toolName),
                    status: result?.ok ? "complete" : "error",
                    resultPreview: JSON.stringify(event.payload.result ?? {}).slice(0, 800),
                    error: result?.ok ? void 0 : result?.error?.message,
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
        recordCoworkLlmDiagnostic(input.context, llmDiagnostic);
        commitVisibleAssistantText();
      }
    }
    if (abortController.signal.aborted) {
      this.clearActiveTurn(assistantMessage.turnId, abortController);
      return;
    }
    const assistantContent = stripControlBlock(rawResponse);
    visibleResponse = assistantContent;
    const control = parseControlBlock(rawResponse);
    const isRouteMissingDiagnostic = llmDiagnostic?.code === "CONVERSATION_LLM_ROUTE_MISSING";
    let finalStatus = errorViewModel && !isRouteMissingDiagnostic ? "error" : "complete";
    let traceStatus = errorViewModel && !isRouteMissingDiagnostic ? "error" : "complete";
    commitAssistantMessage("message_patched", {
      content: `${visibleResponse}${systemAppendix}`,
      diagnostic: llmDiagnostic,
      ...withCoworkReasoning(upsertTraceStep(assistantMessage.reasoningTrace, "cowork-route", {
        status: "complete",
        summary: llmDiagnostic ? `模型链路诊断完成：${llmDiagnostic.providerId ? `${llmDiagnostic.providerId}${llmDiagnostic.modelId ? `/${llmDiagnostic.modelId}` : ""}` : "缺少 route"}。` : "上下文检查完成。",
        completedAt: nowMs()
      }))
    });
    if (abortController.signal.aborted) {
      this.clearActiveTurn(assistantMessage.turnId, abortController);
      return;
    }
    if (!input.context.projectId && EXECUTE_PATTERN.test(effectiveMessage)) {
      const boundaryReply = "我可以先帮你梳理问题，不过正式调试要先选一个项目。选好项目后，你可以继续描述现象，或者直接打开一个 .rdc capture。";
      commitAssistantMessage("message_completed", {
        status: "complete",
        content: boundaryReply,
        ...withCoworkReasoning(finalizeTrace(
          upsertTraceStep(
            upsertTraceStep(assistantMessage.reasoningTrace, "cowork-route", {
              status: "complete",
              summary: "当前还没有可用项目。",
              completedAt: nowMs()
            }),
            "cowork-upgrade",
            {
              title: "升级到正式调试",
              stage: "plan",
              status: "complete",
              summary: "已拦截正式调试请求，等待选择项目。",
              completedAt: nowMs()
            }
          ),
          "complete",
          "等待选择项目"
        ))
      });
      this.clearActiveTurn(assistantMessage.turnId, abortController);
      return;
    }
    const shouldUpgradeByControl = input.requestedMode === "debugger" && control?.intent === "execute" && control.safe_to_start;
    const shouldUpgradeByRequest = !errorViewModel && explicitDebuggerRequest && explicitDebuggerCaptureGuard?.ready === true;
    if (shouldUpgradeByControl || shouldUpgradeByRequest) {
      commitAssistantMessage("message_patched", {
        reasoningTrace: upsertTraceStep(assistantMessage.reasoningTrace, "cowork-upgrade", {
          title: "升级到正式调试",
          stage: "plan",
          status: "running",
          summary: "正在准备正式调试计划。",
          startedAt: nowMs()
        })
      });
      if (!input.context.projectId) {
        appendSystemAppendix(`

我可以先帮你梳理问题，不过正式调试要先选一个项目。选好项目后，你可以继续描述现象，或者直接打开一个 .rdc capture。`);
      } else {
        const captureGuard = resolveCaptureGuards(effectiveMessage, input.context);
        if (!captureGuard.ready) {
          appendSystemAppendix(`

${captureGuard.reason || "当前还不能进入正式分析。"}`);
        } else if (!hasUsableDebuggerRoute()) {
          appendSystemAppendix("\n\n当前调试链路还没绑定可用模型，所以我不能开始正式执行；不过我可以先帮你确认问题范围和所需 capture。");
        } else {
          if (abortController.signal.aborted) {
            this.clearActiveTurn(assistantMessage.turnId, abortController);
            return;
          }
          const requestedCapture = resolveOpenedCaptureDescriptor(input.context);
          const workflowResult = await debuggerRuntime.requestStartFromConversation({
            source: "conversation",
            message: assistantMessage,
            projectId: input.context.projectId,
            sessionId: input.context.session?.sessionId,
            turnId: assistantMessage.turnId,
            mode: "debugger",
            goal: input.rawMessage,
            captures: requestedCapture ? [requestedCapture] : void 0,
            primaryCaptureId: requestedCapture?.id,
            replayDevice: input.context.replayDevice
          });
          if (abortController.signal.aborted) {
            this.clearActiveTurn(assistantMessage.turnId, abortController);
            return;
          }
          const upgradeReply = buildWorkflowUpgradeReply(workflowResult);
          appendSystemAppendix(`

${upgradeReply}`);
          if (workflowResult.runId) {
            commitAssistantMessage("message_patched", {
              runId: workflowResult.runId
            });
            this.emitConversationEvent({
              type: "run_linked",
              sessionId: input.context.session?.sessionId ?? "",
              turnId: assistantMessage.turnId,
              runId: workflowResult.runId
            });
          }
        }
      }
      commitAssistantMessage("message_patched", {
        reasoningTrace: upsertTraceStep(assistantMessage.reasoningTrace, "cowork-upgrade", {
          status: "complete",
          summary: "正式调试升级判断已完成。",
          completedAt: nowMs()
        })
      });
    }
    commitAssistantMessage(finalStatus === "error" ? "message_errored" : "message_completed", {
      status: finalStatus,
      content: `${assistantContent}${systemAppendix}`,
      diagnostic: llmDiagnostic,
      ...withCoworkReasoning(finalizeTrace(
        upsertTraceStep(assistantMessage.reasoningTrace, "cowork-reply", {
          status: errorViewModel && !isRouteMissingDiagnostic ? "error" : "complete",
          summary: llmDiagnostic ? llmDiagnostic.code === "CONVERSATION_LLM_REQUEST_FAILED" ? "模型请求失败，已记录诊断。" : "模型链路不可用，已给出配置诊断。" : explicitDebuggerRequest ? "正式 Debugger 任务入口判断已完成。" : "协作回复已完成。",
          detail: llmDiagnostic?.technicalMessage,
          completedAt: nowMs()
        }),
        traceStatus,
        llmDiagnostic ? finalStatus === "error" ? "回复失败" : "等待模型配置" : explicitDebuggerRequest ? "已完成执行入口判断" : "回复已完成"
      ))
    });
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
}
const conversationService = new ConversationService();
function registerConversationHandlers(context2) {
  const { state: state2 } = context2;
  electron.ipcMain.handle("conversation:sendMessage", async (_event, request) => {
    const result = await conversationService.sendMessage({
      ...request,
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
      return { messages: [] };
    }
    return {
      messages: await conversationService.getHistory(sessionId)
    };
  });
  electron.ipcMain.handle("conversation:cancelActiveTurn", async (_event, request) => {
    return conversationService.cancelActiveTurn(request);
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
  electron.ipcMain.handle("runtimeLog:list", async (_event, request) => {
    return {
      entries: runtimeLogService.list(request.scope, request.sessionId)
    };
  });
  electron.ipcMain.handle("terminal:listTabs", async () => {
    return {
      tabs: terminalSessionService.listTabs()
    };
  });
  electron.ipcMain.handle("terminal:createTab", async (_event, request) => {
    try {
      const tab = terminalSessionService.createTab(request);
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
  async testProviderDraft(request) {
    try {
      const provider = this.getProvider(request.providerId);
      const models = await this.discoverModels(
        provider,
        request.apiKey?.trim() ?? "",
        request.baseUrl?.trim() ?? ""
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
  async connectProvider(request) {
    try {
      const provider = this.getProvider(request.providerId);
      const apiKey = request.apiKey?.trim() ?? "";
      const baseUrl = request.baseUrl?.trim() ?? "";
      const models = await this.discoverModels(provider, apiKey, baseUrl);
      const nextSettings = settingsService.saveProviderConnection(provider.id, apiKey, models, baseUrl);
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
      const nextSettings = settingsService.saveProviderConnection(provider.id, "", models, "");
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
  startProviderAccountLogin(providerId) {
    return providerAccountAuthService.startLogin(providerId);
  }
  finishProviderAccountLogin(request) {
    return providerAccountAuthService.finishLogin(request);
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
  async discoverModels(provider, apiKeyDraft, baseUrlDraft) {
    if (provider.authMode === "account") {
      throw new ProviderConnectionError("Account providers must be tested through the account login flow.");
    }
    const definition = getBuiltinProviderDefinition(provider.id);
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
    if (provider.id === "kimi-code") {
      return this.validateKimiCodeModels(apiKey, baseUrl, definition.recommendedModels);
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
  async validateKimiCodeModels(apiKey, baseUrl, modelIds) {
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
    if (provider.kind === "anthropic") {
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
  electron.ipcMain.handle("llm:testProviderDraft", async (_event, request) => {
    return providerConnectionService.testProviderDraft(request);
  });
  electron.ipcMain.handle("llm:connectProvider", async (_event, request) => {
    const result = await providerConnectionService.connectProvider(request);
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
  electron.ipcMain.handle("llm:startProviderAccountLogin", async (_event, providerId) => {
    return providerConnectionService.startProviderAccountLogin(providerId);
  });
  electron.ipcMain.handle("llm:getProviderAccountStatus", async (_event, providerId) => {
    const result = providerConnectionService.getProviderAccountStatus(providerId);
    if (result.connected) {
      context2.applyCurrentLlmConfig();
    }
    return result;
  });
  electron.ipcMain.handle("llm:finishProviderAccountLogin", async (_event, request) => {
    const result = await providerConnectionService.finishProviderAccountLogin(request);
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
  electron.ipcMain.handle("settings:getProviderSecret", async (_event, providerId) => {
    const paths = appPathService.getWorkspacePaths();
    return settingsService.getProviderSecret(providerId, paths.workspaceRoot);
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
  electron.ipcMain.handle("workflow:getRunUsage", async (_event, runId) => {
    const targetRunId = runId || state2.currentRunId;
    if (!targetRunId) {
      return { usage: null };
    }
    return {
      usage: debuggerLlmService.getRunContextUsage(targetRunId)
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
  electron.ipcMain.handle("workflow:start", async (_event, request) => {
    const result = await debuggerRuntime.startPlan(request);
    if (result.success) {
      state2.currentSessionId = result.sessionId || state2.currentSessionId;
      state2.currentRunId = result.runId || state2.currentRunId;
      state2.currentProjectId = request.projectId;
      if (state2.currentSessionId) {
        await storageAdapter.setCurrentSessionId(state2.currentSessionId);
      }
    }
    return result;
  });
  electron.ipcMain.handle("workflow:getPlan", async (_event, runId) => {
    return debuggerRuntime.getPlan(runId);
  });
  electron.ipcMain.handle("workflow:submitQuestions", async (_event, runId, answers) => {
    return debuggerRuntime.submitQuestions(runId, answers);
  });
  electron.ipcMain.handle("workflow:approvePlan", async (_event, runId) => {
    return debuggerRuntime.approvePlan(runId);
  });
  electron.ipcMain.handle("workflow:requestPlanRevision", async (_event, runId, revisionText) => {
    const result = await debuggerRuntime.requestPlanRevision(runId, revisionText);
    if (result.success) {
      state2.currentSessionId = result.presentation?.sessionId || state2.currentSessionId;
      state2.currentRunId = result.runId || state2.currentRunId;
      if (state2.currentSessionId) {
        await storageAdapter.setCurrentSessionId(state2.currentSessionId);
      }
    }
    return result;
  });
  electron.ipcMain.handle("workflow:restartRun", async (_event, runId) => {
    const result = await debuggerRuntime.restartRun(runId);
    if (result.success) {
      state2.currentSessionId = result.sessionId || state2.currentSessionId;
      state2.currentRunId = result.runId || state2.currentRunId;
      if (state2.currentSessionId) {
        await storageAdapter.setCurrentSessionId(state2.currentSessionId);
      }
    }
    return result;
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
        agentId: trace.runtimeOwner || "rdc-debugger",
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
const emptyPreviewLoadResult = () => ({
  preview: null,
  error: null,
  attempts: []
});
class RdxSessionService {
  rdxCliInvoker;
  contextId = null;
  runtimeOwner = null;
  ownerLeaseId = null;
  captures = [];
  activeCaptureId = null;
  deviceLabel = "Local";
  replayDevice = null;
  remoteStatus = "disconnected";
  remoteId = null;
  openedCapture = null;
  humanPreview = {
    status: "closed",
    updatedAt: Date.now()
  };
  constructor(rdxCliInvoker) {
    this.rdxCliInvoker = rdxCliInvoker;
  }
  async bootstrap(request) {
    const requestedCaptures = request.captures ?? [];
    const requestedReplayDevice = request.replayDevice ?? null;
    if (this.canReuseOpenedCapture(request)) {
      this.captures = requestedCaptures.map((capture) => capture.id === request.primaryCaptureId && this.openedCapture ? {
        ...capture,
        captureFileId: this.openedCapture.captureFileId,
        status: "open",
        sessionId: this.openedCapture.sessionId,
        replaySessionId: this.openedCapture.replaySessionId,
        contextId: this.openedCapture.contextId
      } : { ...capture });
      this.activeCaptureId = request.primaryCaptureId || null;
      return this.snapshotContext();
    }
    if (this.contextId || this.captures.length > 0 || this.openedCapture) {
      await this.closeOrReplaceOpenedCapture();
    }
    await this.ensureRuntimeReady();
    this.captures = requestedCaptures.map((capture) => ({ ...capture }));
    this.remoteId = null;
    this.remoteStatus = "disconnected";
    const hasRemoteCapture = this.captures.some((capture) => capture.backendHint === "remote");
    let replayDevice = requestedReplayDevice;
    let reusedPreparedRemote = false;
    if (hasRemoteCapture) {
      if (!replayDevice || replayDevice.type === "local") {
        throw new Error("Remote capture requires an Android Replay Device.");
      }
      replayDevice = await this.ensureReplayDeviceReady(replayDevice);
      reusedPreparedRemote = await this.tryAdoptPreparedRemote(replayDevice);
    }
    if (!replayDevice) {
      throw new Error("Replay Device is required before bootstrap.");
    }
    this.replayDevice = replayDevice;
    this.deviceLabel = replayDevice.label;
    if (!reusedPreparedRemote) {
      await this.prepareFreshContext();
    }
    try {
      const ownerResult = await this.claimOwner(this.contextId);
      this.runtimeOwner = ownerResult.owner;
      this.ownerLeaseId = ownerResult.leaseId;
    } catch (error) {
      if (!reusedPreparedRemote) {
        throw error;
      }
      this.resetRemoteConnectionState();
      await this.prepareFreshContext();
      const ownerResult = await this.claimOwner(this.contextId);
      this.runtimeOwner = ownerResult.owner;
      this.ownerLeaseId = ownerResult.leaseId;
      reusedPreparedRemote = false;
    }
    if (hasRemoteCapture) {
      if (reusedPreparedRemote) {
        const preparedRemoteStillValid = await this.validatePreparedRemoteHandle();
        if (!preparedRemoteStillValid) {
          this.remoteId = null;
          this.remoteStatus = "disconnected";
          await this.ensureRemoteConnection(replayDevice);
        } else {
          this.remoteStatus = "online";
        }
      } else {
        await this.ensureRemoteConnection(replayDevice);
      }
    }
    const primaryCapture = this.captures.find((capture) => capture.id === request.primaryCaptureId);
    if (!primaryCapture) {
      throw new Error(`Primary capture ${request.primaryCaptureId} not found in captures list`);
    }
    await this.ensureCaptureSession(primaryCapture);
    this.activeCaptureId = primaryCapture.id;
    this.openedCapture = null;
    return this.snapshotContext();
  }
  async openProjectInput(request) {
    await this.closeOrReplaceOpenedCapture();
    await this.ensureRuntimeReady();
    let replayDevice = request.replayDevice;
    const isRemoteReplay = replayDevice.type === "android";
    if (isRemoteReplay) {
      replayDevice = await this.ensureReplayDeviceReady(replayDevice);
    }
    const capture = {
      id: request.inputId,
      filePath: request.filePath,
      role: "primary",
      backendHint: isRemoteReplay ? "remote" : "local",
      status: "pending"
    };
    this.captures = [capture];
    this.activeCaptureId = capture.id;
    this.replayDevice = replayDevice;
    this.deviceLabel = replayDevice.label;
    this.remoteId = null;
    this.remoteStatus = "disconnected";
    let reusedPreparedRemote = false;
    if (isRemoteReplay) {
      reusedPreparedRemote = await this.tryAdoptPreparedRemote(replayDevice);
    }
    if (!reusedPreparedRemote) {
      await this.prepareFreshContext();
    }
    try {
      const ownerResult = await this.claimOwner(this.contextId);
      this.runtimeOwner = ownerResult.owner;
      this.ownerLeaseId = ownerResult.leaseId;
    } catch (error) {
      if (!reusedPreparedRemote) {
        throw error;
      }
      this.resetRemoteConnectionState();
      await this.prepareFreshContext();
      const ownerResult = await this.claimOwner(this.contextId);
      this.runtimeOwner = ownerResult.owner;
      this.ownerLeaseId = ownerResult.leaseId;
      reusedPreparedRemote = false;
    }
    if (isRemoteReplay) {
      if (reusedPreparedRemote) {
        const preparedRemoteStillValid = await this.validatePreparedRemoteHandle();
        if (!preparedRemoteStillValid) {
          this.remoteId = null;
          this.remoteStatus = "disconnected";
          await this.ensureRemoteConnection(replayDevice);
        } else {
          this.remoteStatus = "online";
        }
      } else {
        await this.ensureRemoteConnection(replayDevice);
      }
    }
    const previewResult = await this.ensureCaptureSession(capture, {
      projectId: request.projectId,
      inputId: request.inputId
    });
    const openedCapture = this.createOpenedCaptureState(
      request.projectId,
      request.inputId,
      request.filePath,
      replayDevice,
      previewResult
    );
    this.openedCapture = openedCapture;
    return openedCapture;
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
  async openHumanPreviewWindow(request = {}) {
    const replaySessionId = request.sessionId || this.snapshotContext().sessionId;
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
    const result = await this.rdxCliInvoker.call({
      toolName: "rd.session.open_preview",
      args: {
        session_id: replaySessionId,
        context_id: this.contextId,
        runtime_owner: this.runtimeOwner,
        owner_lease_id: this.ownerLeaseId
      },
      contextId: this.contextId,
      runtimeOwner: this.runtimeOwner,
      ownerLeaseId: this.ownerLeaseId
    });
    if (!result.ok) {
      const message = result.error?.message ?? "rd.session.open_preview failed.";
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
    this.setHumanPreview(this.extractHumanPreview(result, "open", replaySessionId));
    return this.snapshotContext();
  }
  async closeHumanPreviewWindow() {
    if (!this.contextId || !this.runtimeOwner || !this.ownerLeaseId) {
      this.setHumanPreview({ status: "closed" });
      return this.snapshotContext();
    }
    const result = await this.rdxCliInvoker.call({
      toolName: "rd.session.close_preview",
      args: {
        context_id: this.contextId,
        runtime_owner: this.runtimeOwner,
        owner_lease_id: this.ownerLeaseId
      },
      contextId: this.contextId,
      runtimeOwner: this.runtimeOwner,
      ownerLeaseId: this.ownerLeaseId
    });
    if (!result.ok) {
      const message = result.error?.message ?? "rd.session.close_preview failed.";
      this.setHumanPreview({
        status: "error",
        sessionId: this.humanPreview.sessionId,
        boundEventId: this.humanPreview.boundEventId,
        lastError: message
      });
      runtimeLogService.log({
        scope: "app",
        namespace: "context",
        severity: "warning",
        title: "Human preview close warning",
        summary: message,
        raw: { result }
      });
      return this.snapshotContext();
    }
    this.setHumanPreview(this.extractHumanPreview(result, "closed", this.humanPreview.sessionId));
    return this.snapshotContext();
  }
  async prepareFreshContext() {
    this.contextId = await this.allocateContext();
    await this.initializeContextRuntime();
  }
  async ensureRuntimeReady() {
    const statusResult = await this.rdxCliInvoker.executeCLI("daemon", ["status"]);
    if (statusResult.exitCode === 0) {
      try {
        const parsed = JSON.parse(statusResult.stdout);
        if (parsed.data?.running === true) {
          return;
        }
      } catch {
        return;
      }
    }
    const startResult = await this.rdxCliInvoker.executeCLI("daemon", ["start"]);
    if (startResult.exitCode !== 0) {
      const message = startResult.stderr.trim() || `Exit code: ${startResult.exitCode}`;
      throw new Error(`Failed to start rdx daemon: ${message}`);
    }
  }
  async allocateContext() {
    const contextId = `ctx-${generateShortId()}`;
    let result = await this.rdxCliInvoker.call({
      toolName: "rd.session.create_context",
      args: { context_id: contextId },
      contextId
    });
    if (!result.ok) {
      if (result.error?.message?.includes("Context limit exceeded")) {
        const daemonCleaned = await this.cleanupDaemonRuntimeState();
        if (daemonCleaned) {
          result = await this.rdxCliInvoker.call({
            toolName: "rd.session.create_context",
            args: { context_id: contextId },
            contextId
          });
          if (result.ok) {
            return contextId;
          }
        }
        const cleanedCount = await this.cleanupStaleRdcAgentContexts();
        if (cleanedCount > 0) {
          result = await this.rdxCliInvoker.call({
            toolName: "rd.session.create_context",
            args: { context_id: contextId },
            contextId
          });
          if (result.ok) {
            return contextId;
          }
        }
      }
      throw new Error(`Failed to allocate context: ${result.error?.message ?? "unknown"}`);
    }
    return contextId;
  }
  async initializeContextRuntime() {
    const result = await this.rdxCliInvoker.call({
      toolName: "rd.core.init",
      args: {},
      contextId: this.contextId
    });
    if (!result.ok) {
      throw new Error(`Failed to initialize runtime context: ${result.error?.message ?? "unknown"}`);
    }
  }
  async claimOwner(contextId) {
    const owner = `rdc-agent-${generateShortId()}`;
    const result = await this.rdxCliInvoker.call({
      toolName: "rd.session.claim_runtime_owner",
      args: {
        runtime_owner: owner,
        entry_mode: "cli",
        backend: "local"
      },
      contextId
    });
    if (!result.ok) {
      throw new Error(`Failed to claim owner: ${result.error?.message ?? "unknown"}`);
    }
    const ownerInfo = result.data?.runtime_owner || result.data?.owner_lease;
    const leaseId = typeof ownerInfo?.lease_id === "string" && ownerInfo.lease_id ? ownerInfo.lease_id : generateId();
    const resolvedOwner = typeof ownerInfo?.agent_id === "string" && ownerInfo.agent_id ? ownerInfo.agent_id : owner;
    return { owner: resolvedOwner, leaseId };
  }
  buildClaimedToolRequest(toolName, args) {
    return {
      toolName,
      args,
      contextId: this.contextId,
      runtimeOwner: this.runtimeOwner,
      ownerLeaseId: this.ownerLeaseId ?? void 0
    };
  }
  async ensureCaptureSession(capture, previewContext) {
    const captureIndex = this.captures.findIndex((item) => item.id === capture.id);
    if (captureIndex < 0) {
      throw new Error(`Capture ${capture.id} not in captures list`);
    }
    this.captures[captureIndex] = { ...this.captures[captureIndex], status: "opening" };
    try {
      const openResult = await this.rdxCliInvoker.call(this.buildClaimedToolRequest(
        "rd.capture.open_file",
        { file_path: capture.filePath }
      ));
      if (!openResult.ok) {
        throw new Error(`Failed to open capture file: ${openResult.error?.message ?? "unknown"}`);
      }
      const captureFileId = openResult.data?.capture_file_id;
      const replayArgs = {
        capture_file_id: captureFileId ?? capture.id
      };
      if (capture.backendHint === "remote") {
        if (!this.remoteId) {
          throw new Error("Remote replay requested but remote connection is not ready.");
        }
        replayArgs.options = {
          remote_id: this.remoteId
        };
      }
      const replayResult = await this.rdxCliInvoker.call(this.buildClaimedToolRequest(
        "rd.capture.open_replay",
        replayArgs
      ));
      if (!replayResult.ok) {
        if (capture.backendHint === "remote") {
          throw new Error(`Remote replay failed (hard fail, no local fallback): ${replayResult.error?.message ?? "unknown"}`);
        }
        throw new Error(`Failed to open replay session: ${replayResult.error?.message ?? "unknown"}`);
      }
      this.captures[captureIndex] = {
        ...this.captures[captureIndex],
        captureFileId,
        status: "open",
        sessionId: replayResult.data?.session_id,
        replaySessionId: replayResult.data?.replay_session_id,
        contextId: this.contextId
      };
      if (!previewContext || !captureFileId) {
        return emptyPreviewLoadResult();
      }
      return this.loadPreferredPreview(
        previewContext.projectId,
        previewContext.inputId,
        this.captures[captureIndex].sessionId ?? "",
        captureFileId
      );
    } catch (error) {
      this.captures[captureIndex] = { ...this.captures[captureIndex], status: "error" };
      throw error;
    }
  }
  async switchActiveCapture(captureId) {
    const capture = this.captures.find((item) => item.id === captureId);
    if (!capture) {
      throw new Error(`Capture ${captureId} not found`);
    }
    if (capture.status === "pending") {
      await this.ensureCaptureSession(capture);
    }
    this.activeCaptureId = captureId;
  }
  async ensureRemoteConnection(device) {
    if (!device.serial) {
      throw new Error("Replay Device is missing an Android serial number.");
    }
    this.replayDevice = device;
    this.remoteStatus = "connected";
    const connectResult = await this.rdxCliInvoker.call(this.buildClaimedToolRequest(
      "rd.remote.connect",
      {
        timeout_ms: 5e3,
        options: {
          transport: "adb_android",
          device_serial: device.serial
        }
      }
    ));
    if (!connectResult.ok) {
      this.remoteStatus = "error";
      const detail = [
        device.activationPhase ? `phase=${device.activationPhase}` : "",
        device.activationErrorCode ? `code=${device.activationErrorCode}` : ""
      ].filter(Boolean).join(" ");
      const suffix = detail ? ` (${detail})` : "";
      throw new Error(`Remote connect failed (hard fail): ${connectResult.error?.message ?? device.activationErrorMessage ?? "unknown"}${suffix}`);
    }
    const remoteId = connectResult.data?.remote_id;
    if (!remoteId) {
      this.remoteStatus = "error";
      throw new Error("Remote connect did not return a remote_id.");
    }
    this.remoteId = remoteId;
    const pingResult = await this.rdxCliInvoker.call(this.buildClaimedToolRequest(
      "rd.remote.ping",
      { remote_id: remoteId }
    ));
    if (!pingResult.ok) {
      this.remoteStatus = "error";
      throw new Error(`Remote ping failed (hard fail): ${pingResult.error?.message ?? device.activationErrorMessage ?? "unknown"}`);
    }
    this.remoteStatus = "online";
  }
  async ensureReplayDeviceReady(device) {
    if (device.type === "local") {
      return device;
    }
    const currentDevice = replayDeviceService.getDeviceById(device.id) ?? device;
    if (currentDevice.type === "local") {
      return currentDevice;
    }
    if (["connected", "online"].includes(currentDevice.status)) {
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
  async tryAdoptPreparedRemote(device) {
    const prepared = replayDeviceService.consumePreparedRemote(device.id);
    if (!prepared) {
      return false;
    }
    if (!device.serial || prepared.serial !== device.serial) {
      replayDeviceService.invalidatePreparedRemote(device.id);
      return false;
    }
    this.adoptPreparedRemote(prepared);
    return true;
  }
  adoptPreparedRemote(prepared) {
    this.contextId = prepared.contextId;
    this.remoteId = prepared.remoteId;
    this.remoteStatus = "connected";
  }
  async validatePreparedRemoteHandle() {
    if (!this.contextId || !this.remoteId) {
      return false;
    }
    const pingResult = await this.rdxCliInvoker.call({
      toolName: "rd.remote.ping",
      args: { remote_id: this.remoteId },
      contextId: this.contextId,
      runtimeOwner: this.runtimeOwner ?? void 0,
      ownerLeaseId: this.ownerLeaseId ?? void 0
    });
    if (!pingResult.ok) {
      return false;
    }
    return true;
  }
  resetRemoteConnectionState() {
    this.contextId = null;
    this.runtimeOwner = null;
    this.ownerLeaseId = null;
    this.remoteId = null;
    this.remoteStatus = "disconnected";
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
      humanPreview: { ...this.humanPreview }
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
      previewAttempts: previewResult.attempts
    };
  }
  async loadPreferredPreview(projectId, inputId, sessionId, captureFileId) {
    const attempts = [];
    const framebufferPreview = sessionId ? await this.loadFramebufferPreview(projectId, inputId, sessionId, attempts) : null;
    if (framebufferPreview) {
      runtimeLogService.log({
        scope: "app",
        namespace: "capture",
        severity: "success",
        title: "Preview ready",
        summary: `已加载 ${inputId} 的最终渲染预览。`,
        detail: framebufferPreview.width > 0 && framebufferPreview.height > 0 ? `${framebufferPreview.width}x${framebufferPreview.height} · framebuffer · event=${framebufferPreview.resolvedEventId ?? "-"} · target=${framebufferPreview.targetSource ?? "-"}` : `framebuffer · event=${framebufferPreview.resolvedEventId ?? "-"} · target=${framebufferPreview.targetSource ?? "-"}`,
        projectId,
        raw: { preview: framebufferPreview, attempts }
      });
      return { preview: framebufferPreview, error: null, attempts };
    }
    const thumbnailPreview = await this.loadCaptureThumbnail(captureFileId, attempts);
    if (thumbnailPreview) {
      runtimeLogService.log({
        scope: "app",
        namespace: "capture",
        severity: "warning",
        title: "Preview fallback",
        summary: `最终 framebuffer 不可用，已回退为 ${inputId} 的 capture thumbnail。`,
        detail: thumbnailPreview.width > 0 && thumbnailPreview.height > 0 ? `${thumbnailPreview.width}x${thumbnailPreview.height} · thumbnail` : "thumbnail",
        projectId,
        raw: { preview: thumbnailPreview, attempts }
      });
      return { preview: thumbnailPreview, error: null, attempts };
    }
    const error = this.createPreviewError(attempts);
    runtimeLogService.log({
      scope: "app",
      namespace: "capture",
      severity: "warning",
      title: "Preview unavailable",
      summary: `已打开 ${inputId}，但当前没有可用预览内容：${error.message}`,
      projectId,
      raw: { error, attempts }
    });
    return { preview: null, error, attempts };
  }
  async loadFramebufferPreview(projectId, inputId, sessionId, attempts) {
    const outputPath = appPathService.getCapturePreviewPath(projectId, inputId);
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    const swapchainPreview = await this.loadFramebufferPreviewAtEvent(
      sessionId,
      outputPath,
      attempts,
      void 0,
      "swapchain"
    );
    if (swapchainPreview) {
      return swapchainPreview;
    }
    const candidateEventIds = await this.listPreviewCandidateEvents(sessionId);
    const eventAttempts = candidateEventIds.slice().reverse().filter((eventId, index, values) => values.indexOf(eventId) === index);
    for (const eventId of eventAttempts) {
      const preview = await this.loadFramebufferPreviewAtEvent(
        sessionId,
        outputPath,
        attempts,
        eventId,
        "event_output"
      );
      if (preview) {
        return preview;
      }
    }
    return null;
  }
  async loadFramebufferPreviewAtEvent(sessionId, outputPath, attempts, eventId, targetSemantic = "swapchain") {
    const args = {
      session_id: sessionId,
      output_path: outputPath,
      file_format: "png",
      include_alpha: false,
      target: {
        semantic: targetSemantic
      }
    };
    if (eventId !== void 0) {
      args.event_id = eventId;
    }
    const result = await this.rdxCliInvoker.call(this.buildClaimedToolRequest(
      "rd.export.screenshot",
      args
    ));
    if (!result.ok || result.data?.success === false) {
      attempts.push({
        source: "framebuffer_screenshot",
        status: "failed",
        eventId,
        message: this.describeToolFailure(result, "rd.export.screenshot did not return a preview image."),
        code: this.readToolFailureCode(result),
        targetSemantic,
        details: this.readToolFailureDetails(result)
      });
      return null;
    }
    const imagePath = this.resolvePreviewPath(result, outputPath);
    const metadata = this.extractPreviewMetadata(result);
    const preview = imagePath ? this.createPreviewFromPath(imagePath, "framebuffer_screenshot", void 0, void 0, metadata) : null;
    if (!preview) {
      attempts.push({
        source: "framebuffer_screenshot",
        status: "failed",
        eventId,
        message: imagePath ? `rd.export.screenshot produced an unreadable image: ${imagePath}` : "rd.export.screenshot succeeded without image_path, saved_path, artifact_path, or artifact path.",
        code: "preview_image_unreadable",
        imagePath: imagePath ?? void 0,
        targetSemantic,
        details: this.readToolFailureDetails(result),
        ...metadata
      });
      return null;
    }
    attempts.push({
      source: "framebuffer_screenshot",
      status: "success",
      eventId,
      imagePath: preview.imagePath,
      resolvedEventId: preview.resolvedEventId,
      presentEventId: preview.presentEventId,
      textureId: preview.textureId,
      targetSource: preview.targetSource,
      targetSemantic: preview.targetSemantic ?? targetSemantic,
      fallbackReason: preview.fallbackReason,
      details: result.data?.swapchain_error
    });
    return preview;
  }
  async listPreviewCandidateEvents(sessionId) {
    const result = await this.rdxCliInvoker.call(this.buildClaimedToolRequest(
      "rd.event.get_actions",
      {
        session_id: sessionId,
        include_markers: true,
        include_drawcalls: true,
        max_nodes: 2e4
      }
    ));
    if (!result.ok || result.data?.success === false || !Array.isArray(result.data?.actions)) {
      return [];
    }
    const eventIds = [];
    const visit = (node) => {
      const flags = typeof node.flags === "object" && node.flags !== null ? node.flags : {};
      const isPreviewable = flags.is_draw === true || flags.is_dispatch === true || flags.is_pass_boundary === true;
      const eventId = typeof node.event_id === "number" ? node.event_id : Number(node.event_id);
      if (isPreviewable && Number.isFinite(eventId) && eventId > 0) {
        eventIds.push(eventId);
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          if (typeof child === "object" && child !== null) {
            visit(child);
          }
        }
      }
    };
    for (const action of result.data.actions) {
      if (typeof action === "object" && action !== null) {
        visit(action);
      }
    }
    return Array.from(new Set(eventIds));
  }
  async loadCaptureThumbnail(captureFileId, attempts) {
    const result = await this.rdxCliInvoker.call(this.buildClaimedToolRequest(
      "rd.capture.get_thumbnail",
      {
        capture_file_id: captureFileId,
        max_size_px: 640
      }
    ));
    if (!result.ok) {
      attempts.push({
        source: "capture_thumbnail",
        status: "failed",
        message: this.describeToolFailure(result, "rd.capture.get_thumbnail did not return a thumbnail."),
        code: this.readToolFailureCode(result)
      });
      return null;
    }
    const imagePath = this.resolvePreviewPath(result);
    if (!imagePath) {
      attempts.push({
        source: "capture_thumbnail",
        status: "failed",
        message: "rd.capture.get_thumbnail succeeded without image_path, saved_path, artifact_path, or artifact path.",
        code: "thumbnail_path_missing"
      });
      return null;
    }
    const preview = this.createPreviewFromPath(
      imagePath,
      "capture_thumbnail",
      typeof result.data?.width === "number" ? result.data.width : void 0,
      typeof result.data?.height === "number" ? result.data.height : void 0
    );
    if (!preview) {
      attempts.push({
        source: "capture_thumbnail",
        status: "failed",
        message: `rd.capture.get_thumbnail produced an unreadable image: ${imagePath}`,
        code: "thumbnail_image_unreadable",
        imagePath
      });
      return null;
    }
    attempts.push({
      source: "capture_thumbnail",
      status: "success",
      imagePath: preview.imagePath
    });
    return preview;
  }
  resolvePreviewPath(result, fallbackPath) {
    const imagePath = typeof result.data?.image_path === "string" ? result.data.image_path : typeof result.data?.saved_path === "string" ? result.data.saved_path : typeof result.data?.artifact_path === "string" ? result.data.artifact_path : typeof result.data?.path === "string" ? result.data.path : result.artifacts?.[0]?.path ?? fallbackPath ?? null;
    return imagePath ? path.resolve(imagePath) : null;
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
  extractPreviewMetadata(result) {
    return {
      resolvedEventId: typeof result.data?.resolved_event_id === "number" ? result.data.resolved_event_id : void 0,
      presentEventId: typeof result.data?.present_event_id === "number" ? result.data.present_event_id : void 0,
      textureId: typeof result.data?.texture_id === "string" ? result.data.texture_id : void 0,
      targetSource: typeof result.data?.target_source === "string" ? result.data.target_source : void 0,
      targetSemantic: typeof result.data?.requested_semantic === "string" ? result.data.requested_semantic : void 0,
      fallbackReason: typeof result.data?.fallback_reason === "string" ? result.data.fallback_reason : void 0,
      summaryDegraded: typeof result.data?.summary_degraded === "boolean" ? result.data.summary_degraded : void 0
    };
  }
  describeToolFailure(result, fallback) {
    if (result.error?.message) {
      return result.error.message;
    }
    if (typeof result.data?.error_message === "string" && result.data.error_message) {
      return result.data.error_message;
    }
    return fallback;
  }
  readToolFailureCode(result) {
    if (result.error?.code) {
      return result.error.code;
    }
    return typeof result.data?.code === "string" ? result.data.code : void 0;
  }
  readToolFailureDetails(result) {
    if (result.error?.details) {
      return result.error.details;
    }
    return result.data?.details;
  }
  createPreviewError(attempts) {
    const failedAttempts = attempts.filter((attempt) => attempt.status === "failed");
    const lastFailure = failedAttempts[failedAttempts.length - 1];
    return {
      message: lastFailure?.message ?? "No preview attempt produced a readable image.",
      code: lastFailure?.code,
      attempts: [...attempts]
    };
  }
  canReuseOpenedCapture(request) {
    const primaryCapture = (request.captures ?? []).find((capture) => capture.id === request.primaryCaptureId);
    if (!primaryCapture || !this.openedCapture) {
      return false;
    }
    return Boolean(
      this.contextId && this.runtimeOwner && this.ownerLeaseId && this.openedCapture.status === "open" && primaryCapture.id === this.openedCapture.inputId && primaryCapture.filePath === this.openedCapture.filePath && primaryCapture.backendHint === this.openedCapture.backend && request.replayDevice?.id === this.openedCapture.deviceId
    );
  }
  async teardownRuntime() {
    const contextId = this.contextId;
    const runtimeOwner = this.runtimeOwner;
    const ownerLeaseId = this.ownerLeaseId;
    if (contextId && runtimeOwner && ownerLeaseId && this.humanPreview.status !== "closed") {
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
    const replaySessionIds = Array.from(new Set(
      this.captures.map((capture) => capture.sessionId || capture.replaySessionId).filter((sessionId) => typeof sessionId === "string" && Boolean(sessionId))
    ));
    const captureFileIds = Array.from(new Set(
      this.captures.map((capture) => capture.captureFileId).filter((captureFileId) => typeof captureFileId === "string" && Boolean(captureFileId))
    ));
    for (const sessionId of replaySessionIds) {
      const result = await this.rdxCliInvoker.call({
        toolName: "rd.capture.close_replay",
        args: { session_id: sessionId },
        contextId: contextId ?? void 0,
        runtimeOwner: runtimeOwner ?? void 0,
        ownerLeaseId: ownerLeaseId ?? void 0
      });
      if (!result.ok) {
        runtimeLogService.log({
          scope: "app",
          namespace: "capture",
          severity: "warning",
          title: "Replay teardown warning",
          summary: result.error?.message ?? `Failed to close replay ${sessionId}.`,
          raw: {
            sessionId,
            contextId
          }
        });
      }
    }
    for (const captureFileId of captureFileIds) {
      const result = await this.rdxCliInvoker.call({
        toolName: "rd.capture.close_file",
        args: { capture_file_id: captureFileId },
        contextId: contextId ?? void 0,
        runtimeOwner: runtimeOwner ?? void 0,
        ownerLeaseId: ownerLeaseId ?? void 0
      });
      if (!result.ok) {
        runtimeLogService.log({
          scope: "app",
          namespace: "capture",
          severity: "warning",
          title: "Capture teardown warning",
          summary: result.error?.message ?? `Failed to close capture ${captureFileId}.`,
          raw: {
            captureFileId,
            contextId
          }
        });
      }
    }
    if (contextId && runtimeOwner && ownerLeaseId) {
      await this.rdxCliInvoker.call({
        toolName: "rd.session.release_runtime_owner",
        args: {
          runtime_owner: runtimeOwner,
          owner_lease_id: ownerLeaseId,
          force: true
        },
        contextId,
        runtimeOwner,
        ownerLeaseId
      });
    }
    if (contextId) {
      await this.rdxCliInvoker.call({
        toolName: "rd.session.clear_context",
        args: {
          target_context_id: contextId
        },
        contextId
      });
    }
  }
  async cleanupStaleRdcAgentContexts() {
    const result = await this.rdxCliInvoker.call({
      toolName: "rd.session.list_contexts",
      args: {}
    });
    if (!result.ok || !Array.isArray(result.data?.contexts)) {
      return 0;
    }
    let cleanedCount = 0;
    for (const contextEntry of result.data.contexts) {
      const targetContextId = typeof contextEntry.context_id === "string" ? contextEntry.context_id : "";
      if (!targetContextId) {
        continue;
      }
      const runtimeOwner = typeof contextEntry.runtime_owner === "string" ? contextEntry.runtime_owner : typeof contextEntry.runtime_owner?.agent_id === "string" ? String(contextEntry.runtime_owner.agent_id) : "";
      const ownerLeaseId = typeof contextEntry.owner_lease?.lease_id === "string" ? String(contextEntry.owner_lease.lease_id) : "";
      const shouldClear = targetContextId.startsWith("ctx-") || runtimeOwner.startsWith("rdc-agent-");
      if (!shouldClear) {
        continue;
      }
      if (runtimeOwner && ownerLeaseId) {
        await this.rdxCliInvoker.call({
          toolName: "rd.session.release_runtime_owner",
          args: {
            runtime_owner: runtimeOwner,
            owner_lease_id: ownerLeaseId,
            force: true
          },
          contextId: targetContextId,
          runtimeOwner,
          ownerLeaseId
        });
      }
      const clearResult = await this.rdxCliInvoker.call({
        toolName: "rd.session.clear_context",
        args: {
          target_context_id: targetContextId
        },
        contextId: targetContextId
      });
      if (clearResult.ok) {
        cleanedCount += 1;
      }
    }
    return cleanedCount;
  }
  async cleanupDaemonRuntimeState() {
    let cleaned = false;
    const daemonCleanup = await this.rdxCliInvoker.executeCLI("daemon", ["cleanup"]);
    if (daemonCleanup.exitCode === 0) {
      cleaned = true;
    } else {
      runtimeLogService.log({
        scope: "app",
        namespace: "context",
        severity: "warning",
        title: "Daemon cleanup warning",
        summary: daemonCleanup.stderr.trim() || daemonCleanup.stdout.trim() || "Failed to cleanup stale daemon state."
      });
    }
    const contextClear = await this.rdxCliInvoker.executeCLI("context", ["clear"]);
    if (contextClear.exitCode === 0) {
      cleaned = true;
    } else {
      runtimeLogService.log({
        scope: "app",
        namespace: "context",
        severity: "warning",
        title: "Daemon context clear warning",
        summary: contextClear.stderr.trim() || contextClear.stdout.trim() || "Failed to clear default daemon context."
      });
    }
    return cleaned;
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
    this.remoteId = null;
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
    const request = requestImpl(
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
    request.on("timeout", () => {
      request.destroy(new Error("Timed out while connecting to the dev renderer"));
    });
    request.on("error", (error) => {
      resolveCheck({ ok: false, url: url$1, error: error.message });
    });
    request.end();
  });
}
async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
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
async function handleRequest(options, request, response) {
  if (!request.url) {
    sendJson(response, 400, { success: false, error: "Missing URL" });
    return;
  }
  if (request.method === "OPTIONS") {
    setCors(response);
    response.writeHead(204);
    response.end();
    return;
  }
  const bridgeOrigin = bridgeUrl ?? "http://127.0.0.1";
  const url$1 = new url.URL(request.url, bridgeOrigin);
  if (url$1.pathname === "/health" && request.method === "GET") {
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
  if (url$1.pathname === "/invoke" && request.method === "POST") {
    void readJsonBody(request).then(async (body) => {
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
  if (url$1.pathname === "/events" && request.method === "GET") {
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
  server = http.createServer((request, response) => {
    void handleRequest(options, request, response).catch((error) => {
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
const rdxSessionService = new RdxSessionService(rdxCliInvokerService);
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
      providerIds: settings.llm.providers.map((provider) => provider.id),
      lastMigrationReportPath: settings.configuration.lastMigrationReportPath ?? null,
      migrationSummary: settings.configuration.lastMigrationSummary
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
electron.app.on("before-quit", () => {
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
