#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""マップ品質の自動検証スイート。gen_polys.py で再生成したら必ず実行すること。
検査項目:
  1. 店舗位置: 全店が「自分のフロアの床」かつ「自分の施設色の床」に乗っているか
  2. 食い込み: 通路系ゾーンが施設ビルの中に(白リスト外で)入り込んでいないか
  3. 飛地: ゾーンの本体から離れた孤立小片がないか
実行: リポジトリルートで `node tools/dump_nodes.mjs && python3 tools/validate_map.py`
終了コード: 問題(既知の許容を除く)があれば1
"""
import re, json, math, os, sys
from shapely.geometry import Polygon, Point
from shapely.ops import unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAT0 = 34.702
MX = [0.9016776456322585, 0.029513667767732826, 843.3902886095399]
MY = [0.03970669489516974, -1.1219829189908253, 944.3469058365063]
def to_px(lat, lon):
    x = (lon - 135.497) * 111320 * math.cos(math.radians(LAT0))
    y = (lat - LAT0) * 110950
    return (MX[0]*x + MX[1]*y + MX[2], MY[0]*x + MY[1]*y + MY[2])

# 既知の許容(理由付き)
KNOWN_SHOP_OK = {"麺's room 神虎"}   # 第4ビル北縁×バラエティ帯の境界密着(2.4px)
INTRUSION_WHITELIST = {('whity', 'sanban'), ('whity', 'hankyu_dept'), ('diamor', 'ekimae'),
                       ('diamor', 'hanshin_dept'),  # F-40系南北通路(御堂筋沿い・阪神百の壁際)
                       ('hilton', 'herbis'),  # ヒルトンW⇔ハービスENTは直結(壁+3.5px床同士の継ぎ目)
                       ('umechika', 'hankyu_dept'),  # 御堂筋コンコース(阪急百の西壁沿い・実在)
                       ('osaka_sta', 'daimaru'), ('umechika', 'daimaru'),  # 大丸前コンコース(壁沿い・実在)
                       ('nishi_umeda', 'herbis'),  # 四つ橋筋沿い(ハービスENT東壁・実在)
                       ('dotica', 'avanza'), ('sonechika', 'ekimae'),
                       ('sanban', 'links')}  # 最後はOSMビル外形同士の重複(11m四方)由来

# --- 床ポリゴン ---
fsrc = open(os.path.join(ROOT, 'tools', 'floor_polys_generated.js')).read()
finals = []
for m in re.finditer(r"\{ floor: '(B[12])', zone: '(\w+)', pts: (\[\[.*?\]\])(?:, holes: \[(.*?)\])?(?:, covers:.*?)? \},", fsrc):
    holes = [json.loads(h) for h in re.findall(r"\[\[.*?\]\]", m.group(4))] if m.group(4) else []
    finals.append((m.group(1), m.group(2), Polygon(json.loads(m.group(3)), holes)))

problems = []

# --- 1. 店舗位置 ---
d = json.load(open(os.path.join(ROOT, 'tools', 'nodes_dump.json')))
for s in [n for n in d['nodes'] if n['type'] == 'shop']:
    if s['name'] in KNOWN_SHOP_OK:
        continue
    p = Point(s['mx'], s['my'])
    hits = [zone for fl, zone, poly in finals if fl == s['floor'] and poly.contains(p)]
    if s.get('zone') not in hits:
        problems.append(f"[店舗] {s.get('area','manual')} {s['name'][:20]} ({s['mx']:.0f},{s['my']:.0f}) -> {hits[0] if hits else '床なし'}")

# --- 2. 食い込み ---
bld = json.load(open(os.path.join(ROOT, 'tools', 'data', 'osm_buildings.json')))
bgeo = {}; byname = {}
for e in bld['elements']:
    if e['type'] == 'way' and e.get('geometry'):
        bgeo[e['id']] = Polygon([to_px(p['lat'], p['lon']) for p in e['geometry']]).buffer(0)
        byname.setdefault(e.get('tags', {}).get('name', ''), []).append(e['id'])
def bp(*ids): return unary_union([bgeo[i] for i in ids])
FAC = {'sanban': bp(*byname['大阪梅田']), 'links': bp(*byname['ヨドバシ梅田タワー']),
       'grandfront': bp(178942581), 'lucua': bp(162183788), 'hilton': bp(162158150, 162158151),
       'herbis': bp(162158152, 162158418), 'kitte': bp(1146510724), 'daimaru': bp(161450829),
       'hankyu_dept': bp(588689735), 'hanshin_dept': bp(502411898), 'avanza': bp(178958655),
       'ekimae': bp(70561756, 70561758, 135624699, 135624700)}
for fl, zone, poly in finals:
    for fk, fp in FAC.items():
        if zone == fk or (zone, fk) in INTRUSION_WHITELIST:
            continue
        inter = poly.intersection(fp)
        if inter.area > 40:
            c = inter.centroid
            problems.append(f"[食い込み] {fl} {zone} -> {fk} {inter.area:.0f}px² @({c.x:.0f},{c.y:.0f})")

# 実在が確認できている孤立片(正当な飛地)
KNOWN_EXCLAVES = [('B1', '_neutral', 797, 727),      # ヨドバシ⇔ルクア間の高架下連絡路
                  ('B1', 'nishi_umeda', 724, 1183)]  # ヒルトンW/E間の四つ橋筋通路(実在)

# --- 3. 飛地 ---
groups = {}
for fl, zone, poly in finals:
    groups.setdefault((fl, zone), []).append(poly)
for (fl, zone), pieces in groups.items():
    if len(pieces) < 2:
        continue
    for p in pieces:
        dmin = min(p.distance(q) for q in pieces if q is not p)
        if dmin > 15 and p.area < 800:
            c = p.centroid
            if any(fl == kf and zone == kz and abs(c.x-kx) < 15 and abs(c.y-ky) < 15
                   for kf, kz, kx, ky in KNOWN_EXCLAVES):
                continue
            problems.append(f"[飛地] {fl} {zone} {p.area:.0f}px² @({c.x:.0f},{c.y:.0f}) 隔離{dmin:.0f}px")

# --- 4. 縄張り外の塗り(本体と繋がったままゾーン外へ伸びる「舌」を検出) ---
msrc = open(os.path.join(ROOT, 'main.js')).read()
_nodes = {}
for m in re.finditer(r"[SPJ]\('(\w+)',\s*(?:'[^']*',\s*'B[12]',\s*)?(-?[\d.]+),\s*(-?[\d.]+)", msrc):
    _nodes[m.group(1)] = (float(m.group(2)), float(m.group(3)))
_em = re.search(r"const EDGES = \[(.*?)\n\];", msrc, re.S)
from shapely.geometry import LineString
zone_src = {}
def _zadd(zone, geom):
    zone_src[zone] = zone_src[zone].union(geom) if zone in zone_src else geom
for m in re.finditer(r"\['(\w+)',\s*'(\w+)',\s*([\d.]+)(?:,\s*'(\w+)')?\]", _em.group(1)):
    a, b, w, z = m.group(1), m.group(2), float(m.group(3)), m.group(4) or '_neutral'
    if a in _nodes and b in _nodes:
        _zadd(z, LineString([_nodes[a], _nodes[b]]).buffer(w / 2 + 50))
for zname, fp in FAC.items():
    _zadd(zname, fp.buffer(10))
_sta = json.load(open(os.path.join(ROOT, 'tools', 'data', 'osm_osaka_station.json')))['elements'][0]
for mm in _sta['members']:
    if mm.get('role') == 'outer' and len(mm.get('geometry', [])) >= 4:
        _zadd('osaka_sta', Polygon([to_px(p['lat'], p['lon']) for p in mm['geometry']]).buffer(10))
_zadd('osaka_sta', bp(1147394005).buffer(10))  # イノゲート
gsrc = open(os.path.join(ROOT, 'tools', 'gen_polys.py')).read()
hb = gsrc[gsrc.index('HAND_PLATES = ['):gsrc.index('# --- 円形の広場')]
for m in re.finditer(r"\('B[12]', '(\w+)', (\[\[[^\]]*\](?:, \[[^\]]*\])*\])\)", hb):
    _zadd(m.group(1), Polygon(json.loads(m.group(2))).buffer(20))
for m in re.finditer(r"\('B[12]', '(\w+)', (\d+), (\d+), (\d+)\)", gsrc[gsrc.index('DISCS = ['):gsrc.index(']', gsrc.index('DISCS = ['))]):
    _zadd(m.group(1), Point(float(m.group(2)), float(m.group(3))).buffer(float(m.group(4)) + 20))
for fl, zone, poly in finals:
    if zone not in zone_src:
        continue
    resid = poly.difference(zone_src[zone])
    parts = list(resid.geoms) if resid.geom_type == 'MultiPolygon' else ([resid] if not resid.is_empty else [])
    for p in parts:
        if p.area > 150:
            c = p.centroid
            problems.append(f"[縄張り外] {fl} {zone} が発生源から離れて {p.area:.0f}px² @({c.x:.0f},{c.y:.0f})")

if problems:
    print(f'NG: {len(problems)}件')
    for p in problems:
        print(' ', p)
    sys.exit(1)
print('OK: 店舗位置・食い込み・飛地・縄張り すべて問題なし(既知の許容を除く)')
