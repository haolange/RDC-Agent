import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "manifest",
  "vendorId": "manifest",
  "label": "Manifest",
  "status": "stable",
  "availability": {
    "state": "unknown"
  },
  "category": "third-party-compatible",
  "catalogOwnership": "user-managed",
  "authModes": [
    "api-key"
  ],
  "capabilities": [
    "chat",
    "tool-calling",
    "model-discovery"
  ],
  "routes": [
    {
      "protocol": "OpenAICompatibleChatCompletions",
      "baseUrl": "https://app.manifest.build/v1",
      "default": true
    }
  ],
  "userSelectableRoute": false,
  "discovery": {
    "kind": "custom-parser",
    "parserId": "openai-compatible"
  },
  "seedModels": [],
  "overlays": [],
  "recommendedModels": [
    "gpt-4.1"
  ],
  "docsUrl": "https://app.manifest.build/"
};

export default preset;

