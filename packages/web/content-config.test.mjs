// Content settings, apps and
// cloud-editor links, for native and apps-layout courses.
import test from "node:test";
import assert from "node:assert/strict";
import { contentConfig, appInfo, parseRepository, fillForm, validateApp, validateCloudEditor, imageRef, httpsUrl } from "./content-config.mjs";
import { labConfig } from "./runtime.mjs";
import { courseConfig } from "./course.mjs";
import { nativeCourse, appsCourse } from "./test-support/workspace-course.mjs";
import { APPS_SETTINGS_KEY as SETTINGS } from "../core/apps-layout.mjs";

test("a course that declares nothing keeps working with defaults", async () => {
  const root = await nativeCourse();
  const c = await contentConfig(root);
  assert.equal(c.title, "Workspace course");
  assert.deepEqual(c.pages, { intro: "exercises/README.md", finished: "exercises/FINISHED.md" });
  assert.deepEqual(c.forms, {});
  assert.deepEqual(c.notifications, []);
  assert.equal(c.repository, undefined);
  assert.deepEqual(c.warnings, []);
  const app = await appInfo(root, "01", "problem", { lab: await labConfig(root, "01") });
  assert.equal(app.type, null);
  assert.equal(app.cloud, null);
});

test("native settings are validated; invalid values are dropped with warnings, never thrown", async () => {
  const root = await nativeCourse({
    course: {
      subtitle: "Sub",
      instructor: { name: "Ada", url: "https://example.com/ada", avatar: "img/ada.png" },
      product: { name: "Prod", url: "javascript:alert(1)", logo: "../../etc/logo.png" },
      repository: { github: "owner/repo", branch: "dev", root: "course" },
      forms: { workshop: "https://f.test/?w={workshopTitle}", exercise: "http://insecure.test/{exerciseTitle}" },
      support: { text: "Ask", url: "https://help.test", email: "help@example.com" },
      community: { title: "Forum", url: "ftp://forum.test" },
      pages: { intro: "../outside.md", finished: "docs/done.mdx" },
      notifications: [
        { id: "ok", title: "Hello", message: "Hi", type: "warning", link: "https://n.test", expiresAt: "2030-01-01" },
        { id: "bad id!", title: "x", message: "y" },
        { id: "badlink", title: "x", message: "y", link: "javascript:alert(1)" },
        { id: "badtype", title: "x", message: "y", type: "pink" },
      ],
      notificationsFeed: "http://feed.test",
    },
  });
  const c = await contentConfig(root);
  assert.equal(c.subtitle, "Sub");
  assert.deepEqual(c.instructor, { name: "Ada", url: "https://example.com/ada", avatar: { path: "img/ada.png" } });
  assert.deepEqual(c.product, { name: "Prod", url: undefined, logo: undefined });
  assert.deepEqual(c.repository, { owner: "owner", repo: "repo", branch: "dev", root: "course" });
  assert.deepEqual(c.forms, { workshop: "https://f.test/?w={workshopTitle}" });
  assert.deepEqual(c.support, { text: "Ask", url: "https://help.test/", email: "help@example.com" });
  assert.equal(c.community, undefined);
  assert.deepEqual(c.pages, { intro: "exercises/README.md", finished: "docs/done.mdx" });
  assert.deepEqual(c.notifications.map((n) => n.id), ["ok"]);
  assert.equal(c.notifications[0].expiresAt, "2030-01-01T00:00:00.000Z");
  assert.equal(c.notificationsFeed, undefined);
  for (const w of ["forms.exercise", "community.url", "pages.intro", "notificationsFeed", "bad id!", "badlink", "badtype"]) assert.ok(c.warnings.some((x) => x.includes(w)), "warning for " + w);
  // Content settings never leak into the course outline.
  const outline = await courseConfig(root);
  for (const key of ["forms", "notifications", "support", "repository", "instructor", "pages"]) assert.equal(outline[key], undefined);
});

test("apps-layout package.json settings: metadata, githubRoot, forms, notifications, appType and per-app config", async () => {
  const root = await appsCourse({
    pkg: {
      [SETTINGS]: {
        title: "Apps Title",
        subtitle: "Apps sub",
        instructor: { name: "Ada", avatar: "/images/ada.png", xHandle: "ada_example" },
        product: { host: "courses.example.org", displayName: "Example Courses", logo: "/logo.svg" },
        githubRoot: "https://github.com/example-org/react-basics/tree/main",
        forms: { workshop: "https://docs.google.com/forms/x?w={workshopTitle}", exercise: "https://docs.google.com/forms/y?e={exerciseTitle}" },
        notifications: [{ id: "n1", title: "Course note", message: "m", type: "info", expiresAt: null }],
        appType: "export",
      },
    },
    files: {
      "exercises/01.basics/01.problem.start/index.js": "export const a = 1\n",
      "exercises/01.basics/01.problem.start/index.test.js": "// browser test\n",
      "exercises/01.basics/01.problem.start/package.json": { name: "p", [SETTINGS]: { initialRoute: "/start", stackBlitzConfig: { view: "preview", hidedevtools: "1" } } },
      "exercises/01.basics/01.solution.start/index.js": "export const a = 2\n",
    },
  });
  const c = await contentConfig(root);
  assert.equal(c.title, "Apps Title");
  assert.equal(c.subtitle, "Apps sub");
  assert.equal(c.instructor.url, "https://x.com/ada_example");
  assert.equal(c.instructor.avatar, undefined, "absolute paths are not course images");
  assert.equal(c.product.url, "https://courses.example.org/");
  assert.deepEqual(c.repository, { owner: "example-org", repo: "react-basics", branch: "main", root: "" });
  assert.deepEqual(c.pages, { intro: "exercises/README.mdx", finished: "exercises/FINISHED.mdx" });
  assert.deepEqual(c.notifications.map((n) => n.id), ["n1"]);
  assert.equal(c.appType, "export");
  const app = await appInfo(root, "01", "problem", { lab: await labConfig(root, "01") });
  assert.equal(app.type, "export");
  assert.equal(app.initialRoute, "/start");
  assert.equal(app.entry, "index.js");
  assert.deepEqual(app.browserTests, ["index.test.js"]);
  assert.match(app.cloud.problem.stackblitz, /^https:\/\/stackblitz\.com\/github\/example-org\/react-basics\/tree\/main\/exercises\/01\.basics\/01\.problem\.start\?title=[^&]+&view=preview&hidedevtools=1$/);
  assert.match(app.cloud.solution.stackblitz, /view=editor&file=index\.js/, "simple apps open the editor on the first index file");
  assert.equal(app.cloud.solution.github, "https://github.com/example-org/react-basics/tree/main/exercises/01.basics/01.solution.start");
});

test("apps-layout stackBlitzConfig: null hides that app's cloud links; testTab.enabled false hides browser tests; dev apps are not simple", async () => {
  const root = await appsCourse({
    pkg: { [SETTINGS]: { githubRepo: "https://github.com/o/r" } },
    files: {
      "exercises/01.basics/01.problem.start/package.json": { name: "p", scripts: { dev: "vite" }, [SETTINGS]: { stackBlitzConfig: null, testTab: { enabled: false } } },
      "exercises/01.basics/01.problem.start/a.test.js": "",
    },
  });
  const app = await appInfo(root, "01", "problem", { lab: await labConfig(root, "01") });
  assert.equal(app.type, null);
  assert.equal(app.cloud.problem, undefined);
  assert.match(app.cloud.solution.stackblitz, /^https:\/\/stackblitz\.com\/github\/o\/r\/tree\/main\//);
  assert.equal(app.testTab, false);
  assert.deepEqual(app.browserTests, []);
});

test("native lab.json#app: explicit browser tests that exist, entry detection, cloud overrides and false", async () => {
  const root = await nativeCourse({
    course: { repository: { github: "o/r", branch: "feature/x-y" } },
    files: {
      "exercises/01/lab.json": { schemaVersion: 1, runtime: "node", entry: "index.mjs", title: "First", app: { type: "simple", browserTests: ["a.browser.js", "missing.browser.js"] }, cloudEditor: { file: "index.mjs", startScript: "dev", ignored: "x" } },
      "exercises/01/problem/a.browser.js": "",
      "exercises/02/lab.json": { schemaVersion: 1, runtime: "node", entry: "index.mjs", title: "Second", cloudEditor: false },
    },
  });
  const lab = await labConfig(root, "01");
  assert.deepEqual(lab.cloudEditor, { file: "index.mjs", startScript: "dev" });
  const app = await appInfo(root, "01", "problem", { lab });
  assert.deepEqual(app.browserTests, ["a.browser.js"]);
  assert.equal(app.entry, "index.mjs");
  assert.match(app.cloud.problem.stackblitz, /\/tree\/feature\/x-y\/exercises\/01\/problem\?.*file=index\.mjs.*startScript=dev/);
  assert.equal((await appInfo(root, "02", "problem", { lab: await labConfig(root, "02") })).cloud, null);
});

test("validators refuse hostile values", () => {
  assert.throws(() => validateApp({ type: "server" }), /app.type/);
  assert.throws(() => validateApp({ type: "simple", entry: "../x.js" }), /entry/);
  assert.throws(() => validateApp({ type: "simple", entry: ".hidden/x.js" }), /entry/);
  assert.throws(() => validateApp({ type: "simple", initialRoute: "//evil.test" }), /initialRoute/);
  assert.throws(() => validateApp({ type: "simple", initialRoute: "javascript:alert(1)" }), /initialRoute/);
  assert.throws(() => validateApp({ type: "simple", browserTests: ["../../x.js"] }), /browserTests/);
  assert.throws(() => validateCloudEditor({ title: "a\nb" }), /title/);
  assert.equal(validateCloudEditor(null), false);
  for (const bad of ["owner", "o/r/x", "../r", { github: "o/r", branch: "a..b" }, { github: "o/r", branch: "-x\u0000" }, { github: "o/r", root: "../x" }, "https://gitlab.com/o/r", "http://github.com/o/r", { github: ".o/r" }])
    assert.equal(parseRepository(bad), undefined, JSON.stringify(bad));
  assert.deepEqual(parseRepository("https://github.com/o/r.git"), { owner: "o", repo: "r", branch: "main", root: "" });
  assert.deepEqual(parseRepository("https://github.com/o/r/blob/v2/sub/dir"), { owner: "o", repo: "r", branch: "v2", root: "sub/dir" });
  assert.equal(fillForm("https://f.test/?w={workshopTitle}&e={exerciseTitle}", { workshopTitle: "A & B", exerciseTitle: "x#y" }), "https://f.test/?w=A%20%26%20B&e=x%23y");
  assert.equal(fillForm("{workshopTitle}", { workshopTitle: "javascript:alert(1)" }), undefined);
  assert.equal(imageRef("a/../b.png"), undefined);
  assert.equal(imageRef(".git/x.png"), undefined);
  assert.equal(imageRef("x.html"), undefined);
  assert.equal(httpsUrl("https://u:p@x.test"), undefined);
});
