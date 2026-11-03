import type { ReplayPngCodec } from './replayStorageTypes';

export const replayPngCodec: ReplayPngCodec = {
  encode(bytes) {
    if (bytes.length < 8 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      throw new Error('REPLAY_INVALID_PNG');
    }
    const { nativeImage } = require('electron') as typeof import('electron');
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) throw new Error('REPLAY_INVALID_PNG');
    const original = image.getSize();
    if (original.width < 1 || original.height < 1) throw new Error('REPLAY_INVALID_PNG');
    const scale = Math.min(1, 960 / Math.max(original.width, original.height));
    const result = scale < 1 ? image.resize({
      width: Math.max(1, Math.round(original.width * scale)),
      height: Math.max(1, Math.round(original.height * scale)),
      quality: 'best',
    }) : image;
    return { png: result.toPNG(), ...result.getSize() };
  },
};
