import Markdown from "react-markdown";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
const api = async (path, options) => {
  const response = await fetch("/api" + path, {
    ...options,
    headers: { "content-type": "application/json", ...options?.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data;
};

function diffLines(before, after) {
  const a = before.split("\n"),
    b = after.split("\n"),
    n = a.length,
    m = b.length;
  if (n * m > 150000)
    return [
      { kind: "note", text: "Files are too large for inline comparison." },
    ];
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] =
        a[i] === b[j]
          ? 1 + dp[i + 1][j + 1]
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const lines = [];
  let i = 0,
    j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      lines.push({ kind: "same", text: "  " + a[i] });
      i++;
      j++;
    } else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) {
      lines.push({ kind: "added", text: "+ " + b[j++] });
    } else {
      lines.push({ kind: "removed", text: "- " + a[i++] });
    }
  }
  return lines;
}
function App() {
  const [preview, setPreview] = useState(null);
  const [toolId, setToolId] = useState("");
  const [changes, setChanges] = useState([]);
  const [files, setFiles] = useState([]);
  const [file, setFile] = useState("");
  const [reference, setReference] = useState("");
  const [catalog, setCatalog] = useState([]);
  const [completed, setCompleted] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("icode-progress") || "[]");
    } catch {
      return [];
    }
  });
  const [ids, setIds] = useState([]);
  const [selected, setSelected] = useState(null);
  const [exercise, setExercise] = useState(null);
  const [tab, setTab] = useState("playground");
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState("");
  const [panel, setPanel] = useState("console");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/exercises")
      .then(({ ids, exercises }) => {
        setIds(ids);
        setCatalog(exercises);
      })
      .catch((e) => setResult(e.message));
  }, []);
  useEffect(() => {
    const warn = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function openFile(name, id = selected) {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    const data = await api(
      "/file?id=" +
        encodeURIComponent(id) +
        "&name=" +
        encodeURIComponent(name),
    );
    let ref = "";
    try {
      ref = (
        await api(
          "/file?id=" +
            encodeURIComponent(id) +
            "&variant=solution&name=" +
            encodeURIComponent(name),
        )
      ).code;
    } catch {}
    setFile(name);
    setDraft(data.code);
    setReference(ref);
    setDirty(false);
  }
  async function refreshFiles(id = selected) {
    const data = await api("/files?id=" + encodeURIComponent(id));
    setFiles(data.files);
    return data.files;
  }
  function toggleComplete() {
    const next = completed.includes(selected)
      ? completed.filter((id) => id !== selected)
      : [...completed, selected];
    setCompleted(next);
    localStorage.setItem("icode-progress", JSON.stringify(next));
  }
  async function compare() {
    try {
      const data = await api("/compare?id=" + selected);
      setChanges(data.changes);
      setTab("diff");
    } catch (e) {
      setResult(e.message);
    }
  }
  async function reset() {
    if (
      !window.confirm("Reset this playground? Current files will be backed up.")
    )
      return;
    setBusy(true);
    try {
      const data = await api("/reset", {
        method: "POST",
        body: JSON.stringify({ id: selected }),
      });
      await refreshFiles();
      setFile(exercise.entry);
      setDraft(data.code);
      setReference(exercise.solution);
      setDirty(false);
      setPreview(null);
      setResult("Reset completed. Backup: " + data.backup);
    } catch (e) {
      setResult(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function fileAction(action) {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    const name =
      action === "create"
        ? window.prompt("New file path (for example src/helper.py)")
        : file;
    if (!name) return;
    const to =
      action === "rename" ? window.prompt("New path", name) : undefined;
    if (action === "rename" && !to) return;
    if (action === "delete" && !window.confirm("Delete " + name + "?")) return;
    setBusy(true);
    try {
      await api("/file", {
        method:
          action === "create"
            ? "POST"
            : action === "delete"
              ? "DELETE"
              : "PATCH",
        body: JSON.stringify({ id: selected, name, to, code: "" }),
      });
      setDirty(false);
      const names = await refreshFiles();
      const next =
        action === "create" ? name : action === "rename" ? to : names[0];
      if (next) {
        const data = await api(
          "/file?id=" + selected + "&name=" + encodeURIComponent(next),
        );
        setFile(next);
        setDraft(data.code);
        let ref = "";
        try {
          ref = (
            await api(
              "/file?id=" +
                selected +
                "&variant=solution&name=" +
                encodeURIComponent(next),
            )
          ).code;
        } catch {}
        setReference(ref);
      } else {
        setFile("");
        setDraft("");
      }
    } catch (e) {
      setResult(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function previewAction(start) {
    setBusy(true);
    try {
      const data = await api(start ? "/start" : "/stop", {
        method: "POST",
        body: JSON.stringify({ id: selected }),
      });
      setPreview(data.running ? data.url : null);
      setPanel("preview");
    } catch (e) {
      setResult(e.message);
      setPanel("console");
    } finally {
      setBusy(false);
    }
  }
  async function choose(id) {
    if (
      dirty &&
      !window.confirm(
        "Your changes are not saved. Switch exercise and discard them?",
      )
    )
      return;
    setBusy(true);
    setResult("");
    try {
      const item = await api("/exercise?id=" + encodeURIComponent(id));
      const data = await api("/select", {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      await refreshFiles(id);
      setFile(data.entry);
      setReference(item.solution);
      if (selected)
        await api("/stop", {
          method: "POST",
          body: JSON.stringify({ id: selected }),
        });
      setPreview(null);
      setToolId(item.tools?.[0]?.id || "");
      setSelected(id);
      setExercise(item);
      setDraft(data.code);
      setDirty(false);
      setTab("description");
      setResult(
        "Your exercise workspace is ready. Previous edits are preserved.",
      );
    } catch (e) {
      setResult(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      await api("/file", {
        method: "PUT",
        body: JSON.stringify({ id: selected, name: file, code: draft }),
      });
      setDirty(false);
      setResult("Saved to the exercise-specific local playground file.");
    } catch (e) {
      setResult(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    try {
      if (dirty) {
        await api("/file", {
          method: "PUT",
          body: JSON.stringify({ id: selected, name: file, code: draft }),
        });
        setDirty(false);
      }
      const outcome = await api("/test", {
        method: "POST",
        body: JSON.stringify({ id: selected }),
      });
      setPanel("tests");
      setResult((outcome.passed ? "PASS" : "FAIL") + "\n" + outcome.output);
    } catch (e) {
      setResult(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app dark">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">I</span>
          <div>
            <strong>Icode Workshop</strong>
            <small>Learn by building</small>
          </div>
        </div>
        <div className="top-actions">
          <span className="mode">Local learning environment</span>
          <span className="mode">AI Engineering Labs</span>
        </div>
      </header>
      <div className="shell">
        <aside className="sidebar">
          <div className="eyebrow">COURSE</div>
          <h2>Labs</h2>
          <p>
            {completed.length} of {ids.length} lessons marked complete
          </p>
          <div className="eyebrow section-label">EXERCISES</div>
          {ids.map((id) => (
            <button
              disabled={busy}
              key={id}
              className={id === selected ? "exercise active" : "exercise"}
              onClick={() => choose(id)}
            >
              <span className="number">{id}</span>
              <span>
                {catalog.find((item) => item.id === id)?.title ||
                  "Exercise " + id}
                {completed.includes(id) ? " ✓" : ""}
                <small>AI engineering</small>
              </span>
            </button>
          ))}
          <div className="sidebar-footer">
            Select an exercise to create its playground. Each lab has a
            persistent, separate playground.
          </div>
        </aside>
        <main className="content">
          {exercise ? (
            <>
              <div className="heading">
                <span className="pill">{exercise.topic}</span>
                <h1>{exercise.title}</h1>
                <p>{exercise.description}</p>
              </div>
              <div className="learning-layout">
                <article className="lesson-panel">
                  <div className="eyebrow">LESSON · {selected}</div>
                  <Markdown>{exercise.instructions}</Markdown>
                  <div className="lesson-nav">
                    <button
                      disabled={busy || ids.indexOf(selected) === 0}
                      onClick={() => choose(ids[ids.indexOf(selected) - 1])}
                    >
                      ← Previous
                    </button>
                    <button onClick={toggleComplete}>
                      {completed.includes(selected)
                        ? "Mark incomplete"
                        : "Mark complete"}
                    </button>
                    <button
                      disabled={
                        busy || ids.indexOf(selected) === ids.length - 1
                      }
                      onClick={() => choose(ids[ids.indexOf(selected) + 1])}
                    >
                      Next →
                    </button>
                  </div>
                  <small>
                    Completion is self-reported and stored in this browser. Test
                    results are reported separately.
                  </small>
                </article>
                <div className="workspace-column">
                  <section className="workbench">
                    <div className="workbench-head">
                      <div>
                        <h2>Code workbench</h2>
                        <p>
                          Write code, save it locally, then run the exercise
                          tests.
                        </p>
                      </div>
                      <div className="top-actions">
                        <button
                          disabled={busy || !dirty || !file}
                          onClick={save}
                        >
                          Save
                        </button>
                        <button
                          disabled={busy}
                          className="primary"
                          onClick={test}
                        >
                          Run tests
                        </button>
                      </div>
                    </div>
                    <div className="tabs" role="tablist" aria-label="Code view">
                      {["description", "playground", "solution", "diff"].map(
                        (item) => (
                          <button
                            key={item}
                            role="tab"
                            aria-selected={tab === item}
                            className={tab === item ? "tab selected" : "tab"}
                            disabled={busy}
                            onClick={() =>
                              item === "diff" ? compare() : setTab(item)
                            }
                          >
                            {item === "description"
                              ? "Lab description"
                              : item === "playground"
                                ? "Playground"
                                : item === "diff"
                                  ? "Compare"
                                  : item[0].toUpperCase() + item.slice(1)}
                          </button>
                        ),
                      )}
                    </div>
                    <div className="file-tools">
                      <label>
                        Project file{" "}
                        <select
                          aria-label="Project file"
                          disabled={busy}
                          value={file}
                          onChange={(e) =>
                            openFile(e.target.value).catch((e) =>
                              setResult(e.message),
                            )
                          }
                        >
                          {files.map((name) => (
                            <option key={name}>{name}</option>
                          ))}
                        </select>
                      </label>
                      <button disabled={busy} onClick={reset}>
                        Reset playground
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => fileAction("create")}
                      >
                        New file
                      </button>
                      <button
                        disabled={busy || !file}
                        onClick={() => fileAction("rename")}
                      >
                        Rename
                      </button>
                      <button
                        disabled={busy || !file}
                        onClick={() => fileAction("delete")}
                      >
                        Delete
                      </button>
                    </div>
                    <div className="editor-head">
                      <span>{file}</span>
                      <span>
                        {tab === "playground"
                          ? "Editable playground"
                          : tab === "diff"
                            ? "Side-by-side comparison"
                            : "Read-only reference"}
                      </span>
                    </div>
                    {tab === "playground" ? (
                      <textarea
                        disabled={busy || !file}
                        spellCheck="false"
                        aria-label="Playground code editor"
                        value={draft}
                        onChange={(e) => {
                          setDraft(e.target.value);
                          setDirty(true);
                        }}
                      />
                    ) : tab === "diff" ? (
                      <div
                        className="diff-lines"
                        aria-label="Playground versus solution changes"
                      >
                        {dirty && (
                          <p>
                            Comparison uses saved files. Save your changes
                            first.
                          </p>
                        )}
                        {changes.length === 0 ? (
                          <p>All saved files match the solution.</p>
                        ) : (
                          changes.map((change) => (
                            <section key={change.name}>
                              <h3>
                                {change.name} — {change.status}
                              </h3>
                              {diffLines(
                                change.before || "",
                                change.after || "",
                              ).map((line, i) => (
                                <div
                                  key={i}
                                  className={"diff-line " + line.kind}
                                >
                                  {line.text || " "}
                                </div>
                              ))}
                            </section>
                          ))
                        )}
                      </div>
                    ) : (
                      <pre className="code">
                        {tab === "description"
                          ? exercise.description +
                            "\n\nSTARTING CODE\n" +
                            exercise.problem
                          : reference || "No matching solution file."}
                      </pre>
                    )}
                    <div className="editor-footer">
                      <span>
                        {dirty ? "Unsaved changes" : "Saved / reference"}
                      </span>
                      <span>
                        {exercise.runtime === "python"
                          ? "Python · pytest"
                          : "Node.js · JavaScript"}
                      </span>
                    </div>
                  </section>
                  <section className="output-panel">
                    <div
                      className="tabs"
                      role="tablist"
                      aria-label="Output panels"
                    >
                      {["preview", "tools", "console", "tests"].map((item) => (
                        <button
                          key={item}
                          role="tab"
                          aria-selected={panel === item}
                          className={panel === item ? "tab selected" : "tab"}
                          onClick={() => setPanel(item)}
                        >
                          {item === "tests"
                            ? "Test results"
                            : item[0].toUpperCase() + item.slice(1)}
                        </button>
                      ))}
                    </div>
                    {panel === "preview" && exercise.preview ? (
                      <div className="tools-panel">
                        <button
                          disabled={busy}
                          onClick={() => previewAction(!preview)}
                        >
                          {preview ? "Stop app" : "Start app"}
                        </button>
                        {preview && (
                          <>
                            <a
                              href={preview}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {" "}
                              Open preview externally
                            </a>
                            <iframe
                              title="Live preview"
                              src={preview}
                              sandbox="allow-scripts allow-forms allow-same-origin"
                            />
                          </>
                        )}
                      </div>
                    ) : panel === "tools" ? (
                      <div className="tools-panel">
                        <label>
                          Local tool{" "}
                          <select
                            aria-label="Local tool"
                            value={toolId}
                            onChange={(e) => setToolId(e.target.value)}
                          >
                            {exercise.tools?.map((tool) => (
                              <option key={tool.id} value={tool.id}>
                                {tool.title}
                              </option>
                            ))}
                          </select>
                        </label>
                        {!exercise.tools?.length && (
                          <p>
                            No tools configured for this lab. Course authors can
                            add local service links to lab.json.
                          </p>
                        )}
                        {exercise.tools
                          ?.filter((tool) => tool.id === toolId)
                          .map((tool) => (
                            <div key={tool.id}>
                              <p>
                                <a
                                  href={tool.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Open {tool.title} externally
                                </a>
                              </p>
                              {tool.mode === "embed" ? (
                                <>
                                  <p>
                                    If the service blocks embedding or is not
                                    running, use the external link.
                                  </p>
                                  <iframe
                                    title={tool.title}
                                    src={tool.url}
                                    sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
                                    referrerPolicy="no-referrer"
                                  />
                                </>
                              ) : (
                                <p>
                                  This tool opens externally because its
                                  interface may block embedding. Your lesson and
                                  edits stay here.
                                </p>
                              )}
                            </div>
                          ))}
                      </div>
                    ) : (
                      <pre className="notice" role="status">
                        {panel === "preview"
                          ? "Preview is available for labs that provide a browser application. This lab uses the console and test runner."
                          : result || "Run tests to view output here."}
                      </pre>
                    )}
                  </section>
                </div>
              </div>
              <section className="hint">
                <span className="hint-icon">i</span>
                <div>
                  <strong>Playground workflow</strong>
                  <p>
                    The problem and solution remain unchanged. Save edits to
                    your playground. Run tests against the saved files. Each
                    exercise keeps its own playground, so you can return to
                    earlier work.
                  </p>
                </div>
              </section>
            </>
          ) : (
            <div className="heading">
              <span className="pill">Get started</span>
              <h1>Choose a lab</h1>
              <p>Select a lab on the left to create an editable playground.</p>
            </div>
          )}
          {!exercise && result && (
            <pre className="notice" role="status">
              {result}
            </pre>
          )}
        </main>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
