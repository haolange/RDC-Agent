import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "openrouter",
  "vendorId": "openrouter",
  "label": "OpenRouter",
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
    "model-discovery"
  ],
  "routes": [
    {
      "protocol": "OpenRouterChatCompletions",
      "baseUrl": "https://openrouter.ai/api/v1",
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
    "anthropic/claude-haiku-latest",
    "anthropic/claude-sonnet-4.5",
    "openai/gpt-5.2"
  ],
  "docsUrl": "https://openrouter.ai/keys"
};

export default preset;

