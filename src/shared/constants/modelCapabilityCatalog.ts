import type { EffortLevel, ModelCapabilityProfile } from '../types/modelCapability';

const EFFORT_3: EffortLevel[] = ['low', 'medium', 'high'];
const EFFORT_4: EffortLevel[] = ['low', 'medium', 'high', 'extra'];
const EFFORT_5: EffortLevel[] = ['low', 'medium', 'high', 'extra', 'max'];

interface ModelCapabilitySeedEntry {
  match: RegExp;
  profile: ModelCapabilityProfile;
}

const MODEL_CAPABILITY_SEEDS: ModelCapabilitySeedEntry[] = [
  // Claude：官方标称 200k；1M beta 未广泛确认，保守 200k
  {
    match: /^claude-/,
    profile: {
      nominalContextWindowTokens: 200_000,
      supportedEffortLevels: EFFORT_5,
    },
  },
  // GPT-5 系列：标称 400k；codex/gpt-5 才开放 extra（映射 xhigh）
  {
    match: /^gpt-5/,
    profile: {
      nominalContextWindowTokens: 400_000,
      supportedEffortLevels: EFFORT_4,
    },
  },
  // o 系列推理模型：标称 200k；无 extra（非 codex/gpt-5）
  {
    match: /^o[34]/,
    profile: {
      nominalContextWindowTokens: 200_000,
      supportedEffortLevels: EFFORT_3,
    },
  },
  // GPT-4.1：大窗口但非 reasoning 模型
  {
    match: /^gpt-4\.1/,
    profile: {
      nominalContextWindowTokens: 1_047_576,
      supportedEffortLevels: [],
    },
  },
  // Gemini 2.5 Pro / Gemini 3：1M 窗口 + thinking 五档
  {
    match: /^gemini-3/,
    profile: {
      nominalContextWindowTokens: 1_048_576,
      supportedEffortLevels: EFFORT_5,
    },
  },
  {
    match: /^gemini-2\.5-pro/,
    profile: {
      nominalContextWindowTokens: 1_048_576,
      supportedEffortLevels: EFFORT_5,
    },
  },
  // Gemini 2.5 Flash：1M 窗口 + thinking 三档
  {
    match: /^gemini-2\.5-flash/,
    profile: {
      nominalContextWindowTokens: 1_048_576,
      supportedEffortLevels: EFFORT_3,
    },
  },
  // DeepSeek 推理模型：保守 128k
  {
    match: /^deepseek-(r1|reasoner)/,
    profile: {
      nominalContextWindowTokens: 131_072,
      supportedEffortLevels: EFFORT_3,
    },
  },
  // DeepSeek 对话模型（chat/v3）：非 reasoning，128k
  {
    match: /^deepseek-(chat|v3)/,
    profile: {
      nominalContextWindowTokens: 131_072,
      supportedEffortLevels: [],
    },
  },
  // DeepSeek V 系列（v4/v5 等新版本）：非 reasoning，64k 保守
  {
    match: /^deepseek-v/,
    profile: {
      nominalContextWindowTokens: 65_536,
      supportedEffortLevels: [],
    },
  },
  // DeepSeek 兜底（未命中上述具体规则的任意变体）
  {
    match: /^deepseek-/,
    profile: {
      nominalContextWindowTokens: 65_536,
      supportedEffortLevels: [],
    },
  },
  // Kimi K2：262k；turbo 变体 id 未统一，不声明 fast
  {
    match: /^kimi-k2/,
    profile: {
      nominalContextWindowTokens: 262_144,
      supportedEffortLevels: EFFORT_3,
    },
  },
  // Kimi 系列通用（kimi-for-coding 等）：128k，非 reasoning
  {
    match: /^kimi-/,
    profile: {
      nominalContextWindowTokens: 131_072,
      supportedEffortLevels: [],
    },
  },
  // Moonshot 原生模型名
  {
    match: /^moonshot-/,
    profile: {
      nominalContextWindowTokens: 131_072,
      supportedEffortLevels: [],
    },
  },
  // Grok：256k；fast 变体命名不确定，不声明 fast
  {
    match: /^grok-[34]/,
    profile: {
      nominalContextWindowTokens: 256_000,
      supportedEffortLevels: EFFORT_3,
    },
  },
  // Qwen3 / QwQ
  {
    match: /^(qwen3|qwq)/,
    profile: {
      nominalContextWindowTokens: 131_072,
      supportedEffortLevels: EFFORT_3,
    },
  },
  // GLM-5：标称可能 262k，保守 131k
  {
    match: /^glm-5/,
    profile: {
      nominalContextWindowTokens: 131_072,
      supportedEffortLevels: EFFORT_3,
    },
  },
  // GLM-4
  {
    match: /^glm-4/,
    profile: {
      nominalContextWindowTokens: 131_072,
      supportedEffortLevels: EFFORT_3,
    },
  },
  // 开源通用：非 reasoning
  {
    match: /^(llama|mistral|mixtral)/,
    profile: {
      nominalContextWindowTokens: 131_072,
      supportedEffortLevels: [],
    },
  },
];

export function lookupModelCapabilitySeed(modelId: string): ModelCapabilityProfile | null {
  const normalized = modelId.trim().toLowerCase();
  for (const entry of MODEL_CAPABILITY_SEEDS) {
    if (entry.match.test(normalized)) {
      return entry.profile;
    }
  }
  return null;
}
