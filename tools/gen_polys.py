#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""梅田ダンジョン: 実座標ベースのゾーン別フロアポリゴン生成 v2
入力:
  - main.js の NODES/EDGES (通路グラフ。座標は実座標をアフィン投影したマップpx)
  - tools/data/osm_umeda_underground.json (OSM地下通路の実座標中心線)
  - tools/data/osm_buildings.json (OSMビル外形ポリゴン)
方式:
  - 実座標(lat/lon)→マップpx のアフィン投影 (MX/MY, 2026-07 フィット)
  - ビル館内ゾーン('bldg')を最優先で確保し、公共地下街の色はビルに侵入しない
    (Google屋内マップの赤=公共地下街/駅、白=ビル と同じ見え方)
  - 通路 = 自グラフのエッジ + ゾーン割当したOSM中心線 のバッファ
  - HAND_PLATES = スクショ校正済みの手トレース面(広場・モール)
実行: リポジトリルートで `python3 tools/gen_polys.py` (要 shapely)
出力: tools/floor_polys_generated.js を書き、main.js の FLOOR_POLYS を自動差し替え
"""
import re, json, sys, math, os
from shapely.geometry import LineString, Polygon, Point, box
from shapely.ops import unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIN = os.path.join(ROOT, 'main.js')
DATA = os.path.join(ROOT, 'tools', 'data')
src = open(MAIN).read()

# --- 実座標 → マップpx 投影 ---
LAT0 = 34.702
MX = [0.9016776456322585, 0.029513667767732826, 843.3902886095399]
MY = [0.03970669489516974, -1.1219829189908253, 944.3469058365063]
def to_px(lat, lon):
    x = (lon - 135.497) * 111320 * math.cos(math.radians(LAT0))
    y = (lat - LAT0) * 110950
    return (MX[0]*x + MX[1]*y + MX[2], MY[0]*x + MY[1]*y + MY[2])

# --- NODES / EDGES (main.jsから) ---
nodes = {}
for m in re.finditer(r"S\('(\w+)',\s*'[^']*',\s*'(B1|B2)',\s*(-?[\d.]+),\s*(-?[\d.]+)\)", src):
    nodes[m.group(1)] = (float(m.group(3)), float(m.group(4)), m.group(2))
for m in re.finditer(r"P\('(\w+)',\s*'[^']*',\s*'(B1|B2)',\s*(-?[\d.]+),\s*(-?[\d.]+),\s*'(\w+)'\)", src):
    nodes[m.group(1)] = (float(m.group(3)), float(m.group(4)), m.group(2))
for m in re.finditer(r"J\('(\w+)',\s*(-?[\d.]+),\s*(-?[\d.]+)(?:,\s*'(B1|B2)')?\)", src):
    nodes[m.group(1)] = (float(m.group(2)), float(m.group(3)), m.group(4) or 'B1')
em = re.search(r"const EDGES = \[(.*?)\n\];", src, re.S)
edges = []
for m in re.finditer(r"\['(\w+)',\s*'(\w+)',\s*([\d.]+)(?:,\s*'(\w+)')?\]", em.group(1)):
    a, b, w, zone = m.group(1), m.group(2), float(m.group(3)), m.group(4)
    if a not in nodes or b not in nodes:
        print('!! unknown node', a, b, file=sys.stderr); continue
    edges.append((a, b, w, zone or '_neutral', nodes[a][2]))

# ビル館内ノード同士を結ぶエッジは'bldg'扱い(床は館内グレー)
BLDG_NODES = {'hilton', 'hilton_b2', 'herbis', 'herbis_b2'}
edges = [(a, b, w, ('bldg' if (a in BLDG_NODES and b in BLDG_NODES) else z), fl)
         for a, b, w, z, fl in edges]

# --- OSM地下通路中心線: 最寄りの自エッジからゾーン/フロアを継承 ---
osm = json.load(open(os.path.join(DATA, 'osm_umeda_underground.json')))
edge_geoms = []
for a, b, w, zone, fl in edges:
    ax, ay, _ = nodes[a]; bx, by, _ = nodes[b]
    edge_geoms.append((LineString([(ax, ay), (bx, by)]), zone, fl))

NAME_ZONE = {'そねちか': ('sonechika', 'B1'), 'ガーデンアベニュー': ('nishi_umeda', 'B1')}
# 多数決だと誤るway(駅前地下道・曽根崎地下歩道系はうめちか)
ID_ZONE = {1010195556: ('umechika', 'B1'), 1010195558: ('umechika', 'B1'),
           1316299598: ('umechika', 'B1'), 1316299599: ('umechika', 'B1'),
           1320007668: ('umechika', 'B1'), 1320007669: ('umechika', 'B1'),
           1320007670: ('umechika', 'B1')}
OSM_SKIP_HW = {'steps', 'motorway_link', 'tertiary', 'unclassified', 'service', 'elevator'}
osm_ways = []   # (LineString(px), zone, floor)
for e in osm['elements']:
    if e['type'] != 'way' or not e.get('geometry'):
        continue
    t = e.get('tags', {})
    hw = t.get('highway', '')
    if hw in OSM_SKIP_HW or t.get('location') == 'rooftop':
        continue
    if t.get('tunnel') == 'building_passage':
        continue  # ビル内貫通通路はビル面で表現する
    under = (t.get('layer', '').startswith('-') or t.get('tunnel') == 'yes'
             or t.get('indoor') == 'yes')
    if not under:
        continue
    pts = [to_px(p['lat'], p['lon']) for p in e['geometry']]
    if len(pts) < 2:
        continue
    ls = LineString(pts)
    if e['id'] in ID_ZONE:
        osm_ways.append((ls, *ID_ZONE[e['id']])); continue
    name = t.get('name', '')
    if name in NAME_ZONE:
        osm_ways.append((ls, *NAME_ZONE[name])); continue
    # 線分を等間隔サンプルして最寄り自エッジのゾーンを多数決
    votes = {}
    n_samp = max(3, min(12, int(ls.length / 20)))
    ok = 0
    for i in range(n_samp + 1):
        p = ls.interpolate(ls.length * i / n_samp)
        best_d, best_z = 1e9, None
        for g, z, fl in edge_geoms:
            d = g.distance(p)
            if d < best_d:
                best_d, best_z = d, (z, fl)
        if best_d < 35 and best_z:
            votes[best_z] = votes.get(best_z, 0) + 1
            ok += 1
    if ok < (n_samp + 1) * 0.5:
        continue  # グラフから遠い(範囲外)通路は捨てる
    (zone, fl), _ = max(votes.items(), key=lambda kv: kv[1])
    if zone in ('_neutral', 'bldg'):
        continue
    osm_ways.append((ls, zone, fl))
print(f'OSM ways adopted: {len(osm_ways)}')

# OSM中心線に与えるゾーン既定の帯幅(マップpx)。自エッジは各エッジのwを使う
OSM_W = {'whity': 14, 'umechika': 12, 'diamor': 14, 'ekimae': 9, 'sonechika': 13,
         'dotica': 12, 'nishi_umeda': 13, 'osaka_sta': 13, 'sanban': 12}

# --- ビル外形プレート ---
bld = json.load(open(os.path.join(DATA, 'osm_buildings.json')))
bgeo = {}
byname = {}
for e in bld['elements']:
    if e['type'] == 'way' and e.get('geometry'):
        bgeo[e['id']] = Polygon([to_px(p['lat'], p['lon']) for p in e['geometry']]).buffer(0)
        byname.setdefault(e.get('tags', {}).get('name', ''), []).append(e['id'])

def bpoly(*ids):
    return unary_union([bgeo[i] for i in ids]).buffer(0)

# 大阪駅(relation 17915329)はouterウェイ2本を結合して外形にする
_sta = json.load(open(os.path.join(DATA, 'osm_osaka_station.json')))['elements'][0]
osaka_sta_poly = unary_union([
    Polygon([to_px(p['lat'], p['lon']) for p in mm['geometry']])
    for mm in _sta['members'] if mm.get('role') == 'outer' and len(mm.get('geometry', [])) >= 4
]).buffer(0).buffer(2, join_style=2).buffer(-2, join_style=2)

# (floor, zone, polygon)
BUILDING_PLATES = [
    # 大阪駅前ビル1〜4 (地下街扱い: ゾーン色を維持)
    ('B1', 'ekimae', bpoly(70561756)), ('B2', 'ekimae', bpoly(70561756)),
    ('B1', 'ekimae', bpoly(70561758)), ('B2', 'ekimae', bpoly(70561758)),
    ('B1', 'ekimae', bpoly(135624699)), ('B2', 'ekimae', bpoly(135624699)),
    ('B1', 'ekimae', bpoly(135624700)), ('B2', 'ekimae', bpoly(135624700)),
    # 阪急三番街 = 阪急大阪梅田駅ビル直下 B1/B2
    ('B1', 'sanban', bpoly(*byname['大阪梅田'])),
    ('B2', 'sanban', bpoly(*byname['大阪梅田'])),
    # JR大阪駅構内+駅ビル(Googleでも赤=駅構内扱い)
    ('B1', 'osaka_sta', osaka_sta_poly),
    ('B1', 'osaka_sta', bpoly(162183788)),           # ノースゲート(ルクア)
    ('B2', 'osaka_sta', bpoly(162183788)),           # バルチカ/フードホール
    ('B1', 'osaka_sta', bpoly(161450829)),           # サウスゲート(大丸)
    ('B1', 'osaka_sta', bpoly(1147394005)),          # イノゲート大阪
    # ビル館内経由(グレー補足): Googleでは白いが中を歩いて繋がっている
    ('B1', 'bldg', bpoly(162158150)), ('B2', 'bldg', bpoly(162158150)),   # ヒルトンW
    ('B1', 'bldg', bpoly(162158151)), ('B2', 'bldg', bpoly(162158151)),   # ヒルトンE
    ('B1', 'bldg', bpoly(162158152)), ('B2', 'bldg', bpoly(162158152)),   # ハービスENT
    ('B1', 'bldg', bpoly(162158418)), ('B2', 'bldg', bpoly(162158418)),   # ハービスOSAKA
    ('B1', 'bldg', bpoly(588689735)),                # 阪急百貨店(ツインタワーズN)
    ('B1', 'bldg', bpoly(502411898)),                # 阪神百貨店(ツインタワーズS)
    ('B1', 'bldg', bpoly(1146510724)),               # KITTE大阪(JPタワー)
    ('B1', 'bldg', bpoly(*byname['ヨドバシ梅田タワー'])),  # ヨドバシ/LINKS
    ('B1', 'bldg', bpoly(178958655)),                # 堂島アバンザ
    ('B1', 'bldg', bpoly(178942581)),                # グランフロント南館
]

# --- 手トレースの面(広場・モール)。スクショ校正済みマップpx ---
HAND_PLATES = [
    # (floor, zone, [[x,y],...])  ※検証しながら追加・調整する
    # 阪急前広場〜ホワイティ広場(阪急百貨店北側の面的な広がり)
    ('B1', 'whity', [[906, 706], [1002, 706], [1034, 748], [1034, 792], [954, 800], [906, 788]]),
]

# --- 円形の広場(円は使用OK) ---
DISCS = [('B1', 'diamor', 863, 1134, 16), ('B1', 'whity', 1249, 953, 15)]

# --- ゾーンごとに結合 ---
groups = {}
def add(floor, zone, geom):
    groups.setdefault((floor, zone), []).append(geom)

for a, b, w, zone, fl in edges:
    ax, ay, _ = nodes[a]; bx, by, _ = nodes[b]
    add(fl, zone, LineString([(ax, ay), (bx, by)]).buffer(w / 2, cap_style=3, join_style=2))
for ls, zone, fl in osm_ways:
    add(fl, zone, ls.buffer(OSM_W.get(zone, 10) / 2, cap_style=2, join_style=2))
for fl, zone, poly in BUILDING_PLATES:
    add(fl, zone, poly)
for fl, zone, pts in HAND_PLATES:
    add(fl, zone, Polygon(pts).buffer(0))
for fl, zone, cx, cy, r in DISCS:
    add(fl, zone, Point(cx, cy).buffer(r, quad_segs=24))

# 公共地下街が優先。ただしビル外形を7px縮めたマスクで「深く侵入」だけ防ぐ
# (ビル際の公共通路は投影誤差±10px程度で重なるので、際は地下街色が勝つ)
ORDER = ['sanban', 'whity', 'umechika', 'osaka_sta', 'diamor', 'nishi_umeda',
         'ekimae', 'sonechika', 'dotica', 'bldg', '_neutral']

BOUNDS = box(20, 380, 1345, 1700)
covers_by_group = {}
for a, b, w, zone, fl in edges:
    covers_by_group.setdefault((fl, zone), []).append((a, b))

out_entries = []
for floor in ('B1', 'B2'):
    claimed = None
    bldg_mask = None
    if (floor, 'bldg') in groups:
        bldg_mask = unary_union(groups[(floor, 'bldg')]).buffer(0).buffer(-7, join_style=2)
    for zone in ORDER:
        key = (floor, zone)
        if key not in groups:
            continue
        u = unary_union(groups[key]).buffer(0)
        # クロージング(膨張→収縮)で幅違い合流部の欠けを均す
        u = u.buffer(1.6, join_style=2).buffer(-1.6, join_style=2)
        if zone != 'bldg' and bldg_mask is not None:
            u = u.difference(bldg_mask)
        if claimed is not None:
            u = u.difference(claimed.buffer(0.15))
        claimed = unary_union([claimed, u]) if claimed is not None else u
        u = u.intersection(BOUNDS)
        u = u.simplify(1.0, preserve_topology=True).buffer(0)
        polys = list(u.geoms) if u.geom_type == 'MultiPolygon' else [u]
        first = True
        for p in polys:
            if p.area < 40:
                continue
            ext = [[round(x, 1), round(y, 1)] for x, y in p.exterior.coords[:-1]]
            holes = [[[round(x, 1), round(y, 1)] for x, y in r.coords[:-1]] for r in p.interiors]
            e = {'floor': floor, 'zone': zone, 'pts': ext}
            if holes:
                e['holes'] = holes
            if first:
                e['covers'] = covers_by_group.get(key, [])
                first = False
            out_entries.append(e)

# --- JS出力 & main.jsへの差し替え ---
def js_pts(pts):
    return '[' + ', '.join(f'[{x}, {y}]' for x, y in pts) + ']'
lines = ['// 自動生成: 実座標(OSM/Google校正)ベースのゾーン外周ポリゴン(全頂点明示・重なりなし)',
         '// 生成: tools/gen_polys.py v2。手編集せず再生成すること',
         'const FLOOR_POLYS = [']
for e in out_entries:
    parts = [f"floor: '{e['floor']}'", f"zone: '{e['zone']}'", f"pts: {js_pts(e['pts'])}"]
    if 'holes' in e:
        parts.append('holes: [' + ', '.join(js_pts(h) for h in e['holes']) + ']')
    if e.get('covers'):
        parts.append('covers: [' + ', '.join(f"['{a}', '{b}']" for a, b in e['covers']) + ']')
    lines.append('  { ' + ', '.join(parts) + ' },')
lines.append('];')
outjs = '\n'.join(lines)
open(os.path.join(ROOT, 'tools', 'floor_polys_generated.js'), 'w').write(outjs)

m2 = re.search(r"(?:// 自動生成:[^\n]*\n// 生成:[^\n]*\n)?const FLOOR_POLYS = \[.*?\n\];", src, re.S)
src = src[:m2.start()] + outjs + src[m2.end():]
open(MAIN, 'w').write(src)

n_holes = sum(len(e.get('holes', [])) for e in out_entries)
n_vert = sum(len(e['pts']) for e in out_entries)
print(f'polys={len(out_entries)} holes={n_holes} vertices={n_vert}')
from collections import Counter
c = Counter((e['floor'], e['zone']) for e in out_entries)
for k in sorted(c):
    print(' ', k, c[k])
print('spliced into main.js')
