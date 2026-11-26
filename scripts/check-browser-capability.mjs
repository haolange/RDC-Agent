import { createRequire } from 'module';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

function fail(message) {
  console.error(`[browser-capability] ${message}`);
  throw new Error(message);
}

function main() {
  const { RENDERER_INVOKE_CHANNEL_TABLE } = require('../src/shared/renderer-api/channels.ts');

  const counts = { read: 0, mutation: 0, 'high-impact': 0, 'desktop-only': 0 };
  const channels = Object.entries(RENDERER_INVOKE_CHANNEL_TABLE);
  for (const [channel, capability] of channels) {
    if (!(capability in counts)) {
      fail(`Unknown capability "${capability}" for ${channel}`);
    }
    counts[capability] += 1;
  }

  console.log(
    `[browser-capability] OK read=${counts.read} mutation=${counts.mutation} high-impact=${counts['high-impact']} desktop-only=${counts['desktop-only']} total=${channels.length}`,
  );
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
