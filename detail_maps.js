// 詳細地図(ガイド座標系)を持つ施設の登録表。main.js はここだけを見る。
// 各施設の FLOOR / BLOCKS / REAL_POS / AREA_ANCHORS / WALK は tools/gen_detail_*.py が生成した detail_<zone>.js から。
// origin: 広域(実座標)と重ならない専用エリアのワールド座標オフセット。施設ごとに離して置き、互いにも重ねない
import { WHITY_FLOOR, WHITY_WALK, WHITY_BLOCKS, WHITY_REAL_POS, WHITY_AREA_ANCHORS } from './detail_whity.js';
import { AVANZA_FLOOR, AVANZA_WALK, AVANZA_BLOCKS, AVANZA_REAL_POS, AVANZA_AREA_ANCHORS } from './detail_avanza.js';
import * as SNB1 from './detail_sanban_n_b1.js';
import * as SNB2 from './detail_sanban_n_b2.js';

// 施設が館×階に分かれる場合(三番街)は、zone を共有しつつ areas(shops.js のエリアID)で詳細地図を分ける。
// floor は描画する高さ(三番街B1F=浅層S1、B2F=中枢層B1)。name は詳細バーの表示名
const sanban = (m, p, areas, floor, name, origin) => ({
  FLOOR: m[p + '_FLOOR'], WALK: m[p + '_WALK'], BLOCKS: m[p + '_BLOCKS'], REAL_POS: m[p + '_REAL_POS'], AREA_ANCHORS: m[p + '_AREA_ANCHORS'],
  zone: 'sanban', areas, floor, name, origin,
});

export const DETAIL_MAPS = {
  sanban_n_b1: sanban(SNB1, 'SANBAN_N_B1', ['sanban_n_b1'], 'S1', '阪急三番街 北館B1F', [1600, 500]), // ガイド座標 0〜70 / 0〜42 → world z 500〜521
  sanban_n_b2: sanban(SNB2, 'SANBAN_N_B2', ['sanban_n_b2'], 'B1', '阪急三番街 北館B2F', [1600, 560]),
  whity:  { FLOOR: WHITY_FLOOR,  WALK: WHITY_WALK,  BLOCKS: WHITY_BLOCKS,  REAL_POS: WHITY_REAL_POS,  AREA_ANCHORS: WHITY_AREA_ANCHORS,  origin: [1600, 0] },   // ガイド座標 x -80〜200 / y -250〜90 → world x 1560〜1700 / z -125〜45
  avanza: { FLOOR: AVANZA_FLOOR, WALK: AVANZA_WALK, BLOCKS: AVANZA_BLOCKS, REAL_POS: AVANZA_REAL_POS, AREA_ANCHORS: AVANZA_AREA_ANCHORS, origin: [1600, 300] }, // ガイド座標 0〜60 / 0〜72 → world z 300〜336(ホワイティの南、重ならない)
};
