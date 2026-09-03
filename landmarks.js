// ランドマーク(目印)と写真。現地調査の記録(?survey=1 の「目印」「店」「階段」など)と写真から手で追記する。
//
// LANDMARKS: マップに金色の目印として表示し、案内文でも曲がり角の目印に使う。
//   { id, name, floor, mx, my, zone?, photo?, note?,
//     vert?: 'ev'|'esc'|'stairs', to?: '→1F', dir?: [dx, dz](上り方向・world座標) }
//   pin: 'survey' を付けると本番ではピンもラベルも描かない(調査モード ?survey=1 でだけ描く)。案内文の目印としては使う。現地調査JSONから起こした点に付ける
//   vert を付けると地上(GROUND_Y)への昇降設備として VERTICALS と同じ立体(EVシャフト/ESCの帯と手すり/階段)で描く
//   kind: 'atrium'(吹き抜け=地下だが地上が見える空間)は rect: [[mx,my],[mx2,my2]](対角2点)で範囲を持つ。
//     本番(通常モード)では描かず、調査モード(?survey=1)でだけ床から地上まで抜ける半透明の柱で描く。
//     案内文の目印には使う。通路(ルート)にはしない。
//     frame: 'guide:<施設ID>' を付けると rect はその施設の詳細地図のガイド座標(m)で、詳細地図の中に描く(案内文には使わない)。
//     調査モードの種別「吹き抜け」(2点タップ)の記録から追記する
// PHOTOS: ノードID(店・スポット・駅・ランドマークのid、上下接続は 'v:' + name)→ 写真の配列。
//   { file: 'photos/xxx.jpg', caption?: '…' }
// 写真は長辺800px・100KB程度に縮小して photos/ に置く(tools/add_photos.py 参照)。

export const LANDMARKS = [
  // --- 西梅田(ガーデンアベニュー南西端)。現地調査 2026-08-23 (tools/data/survey/2026-08-23_nishi_umeda.json) ---
  { id: 'lm_yellow_obj', name: '黄色い円形のオブジェ', floor: 'B1', mx: 236.5, my: 1420.0, zone: 'nishi_umeda',
    photo: 'photos/yellow_object.jpg', note: '出口6-1(左)と6-2(右)のY字路の股にある黄色い円形の金属オブジェ(KALEIDOSCOPE)。タップ位置(346,1357)は写真により分岐点へ補正' },
  // --- ドーチカ⇔堂島ふらっと(近鉄堂島ビルB1F)の接続。現地の2点タップ 2026-09-03 (tools/data/survey/2026-09-03_dotica_dojima_flat.json) ---
  //     位置は地下近辺案内板(2026-09-03)の通路に合わせて置き直した(タップ位置は旧地図の通路基準だったため) ---
  { id: 'lm_dotica_df_stairs', pin: 'survey', name: '堂島ふらっとへの階段・ESC', floor: 'B1', mx: 663.8, my: 1532.8, zone: 'dotica',
    note: 'ドーチカ C83。ドーチカから見て左が階段(23段、約3.9m上り)、右に上り下り2本のエスカレーター。上がった先が近鉄堂島ビルB1F「堂島ふらっと」' },
  // --- ドーチカ⇔堂島アバンザの接続。現地の2点タップ 2026-09-03 (tools/data/survey/2026-09-03_dotica_avanza.json)。1段15cm ---
  { id: 'lm_dotica_avz_c', pin: 'survey', name: 'アバンザへの階段(7段→10m→17段)', floor: 'B1', mx: 718.3, my: 1516.3, zone: 'dotica',
    note: 'ドーチカからアバンザへ。7段上がって10m平坦、さらに17段上がる(合計3.6m)。アバンザ側から見ると17段下りて10m進み7段下りる' },
  { id: 'lm_dotica_avz_s', pin: 'survey', name: 'アバンザ南口の階段(10段)', floor: 'B1', mx: 720.4, my: 1544.1, zone: 'dotica',
    note: 'ドーチカ南側からアバンザの南側通路へ上がる10段(約1.5m)' },
  // --- 堂島ふらっとのサンクンガーデン(吹き抜け): ドーチカからの階段を上がった所と店の入口の間。案内板(2026-09-03)の右下、木2本と地上への曲線階段がある区画。
  //     広域の位置は階段の上(656,1533。地下近辺案内板 2026-09-03)の西〜南西に案内板の比率で置いた概略。詳細地図の位置は案内板の縮尺 ---
  { id: 'atr_dojima_flat', name: '堂島ふらっとの吹き抜け', kind: 'atrium', floor: 'B1', zone: 'dojima_flat', rect: [[642, 1527], [654, 1538]], note: 'ドーチカからの階段を上がった先のサンクンガーデン。ここを抜けて館内へ' },
  { id: 'atr_dojima_flat_g', name: 'サンクンガーデン', kind: 'atrium', floor: 'B1', zone: 'dojima_flat', frame: 'guide:dojima_flat', rect: [[26, 51], [42, 58]] },
  // --- 吹き抜け(堂島アバンザのサンクンガーデン2つ)。館内案内板(2026-09-03)から。広域の位置はビルとドーチカの間の地下広場
  //     (地下近辺案内板 2026-09-03 の桃色部分)の北端・南端に置いた概略、詳細地図の位置は案内板の縮尺。現地の調査モード「吹き抜け」で置き換える ---
  { id: 'atr_avanza_n', name: '北サンクンガーデン(吹き抜け)', kind: 'atrium', floor: 'B1', zone: 'avanza', rect: [[732, 1472], [750, 1486]], note: '堂島アバンザ北側の吹き抜け。ドーチカから北の階段を上がった通路の先' },
  { id: 'atr_avanza_s', name: '南サンクンガーデン(吹き抜け)', kind: 'atrium', floor: 'B1', zone: 'avanza', rect: [[730, 1510], [748, 1528]], note: '堂島アバンザ南側の吹き抜け。OUTBACKの西、曲線階段の所' },
  { id: 'atr_avanza_n_g', name: '北サンクンガーデン', kind: 'atrium', floor: 'B1', zone: 'avanza', frame: 'guide:avanza', rect: [[18, 1], [42, 10]] },
  { id: 'atr_avanza_s_g', name: '南サンクンガーデン', kind: 'atrium', floor: 'B1', zone: 'avanza', frame: 'guide:avanza', rect: [[18, 42], [36, 54]] },
  { id: 'lm_esc_6_1', name: 'エスカレーター(→1F、上り専用)', floor: 'B1', mx: 224.4, my: 1434.1, zone: 'nishi_umeda', vert: 'esc', to: '→1F', dir: [-7.60, 10.20], note: '出口6-1、地下側から見て右側。上り専用(現地確認 2026-08-23)' },
];

export const PHOTOS = {
  lm_yellow_obj: [
    { file: 'photos/yellow_object.jpg', caption: '黄色い円形のオブジェ(正面)' },
    { file: 'photos/yellow_object_y.jpg', caption: 'Y字路: 左が出口6-1、右が出口6-2' },
    { file: 'photos/garden_avenue_sw.jpg', caption: 'リッツ側からY字路方向を見る' },
  ],
  // 例: shop_dotica_6: [{ file: 'photos/dotica_indian_curry.jpg', caption: 'インデアンカレー 堂島店の入口' }],
};
