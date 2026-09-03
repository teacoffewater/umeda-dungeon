#!/usr/bin/env python3
"""堂島アバンザ B1F の館内案内板写真から詳細地図データ(区画・通路)を起こす。

入力: tools/data/floorguides/avanza_b1_board_2026-09-03.jpg (現地撮影の案内板。区画=オレンジ、通路=白、駐車場等=ベージュ)
出力: tools/data/detail/avanza.json (→ python3 tools/gen_detail.py avanza)、tools/_debug/avanza_trace.png(確認用)

方法: 色で3値化 → 収縮で細い線(枠線・区画境界)を落として連結成分に分ける → 膨張で戻す → ポリゴン化。
区画番号は成分の重心位置で対応付け(NUM、目視で確認済み)。ドーチカへの接続3本(いずれも階段)は
案内板の階段記号の位置に手で置く(STAIRS)。縮尺は建物の東西80m/南北60m(OSM 178958655)から換算。
案内板は西梅田駅方向が上(≒北が上)。ガイド座標系なので実座標とは位置合わせしない。
"""
import json
from PIL import Image, ImageDraw
import numpy as np
from shapely.geometry import box, Polygon, MultiPolygon
from shapely.ops import unary_union
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools/data/floorguides/avanza_b1_board_2026-09-03.jpg')  # 現地の館内案内板(縮小済み)
OUT = os.path.join(ROOT, 'tools/_debug/')  # デバッグ画像(gitignore)
os.makedirs(OUT, exist_ok=True)
S = 2  # 縮小率(素材は元写真の1/2サイズなので、元スクリプトの S=4 と同じ解像度)
im = Image.open(SRC).convert('RGB'); W, H = im.size
sm = im.resize((W // S, H // S), Image.BILINEAR)
a = np.asarray(sm).astype(int); R, G, B = a[..., 0], a[..., 1], a[..., 2]; mx, mn = a.max(-1), a.min(-1)
orange = (R > 160) & (G > 60) & (G < 175) & (B < 120) & (R - G > 55) & (R - B > 90)
white = (mn > 185) & (mx - mn < 30)
# 図面の範囲(元px): 左318*2.856〜右1790*2.856, 上360*2.856〜下1265*2.856 (表示画像2000px幅基準)
K = W / 2000  # 目視で座標を読んだ表示画像(幅2000px)→この画像の倍率
x0, x1, y0, y1 = int(300*K/S), int(1795*K/S), int(355*K/S), int(1270*K/S)
plate = np.zeros_like(white); plate[y0:y1, x0:x1] = True
white &= plate; orange &= plate
def erode(m, r):  # r セルの正方収縮(細い線・枠線・区画境界の細い隙間を落とす)
    out = m.copy()
    for dy in range(-r, r+1):
        for dx in range(-r, r+1):
            out &= np.roll(np.roll(m, dy, 0), dx, 1)
    return out
ER_O, ER_W = 3, 4
orange_e = erode(orange, ER_O)   # 区画同士の細い境界線で切り分ける
white_e = erode(white, ER_W)     # 図面の枠線(細い白線)を落とす

def polys(mask, min_area):
    ys, xs = np.nonzero(mask)
    cells = [box(x, y, x+1, y+1) for x, y in zip(xs, ys)]
    u = unary_union(cells)
    geoms = list(u.geoms) if isinstance(u, MultiPolygon) else [u]
    return [g for g in geoms if g.area >= min_area]

op = [g.buffer(ER_O, join_style=2) for g in polys(orange_e, 40)]
print('区画候補', len(op))
wp = [g.buffer(ER_W, join_style=2) for g in polys(white_e, 120)]
print('白(通路)成分', len(wp), [round(g.area) for g in sorted(wp, key=lambda g: -g.area)[:8]])
# 通路: 区画に接している白成分だけ(枠線や凡例の白は落ちる)
ou = unary_union(op)
# 通路: 区画に接する白成分 + 大きな白成分(西側のドーチカ通路・南サンクンガーデン)。駐車場側(東)の小片は除く
walk = [g for g in wp if g.distance(ou) < 6 or (g.area > 2500 and g.centroid.x < 1100*K/S)]
# ドーチカとの接続部3本(いずれも階段)。案内板の階段記号の位置を手で置く(縮小px)。図面の白でないので色抽出に乗らない
from shapely.geometry import box as _box
STAIRS = {'N': _box(318, 333, 400, 368), 'M': _box(296, 392, 400, 414), 'S': _box(420, 636, 522, 722)}
walk += list(STAIRS.values())
print('区画に接する白成分', len(walk), [round(g.area) for g in walk])
# 番号→成分: 重心位置(元px)で対応付け(目視で確認済み)
# NUM は元写真(幅5712px)で読んだ座標。素材は1/2に縮小してあるので照合時に 2*S で割る
NUM = {1:(2360,2536),2:(2532,2072),3:(1876,2148),4:(2968,1992),5:(2700,1864),6:(2516,1840),7:(2360,1892),
       8:(1860,1740),9:(2900,1556),10:(2400,1560),11:(2080,1540),12:(2432,1128),13:(1644,1176)}
NAMES = {1:'OUTBACK STEAKHOUSE',2:'しゃぶ禅',3:'釣宿酒場マヅメ 梅田本店',4:'ホリーズカフェ',5:'ホリーズカフェ',
         6:"isn't(イズント) 堂島店",8:'がんこ 堂島アバンザ店',9:'セブン-イレブン',10:'SUBWAY',13:'QBハウス'}
blocks = []
for no, (cx, cy) in NUM.items():
    p = min(op, key=lambda g: g.centroid.distance(Polygon([(cx/S,cy/S)]*3).centroid) if False else ((g.centroid.x-cx/(2*S))**2+(g.centroid.y-cy/(2*S))**2))
    blocks.append((no, p))
# 縮尺: 建物の東西幅 80m ↔ 表示px 490→1690 (元px×K)、南北 60m ↔ 表示px 375→1130
sx = 80.0 / ((1690-490)*K); sy = 60.0 / ((1130-375)*K)
ox, oy = 318*K, 365*K  # ガイド原点=図面の左上
def g_of(poly):  # 縮小px → ガイドm
    poly = poly.simplify(0.7)
    return [[round(((x*S)-ox)*sx, 1), round(((y*S)-oy)*sy, 1)] for x, y in poly.exterior.coords[:-1]]
floor = unary_union(walk + [p for _, p in blocks]).buffer(1.2).buffer(-1.2)
if isinstance(floor, MultiPolygon): floor = max(floor.geoms, key=lambda g: g.area)
out = {
  'source': '堂島アバンザ B1F 館内案内板(2026-09-03 現地撮影)。色分けで区画(オレンジ)と通路(白)を切り出し。縮尺は建物幅80m/奥行60m(OSM)で換算',
  'outline_g': g_of(floor),
  'blocks': [{'no': str(no), 'mall': 'avanza', 'g': g_of(p)} for no, p in blocks],
  'shops': [{'name': NAMES[no], 'no': str(no), 'g': [round(((p.centroid.x*S)-ox)*sx,1), round(((p.centroid.y*S)-oy)*sy,1)]} for no, p in blocks if no in NAMES],
  'area_anchors': {},
  'walks': [g_of(v) for v in STAIRS.values()],
  '_stairs_to_dotica': {k: g_of(v) for k, v in STAIRS.items()},
}
json.dump(out, open(os.path.join(ROOT, 'tools/data/detail/avanza.json'), 'w'), ensure_ascii=False, indent=1)
print('床 頂点', len(out['outline_g']), '区画', len(out['blocks']), '店', len(out['shops']))
print('縮尺 sx %.4f sy %.4f m/px  床bbox' % (sx, sy), [min(p[0] for p in out['outline_g']), max(p[0] for p in out['outline_g']), min(p[1] for p in out['outline_g']), max(p[1] for p in out['outline_g'])])
# デバッグ画像
dbg = Image.fromarray((a*0.5).astype(np.uint8)); dr = ImageDraw.Draw(dbg)
for g in walk: dr.polygon([(x, y) for x, y in g.exterior.coords], outline=(80,160,255))
for no, p in blocks:
    dr.polygon([(x, y) for x, y in p.simplify(0.7).exterior.coords], outline=(255,80,80))
    c = p.centroid; dr.text((c.x-6, c.y-6), str(no), fill=(255,255,0))
dr.polygon([(x, y) for x, y in floor.exterior.coords], outline=(0,255,0))
dbg.save(OUT + 'avanza_trace.png'); print('wrote avanza_trace.png')
