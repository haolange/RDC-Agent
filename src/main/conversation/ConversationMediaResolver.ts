import fs from 'fs';
import path from 'path';
import { isSessionArtifactUri } from '@shared/types/sessionArtifact';
import { AppError } from '@shared/errors/appError';
import { sniffRasterImageMime, sniffVideoMime, toDataUrl } from '../media/mediaBytes';

const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const VIDEO_MAX_BYTES = 32 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm']);

export type ConversationMediaError = 'MEDIA_SCOPE_DENIED' | 'MEDIA_NOT_FOUND' | 'MEDIA_TYPE_DENIED' | 'MEDIA_TOO_LARGE';
export type ConversationMediaResult =
  { dataUrl: string; kind: 'image' | 'video' } | { dataUrl: null; error: ConversationMediaError };

export interface ConversationMediaScope {
  /** Absolute path of a `session://` artifact, contained by the session artifact resolver. */
  resolveArtifact: (uri: string) => string;
  /** Root of the project the session belongs to. */
  projectRoot: string | null;
  attachmentsRoot: string;
  attachments: ReadonlyArray<{ fileName: string; filePath: string }>;
}

class MediaError extends AppError {
  declare readonly code: ConversationMediaError;
}

const realpathWithin = (candidate: string, root: string): string => {
  if (!fs.existsSync(candidate)) throw new MediaError('MEDIA_NOT_FOUND');
  const realRoot = fs.realpathSync.native(root);
  const real = fs.realpathSync.native(candidate);
  const relative = path.relative(realRoot, real);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new MediaError('MEDIA_SCOPE_DENIED');
  return real;
};

function findAttachment(src: string, attachments: ConversationMediaScope['attachments']) {
  if (path.isAbsolute(src))
    return attachments.find((attachment) => path.resolve(attachment.filePath) === path.resolve(src));
  if (/[\\/]/.test(src)) return undefined;
  const stored = attachments.find((attachment) => path.basename(attachment.filePath) === src);
  if (stored) return stored;
  const named = attachments.filter((attachment) => attachment.fileName === src);
  return named.length === 1 ? named[0] : undefined;
}

/**
 * Which file an answer's media reference names: a session artifact, an attachment of this session (by file name), or
 * a file inside the session's project. Nothing outside those three roots resolves, symlinks included.
 */
function locate(src: string, scope: ConversationMediaScope): string {
  if (isSessionArtifactUri(src)) {
    try {
      return scope.resolveArtifact(src);
    } catch {
      throw new MediaError('MEDIA_SCOPE_DENIED');
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^[a-z]:[\\/]/i.test(src)) throw new MediaError('MEDIA_SCOPE_DENIED');
  const decoded = decodeURI(src);
  const attachment = findAttachment(decoded, scope.attachments);
  if (attachment) return realpathWithin(attachment.filePath, scope.attachmentsRoot);
  if (!scope.projectRoot) throw new MediaError('MEDIA_SCOPE_DENIED');
  return realpathWithin(path.resolve(scope.projectRoot, decoded), scope.projectRoot);
}

export function resolveConversationMedia(src: string, scope: ConversationMediaScope): ConversationMediaResult {
  try {
    const file = locate(src.trim(), scope);
    const extension = path.extname(file).toLowerCase();
    const kind = IMAGE_EXTENSIONS.has(extension) ? 'image' : VIDEO_EXTENSIONS.has(extension) ? 'video' : null;
    if (!kind) throw new MediaError('MEDIA_TYPE_DENIED');
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new MediaError('MEDIA_NOT_FOUND');
    if (stat.size > (kind === 'image' ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES)) throw new MediaError('MEDIA_TOO_LARGE');
    const bytes = new Uint8Array(fs.readFileSync(file));
    const mime = kind === 'image' ? sniffRasterImageMime(bytes) : sniffVideoMime(bytes);
    if (!mime) throw new MediaError('MEDIA_TYPE_DENIED');
    return { dataUrl: toDataUrl(bytes, mime), kind };
  } catch (error) {
    if (error instanceof MediaError) return { dataUrl: null, error: error.code };
    return { dataUrl: null, error: 'MEDIA_NOT_FOUND' };
  }
}
