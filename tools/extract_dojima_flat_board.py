#!/usr/bin/env python3
"""堂島ふらっと(近鉄堂島ビル B1F)の館内案内板写真から詳細地図データ(区画・通路)を起こす。

入力: tools/data/floorguides/dojima_flat_b1_board_2026-09-03.jpg (現地撮影。区画=緑(番号付き)、通路=黒、設備=薄い灰、黄=無番号の区画)
出力: tools/data/detail/dojima_flat.json (→ python3 tools/gen_detail.py dojima_flat)、tools/_debug/dojima_flat_trace.png

方法: 板の床の枠(白線の矩形)の内側だけを対象に色で分類 → 緑の連結成分=区画(番号は重心位置で対応付け) →
灰・黄・青赤(トイレ)も区画(店ではない)として持つ → 歩ける床 = 枠の内側 − 区画。
ドーチカへの接続(右下の階段、板の「▶ドージマ地下センター」)は手で通路を足す。地上への階段は地下完結の方針で含めない。
縮尺は OSM の近鉄堂島ビル外形(162185349: 東西47m×南北58m)を板の枠に当てる。板は北が上(右=東=四つ橋筋・ドーチカ)。
"""
import json, os
from PIL import Image, ImageDraw
import numpy as np
from shapely.geometry import box, Polygon, MultiPolygon, Point
from shapely.ops import unary_union
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools/data/floorguides/dojima_flat_b1_board_2026-09-03.jpg')
OUT = os.path.join(ROOT, 'tools/_debug/'); os.makedirs(OUT, exist_ok=True)
S = 4
im = Image.open(SRC).convert('RGB'); W, H = im.size
sm = im.resize((W // S, H // S), Image.BILINEAR)
a = np.asarray(sm).astype(int); R, G, B = a[..., 0], a[..., 1], a[..., 2]
mx, mn = a.max(-1), a.min(-1); sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
K = (W / 2000) / S  # 表示画像(幅2000px)で読んだ座標 → 縮小px
# 床の枠(表示px): 白線の矩形の内側。板は少し傾いているので四隅で与える
FRAME = [(508, 328), (1388, 318), (1390, 1203), (512, 1207)]
frame = Polygon([(x * K, y * K) for x, y in FRAME])
x0, y0, x1, y1 = [int(v) for v in frame.bounds]
green = (G > R + 25) & (G > B + 15) & (G > 90) & (sat > 0.3)
yellow = (R > 150) & (G > 150) & (B < 120) & (sat > 0.35)
gray = (mn > 140) & (mx < 235) & (sat < 0.2)          # 薄い灰(設備・空き)
blue = (B > R + 40) & (B > 90) & (sat > 0.35)         # 男子トイレ
red = (R > G + 60) & (R > B + 40) & (R > 120)          # 女子トイレ
inside = np.zeros_like(green)
ys, xs = np.mgrid[0:green.shape[0], 0:green.shape[1]]
from shapely import contains_xy
inside = contains_xy(frame, xs, ys)

def erode(m, r):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out &= np.roll(np.roll(m, dy, 0), dx, 1)
    return out

def polys(mask, min_area, er):
    m = erode(mask & inside, er)
    ys_, xs_ = np.nonzero(m)
    if len(xs_) == 0: return []
    u = unary_union([box(x, y, x + 1, y + 1) for x, y in zip(xs_, ys_)])
    geoms = list(u.geoms) if isinstance(u, MultiPolygon) else [u]
    # 番号の白丸が穴になるので外周だけを採る(穴があると contains/距離判定が番号の位置で外れる)
    return [Polygon(g.exterior).buffer(er, join_style=2) for g in geoms if g.area >= min_area]

gp = polys(green, 60, 2)
print('緑の区画候補', len(gp), sorted(round(g.area) for g in gp))
others = [(g, '空き') for g in polys(gray, 40, 2)] + [(g, '広場') for g in polys(yellow, 60, 2)] + \
         [(g, 'トイレ') for g in polys(blue, 30, 1)] + [(g, 'トイレ') for g in polys(red, 30, 1)]
print('その他の区画', len(others))
# 番号 → 緑成分(重心が最も近いもの)。座標は表示画像(幅2000px)で読んだ
NUM = {'1a': (600, 840), '1b': (600, 1050), '2': (597, 712), '3': (595, 568), '4': (868, 1145), '5': (798, 898), '6': (884, 975),
       '7': (795, 595), '8': (856, 378), '9': (1098, 590), '10': (1037, 375), '11': (1168, 373), '12': (1300, 970),
       '13': (1300, 835), '14': (1300, 703), '15': (1300, 568), '16': (1330, 437)}
NAMES = {'1a': 'ケア21グループ 研修センター 研修室A・B・C', '1b': 'ケア21グループ 研修センター 研修室A・B・C', '2': 'NAVI CLINIC',
         '4': 'S.CLEAR', '5': '大阪小田クリニック', '6': 'パシフィック ダイナー サービス', '7': 'OSAKA ODA CLINIC',
         '8': '近鉄住宅管理 研修センター', '9': 'ケア21グループ 研修センター 研修室D・E', '10': '三菱電機プラントエンジニアリング',
         '11': '三菱電機プラントエンジニアリング', '12': '堂島かわだクリニック', '13': '三菱電機プラントエンジニアリング',
         '14': '近鉄住宅管理 研修センター', '15': 'ヘアサロン ONO 理容室', '16': '耳かき本舗 ほっこり部屋'}
blocks, used = [], set()
for no, (cx, cy) in NUM.items():
    px, py = cx * K, cy * K
    pt = Point(px, py)
    cand = [g for g in gp if g.contains(pt) or g.distance(pt) < 6]
    if not cand:
        print('!! 番号', no, 'の区画が見つからない'); continue
    g = min(cand, key=lambda g: g.distance(pt) if not g.contains(pt) else 0)
    if id(g) in used:
        print('  番号', no, 'は他の番号と同じ区画(共有)');
    used.add(id(g)); blocks.append((no, g))
for g in gp:
    if id(g) not in used:
        print('  無番号の緑区画 area', round(g.area), '@', round(g.centroid.x / K), round(g.centroid.y / K)); blocks.append((None, g))
# 縮尺: 枠 = 建物外形(47m × 58m)。ガイド原点 = 枠の左上
fx0, fy0, fx1, fy1 = frame.bounds
sx, sy = 47.0 / (fx1 - fx0), 58.0 / (fy1 - fy0)
def g_of(poly):
    poly = poly.simplify(0.6)
    return [[round((x - fx0) * sx, 1), round((y - fy0) * sy, 1)] for x, y in poly.exterior.coords[:-1]]
# ドーチカへの接続: 右下の通路(板の x 1290〜1385, y 1040〜1100 の通路)から東へ階段(1385〜1445, 1075〜1130)。ガイド座標で手置き
CONN = Polygon([(x * K, y * K) for x, y in [(1385, 1075), (1445, 1075), (1445, 1130), (1385, 1130)]])
floor = unary_union([frame, CONN])
blocks_out = [{'no': str(no), 'mall': 'dojima_flat', 'g': g_of(p)} for no, p in blocks if no is not None]
blocks_out += [{'mall': 'dojima_flat', 'g': g_of(p)} for no, p in blocks if no is None]
blocks_out += [{'mall': kind, 'g': g_of(p)} for p, kind in others]
seen = {}
shops = []
for no, p in blocks:
    if no in NAMES:
        c = p.centroid
        shops.append({'name': NAMES[no], 'no': str(no), 'g': [round((c.x - fx0) * sx, 1), round((c.y - fy0) * sy, 1)]})
out = {
  'source': '堂島ふらっと(近鉄堂島ビルB1F) 館内案内板(2026-09-03 現地撮影)。緑=区画を色で切り出し。縮尺は建物外形47×58m(OSM 162185349)',
  'outline_g': g_of(floor), 'blocks': blocks_out, 'shops': shops, 'area_anchors': {}, 'walks': [g_of(CONN)],
}
json.dump(out, open(os.path.join(ROOT, 'tools/data/detail/dojima_flat.json'), 'w'), ensure_ascii=False, indent=1)
print('区画', len(blocks_out), '店', len(shops), '縮尺 sx %.4f sy %.4f m/px' % (sx, sy))
dbg = Image.fromarray((a * 0.5).astype(np.uint8)); dr = ImageDraw.Draw(dbg)
dr.polygon([(x, y) for x, y in floor.exterior.coords], outline=(0, 255, 0))
for no, p in blocks:
    dr.polygon([(x, y) for x, y in p.simplify(0.6).exterior.coords], outline=(255, 80, 80))
    c = p.centroid; dr.text((c.x - 6, c.y - 6), str(no), fill=(255, 255, 0))
for p, kind in others:
    dr.polygon([(x, y) for x, y in p.simplify(0.6).exterior.coords], outline=(80, 160, 255))
dbg.crop((x0 - 20, y0 - 20, x1 + 40, y1 + 40)).save(OUT + 'dojima_flat_trace.png'); print('wrote dojima_flat_trace.png')
