# Stage 3: content

Stage 3 of the Epic gap analysis covers lesson rendering (A4), app types and the in-workshop browser (A3, C2), in-browser tests (C5), intro and finished pages (A5), notifications, forms and guide pages (A7–A9), cloud-editor links (C9), plus the content-side rows A1 (workshop metadata) and A10 (per-app configuration). This page records the design and the security model. Every new field is optional: a native or Epic-layout course that declares nothing renders as before, only with better lessons.

Lessons, pages, notifications and apps are **course-author content**. Course scripts are trusted (Stage 1), but rendered content is treated as untrusted: a copied lesson, a pasted snippet or a compromised feed must not run script in the workshop UI or reach the engine API.

## Origins

| Origin | Serves | May call the API |
|---|---|---|
| `http://127.0.0.1:5173` (UI) | the React UI, `/api` proxied to 4317 | yes (the only allowed origin) |
| `http://127.0.0.1:4317` (API) | JSON API | — |
| `http://127.0.0.1:4318` (**sandbox**, `WORKSHOP_SANDBOX_PORT`) | simple and export apps, in-browser tests, the Mermaid renderer, lesson images | no |
| preview ports (Stage 1) | the course's own dev servers | no |

The sandbox server is a separate `http.Server` started with the API (`web/sandbox.mjs`). It is read-only (GET/HEAD only) and checks:

- `Host` is `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding);
- `Sec-Fetch-Site` is `same-origin`, `same-site` or `none` (a cross-site page cannot embed, script-include or fetch a learner's playground);
- every path is validated with `validateId`, the variant allowlist and `assertSafePath` (no `..`, no absolute paths, no symlinks out of the variant).

Every sandbox response sends `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-site`, `Referrer-Policy: no-referrer` and a CSP with `connect-src 'self'` and `frame-ancestors http://127.0.0.1:5173`. The exceptions are static engine scripts with no course content: `/__icode/mermaid-frame.js` and Mermaid's ESM build under `/__icode/mermaid/` (entry and chunks, no source maps, never the elk chunk). They are `Cross-Origin-Resource-Policy: cross-origin`, `Access-Control-Allow-Origin: *` (module scripts from an opaque origin need CORS) and accepted cross-site, because the opaque-origin Mermaid frame's requests are cross-site. The API refuses sandbox requests twice: their `Origin` is not the UI origin, and their `Sec-Fetch-Site` is `same-site`, which the API already rejects. Apps that need their own backend use a Stage 1 preview (dev server on its own port).

In the UI, sandbox iframes use `sandbox="allow-scripts allow-forms allow-same-origin allow-modals"`. `allow-same-origin` here means the sandbox origin, never the UI's. There is no `allow-top-navigation` and no `allow-popups` (a popup would inherit `allow-same-origin` on whatever it opens). The Mermaid frame gets only `allow-scripts`, so it has an opaque origin. Messages from frames are accepted only when `event.source` is that frame's window and `event.origin` is the sandbox origin (or `"null"` for Mermaid). Payloads are validated, length-capped and rendered as text.

### The UI origin never serves course content (BL-1)

The review of the first version of this PR found an escape. An app could navigate its frame, or a popup, to Vite's `/@fs/<engine>/examples/…/evil.html`. Vite served that file as HTML on the UI origin, where it was same-origin with the workshop and could call the API. The UI server (`packages/web/vite.config.mjs`, used by `workshop start` and `vite preview`) is now locked down in layers:

- **File serving.** `server.fs.strict` is on. `fs.allow` holds only the UI sources (`src/`, `index.html`, `public/`) and installed dependencies. `fs.deny` adds `**/.workshop/**`, `**/exercises/**` and `**/examples/**`, so the course, examples, playgrounds and the rest of the engine checkout are refused, through `/@fs/` and through root-relative paths alike.
- **Navigation guard** (middleware, also in `vite preview`): a document or frame request is answered only for `/`, `/index.html` and `/api/…`, and only for direct or same-origin navigation. A navigation from the sandbox (`Sec-Fetch-Site: same-site`), or a `/@fs/` request with a document destination, gets 403.
- **Headers on every UI response:** `X-Frame-Options: DENY` and a strict CSP. Scripts are `'self'` plus a random per-start nonce (Vite `html.cspNonce`), with `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'` and `form-action 'self'`. Frames, images and media are limited to the sandbox, previews and loopback tools. The headers also include `nosniff`, `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy: same-origin`. CORS allows the UI origin only.
- **API.** Every response is `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `sandbox` and `nosniff`. Browser requests that mutate (they carry `Origin` or Fetch Metadata) must also send `x-icode-session`, a random per-process token. The UI reads it from `GET /api/session`, which answers only same-origin `fetch` requests (`Sec-Fetch-Site: same-origin`, `Sec-Fetch-Dest: empty`). Non-browser clients (CLI, tests) send no Origin and are unaffected.
- **Production:** the built UI is only ever served by `vite preview`, which has the same headers, guard and CORS. Preview serves `dist/` only and has no `/@fs/`. `workshop start` runs the dev server with the restrictions above.
- **Regression tests** (`tests/browser/content.spec.mjs`). Course-like HTML is planted in the engine root, in `packages/web/` and in `examples/`. A sandboxed app (fixture step 07) navigates its frame to each file, opens popups, and runs top-level in a new tab and navigates. Progress stays unchanged, no script runs on the UI origin, and the direct requests get 403. The test fails against the previous Vite config.

### No service workers on the sandbox origin (SF-A)

A course app could register a service worker on `:4318`. Such a worker persists across restarts and rewrites later loads of its `/app/<step>/<variant>/` path, for that course and for any course served there later, for example to forge browser-test results. It stays on the sandbox origin, but it is still not acceptable. Two layers stop it:

- **Refused at the source.** The sandbox server answers 403 to any request with a `Service-Worker` header or `Sec-Fetch-Dest: serviceworker`, which browsers send when fetching a worker script, so registration fails. Course files never get a `Service-Worker-Allowed` header, so a worker could never claim more than its own app path anyway.
- **Cleared on every engine start.** `/api/content/config` carries a random `sandboxGeneration`. Once per generation, the UI loads `/__icode/reset` in a hidden frame before it shows any app or diagram. That page answers `Clear-Site-Data: "storage", "cache"`, which removes service workers, caches and storage left on the sandbox origin by older engines or earlier sessions. `/__icode/` is never inside an app's scope, so no worker can intercept the reset. Apps therefore keep `localStorage` within one engine run, not across restarts.
- **Not done: one origin per course or step.** That would need a port per course (or wildcard loopback hostnames), and an in-browser-test origin per step. The two layers above remove the persistence that made sharing the origin dangerous.

Tests: `sandbox.test.mjs` checks the refusal and the reset headers. In Playwright, an app's `register()` fails in the frame and top-level. A worker installed past the guard (simulating an older engine) is gone after the workshop UI opens. Both tests fail when their layer is removed.

## A4. Lessons

### Pipeline (`web/markdown.mjs`, server-side)

1. **Size, shape and time limits.** Rendering runs in a worker thread (`web/markdown-worker.mjs`). A render that takes more than 5 s is cut off: the worker is terminated and a new one starts. Pathological Markdown, such as a 100 KB run of `_*` (quadratic emphasis resolution, over a minute on the event loop), therefore never blocks the API. Sources over 256 KB, or nested more than 200 levels of blockquotes and lists, are not parsed. The lesson shows a notice and the escaped source, cut to 20,000 characters. Any parser failure falls back the same way. A lesson never breaks the page.
2. **MDX subset, never evaluated.** Emoji shortcodes (`:tada:`) become emoji outside code (`remark-emoji`). JSX is not compiled or executed. Outside code, known components are rewritten to HTML elements that the next steps understand. Self-closing tags become open/close pairs, so `<InlineFile />` cannot swallow the rest of the lesson. JSX expressions (`{' '}`, `{/* … */}`) and `import`/`export` lines are removed.
3. **Parse** with `remark-parse` + `remark-gfm` (tables, task lists, strikethrough, autolinks, footnotes), then `remark-rehype` with raw HTML parsed by `rehype-raw` (parse5, HTML-spec error recovery for malformed markup).
4. **Components** become plain elements (see below).
5. **Sanitize** with `rehype-sanitize` and an explicit allowlist: GitHub's default schema minus `id`/`name`, plus `details`/`summary`, `kbd`, callout `div`s, a few `class` values and `data-*` attributes the engine itself sets. `script`, `style`, `iframe`, `object`, `embed`, `form`, `svg`, `math`, event-handler attributes and `style` attributes are removed.
6. **URL policy** (after sanitizing, on every `href` and `src`):
   - `https:` URLs are kept, and so are `http:` **links** to `localhost`, `127.0.0.1` or `[::1]` (lessons often point at a local dev server; never images). External links get `rel="noopener noreferrer nofollow"` and `target="_blank"`.
   - `#…` fragments are kept. Engine fragments are `#file=`, `#diff=`, `#app=`, `#step=` and `#h-…` headings.
   - Relative paths are resolved against the lesson file. If the result stays inside the course, a link becomes `#course=<path>`: the UI opens the step it belongs to or the file in the playground. An image is served from the sandbox origin (`/asset/<path>`, image types only, with `Content-Security-Policy: sandbox`), so an SVG opened directly cannot run script on any origin.
   - Everything else (`javascript:`, `data:`, `vbscript:`, non-loopback `http:`, `file:`, protocol-relative `//`, absolute paths, paths that escape the course, encoded variants) is removed. The text stays and the element gets `data-blocked-url`.
7. **Headings** get stable, de-duplicated ids prefixed `h-` (no DOM clobbering: author ids are never kept) and a hover anchor. h2/h3 headings form the **table of contents**.
8. **Code.** Fenced code is highlighted server-side with **Shiki**, using bundled grammars loaded on demand and the dual `github-light`/`github-dark` themes (CSS variables, so it follows the UI theme). The language comes from the fence info. Meta can carry `filename=`/`title=` and line highlights: `{1,3-5}`, `lines=1,3-5` (Epic) or `highlight=`. Shiki gets only the text of the code node, so its output is trusted HTML (spans and colour variables). Blocks over 100 KB, or in unknown languages, are rendered escaped and unhighlighted. `diff` blocks mark `+`/`-` lines.
9. **Mermaid.** A `mermaid` fence becomes a `<figure class="mermaid-diagram">` whose source is a `data-source` attribute (escaped text) and a visible `<pre>` fallback. It is rendered in the browser, in a sandboxed iframe on the sandbox origin, with no API access:
   - the page `/__icode/mermaid.html` loads Mermaid's ESM build from `node_modules` (no CDN, works offline). Diagram types and layouts load on demand. The layout is `dagre`: Mermaid 12 defaults to elk, but the elk chunk (EPL-2.0/GPL `elkjs`) is never served, so a diagram that explicitly asks for elk falls back to its source;
   - `securityLevel: "strict"` (labels sanitized, `click` callbacks disabled);
   - CSP: `default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'`;
   - an opaque origin (`sandbox="allow-scripts"` only);
   - the theme follows the UI theme class (`.app.dark` → `dark`, otherwise `default`) and re-renders when it changes. The UI is dark-only today (G3), but Shiki and Mermaid already switch with the class;
   - diagrams over 50 KB are not rendered and keep the source.

   Epic renders Mermaid on a worker and falls back to `mermaid` in the main page. Icode never runs Mermaid in the workshop origin.

### Components

| Epic / author markup | Rendered as |
|---|---|
| `<callout-info|success|warning|danger|muted>` and GFM alerts `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` | `<div class="callout callout-…" role="note">` with a label |
| `<InlineFile file="x">label</InlineFile>` | link `#file=x`, opens the file in the playground |
| `<LinkToApp to="/path">label</LinkToApp>` | link `#app=/path`, opens the app panel at that route |
| `<DiffLink>`, `<DiffLink app1="01.problem" app2="02.solution">`, `<NextDiffLink>`, `<PrevDiffLink>` | `#diff=step`, `#diff=a..b`, `#diff=next`, `#diff=prev` (Stage 2). On course pages (no step context) they render as inactive text with a hint instead of failing. Epic throws a server error when an exercise intro uses one |
| `<EpicVideo url>`, `<VideoEmbed url>` | an `https:` link card ("Watch the video"). No third-party iframe, no tracking |
| `<details>`/`<summary>`, `<kbd>`, `<sub>`, `<sup>` | kept |
| any other component | removed, children kept as text |

### Caching and offline

The parent page sends diagram source to the opaque frame with `postMessage(…, "*")`, the only possible target for an opaque origin. The source is lesson text, not a secret. The frame accepts messages only from its parent window with the UI origin, and posts its results to the UI origin only.

Rendered HTML is cached in memory by course root, path, mtime, size, step and sandbox origin (LRU, 200 entries). Shiki grammars, themes and Mermaid ship with the engine, so lessons render with no network.

## A3/C2. Apps and the in-workshop browser

### App types

A step's app is described by `lab.json#app` (native) or detected (Epic layout):

```json
{
  "app": {
    "type": "simple",
    "initialRoute": "/",
    "browserTests": ["counter.browser.js"]
  }
}
```

| `type` | Served by | Behaviour |
|---|---|---|
| `simple` | sandbox `/app/<step>/<variant>/` | `index.html` from the variant, or a generated page that loads `index.(tsx|ts|jsx|js|mjs)`. `.ts`, `.tsx`, `.jsx`, `.js` and `.mjs` requested by the page are bundled with esbuild (ESM, sourcemaps inline), cached by mtime |
| `export` | sandbox `/export/<step>/<variant>/` | bundles `entry` (default `index.*`), captures `console.*` and shows every named export, pretty-printed as text (Epic's export apps) |
| *(none)* with `preview` | Stage 1 dev-server preview | unchanged |

Epic layout: an app whose `package.json` has no `dev` script (or that has no `package.json`) is `simple`. Settings are read from each app's own `package.json` (the problem app for the playground). It is `export` when `package.json#epicshop.appType` (app or workshop root) is `"export"`. `initialRoute`, `testTab.enabled` and `stackBlitzConfig` are read from the same place.

Bundling never executes course code on the engine. An esbuild plugin refuses any file that resolves outside the course root, except the engine's own test runtime and its dependencies. So `import "../../../../etc/passwd.json"` is a build error, not a leak. Builds time out after 20 s, and output over 10 MB is refused.

Not provided: Epic's in-process app API (`api.server.ts`, which the Epic workshop server imports and runs). Icode never runs course code inside the engine. An app with a backend uses a Stage 1 preview (its own dev server on its own port).

### In-workshop browser (C2)

The **Preview** panel shows the variant tabs (playground, problem, solution), back, forward, reload, an address bar (path only: the origin is fixed to the app's), "open in new tab" and the Stage 1 file-change reload. For sandbox apps, a small script injected into served HTML reports in-app navigation (`pushState`, `popstate`, `hashchange`) to the parent with `postMessage` to the UI origin. Dev-server previews keep their own iframe. The address bar works there too, with history kept by the UI. The address bar accepts only paths. Absolute URLs and `javascript:` are refused.

## C5. In-browser tests

- Native: `lab.json#app.browserTests` lists files. Epic: `*.test.*` files in the root of a simple app without a `test` script, as in Epic.
- Running a test loads `/app/<step>/<variant>/?__icode_test=<file>`. The app's own `index.html` (or the generated page) gets the bundled test as an extra module.
- `@epic-web/workshop-utils/test` and `@icodenet/workshop-test` both resolve to the engine's runtime (`web/browser-test-runtime.mjs`). It exports `testStep(title, fn)`, `expect` (equality, truthiness, `toContain`, `toHaveLength`, `toMatch`, `toThrow`, `toBeInTheDocument`, `toHaveTextContent`, `toHaveAttribute`, `.not`, `.resolves`/`.rejects`), `dtl` (`@testing-library/dom`, bundled) and `waitFor`.
- Results stream to the UI per step (`pass`/`fail`, error message, duration) by `postMessage` to the UI origin only. A file that reports nothing within 30 s is marked timed out. **No login or entitlement gate** (Epic gates the tab).
- Isolation: the tests run on the sandbox origin, so they can read the app DOM, but not the UI or the API.
- Not built yet: Epic's `setupInBrowserTests`, which runs every solution's browser tests headlessly with Playwright for authors.

## A5. Intro and finished pages

| Page | Native | Epic layout |
|---|---|---|
| Workshop intro | `course.json#pages.intro`, default `exercises/README.md` | `exercises/README.mdx` |
| Workshop finished | `course.json#pages.finished`, default `exercises/FINISHED.md` | `exercises/FINISHED.mdx` |
| Exercise intro/finished | `README.md`/`FINISHED.md` in the step folder (lesson documents) | `<exercise>/README.mdx`, `FINISHED.mdx` |

The **Course home** page shows the title, subtitle, instructor and product (A1), the intro, the module/step outline with progress, and "Start"/"Continue". The **Finished** page shows completion, the finished document, the workshop feedback form and next steps. Reaching the last step of an exercise shows "Exercise complete": the exercise feedback form and "Next exercise →".

## A7. Notifications

```json
{ "notifications": [{ "id": "mar-update", "title": "New lesson", "message": "Lesson 04 is out.", "type": "info", "link": "https://…", "expiresAt": "2027-01-01" }],
  "notificationsFeed": "https://example.com/feed.json" }
```

- Sources: `course.json#notifications`, Epic `package.json#epicshop.notifications`, and an optional feed (`https:` only, JSON or JSON5 like Epic's). The feed is fetched by the API with a 5 s timeout, a 64 KB cap, `redirect: "error"`, no cookies, cached for 1 h. A failed fetch keeps the last good copy, and offline is silent. `ICODE_NOTIFICATIONS_FEED=0` disables it.
- Messages are Markdown, rendered through the lesson pipeline (sanitiser, URL policy).
- Schema: `id` (`[A-Za-z0-9._-]{1,64}`), `title` ≤ 120, `message` ≤ 1,000 (Markdown through the lesson pipeline), `type` `info|warning|danger`, `link` `https:` only, `expiresAt` ISO date. Invalid entries are dropped and reported by `workshop validate`. Expired ones are hidden.
- **Mute**: `POST /api/notifications/mute {id}` (mutation gate) stores the id in `.workshop/notifications.json` (at most 500 ids).

## A8. Forms

`course.json#forms.workshop` and `forms.exercise` (or Epic `epicshop.forms`) are `https:` URL templates with `{workshopTitle}` and `{exerciseTitle}`, substituted URL-encoded. They are shown as links ("Give feedback") on the finished pages, never as embedded iframes.

## A9. Guide pages

- **Guide**: built in. It covers using the workshop, playgrounds, diffs, tests and keyboard shortcuts, plus the course's workspace structure (problem/solution/playground paths of the current step).
- **Support**: `course.json#support` `{text, url, email}` (`https:`, `mailto:` for `email`).
- **Community**: `course.json#community` `{title, url}` (`https:`). Epic's Discord page is replaced by a plain link, with no embedded chat.

## C9. Open in a cloud editor

```json
{ "repository": { "github": "owner/repo", "branch": "main", "root": "" } }
```

- Epic: `epicshop.githubRoot` (`https://github.com/<owner>/<repo>/tree/<branch>`) or `githubRepo`.
- The workbench offers **Open in StackBlitz**, **Open in CodeSandbox** and **View on GitHub** for the problem and solution of a step (not the playground: it exists only locally). StackBlitz URLs follow Epic's (`/github/<owner>/<repo>/tree/<branch>/<path>?title=&file=&view=`), including `lab.json#cloudEditor` / `epicshop.stackBlitzConfig` overrides and `false` to hide them.
- URLs are built from validated parts (`owner`/`repo` `[A-Za-z0-9_.-]`, branch without `..`/control characters, encoded path segments) and are always `https://`.

## A1/A10. Metadata and per-app configuration

- `course.json#subtitle`, `instructor {name, url, avatar}`, `product {name, url, logo}`. Epic `epicshop.title`, `subtitle`, `instructor {name, avatar, xHandle}`, `product {displayName, host, logo}`. Images go through the URL policy (course-relative or `https:`).
- Per app: `lab.json#app.initialRoute`, `app.browserTests` (and `testTab: false` to hide tests), `cloudEditor`, `app.type`. Epic per-app `package.json#epicshop`: `appType`, `initialRoute`, `testTab.enabled`, `stackBlitzConfig`.

## Examples

`examples/` gains two steps that use Stage 3: **04**, a counter in the in-workshop browser, with Node tests for the logic and in-browser tests for the page; **05**, an export app. It also gains a course intro and finished page with Mermaid and callouts, and a `repository` for cloud-editor links. The browser fixture adds a hostile step (**06**), notifications, forms, support and community settings.

## Validation and dependencies

- `workshop validate` prints every content warning (invalid notifications, forms, pages, repository and so on). An invalid `lab.json#app` or `cloudEditor` fails validation like any other step manifest field.
- New runtime dependencies: `unified`, `remark-parse`, `remark-gfm`, `remark-rehype`, `rehype-raw`, `rehype-sanitize`, `rehype-stringify`, `shiki`, `mermaid`, `@testing-library/dom`, `esbuild` (already present through Vite, now declared). Also `remark-emoji` and `json5` (both MIT). All are recorded in `docs/dependency-licenses.json`. Licences to note: `elkjs` (Mermaid's optional elk layout) is dual EPL-2.0 or GPL-3.0-or-later. Mermaid lists it as a hard dependency, so it is installed, but it is **not served or shipped**: the sandbox serves only Mermaid's ESM entry and its non-elk chunks. `sandbox.test.mjs` asserts that no served file contains elk code and that the elk chunk, the IIFE build and source maps return 404. `caniuse-lite` (CC-BY-4.0) is build tooling only. `dompurify` (inside Mermaid) is MPL-2.0 or Apache-2.0. The package metadata of `khroma` omits its licence, and its bundled license file is MIT.

## API

| Route | Method | Notes |
|---|---|---|
| `/api/exercise` | GET | documents now include `html`, `toc` and `warnings` |
| `/api/content/config` | GET | `sandboxOrigin`, course metadata, forms, support, community |
| `/api/content/page?name=intro|finished|guide` | GET | rendered page |
| `/api/content/app?id=` | GET | app type, routes, browser tests, cloud-editor links |
| `/api/notifications` | GET | active, unmuted notifications |
| `/api/notifications/mute` | POST | mutation gate |

All of them go through the existing Host, Origin, `Sec-Fetch-Site` and mutation-gate checks.

## More than Epic

- Copy buttons on code blocks; file names on code blocks; diff-aware highlighting.
- A lesson table of contents and heading anchors.
- A dark/light-aware Mermaid theme, re-rendered on theme change, in an opaque sandbox.
- Offline-first: Shiki and Mermaid are bundled, rendered HTML is cached, the notification feed is optional and fails silently.
- Diff links never crash a page: on course pages they become inactive with a hint.
- Video components become privacy-preserving link cards (no third-party iframes).
- Bounded notification feed and mute list; open-in-CodeSandbox and view-on-GitHub alongside StackBlitz.
- In-browser tests with no login gate, and `expect`/`dtl` that need no course dependencies.
- Lesson rendering in a worker with a hard time limit. Epic renders on the request path.
- `workshop validate` reports content-setting problems instead of failing at run time.

## Tests

- Unit: `markdown.test.mjs` (pipeline, components, URL policy, hostile inputs, size limits), `content-config.test.mjs` (validation, Epic config, cloud-editor URLs, forms), `notifications.test.mjs`, `sandbox.test.mjs` (Host/Sec-Fetch-Site, traversal, bundling outside the course, CSP headers).
- Integration over HTTP: `content.integration.test.mjs`. Every new route, cross-origin requests and requests with a sandbox `Origin` are refused.
- Browser: `tests/browser/content.spec.mjs` covers XSS through a hostile lesson (script tags, event handlers, `javascript:` links, inline SVG, Mermaid injection), with no dialog and no global set; a sandboxed app that tries to call the API on both ports and to reach `window.parent`; in-browser tests; an export app; intro/finished pages with a `DiffLink`; notifications and mute; guide; copy button and TOC.
