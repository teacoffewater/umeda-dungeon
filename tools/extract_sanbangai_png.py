#!/usr/bin/env python3
"""阪急三番街の公式フロア図(PNG)から、館×階ごとの詳細地図データ(区画・通路)を起こす。

入力: tools/data/floorguides/sanbangai_{n,s}_{b1f,b2f}.png (公式サイトのフロアガイド画像)
      tools/data/detail/sanban_<館>_<階>_numbers.json (区画ポリゴン index → 区画番号。目視で作る。無ければ番号なしで出力)
出力: tools/data/detail/sanban_<館>_<階>.json (→ python3 tools/gen_detail.py sanban_<館>_<階>)
      tools/_debug/sanban_<館>_<階>_blocks.png (区画ポリゴンに index を振った確認画像。番号の対応付けに使う)

方法: 色で分類(区画=彩度の高い色タイル / 通路=建物内の白 / 壁・設備=灰 / 建物=桃色の下地)。
区画は連結成分ごとにポリゴン化。建物の外形は「桃色∪灰∪区画」の穴埋め。通路=外形∩白。
縮尺は shops.js の SHOP_AREAS の rect(館の実寸 m)を外形の幅・高さに当てる。ガイド座標系なので実座標とは位置合わせしない。
店名は shops.js の当該エリアの並び(区画番号の昇順)と、図に現れる番号の昇順を突合して付ける。
"""
import json
import os
import sys
import colorsys
from PIL import Image, ImageDraw
import numpy as np
from shapely.geometry import box, MultiPolygon, Polygon
from shapely.ops import unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONVERT = False
ASSIGN = False
# フロア図ごとの通路の描き方(白 / 明るい床 / 点柄)。extract 時に切り替える
CORRIDOR_MODE = {'sanban_n_b1': 'light', 'sanban_n_b2': 'plate', 'sanban_s_b1': 'white', 'sanban_s_b2': 'white'}
FLOORS = {  # key: (画像, shops.js のエリアID, 館の実寸[幅m, 奥行m])
    'sanban_n_b1': ('sanbangai_n_b1f.png', 'sanban_n_b1', (70.0, 42.0)),
    'sanban_n_b2': ('sanbangai_n_b2f.png', 'sanban_n_b2', (70.0, 42.0)),
    'sanban_s_b1': ('sanbangai_s_b1f.png', 'sanban_s_b1', (75.3, 49.9)),
    'sanban_s_b2': ('sanbangai_s_b2f.png', 'sanban_s_b2', (75.3, 49.9)),
}


def classify(a):
    """RGB配列 → (block, white, grey, peach) のマスク"""
    r, g, b = a[..., 0] / 255.0, a[..., 1] / 255.0, a[..., 2] / 255.0
    mx = np.maximum(np.maximum(r, g), b); mn = np.minimum(np.minimum(r, g), b)
    v = mx; s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    # 色相(0..360)
    h = np.zeros_like(mx)
    d = mx - mn
    m = d > 1e-6
    rr = np.where(m & (mx == r), ((g - b) / np.maximum(d, 1e-6)) % 6, 0)
    gg = np.where(m & (mx == g) & (mx != r), (b - r) / np.maximum(d, 1e-6) + 2, 0)
    bb = np.where(m & (mx == b) & (mx != r) & (mx != g), (r - g) / np.maximum(d, 1e-6) + 4, 0)
    h = (rr + gg + bb) * 60
    white = (s < 0.06) & (v > 0.92)
    grey = (s < 0.10) & (v > 0.45) & (v <= 0.92)
    peach = (s >= 0.06) & (s < 0.24) & (h > 10) & (h < 45) & (v > 0.85)
    block = ((s >= 0.24) | ((s >= 0.12) & ((h > 180) & (h < 320)))) & (v > 0.35) & ~peach
    return block, white, grey, peach


def fill_holes(mask):
    """画像の縁からの塗りつぶしで外側を求め、その補集合(=中身の穴埋め)を返す"""
    h, w = mask.shape
    outside = np.zeros_like(mask)
    stack = [(0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)] + [(0, x) for x in range(0, w, 8)] + [(h - 1, x) for x in range(0, w, 8)] + [(y, 0) for y in range(0, h, 8)] + [(y, w - 1) for y in range(0, h, 8)]
    for y, x in stack:
        if not mask[y, x]: outside[y, x] = True
    stack = [(y, x) for y, x in stack if outside[y, x]]
    while stack:
        y, x = stack.pop()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not mask[ny, nx] and not outside[ny, nx]:
                outside[ny, nx] = True; stack.append((ny, nx))
    return ~outside


def polys(mask, min_area, simplify=0.8):
    ys, xs = np.nonzero(mask)
    if len(xs) == 0: return []
    u = unary_union([box(x, y, x + 1, y + 1) for x, y in zip(xs, ys)])
    geoms = list(u.geoms) if isinstance(u, MultiPolygon) else [u]
    return [g.simplify(simplify) for g in geoms if g.area >= min_area]


def main(key):
    fname, area, (wm, dm) = FLOORS[key]
    im = Image.open(os.path.join(ROOT, 'tools/data/floorguides', fname)).convert('RGBA')
    bg = Image.new('RGBA', im.size, (255, 255, 255, 255)); im = Image.alpha_composite(bg, im).convert('RGB')  # 透明部は白(緑の透明色が区画に化けるのを防ぐ)
    a = np.asarray(im).astype(float)
    block, white, grey, peach = classify(a)
    # 区画: 彩度の高いタイル。文字(施設名の色文字)や小さなアイコンは面積・細長さで落とす
    blocks = [Polygon(g.exterior) for g in polys(block, 25, 0.6)]
    def slender(g):
        r = g.minimum_rotated_rectangle; xs = list(r.exterior.coords)
        e1 = ((xs[1][0]-xs[0][0])**2 + (xs[1][1]-xs[0][1])**2) ** 0.5; e2 = ((xs[2][0]-xs[1][0])**2 + (xs[2][1]-xs[1][1])**2) ** 0.5
        return max(e1, e2) / max(min(e1, e2), 0.1)
    # index を確認画像と一致させるため、ここでは落とさない(文字・ロゴは対応表の ignore で除く)
    numf = os.path.join(ROOT, 'tools/data/detail', f'{key}_numbers.json')
    numinfo = json.load(open(numf)) if os.path.exists(numf) else {}
    # 対応表は区画の重心(元画像px)で引く: {"blocks": [{"c": [x,y], "no": 12}, ...], "ignore": [[x,y], ...], "names": {番号: 店名}}
    # (旧形式 {"blocks": {index: no}, "ignore": [index]} は --convert で重心形式に変換する)
    cents = [(g.centroid.x, g.centroid.y) for g in blocks]
    def nearest_idx(c, tol=18):
        best, bd = None, tol
        for i, (x, y) in enumerate(cents):
            d = ((x - c[0]) ** 2 + (y - c[1]) ** 2) ** 0.5
            if d < bd: best, bd = i, d
        return best
    if isinstance(numinfo.get('blocks'), dict):  # 旧形式(index)
        numbers = {str(k): v for k, v in numinfo['blocks'].items()}
        ignore = set(numinfo.get('ignore', []))
        if CONVERT:
            numinfo = {'_note': numinfo.get('_note', ''), 'blocks': [{'c': [round(cents[int(k)][0], 1), round(cents[int(k)][1], 1)], 'no': v} for k, v in numbers.items()],
                       'ignore': [[round(cents[i][0], 1), round(cents[i][1], 1)] for i in ignore], 'names': numinfo.get('names', {})}
            json.dump(numinfo, open(numf, 'w'), ensure_ascii=False, indent=1); print(f'  {os.path.basename(numf)} を重心形式に変換')
    else:
        numbers, ignore = {}, set()
        # --assign: numpos(番号→図上の位置 px、目視で読む)を最寄りの区画重心に当てて blocks を作る
        if ASSIGN and numinfo.get('numpos'):
            made, bad = [], []
            for no, c in numinfo['numpos'].items():
                i = nearest_idx(c, tol=24)
                if i is None: bad.append(no); continue
                made.append({'c': [round(cents[i][0], 1), round(cents[i][1], 1)], 'no': int(str(no).split('/')[0])})
            numinfo['blocks'] = made
            # 番号の付かない小さな区画(色文字・アイコン)は自動で除外に回す。大きいものは空き区画として残す
            got = {nearest_idx(b['c']) for b in made}
            # 除外: 番号の付かない小さい区画(色文字・アイコン)、番号付き区画と同じ場所にある重複ポリゴン(番号バッジ等)
            def near_numbered(i):
                return any(((cents[i][0]-cents[j][0])**2 + (cents[i][1]-cents[j][1])**2) ** 0.5 < 8 for j in got if j is not None)
            auto_ig = [[round(cents[i][0], 1), round(cents[i][1], 1)] for i, g in enumerate(blocks) if i not in got and (g.area < 130 or near_numbered(i))]
            # 位置の食い違い(番号の位置と区画重心が離れている)は警告
            for b, (no, c) in zip(made, [(n, c) for n, c in numinfo['numpos'].items() if nearest_idx(c, tol=24) is not None]):
                dd = ((b['c'][0]-c[0])**2 + (b['c'][1]-c[1])**2) ** 0.5
                if dd > 14: print(f'  ? 番号 {no}: 位置 {c} と区画重心 {b["c"]} が {dd:.0f}px 離れている')
            numinfo['ignore'] = [c for c in numinfo.get('ignore_manual', [])] + auto_ig  # ignore_manual は手で指定した除外(凡例など)
            json.dump(numinfo, open(numf, 'w'), ensure_ascii=False, indent=1)
            print(f'  --assign: {len(made)} 区画に番号を付与' + (f' / 区画が見つからない番号: {bad}' if bad else ''))
        for b in numinfo.get('blocks', []):
            i = nearest_idx(b['c'])
            if i is None: print(f'  !! 番号 {b["no"]} の重心 {b["c"]} に区画が無い'); continue
            numbers[str(i)] = b['no']
        for c in numinfo.get('ignore', []):
            i = nearest_idx(c)
            if i is not None: ignore.add(i)
    # 通路: フロア図ごとに描き方が違う(CORRIDOR_MODE)。
    #   white: 白〜ごく薄い灰 / light: 明るい床全般 / plate: 建物の面全体(北館B2Fのフードホール。床の塗りで通路を区別しない図)
    bu = unary_union(blocks)
    mode = CORRIDOR_MODE.get(key, 'white')
    # 建物の敷地 = 「純白でない画素」を閉包した最大成分の外周(図ごとに下地の色が違うので色に依存しない)
    def box_sum(m, r):
        out = np.zeros(m.shape, int)
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                out += np.roll(np.roll(m, dy, 0), dx, 1)
        return out
    rr_, gg_, bb_ = a[..., 0] / 255.0, a[..., 1] / 255.0, a[..., 2] / 255.0
    mxx = np.maximum(np.maximum(rr_, gg_), bb_); mnn = np.minimum(np.minimum(rr_, gg_), bb_)
    content = ~((mxx > 0.97) & (mxx - mnn < 0.03))
    content = box_sum(content, 6) > 0; content = box_sum(~content, 6) == 0
    cp = polys(content, 2000, 1.0)
    pbig = max(cp, key=lambda g: g.area) if cp else None
    footprint = Polygon(pbig.exterior).buffer(2) if pbig is not None else None
    if mode == 'plate':
        # 建物の面全体を歩行可能とみなす(フードホール等、床の塗りで通路を区別しない図)。区画は gen_detail 側で床から引かれる
        corr = [Polygon(footprint.exterior)] if footprint is not None else []
    else:
        h2, w2 = a.shape[0] // 2, a.shape[1] // 2
        a2 = a[:h2*2, :w2*2].reshape(h2, 2, w2, 2, 3).mean(axis=(1, 3))
        b2, wh2, gr2, pe2 = classify(a2)
        r2, g2, bb2 = a2[..., 0] / 255.0, a2[..., 1] / 255.0, a2[..., 2] / 255.0
        mx2 = np.maximum(np.maximum(r2, g2), bb2); mn2 = np.minimum(np.minimum(r2, g2), bb2)
        s2 = np.where(mx2 > 0, (mx2 - mn2) / np.maximum(mx2, 1e-6), 0)
        vmin = 0.78 if mode == 'light' else 0.9
        light = (s2 < 0.12) & (mx2 > vmin) & ~b2 & ~pe2
        corr = [Polygon([(x * 2, y * 2) for x, y in g.exterior.coords]) for g in polys(light, 15, 0.6)]
    # 図の外側の余白は画像の縁に触れる成分として除く。区画から離れた白も除く
    H_, W_ = a.shape[0], a.shape[1]
    def touches_border(g):
        x0, y0, x1, y1 = g.bounds
        return x0 <= 1 or y0 <= 1 or x1 >= W_ - 2 or y1 >= H_ - 2
    corr = [g for g in corr if g.is_valid and g.distance(bu) < 25]
    if footprint is not None:  # 敷地の外(図の余白・出口の矢印)へ漏れた分は切り落とす
        clipped = []
        for g in corr:
            c = g.intersection(footprint)
            for cc in (list(c.geoms) if c.geom_type == 'MultiPolygon' else [c]):
                if cc.geom_type == 'Polygon' and cc.area > 15: clipped.append(Polygon(cc.exterior))
        corr = clipped
    # cuts: 床から除く矩形(元画像px [x0,y0,x1,y1])。凡例の囲み・図の外の駅ブロックなど、色では分けられないもの
    cuts = [box(*c) for c in numinfo.get('cuts', [])]
    if cuts:
        cu = unary_union(cuts)
        corr = [Polygon(g.exterior) for g in (list(x.geoms) if x.geom_type == 'MultiPolygon' else [x]) for x in [gg.difference(cu) for gg in corr] if not x.is_empty and g.geom_type == 'Polygon' and g.area > 15] if False else [
            Polygon(cc.exterior) for gg in corr for x in [gg.difference(cu)] for cc in (list(x.geoms) if x.geom_type == 'MultiPolygon' else [x]) if cc.geom_type == 'Polygon' and cc.area > 15]
        ignore |= {i for i, g in enumerate(blocks) if cu.contains(g.centroid)}
    walk = corr
    floor = unary_union(walk + [g for i, g in enumerate(blocks) if i not in ignore]).buffer(3.0, join_style=2).buffer(-3.0, join_style=2)
    if floor.geom_type == 'MultiPolygon': floor = max(floor.geoms, key=lambda g: g.area)
    body_poly = floor
    print(f'[{key}] 区画 {len(blocks)}(除外 {len(ignore)}) 通路成分 {len(corr)}')

    # 縮尺: 建物の下地(桃色)の最大成分の bbox を館の実寸に当てる(床の検出精度に左右されない)
    minx, miny, maxx, maxy = (pbig if pbig is not None else body_poly).bounds
    sx = wm / (maxx - minx); sy = dm / (maxy - miny)
    G = lambda pts: [[round((x - minx) * sx, 1), round((y - miny) * sy, 1)] for x, y in pts]
    # 番号の対応表(目視で作る): {"blocks": {index: 番号}, "ignore": [index...], "names": {番号: 店名}}
    # names が無ければ shops.js のエリアの並び(区画番号の昇順)と図の番号の昇順を突合
    import re
    sh = open(os.path.join(ROOT, 'shops.js')).read()
    names = [m.group(2) for m in re.finditer(r"""[sg]\((['"])(.+?)\1, '%s'""" % area, sh)]
    if numinfo.get('names'):
        num2name = {int(k): v for k, v in numinfo['names'].items()}
    else:
        nums_sorted = sorted({int(v) for v in numbers.values()})
        num2name = dict(zip(nums_sorted, names))
        if numbers and len(nums_sorted) != len(names):
            print(f'  !! 図の番号 {len(nums_sorted)}種 と shops.js の店 {len(names)}件 が一致しない(突合がずれる可能性)')
    missing = [n for n in num2name.values() if n not in names]
    if missing: print(f'  shops.js に無い店(追加が必要): {missing}')
    blocks_out, shops_out = [], {}
    for i, g in enumerate(blocks):
        if i in ignore: continue
        no = numbers.get(str(i))
        o = {'g': G(g.exterior.coords[:-1]), 'mall': key}
        if no is not None: o['no'] = str(no)
        blocks_out.append(o)
        if no is not None and int(no) in num2name:
            nm = num2name[int(no)]
            c = g.centroid
            shops_out.setdefault(nm, []).append((c.x, c.y))
    shops = []
    for nm, cs in shops_out.items():  # 同じ店が複数区画なら重心の平均
        cx = sum(c[0] for c in cs) / len(cs); cy = sum(c[1] for c in cs) / len(cs)
        shops.append({'name': nm, 'g': G([(cx, cy)])[0]})
    out = {
        'source': f'阪急三番街 公式フロアガイド {fname} + 館内案内板(2026-09-03)。縮尺は館の実寸 {wm}x{dm}m',
        'outline_g': G(floor.exterior.coords[:-1]),
        'blocks': blocks_out, 'shops': shops, 'area_anchors': {}, 'areas': [area],
    }
    json.dump(out, open(os.path.join(ROOT, 'tools/data/detail', f'{key}.json'), 'w'), ensure_ascii=False, indent=1)
    unnum = [(i, round(g.centroid.x), round(g.centroid.y), round(g.area)) for i, g in enumerate(blocks) if i not in ignore and str(i) not in numbers]
    if unnum: print(f'  番号なしの区画 {len(unnum)}: ' + ' '.join(f'#{i}@({x},{y})a{a}' for i, x, y, a in unnum[:40]))
    print(f'  床 {round(floor.area * sx * sy)}m² 頂点 {len(out["outline_g"])} / 区画 {len(blocks_out)} / 番号付き {sum(1 for b in blocks_out if "no" in b)} / 店 {len(shops)}')

    # 確認画像: 区画に index、通路を青、床を緑
    dbg = Image.fromarray((a * 0.55).astype(np.uint8)); dr = ImageDraw.Draw(dbg)
    for g in walk: dr.polygon(list(g.exterior.coords), outline=(90, 160, 255))
    dr.polygon(list(floor.exterior.coords), outline=(0, 230, 90))
    for i, g in enumerate(blocks):
        dr.polygon(list(g.exterior.coords), outline=(120, 120, 120) if i in ignore else (255, 90, 90))
        c = g.centroid; lab = f'{i}' + (f':{numbers[str(i)]}' if str(i) in numbers else '')
        dr.rectangle([c.x - 3 * len(lab) - 1, c.y - 6, c.x + 3 * len(lab) + 1, c.y + 6], fill=(0, 0, 0))
        dr.text((c.x - 3 * len(lab), c.y - 6), lab, fill=(255, 255, 80))
    os.makedirs(os.path.join(ROOT, 'tools/_debug'), exist_ok=True)
    dbg = dbg.resize((dbg.width * 2, dbg.height * 2), Image.NEAREST)
    dbg.save(os.path.join(ROOT, 'tools/_debug', f'{key}_blocks.png'))


if __name__ == '__main__':
    CONVERT = '--convert' in sys.argv
    ASSIGN = '--assign' in sys.argv
    keys = [k for k in sys.argv[1:] if not k.startswith('--')] or list(FLOORS)
    for k in keys: main(k)
