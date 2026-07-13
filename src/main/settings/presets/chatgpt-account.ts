import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "chatgpt-account",
  "vendorId": "openai",
  "label": "ChatGPT Account",
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
      "protocol": "OpenAIResponses",
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
        "protocol": "OpenAIResponses",
        "baseUrl": "",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Codex service limit",
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 256000,
      "fast": {
        "kind": "request-param",
        "patch": {
          "service_tier": "priority"
        },
        "entitlement": "granted",
        "label": "Fast"
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
        "baseUrl": "",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Codex service limit",
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 256000,
      "fast": {
        "kind": "request-param",
        "patch": {
          "service_tier": "priority"
        },
        "entitlement": "granted",
        "label": "Fast"
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
        "baseUrl": "",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Codex service limit",
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 256000,
      "fast": {
        "kind": "request-param",
        "patch": {
          "service_tier": "priority"
        },
        "entitlement": "granted",
        "label": "Fast"
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
        "baseUrl": "",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Codex service limit",
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 256000,
      "fast": {
        "kind": "request-param",
        "patch": {
          "service_tier": "priority"
        },
        "entitlement": "granted",
        "label": "Fast"
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
        "baseUrl": "",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Codex service limit",
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 256000,
      "fast": {
        "kind": "request-param",
        "patch": {
          "service_tier": "priority"
        },
        "entitlement": "granted",
        "label": "Fast"
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
        "baseUrl": "",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Codex service limit",
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 256000,
      "fast": {
        "kind": "request-param",
        "patch": {
          "service_tier": "priority"
        },
        "entitlement": "granted",
        "label": "Fast"
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
    }
  ],
  "overlays": [],
  "recommendedModels": [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini"
  ],
  "docsUrl": "https://chatgpt.com/"
};

export default preset;

