// 詳細地図(ガイド座標系)を持つ施設の登録表。main.js はここだけを見る。
// 各施設の FLOOR / BLOCKS / REAL_POS / AREA_ANCHORS / WALK は tools/gen_detail*.py が生成した detail_<zone>.js から。
// origin: 広域(実座標)と重ならない専用エリアのワールド座標オフセット。施設ごとに離して置き、互いにも重ねない
// links: 他の施設への接続(階段・通路の出口)。g=ガイド座標(m)、dir=向き(ガイド座標、+y は南)、to=ラベル。
//        詳細地図は周りの施設を描かないので、矢印と「○○へ」でどこから出ればどこへ行けるかを示す
import { WHITY_FLOOR, WHITY_WALK, WHITY_BLOCKS, WHITY_REAL_POS, WHITY_AREA_ANCHORS } from './detail_whity.js';
import { AVANZA_FLOOR, AVANZA_WALK, AVANZA_BLOCKS, AVANZA_REAL_POS, AVANZA_AREA_ANCHORS } from './detail_avanza.js';
import * as SNB1 from './detail_sanban_n_b1.js';
import * as SNB2 from './detail_sanban_n_b2.js';
import * as SSB1 from './detail_sanban_s_b1.js';
import * as SSB2 from './detail_sanban_s_b2.js';
import { DOTICA_FLOOR, DOTICA_WALK, DOTICA_BLOCKS, DOTICA_REAL_POS, DOTICA_AREA_ANCHORS } from './detail_dotica.js';
import { DOJIMA_FLAT_FLOOR, DOJIMA_FLAT_WALK, DOJIMA_FLAT_BLOCKS, DOJIMA_FLAT_REAL_POS, DOJIMA_FLAT_AREA_ANCHORS } from './detail_dojima_flat.js';
import { KANDEN_B2_FLOOR, KANDEN_B2_WALK, KANDEN_B2_BLOCKS, KANDEN_B2_REAL_POS, KANDEN_B2_AREA_ANCHORS } from './detail_kanden_b2.js';
import { LINKS_B1_FLOOR, LINKS_B1_WALK, LINKS_B1_BLOCKS, LINKS_B1_REAL_POS, LINKS_B1_AREA_ANCHORS } from './detail_links_b1.js';
import { KANDEN_B1_FLOOR, KANDEN_B1_WALK, KANDEN_B1_BLOCKS, KANDEN_B1_REAL_POS, KANDEN_B1_AREA_ANCHORS } from './detail_kanden_b1.js';
import { KIYO_B1_FLOOR, KIYO_B1_WALK, KIYO_B1_BLOCKS, KIYO_B1_REAL_POS, KIYO_B1_AREA_ANCHORS } from './detail_kiyo_b1.js';

// 施設が館×階に分かれる場合(三番街)は、zone を共有しつつ areas(shops.js のエリアID)で詳細地図を分ける。
// floor は描画する高さ(三番街B1F=浅層S1、B2F=中枢層B1)。name は詳細バーの表示名
const sanban = (m, p, areas, floor, name, origin, links) => ({
  FLOOR: m[p + '_FLOOR'], WALK: m[p + '_WALK'], BLOCKS: m[p + '_BLOCKS'], REAL_POS: m[p + '_REAL_POS'], AREA_ANCHORS: m[p + '_AREA_ANCHORS'],
  zone: 'sanban', areas, floor, name, origin, links,
});

export const DETAIL_MAPS = {
  // 三番街の連絡通路の位置は案内板の比率(建物の東端から22%・西端から26%)。北館 70×42 / 南館 75.3×49.9(ガイド座標 m)
  sanban_n_b1: sanban(SNB1, 'SANBAN_N_B1', ['sanban_n_b1'], 'S1', '阪急三番街 北館B1F', [1600, 500], [ // ガイド座標 0〜70 / 0〜42 → world z 500〜521
    { g: [35, 40], dir: [0, 1], to: '南館へは B2F の連絡通路で(B1F は直結なし)' },
  ]),
  sanban_n_b2: sanban(SNB2, 'SANBAN_N_B2', ['sanban_n_b2'], 'B1', '阪急三番街 北館B2F', [1600, 560], [
    { g: [18, 41], dir: [0, 1], to: '南館B2Fへ(連絡通路・西)' }, { g: [55, 41], dir: [0, 1], to: '南館B2Fへ(連絡通路・東)' },
  ]),
  sanban_s_b1: sanban(SSB1, 'SANBAN_S_B1', ['sanban_s_b1'], 'S1', '阪急三番街 南館B1F', [1600, 620], [
    { g: [2, 25], dir: [-1, 0], to: 'リンクス梅田・JR大阪駅へ(西口連絡通路)' },
    { g: [40, 48], dir: [0, 1], to: 'ホワイティうめだ(プチシャン)へ' },
    { g: [37, 2], dir: [0, -1], to: '北館へは B2F の連絡通路で(B1F は直結なし)' },
  ]),
  sanban_s_b2: sanban(SSB2, 'SANBAN_S_B2', ['sanban_s_b2'], 'B1', '阪急三番街 南館B2F', [1600, 690], [
    { g: [19.6, 1], dir: [0, -1], to: '北館B2Fへ(連絡通路・西)' }, { g: [58.7, 1], dir: [0, -1], to: '北館B2Fへ(連絡通路・東)' },
    { g: [40, 48], dir: [0, 1], to: 'ホワイティうめだ・HEP FIVEへ' },
  ]),
  whity:  { FLOOR: WHITY_FLOOR,  WALK: WHITY_WALK,  BLOCKS: WHITY_BLOCKS,  REAL_POS: WHITY_REAL_POS,  AREA_ANCHORS: WHITY_AREA_ANCHORS,  origin: [1600, 0],   // ガイド座標 x -262〜225 / y -257〜96 → world x 1469〜1712 / z -128〜48
    // 接続は広域の通路グラフの境のノードを、2016PDFの位置合わせ(whity_2016.json の blocks m↔g)でガイド座標に写し、床の縁に寄せたもの
    links: [
      { g: [-152.6, -111.2], dir: [-0.37, 0.93], to: '阪急三番街 南館へ' },
      { g: [-185.6, -129.5], dir: [0.37, -0.93], to: '梅田OPA・HEP FIVEへ' },
      { g: [-71.0, -93.0], dir: [0.32, -0.95], to: 'HEP FIVE / NAVIOへ' },
      { g: [41.5, -91.6], dir: [-1.0, -0.06], to: 'HEP NAVIO・OSビルへ' },
      { g: [57.3, 73.7], dir: [-0.6, 0.8], to: '御堂筋線 梅田駅・うめちかへ' },
      { g: [90.4, 95.5], dir: [-0.32, 0.95], to: '阪神百貨店・梅田地下道へ' },
      { g: [186.3, 62.9], dir: [0.35, 0.94], to: 'ディアモール方面(御堂筋沿いの通路)へ' },
      { g: [-260.9, -153.4], dir: [-0.96, -0.27], to: 'プチシャン(茶屋町方面)へ' },
    ] },
  avanza: { FLOOR: AVANZA_FLOOR, WALK: AVANZA_WALK, BLOCKS: AVANZA_BLOCKS, REAL_POS: AVANZA_REAL_POS, AREA_ANCHORS: AVANZA_AREA_ANCHORS, origin: [1600, 300], // ガイド座標 0〜60 / 0〜72 → world z 300〜336(ホワイティの南、重ならない)
    links: [ // 階段3本(館内案内板 2026-09-03)。段数は現地の2点タップ
      { g: [8, 10], dir: [-1, 0], to: 'ドーチカへ(北の階段・C72)' },
      { g: [14, 47], dir: [-1, 0], to: 'ドーチカへ(曲線階段17段→広場→7段・C80)' },
      { g: [18, 68], dir: [-1, 0], to: 'ドーチカへ(10段・C84)' },
    ] },
  // ドーチカ: 公式マップ(北を上に回転)。広域では北・中・南の3エリアの集約ドットが入口
  dotica: { FLOOR: DOTICA_FLOOR, WALK: DOTICA_WALK, BLOCKS: DOTICA_BLOCKS, REAL_POS: DOTICA_REAL_POS, AREA_ANCHORS: DOTICA_AREA_ANCHORS,
            zone: 'dotica', areas: ['dotica_n', 'dotica_c', 'dotica_s'], floor: 'B1', name: 'ドージマ地下センター', origin: [1600, 800], // ガイド座標 x -16〜34 / y 0〜289 → world z 800〜945
            links: [ // 出口番号は公式マップ(tools/dotica_spec_from_map.py の walks)。地上出口(C57/C60/C69/C92/C93)は出さない
              { g: [0, 4], dir: [0, -1], to: '北新地駅・曽根崎地下歩道方面' },
              { g: [-13, 34], dir: [-1, 0], to: '関電不動産西梅田ビル B2Fへ(C61)' },
              { g: [10, 117], dir: [1, 0], to: '堂島アバンザ 北口へ(C72・階段)' },
              { g: [12, 171], dir: [1, 0], to: '堂島アバンザへ(C80・7段→広場→17段)' },
              { g: [-8, 191], dir: [-1, 0], to: '堂島ふらっとへ(C83・階段23段)' },
              { g: [11, 197], dir: [1, 0], to: '堂島アバンザ 南口へ(C84・10段)' },
              { g: [13, 278], dir: [-0.97, 0.26], to: '紀陽ビル B1F(福永診療所・堂島デンタルクリニック)へ' }, // 南端は軸が東へ折れている(通路の西縁 x≈13)
            ] },
  // 堂島ふらっと(近鉄堂島ビルB1F): 現地の案内板から。ドーチカ C83 直結
  dojima_flat: { FLOOR: DOJIMA_FLAT_FLOOR, WALK: DOJIMA_FLAT_WALK, BLOCKS: DOJIMA_FLAT_BLOCKS, REAL_POS: DOJIMA_FLAT_REAL_POS, AREA_ANCHORS: DOJIMA_FLAT_AREA_ANCHORS, origin: [1600, 1000], // ガイド座標 0〜50 / 0〜58 → world z 1000〜1029
    links: [{ g: [48.5, 51], dir: [1, 0], to: 'ドーチカへ(階段23段・C83)' }] },
  // 関電不動産西梅田ビル地下街 B2F(中枢層)と B1F(浅層)。B1F は案内板が無いので仮配置(tools/kanden_b1_provisional.py)
  kanden_b2: { FLOOR: KANDEN_B2_FLOOR, WALK: KANDEN_B2_WALK, BLOCKS: KANDEN_B2_BLOCKS, REAL_POS: KANDEN_B2_REAL_POS, AREA_ANCHORS: KANDEN_B2_AREA_ANCHORS,
               zone: 'kanden', areas: ['kanden_b2'], floor: 'B1', name: '関電不動産西梅田ビル B2F', origin: [1600, 1050], // ガイド座標 0〜52 / -4〜39 → world z 1048〜1070
               links: [{ g: [42, -2], dir: [0, -1], to: 'ドーチカへ(C61)' }, { g: [44.3, 20], dir: [1, 0], to: 'B1Fへ(館内階段)' }] },
  // LINKS UMEDA(リンクス梅田) B1F(浅層): 現地の館内案内板から。ヨドバシB1売場も1区画として持つ
  links_b1: { FLOOR: LINKS_B1_FLOOR, WALK: LINKS_B1_WALK, BLOCKS: LINKS_B1_BLOCKS, REAL_POS: LINKS_B1_REAL_POS, AREA_ANCHORS: LINKS_B1_AREA_ANCHORS,
              zone: 'links', areas: ['links_b1'], floor: 'S1', name: 'LINKS UMEDA B1F', origin: [1600, 1150], // ガイド座標 0〜155 / 0〜144 → world z 1150〜1222
              links: [{ g: [152, 72], dir: [1, 0], to: '阪急三番街へ(西口連絡通路)' }, { g: [77, 141], dir: [0, 1], to: 'JR大阪駅 御堂筋北口・御堂筋線 梅田駅へ' }] },
  kanden_b1: { FLOOR: KANDEN_B1_FLOOR, WALK: KANDEN_B1_WALK, BLOCKS: KANDEN_B1_BLOCKS, REAL_POS: KANDEN_B1_REAL_POS, AREA_ANCHORS: KANDEN_B1_AREA_ANCHORS,
               zone: 'kanden', areas: ['kanden_b1'], floor: 'S1', name: '関電不動産西梅田ビル B1F(仮配置)', origin: [1600, 1100], // ガイド座標 0〜52 / 0〜39 → world z 1100〜1120
               links: [{ g: [49, 19.5], dir: [1, 0], to: 'B2F(ドーチカ側)へ(館内階段)' }] },
  // 紀陽ビル B1F: 館内図が無いので仮配置(tools/kiyo_b1_provisional.py)。ドーチカ南端(現在地・トイレの所)から直結
  kiyo_b1: { FLOOR: KIYO_B1_FLOOR, WALK: KIYO_B1_WALK, BLOCKS: KIYO_B1_BLOCKS, REAL_POS: KIYO_B1_REAL_POS, AREA_ANCHORS: KIYO_B1_AREA_ANCHORS,
             zone: 'kiyo', areas: ['kiyo_b1'], floor: 'B1', name: '紀陽ビル B1F(仮配置)', origin: [1600, 1250], // ガイド座標 0〜34 / 0〜28 → world z 1250〜1264
             links: [{ g: [32, 14], dir: [1, 0], to: 'ドーチカ(南端)へ' }] },
};
