import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fetchPublic } from '../runtime/net/publicEgress';
import { appPathService } from '../runtime/AppPathService';
import { readLimitedBytes, sniffRasterImageMime } from './mediaBytes';

const MAX_FAVICON_BYTES = 64 * 1024;
const MAX_ICON_PAGE_BYTES = 80_000 * 4; // Receive bound for the existing 80k-character HTML window.
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ALLOWED_MIME = new Set([
  'image/png',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/ico',
  'image/icon',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
]);

interface CacheMeta {
  domain: string;
  mime: string;
  savedAt: number;
  fileName: string;
}

export interface FaviconResolveResult {
  dataUrl: string | null;
}

const memoryCache = new Map<string, { dataUrl: string | null; expiresAt: number }>();

function normalizeDomain(raw: string): string {
  const cleaned = raw.replace(/^https?:\/\//i, '').split('/')[0]?.trim().toLowerCase() ?? '';
  return cleaned.replace(/:\d+$/, '');
}

function cacheRoot(): string {
  return path.join(appPathService.getAppStatePaths().appStateRoot, 'cache', 'favicons');
}

function ensureCacheRoot(): string {
  const root = cacheRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function hashDomain(domain: string): string {
  return crypto.createHash('sha256').update(domain).digest('hex').slice(0, 24);
}

function mimeToExt(mime: string): string {
  if (mime.includes('svg')) return 'svg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  return 'ico';
}

function sniffMime(bytes: Uint8Array, contentType: string | null): string | null {
  const header = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (header && ALLOWED_MIME.has(header)) return header;
  const raster = sniffRasterImageMime(bytes);
  if (raster) return raster;
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return 'image/x-icon';
  const asText = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 64)).trimStart();
  if (asText.startsWith('<svg') || asText.startsWith('<?xml')) return 'image/svg+xml';
  return header && header.startsWith('image/') ? header : null;
}

async function fetchPublicBytes(rawUrl: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const { response } = await fetchPublic(rawUrl, {
      accept: 'image/*,*/*;q=0.8', userAgent: 'RDC-Agent/FaviconResolve', maxResponseBytes: MAX_FAVICON_BYTES,
      maxRedirects: MAX_REDIRECTS, timeoutMs: REQUEST_TIMEOUT_MS,
    });
    if (!response.ok) return null;
    const bytes = await readLimitedBytes(response, MAX_FAVICON_BYTES);
    if (!bytes || bytes.byteLength === 0) return null;
    const mime = sniffMime(bytes, response.headers.get('content-type'));
    return mime && ALLOWED_MIME.has(mime) ? { bytes, mime } : null;
  } catch {
    // A favicon is decoration: an unreachable or refused icon falls back to the generic glyph.
    return null;
  }
}

function parseDataImageUrl(raw: string): { mime: string; bytes: Uint8Array } | null {
  const match = raw.trim().match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!ALLOWED_MIME.has(mime)) return null;
  try {
    const bytes = Uint8Array.from(Buffer.from(match[2].replace(/\s+/g, ''), 'base64'));
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_FAVICON_BYTES) return null;
    return { mime, bytes };
  } catch {
    return null;
  }
}

function parseIconHrefFromHtml(html: string, baseUrl: string): string[] {
  const hrefs: string[] = [];
  const linkPattern = /<link\b[^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(html)) && hrefs.length < 4) {
    const tag = match[0];
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1]?.trim();
    if (!href) continue;
    if (/^data:image\//i.test(href)) {
      hrefs.push(href);
      continue;
    }
    try {
      const absolute = new URL(href, baseUrl).toString();
      if (absolute.startsWith('http://') || absolute.startsWith('https://')) {
        hrefs.push(absolute);
      }
    } catch {
      /* ignore */
    }
  }
  return hrefs;
}

async function discoverIconUrls(domain: string): Promise<string[]> {
  const httpsOrigin = `https://${domain}`;
  const httpOrigin = `http://${domain}`;
  const candidates: string[] = [
    `${httpsOrigin}/favicon.ico`,
    `${httpOrigin}/favicon.ico`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  ];

  try {
    const { response, finalUrl } = await fetchPublic(`${httpsOrigin}/`, {
      accept: 'text/html,application/xhtml+xml', userAgent: 'RDC-Agent/FaviconResolve', maxResponseBytes: MAX_ICON_PAGE_BYTES,
      maxRedirects: MAX_REDIRECTS, timeoutMs: REQUEST_TIMEOUT_MS,
    });
    if (response.ok) candidates.unshift(...parseIconHrefFromHtml((await response.text()).slice(0, 80_000), finalUrl));
  } catch {
    // The page is only a hint for icon links; the direct candidates remain.
  }

  return [...new Set(candidates)];
}

function readDiskCache(domain: string): string | null {
  const root = ensureCacheRoot();
  const key = hashDomain(domain);
  const metaPath = path.join(root, `${key}.json`);
  if (!fs.existsSync(metaPath)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as CacheMeta;
    if (!meta?.fileName || !meta.mime || Date.now() - meta.savedAt > CACHE_TTL_MS) return null;
    const filePath = path.join(root, meta.fileName);
    if (!fs.existsSync(filePath)) return null;
    const bytes = fs.readFileSync(filePath);
    return `data:${meta.mime};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

function writeDiskCache(domain: string, mime: string, bytes: Uint8Array): string {
  const root = ensureCacheRoot();
  const key = hashDomain(domain);
  const fileName = `${key}.${mimeToExt(mime)}`;
  const filePath = path.join(root, fileName);
  const metaPath = path.join(root, `${key}.json`);
  fs.writeFileSync(filePath, Buffer.from(bytes));
  const meta: CacheMeta = { domain, mime, savedAt: Date.now(), fileName };
  fs.writeFileSync(metaPath, JSON.stringify(meta));
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

export async function resolveFaviconDataUrl(rawDomain: string): Promise<FaviconResolveResult> {
  const domain = normalizeDomain(rawDomain);
  if (!domain || domain.includes('..') || /[^\w.-]/.test(domain)) {
    return { dataUrl: null };
  }

  const cachedMemory = memoryCache.get(domain);
  if (cachedMemory && cachedMemory.expiresAt > Date.now()) {
    return { dataUrl: cachedMemory.dataUrl };
  }

  const disk = readDiskCache(domain);
  if (disk) {
    memoryCache.set(domain, { dataUrl: disk, expiresAt: Date.now() + CACHE_TTL_MS });
    return { dataUrl: disk };
  }

  const candidates = await discoverIconUrls(domain);
  for (const candidate of candidates) {
    const embedded = parseDataImageUrl(candidate);
    const fetched = embedded ?? (
      candidate.startsWith('http://') || candidate.startsWith('https://')
        ? await fetchPublicBytes(candidate)
        : null
    );
    if (!fetched) continue;
    const dataUrl = writeDiskCache(domain, fetched.mime, fetched.bytes);
    memoryCache.set(domain, { dataUrl, expiresAt: Date.now() + CACHE_TTL_MS });
    return { dataUrl };
  }

  memoryCache.set(domain, { dataUrl: null, expiresAt: Date.now() + 60 * 60 * 1000 });
  return { dataUrl: null };
}
