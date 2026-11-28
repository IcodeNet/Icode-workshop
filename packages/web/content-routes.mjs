// API routes: content settings, pages, apps, notifications. Called by
// server.mjs after its Host/Origin/Sec-Fetch-Site checks and mutation gate.
import { join } from "node:path";
import { validateId } from "../core/index.mjs";
import { stepLayout } from "../core/layout.mjs";
import { contentConfig, appInfo, fillForm } from "./content-config.mjs";
import { renderDocument } from "./lessons.mjs";
import { renderSafe as renderLesson, policy } from "./markdown.mjs";
import { labConfig } from "./runtime.mjs";
import { courseConfig, readProgress } from "./course.mjs";
import { activeNotifications, muteNotification } from "./notifications.mjs";
import { randomBytes } from "node:crypto";

// Changes on every engine start: the UI resets the sandbox origin once per value.
export const SANDBOX_GENERATION = randomBytes(8).toString("hex");

// Rendered output without server-only fields (check-question answers).
const pub = ({ questions, text, ...rest }) => rest;
const image = (ref, sandboxOrigin) => (!ref ? undefined : ref.url ?? policy(ref.path, { kind: "image", sandboxOrigin }).href);

const GUIDE = `# Using this workshop

## Lessons and steps

Each step has a **problem** (where you start), a **solution** (the reference) and your own **playground**, a private copy of the problem that you edit. Pick a step on the left to create its playground. Your playgrounds persist between sessions.

## Working on a step

- **Playground**: edit files in the browser or open them in your editor. Save, then run the tests.
- **Run tests**: runs the step's tests against your saved playground. Steps with a browser app can also run **browser tests** in the Preview panel.
- **Diff**: compare your playground with the solution or any other step. Lesson links such as "View the diff" open it directly.
- **Preview**: steps with a web app show it in the in-workshop browser (address bar, back/forward, reload, open in a new tab). Export apps show console output and exported values.
- **Saved**: your playground is saved before every reset or replace, so you can restore earlier work.

## Keyboard

<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> (or <kbd>Ctrl</kbd>+<kbd>K</kbd>) opens the command palette: search lessons, files and commands. <kbd>?</kbd> lists every shortcut; Preferences lets you change them. In the diff: <kbd>j</kbd>/<kbd>k</kbd> next/previous file, <kbd>n</kbd>/<kbd>p</kbd> next/previous change, <kbd>u</kbd> unified/split, <kbd>?</kbd> help. In the editor: <kbd>Ctrl</kbd>+<kbd>S</kbd> saves.

## Safety

Lessons are rendered without running any of their code. Apps and browser tests run on a separate sandbox origin, which cannot read the workshop or call its API. Nothing here needs a login.
`;

function structure(root, id) {
  const layout = stepLayout(root, id);
  const rel = (p) => p.slice(root.length + 1).replaceAll("\\", "/");
  return `\n## Workspace structure for step ${id}\n\n| Copy | Folder |\n|---|---|\n| Problem (read-only starting point) | \`${rel(layout.problem)}\` |\n| Solution (reference) | \`${rel(layout.solution)}\` |\n| Your playground | \`.workshop/playgrounds/${id}\` |\n\nThe course stores your progress, saved playgrounds and preferences under \`.workshop/\` in the course folder.\n`;
}

export async function handleContent({ req, res, url, root, json, readBody, sandboxOrigin }) {
  const path = url.pathname;
  if (path === "/api/content/config" && req.method === "GET") {
    const c = await contentConfig(root);
    const course = await courseConfig(root);
    const title = c.title ?? course.title;
    return json(res, 200, {
      sandboxOrigin,
      sandboxGeneration: SANDBOX_GENERATION,
      title,
      subtitle: c.subtitle,
      instructor: c.instructor && { name: c.instructor.name, url: c.instructor.url, avatar: image(c.instructor.avatar, sandboxOrigin) },
      product: c.product && { name: c.product.name, url: c.product.url, logo: image(c.product.logo, sandboxOrigin) },
      forms: { workshop: fillForm(c.forms.workshop, { workshopTitle: title }) },
      support: c.support && { ...c.support, html: c.support.text ? (await renderLesson(c.support.text, { sandboxOrigin })).html : undefined, text: undefined },
      community: c.community,
      repository: c.repository ? { url: `https://github.com/${c.repository.owner}/${c.repository.repo}` } : undefined,
      warnings: c.warnings,
    }), true;
  }
  if (path === "/api/content/page" && req.method === "GET") {
    const name = url.searchParams.get("name");
    const c = await contentConfig(root);
    const course = await courseConfig(root);
    const title = c.title ?? course.title;
    if (name === "guide") {
      const id = url.searchParams.get("id");
      let source = GUIDE;
      if (id) {
        validateId(id);
        source += structure(root, id);
      }
      return json(res, 200, { name, title: "Guide", exists: true, ...pub(await renderLesson(source, { sandboxOrigin })) }), true;
    }
    if (name === "support") {
      const md = [c.support?.text, c.support?.url && `[Get support](${c.support.url})`, c.support?.email && `Email: ${c.support.email}`, c.community && `[${c.community.title}](${c.community.url})`].filter(Boolean).join("\n\n");
      return json(res, 200, { name, title: "Support", exists: Boolean(md), ...pub(await renderLesson(md || "This course has no support information.", { sandboxOrigin })), email: c.support?.email }), true;
    }
    if (name !== "intro" && name !== "finished") return json(res, 400, { error: "Unknown page" }), true;
    let doc = null;
    try {
      doc = await renderDocument(root, join(root, ...c.pages[name].split("/")), { stepId: null, sandboxOrigin });
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const progress = await readProgress(root);
    return json(res, 200, {
      name,
      title: name === "intro" ? title : "Workshop complete",
      exists: Boolean(doc),
      html: doc?.html ?? "",
      toc: doc?.toc ?? [],
      warnings: doc?.warnings ?? [],
      completed: progress.completed.length,
      total: course.ids.length,
      form: name === "finished" ? fillForm(c.forms.workshop, { workshopTitle: title }) : undefined,
    }), true;
  }
  if (path === "/api/content/app" && req.method === "GET") {
    const id = url.searchParams.get("id");
    validateId(id);
    const variant = url.searchParams.get("variant") || "playground";
    const lab = await labConfig(root, id);
    const app = await appInfo(root, id, variant, { lab });
    const c = await contentConfig(root);
    const course = await courseConfig(root);
    const module = course.modules?.find((m) => m.steps?.includes(id));
    const group = module?.exercises?.find((e) => e.steps.includes(id));
    const steps = group?.steps ?? module?.steps ?? [id];
    return json(res, 200, {
      ...app,
      variant,
      url: app.type ? `${sandboxOrigin}/${app.type === "export" ? "export" : "app"}/${id}/${variant}/` : null,
      exerciseForm: fillForm(c.forms.exercise, { workshopTitle: c.title ?? course.title, exerciseTitle: group?.title ?? module?.title ?? lab.title }),
      exercise: { title: group?.title ?? module?.title ?? lab.title, last: steps.at(-1) === id, steps },
    }), true;
  }
  if (path === "/api/notifications" && req.method === "GET")
    return json(res, 200, await activeNotifications(root, { sandboxOrigin })), true;
  if (path === "/api/notifications/mute" && req.method === "POST") {
    const { id } = await readBody(req);
    return json(res, 200, await muteNotification(root, id)), true;
  }
  return false;
}
