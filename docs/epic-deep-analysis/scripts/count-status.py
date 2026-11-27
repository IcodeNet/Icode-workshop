"""Count feature statuses in README.md. Usage: python3 count-status.py <README.md>"""
import re, sys, collections
rows = [l for l in open(sys.argv[1]) if re.match(r'\| [A-J]\d+ \|', l)]
c = collections.Counter()
for l in rows:
    s = l.rstrip().rstrip('|').split('|')[-1].strip()
    c['Icode-only' if s.startswith('Icode-only') else 'Covered' if s.startswith('Covered') else 'Partial' if s.startswith('Partial') else 'Gap'] += 1
print(len(rows), dict(c))
