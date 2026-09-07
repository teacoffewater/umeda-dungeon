"""Rebuild reference-corrected Dotica with continuous, mitered connector runs.
The shop-map outline stays in its own coordinates. Transform only its overview
copy; retain all surveyed building-side endpoints and original corridor widths.
"""
from pathlib import Path
import json, re, math
from collections import defaultdict
from shapely.geometry import Polygon, LineString, MultiPoint
from shapely.ops import unary_union
ROOT = Path(__file__).resolve().parent.parent
src = (ROOT / 'main.js').read_text()
path = ROOT / 'tools/data/dotica_reference_correction.json'
data = json.loads(path.read_text())
t = data['transform']
def world(p):
    x,y=p
    return [round(t['origin'][0]+t['scale']*(x+t['north_shear']*y),2), round(t['origin'][1]+t['scale']*y,2)]
outline = json.loads(re.search(r'export const DOTICA_FLOOR = (\[.*\]);', (ROOT/'detail_dotica.js').read_text())[1])
base=unary_union([Polygon([world(p) for p in f['pts']], [[world(p) for p in h] for h in f.get('holes',[])]) for f in outline])
nodes={}
for m in re.finditer(r"(?:J|P)\('([^']+)',\s*(?:'[^']*',\s*'(?:B1|B2|S1)',\s*)?([-\d.]+),\s*([-\d.]+)",src):
    nodes[m[1]]=(float(m[2]),float(m[3]))
edges=[(a,b,float(w)) for a,b,w in re.findall(r"\['([^']+)',\s*'([^']+)',\s*([\d.]+),\s*'dotica'\]",src)]
main=set(data['nodes'])
branches=[(a,b,w) for a,b,w in edges if not (a in main and b in main)]
by_width=defaultdict(list)
for a,b,w in branches: by_width[w].append((a,b))
parts=[base]
# Traverse connected runs by node IDs (never connect merely nearby endpoints).
# Buffer the whole run so both sides of each bend meet at the same miter.
for width, es in by_width.items():
    adj=defaultdict(list)
    for i,(a,b) in enumerate(es): adj[a].append((i,b));adj[b].append((i,a))
    used=set()
    def walk(start,i,nxt):
        run=[start]
        while i not in used:
            used.add(i);run.append(nxt)
            if len(adj[nxt])!=2: break
            options=[v for v in adj[nxt] if v[0] not in used]
            if not options:break
            i,nxt=options[0]
        return run
    for start in [n for n in adj if len(adj[n])!=2]+list(adj):
        for i,nxt in adj[start]:
            if i in used:continue
            run=walk(start,i,nxt)
            parts.append(LineString([nodes[n] for n in run]).buffer(width/2, cap_style=2, join_style=2))
# Continuous junctions where a run changes width or branches into multiple runs.
ends=defaultdict(list)
for a,b,w in branches:
    for at,to in [(a,b),(b,a)]:
        x,y=nodes[at];tx,ty=nodes[to];length=math.hypot(tx-x,ty-y)
        dx,dy=-(ty-y)/length*w/2,(tx-x)/length*w/2
        ends[at].extend([(x+dx,y+dy),(x-dx,y-dy)])
for pts in ends.values():
    if len(pts)>2:parts.append(MultiPoint(pts).convex_hull)
floor=unary_union(parts)
assert floor.geom_type=='Polygon' and floor.is_valid
ring=lambda r:[[round(x,6),round(y,6)] for x,y in list(r.coords)[:-1]]
data['floor']=ring(floor.exterior);data['holes']=[ring(h) for h in floor.interiors]
data['junction_method']='Buffer connected runs with miter joins; join width changes by endpoint cross-sections. 2026-09-07.'
path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
for name in ['main.js','tools/floor_polys_generated.js']:
    p=ROOT/name;s=p.read_text()
    def replace(m):
        return m[1]+json.dumps(data['floor'],separators=(',',':'))+', holes: '+json.dumps(data['holes'],separators=(',',':'))+', covers:'
    s,n=re.subn(r"(\{ floor: 'B1', zone: 'dotica', pts: )\[.*?\], holes: \[.*?\], covers:",replace,s)
    assert n==1,(name,n)
    p.write_text(s)
print('Rebuilt all Dotica connectors with continuous joins.')

# Coplanar building slabs must share a boundary, not overlap the connector.
# Equal-height overlapping surfaces otherwise produce flickering triangles.
import ast
from dotica_floor_partition import partition_dotica
pattern=r"^  \{ floor: '(\w+)', zone: '(\w+)', pts: (\[\[.*?\]\])(?:, holes: (\[.*?\]))?(?:, covers: (\[.*?\]))? \},?$"
for name in ['main.js','tools/floor_polys_generated.js']:
    p=ROOT/name;s=p.read_text()
    matches=list(re.finditer(pattern,s,re.M))
    entries=[{'floor':m[1],'zone':m[2],'pts':json.loads(m[3]),'holes':json.loads(m[4]) if m[4] else [],'covers':ast.literal_eval(m[5]) if m[5] else []} for m in matches]
    assert len(entries)>30
    parts=partition_dotica(entries)
    # Replace the whole data section while retaining the application's declaration.
    lines=[]
    for e in parts:
        original = next((m[0] for m, before in zip(matches, entries) if e == before), None)
        lines.append(original or ("  { floor: '%s', zone: '%s', pts: %s, holes: %s, covers: %s }," % (e['floor'],e['zone'],json.dumps(e['pts']),json.dumps(e['holes']),repr(e['covers']))))
    s=s[:matches[0].start()]+'\n'.join(lines)+s[matches[-1].end():]
    p.write_text(s)
print('Partitioned coplanar building floors: no overlapping surface triangles.')
