import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "openai-eu",
  "vendorId": "openai",
  "label": "OpenAI (EU)",
  "status": "stable",
  "availability": {
    "state": "unknown"
  },
  "category": "official-direct",
  "catalogOwnership": "app-managed",
  "authModes": [
    "api-key"
  ],
  "capabilities": [
    "chat",
    "tool-calling",
    "structured-output",
    "vision-input",
    "model-discovery"
  ],
  "routes": [
    {
      "protocol": "OpenAIResponses",
      "baseUrl": "https://eu.api.openai.com/v1",
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
      "modelId": "gpt-5.6-sol",
      "label": "GPT-5.6 Sol",
      "aliases": [
        "gpt-5.6"
      ],
      "route": {
        "protocol": "OpenAIResponses",
        "baseUrl": "https://eu.api.openai.com/v1",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 1050000,
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
          "kind": "openai-responses",
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
        "protocol": "OpenAIResponses",
        "baseUrl": "https://eu.api.openai.com/v1",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 1050000,
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
          "kind": "openai-responses",
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
        "protocol": "OpenAIResponses",
        "baseUrl": "https://eu.api.openai.com/v1",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 1050000,
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
          "kind": "openai-responses",
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
        "protocol": "OpenAIResponses",
        "baseUrl": "https://eu.api.openai.com/v1",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 1050000,
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
          "kind": "openai-responses",
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
      "modelId": "gpt-5.4",
      "label": "gpt-5.4",
      "aliases": [],
      "route": {
        "protocol": "OpenAIResponses",
        "baseUrl": "https://eu.api.openai.com/v1",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 1050000,
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
        "defaultSelection": "off",
        "wireProfile": {
          "kind": "openai-responses",
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
      "modelId": "gpt-5.4-mini",
      "label": "gpt-5.4-mini",
      "aliases": [],
      "route": {
        "protocol": "OpenAIResponses",
        "baseUrl": "https://eu.api.openai.com/v1",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 400000,
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
        "defaultSelection": "off",
        "wireProfile": {
          "kind": "openai-responses",
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
      "modelId": "gpt-5.4-nano",
      "label": "gpt-5.4-nano",
      "aliases": [],
      "route": {
        "protocol": "OpenAIResponses",
        "baseUrl": "https://eu.api.openai.com/v1",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 400000,
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
        "defaultSelection": "off",
        "wireProfile": {
          "kind": "openai-responses",
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
        "protocol": "OpenAIResponses",
        "baseUrl": "https://eu.api.openai.com/v1",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 400000,
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
      "modelId": "gpt-5.2-codex",
      "label": "gpt-5.2-codex",
      "aliases": [],
      "route": {
        "protocol": "OpenAIResponses",
        "baseUrl": "https://eu.api.openai.com/v1",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 400000,
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
      "modelId": "gpt-4.1",
      "label": "gpt-4.1",
      "aliases": [],
      "route": {
        "protocol": "OpenAIResponses",
        "baseUrl": "https://eu.api.openai.com/v1",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 1047576,
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
    }
  ],
  "overlays": [],
  "recommendedModels": [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3-codex",
    "gpt-4.1"
  ],
  "docsUrl": "https://platform.openai.com/api-keys"
};

export default preset;
