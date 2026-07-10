#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""編集シート(単一SVG)を生成: 三番街・ホワイティの床+道+下敷き+公式マップ。
Illustratorで開くことを最優先:
  - xlink:hrefのみ(href二重指定はしない) / XML宣言あり / id=日本語の分かる名前
  - トップレベル<g>=レイヤー相当(施設ごと)。サブ<g>で床/道/点を分ける
座標系は元地図px(mx,my 1350x1910)。下敷きはピクセル一致。
出力: 編集シート_三番街_ホワイティ.svg
"""
import re, os, base64, io
from PIL import Image

UD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = open(f'{UD}/main.js', encoding='utf-8').read()
LINES = SRC.split('\n')

AX0, AY0, AX1, AY1 = 853, 350, 1304, 1054   # 編集対象領域(地図px)
AW, AH = AX1 - AX0, AY1 - AY0

# ---------- パース ----------
def coords(s):
    return [(float(a), float(b)) for a, b in re.findall(r'\[([0-9.]+),\s*([0-9.]+)\]', s)]

def parse_poly(ln):
    l = LINES[ln - 1]
    body = l[l.index('pts:'):]
    outer = coords(re.search(r'pts:\s*(\[\[.*?\]\])\s*(?:,\s*holes|\}|,\s*covers)', body).group(1))
    holes = []
    hm = re.search(r'holes:\s*(\[.*\])\s*,\s*covers', body) or re.search(r'holes:\s*(\[.*\])\s*\}', body)
    if hm:
        t = hm.group(1); depth = 0; cur = ''; rings = []
        for ch in t[1:-1]:
            if ch == '[':
                depth += 1
                if depth == 1: cur = ''
            if depth >= 1: cur += ch
            if ch == ']':
                depth -= 1
                if depth == 0: rings.append(cur)
        holes = [coords(r) for r in rings]
    return outer, holes

def parse_graph():
    coord, floor, typ, nm, zone = {}, {}, {}, {}, {}
    for m in re.finditer(r"S\('([^']+)',\s*'([^']*)',\s*'([^']*)',\s*([0-9.]+),\s*([0-9.]+)\)", SRC):
        i = m.group(1); coord[i] = (float(m.group(4)), float(m.group(5))); floor[i] = m.group(3); typ[i] = 'station'; nm[i] = m.group(2); zone[i] = ''
    for m in re.finditer(r"P\('([^']+)',\s*'([^']*)',\s*'([^']*)',\s*([0-9.]+),\s*([0-9.]+),\s*'([^']+)'\)", SRC):
        i = m.group(1); coord[i] = (float(m.group(4)), float(m.group(5))); floor[i] = m.group(3); typ[i] = 'spot'; nm[i] = m.group(2); zone[i] = m.group(6)
    for m in re.finditer(r"J\('([^']+)',\s*([0-9.]+),\s*([0-9.]+)(?:,\s*'([^']+)')?\)", SRC):
        i = m.group(1); coord[i] = (float(m.group(2)), float(m.group(3))); floor[i] = m.group(4) or 'B1'; typ[i] = 'junction'; nm[i] = ''; zone[i] = ''
    eb = re.search(r'const EDGES = \[(.*?)\n\];', SRC, re.S).group(1)
    edges = []
    for m in re.finditer(r"\['([^']+)',\s*'([^']+)',\s*[0-9.]+(?:,\s*'([^']+)')?\]", eb):
        edges.append((m.group(1), m.group(2), m.group(3) or ''))
    verts = []
    vb = re.search(r'const VERTICALS = \[(.*?)\n\];', SRC, re.S).group(1)
    for m in re.finditer(r"\{\s*type:\s*'(\w+)',\s*a:\s*'([^']+)',\s*b:\s*'([^']+)',\s*mx:\s*([0-9.]+),\s*my:\s*([0-9.]+),\s*name:\s*'([^']*)'", vb):
        verts.append((m.group(1), m.group(2), m.group(3), float(m.group(4)), float(m.group(5)), m.group(6)))
    return coord, floor, typ, nm, zone, edges, verts

def b64(im):
    buf = io.BytesIO(); im.save(buf, 'PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()

def path_d(r):
    return 'M ' + ' L '.join(f'{x:.1f},{y:.1f}' for x, y in r) + ' Z'

def esc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

# ---------- データ組み立て ----------
FLOORS = {  # 行番号: (レイヤー内名, 施設, 色)
    325: ('床_北館B1F_浅層', '三番街', '#e0913f'),
    326: ('床_北館北_浅層', '三番街', '#e0913f'),
    367: ('床_B2F_中枢層', '三番街', '#c9761f'),
    347: ('床_中枢層', 'ホワイティ', '#d97f9f'),
}
LAYNAME = {'S1': '浅層', 'B1': '中枢層', 'B2': '深層'}
coord, floorOf, typOf, nameOf, zoneOf, EDGES, VERTS = parse_graph()

def inbox(i):
    if i not in coord: return False
    x, y = coord[i]; return AX0 <= x <= AX1 and AY0 <= y <= AY1

def fac_of_edge(a, b, z):
    if z == 'sanban': return '三番街'
    if z == 'whity': return 'ホワイティ'
    za, zb = zoneOf.get(a, ''), zoneOf.get(b, '')
    if za == zb == 'sanban': return '三番街'
    if za == zb == 'whity': return 'ホワイティ'
    return '周辺'

area_edges = [(a, b, z) for a, b, z in EDGES if inbox(a) and inbox(b)]
touched = set()
for a, b, _ in area_edges: touched.add(a); touched.add(b)

def fac_of_node(i):
    z = zoneOf.get(i, '')
    if z == 'sanban': return '三番街'
    if z == 'whity': return 'ホワイティ'
    return '周辺'

area_verts = [v for v in VERTS if inbox(v[1]) and inbox(v[2])]

def fac_of_vert(v):
    za, zb = zoneOf.get(v[1], ''), zoneOf.get(v[2], '')
    if 'sanban' in (za, zb): return '三番街'
    if 'whity' in (za, zb): return 'ホワイティ'
    return '周辺'

# ---------- SVG ----------
def edge_svg(a, b, z):
    (x1, y1), (x2, y2) = coord[a], coord[b]
    cross = floorOf.get(a) != floorOf.get(b)
    nmA = nameOf.get(a) or a; nmB = nameOf.get(b) or b
    dn = f'道 {nmA}—{nmB}' + ('（階またぎ）' if cross else '')
    style = 'stroke="#e8a020" stroke-width="3" stroke-dasharray="6 4"' if cross else 'stroke="#0aa860" stroke-width="3"'
    return f'<line id="道_{a}-{b}" data-name="{esc(dn)}" x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" {style} stroke-linecap="round"/>'

def node_svg(i):
    x, y = coord[i]; t = typOf.get(i, 'junction')
    col = {'station': '#ff9500', 'spot': '#0a78c8', 'junction': '#666'}[t]
    r = {'station': 5, 'spot': 4, 'junction': 2.5}[t]
    label = nameOf.get(i) or i
    out = [f'<circle id="点_{i}" data-name="{esc("点 " + label)}" cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{col}" stroke="#fff" stroke-width="0.8"/>']
    fs, fc = ('9', '#08243d') if t != 'junction' else ('7', '#444')
    out.append(f'<text x="{x + 6:.1f}" y="{y - 4:.1f}" fill="{fc}" font-size="{fs}" font-weight="bold">{esc(label)}</text>')
    return out

def vert_svg(v):
    t, a, b, mx, my, name = v
    mark = {'ev': '#c05be0', 'esc': '#2bb3c0', 'stairs': '#889'}[t]
    lbl = {'ev': 'EV', 'esc': 'ESC', 'stairs': '階段'}[t]
    out = [f'<rect id="縦移動_{a}-{b}-{t}" data-name="{esc("縦移動 " + (name or lbl))}" x="{mx - 4:.1f}" y="{my - 4:.1f}" width="8" height="8" '
           f'transform="rotate(45 {mx:.1f} {my:.1f})" fill="{mark}" stroke="#fff" stroke-width="1"/>']
    out.append(f'<text x="{mx + 7:.1f}" y="{my + 3:.1f}" fill="{mark}" font-size="8" font-weight="bold">{esc(name or lbl)}</text>')
    return out

svg = []
svg.append('<?xml version="1.0" encoding="UTF-8"?>')

# 公式マップパネルの配置計算
panels = [('公式_三番街_北館B1F', f'{UD}/tools/data/floorguides/sanbangai_n_b1f.png'),
          ('公式_三番街_北館B2F', f'{UD}/tools/data/floorguides/sanbangai_n_b2f.png'),
          ('公式_三番街_南館B1F', f'{UD}/tools/data/floorguides/sanbangai_s_b1f.png'),
          ('公式_三番街_南館B2F', f'{UD}/tools/data/floorguides/sanbangai_s_b2f.png'),
          ('公式_ホワイティうめだ', f'{UD}/tools/data/floorguides/whity_official.png')]
PW = 430
colx = [AX1 + 24, AX1 + 24 + PW + 16]
coly = [AY0, AY0]
placed = []
for i, (label, fp) in enumerate(panels):
    im = Image.open(fp).convert('RGB')
    ph = im.height * (PW / im.width)
    c = 0 if i < 3 else 1
    placed.append((label, im, colx[c], coly[c], PW, ph))
    coly[c] += ph + 26
TW = (colx[1] + PW + 16) - AX0
TH = max(AH, max(coly) - AY0) + 36

svg.append(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
           f'width="{TW:.0f}" height="{TH:.0f}" viewBox="{AX0} {AY0 - 36} {TW:.0f} {TH:.0f}" font-family="sans-serif">')
svg.append(f'<rect x="{AX0}" y="{AY0 - 36}" width="{TW:.0f}" height="{TH:.0f}" fill="#f4f5f7"/>')

# --- レイヤー0: 説明 ---
svg.append('<g id="説明_さわらない">')
svg.append(f'<text x="{AX0 + 4}" y="{AY0 - 22}" fill="#222" font-size="13" font-weight="bold">編集シート: 三番街・ホワイティ（床と道）— 座標系=元地図px。下敷き・公式マップは動かさない/拡縮しない</text>')
svg.append(f'<text x="{AX0 + 4}" y="{AY0 - 8}" fill="#444" font-size="11">緑線=同フロアの道 / 橙破線=階をまたぐ道 / ◆=EV・ESC / 面=床ポリゴン。編集して保存→このファイルを渡せば main.js に反映します</text>')
svg.append('</g>')

# --- レイヤー1: 下敷き(元地図) ---
base = Image.open(f'{UD}/tools/data/umechika_main_map_1350x1910.png').convert('RGB')
svg.append('<g id="下敷き_元地図_動かさない">')
svg.append(f'<image xlink:href="{b64(base.crop((AX0, AY0, AX1, AY1)))}" x="{AX0}" y="{AY0}" width="{AW}" height="{AH}" opacity="0.8"/>')
svg.append(f'<rect x="{AX0}" y="{AY0}" width="{AW}" height="{AH}" fill="none" stroke="#8a94a5" stroke-width="1"/>')
svg.append('</g>')

# --- レイヤー2〜: 施設ごと(床+道+点+縦移動) ---
for fac in ['三番街', 'ホワイティ', '周辺']:
    svg.append(f'<g id="{fac if fac != "周辺" else "周辺の接続"}">')
    # 床
    fl = [(ln, nm2, col) for ln, (nm2, f2, col) in FLOORS.items() if f2 == fac]
    if fl:
        svg.append(f'<g id="{fac}_床">')
        for ln, nm2, col in fl:
            outer, holes = parse_poly(ln)
            d = path_d(outer)
            for h in holes: d += ' ' + path_d(h)
            svg.append(f'<path id="{fac}_{nm2}" data-name="{esc(fac + " " + nm2)}" d="{d}" fill="{col}" fill-opacity="0.22" '
                       f'fill-rule="evenodd" stroke="{col}" stroke-width="2" stroke-linejoin="round"/>')
            cx = sum(x for x, _ in outer) / len(outer); cy = sum(y for _, y in outer) / len(outer)
            svg.append(f'<text x="{cx:.0f}" y="{cy:.0f}" fill="#333" font-size="11" font-weight="bold" text-anchor="middle">{esc(fac + " " + nm2)}</text>')
        svg.append('</g>')
    # 道
    es = [e for e in area_edges if fac_of_edge(*e) == fac]
    if es:
        svg.append(f'<g id="{fac}_道">')
        for a, b, z in es: svg.append(edge_svg(a, b, z))
        svg.append('</g>')
    # 縦移動
    vs = [v for v in area_verts if fac_of_vert(v) == fac]
    if vs:
        svg.append(f'<g id="{fac}_縦移動EVESC">')
        for v in vs: svg.extend(vert_svg(v))
        svg.append('</g>')
    # 点
    ns = [i for i in sorted(touched) if fac_of_node(i) == fac]
    if ns:
        svg.append(f'<g id="{fac}_点">')
        for i in ns: svg.extend(node_svg(i))
        svg.append('</g>')
    svg.append('</g>')

# --- レイヤー: 公式マップ(参考) ---
svg.append('<g id="公式マップ_参考_座標系は別">')
for label, im, px, py, pw, ph in placed:
    svg.append(f'<g id="{label}">')
    svg.append(f'<text x="{px:.0f}" y="{py + 12:.0f}" fill="#222" font-size="12" font-weight="bold">{esc(label.replace("_", " "))}</text>')
    svg.append(f'<image xlink:href="{b64(im)}" x="{px:.0f}" y="{py + 16:.0f}" width="{pw:.0f}" height="{ph - 16:.0f}"/>')
    svg.append(f'<rect x="{px:.0f}" y="{py + 16:.0f}" width="{pw:.0f}" height="{ph - 16:.0f}" fill="none" stroke="#8a94a5" stroke-width="1"/>')
    svg.append('</g>')
svg.append('</g>')

svg.append('</svg>')
out = f'{UD}/編集シート_三番街_ホワイティ.svg'
open(out, 'w', encoding='utf-8').write('\n'.join(svg))
print(f'{os.path.basename(out)}: {os.path.getsize(out) // 1024}KB')
