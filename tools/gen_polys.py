#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""梅田ダンジョン: 通路グラフ+施設床からゾーン別の外周ポリゴンを厳密生成する。
- 各エッジを幅w/2でバッファ(角キャップ=四角、直線のみ)
- ゾーン単位でunion → 先に確定したゾーンをdifference(重なりゼロ保証)
- 出力: FLOOR_POLYS配列(全頂点座標を明示、穴も対応)
"""
import re, json, sys
from shapely.geometry import LineString, Polygon, box, Point
from shapely.ops import unary_union

MAIN = 'main.js'  # リポジトリ直下で実行
src = open(MAIN).read()

# --- NODES ---
nodes = {}
for m in re.finditer(r"S\('(\w+)',\s*'[^']*',\s*'(B1|B2)',\s*([\d.]+),\s*([\d.]+)\)", src):
    nodes[m.group(1)] = (float(m.group(3)), float(m.group(4)), m.group(2))
for m in re.finditer(r"P\('(\w+)',\s*'[^']*',\s*'(B1|B2)',\s*([\d.]+),\s*([\d.]+),\s*'(\w+)'\)", src):
    nodes[m.group(1)] = (float(m.group(3)), float(m.group(4)), m.group(2))
for m in re.finditer(r"J\('(\w+)',\s*([\d.]+),\s*([\d.]+)(?:,\s*'(B1|B2)')?\)", src):
    nodes[m.group(1)] = (float(m.group(2)), float(m.group(3)), m.group(4) or 'B1')

# --- EDGES (const EDGES = [ ... ]; の中だけ) ---
em = re.search(r"const EDGES = \[(.*?)\n\];", src, re.S)
edges = []
for m in re.finditer(r"\['(\w+)',\s*'(\w+)',\s*([\d.]+)(?:,\s*'(\w+)')?\]", em.group(1)):
    a, b, w, zone = m.group(1), m.group(2), float(m.group(3)), m.group(4)
    if a not in nodes or b not in nodes:
        print('!! unknown node', a, b, file=sys.stderr); continue
    floor = nodes[a][2]
    edges.append((a, b, w, zone or '_neutral', floor))

# --- 施設の床(手作業プレート)を結合入力に含める ---
PLATES = [
  ('B1','sanban',[[908,496],[980,487],[989,572],[915,582]]),
  ('B2','sanban',[[908,496],[980,487],[989,572],[915,582]]),
  ('B1','sanban',[[906,622],[984,611],[994,696],[916,708]]),
  ('B2','sanban',[[906,622],[984,611],[994,696],[916,708]]),
  ('B1','whity',[[952,952],[1048,952],[1048,976],[952,976]]),
  ('B1','whity',[[1001,909],[1060,890],[1068,912],[1009,931]]),
  ('B1','diamor',[[842,1090],[868,1090],[866,1142],[921,1074],[939,1090],[874,1153],[991,1139],[1014,1197],[996,1203],[989,1165],[870,1176],[868,1182],[868,1226],[999,1212],[1001,1238],[713,1268],[711,1242],[842,1228],[842,1182],[840,1178],[652,1178],[652,1152],[838,1152],[842,1145]]),
  ('B1','ekimae',[[661,1288],[678,1276],[764,1276],[764,1339],[661,1339]]),
  ('B2','ekimae',[[661,1288],[678,1276],[764,1276],[764,1339],[661,1339]]),
  ('B1','ekimae',[[826,1281],[929,1281],[929,1344],[826,1344]]),
  ('B2','ekimae',[[826,1281],[929,1281],[929,1344],[826,1344]]),
  ('B1','ekimae',[[966,1266],[1069,1266],[1069,1334],[966,1334]]),
  ('B2','ekimae',[[966,1266],[1069,1266],[1069,1334],[966,1334]]),
  ('B1','ekimae',[[956,1166],[1048,1166],[1054,1186],[1054,1229],[956,1229]]),
  ('B2','ekimae',[[956,1166],[1048,1166],[1054,1186],[1054,1229],[956,1229]]),
  ('B2','osaka_sta',[[596,788],[700,788],[700,862],[596,862]]),
  ('B1','osaka_sta',[[722,592],[823,592],[823,692],[722,692]]),
  ('B1','osaka_sta',[[531,976],[612,976],[612,1062],[531,1062]]),
  ('B1','umechika',[[878,998],[928,998],[928,1030],[878,1030]]),
  ('B1','osaka_sta',[[342,762],[420,762],[420,840],[342,840]]),
  ('B1','nishi_umeda',[[598,1102],[684,1102],[684,1178],[598,1178]]),
  ('B2','nishi_umeda',[[598,1102],[684,1102],[684,1178],[598,1178]]),
  ('B1','nishi_umeda',[[388,1202],[524,1202],[524,1332],[430,1332],[388,1290]]),
  ('B2','nishi_umeda',[[388,1202],[524,1202],[524,1332],[430,1332],[388,1290]]),
  ('B1','whity',[[1239,924],[1254,909],[1276,909],[1291,924],[1291,946],[1276,961],[1254,961],[1239,946]]),
  ('B1','umechika',[[868,902],[896,902],[896,976],[868,976]]),
]

# --- ゾーンごとに結合 ---
groups = {}   # (floor, zone) -> [geoms]
for a, b, w, zone, floor in edges:
    ax, ay, _ = nodes[a]; bx, by, _ = nodes[b]
    seg = LineString([(ax, ay), (bx, by)])
    groups.setdefault((floor, zone), []).append(seg.buffer(w / 2, cap_style=3, join_style=2))
for floor, zone, pts in PLATES:
    groups.setdefault((floor, zone), []).append(Polygon(pts).buffer(0))

ORDER = ['sanban', 'whity', 'umechika', 'osaka_sta', 'diamor', 'nishi_umeda',
         'ekimae', 'sonechika', 'dotica', '_neutral']

out_entries = []
covers_by_group = {}
for a, b, w, zone, floor in edges:
    covers_by_group.setdefault((floor, zone), []).append((a, b))

for floor in ('B1', 'B2'):
    claimed = None
    for zone in ORDER:
        key = (floor, zone)
        if key not in groups: continue
        u = unary_union(groups[key]).buffer(0)
        if claimed is not None:
            u = u.difference(claimed.buffer(0.15))  # 先行ゾーン優先で重なり除去
        claimed = unary_union([claimed, u]) if claimed is not None else u
        u = u.simplify(0.6, preserve_topology=True).buffer(0)
        polys = list(u.geoms) if u.geom_type == 'MultiPolygon' else [u]
        first = True
        for p in polys:
            if p.area < 40: continue  # 微小な切れ端は捨てる
            ext = [[round(x, 1), round(y, 1)] for x, y in p.exterior.coords[:-1]]
            holes = [[[round(x, 1), round(y, 1)] for x, y in r.coords[:-1]] for r in p.interiors]
            e = {'floor': floor, 'zone': zone, 'pts': ext}
            if holes: e['holes'] = holes
            if first:
                e['covers'] = covers_by_group.get(key, [])
                first = False
            out_entries.append(e)

# --- JS出力 ---
def js_pts(pts): return '[' + ', '.join(f'[{x}, {y}]' for x, y in pts) + ']'
lines = ['// 自動生成: 通路グラフ+施設床から計算したゾーン外周ポリゴン(全角座標を明示・重なりなし)',
         '// 生成: scratchpad/gen_polys.py (shapely union)。手編集せず再生成すること',
         'const FLOOR_POLYS = [']
for e in out_entries:
    zq = f"'{e['zone']}'" if e['zone'] != '_neutral' else "'_neutral'"
    parts = [f"floor: '{e['floor']}'", f"zone: {zq}", f"pts: {js_pts(e['pts'])}"]
    if 'holes' in e:
        parts.append('holes: [' + ', '.join(js_pts(h) for h in e['holes']) + ']')
    if 'covers' in e and e['covers']:
        parts.append('covers: [' + ', '.join(f"['{a}', '{b}']" for a, b in e['covers']) + ']')
    lines.append('  { ' + ', '.join(parts) + ' },')
lines.append('];')
open('tools/floor_polys_generated.js', 'w').write('\n'.join(lines))

n_poly = len(out_entries)
n_holes = sum(len(e.get('holes', [])) for e in out_entries)
n_vert = sum(len(e['pts']) for e in out_entries)
print(f'nodes={len(nodes)} edges={len(edges)} polys={n_poly} holes={n_holes} vertices={n_vert}')
for e in out_entries:
    print(' ', e['floor'], e['zone'], 'v=', len(e['pts']), 'holes=', len(e.get('holes', [])))
