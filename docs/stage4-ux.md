# Stage 4: UX

Stage 4 of the Epic gap analysis covers the G rows: command palette (G1), keyboard shortcuts (G2), theme (G3), preferences (G4), connection status and error boundaries (G5), the exercise warning banner (G6), the OG image and robots file (G7) and scroll restoration (G8). It also re-checks the accessibility row (G9). This page records the design, the accessibility bar and the security model. Epic (`epicweb-dev/epicshop` at `12089440399689c914f3e0f69b3ec52c07b9a3a8`) was used for behaviour only. No code was copied.

Everything here is UI-side apart from four small API routes (`/api/preferences` extended, `/api/health`, `/api/warnings`, `/api/og.svg`). A course that declares nothing gets all of it.

## Modules

| File | What it holds | Tests |
|---|---|---|
| `web/src/ux/preferences.js` | Preference schema, defaults and `validatePreferences` (shared by the server and the UI) | `ux.test.mjs`, `preferences.integration.test.mjs` |
| `web/src/ux/shortcuts.js` | Command ids, default bindings, binding grammar, sequence matcher, conflict checks, display labels | `ux.test.mjs` |
| `web/src/ux/fuzzy.js` | Fuzzy matcher with match ranges (rendered as text, never HTML) | `ux.test.mjs` |
| `web/src/ux/contrast.js` | WCAG 2.x relative luminance and contrast ratio | `ux.test.mjs` (checks every theme's token pairs in `styles.css`) |
| `web/src/palette.jsx` | `CommandPalette`, `ShortcutsDialog`, `useFocusTrap` (no API client) | `tests/browser/ux.spec.mjs` (with axe) |
| `web/src/ux.jsx` | `usePreferences`, `PreferencesPage`, `useTheme`, `useShortcuts`, `useScrollRestore`, `useConnection`, `ConnectionStatus`, `ConnectionBanner`, `useWarnings`, `WarningBanner`, `PanelBoundary` | `tests/browser/ux.spec.mjs` |
| `web/public/theme-boot.js` | Applies the stored theme before React renders (no flash; external file, so the CSP needs no change) | browser |
| `web/ux-routes.mjs` | `/api/health`, `/api/warnings`, `/api/og.svg` | `preferences.integration.test.mjs` |

## G1. Command palette

- **Open:** Ctrl/Cmd+Shift+P (Epic) and Ctrl/Cmd+K. Both are remappable (G2). Also reachable from the "Commands" button in the top bar, so a pointer or a screen-reader user can find it without knowing the shortcut.
- **One search across everything.** Commands, lessons (step id, step title, exercise and module titles) and the current step's playground files are matched together. Epic only searches exercises inside a nested "Go to…" page; typing "Multi" at its top level gave "No results" ([e2e](epic-deep-analysis/e2e.md), G1). Prefixes narrow the search: `>` commands, `#` lessons, `@` files.
- **Fuzzy matching** (`fuzzy.js`): case-insensitive subsequence match, scored by contiguous runs, word starts and an exact-prefix bonus. Up to 50 results. Matched characters are highlighted with `<mark>` elements built from ranges. Labels are always React text, so a crafted course title, module title, lesson name or file name is shown literally (hostile test: `<img src=x onerror=…>` titles in step 08 of the browser fixture).
- **Commands** call the same functions as the buttons they mirror. The palette has no API client of its own: `palette.jsx` contains no `fetch`, and a unit test asserts it. Mutating commands therefore keep their confirmations:
  - "Reset playground", "Use solution in playground", "Copy previous playground", "Migrate previous edits" and "Delete file" go through the same `window.confirm` as the buttons; cancelling does nothing.
  - Course actions run through `useActions().start`, so the server's typed confirmation (`::icode-confirm::`) still opens the typed `ConfirmDialog`. Nothing in the palette can answer it. The browser test runs the destructive "Deploy demo" action from the palette, checks that the typed dialog appears and that the deployment marker is not written until `deploy-demo` is typed.
  - "Update workshop" and "Free port" only open their panels. The typed `update` confirmation and the port confirmation stay where they are.
  - Commands that are unavailable (no lesson open, a run in progress, `busy`) are listed as disabled with the reason instead of failing.
- **Accessibility:** a modal `role="dialog"` with `aria-modal="true"` and a label. The input is a `role="combobox"` with `aria-expanded`, `aria-controls`, `aria-autocomplete="list"` and `aria-activedescendant`. Results are a `role="listbox"` of `role="option"` items grouped by kind, each with `aria-selected` and `aria-disabled`. Arrow keys, Home/End and PageUp/PageDown move, Enter runs, Escape closes. Focus is trapped inside the dialog while it is open and returns to the element that opened it. A polite live region announces the number of results.

## G2. Keyboard shortcuts

- **Dialog:** `?` (when focus is not in a text field) or the palette. Lists every binding by group (General, Navigation, Editor, Diff, Video). It is a modal dialog with the same focus trap and restore, and Escape closes it. Inside the Diff tab, `?` keeps its Stage 2 meaning (the diff's own help) and the dialog is reached with Ctrl/Cmd+/ or the palette.
- **Sequences (Epic):** `g h` course home, `g n` / `g p` next / previous step, `g l` last step, `g i` next incomplete step, `g d` diff, `g f` finish page, `g ,` preferences, `s p` reset the playground to the current step's problem (with its confirmation). A sequence must be completed within 1.5 s. Single keys and sequences never fire while focus is in an input, textarea, select or contenteditable element, while a modifier other than Shift is held, or while another dialog is open. Modifier chords (Ctrl/Cmd+S, Ctrl/Cmd+Enter) work everywhere, as before.
- **Remappable (more than Epic):** Preferences → Shortcuts records a new binding per command or disables it. The grammar is `mod`/`ctrl`/`alt`/`shift` plus one key, or a sequence of up to three plain keys separated by spaces. A binding that is already used, that is a prefix of another sequence, or that the browser reserves (Ctrl/Cmd+W, T, N, Q, L, R, Tab) is refused with a message. Bindings are stored with the other preferences.
- Video shortcuts are the browser's native `<video>` controls (F1 is still Partial); the dialog lists the native keys rather than inventing new ones.

## G3. Theme

- **Light, dark, high contrast and system.** The default stays **dark** (the established Icode look); "system" is one click away. System follows `prefers-color-scheme` and `prefers-contrast: more`, and updates live). Epic has light, dark and system.
- All colours are CSS custom properties on `.app`. Stage 3's hard-coded colours were replaced with tokens. The default (dark) look is unchanged. `.app.dark` still marks a dark scheme (dark and high contrast), so Shiki's dual theme (`github-light` / `github-dark`) and the Mermaid frame (which re-renders when the class changes) follow the theme without new code paths. The `color-scheme` property follows too, so native controls and scrollbars match.
- `theme-boot.js` (an external script in `public/`, allowed by `script-src 'self'`) reads the stored theme from `localStorage`, validates it and sets `data-theme` on `<html>` before the first paint. A missing or invalid value means the default (dark). The server copy wins once `/api/preferences` answers.
- **Code contrast:** Shiki's `github-light`/`github-dark` colours are checked against every background a code line can have (plain, highlighted line, diff add/remove, and the high-contrast backgrounds). Any colour below 4.5:1 is darkened (light) or lightened (dark and high contrast) at highlighter start-up through Shiki's `colorReplacements` (target 4.6:1). This covers every language, because token colours come from the theme. Example: the review found `#E36209` at 3.48:1 on white; it is now `#AD4A07`. Dark code spans never paint token backgrounds. A unit test checks every theme colour, and axe runs on lessons with code in all 242 bundled languages (fixture steps 09–18) in every theme.
- **Contrast:** every theme's text/background, muted text, accent text, link, focus-ring and border token pairs are checked against WCAG AA in a unit test (4.5:1 for text, 3:1 for focus rings and UI borders). High contrast aims for AAA (7:1) on text. axe runs on the main views in each theme.

## G4. Preferences

- **Page:** "Preferences" in the course-pages navigation, `g ,`, or the palette. Settings: theme; UI text size (87.5–150 %); editor font family (system monospace, Menlo/Monaco, Consolas, Courier, or "the UI font") and editor font size (11–24 px); motion (system, reduce, allow); restore scroll positions; save playgrounds automatically (the Stage 2 preference, now also here); dismissed warnings (reset); keyboard shortcuts.
- **Storage:** `.workshop/preferences.json` in the course (as in Stage 2), through `PUT /api/preferences`, plus a `localStorage` mirror so the theme applies before the API answers. Both are validated by the same `validatePreferences`:
  - only known keys; unknown keys, prototype keys (`__proto__`, `constructor`, `prototype`) and non-plain objects are refused;
  - enums and integer ranges only; no free-form strings except shortcut bindings, which must match the binding grammar and refer to a known command id;
  - at most 64 shortcut entries and 4 KB of JSON;
  - a bad `localStorage` value is discarded (defaults), never applied.
  Values reach the page only as class names chosen from the enum and as numbers in CSS custom properties, never as raw CSS or HTML.
- **Security:** `/api/preferences` is an ordinary API route. It sits behind the Host check, the Origin check, the `Sec-Fetch-Site` check, the session token for browser mutations and the mutation gate. A write during another operation gets the gate's 409. The UI keeps the change locally and retries with backoff, and the page says "Saved" or "Will save when the current operation finishes".

## G5. Connection status and error boundaries

- `/api/health` (GET, no side effects) is polled every 15 s, on `online`/`offline` events and when the tab becomes visible. Backoff doubles to 60 s while the server is down.
- The top bar shows a status with text, not only colour: "Connected", "Offline (browser)" or "Workshop server not reachable". It is the only live region for the connection (`aria-live="polite"`), and its text changes only when the state changes, so each change is announced once. When the server is unreachable, a banner (a named region, not an alert) explains that work in the editor is kept, offers "Retry now" (more than Epic, which shows a full-screen "Server is down" overlay) and counts down to the next attempt. The countdown is `aria-live="off"`, so its per-second updates are never read out.
- **Error boundaries** around the lesson, the workbench, the output panel, course pages and the palette: a crash in one panel shows "This panel failed to render" with the message and a "Try again" button; the rest of the workshop keeps working.

## G6. Warning banner

- `/api/warnings` reports when files under the course's `exercises/` directory differ from the committed course (`git status --porcelain -z -- exercises`, run with an argument array, a 5 s timeout and no prompts; no git means no warning). Learners should work in their playground; editing the course sources by mistake (for example in an external editor) is the case Epic's red banner warns about.
- The banner lists up to five paths as text and says where the playground is. "Dismiss" hides it until the set of changed paths changes; "Don't warn me again" stores `exercises-changed` in the dismissed warnings preference (Epic's "dismiss exercise warning"). It is a named `role="region"`.
- Epic's other warning, "the playground is set to a different step", does not apply: every Icode step has its own playground.

## G7. OG image and robots

- `/api/og.svg?title=&subtitle=` returns a 1200×630 SVG card with the course (or given) title. It is generated with string templates and XML escaping: no network, no font downloads and no emoji CDN, so it works offline (Epic's `/og` returns 500 offline because it fetches Google Fonts and jsDelivr at request time). Text is cut to 120 characters and wrapped. The API's `Content-Security-Policy: default-src 'none'; sandbox` stays on the response, so the SVG cannot run script even when opened directly.
- `index.html` carries `og:title`, `og:image` and `twitter:card` meta tags; the UI updates the title from the course.
- `public/robots.txt` disallows indexing: the workshop is a local application.
- PNG output (most social crawlers want PNG) and a sitemap need a hosted, read-only workshop with public URLs. Both wait for deployed mode (H6). G7 is therefore Partial.

## G8. Scroll restoration

- Changing view (step or course page) starts at the top. The window scroll position is saved per view (step id plus course page) in `sessionStorage` when the learner leaves a view, and restored after the view has rendered. Returning to a lesson puts the learner where they were. Heading links and deep links win over the stored position. The "Restore scroll positions" preference turns it off. Positions are numbers, capped at 200 entries.

## Accessibility

- Every new control is a native button, input, select or link, or follows the ARIA pattern named above. Everything is keyboard-operable, including recording a shortcut (Escape cancels).
- **Visible focus:** a 3 px focus ring in the `--focus` token on every focusable element (`:focus-visible`), checked at 3:1 against the background in every theme.
- **Dialogs:** `useFocusTrap` keeps Tab and Shift+Tab inside the open dialog, focuses the first field, and restores focus to the opener when it closes. The Stage 1 `ConfirmDialog` uses the same trap now.
- **Motion:** `prefers-reduced-motion: reduce` or the "reduce" preference stops animations and transitions and turns smooth scrolling off.
- **Automated checks:** `@axe-core/playwright` with WCAG 2.0/2.1 A and AA rules on the course home, a lesson, the palette, the shortcuts dialog and the preferences page, in light, dark and high-contrast themes, and with reduced motion. A violation fails the test. A keyboard-only journey (open palette, search, run a command, change the theme, remap a shortcut, close dialogs) runs without a mouse.

## Tests

- `packages/web/ux.test.mjs` (also on macOS and Windows in CI): preference schema including hostile input (CSS/HTML injection strings, `__proto__`/`constructor` keys, wrong types, oversize), per-key salvage of stored values, binding grammar, matcher, conflicts and reserved keys, fuzzy ranking, WCAG contrast of every theme token pair, OG escaping, and the palette's no-`fetch` rule.
- `packages/web/preferences.integration.test.mjs`: the real server; validated partial writes, 400 without side effects for 13 hostile bodies, tampered files salvaged, 403 for foreign Origin/Host/`Sec-Fetch-Site` and for the UI origin without (or with a wrong) session token, 409 under the mutation gate, health, git-based warnings and the escaped OG SVG.
- `tests/browser/ux.spec.mjs` (14 tests): keyboard-only palette journey with ARIA and focus trap/restore; crafted titles and file names (`<img onerror>`, `<script>`, `<svg onload>`) shown as text with no script run; palette and `s p` cannot skip `window.confirm`, and a destructive course action from the palette still needs the typed word (the palette cannot be opened over the confirmation); shortcuts dialog, sequences, typing guard, Diff `?`, remapping with conflict/reserved errors and persistence; themes with Shiki and Mermaid following, system/contrast media, fonts, zoom and motion; hostile `localStorage` and API preferences; server-down banner and retry; warning banner; scroll restoration; offline OG and robots; axe in three themes and with reduced motion.
- axe found faded text only while the workbench's entrance animation was running; the checks wait for animations to finish. It also flagged the Mermaid source fallback as a non-focusable scroll region, which no longer scrolls.

## Follow-ups (from the independent review of PR #10)

- **`launcher.test.mjs` and the Playwright web servers use fixed ports** (5173, 4317, 4318). They fail whenever another workshop or test run holds those ports on the same machine. A free port needs a `WORKSHOP_UI_PORT` threaded through `vite.config.mjs` (`UI_ORIGIN`), `allowedOrigin` in `server.mjs`, the CSP `connect-src` and the sandbox `frame-ancestors`. That is a separate change; this PR does not touch the launcher test.
- Remap rules (reserved keys, conflicts) are enforced in the UI only. The API validates the schema and the binding grammar. Confirmations are unaffected either way.
- "Allow animations" cannot bring back the workbench entrance animation under the OS reduce setting: that animation is defined only for `prefers-reduced-motion: no-preference`.
- Palette entries for lessons and course actions are a snapshot taken when the palette opens. Commands re-check their state when they run.
- While a dialog is open, Ctrl/Cmd+S reaches the browser.

## Security summary

- CSP, frame rules, the sandbox origin and the session token from Stage 3 are unchanged. The only new script is `public/theme-boot.js`, an engine file on the UI origin.
- Course-supplied strings (titles, module titles, step titles, file names, warning paths) are rendered as React text. The OG SVG escapes `& < > " '` and strips control characters.
- Preferences are validated on both sides and stored locally only. The preference API goes through the existing Host, Origin, `Sec-Fetch-Site`, session-token and mutation-gate checks.
- The palette and shortcuts cannot skip a confirmation: they call the same handlers as the buttons, and server-side typed confirmations remain server-side.

## More than Epic

1. One fuzzy search across commands, lessons and files, with `>`/`#`/`@` prefixes and highlighted matches.
2. Remappable shortcuts with conflict and reserved-key checks.
3. A high-contrast theme (AAA text contrast).
4. UI text size, editor font family and editor font size preferences.
5. A motion preference that overrides the OS setting.
6. Offline/server-down indicator with "Retry now" and backoff, instead of a blocking overlay.
7. Per-panel error boundaries with "Try again".
8. An offline OG image (Epic's returns 500 offline).
9. Disabled palette commands explain why they are unavailable.
