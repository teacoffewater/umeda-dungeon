#!/usr/bin/env python3
"""OSMの出入口ノード(tools/data/osm_exits.json: entrance / subway_entrance / train_station_entrance)から
番号付きの出入口を exits_data.js に書く。表示範囲内のものだけ。通路からの距離 d(m) も付ける(>40m は未接続候補)。
実行: python3 tools/gen_exits.py
"""
import json, os, re, sys
from shapely.geometry import LineString, Point
from shapely.ops import unary_union
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import ll2m
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
X0, Y0, X1, Y1 = 60, 260, 1520, 1760
els = [e for e in json.load(open(os.path.join(ROOT, 'tools/data/osm_exits.json')))['elements'] if 'lat' in e]
src = open(os.path.join(ROOT, 'main.js')).read(); NUM = r'-?\d+(?:\.\d+)?'
nd = {}
for m in re.finditer(rf"\b(?:S|P)\('(\w+)',\s*'[^']*',\s*'(S1|B1|B2)',\s*({NUM}),\s*({NUM})", src): nd[m.group(1)] = (float(m.group(3)), float(m.group(4)))
for m in re.finditer(rf"\bJ\('(\w+)',\s*({NUM}),\s*({NUM})", src): nd[m.group(1)] = (float(m.group(2)), float(m.group(3)))
em = re.search(r"const EDGES = \[\n(.*?)\n\];", src, re.S)
net = unary_union([LineString([nd[a], nd[b]]) for a, b in re.findall(r"\['(\w+)',\s*'(\w+)'", em.group(1)) if a in nd and b in nd])
OVR = json.load(open(os.path.join(ROOT, 'tools/data/exit_overrides.json'))).get('overrides', {})
out = []
for e in els:
    t = e['tags']
    if not t.get('ref'): continue
    if not (t.get('railway') in ('subway_entrance', 'train_station_entrance') or t.get('entrance')): continue
    x, y = ll2m(e['lat'], e['lon'])
    if t['ref'] in OVR:
        x, y = OVR[t['ref']]['mx'], OVR[t['ref']]['my']  # 現地確認で上書き
    if not (X0 <= x <= X1 and Y0 <= y <= Y1): continue
    d = net.distance(Point(x, y))
    out.append({'id': e['id'], 'ref': t['ref'], 'name': t.get('name', ''), 'mx': round(x, 1), 'my': round(y, 1), 'd': round(d)})
out.sort(key=lambda r: (r['ref']))
with open(os.path.join(ROOT, 'exits_data.js'), 'w') as f:
    f.write('// 自動生成: tools/gen_exits.py(OSMの番号付き出入口。d=既存通路からの距離m、>40は通路未接続)。手編集しない\n')
    f.write('export const OSM_EXITS = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(f'exits: {len(out)}  未接続(>40m): {sum(1 for r in out if r["d"] > 40)}')
for r in sorted(out, key=lambda r: -r['d'])[:15]:
    if r['d'] > 40: print(f"  {r['ref']:8s} {r['name'][:14]:14s} ({r['mx']},{r['my']}) {r['d']}m")
