#!/usr/bin/env python3
"""区域ごとにOSMの地下通路で main.js の歩行グラフを置き換える。

使い方: python3 tools/import_region.py <zone> [--dry]
  設定: tools/data/regions.json(区域ポリゴン・フロア・幅)
  入力: tools/data/osm_underground_2026-08.json(Overpass)、tools/data/osm_regions.json(区域ポリゴン形状)
  出力: main.js の NODES/EDGES 内 `// @region <zone> begin/end` ブロックを生成物で置換、
        shops.js の該当ゾーンの edges チェーンを新グラフ上の最短経路に引き直す

方針:
  - 区域ポリゴン(+buffer)内の OSM footway/corridor(level=-1 or tunnel=yes)を交点で分割し、
    Douglas-Peucker(1.5m)で間引いた頂点をノード、区間をエッジにする
  - 区域内の旧ノード: 8m以内に新ノードがあれば新ノードを旧IDに改名(参照を壊さない)。
    無ければ旧ノードを残し、最寄りの新ノードへ接続エッジを足す
  - 旧エッジ: 両端が区域内ならOSMに置き換わるので削除。片端だけなら残す(IDが保たれるので自動接続)
  - 店舗エリア(shops.js)の edges チェーンは、旧チェーン両端の最寄り新ノード間の最短経路に置換
"""
import heapq
import json
import math
import os
import re
import sys

from shapely.geometry import LineString, Point, Polygon, MultiLineString
from shapely.ops import unary_union, linemerge

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import ll2m  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'tools', 'data')
MAIN = os.path.join(ROOT, 'main.js')
SHOPS = os.path.join(ROOT, 'shops.js')
NUM = r'-?\d+(?:\.\d+)?'
SNAP_RENAME = 8.0      # 旧ノードをこの距離以内の新ノードに改名
SIMPLIFY = 1.5         # 頂点間引き(m)
MERGE_NODE = 2.5       # 近接ノード結合(m)
CONNECT_MAX = 60.0     # 残した旧ノード→新グラフ接続の上限(m)

zone = sys.argv[1]
DRY = '--dry' in sys.argv
REG = json.load(open(os.path.join(DATA, 'regions.json')))[zone]
FLOOR = REG['floor']
WIDTH = REG['width']


def log(*a):
    print(*a)


# ---------------------------------------------------------------- 区域ポリゴン
def region_polygon():
    els = {e['id']: e for e in json.load(open(os.path.join(DATA, 'osm_regions.json')))['elements']}
    parts = []
    for pid in REG.get('polygon', []):
        e = els[pid]
        if e['type'] == 'way':
            parts.append(Polygon([ll2m(p['lat'], p['lon']) for p in e['geometry']]))
        else:
            for mm in e.get('members', []):
                if mm.get('role') == 'outer' and 'geometry' in mm:
                    parts.append(Polygon([ll2m(p['lat'], p['lon']) for p in mm['geometry']]))
    for wid in REG.get('ways', []):
        e = els.get(wid) or next((x for x in osm_all if x['id'] == wid), None)
        assert e, f'way {wid} が見つからない'
        parts.append(LineString([ll2m(p['lat'], p['lon']) for p in e['geometry']]).buffer(0.1))
    assert parts, '区域の形が定義されていない'
    return unary_union(parts).buffer(REG.get('buffer', 3), join_style=2)


osm_all = [e for e in json.load(open(os.path.join(DATA, 'osm_underground_2026-08.json')))['elements']]
POLY = region_polygon()
log(f'[{zone}] 区域ポリゴン 面積 {POLY.area:.0f} m², bounds {[round(v) for v in POLY.bounds]}')

# ---------------------------------------------------------------- OSM通路の切り出し
WALK = {'footway', 'corridor', 'pedestrian', 'path'}
lines = []
for e in osm_all:
    if e['type'] != 'way' or 'geometry' not in e:
        continue
    t = e.get('tags', {})
    if t.get('highway') not in WALK:
        continue
    lv = t.get('level', '')
    under = lv.startswith('-') or t.get('tunnel') == 'yes' or t.get('indoor') == 'yes'
    if not under:
        continue
    if lv and lv.split(';')[0] not in ('-1',) and not (lv == '' and t.get('tunnel') == 'yes'):
        if not lv.startswith('-1'):
            continue  # B2等は対象外(OSMにほぼ無い)
    ls = LineString([ll2m(p['lat'], p['lon']) for p in e['geometry']])
    clipped = ls.intersection(POLY)
    if clipped.is_empty:
        continue
    geoms = [clipped] if clipped.geom_type == 'LineString' else [g for g in getattr(clipped, 'geoms', []) if g.geom_type == 'LineString']
    w = None
    try:
        w = float(t.get('width')) if t.get('width') else None
    except ValueError:
        w = None
    for g in geoms:
        if g.length >= 1.0:
            lines.append((g, e['id'], w))
log(f'[{zone}] OSM通路 {len(lines)} 本(切り出し後)')
assert lines, 'OSM通路が無い'

# 交点で分割(noding) → 線分列に
noded = unary_union([g for g, _, _ in lines])
segs = list(noded.geoms) if noded.geom_type == 'MultiLineString' else [noded]
# 各線分にOSM way id と幅を引き継ぐ(最寄りの元線)
src_index = [(g, wid, w) for g, wid, w in lines]


def src_of(seg):
    mid = seg.interpolate(0.5, normalized=True)
    best = min(src_index, key=lambda s: s[0].distance(mid))
    return best[1], best[2]


# ---------------------------------------------------------------- ノード・エッジ化
nodes_xy = []          # [x, y]
node_index = {}        # (rx, ry) -> idx


def node_at(x, y):
    for (nx, ny), i in node_index.items():
        if math.hypot(nx - x, ny - y) <= MERGE_NODE:
            return i
    i = len(nodes_xy)
    nodes_xy.append([x, y])
    node_index[(x, y)] = i
    return i


new_edges = []          # (i, j, width, way_id)
for seg in segs:
    s = seg.simplify(SIMPLIFY, preserve_topology=False)
    wid, w = src_of(seg)
    coords = list(s.coords)
    for a, b in zip(coords, coords[1:]):
        i, j = node_at(*a), node_at(*b)
        if i == j:
            continue
        new_edges.append((i, j, w or WIDTH, wid))
# 重複エッジ除去
seen = set()
dedup = []
for i, j, w, wid in new_edges:
    k = frozenset((i, j))
    if k in seen:
        continue
    seen.add(k)
    dedup.append((i, j, w, wid))
new_edges = dedup
log(f'[{zone}] 新ノード {len(nodes_xy)}、新エッジ {len(new_edges)}')

# ---------------------------------------------------------------- main.js の旧グラフ
src = open(MAIN).read()
nm = re.search(r"const NODES = \[\n(.*?)\n\];", src, re.S)
em = re.search(r"const EDGES = \[\n(.*?)\n\];", src, re.S)
node_lines = nm.group(1).split('\n')
edge_lines = em.group(1).split('\n')
old_nodes = {}  # id -> dict(kind, x, y, floor, line_idx)
for li, ln in enumerate(node_lines):
    m = re.search(rf"\b(S|P)\('(\w+)',\s*'([^']*)',\s*'(S1|B1|B2)',\s*({NUM}),\s*({NUM})", ln)
    if m:
        old_nodes[m.group(2)] = dict(kind=m.group(1), x=float(m.group(5)), y=float(m.group(6)), floor=m.group(4), li=li)
        continue
    m = re.search(rf"\bJ\('(\w+)',\s*({NUM}),\s*({NUM})(?:,\s*'(S1|B1|B2)')?", ln)
    if m:
        old_nodes[m.group(1)] = dict(kind='J', x=float(m.group(2)), y=float(m.group(3)), floor=m.group(4) or 'B1', li=li)
old_edges = []  # (a, b, w, zone, line_idx)
for li, ln in enumerate(edge_lines):
    m = re.search(rf"\['(\w+)',\s*'(\w+)',\s*({NUM})(?:,\s*'(\w+)')?\]", ln)
    if m and not ln.lstrip().startswith('//'):
        old_edges.append((m.group(1), m.group(2), float(m.group(3)), m.group(4) or '', li))

# 前回の取り込みで生成したノード(<zone>_NN)は対象外(ブロックごと作り直す)。旧IDを継承したノードは再び改名対象になる
GEN = re.compile(rf'^{zone}_\d+$')
inside = {nid: n for nid, n in old_nodes.items()
          if n['floor'] == FLOOR and POLY.contains(Point(n['x'], n['y'])) and not GEN.match(nid)}
log(f'[{zone}] 区域内の旧ノード {len(inside)}: ' + ', '.join(f"{k}({v['kind']})" for k, v in inside.items()))

# 旧ノード → 新ノード改名 / 残す
renamed = {}      # new idx -> old id
keep_old = {}     # old id -> nearest new idx(接続用)
for oid, n in inside.items():
    d, i = min((math.hypot(nodes_xy[i][0] - n['x'], nodes_xy[i][1] - n['y']), i) for i in range(len(nodes_xy)))
    # 交点(J)は位置に意味が無い(手置きの近似)のでOSMの最寄り交点に改名して位置を明け渡す。
    # スポット・駅(S/P)は残して最寄りの新ノードへ接続する
    if n['kind'] == 'J' and i not in renamed:
        renamed[i] = oid
        if d > SNAP_RENAME:
            log(f'[{zone}] {oid}: 最寄り新ノードまで {d:.1f} m(改名して移動)')
    else:
        keep_old[oid] = (i, d)
# 刈り込み: 8m未満の行き止まり枝(店先・階段口のスタブ)を落とす。旧ID継承ノードと区域境界の端点は守る
STUB = 8.0
boundary = POLY.exterior
protected = set(renamed) | {i for i, (x, y) in enumerate(nodes_xy) if boundary.distance(Point(x, y)) < 2.0}
while True:
    deg = {}
    for i, j, w, wid in new_edges:
        deg[i] = deg.get(i, 0) + 1; deg[j] = deg.get(j, 0) + 1
    pruned = []
    for i, j, w, wid in new_edges:
        L = math.dist(nodes_xy[i], nodes_xy[j])
        if L < STUB and ((deg.get(i) == 1 and i not in protected) or (deg.get(j) == 1 and j not in protected)):
            continue
        pruned.append((i, j, w, wid))
    if len(pruned) == len(new_edges):
        break
    new_edges = pruned
used = {i for e in new_edges for i in e[:2]}
log(f'[{zone}] 刈り込み後: ノード {len(used)}、エッジ {len(new_edges)}')
# 新ノードID(使われているノードだけ)
ids = {}
seq = 1
for i in sorted(used, key=lambda k: (round(nodes_xy[k][0]), round(nodes_xy[k][1]))):
    if i in renamed:
        ids[i] = renamed[i]
    else:
        ids[i] = f'{zone}_{seq:02d}'
        seq += 1
for i, oid in list(renamed.items()):
    if i not in used:
        raise SystemExit(f'!! 改名先ノード {oid} が刈り込みで消えた')
log(f'[{zone}] 改名(旧IDを維持) {len(renamed)}: ' + ', '.join(f"{v}" for v in renamed.values()))
for oid, (i, d) in keep_old.items():
    log(f"[{zone}] 残す {oid}({inside[oid]['kind']}) → 最寄り新ノード {ids[i]} {d:.1f} m" + ('  !! 遠い' if d > CONNECT_MAX else ''))

# ---------------------------------------------------------------- 出力ブロック
removed_J = {oid for oid in inside if oid not in keep_old}
node_out = [f'  // @region {zone} begin  (tools/import_region.py が生成。OSM通路の交点・屈曲点)']
for i in sorted(ids, key=lambda k: ids[k]):
    x, y = nodes_xy[i]
    tag = "'" + FLOOR + "'" if FLOOR != 'B1' else ''
    node_out.append(f"  J('{ids[i]}', {x:.1f}, {y:.1f}{', ' + tag if tag else ''}),")
node_out.append(f'  // @region {zone} end')
edge_out = [f'  // @region {zone} begin  (OSM way id をコメントに保持)']
for i, j, w, wid in sorted(new_edges, key=lambda e: (ids[e[0]], ids[e[1]])):
    edge_out.append(f"  ['{ids[i]}', '{ids[j]}', {w:g}, '{zone}'], // osm {wid}")
# 残した旧ノードの接続
adj_new = {}
for i, j, w, wid in new_edges:
    adj_new.setdefault(i, set()).add(j); adj_new.setdefault(j, set()).add(i)
for oid, (i, d) in keep_old.items():
    if d <= CONNECT_MAX:
        edge_out.append(f"  ['{oid}', '{ids[i]}', {min(WIDTH, 10):g}, '{zone}'], // 旧ノード接続 {d:.0f}m")
edge_out.append(f'  // @region {zone} end')

# 旧エッジの整理: 両端が区域内(削除J or 残した旧ノード) → 削除。既存の @region ブロックも除去
drop_edge_li = set()
for a, b, w, z, li in old_edges:
    if a in inside and b in inside:
        drop_edge_li.add(li)
log(f'[{zone}] 旧エッジ削除 {len(drop_edge_li)} 本(両端が区域内)')


def strip_region_block(lines_):
    out, skip = [], False
    for ln in lines_:
        if f'// @region {zone} begin' in ln:
            skip = True
        if not skip:
            out.append(ln)
        if f'// @region {zone} end' in ln:
            skip = False
    return out


new_node_lines = [ln for li, ln in enumerate(node_lines) if not (li in {inside[o]['li'] for o in removed_J})]
new_node_lines = strip_region_block(new_node_lines) + node_out
new_edge_lines = [ln for li, ln in enumerate(edge_lines) if li not in drop_edge_li]
new_edge_lines = strip_region_block(new_edge_lines) + edge_out
src2 = src[:nm.start(1)] + '\n'.join(new_node_lines) + src[nm.end(1):]
em2 = re.search(r"const EDGES = \[\n(.*?)\n\];", src2, re.S)
src2 = src2[:em2.start(1)] + '\n'.join(new_edge_lines) + src2[em2.end(1):]

# ---------------------------------------------------------------- 店舗エリアのチェーン引き直し
# 新グラフ(全エッジ)で最短経路
all_nodes = {}
for ln in new_node_lines:
    m = re.search(rf"\b(?:S|P)\('(\w+)',\s*'[^']*',\s*'(?:S1|B1|B2)',\s*({NUM}),\s*({NUM})", ln) or \
        re.search(rf"\bJ\('(\w+)',\s*({NUM}),\s*({NUM})", ln)
    if m:
        all_nodes[m.group(1)] = (float(m.group(2)), float(m.group(3)))
graph = {}
for ln in new_edge_lines:
    m = re.search(rf"\['(\w+)',\s*'(\w+)',\s*({NUM})", ln)
    if m and not ln.lstrip().startswith('//'):
        a, b = m.group(1), m.group(2)
        if a in all_nodes and b in all_nodes:
            d = math.dist(all_nodes[a], all_nodes[b])
            graph.setdefault(a, []).append((b, d)); graph.setdefault(b, []).append((a, d))


def shortest(a, b):
    dist = {a: 0}; prev = {}; pq = [(0, a)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == b:
            break
        if d > dist.get(u, 1e18):
            continue
        for v, w in graph.get(u, []):
            nd = d + w
            if nd < dist.get(v, 1e18):
                dist[v] = nd; prev[v] = u; heapq.heappush(pq, (nd, v))
    if b not in dist:
        return None, None
    path = [b]
    while path[-1] != a:
        path.append(prev[path[-1]])
    return path[::-1], dist[b]


def nearest_node(x, y):
    return min(all_nodes, key=lambda k: math.dist(all_nodes[k], (x, y)))


shops_src = open(SHOPS).read()
am = re.search(r"export const SHOP_AREAS = \{\n(.*?)\n\};", shops_src, re.S)
area_lines = am.group(1).split('\n')
changed = 0
for li, ln in enumerate(area_lines):
    m = re.search(rf"^(\s*(\w+):\s*\{{.*?zone: '{zone}'.*?edges: )(\[\[.*?\]\])(.*)$", ln)
    if not m:
        continue
    chain = json.loads(m.group(3).replace("'", '"'))
    first, last = chain[0][0], chain[-1][1]
    # 旧チェーンの両端(旧座標)→新グラフの最寄りノード
    fx, fy = old_nodes[first]['x'], old_nodes[first]['y']
    lx, ly = old_nodes[last]['x'], old_nodes[last]['y']
    a = first if first in all_nodes else nearest_node(fx, fy)
    b = last if last in all_nodes else nearest_node(lx, ly)
    path, L = shortest(a, b)
    old_len = sum(math.dist((old_nodes[p]['x'], old_nodes[p]['y']), (old_nodes[q]['x'], old_nodes[q]['y'])) for p, q in chain)
    if not path or len(path) < 2:
        log(f'  !! {m.group(2)}: {a}→{b} の経路なし/長さゼロ(手で直す)')
        continue
    ratio = L / old_len if old_len else 1
    flag = '' if 0.7 <= ratio <= 1.5 else '  !! 長さ比が想定外(要確認)'
    pairs = ', '.join(f"['{p}', '{q}']" for p, q in zip(path, path[1:]))
    area_lines[li] = f"{m.group(1)}[{pairs}]{m.group(4)}"
    changed += 1
    log(f'  店舗チェーン {m.group(2)}: {first}→{last} ⇒ {a}→{b} {len(path) - 1}区間 {L:.0f}m (旧{old_len:.0f}m, 比{ratio:.2f}){flag}')
# path 型(手置きの線)は最寄りの新エッジ上に投影する(通路から外れた店を床に戻す)
edge_geoms_new = [LineString([nodes_xy[i], nodes_xy[j]]) for i, j, w, wid in new_edges]
for li, ln in enumerate(area_lines):
    m = re.search(rf"^(\s*(\w+):\s*\{{.*?zone: '{zone}'.*?path: )(\[\[.*?\]\])(.*)$", ln)
    if not m:
        continue
    pts = json.loads(m.group(3))
    out_pts, moved = [], []
    for x, y in pts:
        pt = Point(x, y)
        g = min(edge_geoms_new, key=lambda e: e.distance(pt))
        d = g.distance(pt)
        if d > 40:
            log(f'  !! {m.group(2)}: path点 ({x},{y}) が新通路から {d:.0f} m 離れている(手で直す)')
            out_pts.append([x, y]); continue
        q = g.interpolate(g.project(pt))
        out_pts.append([round(q.x, 1), round(q.y, 1)]); moved.append(round(d, 1))
    # 30m超の店舗列は新グラフのチェーン(edges)に変換して通路の折れに追従させる。短い列は投影のまま
    plen = sum(math.dist(a_, b_) for a_, b_ in zip(out_pts, out_pts[1:]))
    na, nb = nearest_node(*out_pts[0]), nearest_node(*out_pts[-1])
    if plen > 30 and na != nb:
        path, L = shortest(na, nb)
        if path and len(path) >= 2:
            pairs = ', '.join(f"['{p_}', '{q_}']" for p_, q_ in zip(path, path[1:]))
            ln2 = re.sub(r"offset:\s*[\d.]+,\s*", '', ln)
            ln2 = re.sub(r"path:\s*\[\[.*?\]\]", f"edges: [{pairs}]", ln2)
            area_lines[li] = ln2
            log(f'  店舗path {m.group(2)}: {plen:.0f}m の列を edges チェーンに変換 {na}→{nb} {len(path) - 1}区間 {L:.0f}m')
            continue
    area_lines[li] = f"{m.group(1)}{json.dumps(out_pts)}{m.group(4)}"
    log(f'  店舗path {m.group(2)}: {len(pts)}点を新通路へ投影(移動 {moved} m)')
shops_src2 = shops_src[:am.start(1)] + '\n'.join(area_lines) + shops_src[am.end(1):]
# near: の参照が消えたノードを指していたら最寄りへ
for oid in removed_J:
    if f"'{oid}'" in shops_src2 and oid not in all_nodes:
        log(f'  !! shops.js に消えたノード {oid} への参照あり')

# ---------------------------------------------------------------- 検証・書き出し
for a, b, w, z, li in old_edges:
    if li in drop_edge_li:
        continue
    for nid in (a, b):
        if nid not in all_nodes:
            log(f'  !! 旧エッジ {a}-{b} が存在しないノード {nid} を参照')
vm = re.search(r"const VERTICALS = \[\n(.*?)\n\];", src2, re.S)
for m in re.finditer(r"a: '(\w+)',\s*b: '(\w+)'", vm.group(1)):
    for nid in m.groups():
        if nid not in all_nodes:
            log(f'  !! VERTICALS が存在しないノード {nid} を参照')

if '--png' in sys.argv:
    from PIL import Image, ImageDraw
    S = 3
    x0, y0, x1, y1 = [v + d for v, d in zip(POLY.bounds, (-40, -40, 40, 40))]
    im = Image.new('RGB', (int((x1 - x0) * S), int((y1 - y0) * S)), (18, 22, 30)); dr = ImageDraw.Draw(im)
    T = lambda p: ((p[0] - x0) * S, (p[1] - y0) * S)
    dr.polygon([T(c) for c in POLY.exterior.coords], outline=(90, 110, 150))
    for a, b, w, z, li in old_edges:
        if a in old_nodes and b in old_nodes:
            dr.line([T((old_nodes[a]['x'], old_nodes[a]['y'])), T((old_nodes[b]['x'], old_nodes[b]['y']))], fill=(200, 70, 70), width=2)
    for oid, n in old_nodes.items():
        if POLY.buffer(40).contains(Point(n['x'], n['y'])):
            dr.ellipse([T((n['x'] - 2, n['y'] - 2)), T((n['x'] + 2, n['y'] + 2))], fill=(255, 120, 120)); dr.text(T((n['x'] + 3, n['y'] - 10)), oid, fill=(255, 160, 160))
    for i, j, w, wid in new_edges:
        dr.line([T(nodes_xy[i]), T(nodes_xy[j])], fill=(80, 220, 140), width=2)
    for i in ids:
        x, y = nodes_xy[i]
        dr.ellipse([T((x - 1.5, y - 1.5)), T((x + 1.5, y + 1.5))], fill=(120, 255, 180)); dr.text(T((x + 2, y + 2)), ids[i], fill=(150, 230, 190))
    for oid, (i, d) in keep_old.items():
        dr.line([T((old_nodes[oid]['x'], old_nodes[oid]['y'])), T(nodes_xy[i])], fill=(255, 220, 0), width=1)
    out = os.path.join(ROOT, 'tools', '_debug', f'region_{zone}.png'); os.makedirs(os.path.dirname(out), exist_ok=True); im.save(out); log('png:', out)

if DRY:
    log('(dry) 書き込みなし')
else:
    open(MAIN, 'w').write(src2)
    open(SHOPS, 'w').write(shops_src2)
    log(f'書き込み: main.js(ノード {len(ids)} / エッジ {len(edge_out) - 2}), shops.js(チェーン {changed})')
