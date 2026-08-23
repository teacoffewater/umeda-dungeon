// ランドマーク(目印)と写真。現地調査の記録(?survey=1 の「目印」「店」「階段」など)と写真から手で追記する。
//
// LANDMARKS: マップに金色の目印として表示し、案内文でも曲がり角の目印に使う。
//   { id, name, floor: 'S1'|'B1'|'B2'(内部フロア), mx, my(メートル座標), zone?, photo?: 'photos/xxx.jpg', note? }
// PHOTOS: ノードID(店・スポット・駅・ランドマークのid、上下接続は 'v:' + name)→ 写真の配列。
//   { file: 'photos/xxx.jpg', caption?: '…' }
// 写真は長辺800px・100KB程度に縮小して photos/ に置く(tools/add_photos.py 参照)。

export const LANDMARKS = [
  { id: 'lm_bigman', name: 'BIGMAN(大型ビジョン)', floor: 'S1', mx: 965, my: 606.4, zone: 'sanban', note: '阪急三番街 北館B1F。待ち合わせの定番' },
  // --- 西梅田(ガーデンアベニュー南西端)。現地調査 2026-08-23 (tools/data/survey/2026-08-23_nishi_umeda.json) ---
  { id: 'lm_exit_a1', name: '出口 A-1(階段→1F)', floor: 'B1', mx: 369.6, my: 1222.2, zone: 'nishi_umeda', note: 'ホテルモントレ大阪・エスタボート(クオール薬局・サイゼリヤ)へ上がる階段。位置は現地GPS。ガーデンアベニューから連絡通路(約99m)でつながる' },
  { id: 'lm_yellow_obj', name: '黄色い円形のオブジェ', floor: 'B1', mx: 346.3, my: 1357.3, zone: 'nishi_umeda' },
  { id: 'lm_ev_sw', name: 'EV(→1F)', floor: 'B1', mx: 330.5, my: 1395.4, zone: 'nishi_umeda', note: '地上1Fへのエレベーター' },
];

export const PHOTOS = {
  // 例: shop_dotica_6: [{ file: 'photos/dotica_indian_curry.jpg', caption: 'インデアンカレー 堂島店の入口' }],
};
