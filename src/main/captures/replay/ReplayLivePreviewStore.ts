import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { OpenedCapturePreview } from '@shared/types/session';
import { appPathService } from '../../runtime/AppPathService';
import { assertSession, missing } from './replayFileSafety';
import type { EncodedReplayPng } from './replayStorageTypes';

export function livePreviewToken(generation: number, imageEventId: number): string {
  return `live:${generation}:${imageEventId}`;
}

/** Session-owned live PNG; projection carries only the token, never pixels. */
export class ReplayLivePreviewStore {
  pathFor(sessionId: string): string {
    assertSession(sessionId);
    return appPathService.getLiveReplayPreviewPath(sessionId);
  }

  async write(sessionId: string, generation: number, imageEventId: number, encoded: EncodedReplayPng): Promise<OpenedCapturePreview> {
    const target = this.pathFor(sessionId);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, encoded.png);
    return {
      imagePath: livePreviewToken(generation, imageEventId),
      width: encoded.width,
      height: encoded.height,
      source: 'framebuffer_screenshot',
      updatedAt: Date.now(),
    };
  }

  async read(sessionId: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.pathFor(sessionId));
    } catch (error) {
      if (missing(error)) throw new Error('REPLAY_LIVE_MISSING');
      throw error;
    }
  }

  async clear(sessionId: string): Promise<void> {
    await fs.rm(this.pathFor(sessionId), { force: true });
  }
}

export const replayLivePreviewStore = new ReplayLivePreviewStore();
