#!/usr/bin/env python3
"""関電不動産西梅田ビル 地下街 B1F の詳細地図データ(仮配置)。

B1F の案内板(区画図)が無く、テナント板(8店)しか資料がないので、外形は B2F の案内板と同じ建物外形
(tools/kanden_b2_from_board.py と同じ座標系: 北が上、東西52m×南北39m)を使い、テナントは通路の両側に
テナント板の順で等間隔に置く。**位置は仮**。B1F の案内板の写真が届いたら kanden_b2_from_board.py の要領で置き換える。
B2F からの館内階段は東側中央(B2案内板の「現在地」横)なので、通路の東端に階段の床を足す。

出力: tools/data/detail/kanden_b1.json → python3 tools/gen_detail.py kanden_b1
"""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 52.0, 39.0            # 建物外形(m)
CORR_Y0, CORR_Y1 = 14.0, 25.0  # 東西方向の通路(北側の列と南側の列の間)
NORTH = ['SSS Kaneko stretch', 'めん処 鍋物 呑処 はま栄', 'Heilee brow', 'NOVA 駅前留学']          # 北側の列(西→東)
SOUTH = ['リサイクルブティック フォーシーズンズ', '携帯電話 スモールアイランド', 'nail salon Sou', 'LETO']  # 南側の列(西→東)
blocks, shops = [], []
def add(name, x0, x1, y0, y1):
    g = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    blocks.append({'g': g, 'mall': 'kanden(仮配置)', 'name': name})
    shops.append({'name': name, 'no': '', 'g': [round((x0 + x1) / 2, 1), round((y0 + y1) / 2, 1)]})
n = len(NORTH); w = (W - 6) / n  # 東端6mは階段
for i, name in enumerate(NORTH):
    add(name, round(i * w, 1), round((i + 1) * w, 1), 0, CORR_Y0)
for i, name in enumerate(SOUTH):
    add(name, round(i * w, 1), round((i + 1) * w, 1), CORR_Y1, H)
out = {
    'source': '関電不動産西梅田ビル地下街 B1F。案内板が無いため仮配置(テナント板の順に通路の両側へ等間隔)。外形は B2F と同じ建物外形(OSM 162380618)。tools/kanden_b1_provisional.py',
    'areas': ['kanden_b1'],
    'outline_g': [[0, 0], [W, 0], [W, H], [0, H]],
    'blocks': blocks, 'shops': shops, 'walks': [], 'area_anchors': {},
    '_stairs': {'east_mid(B2Fへ)': [[W - 6, CORR_Y0], [W, CORR_Y0], [W, CORR_Y1], [W - 6, CORR_Y1]]},
}
dst = os.path.join(ROOT, 'tools/data/detail/kanden_b1.json')
json.dump(out, open(dst, 'w'), ensure_ascii=False, indent=1)
print('仮配置 区画', len(blocks), '→', os.path.relpath(dst, ROOT))
