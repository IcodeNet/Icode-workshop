// UI: lesson HTML (sanitised on the server), copy buttons, table of
// contents, sandboxed Mermaid, the in-workshop browser, in-browser tests,
// course pages, notifications and cloud-editor links.
import React, { useEffect, useRef, useState, useCallback } from "react";
import { mountQuestions } from "./questions.jsx";

const json = async (path, options) => {
  const response = await fetch("/api" + path, { ...options, headers: { "content-type": "application/json", ...options?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data;
};

/**
 * Once per engine start, clear the sandbox origin (service workers, caches,
 * storage) by loading its reset page, before any app frame is shown.
 */
function resetSandbox(config) {
  const key = "icode-sandbox-generation";
  if (!config.sandboxOrigin || !config.sandboxGeneration || localStorage.getItem(key) === config.sandboxGeneration) return Promise.resolve(config);
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.title = "Sandbox reset";
    frame.setAttribute("sandbox", "");
    const done = () => {
      clearTimeout(timer);
      localStorage.setItem(key, config.sandboxGeneration);
      frame.remove();
      resolve(config);
    };
    const timer = setTimeout(done, 3000);
    frame.addEventListener("load", done, { once: true });
    frame.src = config.sandboxOrigin + "/__icode/reset?generation=" + encodeURIComponent(config.sandboxGeneration);
    document.body.append(frame);
  });
}
let configPromise;
export function useContentConfig() {
  const [config, setConfig] = useState(null);
  useEffect(() => {
    configPromise ??= json("/content/config").then(resetSandbox).catch(() => ({ sandboxOrigin: "" }));
    configPromise.then(setConfig);
  }, []);
  return config;
}

function currentTheme(node) {
  return node?.closest?.(".app")?.classList.contains("dark") ? "dark" : "light";
}

// ---------- Mermaid in an opaque sandboxed frame ----------
const frames = new Map(); // contentWindow -> {iframe, figure, source}
let listening = false;
function listen(sandboxOrigin) {
  if (listening) return;
  listening = true;
  window.addEventListener("message", (event) => {
    const record = frames.get(event.source);
    // Opaque-origin frames report "null"; the window identity is the check.
    if (!record || event.origin !== "null") return;
    const data = event.data;
    if (!data || data.type !== "icode:mermaid") return;
    if (data.ready) return render(record);
    const height = Number(data.height);
    if (Number.isFinite(height)) record.iframe.style.height = Math.min(Math.max(height, 20), 4000) + "px";
    record.figure.classList.toggle("mermaid-rendered", data.ok === true);
    record.figure.classList.toggle("mermaid-failed", data.ok === false);
  });
}
function render(record) {
  record.iframe.contentWindow?.postMessage({ type: "icode:mermaid-render", source: record.source, theme: currentTheme(record.figure) }, "*");
}
function mountMermaid(container, sandboxOrigin) {
  if (!sandboxOrigin) return () => {};
  listen(sandboxOrigin);
  const mounted = [];
  for (const figure of container.querySelectorAll("figure.mermaid-diagram[data-source]")) {
    if (figure.querySelector("iframe")) continue;
    const iframe = document.createElement("iframe");
    iframe.title = "Diagram";
    iframe.className = "mermaid-frame";
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.setAttribute("loading", "lazy");
    iframe.src = sandboxOrigin + "/__icode/mermaid.html";
    figure.prepend(iframe);
    const record = { iframe, figure, source: figure.dataset.source };
    const register = () => iframe.contentWindow && frames.set(iframe.contentWindow, record);
    register();
    iframe.addEventListener("load", register);
    mounted.push(record);
  }
  const app = container.closest(".app");
  const observer = app ? new MutationObserver(() => mounted.forEach(render)) : null;
  observer?.observe(app, { attributes: true, attributeFilter: ["class"] });
  return () => {
    observer?.disconnect();
    for (const r of mounted) {
      frames.delete(r.iframe.contentWindow);
      r.iframe.remove();
    }
  };
}

function addCopyButtons(container) {
  for (const block of container.querySelectorAll(".code-block")) {
    if (block.querySelector(".copy-code")) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-code";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "Copy code");
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const text = block.querySelector("pre")?.innerText ?? "";
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = "Copied";
      } catch {
        button.textContent = "Copy failed";
      }
      setTimeout(() => (button.textContent = "Copy"), 1500);
    });
    block.append(button);
  }
}

/** Sanitised lesson HTML from the API, with TOC, copy buttons and diagrams. */
export function LessonHtml({ html, toc = [], sandboxOrigin, label, showToc = true, stepId = null }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    addCopyButtons(node);
    const unmountMermaid = mountMermaid(node, sandboxOrigin);
    // Check questions are interactive only inside a step's lessons.
    const unmountQuestions = mountQuestions(node, stepId);
    return () => {
      unmountQuestions();
      unmountMermaid();
    };
  }, [html, sandboxOrigin, stepId]);
  return (
    <>
      {showToc && toc.length > 1 && (
        <nav className="lesson-toc" aria-label={label ? "On this page: " + label : "On this page"}>
          <strong>On this page</strong>
          <ul>
            {toc.map((item) => (
              <li key={item.id} className={"toc-" + item.depth}>
                <a href={"#" + item.id}>{item.text}</a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {/* Server-rendered with an allowlist sanitiser and URL policy (markdown.mjs). */}
      <div ref={ref} className="lesson-html" dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}

/** Handles engine links inside rendered content. Returns true if handled. */
export function handleContentLink(event, handlers) {
  const anchor = event.target.closest?.("a");
  const href = anchor?.getAttribute("href");
  if (!href) return false;
  if (href.startsWith("#h-")) {
    event.preventDefault();
    const target = document.getElementById(href.slice(1));
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }
  if (href.startsWith("#app=")) {
    event.preventDefault();
    handlers.app?.(decodeURIComponent(href.slice(5)));
    return true;
  }
  if (href.startsWith("#course=")) {
    event.preventDefault();
    handlers.course?.(decodeURIComponent(href.slice(8)));
    return true;
  }
  if (href.startsWith("#step=")) {
    event.preventDefault();
    handlers.step?.(decodeURIComponent(href.slice(6)));
    return true;
  }
  return false;
}

// ---------- in-workshop browser ----------
export function validPath(value) {
  return typeof value === "string" && /^\/(?!\/)[^\s\\]*$/.test(value) && !/^\/*[a-z][a-z0-9+.-]*:/i.test(value.slice(1)) && value.length <= 500;
}
export function AppBrowser({ base, initialRoute = "/", kind = "sandbox", sandboxOrigin, title = "App preview", reloadKey = 0, navigate }) {
  const iframe = useRef(null);
  const [address, setAddress] = useState(initialRoute);
  const [src, setSrc] = useState(() => join(base, initialRoute));
  const [history, setHistory] = useState({ stack: [initialRoute], index: 0 });
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  const baseUrl = new URL(base);
  const prefix = baseUrl.pathname.replace(/\/$/, "");
  useEffect(() => {
    setSrc(join(base, initialRoute));
    setAddress(initialRoute);
    setHistory({ stack: [initialRoute], index: 0 });
  }, [base, initialRoute]);
  useEffect(() => {
    if (navigate?.path && validPath(navigate.path)) go(navigate.path);
  }, [navigate?.key]);
  useEffect(() => setNonce((n) => n + 1), [reloadKey]);
  useEffect(() => {
    if (kind !== "sandbox") return;
    const onMessage = (event) => {
      if (event.source !== iframe.current?.contentWindow || event.origin !== sandboxOrigin) return;
      const data = event.data;
      if (data?.type !== "icode:location" || typeof data.href !== "string" || data.href.length > 2000) return;
      const path = data.href.startsWith(prefix) ? data.href.slice(prefix.length) || "/" : data.href;
      setAddress(path);
      setError("");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [kind, sandboxOrigin, prefix]);
  function go(path) {
    if (!validPath(path)) {
      setError("Enter a path that starts with / (the app's address is fixed).");
      return;
    }
    setError("");
    setAddress(path);
    setSrc(join(base, path));
    setNonce((n) => n + 1);
    setHistory((h) => ({ stack: [...h.stack.slice(0, h.index + 1), path].slice(-50), index: Math.min(h.index + 1, 49) }));
  }
  function step(direction) {
    if (kind === "sandbox") {
      iframe.current?.contentWindow?.postMessage({ type: "icode:history", action: direction }, sandboxOrigin);
      return;
    }
    setHistory((h) => {
      const index = Math.max(0, Math.min(h.stack.length - 1, h.index + (direction === "back" ? -1 : 1)));
      const path = h.stack[index];
      setAddress(path);
      setSrc(join(base, path));
      setNonce((n) => n + 1);
      return { ...h, index };
    });
  }
  const external = join(base, address);
  return (
    <div className="app-browser">
      <form
        className="browser-bar"
        onSubmit={(event) => {
          event.preventDefault();
          go(address.trim() || "/");
        }}
      >
        <button type="button" aria-label="Back" onClick={() => step("back")}>←</button>
        <button type="button" aria-label="Forward" onClick={() => step("forward")}>→</button>
        <button type="button" aria-label="Reload app" onClick={() => setNonce((n) => n + 1)}>⟳</button>
        <span className="browser-origin">{baseUrl.host}</span>
        <input aria-label="App address" value={address} spellCheck={false} onChange={(e) => setAddress(e.target.value)} />
        <button type="submit">Go</button>
        <a href={external} target="_blank" rel="noopener noreferrer">Open in new tab</a>
      </form>
      {error && <p role="alert">{error}</p>}
      <iframe
        key={nonce + "|" + src}
        ref={iframe}
        title={title}
        src={src}
        sandbox="allow-scripts allow-forms allow-same-origin allow-modals"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
function join(base, path) {
  return base.replace(/\/$/, "") + (path.startsWith("/") ? path : "/" + path);
}

// ---------- in-browser tests ----------
const TIMEOUT_MS = 30000;
export function BrowserTests({ id, variant, tests, sandboxOrigin, onSummary }) {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(null);
  const frame = useRef(null);
  const run = useCallback(
    (file) =>
      new Promise((resolve) => {
        setRunning(file);
        setResults((r) => ({ ...r, [file]: { status: "running", steps: [] } }));
        const iframe = document.createElement("iframe");
        iframe.title = "Browser test " + file;
        iframe.className = "browser-test-frame";
        iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-same-origin allow-modals");
        iframe.src = `${sandboxOrigin}/app/${id}/${variant}/?__icode_test=${encodeURIComponent(file)}`;
        let settled = false;
        const finish = (patch) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          window.removeEventListener("message", onMessage);
          setResults((r) => ({ ...r, [file]: { ...r[file], ...patch } }));
          setTimeout(() => iframe.remove(), 0);
          resolve(patch.status);
        };
        const onMessage = (event) => {
          if (event.source !== iframe.contentWindow || event.origin !== sandboxOrigin) return;
          const d = event.data;
          if (!d || d.type !== "icode:test" || d.file !== file) return;
          if (d.event === "step" && typeof d.title === "string" && ["pass", "fail"].includes(d.status))
            setResults((r) => ({ ...r, [file]: { ...r[file], steps: [...(r[file]?.steps ?? []), { title: d.title.slice(0, 300), status: d.status, error: typeof d.error === "string" ? d.error.slice(0, 4000) : "", durationMs: Number(d.durationMs) || 0 }].slice(0, 200) } }));
          if (d.event === "error" && typeof d.message === "string")
            setResults((r) => ({ ...r, [file]: { ...r[file], errors: [...(r[file]?.errors ?? []), d.message.slice(0, 4000)].slice(0, 20) } }));
          if (d.event === "done") finish({ status: Number(d.failed) > 0 ? "failed" : "passed" });
        };
        window.addEventListener("message", onMessage);
        const timer = setTimeout(() => finish({ status: "timeout" }), TIMEOUT_MS);
        frame.current?.append(iframe);
      }),
    [id, variant, sandboxOrigin],
  );
  async function runAll() {
    const statuses = [];
    for (const file of tests) statuses.push(await run(file));
    setRunning(null);
    onSummary?.(statuses.every((s) => s === "passed") ? "passed" : "failed");
  }
  if (!tests?.length) return null;
  return (
    <section className="browser-tests" aria-label="Browser tests">
      <div className="browser-tests-head">
        <h3>Browser tests</h3>
        <button disabled={Boolean(running)} onClick={runAll}>
          {running ? "Running…" : "Run browser tests"}
        </button>
      </div>
      <p className="muted">Run in the app page on the sandbox origin ({variant}). No login needed.</p>
      <div role="region" aria-label="Browser test results">
        {tests.map((file) => {
          const r = results[file];
          return (
            <div key={file} className={"browser-test " + (r?.status ?? "idle")}>
              <strong>{file}</strong> <span className="badge">{r?.status ?? "not run"}</span>
              <ul>
                {r?.steps?.map((s, i) => (
                  <li key={i} className={s.status}>
                    {s.status === "pass" ? "✓" : "✗"} {s.title} <small>{s.durationMs} ms</small>
                    {s.error && <pre>{s.error}</pre>}
                  </li>
                ))}
                {r?.errors?.map((e, i) => (
                  <li key={"e" + i} className="fail">
                    <pre>{e}</pre>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div ref={frame} className="browser-test-frames" aria-hidden="true" />
    </section>
  );
}

// ---------- cloud editors ----------
export function CloudLinks({ cloud }) {
  if (!cloud) return null;
  return (
    <details className="cloud-links">
      <summary>Open in a cloud editor</summary>
      {["problem", "solution"].map((variant) =>
        cloud[variant] ? (
          <p key={variant}>
            <strong>{variant}</strong>{" "}
            <a href={cloud[variant].stackblitz} target="_blank" rel="noopener noreferrer">StackBlitz</a> ·{" "}
            <a href={cloud[variant].codesandbox} target="_blank" rel="noopener noreferrer">CodeSandbox</a> ·{" "}
            <a href={cloud[variant].github} target="_blank" rel="noopener noreferrer">GitHub</a>
          </p>
        ) : null,
      )}
      <small>Your playground stays local; cloud editors open the course's published problem or solution.</small>
    </details>
  );
}

// ---------- notifications ----------
export function Notifications({ sandboxOrigin }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    json("/notifications").then((d) => setItems(d.notifications)).catch(() => {});
  }, []);
  if (!items.length) return null;
  return (
    <div className="notifications" aria-label="Workshop notifications" role="region">
      {items.map((n) => (
        <div key={n.id} className={"notification " + n.type}>
          <div>
            <strong>{n.title}</strong>
            <LessonHtml html={n.html} sandboxOrigin={sandboxOrigin} showToc={false} />
            {n.link && (
              <a href={n.link} target="_blank" rel="noopener noreferrer nofollow">Learn more</a>
            )}
          </div>
          <button
            aria-label={"Dismiss " + n.title}
            onClick={async () => {
              try {
                await json("/notifications/mute", { method: "POST", body: JSON.stringify({ id: n.id }) });
                setItems((list) => list.filter((x) => x.id !== n.id));
              } catch {}
            }}
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------- course pages ----------
export function CoursePage({ name, stepId, config, course, ids, completed, catalog, onChoose, onClose, onLink }) {
  const [page, setPage] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setPage(null);
    json("/content/page?name=" + name + (name === "guide" && stepId ? "&id=" + stepId : ""))
      .then(setPage)
      .catch((e) => setError(e.message));
  }, [name, stepId]);
  const next = ids.find((id) => !completed.includes(id));
  return (
    <article className="course-page lesson-panel" aria-label={page?.title ?? "Course page"} onClick={onLink}>
      <div className="page-head">
        <span className="pill">{name === "intro" ? "Course home" : name === "finished" ? "Finished" : name === "guide" ? "Guide" : "Support"}</span>
        {onClose && <button onClick={onClose}>Back to lesson</button>}
      </div>
      {error && <p role="alert">{error}</p>}
      {name === "intro" && config && (
        <header className="course-meta">
          {config.product?.logo && <img src={config.product.logo} alt="" className="product-logo" />}
          <h1>{config.title}</h1>
          {config.subtitle && <p className="subtitle">{config.subtitle}</p>}
          {config.instructor && (
            <p className="instructor">
              {config.instructor.avatar && <img src={config.instructor.avatar} alt="" />}
              With{" "}
              {config.instructor.url ? (
                <a href={config.instructor.url} target="_blank" rel="noopener noreferrer">{config.instructor.name}</a>
              ) : (
                config.instructor.name
              )}
              {config.product && (
                <>
                  {" · "}
                  {config.product.url ? <a href={config.product.url} target="_blank" rel="noopener noreferrer">{config.product.name}</a> : config.product.name}
                </>
              )}
            </p>
          )}
        </header>
      )}
      {page && (page.exists || name !== "intro") && <LessonHtml html={page.html} toc={page.toc} sandboxOrigin={config?.sandboxOrigin} label={page.title} />}
      {name === "intro" && (
        <section className="course-outline" aria-label="Course outline">
          <h2>Outline</h2>
          <p>
            {completed.filter((id) => ids.includes(id)).length} of {ids.length} steps complete
          </p>
          {(course?.modules || []).map((module) => (
            <div key={module.id}>
              <p className="outline-module">
                <strong>{module.title}</strong>
              </p>
              <ol>
                {(module.exercises?.flatMap((e) => e.steps) ?? module.steps).map((id) => (
                  <li key={id}>
                    <button className="link-button" onClick={() => onChoose(id)}>
                      {id} · {catalog.find((c) => c.id === id)?.title ?? "Step " + id}
                    </button>
                    {completed.includes(id) ? " ✓" : ""}
                  </li>
                ))}
              </ol>
            </div>
          ))}
          {ids.length > 0 && (
            <button className="primary" onClick={() => onChoose(next ?? ids[0])}>
              {completed.length ? "Continue" : "Start the course"} →
            </button>
          )}
        </section>
      )}
      {name === "finished" && page && (
        <section className="finished-summary" aria-label="Course completion">
          <p>
            You completed {page.completed} of {page.total} steps.
          </p>
          {page.form && (
            <p>
              <a href={page.form} target="_blank" rel="noopener noreferrer">Give feedback on this workshop</a>
            </p>
          )}
          {next && (
            <button onClick={() => onChoose(next)}>Go to the next incomplete step ({next}) →</button>
          )}
        </section>
      )}
    </article>
  );
}

/** Shown under the lesson of an exercise's last step. */
export function ExerciseComplete({ app, ids, selected, onChoose }) {
  if (!app?.exercise?.last) return null;
  const index = ids.indexOf(selected);
  const nextId = ids[index + 1];
  return (
    <section className="exercise-complete" aria-label="Exercise complete">
      <h3>Last step of “{app.exercise.title}”</h3>
      <p>When the tests pass, mark the step complete and move on.</p>
      {app.exerciseForm && (
        <a href={app.exerciseForm} target="_blank" rel="noopener noreferrer">Give feedback on this exercise</a>
      )}{" "}
      {nextId && <button onClick={() => onChoose(nextId)}>Next exercise →</button>}
    </section>
  );
}
