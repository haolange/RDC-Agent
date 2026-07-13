import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "vertex",
  "vendorId": "anthropic",
  "label": "Google Vertex AI",
  "status": "stable",
  "availability": {
    "state": "unavailable",
    "reason": "Google Vertex AI runtime authentication and regional routing are not implemented."
  },
  "category": "cloud-platform",
  "catalogOwnership": "app-managed",
  "authModes": [
    "environment"
  ],
  "capabilities": [
    "chat"
  ],
  "routes": [
    {
      "protocol": "GoogleVertexAI",
      "baseUrl": "",
      "default": true
    }
  ],
  "userSelectableRoute": false,
  "discovery": {
    "kind": "custom-parser",
    "parserId": "static"
  },
  "seedModels": [
    {
      "modelId": "claude-fable-5",
      "label": "claude-fable-5",
      "aliases": [],
      "route": {
        "protocol": "GoogleVertexAI",
        "baseUrl": "",
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
        "supportsOff": false,
        "levels": [
          "low",
          "medium",
          "high",
          "extra",
          "max"
        ],
        "defaultSelection": "high",
        "wireProfile": {
          "kind": "anthropic",
          "on": "high",
          "levels": {
            "low": "low",
            "medium": "medium",
            "high": "high",
            "extra": "xhigh",
            "max": "max"
          },
          "onMode": "adaptive"
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
      "modelId": "claude-sonnet-5",
      "label": "claude-sonnet-5",
      "aliases": [],
      "route": {
        "protocol": "GoogleVertexAI",
        "baseUrl": "",
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
          "low",
          "medium",
          "high",
          "extra",
          "max"
        ],
        "defaultSelection": "high",
        "wireProfile": {
          "kind": "anthropic",
          "on": "high",
          "levels": {
            "low": "low",
            "medium": "medium",
            "high": "high",
            "extra": "xhigh",
            "max": "max"
          },
          "onMode": "adaptive",
          "offMode": "disabled"
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
        "protocol": "GoogleVertexAI",
        "baseUrl": "",
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
          "low",
          "medium",
          "high",
          "extra",
          "max"
        ],
        "defaultSelection": "high",
        "wireProfile": {
          "kind": "anthropic",
          "on": "high",
          "levels": {
            "low": "low",
            "medium": "medium",
            "high": "high",
            "extra": "xhigh",
            "max": "max"
          },
          "onMode": "adaptive",
          "offMode": "disabled"
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
      "modelId": "claude-haiku-4-5@20251001",
      "label": "claude-haiku-4-5@20251001",
      "aliases": [],
      "route": {
        "protocol": "GoogleVertexAI",
        "baseUrl": "",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 200000,
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 200000,
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
      "modelId": "gemini-3.1-pro-preview",
      "label": "gemini-3.1-pro-preview",
      "aliases": [],
      "route": {
        "protocol": "GoogleVertexAI",
        "baseUrl": "",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 1048576,
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
          "kind": "gemini-thinking-level",
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
      "modelId": "gemini-2.5-flash",
      "label": "gemini-2.5-flash",
      "aliases": [],
      "route": {
        "protocol": "GoogleVertexAI",
        "baseUrl": "",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 1048576,
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
          "kind": "gemini-thinking-budget",
          "on": "high",
          "levels": {
            "low": 1024,
            "medium": 4096,
            "high": 8192
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
    "sonnet",
    "opus",
    "haiku"
  ],
  "docsUrl": "https://docs.anthropic.com/en/docs/claude-code/google-vertex-ai"
};

export default preset;

