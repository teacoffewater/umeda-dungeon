"""Give connected, coplanar Dotica floors a single owner at each point."""
from shapely.geometry import Polygon

def partition_dotica(entries):
    reference = next(e for e in entries if e['floor']=='B1' and e['zone']=='dotica')
    corridor=Polygon(reference['pts'],reference.get('holes',[]))
    result=[]
    ring=lambda r:[[round(x,6),round(y,6)] for x,y in list(r.coords)[:-1]]
    for e in entries:
        p=Polygon(e['pts'],e.get('holes',[]))
        if e['floor']!='B1' or e['zone']=='dotica' or p.intersection(corridor).area<1e-4:
            result.append(e);continue
        cut=p.difference(corridor)
        pieces=[cut] if cut.geom_type=='Polygon' else list(cut.geoms)
        assert pieces and all(p.geom_type=='Polygon' and p.is_valid for p in pieces)
        for i,p in enumerate(pieces):
            result.append({**e,'pts':ring(p.exterior),'holes':[ring(h) for h in p.interiors],
                           'covers':e.get('covers',[]) if i==0 else []})
    return result
