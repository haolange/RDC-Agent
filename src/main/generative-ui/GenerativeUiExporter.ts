import fs from 'fs';
import path from 'path';
import type { GenerativeUiCanvas } from '@shared/types/generativeUi';
import { buildGenerativeUiSandboxDocument } from './GenerativeUiSandbox';

export function exportGenerativeUiVersion(rootPath: string, canvas: GenerativeUiCanvas, versionId: string): { filePath: string; fileName: string } {
  const version = canvas.versions.find((entry) => entry.versionId === versionId);
  if (!version) throw new Error(`Canvas version not found: ${versionId}`);
  const exportDirectory = path.join(rootPath, 'exports');
  fs.mkdirSync(exportDirectory, { recursive: true });
  const title = canvas.title.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'generative-ui';
  const fileName = `${title}-${version.versionId.slice(0, 8)}.html`;
  const filePath = path.join(exportDirectory, fileName);
  const metadata = `<!-- RDC-Agent Generative UI | Canvas ${canvas.canvasId} | Version ${version.versionId} -->\n`;
  fs.writeFileSync(filePath, `${metadata}${buildGenerativeUiSandboxDocument(version.source, false)}`, 'utf8');
  return { filePath, fileName };
}
