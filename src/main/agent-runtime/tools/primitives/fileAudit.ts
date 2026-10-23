import * as fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import type { ToolExecutionContext } from '../../agent/AgentTool';
import { safeResolvePath, truncateOutput } from './_shared';
import { TEXT_FILE_MAX_BYTES } from './toolLimits';

export interface FileAuditParams {
  path: string;
  expectedHash?: string;
  compareWith?: { path: string; expectedHash: string };
  textComparison?: boolean;
}

interface FileIdentity {
  path: string;
  bytes: number;
  sha256: string;
  headHex: string;
}

interface TextIdentity {
  normalization: 'crlf-to-lf';
  sha256: string;
  bytes: number;
}

export interface FileAuditDetails extends FileIdentity {
  mode: 'audit';
  truncated: boolean;
  text?: TextIdentity;
  comparison?: {
    file: FileIdentity;
    bytesEqual: boolean;
    firstDifferenceOffset: number | null;
    differenceWindow: { offset: number; leftHex: string; rightHex: string } | null;
    text?: ReturnType<typeof compareText> & { file: TextIdentity };
  };
}

const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const CHANGE_PREVIEW_BYTES = 6000;

function compareBytes(left: Buffer, right: Buffer) {
  let offset = 0;
  while (offset < Math.min(left.length, right.length) && left[offset] === right[offset]) offset += 1;
  if (offset === left.length && offset === right.length) {
    return { bytesEqual: true, firstDifferenceOffset: null, differenceWindow: null };
  }
  const start = Math.max(0, offset - 8);
  return { bytesEqual: false, firstDifferenceOffset: offset,
    differenceWindow: { offset: start, leftHex: left.subarray(start, start + 32).toString('hex'), rightHex: right.subarray(start, start + 32).toString('hex') } };
}

function expectedDigest(value: string | undefined): string {
  if (typeof value !== 'string' || !/^(?:sha256:)?[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error('FILE_AUDIT_EXPECTED_HASH_REQUIRED: supply the exact whole-file SHA-256 for each input.');
  }
  return value.replace(/^sha256:/, '').toLowerCase();
}

async function readBoundFile(input: string, expected: string, context?: ToolExecutionContext, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const absolute = safeResolvePath(input, undefined, context);
  if (path.extname(absolute).toLowerCase() === '.rdc') throw new Error('FILE_AUDIT_CAPTURE_DENIED');
  const stat = await fs.promises.stat(absolute);
  if (!stat.isFile() || stat.size > TEXT_FILE_MAX_BYTES) throw new Error('FILE_AUDIT_SIZE_OR_TYPE_REJECTED');
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of fs.createReadStream(absolute, { signal })) {
    bytes += chunk.length;
    if (bytes > TEXT_FILE_MAX_BYTES) throw new Error('FILE_AUDIT_SIZE_OR_TYPE_REJECTED');
    chunks.push(chunk);
  }
  signal?.throwIfAborted();
  const buffer = Buffer.concat(chunks);
  if (buffer.length >= 8 && buffer.readUInt32LE(0) === 0x434f4452 && buffer.readUInt32LE(4) === 0) {
    throw new Error('FILE_AUDIT_CAPTURE_DENIED');
  }
  const sha256 = digest(buffer);
  if (sha256 !== expected) throw new Error(`FILE_AUDIT_HASH_MISMATCH: ${input}`);
  return { buffer, identity: { path: absolute, bytes, sha256, headHex: buffer.subarray(0, 64).toString('hex') } };
}

function normalizedText(bytes: Buffer): string {
  try {
    // Preserve BOM, bare CR and all other bytes' text semantics. Only CRLF is normalized.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.includes('\0')) throw new Error('NUL');
    return text.replace(/\r\n/g, '\n');
  } catch {
    throw new Error('FILE_AUDIT_UTF8_REQUIRED: text comparison requires NUL-free, valid UTF-8 inputs.');
  }
}

function textIdentity(text: string): TextIdentity {
  return { normalization: 'crlf-to-lf', sha256: digest(text), bytes: Buffer.byteLength(text) };
}

function compareText(left: string, right: string) {
  const a = left.split('\n'), b = right.split('\n');
  let prefix = 0, suffix = 0;
  while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix]) prefix += 1;
  while (suffix < Math.min(a.length, b.length) - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix += 1;
  const leftChanged = a.slice(prefix, a.length - suffix).join('\n');
  const rightChanged = b.slice(prefix, b.length - suffix).join('\n');
  return {
    equal: left === right,
    commonPrefixLines: prefix,
    commonSuffixLines: suffix,
    leftTotalLines: a.length,
    rightTotalLines: b.length,
    leftChanged: truncateOutput(leftChanged, CHANGE_PREVIEW_BYTES),
    rightChanged: truncateOutput(rightChanged, CHANGE_PREVIEW_BYTES),
    truncated: Buffer.byteLength(leftChanged) > CHANGE_PREVIEW_BYTES || Buffer.byteLength(rightChanged) > CHANGE_PREVIEW_BYTES,
  };
}

/** Audits the bytes actually read. No mutation, executable parser, edit grant, or domain interpretation. */
export async function auditFiles(params: FileAuditParams, context?: ToolExecutionContext, signal?: AbortSignal): Promise<FileAuditDetails> {
  const leftHash = expectedDigest(params.expectedHash);
  const rightHash = params.compareWith ? expectedDigest(params.compareWith.expectedHash) : undefined;
  const left = await readBoundFile(params.path, leftHash, context, signal);
  const right = params.compareWith
    ? await readBoundFile(params.compareWith.path, rightHash!, context, signal)
    : undefined;
  const result: FileAuditDetails = { mode: 'audit', ...left.identity, truncated: false };
  if (right) result.comparison = { file: right.identity, ...compareBytes(left.buffer, right.buffer) };
  if (params.textComparison) {
    const a = normalizedText(left.buffer);
    result.text = textIdentity(a);
    if (right && result.comparison) {
      const b = normalizedText(right.buffer);
      result.comparison.text = { file: textIdentity(b), ...compareText(a, b) };
      result.truncated = result.comparison.text.truncated;
    }
  }
  signal?.throwIfAborted();
  return result;
}
