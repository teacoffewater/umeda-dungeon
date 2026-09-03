// 詳細地図(ガイド座標系)を持つ施設の登録表。main.js はここだけを見る。
// 各施設の FLOOR / BLOCKS / REAL_POS / AREA_ANCHORS / WALK は tools/gen_detail_*.py が生成した detail_<zone>.js から。
// origin: 広域(実座標)と重ならない専用エリアのワールド座標オフセット。施設ごとに離して置き、互いにも重ねない
import { WHITY_FLOOR, WHITY_WALK, WHITY_BLOCKS, WHITY_REAL_POS, WHITY_AREA_ANCHORS } from './detail_whity.js';
import { AVANZA_FLOOR, AVANZA_WALK, AVANZA_BLOCKS, AVANZA_REAL_POS, AVANZA_AREA_ANCHORS } from './detail_avanza.js';
import * as SNB1 from './detail_sanban_n_b1.js';
import * as SNB2 from './detail_sanban_n_b2.js';
import * as SSB1 from './detail_sanban_s_b1.js';
import * as SSB2 from './detail_sanban_s_b2.js';
import { DOTICA_FLOOR, DOTICA_WALK, DOTICA_BLOCKS, DOTICA_REAL_POS, DOTICA_AREA_ANCHORS } from './detail_dotica.js';
import { DOJIMA_FLAT_FLOOR, DOJIMA_FLAT_WALK, DOJIMA_FLAT_BLOCKS, DOJIMA_FLAT_REAL_POS, DOJIMA_FLAT_AREA_ANCHORS } from './detail_dojima_flat.js';
import { KANDEN_B2_FLOOR, KANDEN_B2_WALK, KANDEN_B2_BLOCKS, KANDEN_B2_REAL_POS, KANDEN_B2_AREA_ANCHORS } from './detail_kanden_b2.js';

// 施設が館×階に分かれる場合(三番街)は、zone を共有しつつ areas(shops.js のエリアID)で詳細地図を分ける。
// floor は描画する高さ(三番街B1F=浅層S1、B2F=中枢層B1)。name は詳細バーの表示名
const sanban = (m, p, areas, floor, name, origin) => ({
  FLOOR: m[p + '_FLOOR'], WALK: m[p + '_WALK'], BLOCKS: m[p + '_BLOCKS'], REAL_POS: m[p + '_REAL_POS'], AREA_ANCHORS: m[p + '_AREA_ANCHORS'],
  zone: 'sanban', areas, floor, name, origin,
});

export const DETAIL_MAPS = {
  sanban_n_b1: sanban(SNB1, 'SANBAN_N_B1', ['sanban_n_b1'], 'S1', '阪急三番街 北館B1F', [1600, 500]), // ガイド座標 0〜70 / 0〜42 → world z 500〜521
  sanban_n_b2: sanban(SNB2, 'SANBAN_N_B2', ['sanban_n_b2'], 'B1', '阪急三番街 北館B2F', [1600, 560]),
  sanban_s_b1: sanban(SSB1, 'SANBAN_S_B1', ['sanban_s_b1'], 'S1', '阪急三番街 南館B1F', [1600, 620]),
  sanban_s_b2: sanban(SSB2, 'SANBAN_S_B2', ['sanban_s_b2'], 'B1', '阪急三番街 南館B2F', [1600, 690]),
  whity:  { FLOOR: WHITY_FLOOR,  WALK: WHITY_WALK,  BLOCKS: WHITY_BLOCKS,  REAL_POS: WHITY_REAL_POS,  AREA_ANCHORS: WHITY_AREA_ANCHORS,  origin: [1600, 0] },   // ガイド座標 x -80〜200 / y -250〜90 → world x 1560〜1700 / z -125〜45
  avanza: { FLOOR: AVANZA_FLOOR, WALK: AVANZA_WALK, BLOCKS: AVANZA_BLOCKS, REAL_POS: AVANZA_REAL_POS, AREA_ANCHORS: AVANZA_AREA_ANCHORS, origin: [1600, 300] }, // ガイド座標 0〜60 / 0〜72 → world z 300〜336(ホワイティの南、重ならない)
  // ドーチカ: 公式マップ(北を上に回転)。広域では北・中・南の3エリアの集約ドットが入口
  dotica: { FLOOR: DOTICA_FLOOR, WALK: DOTICA_WALK, BLOCKS: DOTICA_BLOCKS, REAL_POS: DOTICA_REAL_POS, AREA_ANCHORS: DOTICA_AREA_ANCHORS,
            zone: 'dotica', areas: ['dotica_n', 'dotica_c', 'dotica_s'], floor: 'B1', name: 'ドージマ地下センター', origin: [1600, 800] }, // ガイド座標 x -12〜40 / y 0〜290 → world z 800〜945
  // 堂島ふらっと(近鉄堂島ビルB1F): 現地の案内板から。ドーチカ C83 直結
  dojima_flat: { FLOOR: DOJIMA_FLAT_FLOOR, WALK: DOJIMA_FLAT_WALK, BLOCKS: DOJIMA_FLAT_BLOCKS, REAL_POS: DOJIMA_FLAT_REAL_POS, AREA_ANCHORS: DOJIMA_FLAT_AREA_ANCHORS, origin: [1600, 1000] }, // ガイド座標 0〜50 / 0〜58 → world z 1000〜1029
  // 関電不動産西梅田ビル地下街 B2F(中枢層)。B1F は詳細地図なし(案内板が無い)ので、B1F のドットは館ノード選択のまま
  kanden_b2: { FLOOR: KANDEN_B2_FLOOR, WALK: KANDEN_B2_WALK, BLOCKS: KANDEN_B2_BLOCKS, REAL_POS: KANDEN_B2_REAL_POS, AREA_ANCHORS: KANDEN_B2_AREA_ANCHORS,
               zone: 'kanden', areas: ['kanden_b2'], floor: 'B1', name: '関電不動産西梅田ビル B2F', origin: [1600, 1050] }, // ガイド座標 0〜52 / -4〜39 → world z 1048〜1070
};
