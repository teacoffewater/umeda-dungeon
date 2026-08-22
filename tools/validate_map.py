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
# --- 実座標 → マップ座標(メートル, metric-v1)。変換は tools/geo.py に一本化 ---
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import ll2m as to_px  # noqa: E402

# 既知の許容(理由付き)
KNOWN_SHOP_OK = {"麺's room 神虎"}   # 第4ビル北縁×バラエティ帯の境界密着(2.4px)
# 店ゾーン→乗ってよい他ゾーン床: バラエティストリート(diamor)は第4ビルB2F(中枢層)を貫通し、店は通り沿いに並ぶ
SHOP_ZONE_PAIR_OK = {('ekimae', 'diamor')}
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
for m in re.finditer(r"\{ floor: '(S1|B[12])', zone: '(\w+)', pts: (\[\[.*?\]\])(?:, holes: \[(.*?)\])?(?:, covers:.*?)? \},", fsrc):
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
        if any((s.get('zone'), h) in SHOP_ZONE_PAIR_OK for h in hits):
            continue  # 実在の貫通通路沿いの店(第4ビルB2F×バラエティストリート等)
        # 生成時のゾーン境界目地(0.15px)に落ちた点は、自ゾーン床までの距離3px以内なら許容
        own = [poly for fl, zone, poly in finals if fl == s['floor'] and zone == s.get('zone')]
        if own and min(poly.distance(p) for poly in own) < 3:
            continue
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
       'herbis': bp(162158152, 162158418), 'kitte': bp(1146510724), 'ema': bp(162158020), 'daimaru': bp(161450829),
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
KNOWN_EXCLAVES = [('S1', '_neutral', 797, 727),      # ヨドバシ⇔ルクア間の高架下連絡路
                  ('B1', 'nishi_umeda', 724, 1183),  # ヒルトンW/E間の四つ橋筋通路(実在)
                  ('S1', 'osaka_sta', 742, 738),     # リンクス/ルクア床に接する駅床片(ゾーン別検査ゆえの見かけ上の孤立)
                  ('B1', 'sonechika', 853, 1389)]    # 北新地駅改札前のスタブ(島内のEV/ESCで深層kitashinchiと接続)

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
for m in re.finditer(r"[SPJ]\('(\w+)',\s*(?:'[^']*',\s*'(?:S1|B[12])',\s*)?(-?[\d.]+),\s*(-?[\d.]+)", msrc):
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
for m in re.finditer(r"\('(?:S1|B[12])', '(\w+)', (\[\[[^\]]*\](?:, \[[^\]]*\])*\])\)", hb):
    _zadd(m.group(1), Polygon(json.loads(m.group(2))).buffer(20))
for m in re.finditer(r"\('(?:S1|B[12])', '(\w+)', (\d+), (\d+), (\d+)\)", gsrc[gsrc.index('DISCS = ['):gsrc.index(']', gsrc.index('DISCS = ['))]):
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

# --- 5. フロア連続性(ユーザールール2026-07-06: 連続していないフロアは原則禁止) ---
# 3層モデル(2026-07-10): 各層とも主成分以外の島は「昇降設備(EV/ESC/階段)ノードを島内に含む」こと。
# 満たさない島は理由と根拠を明記して登録する
ISLAND_REGISTRY = {
    'S1': [
        (545, 991.1, 'JR大阪駅 西側コンコース(西口・桜橋口側)',
         '駅構内の実在部分(浅層)。ルクアビルのマスクで東側コンコースと分割される。'
         'ノード未整備のため昇降設備アイコンなし。うめきた地下口↔西口の通り抜けルートを'
         '実装する際にノード・接続を張る予定(ロードマップ)'),
    ],
    'B1': [],
    'B2': [
        # (x, y, 名称, 理由と根拠)
        (960.8, 1054, '阪神百貨店B2(阪神バル横丁)',
         '公式フロアガイドにB2バル横丁実在。昇降は阪神大阪梅田駅のEV/ESC'
         '(hanshin⇔hanshin_home)経由で接続済みだが、ホーム側B2ノードが島の西縁の外'
         '(駅ホーム上)にあるため島内に設備アイコンが載らない'),
        (451, 1335.8, 'ハービスOSAKA B2',
         '公式フロアガイドに売場あり(実在)。昇降はENT側の館内ESCノードに集約しているため'
         '島内に設備アイコンがないが、館内でENT B2と接続している'),
    ],
}
_verts = []
for m in re.finditer(r"type: '(?:ev|esc|stairs)',\s*a: '(\w+)',\s*b: '(\w+)'", msrc):
    _verts.extend([m.group(1), m.group(2)])
# ノードのフロア(S/P/Jすべて)
_node_floor = {}
for m in re.finditer(r"[SP]\('(\w+)',\s*'[^']*',\s*'(S1|B1|B2)',", msrc):
    _node_floor[m.group(1)] = m.group(2)
for m in re.finditer(r"J\('(\w+)',\s*-?[\d.]+,\s*-?[\d.]+(?:,\s*'(S1|B1|B2)')?\)", msrc):
    _node_floor[m.group(1)] = m.group(2) or 'B1'
_anchors_by_floor = {}
for nid in set(_verts):
    if nid in _nodes and nid in _node_floor:
        _anchors_by_floor.setdefault(_node_floor[nid], []).append(_nodes[nid])
# フロア別に連結成分を計算
for FL in ('S1', 'B1', 'B2'):
    fl_pieces = [(zone, poly) for f, zone, poly in finals if f == FL]
    n = len(fl_pieces)
    parent = list(range(n))
    def _find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for i in range(n):
        for j in range(i + 1, n):
            if fl_pieces[i][1].distance(fl_pieces[j][1]) <= 8:
                parent[_find(i)] = _find(j)
    from collections import defaultdict
    comps = defaultdict(list)
    for i in range(n):
        comps[_find(i)].append(i)
    ordered = sorted(comps.values(), key=lambda c: -sum(fl_pieces[i][1].area for i in c))
    for ci, comp in enumerate(ordered):
        if ci == 0:
            continue  # 主成分
        cu = unary_union([fl_pieces[i][1] for i in comp])
        c = cu.centroid
        anchored = any(cu.buffer(6).contains(Point(px, py)) for px, py in _anchors_by_floor.get(FL, []))
        registered = any(abs(c.x-kx) < 25 and abs(c.y-ky) < 25 for kx, ky, *_ in ISLAND_REGISTRY[FL])
        if not anchored and not registered:
            problems.append(f"[連続性] {FL}の島に昇降設備がなく未登録 {cu.area:.0f}px² @({c.x:.0f},{c.y:.0f})")

if problems:
    print(f'NG: {len(problems)}件')
    for p in problems:
        print(' ', p)
    sys.exit(1)
print('OK: 店舗位置・食い込み・飛地・縄張り・フロア連続性 すべて問題なし(既知の許容・登録済み例外を除く)')
