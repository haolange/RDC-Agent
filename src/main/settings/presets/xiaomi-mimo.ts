import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "xiaomi-mimo",
  "vendorId": "xiaomi",
  "label": "Xiaomi MiMo",
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
      "baseUrl": "https://api.xiaomimimo.com/anthropic",
      "default": true
    },
    {
      "protocol": "OpenAICompatibleChatCompletions",
      "baseUrl": "https://api.xiaomimimo.com/v1"
    },
    {
      "protocol": "OpenAIResponses",
      "baseUrl": "https://api.xiaomimimo.com/v1"
    }
  ],
  "userSelectableRoute": true,
  "discovery": {
    "kind": "custom-parser",
    "parserId": "anthropic-candidate-validation"
  },
  "seedModels": [
    {
      "modelId": "mimo-v2.5-pro",
      "label": "mimo-v2.5-pro",
      "aliases": [],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://api.xiaomimimo.com/anthropic",
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
        "kind": "toggle",
        "supportsOff": true,
        "levels": [],
        "defaultSelection": "on",
        "wireProfile": {
          "kind": "anthropic",
          "on": "high",
          "onMode": "enabled",
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
    }
  ],
  "overlays": [],
  "recommendedModels": [
    "mimo-v2.5-pro"
  ],
  "docsUrl": "https://platform.xiaomimimo.com/#/console/api-keys"
};

export default preset;

