#!/usr/bin/env python3
"""「ひとにやさしい地下街ガイドマップ」(大阪地下街株式会社 2026.4、ベクタPDF)から広域の通路の形を起こす。

入力: tools/data/floorguides/umeda_guide_map_2026-04.pdf
出力: tools/data/guide_map.json  (metric-v1)
        corridors: 地下街の通路の面(白)  / whity: ホワイティ・ドーチカの面(桃)  / buildings: ビル(水色)
        H: PDF座標(pt)→metric-v1 のアフィン
      tools/_debug/guide_layers.png / guide_fit.png

位置合わせ: PDF の水色のビル外形を OSM のビル外形に ICP で当てる(回転+等方スケール+平行移動の相似変換)。
初期値はスケールバー(100m 間隔)と、手で対応付けたビル数棟の重心。
"""
import json, os, sys
import numpy as np
import pymupdf
from PIL import Image, ImageDraw
from shapely.geometry import Polygon, MultiPolygon, Point, LineString, box
from shapely.ops import unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from geo import ll2m  # noqa: E402
SRC = os.path.join(ROOT, 'tools/data/floorguides/umeda_guide_map_2026-04.pdf')
OUT = os.path.join(ROOT, 'tools/_debug/'); os.makedirs(OUT, exist_ok=True)

doc = pymupdf.open(SRC); page = doc[0]
W, H = page.rect.width, page.rect.height
# 地図の範囲(pt): 右の表(x>850)・下のスケールバー(y>817)・左上のエレベーター表とタイトル(x<280, y<410)・右下の凡例(x>850)を除く
MAP_BOX = box(0, 0, 850, 817).difference(box(0, 0, 280, 410))

def rgb(c):
    return tuple(round(v, 2) for v in c) if c else None

WHITE, PINK, LBLUE = (1.0, 1.0, 1.0), (0.97, 0.72, 0.83), (0.73, 0.9, 0.98)
layers = {'white': [], 'pink': [], 'lblue': [], 'purple': [], 'yellow': [], 'beige': []}
# 白=地下街の通路、桃=ホワイティうめだ・ドーチカ、水色=ビル、紫=階段記号、黄=傾斜部、ベージュ=駅(JR大阪駅・阪急)の面
COL = {WHITE: 'white', PINK: 'pink', LBLUE: 'lblue', (0.18, 0.19, 0.57): 'purple', (1.0, 0.95, 0.0): 'yellow',
       (0.99, 0.82, 0.72): 'beige', (0.97, 0.67, 0.56): 'beige'}


def path_polys(dr):
    """描画パスをポリゴン(pt)にする。サブパス(始点が前の終点と違う所)で切り、複合パスは対称差(偶奇)で穴を表す。
    曲線は端点で直線化(地図の曲線は短い)"""
    rings, cur = [], []
    def close():
        if len(cur) >= 3: rings.append(list(cur))
        cur.clear()
    for it in dr['items']:
        op = it[0]
        if op in ('l', 'c'):
            p0 = it[1]; p1 = it[2] if op == 'l' else it[4]
            if cur and (abs(cur[-1][0] - p0.x) > 0.01 or abs(cur[-1][1] - p0.y) > 0.01):
                close()
            if not cur: cur.append((p0.x, p0.y))
            cur.append((p1.x, p1.y))
        elif op == 're':
            close(); r = it[1]
            rings.append([(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)])
        elif op == 'qu':
            close(); q = it[1]
            rings.append([(q.ul.x, q.ul.y), (q.ur.x, q.ur.y), (q.lr.x, q.lr.y), (q.ll.x, q.ll.y)])
    close()
    geom = None
    for pts in rings:
        try:
            g = Polygon(pts).buffer(0)
        except Exception:
            continue
        if g.is_empty: continue
        geom = g if geom is None else geom.symmetric_difference(g)
    if geom is None or geom.is_empty: return []
    return list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]


for dr in page.get_drawings():
    f = rgb(dr.get('fill'))
    if f not in COL: continue
    for p in path_polys(dr):
        if p.area < 2: continue
        if not p.intersects(MAP_BOX): continue
        if COL[f] in ('white', 'pink') and p.area < 12: continue  # 白抜きの文字・記号(12pt² ≈ 24m² 未満)は通路ではない
        layers[COL[f]].append(p)
for k, v in layers.items():
    print(k, len(v), '面積合計 %.0f pt2' % sum(p.area for p in v))

# 確認画像(pt → px ×1.4)
S = 1.4
img = Image.new('RGB', (int(W * S), int(H * S)), (40, 60, 60)); dr_ = ImageDraw.Draw(img)
for k, col in [('lblue', (120, 170, 220)), ('beige', (230, 200, 160)), ('white', (255, 255, 255)), ('pink', (245, 130, 120)), ('purple', (120, 60, 200)), ('yellow', (255, 240, 0))]:
    for p in layers[k]:
        for g in (p.geoms if isinstance(p, MultiPolygon) else [p]):
            dr_.polygon([(x * S, y * S) for x, y in g.exterior.coords], fill=col)
            for h in g.interiors:  # 穴(ビルなど)は背景色で塗り戻す
                dr_.polygon([(x * S, y * S) for x, y in h.coords], fill=(40, 60, 60))
img.save(OUT + 'guide_layers.png'); print('wrote guide_layers.png')
json.dump({k: [list(p.exterior.coords) for p in v if p.geom_type == 'Polygon'] for k, v in layers.items()},
          open(OUT + 'guide_layers_pt.json', 'w'))

# ===================== 位置合わせ: PDF(pt) → metric-v1 の相似変換 =====================
# 初期値: 縮尺はスケールバー(下の帯 100m 刻み。1200m ≈ 851pt → 1.41 m/pt)、回転 0(北が上)、平行移動は名前の分かるビルの重心
bld = json.load(open(os.path.join(ROOT, 'tools/data/osm_buildings.json')))
osm = {e['id']: Polygon([ll2m(p['lat'], p['lon']) for p in e['geometry']]).buffer(0)
       for e in bld['elements'] if e['type'] == 'way' and e.get('geometry')}
byname = {}
for e in bld['elements']:
    if e['type'] == 'way': byname.setdefault(e.get('tags', {}).get('name', ''), []).append(e['id'])
def nearest_pt(polys, x, y):
    return min(polys, key=lambda g: g.distance(Point(x, y)))
# (PDF 上のビルの位置 pt(目視), OSM way id)
INIT = [((420, 154), byname['ヨドバシ梅田タワー'][0]), ((592, 247), 588689735), ((525, 311), 161450829), ((547, 375), 502411898),
        ((450, 450), 162158150), ((345, 131), 178942581)]
src_c, dst_c = [], []
for (px, py), oid in INIT:
    g = nearest_pt(layers['lblue'], px, py)
    src_c.append([g.centroid.x, g.centroid.y]); dst_c.append([osm[oid].centroid.x, osm[oid].centroid.y])
src_c, dst_c = np.array(src_c), np.array(dst_c)
def sim_apply(q, pts):
    s_, th, tx, ty = q; c, sn = np.cos(th), np.sin(th)
    x, y = pts[:, 0], pts[:, 1]
    return np.c_[s_ * (c * x - sn * y) + tx, s_ * (sn * x + c * y) + ty]
# 初期: 縮尺 1.41、回転 0、平行移動 = 重心差の平均
q = np.array([1.41, 0.0, 0.0, 0.0])
d0 = dst_c - sim_apply(q, src_c); q[2], q[3] = d0[:, 0].mean(), d0[:, 1].mean()
print('初期 残差(重心) m:', np.round(np.hypot(*(dst_c - sim_apply(q, src_c)).T), 1))
# ICP: 水色ビルの外周の点 → 最寄りの OSM ビル外形(全体)の距離。20m で頭打ち
osm_bnd = unary_union([g.exterior for g in osm.values() if g.area > 200])
samples = []
for g in layers['lblue']:
    if g.area < 60: continue
    ring = LineString(g.exterior.coords); n = max(6, int(ring.length / 10))
    samples += [ring.interpolate(ring.length * i / n).coords[0] for i in range(n)]
samples = np.array(samples); print('ICP サンプル点', len(samples))
def resid(q):
    P = sim_apply(q, samples)
    return np.array([min(osm_bnd.distance(Point(x, y)), 20.0) for x, y in P])
steps = np.array([1e-3, 1e-3, 0.1, 0.1])
for it in range(30):
    r0 = resid(q); J = np.zeros((len(r0), 4))
    for k in range(4):
        qq = q.copy(); qq[k] += steps[k]; J[:, k] = (resid(qq) - r0) / steps[k]
    lam = 1e-3 * np.trace(J.T @ J) / 4
    q = q + np.linalg.solve(J.T @ J + lam * np.eye(4), -J.T @ r0)
    r1 = resid(q)
    if it % 5 == 0: print('iter', it, 'rms %.2f m' % np.sqrt((r1 ** 2).mean()))
    if abs(np.sqrt((r0 ** 2).mean()) - np.sqrt((r1 ** 2).mean())) < 1e-3: break
print('相似変換: 縮尺 %.4f m/pt, 回転 %.2f°, 平行移動 (%.1f, %.1f)' % (q[0], np.degrees(q[1]), q[2], q[3]))
print('名前付きビルの重心残差 m:', np.round(np.hypot(*(dst_c - sim_apply(q, src_c)).T), 1))
# 確認画像: OSM 外形を PDF のレンダリングに逆投影
pix = page.get_pixmap(dpi=96); ren = Image.frombytes('RGB', (pix.width, pix.height), pix.samples); K = pix.width / W
s_, th, tx, ty = q
def m2pt(x, y):
    c, sn = np.cos(th), np.sin(th); u, v = (x - tx) / s_, (y - ty) / s_
    return (c * u + sn * v, -sn * u + c * v)
dr2 = ImageDraw.Draw(ren)
for g in osm.values():
    pts = [m2pt(x, y) for x, y in g.exterior.coords]
    if all(0 < x < W and 0 < y < H for x, y in pts): dr2.line([(x * K, y * K) for x, y in pts], fill=(255, 0, 0), width=2)
ren.save(OUT + 'guide_fit.png'); print('wrote guide_fit.png')
def to_m(g):
    return [[round(float(x), 1), round(float(y), 1)] for x, y in sim_apply(q, np.array(g.exterior.coords))]
def rings_m(polys):
    out = []
    for p in polys:
        for g in (p.geoms if isinstance(p, MultiPolygon) else [p]):
            out.append({'ext': to_m(g), 'holes': [[[round(float(x), 1), round(float(y), 1)] for x, y in sim_apply(q, np.array(h.coords))] for h in g.interiors]})
    return out
json.dump({'source': 'ひとにやさしい地下街ガイドマップ(大阪地下街株式会社 2026.4)。ベクタPDFの塗りを色で層に分け、水色のビル外形を OSM に ICP で当てた相似変換で metric-v1 へ',
           'sim': {'scale': float(q[0]), 'theta': float(q[1]), 'tx': float(q[2]), 'ty': float(q[3])},
           'corridors': rings_m(layers['white']), 'whity': rings_m(layers['pink']), 'buildings': rings_m(layers['lblue']),
           'station': rings_m(layers['beige']), 'stairs': rings_m(layers['purple']), 'slopes': rings_m(layers['yellow'])},
          open(os.path.join(ROOT, 'tools/data/guide_map.json'), 'w'), ensure_ascii=False)
print('wrote tools/data/guide_map.json')

# ===================== 局所補正: ビルの対応(自動)から薄板スプライン(TPS)で歪みを吸収 =====================
# ガイドマップは案内用の略図で、中心部は合うが周辺(ハービス・ドーチカ側)で 20〜50m ずれる。相似変換の後、
# PDF の水色ビル ↔ OSM ビルを「重心が 45m 以内・面積比 0.5〜2」で自動対応付けし、その重心対応で TPS 補正する
pairs_src, pairs_dst = [], []
osm_list = [(oid, g, g.centroid, g.area) for oid, g in osm.items() if g.area > 150]
cands = []
for g in layers['lblue']:
    if g.area < 100: continue
    c = sim_apply(q, np.array([[g.centroid.x, g.centroid.y]]))[0]; a_m = g.area * q[0] ** 2
    for oid, og, oc, oa in osm_list:
        d = np.hypot(oc.x - c[0], oc.y - c[1]); r = a_m / oa
        if d < 45 and 0.5 < r < 2.0:
            cands.append((d + 20 * abs(np.log(r)), d, id(g), oid, (g.centroid.x, g.centroid.y), (oc.x, oc.y)))
cands.sort(); used_g, used_o = set(), set()
for score, d, gid, oid, sc, dc in cands:
    if gid in used_g or oid in used_o: continue
    used_g.add(gid); used_o.add(oid); pairs_src.append(sc); pairs_dst.append(dc)
print('TPS 対応ビル', len(pairs_src), '組')
P_src = sim_apply(q, np.array(pairs_src)); P_dst = np.array(pairs_dst)
def tps_fit(src, dst, lam=50.0):
    n = len(src)
    def U(r): return np.where(r > 0, r ** 2 * np.log(np.maximum(r, 1e-9)), 0)
    K = U(np.hypot(src[:, None, 0] - src[None, :, 0], src[:, None, 1] - src[None, :, 1])) + lam * np.eye(n)
    Pm = np.c_[np.ones(n), src]
    L = np.zeros((n + 3, n + 3)); L[:n, :n] = K; L[:n, n:] = Pm; L[n:, :n] = Pm.T
    Y = np.zeros((n + 3, 2)); Y[:n] = dst - src
    Wt = np.linalg.solve(L, Y)
    def f(pts):
        r = np.hypot(pts[:, None, 0] - src[None, :, 0], pts[:, None, 1] - src[None, :, 1])
        return pts + U(r) @ Wt[:n] + np.c_[np.ones(len(pts)), pts] @ Wt[n:]
    return f
tps = tps_fit(P_src, P_dst)
res = np.hypot(*(tps(P_src) - P_dst).T)
print('TPS 後のビル重心残差: 平均 %.1f m / 最大 %.1f m' % (res.mean(), res.max()))
def warp(pts):
    return tps(sim_apply(q, np.array(pts, float)))
def to_m(g):
    return [[round(float(x), 1), round(float(y), 1)] for x, y in warp(list(g.exterior.coords))]
def rings_m(polys):
    out = []
    for p in polys:
        for g in (p.geoms if isinstance(p, MultiPolygon) else [p]):
            out.append({'ext': to_m(g), 'holes': [[[round(float(x), 1), round(float(y), 1)] for x, y in warp(list(h.coords))] for h in g.interiors]})
    return out
json.dump({'source': 'ひとにやさしい地下街ガイドマップ(大阪地下街株式会社 2026.4)。ベクタPDFの塗りを色で層に分け、水色のビル外形を OSM に当てた相似変換 + ビル重心の TPS 補正で metric-v1 へ',
           'sim': {'scale': float(q[0]), 'theta': float(q[1]), 'tx': float(q[2]), 'ty': float(q[3])}, 'tps_pairs': [[list(map(float, a)), list(map(float, b))] for a, b in zip(P_src, P_dst)],
           'corridors': rings_m(layers['white']), 'whity': rings_m(layers['pink']), 'buildings': rings_m(layers['lblue']),
           'station': rings_m(layers['beige']), 'stairs': rings_m(layers['purple']), 'slopes': rings_m(layers['yellow'])},
          open(os.path.join(ROOT, 'tools/data/guide_map.json'), 'w'), ensure_ascii=False)
print('wrote tools/data/guide_map.json (TPS)')

# metric 空間の確認図: PDF の通路(白・桃) / OSM ビル / 現在の床(FLOOR_POLYS) / ノード
import re
S2 = 0.8; X0, Y0 = 200, 450
def mp(x, y): return ((x - X0) * S2, (y - Y0) * S2)
cv = Image.new('RGB', (int(1250 * S2), int(1250 * S2)), (235, 235, 235)); d3 = ImageDraw.Draw(cv)
fsrc = open(os.path.join(ROOT, 'tools/floor_polys_generated.js')).read()
for m in re.finditer(r"\{ floor: '(S1|B[12])', zone: '(\w+)', pts: (\[\[.*?\]\])", fsrc):
    pts = json.loads(m.group(3)); col = {'S1': (120, 170, 255), 'B1': (90, 200, 120), 'B2': (200, 120, 200)}[m.group(1)]
    d3.polygon([mp(x, y) for x, y in pts], outline=col)
for g in osm.values():
    d3.line([mp(x, y) for x, y in g.exterior.coords], fill=(150, 150, 150))
for lay, col in [('white', (255, 120, 40)), ('pink', (230, 40, 120))]:
    for p in layers[lay]:
        for g in (p.geoms if isinstance(p, MultiPolygon) else [p]):
            d3.polygon([mp(x, y) for x, y in warp(list(g.exterior.coords))], outline=col, width=2)
            for h in g.interiors: d3.polygon([mp(x, y) for x, y in warp(list(h.coords))], outline=col)
msrc = open(os.path.join(ROOT, 'main.js')).read()
for m in re.finditer(r"[SPJ]\('(\w+)',(?:\s*'[^']*',\s*'(?:S1|B1|B2)',)?\s*(-?[\d.]+),\s*(-?[\d.]+)", msrc):
    x, y = float(m.group(2)), float(m.group(3)); p = mp(x, y)
    d3.ellipse([p[0] - 2, p[1] - 2, p[0] + 2, p[1] + 2], fill=(0, 0, 200))
for gx in range(200, 1450, 100):
    d3.line([mp(gx, 450), mp(gx, 1700)], fill=(200, 200, 200)); d3.text((mp(gx, 450)[0] + 2, 2), str(gx), fill=(100, 100, 100))
for gy in range(500, 1700, 100):
    d3.line([mp(200, gy), mp(1450, gy)], fill=(200, 200, 200)); d3.text((2, mp(200, gy)[1] + 2), str(gy), fill=(100, 100, 100))
cv.save(OUT + 'guide_metric.png'); print('wrote guide_metric.png')
