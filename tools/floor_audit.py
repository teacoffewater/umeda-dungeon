#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""フロア接続監査(方針A=歩ける高さ基準)。
「フロア」を『階段/ESC/EVを使わずに歩ける範囲=1つの面』と定義し、
現行グラフがこの定義と矛盾していないかを機械抽出する。

検出:
  1. 歩行レベル成分: 水平エッジのみ(昇降設備を除く)で到達できる連結成分。
     approach A では1成分=1フロアであるべき。成分内でB1/B2ラベルが混在=矛盾。
  2. 不可能エッジ: 端点のフロアが違うのに間に昇降設備が無いエッジ(瞬間移動)。
  3. 施設間接続の棚卸し: ゾーンをまたぐエッジ一覧(どの面で繋がっているか)。
  4. 昇降設備の一覧: EV/ESC/階段のフロアペア。
実行: リポジトリルートで `python3 tools/floor_audit.py`
"""
import re
from collections import defaultdict, deque

src = open('main.js').read()

nodes = {}
for m in re.finditer(r"S\('(\w+)',\s*'[^']*',\s*'(S1|B1|B2)',", src):
    nodes[m.group(1)] = {'floor': m.group(2), 'zone': None, 'type': 'station'}
for m in re.finditer(r"P\('(\w+)',\s*'[^']*',\s*'(S1|B1|B2)',\s*[\d.]+,\s*[\d.]+,\s*'(\w+)'\)", src):
    nodes[m.group(1)] = {'floor': m.group(2), 'zone': m.group(3), 'type': 'poi'}
for m in re.finditer(r"J\('(\w+)',\s*[\d.]+,\s*[\d.]+(?:,\s*'(S1|B1|B2)')?\)", src):
    nodes[m.group(1)] = {'floor': m.group(2) or 'B1', 'zone': None, 'type': 'junction'}

em = re.search(r"const EDGES = \[(.*?)\n\];", src, re.S)
edges = []
for m in re.finditer(r"\['(\w+)',\s*'(\w+)',\s*([\d.]+)(?:,\s*'(\w+)')?\]", em.group(1)):
    if m.group(1) in nodes and m.group(2) in nodes:
        edges.append((m.group(1), m.group(2), float(m.group(3)), m.group(4)))

verts = []
for m in re.finditer(r"type:\s*'(ev|esc|stairs)',\s*a:\s*'(\w+)',\s*b:\s*'(\w+)'", src):
    verts.append((m.group(1), m.group(2), m.group(3)))
vert_pairs = {frozenset((a, b)) for _, a, b in verts}

# J ノードのゾーンを接続エッジの多数決で推定
inc = defaultdict(list)
for a, b, w, z in edges:
    if z:
        inc[a].append(z); inc[b].append(z)
for nid, nd in nodes.items():
    if nd['zone'] is None and inc[nid]:
        nd['zone'] = max(set(inc[nid]), key=inc[nid].count)

def zof(nid):
    return nodes[nid]['zone'] or '(通路)'

# --- 1. 歩行レベル成分(水平エッジのみ) ---
adj = defaultdict(set)
for a, b, w, z in edges:
    if frozenset((a, b)) in vert_pairs:
        continue  # 昇降設備は使わない
    adj[a].add(b); adj[b].add(a)
seen = set(); comps = []
for nid in nodes:
    if nid in seen:
        continue
    comp = []; q = deque([nid]); seen.add(nid)
    while q:
        u = q.popleft(); comp.append(u)
        for v in adj[u]:
            if v not in seen:
                seen.add(v); q.append(v)
    comps.append(comp)
comps.sort(key=len, reverse=True)

print('=' * 70)
print('【1】歩行レベル成分(階段/ESC/EVを使わず歩ける範囲)')
print('=' * 70)
for i, comp in enumerate(comps):
    floors = defaultdict(int)
    zones = defaultdict(int)
    for nid in comp:
        floors[nodes[nid]['floor']] += 1
        zones[zof(nid)] += 1
    ztxt = ', '.join(f'{z}({n})' for z, n in sorted(zones.items(), key=lambda x: -x[1]))
    flag = '  ★B1/B2混在=方針A矛盾' if len(floors) > 1 else ''
    if len(comp) == 1 and nodes[comp[0]]['type'] == 'station':
        continue  # 孤立した駅ノードは別扱い(下で表示)
    print(f'成分{i}: {len(comp)}ノード  floor={dict(floors)}{flag}')
    print(f'   ゾーン: {ztxt}')
    if len(comp) <= 6:
        print(f'   nodes: {comp}')

print()
print('=' * 70)
print('【2】不可能エッジ(フロアが違うのに昇降設備が無い=瞬間移動)')
print('=' * 70)
bad = 0
for a, b, w, z in edges:
    if nodes[a]['floor'] != nodes[b]['floor'] and frozenset((a, b)) not in vert_pairs:
        bad += 1
        print(f'  {a}({nodes[a]["floor"]}) ─ {b}({nodes[b]["floor"]})  zone={z}')
if not bad:
    print('  なし')

print()
print('=' * 70)
print('【3】施設間接続の棚卸し(ゾーンをまたぐ接続。どの面で繋がっているか)')
print('=' * 70)
inter = []
for a, b, w, z in edges:
    za, zb = zof(a), zof(b)
    if za != zb and za != '(通路)' and zb != '(通路)':
        inter.append((za, nodes[a]['floor'], a, zb, nodes[b]['floor'], b))
for za, fa, a, zb, fb, b in sorted(inter):
    same = '同一面' if fa == fb else '★フロア相違'
    print(f'  {za}[{fa}] ─ {zb}[{fb}]  ({same})   {a}─{b}')
if not inter:
    print('  (ゾーン間直結エッジなし=通路ノード経由)')

print()
print('=' * 70)
print('【4】昇降設備の一覧(EV/ESC/階段)')
print('=' * 70)
for t, a, b in sorted(verts):
    print(f'  {t:6s} {a}({nodes[a]["floor"]}) ⇅ {b}({nodes[b]["floor"]})')

print()
print('=' * 70)
print('【注目】ホワイティ面と三番街の接続')
print('=' * 70)
whity_nodes = [n for n in nodes if zof(n) == 'whity']
wf = defaultdict(int)
for n in whity_nodes:
    wf[nodes[n]['floor']] += 1
print(f'  ホワイティ(whity)ゾーンのノードのフロア: {dict(wf)}')
for a, b, w, z in edges:
    if {zof(a), zof(b)} == {'whity', 'sanban'} or (('sanban' in (zof(a), zof(b))) and ('whity' in (z or ''))):
        print(f'  三番街↔ホワイティ接続: {a}({nodes[a]["floor"]}) ─ {b}({nodes[b]["floor"]})  edge_zone={z}')
