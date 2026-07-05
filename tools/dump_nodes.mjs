// placeShops()をポートして店舗の算出位置をJSONで出力する
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
// shops.jsはESM構文だが拡張子.jsのままCJS扱いされるため、.mjsに複製してから読み込む
copyFileSync(new URL('../shops.js', import.meta.url), new URL('./_shops_tmp.mjs', import.meta.url));
const { SHOP_AREAS, SHOPS_SCRAPED, SHOPS_MANUAL } = await import(new URL('./_shops_tmp.mjs', import.meta.url).href);

const src = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const NODES = [];
for (const m of src.matchAll(/S\('(\w+)',\s*'([^']*)',\s*'(B1|B2)',\s*(-?[\d.]+),\s*(-?[\d.]+)\)/g))
  NODES.push({ id: m[1], name: m[2], floor: m[3], mx: +m[4], my: +m[5], type: 'station' });
for (const m of src.matchAll(/P\('(\w+)',\s*'([^']*)',\s*'(B1|B2)',\s*(-?[\d.]+),\s*(-?[\d.]+),\s*'(\w+)'\)/g))
  NODES.push({ id: m[1], name: m[2], floor: m[3], mx: +m[4], my: +m[5], zone: m[6], type: 'poi' });
for (const m of src.matchAll(/J\('(\w+)',\s*(-?[\d.]+),\s*(-?[\d.]+)(?:,\s*'(B1|B2)')?\)/g))
  NODES.push({ id: m[1], name: '', floor: m[4] || 'B1', mx: +m[2], my: +m[3], type: 'junction' });
const em = src.match(/const EDGES = \[([\s\S]*?)\n\];/);
const EDGES = [];
for (const m of em[1].matchAll(/\['(\w+)',\s*'(\w+)',\s*([\d.]+)(?:,\s*'(\w+)')?\]/g))
  EDGES.push([m[1], m[2], +m[3], m[4] || '_neutral']);

let seq = 0;
for (const s of SHOPS_MANUAL || [])
  NODES.push({ id: `shop_m${seq++}`, name: s.name, floor: s.floor, mx: s.mx, my: s.my, zone: s.zone, type: 'shop' });
const nodeMap = {};
for (const n of NODES) nodeMap[n.id] = n;
const edgeWpx = {};
for (const [a, b, w] of EDGES) { edgeWpx[`${a}|${b}`] = w; edgeWpx[`${b}|${a}`] = w; }
const byArea = {};
for (const s of SHOPS_SCRAPED) (byArea[s.area] ||= []).push(s);
for (const [areaId, shops] of Object.entries(byArea)) {
  const a = SHOP_AREAS[areaId];
  if (!a) continue;
  if (a.rect) {
    const [cx, cy, rw, rd] = a.rect;
    const CD = { '北西': [-1,-1], '北': [0,-1], '北東': [1,-1], '西': [-1,0], '中央': [0,0],
                 '東': [1,0], '南西': [-1,1], '南': [0,1], '南東': [1,1] };
    const byCell = {};
    for (const sh of shops) (byCell[sh.cell || '中央'] ||= []).push(sh);
    let seq2 = 0;
    for (const [cell, cellShops] of Object.entries(byCell)) {
      const c = CD[cell] || [0, 0];
      const bx = cx + c[0] * rw / 3, by = cy + c[1] * rd / 3;
      const rows = Math.ceil(cellShops.length / 3);
      cellShops.forEach((sh, k) => {
        NODES.push({ id: `shop_${areaId}_${seq2++}`, name: sh.name, floor: a.floor,
          mx: bx + (k % 3 - 1) * 6.5, my: by + (Math.floor(k / 3) - (rows - 1) / 2) * 6.5,
          zone: a.zone, area: areaId, type: 'shop' });
      });
    }
    continue;
  }
  const segs = [];
  let total = 0;
  if (a.edges) {
    for (const [ia, ib] of a.edges) {
      const na = nodeMap[ia], nb = nodeMap[ib];
      const w = edgeWpx[`${ia}|${ib}`] || 8;
      const len = Math.hypot(nb.mx - na.mx, nb.my - na.my);
      segs.push({ x1: na.mx, y1: na.my, x2: nb.mx, y2: nb.my, len, off: Math.max(2.5, w / 2 - 3) });
      total += len;
    }
  } else {
    for (let i = 0; i < a.path.length - 1; i++) {
      const [x1, y1] = a.path[i], [x2, y2] = a.path[i + 1];
      const len = Math.hypot(x2 - x1, y2 - y1);
      segs.push({ x1, y1, x2, y2, len, off: a.offset ?? 10 });
      total += len;
    }
  }
  const list = shops.some(s => s.order != null)
    ? shops.slice().sort((p, q) => (p.order ?? 999) - (q.order ?? 999)) : shops;
  const sideSign = (side, nx, ny) => {
    if (!side) return null;
    let score = 0;
    for (const ch of side) {
      if (ch === '北') score += -ny; else if (ch === '南') score += ny;
      else if (ch === '東') score += nx; else if (ch === '西') score += -nx;
    }
    return score > 0 ? 1 : score < 0 ? -1 : null;
  };
  list.forEach((s, i) => {
    const t = ((i + 0.5) / list.length) * total;
    let acc = 0, px = segs[0].x1, py = segs[0].y1, dx = 1, dy = 0, off = segs[0].off;
    for (const sg of segs) {
      if (t <= acc + sg.len) {
        const u = (t - acc) / sg.len;
        px = sg.x1 + (sg.x2 - sg.x1) * u; py = sg.y1 + (sg.y2 - sg.y1) * u;
        dx = (sg.x2 - sg.x1) / sg.len; dy = (sg.y2 - sg.y1) / sg.len; off = sg.off;
        break;
      }
      acc += sg.len;
    }
    const side = sideSign(s.side, -dy, dx) ?? (i % 2 === 0 ? 1 : -1);
    NODES.push({ id: `shop_${areaId}_${i}`, name: s.name, floor: a.floor,
      mx: px - dy * off * side, my: py + dx * off * side, zone: a.zone, area: areaId, type: 'shop' });
  });
}
writeFileSync(new URL('./nodes_dump.json', import.meta.url),
  JSON.stringify({ nodes: NODES, edges: EDGES }));
const shopsN = NODES.filter(n => n.type === 'shop').length;
console.log('nodes:', NODES.length, 'shops:', shopsN, 'edges:', EDGES.length);
