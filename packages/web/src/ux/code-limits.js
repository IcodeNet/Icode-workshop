// Limits for code shown in the workbench, shared by the API (Shiki tokens for
// read-only views) and the browser (the Playground editor). Above either
// limit a file is shown and edited as plain text: no tokenising, no parser.
export const HIGHLIGHT_MAX_CHARS = 64 * 1024;
export const HIGHLIGHT_MAX_LINE_CHARS = 5000;

/** Why `text` is shown as plain text, or "" when it can be highlighted. */
export function plainTextReason(text) {
  const value = String(text ?? "");
  if (value.length > HIGHLIGHT_MAX_CHARS) return "Large file: shown as plain text";
  let start = 0;
  while (start <= value.length) {
    let end = value.indexOf("\n", start);
    if (end < 0) end = value.length;
    if (end - start > HIGHLIGHT_MAX_LINE_CHARS) return "Very long lines: shown as plain text";
    start = end + 1;
  }
  return "";
}
