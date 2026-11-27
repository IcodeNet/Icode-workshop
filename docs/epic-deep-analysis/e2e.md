# Epic Workshop end-to-end observation

The static catalogue in [`README.md`](README.md) was written from source. This document records what the Epic Workshop actually did when run locally, so that each feature row rests on observed behaviour. Rows in `README.md` that observation contradicted or sharpened were corrected. Observed features the catalogue lacked were added as new rows (A11, H9, I7).

## Environment

| Item | Value |
|---|---|
| Epic source | `epicweb-dev/epicshop` at `12089440399689c914f3e0f69b3ec52c07b9a3a8`, `npm install` + `npm run build`, vitest 41 files / 313 tests passing |
| Workshop under test | `example/` from that commit, `npm run setup` (playground = `01.01.problem`) |
| Runtime | Node 24.22.3, Linux container, Chrome (system, headless) driven by Playwright 1.59.1 |
| Start command | `cd example && NODE_ENV=production PORT=5639 npx --prefix ./epicshop epicshop start` |
| Network | Egress allow-list: npm registry reachable. `www.epicweb.dev`, `epic-web-presence.kentcdodds.workers.dev`, `mermaid-to-svg.kentcdodds.workers.dev`, `fonts.googleapis.com` and `cdn.jsdelivr.net` were refused (HTTP 403 from the proxy). So the run covers the offline/no-account behaviour of every feature that talks to epicweb.dev. |
| Tools missing | `ss` (iproute2) is not installed. On Linux, Epic's port-kill path (`fkill :port` → `pid-port`) calls `ss -tunlp`, so the port-kill observations below are specific to hosts without `ss`. `lsof` is present. |
| Accounts | No epicweb.dev account was used or created |

### Two passes

`example/package.json` sets `epicshop.product.slug`. With a slug set, Epic only shows the **tests tab, in-browser tests and diff UI** to a logged-in user with access to that workshop (`userHasAccessToWorkshop` in `utils/epic-api.server.ts`; without a slug it returns `true`). So the walkthrough ran twice:

1. **gated**: the example as shipped (no login, so access is denied);
2. **ungated**: the same example with `product.slug` removed and the workshop restarted. This shows what those features do once access is granted.

A third, short run started a second instance with `EPICSHOP_DEPLOYED=true` on port 5640 to observe deployed mode (H6).

### Startup (log: [`e2e/logs/startup.log`](e2e/logs/startup.log))

`npx` runs `epicshop start`. The process chain is `npm exec` → `epicshop` bin → `tsx cli.ts start` → `node ./start.js` (the app server). The CLI process also listens on a random localhost port, which it passes to the app as `EPICSHOP_PARENT_PORT` plus `EPICSHOP_PARENT_TOKEN` (port 3742 in run 1; see H9). Startup prints `Local: http://localhost:5639`, then `🚀 Starting sidecar processes...`, then `[EpicMeApp] started` with the sidecar's output prefixed and coloured. The sidecar `npm run dev --prefix ./epicshop/epic-me` opens no port. The workshop answered `/resources/healthcheck` 5–6 s after launch. App dev servers use fixed ports: playground 4000, problem apps `6000+n` and solution apps `7000+n`, where n is the app's index (`/admin/apps`).

## Commands

```sh
export PATH=/path/to/node24/bin:$PATH
# workshop
cd epicshop/example && NODE_ENV=production PORT=5639 npx --prefix ./epicshop epicshop start
# Epic's own Playwright smoke test against it (wrapper config: no webServer, system Chrome)
cd epicshop && PORT=5639 npx playwright test -c playwright.wsb.config.ts
# example's in-browser test harness (setupInBrowserTests) against it
cd epicshop/example && ../node_modules/.bin/playwright test -c playwright.wsb.config.ts
# walkthrough (adds and removes its own fixtures)
PHASE=gated   OUT=e2e node scripts/e2e-walkthrough.mjs
PHASE=ungated OUT=e2e node scripts/e2e-walkthrough.mjs   # after removing product.slug and restarting
# MCP server over stdio
EPICSHOP_REPO=/path/to/epicshop node scripts/mcp-probe.mjs > mcp.json
# CLI
npx --prefix ./epicshop epicshop --help | exercises | exercises 1 1 --json | exercises context | diff 01.01.problem 01.01.solution | playground | playground set 1.1.problem | playground saved | progress | auth status | warm | list | config | admin launch-readiness --skip-remote --skip-head
```

The walkthrough adds three temporary fixtures to `example/` and removes them on exit:

1. an MDX probe section in `exercises/03.export-app/01.problem.export/README.mdx` (Mermaid, `LinkToApp`, `DiffLink`, `VideoEmbed`, code-block `add`/`remove`/`lines`, danger and muted callouts);
2. `epicshop/pre-set-playground.js` and `post-set-playground.js` hooks that log their environment;
3. `extra/wsb-files/`, an extra with no `package.json` and no index file. That is dev type `file`, which the example otherwise lacks.

Raw per-step results: [`e2e/logs/results-gated.json`](e2e/logs/results-gated.json), [`e2e/logs/results-ungated.json`](e2e/logs/results-ungated.json).

## Epic's own tests

| Suite | Result | Evidence |
|---|---|---|
| `tests/smoke.spec.ts` (root `playwright.config.ts`, wrapper with system Chrome, no `webServer`) | **1 passed** (1.2 s). The test only loads `/`. | [`e2e/logs/smoke.log`](e2e/logs/smoke.log) |
| `example/tests/in-browser-tests.spec.ts` (`setupInBrowserTests`): finds every solution app with browser tests and runs each page headlessly | gated: **1 failed**. The test page returns "Access Denied … login or register". Ungated: **1 failed** with `Compilation failed: Could not resolve "./index.ts"`. `02.solution.simple/index.test.ts` imports `./index.ts`, but the app's file is `index.js`. That is a bug in the example content at this commit, not in the harness. | [`e2e/logs/in-browser-e2e-gated.log`](e2e/logs/in-browser-e2e-gated.log), [`…-ungated.log`](e2e/logs/in-browser-e2e-ungated.log) |
| `npm test` (vitest, before this run) | 41 files, 313 tests passed | inherited state |

## Observations per feature

"Catalogue" says whether the static row in `README.md` was right: **Yes**, **Refined** (right, now more precise) or **Corrected** (contradicted by observation; the row was changed). Screenshots are in [`e2e/`](e2e/). Icode statuses were not affected by any of these observations, because they concern Epic's behaviour, not Icode's.

### A. Course model and content

| ID | Observed behaviour | Evidence | Catalogue |
|---|---|---|---|
| A1 | `document.title` is the config title "Epic Workshop Tutorial 🔭". The home page body renders `exercises/README.mdx` (h1 "Epic Workshop App Tutorial 👨‍🏫"), not the config title. Product link (EpicWeb.dev) and "Edit on GitHub" are present. The nav header shows the config title. | `01-home.jpg`, `23b-login-after-click.jpg` | Yes |
| A2 | `/apps` returned 15 apps (16 with the temporary extra): playground, 10 problem/solution apps, 4 extras. `/extra` lists extras alphabetically, and each has its own page with a playground. **A new extra directory appeared without a restart.** | `results-gated.json` A2 | Yes |
| A3 | All five dev types were observed. **script**: own dev server on its port. **browser**: `/app/02.02.solution/` served by the workshop with `epic_ws.js` injected. **export**: `/app/03.01.solution/` shows "Console Output" (LOG lines) and "Exports" (values, functions, resolved promises). **none**: no-preview step. **file**: no package.json and no index, so a file list. | `03-export-app.jpg` | Yes |
| A4 | Step MDX renders callouts (`callout-info/warning/success/danger/muted`, `notification` title, `aside`), code blocks with filename, line numbers, `lines` highlight and `add`/`remove` markers, autolinked headings (17 anchors), emoji shortcodes and GFM. `LinkToApp to="/hello"` → `?pathname=%2Fhello` plus an external link to `localhost:4000/hello`. `DiffLink` → `?preview=diff&app1=…&app2=…`, `fullPage` → `/diff?…`. `VideoEmbed` → iframe. **Mermaid**: the server-side worker was unreachable, so the diagram was rendered client-side (`svg[aria-roledescription=flowchart-v2]`). **`DiffLink` in an exercise *intro* README throws `Expected component DiffLink to be defined` and the page shows "Unexpected Server Error".** The DiffLink components exist only in step MDX. | `05-step-mdx.jpg`, `07-mdx-probe-scrolled.jpg`, server log | Refined |
| A5 | Exercise intro, step pages, exercise finished (video + feedback form iframe), workshop finished all render. `/exercise/01/01` → 302 `/exercise/01/01/problem`. Prev/next links work. | `09-exercise-finished.jpg` | Yes |
| A6 | Root loader carries `practicePastLesson` (null without progress). No retrieval-practice UI without login/progress. Over MCP, `get_quiz_instructions` and the `quiz_me` prompt return a full teacher prompt (17,770 chars) **without login**. | `logs/mcp-gated.json` | Refined |
| A7 | `GET /admin/notifications` → 405 (fixed in this commit). `POST intent=mute` → `{"success":true}`. No notifications shown: config list empty, remote feed host unreachable. | `results-gated.json` A7 | Yes |
| A8 | The exercise finished page embeds the Google Form with `{workshopTitle}`/`{exerciseTitle}` filled. The nav has "📝 Workshop Feedback". | `09-exercise-finished.jpg` | Yes |
| A9 | `/guide`, `/support`, `/discord`, `/workspace-structure` all render (200). | `results-gated.json` A9 | Yes |
| A10 | `initialRoute: "/whatever"` is applied: the running playground iframe opened `http://localhost:4000/whatever`. `/app/playground` for a project app → 302 to its own port. | `16-app-running.jpg` | Yes |
| **A11 (new)** | Shortcuts: `/l` → 302 to the last step's solution (`/exercise/03/01/solution`). Step URL without type → problem. | `results-gated.json` A5 | Added |

### B. Learner workspace

| ID | Observed behaviour | Evidence | Catalogue |
|---|---|---|---|
| B1 | "Set to Playground" posts `/set-playground` and copies the step into `playground/` (deleting files absent from the source). The playground selector and a pulsing broken-link icon show mismatch. Hooks ran in order. `pre` receives `EPICSHOP_PLAYGROUND_{TIMESTAMP,DEST_DIR,SRC_DIR,WAS_RUNNING}`. `post` also receives `IS_STILL_RUNNING` and `RESTART_PLAYGROUND`. **Bug: `EPICSHOP_PLAYGROUND_IS_STILL_RUNNING` is the string `"[object Promise]"`, because `isAppRunning` is not awaited (`apps.server.ts` l.1693), so `RESTART_PLAYGROUND` is always `false`.** | `12-set-playground.jpg`, hook log in `results-gated.json` B1 | Refined |
| B2 | Off by default (`/saved-playgrounds` → `status: disabled`). Toggled by Preferences or `POST /persist-playground`. Each later set saves a timestamped copy (`2026.11.27_22.30.24_01.01.solution`) under `<workshop>/saved-playgrounds/` (gitignored). Copies accumulate: 26 after the gated run. Restoring by id worked. The CLI `playground saved` and MCP `list_saved_playgrounds` report "persistence is disabled" when it is off. | `results-gated.json` B2, `logs/cli.log` | Refined |
| B3 | The "Files" popover lists the step's changed files ("Relevant files … Click any file to open it directly in your editor"), with Set to Playground. | `14-touched-files.jpg` | Yes |
| B4 | `/app/<app>/files` lists files with mime type and language, and `file-preview?path=` returns compiled preview code (`?file=` → 400). The explorer UI appears only for dev type `file`, which no example app has, so a fixture was needed. MIME quirk: `.ts` reported as `video/mp2t`. | `results-gated.json` B4 | Refined |
| B5 | Clicking an `InlineFile` posts `/launch-editor.data` (`type=appFile&appName=playground&appFile=./index.js`). No GUI editor is running, and **npm/npx export `EDITOR=vi` to the workshop process**, so Epic spawned `vi playground/index.js` attached to the workshop's own terminal. The vim screen appeared in the server log, and a stray `vi` stayed alive until killed. Detection order observed in code and run: `EPICSHOP_EDITOR` → running editor processes (`ps x`) → `VISUAL` → `EDITOR`. The InlineFile is a button only when the playground matches the step. | `logs/launch-editor-vi.log` | Corrected (fallback behaviour) |
| B6 | Root data carries `repoUpdates`, `updatesAvailable`, `commitsBehind`, `updateNotificationId`. No update banner: the example is the epicshop monorepo itself, with no upstream ahead. `latestWorkshopAppVersion` 6.90.37 was read from npm (`/admin/version.json`). The banner's restart uses `EPICSHOP_PARENT_PORT` (see H9). | `results-gated.json` B6 | Yes |
| B7 | `dependenciesNeedInstall` is in root data. No banner was shown because installs were complete. | `results-gated.json` B7 | Yes (not triggered) |
| B8 | (Icode-only) | — | — |

### C. Running apps, tests and processes

| ID | Observed behaviour | Evidence | Catalogue |
|---|---|---|---|
| C1 | Start App → `/processes` `{playground: port 4000}`, dev output prefixed `[playground:4000]` in the server log, "hello world" on :4000. **Stop App removed the entry but left `npm run dev` → `sh` → `node index.js` running on :4000.** The log shows `[playground:4000] exited (null)` followed by `Timed out waiting for the port to become available`. On revisit the panel says "The port for this app is unavailable. It could be that you're running it elsewhere. Show here anyway" with **STOP PORT**. Stop Port (and `POST /start intent=stop-port` for a foreign server on :4999) returned 200 but killed nothing on this host. Its `fkill(':port')` needs `ss` on Linux, which is absent here. Restart App worked. | `16-app-running.jpg`, `16b-port-unavailable.jpg`, `logs/process-lifecycle.log` | Refined |
| C2 | Playground preview = toolbar (refresh, address field showing `http://localhost:4000/whatever`, Stop App, open in new window) above an iframe. Simple/export apps get an "Open in New Window" link. | `16-app-running.jpg` | Yes |
| C3 | **Simple (browser) app**: editing `playground/index.js` reloaded `/app/playground/` once via `epic_ws.js`. **Lesson content**: editing a step README updated the open step page without navigation. **Project app with its own dev server**: no reload. `epic_ws.js` for such apps redirects to the app's port, and reloading is left to the app's own dev server. | `results-gated.json` C3 | Refined |
| C4 | Gated: tests tab shows "Access Denied — You must login or register … to view and run the tests" plus a demo video. `POST /test intent=run` → 403. Ungated: the run button streams `npm run test` output with ANSI colours ("✔ server responds with goodbye world", "ℹ tests 1"), a status line "Tests passed", and a clear action. | `17-tests-gated.jpg`, `u-17-tests-run.jpg` | Corrected (access gate) |
| C5 | Gated: `/app/02.02.solution/test/index.test.ts` serves an "Access Denied" page instead of the test script. Ungated: the tab lists `index.test.ts` with a fail mark and "Rerun all tests". The test fails to compile because of the example bug above. The Playwright harness (`setupInBrowserTests`) reports the same failure. | `u-18-in-browser-tests.jpg`, `logs/in-browser-e2e-*.log` | Corrected (access gate) |
| C6 | The sidecar started with the workshop. Admin shows `EpicMeApp PID … Status: Running` and "View logs" expands its captured output. `intent=restart-sidecar` logs `Stopping sidecar process` / `exited (signal: SIGTERM)` / `started`. **Each restart and each workshop shutdown (Ctrl-C/SIGINT) left the old `npm run dev` → `sh -c node server.js` → `node server.js` tree running.** Five orphaned EpicMe trees accumulated across the runs. | `19-admin.jpg`, `20-sidecar-logs.jpg`, `logs/process-lifecycle.log` | Refined |
| C7 | `/processes` returns `{processes, testProcesses}` JSON. Admin "Processes" card lists running dev processes ("No processes running" when idle). | `19-admin.jpg` | Yes |
| C8 | `intent=inspect` → `Debugger listening on ws://127.0.0.1:9229/…` and `:9229/json/version` answered. `stop-inspect` closed it. | `logs/process-lifecycle.log` | Yes |
| C9 | `stackBlitzUrl` is computed for every app (`https://stackblitz.com/github/epicweb-dev/epicshop/tree/main/exercises/…?title=…`), but **no StackBlitz link is shown locally**. In deployed mode the preview is a StackBlitz embed (`&embed=1&theme=…`). | `logs/deployed-mode.log` | Corrected (deployed-only UI) |
| C10, C11 | Not Epic features | — | — |

### D. Diffs

| ID | Observed behaviour | Evidence | Catalogue |
|---|---|---|---|
| D1 | Gated: the diff tab and `/diff` page show "Access Denied … to view the diff". Ungated: App 1 / App 2 selectors, refresh, per-file accordion (`index.js −8 +7`) with APP 1 / APP 2 open buttons. **The same diff is available without access from the CLI (`epicshop diff 01.01.problem 01.01.solution`) and MCP (`get_diff_between_apps`).** The gate is UI-only. `epicshop warm` precomputes diffs for all 5 problem/solution pairs. | `21-diff-gated.jpg`, `u-21-diff.jpg`, `logs/cli.log`, `logs/mcp-gated.json` | Corrected (access gate) |
| D2 | `/diff/01.01` → `/diff/1.01` → `/diff?app1=01.01.problem&app2=01.01.solution`, and `/diff/99.01` → `/diff`. MDX `DiffLink` produces the same query (A4). | `results-gated.json` D2 | Yes |

### E. Identity, progress and community

| ID | Observed behaviour | Evidence | Catalogue |
|---|---|---|---|
| E1 | `/login` explains the device flow. "Retrieve Auth Code" posts `/login.data` and opens `/login-sse`. With epicweb.dev unreachable it shows "There was an error: fetch failed". `/account` → 302 `/login?redirectTo=/account`. **In run 1 the page was left before the device-code request failed. The rejection then wrote to the closed SSE stream (`TypeError: Invalid state: Controller is already closed` at `login-sse.tsx:48`), an unhandled rejection, and the whole workshop exited ("second error, exiting"), leaving its sidecar orphaned.** Staying on the page (final run) did not crash. `epicshop auth status` lists EpicWeb.dev, EpicReact.dev and EpicAI.pro, all "Not logged in". | `23b-login-after-click.jpg`, `logs/login-crash.log` | Refined |
| E2 | No progress without login: `POST /progress` → 302 to login, `GET /progress` → 400. `epicshop progress` prints "You're not logged in" and exits 1. MCP `get_what_is_next` → "User is not logged in". | `results-gated.json` E2, `logs/cli.log` | Yes |
| E3 | MCP `get_user_access` → `userHasAccess:false` ("free") with the slug, and `true` ("paid") without it. Access gates C4, C5 and D1 in the UI. | `logs/mcp-*.json` | Refined |
| E4 | Root data contains a presence list with the local anonymous user. The left rail shows "1". The server repeatedly tried `epic-web-presence.kentcdodds.workers.dev` (13 refused connections per run). Opt-out is in Preferences. | proxy log, `29-preferences.jpg` | Yes |
| E5 | The "Chat" tab shows "Login to get access to the exclusive discord channel" and "Create Post". `/discord` renders. | `24-chat-tab.jpg` | Yes |
| E6 | In the first run, yellow "!" onboarding badges appeared on the step header's playground-link icon and on the Files button. After those features had been used, the badges were gone in later runs, because completion is stored under `onboardingComplete` in `data.json`. `POST /mark-onboarding-complete` → `{"success":true}`. | `32-admin-db.jpg` (`onboardingComplete` key) | Yes |
| E7 | Not triggerable without completing progress (login). | — | Not observed |

### F. Video

| ID | Observed behaviour | Evidence | Catalogue |
|---|---|---|---|
| F1 | Each `EpicVideo` is an iframe to `www.epicweb.dev/…/embed?theme=light` with a title link and "Login for transcripts". The iframe failed to load because the host was blocked. No Mux player without login. `/video-player` → 400 without parameters. Video keyboard shortcuts are listed in the "?" dialog. | `05-step-mdx.jpg`, `27-shortcuts-dialog.jpg` | Yes |
| F2 | `/resources/offline-videos`: `totalVideos 0, unavailableVideos 13`. Admin "Offline Videos": "No offline videos are downloaded yet". Download-resolution preference present. | `29-preferences.jpg` | Yes (no downloads possible) |
| F3 | Admin home lists "Local video links with missing info (13/13)": metadata could not be fetched. | `19-admin.jpg` | Yes |

### G. UI and UX

| ID | Observed behaviour | Evidence | Catalogue |
|---|---|---|---|
| G1 | Ctrl/Cmd+Shift+P opens the palette with "Go to… (pages, exercises, steps, extras)", "Set playground to current exercise (s p)" and "Toggle keyboard shortcuts (?)". Typing "Multi" at the top level gave "No results": exercise search happens inside "Go to…". | `26-command-palette.jpg` | Refined |
| G2 | "?" opens the shortcuts dialog (palette, `g h/a/n/p/o/d/l` navigation, `s p`, video keys). `g` then `n` went from problem to solution. | `27-shortcuts-dialog.jpg` | Corrected (full vim-style navigation, not only a dialog) |
| G3 | The nav-menu theme button cycles system → light → dark (`<html class>` changes). It sets cookie `EpicShop_theme` plus client-hint cookies `EpicShop_CH-prefers-color-scheme/time-zone/reduced-motion`. | `28-theme-dark.jpg` | Yes |
| G4 | Preferences: video min/max resolution, offline download resolution, **font size**, presence opt-out, **persist playground**, **dismiss exercise warning**. | `29-preferences.jpg` | Refined |
| G5 | The client posts `navigator.onLine` to `/resources/connection-status`. When the server died (E1), the client showed a "Server is down — Your server is not running. Please restart the workshop app." overlay. | `results-gated.json` G5 | Refined |
| G6 | Full-width red banner "Warning: Changes detected in exercises directory — You should typically work in the playground directory" as soon as any file under `exercises/` changed (triggered by the probe fixture). It is dismissible via preference. A playground-mismatch icon appears in the step header. | every screenshot | Refined |
| G7 | `/robots.txt` and `/sitemap.xml` (35 URLs, including a literal `/*` entry) served. `/og/?title=…` → **500 "fetch failed"**: the image needs Google Fonts and jsDelivr emoji at request time (`/og` without slash → 301). Pages carry `twitter:card`/`twitter:creator` meta. | `results-gated.json` G7 | Refined |
| G8 | Not asserted (library behaviour) | — | Not observed |
| G9 | The layout held at 1280×800. No responsive or a11y checks were run. | — | Not observed |

### H. Admin, caching and operations

| ID | Observed behaviour | Evidence | Catalogue |
|---|---|---|---|
| H1 | `/admin`: sidecar card (PID, status, logs, restart), commands (clear caches, clear all data incl. auth, start inspector), apps list, processes, progress/video diagnostics, sub-nav (Diff Viewer, Database, Cache Management, Offline Videos, Version). `clear-caches` → 200. | `19-admin.jpg` | Yes |
| H2 | `/admin/cache`: per-workshop filter (instance id), search, cache entries grouped by cache. Disk cache at `~/.cache/epicshop/<instanceId>/`. | `31-admin-cache.jpg` | Yes |
| H3 | `/admin/version(.json)`: instance id, cwd, workshop commit, app version, npm latest, start time. `/admin/db` shows and edits `~/.local/state/epicshop/data.json` (preferences, onboarding, client id). | `32-admin-db.jpg` | Yes |
| H4 | Not exercised (`NODE_DEBUG` namespaces) | — | Not observed |
| H5 | `SENTRY_DSN` and project id are shipped to the client in `ENV`. No Sentry tunnel traffic (`/resources/lookout`) was seen in these runs. | page source | Yes |
| H6 | `EPICSHOP_DEPLOYED=true`: no sidecars started, request logging on, "This is the deployed version. Run locally for full experience." banner. `/admin`, `/preferences`, `/login`, `/processes`, `/app/<simple>` → 400. `POST /start`, `/set-playground`, `/launch-editor` → 400 "EPICSHOP_DEPLOYED is true, cannot perform this action". Previews become StackBlitz embeds. Diff remains access-gated. | `logs/deployed-mode.log` | Refined |
| H7 | Preferences/auth in `~/.local/state/epicshop/data.json`, workshops config in `~/.local/state/epicshop/workshops-config.json`, caches in `~/.cache/epicshop/`. Saved playgrounds in the workshop root (B2). | `32-admin-db.jpg` | Refined |
| H8 | Every page response carries `Server-Timing` with per-loader durations and cache hits (`exerciseStepTypeIndexLoader;dur=…`, `cache_…;desc=… cache retrieval`). | `results-gated.json` H8 | Yes |
| **H9 (new)** | Supervisor: the CLI process stays as parent of the app server and exposes a token-protected localhost endpoint (`EPICSHOP_PARENT_PORT`/`EPICSHOP_PARENT_TOKEN`, `/__epicshop-restart`), used by the update banner to restart the app. Both values are sent to the browser in `ENV`. | page source, `update-repo.tsx` | Added |

### I. CLI (log: [`e2e/logs/cli.log`](e2e/logs/cli.log))

| ID | Observed behaviour | Catalogue |
|---|---|---|
| I1 | `start` auto-detected the workshop from cwd. `--help` lists 18 commands. `--version` is not supported: it prints help and exits 1. | Yes |
| I2 | `list` and `config` refuse to prompt without a TTY and print the exact non-interactive alternatives (`config --repos-dir`, `CI=true`). With `CI=true`: "No workshops found … Workshops directory: /root/epic-workshops". `add --help` supports `repo#ref`. | Refined |
| I3 | `warm` loaded 16 apps and generated 5 problem/solution diffs. `update`, `cleanup` (targets caches, offline-videos, preferences, auth, config), `migrate`: help observed, not run. | Yes |
| I4 | `exercises` prints a tree with progress counts and "← current" (the playground). `exercises 1 1 --json` gives the step as JSON (16 KB). `playground` shows the current one, `playground set 1.1.problem` sets it, `playground saved` fails when persistence is off. `diff a b` prints a git diff with a legend. `progress` needs login. `auth status` covers 3 domains. | Yes |
| I5 | With no command and a pseudo-TTY: an arrow-key chooser "What would you like to do? (in Epic Workshop Tutorial 🔭)" (start, open, exercises, playground, progress, diff, list, …). Without a TTY: an actionable error. | Yes |
| I6 | `admin launch-readiness` validates a workshop for launch (ungated pass: FAIL, 9 errors, e.g. missing `product.slug`, solution videos without a `/solution` suffix). `admin set-videos` exists. | Refined |
| **I7 (new)** | `exercises context` exports the whole workshop (instructions, exercises, steps, files) as one JSON document (31 KB here), with `--output` to a file, for AI assistants. | Added |

### J. MCP for AI assistants (logs: [`e2e/logs/mcp-gated.json`](e2e/logs/mcp-gated.json), [`mcp-ungated.json`](e2e/logs/mcp-ungated.json))

| ID | Observed behaviour | Catalogue |
|---|---|---|
| J1 | Server `epicshop 1.0.0` over stdio. Every tool takes `workshopDirectory`. `get_workshop_context` (9,960 chars), `get_exercise_context` (17,179), `get_exercise_step_context` (12,124) and `get_what_is_next` ("User is not logged in … Call `login`") all answered. Responses are markdown with "Next steps" plus embedded JSON. | Yes |
| J2 | `get_diff_between_apps` and `get_exercise_step_progress_diff` returned git diffs **without login or access** | Refined |
| J3 | `list_saved_playgrounds` → error "persistence is disabled". `set_playground`/`open_exercise_step_files`/`update_progress` not called (they mutate or open an editor). | Yes |
| J4 | `get_user_info` → "No authenticated user found". `get_user_access` → false with slug, true without. `login`/`logout` not called. | Yes |
| J5 | `get_quiz_instructions` and the `quiz_me` prompt work offline. `view_video` was not called. | Yes |
| J6 | 8 **resource templates** (`epicshop://{workshopDirectory}/workshop-context`, `…/exercise/{n}`, `…/exercise/{n}/{m}`, `…/diff-between-apps/{a}__vs___{b}`, `…/exercise-step-progress-diff`, `…/user/{info,access,progress}`). There are no static resources. | Refined |

## Summary

* **Coverage**: 70 Epic feature rows (67 catalogued, because B8, C10 and C11 are not Epic features, plus 3 new).
  * **56 observed working.**
  * **10 observed only in their no-account or offline state**: A6 (retrieval practice UI), A7 (remote notifications), E1 (login), E2 (progress), E3 (access), E4 (presence), E5 (Discord), F1–F3 (video).
  * **4 not observed**: E7 (confetti, needs a logged-in completion), G8 (scroll restoration), G9 (responsive/a11y), H4 (debug logging).
* **Most consequential findings for Icode**:
  1. Epic gates tests, in-browser tests and the diff UI on a commercial login when a product slug is set. The same diffs are free over CLI and MCP.
  2. Process cleanup on Linux leaves app and sidecar grandchildren running, and port cleanup depends on `ss`.
  3. A file link with no GUI editor running opens `vi` inside the server's terminal, because npm sets `EDITOR=vi`.
  4. A failed login can take the whole server down.
  5. The OG image and the Mermaid server render need internet access.
  6. The post-set-playground hook gets `"[object Promise]"`.

  When Icode builds C1, C6, B5, E1, G7 and A4 from the build order, it should avoid these failure modes rather than copy Epic's implementation.
