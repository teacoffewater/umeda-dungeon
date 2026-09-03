#!/usr/bin/env python3
"""施設の詳細地図データ(detail_<zone>.js)を生成する。gen_detail_whity.py の施設非依存版。

使い方: python3 tools/gen_detail.py <zone>        例: python3 tools/gen_detail.py dotica

入力: tools/data/detail/<zone>.json (ガイド座標系。フロアガイドの形そのまま・等方スケールでm換算・北が上・y は南向き正)
  {
    "source": "出典メモ",
    "outline_g": [[x,y], ...],                 床の外形(通路含む)。無ければ 区画∪通路 の閉包から作る
    "blocks":  [{"no": "12", "mall": "…", "g": [[x,y], ...]}, ...],   テナント区画
    "shops":   [{"name": "店名", "no": "12", "g": [x,y]}, ...],       資料上の店とその位置(区画番号の位置)
    "area_anchors": {"<shops.js のエリアID>": [x,y]},                 任意。名前一致ゼロのエリアの代表点を手で指定
    "close_r": 8.0                                                    任意。外形が無いときの閉包半径(m)
  }
  一本道の施設は tools/trace_linear.py で <zone>_spec.json からこの形式を作れる。

出力: detail_<zone>.js  ※すべてガイド座標系。実座標との位置合わせはしない(詳細地図は広域地図とは別物)
  - <ZONE>_FLOOR: 床の外形(通路含む)
  - <ZONE>_BLOCKS: テナント区画
  - <ZONE>_REAL_POS: 現在の店(shops.js)のうち資料と名前が一致した店のガイド上の位置 {店名: [gx,gy]}
  - <ZONE>_AREA_ANCHORS: shops.js のエリアIDごとの代表点(名前一致しない店を「エリアまで案内」する用)
  - <ZONE>_WALK: 歩行可能グリッド(床−区画)。ガイド内経路探索用
生成後は detail_maps.js の DETAIL_MAPS に登録する(origin は他施設と重ならない位置に)。
"""
import base64
import json
import os
import re
import sys
from shapely.geometry import Polygon, Point, MultiPolygon, LineString
from shapely.ops import unary_union, nearest_points
from shapely.prepared import prep

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def to_poly(pts):
    try:
        p = Polygon(pts).buffer(0)
        return None if p.is_empty else p
    except Exception:
        return None


def ring(r):
    return [[round(x, 1), round(y, 1)] for x, y in r.coords[:-1]]


def largest(geom):
    if isinstance(geom, MultiPolygon):
        return max(geom.geoms, key=lambda c: c.area)
    return geom


def norm(x):
    return re.sub(r'[ 　・]', '', x).lower()


def main(zone):
    src = os.path.join(ROOT, 'tools/data/detail', f'{zone}.json')
    d = json.load(open(src))
    close_r = float(d.get('close_r', 8.0))

    # --- 1) 区画 ---
    blocks = []
    for b in d['blocks']:
        p = to_poly(b['g'])
        if p is not None:
            blocks.append((b, p))
    print(f'区画 {len(blocks)}')

    # --- 2) 床 = 外形線があればそれ。無ければ 区画∪通路 を閉包(膨張→収縮)して通路の隙間を埋める ---
    if d.get('outline_g'):
        floor = Polygon(d['outline_g']).buffer(0)
        floor = largest(floor)
        faraway = [p for _, p in blocks if p.distance(floor) > 2]
        if faraway:  # 外形線の外に落ちた区画群は閉包で面にして結合
            pad = unary_union(faraway).buffer(5, join_style=2).buffer(-5, join_style=2)
            floor = unary_union([floor, pad]).buffer(0)
            print(f'外形線の外の区画 {len(faraway)}個を閉包で追加')
    else:
        parts = [p for _, p in blocks] + [to_poly(w) for w in d.get('walks', []) if to_poly(w)]
        floor = unary_union(parts).buffer(close_r, join_style=2).buffer(-close_r, join_style=2)
        print(f'外形線なし → 区画∪通路の閉包(±{close_r}m)で床を作成')
    if isinstance(floor, MultiPolygon):  # 離れていたら最近接点を通路帯でつなぐ
        comps = sorted(floor.geoms, key=lambda c: -c.area)
        while len(comps) > 1:
            main_c, rest = comps[0], comps[1:]
            dist, near = min((main_c.distance(c), c) for c in rest)
            p1, p2 = nearest_points(main_c, near)
            print(f'  分断成分を接続: 距離 {dist:.0f}m')
            comps = [unary_union([main_c, near, LineString([p1, p2]).buffer(4.0)])] + [c for c in rest if c is not near]
        floor = comps[0]
    floor = floor.simplify(0.3)
    floor_out = [{'pts': ring(floor.exterior), 'holes': [ring(h) for h in floor.interiors]}]
    print(f'床: 面積 {round(floor.area)}m² 頂点 {len(floor.exterior.coords)}')

    # --- 3) 区画出力(床から遠い迷子は捨てる) ---
    blocks_out = []
    for b, p in blocks:
        if p.distance(floor) <= 2:
            o = {'g': [[round(x, 1), round(y, 1)] for x, y in p.exterior.coords[:-1]]}
            for k in ('mall', 'no'):
                if b.get(k) is not None:
                    o[k] = b[k]
            blocks_out.append(o)
    print(f'床の上の区画 {len(blocks_out)}')

    # --- 4) 歩行可能グリッド(床−区画) ---
    walk_out = build_walk(floor, [p for _, p in blocks])

    # --- 5) 現在の店(shops.js)との名前照合 ---
    sh = open(os.path.join(ROOT, 'shops.js')).read()
    area_ids = re.findall(r"^\s*(\w+):\s*\{[^}]*zone:\s*'%s'" % re.escape(zone), sh, re.M)
    cur, area_of = [], {}
    # 通路型 s('店名', 'エリア', …) とホール型 g('店名', 'エリア', …) の両方。店名は ' でも " でも囲める
    for m in re.finditer(r"""[sg]\((['"])(.+?)\1, '(\w+)'""", sh):
        if m.group(3) in area_ids:
            cur.append(m.group(2))
            area_of[m.group(2)] = m.group(3)
    for m in re.finditer(r"\{\s*name:\s*'([^']+)'[^}]*zone:\s*'%s'" % re.escape(zone), sh):  # SHOPS_MANUAL
        cur.append(m.group(1))
        area_of[m.group(1)] = zone
    by_src = {norm(s['name']): s for s in d.get('shops', [])}
    real = {}
    for c in cur:
        k = norm(c)
        hit = by_src.get(k)
        if not hit:  # 安全な部分一致(4文字以上・片方向包含・候補が1つだけ)
            cands = [s for kk, s in by_src.items() if len(kk) >= 4 and (kk in k or k in kk)]
            hit = cands[0] if len(cands) == 1 else None
        if hit and Point(hit['g']).distance(floor) <= 10:
            real[c] = [round(hit['g'][0], 1), round(hit['g'][1], 1)]
    unmatched = [s['name'] for s in d.get('shops', []) if s['name'] not in real.values() and norm(s['name']) not in {norm(c) for c in real}]
    print(f'現在の店 {len(cur)}件(エリア {area_ids}) 中 実位置が付いた店 {len(real)}件')
    if len(cur) - len(real):
        print('  名前が一致しなかった現在の店:', [c for c in cur if c not in real][:15])
    if unmatched:
        print('  資料側で使われなかった店:', unmatched[:15])

    # --- 6) エリア代表点 ---
    area_pts = {}
    for name, g in real.items():
        area_pts.setdefault(area_of[name], []).append(g)
    area_anchors = {a: [round(sum(p[0] for p in ps) / len(ps), 1), round(sum(p[1] for p in ps) / len(ps), 1)]
                    for a, ps in area_pts.items()}
    for a, g in (d.get('area_anchors') or {}).items():
        area_anchors[a] = [round(g[0], 1), round(g[1], 1)]
    c = floor.centroid
    for a in area_ids:
        if a not in area_anchors:
            area_anchors[a] = [round(c.x, 1), round(c.y, 1)]
    print('エリア代表点:', area_anchors)

    up = zone.upper()
    out = os.path.join(ROOT, f'detail_{zone}.js')
    with open(out, 'w') as f:
        f.write(f'// 自動生成: tools/gen_detail.py {zone}({d.get("source", "")})。手編集しない\n')
        f.write('// 座標はすべて「ガイド座標系」(フロアガイドの形そのまま・等方スケールm換算。広域の実座標とは別物)\n')
        f.write('// FLOOR=床外形(通路含む) BLOCKS=テナント区画 REAL_POS=名前一致した現在店のガイド上の位置\n')
        f.write(f'export const {up}_FLOOR = ' + json.dumps(floor_out, separators=(',', ':')) + ';\n')
        f.write(f'export const {up}_WALK = ' + json.dumps(walk_out, separators=(',', ':')) + ';\n')
        f.write(f'export const {up}_AREA_ANCHORS = ' + json.dumps(area_anchors, ensure_ascii=False, separators=(',', ':')) + ';\n')
        f.write(f'export const {up}_BLOCKS = ' + json.dumps(blocks_out, ensure_ascii=False, separators=(',', ':')) + ';\n')
        f.write(f'export const {up}_REAL_POS = ' + json.dumps(real, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print(f'wrote {os.path.relpath(out, ROOT)}')


def build_walk(floor, block_polys, cell=1.5):
    """通路=床から区画を引いた部分を格子化。区画の角同士で「くびれ切断」される箇所は最近接点同士を帯で橋渡し。"""
    walkable = floor.buffer(0).difference(unary_union(block_polys)) if block_polys else floor.buffer(0)
    wcomps = [c for c in (list(walkable.geoms) if walkable.geom_type == 'MultiPolygon' else [walkable]) if c.area >= 50]
    if not wcomps:
        wcomps = [walkable]
    while len(wcomps) > 1:
        wcomps.sort(key=lambda c: c.area, reverse=True)
        main_c = wcomps[0]
        dist, near = min((main_c.distance(c), c) for c in wcomps[1:])
        p1, p2 = nearest_points(main_c, near)
        print(f'  通路成分を接続: 距離 {dist:.1f}m @({p1.x:.0f},{p1.y:.0f})')
        wcomps = [unary_union([main_c, near, LineString([p1, p2]).buffer(1.6)])] + [c for c in wcomps[1:] if c is not near]
    walkable = wcomps[0]
    minx, miny, maxx, maxy = floor.bounds
    W = int((maxx - minx) / cell) + 2
    H = int((maxy - miny) / cell) + 2
    pw = prep(walkable)
    grid = [[False] * W for _ in range(H)]
    for j in range(H):
        for i in range(W):
            grid[j][i] = pw.contains(Point(minx + (i + 0.5) * cell, miny + (j + 0.5) * cell))
    # 連結成分(8近傍)。1.5m格子で切れた成分は最近接セル対を直線で塗って接続
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
    cells_by = {}
    for j in range(H):
        for i in range(W):
            if grid[j][i]:
                cells_by.setdefault(comp[j][i], []).append((i, j))
    comp_ids = sorted(cells_by, key=lambda c: -len(cells_by[c]))
    merged = list(cells_by[comp_ids[0]]) if comp_ids else []
    for cid in comp_ids[1:]:
        if len(cells_by[cid]) < 3:
            continue
        other = cells_by[cid]
        bd, pair = 1e18, None
        for (ax, ay) in merged[::max(1, len(merged) // 1500)]:
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
    print(f'歩行グリッド {W}x{H} 歩行可 {kept}セル ({round(kept*cell*cell)}m²) 元成分 {len(sizes)}')
    return {'x0': round(minx, 1), 'y0': round(miny, 1), 'cell': cell, 'w': W, 'h': H,
            'bits': base64.b64encode(bytes(bits)).decode()}


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
