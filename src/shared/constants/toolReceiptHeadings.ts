/**
 * Headings main writes into a tool result's model-facing text after storing its evidence. They are protocol text for
 * the model, not interface copy: the renderer recognizes the receipt block by the same strings and keeps it off the
 * card summary, so both sides read them from here.
 */
export const TOOL_RECEIPT_IMAGE_EVIDENCE_HEADING =
  'Image evidence (grant each exact URI explicitly to a reviewer; the result wrapper does not grant pixels):';
export const TOOL_RECEIPT_DECODED_TEXT_HEADING = 'Decoded tool text: call artifact_read with one of the following exact selections, '
  + 'then follow its next cursor. These select returned text blocks, not omitted source-file ranges or domain validation.';
