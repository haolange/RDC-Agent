import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "glm-global",
  "vendorId": "zhipu",
  "label": "Z.ai GLM (Global)",
  "status": "stable",
  "availability": {
    "state": "unknown"
  },
  "category": "official-compatible",
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
      "baseUrl": "https://api.z.ai/api/anthropic",
      "default": true
    },
    {
      "protocol": "OpenAICompatibleChatCompletions",
      "baseUrl": "https://api.z.ai/api/paas/v4"
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
        "baseUrl": "https://api.z.ai/api/anthropic",
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
      "modelId": "glm-4.7",
      "label": "glm-4.7",
      "aliases": [],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://api.z.ai/api/anthropic",
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
        "baseUrl": "https://api.z.ai/api/anthropic",
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
        "baseUrl": "https://api.z.ai/api/anthropic",
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
    "sonnet",
    "opus",
    "haiku"
  ],
  "docsUrl": "https://platform.z.ai/"
};

export default preset;

