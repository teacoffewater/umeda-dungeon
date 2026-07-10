#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""区画のGoogle地図モザイク(z19)を、既存アフィン枠(map px)基準で取得する。
使い方: python3 tools/fetch_district_mosaic.py <name> <mx0> <my0> <mx1> <my1>
出力: tools/data/mosaics/<name>_z19.png と .json(x1,y1,zoom = merc px窓)
既存 MX/MY アフィン(継承)で map px→lat/lon→メルカトルpx を計算。地上ビルの座標系と一致。
"""
import sys, os, math, time, json, urllib.request
from PIL import Image

MX = [0.9016776456322585, 0.029513667767732826, 843.3902886095399]
MY = [0.03970669489516974, -1.1219829189908253, 944.3469058365063]
DET = MX[0]*MY[1] - MX[1]*MY[0]
COS0 = math.cos(math.radians(34.702))
def mappx_to_latlon(px, py):
    ux, uy = px - MX[2], py - MY[2]
    xm = (ux*MY[1] - MX[1]*uy)/DET
    ym = (MX[0]*uy - ux*MY[0])/DET
    return 34.702 + ym/110950, 135.497 + xm/(111320*COS0)
def merc(lat, lon, Z):
    N = 2**Z * 256
    return ((lon+180)/360*N,
            (1 - math.log(math.tan(math.radians(lat)) + 1/math.cos(math.radians(lat)))/math.pi)/2*N)

name, mx0, my0, mx1, my1 = sys.argv[1], *map(float, sys.argv[2:6])
Z, TILE = 19, 256
# 四隅のmap px→メルカトルpxで包絡窓を作る
corners = [mappx_to_latlon(x, y) for x in (mx0, mx1) for y in (my0, my1)]
mxy = [merc(la, lo, Z) for la, lo in corners]
x1 = int(min(p[0] for p in mxy)) - 30; y1 = int(min(p[1] for p in mxy)) - 30
x2 = int(max(p[0] for p in mxy)) + 30; y2 = int(max(p[1] for p in mxy)) + 30
os.makedirs('tools/data/mosaics', exist_ok=True)
os.makedirs('/tmp/gtiles19', exist_ok=True)
img = Image.new('RGB', (x2-x1, y2-y1), '#eee'); n = 0
for tx in range(x1//TILE, x2//TILE+1):
    for ty in range(y1//TILE, y2//TILE+1):
        fp = f'/tmp/gtiles19/{tx}_{ty}.png'
        if not os.path.exists(fp):
            url = f'https://mt{(tx+ty)%4}.google.com/vt/lyrs=m&hl=ja&x={tx}&y={ty}&z={Z}'
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'})
            open(fp, 'wb').write(urllib.request.urlopen(req, timeout=20).read()); n += 1; time.sleep(0.04)
        img.paste(Image.open(fp).convert('RGB'), (tx*TILE-x1, ty*TILE-y1))
img.save(f'tools/data/mosaics/{name}_z19.png')
json.dump({'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2, 'zoom': Z, 'mappx_bbox': [mx0, my0, mx1, my1]},
          open(f'tools/data/mosaics/{name}_z19.json', 'w'))
print(f'{name}: {img.size} tiles+{n} -> tools/data/mosaics/{name}_z19.png')
