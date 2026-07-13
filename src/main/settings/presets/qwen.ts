import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "qwen",
  "vendorId": "alibaba",
  "label": "Qwen / DashScope",
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
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
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
      "modelId": "qwen-turbo",
      "label": "qwen-turbo",
      "aliases": [],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
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
        "kind": "levels",
        "supportsOff": true,
        "levels": [
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultSelection": "off",
        "wireProfile": {
          "kind": "openai-compatible",
          "on": "medium",
          "levels": {
            "minimal": "minimal",
            "low": "low",
            "medium": "medium",
            "high": "high"
          },
          "onMode": "enable-thinking-true",
          "offMode": "enable-thinking-false"
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
      "modelId": "qwen-plus",
      "label": "qwen-plus",
      "aliases": [],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
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
        "kind": "levels",
        "supportsOff": true,
        "levels": [
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultSelection": "off",
        "wireProfile": {
          "kind": "openai-compatible",
          "on": "medium",
          "levels": {
            "minimal": "minimal",
            "low": "low",
            "medium": "medium",
            "high": "high"
          },
          "onMode": "enable-thinking-true",
          "offMode": "enable-thinking-false"
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
      "modelId": "qwen-max",
      "label": "qwen-max",
      "aliases": [],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
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
        "kind": "levels",
        "supportsOff": true,
        "levels": [
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultSelection": "off",
        "wireProfile": {
          "kind": "openai-compatible",
          "on": "medium",
          "levels": {
            "minimal": "minimal",
            "low": "low",
            "medium": "medium",
            "high": "high"
          },
          "onMode": "enable-thinking-true",
          "offMode": "enable-thinking-false"
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
      "modelId": "qwen-flash",
      "label": "qwen-flash",
      "aliases": [],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
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
        "kind": "levels",
        "supportsOff": true,
        "levels": [
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultSelection": "off",
        "wireProfile": {
          "kind": "openai-compatible",
          "on": "medium",
          "levels": {
            "minimal": "minimal",
            "low": "low",
            "medium": "medium",
            "high": "high"
          },
          "onMode": "enable-thinking-true",
          "offMode": "enable-thinking-false"
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
      "modelId": "qwen-vl-max",
      "label": "qwen-vl-max",
      "aliases": [],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
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
        "kind": "levels",
        "supportsOff": true,
        "levels": [
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultSelection": "off",
        "wireProfile": {
          "kind": "openai-compatible",
          "on": "medium",
          "levels": {
            "minimal": "minimal",
            "low": "low",
            "medium": "medium",
            "high": "high"
          },
          "onMode": "enable-thinking-true",
          "offMode": "enable-thinking-false"
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
    }
  ],
  "overlays": [],
  "recommendedModels": [
    "qwen-turbo",
    "qwen-plus",
    "qwen-max",
    "qwen-flash",
    "qwen-vl-max"
  ],
  "docsUrl": "https://dashscope.console.aliyun.com/apiKey"
};

export default preset;

