import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "azure-openai",
  "vendorId": "openai",
  "label": "Azure OpenAI",
  "status": "stable",
  "availability": {
    "state": "unavailable",
    "reason": "Azure OpenAI runtime authentication and deployment routing are not implemented."
  },
  "category": "cloud-platform",
  "catalogOwnership": "app-managed",
  "authModes": [
    "api-key"
  ],
  "baseUrlEditable": true,
  "capabilities": [
    "chat",
    "model-discovery"
  ],
  "routes": [
    {
      "protocol": "AzureOpenAIChatCompletions",
      "baseUrl": "",
      "default": true
    }
  ],
  "userSelectableRoute": false,
  "discovery": {
    "kind": "custom-parser",
    "parserId": "azure-openai"
  },
  "seedModels": [
    {
      "modelId": "gpt-5.6-sol",
      "label": "GPT-5.6 Sol",
      "aliases": [
        "gpt-5.6"
      ],
      "route": {
        "protocol": "AzureOpenAIChatCompletions",
        "baseUrl": "",
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
          "xhigh",
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
            "xhigh": "xhigh",
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
        "protocol": "AzureOpenAIChatCompletions",
        "baseUrl": "",
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
          "xhigh",
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
            "xhigh": "xhigh",
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
        "protocol": "AzureOpenAIChatCompletions",
        "baseUrl": "",
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
          "xhigh",
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
            "xhigh": "xhigh",
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
        "protocol": "AzureOpenAIChatCompletions",
        "baseUrl": "",
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
          "xhigh"
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
            "xhigh": "xhigh",
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
        "protocol": "AzureOpenAIChatCompletions",
        "baseUrl": "",
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
          "xhigh"
        ],
        "defaultSelection": "off",
        "wireProfile": {
          "kind": "openai-compatible",
          "on": "medium",
          "levels": {
            "minimal": "minimal",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "xhigh": "xhigh",
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
        "protocol": "AzureOpenAIChatCompletions",
        "baseUrl": "",
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
          "xhigh"
        ],
        "defaultSelection": "off",
        "wireProfile": {
          "kind": "openai-compatible",
          "on": "medium",
          "levels": {
            "minimal": "minimal",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "xhigh": "xhigh",
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
        "state": "supported"
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
        "protocol": "AzureOpenAIChatCompletions",
        "baseUrl": "",
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
    "gpt-4.1",
    "gpt-5-mini"
  ],
  "docsUrl": "https://learn.microsoft.com/azure/ai-services/openai/"
};

export default preset;

