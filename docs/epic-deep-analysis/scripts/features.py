import sys
import json, re, pathlib, collections
ROOT = pathlib.Path(sys.argv[1]); P = ROOT/'packages'
def rel(f): return str(f.relative_to(ROOT))
routes = []
for f in sorted((P/'workshop-app/app/routes').rglob('*')):
    if not f.is_file() or not re.search(r'\.(tsx?|jsx?)$', f.name): continue
    t = f.read_text(errors='ignore')
    intents = sorted(set(re.findall(r"""intent\s*===?\s*['"]([\w-]+)['"]""", t) + re.findall(r"""case\s+['"]([\w-]+)['"]\s*:""", t) + re.findall(r"""name=["']intent["']\s+value=["']([\w-]+)["']""", t)))
    utils = sorted(set(re.findall(r"import\s*\{([^}]*)\}\s*from\s*'@epic-web/workshop-utils/([\w./-]+)'", t) and [m[1] for m in re.findall(r"import\s*\{([^}]*)\}\s*from\s*'@epic-web/workshop-utils/([\w./-]+)'", t)]))
    routes.append({'file': rel(f).replace('packages/workshop-app/app/routes/',''), 'loader': bool(re.search(r'export (async )?function loader|export const loader', t)), 'action': bool(re.search(r'export (async )?function action|export const action', t)), 'component': bool(re.search(r'export default', t)), 'intents': intents, 'utils': utils, 'lines': t.count('\n')})
utils = {}
for f in sorted((P/'workshop-utils/src').rglob('*.ts')):
    t = f.read_text(errors='ignore')
    ex = re.findall(r'export (?:async )?(?:function|const|class|let) (\w+)', t)
    utils[rel(f).replace('packages/workshop-utils/src/','')] = {'exports': ex, 'lines': t.count('\n')}
spawns = []
for f in ROOT.rglob('*'):
    if not f.is_file() or 'node_modules' in f.parts or '.git' in f.parts or 'example' in f.parts or not re.search(r'\.(m?[jt]sx?)$', f.name): continue
    for i, line in enumerate(f.read_text(errors='ignore').splitlines(), 1):
        if re.search(r'\b(execa|execaCommand|spawn|spawnSync|exec|execSync|execFile|crossSpawn|fkill)\s*\(', line) and 'test' not in f.name:
            spawns.append(f"{rel(f)}:{i}: {line.strip()[:150]}")
envs = collections.Counter()
for f in P.rglob('*'):
    if f.is_file() and 'node_modules' not in f.parts and re.search(r'\.(m?[jt]sx?)$', f.name):
        for m in re.findall(r'process\.env\.(\w+)|ENV\.(\w+)', f.read_text(errors='ignore')): envs[m[0] or m[1]] += 1
cli = sorted(rel(f) for f in (P/'workshop-cli/src/commands').glob('*.ts'))
mcp = {}
for name in ['tools','resources','prompts']:
    t = (P/f'workshop-mcp/src/{name}.ts').read_text()
    mcp[name] = sorted(set(re.findall(r"""register(?:Tool|Prompt)\(\s*(?:\w+,\s*)?['"]([\w-]+)['"]""", t) + re.findall(r"""registerResource\(\s*(\w+Resource)\.name""", t)))
json.dump({'routes': routes, 'utils': utils, 'spawns': spawns, 'env': dict(envs), 'cliCommands': cli, 'mcp': mcp}, open(str(pathlib.Path(sys.argv[2]) / 'features.json'),'w'), indent=1)
print('routes', len(routes), 'utils modules', len(utils), 'spawn sites', len(spawns), 'env vars', len(envs), 'cli', len(cli), 'mcp', {k: len(v) for k, v in mcp.items()})
