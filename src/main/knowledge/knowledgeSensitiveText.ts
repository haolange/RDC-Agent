/**
 * Text that must not enter or leave a knowledge base: credentials recognised by the shape of their value, and
 * absolute local paths. A word such as "password" in prose is not a secret; `password: hunter22` is.
 */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/u,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/u,
  /\bgithub_pat_[A-Za-z0-9_]{22,}/u,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/u,
  /\bAIza[0-9A-Za-z_-]{35}\b/u,
  /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/u,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/u,
  /\bbearer\s+[A-Za-z0-9._~+/-]{16,}=*/iu,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/iu,
  /\b(?:api[_-]?key|access[_-]?key|secret(?:[_-]?key)?|client[_-]?secret|token|password|passwd|credential)\s*[:=]\s*['"]?[^\s'",;]{6,}/iu,
];

const DRIVE_ABS_RE = /(?<![A-Za-z0-9/])[A-Za-z]:[/\\]/u;
const UNC_ABS_RE = /\\\\/u;
const POSIX_ABS_RE = /(?:^|[\s"'`([{,:=])\/[A-Za-z0-9._-]+/u;

/** Single secret matcher shared by import and export, so both refuse the same content. */
export function hasKnowledgeSecret(text: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(text));
}

export function containsAbsolutePath(text: string): boolean {
  return DRIVE_ABS_RE.test(text) || UNC_ABS_RE.test(text) || POSIX_ABS_RE.test(text);
}
