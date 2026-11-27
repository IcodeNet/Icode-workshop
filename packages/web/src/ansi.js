// Minimal ANSI SGR → HTML conversion for process output. Text is HTML-escaped
// before any markup is added; only <span class="…"> / inline colour styles
// generated here are emitted. Non-SGR escape sequences are removed.
const escapeHtml = (text) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const NAMES = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
];
// xterm 256-colour palette entry → rgb string.
function color256(n) {
  if (n < 16) {
    const base = [
      [0, 0, 0],
      [205, 49, 49],
      [13, 188, 121],
      [229, 229, 16],
      [36, 114, 200],
      [188, 63, 188],
      [17, 168, 205],
      [229, 229, 229],
      [102, 102, 102],
      [241, 76, 76],
      [35, 209, 139],
      [245, 245, 67],
      [59, 142, 234],
      [214, 112, 214],
      [41, 184, 219],
      [255, 255, 255],
    ][n];
    return `rgb(${base.join(",")})`;
  }
  if (n < 232) {
    const v = n - 16,
      c = (x) => (x ? 55 + x * 40 : 0);
    return `rgb(${c(Math.floor(v / 36))},${c(Math.floor(v / 6) % 6)},${c(v % 6)})`;
  }
  const g = 8 + (n - 232) * 10;
  return `rgb(${g},${g},${g})`;
}
const clampByte = (x) => Math.max(0, Math.min(255, Number(x) || 0));

export function ansiToHtml(input) {
  const state = {
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
  };
  let html = "";
  const pattern =
    // eslint-disable-next-line no-control-regex
    /\x1b\[([0-9;]*)m|\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
  const style = () => {
    const classes = [],
      css = [];
    if (state.bold) classes.push("ansi-bold");
    if (state.dim) classes.push("ansi-dim");
    if (state.italic) classes.push("ansi-italic");
    if (state.underline) classes.push("ansi-underline");
    if (typeof state.fg === "string") classes.push("ansi-fg-" + state.fg);
    else if (state.fg) css.push("color:" + state.fg.css);
    if (typeof state.bg === "string") classes.push("ansi-bg-" + state.bg);
    else if (state.bg) css.push("background-color:" + state.bg.css);
    if (!classes.length && !css.length) return "";
    return (
      "<span" +
      (classes.length ? ` class="${classes.join(" ")}"` : "") +
      (css.length ? ` style="${css.join(";")}"` : "") +
      ">"
    );
  };
  const write = (text) => {
    if (!text) return;
    const tag = style();
    html += tag ? tag + escapeHtml(text) + "</span>" : escapeHtml(text);
  };
  let last = 0,
    match;
  while ((match = pattern.exec(input))) {
    write(input.slice(last, match.index));
    last = pattern.lastIndex;
    if (match[1] === undefined) continue;
    const codes = match[1] === "" ? [0] : match[1].split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0)
        Object.assign(state, {
          fg: null,
          bg: null,
          bold: false,
          dim: false,
          italic: false,
          underline: false,
        });
      else if (code === 1) state.bold = true;
      else if (code === 2) state.dim = true;
      else if (code === 3) state.italic = true;
      else if (code === 4) state.underline = true;
      else if (code === 22) state.bold = state.dim = false;
      else if (code === 23) state.italic = false;
      else if (code === 24) state.underline = false;
      else if (code >= 30 && code <= 37) state.fg = NAMES[code - 30];
      else if (code >= 90 && code <= 97)
        state.fg = "bright-" + NAMES[code - 90];
      else if (code >= 40 && code <= 47) state.bg = NAMES[code - 40];
      else if (code >= 100 && code <= 107)
        state.bg = "bright-" + NAMES[code - 100];
      else if (code === 39) state.fg = null;
      else if (code === 49) state.bg = null;
      else if (code === 38 || code === 48) {
        let value = null;
        if (codes[i + 1] === 5 && codes[i + 2] !== undefined) {
          value = { css: color256(clampByte(codes[i + 2])) };
          i += 2;
        } else if (codes[i + 1] === 2 && codes[i + 4] !== undefined) {
          value = {
            css: `rgb(${clampByte(codes[i + 2])},${clampByte(codes[i + 3])},${clampByte(codes[i + 4])})`,
          };
          i += 4;
        }
        if (value) state[code === 38 ? "fg" : "bg"] = value;
      }
    }
  }
  write(input.slice(last));
  return html;
}
export function stripAnsi(input) {
  // eslint-disable-next-line no-control-regex
  return input.replace(
    /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g,
    "",
  );
}
