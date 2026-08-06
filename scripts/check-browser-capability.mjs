import { createRequire } from 'module';
import path from 'node:path';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

function fail(message) {
  console.error(`[browser-capability] ${message}`);
  process.exit(1);
}

function main() {
  const { RENDERER_INVOKE_CHANNELS } = require('../src/shared/renderer-api/channels.ts');
  const {
    resolveBridgeChannelCapability,
    assertChannelCapabilityCoverage,
  } = require('../src/shared/renderer-api/channelCapabilities.ts');

  assertChannelCapabilityCoverage();

  const counts = { read: 0, mutation: 0, 'high-impact': 0, 'desktop-only': 0 };
  for (const channel of RENDERER_INVOKE_CHANNELS) {
    const capability = resolveBridgeChannelCapability(channel);
    if (!(capability in counts)) {
      fail(`Unknown capability "${capability}" for ${channel}`);
    }
    counts[capability] += 1;
  }

  console.log(
    `[browser-capability] OK read=${counts.read} mutation=${counts.mutation} high-impact=${counts['high-impact']} desktop-only=${counts['desktop-only']} total=${RENDERER_INVOKE_CHANNELS.length}`,
  );
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
