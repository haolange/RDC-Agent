import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "deepseek",
  "vendorId": "deepseek",
  "label": "DeepSeek",
  "status": "stable",
  "availability": {
    "state": "unknown"
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
    "model-discovery"
  ],
  "routes": [
    {
      "protocol": "AnthropicMessages",
      "baseUrl": "https://api.deepseek.com/anthropic",
      "default": true
    },
    {
      "protocol": "OpenAICompatibleChatCompletions",
      "baseUrl": "https://api.deepseek.com"
    }
  ],
  "userSelectableRoute": true,
  "discovery": {
    "kind": "custom-parser",
    "parserId": "anthropic-candidate-validation"
  },
  "seedModels": [
    {
      "modelId": "deepseek-v4-pro",
      "label": "deepseek-v4-pro",
      "aliases": [
        "deepseek-reasoner"
      ],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://api.deepseek.com/anthropic",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxTotalTokens": 1000000,
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
      "aliases": [
        "deepseek-chat"
      ],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://api.deepseek.com/anthropic",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxTotalTokens": 1000000,
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
    "deepseek-v4-pro",
    "deepseek-v4-flash"
  ],
  "docsUrl": "https://platform.deepseek.com/api_keys"
};

export default preset;
