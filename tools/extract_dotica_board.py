#!/usr/bin/env python3
"""ドーチカ南端の「地下近辺案内」板(現地撮影)から、広域地図(metric-v1)のドーチカの形を起こす。

入力: tools/data/floorguides/dotica_vicinity_board_2026-09-03.jpg
出力: tools/data/dotica_board.json
        floor:   ドーチカの床(桃=区画+白=通路)の外形 [[mx,my],...]
        branches: 各接続通路の中心線(板px→metric)
        exits:   出口番号の位置(内部保持・参照用)
        H:       板px(表示幅1400)→metric のホモグラフィ
      tools/_debug/dotica_board_fit.png (OSM外形を板に投影した確認画像)

位置合わせ: 板の建物(青=地下接続ビル、灰=堂島グランドビル、水色=ホテル・プラザ)の外形を
  OSM のビル外形に ICP(点→辺の距離)で当てる。出口番号(OSM の出入口ノード)は初期値にだけ使う
  (地上の出入口の位置なので 5〜10m ずれる)。
"""
import json, os, sys, re
import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import box, Polygon, MultiPolygon, Point, LineString
from shapely.ops import unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from geo import ll2m  # noqa: E402
SRC = os.path.join(ROOT, 'tools/data/floorguides/dotica_vicinity_board_2026-09-03.jpg')
OUT = os.path.join(ROOT, 'tools/_debug/'); os.makedirs(OUT, exist_ok=True)
DW = 1400  # 座標を読んだ表示幅(px)。約 0.27 m/px

im = Image.open(SRC).convert('RGB'); W0, H0 = im.size
sm = im.resize((DW, int(H0 * DW / W0)), Image.BILINEAR)
a = np.asarray(sm).astype(float); R, G, B = a[..., 0], a[..., 1], a[..., 2]
mx, mn = a.max(-1), a.min(-1); v = mx; s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
d = np.maximum(mx - mn, 1e-6)
h = np.where(mx == R, ((G - B) / d) % 6, np.where(mx == G, (B - R) / d + 2, (R - G) / d + 4)) * 60
ys, xs = np.mgrid[0:a.shape[0], 0:a.shape[1]]
roi = (xs > 470) & (xs < 1250) & (ys > 0) & (ys < 960)  # 板の中(枠・映り込みを除く)
pink = (h > 5) & (h < 24) & (s > 0.26) & (s < 0.48) & (v > 165) & roi     # ドーチカ区画
white = (s < 0.2) & (v > 205) & roi                                         # 通路
blue = (h > 200) & (h < 232) & (s > 0.16) & (s < 0.4) & (v > 110) & (v < 205) & roi   # 地下接続ビル(濃い青。映り込みで暗い所も拾う)
lblue = (h > 200) & (h < 232) & (s > 0.08) & (s <= 0.2) & (v > 175) & (v < 215) & roi  # 水色(ホテル・プラザ)
gray = (h > 5) & (h < 36) & (s > 0.03) & (s < 0.13) & (v > 115) & (v < 158) & roi & (xs > 760) & (ys > 780)  # 堂島グランドビル(背景は h≈44 v≈166)
teal = (h > 160) & (h < 200) & (s > 0.3) & (v < 130) & roi                  # 出口の階段記号


def erode(m, r):
    o = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            o &= np.roll(np.roll(m, dy, 0), dx, 1)
    return o


def dilate(m, r):
    o = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            o |= np.roll(np.roll(m, dy, 0), dx, 1)
    return o


def comps(mask, min_area, er=1):
    m = erode(mask, er) if er else mask
    yy, xx = np.nonzero(m)
    if len(xx) == 0:
        return []
    u = unary_union([box(x, y, x + 1, y + 1) for x, y in zip(xx, yy)])
    gs = list(u.geoms) if isinstance(u, MultiPolygon) else [u]
    return [Polygon(g.exterior).buffer(er, join_style=2) if er else Polygon(g.exterior) for g in gs if g.area >= min_area]


def nearest(polys, x, y):
    return min(polys, key=lambda g: g.distance(Point(x, y)))


BL = comps(blue, 2000, 3); LB = comps(lblue, 2000, 3); GR = comps(gray, 3000, 3); T = comps(teal, 25, 1)
# 板の建物 ↔ OSM(ビル外形)。板の重心(表示px、目視)で成分を選ぶ
bld = json.load(open(os.path.join(ROOT, 'tools/data/osm_buildings.json')))
osm = {e['id']: Polygon([ll2m(p['lat'], p['lon']) for p in e['geometry']]).buffer(0)
       for e in bld['elements'] if e['type'] == 'way' and e.get('geometry')}
MATCH = [  # (名前, 板の成分(mask, 重心px), OSM way id)
    ('近鉄堂島ビル', nearest(BL, 564, 518), 162185349),
    ('堂島アバンザ', nearest(BL, 969, 525), 178958655),
    ('紀陽ビル', nearest(BL, 632, 870), 221966330),
    ('西梅田MID(関電不動産西梅田)', nearest(BL, 602, 133), 162380618),
    ('堂島グランドビル', nearest(GR, 880, 860) if GR else None, 162381435),
    ('堂島プラザビル', nearest(LB, 980, 740) if LB else None, 178996327),
    ('ホテルエルセラーン', nearest(LB, 800, 720) if LB else None, 178996353),
]
MATCH = [m for m in MATCH if m[1] is not None]
for n, g, oid in MATCH:
    print('板', n, '面積px', round(g.area), '重心', round(g.centroid.x), round(g.centroid.y), '/ OSM 面積m2', round(osm[oid].area))

# --- ホモグラフィ H(板px→metric) を ICP で当てる ---
def apply_H(H, pts):
    p = np.c_[pts, np.ones(len(pts))] @ H.T
    return p[:, :2] / p[:, 2:3]


def boundary_samples(g, step=4.0):
    ring = LineString(g.exterior.coords)
    n = max(8, int(ring.length / step))
    return np.array([ring.interpolate(ring.length * i / n).coords[0] for i in range(n)])


samples = [(boundary_samples(g), osm[oid].exterior) for _, g, oid in MATCH]


def residuals(H):
    r = []
    for pts, ring in samples:
        q = apply_H(H, pts)
        r.extend(min(ring.distance(Point(x, y)), 15.0) for x, y in q)  # 15m で頭打ち(板の簡略化に引きずられない)
    return np.array(r)


# 初期値: 縮尺は板のスケールバー(150m ≈ 450px @1400幅 → 0.333 m/px、縦横同じ)、平行移動は出口(階段記号 teal の重心 ↔ OSM 出入口)の平均。
# 出口だけでアフィンを解くと OSM の出入口(地上の位置)のずれで横の縮尺が 0.26 に化け、ICP がそこから抜けない
EXITS = {'C61': ((655, 167), (693.6, 1388.6)), 'C69': ((668, 327), (692.8, 1431.6)), 'C72': ((771, 395), (723.7, 1462.2)),
         'C80': ((752, 571), (719.1, 1514.7)), 'C92': ((771, 820), (729.9, 1615.9))}
S0 = 0.333
tx = np.mean([px - S0 * x for (x, y), (px, py) in EXITS.values()]); ty = np.mean([py - S0 * y for (x, y), (px, py) in EXITS.values()])
params = np.array([S0, 0.0, tx, 0.0, S0, ty, 0.0, 0.0])


def H_of(q):
    return np.array([[q[0], q[1], q[2]], [q[3], q[4], q[5]], [q[6], q[7], 1.0]])


steps = np.array([1e-4, 1e-4, 0.1, 1e-4, 1e-4, 0.1, 1e-7, 1e-7])
for it in range(60):  # ガウス・ニュートン(数値ヤコビアン)
    r0 = residuals(H_of(params))
    J = np.zeros((len(r0), 8))
    for k in range(8):
        q = params.copy(); q[k] += steps[k]
        J[:, k] = (residuals(H_of(q)) - r0) / steps[k]
    lam = 1e-3 * np.trace(J.T @ J) / 8
    dq = np.linalg.solve(J.T @ J + lam * np.eye(8), -J.T @ r0)
    params = params + dq
    r1 = residuals(H_of(params))
    if it % 10 == 0 or it == 59:
        print('iter', it, 'rms %.2f m' % np.sqrt((r1 ** 2).mean()))
    if abs(np.sqrt((r0 ** 2).mean()) - np.sqrt((r1 ** 2).mean())) < 1e-4:
        break
H = H_of(params)
print('H =', H.tolist())
for (n, g, oid), (pts, ring) in zip(MATCH, samples):
    q = apply_H(H, pts); rr = [ring.distance(Point(x, y)) for x, y in q]
    print('  %s: 平均 %.1f m / 最大 %.1f m' % (n, np.mean(rr), np.max(rr)))
for k, ((x, y), (px, py)) in EXITS.items():
    q = apply_H(H, np.array([[x, y]], float))[0]
    print('  出口 %s: 板→ (%.1f, %.1f)  OSM (%.1f, %.1f)  差 %.1f m' % (k, q[0], q[1], px, py, np.hypot(q[0] - px, q[1] - py)))

# --- 確認画像: OSM 外形を板に逆投影 ---
Hi = np.linalg.inv(H)
def m2px(pts):
    return [tuple(q) for q in apply_H(Hi, np.array(pts, float))]
dbg = sm.copy(); dr = ImageDraw.Draw(dbg)
for oid, g in osm.items():
    pts = m2px(list(g.exterior.coords))
    if all(-50 < x < DW + 50 and -50 < y < 1100 for x, y in pts):
        dr.line(pts, fill=(255, 255, 0), width=2)
for n, g, oid in MATCH:
    dr.polygon([tuple(c) for c in g.simplify(1).exterior.coords], outline=(0, 0, 255), width=2)
dbg.crop((450, 0, 1150, 950)).save(OUT + 'dotica_board_fit.png')
json.dump({'H': H.tolist(), 'DW': DW}, open(OUT + 'dotica_board_H.json', 'w'))
print('wrote dotica_board_fit.png')

# ===================== 床(桃+白)と通路の軸 =====================
def m_of(pts):
    return apply_H(H, np.array(pts, float))
floor_mask = (pink | white) & (xs > 540) & (ys > 76)  # y<76 は北新地駅(JR東西線)の面と出口11-5の通路=ドーチカではない(そねちか側の帯でつなぐ)
floor_mask &= ~((xs < 702) & (ys < 115))    # C57 への通路(MIDビル北側。地上出口専用なので入れない)
floor_mask &= ~((xs > 760) & (ys < 90))     # 出口 11-5 への通路(北新地駅側)
floor_mask &= ~((xs > 703) & (xs < 756) & (ys > 662) & (ys < 800) & (s < 0.3))  # 通路の東に接する薄い桃(ホテルエルセラーンの地階?)は床にしない
floor_mask = erode(dilate(floor_mask, 4), 4)  # 通路上の文字・記号(現在地・トイレ)で割れた床をつなぐ
FL = sorted(comps(floor_mask, 300, 2), key=lambda g: -g.area)
print('床の成分', [(round(g.centroid.x), round(g.centroid.y), round(g.area)) for g in FL[:8]])
floor_px = Polygon(FL[0].exterior).simplify(1.2)
floor_m = Polygon(m_of(list(floor_px.exterior.coords)))
print('床 面積 %.0f m2, 頂点 %d' % (floor_m.area, len(floor_px.exterior.coords)))

# 本線の軸: 白(通路)を上から追跡(前の行の x ±22px の中の白の中央値。文字で切れた行は飛ばす)
axis = []; cur = 725.0
for y in range(78, 900, 3):
    row = white[y] & (np.abs(xs[y] - cur) < 22)
    xx = np.nonzero(row)[0]
    if len(xx) < 5:
        continue
    cur = 0.5 * cur + 0.5 * float(np.median(xx))
    axis.append((cur, float(y)))
print('軸サンプル', len(axis))
for x, y in axis[::10]:
    print('   y=%d x=%.0f  → metric (%.1f, %.1f)' % (y, x, *m_of([(x, y)])[0]))

# 通路の東(C72の通路〜C84の通路の間): 板の桃色は「歩けない面」(アバンザ B1F の高さのデッキ・サンクンガーデンの縁)、
# 白が通路。ドーチカ⇔アバンザの接続はこの白い3本(C72 の通路 / C80 の広場=南サンクンガーデン(7段下がった所)と
# その東縁の曲線階段(17段) / C84 の通路)。桃色部分は床にせず、白い部分だけを床に残す(桃色は建物外形にも入れない)
EAST = box(751, 418, 905, 640)
pink_east = unary_union([g for g in comps(pink & (xs > 751) & (ys > 418) & (ys < 640), 200, 2)])
white_east = unary_union([g for g in comps(erode(dilate(white & (xs > 745) & (ys > 500) & (ys < 700), 4), 4), 300, 2)])
dot_px = Polygon(floor_px.exterior).difference(pink_east.buffer(1.5, join_style=2)).union(white_east)
dot_px = dot_px.buffer(2, join_style=2).buffer(-2, join_style=2)
if isinstance(dot_px, MultiPolygon):
    dot_px = max(dot_px.geoms, key=lambda g: g.area)
dot_px = Polygon(dot_px.exterior).simplify(1.0)
dot_m = Polygon(m_of(list(dot_px.exterior.coords)))
ext_m = Polygon()  # 以前の「アバンザ地下広場」は廃止(桃色=歩けない面)
plaza_px = max(white_east.geoms, key=lambda g: g.area) if isinstance(white_east, MultiPolygon) else white_east
plaza_m = Polygon(m_of(list(plaza_px.exterior.coords)))
print('ドーチカ床 %.0f m2 / C80 の広場(南サンクンガーデン) %.0f m2 bounds %s' % (dot_m.area, plaza_m.area, [round(v, 1) for v in plaza_m.bounds]))

# 歩行グラフのノード(板px→metric)。本線は白い通路の軸(axis)上、枝は板の通路の位置
def axis_at(py):
    xs_ = [x for x, y in axis if abs(y - py) <= 6]
    return (float(np.mean(xs_)), float(py))
NODE_PX = {
    'dotica_02': axis_at(82),     # 北端(北新地駅・曽根崎地下歩道との境)
    'dotica_c61': axis_at(170),   # C61 の通路(西→関電不動産西梅田ビル B2F)の分岐
    'kanden_b2': (625, 170),      # 関電不動産西梅田ビル B2F(通路を入った所)
    'dojima': axis_at(340),       # ドーチカ中央(館ノード)
    'dotica_avz_n': axis_at(400), # C72 の通路(東→アバンザ北)の分岐
    'avz_n_s': (838, 400),        # 北: 階段の下(C72 の通路の東端手前)
    'j_avz_n': (878, 412),        # 北: 階段の上(アバンザ北サンクンガーデン通路。地下広場の北端)
    'dotica_avz_c': axis_at(550), # C80 の通路(東→アバンザ中)の分岐
    'avz_c_s': (722, 550),        # 中: 7段の階段(区画帯を抜ける直線階段)の下
    'avz_c_mid': (790, 560),      # 中: 広場(南サンクンガーデン。7段の上〜曲線階段の下)
    'j_avz_c': (836, 565),        # 中: 広場の東縁の曲線階段(17段)の上
    'avz_c_in': (858, 565),       # 中: アバンザの西壁(館内案内板の中の階段 M の位置)
    'dotica_c83': axis_at(612),   # C83 の通路(西→堂島ふらっと)の分岐
    'dotica_df_s0': (582, 612),   # 階段(23段)の下
    'dotica_df_s1': (560, 612),   # 階段の上
    'dojima_flat': (540, 612),    # 堂島ふらっと(近鉄堂島ビルB1F)
    'dotica_01': axis_at(646),    # C84 の通路(東→アバンザ南)の分岐
    'avz_s0': (722, 645),         # 南: 10段の階段(区画帯を抜ける)の下
    'avz_s1': (745, 645),         # 南: 10段の上
    'avz_s_mid': (830, 640),      # 南: C84 の通路の折れ(車椅子EVの東)
    'j_avz_s': (860, 605),        # 南: アバンザ館内の南側通路の入口(ビルの南西角)
    'avanza': axis_at(672),       # 堂島アバンザ前(館ノード)
    'dotica_c92': axis_at(815),   # C92 の所の折れ
    'dotica_03': axis_at(858),    # 南端(現在地の所。C93 の手前)
}
NODE_M = {k: [round(float(c), 1) for c in m_of([v])[0]] for k, v in NODE_PX.items()}
# 板のアバンザ西壁は OSM 外形より約10m東にずれている(板の残差)。館内へ入る点は広域のビル外形(OSM)の壁に合わせる
NODE_M['j_avz_c'] = [744, 1519]   # 中: 曲線階段の上(広場の東縁)
NODE_M['avz_c_in'] = [749, 1519]  # 中: アバンザ西壁(OSM 外形)
for k, v in NODE_M.items():
    print('  %-14s %s' % (k, v))

# 出口(teal)の重心→metric(参照用)
exits_m = {}
for k, ((x, y), _) in EXITS.items():
    exits_m[k] = [round(float(c), 1) for c in m_of([(x, y)])[0]]
def ring(g):
    return [[round(float(x), 1), round(float(y), 1)] for x, y in g.exterior.coords[:-1]]
json.dump({'source': 'ドーチカ南端(C93・紀陽ビル前)の地下近辺案内板 2026-09-03 現地撮影。板の建物外形を OSM に ICP で当てたホモグラフィで metric-v1 に変換',
           'H': H.tolist(), 'DW': DW, 'floor': ring(dot_m), 'plaza_c80': ring(plaza_m), 'nodes': NODE_M, 'exits': exits_m},
          open(os.path.join(ROOT, 'tools/data/dotica_board.json'), 'w'), ensure_ascii=False, indent=1)
floor_m = dot_m
# metric 空間の確認図: 床 / OSM ビル / 旧ノード・エッジ
S = 4.0; X0, Y0 = 600, 1330
def mp(x, y): return ((x - X0) * S, (y - Y0) * S)
cv = Image.new('RGB', (int(260 * S), int(330 * S)), (240, 240, 240)); dr = ImageDraw.Draw(cv)
for gx in range(600, 860, 20):
    dr.line([mp(gx, 1330), mp(gx, 1660)], fill=(210, 210, 210)); dr.text((mp(gx, 1330)[0] + 2, 2), str(gx), fill=(120, 120, 120))
for gy in range(1340, 1660, 20):
    dr.line([mp(600, gy), mp(860, gy)], fill=(210, 210, 210)); dr.text((2, mp(600, gy)[1] + 2), str(gy), fill=(120, 120, 120))
dr.polygon([mp(x, y) for x, y in floor_m.exterior.coords], fill=(250, 200, 190), outline=(200, 60, 60))
dr.polygon([mp(x, y) for x, y in plaza_m.exterior.coords], fill=(225, 220, 170), outline=(150, 140, 60))
for oid, g in osm.items():
    pts = [mp(x, y) for x, y in g.exterior.coords]
    if all(0 < x < cv.size[0] and 0 < y < cv.size[1] for x, y in pts):
        dr.line(pts, fill=(60, 60, 200), width=2)
src = open(os.path.join(ROOT, 'main.js')).read()
nodes = {}
for m in re.finditer(r"[PJ]\('(\w+)',(?:\s*'[^']*',\s*'(?:S1|B1|B2)',)?\s*(-?[\d.]+),\s*(-?[\d.]+)", src):
    nodes[m.group(1)] = (float(m.group(2)), float(m.group(3)))
em = re.search(r"const EDGES = \[(.*?)\n\];", src, re.S)
for m in re.finditer(r"\['(\w+)',\s*'(\w+)',\s*([\d.]+)(?:,\s*'(\w+)')?\]", em.group(1)):
    a_, b_ = m.group(1), m.group(2)
    if a_ in nodes and b_ in nodes and m.group(4) in ('dotica', 'avanza'):
        dr.line([mp(*nodes[a_]), mp(*nodes[b_])], fill=(0, 150, 150), width=2)
for n, (x, y) in nodes.items():
    if 600 < x < 860 and 1330 < y < 1660:
        p = mp(x, y); dr.ellipse([p[0] - 3, p[1] - 3, p[0] + 3, p[1] + 3], fill=(0, 120, 120)); dr.text((p[0] + 4, p[1] - 4), n, fill=(0, 80, 80))
for x, y in m_of(axis):
    p = mp(x, y); dr.ellipse([p[0] - 1.5, p[1] - 1.5, p[0] + 1.5, p[1] + 1.5], fill=(255, 0, 0))
for k, (x, y) in exits_m.items():
    p = mp(x, y); dr.ellipse([p[0] - 4, p[1] - 4, p[0] + 4, p[1] + 4], outline=(0, 160, 0), width=2); dr.text((p[0] + 5, p[1]), k, fill=(0, 120, 0))
for k, (x, y) in NODE_M.items():
    p = mp(x, y); dr.ellipse([p[0] - 3, p[1] - 3, p[0] + 3, p[1] + 3], fill=(200, 0, 200)); dr.text((p[0] + 4, p[1] + 2), k, fill=(150, 0, 150))
cv.save(OUT + 'dotica_board_metric.png'); print('wrote dotica_board_metric.png')

# ===================== --apply: main.js のノード座標を書き換える =====================
if '--apply' in sys.argv:
    mp_ = os.path.join(ROOT, 'main.js'); ms = open(mp_).read(); n_ = 0
    for k, (x, y) in list(NODE_M.items()) + [('kanden_b1', NODE_M['kanden_b2'])]:
        pat = re.compile(r"((?:J|P)\('%s',\s*(?:'[^']*',\s*'(?:S1|B1|B2)',\s*)?)(-?[\d.]+),\s*(-?[\d.]+)" % k)
        ms, c = pat.subn(lambda m: '%s%g, %g' % (m.group(1), x, y), ms); n_ += c
        if c != 1: print('!! main.js のノード', k, 'が', c, '件')
    open(mp_, 'w').write(ms); print('main.js のノード座標を書き換え:', n_)
    # 集約ドット(shops.js の rect)用: 本線の軸の x を metric y ごとに
    ax_m = m_of(axis)
    for my_ in (1385, 1479, 1576):
        near = [x for x, y in ax_m if abs(y - my_) < 3]
        print('  軸 y=%d: x=%.1f' % (my_, np.mean(near)))
