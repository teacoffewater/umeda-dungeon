// ランドマーク(目印)と写真。現地調査の記録(?survey=1 の「目印」「店」「階段」など)と写真から手で追記する。
//
// LANDMARKS: マップに金色の目印として表示し、案内文でも曲がり角の目印に使う。
//   { id, name, floor: 'S1'|'B1'|'B2'(内部フロア), mx, my(メートル座標), zone?, photo?: 'photos/xxx.jpg', note? }
// PHOTOS: ノードID(店・スポット・駅・ランドマークのid、上下接続は 'v:' + name)→ 写真の配列。
//   { file: 'photos/xxx.jpg', caption?: '…' }
// 写真は長辺800px・100KB程度に縮小して photos/ に置く(tools/add_photos.py 参照)。

export const LANDMARKS = [
  // --- 西梅田(ガーデンアベニュー南西端)。現地調査 2026-08-23 (tools/data/survey/2026-08-23_nishi_umeda.json) ---
  { id: 'lm_exit_a1', name: '出口 A-1(階段→1F)', floor: 'B1', mx: 369.6, my: 1222.2, zone: 'nishi_umeda', note: 'ホテルモントレ大阪・エスタボート(クオール薬局・サイゼリヤ)へ上がる階段。位置は現地GPS。ガーデンアベニューから連絡通路(約99m)でつながる' },
  { id: 'lm_yellow_obj', name: '黄色い円形のオブジェ', floor: 'B1', mx: 236.5, my: 1420.0, zone: 'nishi_umeda',
    photo: 'photos/yellow_object.jpg', note: '出口6-1(左)と6-2(右)のY字路の股にある黄色い円形の金属オブジェ(KALEIDOSCOPE)。タップ位置(346,1357)は写真により分岐点へ補正' },
  { id: 'lm_esc_6_1', name: '上りエスカレーター(→1F)', floor: 'B1', mx: 224.4, my: 1434.1, zone: 'nishi_umeda', note: '出口6-1、地下側から見て右側。上り専用(現地確認 2026-08-23)' },
];

export const PHOTOS = {
  lm_yellow_obj: [
    { file: 'photos/yellow_object.jpg', caption: '黄色い円形のオブジェ(正面)' },
    { file: 'photos/yellow_object_y.jpg', caption: 'Y字路: 左が出口6-1、右が出口6-2' },
    { file: 'photos/garden_avenue_sw.jpg', caption: 'リッツ側からY字路方向を見る' },
  ],
  // 例: shop_dotica_6: [{ file: 'photos/dotica_indian_curry.jpg', caption: 'インデアンカレー 堂島店の入口' }],
};
