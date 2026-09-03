#!/usr/bin/env python3
"""紀陽ビル B1F の詳細地図データ(仮配置)。

資料(館内図)が無く、現地の見聞「ドーチカから入って左が福永診療所、右が堂島デンタルクリニック」だけなので、
外形は OSM のビル外形(221966330: 東西約30m×南北約28m)の矩形、入口はドーチカ側(東面の中央)、
入口から西へ通路、通路の左(南)に福永診療所、右(北)に堂島デンタルクリニックを置く。**位置は仮**。
館内図の写真か調査モードの詳細地図記録(店の位置)が届いたら置き換える。

出力: tools/data/detail/kiyo_b1.json → python3 tools/gen_detail.py kiyo_b1
"""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 30.0, 28.0            # 建物外形(m)。北が上、y は南向き正
CY0, CY1 = 11.0, 17.0        # 東西方向の通路(入口から西へ)
blocks, shops = [], []
def add(name, x0, x1, y0, y1):
    blocks.append({'g': [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], 'mall': 'kiyo(仮配置)', 'name': name})
    shops.append({'name': name, 'no': '', 'g': [round((x0 + x1) / 2, 1), round((y0 + y1) / 2, 1)]})
add('堂島デンタルクリニック', 4, W, 0, CY0)   # 入って右(北)
add('福永診療所', 4, W, CY1, H)               # 入って左(南)
out = {
    'source': '紀陽ビル B1F。館内図が無いため仮配置(現地の見聞: ドーチカから入って左=福永診療所、右=堂島デンタルクリニック 2026-09-03)。外形は OSM 221966330。tools/kiyo_b1_provisional.py',
    'areas': ['kiyo_b1'],
    'outline_g': [[0, 0], [W, 0], [W, CY0], [W + 4, CY0], [W + 4, CY1], [W, CY1], [W, H], [0, H]],  # 東面の中央にドーチカへの入口(4m)
    'blocks': blocks, 'shops': shops, 'walks': [], 'area_anchors': {},
}
dst = os.path.join(ROOT, 'tools/data/detail/kiyo_b1.json')
json.dump(out, open(dst, 'w'), ensure_ascii=False, indent=1)
print('仮配置 区画', len(blocks), '→', os.path.relpath(dst, ROOT))
