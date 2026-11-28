// Content settings: workshop metadata, pages, forms,
// support/community, repository and cloud-editor links, and the
// per-step app model. Every field is optional; invalid values
// are dropped and reported as warnings, never break the course.
import { readFile, readdir, lstat } from "node:fs/promises";
import { join, relative } from "node:path";
import { hostConfig, stepLayout } from "../core/layout.mjs";
import { APPS_FORMAT, APPS_SETTINGS_KEY } from "../core/apps-layout.mjs";
import { validateId } from "../core/index.mjs";
import { variantRoot } from "./files.mjs";

export const SANDBOX_PORT = Number(process.env.WORKSHOP_SANDBOX_PORT ?? 4318);

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return undefined;
    throw new Error("Invalid JSON in " + path.split(/[\\/]/).slice(-2).join("/") + ": " + e.message);
  }
}
const str = (v, max = 200) => (typeof v === "string" && v.trim() && v.length <= max && !/[\u0000-\u001f]/.test(v) ? v.trim() : undefined);
export function httpsUrl(value) {
  if (typeof value !== "string" || value.length > 2000) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
// A course-relative path (posix, no dot segments) or an https URL.
export function imageRef(value) {
  if (httpsUrl(value)) return { url: httpsUrl(value) };
  if (typeof value === "string" && value.length <= 240 && /^[\w\-./ ]+$/.test(value) && value.split("/").every((p) => p && !p.startsWith(".")) && /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i.test(value))
    return { path: value };
  return undefined;
}
function coursePath(value) {
  return typeof value === "string" && value.length <= 240 && !value.includes("\\") && value.split("/").every((p) => p && p !== "." && p !== "..") && /\.mdx?$/.test(value) ? value : undefined;
}

async function appsSettings(root) {
  if (hostConfig(root).format !== APPS_FORMAT) return {};
  const pkg = await readJson(join(root, "package.json"));
  const settings = pkg?.[APPS_SETTINGS_KEY];
  return settings && typeof settings === "object" ? settings : {};
}
async function courseJson(root) {
  const course = await readJson(join(root, "course.json"));
  return course && typeof course === "object" ? course : {};
}

/** Parse "owner/repo" or a GitHub URL (apps-layout githubRoot/githubRepo). */
export function parseRepository(value) {
  if (!value) return undefined;
  let owner, repo, branch, root = "";
  if (typeof value === "object") {
    const m = String(value.github ?? "").match(/^([\w.-]{1,100})\/([\w.-]{1,100})$/);
    if (!m) return undefined;
    [, owner, repo] = m;
    branch = value.branch ?? "main";
    root = value.root ?? "";
  } else if (typeof value === "string") {
    const url = httpsUrl(value);
    if (!url) return undefined;
    const u = new URL(url);
    if (u.hostname !== "github.com") return undefined;
    const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    [owner, repo] = parts;
    if (!owner || !repo) return undefined;
    repo = repo.replace(/\.git$/, "");
    if (["tree", "blob"].includes(parts[2]) && parts[3]) {
      branch = parts[3];
      root = parts.slice(4).join("/");
    } else branch = "main";
  } else return undefined;
  if (!/^[\w.-]{1,100}$/.test(owner) || !/^[\w.-]{1,100}$/.test(repo) || owner.startsWith(".") || repo.startsWith(".")) return undefined;
  if (typeof branch !== "string" || !branch || branch.length > 200 || branch.includes("..") || /[\u0000- ~^:?*[\\]/.test(branch) || branch.startsWith("/") || branch.endsWith("/")) return undefined;
  if (typeof root !== "string" || root.length > 240 || (root && !root.split("/").every((p) => p && p !== "." && p !== ".."))) return undefined;
  return { owner, repo, branch, root };
}

function notificationList(list, warnings, source) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    warnings.push(source + ": notifications must be an array");
    return [];
  }
  const out = [];
  for (const item of list.slice(0, 50)) {
    const n = validateNotification(item);
    if (n) out.push(n);
    else warnings.push(source + ": invalid notification " + JSON.stringify(item?.id ?? null).slice(0, 80));
  }
  return out;
}
export function validateNotification(item) {
  if (!item || typeof item !== "object") return undefined;
  const id = typeof item.id === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(item.id) ? item.id : undefined;
  const title = str(item.title, 120);
  const message = typeof item.message === "string" && item.message.length <= 1000 ? item.message : undefined;
  const type = item.type === undefined ? "info" : ["info", "warning", "danger"].includes(item.type) ? item.type : undefined;
  const link = item.link === undefined ? undefined : httpsUrl(item.link);
  let expiresAt = null;
  if (item.expiresAt !== undefined && item.expiresAt !== null) {
    const t = Date.parse(item.expiresAt);
    if (typeof item.expiresAt !== "string" || Number.isNaN(t)) return undefined;
    expiresAt = new Date(t).toISOString();
  }
  if (!id || !title || message === undefined || !type || (item.link !== undefined && !link)) return undefined;
  return { id, title, message, type, link, expiresAt };
}

/** Validated workshop-level content settings. */
export async function contentConfig(root) {
  const warnings = [];
  const course = await courseJson(root);
  const apps = await appsSettings(root);
  const pick = (key) => (course[key] !== undefined ? course[key] : apps[key]);
  const out = { warnings };
  out.title = str(course.title) || str(apps.title) || str(hostConfig(root).title) || undefined;
  out.subtitle = str(pick("subtitle"), 300);
  const instructor = pick("instructor");
  if (instructor !== undefined) {
    const avatar = imageRef(instructor?.avatar);
    const x = str(instructor?.xHandle ?? instructor?.["𝕏"], 40);
    out.instructor = instructor && str(instructor.name, 120)
      ? { name: str(instructor.name, 120), url: httpsUrl(instructor.url) ?? (x && /^[A-Za-z0-9_]{1,15}$/.test(x) ? "https://x.com/" + x : undefined), avatar }
      : (warnings.push("instructor needs a name"), undefined);
  }
  const product = pick("product");
  if (product !== undefined && product && typeof product === "object") {
    const name = str(product.name ?? product.displayName, 120);
    const url = httpsUrl(product.url) ?? (typeof product.host === "string" && /^[\w.-]{1,200}$/.test(product.host) ? "https://" + product.host + "/" : undefined);
    if (name) out.product = { name, url, logo: imageRef(product.logo) };
  }
  out.repository = parseRepository(course.repository) ?? parseRepository(apps.githubRoot) ?? parseRepository(apps.githubRepo);
  if (course.repository !== undefined && !parseRepository(course.repository)) warnings.push("repository must be {github: \"owner/repo\", branch?, root?}");
  const forms = pick("forms");
  out.forms = {};
  if (forms !== undefined)
    for (const key of ["workshop", "exercise"]) {
      if (forms?.[key] === undefined) continue;
      if (httpsUrl(String(forms[key]).replace(/\{(workshopTitle|exerciseTitle)\}/g, "x"))) out.forms[key] = forms[key];
      else warnings.push("forms." + key + " must be an https URL template");
    }
  const support = course.support;
  if (support !== undefined) {
    const email = typeof support?.email === "string" && /^[^\s@<>"]{1,64}@[\w.-]{1,190}$/.test(support.email) ? support.email : undefined;
    out.support = { text: typeof support?.text === "string" && support.text.length <= 2000 ? support.text : undefined, url: httpsUrl(support?.url), email };
    if (!out.support.text && !out.support.url && !email) (warnings.push("support needs text, url or email"), delete out.support);
  }
  const community = course.community;
  if (community !== undefined) {
    const url = httpsUrl(community?.url);
    if (url) out.community = { title: str(community.title, 80) || "Community", url };
    else warnings.push("community.url must be https");
  }
  const pages = course.pages ?? {};
  const appsLayout = hostConfig(root).format === APPS_FORMAT;
  out.pages = {
    intro: coursePath(pages.intro) ?? (appsLayout ? "exercises/README.mdx" : "exercises/README.md"),
    finished: coursePath(pages.finished) ?? (appsLayout ? "exercises/FINISHED.mdx" : "exercises/FINISHED.md"),
  };
  for (const k of ["intro", "finished"]) if (pages[k] !== undefined && !coursePath(pages[k])) warnings.push("pages." + k + " must be a course-relative .md/.mdx path");
  out.notifications = [...notificationList(course.notifications, warnings, "course.json"), ...notificationList(course.notifications === undefined ? apps.notifications : undefined, warnings, "package.json#" + APPS_SETTINGS_KEY)];
  out.notificationsFeed = course.notificationsFeed === undefined ? undefined : httpsUrl(course.notificationsFeed);
  if (course.notificationsFeed !== undefined && !out.notificationsFeed) warnings.push("notificationsFeed must be an https URL");
  const appType = pick("appType");
  out.appType = ["export", "standard", "simple"].includes(appType) ? (appType === "export" ? "export" : "simple") : undefined;
  return out;
}

export function fillForm(template, { workshopTitle = "", exerciseTitle = "" } = {}) {
  if (!template) return undefined;
  return httpsUrl(template.replace(/\{workshopTitle\}/g, encodeURIComponent(workshopTitle)).replace(/\{exerciseTitle\}/g, encodeURIComponent(exerciseTitle)));
}

// ---------- per-step apps ----------
const ENTRY_CANDIDATES = ["index.tsx", "index.ts", "index.jsx", "index.js", "index.mjs"];
const TEST_FILE = /^[\w.-]+\.test\.(?:tsx?|jsx?|mjs)$/;
function validAppFile(name) {
  return typeof name === "string" && name.length <= 200 && /^[\w\-./]+\.(?:tsx?|jsx?|mjs)$/.test(name) && name.split("/").every((p) => p && !p.startsWith("."));
}
export function validateApp(app) {
  if (app === undefined) return undefined;
  if (!app || typeof app !== "object") throw new Error("Invalid app configuration");
  if (!["simple", "export"].includes(app.type)) throw new Error('app.type must be "simple" or "export"');
  if (app.entry !== undefined && !validAppFile(app.entry)) throw new Error("Invalid app.entry");
  if (app.initialRoute !== undefined && !(typeof app.initialRoute === "string" && /^\/(?!\/)[\w\-./~%?=&#]*$/.test(app.initialRoute) && app.initialRoute.length <= 300))
    throw new Error("Invalid app.initialRoute");
  if (app.browserTests !== undefined && (!Array.isArray(app.browserTests) || app.browserTests.length > 50 || !app.browserTests.every(validAppFile)))
    throw new Error("Invalid app.browserTests");
  return { type: app.type, entry: app.entry, initialRoute: app.initialRoute ?? "/", browserTests: app.browserTests ?? [] };
}
const CLOUD_KEYS = ["title", "file", "view", "startScript", "hidedevtools", "terminalHeight", "hideNavigation", "hideExplorer", "theme"];
export function validateCloudEditor(value) {
  if (value === undefined) return undefined;
  if (value === false || value === null) return false;
  if (!value || typeof value !== "object") throw new Error("Invalid cloudEditor configuration");
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (!CLOUD_KEYS.includes(k)) continue;
    if ((typeof v !== "string" && typeof v !== "number") || String(v).length > 200 || /[\u0000-\u001f]/.test(String(v))) throw new Error("Invalid cloudEditor." + k);
    out[k] = String(v);
  }
  return out;
}

async function exists(path) {
  try {
    return (await lstat(path)).isFile();
  } catch {
    return false;
  }
}

/** The app of a step, resolved for one variant. */
export async function appInfo(root, id, variant = "playground", { lab } = {}) {
  validateId(id);
  const layout = stepLayout(root, id);
  const config = await contentConfig(root);
  let app = lab?.app;
  let testTab = lab?.testTab !== false;
  let stackBlitz = { problem: lab?.cloudEditor, solution: lab?.cloudEditor };
  const dir = variantRoot(root, id, variant);
  if (!app && layout.apps) {
    // The apps layout keeps app settings in each app's own package.json.
    const pkgOf = async (v) => (await readJson(join(layout[v], "package.json")).catch(() => undefined)) ?? {};
    const pkg = await pkgOf(variant === "solution" ? "solution" : "problem");
    const own = pkg[APPS_SETTINGS_KEY] ?? {};
    const type = own.appType === "export" || (own.appType === undefined && config.appType === "export") ? "export" : "simple";
    if (!pkg.scripts?.dev) app = { type, initialRoute: typeof own.initialRoute === "string" ? own.initialRoute : "/", browserTests: [], testFilesByName: !pkg.scripts?.test };
    if (own.testTab?.enabled === false) testTab = false;
    for (const v of ["problem", "solution"]) {
      const cfg = (await pkgOf(v))[APPS_SETTINGS_KEY]?.stackBlitzConfig;
      if (cfg !== undefined) stackBlitz[v] = cfg === null ? false : validateCloudEditor(cfg);
    }
  }
  let files = [];
  try {
    files = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
  } catch {}
  const result = { type: app?.type ?? null, initialRoute: app?.initialRoute ?? "/", entry: null, browserTests: [], testTab, hasIndexHtml: files.includes("index.html") };
  if (app) {
    result.entry = app.entry ?? ENTRY_CANDIDATES.find((f) => files.includes(f)) ?? null;
    const tests = app.testFilesByName ? files.filter((f) => TEST_FILE.test(f)).sort() : app.browserTests;
    for (const t of tests) if (await exists(join(dir, t))) result.browserTests.push(t);
  }
  if (!testTab) result.browserTests = [];
  result.cloud = await cloudLinks(root, id, config, stackBlitz, { title: lab?.title ?? layout.title ?? "Exercise " + id });
  return result;
}

const enc = (path) => path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
export async function cloudLinks(root, id, config, overrides, { title = "" } = {}) {
  const repo = config.repository;
  if (!repo || (overrides?.problem === false && overrides?.solution === false)) return null;
  const layout = stepLayout(root, id);
  const out = {};
  for (const variant of ["problem", "solution"]) {
    if (overrides?.[variant] === false) continue;
    const rel = relative(root, layout[variant]).split(/[\\/]/).join("/");
    let files = [];
    try {
      files = await readdir(layout[variant]);
    } catch {}
    if (rel.startsWith("..")) continue;
    const path = enc([repo.root, rel].filter(Boolean).join("/"));
    const tree = enc(repo.branch);
    const params = new URLSearchParams({ title: title + " (" + variant + ")" });
    const defaultFile = ["index.html", "index.tsx", "index.ts", "index.jsx", "index.js", "README.mdx", "README.md"].find((f) => files.includes(f));
    if (!files.includes("package.json")) {
      params.set("view", "editor");
      if (defaultFile) params.set("file", defaultFile);
    }
    for (const [k, v] of Object.entries(overrides?.[variant] || {})) params.set(k, v);
    out[variant] = {
      stackblitz: `https://stackblitz.com/github/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/tree/${tree}/${path}?${params}`,
      codesandbox: `https://codesandbox.io/s/github/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/tree/${tree}/${path}`,
      github: `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/tree/${tree}/${path}`,
    };
  }
  return out;
}
