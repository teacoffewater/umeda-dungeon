#!/usr/bin/env python3
"""ホワイティうめだ 2016年フロアガイドPDFから店の実位置を抽出する。

仕組み:
  - 地図上の出口番号ラベル(H-28 等)を OSM の出入口実位置と照合し、PDF→metric-v1 のアフィンを最小二乗で求める
    (外れ値 15m 超は1回だけ除いて再フィット)
  - 地図上の店番号(数字テキスト)の位置をそのアフィンで実座標に変換
  - ページ下部の凡例(番号・業種・店名)と結合
出力: tools/data/whity_2016.json  { affine, residual, shops: [{no, category, name, pdf, m}] }
注意: 2016年時点のテナント。現在の店とは番号も名前も違うものがある(名前一致で使う)。
実行: python3 tools/extract_whity_pdf.py  (要 pymupdf, numpy)
"""
import json
import math
import os
import re
import sys

import fitz
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import ll2m  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(ROOT, 'tools/data/floorguides/whity_2016_labeled.pdf')
OUT = os.path.join(ROOT, 'tools/data/whity_2016.json')
MAP_Y_MAX = 700  # これより上が地図、下が凡例

page = fitz.open(PDF)[0]
words = page.get_text('words')

# --- アフィン(PDF pt → metric-v1 m)。出口番号で照合 ---
pdf_refs = {w[4]: ((w[0] + w[2]) / 2, (w[1] + w[3]) / 2)
            for w in words if re.fullmatch(r'[A-Z]-\d+[a-z]?', w[4]) and w[1] < MAP_Y_MAX}
osm = {e['tags']['ref']: ll2m(e['lat'], e['lon'])
       for e in json.load(open(os.path.join(ROOT, 'tools/data/osm_exits.json')))['elements']
       if 'lat' in e and e.get('tags', {}).get('ref')}
pairs = [(pdf_refs[r], osm[r], r) for r in pdf_refs if r in osm]


def fit(pairs):
    P = np.array([[p[0][0], p[0][1], 1] for p in pairs])
    Q = np.array([[p[1][0], p[1][1]] for p in pairs])
    A, *_ = np.linalg.lstsq(P, Q, rcond=None)
    err = np.hypot(*((P @ A) - Q).T)
    return A, err


A, err = fit(pairs)
keep = [p for p, e in zip(pairs, err) if e <= 15]
A, err = fit(keep)
print(f'出口照合 {len(pairs)}点 → 外れ値除去後 {len(keep)}点  残差 平均{err.mean():.1f}m 最大{err.max():.1f}m')


def to_m(x, y):
    v = np.array([x, y, 1]) @ A
    return [round(float(v[0]), 1), round(float(v[1]), 1)]


# --- 地図上の店番号(1〜3桁の数字) ---
map_nums = {}
for w in words:
    if w[1] < MAP_Y_MAX and re.fullmatch(r'\d{1,3}', w[4]):
        n = int(w[4])
        if 1 <= n <= 250:
            map_nums.setdefault(n, []).append(((w[0] + w[2]) / 2, (w[1] + w[3]) / 2))

# --- 凡例(番号 業種 店名)。行でグループ化 ---
legend = {}
rows = {}
for w in words:
    if w[1] < MAP_Y_MAX:
        continue
    key = (round(w[1] / 4), w[0] // 220)  # 行 y と列
    rows.setdefault(key, []).append(w)
for key, ws in rows.items():
    ws.sort(key=lambda w: w[0])
    if not re.fullmatch(r'\d{1,3}', ws[0][4]):
        continue
    n = int(ws[0][4])
    rest = [w[4] for w in ws[1:]]
    if not rest:
        continue
    category = rest[0]
    name = ' '.join(rest[1:]) if len(rest) > 1 else rest[0]
    legend[n] = {'category': category, 'name': name}

shops = []
for n, pts in sorted(map_nums.items()):
    if n not in legend:
        continue
    # 同じ番号が複数箇所にある場合は最初のもの(まれ)
    x, y = pts[0]
    shops.append({'no': n, 'name': legend[n]['name'], 'category': legend[n]['category'],
                  'pdf': [round(x, 1), round(y, 1)], 'm': to_m(x, y)})
print(f'凡例 {len(legend)}件 / 地図上の番号 {len(map_nums)}件 / 位置つき店 {len(shops)}件')

# --- テナントブロック(モール別のパステル色ポリゴン) ---
MALL_FILLS = {
    (0.84, 0.91, 0.73): 'プチシャン',
    (0.98, 0.84, 0.63): 'ノースモール1',
    (1.0, 0.95, 0.72): 'ノースモール2',
    (0.98, 0.86, 0.92): 'センターモール・サウスモール',
    (0.78, 0.78, 0.9): 'イーストモール',
    (0.79, 0.9, 0.84): 'ファルル',
    (0.98, 0.82, 0.73): 'mikke',
    (0.78, 0.85, 0.94): 'ポケットパーク',
    (0.86, 0.87, 0.87): 'その他',
}
from shapely.geometry import Polygon as _Poly
blocks = []
for d in page.get_drawings():
    r = d['rect']
    if r.y1 > MAP_Y_MAX or not d.get('fill'):
        continue
    key = tuple(round(c, 2) for c in d['fill'])
    if key not in MALL_FILLS:
        continue
    pts = []
    for item in d['items']:
        if item[0] == 'l':
            pts.append((item[1].x, item[1].y)); pts.append((item[2].x, item[2].y))
        elif item[0] == 'c':
            pts.append((item[1].x, item[1].y)); pts.append((item[4].x, item[4].y))
        elif item[0] == 're':
            rr = item[1]
            pts = [(rr.x0, rr.y0), (rr.x1, rr.y0), (rr.x1, rr.y1), (rr.x0, rr.y1)]
            break
    if len(pts) < 3:
        continue
    try:
        poly = _Poly(pts).buffer(0)
        if poly.is_empty or poly.area < 4:  # 4pt² ≈ 1.5m²未満はノイズ
            continue
        poly = poly.simplify(0.8)
        mpts = [to_m(x, y) for x, y in poly.exterior.coords[:-1]]
        if _Poly(mpts).area < 8:
            continue
        blocks.append({'mall': MALL_FILLS[key], 'm': [[round(a, 1), round(b, 1)] for a, b in mpts]})
    except Exception:
        continue
print(f'テナントブロック {len(blocks)}個')

json.dump({'source': 'whity_2016_labeled.pdf (2016-02-23現在)',
           'affine': A.tolist(), 'residual_mean_m': round(float(err.mean()), 1),
           'shops': shops, 'blocks': blocks}, open(OUT, 'w'), ensure_ascii=False, indent=1)
print('wrote', OUT)
