import Markdown from "react-markdown";
import React, { useEffect, useState, useRef } from "react";
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
function FileTree({ names, selected, busy, onSelect }) {
  const root = Object.create(null);
  for (const name of names) {
    let cursor = root;
    const parts = name.split("/");
    parts.forEach((part, index) => {
      cursor[part] ??= index === parts.length - 1 ? name : Object.create(null);
      cursor = cursor[part];
    });
  }
  const render = (node) => (
    <ul>
      {Object.entries(node).map(([name, value]) => (
        <li key={name}>
          {typeof value === "string" ? (
            <button
              disabled={busy}
              aria-current={selected === value ? "true" : undefined}
              onClick={() => onSelect(value)}
            >
              {name}
            </button>
          ) : (
            <details open>
              <summary>{name}/</summary>
              {render(value)}
            </details>
          )}
        </li>
      ))}
    </ul>
  );
  return (
    <details className="project-tree">
      <summary>Project file tree</summary>
      {render(root)}
    </details>
  );
}
function App() {
  const [preview, setPreview] = useState(null);
  const [integrations, setIntegrations] = useState([]);
  const [serviceData, setServiceData] = useState(null);
  const [serviceError, setServiceError] = useState("");
  const [tutorEnabled, setTutorEnabled] = useState(false);
  const [question, setQuestion] = useState("");
  const [conversation, setConversation] = useState([]);
  const [tutorError, setTutorError] = useState("");
  const [toolId, setToolId] = useState("");
  const [changes, setChanges] = useState([]);
  const [compareFrom, setCompareFrom] = useState("playground");
  const [compareTo, setCompareTo] = useState("solution");
  const [compareTarget, setCompareTarget] = useState("");
  const [files, setFiles] = useState([]);
  const [file, setFile] = useState("");
  const [reference, setReference] = useState("");
  const [catalog, setCatalog] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [course, setCourse] = useState(null);
  const [activity, setActivity] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [referenceFiles, setReferenceFiles] = useState([]);
  const [referenceFile, setReferenceFile] = useState("");
  const [referenceCode, setReferenceCode] = useState("");
  const [previewVariant, setPreviewVariant] = useState("playground");
  const testController = useRef(null);
  const [ids, setIds] = useState([]);
  const [selected, setSelected] = useState(null);
  const [exercise, setExercise] = useState(null);
  const [tab, setTab] = useState("playground");
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState("");
  const [testSummary, setTestSummary] = useState(null);
  const [panel, setPanel] = useState("console");
  const [busy, setBusy] = useState(false);
  const variant = ["problem", "solution"].includes(tab) ? tab : "playground";
  useEffect(() => {
    api("/integrations")
      .then((data) => setIntegrations(data.integrations))
      .catch(() => {});
    api("/tutor")
      .then((data) => setTutorEnabled(data.enabled))
      .catch(() => {});
    api("/progress")
      .then((data) => setCompleted(data.completed))
      .catch((e) => setResult(e.message));
    api("/exercises")
      .then(({ ids, exercises, course }) => {
        setCourse(course);
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
    setBusy(true);
    setActivity("Opening project file");
    try {
      const data = await api(
        "/file?id=" +
          encodeURIComponent(id) +
          "&name=" +
          encodeURIComponent(name),
      );
      setFile(name);
      setDraft(data.code);
      setDirty(false);
    } finally {
      setBusy(false);
    }
  }
  async function refreshFiles(id = selected) {
    const data = await api("/files?id=" + encodeURIComponent(id));
    setFiles(data.files);
    return data.files;
  }
  async function toggleComplete() {
    setBusy(true);
    setActivity("Saving progress");
    try {
      const data = await api("/progress", {
        method: "PUT",
        body: JSON.stringify({
          id: selected,
          complete: !completed.includes(selected),
        }),
      });
      setCompleted(data.completed);
    } catch (e) {
      setResult(e.message);
      setPanel("console");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    if (!selected || !["problem", "solution"].includes(tab)) return;
    let cancelled = false;
    setReferenceFiles([]);
    setReferenceCode("");
    setReferenceFile("");
    api("/files?id=" + selected + "&variant=" + tab)
      .then(async (data) => {
        const name = data.files.includes(file) ? file : data.files[0];
        const item = name
          ? await api(
              "/file?id=" +
                selected +
                "&variant=" +
                tab +
                "&name=" +
                encodeURIComponent(name),
            )
          : { code: "" };
        if (!cancelled) {
          setReferenceFiles(data.files);
          setReferenceFile(name || "");
          setReferenceCode(item.code);
        }
      })
      .catch((e) => {
        if (!cancelled) setResult(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, tab, file]);
  async function openReference(name) {
    setBusy(true);
    setActivity("Loading reference");
    try {
      const data = await api(
        "/file?id=" +
          selected +
          "&variant=" +
          variant +
          "&name=" +
          encodeURIComponent(name),
      );
      setReferenceFile(name);
      setReferenceCode(data.code);
    } catch (e) {
      setResult(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function compare() {
    setBusy(true);
    setActivity("Comparing saved files");
    try {
      const data = await api(
        "/compare?id=" +
          selected +
          "&from=" +
          compareFrom +
          "&to=" +
          compareTo +
          "&targetId=" +
          (compareTarget || selected),
      );
      setChanges(data.changes);
      setTab("diff");
    } catch (e) {
      setResult(e.message);
      setPanel("console");
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    setActivity("Resetting playground");
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
      setPanel("console");
    } finally {
      setBusy(false);
    }
  }
  async function migrate() {
    const sourceId = ids[ids.indexOf(selected) - 1];
    if (
      !sourceId ||
      !window.confirm(
        "Migrate saved edits from the previous lesson onto this lesson's starter? Current saved files will be backed up. Unsaved edits will be discarded only if migration succeeds.",
      )
    )
      return;
    setBusy(true);
    setActivity("Reconciling lesson changes");
    try {
      const data = await api("/migrate", {
        method: "POST",
        body: JSON.stringify({ sourceId, targetId: selected, apply: true }),
      });
      if (!data.applied) {
        setResult(
          "Migration blocked by conflicts; your playground is unchanged.\n" +
            data.conflicts.map((item) => item.name).join("\n"),
        );
        setPanel("console");
        return;
      }
      await refreshFiles();
      const item = await api("/select", {
        method: "POST",
        body: JSON.stringify({ id: selected }),
      });
      setFile(item.entry);
      setDraft(item.code);
      setDirty(false);
      setPreview(null);
      setTab("playground");
      setPanel("console");
      setResult("Migration completed. Previous target files are backed up.");
    } catch (e) {
      setResult(e.message);
      setPanel("console");
    } finally {
      setBusy(false);
    }
  }
  async function openEditor() {
    setBusy(true);
    setActivity("Opening external editor");
    try {
      const name = ["problem", "solution"].includes(tab) ? referenceFile : file;
      const data = await api(
        "/editor?id=" +
          selected +
          "&variant=" +
          variant +
          "&name=" +
          encodeURIComponent(name),
      );
      window.location.href = data.url;
    } catch (e) {
      setResult(e.message);
      setPanel("console");
    } finally {
      setBusy(false);
    }
  }
  async function replaceFrom(sourceId, sourceVariant, backup) {
    if (
      !window.confirm(
        "Replace this playground? Current files will be backed up; unsaved edits will be discarded.",
      )
    )
      return;
    setBusy(true);
    setActivity("Replacing playground");
    try {
      const data = await api("/replace-workspace", {
        method: "POST",
        body: JSON.stringify({
          id: selected,
          sourceId,
          variant: sourceVariant,
          backup,
        }),
      });
      await refreshFiles();
      setFile(data.entry);
      setDraft(data.code);
      setDirty(false);
      setPreview(null);
      setTab("playground");
      setPanel("console");
      setResult("Playground replaced. Previous files preserved in a backup.");
    } catch (e) {
      setResult(e.message);
      setPanel("console");
    } finally {
      setBusy(false);
    }
  }
  async function restoreBackup() {
    setBusy(true);
    setActivity("Loading backups");
    try {
      const data = await api("/backups?id=" + selected);
      if (!data.backups.length) {
        setResult("No backups available for this lesson.");
        setPanel("console");
        return;
      }
      const backup = window.prompt(
        "Enter a backup name to restore:\n" + data.backups.join("\n"),
        data.backups[0],
      );
      if (backup) await replaceFrom(undefined, undefined, backup);
    } catch (e) {
      setResult(e.message);
      setPanel("console");
    } finally {
      setBusy(false);
    }
  }
  async function fileAction(action) {
    setActivity("Updating project files");
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
      setPanel("console");
    } finally {
      setBusy(false);
    }
  }
  async function previewAction(start) {
    setActivity(
      start ? "Starting " + variant + " preview" : "Stopping preview",
    );
    setBusy(true);
    try {
      const data = await api(start ? "/start" : "/stop", {
        method: "POST",
        body: JSON.stringify({ id: selected, variant }),
      });
      setPreviewVariant(variant);
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
    setActivity("Opening lesson");
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
      setCompareTarget(id);
      setCompareFrom("playground");
      setCompareTo("solution");
      setConversation([]);
      setQuestion("");
      setTutorError("");
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
      setPanel("console");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setActivity("Saving playground");
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
      setPanel("console");
    } finally {
      setBusy(false);
    }
  }
  async function loadIntegration(id) {
    setBusy(true);
    setActivity("Reading " + id);
    setServiceError("");
    setServiceData(null);
    try {
      setServiceData(
        await api("/integrations/read", {
          method: "POST",
          body: JSON.stringify({ id }),
        }),
      );
    } catch (e) {
      setServiceError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function ask() {
    if (!question.trim() || busy) return;
    setBusy(true);
    setActivity("Waiting for tutor");
    setTutorError("");
    try {
      const data = await api("/tutor", {
        method: "POST",
        body: JSON.stringify({
          id: selected,
          name: file || undefined,
          question,
          history: conversation.slice(-12),
        }),
      });
      setConversation((previous) => [
        ...previous,
        { role: "user", content: question },
        { role: "assistant", content: data.answer },
      ]);
      setQuestion("");
    } catch (e) {
      setTutorError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setActivity("Running " + variant + " tests");
    setTestSummary(null);
    setPanel("tests");
    setResult("Starting tests…\n");
    const controller = new AbortController();
    testController.current = controller;
    try {
      if (dirty && variant === "playground") {
        await api("/file", {
          method: "PUT",
          body: JSON.stringify({ id: selected, name: file, code: draft }),
        });
        setDirty(false);
      }
      const response = await fetch("/api/test-stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: selected, variant }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let pending = "",
        finished = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop();
        for (const line of lines) {
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.type === "result") {
            finished = true;
            setTestSummary(event.summary);
            setResult(
              (event.passed ? "PASS" : "FAIL") +
                " · " +
                variant +
                "\n" +
                event.output,
            );
          } else if (event.text)
            setResult((previous) => (previous + event.text).slice(-50000));
        }
      }
      if (!finished)
        throw new Error("Test connection ended before a result was received.");
    } catch (e) {
      setResult(e.name === "AbortError" ? "Test run cancelled." : e.message);
    } finally {
      testController.current = null;
      setBusy(false);
    }
  }
  useEffect(() => {
    const shortcut = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (selected && dirty && !busy) save();
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (selected && !busy) test();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  });
  return (
    <div className="app dark">
      <header className="topbar">
        <div className="brand">
          <img className="hippo-logo" src="/hippo.png" alt="Icode hippo" />
          <div>
            <strong>Icode Workshop</strong>
            <small>Learn by building</small>
          </div>
        </div>
        <div className="top-actions">
          <span className="mode">Local learning environment</span>
          <span className="mode">{course?.title || "AI Engineering Labs"}</span>
        </div>
      </header>
      <div
        className="activity-bar"
        role="log"
        aria-live="polite"
        aria-label="Workshop activity"
      >
        {busy ? (
          <>
            <span className="spinner" aria-hidden="true" />
            {activity || "Working"} · {elapsed}s
          </>
        ) : (
          "Ready"
        )}
        {busy && testController.current && (
          <button onClick={() => testController.current?.abort()}>
            Cancel test run
          </button>
        )}
        <span className="shortcut-help">
          Ctrl/⌘ S · Save &nbsp; Ctrl/⌘ Enter · Run tests
        </span>
      </div>
      <div className="shell">
        <aside className="sidebar">
          <div className="eyebrow">COURSE</div>
          <h2>Labs</h2>
          <p>
            {completed.filter((id) => ids.includes(id)).length} of {ids.length}{" "}
            lessons marked complete
          </p>
          <div className="eyebrow section-label">EXERCISES</div>
          <button
            className="next-incomplete"
            disabled={busy || !ids.some((id) => !completed.includes(id))}
            onClick={() => choose(ids.find((id) => !completed.includes(id)))}
          >
            Next incomplete lesson →
          </button>
          <a
            className="progress-export"
            href="/api/progress"
            download="workshop-progress.json"
          >
            Export progress
          </a>
          {(course?.modules || []).map((module) => (
            <section key={module.id} className="course-module">
              <h3>{module.title}</h3>
              {(
                module.exercises || [
                  { id: module.id, title: "", steps: module.steps },
                ]
              ).map((group) => (
                <div key={group.id} className="exercise-group">
                  {group.title && <h4>{group.title}</h4>}
                  {group.steps.map((id) => (
                    <button
                      disabled={busy}
                      key={id}
                      className={
                        id === selected ? "exercise active" : "exercise"
                      }
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
                </div>
              ))}
            </section>
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
                  {exercise.media && (
                    <section className="lesson-media">
                      {exercise.media.src && (
                        <video
                          controls
                          crossOrigin={
                            exercise.media.captions ? "anonymous" : undefined
                          }
                          preload="metadata"
                          src={exercise.media.src}
                          aria-label="Lesson video"
                        >
                          {exercise.media.captions && (
                            <track
                              kind="captions"
                              src={exercise.media.captions}
                              srcLang="en"
                              label="English"
                              default
                            />
                          )}
                        </video>
                      )}
                      {exercise.media.transcript && (
                        <details>
                          <summary>Lesson transcript</summary>
                          <Markdown>{exercise.media.transcript}</Markdown>
                        </details>
                      )}
                    </section>
                  )}
                  <div className="lesson-nav">
                    <button
                      disabled={busy || ids.indexOf(selected) === 0}
                      onClick={() => choose(ids[ids.indexOf(selected) - 1])}
                    >
                      ← Previous
                    </button>
                    <button disabled={busy} onClick={toggleComplete}>
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
                    Completion is self-reported and saved with this course on
                    disk. Test results are reported separately.
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
                      {[
                        "description",
                        "playground",
                        "problem",
                        "solution",
                        "diff",
                      ].map((item) => (
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
                      ))}
                    </div>
                    {["problem", "solution"].includes(tab) ? (
                      <div className="file-tools">
                        <label>
                          Reference file{" "}
                          <select
                            aria-label="Reference file"
                            value={referenceFile}
                            disabled={busy}
                            onChange={(e) => openReference(e.target.value)}
                          >
                            {referenceFiles.map((name) => (
                              <option key={name}>{name}</option>
                            ))}
                          </select>
                        </label>
                        <span>
                          Read-only {variant} · tests run in a temporary copy
                        </span>
                        <button
                          disabled={busy}
                          onClick={() => replaceFrom(selected, variant)}
                        >
                          Use {variant} in playground
                        </button>
                      </div>
                    ) : (
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
                        <button disabled={busy} onClick={restoreBackup}>
                          Restore backup
                        </button>
                        <button
                          disabled={busy || ids.indexOf(selected) < 1}
                          onClick={() =>
                            replaceFrom(
                              ids[ids.indexOf(selected) - 1],
                              "playground",
                            )
                          }
                        >
                          Copy previous playground
                        </button>
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
                    )}
                    <div className="file-tools">
                      <button
                        disabled={busy || !(file || referenceFile)}
                        onClick={openEditor}
                      >
                        Open in VS Code
                      </button>
                      <button
                        disabled={busy || ids.indexOf(selected) < 1}
                        onClick={migrate}
                      >
                        Migrate previous edits
                      </button>
                    </div>
                    <FileTree
                      names={
                        ["problem", "solution"].includes(tab)
                          ? referenceFiles
                          : files
                      }
                      selected={
                        ["problem", "solution"].includes(tab)
                          ? referenceFile
                          : file
                      }
                      busy={busy}
                      onSelect={(name) =>
                        (["problem", "solution"].includes(tab)
                          ? openReference(name)
                          : openFile(name)
                        ).catch((e) => {
                          setResult(e.message);
                          setPanel("console");
                        })
                      }
                    />
                    <div className="editor-head">
                      <span>
                        {["problem", "solution"].includes(tab)
                          ? referenceFile
                          : file}
                      </span>
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
                      <>
                        <div className="file-tools">
                          <label>
                            From{" "}
                            <select
                              aria-label="Compare from"
                              value={compareFrom}
                              onChange={(e) => {
                                setCompareFrom(e.target.value);
                                setChanges(null);
                              }}
                            >
                              {["playground", "problem", "solution"].map(
                                (v) => (
                                  <option key={v}>{v}</option>
                                ),
                              )}
                            </select>
                          </label>
                          <label>
                            To lesson{" "}
                            <select
                              aria-label="Compare target lesson"
                              value={compareTarget || selected}
                              onChange={(e) => {
                                setCompareTarget(e.target.value);
                                setChanges(null);
                              }}
                            >
                              {catalog.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.id} · {item.title}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            To{" "}
                            <select
                              aria-label="Compare to"
                              value={compareTo}
                              onChange={(e) => {
                                setCompareTo(e.target.value);
                                setChanges(null);
                              }}
                            >
                              {["solution", "problem", "playground"].map(
                                (v) => (
                                  <option key={v}>{v}</option>
                                ),
                              )}
                            </select>
                          </label>
                          <button disabled={busy} onClick={compare}>
                            Refresh comparison
                          </button>
                        </div>
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
                          {changes === null ? (
                            <p>
                              Refresh comparison to view the selected projects.
                            </p>
                          ) : changes.length === 0 ? (
                            <p>Compared projects match.</p>
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
                      </>
                    ) : (
                      <pre className="code">
                        {tab === "description"
                          ? exercise.description +
                            "\n\nSTARTING CODE\n" +
                            exercise.problem
                          : referenceCode || "Empty reference file."}
                      </pre>
                    )}
                    <div className="editor-footer">
                      <span>
                        {dirty ? "Unsaved changes" : "Saved / reference"}
                      </span>
                      <span>{exercise.runtime}</span>
                    </div>
                  </section>
                  <section className="output-panel">
                    <div
                      className="tabs"
                      role="tablist"
                      aria-label="Output panels"
                    >
                      {["preview", "tools", "console", "tests", "tutor"].map(
                        (item) => (
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
                        ),
                      )}
                    </div>
                    {panel === "tutor" ? (
                      <div className="tutor-panel">
                        {!tutorEnabled ? (
                          <p>
                            The tutor is not configured. Set a model endpoint
                            and model on the workshop server to enable it.
                          </p>
                        ) : (
                          <>
                            <p>
                              Asking sends this lesson, the saved selected file
                              and recent conversation to your configured model.
                              Unsaved edits are not sent. Answers are guidance,
                              not verified test results.
                            </p>
                            <div
                              className="tutor-conversation"
                              aria-label="Tutor conversation"
                            >
                              {conversation.map((message, index) => (
                                <section key={index}>
                                  <strong>
                                    {message.role === "user" ? "You" : "Tutor"}
                                  </strong>
                                  <Markdown>{message.content}</Markdown>
                                </section>
                              ))}
                            </div>
                            <label htmlFor="tutor-question">
                              Ask about this lesson
                            </label>
                            <textarea
                              id="tutor-question"
                              maxLength={4000}
                              value={question}
                              disabled={busy}
                              onChange={(e) => setQuestion(e.target.value)}
                            />
                            <button
                              className="primary"
                              disabled={busy || !question.trim()}
                              onClick={ask}
                            >
                              Ask tutor
                            </button>
                          </>
                        )}
                        {tutorError && <p role="alert">{tutorError}</p>}
                      </div>
                    ) : panel === "preview" && exercise.preview ? (
                      <div className="tools-panel">
                        <button
                          disabled={busy}
                          onClick={() => previewAction(!preview)}
                        >
                          {preview ? "Stop app" : "Start app"}
                        </button>
                        {preview && (
                          <button
                            disabled={busy}
                            onClick={() => previewAction(true)}
                          >
                            Restart app
                          </button>
                        )}
                        <p>
                          Preview target: {preview ? previewVariant : variant}
                        </p>
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
                        <h3>Connected services</h3>
                        <p>
                          Load a read-only snapshot from a configured service.
                        </p>
                        {integrations.map((item) => (
                          <p key={item.id}>
                            <button
                              disabled={busy || !item.enabled}
                              onClick={() => loadIntegration(item.id)}
                            >
                              {item.title}
                            </button>{" "}
                            {item.enabled ? "Configured" : "Not configured"}
                          </p>
                        ))}
                        {serviceError && <p role="alert">{serviceError}</p>}
                        {serviceData && (
                          <section>
                            <h4>{serviceData.title}</h4>
                            <pre className="notice">
                              {JSON.stringify(serviceData.rows, null, 2)}
                            </pre>
                          </section>
                        )}
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
                      <>
                        {panel === "tests" && testSummary && (
                          <div className="execution-summary">
                            <strong>{testSummary.status}</strong> ·{" "}
                            {testSummary.runtime} ·{" "}
                            {(testSummary.durationMs / 1000).toFixed(2)}s
                            {testSummary.diagnostics.map((item, index) => (
                              <p key={index}>
                                {item.level}: {item.message}
                              </p>
                            ))}
                          </div>
                        )}
                        <pre className="notice" role="status">
                          {panel === "preview"
                            ? "Preview is available for labs that provide a browser application. This lab uses the console and test runner."
                            : result || "Run tests to view output here."}
                        </pre>
                      </>
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
