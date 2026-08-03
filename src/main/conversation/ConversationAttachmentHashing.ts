import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import * as path from 'node:path';
import type { ConversationAttachmentInput } from '@shared/types/conversation';
import {
  MAX_ATTACHMENT_BYTES_PER_FILE,
  MAX_ATTACHMENT_TOTAL_BYTES,
} from './ConversationAttachmentMaterializer';

export const MAX_ATTACHMENT_HASH_CONCURRENCY = 4;

interface AttachmentHashCandidate {
  sourcePath: string;
  absolutePath: string;
  size: number;
  status?: string;
}

function createAbortError(): Error {
  const error = new Error('ATTACHMENT_HASH_ABORTED: attachment hashing was cancelled.');
  error.name = 'AbortError';
  return error;
}

function throwIfAttachmentHashAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

function collectAttachmentHashCandidates(
  attachments: readonly ConversationAttachmentInput[],
): AttachmentHashCandidate[] {
  const candidates = attachments.map((attachment) => {
    const absolutePath = path.resolve(attachment.sourcePath);
    try {
      const stats = statSync(absolutePath);
      if (!stats.isFile()) {
        return {
          sourcePath: attachment.sourcePath,
          absolutePath,
          size: 0,
          status: 'not-file:' + absolutePath,
        };
      }
      if (stats.size > MAX_ATTACHMENT_BYTES_PER_FILE) {
        return {
          sourcePath: attachment.sourcePath,
          absolutePath,
          size: stats.size,
          status: 'oversized:' + stats.size,
        };
      }
      return {
        sourcePath: attachment.sourcePath,
        absolutePath,
        size: stats.size,
      };
    } catch {
      return {
        sourcePath: attachment.sourcePath,
        absolutePath,
        size: 0,
        status: 'missing:' + attachment.sourcePath,
      };
    }
  });

  const totalBytes = candidates.reduce((total, candidate) => total + candidate.size, 0);
  if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
    throw new Error(`ATTACHMENT_LIMIT_EXCEEDED: total attachment bytes exceed ${MAX_ATTACHMENT_TOTAL_BYTES}.`);
  }
  return candidates;
}

function hashAttachmentContent(candidate: AttachmentHashCandidate, signal?: AbortSignal): Promise<string> {
  if (candidate.status) return Promise.resolve(candidate.status);
  throwIfAttachmentHashAborted(signal);

  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(candidate.absolutePath);
    let settled = false;
    let bytesRead = 0;
    const finish = (value: string): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      reject(error);
    };
    const onAbort = (): void => {
      stream.destroy(createAbortError());
      fail(createAbortError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    stream.on('data', (chunk: Buffer | string) => {
      bytesRead += Buffer.byteLength(chunk);
      if (bytesRead > MAX_ATTACHMENT_BYTES_PER_FILE) {
        stream.destroy();
        finish('oversized:' + bytesRead);
        return;
      }
      hash.update(chunk);
    });
    stream.on('error', (error: Error) => {
      if (signal?.aborted || error.name === 'AbortError') {
        fail(createAbortError());
        return;
      }
      finish('missing:' + candidate.sourcePath);
    });
    stream.on('end', () => finish(hash.digest('hex')));
  });
}

export async function hashAttachmentContents(
  attachments: readonly ConversationAttachmentInput[],
  signal?: AbortSignal,
): Promise<string[]> {
  const candidates = collectAttachmentHashCandidates(attachments);
  const hashes = new Array<string>(candidates.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < candidates.length) {
      throwIfAttachmentHashAborted(signal);
      const index = nextIndex;
      nextIndex += 1;
      hashes[index] = await hashAttachmentContent(candidates[index], signal);
    }
  };
  const workerCount = Math.min(MAX_ATTACHMENT_HASH_CONCURRENCY, candidates.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return hashes;
}
