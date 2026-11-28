// Stage 4 API routes: health (G5), exercise warnings (G6) and the offline OG
// image (G7). Called by server.mjs after its Host, Origin, Sec-Fetch-Site and
// session checks and the mutation gate; every route here is read-only.
import { git, parsePorcelain } from "./update.mjs";
import { courseConfig } from "./course.mjs";
import { contentConfig } from "./content-config.mjs";

const started = Date.now();
const MAX_PATHS = 5;
let warningCache = { at: 0, value: null };

/** Files under exercises/ that differ from the committed course. No git: none. */
export async function exerciseWarnings(root, { maxAgeMs = 2000 } = {}) {
  if (warningCache.value && warningCache.root === root && Date.now() - warningCache.at < maxAgeMs) return warningCache.value;
  const result = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "exercises"], { timeoutMs: 5000 });
  let value = { warnings: [] };
  if (result.code === 0) {
    const paths = [...new Set(parsePorcelain(result.stdout))].filter((p) => p.startsWith("exercises/")).sort();
    if (paths.length)
      value = {
        warnings: [
          {
            id: "exercises-changed",
            level: "warning",
            title: "Files in the course's exercises folder changed",
            message: "Work in your playground: the problem and solution folders are the course's reference copies.",
            paths: paths.slice(0, MAX_PATHS),
            more: Math.max(0, paths.length - MAX_PATHS),
            // Changes to the set of paths re-show a dismissed (for now) banner.
            key: paths.join("\n").slice(0, 4000),
          },
        ],
      };
  }
  warningCache = { at: Date.now(), root, value };
  return value;
}

const XML = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
// Control characters (other than tab/newline, removed too) and lone
// surrogates are not valid XML text.
export const xmlText = (value, max = 120) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f\ud800-\udfff￾￿]/g, " ")
    .slice(0, max)
    .replace(/[&<>"']/g, (c) => XML[c]);

function wrap(text, width, lines) {
  const words = text.split(/\s+/).filter(Boolean);
  const out = [];
  let line = "";
  for (const word of words) {
    const next = line ? line + " " + word : word;
    if (next.length > width && line) {
      out.push(line);
      line = word;
    } else line = next;
    if (out.length === lines) break;
  }
  if (line && out.length < lines) out.push(line);
  if (out.length === lines && words.join(" ").length > out.join(" ").length) out[lines - 1] = out[lines - 1].slice(0, width - 1) + "…";
  return out.map((l) => l.slice(0, width + 4));
}

/** A 1200×630 social card as SVG: no fonts, network or emoji CDN. */
export function ogSvg({ title, subtitle, product }) {
  const lines = wrap(String(title || "Icode Workshop").slice(0, 120), 26, 3);
  const sub = String(subtitle || "").slice(0, 120);
  const font = "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
  const titleLines = lines
    .map((l, i) => `<text x="80" y="${250 + i * 84}" font-size="72" font-weight="700" fill="#ffffff">${xmlText(l)}</text>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${xmlText(title || "Icode Workshop", 200)}">
<defs><radialGradient id="g" cx="0.3" cy="0.2" r="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="0.6" stop-color="#0f172a"/></radialGradient></defs>
<rect width="1200" height="630" fill="url(#g)"/>
<g font-family="${font}">
<text x="80" y="130" font-size="30" font-weight="600" fill="#fdba74">${xmlText(product || "Icode Workshop", 60)}</text>
${titleLines}
${sub ? `<text x="80" y="${270 + lines.length * 84}" font-size="34" fill="#cbd5e1">${xmlText(sub, 80)}</text>` : ""}
<text x="80" y="570" font-size="26" fill="#cbd5e1">Learn by building · works offline</text>
</g>
</svg>
`;
}

export async function handleUx({ req, res, url, root, json }) {
  const path = url.pathname;
  if (path === "/api/health" && req.method === "GET") {
    res.setHeader("cache-control", "no-store");
    return json(res, 200, { ok: true, uptimeSeconds: Math.floor((Date.now() - started) / 1000) }), true;
  }
  if (path === "/api/warnings" && req.method === "GET") {
    res.setHeader("cache-control", "no-store");
    return json(res, 200, await exerciseWarnings(root)), true;
  }
  if (path === "/api/og.svg" && req.method === "GET") {
    let title = url.searchParams.get("title");
    let subtitle = url.searchParams.get("subtitle");
    let product;
    if (!title) {
      // Defaults from the course; a broken course.json still gets a card.
      try {
        const c = await contentConfig(root);
        title = c.title ?? (await courseConfig(root)).title;
        subtitle ??= c.subtitle;
        product = c.product?.name;
      } catch {
        title = "Icode Workshop";
      }
    }
    res.writeHead(200, {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    });
    res.end(ogSvg({ title, subtitle, product }));
    return true;
  }
  return false;
}
