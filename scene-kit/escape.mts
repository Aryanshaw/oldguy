// Characters that can break out of HTML text or an attribute, and what to write instead.
const HTML_ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };

// Control characters that are never wanted in a video (tab and newline are kept).
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

// Turn any value into text that is safe to place inside HTML (null and undefined become empty).
function esc(text: unknown): string {
  if (text === null || text === undefined) return "";
  return String(text).replace(CONTROL_CHARS, "").replace(/[&<>"'`]/g, (ch) => HTML_ENTITIES[ch] as string);
}

export { esc };
