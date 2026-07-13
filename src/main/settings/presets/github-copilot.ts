import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "github-copilot",
  "vendorId": "github",
  "label": "GitHub Copilot",
  "status": "stable",
  "availability": {
    "state": "unknown"
  },
  "category": "login-authorization",
  "catalogOwnership": "app-managed",
  "authModes": [
    "oauth"
  ],
  "accountLoginConfigured": true,
  "capabilities": [
    "chat",
    "tool-calling",
    "model-discovery"
  ],
  "routes": [
    {
      "protocol": "OpenAICompatibleChatCompletions",
      "baseUrl": "",
      "default": true
    }
  ],
  "userSelectableRoute": false,
  "discovery": {
    "kind": "custom-parser",
    "parserId": "account-catalog"
  },
  "seedModels": [
    {
      "modelId": "gpt-5.6-sol",
      "label": "GPT-5.6 Sol",
      "aliases": [
        "gpt-5.6"
      ],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 272000,
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
          "low",
          "medium",
          "high",
          "extra",
          "max"
        ],
        "defaultSelection": "medium",
        "wireProfile": {
          "kind": "openai-compatible",
          "on": "medium",
          "levels": {
            "minimal": "minimal",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "extra": "xhigh",
            "max": "max",
            "ultra": "ultra"
          }
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
      "modelId": "gpt-5.6-terra",
      "label": "GPT-5.6 Terra",
      "aliases": [],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 272000,
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
          "low",
          "medium",
          "high",
          "extra",
          "max"
        ],
        "defaultSelection": "medium",
        "wireProfile": {
          "kind": "openai-compatible",
          "on": "medium",
          "levels": {
            "minimal": "minimal",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "extra": "xhigh",
            "max": "max",
            "ultra": "ultra"
          }
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
      "modelId": "gpt-5.6-luna",
      "label": "GPT-5.6 Luna",
      "aliases": [],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 272000,
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
          "low",
          "medium",
          "high",
          "extra",
          "max"
        ],
        "defaultSelection": "medium",
        "wireProfile": {
          "kind": "openai-compatible",
          "on": "medium",
          "levels": {
            "minimal": "minimal",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "extra": "xhigh",
            "max": "max",
            "ultra": "ultra"
          }
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
      "modelId": "gpt-5.5",
      "label": "gpt-5.5",
      "aliases": [],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 272000,
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
          "low",
          "medium",
          "high",
          "extra"
        ],
        "defaultSelection": "medium",
        "wireProfile": {
          "kind": "openai-compatible",
          "on": "medium",
          "levels": {
            "minimal": "minimal",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "extra": "xhigh",
            "max": "max",
            "ultra": "ultra"
          }
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
      "modelId": "gpt-5.3-codex",
      "label": "gpt-5.3-codex",
      "aliases": [],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 272000,
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
          "low",
          "medium",
          "high",
          "extra"
        ],
        "defaultSelection": "medium",
        "wireProfile": {
          "kind": "openai-compatible",
          "on": "medium",
          "levels": {
            "minimal": "minimal",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "extra": "xhigh",
            "max": "max",
            "ultra": "ultra"
          },
          "offMode": "reasoning-none"
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
      "modelId": "claude-sonnet-5",
      "label": "claude-sonnet-5",
      "aliases": [],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 272000,
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
          "low",
          "medium",
          "high",
          "extra",
          "max"
        ],
        "defaultSelection": "high",
        "wireProfile": {
          "kind": "openai-compatible",
          "on": "high",
          "levels": {
            "low": "low",
            "medium": "medium",
            "high": "high",
            "extra": "xhigh",
            "max": "max"
          },
          "onMode": "thinking-enabled",
          "offMode": "thinking-disabled"
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
      "modelId": "claude-opus-4-8",
      "label": "claude-opus-4-8",
      "aliases": [],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 272000,
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 256000,
      "fast": {
        "kind": "model-variant",
        "modelId": "claude-opus-4-8-fast",
        "entitlement": "granted"
      },
      "reasoning": {
        "kind": "levels",
        "supportsOff": true,
        "levels": [
          "low",
          "medium",
          "high",
          "extra",
          "max"
        ],
        "defaultSelection": "high",
        "wireProfile": {
          "kind": "openai-compatible",
          "on": "high",
          "levels": {
            "low": "low",
            "medium": "medium",
            "high": "high",
            "extra": "xhigh",
            "max": "max"
          },
          "onMode": "thinking-enabled",
          "offMode": "thinking-disabled"
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
      "modelId": "gemini-3.1-pro-preview",
      "label": "gemini-3.1-pro-preview",
      "aliases": [],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 272000,
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
        "supportsOff": false,
        "levels": [
          "low",
          "medium",
          "high"
        ],
        "defaultSelection": "high",
        "wireProfile": {
          "kind": "openai-compatible",
          "on": "medium",
          "levels": {
            "minimal": "minimal",
            "low": "low",
            "medium": "medium",
            "high": "high"
          }
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
      "modelId": "gemini-3.5-flash",
      "label": "gemini-3.5-flash",
      "aliases": [],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 272000,
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
        "supportsOff": false,
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
          }
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
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.3-codex",
    "claude-sonnet-5",
    "claude-opus-4-8",
    "gemini-3.1-pro-preview",
    "gemini-3.5-flash"
  ],
  "docsUrl": "https://github.com/features/copilot"
};

export default preset;
