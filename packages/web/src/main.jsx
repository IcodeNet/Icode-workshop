import "./session.js";
import React, { useEffect, useMemo, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import {
  AnsiOutput,
  ActionsPanel,
  ConfirmDialog,
  FreePort,
  IndicatorBanner,
  ProcessesPanel,
  SetupBanner,
  tail,
  useActions,
  useIndicators,
} from "./operations.jsx";
import { DiffView, resolveDiffLink } from "./diff.jsx";
import { QuestionSummary, ReviewList, questionStore, focusQuestion, useReviewItems } from "./questions.jsx";
import { SavedPanel, TouchedFiles, UpdateBanner, UpdatePanel, operationSummary } from "./workspace.jsx";
import {
  AppBrowser,
  BrowserTests,
  CloudLinks,
  CoursePage,
  ExerciseComplete,
  LessonHtml,
  Notifications,
  handleContentLink,
  useContentConfig,
} from "./content.jsx";
import { CommandPalette, ShortcutsDialog } from "./palette.jsx";
import {
  ConnectionBanner,
  ConnectionStatus,
  PanelBoundary,
  PreferencesPage,
  THEME_LABELS,
  WarningBanner,
  nextTheme,
  useConnection,
  usePreferences,
  useScrollRestore,
  useShortcuts,
  useTheme,
  useWarnings,
} from "./ux.jsx";
import { ExternalLink, Prose, Select, TipButton, shortBinding } from "./controls.jsx";
import { COMMANDS, resolveBindings } from "./ux/shortcuts.js";
import { THEMES } from "./ux/preferences.js";
const api = async (path, options) => {
  const response = await fetch("/api" + path, {
    ...options,
    headers: { "content-type": "application/json", ...options?.headers },
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.error ?? "Request failed"), { data });
  return data;
};

// Captured before effects rewrite the URL.
const initialSearch = window.location.search;
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
  const [diffInitial, setDiffInitial] = useState(null);
  const [workspaceKey, setWorkspaceKey] = useState(0);
  const editorRef = useRef(null);
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
  const [portConflict, setPortConflict] = useState(null);
  const [editors, setEditors] = useState([]);
  const [editorId, setEditorId] = useState("");
  const [diskChange, setDiskChange] = useState(null);
  const [reloadPreview, setReloadPreview] = useState(true);
  const [previewKey, setPreviewKey] = useState(0);
  const [liveReload, setLiveReload] = useState("off");
  // Course pages and workshop-served apps.
  const contentConfig = useContentConfig();
  const sandboxOrigin = contentConfig?.sandboxOrigin || "";
  const [page, setPage] = useState(null);
  const [appInfo, setAppInfo] = useState(null);
  const [appVariant, setAppVariant] = useState("playground");
  const [appNavigate, setAppNavigate] = useState(null);
  const [indicators, refreshIndicators] = useIndicators();
  // Preferences, theme, shortcuts, palette, status and warnings.
  const prefs = usePreferences();
  const theme = useTheme(prefs.ui);
  const bindings = useMemo(() => resolveBindings(prefs.ui.shortcuts), [prefs.ui.shortcuts]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const connection = useConnection();
  const warnings = useWarnings(workspaceKey);
  useScrollRestore(page ? "page:" + page : selected ? "step:" + selected : "home", prefs.ui.restoreScroll);
  useEffect(() => {
    if (course?.title) document.title = course.title + " · Icode Workshop";
  }, [course?.title]);
  const actions = useActions({
    onFinished: refreshIndicators,
    onChange: refreshIndicators,
  });
  const variant = ["problem", "solution"].includes(tab) ? tab : "playground";
  // Latest values for long-lived event handlers (live reload).
  const latest = useRef({});
  latest.current = { file, draft, dirty, preview, previewVariant, reloadPreview, busy, app: appInfo?.type && appVariant === "playground" };
  useEffect(() => {
    api("/integrations")
      .then((data) => setIntegrations(data.integrations))
      .catch(() => {});
    api("/tutor")
      .then((data) => setTutorEnabled(data.enabled))
      .catch(() => {});
    api("/editors")
      .then((data) => {
        setEditors(data.editors);
        // A terminal editor ($EDITOR=vi) is never the default.
        setEditorId(data.editors.find((e) => e.available && !e.terminal)?.id || "");
      })
      .catch(() => {});
    api("/progress")
      .then((data) => {
        setCompleted(data.completed);
        questionStore.fromServer(data.questions);
      })
      .catch((e) => setResult(e.message));
    api("/exercises")
      .then(({ ids, exercises, course }) => {
        setCourse(course);
        questionStore.configure(course?.title + "|" + ids.join(","));
        setIds(ids);
        setCatalog(exercises);
        // Deep link: ?diff=<a>..<b>&file=&view=&ws=
        const params = new URLSearchParams(initialSearch);
        const value = params.get("diff");
        if (value) {
          const sides = resolveDiffLink(value, { selected: ids[0], ids });
          const step = sides?.[0]?.slice(0, 2);
          if (sides && ids.includes(step))
            choose(step, { diff: { a: sides[0], b: sides[1], file: params.get("file") || undefined, view: params.get("view") || undefined, ws: params.get("ws") === "ignore" } });
        }
      })
      .catch((e) => setResult(e.message));
  }, []);
  useEffect(() => {
    // Deep links describe the open diff only.
    if (tab !== "diff" && window.location.search.includes("diff="))
      window.history.replaceState(null, "", window.location.pathname);
  }, [tab]);
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
  useEffect(() => {
    if (!selected || typeof EventSource === "undefined") return;
    const source = new EventSource("/api/events?id=" + encodeURIComponent(selected));
    setLiveReload("connecting");
    source.addEventListener("ready", () => setLiveReload("ready"));
    source.addEventListener("error", () => setLiveReload("connecting"));
    let refreshTimer;
    source.addEventListener("change", async (message) => {
      const { name } = JSON.parse(message.data);
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        api("/files?id=" + encodeURIComponent(selected))
          .then((data) => setFiles(data.files))
          .catch(() => {});
      }, 200);
      const now = latest.current;
      if ((now.preview && now.previewVariant === "playground" || now.app) && now.reloadPreview)
        setPreviewKey((key) => key + 1);
      if (!name || name !== now.file) return;
      let code;
      try {
        code = (
          await api("/file?id=" + encodeURIComponent(selected) + "&name=" + encodeURIComponent(name))
        ).code;
      } catch {
        return; // deleted or unreadable; the file list refresh shows it
      }
      const current = latest.current;
      if (current.file !== name || code === current.draft) return;
      if (!current.dirty && !current.busy) {
        setDraft(code);
        setDiskChange(null);
        setActivity("Reloaded " + name + " from disk");
      } else setDiskChange({ name, code });
    });
    return () => {
      clearTimeout(refreshTimer);
      source.close();
    };
  }, [selected]);
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
      setDiskChange(null);
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
  function openDiff(spec = {}) {
    setDiffInitial({
      a: spec.a ?? selected + ".playground",
      b: spec.b ?? selected + ".solution",
      file: spec.file,
      view: spec.view,
      ws: spec.ws,
      key: Date.now(),
    });
    setTab("diff");
  }
  /** Open a playground file and move the cursor to `line`. */
  async function openAtLine(name, line = 1) {
    setTab("playground");
    await openFile(name);
    requestAnimationFrame(() => {
      const el = editorRef.current;
      if (!el) return;
      const lines = el.value.split("\n");
      const offset = lines.slice(0, Math.max(0, line - 1)).reduce((n, l) => n + l.length + 1, 0);
      el.focus();
      el.setSelectionRange(offset, offset);
      el.scrollTop = Math.max(0, (line - 3) * 18);
    });
  }
  async function launchAt(name, line) {
    setBusy(true);
    setActivity("Launching editor");
    try {
      const data = await api("/editor/launch", {
        method: "POST",
        body: JSON.stringify({ id: selected, variant: "playground", name, line, column: 1, editor: editorId || undefined }),
      });
      setResult("Opened " + name + " at line " + line + " in " + data.label + ".");
    } catch (e) {
      setResult(e.message);
      setPanel("console");
    } finally {
      setBusy(false);
    }
  }
  /** Put one file back to the step's problem version. */
  async function resetFile(name) {
    if (!window.confirm("Reset " + name + " to the problem version? The playground is saved first.")) return;
    setBusy(true);
    setActivity("Resetting " + name);
    try {
      const data = await api("/file/sync", {
        method: "POST",
        body: JSON.stringify({ id: selected, name, from: selected + ".problem" }),
      });
      await refreshFiles();
      if (name === file) {
        const item = await api("/file?id=" + selected + "&name=" + encodeURIComponent(name));
        setDraft(item.code);
        setDirty(false);
      }
      setWorkspaceKey((k) => k + 1);
      setResult("Reset " + name + " to the problem version." + (data.saved ? " Previous playground saved." : ""));
    } catch (e) {
      setResult(e.message);
      setPanel("console");
    } finally {
      setBusy(false);
    }
  }
  const showFailure = (e) => {
    setResult(e.message + (e.data?.hooks?.length ? "\n" + operationSummary(e.data) : ""));
    setPanel("console");
  };
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
      setWorkspaceKey((k) => k + 1);
      if (data.previewRestarted && typeof data.previewRestarted === "string") setPreview(data.previewRestarted);
      setResult("Reset completed. Backup: " + data.backup + "\n" + operationSummary(data));
    } catch (e) {
      showFailure(e);
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
      setWorkspaceKey((k) => k + 1);
      setResult("Migration completed. Previous target files are backed up.\n" + operationSummary(data));
    } catch (e) {
      showFailure(e);
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
  async function launchInEditor() {
    setBusy(true);
    setActivity("Launching editor");
    try {
      const name = ["problem", "solution"].includes(tab) ? referenceFile : file;
      const data = await api("/editor/launch", {
        method: "POST",
        body: JSON.stringify({ id: selected, variant, name, line: 1, column: 1, editor: editorId || undefined }),
      });
      setResult("Opened " + name + " in " + data.label + ".");
    } catch (e) {
      setResult(e.message + "\nUse “Open in VS Code” as a fallback.");
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
      setWorkspaceKey((k) => k + 1);
      if (typeof data.previewRestarted === "string") setPreview(data.previewRestarted);
      setResult("Playground replaced. Previous files preserved in a backup.\n" + operationSummary(data));
    } catch (e) {
      showFailure(e);
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
      setPortConflict(null);
      setPanel("preview");
    } catch (e) {
      setResult(e.message);
      if (e.data?.code === "PORT_OCCUPIED") {
        setPortConflict(e.data.port);
        setPanel("preview");
      } else setPanel("console");
    } finally {
      setBusy(false);
    }
  }
  async function choose(id, { diff } = {}) {
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
      setPortConflict(null);
      setDiskChange(null);
      setToolId(item.tools?.[0]?.id || "");
      setConversation([]);
      setQuestion("");
      setTutorError("");
      setSelected(id);
      setExercise(item);
      setPage(null);
      setAppVariant("playground");
      setAppNavigate(null);
      api("/content/app?id=" + encodeURIComponent(id) + "&variant=playground")
        .then(setAppInfo)
        .catch(() => setAppInfo(null));
      setDraft(data.code);
      setDirty(false);
      setTab(diff ? "diff" : "description");
      if (diff) setDiffInitial({ ...diff, key: Date.now() });
      setWorkspaceKey((k) => k + 1);
      const summary = operationSummary(data);
      setResult(
        "Your exercise workspace is ready. Previous edits are preserved." + (summary ? "\n" + summary : ""),
      );
    } catch (e) {
      showFailure(e);
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
      setDiskChange(null);
      setWorkspaceKey((k) => k + 1);
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
            setResult((previous) => tail(previous + event.text));
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
  // Engine links: #app=, #course=, #h- headings.
  function contentClick(event) {
    return handleContentLink(event, {
      app: (path) => {
        setPage(null);
        setPanel("preview");
        setAppNavigate({ path, key: Date.now() });
      },
      course: (path) => {
        const match = path.match(/^exercises\/(\d{2})(?:\/(problem|solution)\/(.+))?/);
        if (match && ids.includes(match[1])) {
          setPage(null);
          if (match[1] !== selected) choose(match[1]);
          else if (match[3] && match[2] === "problem") {
            setTab("playground");
            openFile(match[3]).catch((e) => setResult(e.message));
          }
        } else setResult("This link points to a course file that the workshop does not open: " + path);
      },
    });
  }
  // Every palette entry and shortcut maps to one of these.
  // They call the same functions as the buttons, with the same confirmations.
  const index = ids.indexOf(selected);
  const wait = busy ? "wait for the current operation to finish" : "";
  const noStep = exercise ? "" : "open a lesson first";
  const lessonOnly = (run, extra = "") => ({ disabled: noStep || wait || extra, run: () => (setPage(null), run()) });
  const commandTable = {
    "palette.open": { run: () => setPaletteOpen(true) },
    "shortcuts.open": { run: () => setShortcutsOpen(true) },
    "preferences.open": { disabled: wait, run: () => setPage("preferences") },
    "theme.cycle": { run: () => prefs.update({ theme: nextTheme(prefs.ui.theme) }) },
    "connection.retry": { run: () => connection.retry() },
    "nav.home": { disabled: wait, run: () => setPage("intro") },
    "nav.guide": { disabled: wait, run: () => setPage("guide") },
    "nav.finish": { disabled: wait, run: () => setPage("finished") },
    "nav.next": { disabled: wait || (!ids.length ? "no lessons" : index >= ids.length - 1 ? "this is the last step" : ""), run: () => choose(ids[index + 1]) },
    "nav.prev": { disabled: wait || (index < 1 ? (exercise ? "this is the first step" : "open a lesson first") : ""), run: () => choose(ids[index - 1]) },
    "nav.last": { disabled: wait || (!ids.length ? "no lessons" : ""), run: () => choose(ids[ids.length - 1]) },
    "nav.incomplete": { disabled: wait || (ids.some((id) => !completed.includes(id)) ? "" : "every step is complete"), run: () => choose(ids.find((id) => !completed.includes(id))) },
    "view.diff": lessonOnly(() => openDiff()),
    "view.playground": lessonOnly(() => setTab("playground")),
    "view.problem": lessonOnly(() => setTab("problem")),
    "view.solution": lessonOnly(() => setTab("solution")),
    "file.save": { disabled: noStep || wait || (!dirty ? "nothing to save" : ""), run: save },
    "tests.run": { disabled: noStep || wait, run: test },
    "file.new": lessonOnly(() => (setTab("playground"), fileAction("create"))),
    "file.delete": lessonOnly(() => fileAction("delete"), file ? "" : "no file is open"),
    "playground.reset": lessonOnly(reset),
    "playground.solution": lessonOnly(() => replaceFrom(selected, "solution")),
    "playground.previous": lessonOnly(() => replaceFrom(ids[index - 1], "playground"), index < 1 ? "this is the first step" : ""),
    "playground.migrate": lessonOnly(migrate, index < 1 ? "this is the first step" : ""),
    "lesson.complete": lessonOnly(toggleComplete),
    ...Object.fromEntries(
      ["preview", "console", "tests", "actions", "processes", "saved", "update", "tools", "tutor"].map((name) => [
        "panel." + name,
        { disabled: noStep, run: () => (setPage(null), setPanel(name)) },
      ]),
    ),
  };
  function runCommand(id) {
    const command = commandTable[id];
    if (!command) return false;
    if (command.disabled) {
      setActivity("Unavailable: " + command.disabled);
      // Ctrl/Cmd+S and Ctrl/Cmd+Enter never fall through to the browser.
      return id === "file.save" || id === "tests.run";
    }
    command.run();
    return true;
  }
  const runLatest = useRef(runCommand);
  runLatest.current = runCommand;
  useShortcuts(bindings, (id) => runLatest.current(id), { diffActive: Boolean(exercise && !page && tab === "diff") });
  const reviewItems = useReviewItems();
  // Opens a check question (review list and palette): its step, then focus.
  function openQuestion(step, qid) {
    setPage(null);
    if (step === selected && focusQuestion(step, qid)) return;
    questionStore.focusLater(step, qid);
    if (step !== selected) choose(step);
  }
  const paletteItems = useMemo(() => {
    if (!paletteOpen) return [];
    const items = COMMANDS.map((c) => ({
      key: "command:" + c.id,
      kind: "command",
      label: c.label,
      keywords: [c.group, c.id],
      binding: bindings[c.id]?.[0],
      disabled: commandTable[c.id]?.disabled || "",
      run: () => runLatest.current(c.id),
    }));
    for (const t of THEMES)
      items.push({ key: "theme:" + t, kind: "command", label: "Theme: " + THEME_LABELS[t], keywords: ["theme", "colour", "color", "appearance"], detail: prefs.ui.theme === t ? "current" : "", run: () => prefs.update({ theme: t }) });
    for (const action of actions.actions)
      items.push({
        key: "action:" + action.id,
        kind: "command",
        label: "Run course action: " + action.label,
        keywords: [action.group || "", action.description || "", "action"],
        detail: action.destructive ? "Destructive; asks for typed confirmation" : action.group || "",
        disabled: actions.running ? "another action is running" : "",
        // Same entry point as the Actions panel button: the server's typed
        // confirmation still opens the confirmation dialog.
        run: () => (setPage(null), setPanel("actions"), actions.start(action)),
      });
    for (const module of course?.modules || [])
      for (const group of module.exercises || [{ id: module.id, title: "", steps: module.steps }])
        for (const id of group.steps || []) {
          const title = catalog.find((item) => item.id === id)?.title || "Exercise " + id;
          items.push({
            key: "lesson:" + id,
            kind: "lesson",
            label: id + " " + title + (completed.includes(id) ? " ✓" : ""),
            keywords: [String(group.title || ""), String(module.title || "")],
            detail: [module.title, group.title].filter(Boolean).join(" › "),
            disabled: wait,
            run: () => {
              setPage(null);
              if (id !== selected) choose(id);
            },
          });
        }
    for (const item of reviewItems)
      items.push({
        key: "review:" + item.step + "/" + item.id,
        kind: "review",
        label: "Review again: " + (item.prompt || "Check question"),
        keywords: ["review", "question", "quiz", "check"],
        detail: "Step " + item.step + (item.mark === "review" ? " · marked review again" : " · answered incorrectly"),
        disabled: wait,
        run: () => openQuestion(item.step, item.id),
      });
    for (const name of exercise ? files : [])
      items.push({
        key: "file:" + name,
        kind: "file",
        label: name,
        detail: "playground of " + selected,
        disabled: wait,
        run: () => {
          setPage(null);
          setTab("playground");
          openFile(name).catch((e) => setResult(e.message));
        },
      });
    return items;
  }, [paletteOpen]);
  return (
    <div className={theme.className} style={theme.style}>
      <header className="app-header">
      <div className="topbar">
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
          <ConnectionStatus state={connection.state} onRetry={connection.retry} />
          <TipButton
            iconOnly
            icon="command"
            label="Commands"
            tip="Command palette"
            binding={shortBinding(bindings["palette.open"])}
            align="end"
            className="commands-button"
            onClick={() => setPaletteOpen(true)}
            aria-keyshortcuts="Control+Shift+P Meta+Shift+P Control+K Meta+K"
          />
          <TipButton
            iconOnly
            icon="keyboard"
            label="Shortcuts"
            tip="Keyboard shortcuts"
            binding={shortBinding(bindings["shortcuts.open"])}
            align="end"
            className="commands-button"
            onClick={() => setShortcutsOpen(true)}
            aria-keyshortcuts="Shift+?"
          />

        </div>
      </div>
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
          Ctrl/⌘ Shift P · Commands &nbsp; ? · Shortcuts &nbsp; Ctrl/⌘ S · Save &nbsp; Ctrl/⌘ Enter · Run tests
        </span>
      </div>
      {/* Status, cost, setup and course notices stay in the header: they are
          in view whatever the panes below are scrolled to. */}
      <div className="header-banners">
        <ConnectionBanner connection={connection} />
        <WarningBanner
          warnings={warnings}
          dismissed={prefs.ui.dismissedWarnings}
          onDismissForever={(id) => prefs.update({ dismissedWarnings: [...prefs.ui.dismissedWarnings, id] })}
        />
        <IndicatorBanner indicators={indicators} />
        <SetupBanner />
        <UpdateBanner onOpen={() => setPanel("update")} />
        <Notifications sandboxOrigin={sandboxOrigin} />
      </div>
      </header>
      {paletteOpen && (
        <PanelBoundary name="command palette">
          <CommandPalette items={paletteItems} onClose={() => setPaletteOpen(false)} />
        </PanelBoundary>
      )}
      {shortcutsOpen && <ShortcutsDialog bindings={bindings} onClose={() => setShortcutsOpen(false)} />}
      {actions.confirm && (
        <ConfirmDialog
          title={"Confirm: " + (actions.run?.label || "course action")}
          message={actions.confirm.message}
          expected={actions.confirm.expected}
          confirmLabel="Continue"
          onConfirm={(typed) => actions.answer(typed)}
          onCancel={() => actions.answer("")}
        />
      )}
      <div className="shell">
        <aside className="sidebar" aria-label="Course navigation">
          <div className="eyebrow">COURSE</div>
          <h2>Labs</h2>
          <p>
            {completed.filter((id) => ids.includes(id)).length} of {ids.length}{" "}
            lessons marked complete
          </p>
          <nav className="course-pages" aria-label="Course pages">
            <button disabled={busy} aria-current={page === "intro" ? "page" : undefined} onClick={() => setPage("intro")}>Course home</button>
            <button disabled={busy} aria-current={page === "guide" ? "page" : undefined} onClick={() => setPage("guide")}>Guide</button>
            {(contentConfig?.support || contentConfig?.community) && (
              <button disabled={busy} aria-current={page === "support" ? "page" : undefined} onClick={() => setPage("support")}>Support</button>
            )}
            <button disabled={busy} aria-current={page === "finished" ? "page" : undefined} onClick={() => setPage("finished")}>Finish</button>
            <button disabled={busy} aria-current={page === "preferences" ? "page" : undefined} onClick={() => setPage("preferences")}>Preferences</button>
          </nav>
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
          <ReviewList disabled={busy} items={reviewItems} onOpen={openQuestion} />
          <div className="sidebar-footer">
            Select an exercise to create its playground. Each lab has a
            persistent, separate playground.
          </div>
        </aside>
        <main className={!page && exercise ? "content lesson-view" : "content"} data-scroll-pane="content">
          {page === "preferences" && (
            <PanelBoundary name="preferences page">
              <PreferencesPage prefs={prefs} resolvedTheme={theme.resolved} onClose={exercise ? () => setPage(null) : null} />
            </PanelBoundary>
          )}
          {page && page !== "preferences" && (
            <PanelBoundary name="course page" resetKey={page}>
            <CoursePage
              name={page}
              stepId={selected}
              config={contentConfig}
              course={course}
              ids={ids}
              completed={completed}
              catalog={catalog}
              onChoose={(id) => {
                setPage(null);
                if (id !== selected) choose(id);
              }}
              onClose={exercise ? () => setPage(null) : null}
              onLink={contentClick}
            />
            </PanelBoundary>
          )}
          {page ? null : exercise ? (
            <>
              <div className="heading step-heading">
                <span className="pill">{exercise.topic}</span>
                <h1>{exercise.title}</h1>
                <p>{exercise.description}</p>
              </div>
              <div className="learning-layout">
                <PanelBoundary name="lesson panel" resetKey={selected}>
                <article className="lesson-panel" data-scroll-pane="lesson" onClick={(event) => {
                  if (contentClick(event)) return;
                  const href = event.target.closest("a")?.getAttribute("href");
                  if (href?.startsWith("#file=")) {
                    event.preventDefault();
                    if (!busy) { setTab("playground"); openFile(decodeURIComponent(href.slice(6))).catch(e=>setResult(e.message)); }
                  } else if (href === "#comparison") {
                    event.preventDefault(); if (!busy) openDiff();
                  } else if (href?.startsWith("#diff=")) {
                    // Lesson diff links: #diff=step|next|prev|<a>..<b> (DiffLink).
                    event.preventDefault();
                    const sides = resolveDiffLink(decodeURIComponent(href.slice(6)), { selected, ids });
                    if (!busy && sides) openDiff({ a: sides[0], b: sides[1] });
                    else if (!sides) setResult("This diff link does not apply to this lesson.");
                  }
                }}>
                  <div className="eyebrow">LESSON · {selected}</div>
                  <QuestionSummary step={selected} questions={exercise.documents?.flatMap((doc) => doc.questions || [])} />
                  {exercise.lesson?.html !== undefined ? (
                    <LessonHtml html={exercise.lesson.html} toc={exercise.lesson.toc} sandboxOrigin={sandboxOrigin} label={exercise.title} stepId={selected} />
                  ) : (
                    <Prose>{exercise.instructions}</Prose>
                  )}
                  {exercise.documents?.filter(doc => doc.path !== exercise.lesson?.path).map(doc => (
                    <details key={doc.path}><summary>{doc.title}</summary>{doc.html !== undefined ? <LessonHtml html={doc.html} toc={[]} sandboxOrigin={sandboxOrigin} stepId={selected} /> : <Prose>{doc.content}</Prose>}</details>
                  ))}
                  <ExerciseComplete app={appInfo} ids={ids} selected={selected} onChoose={(id) => choose(id)} />
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
                          <Prose>{exercise.media.transcript}</Prose>
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
                </PanelBoundary>
                <div className="workspace-column" data-scroll-pane="workbench">
                  <PanelBoundary name="code workbench" resetKey={selected}>
                  <section className="workbench" data-live-reload={liveReload}>
                    <div className="workbench-head">
                      <div>
                        <h2>Code workbench</h2>
                        <CloudLinks cloud={appInfo?.cloud} />
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
                        <button disabled={busy || !file} onClick={() => openFile(file).catch(e=>setResult(e.message))}>Reload file</button>
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
                            item === "diff" ? openDiff() : setTab(item)
                          }
                        >
                          {item === "description"
                            ? "Lab description"
                            : item === "playground"
                              ? "Playground"
                              : item === "diff"
                                ? "Diff"
                                : item[0].toUpperCase() + item.slice(1)}
                        </button>
                      ))}
                    </div>
                    {["problem", "solution"].includes(tab) ? (
                      <div className="file-tools">
                        <label className="field">
                          Reference file{" "}
                          <Select
                            aria-label="Reference file"
                            value={referenceFile}
                            disabled={busy}
                            onChange={(e) => openReference(e.target.value)}
                          >
                            {referenceFiles.map((name) => (
                              <option key={name}>{name}</option>
                            ))}
                          </Select>
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
                        <label className="field">
                          Project file{" "}
                          <Select
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
                          </Select>
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
                        <button disabled={busy || !file} onClick={() => resetFile(file)}>
                          Reset file to problem
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
                      {editors.some((e) => e.available) && (
                        <>
                          <label className="field">
                            Editor{" "}
                            <Select
                              aria-label="Editor"
                              value={editorId}
                              disabled={busy}
                              onChange={(e) => setEditorId(e.target.value)}
                            >
                              {editors
                                .filter((e) => e.available)
                                .map((e) => (
                                  <option key={e.id} value={e.id}>
                                    {e.label}
                                  </option>
                                ))}
                            </Select>
                          </label>
                          <button
                            disabled={busy || !(file || referenceFile)}
                            onClick={launchInEditor}
                          >
                            Open in editor
                          </button>
                        </>
                      )}
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
                    {tab !== "diff" && (
                      <TouchedFiles
                        selected={selected}
                        refreshKey={workspaceKey}
                        busy={busy}
                        canLaunch={editors.some((e) => e.available && !e.terminal)}
                        onOpen={(name, line) => openAtLine(name, line).catch((e) => setResult(e.message))}
                        onLaunch={launchAt}
                        onReset={resetFile}
                        onDiff={(name) => openDiff({ a: selected + ".problem", b: selected + ".solution", file: name })}
                      />
                    )}
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
                            ? "Rich diff · press ? for shortcuts"
                            : "Read-only reference"}
                      </span>
                    </div>
                    {tab === "playground" && diskChange?.name === file && (
                      <div className="disk-change" role="alert">
                        {file} changed on disk while you have unsaved edits.{" "}
                        <button
                          onClick={() => {
                            setDraft(diskChange.code);
                            setDirty(false);
                            setDiskChange(null);
                          }}
                        >
                          Load disk version
                        </button>{" "}
                        <button onClick={() => setDiskChange(null)}>
                          Keep my edits
                        </button>
                      </div>
                    )}
                    {tab === "playground" ? (
                      <textarea
                        ref={editorRef}
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
                      <DiffView
                        catalog={catalog}
                        selected={selected}
                        initial={diffInitial}
                        dirty={dirty}
                        busy={busy}
                        onOpenFile={(name, line) => openAtLine(name, line).catch((e) => setResult(e.message))}
                        onSynced={(step, name) => {
                          setWorkspaceKey((k) => k + 1);
                          if (step === selected) refreshFiles().catch(() => {});
                          if (step === selected && name === file)
                            api("/file?id=" + selected + "&name=" + encodeURIComponent(name))
                              .then((item) => { setDraft(item.code); setDirty(false); })
                              .catch(() => {});
                        }}
                        onMessage={setResult}
                      />
                    ) : (
                      <pre className="code" tabIndex={0} role="group" aria-label={tab === "description" ? "Lab description and starting code" : "Read-only " + tab + " code"}>
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
                  </PanelBoundary>
                  <PanelBoundary name="output panel" resetKey={selected}>
                  <section className="output-panel">
                    <div
                      className="tabs"
                      role="tablist"
                      aria-label="Output panels"
                    >
                      {["preview", "tools", "console", "tests", "actions", "processes", "saved", "update", "tutor"].map(
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
                              : item === "saved"
                                ? "Saved"
                              : item === "actions" && actions.running
                                ? "Actions ●"
                                : item[0].toUpperCase() + item.slice(1)}
                          </button>
                        ),
                      )}
                    </div>
                    {panel === "saved" ? (
                      <SavedPanel
                        selected={selected}
                        refreshKey={workspaceKey}
                        busy={busy}
                        setBusy={setBusy}
                        onRestored={async (data) => {
                          await refreshFiles();
                          setFile(data.entry);
                          setDraft(data.code);
                          setDirty(false);
                          if (typeof data.previewRestarted === "string") setPreview(data.previewRestarted);
                          setWorkspaceKey((k) => k + 1);
                        }}
                        onDiff={(side) => openDiff({ a: side, b: selected + ".playground" })}
                      />
                    ) : panel === "update" ? (
                      <UpdatePanel
                        busy={busy}
                        setBusy={setBusy}
                        onUpdated={() =>
                          api("/exercises")
                            .then(({ ids, exercises, course }) => {
                              setCourse(course);
                              setIds(ids);
                              setCatalog(exercises);
                              setWorkspaceKey((k) => k + 1);
                            })
                            .catch(() => {})
                        }
                      />
                    ) : panel === "actions" ? (
                      <ActionsPanel state={actions} />
                    ) : panel === "processes" ? (
                      <ProcessesPanel />
                    ) : panel === "tutor" ? (
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
                                  <Prose>{message.content}</Prose>
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
                    ) : panel === "preview" && appInfo?.type ? (
                      <div className="tools-panel app-panel">
                        <div className="app-panel-head">
                          <span>{appInfo.type === "export" ? "Export app: console output and exported values" : "Workshop-served app"}</span>
                          <label className="field">
                            Variant{" "}
                            <Select
                              aria-label="App variant"
                              value={appVariant}
                              onChange={(e) => {
                                const v = e.target.value;
                                setAppVariant(v);
                                api("/content/app?id=" + encodeURIComponent(selected) + "&variant=" + v).then(setAppInfo).catch(() => {});
                              }}
                            >
                              <option value="playground">playground</option>
                              <option value="problem">problem</option>
                              <option value="solution">solution</option>
                            </Select>
                          </label>
                          <label>
                            <input type="checkbox" checked={reloadPreview} onChange={(e) => setReloadPreview(e.target.checked)} /> Reload when playground files change
                          </label>
                        </div>
                        {sandboxOrigin && appInfo.url && (
                          <AppBrowser
                            base={appInfo.url}
                            initialRoute={appInfo.type === "export" ? "/" : appInfo.initialRoute}
                            kind="sandbox"
                            sandboxOrigin={sandboxOrigin}
                            title={"App preview " + selected}
                            reloadKey={previewKey}
                            navigate={appNavigate}
                          />
                        )}
                        <BrowserTests
                          key={selected + appVariant}
                          id={selected}
                          variant={appVariant}
                          tests={appInfo.browserTests}
                          sandboxOrigin={sandboxOrigin}
                          onSummary={(status) => setActivity("Browser tests " + status)}
                        />
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
                        <label>
                          <input
                            type="checkbox"
                            checked={reloadPreview}
                            onChange={(e) => setReloadPreview(e.target.checked)}
                          />{" "}
                          Reload preview when playground files change
                        </label>
                        {portConflict && !preview && (
                          <FreePort
                            port={portConflict}
                            onFreed={(message) => {
                              setPortConflict(null);
                              setResult(message);
                            }}
                          />
                        )}
                        {preview && (
                          <>
                            <ExternalLink href={preview}>
                              Open preview externally
                            </ExternalLink>
                            <AppBrowser
                              base={preview}
                              kind="preview"
                              title="Live preview"
                              reloadKey={previewKey}
                              navigate={appNavigate}
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
                        <label className="field">
                          Local tool{" "}
                          <Select
                            aria-label="Local tool"
                            value={toolId}
                            onChange={(e) => setToolId(e.target.value)}
                          >
                            {exercise.tools?.map((tool) => (
                              <option key={tool.id} value={tool.id}>
                                {tool.title}
                              </option>
                            ))}
                          </Select>
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
                                <ExternalLink href={tool.url}>
                                  Open {tool.title} externally
                                </ExternalLink>
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
                        <AnsiOutput
                          className="notice"
                          role="status"
                          text={
                            panel === "preview"
                              ? "Preview is available for labs that provide a browser application. This lab uses the console and test runner."
                              : result || "Run tests to view output here."
                          }
                        />
                      </>
                    )}
                  </section>
                  </PanelBoundary>
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
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="heading">
                <span className="pill">Get started</span>
                <h1>Choose a lab</h1>
                <p>Select a lab on the left to create an editable playground.</p>
              </div>
              {ids.length > 0 && (
                <CoursePage
                  name="intro"
                  config={contentConfig}
                  course={course}
                  ids={ids}
                  completed={completed}
                  catalog={catalog}
                  onChoose={(id) => choose(id)}
                  onLink={contentClick}
                />
              )}
            </>
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
