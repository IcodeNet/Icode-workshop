import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// The UI origin must never serve course content (Stage 3, BL-1): a sandboxed
// app that navigates its frame or a popup to this origin must not get HTML
// (or anything else) from the course, examples or playgrounds.
const web = fileURLToPath(new URL(".", import.meta.url));
const engineModules = join(web, "..", "..", "node_modules");
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
export const UI_ORIGIN = "http://127.0.0.1:5173";
const api = "http://127.0.0.1:" + (process.env.WORKSHOP_API_PORT || "4317");
const nonce = randomBytes(18).toString("base64url");
export function uiCsp(nonceValue = nonce) {
  return [
    "default-src 'self'",
    // Dev injects inline module scripts (React refresh) with this nonce; the
    // built index.html has external scripts only.
    nonceValue ? `script-src 'self' 'nonce-${nonceValue}'` : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: http://127.0.0.1:* http://localhost:*",
    "media-src 'self' https: http:",
    "font-src 'self' data:",
    "connect-src 'self' ws://127.0.0.1:5173 ws://localhost:5173",
    // Sandbox origin, previews and loopback tools only.
    "frame-src http://127.0.0.1:* http://localhost:*",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
const securityHeaders = (csp) => ({
  "content-security-policy": csp,
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
});
const NAVIGATION = new Set(["document", "iframe", "frame", "embed", "object"]);
/**
 * Defence in depth on top of fs.allow: documents are only "/" (the UI) and
 * /api downloads, and only for direct or same-origin navigation. A frame or
 * popup opened by the sandbox (Sec-Fetch-Site: same-site) gets nothing.
 */
export function navigationGuard(req, res, next) {
  const dest = req.headers["sec-fetch-dest"];
  const site = req.headers["sec-fetch-site"];
  const path = (req.url || "/").split("?")[0];
  if (path.startsWith("/@fs/") && dest !== "script" && dest !== "style" && dest !== "empty" && dest !== undefined) {
    res.statusCode = 403;
    return res.end("Forbidden");
  }
  if (NAVIGATION.has(dest)) {
    const allowed = (path === "/" || path === "/index.html" || path.startsWith("/api/")) && (site === undefined || site === "none" || site === "same-origin");
    if (!allowed) {
      res.statusCode = 403;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      return res.end("The workshop UI is not served to other pages or frames.");
    }
  }
  next();
}
export default defineConfig({
  plugins: [
    react(),
    {
      name: "icode-ui-guard",
      configureServer(server) {
        server.middlewares.use(navigationGuard);
      },
      configurePreviewServer(server) {
        server.middlewares.use(navigationGuard);
      },
    },
  ],
  html: { cspNonce: nonce },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    cors: { origin: UI_ORIGIN },
    headers: securityHeaders(uiCsp()),
    fs: {
      strict: true,
      // UI sources and installed dependencies only: never the course,
      // examples, playgrounds or the rest of the engine checkout.
      allow: [join(web, "src"), join(web, "index.html"), join(web, "public"), real(join(web, "node_modules")), real(engineModules)],
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.workshop/**", "**/exercises/**", "**/examples/**"],
    },
    proxy: {
      "/api": api,
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    cors: { origin: UI_ORIGIN },
    headers: securityHeaders(uiCsp(null)),
    proxy: { "/api": api },
  },
});
