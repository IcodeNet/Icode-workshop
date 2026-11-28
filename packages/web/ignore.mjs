// gitignore-style patterns, shared by diffs and saved playgrounds.
function globToRegex(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slashAfter = glob[i + 2] === "/";
        out += slashAfter ? "(?:.*/)?" : ".*";
        i += slashAfter ? 2 : 1;
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else if (c === "[") {
      const end = glob.indexOf("]", i + 1);
      if (end > i) {
        out += "[" + glob.slice(i + 1, end).replace(/^!/, "^").replace(/\\/g, "\\\\") + "]";
        i = end;
      } else out += "\\[";
    } else if (c === "\\" && i + 1 < glob.length) out += "\\" + glob[++i];
    else out += c.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  return out;
}
/** Compile gitignore-style patterns into a predicate. Last match wins. Pure. */
export function compileIgnore(patterns) {
  const rules = [];
  for (let raw of patterns) {
    if (typeof raw !== "string") continue;
    let line = raw.replace(/\r$/, "");
    if (!line.trim() || line.startsWith("#")) continue;
    line = line.replace(/(?<!\\)\s+$/, "");
    let negate = false;
    if (line.startsWith("!")) {
      negate = true;
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.replace(/\/+$/, "");
    }
    if (!line) continue;
    const anchored = line.includes("/");
    line = line.replace(/^\//, "");
    const body = globToRegex(line);
    rules.push({
      negate,
      dirOnly,
      regex: new RegExp((anchored ? "^" : "(?:^|/)") + body + "$"),
    });
  }
  return (path, isDir = false) => {
    let ignored = false;
    for (const rule of rules) {
      if (rule.dirOnly && !isDir) continue;
      if (rule.regex.test(path)) ignored = !rule.negate;
    }
    return ignored;
  };
}
