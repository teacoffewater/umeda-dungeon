// ランドマーク(目印)と写真。現地調査の記録(?survey=1 の「目印」「店」「階段」など)と写真から手で追記する。
//
// LANDMARKS: マップに金色の目印として表示し、案内文でも曲がり角の目印に使う。
//   { id, name, floor: 'S1'|'B1'|'B2'(内部フロア), mx, my(メートル座標), zone?, photo?: 'photos/xxx.jpg', note? }
// PHOTOS: ノードID(店・スポット・駅・ランドマークのid、上下接続は 'v:' + name)→ 写真の配列。
//   { file: 'photos/xxx.jpg', caption?: '…' }
// 写真は長辺800px・100KB程度に縮小して photos/ に置く(tools/add_photos.py 参照)。

export const LANDMARKS = [
  { id: 'lm_bigman', name: 'BIGMAN(大型ビジョン)', floor: 'S1', mx: 965, my: 606.4, zone: 'sanban', note: '阪急三番街 北館B1F。待ち合わせの定番' },
];

export const PHOTOS = {
  // 例: shop_dotica_6: [{ file: 'photos/dotica_indian_curry.jpg', caption: 'インデアンカレー 堂島店の入口' }],
};
