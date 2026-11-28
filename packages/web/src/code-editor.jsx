// The Playground editor: CodeMirror 6 with line numbers, bracket matching,
// search, undo/redo and optional soft wrap. This module is loaded on demand
// (React.lazy), and each language loads on demand through
// @codemirror/language-data, so the first page load carries neither.
// Escape then Tab moves focus out of the editor (CodeMirror's tab focus mode).
import React, { useEffect, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { LanguageDescription, bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { tagHighlighter, tags as t } from "@lezer/highlight";
import { languages } from "@codemirror/language-data";
import { plainTextReason } from "./ux/code-limits.js";

// Token classes; their colours live in styles.css for each theme and use the
// same palette as the read-only views.
const highlighter = tagHighlighter([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], class: "tok-keyword" },
  { tag: [t.string, t.special(t.string), t.regexp, t.escape, t.character], class: "tok-string" },
  { tag: [t.number, t.bool, t.null, t.atom, t.literal, t.unit], class: "tok-number" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: "tok-comment" },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], class: "tok-type" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName)), t.macroName], class: "tok-function" },
  { tag: [t.propertyName, t.attributeName, t.labelName], class: "tok-property" },
  { tag: [t.meta, t.annotation, t.processingInstruction], class: "tok-meta" },
  { tag: t.heading, class: "tok-heading" },
  { tag: [t.link, t.url], class: "tok-link" },
  { tag: t.emphasis, class: "tok-emphasis" },
  { tag: t.strong, class: "tok-strong" },
  { tag: t.inserted, class: "tok-inserted" },
  { tag: t.deleted, class: "tok-deleted" },
  { tag: t.invalid, class: "tok-invalid" },
]);

const theme = EditorView.theme({
  "&": { backgroundColor: "var(--wall)", color: "var(--ink)", fontSize: "var(--editor-size, 12px)" },
  ".cm-scroller": { fontFamily: "var(--editor-font, ui-monospace, Menlo, monospace)", lineHeight: "1.8" },
  ".cm-content": { caretColor: "var(--ink)" },
  "&.cm-focused": { outline: "3px solid var(--focus)", outlineOffset: "-3px" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--ink)" },
  ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--selection, rgba(56, 139, 253, 0.35))",
  },
  ".cm-gutters": { backgroundColor: "var(--wall)", color: "var(--soft)", borderRight: "1px solid var(--line)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--ink)" },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "transparent", outline: "1px solid var(--accent)" },
  "&.cm-focused .cm-nonmatchingBracket": { backgroundColor: "transparent", outline: "1px dashed var(--danger, #f85149)" },
  ".cm-searchMatch": { backgroundColor: "transparent", outline: "1px solid var(--accent)" },
  ".cm-searchMatch.cm-searchMatch-selected": { outline: "2px solid var(--accent)" },
  ".cm-selectionMatch": { backgroundColor: "transparent", textDecoration: "underline dotted var(--soft)" },
  ".cm-panels": { backgroundColor: "var(--panel)", color: "var(--ink)" },
  ".cm-panels-top": { borderBottom: "1px solid var(--line)" },
  ".cm-panels-bottom": { borderTop: "1px solid var(--line)" },
  ".cm-textfield": { backgroundColor: "var(--wall)", color: "var(--ink)", border: "1px solid var(--line)" },
  ".cm-button": { backgroundImage: "none", backgroundColor: "var(--panel)", color: "var(--ink)", border: "1px solid var(--line)" },
  ".cm-panel.cm-search label": { color: "var(--ink)" },
  ".cm-panel.cm-search [name=close]": { color: "var(--ink)" },
});

/** The CodeMirror language for a file name, or null. */
export function languageFor(name) {
  return LanguageDescription.matchFilename(languages, String(name ?? "").split("/").pop() || "") ?? null;
}

export default function CodeEditor({ value, onChange, fileName, disabled, softWrap, dark, label, viewRef }) {
  const host = useRef(null);
  const view = useRef(null);
  const change = useRef(onChange);
  change.current = onChange;
  const support = useRef([]);
  const parts = useRef(null);
  parts.current ??= { lang: new Compartment(), wrap: new Compartment(), edit: new Compartment(), dark: new Compartment() };
  const config = () => {
    const c = parts.current;
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      highlightSelectionMatches(),
      search({ top: true }),
      syntaxHighlighting(highlighter),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      theme,
      EditorView.contentAttributes.of({ "aria-label": label }),
      replaceSelectionOnInput,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) change.current?.(u.state.doc.toString());
      }),
      c.lang.of(support.current),
      c.wrap.of(softWrap ? EditorView.lineWrapping : []),
      c.edit.of(editable(disabled)),
      c.dark.of(EditorView.darkTheme.of(Boolean(dark))),
    ];
  };
  useEffect(() => {
    const v = new EditorView({ state: EditorState.create({ doc: value ?? "", extensions: config() }), parent: host.current });
    view.current = v;
    if (viewRef) viewRef.current = v;
    // Like a textarea, the editor element (role textbox) reports its whole
    // text as a read-only `value`, for tests and tools; its rendered lines
    // cover only the visible part of a long file.
    Object.defineProperty(v.contentDOM, "value", { get: () => v.state.doc.toString(), configurable: true });
    return () => {
      v.destroy();
      view.current = null;
      if (viewRef) viewRef.current = null;
    };
  }, []);
  // A new file or text from outside (load, reset, migrate) starts a fresh
  // document with its own undo history; the editor's own edits never do.
  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === (value ?? "")) return;
    v.setState(EditorState.create({ doc: value ?? "", extensions: config() }));
  }, [value, fileName]);
  useEffect(() => {
    view.current?.dispatch({ effects: parts.current.edit.reconfigure(editable(disabled)) });
  }, [disabled]);
  useEffect(() => {
    view.current?.dispatch({ effects: parts.current.wrap.reconfigure(softWrap ? EditorView.lineWrapping : []) });
  }, [softWrap]);
  useEffect(() => {
    view.current?.dispatch({ effects: parts.current.dark.reconfigure(EditorView.darkTheme.of(Boolean(dark))) });
  }, [dark]);
  // Language support loads when a file opens; large files stay plain text.
  const plain = plainTextReason(value);
  useEffect(() => {
    let cancelled = false;
    const use = (next) => {
      support.current = next;
      view.current?.dispatch({ effects: parts.current.lang.reconfigure(next) });
    };
    const description = plain ? null : languageFor(fileName);
    if (!description) {
      use([]);
      return;
    }
    description
      .load()
      .then((loaded) => {
        if (!cancelled) use(loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fileName, Boolean(plain)]);
  return (
    <>
      {plain && (
        <p className="code-note" role="status">
          {plain}
        </p>
      )}
      <div className="code code-editor" ref={host} data-language={plain ? "plain" : languageFor(fileName)?.name ?? "plain"} />
    </>
  );
}

// Text typed or inserted over a selection that spans lines replaces exactly
// that range. Left to the browser, deleting such a range can keep an empty
// last line, which would then stay in the document.
const replaceSelectionOnInput = EditorView.domEventHandlers({
  beforeinput(event, view) {
    if (event.inputType !== "insertText" || typeof event.data !== "string" || view.state.readOnly) return false;
    const range = event.getTargetRanges?.()[0];
    if (!range || range.collapsed) return false;
    let from, to;
    try {
      from = view.posAtDOM(range.startContainer, range.startOffset);
      to = view.posAtDOM(range.endContainer, range.endOffset);
    } catch {
      return false;
    }
    if (from === to || view.state.doc.lineAt(from).number === view.state.doc.lineAt(to).number) return false;
    event.preventDefault();
    view.dispatch({ changes: { from, to, insert: event.data }, selection: { anchor: from + event.data.length }, scrollIntoView: true, userEvent: "input.type" });
    return true;
  },
});

function editable(disabled) {
  return [EditorView.editable.of(!disabled), EditorState.readOnly.of(Boolean(disabled)), EditorView.contentAttributes.of(disabled ? { "aria-disabled": "true" } : {})];
}
