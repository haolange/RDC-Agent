import type {
  EffortLevel,
  ModelCapabilityProfile,
  ModelCapabilitySource,
  ReasoningLevel,
  ReasoningMode,
} from '../types/modelCapability';
import type {
  BuiltinLlmProviderId,
  LlmProviderModel,
} from '../types/settings';

export interface ManagedModelCatalogEntry {
  id: string;
  label?: string;
  aliases?: string[];
  profile: ModelCapabilityProfile;
  source: ModelCapabilitySource;
}

const CATALOG_UPDATED_AT = '2026-07-05';

const EFFORT_3: EffortLevel[] = ['low', 'medium', 'high'];
const EFFORT_4: EffortLevel[] = ['low', 'medium', 'high', 'extHigh'];
const EFFORT_5: EffortLevel[] = ['low', 'medium', 'high', 'extHigh', 'max'];
const EFFORT_NO_EXTRA: EffortLevel[] = ['low', 'medium', 'high', 'max'];
const REASONING_OFF: ReasoningLevel[] = ['off'];
const REASONING_AUTO_ONLY: ReasoningLevel[] = ['off', 'auto'];

const OPENAI_API_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://platform.openai.com/docs/models',
    'https://platform.openai.com/docs/guides/reasoning',
    'https://platform.openai.com/docs/guides/function-calling',
    'https://platform.openai.com/docs/guides/structured-outputs',
  ],
};

const CHATGPT_ACCOUNT_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: ['https://help.openai.com/en/articles/12003714-chatgpt-business-models-limits'],
};

const ANTHROPIC_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://docs.anthropic.com/en/docs/about-claude/models/overview',
    'https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking',
    'https://docs.anthropic.com/en/docs/build-with-claude/tool-use/overview',
    'https://docs.anthropic.com/en/docs/build-with-claude/vision',
  ],
};

const GEMINI_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://ai.google.dev/gemini-api/docs/models',
    'https://ai.google.dev/gemini-api/docs/thinking',
    'https://ai.google.dev/gemini-api/docs/function-calling',
    'https://ai.google.dev/gemini-api/docs/structured-output',
  ],
};

const XAI_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://docs.x.ai/developers/models',
    'https://docs.x.ai/developers/model-capabilities/text/reasoning',
    'https://docs.x.ai/developers/model-capabilities/text/structured-outputs',
  ],
};

const COPILOT_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://docs.github.com/en/copilot/reference/ai-models/supported-models',
    'https://docs.github.com/en/copilot/reference/ai-models/model-comparison',
  ],
};

const AZURE_OPENAI_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure',
    'https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning',
    'https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs',
  ],
};

const BEDROCK_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-anthropic.html',
    'https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-extended-thinking.html',
    'https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-structured-outputs.html',
  ],
};

const VERTEX_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models',
    'https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference',
    'https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/claude/structured_outputs',
  ],
};

const DEEPSEEK_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://api-docs.deepseek.com/guides/reasoning_model',
    'https://api-docs.deepseek.com/quick_start/pricing',
  ],
};

const QWEN_SOURCE: ModelCapabilitySource = {
  kind: 'conservative',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://help.aliyun.com/zh/model-studio/qwen-api-via-dashscope',
    'https://help.aliyun.com/zh/model-studio/vision',
  ],
  note: 'Public model pages do not expose a complete per-model context and effort table; profile is conservative.',
};

const VOLCENGINE_SOURCE: ModelCapabilitySource = {
  kind: 'conservative',
  updatedAt: CATALOG_UPDATED_AT,
  urls: ['https://www.volcengine.com/docs/82379/1928262'],
  note: 'Ark compatible endpoint catalog is product-specific; bundled entries are conservative coding-route candidates.',
};

const GLM_SOURCE: ModelCapabilitySource = {
  kind: 'conservative',
  updatedAt: CATALOG_UPDATED_AT,
  urls: ['https://open.bigmodel.cn/dev/api/normal-model/glm-4.5'],
  note: 'Official pages describe thinking mode, but do not provide a stable low/medium/high effort ladder.',
};

const MINIMAX_SOURCE: ModelCapabilitySource = {
  kind: 'conservative',
  updatedAt: CATALOG_UPDATED_AT,
  urls: ['https://platform.minimaxi.com/document/guides/chat-model/V2'],
  note: 'Public model catalog coverage is incomplete; profile is conservative.',
};

const MIMO_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://mimo.mi.com/docs/quick-start/summary/model',
    'https://mimo.mi.com/models/mimo-v2.5',
    'https://mimo.mi.com/token-plan',
  ],
};

const KIMI_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://platform.moonshot.ai/docs/api/chat',
    'https://platform.moonshot.ai/docs/guide/use-kimi-k2-thinking-model',
  ],
};

const KIMI_CODING_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://www.kimi.com/code/docs/en/',
    'https://www.kimi.com/code/docs/en/third-party-tools/other-coding-agents.html',
    'https://www.kimi.com/code/docs/en/kimi-code/whats-new.html',
  ],
  note: 'Kimi Coding Plan exposes kimi-for-coding. Thinking On routes to the current Kimi For Coding thinking model; no public Coding Plan highspeed model is exposed.',
};

const GROQ_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://console.groq.com/docs/models',
    'https://console.groq.com/docs/structured-outputs',
    'https://console.groq.com/docs/tool-use',
    'https://console.groq.com/docs/vision',
  ],
};

const MISTRAL_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://docs.mistral.ai/models/overview',
    'https://docs.mistral.ai/capabilities/function_calling/',
    'https://docs.mistral.ai/capabilities/structured-output/',
    'https://docs.mistral.ai/capabilities/vision/',
  ],
};

const CEREBRAS_SOURCE: ModelCapabilitySource = {
  kind: 'conservative',
  updatedAt: CATALOG_UPDATED_AT,
  urls: ['https://inference-docs.cerebras.ai/'],
  note: 'Official inference docs are latency-focused; model capability table is conservative.',
};

const TOOLS_ONLY: Pick<ModelCapabilityProfile, 'toolCalling' | 'visionInput' | 'structuredOutput'> = {
  toolCalling: true,
  visionInput: false,
  structuredOutput: true,
};

const MULTIMODAL_TOOLS: Pick<ModelCapabilityProfile, 'toolCalling' | 'visionInput' | 'structuredOutput'> = {
  toolCalling: true,
  visionInput: true,
  structuredOutput: true,
};

function buildReasoningProfile(
  nominalContextWindowTokens: number | undefined,
  adjustableLevels: EffortLevel[],
  toolProfile: Pick<ModelCapabilityProfile, 'toolCalling' | 'visionInput' | 'structuredOutput'>,
): ModelCapabilityProfile {
  const reasoningMode: ReasoningMode = adjustableLevels.length > 0 ? 'effort-levels' : 'none';
  const supportedReasoningLevels: ReasoningLevel[] = adjustableLevels.length > 0
    ? [...REASONING_AUTO_ONLY, ...adjustableLevels]
    : REASONING_OFF;
  const defaultReasoningLevel: ReasoningLevel = adjustableLevels.length > 0 ? 'auto' : 'off';
  return {
    ...(nominalContextWindowTokens ? { nominalContextWindowTokens } : {}),
    reasoningMode,
    supportedReasoningLevels,
    defaultReasoningLevel,
    ...toolProfile,
  };
}

const textOnly = (
  nominalContextWindowTokens: number | undefined,
  adjustableLevels: EffortLevel[] = [],
): ModelCapabilityProfile => buildReasoningProfile(nominalContextWindowTokens, adjustableLevels, TOOLS_ONLY);

const multimodal = (
  nominalContextWindowTokens: number | undefined,
  adjustableLevels: EffortLevel[] = [],
): ModelCapabilityProfile => buildReasoningProfile(nominalContextWindowTokens, adjustableLevels, MULTIMODAL_TOOLS);

function buildAutoOnlyProfile(
  nominalContextWindowTokens: number | undefined,
  toolProfile: Pick<ModelCapabilityProfile, 'toolCalling' | 'visionInput' | 'structuredOutput'>,
  supportedReasoningLevels: ReasoningLevel[] = REASONING_AUTO_ONLY,
): ModelCapabilityProfile {
  return {
    ...(nominalContextWindowTokens ? { nominalContextWindowTokens } : {}),
    reasoningMode: 'auto-only',
    supportedReasoningLevels,
    defaultReasoningLevel: 'auto',
    ...toolProfile,
  };
}

const autoOnlyText = (
  nominalContextWindowTokens: number | undefined,
  supportedReasoningLevels: ReasoningLevel[] = REASONING_AUTO_ONLY,
): ModelCapabilityProfile => buildAutoOnlyProfile(nominalContextWindowTokens, TOOLS_ONLY, supportedReasoningLevels);

const autoOnlyMultimodal = (
  nominalContextWindowTokens: number | undefined,
  supportedReasoningLevels: ReasoningLevel[] = REASONING_AUTO_ONLY,
): ModelCapabilityProfile => buildAutoOnlyProfile(nominalContextWindowTokens, MULTIMODAL_TOOLS, supportedReasoningLevels);

const openSourceText = (
  nominalContextWindowTokens: number | undefined,
): ModelCapabilityProfile => ({
  ...(nominalContextWindowTokens ? { nominalContextWindowTokens } : {}),
  reasoningMode: 'none',
  supportedReasoningLevels: REASONING_OFF,
  defaultReasoningLevel: 'off',
  toolCalling: true,
  visionInput: false,
  structuredOutput: true,
});

const model = (
  id: string,
  profile: ModelCapabilityProfile,
  source: ModelCapabilitySource,
  options: Pick<ManagedModelCatalogEntry, 'label' | 'aliases'> = {},
): ManagedModelCatalogEntry => ({
  id,
  ...options,
  profile,
  source,
});

const gpt55Api = multimodal(1_050_000, EFFORT_NO_EXTRA);
const gpt54Api = multimodal(1_050_000, EFFORT_NO_EXTRA);
const gptMiniApi = multimodal(400_000, EFFORT_3);
const gptCodex = textOnly(400_000, EFFORT_4);
const gpt41 = multimodal(1_047_576, []);

const chatGptAccountModels = [
  model('gpt-5.5-instant', { ...multimodal(128_000, []), fastVariantModelId: 'gpt-5.5-instant' }, CHATGPT_ACCOUNT_SOURCE, { label: 'GPT-5.5 Instant' }),
  model('gpt-5.5-thinking', multimodal(128_000, EFFORT_4), CHATGPT_ACCOUNT_SOURCE, { label: 'GPT-5.5 Thinking' }),
  model('gpt-5.5-pro', multimodal(272_000, EFFORT_4), CHATGPT_ACCOUNT_SOURCE, { label: 'GPT-5.5 Pro' }),
];

const openAiApiModels = [
  model('gpt-5.5', gpt55Api, OPENAI_API_SOURCE),
  model('gpt-5.4', gpt54Api, OPENAI_API_SOURCE),
  model('gpt-5.4-mini', gptMiniApi, OPENAI_API_SOURCE),
  model('gpt-5.4-nano', gptMiniApi, OPENAI_API_SOURCE),
  model('gpt-5.3-codex', gptCodex, OPENAI_API_SOURCE),
  model('gpt-5.2-codex', gptCodex, OPENAI_API_SOURCE),
  model('gpt-4.1', gpt41, OPENAI_API_SOURCE),
];

const claudeApiModels = [
  model('claude-fable-5', multimodal(1_000_000, EFFORT_3), ANTHROPIC_SOURCE),
  model('claude-sonnet-5', multimodal(1_000_000, EFFORT_3), ANTHROPIC_SOURCE),
  model('claude-opus-4-8', multimodal(1_000_000, EFFORT_3), ANTHROPIC_SOURCE),
  model('claude-haiku-4-5-20251001', multimodal(200_000, EFFORT_3), ANTHROPIC_SOURCE, {
    aliases: ['claude-haiku-4-5'],
  }),
];

const geminiModels = [
  model('gemini-3.5-flash', multimodal(1_048_576, EFFORT_3), GEMINI_SOURCE),
  model('gemini-3.1-pro-preview', multimodal(1_048_576, EFFORT_3), GEMINI_SOURCE),
  model('gemini-2.5-pro', multimodal(1_048_576, EFFORT_3), GEMINI_SOURCE, {
    aliases: ['gemini-pro'],
  }),
  model('gemini-2.5-flash', multimodal(1_048_576, EFFORT_3), GEMINI_SOURCE),
];

const grokModels = [
  model('grok-4.3', multimodal(1_000_000, EFFORT_3), XAI_SOURCE),
  model('grok-build-0.1', textOnly(256_000, EFFORT_3), XAI_SOURCE),
  model('grok-code-fast-1', textOnly(256_000, []), XAI_SOURCE),
];

const copilotModels = [
  model('gpt-5.5', gpt55Api, COPILOT_SOURCE),
  model('gpt-5.3-codex', gptCodex, COPILOT_SOURCE),
  model('claude-sonnet-5', multimodal(1_000_000, EFFORT_3), COPILOT_SOURCE),
  model('claude-opus-4-8', {
    ...multimodal(1_000_000, EFFORT_3),
    fastVariantModelId: 'claude-opus-4-8-fast',
  }, COPILOT_SOURCE),
  model('claude-opus-4-8-fast', multimodal(1_000_000, EFFORT_3), COPILOT_SOURCE),
  model('gemini-3.1-pro-preview', multimodal(1_048_576, EFFORT_3), COPILOT_SOURCE),
  model('gemini-3.5-flash', multimodal(1_048_576, EFFORT_3), COPILOT_SOURCE),
];

const qwenModels = [
  model('qwen-turbo', autoOnlyText(131_072), QWEN_SOURCE),
  model('qwen-plus', autoOnlyText(131_072), QWEN_SOURCE),
  model('qwen-max', autoOnlyText(131_072), QWEN_SOURCE),
  model('qwen-flash', autoOnlyText(131_072), QWEN_SOURCE),
  model('qwen-vl-max', autoOnlyMultimodal(131_072), QWEN_SOURCE),
];

const qwenCodingPlanModels = [
  model('qwen3-coder-plus', autoOnlyText(131_072), QWEN_SOURCE),
  model('qwen3-coder-next', autoOnlyText(131_072), QWEN_SOURCE),
  model('qwen3.6-plus', autoOnlyText(131_072), QWEN_SOURCE),
];

const deepSeekModels = [
  model('deepseek-v4-pro', textOnly(1_000_000, EFFORT_NO_EXTRA), DEEPSEEK_SOURCE, {
    aliases: ['deepseek-reasoner'],
  }),
  model('deepseek-v4-flash', textOnly(131_072, []), DEEPSEEK_SOURCE, {
    aliases: ['deepseek-chat'],
  }),
];

const kimiApiModels = [
  model('kimi-k2.7-code', {
    ...autoOnlyText(262_144, ['auto']),
    fastVariantModelId: 'kimi-k2.7-code-highspeed',
  }, KIMI_SOURCE),
  model('kimi-k2.7-code-highspeed', autoOnlyText(262_144, ['auto']), KIMI_SOURCE),
  model('kimi-k2.6', autoOnlyMultimodal(262_144), KIMI_SOURCE),
  model('kimi-k2.5', textOnly(262_144, []), KIMI_SOURCE),
];

const kimiCodingPlanModels = [
  model('kimi-for-coding', {
    ...textOnly(262_144, []),
    reasoningMode: 'auto-only',
    supportedReasoningLevels: REASONING_AUTO_ONLY,
    defaultReasoningLevel: 'auto',
  }, KIMI_CODING_SOURCE),
];

const glmModels = [
  model('glm-5', autoOnlyText(131_072), GLM_SOURCE),
  model('glm-4.7', autoOnlyText(131_072), GLM_SOURCE),
  model('glm-4.6', autoOnlyText(131_072), GLM_SOURCE),
  model('glm-4.5', autoOnlyText(131_072), GLM_SOURCE),
];

const minimaxModels = [
  model('MiniMax-M2.7', autoOnlyText(131_072), MINIMAX_SOURCE),
];

const mimoModels = [
  model('mimo-v2.5-pro', autoOnlyMultimodal(1_000_000), MIMO_SOURCE),
];

const doubaoModels = [
  model('doubao-seed-2.1-pro', autoOnlyText(131_072), VOLCENGINE_SOURCE),
  model('doubao-seed-2.1-turbo', autoOnlyText(131_072), VOLCENGINE_SOURCE),
];

const groqModels = [
  model('moonshotai/kimi-k2-instruct-0905', openSourceText(262_144), GROQ_SOURCE),
  model('meta-llama/llama-4-maverick-17b-128e-instruct', {
    ...openSourceText(131_072),
    visionInput: true,
  }, GROQ_SOURCE),
  model('openai/gpt-oss-120b', openSourceText(131_072), GROQ_SOURCE),
  model('llama-3.3-70b-versatile', openSourceText(131_072), GROQ_SOURCE),
];

const mistralModels = [
  model('mistral-small-3.2-25-06', multimodal(131_072, []), MISTRAL_SOURCE),
  model('mistral-large-latest', multimodal(131_072, []), MISTRAL_SOURCE),
  model('codestral-latest', textOnly(262_144, []), MISTRAL_SOURCE),
];

const cerebrasModels = [
  model('llama-4-scout-17b-16e-instruct', openSourceText(131_072), CEREBRAS_SOURCE),
  model('qwen-3-coder-480b', openSourceText(131_072), CEREBRAS_SOURCE),
  model('gpt-oss-120b', openSourceText(131_072), CEREBRAS_SOURCE),
];

const bedrockClaudeModels = [
  model('anthropic.claude-fable-5', multimodal(1_000_000, EFFORT_5), BEDROCK_SOURCE),
  model('anthropic.claude-sonnet-5', multimodal(1_000_000, EFFORT_5), BEDROCK_SOURCE),
  model('anthropic.claude-opus-4-8', multimodal(1_000_000, EFFORT_5), BEDROCK_SOURCE),
  model('anthropic.claude-haiku-4-5-20251001-v1:0', multimodal(200_000, EFFORT_3), BEDROCK_SOURCE),
];

const vertexModels = [
  model('claude-fable-5', multimodal(1_000_000, EFFORT_5), VERTEX_SOURCE),
  model('claude-sonnet-5', multimodal(1_000_000, EFFORT_5), VERTEX_SOURCE),
  model('claude-opus-4-8', multimodal(1_000_000, EFFORT_5), VERTEX_SOURCE),
  model('claude-haiku-4-5@20251001', multimodal(200_000, EFFORT_3), VERTEX_SOURCE),
  model('gemini-3.1-pro-preview', multimodal(1_048_576, EFFORT_4), VERTEX_SOURCE),
  model('gemini-2.5-flash', multimodal(1_048_576, EFFORT_3), VERTEX_SOURCE),
];

export const MANAGED_PROVIDER_MODEL_CATALOG: Partial<Record<BuiltinLlmProviderId, ManagedModelCatalogEntry[]>> = {
  'chatgpt-account': chatGptAccountModels,
  'claude-account': claudeApiModels,
  'github-copilot': copilotModels,
  'grok-account': grokModels,
  'gemini-account': geminiModels,
  'qwen-account': qwenModels,

  openai: openAiApiModels,
  'openai-eu': openAiApiModels,
  'openai-us': openAiApiModels,
  anthropic: claudeApiModels,
  'google-ai-studio': geminiModels,

  'azure-openai': [
    model('gpt-5.5', gpt55Api, AZURE_OPENAI_SOURCE),
    model('gpt-5.4', gpt54Api, AZURE_OPENAI_SOURCE),
    model('gpt-5.4-mini', gptMiniApi, AZURE_OPENAI_SOURCE),
    model('gpt-4.1', gpt41, AZURE_OPENAI_SOURCE),
  ],
  bedrock: bedrockClaudeModels,
  vertex: vertexModels,

  deepseek: deepSeekModels,
  bailian: qwenModels,
  qwen: qwenModels,
  volcengine: [
    ...doubaoModels,
    ...glmModels,
    ...deepSeekModels.filter((entry) => entry.id === 'deepseek-v4-pro'),
    ...kimiApiModels.filter((entry) => entry.id === 'kimi-k2.5'),
  ],
  'glm-cn': glmModels,
  'glm-global': glmModels,
  'minimax-cn': minimaxModels,
  'minimax-global': minimaxModels,
  'xiaomi-mimo': mimoModels,
  moonshot: kimiApiModels,
  xai: grokModels,
  groq: groqModels,
  mistral: mistralModels,
  cerebras: cerebrasModels,

  'kimi-coding-plan': kimiCodingPlanModels,
  'bailian-coding-plan': [
    ...qwenCodingPlanModels,
    ...kimiApiModels.filter((entry) => entry.id === 'kimi-k2.5'),
    ...glmModels.filter((entry) => entry.id === 'glm-5' || entry.id === 'glm-4.7'),
  ],
  'volcengine-coding-plan': [
    ...doubaoModels,
    ...glmModels.filter((entry) => entry.id === 'glm-4.6'),
    ...deepSeekModels.filter((entry) => entry.id === 'deepseek-v4-pro'),
    ...kimiApiModels.filter((entry) => entry.id === 'kimi-k2.5'),
  ],
  'glm-cn-coding-plan': glmModels,
  'glm-global-coding-plan': glmModels,
  'minimax-cn-coding-plan': minimaxModels,
  'minimax-global-coding-plan': minimaxModels,
  'xiaomi-mimo-token-plan': mimoModels,
};

const normalizeId = (value: string): string => value.trim().toLowerCase();

export function getManagedProviderModelCatalog(providerId: string): ManagedModelCatalogEntry[] {
  const entries = MANAGED_PROVIDER_MODEL_CATALOG[providerId as BuiltinLlmProviderId] ?? [];
  return entries.map((entry) => ({
    ...entry,
    aliases: entry.aliases ? [...entry.aliases] : undefined,
    profile: {
      ...entry.profile,
      supportedReasoningLevels: entry.profile.supportedReasoningLevels
        ? [...entry.profile.supportedReasoningLevels]
        : undefined,
    },
    source: {
      ...entry.source,
      urls: [...entry.source.urls],
    },
  }));
}

export function getManagedProviderModelIds(providerId: string): string[] {
  return getManagedProviderModelCatalog(providerId).map((entry) => entry.id);
}

export function getManagedProviderModels(providerId: string): LlmProviderModel[] {
  return getManagedProviderModelCatalog(providerId).map((entry) => ({
    id: entry.id,
    label: entry.label ?? entry.id,
    enabled: true,
    availability: 'unknown',
  }));
}

export function lookupManagedModelCatalogEntry(
  providerId: string,
  modelId: string,
): ManagedModelCatalogEntry | null {
  const normalizedModelId = normalizeId(modelId);
  for (const entry of getManagedProviderModelCatalog(providerId)) {
    if (normalizeId(entry.id) === normalizedModelId) {
      return entry;
    }
    if (entry.aliases?.some((alias) => normalizeId(alias) === normalizedModelId)) {
      return entry;
    }
  }
  return null;
}

export function lookupManagedModelCapabilityProfile(
  providerId: string,
  modelId: string,
): ModelCapabilityProfile | null {
  return lookupManagedModelCatalogEntry(providerId, modelId)?.profile ?? null;
}
