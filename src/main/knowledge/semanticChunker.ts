import { DEFAULT_EMBEDDING_CHUNKER } from '@shared/types/embedding';
import type { SemanticCorpusDocument } from './knowledgeLanes';

export const PLAIN_V1_MAX_CHARS = 800;

export interface SemanticChunkDraft {
  cardId: string;
  spaceId: string;
  relativePath: string;
  title: string;
  type?: string;
  lifecycle?: string;
  chunkIndex: number;
  text: string;
}

export function chunkPlainV1(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';

  const flush = (): void => {
    const next = current.trim();
    if (next) chunks.push(next);
    current = '';
  };

  for (const paragraph of paragraphs) {
    const piece = paragraph.trim();
    if (!piece) continue;
    if (piece.length > PLAIN_V1_MAX_CHARS) {
      flush();
      for (const part of splitLongPiece(piece, PLAIN_V1_MAX_CHARS)) {
        chunks.push(part);
      }
      continue;
    }
    if (!current) {
      current = piece;
      continue;
    }
    if (`${current}\n\n${piece}`.length <= PLAIN_V1_MAX_CHARS) {
      current = `${current}\n\n${piece}`;
      continue;
    }
    flush();
    current = piece;
  }
  flush();
  return chunks;
}

export function draftSemanticChunks(documents: readonly SemanticCorpusDocument[]): SemanticChunkDraft[] {
  const drafts: SemanticChunkDraft[] = [];
  const ordered = [...documents].sort((left, right) => (
    left.relativePath.localeCompare(right.relativePath) || left.cardId.localeCompare(right.cardId)
  ));
  for (const document of ordered) {
    const source = [document.title.trim(), document.body.trim()].filter(Boolean).join('\n\n');
    const parts = chunkPlainV1(source);
    parts.forEach((text, chunkIndex) => {
      drafts.push({
        cardId: document.cardId,
        spaceId: document.spaceId,
        relativePath: document.relativePath,
        title: document.title,
        type: document.type,
        lifecycle: document.lifecycle,
        chunkIndex,
        text,
      });
    });
  }
  return drafts;
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function compareSemanticHits(left: { score: number; cardId: string; chunkIndex: number }, right: {
  score: number;
  cardId: string;
  chunkIndex: number;
}): number {
  return right.score - left.score
    || left.cardId.localeCompare(right.cardId)
    || left.chunkIndex - right.chunkIndex;
}

export const SEMANTIC_CHUNKER_ID = DEFAULT_EMBEDDING_CHUNKER;

function splitLongPiece(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const byLine = text.split('\n');
  if (byLine.length > 1) {
    const packed: string[] = [];
    let current = '';
    for (const line of byLine) {
      const next = current ? `${current}\n${line}` : line;
      if (next.length <= maxChars) {
        current = next;
        continue;
      }
      if (current.trim()) packed.push(current.trim());
      if (line.length > maxChars) {
        packed.push(...hardSplit(line, maxChars));
        current = '';
      } else {
        current = line;
      }
    }
    if (current.trim()) packed.push(current.trim());
    return packed;
  }
  const bySpace = text.split(/\s+/);
  if (bySpace.length > 1) {
    const packed: string[] = [];
    let current = '';
    for (const word of bySpace) {
      const next = current ? `${current} ${word}` : word;
      if (next.length <= maxChars) {
        current = next;
        continue;
      }
      if (current.trim()) packed.push(current.trim());
      if (word.length > maxChars) {
        packed.push(...hardSplit(word, maxChars));
        current = '';
      } else {
        current = word;
      }
    }
    if (current.trim()) packed.push(current.trim());
    return packed;
  }
  return hardSplit(text, maxChars);
}

function hardSplit(text: string, maxChars: number): string[] {
  const parts: string[] = [];
  for (let index = 0; index < text.length; index += maxChars) {
    parts.push(text.slice(index, index + maxChars));
  }
  return parts;
}
