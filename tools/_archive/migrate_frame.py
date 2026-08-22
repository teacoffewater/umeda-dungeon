"""旧座標(FC2案内図px + 歪みアフィン) → metric-v1(メートル格子) への一括移行。1回きり。

使い方: python3 tools/migrate_frame.py [--dry]
  main.js / shops.js / tools/gen_polys.py / tools/validate_map.py の座標リテラルを書き換える。
  FLOOR_POLYS は書き換えない(gen_polys.py で再生成する)。
  ブロックごとに置換件数を表示する。想定外の形式は例外で止める。
"""
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRY = '--dry' in sys.argv

# --- 旧アフィン(lat/lon→旧px)。tools/gen_polys.py 等にあったもの ---
MX = [0.9016776456322585, 0.029513667767732826, 843.3902886095399]
MY = [0.03970669489516974, -1.1219829189908253, 944.3469058365063]
DET = MX[0] * MY[1] - MX[1] * MY[0]
# --- 新フレーム(metric-v1): 平行移動は旧アフィンの項を踏襲 ---
OX, OY = 843.39, 944.35
# 旧px 1単位あたりの実距離(m): x列・y列のノルムの逆数
SX = 1 / math.hypot(MX[0], MY[0])   # ≒1.108
SY = 1 / math.hypot(MX[1], MY[1])   # ≒0.891


def old2new(px, py):
    ux, uy = px - MX[2], py - MY[2]
    xm = (ux * MY[1] - MX[1] * uy) / DET    # 東向きm
    ym = (MX[0] * uy - ux * MY[0]) / DET    # 北向きm
    return xm + OX, -ym + OY


def vec(vx, vy):
    """方向ベクトル(平行移動なし)"""
    xm = (vx * MY[1] - MX[1] * vy) / DET
    ym = (MX[0] * vy - vx * MY[0]) / DET
    return xm, -ym


def f1(v):
    s = f'{v:.1f}'
    return s[:-2] if s.endswith('.0') else s


NUM = r'-?\d+(?:\.\d+)?'
stats = {}


def count(key, n=1):
    stats[key] = stats.get(key, 0) + n


def pair_sub(line, key):
    """[x, y] をすべて変換"""
    def rep(m):
        x, y = old2new(float(m.group(1)), float(m.group(2)))
        count(key)
        return f'[{f1(x)}, {f1(y)}]'
    return re.sub(rf'\[\s*({NUM}),\s*({NUM})\s*\]', rep, line)


def mxmy_sub(line, key):
    def rep(m):
        x, y = old2new(float(m.group(1)), float(m.group(2)))
        count(key)
        return f'mx: {f1(x)}, my: {f1(y)}'
    return re.sub(rf'mx:\s*({NUM}),\s*my:\s*({NUM})', rep, line)


def dir_sub(line, key):
    def rep(m):
        x, y = vec(float(m.group(1)), float(m.group(2)))
        count(key)
        return f'dir: [{f1(x)}, {f1(y)}]'
    return re.sub(rf'dir:\s*\[\s*({NUM}),\s*({NUM})\s*\]', rep, line)


def block(lines, start_pat, end_pat, fn, key):
    """start_pat を含む行から end_pat を含む行(同行含む)までに fn を適用"""
    out, inside, found = [], False, False
    for ln in lines:
        if not inside and re.search(start_pat, ln):
            inside, found = True, True
        if inside:
            ln = fn(ln, key)
            if re.search(end_pat, ln):
                inside = False
        out.append(ln)
    assert found, f'ブロックが見つからない: {start_pat}'
    return out


def migrate_main():
    p = os.path.join(ROOT, 'main.js')
    L = open(p).read().split('\n')
    # ZONES label
    L = block(L, r'^const ZONES = \{', r'^\};', pair_sub, 'ZONES.label')

    # NODES: S('id','name','fl', x, y) / P(..., x, y, 'zone') / J('id', x, y[, 'fl'])
    def nodes(ln, key):
        def repS(m):
            x, y = old2new(float(m.group(2)), float(m.group(3))); count(key)
            return f'{m.group(1)}{f1(x)}, {f1(y)}'
        ln = re.sub(rf"((?:S|P)\('\w+',\s*'[^']*',\s*'(?:S1|B1|B2)',\s*)({NUM}),\s*({NUM})", repS, ln)
        ln = re.sub(rf"(J\('\w+',\s*)({NUM}),\s*({NUM})", repS, ln)
        return ln
    L = block(L, r'^const NODES = \[', r'^\];', nodes, 'NODES')
    L = block(L, r'^const VERTICALS = \[', r'^\];', mxmy_sub, 'VERTICALS.mxmy')
    L = block(L, r'^const RAIL_LINES = \[', r'^\];', pair_sub, 'RAIL_LINES.pts')

    def platforms(ln, key):
        return dir_sub(mxmy_sub(ln, key), key + '.dir')
    L = block(L, r'^const PLATFORMS = \[', r'^\];', platforms, 'PLATFORMS')
    L = block(L, r'^const PLAZAS = \[', r'^\];', mxmy_sub, 'PLAZAS')

    # 地上: GROUND_BUILDINGS(poly) / FILLER(5つ組) / スカイビル / JR駅 / 高架 / ラベル
    def ground(ln, key):
        s = ln.lstrip()
        if re.search(r'\bpoly:\s*\[\[|\bpts:\s*\[\[|const (DECK|STA_MAIN|STA_WEST|C) = \[|M2W\(\[' + NUM, ln):
            return pair_sub(ln, key + '.pts')
        if re.match(rf'\[{NUM}, {NUM}, {NUM}, {NUM}, {NUM}\]', s):  # FILLER: [x1,y1,x2,y2,h]
            def rep(m):
                x1, y1, x2, y2, h = m.groups()
                pts = [old2new(float(a), float(b)) for a, b in ((x1, y1), (x2, y1), (x2, y2), (x1, y2))]
                xs, ys = [q[0] for q in pts], [q[1] for q in pts]
                count(key + '.filler')
                return f'[{f1(min(xs))}, {f1(min(ys))}, {f1(max(xs))}, {f1(max(ys))}, {h}]'
            return re.sub(rf'\[({NUM}), ({NUM}), ({NUM}), ({NUM}), ({NUM})\]', rep, ln)
        if re.match(rf'\[{NUM}, {NUM}, {NUM}\],?', s):  # VIADUCT: [x, y, halfwidth]
            def rep(m):
                x, y = old2new(float(m.group(1)), float(m.group(2))); count(key + '.viaduct')
                return f'[{f1(x)}, {f1(y)}, {m.group(3)}]'
            return re.sub(rf'\[({NUM}), ({NUM}), ({NUM})\]', rep, ln)
        m = re.search(rf"addBldgLabel\('([^']+)',\s*({NUM}),\s*({NUM}),", ln)
        if m:
            x, y = old2new(float(m.group(2)), float(m.group(3))); count(key + '.label')
            return ln[:m.start()] + f"addBldgLabel('{m.group(1)}', {f1(x)}, {f1(y)}," + ln[m.end():]
        m = re.search(rf'const TH = ({NUM}) \* Math\.PI / 180;', ln)
        if m:  # JR駅の大屋根の向き: 旧フレームの角度 → 新フレームの角度
            th = math.radians(float(m.group(1)))
            vx, vy = vec(math.cos(th), math.sin(th))
            count(key + '.TH')
            return ln.replace(m.group(0), f'const TH = {math.degrees(math.atan2(vy, vx)):.1f} * Math.PI / 180;')
        return ln
    L = block(L, r'const GROUND_BUILDINGS = \[', r'const deckTop = GROUND_Y', ground, 'GROUND')

    # コメント・定数の更新
    src = '\n'.join(L)
    src = src.replace("// 参考: https://umedachikagai.web.fc2.com/ の案内地図をトレースした概略座標\n// mx,my は地図画像(1350x1910px)上のピクセル座標。x:東+ / z:南+",
                      "// mx,my = 原点からの東向き・南向きのメートル(北が上、小数可)。緯度経度との変換は geo.js(metric-v1)\n// x:東+ / z:南+")
    src = src.replace("const UNIT_M = 2.1;              // 1 world unit ≈ 2.1m（地図1px ≈ 1.05m）",
                      "const UNIT_M = 2.0;              // 1 world unit = 2m(M2Wの係数0.5の逆数)")
    assert 'const UNIT_M = 2.0' in src and 'metric-v1' in src
    write(p, src)


def migrate_shops():
    p = os.path.join(ROOT, 'shops.js')
    L = open(p).read().split('\n')

    def areas(ln, key):
        def rect(m):
            cx, cy = old2new(float(m.group(1)), float(m.group(2)))
            w, d = float(m.group(3)) * SX, float(m.group(4)) * SY
            count(key + '.rect')
            return f'rect: [{f1(cx)}, {f1(cy)}, {f1(w)}, {f1(d)}]'
        ln = re.sub(rf'rect:\s*\[({NUM}),\s*({NUM}),\s*({NUM}),\s*({NUM})\]', rect, ln)
        if 'path:' in ln:
            ln = pair_sub(ln, key + '.path')
        return ln
    L = block(L, r'^export const SHOP_AREAS = \{', r'^\};', areas, 'SHOP_AREAS')
    src = '\n'.join(L).replace('rect=[中心mx, 中心my, 幅, 奥行] map px', 'rect=[中心mx, 中心my, 幅, 奥行] メートル')
    write(p, src)


def migrate_gen_polys():
    p = os.path.join(ROOT, 'tools', 'gen_polys.py')
    L = open(p).read().split('\n')
    L = block(L, r'^HAND_PLATES = \[', r'^\]', pair_sub, 'gen_polys.HAND_PLATES')

    def discs(ln, key):
        def rep(m):
            x, y = old2new(float(m.group(3)), float(m.group(4))); count(key)
            return f"('{m.group(1)}', '{m.group(2)}', {f1(x)}, {f1(y)}, {m.group(5)})"
        return re.sub(rf"\('(S1|B1|B2)', '(\w+)', ({NUM}), ({NUM}), ({NUM})\)", rep, ln)
    L = block(L, r'^DISCS = \[', r'\]$', discs, 'gen_polys.DISCS')
    write(p, '\n'.join(L))


def migrate_validate():
    p = os.path.join(ROOT, 'tools', 'validate_map.py')
    L = open(p).read().split('\n')

    def reg(ln, key):
        def rep(m):
            x, y = old2new(float(m.group(1)), float(m.group(2))); count(key)
            return f"({f1(x)}, {f1(y)}, '"
        return re.sub(rf"\(({NUM}), ({NUM}), '", rep, ln)
    L = block(L, r'^ISLAND_REGISTRY = \{', r'^\}', reg, 'validate.ISLAND_REGISTRY')
    write(p, '\n'.join(L))


def write(p, src):
    if DRY:
        print('(dry) would write', os.path.relpath(p, ROOT))
    else:
        open(p, 'w').write(src)


if __name__ == '__main__':
    print(f'scale old px→m: x {SX:.3f}, y {SY:.3f}; rotation {math.degrees(math.atan2(*vec(0, 1)[::-1]) - math.pi/2):+.2f}°')
    migrate_main(); migrate_shops(); migrate_gen_polys(); migrate_validate()
    for k, v in sorted(stats.items()):
        print(f'{v:5d}  {k}')
    print('dry run' if DRY else 'done')
