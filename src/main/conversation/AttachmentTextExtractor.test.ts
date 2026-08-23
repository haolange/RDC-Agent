import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  countAttachmentTokens,
  extractPdfText,
  resolveInlineTokenBudget,
  truncateTextToTokenBudget,
} from './AttachmentTextExtractor';

function buildTextLayerPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  let body = '%PDF-1.1\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }
  const xrefStart = body.length;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let index = 1; index <= 5; index += 1) {
    xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  return Buffer.from(`${body}${xref}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
}

describe('AttachmentTextExtractor budget', () => {
  it('splits the fixed inline budget evenly across extractable attachments', () => {
    expect(resolveInlineTokenBudget(1)).toBe(24_000);
    expect(resolveInlineTokenBudget(2)).toBe(12_000);
    expect(resolveInlineTokenBudget(3)).toBe(8_000);
  });

  it('caps the inline budget by a ratio of the turn prompt budget', () => {
    expect(resolveInlineTokenBudget(1, 72_000)).toBe(7_200);
    expect(resolveInlineTokenBudget(2, 72_000)).toBe(3_600);
    expect(resolveInlineTokenBudget(1, 500_000)).toBe(24_000);
  });

  it('returns identical truncated text for the same input and budget', () => {
    const source = Array.from({ length: 4000 }, (_, index) => `line-${index} ${'word '.repeat(8)}`).join('\n');
    const first = truncateTextToTokenBudget(source, 400);
    const second = truncateTextToTokenBudget(source, 400);
    expect(first.truncated).toBe(true);
    expect(first.text).toBe(second.text);
    expect(first.text).toContain('… truncated …');
    expect(countAttachmentTokens(first.text)).toBeLessThanOrEqual(400);
  });

  it('does not truncate text that already fits the budget', () => {
    const result = truncateTextToTokenBudget('short note', 200);
    expect(result).toEqual({ text: 'short note', truncated: false });
  });

  it('returns an explicit empty-layer diagnostic for a PDF without text', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-pdf-'));
    const pdfPath = path.join(dir, 'empty.pdf');
    fs.writeFileSync(pdfPath, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const extracted = await extractPdfText(pdfPath, 400);
    expect(extracted.body).toBe('');
    expect(extracted.emptyReason).toMatch(/could not be loaded|no extractable text layer/i);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('extracts text from a PDF that has a text layer', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-pdf-text-'));
    const pdfPath = path.join(dir, 'hello.pdf');
    fs.writeFileSync(pdfPath, buildTextLayerPdf('Hello PDF text layer'));
    const extracted = await extractPdfText(pdfPath, 400);
    expect(extracted.emptyReason).toBeUndefined();
    expect(extracted.body).toMatch(/Hello PDF text layer/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
