// 詳細地図(ガイド座標系)を手で直すためのベクタ書き出し(施設ごとに SVG と EPS)。
// 使い方: node tools/export_detail_vector.mjs → docs/export/detail/<施設ID>.svg / .eps
// 座標はその施設のガイド座標(m)のまま(1 単位 = 1m、x=東、y=南。EPS は y を反転)。
// 層: floor(床の外形と穴) / blocks(区画。店が付いた区画は施設色、空きは灰) / shops(店名ラベル) / links(他施設への接続の矢印と文字) / anchors(エリア代表点)
// 直した SVG を返してもらったら、<g id="floor"> と <g id="blocks"> の <path>/<polygon> をガイド座標のまま読み戻せる。
import { writeFileSync, mkdirSync } from 'node:fs';
// detail_maps.js は ESM(型宣言の無いリポジトリなので node からは直接読めない)。先に esbuild で束ねる:
//   npx esbuild detail_maps.js --bundle --format=esm --outfile=tools/_debug/detail_maps_bundle.mjs && node tools/export_detail_vector.mjs
import { DETAIL_MAPS } from './_debug/detail_maps_bundle.mjs';

const OUT = new URL('../docs/export/detail/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ZONE_COLOR = { whity: '#e6c84a', avanza: '#9a8f52', dotica: '#5fae6e', dojima_flat: '#3f9a6e', kanden: '#3a78c2', links: '#e07ad0', sanban: '#e8963c', kiyo: '#7a6bc9' };
const inPoly = (x, y, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const P = pts => pts.map(([x, y]) => `${x},${y}`).join(' ');
const D = (ext, holes = []) => 'M' + ext.map(([x, y]) => `${x} ${y}`).join(' L') + ' Z' + holes.map(h => ' M' + h.map(([x, y]) => `${x} ${y}`).join(' L') + ' Z').join('');
const eps = pts => pts.map(([x, y], i) => `${x.toFixed(1)} ${y.toFixed(1)} ${i ? 'l' : 'm'}`).join(' ') + ' cp';

for (const [key, M] of Object.entries(DETAIL_MAPS)) {
  const zone = M.zone || key, col = ZONE_COLOR[zone] || '#888';
  const name = M.name || key;
  // 範囲
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of M.FLOOR) for (const [x, y] of f.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  for (const L of M.links || []) { const [dx, dy] = L.dir || [0, -1]; x0 = Math.min(x0, L.g[0] + (dx < -0.3 ? -45 : -12)); y0 = Math.min(y0, L.g[1] - 12); x1 = Math.max(x1, L.g[0] + (dx > 0.3 ? 45 : 12)); y1 = Math.max(y1, L.g[1] + 12); } // 接続ラベルの文字が入るように
  x0 = Math.floor(x0 - 10); y0 = Math.floor(y0 - 10); x1 = Math.ceil(x1 + 10); y1 = Math.ceil(y1 + 10);
  // 区画 → 店名(REAL_POS の点が入る区画)
  const shopsOf = M.BLOCKS.map(() => []);
  for (const [sname, [gx, gy]] of Object.entries(M.REAL_POS)) {
    let bi = M.BLOCKS.findIndex(b => inPoly(gx, gy, b.g));
    if (bi < 0) { let best = 4; M.BLOCKS.forEach((b, i) => { const cx = b.g.reduce((s, p) => s + p[0], 0) / b.g.length, cy = b.g.reduce((s, p) => s + p[1], 0) / b.g.length; const d = Math.hypot(cx - gx, cy - gy); if (d < best) { best = d; bi = i; } }); }
    if (bi >= 0) shopsOf[bi].push(sname);
  }
  const SC = 4; // 1m = 4px の表示サイズ
  const S = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" width="${(x1 - x0) * SC}" height="${(y1 - y0) * SC}">`,
    `<title>${esc(name)} 詳細地図(ガイド座標: 1単位=1m, x=東, y=南)</title>`,
    `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#f4f4f4"/>`,
    `<g id="floor" fill="${col}" fill-opacity="0.25" stroke="${col}" stroke-width="0.3">`];
  for (const f of M.FLOOR) S.push(`  <path fill-rule="evenodd" d="${D(f.pts, f.holes)}"/>`);
  S.push('</g>', '<g id="blocks" stroke="#333" stroke-width="0.15">');
  M.BLOCKS.forEach((b, i) => {
    const occ = shopsOf[i].length > 0;
    const title = [b.no ? `区画${b.no}` : '', b.name || '', b.mall || '', ...shopsOf[i]].filter(Boolean).join(' / ');
    S.push(`  <polygon points="${P(b.g)}" fill="${occ ? col : '#b0b6c0'}" fill-opacity="${occ ? 0.8 : 0.5}" data-no="${esc(b.no || '')}" data-mall="${esc(b.mall || '')}"><title>${esc(title)}</title></polygon>`);
  });
  S.push('</g>', '<g id="shops" font-size="1.6" fill="#222">');
  M.BLOCKS.forEach((b, i) => {
    if (!shopsOf[i].length && !b.no) return;
    const cx = b.g.reduce((s, p) => s + p[0], 0) / b.g.length, cy = b.g.reduce((s, p) => s + p[1], 0) / b.g.length;
    const label = shopsOf[i].length ? shopsOf[i].join('・') : `#${b.no}`;
    S.push(`  <text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${esc(label)}</text>`);
  });
  S.push('</g>', '<g id="links" fill="#c8901a" stroke="#c8901a" font-size="2.2" font-weight="bold">');
  for (const L of M.links || []) {
    const [gx, gy] = L.g; let [dx, dy] = L.dir || [0, -1]; const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
    const tip = [gx + dx * 4, gy + dy * 4], l = [gx - dy * 1.5, gy + dx * 1.5], r = [gx + dy * 1.5, gy - dx * 1.5];
    S.push(`  <polygon points="${P([tip, l, r])}" stroke="none"><title>${esc(L.to)}</title></polygon>`);
    S.push(`  <text x="${(gx + dx * 6).toFixed(1)}" y="${(gy + dy * 6).toFixed(1)}" stroke="none" text-anchor="${dx > 0.3 ? 'start' : dx < -0.3 ? 'end' : 'middle'}">➜ ${esc(L.to)}</text>`);
  }
  S.push('</g>', '<g id="anchors" fill="#d33">');
  for (const [area, [ax, ay]] of Object.entries(M.AREA_ANCHORS || {})) S.push(`  <circle cx="${ax}" cy="${ay}" r="0.8"><title>エリア代表点 ${esc(area)}</title></circle>`);
  S.push('</g>', `<g id="legend" font-size="2.5" fill="#333"><text x="${x0 + 2}" y="${y0 + 4}">${esc(name)}  ガイド座標(1単位=1m, x=東, y=南)。色付き区画=店が特定できた区画、灰=空き/未対応。矢印=他施設への接続</text></g>`, '</svg>');
  writeFileSync(OUT + key + '.svg', S.join('\n'));
  // EPS(1m = 4pt、y 反転)
  const hex = c => [1, 3, 5].map(i => (parseInt(c.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
  const E = ['%!PS-Adobe-3.0 EPSF-3.0', `%%BoundingBox: 0 0 ${(x1 - x0) * SC} ${(y1 - y0) * SC}`, `%%Title: ${name} (guide coords, 1pt = 0.25m)`, '%%EndComments',
    '/m {moveto} def /l {lineto} def /cp {closepath} def /f {fill} def /s {stroke} def /rgb {setrgbcolor} def',
    `${SC} ${SC} scale ${-x0} ${y1} translate 1 -1 scale`, '% ---- floor ----', `${hex(col)} rgb 0.2 setlinewidth`];
  for (const f of M.FLOOR) E.push(eps(f.pts) + ' ' + (f.holes || []).map(eps).join(' ') + ' gsave 0.9 0.9 0.9 rgb eofill grestore s');
  E.push('% ---- blocks ----');
  M.BLOCKS.forEach((b, i) => { E.push(`% block ${b.no || ''} ${b.mall || ''} ${shopsOf[i].join('/')}`); E.push(`${shopsOf[i].length ? hex(col) : '0.7 0.72 0.75'} rgb ` + eps(b.g) + ' f'); });
  E.push('% ---- links ----', '0.78 0.56 0.1 rgb');
  for (const L of M.links || []) { const [gx, gy] = L.g; let [dx, dy] = L.dir || [0, -1]; const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n; E.push(`% link ${L.to}`); E.push(eps([[gx + dx * 4, gy + dy * 4], [gx - dy * 1.5, gy + dx * 1.5], [gx + dy * 1.5, gy - dx * 1.5]]) + ' f'); }
  E.push('%%EOF');
  writeFileSync(OUT + key + '.eps', E.join('\n'));
  console.log(key, name, 'floor', M.FLOOR.length, 'blocks', M.BLOCKS.length, 'shops', Object.keys(M.REAL_POS).length, 'links', (M.links || []).length);
}
