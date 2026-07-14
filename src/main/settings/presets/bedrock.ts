import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "bedrock",
  "vendorId": "anthropic",
  "label": "Amazon Bedrock",
  "status": "stable",
  "availability": {
    "state": "unavailable",
    "reason": "Amazon Bedrock runtime authentication and request signing are not implemented."
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
      "protocol": "AwsBedrock",
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
      "modelId": "anthropic.claude-fable-5",
      "label": "anthropic.claude-fable-5",
      "aliases": [],
      "route": {
        "protocol": "AwsBedrock",
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
      "modelId": "anthropic.claude-sonnet-5",
      "label": "anthropic.claude-sonnet-5",
      "aliases": [],
      "route": {
        "protocol": "AwsBedrock",
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
      "modelId": "anthropic.claude-opus-4-8",
      "label": "anthropic.claude-opus-4-8",
      "aliases": [],
      "route": {
        "protocol": "AwsBedrock",
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
      "modelId": "anthropic.claude-haiku-4-5-20251001-v1:0",
      "label": "anthropic.claude-haiku-4-5-20251001-v1:0",
      "aliases": [],
      "route": {
        "protocol": "AwsBedrock",
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
    "sonnet",
    "opus",
    "haiku"
  ],
  "docsUrl": "https://docs.anthropic.com/en/docs/claude-code/amazon-bedrock"
};

export default preset;

