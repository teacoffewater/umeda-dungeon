// 詳細地図(ガイド座標系)を持つ施設の登録表。main.js はここだけを見る。
// 各施設の FLOOR / BLOCKS / REAL_POS / AREA_ANCHORS / WALK は tools/gen_detail_*.py が生成した detail_<zone>.js から。
// origin: 広域(実座標)と重ならない専用エリアのワールド座標オフセット。施設ごとに離して置き、互いにも重ねない
import { WHITY_FLOOR, WHITY_WALK, WHITY_BLOCKS, WHITY_REAL_POS, WHITY_AREA_ANCHORS } from './detail_whity.js';
import { AVANZA_FLOOR, AVANZA_WALK, AVANZA_BLOCKS, AVANZA_REAL_POS, AVANZA_AREA_ANCHORS } from './detail_avanza.js';

export const DETAIL_MAPS = {
  whity:  { FLOOR: WHITY_FLOOR,  WALK: WHITY_WALK,  BLOCKS: WHITY_BLOCKS,  REAL_POS: WHITY_REAL_POS,  AREA_ANCHORS: WHITY_AREA_ANCHORS,  origin: [1600, 0] },   // ガイド座標 x -80〜200 / y -250〜90 → world x 1560〜1700 / z -125〜45
  avanza: { FLOOR: AVANZA_FLOOR, WALK: AVANZA_WALK, BLOCKS: AVANZA_BLOCKS, REAL_POS: AVANZA_REAL_POS, AREA_ANCHORS: AVANZA_AREA_ANCHORS, origin: [1600, 300] }, // ガイド座標 0〜60 / 0〜72 → world z 300〜336(ホワイティの南、重ならない)
};
