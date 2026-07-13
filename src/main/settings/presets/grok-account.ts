import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "grok-account",
  "vendorId": "xai",
  "label": "Super Grok Account",
  "status": "stable",
  "availability": {
    "state": "unknown"
  },
  "category": "login-authorization",
  "catalogOwnership": "app-managed",
  "authModes": [
    "oauth"
  ],
  "capabilities": [
    "chat",
    "tool-calling",
    "vision-input",
    "model-discovery"
  ],
  "routes": [
    {
      "protocol": "OpenAICompatibleChatCompletions",
      "baseUrl": "https://api.x.ai/v1",
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
      "modelId": "grok-4.5",
      "label": "grok-4.5",
      "aliases": [
        "grok-4.5-latest",
        "grok-build-latest"
      ],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "https://api.x.ai/v1",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 500000,
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
        "state": "supported"
      },
      "structuredOutput": {
        "state": "supported"
      }
    },
    {
      "modelId": "grok-4.3",
      "label": "grok-4.3",
      "aliases": [],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "https://api.x.ai/v1",
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
          "high"
        ],
        "defaultSelection": "low",
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
        "state": "supported"
      },
      "structuredOutput": {
        "state": "supported"
      }
    },
    {
      "modelId": "grok-build-0.1",
      "label": "grok-build-0.1",
      "aliases": [],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "https://api.x.ai/v1",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 256000,
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
      "modelId": "grok-code-fast-1",
      "label": "grok-code-fast-1",
      "aliases": [],
      "route": {
        "protocol": "OpenAICompatibleChatCompletions",
        "baseUrl": "https://api.x.ai/v1",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 256000,
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
    }
  ],
  "overlays": [],
  "recommendedModels": [
    "grok-4.5",
    "grok-4.3",
    "grok-build-0.1",
    "grok-code-fast-1"
  ],
  "docsUrl": "https://grok.com/",
  "accountLoginConfigured": true
};

export default preset;
