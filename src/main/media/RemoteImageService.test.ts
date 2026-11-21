import { describe, expect, it } from 'vitest';
import { fetchRemoteImage } from './RemoteImageService';
import { sniffRasterImageMime, sniffVideoMime } from './mediaBytes';

describe('fetchRemoteImage', () => {
  it('refuses anything but https before any network access', async () => {
    for (const url of ['http://example.com/a.png', 'file:///etc/hosts', 'data:image/png;base64,AA==']) {
      await expect(fetchRemoteImage(url)).resolves.toEqual({ dataUrl: null, error: 'REMOTE_IMAGE_URL_DENIED' });
    }
  });

  it('refuses private and local hosts', async () => {
    await expect(fetchRemoteImage('https://127.0.0.1/a.png')).resolves.toEqual({ dataUrl: null, error: 'REMOTE_IMAGE_URL_DENIED' });
    await expect(fetchRemoteImage('https://localhost/a.png')).resolves.toEqual({ dataUrl: null, error: 'REMOTE_IMAGE_URL_DENIED' });
  });
});

describe('media byte sniffing', () => {
  it('recognises raster images and video by their bytes, not their names', () => {
    expect(sniffRasterImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffRasterImageMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffVideoMime(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]))).toBe('video/mp4');
    expect(sniffVideoMime(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBe('video/webm');
  });
});
