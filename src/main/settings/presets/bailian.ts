import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "bailian",
  "vendorId": "alibaba",
  "label": "Alibaba Cloud Bailian",
  "status": "stable",
  "availability": {
    "state": "unavailable",
    "reason": "The general Bailian API endpoint is not pinned in this catalog. Use Qwen / DashScope or Bailian Coding Plan until a stable official endpoint is configured."
  },
  "category": "official-compatible",
  "catalogOwnership": "app-managed",
  "authModes": [
    "api-key"
  ],
  "capabilities": [
    "chat",
    "tool-calling",
    "reasoning",
    "prompt-cache"
  ],
  "routes": [
    {
      "protocol": "AnthropicMessages",
      "baseUrl": "",
      "default": true
    }
  ],
  "userSelectableRoute": false,
  "discovery": null,
  "seedModels": [
    {
      "modelId": "qwen-turbo",
      "label": "qwen-turbo",
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
        "protocol": "AnthropicMessages",
        "baseUrl": "",
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
        "protocol": "AnthropicMessages",
        "baseUrl": "",
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
        "protocol": "AnthropicMessages",
        "baseUrl": "",
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
    "qwen-vl-max"
  ],
  "docsUrl": "https://bailian.console.aliyun.com/"
};

export default preset;
