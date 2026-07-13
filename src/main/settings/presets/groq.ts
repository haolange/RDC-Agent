import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "groq",
  "vendorId": "groq",
  "label": "Groq",
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
    "model-discovery"
  ],
  "routes": [
    {
      "protocol": "OpenAICompatibleChatCompletions",
      "baseUrl": "https://api.groq.com/openai/v1",
      "default": true
    }
  ],
  "userSelectableRoute": false,
  "discovery": {
    "kind": "custom-parser",
    "parserId": "openai-compatible"
  },
  "seedModels": [
    {
      "modelId": "llama-3.3-70b-versatile",
      "label": "llama-3.3-70b-versatile",
      "aliases": [],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "https://api.groq.com/openai/v1",
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
        "kind": "none",
        "supportsOff": true,
        "levels": [],
        "defaultSelection": "off",
        "wireProfile": {
          "kind": "none"
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
      "modelId": "openai/gpt-oss-120b",
      "label": "openai/gpt-oss-120b",
      "aliases": [],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "https://api.groq.com/openai/v1",
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
        "kind": "none",
        "supportsOff": true,
        "levels": [],
        "defaultSelection": "off",
        "wireProfile": {
          "kind": "none"
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
      "modelId": "meta-llama/llama-4-scout-17b-16e-instruct",
      "label": "meta-llama/llama-4-scout-17b-16e-instruct",
      "aliases": [],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "https://api.groq.com/openai/v1",
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
        "kind": "none",
        "supportsOff": true,
        "levels": [],
        "defaultSelection": "off",
        "wireProfile": {
          "kind": "none"
        }
      },
      "toolCalling": {
        "state": "supported"
      },
      "visionInput": {
        "state": "supported"
      },
      "structuredOutput": {
        "state": "supported"
      }
    },
    {
      "modelId": "qwen/qwen3-32b",
      "label": "qwen/qwen3-32b",
      "aliases": [],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "https://api.groq.com/openai/v1",
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
        "kind": "none",
        "supportsOff": true,
        "levels": [],
        "defaultSelection": "off",
        "wireProfile": {
          "kind": "none"
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
    "openai/gpt-oss-120b",
    "llama-3.3-70b-versatile"
  ],
  "docsUrl": "https://console.groq.com/keys"
};

export default preset;

