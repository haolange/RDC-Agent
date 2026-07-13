import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "google-ai-studio",
  "vendorId": "google",
  "label": "Google AI Studio",
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
    "reasoning",
    "vision-input",
    "model-discovery"
  ],
  "routes": [
    {
      "protocol": "GoogleGemini",
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
      "default": true
    }
  ],
  "userSelectableRoute": false,
  "discovery": {
    "kind": "custom-parser",
    "parserId": "google-ai-studio"
  },
  "seedModels": [
    {
      "modelId": "gemini-3.5-flash",
      "label": "gemini-3.5-flash",
      "aliases": [],
      "route": {
        "protocol": "GoogleGemini",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
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
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultSelection": "medium",
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
      "modelId": "gemini-3.1-pro-preview",
      "label": "gemini-3.1-pro-preview",
      "aliases": [],
      "route": {
        "protocol": "GoogleGemini",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
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
      "modelId": "gemini-2.5-pro",
      "label": "gemini-2.5-pro",
      "aliases": [
        "gemini-pro"
      ],
      "route": {
        "protocol": "GoogleGemini",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
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
    },
    {
      "modelId": "gemini-2.5-flash",
      "label": "gemini-2.5-flash",
      "aliases": [],
      "route": {
        "protocol": "GoogleGemini",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
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
    "gemini-2.5-pro",
    "gemini-2.5-flash"
  ],
  "docsUrl": "https://aistudio.google.com/app/apikey"
};

export default preset;

