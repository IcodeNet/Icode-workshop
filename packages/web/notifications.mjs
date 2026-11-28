// Workshop notifications: course-declared, apps-layout package.json,
// and an optional https feed. Offline-safe, bounded, mutable per learner.
import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import JSON5 from "json5";
import { contentConfig, validateNotification } from "./content-config.mjs";
import { assertSafePath } from "./files.mjs";
import { renderSafe as renderLesson } from "./markdown.mjs";

const FEED_TTL_MS = 60 * 60 * 1000;
const FEED_MAX_BYTES = 64 * 1024;
const MAX_MUTED = 500;
const feeds = new Map(); // url -> {at, items}

export async function fetchFeed(url, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (process.env.ICODE_NOTIFICATIONS_FEED === "0" || !url) return [];
  const cached = feeds.get(url);
  if (cached && now - cached.at < FEED_TTL_MS) return cached.items;
  try {
    const response = await fetchImpl(url, {
      redirect: "error",
      credentials: "omit",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const length = Number(response.headers?.get?.("content-length") || 0);
    if (length > FEED_MAX_BYTES) throw new Error("Feed too large");
    const text = await readCapped(response, FEED_MAX_BYTES);
    // JSON5 (comments, trailing commas); plain JSON is JSON5.
    const data = JSON5.parse(text);
    const list = Array.isArray(data) ? data : Array.isArray(data?.notifications) ? data.notifications : [];
    const items = list.slice(0, 50).map(validateNotification).filter(Boolean).map((n) => ({ ...n, source: "feed" }));
    feeds.set(url, { at: now, items });
    return items;
  } catch {
    // Offline or invalid: keep the last good copy, stay silent.
    if (cached) feeds.set(url, { at: now, items: cached.items });
    return cached?.items ?? [];
  }
}
async function readCapped(response, max) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (text.length > max) throw new Error("Feed too large");
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new Error("Feed too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}
export function clearFeedCache() {
  feeds.clear();
}

async function mutedPath(root) {
  return assertSafePath(join(root, ".workshop", "notifications.json"));
}
export async function readMuted(root) {
  try {
    const data = JSON.parse(await readFile(await mutedPath(root), "utf8"));
    return Array.isArray(data.muted) ? data.muted.filter((id) => typeof id === "string").slice(-MAX_MUTED) : [];
  } catch (e) {
    if (e.code === "ENOENT" || e instanceof SyntaxError) return [];
    throw e;
  }
}
let queue = Promise.resolve();
export function muteNotification(root, id) {
  const op = queue.catch(() => {}).then(async () => {
    if (typeof id !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(id)) throw new Error("Invalid notification id");
    const muted = (await readMuted(root)).filter((m) => m !== id);
    muted.push(id);
    const path = await mutedPath(root);
    await mkdir(join(root, ".workshop"), { recursive: true });
    const tmp = path + "." + randomUUID() + ".tmp";
    try {
      await writeFile(tmp, JSON.stringify({ muted: muted.slice(-MAX_MUTED) }, null, 2), { flag: "wx" });
      await rename(tmp, path);
    } finally {
      await rm(tmp, { force: true });
    }
    return { muted: muted.slice(-MAX_MUTED) };
  });
  queue = op;
  return op;
}

export async function activeNotifications(root, { now = Date.now(), fetchImpl, sandboxOrigin = "" } = {}) {
  const config = await contentConfig(root);
  const feed = config.notificationsFeed ? await fetchFeed(config.notificationsFeed, { fetchImpl, now }) : [];
  const muted = new Set(await readMuted(root));
  const seen = new Set();
  const out = [];
  for (const n of [...config.notifications, ...feed]) {
    if (seen.has(n.id) || muted.has(n.id)) continue;
    if (n.expiresAt && Date.parse(n.expiresAt) <= now) continue;
    seen.add(n.id);
    const { html } = await renderLesson(n.message, { sandboxOrigin });
    out.push({ ...n, html });
  }
  return { notifications: out };
}
