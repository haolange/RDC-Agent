import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "kimi-coding-plan",
  "vendorId": "moonshot",
  "label": "Kimi Coding Plan",
  "status": "stable",
  "availability": {
    "state": "unknown"
  },
  "category": "coding-token-plan",
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
      "baseUrl": "https://api.kimi.com/coding/",
      "default": true
    },
    {
      "protocol": "OpenAICompatibleChatCompletions",
      "baseUrl": "https://api.kimi.com/coding/v1"
    }
  ],
  "userSelectableRoute": true,
  "discovery": {
    "kind": "custom-parser",
    "parserId": "anthropic-candidate-validation"
  },
  "seedModels": [
    {
      "modelId": "kimi-for-coding",
      "label": "kimi-for-coding",
      "aliases": [],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://api.kimi.com/coding/",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 262144,
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 256000,
      "fast": {
        "kind": "model-variant",
        "modelId": "kimi-for-coding-highspeed",
        "entitlement": "granted"
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
          "onBudgetTokens": 4096,
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
      },
      "fixedTemperature": 1
    },
    {
      "modelId": "kimi-for-coding-highspeed",
      "label": "kimi-for-coding-highspeed",
      "aliases": [],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://api.kimi.com/coding/",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 262144,
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
          "onBudgetTokens": 4096,
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
      },
      "fixedTemperature": 1
    }
  ],
  "overlays": [],
  "recommendedModels": [
    "kimi-for-coding"
  ],
  "docsUrl": "https://www.kimi.com/code/docs/en/"
};

export default preset;

