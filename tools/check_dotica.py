"""Check the source's Dotica outline, central aisle and building connections."""
from pathlib import Path
import re, json
from shapely.geometry import Polygon, LineString, Point
src = (Path(__file__).resolve().parent.parent / 'main.js').read_text()
nodes = {}
for m in re.finditer(r"(?:J|P)\('([^']+)',\s*(?:'[^']*',\s*'(?:B1|B2|S1)',\s*)?([-\d.]+),\s*([-\d.]+)", src):
    nodes[m[1]] = [float(m[2]), float(m[3])]
line = next(l for l in src.splitlines() if "floor: 'B1', zone: 'dotica', pts:" in l)
pts = json.loads(re.search(r'pts: (\[\[.*?\]\])', line)[1])
hole_match = re.search(r'holes: (\[.*?\]), covers:', line)
holes = json.loads(hole_match[1]) if hole_match else []
covers = re.findall(r"\['([^']+)'\s*,\s*'([^']+)'\]", line.split('covers:')[1])
poly = Polygon(pts, holes)
assert poly.is_valid and poly.area > 0
assert len(covers) == 26
for a,b in covers:
    assert poly.buffer(.02).covers(LineString([nodes[a],nodes[b]])), (a,b,'off floor')
# Straight north aisle, one eastward bend in the south; no final westward kink.
north = ['dotica_02','dotica_c61','dojima','dotica_avz_n','dotica_avz_c','dotica_c83','dotica_bend']
axis=LineString([nodes[north[0]],nodes[north[-1]]])
assert all(axis.distance(Point(nodes[n])) < .02 for n in north)
south=['dotica_bend','dotica_01','avanza','dotica_c92','dotica_03']
assert all(nodes[b][0]>nodes[a][0] and nodes[b][1]>nodes[a][1] for a,b in zip(south,south[1:]))
# These connections must stay reachable without adding exits to the ground.
adj={}
for a,b in covers:
    adj.setdefault(a,[]).append(b); adj.setdefault(b,[]).append(a)
seen=set(); todo=['dotica_02']
while todo:
    n=todo.pop()
    if n in seen: continue
    seen.add(n); todo.extend(adj.get(n,[]))
assert {'j_sone_w','kanden_b2','j_avz_n','avz_c_in','j_avz_s','dojima_flat','kiyo_b1'} <= seen
print('OK: Dotica floor valid; 26 route segments inside; straight/bend geometry and all building connections verified.')

# A centreline-only check misses wedge-shaped cuts at bends. Require the full
# walking width, including both corners, for each continuous building connector.
from collections import defaultdict
edge_widths={(a,b):float(w) for a,b,w in re.findall(r"\['([^']+)',\s*'([^']+)',\s*([\d.]+),\s*'dotica'\]", src)}
main_nodes=set(north+south)
incident=defaultdict(list)
for (a,b),w in edge_widths.items():
    if a in main_nodes and b in main_nodes: continue
    required=LineString([nodes[a],nodes[b]]).buffer(w/2,cap_style=2)
    assert poly.buffer(.00001).covers(required),(a,b,'corridor width is cut away')
    incident[a].append((b,w));incident[b].append((a,w))
count=0
for at,es in incident.items():
    if len(es)!=2 or es[0][1]!=es[1][1]:continue
    (a,w),(b,_)=es
    joint=LineString([nodes[a],nodes[at],nodes[b]]).buffer(w/2,cap_style=2,join_style=2)
    assert poly.buffer(.00001).covers(joint),(at,'open corner / slit at junction')
    count+=1
print(f'OK: full-width connectors and {count} continuous bend/straight joints have no slit.')

# Same-height overlapping slabs create the jagged/flickering triangles seen at
# building entrances. Check actual exported floor polygons, not mesh heights.
for m in re.finditer(r"floor: 'B1', zone: '(\w+)', pts: (\[\[.*?\]\])(?:, holes: (\[.*?\]))?, covers:",src):
    if m[1]=='dotica':continue
    other=Polygon(json.loads(m[2]),json.loads(m[3]) if m[3] else [])
    assert poly.intersection(other).area<.0001,(m[1],'overlapping coplanar floor')
print('OK: no coplanar floor overlap at Dotica building entrances.')
