// 詳細地図(ガイド座標系)を持つ施設の登録表。main.js はここだけを見る。
// 各施設の FLOOR / BLOCKS / REAL_POS / AREA_ANCHORS / WALK は tools/gen_detail_*.py が生成した detail_<zone>.js から。
// origin: 広域(実座標)と重ならない専用エリアのワールド座標オフセット。施設ごとに離して置き、互いにも重ねない
import { WHITY_FLOOR, WHITY_WALK, WHITY_BLOCKS, WHITY_REAL_POS, WHITY_AREA_ANCHORS } from './detail_whity.js';

export const DETAIL_MAPS = {
  whity: { FLOOR: WHITY_FLOOR, WALK: WHITY_WALK, BLOCKS: WHITY_BLOCKS, REAL_POS: WHITY_REAL_POS, AREA_ANCHORS: WHITY_AREA_ANCHORS, origin: [1600, 0] },
};
