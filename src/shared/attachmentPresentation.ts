const associatedDocumentMimes: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function attachmentExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot).toLowerCase() : '';
}

export function associatedDocumentMime(extension: string): string | undefined {
  return associatedDocumentMimes[extension];
}

export function isMarkdownAttachment(extension: string): boolean {
  return extension === '.md' || extension === '.markdown';
}
