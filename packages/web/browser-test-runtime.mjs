// In-browser test runtime (Stage 3, C5). Bundled into test pages on the
// sandbox origin as `@icodenet/workshop-test` and Epic's
// `@epic-web/workshop-utils/test`. Results go to the workshop UI origin only.
import * as dtl from "@testing-library/dom";

export { dtl };
export const { waitFor, screen, within, fireEvent } = dtl;

const UI = globalThis.__ICODE_UI_ORIGIN__ || "http://127.0.0.1:5173";
let file = "";
let queue = Promise.resolve();
let counts = { passed: 0, failed: 0 };
function post(message) {
  try {
    if (window.parent !== window) window.parent.postMessage({ type: "icode:test", file, ...message }, UI);
  } catch {}
}
const describe = (error) => String(error?.message ?? error).slice(0, 4000);

export function __start(name) {
  file = name;
  post({ event: "start" });
  addEventListener("error", (e) => post({ event: "error", message: describe(e.error ?? e.message) }));
  addEventListener("unhandledrejection", (e) => post({ event: "error", message: "Unhandled rejection: " + describe(e.reason) }));
}
export async function __done() {
  await queue;
  post({ event: "done", ...counts });
}
export function __fail(error) {
  post({ event: "error", message: describe(error) });
  post({ event: "done", ...counts, failed: counts.failed + 1 });
}

/** Run one titled step; steps run in order. Returns a promise. */
export function testStep(title, fn) {
  const label = typeof title === "function" ? title({ type: "pending" }) : String(title);
  const run = queue.then(async () => {
    const started = performance.now();
    try {
      const value = await fn();
      counts.passed++;
      post({ event: "step", title: String(label).slice(0, 300), status: "pass", durationMs: Math.round(performance.now() - started) });
      return value;
    } catch (error) {
      counts.failed++;
      post({ event: "step", title: String(label).slice(0, 300), status: "fail", error: describe(error), durationMs: Math.round(performance.now() - started) });
      throw error;
    }
  });
  queue = run.catch(() => {});
  return run;
}

// ---------- expect ----------
function fmt(v, depth = 0) {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "function") return "[Function " + (v.name || "anonymous") + "]";
  if (typeof Element !== "undefined" && v instanceof Element) return "<" + v.tagName.toLowerCase() + ">";
  if (v && typeof v === "object" && depth < 3) {
    try {
      return Array.isArray(v) ? "[" + v.map((x) => fmt(x, depth + 1)).join(", ") + "]" : "{" + Object.entries(v).map(([k, x]) => k + ": " + fmt(x, depth + 1)).join(", ") + "}";
    } catch {}
  }
  return String(v);
}
export function equals(a, b, seen = new Map()) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (seen.get(a) === b) return true;
  seen.set(a, b);
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (a instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof RegExp) return String(a) === String(b);
  if (a instanceof Map || a instanceof Set) {
    if (a.size !== b.size) return false;
    const ea = [...a], eb = [...b];
    return ea.every((x, i) => equals(x, eb[i], seen));
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && equals(a[k], b[k], seen));
}
class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = "AssertionError";
  }
}
const isElement = (v) => typeof Element !== "undefined" && v instanceof Element;
const textOf = (v) => (isElement(v) ? v.textContent ?? "" : String(v));
function matchers(actual) {
  return {
    toBe: (e) => [Object.is(actual, e), `expected ${fmt(actual)} to be ${fmt(e)}`, `expected ${fmt(actual)} not to be ${fmt(e)}`],
    toEqual: (e) => [equals(actual, e), `expected ${fmt(actual)} to equal ${fmt(e)}`, `expected ${fmt(actual)} not to equal ${fmt(e)}`],
    toStrictEqual: (e) => [equals(actual, e), `expected ${fmt(actual)} to strictly equal ${fmt(e)}`, `expected ${fmt(actual)} not to strictly equal ${fmt(e)}`],
    toBeTruthy: () => [Boolean(actual), `expected ${fmt(actual)} to be truthy`, `expected ${fmt(actual)} to be falsy`],
    toBeFalsy: () => [!actual, `expected ${fmt(actual)} to be falsy`, `expected ${fmt(actual)} to be truthy`],
    toBeNull: () => [actual === null, `expected ${fmt(actual)} to be null`, `expected value not to be null`],
    toBeUndefined: () => [actual === undefined, `expected ${fmt(actual)} to be undefined`, `expected value to be defined`],
    toBeDefined: () => [actual !== undefined, `expected value to be defined`, `expected ${fmt(actual)} to be undefined`],
    toBeGreaterThan: (e) => [actual > e, `expected ${fmt(actual)} to be greater than ${fmt(e)}`, `expected ${fmt(actual)} not to be greater than ${fmt(e)}`],
    toBeLessThan: (e) => [actual < e, `expected ${fmt(actual)} to be less than ${fmt(e)}`, `expected ${fmt(actual)} not to be less than ${fmt(e)}`],
    toBeInstanceOf: (e) => [actual instanceof e, `expected value to be an instance of ${e?.name}`, `expected value not to be an instance of ${e?.name}`],
    toContain: (e) => [actual != null && (typeof actual === "string" ? actual.includes(e) : [...actual].includes(e)), `expected ${fmt(actual)} to contain ${fmt(e)}`, `expected ${fmt(actual)} not to contain ${fmt(e)}`],
    toHaveLength: (n) => [actual?.length === n, `expected length ${actual?.length} to be ${n}`, `expected length not to be ${n}`],
    toMatch: (e) => [typeof actual === "string" && (e instanceof RegExp ? e.test(actual) : actual.includes(e)), `expected ${fmt(actual)} to match ${String(e)}`, `expected ${fmt(actual)} not to match ${String(e)}`],
    toThrow: (e) => {
      let thrown = null;
      try {
        actual();
      } catch (error) {
        thrown = error ?? new Error("thrown");
      }
      const ok = Boolean(thrown) && (e === undefined || (e instanceof RegExp ? e.test(describe(thrown)) : typeof e === "function" ? thrown instanceof e : describe(thrown).includes(e)));
      return [ok, `expected function to throw${e === undefined ? "" : " " + String(e)}`, `expected function not to throw, but it threw ${describe(thrown)}`];
    },
    toBeInTheDocument: () => [isElement(actual) && actual.ownerDocument.contains(actual), `expected element to be in the document`, `expected element not to be in the document`],
    toBeVisible: () => [isElement(actual) && actual.ownerDocument.contains(actual) && getComputedStyle(actual).visibility !== "hidden" && getComputedStyle(actual).display !== "none", `expected element to be visible`, `expected element not to be visible`],
    toHaveTextContent: (e) => {
      const t = textOf(actual).replace(/\s+/g, " ").trim();
      return [e instanceof RegExp ? e.test(t) : t.includes(String(e)), `expected text ${fmt(t)} to contain ${String(e)}`, `expected text ${fmt(t)} not to contain ${String(e)}`];
    },
    toHaveAttribute: (name, value) => [isElement(actual) && actual.hasAttribute(name) && (value === undefined || actual.getAttribute(name) === String(value)), `expected element to have attribute ${name}${value === undefined ? "" : "=" + fmt(value)}`, `expected element not to have attribute ${name}`],
    toHaveValue: (e) => [isElement(actual) && equals(actual.value, e), `expected value ${fmt(actual?.value)} to be ${fmt(e)}`, `expected value not to be ${fmt(e)}`],
  };
}
function build(actual, negate, mode) {
  const table = matchers(actual);
  const api = {};
  for (const name of Object.keys(table)) {
    api[name] = (...args) => {
      const check = (value) => {
        const [pass, message, negMessage] = matchers(value)[name](...args);
        if (pass === negate) throw new AssertionError(negate ? negMessage : message);
      };
      if (!mode) return check(actual);
      return Promise.resolve(actual).then(
        (v) => {
          if (mode === "rejects") throw new AssertionError("expected promise to reject, it resolved with " + fmt(v));
          check(v);
        },
        (e) => {
          if (mode === "resolves") throw new AssertionError("expected promise to resolve, it rejected with " + describe(e));
          check(e);
        },
      );
    };
  }
  return api;
}
export function expect(actual) {
  const api = build(actual, false);
  api.not = build(actual, true);
  api.resolves = build(actual, false, "resolves");
  api.rejects = build(actual, false, "rejects");
  api.resolves.not = build(actual, true, "resolves");
  api.rejects.not = build(actual, true, "rejects");
  return api;
}
