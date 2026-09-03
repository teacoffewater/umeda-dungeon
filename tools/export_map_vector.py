#!/usr/bin/env python3
"""広域地図を手で直すためのベクタ書き出し(SVG と EPS)。

座標は metric-v1 そのまま(1 単位 = 1m、x=東、y=南。SVG は y 下向きなのでそのまま、EPS は y を反転)。
層(SVG は <g id=…>、EPS はコメント):
  floor-<階>-<ゾーン>  床(FLOOR_POLYS)。階 S1=浅層 / B1=中枢層 / B2=深層
  buildings            OSM のビル外形(参考・薄い線)
  guide-corridors      ガイドマップ PDF の通路(参考・点線。tools/data/guide_map.json)
  graph-<階>           歩行グラフ(ノード=丸、エッジ=線、ノードIDのラベル)
  labels               ゾーン名
使い方: python3 tools/export_map_vector.py → docs/export/umeda_map_<日付>.svg / .eps
直した SVG を返してもらったら、<g id="floor-…"> の <polygon points> を読み戻せる(座標は metric のまま)。
"""
import json, os, re, sys, datetime
from html import escape as esc
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
from geo import ll2m  # noqa: E402
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = os.path.join(ROOT, 'docs', 'export'); os.makedirs(OUTDIR, exist_ok=True)
DATE = datetime.date.today().isoformat()
src = open(os.path.join(ROOT, 'main.js')).read()

# ゾーン色
zones = {}
for m in re.finditer(r"^\s*(\w+):\s*\{\s*name:\s*'([^']*)',\s*color:\s*0x([0-9a-fA-F]{6})", src, re.M):
    zones[m.group(1)] = (m.group(2), '#' + m.group(3))
zones.setdefault('_neutral', ('通路', '#8fa3bb'))
# 床
fsrc = open(os.path.join(ROOT, 'tools/floor_polys_generated.js')).read()
floors = []
for m in re.finditer(r"\{ floor: '(S1|B[12])', zone: '(\w+)', pts: (\[\[.*?\]\])(?:, holes: \[(.*?)\])?", fsrc):
    holes = [json.loads(h) for h in re.findall(r"\[\[.*?\]\]", m.group(4))] if m.group(4) else []
    floors.append((m.group(1), m.group(2), json.loads(m.group(3)), holes))
# ノード・エッジ
nodes = {}
for m in re.finditer(r"([SPJ])\('(\w+)',(?:\s*'([^']*)',\s*'(S1|B1|B2)',)?\s*(-?[\d.]+),\s*(-?[\d.]+)(?:,\s*'(\w+)')?", src):
    kind, nid, name, fl, x, y, extra = m.groups()
    if kind == 'J': fl = extra or 'B1'
    nodes[nid] = (float(x), float(y), fl or 'B1', name or '')
em = re.search(r"const EDGES = \[(.*?)\n\];", src, re.S)
edges = [(m.group(1), m.group(2), float(m.group(3)), m.group(4) or '_neutral') for m in re.finditer(r"\['(\w+)',\s*'(\w+)',\s*([\d.]+)(?:,\s*'(\w+)')?\]", em.group(1))]
# ビル外形(OSM)
bld = json.load(open(os.path.join(ROOT, 'tools/data/osm_buildings.json')))
buildings = []
for e in bld['elements']:
    if e['type'] == 'way' and e.get('geometry'):
        buildings.append((e.get('tags', {}).get('name', ''), [ll2m(p['lat'], p['lon']) for p in e['geometry']]))
# ガイドマップの通路(参考)
guide = []
gp = os.path.join(ROOT, 'tools/data/guide_map.json')
if os.path.exists(gp):
    gm = json.load(open(gp))
    for r in gm['corridors'] + gm['whity']:
        guide.append((r['ext'], r.get('holes', [])))

X0, Y0, X1, Y1 = 150, 400, 1450, 1700  # 書き出す範囲(metric)
FL_NAME = {'S1': '浅層', 'B1': '中枢層', 'B2': '深層'}

# ---------------- SVG ----------------
def pts_s(pts): return ' '.join(f'{x:.1f},{y:.1f}' for x, y in pts)
def path_d(ext, holes):
    d = 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in ext) + ' Z'
    for h in holes: d += ' M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in h) + ' Z'
    return d
L = [f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="{X0} {Y0} {X1 - X0} {Y1 - Y0}" width="{(X1 - X0) * 2}" height="{(Y1 - Y0) * 2}">',
     f'<title>梅田ダンジョン 広域地図 {DATE}(座標=metric-v1: 1単位=1m, x=東, y=南)</title>',
     '<rect x="150" y="400" width="1300" height="1300" fill="#f4f4f4"/>']
L.append('<g id="buildings" fill="none" stroke="#9aa" stroke-width="0.5">')
for name, pts in buildings:
    L.append(f'  <polygon points="{pts_s(pts)}"><title>{esc(name)}</title></polygon>')
L.append('</g>')
if guide:
    L.append('<g id="guide-corridors" fill="none" stroke="#c060c0" stroke-width="0.6" stroke-dasharray="3 2">')
    for ext, holes in guide:
        L.append(f'  <path fill-rule="evenodd" d="{path_d(ext, holes)}"/>')
    L.append('</g>')
for fl in ('B2', 'B1', 'S1'):
    L.append(f'<g id="floor-{fl}" data-floor="{FL_NAME[fl]}">')
    for f, zone, pts, holes in floors:
        if f != fl: continue
        name, col = zones.get(zone, (zone, '#888888'))
        L.append(f'  <g id="floor-{fl}-{zone}" data-zone="{esc(name)}"><path fill="{col}" fill-opacity="0.55" stroke="{col}" stroke-width="0.4" fill-rule="evenodd" d="{path_d(pts, holes)}"/></g>')
    L.append('</g>')
for fl in ('B2', 'B1', 'S1'):
    L.append(f'<g id="graph-{fl}" data-floor="{FL_NAME[fl]}">')
    for a, b, w, z in edges:
        if a in nodes and b in nodes and nodes[a][2] == fl and nodes[b][2] == fl:
            L.append(f'  <line x1="{nodes[a][0]}" y1="{nodes[a][1]}" x2="{nodes[b][0]}" y2="{nodes[b][1]}" stroke="#203040" stroke-width="{max(0.8, w / 6):.1f}" stroke-opacity="0.8"><title>{a}-{b} ({z}, 幅{w:g}m)</title></line>')
    for nid, (x, y, f, name) in nodes.items():
        if f != fl: continue
        L.append(f'  <circle cx="{x}" cy="{y}" r="1.6" fill="#203040" data-id="{nid}"><title>{nid} {esc(name)}</title></circle>')
        L.append(f'  <text x="{x + 2}" y="{y - 1.5}" font-size="3.5" fill="#203040">{nid}</text>')
    L.append('</g>')
L.append('<g id="labels" font-size="12" font-weight="bold" fill="#333">')
for zid, (name, col) in zones.items():
    m = re.search(r"^\s*%s:\s*\{[^}]*label:\s*\[(-?[\d.]+),\s*(-?[\d.]+)\]" % zid, src, re.M)
    if m: L.append(f'  <text x="{m.group(1)}" y="{m.group(2)}" fill="{col}">{esc(name)}</text>')
L.append('</g>')
# 凡例
L.append('<g id="legend" font-size="10">')
y = Y0 + 20
for zid, (name, col) in zones.items():
    L.append(f'  <rect x="{X0 + 10}" y="{y}" width="14" height="10" fill="{col}" fill-opacity="0.55" stroke="{col}"/><text x="{X0 + 28}" y="{y + 9}">{esc(name)} ({zid})</text>'); y += 14
L.append(f'  <text x="{X0 + 10}" y="{y + 12}">座標: metric-v1(1単位=1m, x=東, y=南)。点線=地下街ガイドマップPDFの通路(参考)。細線=OSMビル外形。黒=歩行グラフ</text>')
L.append('</g></svg>')
svg_path = os.path.join(OUTDIR, f'umeda_map_{DATE}.svg')
open(svg_path, 'w').write('\n'.join(L)); print('wrote', os.path.relpath(svg_path, ROOT))

# ---------------- EPS ----------------
def hexrgb(c): return tuple(int(c[i:i + 2], 16) / 255 for i in (1, 3, 5))
E = ['%!PS-Adobe-3.0 EPSF-3.0', f'%%BoundingBox: 0 0 {(X1 - X0) * 2} {(Y1 - Y0) * 2}', f'%%Title: 梅田ダンジョン 広域地図 {DATE} (1pt = 0.5m, metric-v1)', '%%EndComments',
     '/m {moveto} def /l {lineto} def /cp {closepath} def /f {fill} def /s {stroke} def /rgb {setrgbcolor} def',
     f'2 2 scale {-X0} {Y1} translate 1 -1 scale']  # metric(y下向き) → EPS(y上向き)
def eps_path(pts):
    return ' '.join(('%.1f %.1f m' if i == 0 else '%.1f %.1f l') % (x, y) for i, (x, y) in enumerate(pts)) + ' cp'
E.append('% ---- buildings (OSM) ----'); E.append('0.6 0.65 0.7 rgb 0.3 setlinewidth')
for name, pts in buildings: E.append(eps_path(pts) + ' s')
if guide:
    E.append('% ---- guide-corridors (PDF, reference) ----'); E.append('0.75 0.35 0.75 rgb 0.4 setlinewidth [2 1.5] 0 setdash')
    for ext, holes in guide:
        E.append(eps_path(ext) + ' s')
        for h in holes: E.append(eps_path(h) + ' s')
    E.append('[] 0 setdash')
for fl in ('B2', 'B1', 'S1'):
    E.append(f'% ---- floor-{fl} ({FL_NAME[fl]}) ----')
    for f, zone, pts, holes in floors:
        if f != fl: continue
        name, col = zones.get(zone, (zone, '#888888')); r, g, b = hexrgb(col)
        E.append(f'% floor-{fl}-{zone} {name}')
        E.append(f'{r:.3f} {g:.3f} {b:.3f} rgb ' + eps_path(pts) + ' ' + ' '.join(eps_path(h) for h in holes) + ' eofill')
for fl in ('B2', 'B1', 'S1'):
    E.append(f'% ---- graph-{fl} ----'); E.append('0.12 0.19 0.25 rgb 0.6 setlinewidth')
    for a, b, w, z in edges:
        if a in nodes and b in nodes and nodes[a][2] == fl and nodes[b][2] == fl:
            E.append(f'% edge {a}-{b} {z} w={w:g}'); E.append(f'{nodes[a][0]} {nodes[a][1]} m {nodes[b][0]} {nodes[b][1]} l s')
    for nid, (x, y, f, name) in nodes.items():
        if f != fl: continue
        E.append(f'% node {nid} {name}'); E.append(f'{x} {y} 1.4 0 360 arc cp f')
E.append('%%EOF')
eps_path_ = os.path.join(OUTDIR, f'umeda_map_{DATE}.eps')
open(eps_path_, 'w').write('\n'.join(E)); print('wrote', os.path.relpath(eps_path_, ROOT))
