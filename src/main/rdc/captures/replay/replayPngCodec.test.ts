import { describe, expect, it } from 'vitest';
import { replayPngCodec } from './replayPngCodec';

// Codec uses the Electron runtime loader; expose it through an injected codec in store tests.
// Native image resizing is verified in the Electron runtime acceptance, not a fake raster codec.
describe('replayPngCodec input guard', () => {
  it('rejects non-PNG data before loading the Electron image runtime', () => {
    expect(() => replayPngCodec.encode(Buffer.from('jpeg'))).toThrow('REPLAY_INVALID_PNG');
  });
});
