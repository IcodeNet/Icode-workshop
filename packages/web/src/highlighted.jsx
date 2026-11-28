// Read-only code with syntax highlighting. Tokens come from /api/highlight
// (the bundled Shiki highlighter, its themes and contrast replacements); each
// token is [text, light colour, dark colour, style flags]. Text is rendered
// as text, never as HTML. Tokens are used only when they spell exactly the
// code shown; otherwise the code stays plain.
import React, { useEffect, useState } from "react";

const ITALIC = 1,
  BOLD = 2,
  UNDERLINE = 4;
const cache = new Map();

/** Tokens for `path` on `side` (`01.problem`, `01.playground`, ...). */
export function fetchTokens(side, path) {
  const key = side + "\0" + path;
  if (!cache.has(key)) {
    const pending = fetch("/api/highlight?side=" + encodeURIComponent(side) + "&path=" + encodeURIComponent(path))
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Highlighting failed");
        return data;
      })
      // Shared while in flight only: files change on disk.
      .finally(() => cache.delete(key));
    cache.set(key, pending);
  }
  return cache.get(key);
}

const joined = (lines) => lines.map((line) => line.map((token) => token[0]).join("")).join("\n");

export function Token({ token }) {
  const [text, light, dark, flags] = token;
  if (!light && !dark && !flags) return text;
  const style = {};
  if (light) style["--tl"] = light;
  if (dark) style["--td"] = dark;
  if (flags & ITALIC) style.fontStyle = "italic";
  if (flags & BOLD) style.fontWeight = "bold";
  if (flags & UNDERLINE) style.textDecoration = "underline";
  return (
    <span className="tok" style={style}>
      {text}
    </span>
  );
}

/** One line's tokens; characters in `range` are marked as changed (plain colour). */
export function TokenLine({ tokens, range }) {
  if (!range || range.start >= range.end) return tokens.map((token, i) => <Token key={i} token={token} />);
  const out = [];
  let at = 0;
  tokens.forEach((token, i) => {
    const text = token[0];
    const end = at + text.length;
    const before = text.slice(0, Math.max(0, range.start - at));
    const inside = text.slice(Math.max(0, range.start - at), Math.max(0, range.end - at));
    const after = text.slice(Math.max(0, range.end - at));
    if (before) out.push(<Token key={i + "b"} token={[before, ...token.slice(1)]} />);
    if (inside) out.push(<mark key={i + "m"} className="word-change">{inside}</mark>);
    if (after) out.push(<Token key={i + "a"} token={[after, ...token.slice(1)]} />);
    at = end;
  });
  return out;
}

/** Tokens of line `number` (1-based) when they spell `text`, else null. */
export function lineTokens(lines, number, text) {
  const line = number ? lines?.[number - 1] : null;
  return line && line.map((token) => token[0]).join("") === text ? line : null;
}

/** Token lines matching `code`, or null while loading or when the code stays plain. */
export function useTokens(side, path, code, version) {
  const [state, setState] = useState({ key: "", data: null });
  const key = side && path ? side + "\0" + path : "";
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetchTokens(side, path)
      .then((data) => !cancelled && setState({ key, data }))
      .catch((e) => !cancelled && setState({ key, data: { plain: e.message } }));
    return () => {
      cancelled = true;
    };
  }, [key, code, version]);
  const data = state.key === key ? state.data : null;
  if (!data) return { lines: null, plain: "" };
  if (data.plain) return { lines: null, plain: data.plain };
  if (code !== undefined && joined(data.lines) !== code) return { lines: null, plain: "" };
  return { lines: data.lines, lang: data.lang, plain: "" };
}

export function HighlightedCode({ side, path, code, empty }) {
  const { lines, lang, plain } = useTokens(side, path, code);
  return (
    <>
      {plain && /Large|long lines/.test(plain) && (
        <p className="code-note" role="status">
          {plain}
        </p>
      )}
      <pre className="code highlighted" data-language={lines ? lang : "plain"}>
        {!code
          ? empty
          : lines
            ? lines.map((line, i) => (
                <React.Fragment key={i}>
                  {i > 0 && "\n"}
                  <TokenLine tokens={line} />
                </React.Fragment>
              ))
            : code}
      </pre>
    </>
  );
}
