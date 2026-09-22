/**
 * Bake the packaged window icons from resources/brand/rdc-agent-logo.png
 * at the default dark accent. Runtime taskbar icons are recolored separately.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { maskLogoCircleRgba, recolorLogoRgba } from '../src/shared/theme/recolorLogo.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DARK_ACCENT = '#33d1ff';

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  return upDistance <= upLeftDistance ? up : upLeft;
}

function decodePng(buffer: Buffer): { width: number; height: number; rgba: Uint8Array } {
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid PNG signature.');
  let offset = 8;
  let width = 0;
  let height = 0;
  const data: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      if (chunk[8] !== 8 || chunk[9] !== 2 || chunk[12] !== 0) {
        throw new Error('Logo PNG must be 8-bit non-interlaced RGB.');
      }
    } else if (type === 'IDAT') {
      data.push(chunk);
    }
    offset += 12 + length;
  }
  const inflated = zlib.inflateSync(Buffer.concat(data));
  const stride = width * 3;
  if (inflated.length !== (stride + 1) * height) throw new Error('Invalid PNG pixel length.');
  const rgba = new Uint8Array(width * height * 4);
  let source = 0;
  const previous = new Uint8Array(stride);
  const current = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[source];
    if (filter > 4) throw new Error('Unsupported PNG filter.');
    source += 1;
    for (let index = 0; index < stride; index += 1) {
      const raw = inflated[source + index];
      const left = index >= 3 ? current[index - 3] : 0;
      const up = previous[index];
      const upLeft = index >= 3 ? previous[index - 3] : 0;
      let value = raw;
      if (filter === 1) value = (raw + left) & 255;
      else if (filter === 2) value = (raw + up) & 255;
      else if (filter === 3) value = (raw + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) value = (raw + paeth(left, up, upLeft)) & 255;
      current[index] = value;
    }
    source += stride;
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * 4;
      rgba[pixel] = current[x * 3];
      rgba[pixel + 1] = current[x * 3 + 1];
      rgba[pixel + 2] = current[x * 3 + 2];
      rgba[pixel + 3] = 255;
    }
    previous.set(current);
  }
  return { width, height, rgba };
}

/** Area averaging preserves fine lines when the large source becomes a taskbar icon. */
function scale(source: Uint8Array, sourceSize: number, targetSize: number): Uint8Array {
  const target = new Uint8Array(targetSize * targetSize * 4);
  const ratio = sourceSize / targetSize;
  for (let y = 0; y < targetSize; y += 1) {
    for (let x = 0; x < targetSize; x += 1) {
      const sums = [0, 0, 0, 0];
      const x0 = x * ratio, x1 = (x + 1) * ratio;
      const y0 = y * ratio, y1 = (y + 1) * ratio;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy += 1) {
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx += 1) {
          const weight = (Math.min(sx + 1, x1) - Math.max(sx, x0)) * (Math.min(sy + 1, y1) - Math.max(sy, y0));
          const from = (Math.min(sourceSize - 1, sy) * sourceSize + Math.min(sourceSize - 1, sx)) * 4;
          for (let channel = 0; channel < 3; channel += 1) sums[channel] += source[from + channel] * source[from + 3] / 255 * weight;
          sums[3] += source[from + 3] * weight;
        }
      }
      const to = (y * targetSize + x) * 4;
      target[to + 3] = Math.round(sums[3] / (ratio * ratio));
      for (let channel = 0; channel < 3; channel += 1) target[to + channel] = sums[3] > 0 ? Math.round(sums[channel] * 255 / sums[3]) : 0;
    }
  }
  return target;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([header, body, checksum]);
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, row + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeIco(images: { png: Buffer; size: number }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ png, size }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(image => image.png)]);
}

function icnsChunk(type: string, png: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii');
  header.writeUInt32BE(8 + png.length, 4);
  return Buffer.concat([header, png]);
}

const source = decodePng(fs.readFileSync(path.join(repoRoot, 'resources/brand/rdc-agent-logo.png')));
if (source.width !== source.height || source.width < 512) throw new Error('Brand source must be square and at least 512px.');
recolorLogoRgba(source.rgba, DEFAULT_DARK_ACCENT);
maskLogoCircleRgba(source.rgba, source.width, source.height);
const icons = path.join(repoRoot, 'resources/icons');
function writeIcon(name: string, bytes: Buffer): void {
  const destination = path.join(icons, name);
  const temporary = destination + '.tmp';
  try {
    fs.writeFileSync(temporary, bytes);
    fs.renameSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
const png256 = encodePng(256, 256, scale(source.rgba, source.width, 256));
writeIcon('icon.png', png256);
const icoImages = [16, 20, 24, 32, 40, 48, 64, 128, 256].map(size => ({
  size, png: encodePng(size, size, scale(source.rgba, source.width, size)),
}));
writeIcon('icon.ico', encodeIco(icoImages));
const icns = Buffer.concat([
  icnsChunk('ic07', encodePng(128, 128, scale(source.rgba, source.width, 128))),
  icnsChunk('ic08', png256),
  icnsChunk('ic09', encodePng(512, 512, scale(source.rgba, source.width, 512))),
]);
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns', 0);
icnsHeader.writeUInt32BE(8 + icns.length, 4);
writeIcon('icon.icns', Buffer.concat([icnsHeader, icns]));
console.log('[product-icons] wrote icon.png, icon.ico, icon.icns');
