import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "huggingface",
  "vendorId": "huggingface",
  "label": "Hugging Face Router",
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
      "baseUrl": "https://router.huggingface.co/v1",
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
    "openai/gpt-oss-120b",
    "Qwen/Qwen3-Coder-480B-A35B-Instruct"
  ],
  "docsUrl": "https://huggingface.co/settings/tokens"
};

export default preset;

