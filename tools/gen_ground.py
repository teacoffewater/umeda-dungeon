#!/usr/bin/env python3
"""地上のビル全棟と道路網を OSM(tools/data/osm_ground.json)から生成して ground_data.js に書く。

- ビル: 面積100m²以上を対象。高さは height / building:levels×3.2 / 既定12m を×0.75(既存表示と同じ縮率)。
  main.js の GROUND_BUILDINGS(名前付きランドマーク)と重なるものは除外(二重描画防止)
- 道路: クラス別の幅でバッファし、クラスごとに結合したポリゴンにする
実行: python3 tools/gen_ground.py  →  ground_data.js を書き出す(esbuildで同梱される)
"""
import json
import os
import re
import sys

from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import ll2m  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = json.load(open(os.path.join(ROOT, 'tools', 'data', 'osm_ground.json')))
OUT = os.path.join(ROOT, 'ground_data.js')

# 表示範囲(メートル座標)。シーンのグリッドより少し広め
X0, Y0, X1, Y1 = 60, 260, 1520, 1760
BOUNDS = Polygon([(X0, Y0), (X1, Y0), (X1, Y1), (X0, Y1)])

# 既存の名前付きランドマーク(main.js)の外形。重なるOSMビルは除外
main_src = open(os.path.join(ROOT, 'main.js')).read()
gb = re.search(r'const GROUND_BUILDINGS = \[(.*?)\n  \];', main_src, re.S)
named = []
for m in re.finditer(r'poly: (\[\[.*?\]\])', gb.group(1).replace('\n', ' ')):
    try:
        named.append(Polygon(json.loads(m.group(1))))
    except Exception:
        pass
named_union = unary_union(named).buffer(1)
print(f'named landmarks: {len(named)}')


def height_of(t):
    h = None
    for key in ('height', 'building:height'):
        v = t.get(key, '').replace('m', '').strip()
        if v:
            try:
                h = float(v); break
            except ValueError:
                pass
    if h is None and t.get('building:levels'):
        try:
            h = float(t['building:levels']) * 3.2
        except ValueError:
            pass
    return (h or 12.0) * 0.75  # 既存ランドマークと同じ縮率


buildings = []
skipped_overlap = 0
for e in SRC['elements']:
    t = e.get('tags', {})
    if 'building' not in t or e['type'] != 'way' or 'geometry' not in e:
        continue
    try:
        p = Polygon([ll2m(q['lat'], q['lon']) for q in e['geometry']]).buffer(0)
    except Exception:
        continue
    if p.is_empty or p.area < 100 or not p.intersects(BOUNDS):
        continue
    if p.intersection(named_union).area > 0.3 * p.area:
        skipped_overlap += 1
        continue
    p = p.intersection(BOUNDS).simplify(1.0, preserve_topology=True)
    polys = [p] if p.geom_type == 'Polygon' else list(getattr(p, 'geoms', []))
    for q in polys:
        if q.geom_type != 'Polygon' or q.area < 100:
            continue
        pts = [[round(x), round(y)] for x, y in q.exterior.coords[:-1]]
        if len(pts) >= 3:
            buildings.append({'p': pts, 'h': round(height_of(t), 1)})
print(f'buildings: {len(buildings)} (skipped overlap {skipped_overlap})')

ROAD_W = {'motorway': 20, 'trunk': 22, 'primary': 18, 'secondary': 14,
          'tertiary': 10, 'residential': 7, 'unclassified': 7,
          'pedestrian': 5, 'living_street': 5}
by_cls = {}
for e in SRC['elements']:
    t = e.get('tags', {})
    hw = t.get('highway')
    if not hw or e['type'] != 'way' or 'geometry' not in e:
        continue
    if t.get('tunnel') in ('yes', 'building_passage') or t.get('layer', '').startswith('-'):
        continue  # 地下・トンネルは描かない
    if t.get('area') == 'yes':
        continue
    ls = LineString([ll2m(q['lat'], q['lon']) for q in e['geometry']])
    if not ls.intersects(BOUNDS):
        continue
    w = ROAD_W.get(hw, 7)
    if t.get('bridge') == 'yes' and hw == 'motorway':
        w = 20  # 高速の高架はそのまま(高さは付けない)
    by_cls.setdefault('major' if hw in ('motorway', 'trunk', 'primary', 'secondary') else 'minor', []).append(ls.buffer(w / 2, cap_style=2))
roads = []
for cls, parts in by_cls.items():
    u = unary_union(parts).intersection(BOUNDS).simplify(1.0, preserve_topology=True)
    polys = [u] if u.geom_type == 'Polygon' else list(getattr(u, 'geoms', []))
    for q in polys:
        if q.geom_type != 'Polygon' or q.area < 50:
            continue
        roads.append({
            'cls': cls,
            'p': [[round(x), round(y)] for x, y in q.exterior.coords[:-1]],
            'holes': [[[round(x), round(y)] for x, y in r.coords[:-1]] for r in q.interiors if Polygon(r).area > 30],
        })
print(f'road polygons: {len(roads)}')

with open(OUT, 'w') as f:
    f.write('// 自動生成: tools/gen_ground.py(OSMの全ビル外形+道路網、メートル座標)。手編集しない\n')
    f.write('export const OSM_BUILDINGS = ' + json.dumps(buildings, separators=(',', ':')) + ';\n')
    f.write('export const OSM_ROADS = ' + json.dumps(roads, separators=(',', ':')) + ';\n')
print('wrote', OUT, f'{os.path.getsize(OUT) / 1e6:.2f} MB')
