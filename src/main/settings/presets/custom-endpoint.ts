import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "custom-endpoint",
  "vendorId": "custom-endpoint",
  "label": "Custom OpenAI Endpoint",
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
    "model-discovery"
  ],
  "routes": [
    {
      "protocol": "OpenAICompatibleChatCompletions",
      "baseUrl": "",
      "default": true
    },
    {
      "protocol": "OpenAIResponses",
      "baseUrl": ""
    }
  ],
  "userSelectableRoute": true,
  "discovery": {
    "kind": "custom-parser",
    "parserId": "openai-compatible"
  },
  "seedModels": [],
  "overlays": [],
  "recommendedModels": [
    "gpt-4.1"
  ],
  "docsUrl": "https://platform.openai.com/docs/api-reference"
};

export default preset;

