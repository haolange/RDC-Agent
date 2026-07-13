import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "siliconflow",
  "vendorId": "siliconflow",
  "label": "SiliconFlow",
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
      "baseUrl": "https://api.siliconflow.cn/v1",
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
    "Qwen/Qwen3-32B",
    "deepseek-ai/DeepSeek-V3"
  ],
  "docsUrl": "https://siliconflow.cn/"
};

export default preset;

