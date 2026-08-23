import * as fs from 'fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { TokenizerService } from '../agent-runtime/core/TokenizerService';
import {
  ATTACHMENT_INLINE_BUDGET_RATIO,
  ATTACHMENT_INLINE_TOKEN_BUDGET,
} from './attachmentClassify';

const tokenizer = new TokenizerService();
const TOKEN_MODEL = 'gpt-4';
const BYTE_WINDOW_SLACK = 1.5;
const BYTES_PER_TOKEN = 4;

export interface ExtractedAttachmentText {
  body: string;
  truncated: boolean;
  extractedChars: number;
  totalChars: number;
  extractedBytes: number;
  totalBytes: number;
  emptyReason?: string;
}

export function countAttachmentTokens(text: string): number {
  return tokenizer.countTokens(text, TOKEN_MODEL);
}

export function resolveInlineTokenBudget(
  extractableCount: number,
  contextBudgetTokens?: number,
): number {
  const fromContext = typeof contextBudgetTokens === 'number' && contextBudgetTokens > 0
    ? Math.floor(contextBudgetTokens * ATTACHMENT_INLINE_BUDGET_RATIO)
    : ATTACHMENT_INLINE_TOKEN_BUDGET;
  const total = Math.min(ATTACHMENT_INLINE_TOKEN_BUDGET, Math.max(256, fromContext));
  return Math.max(256, Math.floor(total / Math.max(1, extractableCount)));
}

export function truncateTextToTokenBudget(
  text: string,
  budgetTokens: number,
): { text: string; truncated: boolean } {
  if (countAttachmentTokens(text) <= budgetTokens) {
    return { text, truncated: false };
  }
  const marker = '\n\n… truncated …\n\n';
  const available = Math.max(128, budgetTokens - countAttachmentTokens(marker));
  const headBudget = Math.max(64, Math.floor(available * 0.6));
  const tailBudget = Math.max(64, available - headBudget);
  const head = sliceByTokens(text, headBudget, 'head');
  const tail = sliceByTokens(text, tailBudget, 'tail');
  return { text: `${head}${marker}${tail}`, truncated: true };
}

function sliceByTokens(text: string, budget: number, side: 'head' | 'tail'): string {
  if (text.length === 0) return '';
  let low = 0;
  let high = text.length;
  let best = '';
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = side === 'head' ? text.slice(0, mid) : text.slice(text.length - mid);
    if (countAttachmentTokens(candidate) <= budget) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

function windowBytesForBudget(budgetTokens: number): number {
  return Math.max(4096, Math.ceil(budgetTokens * BYTES_PER_TOKEN * BYTE_WINDOW_SLACK));
}

async function readUtf8Window(filePath: string, budgetTokens: number): Promise<{
  decoded: string;
  totalBytes: number;
  pretrimmed: boolean;
}> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const stats = await handle.stat();
    const totalBytes = stats.size;
    const windowBytes = windowBytesForBudget(budgetTokens);
    if (totalBytes <= windowBytes) {
      const bytes = Buffer.alloc(totalBytes);
      await handle.read(bytes, 0, totalBytes, 0);
      return { decoded: bytes.toString('utf8'), totalBytes, pretrimmed: false };
    }
    const headBytes = Math.max(1, Math.floor(windowBytes * 0.6));
    const tailBytes = Math.max(1, windowBytes - headBytes);
    const head = Buffer.alloc(headBytes);
    const tail = Buffer.alloc(tailBytes);
    await handle.read(head, 0, headBytes, 0);
    await handle.read(tail, 0, tailBytes, Math.max(0, totalBytes - tailBytes));
    return {
      decoded: `${head.toString('utf8')}\n\n… truncated …\n\n${tail.toString('utf8')}`,
      totalBytes,
      pretrimmed: true,
    };
  } finally {
    await handle.close();
  }
}

export async function extractUtf8Text(filePath: string, budgetTokens: number): Promise<ExtractedAttachmentText> {
  const { decoded, totalBytes, pretrimmed } = await readUtf8Window(filePath, budgetTokens);
  const { text, truncated } = truncateTextToTokenBudget(decoded, budgetTokens);
  return {
    body: text,
    truncated: truncated || pretrimmed,
    extractedChars: text.length,
    totalChars: decoded.length,
    extractedBytes: Buffer.byteLength(text),
    totalBytes,
  };
}

export async function extractPdfText(filePath: string, budgetTokens: number): Promise<ExtractedAttachmentText> {
  let pages: string[];
  try {
    pages = await readPdfPageText(filePath);
  } catch (error) {
    return {
      body: '',
      truncated: false,
      extractedChars: 0,
      totalChars: 0,
      extractedBytes: 0,
      totalBytes: 0,
      emptyReason: pdfEmptyReason(error),
    };
  }
  if (pages.every((page) => page.length === 0)) {
    return {
      body: '',
      truncated: false,
      extractedChars: 0,
      totalChars: 0,
      extractedBytes: 0,
      totalBytes: 0,
      emptyReason: 'PDF has no extractable text layer (likely a scanned document).',
    };
  }
  const decoded = pages
    .map((page, index) => `--- page ${index + 1} ---\n${page}`)
    .join('\n\n');
  const { text, truncated } = truncateTextToTokenBudget(decoded, budgetTokens);
  return {
    body: text,
    truncated,
    extractedChars: text.length,
    totalChars: decoded.length,
    extractedBytes: Buffer.byteLength(text),
    totalBytes: Buffer.byteLength(decoded),
  };
}

function pdfEmptyReason(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'PasswordException' || /password/i.test(message)) {
    return 'PDF is encrypted and cannot be read without a password.';
  }
  return 'PDF text extraction failed; the document could not be loaded.';
}

let pdfWorkerConfigured = false;

function configurePdfWorker(pdfjs: { GlobalWorkerOptions: { workerSrc: string } }): void {
  if (pdfWorkerConfigured) return;
  const require = createRequire(__filename);
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ).href;
  pdfWorkerConfigured = true;
}

async function readPdfPageText(filePath: string): Promise<string[]> {
  const bytes = await fs.promises.readFile(filePath);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  configurePdfWorker(pdfjs);
  const document = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
  }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => (typeof item.str === 'string' ? item.str : ''))
      .join(' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
    pages.push(text);
  }
  return pages;
}
