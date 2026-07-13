import type { ProviderPreset } from '@shared/types/providerCapability';

const preset: ProviderPreset = {
  "schemaVersion": 1,
  "id": "ollama",
  "vendorId": "ollama",
  "label": "Ollama",
  "status": "stable",
  "availability": {
    "state": "unknown"
  },
  "category": "local",
  "catalogOwnership": "user-managed",
  "authModes": [
    "local"
  ],
  "baseUrlEditable": true,
  "capabilities": [
    "chat",
    "model-discovery"
  ],
  "routes": [
    {
      "protocol": "OllamaOpenAICompatibleChatCompletions",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "default": true
    },
    {
      "protocol": "OpenAIResponses",
      "baseUrl": "http://127.0.0.1:11434/v1"
    }
  ],
  "userSelectableRoute": true,
  "discovery": {
    "kind": "custom-parser",
    "parserId": "ollama-tags"
  },
  "seedModels": [],
  "overlays": [],
  "recommendedModels": [
    "qwen2.5-coder:14b",
    "llama3.1:8b"
  ],
  "docsUrl": "https://ollama.com/download"
};

export default preset;

