#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阪急三番街の編集用シートをレイヤー分割PSDで生成する。
参照レイヤー(下敷き/床/通路/格子/グリッド/店番号/ノードID/凡例)を分け、
最上部に色別の空の描き込みレイヤー(赤=店移動/緑=通路追加/青=削除/黄=床/紫=メモ)を重ねる。
"""
import re, json, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import pytoshop
from pytoshop.user import nested_layers
from pytoshop import enums

OUT = '/Users/kana/Desktop/Blender2/編集シート'
F = lambda size: ImageFont.truetype('/System/Library/Fonts/Hiragino Sans GB.ttc', size)
MX = [0.9016776456322585, 0.029513667767732826, 843.3902886095399]
MY = [0.03970669489516974, -1.1219829189908253, 944.3469058365063]
DET = MX[0]*MY[1] - MX[1]*MY[0]
COS0 = math.cos(math.radians(34.702))
def mappx_to_latlon(px, py):
    ux, uy = px - MX[2], py - MY[2]
    return (34.702 + ((MX[0]*uy - ux*MY[0])/DET)/110950,
            135.497 + ((ux*MY[1] - MX[1]*uy)/DET)/(111320*COS0))
def merc(lat, lon, Z):
    N = 2**Z * 256
    return ((lon + 180)/360*N,
            (1 - math.log(math.tan(math.radians(lat)) + 1/math.cos(math.radians(lat)))/math.pi)/2*N)
ZCOL = {'sanban':(224,145,63),'whity':(217,192,75),'umechika':(217,127,159),'osaka_sta':(95,159,217),
        'lucua':(106,111,226),'hilton':(203,179,122),'herbis':(170,78,102),'kitte':(47,143,163),
        'daimaru':(60,138,94),'hankyu_dept':(139,53,72),'hanshin_dept':(63,95,158),'avanza':(154,143,82),
        'diamor':(69,200,168),'nishi_umeda':(160,127,217),'ekimae':(219,90,102),'sonechika':(73,182,196),
        'dotica':(95,174,110),'links':(207,107,191),'grandfront':(157,184,62),'umekita':(133,215,182),
        '_neutral':(120,120,120)}

d = json.load(open('nodes_dump.json'))
nodes = {n['id']: n for n in d['nodes']}
psrc = open('/Users/kana/Desktop/Blender2/umeda-dungeon/tools/floor_polys_generated.js').read()
fpolys = []
for m in re.finditer(r"\{ floor: '(B[12])', zone: '(\w+)', pts: (\[\[.*?\]\])(?:, holes: \[(.*?)\])?(?:, covers:.*?)? \},", psrc):
    holes = [json.loads(h) for h in re.findall(r"\[\[.*?\]\]", m.group(4))] if m.group(4) else []
    fpolys.append((m.group(1), m.group(2), json.loads(m.group(3)), holes))
ssrc = open('/Users/kana/Desktop/Blender2/umeda-dungeon/shops.js').read()
rect_areas = []
for m in re.finditer(r"^\s*(\w+):\s*\{ floor: '(B[12])', zone: '(\w+)',.*rect: \[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\]", ssrc, re.M):
    rect_areas.append((m.group(1), m.group(2), [float(x) for x in m.groups()[3:]]))

INSTR = ["【描き方】専用レイヤーに描いてください(下の参照レイヤーは触らない)",
         "■赤=店の位置なおし(正しい位置に印+店番号)  ■緑=通路の追加(歩ける道を線で)",
         "■青=通路の削除(消したい線をなぞる/消す)  ■黄=床(ゾーン)の形なおし  ■紫=自由メモ(文字OK)",
         "【保存】PSDのまま or 統合せず。ファイル名『(元名)_edited.psd/.png』でこのフォルダへ"]

def blank(W, H):
    return Image.new('RGBA', (W, H), (0, 0, 0, 0))

def layer_from(img, name, visible=True, opacity=255):
    arr = np.asarray(img.convert('RGBA'))
    ch = {0: arr[..., 0].copy(), 1: arr[..., 1].copy(), 2: arr[..., 2].copy(), -1: arr[..., 3].copy()}
    return nested_layers.Image(name=name, visible=visible, opacity=opacity,
                               top=0, left=0, channels=ch,
                               color_mode=enums.ColorMode.rgb)

def make_psd(sheet_name, base_png, meta, floor, ML, MT, MR, MB, dot_r, grid_step, idfont, shopfont):
    base = Image.open(base_png).convert('RGB')
    x1, y1, Z = meta['x1'], meta['y1'], meta['zoom']
    def mp(px, py):
        la, lo = mappx_to_latlon(px, py)
        gx, gy = merc(la, lo, Z)
        return gx - x1 + ML, gy - y1 + MT
    W, H = base.size[0] + ML + MR, base.size[1] + MT + MB

    # --- 背景(下敷き) ---
    L_bg = Image.new('RGBA', (W, H), (255, 255, 255, 255))
    L_bg.paste(base, (ML, MT))

    # --- 床ゾーン ---
    L_floor = blank(W, H); dr = ImageDraw.Draw(L_floor)
    for fl, zone, pts, holes in fpolys:
        if fl != floor: continue
        c = ZCOL.get(zone, (120, 120, 120))
        dr.polygon([mp(x, y) for x, y in pts], fill=c+(70,), outline=c+(255,), width=2)
        for h in holes:
            dr.polygon([mp(x, y) for x, y in h], outline=c+(255,), width=2)

    # --- 通路 ---
    L_corr = blank(W, H); dr = ImageDraw.Draw(L_corr)
    for a, b, w, zone in d['edges']:
        na, nb = nodes[a], nodes[b]
        if na['floor'] != floor and nb['floor'] != floor: continue
        c = ZCOL.get(zone, (90, 90, 90))
        dr.line([mp(na['mx'], na['my']), mp(nb['mx'], nb['my'])], fill=c+(230,), width=4)

    # --- ビル内格子(現状の抽象通路) ---
    L_grid_b = blank(W, H); dr = ImageDraw.Draw(L_grid_b)
    for aid, fl, (cx, cy, rw, rd) in rect_areas:
        if fl != floor: continue
        for i in (-1, 0, 1):
            dr.line([mp(cx-rw/3*1.15, cy+i*rd/3), mp(cx+rw/3*1.15, cy+i*rd/3)], fill=(40, 40, 40, 180), width=2)
            dr.line([mp(cx+i*rw/3, cy-rd/3*1.15), mp(cx+i*rw/3, cy+rd/3*1.15)], fill=(40, 40, 40, 180), width=2)

    # --- 座標グリッド ---
    L_grid = blank(W, H); dr = ImageDraw.Draw(L_grid)
    for gx in range(400, 1360, grid_step):
        dr.line([mp(gx, 380), mp(gx, 1700)], fill=(0, 160, 200, 90), width=1)
        px, py = mp(gx, 380)
        if ML < px < W-MR: dr.text((px-14, MT-22), f'x{gx}', fill=(0, 120, 160, 255), font=F(14))
    for gy in range(400, 1710, grid_step):
        dr.line([mp(180, gy), mp(1360, gy)], fill=(0, 160, 200, 90), width=1)
        px, py = mp(180, gy)
        if MT < py < H-MB: dr.text((6, py-8), f'y{gy}', fill=(0, 120, 160, 255), font=F(14))

    # --- ノードID ---
    L_node = blank(W, H); dr = ImageDraw.Draw(L_node)
    for n in nodes.values():
        if n['type'] == 'shop' or n['floor'] != floor: continue
        px, py = mp(n['mx'], n['my'])
        if not (ML-10 < px < W-MR+10 and MT-10 < py < H-MB+10): continue
        dr.ellipse([px-4, py-4, px+4, py+4], fill=(20, 20, 20, 255), outline=(255, 255, 255, 255), width=1)
        dr.text((px+5, py-6), n['id'], fill=(30, 30, 30, 255), font=F(idfont))

    # --- 店舗(点+番号) & リスト ---
    L_shop = blank(W, H); dr = ImageDraw.Draw(L_shop)
    shop_list = []; num = 0
    for n in d['nodes']:
        if n['type'] != 'shop' or n['floor'] != floor: continue
        px, py = mp(n['mx'], n['my'])
        if not (ML < px < W-MR and MT < py < H-MB): continue
        c = ZCOL.get(n.get('zone', ''), (120, 120, 120))
        num += 1
        dr.ellipse([px-dot_r, py-dot_r, px+dot_r, py+dot_r], fill=c+(255,), outline=(0, 0, 0, 255), width=1)
        t = str(num); bb = dr.textbbox((0, 0), t, font=F(shopfont))
        dr.text((px-(bb[2]-bb[0])/2, py-(bb[3]-bb[1])/2-2), t, fill=(255, 255, 255, 255), font=F(shopfont))
        shop_list.append((num, n['name']))

    # --- 凡例・店名リスト・指示 ---
    L_leg = blank(W, H); dr = ImageDraw.Draw(L_leg)
    col_w = 265; rows = (H - MT - MB - 20) // 15
    for i, (snum, sname) in enumerate(shop_list):
        cx0 = W - MR + 10 + (i // rows) * col_w
        cy0 = MT + 8 + (i % rows) * 15
        dr.text((cx0, cy0), f'{snum:>3} {sname[:16]}', fill=(20, 20, 20, 255), font=F(11))
    ly = H - MB + 8
    dr.text((ML, ly), f'梅田ダンジョン 編集シート [{sheet_name}]  フロア:{floor}  細線=通路(色=施設) 格子=ビル内の抽象通路 丸=店舗',
            fill=(0, 0, 0, 255), font=F(16))
    for i, t in enumerate(INSTR):
        dr.text((ML, ly + 26 + i*20), t, fill=(60, 60, 60, 255), font=F(14))
    lx = ML; lyy = ly + 26 + len(INSTR)*20 + 6
    for zone, c in ZCOL.items():
        if zone == '_neutral': continue
        dr.rectangle([lx, lyy, lx+14, lyy+14], fill=c+(255,))
        dr.text((lx+18, lyy), zone, fill=(40, 40, 40, 255), font=F(12))
        lx += 18 + 8*len(zone) + 26
        if lx > W - 220: lx = ML; lyy += 20

    # --- 描き込み用レイヤー(色チップだけ置いて空にしない=Photoshopで残る) ---
    # (名前, チップ色, 説明) 先頭=最上位
    draw_defs = [
        ('✏5_紫_メモ',        (150, 70, 200),  '紫: 自由メモ(文字OK)'),
        ('✏4_黄_床の形なおし', (220, 180, 40),  '黄: 床(ゾーン)の形なおし'),
        ('✏3_青_通路の削除',   (40, 120, 220),  '青: 通路の削除(なぞる)'),
        ('✏2_緑_通路の追加',   (40, 170, 90),   '緑: 通路の追加'),
        ('✏1_赤_店の位置なおし',(220, 50, 60),   '赤: 店の位置なおし(印+番号)'),
    ]
    layers = []
    for i, (nm, col, desc) in enumerate(draw_defs):
        chip = blank(W, H); cd = ImageDraw.Draw(chip)
        cy0 = MT + 4 + i * 20
        cd.rectangle([ML + 4, cy0, ML + 20, cy0 + 15], fill=col + (255,), outline=(255, 255, 255, 255))
        cd.text((ML + 26, cy0), desc + ' ← このレイヤーに描く', fill=col + (255,), font=F(13))
        layers.append(layer_from(chip, nm))
    layers += [
        layer_from(L_leg,    '参照_凡例と店名リスト'),
        layer_from(L_shop,   '参照_店舗(点と番号)'),
        layer_from(L_node,   '参照_ノードID', visible=False),
        layer_from(L_grid,   '参照_座標グリッド', visible=False),
        layer_from(L_grid_b, '参照_ビル内の抽象通路(格子)'),
        layer_from(L_corr,   '参照_通路'),
        layer_from(L_floor,  '参照_床(ゾーン色)'),
        layer_from(L_bg,     '背景_Google地図'),
    ]
    psd = nested_layers.nested_layers_to_psd(layers, color_mode=enums.ColorMode.rgb, size=(H, W), compression=enums.Compression.zip)
    path = f'{OUT}/{sheet_name}.psd'
    with open(path, 'wb') as f:
        psd.write(f)
    # 参照用フラットPNG(originals)も維持
    flat = L_bg.copy()
    for L in (L_floor, L_grid_b, L_corr, L_grid, L_shop, L_leg):
        flat = Image.alpha_composite(flat, L)
    os.makedirs(OUT + '/originals', exist_ok=True)
    flat.convert('RGB').save(f'{OUT}/originals/{sheet_name}.png')
    print(sheet_name, (W, H), 'shops:', num, 'layers:', len(layers))

meta_s = json.load(open('mosaic_sanban_z19.json'))
make_psd('B1_三番街詳細', 'mosaic_sanban_z19.png', meta_s, 'B1', 70, 40, 620, 210, 9, 50, 13, 11)
make_psd('B2_三番街詳細', 'mosaic_sanban_z19.png', meta_s, 'B2', 70, 40, 620, 210, 9, 50, 13, 11)
