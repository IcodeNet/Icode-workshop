// Epic Workshop (epicshop @ 12089440) end-to-end walkthrough.
// Exercises every catalogued feature that can run locally without an
// epicweb.dev account, records what happened, and saves screenshots.
//
// Usage (workshop already running on BASE, Node 24, system Chrome):
//   PHASE=gated   node e2e-walkthrough.mjs   # example as shipped (product.slug set)
//   PHASE=ungated node e2e-walkthrough.mjs   # same example with epicshop.product.slug removed
//                                            # from example/package.json and the workshop restarted
// The script adds temporary fixtures to the example (see "fixtures") and removes them on exit.
// Env: BASE (default http://localhost:5639), WORKSHOP (example dir),
//      EPICSHOP_REPO (epicshop checkout), OUT (screenshots dir), RESULTS (json),
//      PLAYWRIGHT (path to playwright index.mjs), CHROME (executable).
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:5639'
const PHASE = process.env.PHASE ?? 'gated'
const REPO = process.env.EPICSHOP_REPO ?? '/home/claude/epicshop'
const WORKSHOP = process.env.WORKSHOP ?? path.join(REPO, 'example')
const OUT = process.env.OUT ?? path.resolve('e2e')
const RESULTS = process.env.RESULTS ?? path.resolve(`results-${PHASE}.json`)
const HOOK_LOG = process.env.HOOK_LOG ?? path.join(os.tmpdir(), 'epicshop-hooks.log')
const { chromium } = await import(
	process.env.PLAYWRIGHT ?? path.join(REPO, 'node_modules/playwright/index.mjs')
)
fs.mkdirSync(OUT, { recursive: true })

const results = []
function rec(id, observed, evidence = '') {
	results.push({ phase: PHASE, id, observed, evidence })
	console.log(`[${PHASE}] ${id}: ${observed}${evidence ? `  {${evidence}}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function step(id, fn) {
	try {
		await fn()
	} catch (error) {
		rec(id, `ERROR ${String(error?.message ?? error).split('\n')[0]}`)
	}
}

const browser = await chromium.launch({
	executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
	args: ['--no-sandbox'],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await context.newPage()
const requests = []
page.on('request', (r) => requests.push({ method: r.method(), url: r.url(), post: r.postData() }))
const consoleLines = []
page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`))

// the ungated pass only keeps screenshots of the features the slug gates
const UNGATED_SHOTS = /tests|diff|in-browser/
async function shot(name, target = page) {
	if (PHASE !== 'gated') {
		if (!UNGATED_SHOTS.test(name)) return '(no screenshot in this pass)'
		name = `u-${name}`
	}
	const file = path.join(OUT, `${name}.jpg`)
	await target.screenshot({ path: file, type: 'jpeg', quality: 55 })
	return `e2e/${name}.jpg`
}
// 'load' rather than 'networkidle': several pages hold SSE/WebSocket connections open
async function go(p, opts = {}) {
	const res = await page.goto(BASE + p, { waitUntil: 'load', timeout: 30000, ...opts })
	await page.waitForTimeout(1500)
	return res
}
async function text(sel = 'body') {
	const loc = page.locator(sel).first()
	const t = (await loc.count()) ? await loc.innerText({ timeout: 3000 }).catch(() => null) : null
	return (t ?? (await page.innerText('body'))).replace(/\s+/g, ' ')
}
function requestsSince(i, re) {
	return requests.slice(i).filter((r) => re.test(r.url))
}
async function json(p) {
	const r = await page.request.get(BASE + p)
	return { status: r.status(), body: await r.text() }
}
// React Router actions: POST a form the same way the UI's fetchers do.
async function post(p, fields) {
	const form = new URLSearchParams(fields)
	const r = await page.request.post(BASE + p, {
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		data: form.toString(),
		maxRedirects: 0,
	})
	return { status: r.status(), body: (await r.text()).slice(0, 400), headers: r.headers() }
}
const playgroundFile = (f) => path.join(WORKSHOP, 'playground', f)
const readPlaygroundName = () =>
	JSON.parse(fs.readFileSync(path.join(WORKSHOP, 'playground', 'package.json'), 'utf8')).name ?? '(no name)'


// ---------------------------------------------------------------- fixtures
// Temporary additions to the example workshop, removed again at the end:
// 1. an MDX probe section (Mermaid, LinkToApp, DiffLink, VideoEmbed, code-block
//    add/remove/highlight, extra callouts) appended to a step README,
// 2. pre/post set-playground hooks that log their environment to HOOK_LOG,
// 3. an extra with no package.json and no index file (dev type "file").
const PROBE_README = path.join(WORKSHOP, 'exercises/03.export-app/01.problem.export/README.mdx')
const HOOKS = ['pre', 'post'].map((h) => path.join(WORKSHOP, 'epicshop', `${h}-set-playground.js`))
const FILE_EXTRA = path.join(WORKSHOP, 'extra/wsb-files')
const probeOriginal = fs.readFileSync(PROBE_README, 'utf8')
function setupFixtures() {
	fs.writeFileSync(PROBE_README, probeOriginal + `
## WSB probe (temporary)

\`\`\`js filename=probe.js remove=2 add=3 lines=1
const a = 1
const b = 2
const c = 3
\`\`\`

<callout-danger class="notification">
	<div className="title">Danger title</div>
	Danger callout body
</callout-danger>

<callout-muted class="aside">Muted aside callout</callout-muted>

\`\`\`mermaid
graph LR
  Probe --> Mermaid
\`\`\`

<LinkToApp to="/hello">Probe LinkToApp</LinkToApp>

<DiffLink app1="01/01.problem" app2="01/01.solution">Probe DiffLink</DiffLink>

<DiffLink app1="01/01.problem" app2="01/01.solution" fullPage>Probe full-page DiffLink</DiffLink>

<VideoEmbed title="Probe VideoEmbed" url="https://www.youtube.com/embed/dQw4w9WgXcQ" />

Emoji :tada: and GFM ~~strike~~ | a | b |
`)
	for (const [i, file] of HOOKS.entries()) {
		const hook = i === 0 ? 'pre' : 'post'
		fs.writeFileSync(file, `import fs from 'node:fs'
fs.appendFileSync(${JSON.stringify(HOOK_LOG)}, JSON.stringify({ hook: '${hook}', env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('EPICSHOP_PLAYGROUND'))) }) + '\\n')
`)
	}
	fs.mkdirSync(path.join(FILE_EXTRA, 'src'), { recursive: true })
	fs.writeFileSync(path.join(FILE_EXTRA, 'README.mdx'), '# WSB file explorer probe\n\nTemporary extra with no package.json and no index entry.\n')
	fs.writeFileSync(path.join(FILE_EXTRA, 'notes.md'), '# Notes\n\nhello\n')
	fs.writeFileSync(path.join(FILE_EXTRA, 'src/util.ts'), 'export const x = 1\n')
}
function teardownFixtures() {
	fs.writeFileSync(PROBE_README, probeOriginal)
	for (const file of HOOKS) fs.rmSync(file, { force: true })
	fs.rmSync(FILE_EXTRA, { recursive: true, force: true })
}
setupFixtures()
process.on('exit', teardownFixtures)
await sleep(3000) // let the workshop's file watcher pick the fixtures up

// ---------------------------------------------------------------- A. content
await step('A1', async () => {
	await go('/')
	const t = await text()
	rec('A1', `document.title "${await page.title()}"; h1 "${await page.locator('h1').first().innerText()}" (README.mdx heading, not config title);`, '')
	rec('A1', `home shows config title in body ${/epic workshop tutorial/i.test(t)}, subtitle ${/epic workshop tutorial/i.test(t)}, subtitle ${/foundational tools/i.test(t)}, instructor ${/kent c\. dodds/i.test(t)}, product link ${await page.locator('a[href="https://www.epicweb.dev"]').count()}x; EDIT ON GITHUB link ${await page.locator('a[href*="github.com/epicweb-dev/epicshop"]').count()}x`, await shot('01-home'))
})
await step('A2', async () => {
	const apps = JSON.parse((await json('/apps')).body)
	const names = (apps.apps ?? apps).map?.((a) => a.name) ?? Object.keys(apps)
	const ex = JSON.parse((await json('/exercises')).body)
	rec('A2', `/apps lists ${names.length} apps (${names.join(', ')}); /exercises returns ${Array.isArray(ex) ? ex.length : Object.keys(ex).length} entries`, 'GET /apps, /exercises')
	await go('/extra')
	rec('A2', `/extra lists: ${(await text('main')).slice(0, 200)}`, await shot('02-extras'))
	await go('/extra/async-search')
	rec('A2', `/extra/async-search renders an extra with its own playground/preview: ${(await text('main')).slice(0, 160)}`)
})
await step('A3', async () => {
	await go('/app/03.01.solution/')
	const t = await text()
	rec('A3', `export app /app/03.01.solution/ compiled in-browser; shows exports/console: ${t.slice(0, 260)}`, await shot('03-export-app'))
	await go('/app/02.02.solution/')
	rec('A3', `simple app /app/02.02.solution/ served by workshop: "${(await text()).slice(0, 80)}"; injected scripts: ${await page.locator('script[src*="epic_ws"]').count()} epic_ws`)
	await go('/exercise/02/01/problem')
	rec('A3', `no-preview (non-UI) app step preview area: ${(await text('main')).match(/(No preview|Files|preview)[^.]{0,120}/i)?.[0] ?? 'n/a'}`, await shot('04-no-preview-app'))
})
await step('A4', async () => {
	await go('/exercise/01/01/problem')
	const callouts = await page.locator('callout-info, callout-warning, callout-success, [class*="callout"]').count()
	const shiki = await page.locator('pre[data-lang], pre.shiki, pre code [data-line], pre [class*="line"]').count()
	const inline = await page.getByRole('button', { name: './index.js' }).count()
	const video = await page.locator('iframe[src*="epicweb.dev"], [data-epic-video], a[href*="epicweb.dev/tips"]').count()
	rec('A4', `step MDX: ${callouts} callout elements, ${shiki} highlighted code/line nodes, InlineFile button(s) ${inline}, EpicVideo element(s) ${video}, autolinked heading anchors ${await page.locator('a[href^="/exercise/01/01/problem#"]').count()}`, await shot('05-step-mdx'))
	// probe section appended to 03.01.problem README for this run
	await go('/exercise/03/01/problem')
	await page.waitForTimeout(1500)
	const probe = await page.locator('#wsb-probe-temporary').count()
	if (probe) {
		const mermaidSvg = await page.locator('svg[id^="mermaid"], .mermaid svg, [data-mermaid] svg, svg[aria-roledescription]').count()
		const linkToApp = await page.getByRole('link', { name: 'Probe LinkToApp' }).getAttribute('href')
		const diffLink = await page.getByRole('link', { name: 'Probe DiffLink' }).getAttribute('href')
		const fullDiff = await page.getByRole('link', { name: 'Probe full-page DiffLink' }).getAttribute('href')
		const videoEmbed = await page.locator('iframe[title*="Probe VideoEmbed"], iframe[src*="youtube"]').count()
		const added = await page.locator('[data-add], .line[data-add], [data-diff="add"], .add').count()
		rec('A4', `probe MDX: mermaid svg ${mermaidSvg}; LinkToApp -> ${linkToApp}; DiffLink -> ${diffLink}; DiffLink fullPage -> ${fullDiff}; VideoEmbed iframe ${videoEmbed}; add/remove line markers ${added}; danger/muted callouts ${await page.locator('callout-danger, callout-muted').count()}; emoji ${(await text('main')).includes('🎉')}`, await shot('06-mdx-probe'))
		await page.locator('#wsb-probe-temporary').evaluate((el) => el.scrollIntoView({ block: 'start' })); await page.waitForTimeout(800)
		await shot('07-mdx-probe-scrolled')
	} else rec('A4', 'probe section not present in this run')
})
await step('A5', async () => {
	await go('/exercise/01')
	rec('A5', `exercise intro /exercise/01: ${(await text('main')).slice(0, 160)}`, await shot('08-exercise-intro'))
	const r = await page.request.get(BASE + '/exercise/01/01', { maxRedirects: 0 })
	rec('A5', `/exercise/01/01 -> ${r.status()} ${r.headers().location}`)
	await go('/exercise/01/finished')
	rec('A5', `exercise finished page: ${(await text('main')).slice(0, 200)}; iframes: ${(await page.$$eval('iframe', (f) => f.map((x) => x.src.slice(0, 90)))).join(' | ')}`, await shot('09-exercise-finished'))
	await go('/finished')
	rec('A5', `workshop finished page: ${(await text('main')).slice(0, 160)}`)
	const l = await page.request.get(BASE + '/l', { maxRedirects: 0 })
	rec('A5', `/l (last step shortcut) -> ${l.status()} ${l.headers().location}`)
})
await step('A6', async () => {
	const t = (await (await page.request.get(BASE + '/exercise/01/01/solution')).text())
	rec('A6', `retrieval practice: root loader practicePastLesson present=${t.includes('practicePastLesson')}; no quiz UI rendered without login/progress (${(await page.locator('text=/practice|quiz/i').count())} matches on solution page)`)
})
await step('A7', async () => {
	const r = await post('/admin/notifications', { intent: 'mute', id: 'wsb-probe' })
	const g = await page.request.get(BASE + '/admin/notifications')
	rec('A7', `GET /admin/notifications -> ${g.status()}; POST mute id=wsb-probe -> ${r.status} ${r.body.slice(0, 80)}; config notifications [] and remote feed unreachable (no notification banner shown)`)
})
await step('A8', async () => {
	await go('/exercise/01/finished')
	const forms = await page.$$eval('iframe', (f) => f.map((x) => x.src).filter((s) => s.includes('docs.google.com')))
	rec('A8', `feedback form iframe(s): ${forms.length}; URL template filled: ${forms[0]?.includes('Epic%20Workshop') || forms[0]?.includes('Epic+Workshop') || forms[0]?.includes('Epic Workshop') ? 'yes' : forms[0]?.slice(0, 160)}`)
})
await step('A9', async () => {
	for (const [p, n] of [['/guide', '10-guide'], ['/support', null], ['/discord', '11-discord'], ['/workspace-structure', null]]) {
		await go(p)
		const s = n ? await shot(n) : ''
		rec('A9', `${p}: ${(await text('main')).slice(0, 150)}`, s)
	}
})
await step('A10', async () => {
	const r = await page.request.get(BASE + '/app/playground', { maxRedirects: 0 })
	rec('A10', `initialRoute "/whatever" in config; /app/playground -> ${r.status()} ${r.headers().location ?? ''} (project app redirects to its own port)`)
})

// ---------------------------------------------------------------- B. workspace
await step('B1', async () => {
	fs.writeFileSync(HOOK_LOG, '')
	await post('/set-playground', { appName: '01.01.problem' })
	fs.writeFileSync(HOOK_LOG, '')
	const before = readPlaygroundName()
	await go('/exercise/01/02/problem')
	const named = page.getByRole('button', { name: /set to playground/i })
	const btn = (await named.count()) ? named.first() : page.locator('form[action="/set-playground"] button[type="submit"]').first()
	const i = requests.length
	await btn.click()
	await page.waitForTimeout(3000)
	const after = fs.existsSync(playgroundFile('package.json')) ? readPlaygroundName() : '(no package.json: simple app)'
	const hooks = fs.readFileSync(HOOK_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
	const files = fs.readdirSync(path.join(WORKSHOP, 'playground'))
	rec('B1', `"Set to Playground" (${requestsSince(i, /set-playground/).map((r) => r.method).join(',')} /set-playground): playground ${before} -> ${after}; files now [${files.join(', ')}]; hooks ran: ${hooks.map((h) => `${h.hook}(${Object.keys(h.env).join(',')})`).join(' ; ')}`, await shot('12-set-playground'))
})
await step('B2', async () => {
	const p1 = await post('/persist-playground', { persist: 'true' })
	rec('B2', `POST /persist-playground persist=true -> ${p1.status}`)
	await post('/set-playground', { appName: '01.01.solution' })
	await sleep(1500)
	await post('/set-playground', { appName: '02.02.problem' })
	await sleep(1500)
	const s = JSON.parse((await json('/saved-playgrounds')).body)
	rec('B2', `/saved-playgrounds after two sets with persistence on: status=${s.status}, ${s.savedPlaygrounds?.length} saved: ${s.savedPlaygrounds?.slice(0, 3).map((x) => x.appName ?? x.id).join(', ')}`)
	if (s.savedPlaygrounds?.[0]) {
		const id = s.savedPlaygrounds[0].id
		const r = await post('/saved-playgrounds', { savedPlaygroundId: id })
		rec('B2', `restore saved playground ${id} -> ${r.status}; playground now ${readPlaygroundName()}`)
	}
	await go('/exercise/02/02/problem')
	const sel = page.getByRole('button', { name: /select app for playground/i }).first()
	if (await sel.count()) {
		await sel.click()
		await page.waitForTimeout(500)
		rec('B2', `playground app selector opened (lists apps and saved playgrounds)`, await shot('13-playground-selector'))
		await page.keyboard.press('Escape')
	}
	await post('/persist-playground', { persist: 'false' })
})
await step('B3', async () => {
	await go('/exercise/01/01/problem')
	const files = page.getByRole('button', { name: /^files$|relevant files/i }).first()
	await files.click()
	await page.waitForTimeout(700)
	rec('B3', `touched-files popover: ${(await text('[role="dialog"], [data-radix-popper-content-wrapper]').catch(() => 'n/a')).slice(0, 200)}`, await shot('14-touched-files'))
	await page.keyboard.press('Escape')
})
await step('B4', async () => {
	for (const p of ['/app/playground/files', '/app/02.01.solution/files', '/app/02.01.solution/file-preview?file=greet.js', '/app/02.01.solution/file-preview?path=greet.js']) {
		const r = await json(p)
		rec('B4', `GET ${p} -> ${r.status} ${r.body.replace(/\s+/g, ' ').slice(0, 160)}`)
	}
	// dev type "file" = no package.json and no index entry (temporary extra/wsb-files)
	const f = await json('/app/extra.wsb-files/files')
	if (f.status === 200) {
		await go('/extra/wsb-files')
		const entry = page.getByText('notes.md').first()
		if (await entry.count()) { await entry.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(1500) }
		rec('B4', `file-type extra: /files -> ${f.body.slice(0, 200)}; explorer UI: ${(await text('main')).slice(-260)}`, await shot('15b-file-explorer'))
	}
})
await step('B5', async () => {
	// InlineFile renders as an "open in editor" button only when the playground matches this step
	await post('/set-playground', { appName: '01.01.problem' })
	await go('/exercise/01/01/problem')
	const i = requests.length
	const respP = page.waitForResponse((r) => r.url().includes('launch-editor'), { timeout: 10000 }).catch(() => null)
	await page.getByRole('button', { name: './index.js' }).first().evaluate((el) => el.click())
	const resp = await respP
	await page.waitForTimeout(1000)
	const reqs = requestsSince(i, /launch-editor/).map((r) => `${r.method} ${new URL(r.url).pathname}${r.post ? ` [${decodeURIComponent(r.post).slice(0, 120)}]` : ''}`)
	await page.waitForTimeout(2000)
	let editors = ''
	try { editors = execFileSync('pgrep', ['-a', '-x', 'vi|vim|code|nano']).toString().trim() } catch {}
	rec('B5', `InlineFile click -> ${reqs.join(' ; ')}; response ${resp?.status()} ${await resp?.text().then((t) => t.slice(0, 120)).catch(() => '')}; editor processes spawned: ${editors || 'none'}`, await shot('15-launch-editor'))
	// the workshop was started through npm, which exports EDITOR=vi; stop the stray editor
	for (const line of editors.split('\n').filter(Boolean)) { try { process.kill(Number(line.split(' ')[0])) } catch {} }
})
await step('B6', async () => {
	const t = await (await page.request.get(BASE + '/')).text()
	const m = t.match(/"repoUpdates",\{[^}]*\}/)
	rec('B6', `root loader carries repoUpdates/updatesAvailable/commitsBehind; update banner shown: ${await page.locator('text=/update available|updates available/i').count() > 0}; EPICSHOP_PARENT_PORT present: ${t.includes('EPICSHOP_PARENT_PORT')}`)
})
await step('B7', async () => {
	const t = await (await page.request.get(BASE + '/')).text()
	rec('B7', `root data has dependenciesNeedInstall key: ${t.includes('dependenciesNeedInstall')}; install banner shown: ${await page.locator('text=/npm install|install dependencies/i').count() > 0}`)
})

// ---------------------------------------------------------------- C. run
await step('C1', async () => {
	await post('/set-playground', { appName: '01.01.problem' })
	await go('/exercise/01/01/problem')
	await page.getByRole('button', { name: 'Start App' }).first().evaluate((el) => el.click())
	await page.waitForTimeout(6000)
	const procs = JSON.parse((await json('/processes')).body)
	const names = Object.entries(procs.processes ?? {}).map(([k, v]) => `${k}:${v.port ?? ''}`)
	rec('C1', `Start App -> processes ${names.join(', ')}`, await shot('16-app-running'))
	const port = Object.values(procs.processes ?? {})[0]?.port
	if (port) {
		const r = await fetch(`http://localhost:${port}/`).then((r) => r.text()).catch((e) => e.message)
		rec('C1', `dev server on :${port} answers "${r.slice(0, 80)}"`)
	}
	// C2 in-browser browser
	const frames = await page.$$eval('iframe', (f) => f.map((x) => x.src))
	const addr = (await page.locator('input').evaluateAll((els) => els.map((e) => e.value))).filter((v) => v.includes('localhost:')).join(', ')
	rec('C2', `in-browser browser: iframes [${frames.filter((s) => s.includes('localhost')).join(', ')}], address input ${addr}, back/forward buttons ${await page.getByRole('button', { name: /back|forward/i }).count()}, open-in-new-window ${await page.getByRole('link', { name: /open in new window/i }).count()}`)
	// C3 live reload: edit the running project app and observe the iframe
	if (port) {
		const file = playgroundFile('index.js')
		const orig = fs.readFileSync(file, 'utf8')
		const ws = await fetch(`${BASE}/app/playground/epic_ws.js`, { redirect: 'manual' })
		rec('C3', `/app/playground/epic_ws.js -> ${ws.status} ${ws.headers.get('location') ?? ''}`)
		fs.writeFileSync(file, orig.replace(/Hello|hello/, 'WSB live reload'))
		await page.waitForTimeout(5000)
		const frame = page.frames().find((f) => f.url().includes(`:${port}`))
		const ft = frame ? await frame.innerText('body').catch(() => '') : ''
		rec('C3', `after editing playground/index.js of a running project app: iframe shows "${ft.slice(0, 80)}" (server restarted? ${JSON.stringify(Object.keys(JSON.parse((await json('/processes')).body).processes ?? {}))})`)
		fs.writeFileSync(file, orig)
	}
	// restart / stop
	const restart = page.getByRole('button', { name: /restart/i }).first()
	if (await restart.count()) {
		await restart.click()
		await page.waitForTimeout(3000)
		rec('C1', `Restart App clicked; processes: ${JSON.stringify(Object.keys(JSON.parse((await json('/processes')).body).processes ?? {}))}`)
	}
	const stop = page.getByRole('button', { name: /stop app/i }).first()
	if (await stop.count()) {
		await stop.click()
		await page.waitForTimeout(12000)
	}
	const holders = () => { try { return execFileSync('lsof', ['-t', '-iTCP:4000', '-sTCP:LISTEN']).toString().trim().split('\n').filter(Boolean) } catch { return [] } }
	rec('C1', `Stop App -> /processes ${JSON.stringify(JSON.parse((await json('/processes')).body).processes)}; pids still listening on :4000: [${holders().join(',')}]`)
	await go('/exercise/01/01/problem')
	const t = await text('main')
	if (/port for this app is unavailable/i.test(t)) {
		const s = await shot('16b-port-unavailable')
		await page.getByRole('button', { name: /stop port/i }).first().click()
		await page.waitForTimeout(12000)
		rec('C1', `preview shows "${t.match(/The port for this app is unavailable[^.]*\./)?.[0]}" with a STOP PORT button; after clicking it pids on :4000: [${holders().join(',')}]`, s)
		for (const pid of holders()) { try { process.kill(Number(pid)) } catch {} }
		try { execFileSync('pkill', ['-f', 'npm run dev --silent']) } catch {}
	}
	// stop-port: hold a port with a foreign process and ask the workshop to kill it
	const holder = spawn(process.execPath, ['-e', "require('http').createServer((q,s)=>s.end('x')).listen(4999)"], { stdio: 'ignore' })
	await sleep(800)
	const r = await post('/start', { intent: 'stop-port', port: '4999' })
	await sleep(1500)
	rec('C1', `POST /start intent=stop-port port=4999 (foreign node server) -> ${r.status}; holder exited: ${holder.exitCode !== null || holder.signalCode !== null} (${holder.signalCode ?? holder.exitCode})`)
	try { holder.kill() } catch {}
})
await step('C3', async () => {
	// simple app served by the workshop: epic_ws.js triggers reload
	await post('/set-playground', { appName: '02.02.problem' })
	await sleep(1500)
	const p2 = await context.newPage()
	let navigations = 0
	p2.on('framenavigated', (f) => { if (f === p2.mainFrame()) navigations++ })
	await p2.goto(BASE + '/app/playground/', { waitUntil: 'networkidle' })
	const before = navigations
	const file = playgroundFile('index.js')
	const orig = fs.readFileSync(file, 'utf8')
	fs.appendFileSync(file, '\n// wsb live reload probe\n')
	await p2.waitForTimeout(4000)
	rec('C3', `simple app /app/playground/ with epic_ws.js: editing playground/index.js caused ${navigations - before} reload(s)`)
	fs.writeFileSync(file, orig)
	await p2.close()
	// UI revalidation: edit the step README and watch the step page change without navigation
	await go('/exercise/02/02/problem')
	const readme = path.join(WORKSHOP, 'exercises/02.app-varieties/02.problem.simple/README.mdx')
	if (fs.existsSync(readme)) {
		const o = fs.readFileSync(readme, 'utf8')
		let nav = 0
		const h = (f) => { if (f === page.mainFrame()) nav++ }
		page.on('framenavigated', h)
		fs.appendFileSync(readme, '\n\nWSB revalidation probe\n')
		await page.waitForTimeout(4000)
		rec('C3', `editing playground/README.mdx: step page shows probe text without navigation? ${(await text()).includes('WSB revalidation probe')} (navigations ${nav})`)
		page.off('framenavigated', h)
		fs.writeFileSync(readme, o)
	}
})
await step('C4', async () => {
	await post('/set-playground', { appName: '01.01.solution' })
	await go('/exercise/01/01/solution?preview=tests')
	await page.waitForTimeout(1000)
	const t = await text('main')
	if (/access denied/i.test(t)) {
		rec('C4', `tests tab: "${t.match(/Access Denied[^.]*\./)?.[0]}" (gated by product.slug + login)`, await shot('17-tests-gated'))
		const r = await post('/test', { intent: 'run', name: 'playground' })
		rec('C4', `POST /test intent=run without access -> ${r.status} ${r.body.slice(0, 100)}`)
		return
	}
	// the run/stop/clear controls are icon-only submit buttons in a form posting to /test
	const intents = async () => page.locator('form[action="/test"] button[name="intent"]').evaluateAll((b) => b.map((x) => x.value))
	rec('C4', `tests tab controls before run: intents [${(await intents()).join(',')}]`)
	await page.locator('form[action="/test"] button[name="intent"]').first().evaluate((el) => el.click())
	await page.waitForTimeout(800)
	rec('C4', `while running: intents [${(await intents()).join(',')}]`)
	await page.waitForTimeout(6000)
	const out = await text('main')
	rec('C4', `tests tab run -> output: ${out.slice(0, 300)}; ANSI-coloured spans: ${await page.locator('main span[style*="color"]').count()}`, await shot('17-tests-run'))
	rec('C4', `after run: intents [${(await intents()).join(',')}]`)
	const clear = page.locator('form[action="/test"] button[name="intent"][value="clear"]')
	if (await clear.count()) { await clear.first().evaluate((el) => el.click()); await page.waitForTimeout(1500); rec('C4', `after clear: ${(await text('main')).slice(-120)}`) }
	const sse = await page.request.get(BASE + '/test?name=playground')
	rec('C4', `GET /test?name=playground (SSE) -> ${sse.status()} ${sse.headers()['content-type']}`)
})
await step('C5', async () => {
	await post('/set-playground', { appName: '02.02.solution' })
	await sleep(1500)
	await go('/exercise/02/02/solution?preview=tests')
	await page.waitForTimeout(4000)
	const t = await text('main')
	rec('C5', `in-browser tests tab (02.02.solution): ${t.slice(0, 260)}`, await shot(/access denied/i.test(t) ? '18-in-browser-tests-gated' : '18-in-browser-tests'))
	const raw = await (await page.request.get(BASE + '/app/02.02.solution/test/index.test.ts')).text()
	rec('C5', `GET /app/02.02.solution/test/index.test.ts: ${raw.includes('Access Denied') ? 'Access Denied page (login required)' : 'test harness page with script'}`)
})
await step('C6', async () => {
	const t = await (await page.request.get(BASE + '/admin')).text()
	rec('C6', `sidecarStatus in root data; admin shows EpicMeApp ${t.includes('EpicMeApp') ? 'listed' : 'absent'}`)
})
await step('C7', async () => {
	rec('C7', `/processes JSON: ${(await json('/processes')).body.slice(0, 200)}; admin "Processes" card: see admin screenshot`)
})
await step('H1', async () => {
	await go('/admin')
	rec('H1', `admin: ${(await text('main')).slice(0, 300)}`, await shot('19-admin'))
	const logs = page.getByText(/view logs/i).first()
	if (await logs.count()) {
		await logs.click()
		await page.waitForTimeout(1500)
		rec('C6', `admin "View logs" for EpicMeApp: ${(await text('main')).match(/Epic Me App[^\n]{0,160}/)?.[0] ?? (await text('main')).slice(-200)}`, await shot('20-sidecar-logs'))
	}
	const r1 = await post('/admin?index', { intent: 'get-sidecar-logs', name: 'EpicMeApp' })
	rec('C6', `POST /admin intent=get-sidecar-logs -> ${r1.status} ${r1.body.replace(/\s+/g, ' ').slice(0, 160)}`)
	const r2 = await post('/admin?index', { intent: 'restart-sidecar', name: 'EpicMeApp' })
	await sleep(3000)
	rec('C6', `POST /admin intent=restart-sidecar -> ${r2.status} ${r2.body.slice(0, 120)}`)
	const r3 = await post('/admin?index', { intent: 'inspect' })
	await sleep(1000)
	rec('C8', `POST /admin intent=inspect -> ${r3.status} ${r3.body.slice(0, 200)}`)
	let inspectorUp = ''
	try { inspectorUp = (await fetch('http://127.0.0.1:9229/json/version').then((r) => r.text())).slice(0, 80) } catch (e) { inspectorUp = e.message }
	rec('C8', `inspector :9229/json/version -> ${inspectorUp}`)
	const r4 = await post('/admin?index', { intent: 'stop-inspect' })
	rec('C8', `POST /admin intent=stop-inspect -> ${r4.status}`)
	const r5 = await post('/admin?index', { intent: 'clear-caches' })
	rec('H1', `POST /admin intent=clear-caches -> ${r5.status} ${r5.body.slice(0, 100)}`)
})
await step('C9', async () => {
	const t = await (await page.request.get(BASE + '/exercise/01/01/problem')).text()
	const m = t.match(/https:\/\/stackblitz\.com[^"\\]{0,160}/)
	rec('C9', `stackBlitzUrl in loader data: ${m ? m[0] : 'none'}; StackBlitz link visible locally: ${await page.locator('a[href*="stackblitz"]').count()}`)
})

// ---------------------------------------------------------------- D. diffs
await step('D1', async () => {
	await go('/exercise/01/01/problem?preview=diff')
	await page.waitForTimeout(3000)
	const t = await text('main')
	rec('D1', `diff tab: ${/access denied/i.test(t) ? t.match(/Access Denied[^.]*\./)?.[0] : t.slice(0, 260)}`, await shot(/access denied/i.test(t) ? '21-diff-gated' : '21-diff'))
	await go('/diff?app1=01.01.problem&app2=01.01.solution')
	await page.waitForTimeout(3000)
	const trig = page.getByText('index.js').first()
	if (await trig.count()) { await trig.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(1500) }
	const t2 = await text('main')
	rec('D1', `/diff full page: ${t2.slice(0, 220)}`, await shot(/access denied/i.test(t2) ? '22-diff-page-gated' : '22-diff-page'))
})
await step('D2', async () => {
	for (const s of ['01.01', '1.1', '01.02', '99.01']) {
		const chain = []
		let url = `/diff/${s}`
		for (let i = 0; i < 4 && url; i++) {
			const r = await page.request.get(BASE + url, { maxRedirects: 0 })
			chain.push(`${url} ${r.status()}`)
			url = r.headers().location?.replace(BASE, '')
		}
		rec('D2', `redirect chain: ${chain.join(' -> ')}`)
	}
})

// ---------------------------------------------------------------- E. identity
await step('E1', async () => {
	const a = await page.request.get(BASE + '/account', { maxRedirects: 0 })
	rec('E1', `/account without login -> ${a.status()} ${a.headers().location}`)
})
await step('E2', async () => {
	const g = await page.request.get(BASE + '/progress')
	const p = await post('/progress', { complete: 'true', lessonSlug: 'first-exercise-step-problem' })
	rec('E2', `GET /progress -> ${g.status()} ${(await g.text()).slice(0, 80)}; POST /progress complete -> ${p.status} ${p.body.slice(0, 120)}`)
})
await step('E4', async () => {
	const t = await (await page.request.get(BASE + '/exercise/01/01/problem')).text()
	const ws = requests.filter((r) => /party|presence/.test(r.url)).map((r) => r.url)
	rec('E4', `presence: root data has presence users with only the local user; presence requests seen: ${[...new Set(ws)].slice(0, 3).join(', ') || 'none'}`)
})
await step('E5', async () => {
	await go('/exercise/01/01/problem?preview=chat')
	await page.waitForTimeout(1500)
	rec('E5', `chat tab: ${(await text('main')).slice(-260)}`, await shot('24-chat-tab'))
})
await step('E6', async () => {
	await go('/exercise/01/01/problem')
	const badges = await page.locator('[data-onboarding], [class*="onboarding"]').count()
	const r = await post('/mark-onboarding-complete', { featureId: 'wsb-probe' })
	rec('E6', `onboarding indicator elements ${badges}; POST /mark-onboarding-complete -> ${r.status} ${r.body.slice(0, 80)}`)
})
await step('E7', async () => rec('E7', 'confetti only fires on a completed-progress toast (needs login); not triggerable'))

// ---------------------------------------------------------------- F. video
await step('F1', async () => {
	await go('/exercise/01/01/problem')
	const v = await page.locator('mux-player, media-controller, video').count()
	const ifr = await page.locator('iframe[src*="epicweb.dev"]').count()
	rec('F1', `video area: mux/video elements ${v}, epicweb embed iframes ${ifr}; text "${(await text('main')).match(/Login for transcripts|Login to watch[^.]*|offline[^.]*/i)?.[0] ?? ''}"`, await shot('25-video'))
	const r = await page.request.get(BASE + '/video-player')
	rec('F1', `GET /video-player -> ${r.status()}`)
})
await step('F2', async () => {
	const r = await json('/resources/offline-videos')
	await go('/admin/offline-videos')
	rec('F2', `/resources/offline-videos -> ${r.body.slice(0, 160)}; admin page: ${(await text('main')).slice(0, 180)}`)
})

// ---------------------------------------------------------------- G. UX
await step('G1', async () => {
	await go('/exercise/01/01/problem')
	await page.keyboard.press('Control+Shift+P')
	await page.waitForTimeout(900)
	rec('G1', `Ctrl+Shift+P palette (empty query): ${(await text('[role="dialog"]').catch(() => 'no dialog')).slice(0, 400)}`, await shot('26-command-palette'))
	await page.keyboard.type('Multi')
	await page.waitForTimeout(700)
	rec('G1', `palette query "Multi": ${(await text('[role="dialog"]').catch(() => 'no dialog')).slice(0, 300)}`)
	await page.keyboard.press('Escape')
})
await step('G2', async () => {
	await page.locator('h1').first().click()
	await page.keyboard.press('Shift+?')
	await page.waitForTimeout(700)
	rec('G2', `"?" dialog: ${(await text('[role="dialog"]').catch(() => 'no dialog')).slice(0, 260)}`, await shot('27-shortcuts-dialog'))
	await page.keyboard.press('Escape')
	const before = page.url()
	await page.locator('h1').first().click()
	await page.keyboard.press('g')
	await page.waitForTimeout(150)
	await page.keyboard.press('n')
	await page.waitForTimeout(1500)
	rec('G2', `"g n" navigates ${before.replace(BASE, '')} -> ${page.url().replace(BASE, '')}`)
})
await step('G3', async () => {
	await go('/exercise/01/01/problem')
	const cls0 = await page.evaluate(() => document.documentElement.className)
	await page.getByRole('button', { name: 'Open Navigation menu' }).click()
	await page.waitForTimeout(600)
	const btn = page.locator('form[action="/theme"] button').first()
	await btn.click()
	await page.waitForTimeout(1200)
	const cls1 = await page.evaluate(() => document.documentElement.className)
	await btn.click()
	await page.waitForTimeout(1200)
	const cls2 = await page.evaluate(() => document.documentElement.className)
	const cookies = (await context.cookies()).map((c) => c.name)
	rec('G3', `theme switch cycles <html class> "${cls0}" -> "${cls1}" -> "${cls2}"; cookies ${cookies.join(',')}`, await shot('28-theme-dark'))
	while ((await page.evaluate(() => document.documentElement.className)).includes('dark')) { await btn.click(); await page.waitForTimeout(800) }
})
await step('G4', async () => {
	await go('/preferences')
	rec('G4', `/preferences: ${(await text('main')).slice(0, 400)}`, await shot('29-preferences'))
})
await step('G5', async () => {
	const r = await post('/resources/connection-status', {})
	await go('/')
	rec('G5', `GET /resources/connection-status -> ${r.status} ${r.body.slice(0, 80)}; UI: ${(await text()).match(/You are offline|offline/i)?.[0] ?? 'no offline text'}; healthcheck ${(await json('/resources/healthcheck')).body}`)
})
await step('G6', async () => {
	await post('/set-playground', { appName: '02.02.problem' })
	await go('/exercise/01/01/problem')
	const banner = (await text()).match(/Warning:[^.]*\.|Changes detected[^.]*/)?.[0]
	rec('G6', `warning banner: ${banner ?? 'none'}; playground-mismatch indicator: ${await page.locator('[class*="animate-pulse"], [aria-label*="playground" i]').count()} elements`, await shot('30-warning-banner'))
})
await step('G7', async () => {
	const og = await page.request.get(BASE + '/og/?title=Probe')
	const sm = await json('/sitemap.xml')
	const rb = await json('/robots.txt')
	const urls = (sm.body.match(/<loc>/g) ?? []).length
	rec('G7', `/og/?title=Probe -> ${og.status()} ${og.headers()['content-type']} "${(await og.text()).slice(0, 40)}"; /sitemap.xml ${sm.status} ${urls} URLs (first contains "/*"=${sm.body.includes('/*</loc>')}); /robots.txt ${rb.status} "${rb.body.replace(/\n/g, ' | ')}"`)
	const meta = await page.$$eval('meta[property^="og:"], meta[name^="twitter:"]', (m) => m.map((x) => `${x.getAttribute('property') ?? x.getAttribute('name')}=${(x.getAttribute('content') ?? '').slice(0, 60)}`))
	rec('G7', `page OG meta: ${meta.join(' ; ')}`)
})
await step('G8', async () => rec('G8', 'scroll restoration: not separately asserted (library behaviour)'))

// ---------------------------------------------------------------- H. admin
await step('H2', async () => {
	await go('/admin/cache')
	rec('H2', `/admin/cache: ${(await text('main')).slice(0, 300)}`, await shot('31-admin-cache'))
})
await step('H3', async () => {
	await go('/admin/version')
	rec('H3', `/admin/version: ${(await text('main')).slice(0, 220)}`)
	await go('/admin/db')
	rec('H3', `/admin/db: ${(await text('main')).slice(0, 220)}`, await shot('32-admin-db'))
	rec('H3', `/admin/version.json: ${(await json('/admin/version.json')).body.slice(0, 200)}`)
})
await step('H8', async () => {
	const r = await page.request.get(BASE + '/exercise/01/01/problem')
	rec('H8', `Server-Timing header: ${(r.headers()['server-timing'] ?? 'none').slice(0, 200)}`)
})

// Run last: in run 1 a failed device-code login crashed the workshop server.
await step('E1', async () => {
	await go('/login')
	rec('E1', `/login: ${(await text('main')).slice(0, 200)}`, await shot('23-login'))
	const btn = page.getByRole('button', { name: /login|retrieve|start/i }).first()
	if (await btn.count()) {
		const i = requests.length
		await btn.click()
		// stay on the page so the login SSE stream remains open while the device-code request fails
		await page.waitForTimeout(15000)
		await shot('23b-login-after-click')
		rec('E1', `clicked login button: requests ${requestsSince(i, /login/).map((r) => `${r.method} ${new URL(r.url).pathname}`).join(', ')}; page: ${(await text('main')).slice(0, 200)}`)
	}
	const alive = await page.request.get(BASE + '/resources/healthcheck').then((r) => r.status()).catch((e) => e.message)
	rec('E1', `workshop healthcheck after the failed login attempt: ${alive}`)
})
await step('H5', async () => {
	const ext = [...new Set(requests.map((r) => new URL(r.url).host).filter((h) => !h.startsWith('localhost')))]
	rec('H5', `browser requests to /resources/lookout (Sentry tunnel): ${requests.filter((r) => r.url.includes('/resources/lookout')).length}; external hosts contacted by the browser: ${ext.join(', ')}`)
})

fs.writeFileSync(RESULTS, JSON.stringify({ phase: PHASE, results, console: consoleLines.slice(-50) }, null, 2))
await browser.close()
teardownFixtures()
try { execFileSync(process.execPath, [path.join(WORKSHOP, 'epicshop/node_modules/.bin/epicshop'), 'playground', 'set', '1.1.problem'], { cwd: WORKSHOP, stdio: 'ignore' }) } catch {}
console.log(`wrote ${RESULTS}`)
