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
for m in re.finditer(r"S\('(\w+)',\s*'[^']*',\s*'(S1|B1|B2)',\s*(-?[\d.]+),\s*(-?[\d.]+)\)", src):
    nodes[m.group(1)] = (float(m.group(3)), float(m.group(4)), m.group(2))
for m in re.finditer(r"P\('(\w+)',\s*'[^']*',\s*'(S1|B1|B2)',\s*(-?[\d.]+),\s*(-?[\d.]+),\s*'(\w+)'\)", src):
    nodes[m.group(1)] = (float(m.group(3)), float(m.group(4)), m.group(2))
for m in re.finditer(r"J\('(\w+)',\s*(-?[\d.]+),\s*(-?[\d.]+)(?:,\s*'(S1|B1|B2)')?\)", src):
    nodes[m.group(1)] = (float(m.group(2)), float(m.group(3)), m.group(4) or 'B1')
em = re.search(r"const EDGES = \[(.*?)\n\];", src, re.S)
edges = []
for m in re.finditer(r"\['(\w+)',\s*'(\w+)',\s*([\d.]+)(?:,\s*'(\w+)')?\]", em.group(1)):
    a, b, w, zone = m.group(1), m.group(2), float(m.group(3)), m.group(4)
    if a not in nodes or b not in nodes:
        print('!! unknown node', a, b, file=sys.stderr); continue
    # (a, b, 幅, ゾーン, aのフロア, bのフロア)。フロアまたぎエッジ(fa≠fb)は昇降接続なので床帯を作らない
    edges.append((a, b, w, zone or '_neutral', nodes[a][2], nodes[b][2]))

# --- OSM地下通路中心線: 最寄りの自エッジからゾーン/フロアを継承 ---
osm = json.load(open(os.path.join(DATA, 'osm_umeda_underground.json')))
edge_geoms = []
for a, b, w, zone, fl, fb in edges:
    if fl != fb:
        continue  # フロアまたぎはOSM継承の基準にしない
    ax, ay, _ = nodes[a]; bx, by, _ = nodes[b]
    edge_geoms.append((LineString([(ax, ay), (bx, by)]), zone, fl))

NAME_ZONE = {'そねちか': ('sonechika', 'B1'), 'ガーデンアベニュー': ('nishi_umeda', 'B1')}
# 多数決だと誤るway(駅前地下道・曽根崎地下歩道系はうめちか)
SKIP_IDS = {1320007664, 1320007665, 1320007666, 1320007668, 1320007669, 1320007670,
            1316299598, 1316299599, 1316299600}  # 泉の水まわりの微小断片(2〜6px)は飛地しか生まない
ID_ZONE = {747189969: ('sanban', 'S1'), 756534634: ('sanban', 'S1'), 885099466: ('sanban', 'S1'),
           }  # 三番街B1F通路のOSM中心線=浅層
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
    if e['id'] in SKIP_IDS:
        continue
    if e['id'] in ID_ZONE:
        osm_ways.append((ls, *ID_ZONE[e['id']])); continue
    name = t.get('name', '')
    if name in NAME_ZONE:
        osm_ways.append((ls, *NAME_ZONE[name])); continue
    # 25px区間ごとに最寄り自エッジのゾーンへ割り当てる(長いwayはゾーン境界で分割される)
    n_seg = max(2, int(ls.length / 25))
    seg_zone = []
    for i in range(n_seg):
        p = ls.interpolate(ls.length * (i + 0.5) / n_seg)
        best_d, best_z = 1e9, None
        for gl, z, fl in edge_geoms:
            dd = gl.distance(p)
            if dd < best_d:
                best_d, best_z = dd, (z, fl)
        seg_zone.append(best_z if best_d < 35 else None)
    # 連続する同一ゾーン区間をまとめて採用
    i = 0
    while i < n_seg:
        if seg_zone[i] is None:
            i += 1; continue
        j = i
        while j + 1 < n_seg and seg_zone[j + 1] == seg_zone[i]:
            j += 1
        zone, fl = seg_zone[i]
        if zone != 'bldg':
            t0 = ls.length * i / n_seg
            t1 = ls.length * (j + 1) / n_seg
            sub = [ls.interpolate(t0)] + [p for k, p in enumerate(
                (ls.interpolate(ls.length * m2 / n_seg) for m2 in range(i + 1, j + 1)), 1)] + [ls.interpolate(t1)]
            from shapely.geometry import LineString as _LS
            osm_ways.append((_LS([(q.x, q.y) for q in sub]), zone, fl))
        i = j + 1
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

def plate(*ids):
    # 床用: 壁の厚み分(+3.5px)広げて、隣接する通路の塗りと確実に重ねる
    return bpoly(*ids).buffer(3.5, join_style=2)

# 大阪駅(relation 17915329)はouterウェイ2本を結合して外形にする
_sta = json.load(open(os.path.join(DATA, 'osm_osaka_station.json')))['elements'][0]
osaka_sta_poly = unary_union([
    Polygon([to_px(p['lat'], p['lon']) for p in mm['geometry']])
    for mm in _sta['members'] if mm.get('role') == 'outer' and len(mm.get('geometry', [])) >= 4
]).buffer(0).buffer(2, join_style=2).buffer(-2, join_style=2)

# --- 汎用: 通路帯とビル床の関係(確定版) ---
# 原則: 通路系ゾーンの帯はビル壁(+3px)で止める(抽象接続の槍を根絶)。
# 例外(CARVE) = 実在が確認できている「ビル際・ビル貫通の公共帯」だけがビル床を削れる。
def _edge_band(pred, extra=1.5):
    parts = [LineString([(nodes[a][0], nodes[a][1]), (nodes[b][0], nodes[b][1])]).buffer(w / 2, cap_style=3, join_style=2)
             for a, b, w, z, fl, fb in edges if pred(a, b, w, z, fl)]
    return unary_union(parts).buffer(extra, join_style=2) if parts else None

# 三番街ノードへの接続エッジは館内に入るので帯から除外(ビル壁で止める)
_whity_pred = lambda a, b, w, z, fl: z == 'whity' and not (a.startswith('sanban') or b.startswith('sanban'))
f40_pairs = {frozenset(('j_f40', 'j_diamor_e')), frozenset(('j_higashi_n', 'j_f40'))}
_f40_pred = lambda a, b, w, z, fl: frozenset((a, b)) in f40_pairs
f40_band = _edge_band(_f40_pred)              # 御堂筋沿い南北通路(阪神百の壁際・実在)
f40_band_raw = _edge_band(_f40_pred, extra=0)
mido_pairs = {frozenset(('j_shibata', 'j_sun')), frozenset(('j_sun', 'j_mido_n')), frozenset(('j_mido_n', 'j_metro'))}
_mido_pred = lambda a, b, w, z, fl: frozenset((a, b)) in mido_pairs
mido_band = _edge_band(_mido_pred)            # 御堂筋コンコース(阪急百の西壁沿い・実在)
mido_band_raw = _edge_band(_mido_pred, extra=0)
dai_pairs = {frozenset(('jr_osaka', 'daimaru')), frozenset(('daimaru', 'j_c1')),
             frozenset(('daimaru', 'j_metro')), frozenset(('daimaru', 'kitte'))}
_dai_pred = lambda a, b, w, z, fl: frozenset((a, b)) in dai_pairs
dai_band = _edge_band(_dai_pred)              # 大丸前を通る駅コンコース(壁沿い・実在)
dai_band_raw = _edge_band(_dai_pred, extra=0)
yotsu_pairs = {frozenset(('j_nishi_x', 'j_sone_w'))}
_yotsu_pred = lambda a, b, w, z, fl: frozenset((a, b)) in yotsu_pairs
yotsu_band = _edge_band(_yotsu_pred)          # 四つ橋筋沿い(ハービスENT東壁・実在)
yotsu_band_raw = _edge_band(_yotsu_pred, extra=0)
umekita_pairs = {frozenset(('lucua', 'grandfront'))}
umekita_band = _edge_band(lambda a, b, w, z, fl: frozenset((a, b)) in umekita_pairs)  # うめきた地下道
whity_band = _edge_band(_whity_pred)          # マスク穴用(+1.5)
whity_band_raw = _edge_band(_whity_pred, extra=0)  # 床削り用(描画と同寸)
diamor_band = _edge_band(lambda a, b, w, z, fl: z == 'diamor' and not any(
    n.startswith(('ekimae1', 'ekimae2', 'ekimae3')) for n in (a, b)))  # 街路+バラエティ(第4ビル貫通)+北新地通路
dotica_band = _edge_band(lambda a, b, w, z, fl: z == 'dotica')         # C-84のアバンザ接続を含む

FACILITY_BLD = {
    'sanban': bpoly(*byname['大阪梅田']),
    'links': bpoly(*byname['ヨドバシ梅田タワー']),
    'grandfront': bpoly(178942581),
    'lucua': bpoly(162183788),
    'hilton': bpoly(162158150, 162158151),
    'herbis': bpoly(162158152, 162158418),
    'kitte': bpoly(1146510724),
    'ema': bpoly(162158020),
    'daimaru': bpoly(161450829),
    'hankyu_dept': bpoly(588689735),
    'hanshin_dept': bpoly(502411898),
    'avanza': bpoly(178958655),
    'ekimae': bpoly(70561756, 70561758, 135624699, 135624700),
}
# 床を削るのは阪急系×ホワイティのみ(描画と同寸)。駅前ビル×ディアモールは描画順で処理
CARVE = {'sanban': whity_band_raw,
         'hankyu_dept': unary_union([whity_band_raw, mido_band_raw]),
         'hanshin_dept': f40_band_raw,
         'daimaru': dai_band_raw, 'herbis': yotsu_band_raw}
# 通路帯マスクの「穴」(帯がビル内でも生きる場所)は広め(+1.5)で開ける
MASK_HOLES = {'sanban': whity_band,
              'hankyu_dept': unary_union([whity_band, mido_band]),
              'hanshin_dept': f40_band, 'avanza': dotica_band,  # ekimae×diamorの貫通穴は撤去(バラエティSTは第4ビル西縁沿い・貫通しない 2026-07-10)
              'daimaru': dai_band, 'herbis': yotsu_band,
              'lucua': umekita_band, 'grandfront': umekita_band}
_fm_cache = {}
def facility_mask_total():
    if 'm' not in _fm_cache:
        parts = []
        for z, p in FACILITY_BLD.items():
            m = p.buffer(3, join_style=2)
            hb = MASK_HOLES.get(z)
            if hb is not None:
                m = m.difference(hb)
            parts.append(m)
        _fm_cache['m'] = unary_union(parts)
    return _fm_cache['m']

# (floor, zone, polygon)
BUILDING_PLATES = [
    # 大阪駅前ビル1〜4 (地下街扱い: ゾーン色を維持)。三番街と同じくB1F=浅層(S1)/B2F=中枢層(B1)
    ('S1', 'ekimae', plate(70561756)), ('B1', 'ekimae', plate(70561756)),
    ('S1', 'ekimae', plate(70561758)), ('B1', 'ekimae', plate(70561758)),
    ('S1', 'ekimae', plate(135624699)), ('B1', 'ekimae', plate(135624699)),
    ('S1', 'ekimae', plate(135624700)), ('B1', 'ekimae', plate(135624700)),
    # 阪急三番街 = 阪急大阪梅田駅ビル直下。B1F=浅層(S1)、B2F=中枢層(B1)
    # B1Fは北館/南館が間の市道で分断(直結なし・B2F経由)。B2F「川の流れる街」は貫通
    ('S1', 'sanban', plate(*byname['大阪梅田']).difference(
        LineString([(915, 603), (1040, 577)]).buffer(8, cap_style=2))),
    ('B1', 'sanban', plate(*byname['大阪梅田'])),
    # JR大阪駅構内+駅ビル=浅層(三番街・リンクス・ルクアB1Fと同層)
    ('S1', 'osaka_sta', osaka_sta_poly.buffer(3.5, join_style=2)),
    ('S1', 'lucua', plate(162183788)),               # ルクア+ルクア1100(ノースゲート) B1F=浅層
    ('B1', 'lucua', plate(162183788)),  # バルチカ/フードホール B2F=中枢層(壁際店舗の許容+3.5px)
    ('B1', 'daimaru', plate(161450829)), ('B2', 'daimaru', plate(161450829)),   # 大丸梅田店(サウスゲート)
    ('S1', 'osaka_sta', plate(1147394005)),          # イノゲート大阪(駅クラスタ=浅層)
    # ビル館内経由(グレー補足): Googleでは白いが中を歩いて繋がっている
    ('B1', 'hilton', plate(162158150)), ('B2', 'hilton', plate(162158150)),   # ヒルトンW
    ('B1', 'hilton', plate(162158151)), ('B2', 'hilton', plate(162158151)),   # ヒルトンE
    ('B1', 'herbis', plate(162158152)), ('B2', 'herbis', plate(162158152)),   # ハービスENT
    ('B1', 'herbis', plate(162158418)), ('B2', 'herbis', plate(162158418)),   # ハービスOSAKA
    ('B1', 'hankyu_dept', plate(588689735)), ('B2', 'hankyu_dept', plate(588689735)),   # 阪急百貨店
    ('B1', 'hanshin_dept', plate(502411898)), ('B2', 'hanshin_dept', plate(502411898)),   # 阪神百貨店
    ('B1', 'kitte', plate(1146510724)),              # KITTE大阪(JPタワー)
    ('B1', 'ema', plate(162158020)),                 # イーマ(B1がディアモール マーケットST東端と直結)
    ('S1', 'links', plate(*byname['ヨドバシ梅田タワー'])),       # リンクス梅田B1F=浅層
    ('B1', 'links', plate(*byname['ヨドバシ梅田タワー'])),       # リンクス梅田B2F=中枢層(館内EV/ESCのみで接続)
    ('B1', 'avanza', plate(178958655)),              # 堂島アバンザ(ドーチカ直結)
    ('S1', 'grandfront', plate(178942581)),          # グランフロント大阪(南館) B1F=浅層
]

# --- 手トレースの面(広場・モール)。スクショ校正済みマップpx ---
HAND_PLATES = [
    # (floor, zone, [[x,y],...])  ※検証しながら追加・調整する
    # 阪急百貨店前コンコース(公共歩行空間。ホワイティではなく梅田地下道系)
    ('B1', 'umechika', [[906, 702], [1002, 702], [1034, 746], [1034, 792], [954, 800], [906, 788]]),
    # うめきた広場(OSM way 549066320のサンクン広場。駅クラスタ=浅層でセラー・グランフロントと接続)
    ('S1', 'umekita', [[658, 723], [652, 721], [639, 725], [626, 743], [623, 784], [628, 788], [636, 789], [643, 784], [654, 768], [661, 747], [662, 737]]),
    # ディアモール マーケットストリート(阪神ビル外形の凹み部を通る。店3軒が実在)
    ('B1', 'diamor', [[926, 1062], [965, 1062], [965, 1094], [926, 1094]]),
    # 阪神前広場〜うめちか本体(阪急百と阪神百の間、御堂筋直下の面)
    # 百貨店ビル内部はビルマスクが自動で除くため外形は広めに定義
    ('B1', 'umechika', [[840, 920], [1028, 920], [1028, 1010], [850, 1012]]),
]

# --- 円形の広場(円は使用OK) ---
DISCS = [('B1', 'diamor', 863, 1134, 16), ('B1', 'whity', 1249, 953, 15)]

# --- ゾーンごとに結合 ---
groups = {}
def add(floor, zone, geom):
    groups.setdefault((floor, zone), []).append(geom)

for a, b, w, zone, fl, fb in edges:
    if fl != fb:
        continue  # フロアまたぎ(昇降接続)は床帯を作らない=スラブ貫通の元
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
ORDER = ['sanban', 'links', 'grandfront', 'umekita', 'lucua', 'hilton', 'herbis', 'kitte', 'ema', 'daimaru',
         'hankyu_dept', 'hanshin_dept', 'avanza', 'diamor', 'whity', 'umechika', 'osaka_sta',
         'dotica', 'ekimae', 'sonechika', 'nishi_umeda', 'bldg', '_neutral']

BOUNDS = box(20, 380, 1345, 1700)
covers_by_group = {}
for a, b, w, zone, fl, fb in edges:
    covers_by_group.setdefault((fl, zone), []).append((a, b))
    # フロアまたぎエッジは通路箱を絶対に描かない(斜めランプがスラブを貫く)。両フロアのゾーン面に登録して確実に抑止
    if fb != fl:
        covers_by_group.setdefault((fb, zone), []).append((a, b))

out_entries = []
for floor in ('S1', 'B1', 'B2'):
    claimed = None
    for zone in ORDER:
        key = (floor, zone)
        if key not in groups:
            continue
        u = unary_union(groups[key]).buffer(0)
        # クロージング(膨張→収縮)で幅違い合流部の欠けを均す
        u = u.buffer(1.6, join_style=2).buffer(-1.6, join_style=2)
        if zone in FACILITY_BLD:
            if zone != 'ekimae':
                u = u.intersection(FACILITY_BLD[zone].buffer(4, join_style=2))  # 施設色はビルの外に出さない
            cb = CARVE.get(zone)
            if floor == 'B1' and cb is not None:
                u = u.difference(cb)  # 実在確認済みの公共帯だけビル床を削れる
        else:
            u = u.difference(facility_mask_total())  # 通路帯はビル壁(+3px)で止める
        if claimed is not None:
            u = u.difference(claimed.buffer(0.15))
        claimed = unary_union([claimed, u]) if claimed is not None else u
        u = u.intersection(BOUNDS)
        u = u.simplify(1.0, preserve_topology=True).buffer(0)
        polys = list(u.geoms) if u.geom_type == 'MultiPolygon' else [u]
        first = True
        min_area = 250 if zone in FACILITY_BLD else 40
        for p in polys:
            if p.area < min_area:
                continue
            if zone in FACILITY_BLD and p.buffer(-1.6, join_style=2).is_empty:
                continue  # 幅3px級の薄皮(通路沿いの残骸)は捨てる
            if zone not in FACILITY_BLD and p.area < 120:
                others = [q for q in polys if q is not p]
                if not others or min(p.distance(q) for q in others) > 15:
                    continue  # 施設に挟まれて残った微小な切れ端は捨てる
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
