// Export apps (Epic appType "export"): show console output and the entry
// module's named exports. Runs on the sandbox origin; renders text only.
const main = document.querySelector("main");
const list = document.getElementById("console");
const exportsBox = document.getElementById("exports");
const MAX_ENTRIES = 500;
function inspect(value, depth = 0, seen = new WeakSet()) {
  const pad = "  ".repeat(depth);
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  const type = typeof value;
  if (type === "string") return depth ? JSON.stringify(value) : value;
  if (type === "number" || type === "boolean" || type === "bigint") return String(value) + (type === "bigint" ? "n" : "");
  if (type === "symbol") return value.toString();
  if (type === "function") return "[Function " + (value.name || "anonymous") + "]";
  if (seen.has(value)) return "[Circular]";
  if (depth > 5) return "[…]";
  seen.add(value);
  if (value instanceof Error) return value.name + ": " + value.message;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return String(value);
  if (typeof Promise !== "undefined" && value instanceof Promise) return "Promise { … }";
  if (typeof Node !== "undefined" && value instanceof Node) return "<" + (value.nodeName || "node").toLowerCase() + ">";
  if (value instanceof Map) return "Map(" + value.size + ") {" + [...value].slice(0, 100).map(([k, v]) => "\n" + pad + "  " + inspect(k, depth + 1, seen) + " => " + inspect(v, depth + 1, seen)).join(",") + "\n" + pad + "}";
  if (value instanceof Set) return "Set(" + value.size + ") {" + [...value].slice(0, 100).map((v) => "\n" + pad + "  " + inspect(v, depth + 1, seen)).join(",") + "\n" + pad + "}";
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return "[" + value.slice(0, 100).map((v) => "\n" + pad + "  " + inspect(v, depth + 1, seen)).join(",") + (value.length > 100 ? ",\n" + pad + "  …" : "") + "\n" + pad + "]";
  }
  const keys = Object.keys(value).slice(0, 100);
  if (!keys.length) return "{}";
  return "{" + keys.map((k) => "\n" + pad + "  " + (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)) + ": " + inspect(value[k], depth + 1, seen)).join(",") + "\n" + pad + "}";
}
let count = 0;
for (const level of ["log", "info", "warn", "error", "debug"]) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    original(...args);
    if (count++ >= MAX_ENTRIES) return;
    const li = document.createElement("li");
    li.className = level;
    li.textContent = (level === "log" ? "" : level + ": ") + args.map((a) => inspect(a)).join(" ");
    list.append(li);
  };
}
addEventListener("error", (e) => console.error(e.message));
addEventListener("unhandledrejection", (e) => console.error("Unhandled rejection: " + inspect(e.reason)));
try {
  const mod = await import(main.dataset.entry);
  exportsBox.textContent = "";
  const names = Object.keys(mod);
  if (!names.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "This module has no exports.";
    exportsBox.append(p);
  }
  for (const name of names) {
    let value = mod[name];
    if (value instanceof Promise) value = await value.catch((e) => e);
    const box = document.createElement("div");
    box.className = "export";
    const label = document.createElement("strong");
    label.textContent = name === "default" ? "default" : name;
    const pre = document.createElement("pre");
    pre.textContent = inspect(value);
    box.append(label, pre);
    exportsBox.append(box);
  }
} catch (error) {
  exportsBox.textContent = "Could not load the module: " + (error?.message ?? error);
}
