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
  catalogOwnership: 'app-managed',
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
  seedModels: [
    {
      modelId: 'MiniMax-M2.7',
      label: 'MiniMax-M2.7',
      aliases: [],
      route: { protocol: 'AnthropicMessages', baseUrl: 'https://api.minimax.io/anthropic', source: 'preset' },
      availability: 'unknown',
      contextTiers: [{
        id: 'default', label: 'MiniMax OAuth', maxPromptTokens: 204800,
        activation: { kind: 'implicit' }, entitlement: 'unknown',
      }],
      defaultBudgetTokens: 204800,
      fast: { kind: 'model-variant', modelId: 'MiniMax-M2.7-highspeed', entitlement: 'unknown', label: 'Highspeed' },
      reasoning: {
        kind: 'always-on', supportsOff: false, levels: [], defaultSelection: 'on', lockedSelection: 'on',
        wireProfile: { kind: 'anthropic', on: 'high', onMode: 'enabled' },
      },
      toolCalling: { state: 'supported' },
      visionInput: { state: 'unsupported' },
      structuredOutput: { state: 'supported' },
    },
    {
      modelId: 'MiniMax-M2.7-highspeed',
      label: 'MiniMax-M2.7 Highspeed',
      aliases: [],
      route: { protocol: 'AnthropicMessages', baseUrl: 'https://api.minimax.io/anthropic', source: 'preset' },
      availability: 'unknown',
      contextTiers: [{
        id: 'default', label: 'MiniMax OAuth', maxPromptTokens: 204800,
        activation: { kind: 'implicit' }, entitlement: 'unknown',
      }],
      defaultBudgetTokens: 204800,
      fast: { kind: 'unsupported' },
      reasoning: {
        kind: 'always-on', supportsOff: false, levels: [], defaultSelection: 'on', lockedSelection: 'on',
        wireProfile: { kind: 'anthropic', on: 'high', onMode: 'enabled' },
      },
      toolCalling: { state: 'supported' },
      visionInput: { state: 'unsupported' },
      structuredOutput: { state: 'supported' },
    },
  ],
  overlays: [],
  recommendedModels: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed'],
  docsUrl: 'https://platform.minimax.io/',
};

export default preset;
