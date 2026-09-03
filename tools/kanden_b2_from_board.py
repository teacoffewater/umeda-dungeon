#!/usr/bin/env python3
"""関電不動産西梅田ビル 地下街 B2F の案内板(線画)から詳細地図データを起こす。

入力: tools/data/floorguides/kanden_b2_board_2026-09-03.jpg(現地撮影。線画で区画4つ+トイレ+階段2つ)
出力: tools/data/detail/kanden_b2.json → python3 tools/gen_detail.py kanden_b2

線画なので色抽出はせず、幅2000pxで表示した写真から目で読んだ区画の角(px)を手で置く。
向き: 案内板の「堂島地下センター」出口は板の下側にあるが、実際の接続はビルの北東角(ドーチカ C61 の西、
通路は西へ出てから南へ折れる)なので、**板は南が上**(180°回転)として置く。板の左=東、板の下=北。
縮尺: OSM の建物外形(162380618: 東西52m×南北39m)を板の外形(713×415px)に当てる。
"""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BX0, BX1, BY0, BY1 = 712, 1425, 480, 895          # 板の外形(表示px)
SX, SY = 52.0 / (BX1 - BX0), 39.0 / (BY1 - BY0)  # m/px

def g(pts):  # 板px → ガイドm(北が上、x東・y南)。板の左=東、板の下=北
    return [[round((BX1 - x) * SX, 1), round((BY1 - y) * SY, 1)] for x, y in pts]

OUTLINE = [(712, 480), (1425, 478), (1425, 640), (1355, 720), (1310, 895), (770, 895), (712, 865)]
CONN = [(800, 895), (900, 895), (900, 935), (800, 935)]  # 北東角からドーチカ C61 へ出る通路(板の下へ)
BLOCKS = [
    ({'no': '4', 'name': '堂島喫茶 SUI'}, [(712, 480), (1005, 480), (1005, 650), (712, 650)]),  # 板の左上(=南東)の無記名区画。SUI と推定(テナント板にはB2、案内板に区画名なし)。要現地確認
    ({'no': '1', 'name': '中国料理 敦煌'}, [(1005, 480), (1155, 480), (1155, 650), (1005, 650)]),
    ({'no': '2', 'name': '割烹 小澤'}, [(1155, 480), (1265, 480), (1225, 650), (1155, 650)]),
    ({'mall': '空き'}, [(1265, 480), (1340, 480), (1300, 650), (1225, 650)]),
    ({'mall': 'トイレ'}, [(1340, 480), (1425, 478), (1425, 570), (1320, 570)]),
    ({'no': '3', 'name': 'とんこう'}, [(900, 715), (1355, 715), (1310, 895), (900, 895)]),
]
blocks, shops = [], []
for meta, pts in BLOCKS:
    b = {'g': g(pts), 'mall': meta.get('mall', 'kanden')}
    if 'no' in meta: b['no'] = meta['no']
    blocks.append(b)
    if 'name' in meta:
        xs = [p[0] for p in b['g']]; ys = [p[1] for p in b['g']]
        shops.append({'name': meta['name'], 'no': meta['no'], 'g': [round(sum(xs) / len(xs), 1), round(sum(ys) / len(ys), 1)]})
out = {
    'source': '関電不動産西梅田ビル地下街 B2F 案内板(2026-09-03 現地撮影、線画)。tools/kanden_b2_from_board.py が手置き。南が上の板を北上に回転。縮尺は建物外形52×39m(OSM 162380618)',
    'areas': ['kanden_b2'],
    'outline_g': g(OUTLINE), 'blocks': blocks, 'shops': shops, 'walks': [g(CONN)], 'area_anchors': {},
    '_stairs': {'east_mid(現在地の隣, B1Fへ)': g([(790, 650), (845, 650), (845, 715), (790, 715)]),
                'southwest(トイレの隣)': g([(1300, 570), (1425, 570), (1425, 640), (1300, 640)])},
}
dst = os.path.join(ROOT, 'tools/data/detail/kanden_b2.json')
json.dump(out, open(dst, 'w'), ensure_ascii=False, indent=1)
print('区画', len(blocks), '店', len(shops), '→', os.path.relpath(dst, ROOT))
