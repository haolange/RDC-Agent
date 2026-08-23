export const formatBytes = (size: number | null | undefined): string => {
  if (!size || size <= 0) {
    return '';
  }

  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export function ellipsizeFileName(fileName: string, max = 28): string {
  const separator = fileName.lastIndexOf('.');
  const ext = separator > 0 ? fileName.slice(separator) : '';
  const stem = ext ? fileName.slice(0, -ext.length) : fileName;
  if (fileName.length <= max) return fileName;
  const keep = Math.max(4, max - ext.length - 1);
  const head = Math.ceil(keep * 0.6);
  const tail = Math.max(1, keep - head);
  return `${stem.slice(0, head)}…${stem.slice(-tail)}${ext}`;
}

export function fileExtensionLabel(fileName: string): string {
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1) : '';
  return ext ? ext.toUpperCase() : 'FILE';
}
