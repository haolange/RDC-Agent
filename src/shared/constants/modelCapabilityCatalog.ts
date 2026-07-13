import type {
  GeminiWireThinkingLevel,
  ModelCapabilityProfile,
  ModelCapabilitySource,
  NamedReasoningLevel,
  OpenAiWireEffort,
  ReasoningControl,
  ReasoningSelection,
  ReasoningWireProfile,
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

const CATALOG_UPDATED_AT = '2026-07-12';

const OPENAI_LEVELS: NamedReasoningLevel[] = ['low', 'medium', 'high', 'extra'];
const OPENAI_56_LEVELS: NamedReasoningLevel[] = ['low', 'medium', 'high', 'extra', 'max'];
const ANTHROPIC_5_LEVELS: NamedReasoningLevel[] = ['low', 'medium', 'high', 'extra', 'max'];
const GEMINI_35_LEVELS: NamedReasoningLevel[] = ['minimal', 'low', 'medium', 'high'];
const GEMINI_31_LEVELS: NamedReasoningLevel[] = ['low', 'medium', 'high'];
const DEEPSEEK_LEVELS: NamedReasoningLevel[] = ['high', 'max'];
const XAI_LEVELS: NamedReasoningLevel[] = ['low', 'medium', 'high'];
const QWEN_LEVELS: NamedReasoningLevel[] = ['minimal', 'low', 'medium', 'high'];

const OPENAI_WIRE_LEVELS: Partial<Record<NamedReasoningLevel, OpenAiWireEffort>> = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  extra: 'xhigh',
  max: 'max',
  ultra: 'ultra',
};

const ANTHROPIC_WIRE_LEVELS: Partial<Record<NamedReasoningLevel, 'low' | 'medium' | 'high' | 'xhigh' | 'max'>> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  extra: 'xhigh',
  max: 'max',
};

const GEMINI_WIRE_LEVELS: Partial<Record<NamedReasoningLevel, GeminiWireThinkingLevel>> = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
};

const GEMINI_BUDGET_LEVELS: Partial<Record<NamedReasoningLevel, number>> = {
  low: 1_024,
  medium: 4_096,
  high: 8_192,
};

const OPENAI_RESPONSES_WIRE: ReasoningWireProfile = {
  kind: 'openai-responses',
  on: 'medium',
  levels: OPENAI_WIRE_LEVELS,
};

const OPENAI_COMPATIBLE_WIRE: ReasoningWireProfile = {
  kind: 'openai-compatible',
  on: 'medium',
  levels: OPENAI_WIRE_LEVELS,
  offMode: 'reasoning-none',
};

const QWEN_OPENAI_WIRE: ReasoningWireProfile = {
  kind: 'openai-compatible',
  on: 'medium',
  levels: {
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
  },
  onMode: 'enable-thinking-true',
  offMode: 'enable-thinking-false',
};

const DEEPSEEK_ANTHROPIC_WIRE: ReasoningWireProfile = {
  kind: 'anthropic',
  on: 'high',
  levels: {
    high: 'high',
    max: 'max',
  },
  onMode: 'enabled',
  offMode: 'disabled',
};

const ANTHROPIC_ADAPTIVE_WIRE: ReasoningWireProfile = {
  kind: 'anthropic',
  on: 'high',
  levels: ANTHROPIC_WIRE_LEVELS,
  onMode: 'adaptive',
  offMode: 'disabled',
};

const ANTHROPIC_ALWAYS_ON_WIRE: ReasoningWireProfile = {
  kind: 'anthropic',
  on: 'high',
  levels: ANTHROPIC_WIRE_LEVELS,
  onMode: 'adaptive',
};

const ANTHROPIC_TOGGLE_WIRE: ReasoningWireProfile = {
  kind: 'anthropic',
  on: 'high',
  onMode: 'enabled',
  offMode: 'disabled',
};

const KIMI_CODING_PLAN_WIRE: ReasoningWireProfile = {
  kind: 'anthropic',
  on: 'high',
  onMode: 'enabled',
  onBudgetTokens: 4_096,
  offMode: 'disabled',
};

const ANTHROPIC_ALWAYS_ON_TOGGLE_WIRE: ReasoningWireProfile = {
  kind: 'anthropic',
  on: 'high',
  onMode: 'enabled',
};

const GEMINI_3_WIRE: ReasoningWireProfile = {
  kind: 'gemini-thinking-level',
  on: 'medium',
  levels: GEMINI_WIRE_LEVELS,
};

const GEMINI_25_WIRE: ReasoningWireProfile = {
  kind: 'gemini-thinking-budget',
  on: 'high',
  levels: GEMINI_BUDGET_LEVELS,
};

const MOONSHOT_TOGGLE_WIRE: ReasoningWireProfile = {
  kind: 'moonshot-thinking',
  onMode: 'enabled',
  offMode: 'disabled',
};

const MOONSHOT_ALWAYS_ON_WIRE: ReasoningWireProfile = {
  kind: 'moonshot-thinking',
  onMode: 'enabled',
};

const VOLCENGINE_TOGGLE_WIRE: ReasoningWireProfile = {
  kind: 'openai-compatible',
  on: 'high',
  onMode: 'thinking-enabled',
  offMode: 'thinking-disabled',
};

/** Doubao Seed 2.0 on Coding Plan: thinking + reasoning_effort minimal|low|medium|high. */
const VOLCENGINE_DOUBAO_LEVELS_WIRE: ReasoningWireProfile = {
  kind: 'openai-compatible',
  on: 'medium',
  levels: {
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
  },
  onMode: 'thinking-enabled',
  offMode: 'thinking-disabled',
};

const NONE_WIRE: ReasoningWireProfile = { kind: 'none' };

const OPENAI_API_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://developers.openai.com/api/docs/guides/reasoning',
    'https://developers.openai.com/api/docs/guides/latest-model',
    'https://developers.openai.com/api/docs/models',
    'https://developers.openai.com/api/docs/guides/function-calling',
    'https://developers.openai.com/api/docs/guides/structured-outputs',
  ],
};

const CHATGPT_ACCOUNT_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://developers.openai.com/codex/models',
    'https://developers.openai.com/api/docs/models/gpt-5.6-sol',
    'https://developers.openai.com/api/docs/guides/latest-model',
  ],
  note: 'chatgpt-account uses Codex ChatGPT-sign-in (backend-api/codex). Model IDs follow the Codex surface (Sol/Terra/Luna + gpt-5.5/5.4), not the web ChatGPT Instant/Thinking/Pro product picker and not the full API-key openai catalog. Deprecated Codex ChatGPT-sign-in IDs (gpt-5.2, gpt-5.3-codex) are omitted.',
};

const ANTHROPIC_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://platform.claude.com/docs/en/build-with-claude/effort',
    'https://docs.anthropic.com/en/api/messages',
    'https://docs.anthropic.com/en/docs/build-with-claude/tool-use/overview',
    'https://docs.anthropic.com/en/docs/build-with-claude/vision',
  ],
};

const GEMINI_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://ai.google.dev/gemini-api/docs/thinking',
    'https://ai.google.dev/gemini-api/docs/function-calling',
    'https://ai.google.dev/gemini-api/docs/structured-output',
  ],
};

const XAI_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://docs.x.ai/developers/model-capabilities/text/reasoning',
    'https://docs.x.ai/developers/models/grok-4.5',
    'https://docs.x.ai/developers/models/grok-4.3',
    'https://docs.x.ai/developers/models/grok-build-0.1',
  ],
  note: 'grok-4.5 reasoning_effort is low|medium|high (default high) and cannot be disabled. grok-code-fast-1 redirects to grok-build-0.1.',
};

const COPILOT_SOURCE: ModelCapabilitySource = {
  kind: 'observed',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://docs.github.com/en/copilot/reference/ai-models/supported-models',
    'https://docs.github.com/en/copilot/reference/ai-models/model-comparison',
  ],
  note: 'GitHub Copilot exposes cross-vendor models behind a single compatible endpoint; capability rows mirror the curated product offer and stay conservative when the Copilot wire contract is not explicit.',
};

const AZURE_OPENAI_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
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
  ],
};

const VERTEX_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference',
    'https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/claude/structured_outputs',
  ],
};

const DEEPSEEK_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  note: 'DeepSeek maps product Off to thinking disabled; when thinking is on, official reasoning_effort is only high|max (low/medium→high, xhigh→max for compatibility). Composer/Settings therefore expose Off|High|Max only.',
  urls: [
    'https://api-docs.deepseek.com/quick_start/pricing',
    'https://api-docs.deepseek.com/guides/thinking_mode',
    'https://api-docs.deepseek.com/guides/anthropic_api',
    'https://api-docs.deepseek.com/api/create-chat-completion',
  ],
};

const QWEN_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://help.aliyun.com/en/model-studio/text-generation-model/',
    'https://help.aliyun.com/en/model-studio/compatibility-with-openai-responses-api',
    'https://help.aliyun.com/en/model-studio/coding-plan-faq',
  ],
  note: 'Bailian Coding Plan FAQ: qwen3-coder-plus / qwen3-coder-next do not support thinking mode, so those rows use reasoning none.',
};

const VOLCENGINE_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://www.volcengine.com/docs/82379/1928261',
    'https://www.volcengine.com/docs/82379/1925115',
    'https://www.volcengine.com/docs/82379/1519548',
    'https://www.volcengine.com/docs/82379/1956279',
  ],
  note: 'Volcengine Ark Coding Plan uses ark.cn-beijing.volces.com/api/coding(+ /v3), not the general Ark /api/v3 pay-as-you-go gateway. Doubao Seed 2.0 exposes thinking enable/disable plus reasoning_effort minimal|low|medium|high. Fast maps to the independent doubao-seed-2.0-lite model id.',
};

const GLM_SOURCE: ModelCapabilitySource = {
  kind: 'conservative',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://docs.bigmodel.cn/cn/guide/develop/openai/introduction',
    'https://help.aliyun.com/en/model-studio/glm-zhipu',
    'https://help.aliyun.com/zh/model-studio/glm',
  ],
  note: 'The dedicated Anthropic-compatible GLM endpoints document thinking enable/disable, but do not publish a stable effort ladder. App-managed GLM direct providers therefore expose toggle-only reasoning; richer level variants remain covered by shared tests, not by these endpoint rows.',
};

const MINIMAX_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://platform.minimax.io/docs/api-reference/text-openai-api',
    'https://platform.minimax.io/docs/api-reference/text-anthropic-api',
  ],
};

const MIMO_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://mimo.mi.com/docs/en-US/api/chat/responses',
    'https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/deep-thinking',
    'https://mimo.mi.com/docs/en-US/tokenplan/integration/codex-configuration',
  ],
};

const KIMI_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://platform.moonshot.ai/docs/guide/use-kimi-k2-thinking-model',
    'https://platform.moonshot.ai/docs/api/chat',
    'https://platform.moonshot.ai/docs/guide/kimi-k2-6-quickstart',
  ],
};

const KIMI_CODING_SOURCE: ModelCapabilitySource = {
  kind: 'official',
  updatedAt: CATALOG_UPDATED_AT,
  urls: [
    'https://www.kimi.com/code/docs/en/third-party-tools/other-coding-agents.html',
    'https://www.kimi.com/code/docs/en/kimi-code/whats-new.html',
    'https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/config-files.html',
  ],
  note: 'Kimi Coding Plan exposes Standard kimi-for-coding and HighSpeed kimi-for-coding-highspeed (same ability; HighSpeed needs Allegretto+). Fast mode selects the declared model variant. Thinking remains a binary product switch; the coding-model upgrade only takes effect when thinking is on.',
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
  note: 'Cerebras public docs do not publish a stable reasoning control contract for the curated rows in this catalog, so reasoning fails closed to none.',
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

function createReasoningControl(control: ReasoningControl): ReasoningControl {
  return {
    ...control,
    levels: [...control.levels],
    wireProfile: cloneWireProfile(control.wireProfile),
  };
}

function cloneWireProfile(profile: ReasoningWireProfile): ReasoningWireProfile {
  switch (profile.kind) {
    case 'openai-responses':
      return {
        ...profile,
        levels: profile.levels ? { ...profile.levels } : profile.levels,
      };
    case 'openai-compatible':
      return {
        ...profile,
        levels: profile.levels ? { ...profile.levels } : profile.levels,
      };
    case 'anthropic':
      return {
        ...profile,
        levels: profile.levels ? { ...profile.levels } : profile.levels,
      };
    case 'gemini-thinking-level':
      return {
        ...profile,
        levels: { ...profile.levels },
      };
    case 'gemini-thinking-budget':
      return {
        ...profile,
        levels: { ...profile.levels },
      };
    case 'moonshot-thinking':
    case 'none':
    default:
      return { ...profile };
  }
}

function noReasoningControl(): ReasoningControl {
  return {
    kind: 'none',
    supportsOff: true,
    levels: [],
    defaultSelection: 'off',
    wireProfile: NONE_WIRE,
  };
}

function toggleReasoningControl(
  defaultSelection: 'off' | 'on',
  wireProfile: ReasoningWireProfile,
): ReasoningControl {
  return {
    kind: 'toggle',
    supportsOff: true,
    levels: [],
    defaultSelection,
    wireProfile,
  };
}

function alwaysOnReasoningControl(
  lockedSelection: ReasoningSelection,
  wireProfile: ReasoningWireProfile,
): ReasoningControl {
  return {
    kind: 'always-on',
    supportsOff: false,
    levels: [],
    defaultSelection: lockedSelection,
    lockedSelection,
    wireProfile,
  };
}

function levelsReasoningControl(
  levels: NamedReasoningLevel[],
  options: {
    supportsOff: boolean;
    defaultSelection: ReasoningSelection;
    wireProfile: ReasoningWireProfile;
  },
): ReasoningControl {
  return {
    kind: 'levels',
    supportsOff: options.supportsOff,
    levels: [...levels],
    defaultSelection: options.defaultSelection,
    wireProfile: options.wireProfile,
  };
}

function buildProfile(
  nominalContextWindowTokens: number | undefined,
  reasoningControl: ReasoningControl,
  toolProfile: Pick<ModelCapabilityProfile, 'toolCalling' | 'visionInput' | 'structuredOutput'>,
): ModelCapabilityProfile {
  return {
    ...(nominalContextWindowTokens ? { nominalContextWindowTokens } : {}),
    reasoningControl: createReasoningControl(reasoningControl),
    ...toolProfile,
  };
}

const textOnly = (
  nominalContextWindowTokens: number | undefined,
  reasoningControl: ReasoningControl = noReasoningControl(),
): ModelCapabilityProfile => buildProfile(nominalContextWindowTokens, reasoningControl, TOOLS_ONLY);

const multimodal = (
  nominalContextWindowTokens: number | undefined,
  reasoningControl: ReasoningControl = noReasoningControl(),
): ModelCapabilityProfile => buildProfile(nominalContextWindowTokens, reasoningControl, MULTIMODAL_TOOLS);

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

const openAiLevelsDefaultMedium = levelsReasoningControl(OPENAI_LEVELS, {
  supportsOff: true,
  defaultSelection: 'medium',
  wireProfile: OPENAI_RESPONSES_WIRE,
});

const openAi56LevelsDefaultMedium = levelsReasoningControl(OPENAI_56_LEVELS, {
  supportsOff: true,
  defaultSelection: 'medium',
  wireProfile: OPENAI_RESPONSES_WIRE,
});

const openAiLevelsDefaultOff = levelsReasoningControl(OPENAI_LEVELS, {
  supportsOff: true,
  defaultSelection: 'off',
  wireProfile: OPENAI_RESPONSES_WIRE,
});

const openAiCompatibleLevelsDefaultMedium = levelsReasoningControl(OPENAI_LEVELS, {
  supportsOff: true,
  defaultSelection: 'medium',
  wireProfile: OPENAI_COMPATIBLE_WIRE,
});

const openAi56CompatibleLevelsDefaultMedium = levelsReasoningControl(OPENAI_56_LEVELS, {
  supportsOff: true,
  defaultSelection: 'medium',
  wireProfile: OPENAI_COMPATIBLE_WIRE,
});

const anthropicFiveLevelsDefaultHigh = levelsReasoningControl(ANTHROPIC_5_LEVELS, {
  supportsOff: true,
  defaultSelection: 'high',
  wireProfile: ANTHROPIC_ADAPTIVE_WIRE,
});

const anthropicFiveLevelsAlwaysOn = levelsReasoningControl(ANTHROPIC_5_LEVELS, {
  supportsOff: false,
  defaultSelection: 'high',
  wireProfile: ANTHROPIC_ALWAYS_ON_WIRE,
});

const gemini35Levels = levelsReasoningControl(GEMINI_35_LEVELS, {
  supportsOff: false,
  defaultSelection: 'medium',
  wireProfile: GEMINI_3_WIRE,
});

const gemini31Levels = levelsReasoningControl(GEMINI_31_LEVELS, {
  supportsOff: false,
  defaultSelection: 'high',
  wireProfile: GEMINI_3_WIRE,
});

const gemini25Levels = levelsReasoningControl(GEMINI_31_LEVELS, {
  supportsOff: false,
  defaultSelection: 'high',
  wireProfile: GEMINI_25_WIRE,
});

const xaiLevels = levelsReasoningControl(XAI_LEVELS, {
  supportsOff: true,
  defaultSelection: 'low',
  wireProfile: OPENAI_COMPATIBLE_WIRE,
});

const xaiLevelsDefaultHigh = levelsReasoningControl(XAI_LEVELS, {
  supportsOff: false,
  defaultSelection: 'high',
  wireProfile: OPENAI_COMPATIBLE_WIRE,
});

const qwenLevelsDefaultOff = levelsReasoningControl(QWEN_LEVELS, {
  supportsOff: true,
  defaultSelection: 'off',
  wireProfile: QWEN_OPENAI_WIRE,
});

const deepSeekLevelsDefaultHigh = levelsReasoningControl(DEEPSEEK_LEVELS, {
  supportsOff: true,
  defaultSelection: 'high',
  wireProfile: DEEPSEEK_ANTHROPIC_WIRE,
});

const moonshotToggleDefaultOn = toggleReasoningControl('on', MOONSHOT_TOGGLE_WIRE);
const moonshotAlwaysOn = alwaysOnReasoningControl('on', MOONSHOT_ALWAYS_ON_WIRE);
const anthropicToggleDefaultOn = toggleReasoningControl('on', ANTHROPIC_TOGGLE_WIRE);
const kimiCodingPlanToggleDefaultOn = toggleReasoningControl('on', KIMI_CODING_PLAN_WIRE);
const anthropicAlwaysOnToggle = alwaysOnReasoningControl('on', ANTHROPIC_ALWAYS_ON_TOGGLE_WIRE);
const volcengineToggleDefaultOn = toggleReasoningControl('on', VOLCENGINE_TOGGLE_WIRE);
const doubaoSeed20LevelsDefaultMedium = levelsReasoningControl(QWEN_LEVELS, {
  supportsOff: true,
  defaultSelection: 'medium',
  wireProfile: VOLCENGINE_DOUBAO_LEVELS_WIRE,
});
const xaiToggleDefaultOn = toggleReasoningControl('on', OPENAI_COMPATIBLE_WIRE);

const gpt56Api = multimodal(1_050_000, openAi56LevelsDefaultMedium);
const gpt55Api = multimodal(1_050_000, openAiLevelsDefaultMedium);
const gpt54Api = multimodal(1_050_000, openAiLevelsDefaultOff);
const gptMiniApi = multimodal(400_000, openAiLevelsDefaultOff);
const gptCodex = textOnly(400_000, openAiCompatibleLevelsDefaultMedium);
const gpt41 = multimodal(1_047_576);

const chatGptAccountModels = [
  model('gpt-5.6-sol', gpt56Api, CHATGPT_ACCOUNT_SOURCE, {
    label: 'GPT-5.6 Sol',
    aliases: ['gpt-5.6'],
  }),
  model('gpt-5.6-terra', gpt56Api, CHATGPT_ACCOUNT_SOURCE, { label: 'GPT-5.6 Terra' }),
  model('gpt-5.6-luna', gpt56Api, CHATGPT_ACCOUNT_SOURCE, { label: 'GPT-5.6 Luna' }),
  model('gpt-5.5', gpt55Api, CHATGPT_ACCOUNT_SOURCE),
  model('gpt-5.4', gpt54Api, CHATGPT_ACCOUNT_SOURCE),
  model('gpt-5.4-mini', gptMiniApi, CHATGPT_ACCOUNT_SOURCE),
];

const openAiApiModels = [
  model('gpt-5.6-sol', gpt56Api, OPENAI_API_SOURCE, {
    label: 'GPT-5.6 Sol',
    aliases: ['gpt-5.6'],
  }),
  model('gpt-5.6-terra', gpt56Api, OPENAI_API_SOURCE, { label: 'GPT-5.6 Terra' }),
  model('gpt-5.6-luna', gpt56Api, OPENAI_API_SOURCE, { label: 'GPT-5.6 Luna' }),
  model('gpt-5.5', gpt55Api, OPENAI_API_SOURCE),
  model('gpt-5.4', gpt54Api, OPENAI_API_SOURCE),
  model('gpt-5.4-mini', gptMiniApi, OPENAI_API_SOURCE),
  model('gpt-5.4-nano', gptMiniApi, OPENAI_API_SOURCE),
  model('gpt-5.3-codex', gptCodex, OPENAI_API_SOURCE),
  model('gpt-5.2-codex', gptCodex, OPENAI_API_SOURCE),
  model('gpt-4.1', gpt41, OPENAI_API_SOURCE),
];

const claudeApiModels = [
  model('claude-fable-5', multimodal(1_000_000, anthropicFiveLevelsAlwaysOn), ANTHROPIC_SOURCE),
  model('claude-sonnet-5', multimodal(1_000_000, anthropicFiveLevelsDefaultHigh), ANTHROPIC_SOURCE),
  model('claude-opus-4-8', multimodal(1_000_000, anthropicFiveLevelsDefaultHigh), ANTHROPIC_SOURCE),
  model('claude-haiku-4-5-20251001', multimodal(200_000), ANTHROPIC_SOURCE, {
    aliases: ['claude-haiku-4-5'],
  }),
];

const geminiModels = [
  model('gemini-3.5-flash', multimodal(1_048_576, gemini35Levels), GEMINI_SOURCE),
  model('gemini-3.1-pro-preview', multimodal(1_048_576, gemini31Levels), GEMINI_SOURCE),
  model('gemini-2.5-pro', multimodal(1_048_576, gemini25Levels), GEMINI_SOURCE, {
    aliases: ['gemini-pro'],
  }),
  model('gemini-2.5-flash', multimodal(1_048_576, gemini25Levels), GEMINI_SOURCE),
];

const grokModels = [
  model('grok-4.5', multimodal(500_000, xaiLevelsDefaultHigh), XAI_SOURCE, {
    aliases: ['grok-4.5-latest', 'grok-build-latest'],
  }),
  model('grok-4.3', multimodal(1_000_000, xaiLevels), XAI_SOURCE),
  model('grok-build-0.1', textOnly(256_000, xaiToggleDefaultOn), XAI_SOURCE),
  // Official docs redirect grok-code-fast-1 → grok-build-0.1; keep the same toggle profile.
  model('grok-code-fast-1', textOnly(256_000, xaiToggleDefaultOn), XAI_SOURCE),
];

const copilotModels = [
  model('gpt-5.6-sol', multimodal(1_050_000, openAi56CompatibleLevelsDefaultMedium), COPILOT_SOURCE, {
    label: 'GPT-5.6 Sol',
    aliases: ['gpt-5.6'],
  }),
  model('gpt-5.6-terra', multimodal(1_050_000, openAi56CompatibleLevelsDefaultMedium), COPILOT_SOURCE, {
    label: 'GPT-5.6 Terra',
  }),
  model('gpt-5.6-luna', multimodal(1_050_000, openAi56CompatibleLevelsDefaultMedium), COPILOT_SOURCE, {
    label: 'GPT-5.6 Luna',
  }),
  model('gpt-5.5', multimodal(1_050_000, openAiCompatibleLevelsDefaultMedium), COPILOT_SOURCE),
  model('gpt-5.3-codex', textOnly(400_000, openAiCompatibleLevelsDefaultMedium), COPILOT_SOURCE),
  model('claude-sonnet-5', multimodal(1_000_000, anthropicFiveLevelsDefaultHigh), COPILOT_SOURCE),
  model('claude-opus-4-8', {
    ...multimodal(1_000_000, anthropicFiveLevelsDefaultHigh),
    fast: { modelId: 'claude-opus-4-8-fast' },
  }, COPILOT_SOURCE),
  model('gemini-3.1-pro-preview', multimodal(1_048_576, gemini31Levels), COPILOT_SOURCE),
  model('gemini-3.5-flash', multimodal(1_048_576, gemini35Levels), COPILOT_SOURCE),
];

const qwenModels = [
  model('qwen-turbo', textOnly(131_072, qwenLevelsDefaultOff), QWEN_SOURCE),
  model('qwen-plus', textOnly(131_072, qwenLevelsDefaultOff), QWEN_SOURCE),
  model('qwen-max', textOnly(131_072, qwenLevelsDefaultOff), QWEN_SOURCE),
  model('qwen-flash', textOnly(131_072, qwenLevelsDefaultOff), QWEN_SOURCE),
  model('qwen-vl-max', multimodal(131_072, qwenLevelsDefaultOff), QWEN_SOURCE),
];

const qwenCodingPlanModels = [
  // Bailian Coding Plan FAQ: qwen3-coder-* do not support thinking mode.
  model('qwen3-coder-plus', textOnly(131_072), QWEN_SOURCE),
  model('qwen3-coder-next', textOnly(131_072), QWEN_SOURCE),
  model('qwen3.6-plus', textOnly(131_072, anthropicToggleDefaultOn), QWEN_SOURCE),
];

const deepSeekModels = [
  model('deepseek-v4-pro', textOnly(1_000_000, deepSeekLevelsDefaultHigh), DEEPSEEK_SOURCE, {
    aliases: ['deepseek-reasoner'],
  }),
  model('deepseek-v4-flash', textOnly(1_000_000, deepSeekLevelsDefaultHigh), DEEPSEEK_SOURCE, {
    aliases: ['deepseek-chat'],
  }),
];

const kimiApiModels = [
  model('kimi-k2.7-code', {
    ...multimodal(262_144, moonshotAlwaysOn),
    fast: { modelId: 'kimi-k2.7-code-highspeed' },
  }, KIMI_SOURCE),
  model('kimi-k2.7-code-highspeed', multimodal(262_144, moonshotAlwaysOn), KIMI_SOURCE),
  model('kimi-k2.6', multimodal(262_144, moonshotToggleDefaultOn), KIMI_SOURCE),
  model('kimi-k2.5', textOnly(262_144, moonshotToggleDefaultOn), KIMI_SOURCE),
];

const kimiCodingPlanModels = [
  model('kimi-for-coding', {
    ...textOnly(262_144, kimiCodingPlanToggleDefaultOn),
    fixedTemperature: 1,
    fast: { modelId: 'kimi-for-coding-highspeed' },
  }, KIMI_CODING_SOURCE),
  model('kimi-for-coding-highspeed', {
    ...textOnly(262_144, kimiCodingPlanToggleDefaultOn),
    fixedTemperature: 1,
  }, KIMI_CODING_SOURCE),
];

const glmAnthropicModels = [
  model('glm-5', textOnly(131_072, anthropicToggleDefaultOn), GLM_SOURCE),
  model('glm-4.7', textOnly(131_072, anthropicToggleDefaultOn), GLM_SOURCE),
  model('glm-4.6', textOnly(131_072, anthropicToggleDefaultOn), GLM_SOURCE),
  model('glm-4.5', textOnly(131_072, anthropicToggleDefaultOn), GLM_SOURCE),
];

const minimaxModels = [
  model('MiniMax-M2.7', textOnly(204_800, anthropicAlwaysOnToggle), MINIMAX_SOURCE),
];

const mimoModels = [
  model('mimo-v2.5-pro', multimodal(1_000_000, anthropicToggleDefaultOn), MIMO_SOURCE),
];

const doubaoModels = [
  model('doubao-seed-2.1-pro', textOnly(131_072, volcengineToggleDefaultOn), VOLCENGINE_SOURCE),
  model('doubao-seed-2.1-turbo', textOnly(131_072, volcengineToggleDefaultOn), VOLCENGINE_SOURCE),
];

const groqModels = [
  model('llama-3.3-70b-versatile', textOnly(131_072), GROQ_SOURCE),
  model('openai/gpt-oss-120b', textOnly(131_072), GROQ_SOURCE),
  model('meta-llama/llama-4-scout-17b-16e-instruct', {
    ...textOnly(131_072),
    visionInput: true,
  }, GROQ_SOURCE),
  model('qwen/qwen3-32b', textOnly(131_072), GROQ_SOURCE),
];

const mistralModels = [
  model('mistral-small-2603', multimodal(131_072), MISTRAL_SOURCE, {
    label: 'Mistral Small 4',
    aliases: ['mistral-small-latest'],
  }),
  model('mistral-large-latest', multimodal(131_072), MISTRAL_SOURCE),
  model('codestral-latest', textOnly(262_144), MISTRAL_SOURCE),
];

const cerebrasModels = [
  model('llama-4-scout-17b-16e-instruct', textOnly(131_072), CEREBRAS_SOURCE),
  model('qwen-3-coder-480b', textOnly(131_072), CEREBRAS_SOURCE),
  model('gpt-oss-120b', textOnly(131_072), CEREBRAS_SOURCE),
];

const bedrockClaudeModels = [
  model('anthropic.claude-fable-5', multimodal(1_000_000, anthropicFiveLevelsAlwaysOn), BEDROCK_SOURCE),
  model('anthropic.claude-sonnet-5', multimodal(1_000_000, anthropicFiveLevelsDefaultHigh), BEDROCK_SOURCE),
  model('anthropic.claude-opus-4-8', multimodal(1_000_000, anthropicFiveLevelsDefaultHigh), BEDROCK_SOURCE),
  model('anthropic.claude-haiku-4-5-20251001-v1:0', multimodal(200_000), BEDROCK_SOURCE),
];

const vertexModels = [
  model('claude-fable-5', multimodal(1_000_000, anthropicFiveLevelsAlwaysOn), VERTEX_SOURCE),
  model('claude-sonnet-5', multimodal(1_000_000, anthropicFiveLevelsDefaultHigh), VERTEX_SOURCE),
  model('claude-opus-4-8', multimodal(1_000_000, anthropicFiveLevelsDefaultHigh), VERTEX_SOURCE),
  model('claude-haiku-4-5@20251001', multimodal(200_000), VERTEX_SOURCE),
  model('gemini-3.1-pro-preview', multimodal(1_048_576, gemini31Levels), VERTEX_SOURCE),
  model('gemini-2.5-flash', multimodal(1_048_576, gemini25Levels), VERTEX_SOURCE),
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
    model('gpt-5.6-sol', multimodal(1_050_000, openAi56CompatibleLevelsDefaultMedium), AZURE_OPENAI_SOURCE, {
      label: 'GPT-5.6 Sol',
      aliases: ['gpt-5.6'],
    }),
    model('gpt-5.6-terra', multimodal(1_050_000, openAi56CompatibleLevelsDefaultMedium), AZURE_OPENAI_SOURCE, {
      label: 'GPT-5.6 Terra',
    }),
    model('gpt-5.6-luna', multimodal(1_050_000, openAi56CompatibleLevelsDefaultMedium), AZURE_OPENAI_SOURCE, {
      label: 'GPT-5.6 Luna',
    }),
    model('gpt-5.5', multimodal(1_050_000, levelsReasoningControl(OPENAI_LEVELS, {
      supportsOff: true,
      defaultSelection: 'medium',
      wireProfile: OPENAI_COMPATIBLE_WIRE,
    })), AZURE_OPENAI_SOURCE),
    model('gpt-5.4', multimodal(1_050_000, levelsReasoningControl(OPENAI_LEVELS, {
      supportsOff: true,
      defaultSelection: 'off',
      wireProfile: OPENAI_COMPATIBLE_WIRE,
    })), AZURE_OPENAI_SOURCE),
    model('gpt-5.4-mini', multimodal(400_000, levelsReasoningControl(OPENAI_LEVELS, {
      supportsOff: true,
      defaultSelection: 'off',
      wireProfile: OPENAI_COMPATIBLE_WIRE,
    })), AZURE_OPENAI_SOURCE),
    model('gpt-4.1', gpt41, AZURE_OPENAI_SOURCE),
  ],
  bedrock: bedrockClaudeModels,
  vertex: vertexModels,

  deepseek: deepSeekModels,
  bailian: qwenModels.map((entry) => ({
    ...entry,
    source: QWEN_SOURCE,
  })),
  qwen: qwenModels,
  volcengine: [
    ...doubaoModels,
    ...glmAnthropicModels.map((entry) => ({ ...entry, source: VOLCENGINE_SOURCE })),
    ...deepSeekModels.filter((entry) => entry.id === 'deepseek-v4-pro').map((entry) => ({
      ...entry,
      source: VOLCENGINE_SOURCE,
    })),
    ...kimiApiModels.filter((entry) => entry.id === 'kimi-k2.5').map((entry) => ({
      ...entry,
      source: VOLCENGINE_SOURCE,
    })),
  ],
  'glm-cn': glmAnthropicModels,
  'glm-global': glmAnthropicModels,
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
    model('kimi-k2.5', textOnly(262_144, anthropicToggleDefaultOn), KIMI_SOURCE),
    model('glm-5', textOnly(131_072, anthropicToggleDefaultOn), GLM_SOURCE),
    model('glm-4.7', textOnly(131_072, anthropicToggleDefaultOn), GLM_SOURCE),
  ],
  'volcengine-coding-plan': [
    model('doubao-seed-2.0-code', {
      ...textOnly(131_072, doubaoSeed20LevelsDefaultMedium),
      fast: { modelId: 'doubao-seed-2.0-lite' },
    }, VOLCENGINE_SOURCE),
    model('doubao-seed-2.0-pro', {
      ...textOnly(131_072, doubaoSeed20LevelsDefaultMedium),
      fast: { modelId: 'doubao-seed-2.0-lite' },
    }, VOLCENGINE_SOURCE),
    model('doubao-seed-2.0-lite', textOnly(131_072, doubaoSeed20LevelsDefaultMedium), VOLCENGINE_SOURCE, {
      aliases: ['doubao-seed-2.0-mini', 'doubao-seed-2-0-mini'],
    }),
    model('doubao-seed-code', textOnly(131_072, doubaoSeed20LevelsDefaultMedium), VOLCENGINE_SOURCE, {
      aliases: ['doubao-seed-code-preview'],
    }),
    model('minimax-m2.7', textOnly(204_800, anthropicAlwaysOnToggle), MINIMAX_SOURCE, {
      aliases: ['MiniMax-M2.7'],
    }),
    model('minimax-m2.5', textOnly(204_800, anthropicAlwaysOnToggle), MINIMAX_SOURCE, {
      aliases: ['MiniMax-M2.5'],
    }),
    model('kimi-k2.7-code', {
      ...textOnly(262_144, anthropicToggleDefaultOn),
      fast: { modelId: 'kimi-k2.7-code-highspeed' },
    }, KIMI_SOURCE),
    model('kimi-k2.7-code-highspeed', textOnly(262_144, anthropicToggleDefaultOn), KIMI_SOURCE),
    model('kimi-k2.6', textOnly(262_144, anthropicToggleDefaultOn), KIMI_SOURCE),
    model('kimi-k2.5', textOnly(262_144, anthropicToggleDefaultOn), KIMI_SOURCE),
    model('glm-5.2', textOnly(131_072, anthropicToggleDefaultOn), GLM_SOURCE, {
      aliases: ['glm-latest'],
    }),
    model('glm-5.1', textOnly(131_072, anthropicToggleDefaultOn), GLM_SOURCE),
    model('glm-4.7', textOnly(131_072, anthropicToggleDefaultOn), GLM_SOURCE),
    model('deepseek-v4-pro', textOnly(1_000_000, deepSeekLevelsDefaultHigh), DEEPSEEK_SOURCE),
    model('deepseek-v4-flash', textOnly(1_000_000, deepSeekLevelsDefaultHigh), DEEPSEEK_SOURCE),
    model('deepseek-v3.2', textOnly(128_000, deepSeekLevelsDefaultHigh), DEEPSEEK_SOURCE),
  ],
  'glm-cn-coding-plan': glmAnthropicModels,
  'glm-global-coding-plan': glmAnthropicModels,
  'minimax-cn-coding-plan': minimaxModels,
  'minimax-global-coding-plan': minimaxModels,
  'xiaomi-mimo-token-plan': mimoModels,
};

const normalizeId = (value: string): string => value.trim().toLowerCase();

function cloneProfile(profile: ModelCapabilityProfile): ModelCapabilityProfile {
  return {
    ...profile,
    reasoningControl: profile.reasoningControl ? createReasoningControl(profile.reasoningControl) : undefined,
  };
}

export function getManagedProviderModelCatalog(providerId: string): ManagedModelCatalogEntry[] {
  const entries = MANAGED_PROVIDER_MODEL_CATALOG[providerId as BuiltinLlmProviderId] ?? [];
  return entries.map((entry) => ({
    ...entry,
    aliases: entry.aliases ? [...entry.aliases] : undefined,
    profile: cloneProfile(entry.profile),
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
