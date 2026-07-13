export const CLAUDE_ACCOUNT_OAUTH_BETAS = 'claude-code-20250219,oauth-2025-04-20';

export const CLAUDE_ACCOUNT_WIRE_HEADERS = {
  'anthropic-beta': CLAUDE_ACCOUNT_OAUTH_BETAS,
  'User-Agent': 'claude-cli/2.1.119 (external, cli)',
  'x-app': 'cli',
} as const;
