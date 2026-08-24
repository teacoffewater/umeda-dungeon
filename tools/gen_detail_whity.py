#!/usr/bin/env python3
"""ホワイティ詳細データ(detail_whity.js)を生成する。

入力: tools/data/whity_2016.json (extract_whity_pdf.py の出力)
出力: detail_whity.js
  - WHITY_BLOCKS: テナントブロックの外形(ホワイティ床の近く30m以内のみ。案内図の飾り由来のノイズを除く)
  - WHITY_REAL_POS: 現在の店(shops.js)のうち2016年版と名前が一致した店の実位置 {店名: [mx,my]}
"""
import json, os, re, sys
from shapely.geometry import Polygon, Point
from shapely.ops import unary_union
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(os.path.join(ROOT, 'tools/data/whity_2016.json')))
src = open(os.path.join(ROOT, 'tools/floor_polys_generated.js')).read()
whity = unary_union([Polygon(json.loads(m.group(1))) for m in re.finditer(r"zone: 'whity', pts: (\[\[.*?\]\])", src)])
blocks = []
for b in d['blocks']:
    if b['mall'] == 'その他':
        continue
    p = Polygon(b['m'])
    if p.is_valid and p.distance(whity) <= 30:
        blocks.append(b)
print(f'ブロック {len(d["blocks"])} → 床の近く {len(blocks)}')

def norm(x):
    return re.sub(r'[ 　・]', '', x).lower()
by2016 = {}
for s in d['shops']:
    by2016[norm(s['name'])] = s
sh = open(os.path.join(ROOT, 'shops.js')).read()
cur = [m.group(1) for m in re.finditer(r"s\('([^']+)', 'whity_\w+'", sh)]
real = {}
for c in cur:
    k = norm(c)
    hit = by2016.get(k)
    if not hit:  # 安全な部分一致(4文字以上・片方向包含)
        cands = [s for kk, s in by2016.items() if len(kk) >= 4 and (kk in k or k in kk)]
        hit = cands[0] if len(cands) == 1 else None
    if hit:
        # 床から10m超離れる位置は採用しない(地図データの粗さ・誤照合のガード)
        if Point(hit['m']).distance(whity) <= 10:
            real[c] = hit['m']
print(f'現在のホワイティ店 {len(cur)}件中 実位置が付いた店 {len(real)}件')
with open(os.path.join(ROOT, 'detail_whity.js'), 'w') as f:
    f.write('// 自動生成: tools/gen_detail_whity.py(2016年公式フロアガイドPDF由来)。手編集しない\n')
    f.write('// ブロックはテナント区画の外形(2016年時点)。REAL_POS は名前が一致した現在の店の実位置\n')
    f.write('export const WHITY_BLOCKS = ' + json.dumps(blocks, ensure_ascii=False, separators=(',', ':')) + ';\n')
    f.write('export const WHITY_REAL_POS = ' + json.dumps(real, ensure_ascii=False, separators=(',', ':')) + ';\n')
print('wrote detail_whity.js')
