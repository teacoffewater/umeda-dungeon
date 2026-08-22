// 座標の土台(metric-v1)。tools/data/frame.json と同じ値を持つ(tools/geo.py が一致を検査する)
// mx,my = 原点からの東向き・南向きのメートル(北が上)。数値1 = 1m(小数可)
export const FRAME = {
  name: 'metric-v1',
  lat0: 34.702,
  lon0: 135.497,
  ox: 843.39,
  oy: 944.35,
};
const KX = 111320 * Math.cos(FRAME.lat0 * Math.PI / 180); // 1度の経度 ≒ この距離(m)
const KY = 110950;                                          // 1度の緯度 ≒ 110950m

// 緯度経度 → [mx, my]
export function ll2m(lat, lon) {
  return [(lon - FRAME.lon0) * KX + FRAME.ox, -(lat - FRAME.lat0) * KY + FRAME.oy];
}
// [mx, my] → [lat, lon]
export function m2ll(mx, my) {
  return [FRAME.lat0 - (my - FRAME.oy) / KY, FRAME.lon0 + (mx - FRAME.ox) / KX];
}
