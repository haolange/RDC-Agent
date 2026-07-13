import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "anthropic-thirdparty",
  "vendorId": "anthropic",
  "label": "Custom Anthropic Endpoint",
  "status": "stable",
  "availability": {
    "state": "unknown"
  },
  "category": "third-party-compatible",
  "catalogOwnership": "user-managed",
  "authModes": [
    "api-key"
  ],
  "baseUrlEditable": true,
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
    "parserId": "anthropic-candidate-validation"
  },
  "seedModels": [],
  "overlays": [],
  "recommendedModels": [
    "sonnet",
    "opus",
    "haiku"
  ],
  "docsUrl": "https://platform.claude.com/docs/en/api/overview"
};

export default preset;

