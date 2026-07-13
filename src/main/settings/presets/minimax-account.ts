import type { ProviderPreset } from '@shared/types/providerCapability';

// TODO(live-verify): enable only after both regional grants and rotating refresh tokens are tested by an account owner.
const preset: ProviderPreset = {
  schemaVersion: 1,
  id: 'minimax-account',
  vendorId: 'minimax',
  label: 'MiniMax Account',
  status: 'beta',
  availability: { state: 'unavailable', reason: 'TODO(live-verify): MiniMax global/CN OAuth requires account-owner verification.' },
  category: 'login-authorization',
  catalogOwnership: 'user-managed',
  authModes: ['oauth'],
  authModeAvailability: { oauth: { state: 'unavailable', reason: 'TODO(live-verify): verify the pinned public reference flow.' } },
  accountLoginConfigured: false,
  capabilities: ['chat', 'tool-calling', 'model-discovery'],
  routes: [
    { protocol: 'AnthropicMessages', baseUrl: 'https://api.minimax.io/anthropic', default: true },
    { protocol: 'AnthropicMessages', baseUrl: 'https://api.minimaxi.com/anthropic' },
  ],
  userSelectableRoute: false,
  discovery: { kind: 'custom-parser', parserId: 'minimax-account-catalog' },
  seedModels: [],
  overlays: [],
  recommendedModels: [],
  docsUrl: 'https://platform.minimax.io/',
};

export default preset;
