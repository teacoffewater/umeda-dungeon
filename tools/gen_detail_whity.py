#!/usr/bin/env python3
"""ホワイティ詳細データ(detail_whity.js)を生成する。

入力: tools/data/whity_2016.json (extract_whity_pdf.py の出力)
出力: detail_whity.js  ※すべて「ガイド座標系」(フロアガイドそのままの形・向き。等方スケールでm換算。
                        実座標との位置合わせはしない=詳細地図は広域地図とは別物)
  - WHITY_FLOOR: 床の外形(通路含む)。区画+白塗り片の結合を閉包(膨張→収縮)して
    「区画列の隙間=通路」を埋めたもの
  - WHITY_BLOCKS: テナントブロックの外形(飾り帯ノイズを除去したもの)
  - WHITY_REAL_POS: 現在の店(shops.js)のうち2016年版と名前が一致した店のガイド上の位置 {店名: [gx,gy]}
"""
import base64
import json, os, re
from shapely.geometry import Polygon, Point, MultiPolygon, LineString
from shapely.ops import unary_union, nearest_points
from shapely.prepared import prep

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(os.path.join(ROOT, 'tools/data/whity_2016.json')))

CLOSE_R = 8.0     # 閉包半径(m)。これ×2 までの通路幅の隙間が床として埋まる
MIN_COMP = 1200   # 床の連結成分の最小面積(m²)。小さな孤立片は捨てる


def to_poly(pts):
    try:
        p = Polygon(pts).buffer(0)
        return None if p.is_empty else p
    except Exception:
        return None


# --- 1) 飾り帯ノイズの除去: 細長すぎるブロック(路線図の帯・モール名バナー) ---
blocks = []
dropped = 0
for b in d['blocks']:
    p = to_poly(b['g'])
    if p is None:
        continue
    r = p.minimum_rotated_rectangle
    xs = list(r.exterior.coords)
    e1 = ((xs[1][0]-xs[0][0])**2 + (xs[1][1]-xs[0][1])**2) ** 0.5
    e2 = ((xs[2][0]-xs[1][0])**2 + (xs[2][1]-xs[1][1])**2) ** 0.5
    L, W = max(e1, e2), min(e1, e2)
    if L > 40 and W < 8:  # 40m超×8m未満の細帯は地図の飾り
        dropped += 1
        continue
    blocks.append((b, p))
print(f"ブロック {len(d['blocks'])} → 飾り帯除去後 {len(blocks)} (除去 {dropped})")

# --- 2) 床 = 閉包(ブロック ∪ 白塗り片) ---
walks = [w for w in (to_poly(w) for w in d.get('walks', [])) if w]
base = unary_union([p for _, p in blocks] + walks)
closed = base.buffer(CLOSE_R, join_style=2).buffer(-CLOSE_R, join_style=2)
comps = list(closed.geoms) if isinstance(closed, MultiPolygon) else [closed]
comps = [c for c in comps if c.area >= MIN_COMP]
# 店のない通路区間は地図上で塗られておらず成分が分断されることがある → 最近接点同士を通路幅の帯でつなぐ
while len(comps) > 1:
    comps.sort(key=lambda c: c.area, reverse=True)
    main = comps[0]
    dist, near = min((main.distance(c), c) for c in comps[1:])
    p1, p2 = nearest_points(main, near)
    print(f'分断成分を接続: 距離 {dist:.0f}m')
    bridge = LineString([p1, p2]).buffer(4.0)  # 幅8mの通路帯(丸端で両成分に食い込ませて確実に結合)
    comps = [unary_union([main, near, bridge])] + [c for c in comps[1:] if c is not near]
floor = unary_union(comps).simplify(0.8)
fl_list = list(floor.geoms) if isinstance(floor, MultiPolygon) else [floor]
print(f'床: 連結成分 {len(fl_list)} 面積 {round(floor.area)}m²')


def ring(r):
    return [[round(x, 1), round(y, 1)] for x, y in r.coords[:-1]]


floor_out = [{'pts': ring(c.exterior), 'holes': [ring(h) for h in c.interiors]} for c in fl_list]

# --- 3) ブロック出力(床から遠い迷子は捨てる。「その他」=非店舗区画も残す) ---
blocks_out = []
for b, p in blocks:
    if p.distance(floor) <= 2:
        blocks_out.append({'mall': b['mall'], 'g': [[round(x, 1), round(y, 1)] for x, y in p.exterior.coords[:-1]]})
print(f'床の上のブロック {len(blocks_out)}')

# --- 3.5) 歩行可能グリッド(床−区画)。ガイド内ルート探索用 ---
# 通路=床から区画を引いた部分。区画の角同士が接して通路が「くびれ切断」される箇所は
# (実際は繋がっているので)最近接点同士を幅2.5mの帯で橋渡しして繋ぐ
CELL = 1.5
walkable = floor.buffer(0).difference(unary_union([p for _, p in blocks]))
wcomps = [c for c in (list(walkable.geoms) if walkable.geom_type == 'MultiPolygon' else [walkable]) if c.area >= 50]
while len(wcomps) > 1:
    wcomps.sort(key=lambda c: c.area, reverse=True)
    main = wcomps[0]
    dist, near = min((main.distance(c), c) for c in wcomps[1:])
    p1, p2 = nearest_points(main, near)
    print(f'  通路成分を接続: 距離 {dist:.1f}m @({p1.x:.0f},{p1.y:.0f})')
    wcomps = [unary_union([main, near, LineString([p1, p2]).buffer(1.6)])] + [c for c in wcomps[1:] if c is not near]  # 幅3.2m(1.5mグリッドが確実に通る太さ)
walkable = wcomps[0]
minx, miny, maxx, maxy = floor.bounds
W = int((maxx - minx) / CELL) + 2
H = int((maxy - miny) / CELL) + 2
pw = prep(walkable)
grid = [[False] * W for _ in range(H)]
for j in range(H):
    for i in range(W):
        grid[j][i] = pw.contains(Point(minx + (i + 0.5) * CELL, miny + (j + 0.5) * CELL))
# 最大連結成分(8近傍)
comp = [[-1] * W for _ in range(H)]
sizes = []
for j in range(H):
    for i in range(W):
        if not grid[j][i] or comp[j][i] >= 0:
            continue
        cid = len(sizes)
        stack = [(i, j)]
        comp[j][i] = cid
        n = 0
        while stack:
            x, y = stack.pop()
            n += 1
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < W and 0 <= ny < H and grid[ny][nx] and comp[ny][nx] < 0:
                        comp[ny][nx] = cid
                        stack.append((nx, ny))
        sizes.append(n)
# ポリゴン上は連結でも1.5m格子では細い箇所で切れる。切れた成分は最近接セル対を直線で塗って接続
# (歩行ポリゴンは1成分なので、この接続は通路沿いの短い繋ぎにしかならない)
cells_by = {}
for j in range(H):
    for i in range(W):
        if grid[j][i]:
            cells_by.setdefault(comp[j][i], []).append((i, j))
comp_ids = sorted(cells_by, key=lambda c: -len(cells_by[c]))
merged = list(cells_by[comp_ids[0]])
for cid in comp_ids[1:]:
    if len(cells_by[cid]) < 3:  # 数セルの欠片は捨てる
        continue
    other = cells_by[cid]
    bd, pair = 1e18, None
    for (ax, ay) in merged[::max(1, len(merged) // 1500)]:  # 粗サンプルで近い候補
        for (bx, by) in other:
            dd = (ax - bx) ** 2 + (ay - by) ** 2
            if dd < bd:
                bd, pair = dd, ((ax, ay), (bx, by))
    (ax, ay), (bx, by) = pair
    steps = max(abs(ax - bx), abs(ay - by))
    added = []
    px, py = ax, ay
    for s in range(1, steps + 1):
        t = s / steps
        xi, yi = round(ax + (bx - ax) * t), round(ay + (by - ay) * t)
        # 4近傍で連結にする(斜めステップは中間セルを挟む。1セル幅の斜め鎖は角すり抜け禁止で通れない)
        for (qx, qy) in ([(xi, py)] if (xi != px and yi != py) else []) + [(xi, yi)]:
            if 0 <= qx < W and 0 <= qy < H and not grid[qy][qx]:
                grid[qy][qx] = True
                added.append((qx, qy))
        px, py = xi, yi
    merged.extend(other)
    merged.extend(added)
    if added:
        print(f'  格子の切れ目を接続: {len(added)}セル @({ax},{ay})→({bx},{by})')
bits = bytearray((W * H + 7) // 8)
kept = 0
for (i, j) in merged:
    k = j * W + i
    if not (bits[k // 8] >> (k % 8)) & 1:
        bits[k // 8] |= 1 << (k % 8)
        kept += 1
walk_out = {'x0': round(minx, 1), 'y0': round(miny, 1), 'cell': CELL, 'w': W, 'h': H,
            'bits': base64.b64encode(bytes(bits)).decode()}
print(f'歩行グリッド {W}x{H} 歩行可 {kept}セル ({round(kept*CELL*CELL)}m²) 元成分 {len(sizes)}(全接続済み)')

# --- 4) 現在の店との名前照合 ---
def norm(x):
    return re.sub(r'[ 　・]', '', x).lower()


by2016 = {}
for s in d['shops']:
    by2016[norm(s['name'])] = s
sh = open(os.path.join(ROOT, 'shops.js')).read()
cur = [m.group(1) for m in re.finditer(r"s\('([^']+)', 'whity_\w+'", sh)]
real = {}
for c in cur:
    k = norm(c)
    hit = by2016.get(k)
    if not hit:  # 安全な部分一致(4文字以上・片方向包含)
        cands = [s for kk, s in by2016.items() if len(kk) >= 4 and (kk in k or k in kk)]
        hit = cands[0] if len(cands) == 1 else None
    if hit and Point(hit['g']).distance(floor) <= 10:
        real[c] = hit['g']
print(f'現在のホワイティ店 {len(cur)}件中 実位置が付いた店 {len(real)}件')

with open(os.path.join(ROOT, 'detail_whity.js'), 'w') as f:
    f.write('// 自動生成: tools/gen_detail_whity.py(2016年公式フロアガイドPDF由来)。手編集しない\n')
    f.write('// 座標はすべて「ガイド座標系」(フロアガイドの形そのまま・等方スケールm換算。広域の実座標とは別物)\n')
    f.write('// FLOOR=床外形(通路含む) BLOCKS=テナント区画 REAL_POS=名前一致した現在店のガイド上の位置\n')
    f.write('export const WHITY_FLOOR = ' + json.dumps(floor_out, separators=(',', ':')) + ';\n')
    f.write('export const WHITY_WALK = ' + json.dumps(walk_out, separators=(',', ':')) + ';\n')
    f.write('export const WHITY_BLOCKS = ' + json.dumps(blocks_out, ensure_ascii=False, separators=(',', ':')) + ';\n')
    f.write('export const WHITY_REAL_POS = ' + json.dumps(real, ensure_ascii=False, separators=(',', ':')) + ';\n')
print('wrote detail_whity.js')
