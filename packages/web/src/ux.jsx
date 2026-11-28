// UI: preferences (stored through /api/preferences with a
// validated localStorage mirror), theme, keyboard shortcuts, scroll
// restoration, connection status, the exercise warning banner and per-panel
// error boundaries. Course-supplied strings are rendered as React text only.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_UI, EDITOR_FONTS, MOTION, THEMES, UI_SCALES, safePreferences, validatePreferences } from "./ux/preferences.js";
import { COMMANDS, checkBinding, createMatcher, eventToBinding, normalizeBinding, resolveBindings } from "./ux/shortcuts.js";
import { Keys } from "./palette.jsx";

const STORAGE_KEY = "icode:preferences";
async function request(path, options) {
  const response = await fetch("/api" + path, { ...options, headers: { "content-type": "application/json", ...options?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error ?? "Request failed"), { status: response.status });
  return data;
}
function readMirror() {
  try {
    return safePreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
  } catch {
    return safePreferences({});
  }
}
function writeMirror(ui) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ui));
  } catch {
    // Storage full or disabled: the API copy still applies.
  }
}

// ---------- preferences ----------
export function usePreferences() {
  const [ui, setUi] = useState(readMirror);
  const [savePlaygrounds, setSavePlaygrounds] = useState(null);
  const [status, setStatus] = useState("saved"); // saved | pending | retrying | error
  const [error, setError] = useState("");
  const pending = useRef({});
  const timer = useRef(null);
  const attempt = useRef(0);
  useEffect(() => {
    request("/preferences")
      .then((data) => {
        const server = safePreferences(data.ui);
        // Local changes not yet saved win over the server copy.
        const merged = { ...server, ...pending.current.ui };
        setUi(merged);
        writeMirror(merged);
        setSavePlaygrounds(data.savePlaygrounds);
      })
      .catch(() => {});
    return () => clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    // Best effort: save a pending change before the tab goes away.
    const hidden = () => document.visibilityState === "hidden" && Object.keys(pending.current).length && flush();
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  });
  const flush = useCallback(async () => {
    const body = pending.current;
    if (!Object.keys(body).length) return;
    pending.current = {};
    try {
      const data = await request("/preferences", { method: "PUT", body: JSON.stringify(body) });
      attempt.current = 0;
      setSavePlaygrounds(data.savePlaygrounds);
      setStatus(Object.keys(pending.current).length ? "pending" : "saved");
      setError("");
    } catch (e) {
      // Keep the change; newer edits of the same keys win.
      const merged = { ...body, ...pending.current };
      if (body.ui || pending.current.ui) merged.ui = { ...body.ui, ...pending.current.ui };
      pending.current = merged;
      if (e.status === 400) {
        pending.current = {};
        setStatus("error");
        setError(e.message);
        return;
      }
      // 409 (another operation holds the mutation gate) or offline: retry.
      setStatus("retrying");
      const delay = Math.min(30000, 1000 * 2 ** attempt.current++);
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    }
  }, []);
  const update = useCallback(
    (changes) => {
      let valid;
      try {
        valid = validatePreferences(changes, { partial: true });
      } catch (e) {
        setStatus("error");
        setError(e.message);
        return false;
      }
      setUi((previous) => {
        const next = { ...previous, ...valid };
        writeMirror(next);
        return next;
      });
      pending.current = { ...pending.current, ui: { ...pending.current.ui, ...valid } };
      setStatus("pending");
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 250);
      return true;
    },
    [flush],
  );
  const updateSavePlaygrounds = useCallback(
    (value) => {
      setSavePlaygrounds(value);
      pending.current = { ...pending.current, savePlaygrounds: value };
      setStatus("pending");
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 0);
    },
    [flush],
  );
  return { ui, update, status, error, savePlaygrounds, setSavePlaygrounds: updateSavePlaygrounds };
}

// ---------- theme ----------
const FONTS = {
  "system-mono": 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  menlo: "Menlo, Monaco, ui-monospace, monospace",
  consolas: 'Consolas, "Cascadia Mono", ui-monospace, monospace',
  courier: '"Courier New", Courier, monospace',
  ui: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};
function useMedia(query) {
  const get = () => Boolean(window.matchMedia?.(query).matches);
  const [value, setValue] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setValue(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return value;
}
export function useTheme(ui) {
  const dark = useMedia("(prefers-color-scheme: dark)");
  const more = useMedia("(prefers-contrast: more)");
  const resolved = ui.theme === "system" ? (more ? "high-contrast" : dark ? "dark" : "light") : ui.theme;
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
    document.documentElement.style.colorScheme = resolved === "light" ? "light" : "dark";
  }, [resolved]);
  const className =
    "app" +
    (resolved === "light" ? " theme-light" : resolved === "high-contrast" ? " dark theme-hc" : " dark theme-dark") +
    (ui.motion === "reduce" ? " motion-reduce" : ui.motion === "allow" ? " motion-allow" : "");
  // Numbers and enum lookups only: never raw CSS from storage.
  const style = {
    "--ui-zoom": String(UI_SCALES.includes(ui.uiScale) ? ui.uiScale / 100 : 1),
    "--editor-font": FONTS[ui.editorFont] || FONTS["system-mono"],
    "--editor-size": (Number.isInteger(ui.editorFontSize) ? ui.editorFontSize : 12) + "px",
  };
  return { resolved, className, style };
}
export const THEME_LABELS = { system: "System", light: "Light", dark: "Dark", "high-contrast": "High contrast" };
export const nextTheme = (theme) => THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];

// ---------- shortcuts ----------
const typingTarget = (el) =>
  Boolean(el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable));
/**
 * Global shortcuts. `run(id)` returns false when the command did not apply.
 * Registered in the capture phase so that a completed sequence ("g n") does
 * not also reach the diff view's single-key handler.
 */
export function useShortcuts(bindings, run, { diffActive = false } = {}) {
  const matcher = useMemo(() => createMatcher(bindings), [bindings]);
  const latest = useRef({});
  latest.current = { run, diffActive };
  useEffect(() => {
    const onKey = (event) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.target?.closest?.("[data-shortcut-recorder]")) return matcher.reset();
      // Any open modal dialog owns the keyboard (palette, confirmations…).
      if (document.querySelector('[aria-modal="true"]')) return matcher.reset();
      // In the Diff tab, "?" is the diff's own help.
      if (latest.current.diffActive && event.key === "?" && !event.ctrlKey && !event.metaKey) return matcher.reset();
      const typing = typingTarget(event.target);
      const id = matcher.handle(event, { typing });
      if (id && latest.current.run(id) !== false) {
        event.preventDefault();
        event.stopPropagation();
      } else if (matcher.pending().length) event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [matcher]);
}

// ---------- scroll restoration ----------
const SCROLL_KEY = "icode:scroll";
function readScroll() {
  try {
    const v = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
export function useScrollRestore(key, enabled) {
  const current = useRef(null);
  useEffect(() => {
    if (!key) return;
    // A new view starts at the top unless a position is restored.
    if (!enabled) return void window.scrollTo(0, 0);
    current.current = key;
    const positions = readScroll();
    const y = Number(positions[key]);
    // A heading fragment or deep link wins over the stored position.
    if (Number.isFinite(y) && y > 0 && !location.hash) {
      let frames = 0;
      const restore = () => {
        window.scrollTo(0, y);
        if (Math.abs(window.scrollY - y) > 2 && frames++ < 20) requestAnimationFrame(restore);
      };
      requestAnimationFrame(restore);
    } else window.scrollTo(0, 0);
    let timer;
    const save = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const all = readScroll();
        delete all[key];
        all[key] = Math.round(window.scrollY);
        const keys = Object.keys(all);
        for (const old of keys.slice(0, Math.max(0, keys.length - 200))) delete all[old];
        try {
          sessionStorage.setItem(SCROLL_KEY, JSON.stringify(all));
        } catch {}
      }, 120);
    };
    window.addEventListener("scroll", save, { passive: true });
    return () => {
      window.removeEventListener("scroll", save);
      clearTimeout(timer);
    };
  }, [key, enabled]);
}

// ---------- connection status ----------
export function useConnection() {
  const [state, setState] = useState(navigator.onLine === false ? "offline" : "online"); // online | offline | down | checking
  const [nextCheck, setNextCheck] = useState(null);
  const failures = useRef(0);
  const timer = useRef(null);
  const check = useCallback(async () => {
    clearTimeout(timer.current);
    if (navigator.onLine === false) {
      // A loopback server can still be reachable offline; try anyway.
    }
    let ok = false;
    try {
      const controller = new AbortController();
      const abort = setTimeout(() => controller.abort(), 4000);
      const response = await fetch("/api/health", { cache: "no-store", signal: controller.signal });
      clearTimeout(abort);
      ok = response.ok;
    } catch {
      ok = false;
    }
    failures.current = ok ? 0 : failures.current + 1;
    setState(ok ? (navigator.onLine === false ? "offline" : "online") : "down");
    const delay = ok ? 15000 : Math.min(60000, 2000 * 2 ** Math.min(failures.current - 1, 5));
    setNextCheck(Date.now() + delay);
    timer.current = setTimeout(check, delay);
  }, []);
  useEffect(() => {
    check();
    const online = () => check();
    const offline = () => setState((s) => (s === "down" ? s : "offline"));
    const visible = () => document.visibilityState === "visible" && check();
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [check]);
  return { state, nextCheck, retry: check };
}
const CONNECTION_TEXT = { online: "Connected", offline: "Offline (browser); workshop server reachable", down: "Workshop server not reachable", checking: "Checking connection" };
export function ConnectionStatus({ state }) {
  return (
    <span className="connection-status" data-state={state} aria-live="polite">
      <span className="dot" aria-hidden="true" />
      {CONNECTION_TEXT[state]}
    </span>
  );
}
export function ConnectionBanner({ connection }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (connection.state !== "down") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [connection.state]);
  if (connection.state !== "down") return null;
  const seconds = connection.nextCheck ? Math.max(0, Math.round((connection.nextCheck - now) / 1000)) : null;
  // Announced once per state change by the polite status in the top bar; the
  // banner itself is not a live region, and the countdown is aria-live="off"
  // so the per-second updates are never read out.
  return (
    <section className="connection-banner" role="region" aria-labelledby="connection-title">
      <strong id="connection-title">The workshop server is not reachable.</strong>
      <p>
        Unsaved edits stay in this page. Saving, tests and previews need the server: start it again with <code>workshop start</code> if it stopped.
      </p>
      {seconds !== null && (
        <p className="countdown" aria-live="off">
          Next automatic check in {seconds} s.
        </p>
      )}
      <div className="actions">
        <button onClick={connection.retry}>Retry now</button>
      </div>
    </section>
  );
}

// ---------- exercise warning banner ----------
export function useWarnings(refreshKey) {
  const [warnings, setWarnings] = useState([]);
  useEffect(() => {
    let stopped = false;
    const load = () =>
      request("/warnings")
        .then((d) => !stopped && setWarnings(Array.isArray(d.warnings) ? d.warnings : []))
        .catch(() => {});
    load();
    const t = setInterval(load, 20000);
    const visible = () => document.visibilityState === "visible" && load();
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      clearInterval(t);
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refreshKey]);
  return warnings;
}
export function WarningBanner({ warnings, dismissed, onDismissForever }) {
  const [hidden, setHidden] = useState(() => new Set());
  const visible = warnings.filter((w) => !dismissed.includes(w.id) && !hidden.has(w.id + "\n" + w.key));
  if (!visible.length) return null;
  return visible.map((w) => (
    <section key={w.id} className="warning-banner" role="region" aria-labelledby={"warning-" + w.id}>
      <strong id={"warning-" + w.id}>Warning: {String(w.title || "")}</strong>
      <p>{String(w.message || "")}</p>
      {Array.isArray(w.paths) && (
        <ul aria-label="Changed files">
          {w.paths.slice(0, 5).map((p) => (
            <li key={p}>{String(p)}</li>
          ))}
          {w.more > 0 && <li>and {Number(w.more)} more</li>}
        </ul>
      )}
      <div className="actions">
        <button onClick={() => setHidden((h) => new Set(h).add(w.id + "\n" + w.key))}>Dismiss</button>
        <button onClick={() => onDismissForever(w.id)}>Don’t warn me again</button>
      </div>
    </section>
  ));
}

// ---------- error boundaries ----------
export class PanelBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidUpdate(previous) {
    // A new step or page gets a fresh render, not the old error.
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  componentDidCatch(error) {
    console.error("Panel failed:", this.props.name, error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="panel-error" role="alert" aria-label={this.props.name + " failed"}>
        <strong>The {this.props.name} failed to render.</strong>
        <pre>{String(this.state.error?.message || this.state.error).slice(0, 2000)}</pre>
        <button onClick={() => this.setState({ error: null })}>Try again</button>
      </section>
    );
  }
}

// ---------- preferences page ----------
const STATUS_TEXT = { saved: "Saved", pending: "Saving…", retrying: "Will save when the current operation finishes", error: "Not saved" };
function ShortcutRow({ command, overrides, bindings, onChange }) {
  const [recording, setRecording] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const custom = Object.prototype.hasOwnProperty.call(overrides, command.id);
  const apply = (value) => {
    const message = checkBinding(command.id, value, overrides);
    if (message) return setError(message), false;
    setError("");
    onChange(command.id, value === "" ? "" : normalizeBinding(value));
    return true;
  };
  return (
    <tr>
      <td>{command.label}</td>
      <td>
        {bindings[command.id]?.length ? bindings[command.id].map((b) => <Keys key={b} binding={b} />) : <span className="muted">None</span>}
        {custom && <span className="muted"> (custom)</span>}
      </td>
      <td>
        {recording ? (
          <input
            type="text"
            className="recording"
            aria-label={"New shortcut for " + command.label + ". Press keys, Enter to save, Escape to cancel"}
            value={text}
            autoFocus
            readOnly
            data-shortcut-recorder="true"
            onKeyDown={(event) => {
              // Tab leaves the recorder (no keyboard trap); Escape cancels.
              if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) return setRecording(false), setText("");
              event.preventDefault();
              event.stopPropagation();
              if (event.key === "Escape") return setRecording(false), setText(""), setError("");
              if (event.key === "Enter" && text) {
                if (apply(text)) setRecording(false), setText("");
                return;
              }
              if (event.key === "Backspace") return setText((t) => t.split(" ").slice(0, -1).join(" "));
              const b = eventToBinding(event);
              if (!b) return;
              setText((t) => (b.includes("+") || !t || t.includes("+") ? b : t.split(" ").length >= 3 ? t : t + " " + b));
            }}
            onBlur={() => setRecording(false)}
          />
        ) : (
          <button onClick={() => (setRecording(true), setText(""), setError(""))} aria-label={"Change shortcut for " + command.label}>
            Change
          </button>
        )}{" "}
        <button onClick={() => apply("")} aria-label={"Remove shortcut for " + command.label} disabled={!bindings[command.id]?.length}>
          Remove
        </button>{" "}
        {custom && (
          <button onClick={() => (setError(""), onChange(command.id, undefined))} aria-label={"Restore default shortcut for " + command.label}>
            Default
          </button>
        )}
        {error && (
          <span className="error" role="alert">
            {" "}
            {error}
          </span>
        )}
      </td>
    </tr>
  );
}
export function PreferencesPage({ prefs, resolvedTheme, onClose }) {
  const { ui, update, status, error, savePlaygrounds, setSavePlaygrounds } = prefs;
  const overrides = ui.shortcuts || {};
  const bindings = useMemo(() => resolveBindings(overrides), [overrides]);
  const setShortcut = (id, value) => {
    const next = { ...overrides };
    if (value === undefined) delete next[id];
    else next[id] = value;
    update({ shortcuts: next });
  };
  const heading = useRef(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section className="course-page prefs" aria-labelledby="prefs-title">
      <div className="page-head">
        <h1 id="prefs-title" ref={heading} tabIndex={-1}>
          Preferences
        </h1>
        {onClose && <button onClick={onClose}>Back to the lesson</button>}
      </div>
      <p className="pref-status" aria-live="polite">
        {STATUS_TEXT[status]}
        {error && ": " + error}. Stored in this course’s <code>.workshop/preferences.json</code> and in this browser.
      </p>
      <fieldset>
        <legend>Theme</legend>
        {THEMES.map((t) => (
          <label key={t}>
            <input type="radio" name="theme" value={t} checked={ui.theme === t} onChange={() => update({ theme: t })} />
            {THEME_LABELS[t]}
          </label>
        ))}
        <p className="muted">Now showing: {THEME_LABELS[resolvedTheme]}. System follows your operating system’s light, dark and contrast settings.</p>
      </fieldset>
      <fieldset>
        <legend>Text and editor</legend>
        <label>
          Interface size
          <select aria-label="Interface size" value={ui.uiScale} onChange={(e) => update({ uiScale: Number(e.target.value) })}>
            {UI_SCALES.map((s) => (
              <option key={s} value={s}>
                {s}%
              </option>
            ))}
          </select>
        </label>
        <label>
          Editor font
          <select aria-label="Editor font" value={ui.editorFont} onChange={(e) => update({ editorFont: e.target.value })}>
            {EDITOR_FONTS.map((f) => (
              <option key={f} value={f}>
                {{ "system-mono": "System monospace", menlo: "Menlo / Monaco", consolas: "Consolas / Cascadia", courier: "Courier New", ui: "Interface font" }[f]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Editor font size
          <select aria-label="Editor font size" value={ui.editorFontSize} onChange={(e) => update({ editorFontSize: Number(e.target.value) })}>
            {Array.from({ length: 14 }, (_, i) => i + 11).map((n) => (
              <option key={n} value={n}>
                {n} px
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={ui.softWrap} onChange={(e) => update({ softWrap: e.target.checked })} />
          Wrap long lines in the Playground editor
        </label>
      </fieldset>
      <fieldset>
        <legend>Motion and scrolling</legend>
        {MOTION.map((m) => (
          <label key={m}>
            <input type="radio" name="motion" value={m} checked={ui.motion === m} onChange={() => update({ motion: m })} />
            {{ system: "Follow the system", reduce: "Reduce motion", allow: "Allow animations" }[m]}
          </label>
        ))}
        <label>
          <input type="checkbox" checked={ui.restoreScroll} onChange={(e) => update({ restoreScroll: e.target.checked })} />
          Restore scroll positions when returning to a lesson
        </label>
      </fieldset>
      <fieldset>
        <legend>Playgrounds and warnings</legend>
        <label>
          <input type="checkbox" checked={savePlaygrounds !== false} disabled={savePlaygrounds === null} onChange={(e) => setSavePlaygrounds(e.target.checked)} />
          Save the playground automatically before it is replaced
        </label>
        <label>
          <input
            type="checkbox"
            checked={!ui.dismissedWarnings.includes("exercises-changed")}
            onChange={(e) =>
              update({ dismissedWarnings: e.target.checked ? ui.dismissedWarnings.filter((w) => w !== "exercises-changed") : [...ui.dismissedWarnings, "exercises-changed"] })
            }
          />
          Warn when files in the course’s exercises folder change
        </label>
      </fieldset>
      <fieldset>
        <legend>Keyboard shortcuts</legend>
        <p className="muted">
          Use mod (Ctrl, or ⌘ on a Mac), Ctrl or Alt with one key, or up to three letter keys in a row (for example <kbd>g</kbd> then <kbd>n</kbd>).
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">Command</th>
              <th scope="col">Shortcut</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {COMMANDS.map((command) => (
              <ShortcutRow key={command.id} command={command} overrides={overrides} bindings={bindings} onChange={setShortcut} />
            ))}
          </tbody>
        </table>
        <p>
          <button onClick={() => update({ shortcuts: {} })} disabled={!Object.keys(overrides).length}>
            Restore all default shortcuts
          </button>
        </p>
      </fieldset>
      <p>
        <button onClick={() => update({ ...DEFAULT_UI, shortcuts: {}, dismissedWarnings: [] })}>Reset all preferences</button>
      </p>
    </section>
  );
}
