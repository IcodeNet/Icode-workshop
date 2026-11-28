// Stage 4 (G1): fuzzy matching for the command palette. Returns a score and
// the matched character ranges; the UI turns ranges into <mark> elements with
// text children, so labels are never parsed as HTML.

const WORD_START = /[\s\-_./·:#@()[\]]/;

/**
 * Match `query` against `text` as a case-insensitive subsequence.
 * Returns { score, ranges: [[start, end), ...] } or null.
 */
export function fuzzyMatch(query, text) {
  const q = String(query ?? "").trim().toLowerCase();
  const t = String(text ?? "");
  const lower = t.toLowerCase();
  if (!q) return { score: 0, ranges: [] };
  if (q.length > t.length) return null;
  // Substring match first: much better than a scattered subsequence.
  const at = lower.indexOf(q);
  if (at !== -1) {
    const start = at === 0 || WORD_START.test(t[at - 1]);
    return { score: 1000 - at + (start ? 200 : 0) + (at === 0 ? 300 : 0) + (q.length === t.length ? 500 : 0), ranges: [[at, at + q.length]] };
  }
  const ranges = [];
  let score = 0;
  let ti = 0;
  let run = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    if (c === " ") continue;
    const found = lower.indexOf(c, ti);
    if (found === -1) return null;
    const contiguous = found === ti && qi > 0;
    run = contiguous ? run + 1 : 0;
    score += 10 + run * 15 + (found === 0 || WORD_START.test(t[found - 1]) ? 25 : 0) - Math.min(found - ti, 20);
    const lastRange = ranges[ranges.length - 1];
    if (lastRange && lastRange[1] === found) lastRange[1] = found + 1;
    else ranges.push([found, found + 1]);
    ti = found + 1;
  }
  return { score, ranges };
}

/** Score an item over its fields (label first); keep ranges for the label. */
export function matchItem(query, item) {
  const label = fuzzyMatch(query, item.label);
  let best = label ? { score: label.score + 50, ranges: label.ranges } : null;
  for (const field of item.keywords || []) {
    const m = fuzzyMatch(query, field);
    if (m && (!best || m.score > best.score)) best = { score: m.score, ranges: label?.ranges || [] };
  }
  return best;
}

/** Filter and rank items. Ties keep their original order. */
export function search(query, items, limit = 50) {
  const q = String(query ?? "").trim();
  if (!q) return items.slice(0, limit).map((item) => ({ item, ranges: [] }));
  const scored = [];
  items.forEach((item, index) => {
    const m = matchItem(q, item);
    if (m) scored.push({ item, ranges: m.ranges, score: m.score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map(({ item, ranges }) => ({ item, ranges }));
}

/** Split text into [{ text, match }] parts for rendering. */
export function highlightParts(text, ranges) {
  const parts = [];
  let i = 0;
  for (const [start, end] of ranges) {
    if (start > i) parts.push({ text: text.slice(i, start), match: false });
    parts.push({ text: text.slice(start, end), match: true });
    i = end;
  }
  if (i < text.length) parts.push({ text: text.slice(i), match: false });
  return parts;
}

/** Palette prefixes: ">" commands, "#" lessons, "@" files. */
export function parseQuery(raw) {
  const value = String(raw ?? "");
  const kind = { ">": "command", "#": "lesson", "@": "file" }[value[0]];
  return kind ? { kind, query: value.slice(1) } : { kind: null, query: value };
}
