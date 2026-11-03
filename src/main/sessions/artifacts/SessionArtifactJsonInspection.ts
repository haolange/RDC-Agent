import { createHash } from 'node:crypto';
import { isSessionArtifactizedEnvelope, SessionArtifactError } from '@shared/types/sessionArtifact';

export interface ArtifactJsonInspection {
  layers: Array<{ kind: 'file' | 'json-chunks' | 'json-text' | 'json-string'; pointer?: string; bytes: number; sha256: string }>;
  rootType: string;
  nodeCount: number;
  numberCount: number;
  nonFiniteNumberCount: number;
  arrayCount: number;
  arrayLengths: Record<string, number>;
  sourceResultTruncated?: boolean;
}

function parse(text: string, layer: string): unknown {
  try { return JSON.parse(text); } catch {
    throw new SessionArtifactError('ARTIFACT_JSON_INVALID', `JSON layer ${layer} is not valid JSON.`);
  }
}

function digest(kind: ArtifactJsonInspection['layers'][number]['kind'], bytes: Buffer, pointer?: string) {
  return { kind, ...(pointer === undefined ? {} : { pointer }), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function selectText(value: unknown, pointer: string): string {
  if (typeof pointer !== 'string' || pointer.length > 256 || (pointer !== '' && !pointer.startsWith('/')) || /~(?:[^01]|$)/.test(pointer)) {
    throw new SessionArtifactError('ARTIFACT_JSON_POINTER_INVALID', 'Use an RFC 6901 pointer of at most 256 characters.');
  }
  let current = value;
  for (const segment of pointer === '' ? [] : pointer.slice(1).split('/')) {
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) {
      throw new SessionArtifactError('ARTIFACT_JSON_POINTER_INVALID', 'The pointer does not select an own JSON property.');
    }
    current = (current as Record<string, unknown>)[key];
  }
  if (typeof current !== 'string') {
    throw new SessionArtifactError('ARTIFACT_JSON_POINTER_INVALID', 'Each pointer must select a string.');
  }
  return current;
}

/** Pure data decoding of already-authorized bytes; never evaluates code or opens another path. */
function decodeArtifactJson(bytes: Buffer, textPointers: string[]) {
  if (!Array.isArray(textPointers) || textPointers.length > 4) {
    throw new SessionArtifactError('ARTIFACT_JSON_INSPECTION_LIMIT', 'At most four JSON text pointers are allowed.');
  }
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    throw new SessionArtifactError('ARTIFACT_JSON_INVALID', 'The artifact is not valid UTF-8.');
  }
  let value = parse(text, 'file');
  const layers = [digest('file', bytes)];
  if (value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).encoding === 'json-chunks') {
    const chunks = (value as Record<string, unknown>).chunks;
    if (!Array.isArray(chunks) || !chunks.every((chunk) => typeof chunk === 'string')) {
      throw new SessionArtifactError('ARTIFACT_JSON_INVALID', 'The json-chunks envelope contains invalid chunks.');
    }
    const joined = chunks.join('');
    value = parse(joined, 'json-chunks');
    layers.push(digest('json-chunks', Buffer.from(joined, 'utf8')));
  }
  const details = isSessionArtifactizedEnvelope(value) ? value.details : null;
  const sourceResultTruncated = details && typeof details === 'object' && 'truncated' in details && typeof details.truncated === 'boolean'
    ? details.truncated : undefined;
  for (const [index, pointer] of textPointers.entries()) {
    const selected = selectText(value, pointer);
    value = parse(selected, `text pointer ${index + 1}`);
    layers.push(digest('json-text', Buffer.from(selected, 'utf8'), pointer));
  }
  return { value, layers, sourceResultTruncated };
}

export interface ArtifactJsonTextView {
  pointer: string;
  sha256: string;
  bytes: number;
  layers: ArtifactJsonInspection['layers'];
  sourceResultTruncated?: boolean;
}

/** Select plain string data after the same bounded JSON decoding used by inspection. */
export function readArtifactJsonText(bytes: Buffer, textPointers: string[], pointer: string): { text: string; view: ArtifactJsonTextView } {
  const decoded = decodeArtifactJson(bytes, textPointers);
  const text = selectText(decoded.value, pointer);
  const selected = Buffer.from(text, 'utf8');
  if (selected.toString('utf8') !== text) throw new SessionArtifactError('ARTIFACT_JSON_INVALID', 'Selected text contains invalid Unicode.');
  const layer = digest('json-string', selected, pointer);
  return { text, view: { pointer, sha256: layer.sha256, bytes: layer.bytes,
    layers: [...decoded.layers, layer],
    ...(decoded.sourceResultTruncated === undefined ? {} : { sourceResultTruncated: decoded.sourceResultTruncated }),
  } };
}

export function inspectArtifactJson(bytes: Buffer, textPointers: string[]): ArtifactJsonInspection {
  const { value, layers, sourceResultTruncated } = decodeArtifactJson(bytes, textPointers);
  const result: ArtifactJsonInspection = {
    layers, rootType: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
    nodeCount: 0, numberCount: 0, nonFiniteNumberCount: 0, arrayCount: 0, arrayLengths: {},
    ...(sourceResultTruncated === undefined ? {} : { sourceResultTruncated }),
  };
  const pending = [value];
  while (pending.length) {
    const node = pending.pop();
    if (++result.nodeCount > 100_000) throw new SessionArtifactError('ARTIFACT_JSON_INSPECTION_LIMIT', 'JSON exceeds 100000 inspected nodes.');
    if (typeof node === 'number') {
      result.numberCount += 1;
      if (!Number.isFinite(node)) result.nonFiniteNumberCount += 1;
    } else if (Array.isArray(node)) {
      result.arrayCount += 1;
      const key = String(node.length);
      result.arrayLengths[key] = (result.arrayLengths[key] ?? 0) + 1;
      for (const child of node) pending.push(child);
    } else if (node && typeof node === 'object') {
      for (const child of Object.values(node)) pending.push(child);
    }
  }
  return result;
}
