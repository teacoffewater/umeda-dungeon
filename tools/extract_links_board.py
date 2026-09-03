#!/usr/bin/env python3
"""LINKS UMEDA(リンクス梅田) B1F の館内案内板写真から詳細地図データを起こす。

入力: tools/data/floorguides/links_b1_board_2026-09-03.jpg (現地撮影。北が上になるよう回転済み)
出力: tools/data/detail/links_b1.json (→ python3 tools/gen_detail.py links_b1)、tools/_debug/links_b1_trace.png

板の色: 区画=茶(Harves・マクド・スギ薬局など)/黄(オイシイもの横丁 20〜41)/オリーブ(16〜19)、ヨドバシ売場=灰、
通路=背景と同じ薄いベージュ(色では分けられない)。→ 歩ける床 = 外形の内側 − 区画 − 暗い記号(ESC・EV・トイレ)。
番号→店名は板のテナント一覧(links_b1_tenants)。店名は shops.js の links_b1 の表記に合わせる(名前照合のため)。
縮尺: OSM のヨドバシ梅田タワー外形(788888925: 東西155m×南北144m)を板の外形に当てる。
"""
import json, os
from PIL import Image, ImageDraw
import numpy as np
from shapely.geometry import box, Polygon, MultiPolygon, Point
from shapely.ops import unary_union
from shapely import contains_xy
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools/data/floorguides/links_b1_board_2026-09-03.jpg')
OUT = os.path.join(ROOT, 'tools/_debug/'); os.makedirs(OUT, exist_ok=True)
im = Image.open(SRC).convert('RGB'); W0, H0 = im.size
DW = 1200  # 座標を読んだ表示幅
sm = im.resize((DW, int(H0 * DW / W0)), Image.BILINEAR)
a = np.asarray(sm).astype(float); R, G, B = a[..., 0], a[..., 1], a[..., 2]
mx, mn = a.max(-1), a.min(-1); v = mx; s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
d = np.maximum(mx - mn, 1e-6)
h = np.where(mx == R, ((G - B) / d) % 6, np.where(mx == G, (B - R) / d + 2, (R - G) / d + 4)) * 60
# 板の床の外形(表示px、目視)。通路は背景と同色なので外形で切る
FRAME = [(20, 455), (630, 302), (640, 245), (1035, 240), (1035, 690), (962, 700), (962, 960), (1005, 965), (1005, 1120),
         (975, 1130), (975, 1240), (955, 1300), (930, 1342), (640, 1348), (600, 1340), (420, 1282), (330, 1247)]
frame = Polygon(FRAME)
ys, xs = np.mgrid[0:a.shape[0], 0:a.shape[1]]
inside = contains_xy(frame, xs, ys)
tan = (h > 22) & (h < 42) & (s > 0.35) & (s < 0.72) & (v > 110)
yellow = (h > 30) & (h < 58) & (s > 0.62) & (v > 90)
olive = (h > 44) & (h < 80) & (s > 0.28) & (s < 0.62) & (v > 110)
gray = (s < 0.13) & (v > 135) & (v < 182)
dark = v < 105

def erode(m, r):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out &= np.roll(np.roll(m, dy, 0), dx, 1)
    return out

def dilate(m, r):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out
def close(m, r):  # 区画の中の黒い番号の文字(太さ数px)を埋める。区画の境の白線(細い)は次の erode で切れる
    return erode(dilate(m, r), r)

def polys(mask, min_area, er):
    # 区画の中の黒い番号の文字だけを埋める(暗い画素のうち区画色に隣接するもの)。区画の境の白線は明るいので埋まらない
    filled = mask | (dark & dilate(mask, 5))
    m = erode(filled & inside, er)
    ys_, xs_ = np.nonzero(m)
    if len(xs_) == 0: return []
    u = unary_union([box(x, y, x + 1, y + 1) for x, y in zip(xs_, ys_)])
    geoms = list(u.geoms) if isinstance(u, MultiPolygon) else [u]
    return [Polygon(g.exterior).buffer(er, join_style=2) for g in geoms if g.area >= min_area]

tanp = polys(tan & ~yellow, 150, 2)
yelp = polys(yellow, 120, 2)
olip = polys(olive & ~tan & ~yellow, 150, 2)
grayp = sorted(polys(gray, 5000, 3), key=lambda g: -g.area)[:1]  # ヨドバシ売場(最大の灰)
print('茶', len(tanp), '黄', len(yelp), 'オリーブ', len(olip), '灰', [round(g.area) for g in grayp])
cands = [(g, 'tan') for g in tanp] + [(g, 'yellow') for g in yelp] + [(g, 'olive') for g in olip]
# 番号の位置(表示px、目視)。9 はスギ薬局が2区画
NUM = {'1': (790, 310), '7': (830, 515), '9a': (720, 635), '9b': (798, 745), '8': (843, 745), '2': (930, 712), '3': (930, 775),
       '4': (915, 822), '5': (930, 868), '6': (930, 915), '10': (843, 832), '11': (798, 832), '12': (735, 840), '13': (808, 922),
       '14': (802, 1040), '15': (690, 1055), '20': (719, 1025), '21': (908, 988), '22': (963, 995), '23': (948, 1060),
       '24': (950, 1100), '25': (866, 1103), '26': (833, 1128), '27': (795, 1140), '28': (745, 1170), '29': (695, 1188),
       '30': (650, 1203), '31': (868, 1198), '32': (825, 1210), '33': (773, 1228), '34': (725, 1253), '35': (675, 1265),
       '36': (940, 1250), '37': (890, 1287), '38': (848, 1273), '39': (790, 1288), '40': (712, 1320), '41': (658, 1325),
       '16': (600, 1222), '17': (570, 1222), '18': (553, 1147), '19': (497, 1170)}
# 店名は shops.js の links_b1 の表記(名前照合のため)。板の表記が違うものはコメント
NAMES = {'1': 'スーパーマーケット Harves', '2': 'みどりの雑貨屋', '5': 'さち福やCAFÉ', '7': 'マクドナルド', '8': 'わしたショップ',
         '9a': 'スギ薬局', '9b': 'スギ薬局', '13': '韓time', '15': 'クリスピー・クリーム・ドーナツ', '16': 'SUBWAY',
         '17': '青山フラワーマーケット', '18': 'ゴンチャ', '19': 'スターバックス コーヒー', '20': 'お酒の美術館',
         '21': '海鮮と串焼きのお店 鈴音',  # 板: 海鮮と串焼き 美旬彩 鈴音
         '23': 'うまいもん酒場 源喜', '24': '焼肉ジャパン', '25': 'ニューすしセンター200', '26': 'BAR ESPAÑOL PEQUEÑO',
         '27': '焼鳥ボトルバード', '28': '堂山食堂', '29': '漁師酒場あらき',
         '30': '函館立喰い寿司 函太郎',  # 板: 函館 グルメ寿司 函太郎
         '31': '博多ぐるぐるとりかわ 竹乃屋', '32': '肉処 大阪ブラウン', '33': 'たこ酒場 くれおーる',
         '34': '梅田のしんちゃん',  # 板: 餃子とセアブラおでん 梅田のしんちゃん
         '35': '福岡鮮魚卸直営店 ビストロ酒場 ウオスケ', '36': 'HUB', '37': 'もつ焼 もつ福', '38': '金の粉', '39': 'ODD',
         '40': '大衆中華酒場 若林', '41': '桐麺'}  # 板: 中華そば 桐麺 梅田店。3/4/6/10/11/12/14/22 は空き
blocks, used = [], set()
for no, (cx, cy) in NUM.items():
    pt = Point(cx, cy)
    cand = [(g, k) for g, k in cands if g.contains(pt) or g.distance(pt) < 5]
    if not cand:
        print('!! 番号', no, 'の区画が見つからない'); continue
    g, k = min(cand, key=lambda gk: 0 if gk[0].contains(pt) else gk[0].distance(pt))
    if id(g) in used: print('  番号', no, 'は他と同じ区画')
    used.add(id(g)); blocks.append((no, g, k))
for g, k in cands:
    if id(g) not in used and g.area > 1000:
        print('  無番号の区画', k, round(g.area), '@', round(g.centroid.x), round(g.centroid.y)); blocks.append((None, g, k))
# 縮尺: 外形bbox ↔ 建物 155m × 144m
fx0, fy0, fx1, fy1 = frame.bounds
sx, sy = 155.0 / (fx1 - fx0), 144.0 / (fy1 - fy0)
def g_of(poly):
    poly = poly.simplify(0.8)
    return [[round((x - fx0) * sx, 1), round((y - fy0) * sy, 1)] for x, y in poly.exterior.coords[:-1]]
# 暗い記号(ESC・EV・トイレの箱)は歩けない区画として持つ(床からの引き算用)
darkp = polys(dark & ~tan & ~yellow & ~olive, 60, 1)
floor = unary_union([frame] + [p for _, p, _ in blocks] + grayp).buffer(1.0).buffer(-1.0)
if isinstance(floor, MultiPolygon): floor = max(floor.geoms, key=lambda g: g.area)
blocks_out = []
for no, p, k in blocks:
    o = {'mall': {'tan': 'links', 'yellow': '横丁', 'olive': 'links'}[k], 'g': g_of(p)}
    if no: o['no'] = no.rstrip('ab')
    blocks_out.append(o)
blocks_out += [{'mall': 'ヨドバシ', 'g': g_of(p)} for p in grayp]
blocks_out += [{'mall': '設備', 'g': g_of(p)} for p in darkp if p.area < 4000]
shops = []
for no, p, k in blocks:
    if no in NAMES:
        c = p.centroid; shops.append({'name': NAMES[no], 'no': no.rstrip('ab'), 'g': [round((c.x - fx0) * sx, 1), round((c.y - fy0) * sy, 1)]})
if grayp:
    c = grayp[0].centroid; shops.append({'name': 'ヨドバシカメラ マルチメディア梅田 B1売場', 'no': '', 'g': [round((c.x - fx0) * sx, 1), round((c.y - fy0) * sy, 1)]})
out = {'source': 'LINKS UMEDA B1F 館内案内板(2026-09-03 現地撮影)。色で区画を切り出し。縮尺は建物外形155×144m(OSM 788888925)',
       'areas': ['links_b1'], 'outline_g': g_of(floor), 'blocks': blocks_out, 'shops': shops, 'area_anchors': {}, 'walks': []}
json.dump(out, open(os.path.join(ROOT, 'tools/data/detail/links_b1.json'), 'w'), ensure_ascii=False, indent=1)
print('区画', len(blocks_out), '店', len(shops), '縮尺 sx %.3f sy %.3f m/px' % (sx, sy))
dbg = sm.copy(); dr = ImageDraw.Draw(dbg)
dr.polygon(FRAME, outline=(0, 255, 0))
for no, p, k in blocks:
    dr.polygon([(x, y) for x, y in p.simplify(0.8).exterior.coords], outline=(255, 60, 60), width=2)
    c = p.centroid; dr.text((c.x - 6, c.y - 6), str(no), fill=(0, 0, 255))
for p in grayp: dr.polygon([(x, y) for x, y in p.simplify(0.8).exterior.coords], outline=(60, 120, 255), width=2)
for p in darkp: dr.polygon([(x, y) for x, y in p.simplify(0.8).exterior.coords], outline=(255, 0, 255))
dbg.save(OUT + 'links_b1_trace.png'); print('wrote links_b1_trace.png')
