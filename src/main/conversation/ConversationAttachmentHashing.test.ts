import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    createReadStream: vi.fn(),
    statSync: vi.fn(),
  };
});

import { createReadStream, statSync } from 'fs';
import { hashAttachmentContents } from './ConversationAttachmentHashing';

const attachment = (index: number) => ({
  sourcePath: `C:/attachments/${index}.txt`,
  fileName: `${index}.txt`,
  mimeType: 'text/plain',
});

describe('conversation attachment hashing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(statSync).mockReturnValue({
      isFile: () => true,
      size: 1,
    } as import('fs').Stats);
  });

  it('stats every attachment and rejects the total budget before opening a hash stream', async () => {
    vi.mocked(statSync).mockReturnValue({
      isFile: () => true,
      size: 64 * 1024 * 1024,
    } as import('fs').Stats);

    await expect(hashAttachmentContents([0, 1, 2, 3, 4].map(attachment)))
      .rejects.toThrow('ATTACHMENT_LIMIT_EXCEEDED');
    expect(statSync).toHaveBeenCalledTimes(5);
    expect(createReadStream).not.toHaveBeenCalled();
  });

  it('limits concurrent content hashing to four streams', async () => {
    let active = 0;
    let maximumActive = 0;
    vi.mocked(createReadStream).mockImplementation(() => {
      let started = false;
      return new Readable({
        read() {
          if (started) return;
          started = true;
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          setTimeout(() => {
            this.push(Buffer.from('x'));
            this.push(null);
            active -= 1;
          }, 5);
        },
      }) as unknown as ReturnType<typeof createReadStream>;
    });

    const hashes = await hashAttachmentContents(Array.from({ length: 9 }, (_, index) => attachment(index)));

    expect(hashes).toHaveLength(9);
    expect(createReadStream).toHaveBeenCalledTimes(9);
    expect(maximumActive).toBe(4);
  });

  it('cancels active hashing through the optional signal', async () => {
    let stream!: Readable;
    vi.mocked(createReadStream).mockImplementation(() => {
      stream = new Readable({ read() {} });
      return stream as unknown as ReturnType<typeof createReadStream>;
    });
    const controller = new AbortController();
    const pending = hashAttachmentContents([attachment(0)], controller.signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(stream.destroyed).toBe(true);
  });

  it('preserves attachment order in returned content hashes', async () => {
    vi.mocked(createReadStream).mockImplementation((filePath) => {
      const label = String(filePath);
      let started = false;
      return new Readable({
        read() {
          if (started) return;
          started = true;
          const payload = label.includes('2.txt') ? 'second' : label.includes('1.txt') ? 'first' : 'zeroth';
          this.push(Buffer.from(payload));
          this.push(null);
        },
      }) as unknown as ReturnType<typeof createReadStream>;
    });

    const hashes = await hashAttachmentContents([attachment(0), attachment(1), attachment(2)]);
    expect(hashes).toHaveLength(3);
    expect(new Set(hashes).size).toBe(3);
    // Re-hash reverse order should reverse results, proving order preservation rather than sort-by-hash.
    const reversed = await hashAttachmentContents([attachment(2), attachment(1), attachment(0)]);
    expect(reversed).toEqual([hashes[2], hashes[1], hashes[0]]);
  });

});
