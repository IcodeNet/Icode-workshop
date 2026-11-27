import json, os, re, sys, collections, pathlib
ROOT = pathlib.Path(sys.argv[1])
BUILTINS = set("assert async_hooks buffer child_process cluster console constants crypto dgram diagnostics_channel dns domain events fs http http2 https inspector module net os path perf_hooks process punycode querystring readline repl stream string_decoder sys timers tls trace_events tty url util v8 vm wasi worker_threads zlib test sqlite".split())
pkgs = {}
for p in sorted(ROOT.rglob('package.json')):
    if 'node_modules' in p.parts: continue
    d = json.loads(p.read_text())
    rel = str(p.parent.relative_to(ROOT)) or '.'
    pkgs[rel] = d
decl = collections.defaultdict(list)
for rel, d in pkgs.items():
    for kind in ['dependencies','devDependencies','peerDependencies','optionalDependencies']:
        for name, ver in (d.get(kind) or {}).items():
            decl[name].append({'package': rel, 'name': d.get('name'), 'kind': kind, 'version': ver})
SRC = re.compile(r'\.(m?[jt]sx?|cjs)$')
imp_re = re.compile(r'''(?:import\s+(?:type\s+)?([\w*\s{},$]+?)\s+from\s+|import\s+|export\s+(?:type\s+)?[\w*\s{},$]+?\s+from\s+|import\(\s*|require\(\s*|vi\.mock\(\s*)['"]([^'"\n]+)['"]''')
def pkgname(spec):
    if spec.startswith(('.', '/', '#', '~')) or spec.startswith('node:'): return None
    parts = spec.split('/')
    return '/'.join(parts[:2]) if spec.startswith('@') else parts[0]
uses = collections.defaultdict(lambda: {'files': set(), 'symbols': collections.Counter(), 'subpaths': collections.Counter()})
builtin_uses = collections.Counter()
for f in ROOT.rglob('*'):
    if not f.is_file() or 'node_modules' in f.parts or '.git' in f.parts or not SRC.search(f.name): continue
    text = f.read_text(errors='ignore'); rel = str(f.relative_to(ROOT))
    for m in imp_re.finditer(text):
        spec = m.group(2)
        if spec.startswith('node:') or spec.split('/')[0] in BUILTINS:
            builtin_uses[spec.replace('node:','').split('/')[0]] += 1; continue
        name = pkgname(spec)
        if not name: continue
        u = uses[name]; u['files'].add(rel)
        if spec != name: u['subpaths'][spec] += 1
        if m.group(1):
            for s in re.split(r'[,{}\s]+', m.group(1)):
                s = s.strip()
                if s and s not in ('type','as'): u['symbols'][s] += 1
out = {}
for name in sorted(set(decl) | set(uses)):
    u = uses.get(name)
    out[name] = {
        'declared': decl.get(name, []),
        'importingFiles': sorted(u['files']) if u else [],
        'symbols': dict(u['symbols'].most_common(15)) if u else {},
        'subpaths': dict(u['subpaths'].most_common(8)) if u else {},
    }
json.dump({'commit': '12089440399689c914f3e0f69b3ec52c07b9a3a8', 'packages': {k: {'name': v.get('name'), 'scripts': v.get('scripts', {}), 'bin': v.get('bin'), 'exports': list((v.get('exports') or {}).keys()) if isinstance(v.get('exports'), dict) else v.get('exports')} for k, v in pkgs.items()}, 'dependencies': out, 'nodeBuiltins': dict(builtin_uses.most_common())}, open(str(pathlib.Path(sys.argv[2]) / 'dependencies.json'),'w'), indent=1)
core = {k: v for k, v in out.items() if any(not d['package'].startswith('example') for d in v['declared']) or any(not f.startswith('example') for f in v['importingFiles'])}
unused = [k for k, v in core.items() if v['declared'] and not v['importingFiles']]
undeclared = [k for k, v in core.items() if not v['declared']]
print('packages:', len(pkgs), '| distinct deps:', len(out), '| non-example deps:', len(core))
print('declared but never imported (often CLIs/config/types):', len(unused))
print('imported but undeclared:', undeclared[:30])
print('builtins:', dict(builtin_uses.most_common(12)))
