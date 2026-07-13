import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "volcengine-coding-plan",
  "vendorId": "bytedance",
  "label": "Volcengine Ark Coding Plan",
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
      "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
      "default": true
    },
    {
      "protocol": "OpenAICompatibleChatCompletions",
      "baseUrl": "https://ark.cn-beijing.volces.com/api/coding/v3"
    }
  ],
  "userSelectableRoute": true,
  "discovery": {
    "kind": "custom-parser",
    "parserId": "anthropic-candidate-validation"
  },
  "seedModels": [
    {
      "modelId": "doubao-seed-2.0-code",
      "label": "doubao-seed-2.0-code",
      "aliases": [],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
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
        "kind": "model-variant",
        "modelId": "doubao-seed-2.0-lite",
        "entitlement": "granted"
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
        "defaultSelection": "medium",
        "wireProfile": {
          "kind": "openai-compatible",
          "on": "medium",
          "levels": {
            "minimal": "minimal",
            "low": "low",
            "medium": "medium",
            "high": "high"
          },
          "onMode": "thinking-enabled",
          "offMode": "thinking-disabled"
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
      "modelId": "doubao-seed-2.0-pro",
      "label": "doubao-seed-2.0-pro",
      "aliases": [],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
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
        "kind": "model-variant",
        "modelId": "doubao-seed-2.0-lite",
        "entitlement": "granted"
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
        "defaultSelection": "medium",
        "wireProfile": {
          "kind": "openai-compatible",
          "on": "medium",
          "levels": {
            "minimal": "minimal",
            "low": "low",
            "medium": "medium",
            "high": "high"
          },
          "onMode": "thinking-enabled",
          "offMode": "thinking-disabled"
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
      "modelId": "doubao-seed-2.0-lite",
      "label": "doubao-seed-2.0-lite",
      "aliases": [
        "doubao-seed-2.0-mini",
        "doubao-seed-2-0-mini"
      ],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
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
        "defaultSelection": "medium",
        "wireProfile": {
          "kind": "openai-compatible",
          "on": "medium",
          "levels": {
            "minimal": "minimal",
            "low": "low",
            "medium": "medium",
            "high": "high"
          },
          "onMode": "thinking-enabled",
          "offMode": "thinking-disabled"
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
      "modelId": "doubao-seed-code",
      "label": "doubao-seed-code",
      "aliases": [
        "doubao-seed-code-preview"
      ],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
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
        "defaultSelection": "medium",
        "wireProfile": {
          "kind": "openai-compatible",
          "on": "medium",
          "levels": {
            "minimal": "minimal",
            "low": "low",
            "medium": "medium",
            "high": "high"
          },
          "onMode": "thinking-enabled",
          "offMode": "thinking-disabled"
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
      "modelId": "minimax-m2.7",
      "label": "minimax-m2.7",
      "aliases": [
        "MiniMax-M2.7"
      ],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 204800,
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 204800,
      "fast": {
        "kind": "unsupported"
      },
      "reasoning": {
        "kind": "always-on",
        "supportsOff": false,
        "levels": [],
        "defaultSelection": "on",
        "lockedSelection": "on",
        "wireProfile": {
          "kind": "anthropic",
          "on": "high",
          "onMode": "enabled"
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
      "modelId": "minimax-m2.5",
      "label": "minimax-m2.5",
      "aliases": [
        "MiniMax-M2.5"
      ],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 204800,
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 204800,
      "fast": {
        "kind": "unsupported"
      },
      "reasoning": {
        "kind": "always-on",
        "supportsOff": false,
        "levels": [],
        "defaultSelection": "on",
        "lockedSelection": "on",
        "wireProfile": {
          "kind": "anthropic",
          "on": "high",
          "onMode": "enabled"
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
      "modelId": "kimi-k2.7-code",
      "label": "kimi-k2.7-code",
      "aliases": [],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 262144,
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 256000,
      "fast": {
        "kind": "model-variant",
        "modelId": "kimi-k2.7-code-highspeed",
        "entitlement": "granted"
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
      "modelId": "kimi-k2.7-code-highspeed",
      "label": "kimi-k2.7-code-highspeed",
      "aliases": [],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 262144,
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 256000,
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
      "modelId": "kimi-k2.6",
      "label": "kimi-k2.6",
      "aliases": [],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 262144,
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 256000,
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
      "modelId": "kimi-k2.5",
      "label": "kimi-k2.5",
      "aliases": [],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 262144,
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 256000,
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
      "modelId": "glm-5.2",
      "label": "glm-5.2",
      "aliases": [
        "glm-latest"
      ],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
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
      "modelId": "glm-5.1",
      "label": "glm-5.1",
      "aliases": [],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
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
        "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
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
      "modelId": "deepseek-v4-pro",
      "label": "deepseek-v4-pro",
      "aliases": [],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 1000000,
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 256000,
      "fast": {
        "kind": "unsupported"
      },
      "reasoning": {
        "kind": "levels",
        "supportsOff": true,
        "levels": [
          "high",
          "max"
        ],
        "defaultSelection": "high",
        "wireProfile": {
          "kind": "anthropic",
          "on": "high",
          "levels": {
            "high": "high",
            "max": "max"
          },
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
      "modelId": "deepseek-v4-flash",
      "label": "deepseek-v4-flash",
      "aliases": [],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 1000000,
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 256000,
      "fast": {
        "kind": "unsupported"
      },
      "reasoning": {
        "kind": "levels",
        "supportsOff": true,
        "levels": [
          "high",
          "max"
        ],
        "defaultSelection": "high",
        "wireProfile": {
          "kind": "anthropic",
          "on": "high",
          "levels": {
            "high": "high",
            "max": "max"
          },
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
    "doubao-seed-2.0-code",
    "doubao-seed-2.0-pro",
    "doubao-seed-2.0-lite",
    "glm-5.2",
    "kimi-k2.7-code",
    "deepseek-v4-pro",
    "minimax-m2.7"
  ],
  "docsUrl": "https://www.volcengine.com/docs/82379/1928261"
};

export default preset;
