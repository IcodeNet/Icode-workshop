// Start the Epic workshop MCP server (packages/workshop-mcp, built) over stdio,
// list its tools/resources/prompts and call the read-only tools.
// Usage: EPICSHOP_REPO=/path/to/epicshop WORKSHOP=/path/to/epicshop/example node mcp-probe.mjs > out.json
const REPO = process.env.EPICSHOP_REPO ?? '/home/claude/epicshop'
const SDK = `${REPO}/node_modules/@modelcontextprotocol/sdk/dist/esm/client`
const { Client } = await import(`${SDK}/index.js`)
const { StdioClientTransport } = await import(`${SDK}/stdio.js`)
const WS = process.env.WORKSHOP ?? `${REPO}/example`
const transport = new StdioClientTransport({ command: process.execPath, args: [`${REPO}/packages/workshop-mcp/dist/index.js`], cwd: WS, env: { ...process.env }, stderr: 'pipe' })
let stderr = ''; transport.stderr?.on('data', (d) => (stderr += d))
const client = new Client({ name: 'wsb-probe', version: '0.0.0' })
await client.connect(transport)
const out = { server: client.getServerVersion(), capabilities: client.getServerCapabilities() }
out.tools = (await client.listTools()).tools.map((t) => t.name)
out.resources = (await client.listResources().catch((e) => ({ resources: [{ name: 'ERR ' + e.message }] }))).resources.map((r) => r.uri ?? r.name)
out.resourceTemplates = (await client.listResourceTemplates().catch(() => ({ resourceTemplates: [] }))).resourceTemplates.map((r) => r.uriTemplate)
out.prompts = (await client.listPrompts().catch(() => ({ prompts: [] }))).prompts.map((p) => p.name)
const call = async (name, args) => {
  try {
    const r = await client.callTool({ name, arguments: args })
    const txt = r.content?.map((c) => c.text ?? `[${c.type}]`).join('\n') ?? JSON.stringify(r)
    return { isError: !!r.isError, chars: txt.length, head: txt.slice(0, 400) }
  } catch (e) { return { thrown: e.message.slice(0, 300) } }
}
out.calls = {
  get_workshop_context: await call('get_workshop_context', { workshopDirectory: WS }),
  get_exercise_context: await call('get_exercise_context', { workshopDirectory: WS, exerciseNumber: 1 }),
  get_exercise_step_context: await call('get_exercise_step_context', { workshopDirectory: WS, exerciseNumber: 1, stepNumber: 1 }),
  get_what_is_next: await call('get_what_is_next', { workshopDirectory: WS }),
  get_diff_between_apps: await call('get_diff_between_apps', { workshopDirectory: WS, app1: '01.01.problem', app2: '01.01.solution' }),
  get_exercise_step_progress_diff: await call('get_exercise_step_progress_diff', { workshopDirectory: WS }),
  list_saved_playgrounds: await call('list_saved_playgrounds', { workshopDirectory: WS }),
  get_user_info: await call('get_user_info', { workshopDirectory: WS }),
  get_user_access: await call('get_user_access', { workshopDirectory: WS }),
  get_quiz_instructions: await call('get_quiz_instructions', { workshopDirectory: WS }),
}
if (out.prompts.includes('quiz_me')) {
  const p = await client.getPrompt({ name: 'quiz_me', arguments: { workshopDirectory: WS } }).catch((e) => ({ error: e.message }))
  out.quiz_me = JSON.stringify(p).slice(0, 300)
}
if (out.resourceTemplates[0] || out.resources[0]) {
  const uri = out.resources.find((u) => typeof u === 'string' && u.includes('://'))
  if (uri) out.readResource = { uri, head: JSON.stringify(await client.readResource({ uri }).catch((e) => ({ error: e.message }))).slice(0, 300) }
}
out.stderr = stderr.slice(0, 800)
console.log(JSON.stringify(out, null, 2))
await client.close()
