#!/usr/bin/env python3
"""一本道の地下街(ドーチカ等)の詳細地図データを「軸＋区画の並び」から作る。

フロアマップの画像をピクセルでなぞる代わりに、通路の軸と区画の表(番号・側・幅・奥行)から
区画ポリゴンと床外形を生成する。出力は tools/gen_detail.py の入力形式。

使い方: python3 tools/trace_linear.py <zone>
入力: tools/data/detail/<zone>_spec.json (ガイド座標系: m、北が上、y は南向き正)
  {
    "source": "出典メモ",
    "axis": [[x,y], [x,y], ...],     通路の中心線(折れ線)。並びの起点は先頭
    "width": 6.0,                    通路幅(m)
    "blocks": [                      並び順に置く。side ごとに起点からの距離を独立に進める
      {"no": "1", "side": "W", "len": 6, "depth": 8, "name": "三菱UFJ銀行ATM"},
      {"no": "2", "side": "E", "len": 8, "depth": 8, "name": "新梅田コクミン薬局", "gap": 3},   gap: 手前の空き(m)
      {"side": "E", "len": 10, "depth": 8, "mall": "通路"},                                        name 無し = 空き区画/設備
      ...
    ],
    "extras": [{"g": [[x,y], ...], "mall": "広場", "name": "…"}],   任意。手で置く多角形(広場など)
    "walks":  [[[x,y], ...]]                                          任意。通路として床に含める多角形
  }
  side は方角(E/W/N/S)。軸の進行方向に対してその方角側に区画を置く。

出力: tools/data/detail/<zone>.json  → python3 tools/gen_detail.py <zone>
"""
import json
import math
import os
import sys
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMPASS = {'E': (1, 0), 'W': (-1, 0), 'N': (0, -1), 'S': (0, 1)}


def main(zone):
    spec_path = os.path.join(ROOT, 'tools/data/detail', f'{zone}_spec.json')
    spec = json.load(open(spec_path))
    axis = LineString(spec['axis'])
    width = float(spec.get('width', 6.0))
    half = width / 2

    def frame(s):  # 軸上の距離 s の点と単位進行方向
        s = max(0.0, min(axis.length, s))
        p = axis.interpolate(s)
        a = axis.interpolate(max(0.0, s - 0.5))
        b = axis.interpolate(min(axis.length, s + 0.5))
        dx, dy = b.x - a.x, b.y - a.y
        n = math.hypot(dx, dy) or 1.0
        return (p.x, p.y), (dx / n, dy / n)

    def side_normal(d, side):  # 進行方向 d に直交する単位ベクトルのうち、方角 side に向く方
        cands = [(-d[1], d[0]), (d[1], -d[0])]
        cx, cy = COMPASS[side]
        return max(cands, key=lambda v: v[0] * cx + v[1] * cy)

    pos = {}  # side → 起点からの距離
    blocks, shops = [], []
    walks = list(spec.get('walks', []))
    for b in spec['blocks']:
        side = b['side']
        # at: 起点からの絶対距離(m)。資料の画像から読んだ位置を直接置くときに使う(無ければ並び順に詰める)
        s0 = float(b['at']) if 'at' in b else pos.get(side, 0.0) + float(b.get('gap', 0))
        s1 = s0 + float(b['len'])
        pos[side] = max(pos.get(side, 0.0), s1)
        depth = float(b.get('depth', 8))
        off = float(b.get('off', 0))  # 通路の縁からの後退(m)。奥に並ぶ区画(前に浅い区画がある)に使う
        (p0, d0) = frame(s0)
        (p1, d1) = frame(s1)
        n0, n1 = side_normal(d0, side), side_normal(d1, side)
        corners = [
            (p0[0] + n0[0] * (half + off), p0[1] + n0[1] * (half + off)),
            (p1[0] + n1[0] * (half + off), p1[1] + n1[1] * (half + off)),
            (p1[0] + n1[0] * (half + off + depth), p1[1] + n1[1] * (half + off + depth)),
            (p0[0] + n0[0] * (half + off + depth), p0[1] + n0[1] * (half + off + depth)),
        ]
        poly = Polygon(corners)
        if not poly.is_valid or poly.area < 1:
            print(f'  区画 {b.get("no")} をスキップ(形が不正)')
            continue
        g = [[round(x, 1), round(y, 1)] for x, y in corners]
        if b.get('walk'):  # 出入口・接続通路: 区画ではなく歩ける床として足す
            walks.append(g)
            continue
        out = {'g': g, 'mall': b.get('mall', zone)}
        if b.get('no') is not None:
            out['no'] = str(b['no'])
        blocks.append(out)
        if b.get('name'):
            c = poly.centroid
            shops.append({'name': b['name'], 'no': str(b.get('no', '')), 'g': [round(c.x, 1), round(c.y, 1)]})
    for e in spec.get('extras', []):
        blocks.append({'g': e['g'], 'mall': e.get('mall', zone), **({'no': str(e['no'])} if e.get('no') is not None else {})})
        if e.get('name'):
            c = Polygon(e['g']).centroid
            shops.append({'name': e['name'], 'no': str(e.get('no', '')), 'g': [round(c.x, 1), round(c.y, 1)]})

    # 床 = 通路の帯 ∪ 区画 ∪ 追加通路。角の隙間を少し閉じる
    corridor = axis.buffer(half, cap_style=2, join_style=2)
    parts = [corridor] + [Polygon(b['g']) for b in blocks] + [Polygon(w) for w in walks]
    floor = unary_union(parts).buffer(1.0, join_style=2).buffer(-1.0, join_style=2).simplify(0.2)
    if floor.geom_type == 'MultiPolygon':
        floor = max(floor.geoms, key=lambda c: c.area)
    outline = [[round(x, 1), round(y, 1)] for x, y in floor.exterior.coords[:-1]]

    out = {
        'source': spec.get('source', ''),
        'outline_g': outline,
        'blocks': blocks,
        'shops': shops,
        'walks': walks,
        'area_anchors': spec.get('area_anchors', {}),
    }
    dst = os.path.join(ROOT, 'tools/data/detail', f'{zone}.json')
    json.dump(out, open(dst, 'w'), ensure_ascii=False, indent=1)
    print(f'軸 {axis.length:.0f}m 幅 {width}m / 区画 {len(blocks)} 店 {len(shops)} / 床 {round(floor.area)}m² 頂点 {len(outline)}')
    print(f'側ごとの並び長:', {k: round(v, 1) for k, v in pos.items()})
    print(f'wrote {os.path.relpath(dst, ROOT)}')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
