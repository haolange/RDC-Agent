import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "claude-account",
  "vendorId": "anthropic",
  "label": "Claude Account",
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
    "reasoning",
    "prompt-cache",
    "model-discovery"
  ],
  "routes": [
    {
      "protocol": "AnthropicMessages",
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
      "modelId": "claude-fable-5",
      "label": "claude-fable-5",
      "aliases": [],
      "route": {
        "protocol": "AnthropicMessages",
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
        },
        {
          "id": "max",
          "label": "1M context",
          "maxPromptTokens": 1000000,
          "activation": {
            "kind": "header",
            "headers": {
              "anthropic-beta": "context-1m-2025-08-07"
            }
          },
          "entitlement": "unknown"
        }
      ],
      "defaultBudgetTokens": 200000,
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
          "xhigh",
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
            "xhigh": "xhigh",
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
        "protocol": "AnthropicMessages",
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
        },
        {
          "id": "max",
          "label": "1M context",
          "maxPromptTokens": 1000000,
          "activation": {
            "kind": "header",
            "headers": {
              "anthropic-beta": "context-1m-2025-08-07"
            }
          },
          "entitlement": "unknown"
        }
      ],
      "defaultBudgetTokens": 200000,
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
        "defaultSelection": "high",
        "wireProfile": {
          "kind": "anthropic",
          "on": "high",
          "levels": {
            "low": "low",
            "medium": "medium",
            "high": "high",
            "xhigh": "xhigh",
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
        "protocol": "AnthropicMessages",
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
        },
        {
          "id": "max",
          "label": "1M context",
          "maxPromptTokens": 1000000,
          "activation": {
            "kind": "header",
            "headers": {
              "anthropic-beta": "context-1m-2025-08-07"
            }
          },
          "entitlement": "unknown"
        }
      ],
      "defaultBudgetTokens": 200000,
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
        "defaultSelection": "high",
        "wireProfile": {
          "kind": "anthropic",
          "on": "high",
          "levels": {
            "low": "low",
            "medium": "medium",
            "high": "high",
            "xhigh": "xhigh",
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
      "modelId": "claude-haiku-4-5-20251001",
      "label": "claude-haiku-4-5-20251001",
      "aliases": [
        "claude-haiku-4-5"
      ],
      "route": {
        "protocol": "AnthropicMessages",
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
    }
  ],
  "overlays": [],
  "recommendedModels": [
    "claude-fable-5",
    "claude-sonnet-5",
    "claude-opus-4-8",
    "claude-haiku-4-5-20251001"
  ],
  "docsUrl": "https://claude.ai/"
};

export default preset;

