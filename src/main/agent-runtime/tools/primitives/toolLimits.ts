/**
 * Canonical hard limits for builtin primitive / file tools.
 * Full-access may skip approval but must not bypass these budgets.
 */

/** Max bytes returned by read_file after numbering. */
export const READ_FILE_MAX_OUTPUT_BYTES = 200 * 1024;

/** Max lines per read_file call. */
export const READ_FILE_DEFAULT_LIMIT = 2000;
export const READ_FILE_MAX_LIMIT = 5000;

/** Reject whole-file text loads above this size (streamed windows still allowed under sample gates). */
export const TEXT_FILE_MAX_BYTES = 8 * 1024 * 1024;

/** Bytes sampled from file head for binary / NUL detection. */
export const BINARY_SAMPLE_BYTES = 8 * 1024;

/** Max UTF-8 bytes accepted by write_file content. */
export const WRITE_FILE_MAX_CONTENT_BYTES = 2 * 1024 * 1024;

/** Max source file size for copy / move. */
export const COPY_MOVE_MAX_BYTES = 32 * 1024 * 1024;

/** Max notebook file size for notebook_edit. */
export const NOTEBOOK_MAX_BYTES = 4 * 1024 * 1024;

/** Grep output and per-file / per-line caps. */
export const GREP_MAX_OUTPUT_BYTES = 120 * 1024;
export const GREP_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const GREP_MAX_LINE_CHARS = 4 * 1024;
export const GREP_REGEX_TIMEOUT_MS = 200;

/** Glob result output byte cap. */
export const GLOB_MAX_OUTPUT_BYTES = 120 * 1024;

/** Bash output / timeout clamps. */
export const BASH_MAX_OUTPUT_BYTES = 50 * 1024;
export const BASH_DEFAULT_TIMEOUT_MS = 120_000;
export const BASH_MAX_TIMEOUT_MS = 600_000;

/** Git tool output / timeout. */
export const GIT_MAX_OUTPUT_BYTES = 64 * 1024;
export const GIT_TIMEOUT_MS = 60_000;

/** Web fetch response cap. */
export const WEB_MAX_RESPONSE_BYTES = 160 * 1024;
export const WEB_MAX_REDIRECTS = 5;
