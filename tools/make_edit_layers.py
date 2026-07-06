#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阪急三番街の編集シートをレイヤー別PNGで書き出す(PSD互換問題の回避)。
各PNGは同一キャンバスサイズ・透過付き。Photoshopで(0,0)に重ねれば一致する。
"""
import re, json, math, os
from PIL import Image, ImageDraw, ImageFont

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

INSTR = ["【使い方】00_背景 を開き、01〜07 を番号順に(0,0)へ重ねる(各PNG透過付き・同サイズ)",
         "その上に自分で描画レイヤーを作り、色で意味を分ける:",
         "■赤=店の位置なおし(印+店番号)  ■緑=通路の追加  ■青=通路の削除(消したい線)",
         "■黄=床(ゾーン)の形なおし  ■紫=自由メモ(文字OK)",
         "【保存】各色レイヤーごとにPNG書き出し、名前に色を入れてこのフォルダへ(例: B1_三番街_赤.png)"]

def blank(W, H):
    return Image.new('RGBA', (W, H), (0, 0, 0, 0))

def make_layers(sheet_name, base_png, meta, floor, ML, MT, MR, MB, dot_r, grid_step, idfont, shopfont):
    base = Image.open(base_png).convert('RGB')
    x1, y1, Z = meta['x1'], meta['y1'], meta['zoom']
    def mp(px, py):
        la, lo = mappx_to_latlon(px, py)
        gx, gy = merc(la, lo, Z)
        return gx - x1 + ML, gy - y1 + MT
    W, H = base.size[0] + ML + MR, base.size[1] + MT + MB
    folder = f'{OUT}/{sheet_name}_layers'
    os.makedirs(folder, exist_ok=True)

    # 00 背景(不透明)
    L_bg = Image.new('RGB', (W, H), (255, 255, 255))
    L_bg.paste(base, (ML, MT))
    L_bg.save(f'{folder}/00_背景_Google地図.png')

    # 01 床ゾーン
    L = blank(W, H); dr = ImageDraw.Draw(L)
    for fl, zone, pts, holes in fpolys:
        if fl != floor: continue
        c = ZCOL.get(zone, (120, 120, 120))
        dr.polygon([mp(x, y) for x, y in pts], fill=c+(70,), outline=c+(255,), width=2)
        for h in holes:
            dr.polygon([mp(x, y) for x, y in h], outline=c+(255,), width=2)
    L.save(f'{folder}/01_床ゾーン.png')

    # 02 通路
    L = blank(W, H); dr = ImageDraw.Draw(L)
    for a, b, w, zone in d['edges']:
        na, nb = nodes[a], nodes[b]
        if na['floor'] != floor and nb['floor'] != floor: continue
        c = ZCOL.get(zone, (90, 90, 90))
        dr.line([mp(na['mx'], na['my']), mp(nb['mx'], nb['my'])], fill=c+(230,), width=4)
    L.save(f'{folder}/02_通路.png')

    # 03 ビル内格子
    L = blank(W, H); dr = ImageDraw.Draw(L)
    for aid, fl, (cx, cy, rw, rd) in rect_areas:
        if fl != floor: continue
        for i in (-1, 0, 1):
            dr.line([mp(cx-rw/3*1.15, cy+i*rd/3), mp(cx+rw/3*1.15, cy+i*rd/3)], fill=(40, 40, 40, 180), width=2)
            dr.line([mp(cx+i*rw/3, cy-rd/3*1.15), mp(cx+i*rw/3, cy+rd/3*1.15)], fill=(40, 40, 40, 180), width=2)
    L.save(f'{folder}/03_ビル内の抽象通路.png')

    # 04 座標グリッド
    L = blank(W, H); dr = ImageDraw.Draw(L)
    for gx in range(400, 1360, grid_step):
        dr.line([mp(gx, 380), mp(gx, 1700)], fill=(0, 160, 200, 90), width=1)
        px, py = mp(gx, 380)
        if ML < px < W-MR: dr.text((px-14, MT-22), f'x{gx}', fill=(0, 120, 160, 255), font=F(14))
    for gy in range(400, 1710, grid_step):
        dr.line([mp(180, gy), mp(1360, gy)], fill=(0, 160, 200, 90), width=1)
        px, py = mp(180, gy)
        if MT < py < H-MB: dr.text((6, py-8), f'y{gy}', fill=(0, 120, 160, 255), font=F(14))
    L.save(f'{folder}/04_座標グリッド.png')

    # 05 ノードID
    L = blank(W, H); dr = ImageDraw.Draw(L)
    for n in nodes.values():
        if n['type'] == 'shop' or n['floor'] != floor: continue
        px, py = mp(n['mx'], n['my'])
        if not (ML-10 < px < W-MR+10 and MT-10 < py < H-MB+10): continue
        dr.ellipse([px-4, py-4, px+4, py+4], fill=(20, 20, 20, 255), outline=(255, 255, 255, 255), width=1)
        dr.text((px+5, py-6), n['id'], fill=(30, 30, 30, 255), font=F(idfont))
    L.save(f'{folder}/05_ノードID.png')

    # 06 店舗(点+番号)
    L = blank(W, H); dr = ImageDraw.Draw(L)
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
    L.save(f'{folder}/06_店舗_点と番号.png')

    # 07 凡例・店名リスト・指示
    L = blank(W, H); dr = ImageDraw.Draw(L)
    col_w = 265; rows = (H - MT - MB - 20) // 15
    for i, (snum, sname) in enumerate(shop_list):
        cx0 = W - MR + 10 + (i // rows) * col_w
        cy0 = MT + 8 + (i % rows) * 15
        dr.text((cx0, cy0), f'{snum:>3} {sname[:16]}', fill=(20, 20, 20, 255), font=F(11))
    ly = H - MB + 8
    dr.text((ML, ly), f'梅田ダンジョン 編集シート [{sheet_name}]  フロア:{floor}  細線=通路(色=施設) 格子=ビル内の抽象通路 丸=店舗',
            fill=(0, 0, 0, 255), font=F(16))
    for i, t in enumerate(INSTR):
        dr.text((ML, ly + 26 + i*20), t, fill=(60, 60, 60, 255), font=F(13))
    lx = ML; lyy = ly + 26 + len(INSTR)*20 + 6
    for zone, c in ZCOL.items():
        if zone == '_neutral': continue
        dr.rectangle([lx, lyy, lx+14, lyy+14], fill=c+(255,))
        dr.text((lx+18, lyy), zone, fill=(40, 40, 40, 255), font=F(12))
        lx += 18 + 8*len(zone) + 26
        if lx > W - 220: lx = ML; lyy += 20
    L.save(f'{folder}/07_凡例と店名リスト.png')

    # フラット参照(originals) — 差分照合の基準
    flat = L_bg.convert('RGBA')
    for name in ['01_床ゾーン', '03_ビル内の抽象通路', '02_通路', '04_座標グリッド', '06_店舗_点と番号', '07_凡例と店名リスト']:
        flat = Image.alpha_composite(flat, Image.open(f'{folder}/{name}.png').convert('RGBA'))
    os.makedirs(OUT + '/originals', exist_ok=True)
    flat.convert('RGB').save(f'{OUT}/originals/{sheet_name}.png')
    print(sheet_name, '→', folder, f'({W}x{H}, 店{num})')

meta_s = json.load(open('mosaic_sanban_z19.json'))
make_layers('B1_三番街詳細', 'mosaic_sanban_z19.png', meta_s, 'B1', 70, 40, 620, 210, 9, 50, 13, 11)
make_layers('B2_三番街詳細', 'mosaic_sanban_z19.png', meta_s, 'B2', 70, 40, 620, 210, 9, 50, 13, 11)
