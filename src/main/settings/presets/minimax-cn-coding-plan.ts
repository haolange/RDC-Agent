import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "minimax-cn-coding-plan",
  "vendorId": "minimax",
  "label": "MiniMax Coding Plan (CN)",
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
      "baseUrl": "https://api.minimaxi.com/anthropic",
      "default": true
    },
    {
      "protocol": "OpenAICompatibleChatCompletions",
      "baseUrl": "https://api.minimaxi.com/v1"
    }
  ],
  "userSelectableRoute": true,
  "discovery": {
    "kind": "custom-parser",
    "parserId": "anthropic-candidate-validation"
  },
  "seedModels": [
    {
      "modelId": "MiniMax-M2.7",
      "label": "MiniMax-M2.7",
      "aliases": [],
      "route": {
        "protocol": "AnthropicMessages",
        "baseUrl": "https://api.minimaxi.com/anthropic",
        "source": "preset"
      },
      "availability": "available",
      "contextTiers": [
        {
          "id": "default",
          "label": "Default",
          "maxPromptTokens": 204800,
          "activation": {
            "kind": "implicit"
          },
          "entitlement": "granted"
        }
      ],
      "defaultBudgetTokens": 204800,
      "fast": {
        "kind": "unsupported"
      },
      "reasoning": {
        "kind": "always-on",
        "supportsOff": false,
        "levels": [],
        "defaultSelection": "on",
        "lockedSelection": "on",
        "wireProfile": {
          "kind": "anthropic",
          "on": "high",
          "onMode": "enabled"
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
    "MiniMax-M2.7"
  ],
  "docsUrl": "https://platform.minimaxi.com/"
};

export default preset;

