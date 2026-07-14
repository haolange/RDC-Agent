import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "glm-cn-coding-plan",
  "vendorId": "zhipu",
  "label": "Zhipu AI GLM Coding Plan (CN)",
  "status": "stable",
  "availability": {
    "state": "unknown"
  },
  "category": "coding-token-plan",
  "catalogOwnership": "app-managed",
  "authModes": [
    "api-key"
  ],
  "capabilities": [
    "chat",
    "tool-calling",
    "reasoning",
    "model-discovery"
  ],
  "routes": [
    {
      "protocol": "AnthropicMessages",
      "baseUrl": "https://open.bigmodel.cn/api/anthropic",
      "default": true
    },
    {
      "protocol": "OpenAICompatibleChatCompletions",
      "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4"
    }
  ],
  "userSelectableRoute": true,
  "discovery": {
    "kind": "custom-parser",
    "parserId": "anthropic-candidate-validation"
  },
  "seedModels": [
    {
      "modelId": "glm-5",
      "label": "glm-5",
      "aliases": [],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://open.bigmodel.cn/api/anthropic",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 200000,
          "maxOutputTokens": 128000,
          "maxTotalTokens": 200000,
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 72000,
      "fast": {
        "kind": "unsupported"
      },
      "reasoning": {
        "kind": "toggle",
        "supportsOff": true,
        "levels": [],
        "defaultSelection": "on",
        "wireProfile": {
          "kind": "anthropic",
          "on": "high",
          "onMode": "enabled",
          "offMode": "disabled"
        }
      },
      "toolCalling": {
        "state": "supported"
      },
      "visionInput": {
        "state": "unsupported"
      },
      "structuredOutput": {
        "state": "supported"
      }
    },
    {
      "modelId": "glm-4.7",
      "label": "glm-4.7",
      "aliases": [],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://open.bigmodel.cn/api/anthropic",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 131072,
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 131072,
      "fast": {
        "kind": "unsupported"
      },
      "reasoning": {
        "kind": "toggle",
        "supportsOff": true,
        "levels": [],
        "defaultSelection": "on",
        "wireProfile": {
          "kind": "anthropic",
          "on": "high",
          "onMode": "enabled",
          "offMode": "disabled"
        }
      },
      "toolCalling": {
        "state": "supported"
      },
      "visionInput": {
        "state": "unsupported"
      },
      "structuredOutput": {
        "state": "supported"
      }
    },
    {
      "modelId": "glm-4.6",
      "label": "glm-4.6",
      "aliases": [],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://open.bigmodel.cn/api/anthropic",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 131072,
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 131072,
      "fast": {
        "kind": "unsupported"
      },
      "reasoning": {
        "kind": "toggle",
        "supportsOff": true,
        "levels": [],
        "defaultSelection": "on",
        "wireProfile": {
          "kind": "anthropic",
          "on": "high",
          "onMode": "enabled",
          "offMode": "disabled"
        }
      },
      "toolCalling": {
        "state": "supported"
      },
      "visionInput": {
        "state": "unsupported"
      },
      "structuredOutput": {
        "state": "supported"
      }
    },
    {
      "modelId": "glm-4.5",
      "label": "glm-4.5",
      "aliases": [],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://open.bigmodel.cn/api/anthropic",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 131072,
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 131072,
      "fast": {
        "kind": "unsupported"
      },
      "reasoning": {
        "kind": "toggle",
        "supportsOff": true,
        "levels": [],
        "defaultSelection": "on",
        "wireProfile": {
          "kind": "anthropic",
          "on": "high",
          "onMode": "enabled",
          "offMode": "disabled"
        }
      },
      "toolCalling": {
        "state": "supported"
      },
      "visionInput": {
        "state": "unsupported"
      },
      "structuredOutput": {
        "state": "supported"
      }
    }
  ],
  "overlays": [],
  "recommendedModels": [
    "glm-5",
    "glm-4.7",
    "sonnet",
    "opus",
    "haiku"
  ],
  "docsUrl": "https://open.bigmodel.cn/"
};

export default preset;
