// Stage 4 UI (G1, G2): command palette, keyboard shortcuts dialog and the
// focus trap shared by every modal dialog. This module has no API client:
// commands are callbacks supplied by main.jsx, the same functions the buttons
// call, so they keep every confirmation the buttons have (ux.test.mjs checks
// that no fetch appears here).
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { search, highlightParts, parseQuery } from "./ux/fuzzy.js";
import { COMMANDS, FIXED_SHORTCUTS, formatBinding } from "./ux/shortcuts.js";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
export const isMac = () => /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || "");

/**
 * Keep Tab/Shift+Tab inside `ref` while active, focus `initial` (or the first
 * focusable element) on open, and give focus back to the opener on close.
 */
export function useFocusTrap(ref, active, initial) {
  useLayoutEffect(() => {
    if (!active) return;
    const opener = document.activeElement;
    const node = ref.current;
    const first = () => (initial?.current || node?.querySelector(FOCUSABLE))?.focus();
    first();
    const onKey = (event) => {
      if (event.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const index = items.indexOf(document.activeElement);
      const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : index === items.length - 1 ? 0 : index + 1;
      event.preventDefault();
      items[next].focus();
    };
    const keepInside = (event) => {
      if (node && !node.contains(event.target)) first();
    };
    node?.addEventListener("keydown", onKey);
    document.addEventListener("focusin", keepInside);
    return () => {
      node?.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", keepInside);
      if (opener && opener.isConnected && typeof opener.focus === "function") opener.focus();
    };
  }, [active]);
}

export function Keys({ binding }) {
  const parts = formatBinding(binding, isMac());
  return (
    <span className="shortcut-keys" aria-label={parts.join(" ")}>
      {parts.map((p, i) => (p === "then" ? <span key={i} className="then">then</span> : <kbd key={i}>{p}</kbd>))}
    </span>
  );
}

function Highlighted({ text, ranges }) {
  return highlightParts(text, ranges).map((part, i) => (part.match ? <mark key={i}>{part.text}</mark> : <React.Fragment key={i}>{part.text}</React.Fragment>));
}

// ARIA id references are space-separated lists: ids must have no spaces.
export const slug = (text) => "sg-" + String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const KIND_LABEL = { command: "Command", lesson: "Lesson", file: "File", review: "Review" };

/**
 * items: [{ key, kind: "command"|"lesson"|"file", label, detail?, keywords?,
 * disabled?: string (the reason), binding?, run() }]
 */
export function CommandPalette({ items, onClose }) {
  const [raw, setRaw] = useState("");
  const [active, setActive] = useState(0);
  const dialog = useRef(null);
  const input = useRef(null);
  const list = useRef(null);
  const ids = useId();
  useFocusTrap(dialog, true, input);
  const { kind, query } = parseQuery(raw);
  const results = useMemo(() => search(query, kind ? items.filter((i) => i.kind === kind) : items, 50), [items, kind, query]);
  useEffect(() => setActive(0), [raw]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [active, results]);
  const optionId = (i) => ids + "-option-" + i;
  function runAt(index) {
    const result = results[index];
    if (!result || result.item.disabled) return;
    onClose();
    // After the dialog has closed and focus is back on the opener, so that a
    // confirmation the command opens gets focus and the opener gets it back.
    setTimeout(() => result.item.run(), 0);
  }
  function onKeyDown(event) {
    const last = results.length - 1;
    const moves = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: last, PageDown: active + 8, PageUp: active - 8 };
    // Home/End move the caret while there is text to edit.
    if ((event.key === "Home" || event.key === "End") && raw) return;
    if (event.key in moves) {
      event.preventDefault();
      setActive(Math.max(0, Math.min(last, moves[event.key])));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runAt(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }
  return (
    <div className="dialog-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} className="dialog palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown}>
        <input
          ref={input}
          className="palette-input"
          role="combobox"
          aria-expanded="true"
          aria-controls={ids + "-list"}
          aria-autocomplete="list"
          aria-activedescendant={results.length ? optionId(active) : undefined}
          aria-label="Search commands, lessons and files"
          aria-describedby={ids + "-hint"}
          placeholder="Search commands, lessons and files…"
          autoComplete="off"
          spellCheck="false"
          maxLength={200}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
        <p id={ids + "-hint"} className="palette-hint">
          Type to search. <kbd>&gt;</kbd> commands · <kbd>#</kbd> lessons · <kbd>@</kbd> files · <kbd>↑</kbd>
          <kbd>↓</kbd> move · <kbd>Enter</kbd> run · <kbd>Esc</kbd> close
        </p>
        <ul ref={list} id={ids + "-list"} className="palette-list" role="listbox" aria-label="Results">
          {results.map(({ item, ranges }, i) => (
            <li
              key={item.key}
              id={optionId(i)}
              role="option"
              className="palette-option"
              aria-selected={i === active}
              aria-disabled={item.disabled ? "true" : undefined}
              data-kind={item.kind}
              onMouseMove={() => setActive(i)}
              onClick={() => runAt(i)}
            >
              <span className="label">
                <Highlighted text={item.label} ranges={ranges} />
              </span>
              <span className="detail">
                {KIND_LABEL[item.kind]}
                {item.detail ? " · " + item.detail : ""}
                {item.disabled ? " · Unavailable: " + item.disabled : ""}
              </span>
              {item.binding && <Keys binding={item.binding} />}
            </li>
          ))}
        </ul>
        {!results.length && <p className="palette-empty">No results for “{query}”.</p>}
        <p className="visually-hidden" aria-live="polite">
          {results.length} {results.length === 1 ? "result" : "results"}
        </p>
      </div>
    </div>
  );
}

export function ShortcutsDialog({ bindings, onClose }) {
  const dialog = useRef(null);
  const close = useRef(null);
  useFocusTrap(dialog, true, close);
  const groups = new Map();
  for (const command of COMMANDS) {
    const list = bindings[command.id] || [];
    if (!list.length) continue;
    if (!groups.has(command.group)) groups.set(command.group, []);
    groups.get(command.group).push([command, list]);
  }
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="dialog shortcuts"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="page-head">
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button ref={close} className="close-dialog" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted">
          Letter shortcuts work when focus is not in a text field. Every command is also in the palette, and you can change these keys in Preferences.
        </p>
        <div className="shortcut-groups">
          {[...groups].map(([group, entries]) => (
            <section key={group} aria-labelledby={slug(group)}>
              <h3 id={slug(group)}>{group}</h3>
              <dl>
                {entries.map(([command, list]) => (
                  <React.Fragment key={command.id}>
                    <dt>
                      {list.map((b, i) => (
                        <React.Fragment key={b}>
                          {i > 0 && " or "}
                          <Keys binding={b} />
                        </React.Fragment>
                      ))}
                    </dt>
                    <dd>{command.label}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </section>
          ))}
          {FIXED_SHORTCUTS.map((group) => (
            <section key={group.group} aria-labelledby={slug(group.group)}>
              <h3 id={slug(group.group)}>{group.group}</h3>
              <dl>
                {group.items.map(([keys, text]) => (
                  <React.Fragment key={keys + text}>
                    <dt>
                      <kbd>{keys}</kbd>
                    </dt>
                    <dd>{text}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
