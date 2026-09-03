import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SHOP_AREAS, SHOPS_MANUAL, SHOPS_SCRAPED, ALIASES } from './shops.js';
import { initSurvey } from './survey.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OSM_BUILDINGS, OSM_ROADS } from './ground_data.js'; // tools/gen_ground.py が生成
import { LANDMARKS, PHOTOS } from './landmarks.js';
import { DETAIL_MAPS } from './detail_maps.js'; // 詳細地図を持つ施設の登録表(whity / dotica / avanza …)

// ---------------------------------------------------------------------------
// 梅田ダンジョン データ
// コンセプト: 地下にいる人が「地下の中だけ」を移動するためのアプリ。地上への出口・地上専用通路は表示しない
// (出口位置は tools/data/osm_exits.json 等に内部保持し、地図の位置合わせと現地調査の基準点にのみ使う)
// mx,my = 原点からの東向き・南向きのメートル(北が上、小数可)。緯度経度との変換は geo.js(metric-v1)
// x:東+ / z:南+
// ---------------------------------------------------------------------------
// 視認性のためフロア間隔は誇張。S1=浅層(中枢層B1の1段上)。全層とも66間隔で等間隔スタック
const FLOOR_Y = { S1: 66, B1: 0, B2: -66 };
const GROUND_Y = 112; // 地上レベル。浅層S1=66の上に46の土被りを確保（浅層↔中枢層↔深層は各66で等間隔）
// フロアの表示名（地下ダンジョンの層区分）。内部キーはそのまま、UI表記だけ層名に置換
const FLOOR_LABEL = { S1: '浅層', B1: '中枢層', B2: '深層' };
const fl = f => FLOOR_LABEL[f] || `${f}F`;
const UNIT_M = 2.0;              // 1 world unit = 2m(M2Wの係数0.5の逆数)
const M2W = ([mx, my]) => [(mx - 800) * 0.5, (my - 1100) * 0.5];

const S = (id, name, floor, mx, my) => ({ id, name, floor, mx, my, type: 'station' });
const P = (id, name, floor, mx, my, zone) => ({ id, name, floor, mx, my, zone, type: 'spot' });
const J = (id, mx, my, floor = 'B1') => ({ id, name: '', floor, mx, my, type: 'junction' });
// 店舗。near: 最寄りの通路ノード。aliases: 検索用の別表記
const Sh = (id, name, floor, mx, my, zone, near, aliases) =>
  ({ id, name, floor, mx, my, zone, near, aliases, type: 'shop' });

// 施設レイヤー（エリアごとの色分け・強調表示用）。駅は常に表示するのでゾーンなし
const ZONES = {
  sanban:      { name: '阪急三番街',            color: 0xe0913f, label: [945.6, 623.1] },
  whity:       { name: 'ホワイティうめだ',      color: 0xd9c04b, label: [1171.5, 918.2] },
  umechika:    { name: '梅田地下道',            color: 0xd97f9f, label: [910.7, 980.9] },
  osaka_sta:   { name: 'JR大阪駅',              color: 0x5f9fd9, label: [671.6, 893.1] },
  lucua:       { name: 'ルクア',                color: 0x6a6fe2, label: [649, 811.9] },  // インディゴ(ルクア+ルクア1100)
  diamor:      { name: 'ディアモール大阪',      color: 0x45c8a8, label: [863.9, 1143] },
  // corridor: 現地で名前の表示が乏しく施設として認識されない通路。施設レイヤー・地図ラベル・「ここから○○」案内に出さない(2026-08-23 現地確認)。色は他の区域と同じ扱い
  nishi_umeda: { name: '西梅田地下通路(ガーデンアベニュー)', color: 0xa07fd9, label: [438.5, 1226.6], corridor: true },
  hilton:      { name: 'ヒルトンプラザ',        color: 0xcbb37a, label: [735.6, 1154.6] },  // シャンパン(EAST/WEST)
  herbis:      { name: 'ハービス',              color: 0xaa4e66, label: [517.7, 1272.9] },  // ワイン(ENT/OSAKA)
  kitte:       { name: 'KITTE大阪',             color: 0x2f8fa3, label: [539.7, 1098.3] },  // ダークターコイズ
  // 百貨店は濃色系(ブランドカラー): 公共地下道の中間色と階調で区別する
  daimaru:     { name: '大丸梅田店',            color: 0x3c8a5e, label: [785.6, 987.1] },   // 大丸グリーン(床の重心)
  hankyu_dept: { name: '阪急百貨店',            color: 0x8b3548, label: [986.7, 864.1] },   // 阪急マルーン(床の重心)
  hanshin_dept:{ name: '阪神百貨店',            color: 0x3f5f9e, label: [954.4, 1061.3] },  // 阪神ネイビー(床の重心)
  avanza:      { name: '堂島アバンザ',          color: 0x9a8f52, label: [782.9, 1514.8] },  // オリーブ
  ekimae:      { name: '大阪駅前ビル',          color: 0xdb5a66, label: [904.2, 1221.8] },  // 鮮明な赤(そねちかとの分離)
  sonechika:   { name: '曽根崎地下歩道(そねちか)', color: 0x7f93b0, label: [1023.8, 1319.1], corridor: true },  // 東梅田改札へ向かうただの通路として扱う
  hep:         { name: 'HEP FIVE / NAVIO',      color: 0xe0554f, label: [1120, 745] },   // 赤い観覧車の朱赤
  osbld:       { name: 'OSビル',                color: 0x5f8fa8, label: [1168, 872] },   // スチールブルー
  ema:         { name: 'イーマ',                color: 0x9b59d0, label: [984.4, 1098.6] },  // 紫(隣のディアモールteal・うめちかピンクと対比)
  dotica:      { name: 'ドージマ地下センター',  color: 0x5fae6e, label: [700.4, 1435.7] },
  links:       { name: 'ヨドバシ / リンクス梅田', color: 0xcf6bbf, label: [772.5, 656] },  // ローズ
  grandfront:  { name: 'グランフロント大阪',    color: 0x9db83e, label: [643, 696.2] },  // 若草
  umekita:     { name: 'うめきた広場',          color: 0x85d7b6, label: [614.8, 784.6] },  // ミント(サンクン広場)
};

const NODES = [
  // --- 北エリア（阪急・茶屋町方面） ---
  S('hankyu',      '阪急 大阪梅田駅',            'B1',  969.2, 565.3),
  // 阪急三番街は北館/南館 × B1/B2 の4面構成（北館B2=UMEDA FOOD HALL、南館B2=川の流れる街）
  // 三番街は周囲より1段高い: B1F=浅層(S1)、B2F=中枢層(B1)。名称のB1/B2は館内の実フロア名なので保持
  P('sanban_n_b1', '阪急三番街 北館B1',          'S1',  935, 548, 'sanban'), // 北館は市道(y≈565〜575)の北。旧位置(925.5,587.3)は南館側だった
  P('sanban_n_b2', '阪急三番街 北館B2 (UMEDA FOOD HALL)', 'B1', 935, 548, 'sanban'),
  P('sanban_s_b1', '阪急三番街 南館B1',          'S1',  955.2, 681.6, 'sanban'),
  P('sanban_s_b2', '阪急三番街 南館B2 (川の流れる街)',    'B1', 955.2, 681.6, 'sanban'),
  P('yodobashi',   'ヨドバシ / LINKS UMEDA',     'S1',  765.7, 650, 'links'), // リンクスB1F=浅層(三番街B1F・ルクアB1Fと同層)
  P('yodobashi_b2','リンクス梅田 B2F',           'B1',  765.7, 650, 'links'), // リンクスB2F=中枢層。同施設B1F(浅層)とだけEV/ESCで接続
  P('opa',         '梅田OPA・HEP前',             'B1', 1042.3, 631.3, 'sanban'),
  P('hq_concourse','阪急百貨店前コンコース',      'B1',  966.7, 759.6, 'umechika'),
  P('bigman',      'ビッグマン前 (BIGMAN・紀伊國屋)','S1',  965, 606.4, 'sanban'), // 三番街南館B1F=浅層(紀伊國屋は市道の南側・OSM)
  P('hankyu_dept', '阪急百貨店',                 'B1',  993.4, 864.8, 'hankyu_dept'),
  // --- JR大阪駅・中央 ---
  // 北西クラスタ(JR大阪駅・ルクア・リンクス・グランフロント・うめきた)は三番街と同じく1段高い。
  // 各B1F=浅層(S1)、ルクアB2F(バルチカ)=中枢層。中枢層の一般地下街へは大丸(daimaru)1点で段差接続。
  S('jr_osaka',    'JR大阪駅(御堂筋口)',         'S1',  770, 883.4),
  P('lucua',       'ルクア / イノゲート大阪',    'S1',  700.7, 834.1, 'lucua'),
  P('lucua_b2',    'ルクア バルチカ/FOOD HALL',  'B1',  700.7, 834.1, 'lucua'),
  P('grandfront',  'グランフロント大阪',         'S1',  646.2, 694.3, 'grandfront'), // 北西クラスタ=浅層(動画: 地下最高地点)
  P('umekita_sq',  'うめきた広場',               'S1',  614.8, 782.8, 'umekita'),    // 北西クラスタ=浅層
  S('midosuji',    '御堂筋線 梅田駅',            'B2',  943.6, 866.5),
  P('daimaru',     '大丸・グランヴィア前',       'B1',  727.7, 914.3, 'daimaru'),
  S('hanshin',     '阪神 大阪梅田駅(百貨店)',    'B1',  857.3, 1009.5),
  S('hanshin_home','阪神 大阪梅田駅(ホーム)',    'B2',  834.8, 1033.5),
  // --- ホワイティうめだ ---
  P('whity_w',     'ホワイティうめだ(西)',       'B1', 1014.5, 934.4, 'whity'),
  P('izumi',       '泉の広場',                   'B1', 1293, 936.2, 'whity'),
  S('higashi',     '谷町線 東梅田駅',            'B2', 1100.9, 1099.8),
  // --- ディアモール・駅前ビル ---
  P('enkei',       'ディアモール 円形広場',      'B1',  870.6, 1112.4, 'diamor'),
  // 駅前ビルは三番街と同じく1段高い: B1F=浅層(S1)、B2F=中枢層(B1)
  P('ekimae1',     '大阪駅前第1ビル',            'S1',  795.5, 1291.6, 'ekimae'),
  P('ekimae2',     '大阪駅前第2ビル',            'S1',  931.1, 1299.2, 'ekimae'),
  P('ekimae3',     '大阪駅前第3ビル',            'S1', 1051.9, 1297.6, 'ekimae'),
  P('ekimae4',     '大阪駅前第4ビル',            'S1',  1017.1, 1181.2, 'ekimae'),
  // B2F=中枢層。4棟はB2Fレベルで相互接続し、ディアモール・曽根崎地下歩道・そねちかとフラット接続(北新地駅へは段差)
  P('ekimae1_b2',  '大阪駅前第1ビル(B2)',        'B1',  795.5, 1291.6, 'ekimae'),
  P('ekimae2_b2',  '大阪駅前第2ビル(B2)',        'B1',  931.1, 1299.2, 'ekimae'),
  P('ekimae3_b2',  '大阪駅前第3ビル(B2)',        'B1', 1051.9, 1297.6, 'ekimae'),
  P('ekimae4_b2',  '大阪駅前第4ビル(B2)',        'B1',  1017.1, 1181.2, 'ekimae'),
  // --- 西梅田・北新地・堂島 ---
  S('nishi',       '四つ橋線 西梅田駅',          'B2',  720.1, 1223.8),
  P('hilton',      'ヒルトンプラザ EAST/WEST',   'B1',  726.1, 1168.3, 'hilton'),
  P('hilton_b2',   'ヒルトンプラザ (B2)',        'B2',  726.1, 1168.3, 'hilton'),
  P('garden',      '大阪ガーデンシティ',         'B1',  560.7, 1164.4, 'nishi_umeda'),
  P('herbis',      'ハービスENT / OSAKA',        'B1',  618.3, 1197.1, 'herbis'),
  P('herbis_b2',   'ハービス (B2)',              'B2',  618.3, 1197.1, 'herbis'),
  P('kitte',       'KITTE大阪 (うめよこ)',       'B1',  571, 1106.1, 'kitte'),
  P('ritz',        'リッツ・カールトン前',       'B1',  301.5, 1375.9, 'herbis'),
  S('kitashinchi', 'JR東西線 北新地駅',          'B2',  867.2, 1345.2),
  P('dojima',      'ドージマ地下センター',       'B1',  707.5, 1448.9, 'dotica'),
  P('avanza',      '堂島アバンザ前',             'B1',  703, 1547.1, 'dotica'),
  P('sonechika',   'そねちか(お初天神方面)',     'B1', 1131, 1342.1, 'sonechika'),
  P('hep',         'HEP FIVE (B1F)',            'B1', 1136, 719, 'hep'),   // ノースモール1北端から接続
  P('navio',       'HEP NAVIO (B1F)',           'B1', 1102, 831, 'hep'),   // ノースモール2から接続
  P('osbld',       'OSビル (B1F)',               'B1', 1155, 858, 'osbld'), // ノースモール2の突き当たり(J2階段で地上へ)
  P('ema',         'イーマ',                     'B1',  977.4, 1088.1, 'ema'), // E-MA。B1がディアモール マーケットST東端と直結(OSMビル162158020)
  // --- 無名の分岐点（経路用ジャンクション） ---
  J('j_yodo_e',    835.5, 683.2, 'S1'),   // 三番街西口（浅層: 三番街B1F↔リンクスB1Fの連絡通路）
  J('j_kita',      793.6, 792.5, 'S1'),   // JR大阪駅 御堂筋北口（浅層: リンクス↔JR大阪駅コンコース）
  J('j_pchn',     1024.1, 549.9),   // プチシャン北端（Nu茶屋町・ホテル阪急方面）
  J('j_nm2',      1111.5, 847.2),   // ノースモール2先端（阪急東通り入口）
  J('j_fashion_w', 718, 1226.6),   // ファッショナブルST西端（第1ビル・北新地方面）
  J('j_c1',        644.4, 1010.8),   // 大阪駅前地下道 西端
  J('j_sone_w',    712.8, 1339),   // 曽根崎地下歩道 西端(OSM実測)
  J('j_mido_s',   1076.7, 1207.6),   // 御堂筋西沿い南北通路の中間(第4ビル東壁沿い。OSM実測)
  // 阪急三番街 B2F(中枢層)の北館⇔南館 連絡通路2本の両端。間の市道は OSM の建物内通路道路(way 682682107)の東西区間 y≈565〜575。
  // 位置は案内板の比率(建物の東端から22% / 西端から26%)。tools/gen_polys.py の SANBAN_ROAD / SANBAN_B2_LINKS と揃える
  J('sanban_n2_w', 938, 565), J('sanban_s2_w', 938, 580),
  J('sanban_n2_e', 988, 556), J('sanban_s2_e', 988, 571),
  J('j_avz',       760.7, 1513.8),   // 堂島アバンザ館内(ドーチカC-84直結)
  // ドーチカ⇔アバンザは3ヶ所(いずれも階段)で接続。北=北サンクンガーデン通路、中=南サンクンガーデンへの曲線階段の手前、南=既存の avanza→j_avz(C-84)
  // 位置は館内案内板(2026-09-03)の比率から置いた仮値。現地の2点タップ(階段・段数)で補正する
  J('dotica_avz_n', 705.5, 1482),    // ドーチカ側・北の階段下(dojima→dotica_01 の通路上)
  J('dotica_avz_m', 702.7, 1527),    // ドーチカ側・中の階段下
  J('j_avz_n',      758, 1482),      // アバンザ側・北の階段上(北サンクンガーデン通路)
  J('j_avz_m',      751, 1527),      // アバンザ側・中の階段上
  J('j_hankyu_b2', 990.2, 869.3, 'B2'),   // 阪急百貨店B2(生鮮・惣菜フロア)
  J('j_daimaru_b2', 787.9, 989.7, 'B2'),  // 大丸B2(食品フロア)
  J('j_hilton_e', 818.7, 1119.6),        // ヒルトンE東壁(ディアモール⇔西梅田の境目)
  // @region whity begin  (tools/import_region.py が生成。OSM通路の交点・屈曲点)
  J('izumi_ne', 1285.0, 870.6),
  J('j_east1', 1067.7, 749.9),
  J('j_f40', 1043.1, 1060.7),
  J('j_hanshin_e', 957.2, 990.9),
  J('j_higashi_n', 1058.4, 976.4),
  J('j_nm1s', 1111.9, 859.7),
  J('j_whity_x', 1092.3, 911.8),
  J('whity_01', 936.1, 948.7),
  J('whity_02', 951.5, 940.0),
  J('whity_03', 962.8, 968.1),
  J('whity_04', 962.8, 997.0),
  J('whity_05', 962.7, 1002.0),
  J('whity_06', 963.5, 930.5),
  J('whity_07', 965.1, 934.9),
  J('whity_08', 970.6, 986.5),
  J('whity_09', 982.8, 931.2),
  J('whity_10', 998.4, 1024.4),
  J('whity_11', 1000.7, 1021.3),
  J('whity_12', 1008.8, 1032.8),
  J('whity_13', 1014.8, 933.0),
  J('whity_14', 1019.0, 956.8),
  J('whity_15', 1022.8, 1042.8),
  J('whity_16', 1025.2, 555.5),
  J('whity_17', 1037.4, 600.9),
  J('whity_18', 1038.8, 665.9),
  J('whity_19', 1045.9, 1063.6),
  J('whity_20', 1047.9, 664.4),
  J('whity_21', 1048.4, 1017.7),
  J('whity_22', 1054.1, 912.3),
  J('whity_23', 1055.3, 903.3),
  J('whity_24', 1056.2, 895.3),
  J('whity_25', 1055.7, 1047.3),
  J('whity_26', 1056.8, 753.6),
  J('whity_27', 1059.0, 840.4),
  J('whity_28', 1059.3, 850.7),
  J('whity_29', 1059.4, 1043.4),
  J('whity_30', 1064.1, 948.5),
  J('whity_31', 1066.9, 904.6),
  J('whity_32', 1066.5, 909.3),
  J('whity_33', 1067.8, 1014.2),
  J('whity_34', 1071.1, 853.4),
  J('whity_35', 1071.9, 844.0),
  J('whity_36', 1071.5, 1026.5),
  J('whity_37', 1075.8, 796.5),
  J('whity_38', 1078.8, 1050.6),
  J('whity_39', 1084.9, 1022.6),
  J('whity_40', 1293.0, 936.1),
  // @region whity end
  // @region dotica begin  (tools/import_region.py が生成。OSM通路の交点・屈曲点)
  J('dotica_01', 701.9, 1539.6),
  J('dotica_02', 711.3, 1369.6),
  J('dotica_03', 713.8, 1620.9),
  // @region dotica end
  // @region nishi_umeda begin  (tools/import_region.py が生成。OSM通路の交点・屈曲点)
  J('j_kitte_e', 672.4, 1105.6),
  J('nishi_y',     244.0, 1417.0),        // ガーデンアベニュー南西端のY字路(出口6-1/6-2への分岐)。現地写真 2026-08-23
  J('nishi_y_k1',  236.0, 1423.4),    // 6-1側の枝の折れ(左に振ってから出口へ。現地スケッチ 2026-08-23)
  J('exit_6_1',    228.8, 1437.4),    // 出口6-1(OSM)
  J('exit_6_2',    236.8, 1405.5),    // 出口6-2(OSM)
  J('nishi_a1_j',  412.3, 1314.6),   // ガーデンアベニュー上の分岐点(出口A-1への通路の付け根)
  J('j_nishi_x', 630.4, 1147.8),
  J('nishi_umeda_01', 319.2, 1387.7),
  J('nishi_umeda_02', 528.7, 1223.2),
  J('nishi_umeda_03', 550.0, 1174.9),
  J('nishi_umeda_04', 560.7, 1164.1),
  J('nishi_umeda_05', 561.7, 1185.7),
  J('nishi_umeda_06', 578.6, 1166.6),
  J('nishi_umeda_07', 611.5, 1140.9),
  J('nishi_umeda_08', 630.8, 1129.0),
  J('nishi_umeda_09', 638.2, 1142.8),
  J('nishi_umeda_10', 674.4, 1127.2),
  J('nishi_umeda_11', 683.3, 1104.1),
  J('nishi_umeda_12', 704.2, 1053.9),
  J('nishi_umeda_13', 711.7, 1095.3),
  J('nishi_umeda_14', 717.4, 1075.2),
  J('nishi_umeda_15', 717.8, 1119.7),
  J('nishi_umeda_16', 739.3, 1062.9),
  J('nishi_umeda_17', 742.4, 1073.0),
  J('nishi_umeda_p2_garden', 560.5, 1164.2),
  J('nishi_umeda_p2_ritz', 307.4, 1392.0),
  // @region nishi_umeda end
  // @region sonechika begin  (tools/import_region.py が生成。OSM通路の交点・屈曲点)
  J('j_sone_e', 1045.1, 1361.3),
  J('sonechika_01', 987.5, 1359.3),
  J('sonechika_02', 993.5, 1377.0),
  J('sonechika_03', 1001.9, 1360.1),
  J('sonechika_04', 1002.1, 1377.0),
  J('sonechika_05', 1005.1, 1336.7),
  J('sonechika_06', 1012.6, 1360.7),
  J('sonechika_07', 1013.9, 1377.0),
  J('sonechika_08', 1045.2, 1377.0),
  J('sonechika_09', 1062.2, 1377.0),
  J('sonechika_10', 1121.7, 1337.7),
  J('sonechika_11', 1131.0, 1341.9),
  J('sonechika_12', 1146.2, 1354.4),
  J('sonechika_13', 1149.4, 1363.3),
  J('sonechika_14', 1155.2, 1379.8),
  J('sonechika_p1_sonechika', 1131.1, 1341.9),
  // @region sonechika end
  // @region umechika begin  (tools/import_region.py が生成。OSM通路の交点・屈曲点)
  J('j_metro', 910.8, 938.7),
  J('j_mido_n', 948.5, 889.5),
  J('j_shibata', 938.2, 734.8),
  J('j_sun', 944.6, 803.0),
  J('umechika_01', 747.5, 909.8),
  J('umechika_02', 758.7, 938.8),
  J('umechika_03', 761.8, 939.2),
  J('umechika_04', 764.4, 937.6),
  J('umechika_05', 764.7, 899.0),
  J('umechika_06', 765.7, 939.7),
  J('umechika_07', 813.0, 905.6),
  J('umechika_08', 816.7, 906.1),
  J('umechika_09', 837.5, 1006.2),
  J('umechika_10', 853.7, 980.8),
  J('umechika_11', 860.5, 992.6),
  J('umechika_12', 918.1, 826.3),
  J('umechika_13', 920.8, 770.3),
  J('umechika_14', 922.1, 738.0),
  J('umechika_15', 922.4, 956.5),
  J('umechika_16', 924.5, 823.8),
  J('umechika_17', 929.9, 700.5),
  J('umechika_18', 929.9, 736.5),
  J('umechika_19', 932.1, 766.8),
  J('umechika_20', 939.5, 764.3),
  J('umechika_21', 947.5, 761.5),
  J('umechika_22', 951.4, 798.6),
  J('umechika_23', 955.3, 679.4),
  J('umechika_24', 958.3, 696.0),
  J('umechika_25', 959.8, 730.5),
  J('umechika_26', 959.8, 757.7),
  J('umechika_27', 959.8, 793.1),
  J('umechika_28', 960.6, 801.1),
  J('umechika_29', 962.7, 1005.2),
  J('umechika_30', 969.1, 742.9),
  J('umechika_31', 969.1, 757.7),
  J('umechika_32', 969.2, 787.0),
  J('umechika_33', 974.6, 676.3),
  J('umechika_34', 992.5, 1027.9),
  J('umechika_35', 997.0, 1039.8),
  J('umechika_p4_daimaru', 747.5, 909.8),
  J('umechika_p4_hanshin', 850.7, 998.4),
  // @region umechika end
  // @region diamor begin  (tools/import_region.py が生成。OSM通路の交点・屈曲点)
  J('diamor_00', 849.6, 1117.5), // import_region.py が diamor_01 を二重採番していたのを分離(北側=diamor_03 の隣)
  J('diamor_01', 863.9, 1352.1),
  J('diamor_02', 870.1, 1352.6),
  J('diamor_03', 871.2, 1114.3),
  J('diamor_04', 887.0, 1117.9),
  J('diamor_05', 886.6, 1144.3),
  J('j_diamor_e', 970.2, 1225.7),
  J('j_diamor_n', 846.1, 1071.0),
  J('j_diamor_s', 868.9, 1226.1),
  J('j_fashion_e', 1022.3, 1225.9),
  J('j_market_ne', 979.4, 1050.2),
  J('j_sone_c', 867.0, 1352.4),
  J('j_variety', 930.2, 1150.4),
  // @region diamor end
];

// [a, b, 幅(world unit), zone?]
const EDGES = [
  // 北エリア
  ['hankyu', 'sanban_n_b1', 18, 'sanban'],
  // 北館⇔南館の地下連絡はB2のみ（東西2本を1本に集約。B1に連絡通路はない）
  // B2F 北館⇔南館は間の市道の下を小さい連絡通路2本(西寄り・東寄り)で結ぶ(現地の案内板 2026-09-03)。B1Fは直結なし
  ['sanban_n2_w', 'sanban_s2_w', 4, 'sanban'],
  ['sanban_n2_e', 'sanban_s2_e', 4, 'sanban'],
  // 南館B2F(=中枢層)はホワイティうめだ方面と2箇所で直結（公式s_b2fマップ南側2出口）。同一フロア=中枢層なので水平連絡
  ['sanban_s_b2', 'opa', 9, 'whity'],            // 南館B2F 南東口→プチシャン/OPA・HEP前
  ['sanban_s_b2', 'j_east1', 12, 'whity'],       // 南館B2F 南口→ノースモール（ホワイティうめだ方面）
  ['sanban_s_b1', 'j_shibata', 18, 'umechika'],  // 三番街→芝田(御堂筋コンコース系)
  ['sanban_s_b1', 'bigman', 8, 'sanban'],         // 南館内・紀伊國屋前(紀伊國屋は OSM で市道の南=南館側)
  ['sanban_s_b1', 'j_yodo_e', 10],               // 三番街→ヨドバシ方面(中立の連絡地下道)
  ['j_yodo_e', 'yodobashi', 10, 'osaka_sta'],
  ['yodobashi', 'j_kita', 9],                     // ヨドバシ→高架下(中立の連絡通路)
  ['j_kita', 'jr_osaka', 14, 'osaka_sta'],
  ['sanban_s_b1', 'opa', 9, 'whity'],            // 三番街→プチシャン(ホワイティ)合流
  // プチシャン〜ノースモール1は南北方向の通路（阪急東側・実測）
  ['j_pchn', 'opa', 11, 'whity'],
  // 中央
  ['jr_osaka', 'lucua', 13, 'osaka_sta'],
  ['yodobashi', 'lucua', 12, 'osaka_sta'],   // リンクスB1F↔ルクアB1F 直結（浅層・公式確認: B1同士）
  ['lucua', 'grandfront', 10, 'osaka_sta'],
  ['umekita_sq', 'grandfront', 8, 'umekita'],     // 広場→グランフロント地下口
  ['jr_osaka', 'daimaru', 15, 'osaka_sta'],
  ['daimaru', 'j_c1', 13, 'osaka_sta'],
  ['j_metro', 'whity_w', 22, 'whity'],
  // ホワイティうめだ（実測: 東西軸はセンターモール→ポケットパーク→イーストモールの1本）
  // 阪神・東梅田
  ['hanshin', 'j_hanshin_e', 10, 'umechika'],
  ['j_f40', 'j_mido_s', 9],                       // 御堂筋西沿いの南北通路 前半(第4ビル東壁沿い。OSM実測)
  ['j_mido_s', 'sonechika', 9],                   // 同 後半(→そねちか北端)
  // ディアモール（十字）
  ['hanshin', 'j_diamor_n', 16, 'diamor'],
  ['j_diamor_e', 'ekimae4_b2', 9, 'ekimae'],   // バラエティST→第4ビルB2F西面へ入る枝(同じ中枢層・フラット)
  ['j_diamor_s', 'ekimae1_b2', 9, 'diamor'],   // ディアモール→第1ビルB2F(フラット)
  ['j_diamor_s', 'ekimae2_b2', 9, 'diamor'],   // ディアモール→第2ビルB2F(フラット)
  ['enkei', 'j_hilton_e', 18, 'diamor'],          // 円形広場→ヒルトンE東壁
  ['j_hilton_e', 'j_nishi_x', 18, 'nishi_umeda'], // ヒルトンE経由で西梅田へ
  // ファッショナブルストリート（駅前ビル北側を東西に走る幹線・E字の横棒）
  ['j_fashion_w', 'j_diamor_s', 16, 'diamor'],
  ['j_fashion_w', 'ekimae1', 8, 'ekimae'],
  ['j_fashion_e', 'ekimae4', 8, 'ekimae'],
  // マーケットストリート（円形広場→北東へ斜行、E-ma横で御堂筋線方面に接続）
  ['j_market_ne', 'ema', 8, 'ema'],               // マーケットST東端→イーマB1(直結・同じ中枢層)
  ['j_market_ne', 'j_hanshin_e', 9, 'umechika'],
  // 西梅田
  ['j_nishi_x', 'hilton', 9, 'nishi_umeda'],
  ['hilton', 'garden', 9, 'nishi_umeda'],
  ['j_c1', 'j_kitte_e', 12, 'nishi_umeda'],       // 桜橋→KITTE東側
  ['garden', 'herbis', 12, 'nishi_umeda'],
  ['garden', 'kitte', 8, 'nishi_umeda'],      // ガーデンシティ〜JR西口(KITTE)方面
  ['daimaru', 'kitte', 9, 'osaka_sta'],        // 大阪駅前地下道の西延長(桜橋口方面)
  ['hilton_b2', 'herbis_b2', 9, 'nishi_umeda'], // B2連絡通路(ガーデンアベニュー)
  ['herbis', 'j_nishi_x', 10, 'nishi_umeda'],
  // 北新地・堂島
  ['j_nishi_x', 'j_sone_w', 10, 'nishi_umeda'],
  ['j_sone_w', 'dojima', 9, 'dotica'],
  ['avanza', 'j_avz', 7, 'dotica'],       // アバンザ館内へ(C-84。通路はドーチカ側)=南の階段
  ['dotica_avz_n', 'j_avz_n', 7, 'dotica'], // アバンザ北の階段(北サンクンガーデン通路へ)
  ['dotica_avz_m', 'j_avz_m', 7, 'dotica'], // アバンザ中の階段(南サンクンガーデンへの曲線階段の手前へ)
  ['j_avz_n', 'j_avz', 6, 'avanza'],       // 館内西側の通路(北口→C-84側)
  ['j_avz_m', 'j_avz', 6, 'avanza'],
  ['j_sone_w', 'j_sone_c', 9, 'sonechika'],
  ['j_sone_c', 'j_sone_e', 9, 'sonechika'],       // 曽根崎地下歩道 東行(OSM実測 y≈1410-1420)
  // 駅前ビル
  ['ekimae1', 'ekimae2', 8, 'ekimae'],
  ['ekimae2', 'ekimae3', 8, 'ekimae'],
  ['ekimae3', 'ekimae4', 8, 'ekimae'],
  ['ekimae1_b2', 'j_sone_w', 8, 'ekimae'],     // 曽根崎地下歩道へはB2F(中枢層)からフラット
  ['ekimae1_b2', 'j_sone_c', 8, 'ekimae'],
  ['ekimae3_b2', 'sonechika', 8, 'ekimae'],    // そねちかへもB2F(中枢層)からフラット
  // 駅前ビル B2レベルの相互連絡通路（北新地駅 東改札は第2ビルB2に直結）
  ['ekimae1_b2', 'ekimae2_b2', 8, 'ekimae'],
  ['ekimae2_b2', 'ekimae3_b2', 8, 'ekimae'],
  ['ekimae3_b2', 'ekimae4_b2', 8, 'ekimae'],
  ['kitashinchi', 'ekimae2_b2', 8, 'ekimae'], // 北新地駅(深層)→B2F(中枢層)は段差接続
  ['kitashinchi', 'ekimae1_b2', 7, 'ekimae'], // 第1ビルも北新地駅直結(段差)
  // @region whity begin  (OSM way id をコメントに保持)
  ['j_east1', 'whity_20', 14, 'whity'], // osm 1010195568
  ['j_east1', 'whity_26', 14, 'whity'], // osm 1010195576
  ['j_f40', 'whity_19', 14, 'whity'], // osm 1110527726
  ['j_f40', 'whity_25', 14, 'whity'], // osm 1320007676
  ['j_hanshin_e', 'whity_04', 14, 'whity'], // osm 1329514168
  ['j_higashi_n', 'whity_30', 14, 'whity'], // osm 1010195559
  ['j_nm1s', 'whity_32', 14, 'whity'], // osm 1010195553
  ['whity_02', 'whity_01', 14, 'whity'], // osm 1010195556
  ['whity_02', 'whity_03', 14, 'whity'], // osm 1110527726
  ['whity_03', 'whity_08', 14, 'whity'], // osm 1110527726
  ['whity_03', 'whity_14', 14, 'whity'], // osm 1010195578
  ['whity_04', 'whity_08', 14, 'whity'], // osm 1329514175
  ['whity_05', 'whity_04', 14, 'whity'], // osm 1329514175
  ['whity_07', 'whity_02', 14, 'whity'], // osm 1010195556
  ['whity_07', 'whity_06', 14, 'whity'], // osm 1010195574
  ['whity_08', 'whity_11', 14, 'whity'], // osm 1110527726
  ['whity_09', 'whity_07', 14, 'whity'], // osm 1010195556
  ['whity_11', 'whity_10', 14, 'whity'], // osm 1329514175
  ['whity_11', 'whity_12', 14, 'whity'], // osm 1110527726
  ['whity_12', 'whity_15', 14, 'whity'], // osm 1110527726
  ['whity_12', 'whity_21', 14, 'whity'], // osm 1010195558
  ['whity_14', 'whity_13', 14, 'whity'], // osm 1320007679
  ['whity_14', 'whity_30', 14, 'whity'], // osm 1010195578
  ['whity_15', 'j_f40', 14, 'whity'], // osm 1110527726
  ['whity_17', 'whity_16', 14, 'whity'], // osm 1010195568
  ['whity_20', 'whity_17', 14, 'whity'], // osm 1010195568
  ['whity_20', 'whity_18', 14, 'whity'], // osm 1010195567
  ['whity_21', 'whity_14', 14, 'whity'], // osm 1320007678
  ['whity_21', 'whity_33', 14, 'whity'], // osm 1010195558
  ['whity_23', 'whity_22', 14, 'whity'], // osm 1322885774
  ['whity_24', 'whity_23', 14, 'whity'], // osm 1322885774
  ['whity_27', 'whity_28', 14, 'whity'], // osm 1322885762
  ['whity_28', 'whity_34', 14, 'whity'], // osm 1322885762
  ['whity_29', 'whity_21', 14, 'whity'], // osm 1320007678
  ['whity_30', 'whity_32', 14, 'whity'], // osm 1010195568
  ['whity_30', 'whity_40', 14, 'whity'], // osm 1010195578
  ['whity_31', 'whity_23', 14, 'whity'], // osm 1322885775
  ['whity_31', 'whity_34', 14, 'whity'], // osm 1010195568
  ['whity_32', 'j_whity_x', 14, 'whity'], // osm 1322885773
  ['whity_32', 'whity_31', 14, 'whity'], // osm 1010195568
  ['whity_33', 'j_higashi_n', 14, 'whity'], // osm 1010195559
  ['whity_34', 'whity_35', 14, 'whity'], // osm 1010195568
  ['whity_35', 'whity_37', 14, 'whity'], // osm 1010195568
  ['whity_36', 'whity_33', 14, 'whity'], // osm 1010195559
  ['whity_36', 'whity_39', 14, 'whity'], // osm 1322885772
  ['whity_37', 'j_east1', 14, 'whity'], // osm 1010195568
  ['whity_38', 'whity_36', 14, 'whity'], // osm 1010195559
  ['whity_40', 'izumi_ne', 14, 'whity'], // osm 1010195578
  ['opa', 'whity_17', 10, 'whity'], // 旧ノード接続 31m
  ['whity_w', 'whity_13', 10, 'whity'], // 旧ノード接続 1m
  ['izumi', 'whity_40', 10, 'whity'], // 旧ノード接続 0m
  ['j_nm2', 'j_nm1s', 10, 'whity'], // 旧ノード接続 13m
  // @region whity end
  // @region dotica begin  (OSM way id をコメントに保持)
  ['dotica_02', 'dojima', 12, 'dotica'], // osm 1010195561 (旧ノード dojima を挟む)
  ['dojima', 'dotica_avz_n', 12, 'dotica'], // osm 1010195561 (アバンザ北・中の階段下を挟む。再取り込み時は手で戻す)
  ['dotica_avz_n', 'dotica_avz_m', 12, 'dotica'], // osm 1010195561
  ['dotica_avz_m', 'dotica_01', 12, 'dotica'], // osm 1010195561
  ['dotica_01', 'avanza', 12, 'dotica'], // osm 1010195561 (旧ノード avanza を挟む)
  ['avanza', 'dotica_03', 12, 'dotica'], // osm 1010195561
  // @region dotica end
  // @region nishi_umeda begin  (OSM way id をコメントに保持)
  ['j_kitte_e', 'nishi_umeda_08', 13, 'nishi_umeda'], // osm 1318982038
  ['nishi_umeda_05', 'nishi_umeda_02', 13, 'nishi_umeda'], // osm 1318982038
  ['nishi_umeda_05', 'nishi_umeda_03', 13, 'nishi_umeda'], // osm 1473638614
  ['nishi_umeda_06', 'nishi_umeda_05', 13, 'nishi_umeda'], // osm 1318982038
  ['nishi_umeda_07', 'nishi_umeda_06', 13, 'nishi_umeda'], // osm 1318982038
  ['nishi_umeda_08', 'nishi_umeda_07', 13, 'nishi_umeda'], // osm 1318982038
  ['nishi_umeda_08', 'nishi_umeda_09', 13, 'nishi_umeda'], // osm 1322885760
  ['nishi_umeda_09', 'j_nishi_x', 13, 'nishi_umeda'], // osm 1322885759
  ['nishi_umeda_11', 'j_kitte_e', 13, 'nishi_umeda'], // osm 1318982038
  ['nishi_umeda_11', 'nishi_umeda_10', 13, 'nishi_umeda'], // osm 1322885761
  ['nishi_umeda_12', 'nishi_umeda_14', 13, 'nishi_umeda'], // osm 1010195576
  ['nishi_umeda_13', 'nishi_umeda_11', 13, 'nishi_umeda'], // osm 1318982038
  ['nishi_umeda_13', 'nishi_umeda_15', 13, 'nishi_umeda'], // osm 1323837466
  ['nishi_umeda_14', 'nishi_umeda_13', 13, 'nishi_umeda'], // osm 1318982038
  ['nishi_umeda_16', 'nishi_umeda_14', 13, 'nishi_umeda'], // osm 1010195556
  ['nishi_umeda_16', 'nishi_umeda_17', 13, 'nishi_umeda'], // osm 1320007664
  ['nishi_umeda_03', 'nishi_umeda_p2_garden', 13, 'nishi_umeda'], // osm 1473638614
  ['nishi_umeda_p2_garden', 'nishi_umeda_04', 13, 'nishi_umeda'], // osm 1473638614
  ['garden', 'nishi_umeda_p2_garden', 10, 'nishi_umeda'], // 旧ノード接続 0m
  ['nishi_umeda_01', 'nishi_umeda_p2_ritz', 13, 'nishi_umeda'], // osm 1318982038
  ['ritz', 'nishi_umeda_p2_ritz', 10, 'nishi_umeda'], // 旧ノード接続 17m
  // @region nishi_umeda end
  // @region sonechika begin  (OSM way id をコメントに保持)
  ['j_sone_e', 'sonechika_08', 9, 'sonechika'], // osm 1322885750
  ['j_sone_e', 'sonechika_13', 9, 'sonechika'], // osm 1010195557
  ['sonechika_01', 'sonechika_03', 9, 'sonechika'], // osm 1010195560
  ['sonechika_02', 'sonechika_04', 9, 'sonechika'], // osm 1322885752
  ['sonechika_03', 'sonechika_06', 9, 'sonechika'], // osm 1010195560
  ['sonechika_04', 'sonechika_03', 9, 'sonechika'], // osm 1322885751
  ['sonechika_04', 'sonechika_07', 9, 'sonechika'], // osm 1322885752
  ['sonechika_06', 'j_sone_e', 9, 'sonechika'], // osm 1010195557
  ['sonechika_06', 'sonechika_05', 9, 'sonechika'], // osm 1010195563
  ['sonechika_08', 'sonechika_09', 9, 'sonechika'], // osm 1322885750
  ['sonechika_11', 'sonechika_10', 9, 'sonechika'], // osm 1304369403
  ['sonechika_13', 'sonechika_12', 9, 'sonechika'], // osm 1010195577
  ['sonechika_14', 'sonechika_13', 9, 'sonechika'], // osm 1010195577
  ['sonechika_12', 'sonechika_p1_sonechika', 9, 'sonechika'], // osm 1010195577
  ['sonechika_p1_sonechika', 'sonechika_11', 9, 'sonechika'], // osm 1010195577
  ['sonechika', 'sonechika_p1_sonechika', 9, 'sonechika'], // 旧ノード接続 0m
  // @region sonechika end
  // @region umechika begin  (OSM way id をコメントに保持)
  ['j_market_ne', 'umechika_35', 12, 'umechika'], // osm 1010195558
  ['j_metro', 'umechika_15', 12, 'umechika'], // osm 1338274268
  ['j_mido_n', 'umechika_16', 12, 'umechika'], // osm 1010195574
  ['j_shibata', 'umechika_21', 12, 'umechika'], // osm 533777757
  ['j_sun', 'umechika_19', 12, 'umechika'], // osm 533777750
  ['umechika_04', 'umechika_02', 12, 'umechika'], // osm 1010195576
  ['umechika_04', 'umechika_03', 2, 'umechika'], // osm 330561963
  ['umechika_06', 'umechika_04', 12, 'umechika'], // osm 1010195572
  ['umechika_07', 'umechika_04', 12, 'umechika'], // osm 1010195576
  ['umechika_08', 'umechika_04', 2, 'umechika'], // osm 330561963
  ['umechika_10', 'umechika_11', 12, 'umechika'], // osm 1338274270
  ['umechika_13', 'umechika_19', 12, 'umechika'], // osm 533777754
  ['umechika_15', 'umechika_11', 12, 'umechika'], // osm 1010195556
  ['umechika_16', 'umechika_12', 12, 'umechika'], // osm 1010195576
  ['umechika_18', 'umechika_20', 12, 'umechika'], // osm 744803215
  ['umechika_19', 'umechika_14', 12, 'umechika'], // osm 533777750
  ['umechika_19', 'umechika_20', 12, 'umechika'], // osm 533777754
  ['umechika_20', 'umechika_21', 12, 'umechika'], // osm 533777754
  ['umechika_20', 'umechika_22', 12, 'umechika'], // osm 744803215
  ['umechika_21', 'umechika_26', 12, 'umechika'], // osm 533777754
  ['umechika_24', 'umechika_17', 12, 'umechika'], // osm 1010195567
  ['umechika_26', 'umechika_25', 12, 'umechika'], // osm 533777752
  ['umechika_27', 'umechika_26', 12, 'umechika'], // osm 533777752
  ['umechika_28', 'umechika_16', 12, 'umechika'], // osm 1010195576
  ['umechika_29', 'whity_05', 12, 'umechika'], // osm 1329514175
  ['umechika_31', 'umechika_30', 12, 'umechika'], // osm 533777753
  ['umechika_32', 'umechika_31', 12, 'umechika'], // osm 533777753
  ['umechika_33', 'umechika_23', 12, 'umechika'], // osm 1010195567
  ['umechika_34', 'umechika_29', 12, 'umechika'], // osm 1329514175
  ['umechika_23', 'sanban_s_b2', 12, 'umechika'], // osm 1010195567 (旧ノード sanban_s_b2 を挟む)
  ['sanban_s_b2', 'umechika_24', 12, 'umechika'], // osm 1010195567
  ['umechika_26', 'hq_concourse', 12, 'umechika'], // osm 533777754 (旧ノード hq_concourse を挟む)
  ['hq_concourse', 'umechika_31', 12, 'umechika'], // osm 533777754
  ['umechika_05', 'umechika_p4_daimaru', 12, 'umechika'], // osm 971056409
  ['umechika_p4_daimaru', 'umechika_01', 12, 'umechika'], // osm 971056409
  ['daimaru', 'umechika_p4_daimaru', 10, 'umechika'], // 旧ノード接続 20m
  ['umechika_11', 'umechika_p4_hanshin', 12, 'umechika'], // osm 1010195556
  ['umechika_p4_hanshin', 'umechika_09', 12, 'umechika'], // osm 1010195556
  ['hanshin', 'umechika_p4_hanshin', 10, 'umechika'], // 旧ノード接続 13m
  ['j_sun', 'j_mido_n', 13, 'umechika'],          // 御堂筋コンコース(阪急百はEV/ESCで接続)  // OSMに無い区間のため旧エッジを維持(import_region umechika)
  // @region umechika end
  // @region diamor begin  (OSM way id をコメントに保持)
  ['diamor_01', 'j_sone_c', 14, 'diamor'], // osm 1010195560
  ['diamor_03', 'diamor_00', 14, 'diamor'], // osm 1322885769 (旧 diamor_01 二重定義の北側。後勝ちで南端(1352)に化けて240mの偽の直通になっていた)
  ['diamor_03', 'diamor_05', 14, 'diamor'], // osm 1322885768
  ['diamor_03', 'j_diamor_s', 14, 'diamor'], // osm 1010195569
  ['diamor_03', 'j_market_ne', 14, 'diamor'], // osm 1010195558
  ['diamor_04', 'diamor_03', 14, 'diamor'], // osm 1010195570
  ['j_diamor_e', 'j_fashion_e', 14, 'diamor'], // osm 1010195571
  ['j_diamor_e', 'j_variety', 14, 'diamor'], // osm 1010195570
  ['j_diamor_s', 'j_diamor_e', 14, 'diamor'], // osm 1010195571
  ['j_diamor_s', 'j_sone_c', 14, 'diamor'], // osm 1010195564
  ['j_sone_c', 'diamor_02', 14, 'diamor'], // osm 1010195560
  ['j_variety', 'diamor_04', 14, 'diamor'], // osm 1010195570
  ['sonechika_06', 'j_diamor_e', 14, 'diamor'], // osm 1010195563
  ['diamor_03', 'enkei', 14, 'diamor'], // osm 1010195572 (旧ノード enkei を挟む)
  ['enkei', 'j_diamor_n', 14, 'diamor'], // osm 1010195572
  // @region diamor end
  // A-1方面の連絡通路は撤去(地上に行くためだけの通路は描かない=地下完結コンセプト)。nishi_a1_j は本線上の点として残す
  ['nishi_umeda_02', 'nishi_a1_j', 13, 'nishi_umeda'],
  ['nishi_a1_j', 'nishi_umeda_01', 13, 'nishi_umeda'],
  // 南西端のY字路(現地写真 2026-08-23): 黄色い円形のオブジェを挟んで 6-1(左)と 6-2(右)へ
  ['nishi_umeda_p2_ritz', 'nishi_y', 13, 'nishi_umeda'],
  ['nishi_y', 'nishi_y_k1', 8, 'nishi_umeda'],
  ['nishi_y_k1', 'exit_6_1', 8, 'nishi_umeda'],
  ['nishi_y', 'exit_6_2', 8, 'nishi_umeda'],
  // HEP FIVE / NAVIO / OSビル の地下接続(ホワイティ ノースモール1・2 から。2026-08-23 現地指摘+公式アクセス)
  ['j_east1', 'hep', 10, 'hep'],
  ['j_nm2', 'navio', 8, 'hep'],
  ['j_nm2', 'osbld', 8, 'osbld'],
];

// フロア間の縦移動設備。位置は各駅のバリアフリー情報を元に配置
// a: B1側ノード / b: B2側ノード / mx,my: 設備の位置（地図px）
const VERTICALS = [
  // 御堂筋線 梅田駅（EVは各ホーム1基: 中北東改札側・南改札側）
  { type: 'ev',     a: 'j_metro',     b: 'midosuji',    mx: 924.5, my: 927.8, name: '南改札EV' },
  { type: 'esc',    a: 'j_metro',     b: 'midosuji',    mx: 911.8, my: 912.2, name: '南改札ESC' },
  { type: 'ev',     a: 'hankyu_dept', b: 'midosuji',    mx: 944.4, my: 891.4, name: '中北東改札EV' },
  { type: 'esc',    a: 'hankyu_dept', b: 'midosuji',    mx: 966.1, my: 879.1, name: '北改札ESC' },
  // 谷町線 東梅田駅（EVは南改札側・中西改札側 / 北東改札はESC）
  { type: 'esc',    a: 'j_higashi_n', b: 'higashi',     mx: 1065.4, my: 1030.7, name: '北東改札ESC' },
  { type: 'ev',     a: 'j_f40',       b: 'higashi',     mx: 1055.3, my: 1063.1, name: '中西改札EV' },
  { type: 'ev',     a: 'ekimae4_b2',  b: 'higashi',     mx: 1039.2, my: 1144.8, name: '南改札EV' },  // B2F(中枢層)⇔東梅田(深層)
  { type: 'esc',    a: 'ekimae4_b2',  b: 'higashi',     mx: 1058.7, my: 1131.6, name: '南改札ESC' },
  // 四つ橋線 西梅田駅（EVは南改札側のみ / 北改札はESC）
  { type: 'esc',    a: 'j_nishi_x',   b: 'nishi',       mx: 633.6, my: 1156.5, name: '北改札ESC' },
  { type: 'ev',     a: 'herbis',      b: 'nishi',       mx: 786.1, my: 1171.6, name: '南改札EV' },
  { type: 'stairs', a: 'j_sone_w',    b: 'nishi',       mx: 716.3, my: 1240.9, name: '南改札階段' },
  // 阪神 大阪梅田駅（ホームはB2頭端式。西口EV / 百貨店口・東口はESC・階段でB1へ）
  { type: 'ev',     a: 'hanshin',     b: 'hanshin_home', mx: 774.6, my: 1023.1, name: '西口EV' },
  { type: 'esc',    a: 'hanshin',     b: 'hanshin_home', mx: 837.3, my: 1010.2, name: '百貨店口ESC' },
  // JR東西線 北新地駅（西改札・東改札の両方にEV）
  { type: 'ev',     a: 'j_sone_c',    b: 'kitashinchi', mx: 872.8, my: 1347.6, name: '西改札EV' },
  { type: 'esc',    a: 'j_sone_c',    b: 'kitashinchi', mx: 843.8, my: 1341.5, name: '西改札ESC' },
  { type: 'ev',     a: 'sonechika',   b: 'kitashinchi', mx: 1045, my: 1355.8, name: '東改札EV' },
  { type: 'esc',    a: 'sonechika',   b: 'kitashinchi', mx: 1009.4, my: 1353.5, name: '東改札ESC' },
  // 商業施設のB1⇔B2フロア間（館内ESC・階段）
  { type: 'esc',    a: 'hankyu_dept', b: 'j_hankyu_b2', mx: 1005.3, my: 856.3, name: '阪急百貨店 館内ESC' },
  { type: 'esc',    a: 'daimaru',     b: 'j_daimaru_b2', mx: 800.9, my: 979.4, name: '大丸 館内ESC' },
  { type: 'esc',    a: 'lucua',       b: 'lucua_b2',    mx: 717.8, my: 846.9, name: 'ルクア館内ESC' },
  { type: 'esc',    a: 'sanban_n_b1', b: 'sanban_n_b2', mx: 945, my: 540, name: '三番街北館ESC' }, // 北館内(市道の北)
  { type: 'esc',    a: 'sanban_s_b1', b: 'sanban_s_b2', mx: 972.1, my: 687.3, name: '三番街南館ESC' },
  // リンクス梅田 B1F(浅層)⇔B2F(中枢層): 同施設内のみ。EVとESCの2本
  { type: 'ev',     a: 'yodobashi',   b: 'yodobashi_b2', mx: 750.4, my: 658.6, name: 'リンクス梅田EV' },
  { type: 'esc',    a: 'yodobashi',   b: 'yodobashi_b2', mx: 781.2, my: 651.2, name: 'リンクス梅田ESC' },
  { type: 'esc',    a: 'ekimae1',     b: 'ekimae1_b2',  mx: 809.6, my: 1280.4, name: '第1ビル館内ESC' },
  { type: 'esc',    a: 'ekimae2',     b: 'ekimae2_b2',  mx: 945.1, my: 1288, name: '第2ビル館内ESC' },
  { type: 'esc',    a: 'hilton',      b: 'hilton_b2',   mx: 739, my: 1157.2, name: 'ヒルトン館内ESC' },
  { type: 'esc',    a: 'herbis',      b: 'herbis_b2',   mx: 604.7, my: 1188.7, name: 'ハービス館内ESC' },
  { type: 'stairs', a: 'ekimae3',     b: 'ekimae3_b2',  mx: 1064.9, my: 1286.5, name: '第3ビル館内階段' },
  { type: 'stairs', a: 'ekimae4',     b: 'ekimae4_b2',  mx: 1031.1, my: 1170, name: '第4ビル館内階段' },
];
const VERT_LABEL = { ev: 'エレベーター', esc: 'エスカレーター', stairs: '階段' };
const VERT_ICON  = { ev: '🛗', esc: '↗', stairs: '🪜' };
const VERT_COST  = { ev: 90, esc: 40, stairs: 60 }; // 乗換の手間（待ち時間など）を距離換算で加算

// B2は駅のホーム階。路線・ホームを描いてB2にも「通り」があることを見せる（見た目用）
const RAIL_LINES = [
  { name: '御堂筋線',  color: 0xe5343c,
    ends: ['中津・新大阪方面', 'なんば・天王寺方面'],
    pts: [[943.3, 452.1], [945.2, 746.1], [943.6, 866.5], [945.4, 1093.7], [955.9, 1583.6]] },
  { name: '谷町線',    color: 0x9a6fd6,
    ends: ['中崎町・都島方面', '南森町・天王寺方面'],
    pts: [[1231.4, 680.8], [1141.6, 987], [1103.8, 1086.3], [1105.9, 1184.3], [1166.3, 1405], [1223.5, 1625.8]] },
  // 西梅田は改札がB2・ホームB3（実調査）のため線路・ホームをさらに下げて描く
  { name: '四つ橋線',  color: 0x2f9fe0, dy: -16,
    ends: [null, '肥後橋・なんば方面'],
    pts: [[719.3, 1197.1], [727.2, 1406.3], [740.4, 1673.2]] },
  { name: 'JR東西線',  color: 0xf06eaa,
    ends: ['新福島・尼崎方面', '大阪天満宮・京橋方面'],
    pts: [[4.9, 1429.2], [469.1, 1381.5], [867.2, 1345.2], [1165.5, 1312.3], [1364.3, 1285.7]] },
  // 阪神本線（頭端式ターミナル: 東端が車止め）
  { name: '阪神本線',  color: 0x3b82d0,
    ends: ['福島・神戸三宮方面', null],
    pts: [[11.4, 1120.5], [232.2, 1090.4], [563.8, 1054.7], [871.3, 1029.5]] },
];

// 駅ホーム（B2の見た目用スラブ）。dirは線路方向、dyは追加の深さ
const PLATFORMS = [
  { mx: 944.5, my: 862, len: 100, w: 18, dir: [-1.1, 374.4] },           // 御堂筋線 梅田（島式1面）
  { mx: 1115.5, my: 1104.6, len:  90, w:  8, dir: [-25.9, 223.7] },           // 谷町線 東梅田（相対式・東側）
  { mx: 1091.1, my: 1103.7, len:  90, w:  8, dir: [-25.9, 223.7] },           // 谷町線 東梅田（相対式・西側）
  { mx: 722.3, my: 1254.9, len:  85, w: 16, dir: [0, 0.9], dy: -16 },      // 四つ橋線 西梅田（島式・B3相当）
  { mx: 867.2, my: 1345.2, len:  95, w: 14, dir: [917.3, -99.3] },           // JR東西線 北新地（島式）
  { mx: 773.9, my: 1038.3, len:  95, w: 22, dir: [307.5, -25.1] },           // 阪神 大阪梅田（頭端式4面）
];

// 広場・モール（見た目用の面。経路には影響しない）
const PLAZAS = [
  { kind: 'disc', mx: 862.7, my: 1140.3, r: 16, floor: 'B1', zone: 'diamor' },      // 円形広場
  { kind: 'disc', mx: 1310.2, my: 919.5, r: 15, floor: 'B1', zone: 'whity' },       // 泉の広場
];

// 任意多角形のフロア面（地図pxの頂点列。coversに挙げた通路はこの面が置き換える）
// 自動生成: 実座標(OSM/Google校正)ベースのゾーン外周ポリゴン(全頂点明示・重なりなし)
// 生成: tools/gen_polys.py v2。手編集せず再生成すること
const FLOOR_POLYS = [
  { floor: 'S1', zone: 'sanban', pts: [[929.0, 662.0], [929.8, 667.3], [931.3, 667.1], [934.4, 683.7], [922.3, 685.5], [929.7, 727.7], [961.3, 723.5], [1003.4, 715.4], [1030.8, 704.5], [1046.3, 695.9], [1037.1, 621.3], [1026.5, 571.4], [1024.2, 570.5], [1022.6, 563.1], [911.6, 582.1], [913.2, 590.4], [911.4, 590.8], [915.9, 617.6], [918.3, 617.2], [925.9, 662.5]], covers: [['hankyu', 'sanban_n_b1'], ['sanban_s_b1', 'bigman']] },
  { floor: 'S1', zone: 'sanban', pts: [[894.8, 492.0], [909.6, 572.3], [1020.5, 553.3], [1015.8, 533.1], [989.4, 444.3], [913.3, 457.9], [911.3, 467.3], [905.6, 468.1]] },
  { floor: 'S1', zone: 'links', pts: [[689.8, 638.4], [709.1, 706.4], [712.1, 705.4], [719.3, 728.3], [729.8, 752.3], [738.2, 758.3], [742.9, 759.4], [752.9, 757.9], [835.5, 707.9], [843.3, 699.1], [847.0, 686.5], [845.7, 657.4], [853.1, 656.5], [848.0, 623.1], [838.4, 616.3], [831.5, 616.2], [830.2, 608.2], [815.6, 610.3], [817.0, 619.6]] },
  { floor: 'S1', zone: 'grandfront', pts: [[585.0, 662.1], [586.8, 682.7], [591.4, 698.1], [601.0, 717.5], [615.5, 734.8], [630.5, 746.5], [653.3, 759.7], [679.6, 765.0], [697.8, 764.4], [700.6, 760.2], [699.6, 754.6], [686.5, 697.2], [683.1, 697.6], [671.3, 645.0], [665.7, 641.1], [651.1, 643.8], [646.1, 646.7], [628.1, 649.7], [625.5, 648.6], [589.9, 654.7]] },
  { floor: 'S1', zone: 'umekita', pts: [[595.4, 765.2], [591.5, 774.4], [596.5, 776.5], [594.6, 810.2], [596.6, 811.4], [596.1, 816.7], [604.5, 817.6], [609.2, 821.7], [615.7, 814.1], [613.0, 811.8], [616.7, 809.5], [628.5, 794.8], [631.4, 787.1], [642.2, 788.9], [644.5, 798.2], [622.4, 811.3], [627.5, 819.9], [650.6, 806.2], [647.7, 801.2], [655.1, 799.4], [650.0, 778.4], [650.1, 758.1], [631.3, 748.2], [624.8, 742.6], [620.7, 754.2], [610.6, 757.1], [601.6, 767.8]], holes: [[[633.1, 758.4], [640.1, 759.0], [640.0, 778.4], [634.9, 777.6], [636.4, 766.9]]], covers: [['umekita_sq', 'grandfront']] },
  { floor: 'S1', zone: 'lucua', pts: [[606.9, 927.7], [793.5, 813.5], [799.6, 823.2], [839.9, 797.9], [833.5, 787.9], [843.1, 782.1], [841.0, 778.7], [849.2, 774.0], [839.2, 767.6], [834.8, 762.0], [834.3, 758.9], [845.6, 755.1], [843.9, 749.6], [835.4, 737.3], [734.4, 799.2], [718.3, 774.4], [666.4, 808.0], [665.5, 806.6], [572.8, 863.7], [586.3, 884.7], [582.1, 887.3]] },
  { floor: 'S1', zone: 'osaka_sta', pts: [[588.0, 922.3], [647.2, 1021.1], [715.4, 979.9], [721.0, 989.4], [718.1, 983.6], [807.9, 928.4], [807.0, 927.0], [823.2, 916.7], [827.9, 913.8], [830.6, 918.2], [881.8, 885.4], [887.4, 885.6], [891.3, 882.4], [891.7, 866.8], [904.2, 857.9], [863.9, 744.5], [839.5, 758.3], [844.5, 768.4], [842.6, 769.6], [849.4, 774.0], [841.2, 778.7], [843.2, 782.2], [833.7, 788.0], [840.0, 798.1], [799.6, 823.4], [793.5, 813.7], [607.0, 927.9], [597.9, 913.4], [594.1, 915.6], [595.3, 917.7]], covers: [['j_yodo_e', 'yodobashi'], ['j_kita', 'jr_osaka'], ['jr_osaka', 'lucua'], ['yodobashi', 'lucua'], ['lucua', 'grandfront'], ['jr_osaka', 'daimaru']] },
  { floor: 'S1', zone: 'osaka_sta', pts: [[663.5, 780.6], [650.2, 778.5], [655.2, 799.4], [647.9, 801.3], [651.3, 807.5], [669.9, 796.7], [673.8, 803.2], [690.1, 793.1], [681.0, 769.7], [683.7, 767.7], [681.9, 765.1], [662.7, 762.2], [650.3, 758.2], [650.2, 763.7], [661.6, 768.7]] },
  { floor: 'S1', zone: 'osaka_sta', pts: [[562.3, 1066.3], [618.8, 1032.6], [620.5, 1035.2], [625.6, 1032.3], [567.3, 935.1], [560.9, 939.1], [547.2, 917.2], [536.6, 923.5], [440.3, 998.5], [454.2, 1019.6], [492.9, 994.4], [493.9, 995.9], [512.9, 984.1]] },
  { floor: 'S1', zone: 'ekimae', pts: [[1023.8, 1217.5], [1033.8, 1250.9], [998.1, 1251.3], [989.7, 1263.6], [999.6, 1294.3], [985.5, 1294.5], [973.9, 1259.7], [964.3, 1250.8], [883.3, 1251.3], [874.4, 1261.0], [874.1, 1292.0], [860.9, 1291.3], [861.8, 1261.0], [853.2, 1251.1], [740.5, 1252.0], [727.5, 1264.5], [725.4, 1310.6], [741.4, 1327.2], [851.0, 1335.6], [859.8, 1327.5], [860.7, 1299.3], [874.0, 1300.0], [873.7, 1330.6], [881.9, 1339.6], [942.3, 1344.6], [989.8, 1344.1], [998.1, 1333.2], [988.2, 1302.4], [1002.2, 1302.3], [1013.1, 1336.8], [1024.1, 1344.7], [1105.2, 1344.8], [1115.6, 1333.8], [1090.4, 1259.0], [1081.2, 1250.5], [1042.1, 1250.9], [1032.1, 1217.5], [1070.8, 1217.5], [1078.9, 1208.2], [1055.8, 1139.2], [1042.6, 1135.0], [956.1, 1159.3], [951.1, 1171.6], [972.2, 1212.2], [981.9, 1217.6]], covers: [['j_fashion_w', 'ekimae1'], ['j_fashion_e', 'ekimae4'], ['ekimae1', 'ekimae2'], ['ekimae2', 'ekimae3'], ['ekimae3', 'ekimae4']] },
  { floor: 'S1', zone: '_neutral', pts: [[847.3, 678.0], [846.8, 688.0], [922.4, 687.0], [922.2, 685.4], [934.2, 683.6], [933.0, 676.9]], covers: [['sanban_s_b1', 'j_yodo_e'], ['yodobashi', 'j_kita']] },
  { floor: 'S1', zone: '_neutral', pts: [[837.5, 720.2], [914.4, 708.0], [912.9, 698.1], [841.5, 709.5], [841.3, 702.1], [833.8, 709.1], [835.8, 709.0]] },
  { floor: 'B1', zone: 'sanban', pts: [[905.6, 468.1], [894.8, 492.0], [909.6, 572.3], [936.0, 567.5], [936.0, 577.7], [911.6, 582.1], [913.2, 590.4], [911.4, 590.8], [915.9, 617.6], [918.3, 617.2], [925.9, 662.5], [929.0, 662.0], [929.8, 667.3], [931.3, 667.1], [934.4, 683.7], [922.3, 685.5], [929.7, 727.7], [984.2, 719.7], [1002.4, 715.2], [1030.8, 704.5], [1046.3, 695.9], [1042.6, 672.4], [1033.0, 673.9], [1030.8, 660.1], [1039.9, 658.6], [1031.5, 608.4], [1020.1, 563.4], [990.0, 567.8], [990.0, 557.7], [1017.5, 553.7], [1016.6, 550.6], [1018.5, 550.1], [1017.5, 545.7], [1018.6, 545.5], [989.4, 444.3], [913.3, 457.9], [911.3, 467.3]], holes: [[[940.0, 566.8], [986.0, 558.3], [986.0, 568.4], [940.0, 577.0]]], covers: [['hankyu', 'sanban_n_b1'], ['sanban_n2_w', 'sanban_s2_w'], ['sanban_n2_e', 'sanban_s2_e']] },
  { floor: 'B1', zone: 'links', pts: [[689.8, 638.4], [709.1, 706.4], [712.1, 705.4], [719.3, 728.3], [729.8, 752.3], [738.2, 758.3], [742.9, 759.4], [752.9, 757.9], [835.5, 707.9], [843.3, 699.1], [847.0, 686.5], [845.7, 657.4], [853.1, 656.5], [848.0, 623.1], [838.4, 616.3], [831.5, 616.2], [830.2, 608.2], [815.6, 610.3], [817.0, 619.6]] },
  { floor: 'B1', zone: 'lucua', pts: [[606.9, 927.7], [793.5, 813.5], [799.6, 823.2], [839.9, 797.9], [833.5, 787.9], [843.1, 782.1], [841.0, 778.7], [849.2, 774.0], [839.2, 767.6], [834.8, 762.0], [834.3, 758.9], [845.6, 755.1], [843.9, 749.6], [835.4, 737.3], [734.4, 799.2], [718.3, 774.4], [666.4, 808.0], [665.5, 806.6], [572.8, 863.7], [586.3, 884.7], [582.1, 887.3]] },
  { floor: 'B1', zone: 'hilton', pts: [[741.9, 1130.4], [739.6, 1171.8], [735.8, 1177.8], [734.9, 1186.4], [737.7, 1196.4], [738.1, 1207.0], [741.7, 1211.8], [741.7, 1217.8], [786.6, 1217.4], [791.0, 1215.2], [792.7, 1210.9], [794.6, 1169.4], [797.0, 1161.3], [805.7, 1147.4], [819.4, 1136.7], [789.5, 1086.8], [764.4, 1101.1], [758.8, 1099.9], [756.7, 1106.0], [748.4, 1113.5], [744.0, 1121.9]] },
  { floor: 'B1', zone: 'hilton', pts: [[675.5, 1210.9], [701.6, 1211.8], [705.4, 1145.6], [678.6, 1144.4], [656.6, 1157.2], [654.2, 1222.4], [675.4, 1217.2]] },
  { floor: 'B1', zone: 'herbis', pts: [[676.6, 1140.7], [669.4, 1138.4], [658.9, 1138.5], [650.3, 1140.5], [635.6, 1147.2], [655.2, 1192.8], [656.5, 1157.1], [679.8, 1144.3]] },
  { floor: 'B1', zone: 'herbis', pts: [[562.5, 1245.1], [588.4, 1246.8], [588.4, 1244.5], [594.8, 1244.0], [600.4, 1241.6], [608.4, 1235.8], [611.4, 1231.8], [624.8, 1232.2], [657.0, 1222.3], [654.1, 1222.4], [654.3, 1215.9], [626.9, 1152.4], [585.7, 1185.2], [587.8, 1189.7], [585.2, 1189.6], [563.7, 1207.0], [561.2, 1207.0], [561.2, 1211.5], [558.5, 1211.6], [558.6, 1241.7], [562.6, 1241.7]] },
  { floor: 'B1', zone: 'herbis', pts: [[395.7, 1417.9], [418.8, 1399.8], [420.7, 1401.8], [440.9, 1387.9], [450.5, 1377.6], [452.5, 1361.8], [469.5, 1347.7], [479.0, 1348.3], [479.6, 1339.2], [491.6, 1328.9], [488.5, 1325.5], [496.2, 1318.4], [493.6, 1315.7], [501.7, 1307.4], [508.6, 1304.6], [518.2, 1294.4], [520.9, 1288.5], [543.6, 1269.5], [545.2, 1265.6], [554.1, 1257.1], [544.4, 1247.1], [539.8, 1251.6], [532.4, 1250.3], [529.2, 1251.7], [526.3, 1249.6], [520.0, 1254.6], [517.2, 1251.7], [487.4, 1275.8], [489.1, 1278.0], [473.7, 1292.2], [470.6, 1289.0], [459.2, 1299.2], [460.8, 1300.9], [453.4, 1308.8], [446.2, 1307.9], [445.6, 1315.1], [438.4, 1321.2], [434.4, 1320.7], [434.0, 1325.0], [430.0, 1328.5], [420.4, 1327.8], [419.8, 1335.0], [414.9, 1330.6], [411.4, 1339.0], [391.1, 1355.3], [389.1, 1353.1], [369.8, 1369.0], [371.6, 1371.2], [363.1, 1378.2]] },
  { floor: 'B1', zone: 'kitte', pts: [[645.8, 1102.7], [635.2, 1085.5], [647.5, 1077.9], [619.0, 1031.9], [503.4, 1101.1], [521.0, 1194.7], [581.7, 1141.6]] },
  { floor: 'B1', zone: 'ema', pts: [[979.6, 1060.6], [956.6, 1074.8], [958.1, 1078.8], [956.0, 1079.9], [977.2, 1135.1], [1013.3, 1121.6], [1004.9, 1100.9], [986.1, 1068.1], [982.4, 1069.7]], covers: [['j_market_ne', 'ema']] },
  { floor: 'B1', zone: 'hep', pts: [[1078.1, 865.4], [1080.5, 869.8], [1083.4, 871.5], [1086.7, 871.9], [1091.2, 869.9], [1160.1, 804.1], [1155.3, 762.2], [1151.1, 763.0], [1151.1, 761.0], [1128.9, 763.3], [1128.3, 756.5], [1145.6, 754.8], [1143.9, 730.1], [1205.1, 725.5], [1201.3, 667.9], [1191.9, 669.0], [1176.3, 675.5], [1112.5, 706.4], [1090.1, 720.3], [1089.8, 729.6], [1086.6, 735.9], [1086.1, 742.5], [1088.2, 742.5], [1086.3, 760.6], [1090.5, 760.2]], covers: [['j_east1', 'hep'], ['j_nm2', 'navio']] },
  { floor: 'B1', zone: 'osbld', pts: [[1174.8, 867.9], [1176.4, 817.7], [1167.7, 817.4], [1112.7, 873.3], [1115.1, 879.2], [1162.6, 879.5], [1162.7, 876.2], [1168.9, 873.1], [1171.5, 867.8]], covers: [['j_nm2', 'osbld']] },
  { floor: 'B1', zone: 'daimaru', pts: [[717.4, 983.4], [752.1, 1041.3], [845.7, 984.0], [852.6, 978.0], [856.7, 970.0], [856.2, 960.8], [828.0, 913.1], [806.4, 926.8], [807.2, 928.2]] },
  { floor: 'B1', zone: 'hankyu_dept', pts: [[955.3, 895.1], [962.3, 915.0], [971.3, 925.2], [988.2, 922.9], [988.5, 924.5], [1025.0, 923.0], [1025.6, 936.7], [1040.8, 934.2], [1049.9, 927.6], [1052.8, 922.2], [1053.3, 919.3], [1046.2, 918.3], [1050.0, 887.6], [1057.8, 888.4], [1060.1, 871.0], [1020.6, 870.9], [1019.9, 776.5], [1016.0, 770.6], [1009.8, 768.7], [951.3, 806.4]] },
  { floor: 'B1', zone: 'hanshin_dept', pts: [[971.5, 1045.8], [984.8, 1068.5], [986.2, 1068.0], [1012.2, 1114.3], [1014.4, 1113.5], [1016.3, 1120.1], [1023.6, 1117.8], [1024.3, 1119.5], [1060.2, 1110.0], [1058.3, 1102.1], [1061.8, 1101.2], [1054.2, 1074.5], [1047.4, 1062.9], [982.6, 1007.0], [964.9, 999.4], [955.0, 997.0], [944.4, 997.2], [934.9, 998.1], [925.2, 1001.8], [853.8, 1045.7], [884.9, 1097.3]] },
  { floor: 'B1', zone: 'avanza', pts: [[744.4, 1530.4], [823.2, 1542.6], [831.8, 1485.4], [833.9, 1483.1], [832.2, 1482.8], [833.0, 1477.7], [828.0, 1482.2], [754.3, 1471.1], [756.0, 1474.2], [750.8, 1468.7], [741.2, 1532.8]], covers: [['j_avz_n', 'j_avz'], ['j_avz_m', 'j_avz']] },
  { floor: 'B1', zone: 'diamor', pts: [[709.3, 1257.0], [723.3, 1257.6], [724.2, 1234.6], [853.1, 1234.2], [833.4, 1251.8], [847.0, 1251.7], [861.7, 1238.6], [860.1, 1344.7], [857.6, 1344.5], [856.3, 1358.4], [876.6, 1360.0], [877.5, 1346.1], [874.1, 1345.8], [875.7, 1241.0], [884.9, 1251.8], [896.6, 1251.7], [880.7, 1233.1], [965.1, 1232.7], [1008.0, 1369.5], [1021.4, 1365.3], [979.8, 1232.7], [1029.3, 1232.9], [1029.3, 1218.9], [975.3, 1218.7], [938.5, 1151.0], [940.0, 1149.0], [935.7, 1145.7], [933.1, 1140.9], [930.8, 1142.1], [894.8, 1115.0], [895.4, 1112.6], [889.9, 1111.4], [953.3, 1073.8], [958.2, 1073.6], [979.6, 1060.4], [982.3, 1066.2], [982.2, 1064.3], [971.4, 1046.0], [881.6, 1100.0], [882.3, 1093.3], [873.3, 1078.4], [869.9, 1078.0], [868.1, 1094.5], [854.2, 1071.0], [857.6, 1052.4], [853.6, 1045.7], [859.6, 1041.8], [866.6, 1003.1], [850.9, 1000.2], [841.7, 1050.3], [822.9, 1019.4], [810.9, 1026.8], [838.0, 1071.0], [836.8, 1077.4], [842.3, 1078.4], [857.8, 1105.1], [808.5, 1111.9], [809.7, 1120.1], [815.1, 1129.2], [858.8, 1123.2], [863.9, 1127.0], [862.0, 1218.1], [724.9, 1218.6], [725.5, 1203.3], [711.5, 1202.7]], holes: [[[877.5, 1147.4], [880.3, 1147.3], [883.6, 1153.7], [896.0, 1147.3], [886.0, 1127.8], [891.3, 1129.9], [910.9, 1144.7], [928.0, 1161.3], [958.6, 1218.7], [876.9, 1219.1]]], covers: [['hanshin', 'j_diamor_n'], ['j_diamor_s', 'ekimae1_b2'], ['j_diamor_s', 'ekimae2_b2'], ['enkei', 'j_hilton_e'], ['j_fashion_w', 'j_diamor_s'], ['diamor_01', 'j_sone_c'], ['diamor_03', 'diamor_00'], ['diamor_03', 'diamor_05'], ['diamor_03', 'j_diamor_s'], ['diamor_03', 'j_market_ne'], ['diamor_04', 'diamor_03'], ['j_diamor_e', 'j_fashion_e'], ['j_diamor_e', 'j_variety'], ['j_diamor_s', 'j_diamor_e'], ['j_diamor_s', 'j_sone_c'], ['j_sone_c', 'diamor_02'], ['j_variety', 'diamor_04'], ['sonechika_06', 'j_diamor_e'], ['diamor_03', 'enkei'], ['enkei', 'j_diamor_n']] },
  { floor: 'B1', zone: 'whity', pts: [[938.8, 997.5], [948.6, 996.8], [923.3, 949.2], [928.2, 949.0], [933.4, 958.2], [948.1, 950.4], [957.3, 976.3], [958.5, 976.1], [962.7, 985.9], [957.6, 981.0], [947.3, 990.5], [953.2, 996.9], [964.9, 999.2], [982.7, 1006.9], [1019.1, 1037.1], [1047.5, 1062.8], [1051.5, 1067.9], [1057.2, 1062.4], [1062.1, 1067.3], [1075.1, 1062.7], [1078.8, 1075.1], [1092.3, 1071.1], [1080.3, 1031.2], [1093.6, 1027.4], [1089.7, 1013.9], [1076.4, 1017.8], [1066.1, 973.8], [1070.7, 955.2], [1075.2, 954.9], [1075.5, 966.7], [1089.3, 965.8], [1089.0, 954.2], [1128.5, 952.0], [1129.0, 964.2], [1161.1, 961.7], [1161.0, 960.5], [1181.8, 958.8], [1181.7, 956.9], [1268.3, 946.3], [1277.6, 956.3], [1290.2, 955.4], [1290.1, 951.0], [1298.0, 952.0], [1304.9, 945.3], [1310.0, 936.1], [1313.2, 938.0], [1315.7, 934.5], [1315.6, 919.2], [1301.9, 904.6], [1297.8, 852.7], [1284.2, 854.5], [1285.0, 863.5], [1281.3, 864.0], [1280.5, 855.1], [1267.3, 856.8], [1270.3, 887.2], [1271.0, 916.1], [1265.1, 924.0], [1262.5, 921.8], [1182.3, 930.9], [1182.6, 934.3], [1173.7, 935.1], [1173.5, 931.8], [1159.7, 933.0], [1159.9, 936.3], [1156.2, 936.5], [1155.8, 931.5], [1113.7, 935.2], [1113.8, 938.8], [1107.3, 939.1], [1107.3, 935.9], [1094.1, 936.8], [1088.7, 928.3], [1092.3, 918.8], [1098.6, 919.4], [1099.9, 905.5], [1093.9, 904.9], [1105.4, 885.9], [1113.5, 875.7], [1112.6, 873.2], [1121.8, 863.7], [1119.8, 861.5], [1121.8, 859.3], [1116.7, 854.6], [1116.5, 846.0], [1085.1, 876.0], [1082.5, 875.8], [1082.8, 871.4], [1077.9, 865.5], [1078.0, 855.2], [1088.2, 778.0], [1087.2, 769.8], [1084.9, 756.2], [1081.6, 756.9], [1080.7, 752.5], [1076.3, 753.5], [1075.0, 749.5], [1075.9, 747.9], [1074.3, 746.9], [1062.2, 695.0], [1069.9, 690.6], [1065.4, 676.5], [1058.4, 678.8], [1057.4, 674.6], [1063.7, 672.5], [1059.5, 657.3], [1055.2, 627.0], [1049.0, 628.2], [1048.3, 623.6], [1054.4, 622.3], [1053.1, 612.0], [1040.6, 564.7], [1035.3, 566.2], [1033.6, 559.9], [1037.3, 559.0], [1034.8, 549.0], [1031.0, 550.1], [1028.3, 543.3], [1017.7, 545.8], [1018.6, 550.1], [1016.8, 550.7], [1031.7, 608.4], [1040.0, 658.6], [1030.9, 660.3], [1033.2, 673.8], [1042.7, 672.3], [1057.4, 736.7], [1035.8, 723.5], [1033.8, 707.8], [1019.9, 709.6], [1000.1, 715.9], [1003.5, 717.9], [995.0, 717.2], [990.3, 718.3], [987.6, 748.3], [1001.5, 749.6], [1002.2, 742.7], [1013.8, 742.5], [1013.5, 724.0], [1016.9, 726.1], [1019.0, 754.3], [1016.1, 756.2], [1021.5, 773.0], [1061.3, 759.5], [1068.4, 801.5], [1065.8, 833.2], [1051.8, 833.6], [1052.3, 850.0], [1050.9, 856.0], [1052.5, 857.9], [1063.6, 858.9], [1061.2, 888.8], [1050.2, 887.7], [1046.4, 918.2], [1058.2, 919.9], [1057.5, 923.5], [1054.2, 933.7], [1025.7, 938.2], [1024.9, 923.1], [988.6, 924.6], [988.1, 923.1], [969.1, 925.3], [967.6, 921.2], [962.2, 915.0], [958.9, 905.7], [948.4, 909.5], [954.4, 925.9], [911.8, 927.6], [906.6, 917.8], [898.8, 922.3], [901.8, 928.1], [899.4, 928.2], [900.3, 950.1], [913.3, 949.6]], holes: [[[1273.0, 930.2], [1273.6, 926.1], [1276.5, 922.6], [1275.1, 921.5], [1287.8, 916.9], [1276.0, 930.0]], [[1076.7, 917.3], [1074.2, 927.6], [1072.4, 927.3], [1073.1, 917.0]], [[1041.3, 986.8], [1052.9, 983.1], [1055.0, 991.6], [1045.3, 995.0]], [[1029.6, 962.7], [1054.8, 958.9], [1053.0, 967.7], [1050.9, 965.7], [1043.4, 967.1], [1045.9, 975.4], [1041.1, 976.8], [1041.1, 986.4]], [[1037.2, 738.4], [1052.5, 747.7], [1044.8, 750.3]], [[1046.2, 1030.5], [1042.4, 1031.7], [1041.1, 1024.9], [1045.1, 1028.1]], [[1024.0, 945.0], [1027.7, 944.9], [1028.1, 948.0], [1024.7, 948.6]], [[991.2, 969.5], [1015.2, 965.0], [1017.9, 970.6], [994.1, 974.3], [995.9, 989.1], [1008.6, 986.8], [1010.2, 997.7], [1023.0, 995.9], [1026.4, 1016.5], [995.1, 991.1], [991.2, 981.8], [978.2, 983.4], [972.8, 973.3], [989.4, 969.9], [991.2, 972.8]], [[985.5, 993.0], [992.7, 991.9], [988.7, 996.7]], [[967.1, 960.1], [962.1, 947.6], [987.8, 946.5], [980.7, 955.8], [981.5, 957.2]]], covers: [['sanban_s_b2', 'opa'], ['sanban_s_b2', 'j_east1'], ['sanban_s_b1', 'opa'], ['j_pchn', 'opa'], ['j_metro', 'whity_w'], ['j_east1', 'whity_20'], ['j_east1', 'whity_26'], ['j_f40', 'whity_19'], ['j_f40', 'whity_25'], ['j_hanshin_e', 'whity_04'], ['j_higashi_n', 'whity_30'], ['j_nm1s', 'whity_32'], ['whity_02', 'whity_01'], ['whity_02', 'whity_03'], ['whity_03', 'whity_08'], ['whity_03', 'whity_14'], ['whity_04', 'whity_08'], ['whity_05', 'whity_04'], ['whity_07', 'whity_02'], ['whity_07', 'whity_06'], ['whity_08', 'whity_11'], ['whity_09', 'whity_07'], ['whity_11', 'whity_10'], ['whity_11', 'whity_12'], ['whity_12', 'whity_15'], ['whity_12', 'whity_21'], ['whity_14', 'whity_13'], ['whity_14', 'whity_30'], ['whity_15', 'j_f40'], ['whity_17', 'whity_16'], ['whity_20', 'whity_17'], ['whity_20', 'whity_18'], ['whity_21', 'whity_14'], ['whity_21', 'whity_33'], ['whity_23', 'whity_22'], ['whity_24', 'whity_23'], ['whity_27', 'whity_28'], ['whity_28', 'whity_34'], ['whity_29', 'whity_21'], ['whity_30', 'whity_32'], ['whity_30', 'whity_40'], ['whity_31', 'whity_23'], ['whity_31', 'whity_34'], ['whity_32', 'j_whity_x'], ['whity_32', 'whity_31'], ['whity_33', 'j_higashi_n'], ['whity_34', 'whity_35'], ['whity_35', 'whity_37'], ['whity_36', 'whity_33'], ['whity_36', 'whity_39'], ['whity_37', 'j_east1'], ['whity_38', 'whity_36'], ['whity_40', 'izumi_ne'], ['opa', 'whity_17'], ['whity_w', 'whity_13'], ['izumi', 'whity_40'], ['j_nm2', 'j_nm1s']] },
  { floor: 'B1', zone: 'umechika', pts: [[886.8, 845.1], [920.9, 831.6], [942.0, 889.1], [942.3, 896.3], [944.6, 896.2], [949.3, 909.0], [958.8, 905.5], [955.1, 895.2], [951.1, 806.3], [1009.8, 768.6], [1016.1, 770.5], [1020.0, 776.4], [1019.7, 804.8], [1050.1, 801.3], [1048.9, 763.8], [1021.4, 773.1], [1015.9, 756.3], [1018.9, 754.3], [1016.8, 727.3], [1013.7, 724.3], [1013.9, 742.6], [1002.3, 742.8], [1001.5, 749.7], [987.5, 748.4], [989.7, 723.2], [987.1, 723.3], [987.1, 721.1], [976.5, 721.0], [975.1, 721.2], [975.1, 723.7], [951.0, 724.5], [929.7, 727.8], [929.1, 725.3], [905.7, 726.1], [908.2, 802.7], [928.7, 806.1], [926.1, 807.7], [929.9, 813.5], [882.4, 833.9]], holes: [[[940.4, 853.8], [928.5, 820.9], [938.6, 814.4]]], covers: [['sanban_s_b1', 'j_shibata'], ['hanshin', 'j_hanshin_e'], ['j_market_ne', 'j_hanshin_e'], ['j_market_ne', 'umechika_35'], ['j_metro', 'umechika_15'], ['j_mido_n', 'umechika_16'], ['j_shibata', 'umechika_21'], ['j_sun', 'umechika_19'], ['umechika_04', 'umechika_02'], ['umechika_04', 'umechika_03'], ['umechika_06', 'umechika_04'], ['umechika_07', 'umechika_04'], ['umechika_08', 'umechika_04'], ['umechika_10', 'umechika_11'], ['umechika_13', 'umechika_19'], ['umechika_15', 'umechika_11'], ['umechika_16', 'umechika_12'], ['umechika_18', 'umechika_20'], ['umechika_19', 'umechika_14'], ['umechika_19', 'umechika_20'], ['umechika_20', 'umechika_21'], ['umechika_20', 'umechika_22'], ['umechika_21', 'umechika_26'], ['umechika_24', 'umechika_17'], ['umechika_26', 'umechika_25'], ['umechika_27', 'umechika_26'], ['umechika_28', 'umechika_16'], ['umechika_29', 'whity_05'], ['umechika_31', 'umechika_30'], ['umechika_32', 'umechika_31'], ['umechika_33', 'umechika_23'], ['umechika_34', 'umechika_29'], ['umechika_23', 'sanban_s_b2'], ['sanban_s_b2', 'umechika_24'], ['umechika_26', 'hq_concourse'], ['hq_concourse', 'umechika_31'], ['umechika_05', 'umechika_p4_daimaru'], ['umechika_p4_daimaru', 'umechika_01'], ['daimaru', 'umechika_p4_daimaru'], ['umechika_11', 'umechika_p4_hanshin'], ['umechika_p4_hanshin', 'umechika_09'], ['hanshin', 'umechika_p4_hanshin'], ['j_sun', 'j_mido_n']] },
  { floor: 'B1', zone: 'umechika', pts: [[1048.7, 984.7], [1041.5, 986.9], [1045.3, 994.9], [1049.7, 993.3]] },
  { floor: 'B1', zone: 'umechika', pts: [[1048.6, 960.0], [1029.9, 962.8], [1040.9, 985.8], [1041.0, 976.7], [1045.7, 975.3], [1043.2, 967.1], [1048.8, 965.9]] },
  { floor: 'B1', zone: 'umechika', pts: [[1008.5, 987.0], [995.8, 989.2], [994.0, 974.3], [1017.7, 970.5], [1015.1, 965.2], [991.3, 969.7], [991.3, 972.9], [989.4, 970.1], [973.0, 973.4], [977.0, 982.3], [991.3, 981.6], [995.2, 990.9], [1004.5, 997.6], [1010.0, 997.4]] },
  { floor: 'B1', zone: 'umechika', pts: [[980.5, 955.9], [987.5, 946.7], [962.3, 947.7], [967.2, 959.9], [981.3, 957.1]] },
  { floor: 'B1', zone: 'umechika', pts: [[949.2, 996.8], [953.0, 996.8], [947.2, 990.4], [957.5, 980.9], [962.5, 985.8], [958.4, 976.3], [957.2, 976.4], [948.1, 950.6], [933.4, 958.4], [928.1, 949.1], [923.5, 949.3]] },
  { floor: 'B1', zone: 'umechika', pts: [[911.9, 927.5], [954.2, 925.7], [951.6, 918.8], [908.1, 920.3]] },
  { floor: 'B1', zone: 'umechika', pts: [[809.7, 1029.4], [811.7, 1028.3], [810.8, 1026.7], [822.8, 1019.3], [824.0, 1021.0], [849.6, 1006.3], [850.8, 1000.0], [866.7, 1003.0], [864.9, 1013.2], [924.3, 1002.1], [938.7, 997.5], [913.2, 949.8], [900.1, 950.2], [899.2, 928.2], [901.6, 927.9], [898.6, 922.3], [901.5, 920.6], [838.9, 922.8], [840.8, 934.1], [856.4, 960.7], [856.8, 970.0], [852.7, 978.1], [847.9, 982.7], [850.5, 991.5], [816.7, 1011.4], [812.6, 1004.6], [802.4, 1010.9], [806.4, 1017.4], [803.7, 1019.0]] },
  { floor: 'B1', zone: 'umechika', pts: [[762.4, 945.9], [766.5, 953.1], [777.0, 946.6], [772.9, 939.5], [840.0, 898.9], [839.4, 898.0], [851.9, 892.2], [846.9, 881.3], [822.3, 892.6], [813.0, 876.6], [802.6, 882.7], [804.1, 885.2], [780.8, 899.5], [772.8, 886.8], [749.3, 901.6], [736.3, 881.1], [726.2, 887.5], [738.4, 906.7], [721.7, 910.5], [723.9, 920.3], [744.1, 915.7], [747.1, 920.4], [736.3, 927.0], [742.7, 937.2], [751.1, 932.0], [751.9, 935.9], [735.8, 945.6], [742.6, 958.0]], holes: [[[763.7, 924.2], [810.1, 895.5], [812.1, 899.0], [765.8, 927.4]]] },
  { floor: 'B1', zone: 'osaka_sta', pts: [[684.8, 1035.1], [695.9, 1028.2], [683.0, 1007.5], [680.8, 996.3], [742.9, 958.4], [734.2, 943.0], [742.9, 937.7], [736.1, 926.6], [715.4, 938.5], [732.7, 918.4], [723.9, 920.4], [721.7, 911.3], [707.1, 928.2], [694.6, 907.5], [683.5, 914.2], [696.6, 935.8], [703.5, 932.4], [635.2, 1011.5], [639.5, 1015.2], [622.1, 1036.5], [627.1, 1044.6], [651.8, 1014.3], [669.0, 1003.6], [670.7, 1012.3]], holes: [[[708.7, 961.3], [683.4, 976.6], [683.0, 976.1], [708.8, 946.2]]], covers: [['jr_osaka', 'daimaru'], ['daimaru', 'j_c1'], ['daimaru', 'kitte']] },
  { floor: 'B1', zone: 'dotica', pts: [[696.7, 1545.3], [710.2, 1637.3], [722.0, 1635.6], [709.8, 1547.2], [738.8, 1530.5], [741.4, 1530.5], [743.0, 1520.0], [736.9, 1523.5], [708.9, 1523.5], [711.3, 1485.5], [748.1, 1485.5], [749.2, 1478.5], [711.7, 1478.5], [719.0, 1339.0], [717.3, 1338.9], [717.5, 1334.7], [708.5, 1334.3], [708.3, 1338.4], [707.0, 1338.3], [696.5, 1529.2], [696.2, 1534.4], [695.1, 1534.5], [695.5, 1545.2]], holes: [[[708.7, 1530.5], [724.8, 1530.5], [709.2, 1539.5]]], covers: [['j_sone_w', 'dojima'], ['avanza', 'j_avz'], ['dotica_avz_n', 'j_avz_n'], ['dotica_avz_m', 'j_avz_m'], ['dotica_02', 'dojima'], ['dojima', 'dotica_avz_n'], ['dotica_avz_n', 'dotica_avz_m'], ['dotica_avz_m', 'dotica_01'], ['dotica_01', 'avanza'], ['avanza', 'dotica_03']] },
  { floor: 'B1', zone: 'ekimae', pts: [[1023.8, 1217.5], [1024.2, 1218.8], [1029.5, 1218.9], [1028.4, 1233.1], [1033.8, 1250.9], [998.1, 1251.3], [989.7, 1263.6], [1013.1, 1336.8], [1024.1, 1344.7], [1088.7, 1344.9], [1105.2, 1344.8], [1113.0, 1336.6], [1124.8, 1343.2], [1127.6, 1345.6], [1127.6, 1350.2], [1130.1, 1350.2], [1136.4, 1340.6], [1115.3, 1325.8], [1108.1, 1303.4], [1105.6, 1304.2], [1090.4, 1259.0], [1081.2, 1250.5], [1042.1, 1250.9], [1032.1, 1217.5], [1070.8, 1217.5], [1078.9, 1208.2], [1055.8, 1139.2], [1042.6, 1135.0], [956.1, 1159.3], [951.1, 1171.6], [972.2, 1212.2], [975.8, 1214.2], [973.7, 1217.1], [977.3, 1218.6]], covers: [['j_diamor_e', 'ekimae4_b2'], ['j_fashion_w', 'ekimae1'], ['j_fashion_e', 'ekimae4'], ['ekimae1_b2', 'j_sone_w'], ['ekimae1_b2', 'j_sone_c'], ['ekimae3_b2', 'sonechika'], ['ekimae1_b2', 'ekimae2_b2'], ['ekimae2_b2', 'ekimae3_b2'], ['ekimae3_b2', 'ekimae4_b2'], ['kitashinchi', 'ekimae2_b2'], ['kitashinchi', 'ekimae1_b2']] },
  { floor: 'B1', zone: 'ekimae', pts: [[964.3, 1250.8], [883.3, 1251.3], [875.0, 1261.2], [874.5, 1331.4], [881.9, 1339.6], [942.3, 1344.6], [989.8, 1344.1], [997.4, 1333.1], [973.2, 1259.0]] },
  { floor: 'B1', zone: 'ekimae', pts: [[853.2, 1251.1], [740.5, 1252.0], [727.5, 1264.5], [725.4, 1310.6], [735.7, 1321.3], [712.9, 1334.3], [717.6, 1334.6], [717.5, 1338.8], [719.1, 1340.0], [741.4, 1327.2], [840.0, 1334.7], [857.0, 1349.1], [857.5, 1344.4], [860.0, 1344.5], [860.0, 1341.2], [852.2, 1334.5], [859.8, 1327.5], [861.2, 1260.3]] },
  { floor: 'B1', zone: 'sonechika', pts: [[1039.7, 1383.5], [1062.2, 1383.5], [1062.2, 1381.5], [1066.7, 1381.5], [1066.7, 1372.5], [1062.2, 1372.5], [1062.2, 1368.2], [1144.7, 1369.7], [1149.1, 1382.0], [1151.0, 1381.3], [1152.4, 1385.5], [1160.9, 1382.6], [1159.5, 1378.3], [1161.3, 1377.7], [1153.1, 1354.2], [1148.9, 1348.6], [1147.7, 1349.1], [1135.6, 1337.2], [1132.7, 1337.4], [1136.6, 1340.6], [1130.3, 1350.2], [1136.8, 1356.6], [1018.1, 1354.3], [1021.5, 1365.3], [1015.6, 1367.3], [1038.9, 1367.7]], covers: [['j_sone_w', 'j_sone_c'], ['j_sone_c', 'j_sone_e'], ['j_sone_e', 'sonechika_08'], ['j_sone_e', 'sonechika_13'], ['sonechika_01', 'sonechika_03'], ['sonechika_02', 'sonechika_04'], ['sonechika_03', 'sonechika_06'], ['sonechika_04', 'sonechika_03'], ['sonechika_04', 'sonechika_07'], ['sonechika_06', 'j_sone_e'], ['sonechika_06', 'sonechika_05'], ['sonechika_08', 'sonechika_09'], ['sonechika_11', 'sonechika_10'], ['sonechika_13', 'sonechika_12'], ['sonechika_14', 'sonechika_13'], ['sonechika_12', 'sonechika_p1_sonechika'], ['sonechika_p1_sonechika', 'sonechika_11'], ['sonechika', 'sonechika_p1_sonechika']] },
  { floor: 'B1', zone: 'sonechika', pts: [[876.8, 1359.4], [995.5, 1366.2], [995.6, 1370.5], [980.8, 1370.5], [980.8, 1383.5], [1013.9, 1383.5], [1013.9, 1381.5], [1018.4, 1381.5], [1018.4, 1372.5], [1013.9, 1372.5], [1013.9, 1370.5], [1008.6, 1370.5], [1002.9, 1353.6], [877.7, 1346.4]] },
  { floor: 'B1', zone: 'sonechika', pts: [[718.8, 1345.7], [852.2, 1357.6], [851.9, 1362.9], [829.8, 1361.2], [828.8, 1374.1], [893.3, 1379.2], [894.4, 1366.3], [864.8, 1363.9], [865.1, 1359.5], [856.1, 1358.5], [857.0, 1349.3], [851.2, 1344.4], [730.4, 1333.7], [719.1, 1340.1]] },
  { floor: 'B1', zone: 'nishi_umeda', pts: [[316.4, 1398.0], [326.5, 1397.3], [331.1, 1398.8], [335.6, 1385.2], [333.0, 1385.2], [528.5, 1231.7], [529.3, 1232.4], [537.8, 1224.3], [537.2, 1223.4], [575.6, 1179.8], [585.7, 1185.5], [595.2, 1177.1], [581.7, 1169.4], [603.7, 1169.9], [614.2, 1161.2], [596.7, 1160.7], [620.6, 1142.9], [622.4, 1155.3], [627.1, 1152.3], [654.3, 1215.6], [655.2, 1193.0], [635.5, 1147.1], [650.3, 1140.4], [665.4, 1137.8], [673.5, 1139.0], [679.5, 1142.4], [679.9, 1144.3], [709.6, 1145.0], [709.5, 1148.3], [712.7, 1148.5], [712.8, 1160.8], [704.8, 1159.1], [704.0, 1172.3], [712.9, 1172.5], [712.9, 1175.9], [725.9, 1175.8], [725.9, 1172.9], [730.5, 1172.9], [731.4, 1164.8], [725.8, 1163.8], [725.4, 1142.7], [741.0, 1140.3], [743.9, 1121.7], [725.7, 1124.4], [718.5, 1095.2], [722.9, 1079.6], [735.5, 1072.5], [738.1, 1081.1], [750.5, 1077.3], [747.1, 1066.0], [765.3, 1055.4], [758.9, 1044.2], [736.6, 1056.9], [731.2, 1058.6], [731.5, 1059.8], [719.6, 1066.5], [695.9, 1028.3], [684.9, 1035.2], [710.4, 1076.2], [706.5, 1089.9], [683.5, 1097.2], [679.6, 1095.7], [677.4, 1101.3], [651.8, 1014.6], [642.6, 1025.8], [665.1, 1102.2], [612.6, 1131.8], [575.5, 1160.2], [565.5, 1160.0], [566.4, 1155.2], [542.1, 1176.5], [552.6, 1186.2], [524.2, 1218.5], [316.0, 1381.9], [309.8, 1384.1], [304.5, 1369.5], [295.1, 1372.9], [300.5, 1387.6], [243.4, 1408.5], [238.1, 1400.0], [231.3, 1404.2], [235.7, 1411.3], [220.1, 1417.0], [224.6, 1429.2], [229.4, 1427.4], [223.4, 1439.1], [230.5, 1442.8], [239.2, 1425.9], [315.5, 1396.0]], holes: [[[688.3, 1110.0], [706.9, 1103.6], [711.6, 1126.5], [679.7, 1131.3]], [[673.0, 1112.7], [666.0, 1130.9], [670.6, 1132.7], [643.2, 1136.8], [639.8, 1131.4]]], covers: [['j_hilton_e', 'j_nishi_x'], ['j_nishi_x', 'hilton'], ['hilton', 'garden'], ['j_c1', 'j_kitte_e'], ['garden', 'herbis'], ['garden', 'kitte'], ['herbis', 'j_nishi_x'], ['j_nishi_x', 'j_sone_w'], ['j_kitte_e', 'nishi_umeda_08'], ['nishi_umeda_05', 'nishi_umeda_02'], ['nishi_umeda_05', 'nishi_umeda_03'], ['nishi_umeda_06', 'nishi_umeda_05'], ['nishi_umeda_07', 'nishi_umeda_06'], ['nishi_umeda_08', 'nishi_umeda_07'], ['nishi_umeda_08', 'nishi_umeda_09'], ['nishi_umeda_09', 'j_nishi_x'], ['nishi_umeda_11', 'j_kitte_e'], ['nishi_umeda_11', 'nishi_umeda_10'], ['nishi_umeda_12', 'nishi_umeda_14'], ['nishi_umeda_13', 'nishi_umeda_11'], ['nishi_umeda_13', 'nishi_umeda_15'], ['nishi_umeda_14', 'nishi_umeda_13'], ['nishi_umeda_16', 'nishi_umeda_14'], ['nishi_umeda_16', 'nishi_umeda_17'], ['nishi_umeda_03', 'nishi_umeda_p2_garden'], ['nishi_umeda_p2_garden', 'nishi_umeda_04'], ['garden', 'nishi_umeda_p2_garden'], ['nishi_umeda_01', 'nishi_umeda_p2_ritz'], ['ritz', 'nishi_umeda_p2_ritz'], ['nishi_umeda_02', 'nishi_a1_j'], ['nishi_a1_j', 'nishi_umeda_01'], ['nishi_umeda_p2_ritz', 'nishi_y'], ['nishi_y', 'nishi_y_k1'], ['nishi_y_k1', 'exit_6_1'], ['nishi_y', 'exit_6_2']] },
  { floor: 'B1', zone: 'nishi_umeda', pts: [[706.9, 1338.4], [708.6, 1334.0], [712.7, 1334.3], [713.5, 1332.1], [719.9, 1330.2], [722.8, 1257.7], [709.8, 1257.2], [707.5, 1314.1], [666.7, 1219.5], [657.0, 1221.8]] },
  { floor: 'B1', zone: '_neutral', pts: [[1047.7, 1113.5], [1047.8, 1136.5], [1055.9, 1139.1], [1079.1, 1208.1], [1072.5, 1215.7], [1075.8, 1234.4], [1080.9, 1250.4], [1090.5, 1258.9], [1105.7, 1304.0], [1110.2, 1302.7], [1121.1, 1329.5], [1133.9, 1337.2], [1081.0, 1206.2], [1065.5, 1138.6], [1102.0, 1127.2], [1099.1, 1117.7], [1063.3, 1128.8], [1059.1, 1110.5]], covers: [['j_f40', 'j_mido_s'], ['j_mido_s', 'sonechika']] },
  { floor: 'B2', zone: 'hilton', pts: [[744.0, 1121.9], [741.1, 1139.4], [739.6, 1171.8], [735.8, 1177.8], [734.9, 1186.4], [737.7, 1196.4], [738.1, 1207.0], [741.7, 1211.8], [741.7, 1217.8], [786.6, 1217.4], [791.0, 1215.2], [792.7, 1210.9], [794.6, 1169.4], [797.0, 1161.3], [805.7, 1147.4], [819.4, 1136.7], [789.5, 1086.8], [764.4, 1101.1], [758.8, 1099.9], [756.7, 1106.0], [748.4, 1113.5]] },
  { floor: 'B2', zone: 'hilton', pts: [[675.5, 1210.9], [701.6, 1211.8], [705.4, 1145.6], [678.6, 1144.4], [656.6, 1157.2], [654.2, 1222.4], [675.4, 1217.2]] },
  { floor: 'B2', zone: 'herbis', pts: [[562.6, 1241.7], [562.5, 1245.1], [588.4, 1246.8], [588.4, 1244.5], [594.8, 1244.0], [600.4, 1241.6], [608.4, 1235.8], [611.4, 1231.8], [624.8, 1232.2], [659.6, 1221.5], [654.1, 1222.4], [656.5, 1157.1], [679.8, 1144.3], [679.4, 1142.5], [673.5, 1139.1], [665.4, 1138.0], [650.3, 1140.5], [641.5, 1144.1], [615.0, 1160.7], [585.7, 1185.2], [587.8, 1189.7], [585.2, 1189.6], [563.7, 1207.0], [561.2, 1207.0], [561.2, 1211.5], [558.5, 1211.6], [558.6, 1241.7]] },
  { floor: 'B2', zone: 'herbis', pts: [[363.1, 1378.2], [395.7, 1417.9], [418.8, 1399.8], [420.7, 1401.8], [429.9, 1396.5], [440.9, 1387.9], [450.5, 1377.6], [452.5, 1361.8], [469.5, 1347.7], [479.0, 1348.3], [479.6, 1339.2], [491.6, 1328.9], [488.5, 1325.5], [496.2, 1318.4], [493.6, 1315.7], [501.7, 1307.4], [508.6, 1304.6], [518.2, 1294.4], [520.9, 1288.5], [543.6, 1269.5], [545.2, 1265.6], [554.1, 1257.1], [544.4, 1247.1], [539.8, 1251.6], [532.4, 1250.3], [529.2, 1251.7], [526.3, 1249.6], [520.0, 1254.6], [517.2, 1251.7], [487.4, 1275.8], [489.1, 1278.0], [473.7, 1292.2], [470.6, 1289.0], [459.2, 1299.2], [460.8, 1300.9], [453.4, 1308.8], [446.2, 1307.9], [445.6, 1315.1], [438.4, 1321.2], [434.4, 1320.7], [434.0, 1325.0], [430.0, 1328.5], [420.4, 1327.8], [419.8, 1335.0], [414.9, 1330.6], [411.4, 1339.0], [391.1, 1355.3], [389.1, 1353.1], [369.8, 1369.0], [371.6, 1371.2]] },
  { floor: 'B2', zone: 'daimaru', pts: [[717.4, 983.4], [752.1, 1041.3], [845.7, 984.0], [852.6, 978.0], [856.7, 970.0], [856.2, 960.8], [828.0, 913.1], [806.4, 926.8], [807.2, 928.2]] },
  { floor: 'B2', zone: 'hankyu_dept', pts: [[928.6, 820.9], [962.3, 915.0], [984.5, 939.5], [988.1, 941.0], [996.6, 941.0], [1040.8, 934.2], [1049.9, 927.6], [1052.8, 922.2], [1060.1, 871.0], [1020.6, 870.9], [1019.9, 776.5], [1016.0, 770.6], [1009.8, 768.7]] },
  { floor: 'B2', zone: 'hanshin_dept', pts: [[971.5, 1045.8], [1012.2, 1114.3], [1014.4, 1113.5], [1016.3, 1120.1], [1023.6, 1117.8], [1024.3, 1119.5], [1060.2, 1110.0], [1058.3, 1102.1], [1061.8, 1101.2], [1054.2, 1074.5], [1047.4, 1062.9], [982.6, 1007.0], [964.9, 999.4], [955.0, 997.0], [944.4, 997.2], [934.9, 998.1], [925.2, 1001.8], [853.8, 1045.7], [884.9, 1097.3]] },
  { floor: 'B2', zone: 'nishi_umeda', pts: [[725.0, 1203.2], [725.9, 1176.1], [718.5, 1175.0], [731.6, 1171.5], [729.3, 1162.8], [704.2, 1169.5], [703.6, 1179.0], [712.9, 1176.5], [712.0, 1202.8]], covers: [['hilton_b2', 'herbis_b2']] },
];

// ホール型フロア内部の見えない通路格子（経路探索・案内用。描画はしない）
const HALL_EDGES = [];
const MERGED_DOTS = []; // merged指定エリアの代表ドット(店の形は将来対応。それまで館単位1点に集約)

// --- 店舗をNODESに追加（エリア指定はパス沿いに自動配置、蛇行パスで面を埋める） ---
(function placeShops() {
  const aliasesFor = name => {
    const out = [];
    for (const [k, v] of Object.entries(ALIASES)) if (name.includes(k)) out.push(...v);
    return out;
  };
  let seq = 0;
  for (const s of SHOPS_MANUAL) {
    NODES.push({ id: `shop_m${seq++}`, name: s.name, floor: s.floor, mx: s.mx, my: s.my,
      zone: s.zone, near: [s.near], aliases: aliasesFor(s.name), type: 'shop' });
  }
  const nodeMap = {};
  for (const n of NODES) nodeMap[n.id] = n;
  // ホワイティ詳細(公式PDF): 名前が一致した店は実位置に置く(通路沿いの合成位置より優先)
  // placeShops 全体の後にも適用する(下の applyWhityRealPos 参照)
  const edgeWpx = {};
  for (const [a, b, w] of EDGES) {
    edgeWpx[`${a}|${b}`] = w;
    edgeWpx[`${b}|${a}`] = w;
  }
  const byArea = {};
  for (const s of SHOPS_SCRAPED) (byArea[s.area] ||= []).push(s);
  for (const [areaId, shops] of Object.entries(byArea)) {
    const a = SHOP_AREAS[areaId];
    if (!a) continue;
    // ホール型フロア（三番街など）: 公式マップの3×3グリッド位置で配置し、
    // フロア内部に3×3の通路格子を張って館内ルート案内を可能にする
    if (a.rect) {
      const [cx, cy, rw, rd] = a.rect;
      const CD = { '北西': [-1, -1], '北': [0, -1], '北東': [1, -1], '西': [-1, 0], '中央': [0, 0],
                   '東': [1, 0], '南西': [-1, 1], '南': [0, 1], '南東': [1, 1] };
      // 場内格子ノード（見えない分岐点）
      const gid = (r, c) => `${areaId}_g${r}${c}`;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        NODES.push({ id: gid(r, c), name: '', floor: a.floor,
          mx: cx + (c - 1) * rw / 3, my: cy + (r - 1) * rd / 3,
          zone: a.zone, type: 'junction' });
        if (c < 2) HALL_EDGES.push([gid(r, c), gid(r, c + 1), a.zone]);
        if (r < 2) HALL_EDGES.push([gid(r, c), gid(r + 1, c), a.zone]);
      }
      HALL_EDGES.push([gid(1, 1), a.near[0], a.zone]); // 格子中央を既存の出入口ノードへ接続
      // 追加の出入口(near[1..]): その地点に最も近い格子点から接続(三番街B2Fの北館⇔南館 連絡通路など)
      for (const extra of a.near.slice(1)) {
        const en = NODES.find(n => n.id === extra); // (nodeById はこの時点では未構築)
        if (!en) { console.warn('shop area', areaId, 'の出入口が見つからない:', extra); continue; }
        let best = null, bd = Infinity;
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
          const d = Math.hypot(cx + (c - 1) * rw / 3 - en.mx, cy + (r - 1) * rd / 3 - en.my);
          if (d < bd) { bd = d; best = gid(r, c); }
        }
        HALL_EDGES.push([best, extra, a.zone]);
      }
      // セルごとに整列配置し、最寄りの格子点に接続
      const byCell = {};
      for (const sh of shops) (byCell[sh.cell || '中央'] ||= []).push(sh);
      let seq2 = 0;
      for (const [cell, cellShops] of Object.entries(byCell)) {
        const c = CD[cell] || [0, 0];
        const bx = cx + c[0] * rw / 3, by = cy + c[1] * rd / 3;
        const cellNode = gid(c[1] + 1, c[0] + 1);
        const rows = Math.ceil(cellShops.length / 3);
        cellShops.forEach((sh, k) => {
          // mergedはドット非表示なので広げず、セル中心の1点に集約(小さい建物でも床からはみ出さない)
          NODES.push({ id: `shop_${areaId}_${seq2++}`, name: sh.name, floor: a.floor,
            mx: a.merged ? bx : bx + (k % 3 - 1) * 6.5,
            my: a.merged ? by : by + (Math.floor(k / 3) - (rows - 1) / 2) * 6.5,
            zone: a.zone, area: areaId, near: [cellNode], aliases: aliasesFor(sh.name),
            small: true, noDot: a.merged, type: 'shop' }); // ホール内は小径ドット。mergedは個別ドットを描かない
        });
      }
      if (a.merged) MERGED_DOTS.push({ mx: cx, my: cy, floor: a.floor, zone: a.zone, area: areaId, near: a.near[0] });
      continue;
    }
    // セグメント列: edges指定なら実在の通路に吸着（床のない場所に店を置かない）
    const segs = [];
    let total = 0;
    if (a.edges) {
      for (const [ia, ib] of a.edges) {
        const na = nodeMap[ia], nb = nodeMap[ib];
        const w = edgeWpx[`${ia}|${ib}`] || 8;
        const len = Math.hypot(nb.mx - na.mx, nb.my - na.my);
        // 通路の縁の内側に並べる（マップpx: 半幅-3。床帯の実寸内に収める）
        segs.push({ x1: na.mx, y1: na.my, x2: nb.mx, y2: nb.my, len, off: Math.max(2.5, w / 2 - 3) });
        total += len;
      }
    } else {
      for (let i = 0; i < a.path.length - 1; i++) {
        const [x1, y1] = a.path[i], [x2, y2] = a.path[i + 1];
        const len = Math.hypot(x2 - x1, y2 - y1);
        segs.push({ x1, y1, x2, y2, len, off: a.offset ?? 10 });
        total += len;
      }
    }
    const near = a.near || [...new Set((a.edges || []).flat())];
    // 公式マップ由来のorder（歩く順）があればそれで並べる
    const list = shops.some(s => s.order != null)
      ? shops.slice().sort((p, q) => (p.order ?? 999) - (q.order ?? 999))
      : shops;
    // 方角文字列（例:"北","南東"）→ 法線方向の符号。px座標は x:東+ / y:南+
    const sideSign = (side, nx, ny) => {
      if (!side) return null;
      let score = 0;
      for (const ch of side) {
        if (ch === '北') score += -ny;
        else if (ch === '南') score += ny;
        else if (ch === '東') score += nx;
        else if (ch === '西') score += -nx;
      }
      return score > 0 ? 1 : score < 0 ? -1 : null;
    };
    list.forEach((s, i) => {
      const t = ((i + 0.5) / list.length) * total;
      let acc = 0, px = segs[0].x1, py = segs[0].y1, dx = 1, dy = 0, off = segs[0].off;
      for (const sg of segs) {
        if (t <= acc + sg.len) {
          const u = (t - acc) / sg.len;
          px = sg.x1 + (sg.x2 - sg.x1) * u;
          py = sg.y1 + (sg.y2 - sg.y1) * u;
          dx = (sg.x2 - sg.x1) / sg.len;
          dy = (sg.y2 - sg.y1) / sg.len;
          off = sg.off;
          break;
        }
        acc += sg.len;
      }
      // 通路の側: 調査データがあればそれに従い、なければ交互
      const side = sideSign(s.side, -dy, dx) ?? (i % 2 === 0 ? 1 : -1);
      NODES.push({ id: `shop_${areaId}_${i}`, name: s.name, floor: a.floor,
        mx: px - dy * off * side, my: py + dx * off * side,
        zone: a.zone, area: areaId, near, aliases: aliasesFor(s.name), category: s.category, type: 'shop' });
    });
  }
})();

// 広域地図の店ノードは合成位置のまま(店の位置は広域では持たない方針)。
// 詳細地図の店位置(DETAIL_MAPS[*].REAL_POS)はガイド座標系(詳細地図専用)なので広域のノードには適用しない
for (const n of NODES) [n.x, n.z] = M2W([n.mx, n.my]);
const nodeById = Object.fromEntries(NODES.map(n => [n.id, n]));
const posOf = n => new THREE.Vector3(n.x, FLOOR_Y[n.floor], n.z);
const NAMED = NODES.filter(n => n.type !== 'junction');

// ---------------------------------------------------------------------------
// シーン基盤
// ---------------------------------------------------------------------------
const app = document.getElementById('app');
const scene = new THREE.Scene();
scene.background = null; // 背景はCSSの放射グラデーション（#appに設定）を透かして見せる
scene.fog = new THREE.Fog(0x0b0e14, 1200, 2400);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 5, 3000); // near平面を上げて深度精度を確保
camera.position.set(60, 480, 620);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
app.prepend(renderer.domElement);

const labelRenderer = new CSS2DRenderer({ element: document.getElementById('labels') });
labelRenderer.setSize(innerWidth, innerHeight);

// スマホは下部が案内シートで隠れるため、投影中心(=ズーム・回転の不動点が映る位置)を
// 画面中央ではなく「シートを除いた地図表示領域の中央」へずらす。シート高は状態で変わるので実測する
function applyViewOffset() {
  if (innerWidth <= 640) {
    const sheet = document.body.classList.contains('survey') ? 'survey' : 'panel';
    const panelH = document.getElementById(sheet)?.offsetHeight ?? 0;
    camera.setViewOffset(innerWidth, innerHeight, 0, panelH / 2, innerWidth, innerHeight);
  } else {
    camera.clearViewOffset();
  }
}
applyViewOffset();

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-30, -10, -10);
controls.enableDamping = true;
controls.zoomSpeed = 3; // ホイールズームの感度(タッチのピンチは下で等倍=1にする)
controls.zoomToCursor = true; // カーソル位置に向かって拡大縮小(three r160ではマウスのみ。タッチは下で自前対応)
controls.minDistance = 15;
controls.maxDistance = 1600;
// タッチ: ピンチは「指を広げた比率=拡大率」(等倍)。zoomSpeed=3 だと比率が3乗されて感度が高すぎる
// タッチのピンチは自前で指の下にピボットを置くので zoomToCursor は切る(二重に効いてズレが溜まる)
renderer.domElement.addEventListener('pointerdown', e => {
  controls.zoomSpeed = e.pointerType === 'touch' ? 1 : 3; // ピンチは等倍、ホイールは速め
}, { capture: true });
renderer.domElement.addEventListener('wheel', () => { controls.zoomSpeed = 3; }, { capture: true, passive: true });
controls.maxPolarAngle = Math.PI * 0.49;
window.__dbg = { camera, controls, M2W, FLOOR_Y, THREE, scene, DETAIL_MAPS, // 開発用: 検証時にカメラ操作・状態確認に使う。z は詳細地図の施設ID(省略時は開いている施設、無ければ whity)
  dbgDetail: (z = detailMode || 'whity') => ({ zone: z, ids: DETAIL[z].shopIds.length, labels: DETAIL[z].labels.length, mode: detailMode, realKeys: Object.keys(DETAIL_MAPS[z].REAL_POS).length, sampleNode: NODES.find(n => detailKeyOfShop(n) === z)?.name }),
  dbgNav: (a, b, z = detailMode || 'whity') => DETAIL[z].nav(a, b), dbgReal: (name, z = 'whity') => DETAIL_MAPS[z].REAL_POS[name], dbgWalk: (z = 'whity') => DETAIL_MAPS[z].WALK };

scene.add(new THREE.AmbientLight(0x8899bb, 0.9));
const dir = new THREE.DirectionalLight(0xffffff, 1.4);
dir.position.set(200, 400, 150);
scene.add(dir);
const dir2 = new THREE.DirectionalLight(0x5588ff, 0.5);
dir2.position.set(-300, 200, -200);
scene.add(dir2);

// ---------------------------------------------------------------------------
// フロア・通路・広場・スポットの構築
// ---------------------------------------------------------------------------
const floorGroups = { S1: new THREE.Group(), B1: new THREE.Group(), B2: new THREE.Group() };
const floorLabelObjs = { S1: [], B1: [], B2: [] }; // CSS2Dラベルはグループ非表示に連動しないため個別管理
const vertGroup = new THREE.Group(); // EV・ESC・階段はフロア切替に関わらず常時表示
scene.add(floorGroups.S1, floorGroups.B1, floorGroups.B2, vertGroup);

// 最下層（B2レベル）に薄いグリッドを1枚だけ敷いて高さの基準にする（台座は廃止）
{
  const grid = new THREE.GridHelper(680, 34, 0x2a3c58, 0x203048);
  grid.position.set(-45, FLOOR_Y.B2 - 3.6, -20);
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  scene.add(grid);
}

// 地上のビル群: Googleマップ風の2.5Dボリューム（ごく薄い面＋エッジ線＋屋上ネーム）
// 「街の下にいる」感覚を保つため面はほぼ透明にし、輪郭とランドマーク形状で梅田と分からせる
const groundGroup = new THREE.Group(); // 「ビル」トグルで一括ON/OFF
const groundLabelObjs = [];            // CSS2Dラベルはグループ非表示に連動しないため個別管理
scene.add(groundGroup);
{
  // GROUND_Y はトップレベル(FLOOR_Y の隣)で定義
  // r: [x1, y1, x2, y2](地図px), h: 高さ(world), name: 屋上ラベル, lm: ランドマーク(輪郭強調)
  // 高さは実際の建物高(m)×0.75で統一(相対的な高さ関係を実物に合わせる)
  const GROUND_BUILDINGS = [
    // 実外形はOSM building footprint(簡略化3.5px)。高さは従来値を踏襲
    { poly: [[953.6, 720.4], [1001.4, 711.8], [1042.6, 694], [1023.5, 574], [987.1, 448.3], [916.6, 460.9], [898.5, 492.4], [939.8, 694.3], [926.3, 688.4], [932.6, 723.7]], h: 24, name: '阪急 大阪梅田駅', lm: true },
    { poly: [[932.9, 822.3], [965.4, 913.1], [984.3, 934.7], [996.2, 937.5], [1044.1, 928.3], [1056.2, 874.5], [1017.1, 874.3], [1014, 773.7]], h: 140, name: '阪急百貨店', lm: true },
    { poly: [[1019, 795.7], [1017, 860.9], [1051.4, 860.8], [1051.2, 795.6]], h: 95, name: '阪急グランドビル' },
    { poly: [[1201.6, 722.3], [1199.1, 687.7], [1195, 687.9], [1198, 671.8], [1093.5, 722.4], [1090.3, 756.7], [1141.9, 751.7], [1140.2, 726.9]], h: 47, name: 'HEP FIVE', lm: true },
    { poly: [[1016.7, 1039.8], [980.7, 1010], [949.3, 1000.5], [921, 1007.9], [858.5, 1046.8], [886.1, 1092.5], [972.8, 1041], [1013.7, 1110], [1018.7, 1115.6], [1026.3, 1115.4], [1056, 1107.5], [1057.5, 1098.7], [1048.6, 1070.1]], h: 141, name: '阪神百貨店', lm: true },
    { poly: [[835, 796.8], [828.7, 786.8], [842.5, 773.8], [831.5, 763.1], [830.8, 756.2], [841.2, 752.8], [834.3, 742], [733.2, 804], [717.1, 779.2], [577.7, 864.8], [608, 923], [797.2, 807.1], [800.7, 818.4]], h: 48, name: 'ルクア / ノースゲート', lm: true },
    { poly: [[753.3, 1036.4], [851.7, 972.9], [852.8, 961.9], [826.9, 917.9], [722.2, 984.6]], h: 92, name: '大丸 / サウスゲート', lm: true },
    { poly: [[694.2, 641.3], [711.5, 701.9], [739.5, 755], [751.6, 754.6], [840.2, 697.4], [841.5, 654.4], [849.1, 653.5], [844.7, 625.1], [828.6, 620.1], [827.3, 612.2], [819.6, 613.3], [821, 622.5]], h: 85, name: 'ヨドバシ梅田 / LINKS', lm: true },
    { poly: [[445.1, 999.2], [455.2, 1014.7], [548, 958.3], [544.9, 953.2], [559.7, 944], [546.1, 921.9]], h: 75, name: 'イノゲート大阪' },
    { poly: [[591.6, 657.9], [593.2, 692.9], [618, 732.2], [654.6, 756.4], [695.9, 760.9], [668.2, 647.1]], h: 135, name: 'グランフロント南館', lm: true },
    { poly: [[558.4, 425.2], [582, 608.9], [589.4, 608], [590.3, 614.8], [662.9, 601.8], [634.2, 421.3], [579.4, 428.2], [578.7, 422.6]], h: 131, name: 'グランフロント北館', lm: true },
    { poly: [[335.4, 807.9], [325.8, 804.9], [305.6, 873.2], [301.4, 924.6], [289.7, 958.7], [289.8, 971.7], [328.6, 981.2], [331.5, 969.1], [341, 971.4], [348.5, 941.6], [357.3, 941.8], [376.6, 865.5], [401, 839.2], [375.9, 819], [369.5, 821.1], [371.7, 812.3], [337.7, 802.6]], h: 32, name: 'グラングリーン大阪' },
    { poly: [[523.3, 1188.1], [579.6, 1138.8], [640.9, 1101.6], [630.4, 1084.4], [642.7, 1076.8], [617.8, 1036.7], [507.2, 1102.9]], h: 130, name: 'KITTE大阪' },
    { poly: [[849.8, 1332], [856.4, 1325.8], [858.2, 1262.2], [851.7, 1254.6], [741.9, 1255.5], [730.9, 1266], [729, 1309.2], [742.9, 1323.8]], h: 38, name: '駅前第1ビル' },
    { poly: [[877.3, 1329.2], [883.6, 1336.2], [988, 1340.5], [994.2, 1332.6], [970.9, 1261.6], [962.9, 1254.3], [884.8, 1254.8], [877.9, 1262.3]], h: 53, name: '駅前第2ビル' },
    { poly: [[1000, 1254.7], [993.6, 1264.1], [1016.1, 1334.7], [1025.2, 1341.3], [1103.7, 1341.3], [1111.5, 1333], [1087.3, 1260.9], [1079.9, 1254]], h: 107, name: '駅前第3ビル' },
    { poly: [[958.7, 1162.2], [954.9, 1171.5], [974.9, 1209.6], [982.9, 1214.1], [1069.2, 1214], [1074.9, 1207.3], [1053, 1142], [1042.5, 1138.7]], h: 68, name: '駅前第4ビル' },
    { poly: [[788.2, 1091.5], [760.9, 1103.9], [747.2, 1123.1], [738.4, 1186.2], [745.2, 1214.3], [785.8, 1213.9], [789.2, 1210.1], [793.7, 1160], [814.7, 1135.6]], h: 110, name: 'ヒルトンプラザ', lm: true },
    { poly: [[657.9, 1217.9], [671.9, 1214.5], [672.1, 1207.2], [698.3, 1208.2], [701.7, 1149], [679.4, 1148], [660.1, 1159.2]], h: 110 },
    { poly: [[590.3, 1186.5], [589.4, 1192.8], [562.4, 1215.1], [562, 1238.3], [566.4, 1238.2], [566.6, 1241.7], [585.4, 1242.8], [603, 1236], [609.3, 1225.9], [626, 1228], [656.8, 1218.9], [659.1, 1154.7], [676.6, 1147.8], [676.5, 1144.2], [659.8, 1142.2], [643.3, 1147.2]],
      h: 75, name: 'ハービスENT', lm: true },   // 約100m ×0.75。斜め形状のため実外形で描画
    { poly: [[517.1, 1256.8], [519.4, 1259.4], [525.9, 1253.9], [540.4, 1256], [544.7, 1252.3], [549.3, 1256.6], [489.1, 1315.8], [491.4, 1318.4], [483.9, 1324.9], [486.2, 1328.3], [476.5, 1337.6], [475.7, 1344.8], [467.9, 1344.1], [449.5, 1359.9], [446.7, 1376.1], [438.2, 1385.3], [395.8, 1412.7], [368.1, 1378.9], [376.7, 1371.4], [374.4, 1369.7], [388.5, 1357.7], [390.8, 1360.2], [416.6, 1336.2], [420.2, 1343.2], [423.1, 1331.5], [430.9, 1332.1], [449.3, 1317.2], [449.1, 1311.8], [454.6, 1312.5], [470.7, 1294.1], [473, 1297.6]],
      h: 135, name: 'ハービスOSAKA', lm: true }, // 190m ×0.75。同上
    { poly: [[535.8, 1301.3], [537.5, 1306.6], [527.5, 1311], [530.5, 1318.5], [524, 1321.4], [528.5, 1330.8], [545.8, 1325.8], [553.9, 1343.2], [549.4, 1350.9], [553.6, 1360.1], [556.7, 1351.4], [570.2, 1356.3], [576.5, 1350.4], [574.6, 1339.3], [582.2, 1336.1], [589.2, 1342.7], [581.5, 1323.2], [582.6, 1315.8], [596.7, 1309.8], [592.4, 1281], [587.6, 1282.6], [583.1, 1273.3], [579.1, 1277.3], [568, 1271.9], [558.9, 1281], [562.7, 1292.8]], h: 131, name: 'ブリーゼタワー' },
    { poly: [[962.5, 1080.5], [979.3, 1130.6], [1008.7, 1119.6], [977.8, 1066.3], [961, 1076.2]], h: 55, name: 'イーマ' },
  ];
  // 街の地: 名もなきビル群（低層〜中層）で市街の質感を足す

  const faceMat = new THREE.MeshBasicMaterial({
    color: 0x9fb6d4, transparent: true, opacity: 0.12, depthWrite: false,
  });
  const faceMatLm = new THREE.MeshBasicMaterial({
    color: 0xaec8e8, transparent: true, opacity: 0.20, depthWrite: false,
  });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xcfe0f5, transparent: true, opacity: 0.38 });
  const edgeMatSoft = new THREE.LineBasicMaterial({ color: 0xaec4de, transparent: true, opacity: 0.21 });
  const edgeMatFill = new THREE.LineBasicMaterial({ color: 0x8fa6c2, transparent: true, opacity: 0.12 });

  const addBldgLabel = (text, mx, my, y) => {
    const div = document.createElement('div');
    div.className = 'bldg-label';
    div.textContent = text;
    const lab = new CSS2DObject(div);
    const [x, z] = M2W([mx, my]);
    lab.position.set(x, y, z);
    groundGroup.add(lab);
    groundLabelObjs.push(lab);
  };

  const addBox = (r, h, mats, lm) => {
    const [x1, z1] = M2W([r[0], r[1]]);
    const [x2, z2] = M2W([r[2], r[3]]);
    const geo = new THREE.BoxGeometry(Math.abs(x2 - x1), h, Math.abs(z2 - z1));
    const solid = new THREE.Mesh(geo, lm ? faceMatLm : faceMat);
    solid.renderOrder = 3;
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(geo), mats);
    solid.position.set((x1 + x2) / 2, GROUND_Y + h / 2, (z1 + z2) / 2);
    wire.position.copy(solid.position);
    groundGroup.add(solid, wire);
  };

  // 斜めに建つビルは軸平行の箱だと実際の2倍近く膨らむため、実外形ポリゴンで押し出す
  const addPolyBldg = (pts, h, mats, lm) => {
    const shape = new THREE.Shape();
    pts.forEach(([mx, my], i) => {
      const [x, z] = M2W([mx, my]);
      if (i === 0) shape.moveTo(x, z); else shape.lineTo(x, z);
    });
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, GROUND_Y + h, 0);
    const solid = new THREE.Mesh(geo, lm ? faceMatLm : faceMat);
    solid.renderOrder = 3;
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), mats);
    groundGroup.add(solid, wire);
  };

  for (const b of GROUND_BUILDINGS) {
    if (b.poly) {
      addPolyBldg(b.poly, b.h, b.lm ? edgeMat : edgeMatSoft, b.lm);
      if (b.name && b.lm) {
        const cx = b.poly.reduce((s, p) => s + p[0], 0) / b.poly.length;
        const cy = b.poly.reduce((s, p) => s + p[1], 0) / b.poly.length;
        addBldgLabel(b.name, cx, cy, GROUND_Y + b.h + 7);
      }
      continue;
    }
    addBox(b.r, b.h, b.lm ? edgeMat : edgeMatSoft, b.lm);
    // 名前はランドマークのみ（全ビルに付けると引きの視点で文字が渋滞する）
    if (b.name && b.lm) addBldgLabel(b.name, (b.r[0] + b.r[2]) / 2, (b.r[1] + b.r[3]) / 2, GROUND_Y + b.h + 7);
  }
  // --- OSM全ビル(ランドマーク以外の約1,300棟)。面は1メッシュに結合、輪郭は上端のみ(描画負荷を抑える) ---
  {
    const geos = [];
    const topPts = [];
    for (const b of OSM_BUILDINGS) {
      const shape = new THREE.Shape();
      const wpts = b.p.map(([mx, my]) => M2W([mx, my]));
      wpts.forEach(([x, z], i) => { if (i === 0) shape.moveTo(x, -z); else shape.lineTo(x, -z); });
      const g = new THREE.ExtrudeGeometry(shape, { depth: b.h, bevelEnabled: false, curveSegments: 1 });
      g.rotateX(-Math.PI / 2); // 押し出し方向(+z)が +y(上)になる → 地面から上へ h
      g.translate(0, GROUND_Y, 0);
      geos.push(g);
      for (let i = 0; i < wpts.length; i++) {
        const [x1, z1] = wpts[i], [x2, z2] = wpts[(i + 1) % wpts.length];
        topPts.push(x1, GROUND_Y + b.h, z1, x2, GROUND_Y + b.h, z2); // 上端
        topPts.push(x1, GROUND_Y, z1, x2, GROUND_Y, z2);             // 下端
        topPts.push(x1, GROUND_Y, z1, x1, GROUND_Y + b.h, z1);       // 縦の辺(枠が宙に浮いて見えないように)
      }
    }
    const merged = mergeGeometries(geos, false);
    const mass = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ color: 0x8fa6c2, transparent: true, opacity: 0.05, depthWrite: false }));
    mass.renderOrder = 1;
    const topGeo = new THREE.BufferGeometry();
    topGeo.setAttribute('position', new THREE.Float32BufferAttribute(topPts, 3));
    groundGroup.add(mass, new THREE.LineSegments(topGeo, edgeMatFill));
  }
  // --- OSM道路網(クラス別に結合済みポリゴン)。地面に薄く敷く ---
  {
    const roadMat = {
      major: new THREE.MeshBasicMaterial({ color: 0x3a4a63, transparent: true, opacity: 0.35, depthWrite: false }),
      minor: new THREE.MeshBasicMaterial({ color: 0x2c3a52, transparent: true, opacity: 0.22, depthWrite: false }),
    };
    for (const r of OSM_ROADS) {
      const shape = new THREE.Shape();
      r.p.forEach(([mx, my], i) => { const [x, z] = M2W([mx, my]); if (i === 0) shape.moveTo(x, -z); else shape.lineTo(x, -z); });
      for (const h of r.holes || []) {
        const path = new THREE.Path();
        h.forEach(([mx, my], i) => { const [x, z] = M2W([mx, my]); if (i === 0) path.moveTo(x, -z); else path.lineTo(x, -z); });
        shape.holes.push(path);
      }
      const g = new THREE.ShapeGeometry(shape);
      g.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(g, roadMat[r.cls] || roadMat.minor);
      mesh.position.y = GROUND_Y + (r.cls === 'major' ? 0.5 : 0.3);
      mesh.renderOrder = 2;
      groundGroup.add(mesh);
    }
  }

  // --- 梅田スカイビル: OSM building:part 実測。段丘状ツインタワー(吹き抜け側ほど高い)+
  //     空中庭園(39-40Fの板が両塔頂部と吹き抜けを覆い、中央に円形開口)+35F→39F斜行チューブ ---
  {
    const LV = 130 / 40; // 1フロア分の高さ(173m×0.75 ÷ 40F)
    // 各段の実外形(OSM way 252708903/901, 252485324, 252708902/904)。lv=階数
    const PARTS = [
      { pts: [[163, 547.8], [176.7, 548.6], [173.8, 603.3], [159.5, 602.4]], lv: 38 }, // 西塔 外段
      { pts: [[176.7, 548.6], [190.2, 549.6], [187.5, 604.2], [173.8, 603.3]], lv: 39 }, // 西塔 内段
      { pts: [[243.1, 553], [251.4, 553.5], [248.4, 608.1], [239.9, 607.6]], lv: 40 }, // 東塔 内段
      { pts: [[251.4, 553.5], [261.6, 554.2], [257.8, 608.8], [248.4, 608.1]], lv: 39 }, // 東塔 中段
      { pts: [[261.6, 554.2], [271.5, 554.8], [267.9, 609.4], [257.8, 608.8]], lv: 38 }, // 東塔 外段
    ];
    for (const p of PARTS) addPolyBldg(p.pts, p.lv * LV, edgeMat, true);
    // 空中庭園(39-40F): 両塔頂部+吹き抜けを覆う板(OSM way 588689730+649098944の結合外形)に円形開口
    const DECK = [[190.2, 549.6], [217.1, 551.3], [243.1, 553], [239.9, 607.6], [213.7, 606.7], [187.5, 604.2]];
    const shape = new THREE.Shape();
    DECK.forEach(([mx, my], i) => {
      const [x, z] = M2W([mx, my]);
      if (i === 0) shape.moveTo(x, z); else shape.lineTo(x, z);
    });
    const [ox, oz] = M2W([215.5, 579.2]);
    const holePath = new THREE.Path();
    holePath.absarc(ox, oz, 8.3, 0, Math.PI * 2, true); // 実測: 開口半径≈16.5px→world 8.3
    shape.holes.push(holePath);
    const deckGeo = new THREE.ExtrudeGeometry(shape, { depth: LV, bevelEnabled: false });
    deckGeo.rotateX(Math.PI / 2);
    deckGeo.translate(0, GROUND_Y + 40 * LV, 0); // 39F床〜40F屋上
    const deck = new THREE.Mesh(deckGeo, faceMatLm);
    deck.renderOrder = 3;
    groundGroup.add(deck, new THREE.LineSegments(new THREE.EdgesGeometry(deckGeo, 30), edgeMat));
    // 屋上スカイウォーク(開口の縁のリング)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(8.8, 0.7, 6, 40),
      new THREE.MeshBasicMaterial({ color: 0xcfe0f5, transparent: true, opacity: 0.35, depthWrite: false })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(ox, GROUND_Y + 40 * LV + 0.8, oz);
    groundGroup.add(ring);
    // 斜行エスカレーターチューブ(35F→39F。吹き抜けを渡って交差する名物の2本。見える太さの円柱で)
    const tubeMat = new THREE.MeshBasicMaterial({ color: 0xcfe0f5, transparent: true, opacity: 0.5, depthWrite: false });
    const addTube = (m1, y1, m2, y2) => {
      const [ax, az] = M2W(m1); const [bx, bz] = M2W(m2);
      const a = new THREE.Vector3(ax, y1, az), b = new THREE.Vector3(bx, y2, bz);
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, a.distanceTo(b), 8), tubeMat);
      cyl.position.copy(a).add(b).multiplyScalar(0.5);
      cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      cyl.renderOrder = 3;
      groundGroup.add(cyl);
    };
    // 空中エスカレーター: 東塔35Fから空中庭園(39F)の穴に向かって2本が平行に伸びる(現地確認 2026-08-23)
    addTube([236.9, 589.4], GROUND_Y + 35 * LV, [206.2, 567.3], GROUND_Y + 39 * LV);
    addTube([240.4, 584.5], GROUND_Y + 35 * LV, [209.7, 562.4], GROUND_Y + 39 * LV);
    addBldgLabel('梅田スカイビル', 215.5, 578.6, GROUND_Y + 40 * LV + 9);
  }

  // --- HEP FIVE: 赤い観覧車（梅田の目印） ---
  // 実物は直径75m・頂部106mで、ビル(63m)より観覧車の方が大きい。×0.75で統一
  {
    const [wx, wz] = M2W([1144.8, 714.1]);  // HEP FIVEビル実外形の中心(実座標化に追従)
    const wy = GROUND_Y + 51;   // 車輪中心 ~68m
    const R = 28;               // 半径 37.5m
    const wheelMat = new THREE.LineBasicMaterial({ color: 0xcfe0f5, transparent: true, opacity: 0.30 });
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(R, 1.0, 6, 48),
      new THREE.MeshBasicMaterial({ color: 0xcfe0f5, transparent: true, opacity: 0.22, depthWrite: false })
    );
    rim.position.set(wx, wy, wz);
    groundGroup.add(rim);
    const spokes = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI;
      spokes.push(wx + Math.cos(a) * R, wy + Math.sin(a) * R, wz,
                  wx - Math.cos(a) * R, wy - Math.sin(a) * R, wz);
    }
    const spokeGeo = new THREE.BufferGeometry();
    spokeGeo.setAttribute('position', new THREE.Float32BufferAttribute(spokes, 3));
    groundGroup.add(new THREE.LineSegments(spokeGeo, wheelMat));
  }

  // --- 主要道路: 御堂筋・四つ橋筋・曽根崎通（地上の座標系の手掛かり） ---
  {
    // 道路の面は OSM(ground_data.js)で描くので、ここは主要道路の名前ラベルだけ
    addBldgLabel('御堂筋', 905.7, 1268.0, GROUND_Y + 3);
    addBldgLabel('四つ橋筋', 619.9, 1447.5, GROUND_Y + 3);
    addBldgLabel('曽根崎通', 1228.8, 1312.8, GROUND_Y + 3);
  }

  // --- 地面の枠: 地中の底グリッドと同じ範囲を地上レベルで四角く囲い、「地面の板」を感じさせる ---
  {
    // B2のGridHelper(size 680, 中心(-45, -20))と同じ矩形
    const cx = -45, cz = -20, half = 340;
    const y = GROUND_Y;
    const frameGeo = new THREE.BufferGeometry();
    frameGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      cx - half, y, cz - half,  cx + half, y, cz - half,
      cx + half, y, cz - half,  cx + half, y, cz + half,
      cx + half, y, cz + half,  cx - half, y, cz + half,
      cx - half, y, cz + half,  cx - half, y, cz - half,
    ], 3));
    const frame = new THREE.LineSegments(frameGeo,
      new THREE.LineBasicMaterial({ color: 0xaec4de, transparent: true, opacity: 0.35 }));
    groundGroup.add(frame);
    // 四隅から地中の底へ落ちる柱線: 地上の板と地下の箱を1つの構造としてつなぐ
    const yB = FLOOR_Y.B2 - 3.6;
    const cornerGeo = new THREE.BufferGeometry();
    cornerGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      cx - half, y, cz - half,  cx - half, yB, cz - half,
      cx + half, y, cz - half,  cx + half, yB, cz - half,
      cx + half, y, cz + half,  cx + half, yB, cz + half,
      cx - half, y, cz + half,  cx - half, yB, cz + half,
    ], 3));
    groundGroup.add(new THREE.LineSegments(cornerGeo,
      new THREE.LineBasicMaterial({ color: 0xaec4de, transparent: true, opacity: 0.14 })));
  }

  // --- JR大阪駅: OSM実測(relation 17915329)。駅は地図座標系で長軸-36.4°に斜行する ---
  //     (地下・浅層の駅コンコース床と同じ外形なので、上下がぴったり重なる)
  {
    const stMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.24 });
    // 駅本体+西側部(うめきた/西口)の実外形ボリューム
    const STA_MAIN = [[900.1, 856.6], [862.1, 749.6], [844.1, 759.8], [849, 769.7], [828.7, 786.8], [835, 796.8], [800.7, 818.4], [797.2, 807.1], [608, 923], [603, 914.6], [592.8, 923.4], [648.4, 1016.5], [716.6, 975.1], [722.2, 984.6], [812.1, 929.4], [887.9, 880.7], [888.2, 864.9]];
    const STA_WEST = [[584.9, 1051.9], [620.8, 1031.1], [566.1, 939.9], [514.1, 979.3], [564.8, 1063.7]];
    addPolyBldg(STA_MAIN, 20, edgeMat, true);
    addPolyBldg(STA_WEST, 8, edgeMatSoft);

    // 回転フレーム: 中心=本体重心(765.3,885.1)、長軸-36.4°(OSM回転矩形の実測)
    const C = [755.2, 894.7];
    const TH = -32.6 * Math.PI / 180;
    const ux = Math.cos(TH), uy = Math.sin(TH); // 長軸=線路方向(南西→北東)
    const vx = -uy, vy = ux;                    // 幅方向(ホームを横切る向き)
    const ROOF_W = 132;                          // 大屋根の幅(回転矩形の実測短辺)
    const at = (s, t) => M2W([C[0] + ux * s + vx * (t - 0.5) * ROOF_W,
                              C[1] + uy * s + vy * (t - 0.5) * ROOF_W]);
    // アーチ断面(幅方向t=0..1): 中央が膨らみ、片側へ緩く下がる大屋根
    const archY = t => GROUND_Y + 36 + Math.sin(Math.PI * t) * 34 - 10 * t;
    const P = [];
    const SEG = 12;
    const S_ARCS = [-110, -55, 0, 55, 110]; // アーチ断面の位置(長軸方向・ゲートビル間)
    for (const s of S_ARCS) {
      for (let i = 0; i < SEG; i++) {
        const [x1, z1] = at(s, i / SEG), [x2, z2] = at(s, (i + 1) / SEG);
        P.push(x1, archY(i / SEG), z1, x2, archY((i + 1) / SEG), z2);
      }
    }
    for (const t of [0, 0.25, 0.5, 0.75, 1]) { // 長軸方向のつなぎ(稜線)
      const y = archY(t);
      for (let r = 0; r < S_ARCS.length - 1; r++) {
        const [x1, z1] = at(S_ARCS[r], t), [x2, z2] = at(S_ARCS[r + 1], t);
        P.push(x1, y, z1, x2, y, z2);
      }
    }
    const archGeo = new THREE.BufferGeometry();
    archGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    groundGroup.add(new THREE.LineSegments(archGeo, stMat));

    // 大屋根の面（ごく薄いシートを張って「駅の大屋根」に見せる）
    {
      const verts = [], idx = [];
      const COLS = S_ARCS.length;
      for (let i = 0; i <= SEG; i++) {
        const y = archY(i / SEG);
        for (const s of S_ARCS) {
          const [x, z] = at(s, i / SEG);
          verts.push(x, y, z);
        }
      }
      for (let i = 0; i < SEG; i++) {
        for (let c = 0; c < COLS - 1; c++) {
          const a = i * COLS + c, b = a + 1, d = a + COLS, e = d + 1;
          idx.push(a, d, b, b, d, e);
        }
      }
      const sheetGeo = new THREE.BufferGeometry();
      sheetGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      sheetGeo.setIndex(idx);
      const sheet = new THREE.Mesh(sheetGeo, new THREE.MeshBasicMaterial({
        color: 0xbcd4ee, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide,
      }));
      sheet.renderOrder = 3;
      groundGroup.add(sheet);
      addBldgLabel('JR大阪駅', 754.8, 894.6, GROUND_Y + 78);
    }

    // JR線の高架橋: OSM東海道本線の実線形(駅重心から5.5px)を簡略化した帯。
    // 南西(福島方面)から駅を斜めに貫き、北東へカーブして新大阪方面へ抜ける
    const VIADUCT = [
      [5.8, 1356, 14],   // 南西端(福島方面)
      [93.9, 1337.8, 15],
      [170.4, 1303, 17],
      [529.6, 1026.4, 30],  // 駅の手前で拡大開始
      [603.5, 981.1, 55],
      [751.4, 890.3, 63],   // 駅中心(ホーム群)
      [896, 802.2, 55],
      [1109.5, 685.1, 26],  // 北東へ収束
      [1178.5, 625.6, 20],
      [1216.9, 577, 18],
      [1265.7, 476.3, 16],
      [1281.3, 410.7, 15],
      [1300.2, 207.7, 14],  // 北東端(新大阪方面)
    ];
    const deckTop = GROUND_Y + 13;
    {
      // 高架は「地面から立ち上がる一体の盛土状ボリューム」で描く(柱なし・下は埋める)
      const upper = VIADUCT.map(([mx, my, hw]) => M2W([mx, my - hw]));
      const lower = VIADUCT.map(([mx, my, hw]) => M2W([mx, my + hw]));
      const shape = new THREE.Shape();
      shape.moveTo(upper[0][0], -upper[0][1]);
      for (let i = 1; i < upper.length; i++) shape.lineTo(upper[i][0], -upper[i][1]);
      for (let i = lower.length - 1; i >= 0; i--) shape.lineTo(lower[i][0], -lower[i][1]);
      const solid = new THREE.Mesh(
        new THREE.ExtrudeGeometry(shape, { depth: deckTop - GROUND_Y, bevelEnabled: false }),
        new THREE.MeshBasicMaterial({ color: 0xa9c4e2, transparent: true, opacity: 0.10, depthWrite: false })
      );
      solid.rotation.x = -Math.PI / 2;
      solid.position.y = GROUND_Y;
      solid.renderOrder = 3;
      groundGroup.add(solid);
      // 上端の輪郭線だけ残してエッジを立たせる
      const ring = [...upper, ...lower.slice().reverse()];
      const outlineGeo = new THREE.BufferGeometry().setFromPoints(
        ring.map(([wx, wz]) => new THREE.Vector3(wx, deckTop, wz))
      );
      groundGroup.add(new THREE.LineLoop(outlineGeo, stMat));
    }

    // ホーム（高架デッキの上・大屋根の下）: 線路軸に沿った細長い箱を幅方向にずらして2本
    for (const off of [-9, 13]) {
      const g = new THREE.BoxGeometry(220 * 0.5, 5, 12 * 0.5); // 地図px→world ×0.5
      const w = new THREE.LineSegments(new THREE.EdgesGeometry(g), stMat);
      const [px, pz] = M2W([C[0] + vx * off, C[1] + vy * off]);
      w.position.set(px, deckTop + 2.5, pz);
      w.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(ux, 0, uy).normalize());
      groundGroup.add(w);
    }
  }
}

// チラつき対策: 半透明は使わず、減光は「色を暗くする」方式で行う（不透明描画のみ）
const corridorMat = new THREE.MeshStandardMaterial({ color: 0x3a4f6e, emissive: 0x0d1521, roughness: 0.6 });

// 施設（ゾーン）ごとの通路マテリアル
const zoneMats = {};
for (const [id, z] of Object.entries(ZONES)) {
  zoneMats[id] = new THREE.MeshStandardMaterial({
    color: new THREE.Color(z.color).multiplyScalar(0.55),
    emissive: new THREE.Color(z.color).multiplyScalar(0.14),
    roughness: 0.6,
  });
}

// チラつき対策2: メッシュごとに微小な高さ差をつけ、同一平面の重なりを作らない
let meshSeq = 0;
const jitterY = () => (meshSeq++ % 16) * 0.025;
// ゾーンなしの脇役（フィルタ時に減光する中立マテリアル）
const neutralMats = [corridorMat];

// 施設(ゾーン)が跨るフロア一覧。中枢層など一部フロアを消しても他の可視フロアに名前を出すため
const zoneFloors = {};
const addZoneFloor = (zone, floor) => {
  if (zone && floor) (zoneFloors[zone] || (zoneFloors[zone] = new Set())).add(floor);
};
for (const n of NODES) addZoneFloor(n.zone, n.floor);
for (const a of Object.values(SHOP_AREAS)) addZoneFloor(a.zone, a.floor);

// 地図上の文字は施設名（施設色の素のテキスト、装飾なし）
const zoneLabelDivs = {};
const zoneLabelObjs = []; // {id, lab} 施設名は一律トグルに任せず updateZoneLabels() で可視フロアへ出し分ける
for (const [id, z] of Object.entries(ZONES)) {
  if (!z.label || z.corridor) continue; // 通路扱いのゾーンは地図に名前を出さない
  const [lx, lz] = M2W(z.label);
  const div = document.createElement('div');
  div.className = 'zone-label';
  div.textContent = z.name;
  div.style.color = '#' + z.color.toString(16).padStart(6, '0');
  const lab = new CSS2DObject(div);
  lab.position.set(lx, FLOOR_Y.B1 + 14, lz);
  floorGroups.B1.add(lab); // 親はB1のGroupだがCSS2Dはグループ非表示に連動しない→可視はlab.visibleで制御
  zoneLabelObjs.push({ id, lab });
  zoneLabelDivs[id] = div;
}

// ★絶対ルール: 複数フロアに跨る施設は、中枢層など一部フロアを非表示にしても、他の可視フロアに
//   名前ラベルを必ず出す(現在地把握のため必須)。可視フロアのうち 中枢層>浅層>深層 の順で選ぶ。
//   単一フロアの施設は、その唯一のフロアを消したら出しようがないので消える(ルールの対象外)。
const ZONE_LABEL_FLOOR_PREF = ['B1', 'S1', 'B2'];
function updateZoneLabels() {
  for (const { id, lab } of zoneLabelObjs) {
    const floors = zoneFloors[id];
    let target = null;
    if (floors) for (const f of ZONE_LABEL_FLOOR_PREF) {
      if (floors.has(f) && floorGroups[f].visible) { target = f; break; }
    }
    lab.visible = !!target;
    if (target) lab.position.y = FLOOR_Y[target] + 14;
  }
}
updateZoneLabels();

// ---------------------------------------------------------------------------
// ランドマーク(目印): 金色のピン+名前。タップで写真/メモを表示。案内文の曲がり角の目印にも使う
// ---------------------------------------------------------------------------
const landmarkMeshes = [];
const landmarkById = {};
{
  const pinGeo = new THREE.ConeGeometry(2.2, 6, 6);
  const pinMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
  for (const lm of LANDMARKS) {
    const [x, z] = M2W([lm.mx, lm.my]);
    lm.x = x; lm.z = z;
    landmarkById[lm.id] = lm;
    if (lm.vert) { lm.x = x; lm.z = z; continue; } // 地上への昇降設備は VERTICALS と同じ立体で描く(下の drawVertical)
    const pin = new THREE.Mesh(pinGeo, pinMat);
    pin.rotation.x = Math.PI; // 先端を下に
    pin.position.set(x, FLOOR_Y[lm.floor] + 7, z);
    pin.userData.landmarkId = lm.id;
    pin.renderOrder = 5;
    const div = document.createElement('div');
    div.className = 'landmark-label';
    div.textContent = (lm.photo ? '📷 ' : '') + lm.name;
    const lab = new CSS2DObject(div);
    lab.position.set(0, 5, 0);
    pin.add(lab);
    floorGroups[lm.floor].add(pin);
    floorLabelObjs[lm.floor].push(lab);
    landmarkMeshes.push(pin);
  }
}

// 詳細地図はガイド座標系(フロアガイドそのまま)で、広域とは別の専用エリアに置く。
// 広域(実座標)と重ならない遠方にオフセットし、詳細モード中はそこだけを見せる。オフセットは施設ごと(DETAIL_MAPS.origin)
const g2w = (zone, [gx, gy]) => [gx * 0.5 + DETAIL_MAPS[zone].origin[0], gy * 0.5 + DETAIL_MAPS[zone].origin[1]];

// ---------------------------------------------------------------------------
// 詳細モード: 施設の床をタップ → その施設の詳細地図(区画+実位置の店名)。✕で広域へ戻る
// 入れるのは DETAIL_MAPS に登録した施設だけ(詳細データがある施設)
// ---------------------------------------------------------------------------
var detailMode = null; // (前方のイベントハンドラから参照するため var) いま開いている施設のゾーンID
// 施設ごとの詳細地図の実体。group=専用グループ / blockByShop=店ID→区画メッシュ / shopIds=実位置を持つ店 /
// labels=店名ラベル / anchors=地図の実体がある位置([x,z,...] パンで見失わないための基準) / nav=ガイド内経路探索
const DETAIL = {};
for (const [key, M] of Object.entries(DETAIL_MAPS)) {
  // entry: 広域側でこの詳細地図が「どこにあるか」(床タップで館×階を選ぶ基準)。areas の rect 中心、無ければゾーンのラベル位置
  const a = M.areas && SHOP_AREAS[M.areas[0]];
  const [ex, ez] = a ? M2W([a.rect[0], a.rect[1]]) : M2W(ZONES[M.zone || key].label);
  DETAIL[key] = { group: null, blockByShop: {}, shopIds: [], labels: [], anchors: [], nav: null,
                  y: FLOOR_Y[M.floor || 'B1'], entry: [ex, ez] };
}
// 店・エリア → 詳細地図のキー。areas を持つ施設(三番街の館×階)はエリアで、それ以外はゾーンで引く
function detailKeyOfArea(area, zone) {
  for (const [k, M] of Object.entries(DETAIL_MAPS)) {
    if (M.areas) { if (area && M.areas.includes(area)) return k; }
    else if ((M.zone || k) === zone) return k;
  }
  return null;
}
const detailKeyOfShop = n => (n && n.type === 'shop') ? detailKeyOfArea(n.area, n.zone) : null;
// 床タップ → 詳細地図。同じゾーン・同じ階に複数の詳細地図があれば(北館/南館)、タップ位置に近い方
function detailKeyAt(zone, floor, point) {
  let best = null, bd = Infinity;
  for (const [k, M] of Object.entries(DETAIL_MAPS)) {
    if ((M.zone || k) !== zone || (M.floor || 'B1') !== (floor || 'B1')) continue;
    const [ex, ez] = DETAIL[k].entry;
    const d = Math.hypot(point.x - ex, point.z - ez);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}
const detailKeyForFloorHit = hit => detailKeyAt(hit.object.userData.zone, hit.object.userData.floor, hit.point);
// 館ノード(P: 名前付きの地下街・館の地点)の当たり判定は半径18mの透明シリンダーで、集約ドットの真上に重なることがある(三番街南館)。
// 詳細地図を持つ館では館ノードのタップも床タップと同じく詳細地図への入口にする(端点にしたければ検索で選べる)
const detailKeyForSpotHit = hit => { const n = nodeById[hit.object.userData.nodeId]; return n && n.type === 'spot' ? detailKeyAt(n.zone, n.floor, hit.point) : null; };
function buildDetailLabels(zone) {
  const D = DETAIL[zone];
  if (D.labels.length) return;
  const stacked = new Map(); // 同じ区画に複数店 → ラベルを縦にずらす
  for (const id of D.shopIds) {
    const block = D.blockByShop[id];
    if (!block) continue; // ガイド上の区画に対応づいた店だけ(詳細地図はガイドそのもの)
    const div = document.createElement('div');
    div.className = 'node-label shop detail-shop';
    div.textContent = shortShopName(nodeById[id].name);
    const lab = new CSS2DObject(div);
    const n = stacked.get(block) || 0;
    stacked.set(block, n + 1);
    const [cx, cz] = block.userData.center;
    lab.position.set(cx, 2.2 + n * 3, cz); // 区画の重心(ジオメトリがワールド座標なのでローカル=ワールド)
    block.add(lab);
    lab.visible = false;
    D.labels.push({ id, block, lab });
  }
}
const detailHidden = []; // 詳細モードで隠したオブジェクト(戻すときに復元)
const detailSaved = {};
function hideForDetail(obj) { if (obj.visible) { obj.visible = false; detailHidden.push(obj); } }
function enterDetail(zoneId) {
  if (detailMode === zoneId || !DETAIL_MAPS[zoneId]) return;
  if (detailMode) exitDetail(); // 別の施設の詳細を開いていたら先に閉じる(専用エリアが違う)
  detailMode = zoneId;
  const D = DETAIL[zoneId];
  buildDetailLabels(zoneId);
  for (const d of D.labels) d.lab.visible = true;
  document.getElementById('detail-bar').hidden = false;
  document.getElementById('detail-bar-name').textContent = (DETAIL_MAPS[zoneId].name || ZONES[DETAIL_MAPS[zoneId].zone || zoneId].name) + ' 詳細地図';
  // 詳細地図=ガイド座標系の別画面。広域(実座標)のものは丸ごと隠して専用エリアへ飛ぶ
  hideForDetail(floorGroups.S1); hideForDetail(floorGroups.B1); hideForDetail(floorGroups.B2);
  hideForDetail(groundGroup); hideForDetail(vertGroup);
  // CSS2Dラベルはグループ非表示に連動しないため個別に隠す
  for (const labs of Object.values(floorLabelObjs)) for (const lab of labs) { if (lab.visible) { lab.visible = false; detailHidden.push(lab); } }
  for (const { lab } of zoneLabelObjs) { if (lab.visible) { lab.visible = false; detailHidden.push(lab); } }
  for (const lab of groundLabelObjs) { if (lab.visible) { lab.visible = false; detailHidden.push(lab); } }
  routeGroup.visible = false; // 広域のルート線は詳細では出さない(詳細はガイド内経路で案内)
  syncRouteShopLabels(); // 広域のルート経由店ラベル(CSS2D)は親を隠しても残るので個別に消す
  D.group.visible = true;
  // ガイド全体が入る範囲
  const box = new THREE.Box3().expandByObject(D.group);
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(45, box.getBoundingSphere(new THREE.Sphere()).radius); // 小さい施設(アバンザ・三番街の1フロア)でも画面に収まる程度に寄る
  detailSaved.camPos = camera.position.clone();
  detailSaved.camTgt = controls.target.clone();
  // Google Maps 風の操作: 1本指=パン、2本指=ズーム+ひねり回転(+上下で傾き)、左ドラッグ=パン、右ドラッグ=回転。
  // 初期視点は真俯瞰(固定はしない)。傾きは60°まで
  detailSaved.enableRotate = controls.enableRotate;
  detailSaved.maxPolar = controls.maxPolarAngle;
  detailSaved.minDistance = controls.minDistance;
  detailSaved.touchesONE = controls.touches.ONE;
  detailSaved.touchesTWO = controls.touches.TWO;
  detailSaved.mouseLEFT = controls.mouseButtons.LEFT;
  detailSaved.mouseRIGHT = controls.mouseButtons.RIGHT;
  detailSaved.screenSpacePanning = controls.screenSpacePanning;
  controls.enableRotate = true;
  controls.touches.ONE = THREE.TOUCH.PAN;
  controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
  controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
  controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  controls.screenSpacePanning = false; // パンは床面に沿って動かす(地図らしい移動)
  controls.minPolarAngle = 0; controls.maxPolarAngle = Math.PI / 3; // 傾きは60°まで(現在の角度より広いので跳ねない)
  controls.minDistance = 40;
  camAnim = { fromPos: camera.position.clone(), toPos: new THREE.Vector3(c.x, D.y + r * 1.7, c.z + 0.1),
              fromTgt: controls.target.clone(), toTgt: new THREE.Vector3(c.x, D.y, c.z), start: performance.now(), dur: 900, hard: true };
}
function exitDetail() {
  if (!detailMode) return;
  const D = DETAIL[detailMode];
  detailMode = null;
  D.group.visible = false;
  routeGroup.visible = true;
  for (const d of D.labels) d.lab.visible = false;
  syncRouteShopLabels(); // 詳細用(区画)のラベルを消し、広域用のラベルを戻す
  for (const o of detailHidden) o.visible = true;
  detailHidden.length = 0;
  // フロアチップでOFFにしていた階は隠したまま(チップの状態に従う)
  for (const f of ['S1', 'B1', 'B2']) {
    const chip = document.getElementById('chip-' + f);
    if (chip && chip.classList.contains('off')) floorGroups[f].visible = false;
  }
  if (document.getElementById('chip-buildings').classList.contains('off')) groundGroup.visible = false;
  controls.enableRotate = detailSaved.enableRotate;
  controls.minPolarAngle = 0; controls.maxPolarAngle = detailSaved.maxPolar;
  controls.minDistance = detailSaved.minDistance;
  controls.touches.ONE = detailSaved.touchesONE;
  controls.touches.TWO = detailSaved.touchesTWO;
  controls.mouseButtons.LEFT = detailSaved.mouseLEFT;
  controls.mouseButtons.RIGHT = detailSaved.mouseRIGHT;
  controls.screenSpacePanning = detailSaved.screenSpacePanning;
  // 広域のカメラ位置に戻る
  if (detailSaved.camPos) {
    camAnim = { fromPos: camera.position.clone(), toPos: detailSaved.camPos,
                fromTgt: controls.target.clone(), toTgt: detailSaved.camTgt, start: performance.now(), dur: 700, hard: true };
  }
  document.getElementById('detail-bar').hidden = true;
}
document.getElementById('detail-bar-close')?.addEventListener('click', exitDetail);

// 写真ビューア(案内文のサムネイル・ランドマーク/店のタップで開く)
const photoView = document.getElementById('photo-view');
function showPhotos(title, photos, note) {
  if (!photoView) return;
  const list = (photos || []).map(p => `<figure><img src="${p.file}" alt=""><figcaption>${p.caption || ''}</figcaption></figure>`).join('');
  photoView.innerHTML = `<div class="pv-box"><div class="pv-head"><b>${title}</b><button id="pv-close">閉じる</button></div>${note ? `<p class="pv-note">${note}</p>` : ''}${list || '<p class="pv-note">写真はまだありません</p>'}</div>`;
  photoView.hidden = false;
  photoView.querySelector('#pv-close').addEventListener('click', () => { photoView.hidden = true; });
}
photoView?.addEventListener('click', e => { if (e.target === photoView) photoView.hidden = true; });
const photosOf = id => PHOTOS[id] || [];
// 案内文に付けるサムネイル(写真があるときだけ)
const photoTag = id => {
  const ps = photosOf(id);
  return ps.length ? `<img class="step-photo" src="${ps[0].file}" data-photo-id="${id}" alt="">` : '';
};
document.getElementById('route-info')?.addEventListener('click', e => {
  const img = e.target.closest?.('.step-photo');
  if (!img) return;
  e.stopPropagation();
  const id = img.dataset.photoId;
  showPhotos(nodeById[id]?.name || landmarkById[id]?.name || id, photosOf(id));
});

// 通路端の延長量: 交差相手（そのノードに接続する他の通路）の半幅ぶんだけ伸ばす。
// 行き止まりはノードで止める。露骨な重なり・突き抜けを防ぐ。
const nodeEdgeWidths = {};
for (const [a, b, w] of EDGES) {
  (nodeEdgeWidths[a] ||= []).push(w);
  (nodeEdgeWidths[b] ||= []).push(w);
}
function endExt(nodeId, ownW) {
  const ws = nodeEdgeWidths[nodeId] || [];
  if (ws.length <= 1) return 0; // 行き止まり
  const others = ws.slice();
  others.splice(others.indexOf(ownW), 1);
  return Math.max(...others) / 2;
}

function addCorridor(aId, bId, w, zone) {
  const a = nodeById[aId], b = nodeById[bId];
  const pa = posOf(a), pb = posOf(b);
  const dist = pa.distanceTo(pb);
  const extA = endExt(aId, w), extB = endExt(bId, w);
  const len = dist + extA + extB;
  const d = pb.clone().sub(pa).normalize();
  const geo = new THREE.BoxGeometry(len, 3, w);
  const mesh = new THREE.Mesh(geo, zoneMats[zone] || corridorMat);
  if (zone) mesh.userData.zone = zone; // 調査モードのタップ地点判定用
  // 延長量が左右で違うぶん中心をずらす
  mesh.position.copy(pa).add(pb).multiplyScalar(0.5).add(d.clone().multiplyScalar((extB - extA) / 2));
  mesh.position.y += jitterY();
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), d);
  floorGroups[a.floor].add(mesh);
}
// 多角形フロアが置き換える通路は箱を描かない
const polyCoveredPairs = new Set();
for (const fp of FLOOR_POLYS) {
  for (const [a, b] of fp.covers || []) {
    polyCoveredPairs.add(`${a}|${b}`);
    polyCoveredPairs.add(`${b}|${a}`);
  }
}
for (const [ia, ib, w, zone] of EDGES) {
  if (polyCoveredPairs.has(`${ia}|${ib}`)) continue;
  addCorridor(ia, ib, w, zone);
}

// 任意多角形のフロア面を押し出しで生成（Shapeの+yは地図の-z方向に対応）
for (const fp of FLOOR_POLYS) {
  const shape = new THREE.Shape();
  fp.pts.forEach(([mx, my], i) => {
    const [x, z] = M2W([mx, my]);
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  for (const h of fp.holes || []) {   // 穴(通路ループの内側)
    const path = new THREE.Path();
    h.forEach(([mx, my], i) => {
      const [x, z] = M2W([mx, my]);
      if (i === 0) path.moveTo(x, -z);
      else path.lineTo(x, -z);
    });
    shape.holes.push(path);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: false });
  const mesh = new THREE.Mesh(geo, zoneMats[fp.zone] || corridorMat);
  mesh.userData.zone = fp.zone; mesh.userData.floor = fp.floor; // 調査モードのタップ地点判定用
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = FLOOR_Y[fp.floor] - 1.5; // ゾーン間の重なりは生成時に除去済み。高さは全面で統一(段差なし)
  floorGroups[fp.floor].add(mesh);
}

// --- EV・ESC・階段の3D表現: 細い光のビーム＋両端パッド（色で種別を判別） ---
// 店舗ドット（低くて控えめ）と混同しないよう、設備は「立ち上がる明るい立体」で表現
const VERT_COLORS = { ev: 0x9fe0ff, esc: 0xffc23d, stairs: 0xc4cedd };
const beamMats = {}, padMats = {};
for (const [type, color] of Object.entries(VERT_COLORS)) {
  beamMats[type] = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.5,
    transparent: true, opacity: 0.25, depthWrite: false,
  });
  padMats[type] = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: type === 'stairs' ? 0.7 : 1.2, roughness: 0.35,
  });
}
const beamGeo = new THREE.CylinderGeometry(0.7, 0.7, FLOOR_Y.B1 - FLOOR_Y.B2, 8);
// 階段: 側面が3段のステップ形(踏面→蹴上×3+上部の小さな踊り場)を押し出したソリッド。
// ローカル+Xが「上り方向」
const stairsGeo = (() => {
  const steps = 3, sw = 1.24, sh = 1.3, landing = 1.5, depth = 3.6; // 踏面幅は1.9の65%
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  let x = 0, y = 0;
  for (let i = 0; i < steps; i++) { s.lineTo(x + sw, y); x += sw; s.lineTo(x, y + sh); y += sh; }
  s.lineTo(x + landing, y);
  s.lineTo(x + landing, 0);
  s.lineTo(0, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  geo.translate(-(x + landing) / 2, 0, -depth / 2);
  return geo;
})();

// エレベーター: 半透明のシャフト(直方体の枠)+中を上下する「かご」(立方体)で表現
const evShaftGeo = new THREE.BoxGeometry(3.6, (FLOOR_Y.B1 - FLOOR_Y.B2) + 8, 3.6);
const evShaftMat = new THREE.MeshBasicMaterial({
  color: 0x9fe0ff, transparent: true, opacity: 0.12, depthWrite: false,
});
const evShaftEdgeMat = new THREE.LineBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.45 });
const evCageGeo = new THREE.BoxGeometry(3.2, 3.2, 3.2);
const evCages = []; // { mesh, low, high, phase } — animate()で各EVの実フロア間を往復させる
window.__dbg.evCages = evCages;
// かごの可動域は各EVの実フロアペアから算出(evCagesのlow/high。+3.5=床上面+かご半分)

// エスカレーターの手すり(欄干): 中身の詰まったソリッドな側面パネル×2。
// ローカル+Xが「上り方向」。フロアで形を変える:
//   B1(下り) = 上り側の端が丸い高台から、進行方向へ尖って下るくさび
//   B2(上り) = 乗り口側の端が丸く、上り方向の頂部が尖って立ち上がる形
const ESC_L = 9.5;
function escPanelGeo(floorKey) {
  const s = new THREE.Shape();
  if (floorKey === 'B1') {
    // 下り: 上辺が水平の台形。左辺が斜めのスロープ、右端(上り側)は全高の丸(R)
    // 0°(水平)の線が長すぎたため全長を短縮(上辺4.0→2.6 = 65%)
    const LB = 8.1;
    const H = 4.2, r = H / 2, xR = LB / 2 - r, slant = 3.4;
    s.moveTo(-LB / 2, 0);                                       // 左下
    s.lineTo(xR, 0);                                            // 底辺
    s.absarc(xR, r, r, -Math.PI / 2, Math.PI / 2, false);       // 右端の丸(R)
    s.lineTo(-LB / 2 + slant, H);                               // 上辺(水平)
    s.lineTo(-LB / 2, 0);                                       // 左辺(斜めカット)
  } else {
    // 上り: 半円(乗り口R)+直線は床に対して0°・45°・90°のみで構成。
    // 底辺(0°)は途中で45°に切り上がり、そのあと90°(垂直)で峰へ。
    // 0°(床に平行)の辺は従来の40%に短縮。半円中心をx=0に置いて構築し、最後に中央寄せ
    const r = 1.9;
    const topRun = 1.76, botRun = 2.46;   // 底辺(地面側)は1.54の1.6倍
    const H = 7.0;                        // 峰の高さは維持
    const xR = topRun + (H - 2 * r);      // 45°で峰へ届く右端 = 4.96
    const yV = xR - botRun;               // 垂直辺の下端 = 2.50(底辺延長に合わせ調整)
    s.moveTo(xR, H);                                            // 峰の頂点(右上)
    s.lineTo(xR, yV);                                           // 90°: 垂直辺
    s.lineTo(botRun, 0);                                        // 45°: 底辺から切り上がり
    s.lineTo(0, 0);                                             // 0°: 底辺
    s.absarc(0, r, r, -Math.PI / 2, Math.PI / 2, true);         // 半円(乗り口R)
    s.lineTo(topRun, 2 * r);                                    // 0°: 半円上端から水平
    s.lineTo(xR, H);                                            // 45°: 峰へ
  }
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.55, bevelEnabled: false });
  // B2は形が非対称なので水平方向も中央寄せする(-r〜xRの中心)
  geo.translate(floorKey === 'B1' ? 0 : -1.53, 0, -0.275);
  return geo;
}
const escPanelGeos = { B1: escPanelGeo('B1'), B2: escPanelGeo('B2') };
function makeEscalator(floorKey, mat) {
  // 手すりパネルのみ(床板なし)
  const g = new THREE.Group();
  for (const sgn of [-1, 1]) {
    const rail = new THREE.Mesh(escPanelGeos[floorKey], mat);
    rail.position.z = sgn * 1.85;
    g.add(rail);
  }
  return g;
}

const concourseMat = new THREE.MeshStandardMaterial({ color: 0x31435f, emissive: 0x0d1522, roughness: 0.65 });
neutralMats.push(concourseMat);
// 昇降設備の立体表現。VERTICALS(地図内の2階を結ぶ)と、地上1Fへ上がる設備(LANDMARKS の vert)の両方で使う。
// type: ev|esc|stairs, (x,z): 位置, yB2/yB1: 下段/上段の高さ, dir: 上り方向の水平ベクトル, opts.skipLower: 下段アイコン省略
function drawVertical(type, x, z, yB2, yB1, dir, opts = {}) {
  const span = yB1 - yB2;
  if (type === 'ev') {
    // EV: 半透明シャフト+上下するかご
    const shaftGeo = span === FLOOR_Y.B1 - FLOOR_Y.B2 ? evShaftGeo : new THREE.BoxGeometry(3.6, span + 8, 3.6);
    const shaftY = yB2 + (span + 8) / 2;
    const fill = new THREE.Mesh(shaftGeo, evShaftMat);
    fill.position.set(x, shaftY, z);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(shaftGeo), evShaftEdgeMat);
    edges.position.set(x, shaftY, z);
    const cage = new THREE.Mesh(evCageGeo, padMats.ev);
    cage.position.set(x, yB2 + 3.5, z);
    vertGroup.add(fill, edges, cage);
    evCages.push({ mesh: cage, low: yB2 + 3.5, high: yB1 + 3.5, phase: evCages.length * 1.73 });
    return fill;
  }
  const beam = new THREE.Mesh(span === FLOOR_Y.B1 - FLOOR_Y.B2 ? beamGeo : new THREE.CylinderGeometry(0.7, 0.7, span, 8), beamMats[type]);
  beam.position.set(x, (yB1 + yB2) / 2, z);
  vertGroup.add(beam);
  let [dx, dz] = dir;
  if (Math.hypot(dx, dz) < 1) { dx = 1; dz = 0; }
  const rotY = Math.atan2(-dz, dx);
  const FLOOR_TOP = 1.9; // 床スラブ上面
  for (const y of [yB1, yB2]) {
    if (opts.skipLower && y === yB2) continue;
    if (opts.skipUpper && y === yB1) continue;
    const m = type === 'esc' ? makeEscalator(y === yB1 ? 'B1' : 'B2', padMats.esc) : new THREE.Mesh(stairsGeo, padMats.stairs);
    m.rotation.y = rotY;
    m.position.set(x, y + FLOOR_TOP, z);
    vertGroup.add(m);
  }
  return beam;
}

for (const v of VERTICALS) {
  // 接続先が駅(ホーム=改札内・フロア未描画)の設備は、B2側のアイコンだけ省略する。
  // EVシャフトはフロアを貫く柱なので常に描画(以前は丸ごとスキップしていてEVが1本も出ていなかった)
  const bIsStation = nodeById[v.b].type === 'station';

  const [x, z] = M2W([v.mx, v.my]);
  // この設備が実際につなぐ2フロアの上段/下段の高さ。三番街ESCは浅層↔中枢層などB1↔B2以外も通す。
  // 変数名yB1/yB2は「上段/下段スロット」の意（ESC形状B1=下り/B2=上りもこのスロットに対応）。全層66間隔なので梁高は共通。
  const yB1 = Math.max(FLOOR_Y[nodeById[v.a].floor], FLOOR_Y[nodeById[v.b].floor]);
  const yB2 = Math.min(FLOOR_Y[nodeById[v.a].floor], FLOOR_Y[nodeById[v.b].floor]);
  // ※設備と通路をつなぐ「接続枝」は廃止(床の上の謎の板に見えてノイズだったため)

  // B2側: 駅ノードから設備の足元までの改札内コンコース通路
  if (SHOW_STATION_INTERIOR) {
    const pb = posOf(nodeById[v.b]);
    const len = Math.hypot(pb.x - x, pb.z - z);
    if (len > 6) {
      const stub = new THREE.Mesh(new THREE.BoxGeometry(len + 5, 2.6, 7), concourseMat);
      stub.position.set((pb.x + x) / 2, yB2, (pb.z + z) / 2);
      stub.quaternion.setFromUnitVectors(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(pb.x - x, 0, pb.z - z).normalize()
      );
      floorGroups.B2.add(stub);
    }
  }

  // 実際の進行方向: 下フロアのノード(b)から上フロアのノード(a)へ向かう水平ベクトルを「上り」とみなす
  const pa = nodeById[v.a], pb = nodeById[v.b];
  let dx = pa.x - pb.x, dz = pa.z - pb.z;
  if (Math.hypot(dx, dz) < 3) { dx = pa.x - x; dz = pa.z - z; }
  drawVertical(v.type, x, z, yB2, yB1, [dx, dz], { skipLower: bIsStation });
}



// --- B2: 路線・駅ホーム・改札内コンコース（見やすさのため一旦非表示。trueで復活） ---
const SHOW_STATION_INTERIOR = false;
if (SHOW_STATION_INTERIOR) for (const line of RAIL_LINES) {
  const mat = new THREE.MeshStandardMaterial({
    color: line.color, emissive: line.color, emissiveIntensity: 0.35,
    transparent: true, opacity: 0.85, roughness: 0.5,
  });
  neutralMats.push(mat);
  const world = line.pts.map(p => M2W(p));
  const railY = FLOOR_Y.B2 - 2.2 + (line.dy || 0);
  for (let i = 0; i < world.length - 1; i++) {
    const [ax, az] = world[i], [bx, bz] = world[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const seg = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 1.4, 4), mat);
    seg.position.set((ax + bx) / 2, railY, (az + bz) / 2);
    seg.quaternion.setFromUnitVectors(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(bx - ax, 0, bz - az).normalize()
    );
    floorGroups.B2.add(seg);
  }
  // 行き先ラベル（方面表示）
  line.ends.forEach((text, i) => {
    if (!text) return;
    const [x, z] = world[i === 0 ? 0 : world.length - 1];
    const div = document.createElement('div');
    div.className = 'rail-label';
    div.style.color = '#' + line.color.toString(16).padStart(6, '0');
    div.textContent = `${line.name} ${text}`;
    const lab = new CSS2DObject(div);
    lab.position.set(x, FLOOR_Y.B2 + (line.dy || 0), z);
    floorGroups.B2.add(lab);
    floorLabelObjs.B2.push(lab);
  });
}

const platformMat = new THREE.MeshStandardMaterial({ color: 0x2c3d5a, emissive: 0x0c1524, roughness: 0.7 });
neutralMats.push(platformMat);
if (SHOW_STATION_INTERIOR) for (const pf of PLATFORMS) {
  const [x, z] = M2W([pf.mx, pf.my]);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(pf.len, 2.6, pf.w), platformMat);
  slab.position.set(x, FLOOR_Y.B2 - 0.6 + (pf.dy || 0), z);
  slab.quaternion.setFromUnitVectors(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(pf.dir[0], 0, pf.dir[1]).normalize()
  );
  floorGroups.B2.add(slab);
}

const plazaMat = new THREE.MeshStandardMaterial({ color: 0x46608a, emissive: 0x101c2e, roughness: 0.55 });
neutralMats.push(plazaMat);
for (const pl of PLAZAS) {
  const [x, z] = M2W([pl.mx, pl.my]);
  const geo = pl.kind === 'disc'
    ? new THREE.CylinderGeometry(pl.r, pl.r, 3.4, 36)
    : new THREE.BoxGeometry(pl.w, 3.4, pl.d);
  const mesh = new THREE.Mesh(geo, zoneMats[pl.zone] || plazaMat);
  // 円盤の上面を床上面(+1.5)のわずかに上に置く(見た目は同一面・Zファイトなし)
  mesh.position.set(x, FLOOR_Y[pl.floor] - 0.08, z);
  floorGroups[pl.floor].add(mesh);
}

// スポット（クリック対象）・ジャンクション・店舗
const nodeMeshes = [];
window.__dbg.nodeMeshes = nodeMeshes; window.__dbg.floorGroups = floorGroups; // 開発用: タップ判定の再現に使う
const labelDivs = {};
const spotZoneEntries = []; // 施設フィルタで減光する対象（駅は常に表示）
const shopLabels = {};      // 店舗ラベルは選択・ルート表示時のみ見せる
const shopMeshes = [];      // 店舗ドットの一括表示切替用
const shopMeshById = {};    // ルート経由店舗のハイライト用
// 店舗は低く平たいマットなドット（発光する設備アイコンと質感で区別）
const shopGeo = new THREE.CylinderGeometry(1.9, 1.9, 1.2, 8);
const shopGeoSmall = new THREE.CylinderGeometry(1.25, 1.25, 1.2, 8); // ホール内の高密度エリア用
const shopMats = {};
for (const [id, z] of Object.entries(ZONES)) {
  shopMats[id] = new THREE.MeshStandardMaterial({
    color: z.color, emissive: new THREE.Color(z.color).multiplyScalar(0.12),
    roughness: 0.6,
  });
}
const shopMatDefault = new THREE.MeshStandardMaterial({
  color: 0xffa8cd, emissive: 0x552038, roughness: 0.4,
});
neutralMats.push(shopMatDefault);

for (const n of NODES) {
  // 交差点の円盤は透過減光時のチラつき原因になるため描画しない（通路の延長で交差部は埋まる）
  if (n.type === 'junction') continue;
  if (n.type === 'shop') {
    if (n.noDot) continue; // 館単位集約(merged): 個別ドットなし。検索・ルート案内・案内文の店名アンカーはそのまま
    const mesh = new THREE.Mesh(n.small ? shopGeoSmall : shopGeo, shopMats[n.zone] || shopMatDefault);
    mesh.position.copy(posOf(n)).add(new THREE.Vector3(0, 1.7, 0));
    mesh.userData.nodeId = n.id;
    floorGroups[n.floor].add(mesh);
    nodeMeshes.push(mesh);
    shopMeshes.push(mesh);
    shopMeshById[n.id] = mesh;
    continue;
  }
  const isStation = n.type === 'station';
  const geo = new THREE.CylinderGeometry(isStation ? 12 : 9, isStation ? 12 : 9, 6, 28);
  const mat = new THREE.MeshStandardMaterial({
    color: isStation ? 0xffb830 : 0x3fd0ff,
    emissive: isStation ? 0x4a3005 : 0x0a3346,
    roughness: 0.4,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(posOf(n)).add(new THREE.Vector3(0, 2, 0));
  mesh.userData.nodeId = n.id;
  mesh.visible = false; // 駅・地下街の丸マーカーは非表示（クリック判定とラベル位置決めにのみ使用）
  floorGroups[n.floor].add(mesh);
  nodeMeshes.push(mesh);

  if (!isStation) spotZoneEntries.push({ mat, zone: n.zone });
}

// merged エリアの代表ドット: 館ごとに1点(個別店ドットの代わり)
// 床と同色だと沈むので、明るめの発光で「店群がここにある」ことを示す
// タップの意味は施設によって変える:
//   詳細地図がある施設(ホワイティ) → 詳細地図への入口。店を選ぶのは詳細地図の管轄なので広域では端点にしない
//   それ以外(三番街・イーマ)       → 従来どおり館ノードを選択(詳細地図が無いため広域で選べる必要がある)
const mergedDotGeo = new THREE.CylinderGeometry(4.6, 4.6, 1.6, 12);
const mergedDotMats = {};
for (const md of MERGED_DOTS) {
  const [x, z] = M2W([md.mx, md.my]);
  const zc = ZONES[md.zone] ? ZONES[md.zone].color : 0xffa8cd;
  mergedDotMats[md.zone] ||= new THREE.MeshStandardMaterial({
    color: new THREE.Color(zc).lerp(new THREE.Color(0xffffff), 0.45),
    emissive: new THREE.Color(zc).multiplyScalar(0.5), roughness: 0.35,
  });
  const mesh = new THREE.Mesh(mergedDotGeo, mergedDotMats[md.zone]);
  mesh.position.set(x, FLOOR_Y[md.floor] + 1.7, z);
  const detailKey = detailKeyOfArea(md.area, md.zone);
  if (detailKey) {
    mesh.userData.zone = md.zone; mesh.userData.floor = md.floor; mesh.userData.detailKey = detailKey; // 床タップと同じ扱い(=その館×階の詳細地図へ)。館ノードは名前を持たない通路の交差点なので端点にしない
  } else {
    mesh.userData.nodeId = md.near; // タップ=館ノードを選択
    nodeMeshes.push(mesh);
  }
  floorGroups[md.floor].add(mesh);
  shopMeshes.push(mesh); // 「詳細」トグルでは店ドット扱いで一緒に隠す
}

// 詳細地図(ガイド座標系)の専用グループ。施設ごとに1つ、広域とは独立し、その施設の詳細モード中だけ表示する
for (const [zone, M] of Object.entries(DETAIL_MAPS)) {
  const D = DETAIL[zone];
  const W = g => g2w(zone, g);
  const detailGroup = new THREE.Group();
  detailGroup.visible = false;
  scene.add(detailGroup);
  D.group = detailGroup;

  // 床(通路含む): フロアガイドそのままの外形
  for (const f of M.FLOOR) {
    const shape = new THREE.Shape();
    f.pts.forEach(([gx, gy], i) => {
      const [x, z] = W([gx, gy]);
      if (i === 0) shape.moveTo(x, -z); else shape.lineTo(x, -z);
      if (i % 4 === 0) D.anchors.push(x, z); // パン制限の基準点(外形を間引いて採る)
    });
    for (const h of f.holes || []) {
      const path = new THREE.Path();
      h.forEach(([gx, gy], i) => {
        const [x, z] = W([gx, gy]);
        if (i === 0) path.moveTo(x, -z); else path.lineTo(x, -z);
      });
      shape.holes.push(path);
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: false });
    const mesh = new THREE.Mesh(geo, zoneMats[M.zone || zone] || corridorMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = D.y - 1.5; // その館×階の高さ(三番街B1Fは浅層)
    detailGroup.add(mesh);
  }

  // テナント区画: 店が特定できた区画は施設色で光らせ、それ以外は暗い灰青
  const zc = ZONES[M.zone || zone].color;
  const occMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(zc).lerp(new THREE.Color(0xffffff), 0.5),
    emissive: new THREE.Color(zc).multiplyScalar(0.35), roughness: 0.5, side: THREE.DoubleSide,
  });
  const vacMat = new THREE.MeshStandardMaterial({ color: 0x3a4258, roughness: 0.85, side: THREE.DoubleSide });
  const inPoly = (gx, gy, pts) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > gy) !== (yj > gy) && gx < (xj - xi) * (gy - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  // 各区画にガイド上の店を割り当てる(区画内 → だめなら重心4m以内の最寄り)
  const shopsReal = NODES.filter(n => detailKeyOfShop(n) === zone && M.REAL_POS[n.name]);
  D.shopIds = shopsReal.map(n => n.id);
  const blockShops = M.BLOCKS.map(() => []);
  const centroid = b => {
    let cx = 0, cy = 0;
    for (const [x, y] of b.g) { cx += x; cy += y; }
    return [cx / b.g.length, cy / b.g.length];
  };
  for (const n of shopsReal) {
    const [sgx, sgy] = M.REAL_POS[n.name]; // ガイド上の店位置(番号の位置なので誤差なし)
    let bi = M.BLOCKS.findIndex(b => inPoly(sgx, sgy, b.g));
    if (bi < 0) {
      let best = 4;
      M.BLOCKS.forEach((b, i) => {
        const [cx, cy] = centroid(b);
        const d = Math.hypot(cx - sgx, cy - sgy);
        if (d < best) { best = d; bi = i; }
      });
    }
    if (bi >= 0) blockShops[bi].push(n);
  }
  M.BLOCKS.forEach((b, i) => {
    const shape = new THREE.Shape();
    b.g.forEach(([gx, gy], k) => {
      const [x, z] = W([gx, gy]);
      if (k === 0) shape.moveTo(x, -z); else shape.lineTo(x, -z);
    });
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.5, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2); // 押し出しを上向きに(座標はワールド値のまま)
    const occ = blockShops[i].length > 0;
    const mesh = new THREE.Mesh(geo, occ ? occMat : vacMat);
    mesh.position.y = D.y + 1.5; // 床スラブの上に乗せる
    const [cgx, cgy] = centroid(b);
    mesh.userData.center = W([cgx, cgy]); // ラベルの置き場所(区画の重心)
    D.anchors.push(mesh.userData.center[0], mesh.userData.center[1]);
    if (occ) { mesh.userData.nodeId = blockShops[i][0].id; nodeMeshes.push(mesh); }
    detailGroup.add(mesh);
    for (const n of blockShops[i]) D.blockByShop[n.id] = mesh;
  });
}

// 詳細地図内の経路探索: 歩行可能グリッド(床−区画、tools/gen_detail_*.py 生成)上のA*。
// ガイドの通路だけを通るので、ガイド内の案内は原理的に間違えない。施設ごとにグリッドが違うので工場関数
function makeDetailNav(WALK) {
  const { x0, y0, cell, w, h, bits } = WALK;
  const bin = atob(bits);
  const walkAt = k => (bin.charCodeAt(k >> 3) >> (k & 7)) & 1;
  const at = (i, j) => i >= 0 && j >= 0 && i < w && j < h && !!walkAt(j * w + i);
  const toCell = g => [Math.floor((g[0] - x0) / cell), Math.floor((g[1] - y0) / cell)];
  const toG = c => [x0 + (c[0] + 0.5) * cell, y0 + (c[1] + 0.5) * cell];
  function nearest(i, j) { // 店の点は区画の中にあるため、最寄りの通路セルへ寄せる
    if (at(i, j)) return [i, j];
    for (let r = 1; r < 40; r++) {
      let best = null, bd = Infinity;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !at(i + di, j + dj)) continue;
        const d = di * di + dj * dj;
        if (d < bd) { bd = d; best = [i + di, j + dj]; }
      }
      if (best) return best;
    }
    return null;
  }
  const los = (a, b) => { // セル間の見通し(通路から出ずに直線で結べるか)
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.4) || 1;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (!at(Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t))) return false;
    }
    return true;
  };
  return function findPath(gA, gB) { // ガイド座標→ガイド座標の折れ線(なければnull)
    const s = nearest(...toCell(gA)), g = nearest(...toCell(gB));
    if (!s || !g) return null;
    const key = c => c[1] * w + c[0];
    const open = [[Math.hypot(s[0] - g[0], s[1] - g[1]), s[0], s[1]]];
    const gcost = new Map([[key(s), 0]]);
    const came = new Map();
    const closed = new Set();
    let found = false;
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
      const [, ci, cj] = open.splice(bi, 1)[0];
      const ck = cj * w + ci;
      if (closed.has(ck)) continue;
      closed.add(ck);
      if (ci === g[0] && cj === g[1]) { found = true; break; }
      const base = gcost.get(ck);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (!at(ni, nj)) continue;
        if (di && dj && (!at(ci, nj) || !at(ni, cj))) continue; // 角を斜めにすり抜けない
        const nk = nj * w + ni;
        const nc = base + Math.hypot(di, dj);
        if (nc < (gcost.get(nk) ?? Infinity)) {
          gcost.set(nk, nc);
          came.set(nk, ck);
          open.push([nc + Math.hypot(ni - g[0], nj - g[1]), ni, nj]);
        }
      }
    }
    if (!found) return null;
    const cells = [];
    let cur = g[1] * w + g[0];
    while (cur !== undefined) { cells.push([cur % w, Math.floor(cur / w)]); cur = came.get(cur); }
    cells.reverse();
    // 見通し直線化(グリッドのギザギザを取る)
    const out = [cells[0]];
    let a = 0;
    while (a < cells.length - 1) {
      let b = cells.length - 1;
      while (b > a + 1 && !los(cells[a], cells[b])) b--;
      out.push(cells[b]);
      a = b;
    }
    return out.map(toG);
  };
}
for (const [zone, M] of Object.entries(DETAIL_MAPS)) DETAIL[zone].nav = makeDetailNav(M.WALK);

// 詳細地図上のルート描画(白いチューブ+出発・ゴール)
let detailRouteGroup = null, detailRouteZone = null;
function clearDetailRoute() {
  if (detailRouteGroup) { DETAIL[detailRouteZone].group.remove(detailRouteGroup); detailRouteGroup = null; detailRouteZone = null; }
}
// 店のガイド上の位置: 名前一致した店は正確な位置、それ以外は所属モール区分の代表点(エリアまで案内)。
// 詳細地図を持つ施設の店だけ通す。戻り値は { zone, pos }
function guidePosOf(n) {
  const key = detailKeyOfShop(n);
  const M = key && DETAIL_MAPS[key];
  if (!M) return null;
  const pos = M.REAL_POS[n.name] || M.AREA_ANCHORS[n.area] || null;
  return pos ? { zone: key, pos } : null;
}
// 両端が同じ施設の詳細地図に載る店ならガイド内経路を描き、その施設IDを返す(なければ null)
function drawDetailRoute(startId, goalId) {
  clearDetailRoute();
  const a = guidePosOf(nodeById[startId]), b = guidePosOf(nodeById[goalId]);
  if (!a || !b || a.zone !== b.zone) return null;
  const zone = a.zone;
  const gpath = DETAIL[zone].nav(a.pos, b.pos);
  if (!gpath) return null;
  const y0 = DETAIL[zone].y;
  const pts = [a.pos, ...gpath, b.pos].map(g => {
    const [x, z] = g2w(zone, g);
    return new THREE.Vector3(x, y0 + 6, z);
  });
  detailRouteGroup = new THREE.Group();
  detailRouteZone = zone;
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
  // 詳細地図は数十mの施設をカメラが近くから見るので、広域用の太さ・大きさ(通路幅より大きい人型や輪)だとつぶれる。
  // 線は幅約1m、人と旗は広域の1/3にする(ガイド座標は 1 world = 2m で広域と同じ縮尺)
  detailRouteGroup.add(new THREE.Mesh(
    new THREE.TubeGeometry(curve, 140, 0.45, 8, false),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdddddd, emissiveIntensity: 1.3 })
  ));
  const base = v => new THREE.Vector3(v.x, y0, v.z);
  const DETAIL_MARK_SCALE = 0.33;
  const person = makeStartPerson(base(pts[0])); person.scale.setScalar(DETAIL_MARK_SCALE);
  const flag = makeGoalFlag(base(pts[pts.length - 1])); flag.scale.setScalar(DETAIL_MARK_SCALE);
  detailRouteGroup.add(person);
  detailRouteGroup.add(flag);
  DETAIL[zone].group.add(detailRouteGroup);
  return zone;
}

// ---------------------------------------------------------------------------
// 経路探索（ダイクストラ）
// ---------------------------------------------------------------------------
const adj = {};
for (const n of NODES) adj[n.id] = [];
for (const [ia, ib] of EDGES) {
  const w = posOf(nodeById[ia]).distanceTo(posOf(nodeById[ib])) * UNIT_M;
  adj[ia].push({ to: ib, w });
  adj[ib].push({ to: ia, w });
}
// ホール内部の通路格子（描画されないが歩ける）
for (const [ia, ib] of HALL_EDGES) {
  const w = posOf(nodeById[ia]).distanceTo(posOf(nodeById[ib])) * UNIT_M;
  adj[ia].push({ to: ib, w });
  adj[ib].push({ to: ia, w });
}
// フロア間設備。同じ2ノード間に複数ある場合は経路上は最安のみ有効
const pairKey = (a, b) => [a, b].sort().join('|');
// 通路→施設ゾーンの対応（案内で「いまどの施設にいるか」を伝えるため）
const edgeZoneByPair = {};
for (const [a, b, , z] of EDGES) if (z) edgeZoneByPair[pairKey(a, b)] = z;
for (const [a, b, z] of HALL_EDGES) if (z) edgeZoneByPair[pairKey(a, b)] = z;
const vertTypeByPair = {}; // 経路案内で使う種別（最安コストの設備）
const vertPosByPair = {};  // ルートの線を実際の設備位置経由で描くため
const vertNameByPair = {}; // 写真の対応付け用('v:' + name)
const pairHasEv = new Set();
const vertCostByPair = {};
for (const v of VERTICALS) {
  const key = pairKey(v.a, v.b);
  // 階差の視覚的な誇張が距離に乗らないよう水平距離のみで計算
  const na = nodeById[v.a], nb = nodeById[v.b];
  const w = Math.hypot(na.x - nb.x, na.z - nb.z) * UNIT_M + VERT_COST[v.type];
  if (v.type === 'ev') pairHasEv.add(key);
  if (!(key in vertCostByPair) || w < vertCostByPair[key]) {
    vertCostByPair[key] = w;
    vertTypeByPair[key] = v.type;
    vertNameByPair[key] = v.name;
    const [vx, vz] = M2W([v.mx, v.my]);
    vertPosByPair[key] = { x: vx, z: vz };
  }
}
for (const key of Object.keys(vertCostByPair)) {
  const [a, b] = key.split('|');
  adj[a].push({ to: b, w: vertCostByPair[key] });
  adj[b].push({ to: a, w: vertCostByPair[key] });
}
// 店舗 → 最寄り通路ノードへの接続（+10mは店先から通路までのロス）
for (const n of NODES) {
  if (n.type !== 'shop') continue;
  let best = null, bd = Infinity;
  for (const nid of n.near) {
    const m = nodeById[nid];
    const d = Math.hypot(n.x - m.x, n.z - m.z);
    if (d < bd) { bd = d; best = nid; }
  }
  const w = bd * UNIT_M + 10;
  adj[n.id].push({ to: best, w });
  adj[best].push({ to: n.id, w });
}

function dijkstra(start, goal) {
  const dist = {}, prev = {}, visited = new Set();
  for (const n of NODES) dist[n.id] = Infinity;
  dist[start] = 0;
  while (true) {
    let u = null, best = Infinity;
    for (const id in dist) if (!visited.has(id) && dist[id] < best) { best = dist[id]; u = id; }
    if (u === null || u === goal) break;
    visited.add(u);
    for (const { to, w } of adj[u]) {
      if (dist[u] + w < dist[to]) { dist[to] = dist[u] + w; prev[to] = u; }
    }
  }
  if (dist[goal] === Infinity) return null;
  const path = [goal];
  while (path[0] !== start) path.unshift(prev[path[0]]);
  return { path, total: dist[goal] };
}

// ---------------------------------------------------------------------------
// ルート表示
// ---------------------------------------------------------------------------
let routeGroup = new THREE.Group();
scene.add(routeGroup);
let routeCurve = null;
let markers = []; // ルート上を等間隔で流れる進行方向インジケータ(白球×4)
let startIcon = null;
let camAnim = null; // ルート実行時のカメラ移動アニメーション({ hard: true } は途中で止められない移動)
// 進行中のカメラ移動を最終地点で即座に完了させる(中断できない移動を打ち切る代わりに使う)
function finishCamAnim() {
  if (!camAnim) return;
  camera.position.copy(camAnim.toPos);
  controls.target.copy(camAnim.toTgt);
  const done = camAnim.onDone;
  camAnim = null;
  done?.();
}
// 案内文タップ → 赤い人がその地点までルート沿いに歩くアニメーション
let routeStepUs = [];  // 案内行ごとのカーブ上パラメータu(0〜1)
let walkU = 0;         // 赤い人の現在位置(u)
let walkAnim = null;   // { from, to, start, dur }

// 出発地が手前・ゴールが奥になる視点へ、ルート全体が収まる距離で移動
function flyCameraToRoute(startId, goalId, pathIds) {
  const s = posOf(nodeById[startId]), g = posOf(nodeById[goalId]);
  const box = new THREE.Box3();
  for (const id of pathIds) box.expandByPoint(posOf(nodeById[id]));
  const center = box.getCenter(new THREE.Vector3());
  const r = Math.max(60, box.getBoundingSphere(new THREE.Sphere()).radius);
  const dir = new THREE.Vector3(g.x - s.x, 0, g.z - s.z);
  if (dir.lengthSq() < 1) dir.set(0, 0, -1);
  else dir.normalize();
  // 縦画面は水平視野が狭いので、ルートの横幅が収まる距離まで引く（fov=50°の半角tan≈0.466）
  const aspect = innerWidth / innerHeight;
  let dist = r * 1.9;
  if (aspect < 1.2) dist = Math.min(r * 5.0, (r * 1.9 * 1.2) / aspect);
  const toPos = new THREE.Vector3(center.x - dir.x * dist, center.y + dist * 0.85, center.z - dir.z * dist);
  const toTgt = center.clone();
  // スマホの「上半分中央への寄せ」はカメラのviewOffset(投影中心のずらし)側で行う
  camAnim = {
    fromPos: camera.position.clone(),
    toPos,
    fromTgt: controls.target.clone(),
    toTgt,
    start: performance.now(),
  };
}

// ルート経由店舗のハイライト（ドットを施設色に光らせ拡大＋施設色の店名ラベル表示）
// ラベルの背景＝施設カラーにすることで、地図の通路色と対応づけて位置を掴めるようにする
const routeShopMats = {}; // ゾーンごとの強発光マテリアル
function routeShopMatFor(zoneId) {
  if (!routeShopMats[zoneId]) {
    const z = ZONES[zoneId];
    const c = z ? z.color : 0xffffff;
    routeShopMats[zoneId] = new THREE.MeshStandardMaterial({
      color: c, emissive: c, emissiveIntensity: 0.9, roughness: 0.3,
    });
  }
  return routeShopMats[zoneId];
}
let routeShopDecor = []; // { mesh, mat, label }
function decorateRouteShops(shopIds) {
  for (const id of shopIds) {
    // 詳細モード中は丸ドットではなく店の区画そのものを光らせる
    const block = detailMode ? DETAIL[detailMode].blockByShop[id] : null;
    const mesh = block || shopMeshById[id];
    if (!mesh) continue;
    mesh.visible = true; // 広域で店ドット非表示でも、ルートの目印店だけは見せる
    const orig = mesh.material;
    const zone = ZONES[nodeById[id].zone];
    mesh.material = routeShopMatFor(nodeById[id].zone);
    if (!block) mesh.scale.set(1.7, 2.2, 1.7); // 区画はワールド座標焼き込みのため拡縮しない
    const div = document.createElement('div');
    div.className = 'node-label route-shop';
    div.textContent = shortShopName(nodeById[id].name);
    if (zone) {
      // 背景は施設色を少し沈めた色、枠は施設色そのまま。いずれも透明度30%(装飾を控えめに)
      const hex = new THREE.Color(zone.color).multiplyScalar(0.62).getHexString();
      const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
      const c = zone.color;
      div.style.setProperty('--zone-bg', `rgba(${r}, ${g}, ${b}, 0.3)`);
      div.style.setProperty('--zone-border', `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, 0.3)`);
    }
    const label = new CSS2DObject(div);
    if (block) label.position.set(block.userData.center[0], 6, block.userData.center[1]);
    else label.position.set(0, 6, 0);
    mesh.add(label);
    routeShopDecor.push({ mesh, mat: orig, label, isBlock: !!block });
  }
  syncRouteShopLabels();
}
// ルート経由店のラベルは広域用(店ドット)と詳細用(区画)の2種類ある。CSS2Dは親グループの
// visible に連動しないため、いまいる層のものだけを出す(広域のラベルが詳細地図に残るのを防ぐ)
function syncRouteShopLabels() {
  for (const d of routeShopDecor) d.label.visible = (d.isBlock === !!detailMode);
}
function clearRouteShops() {
  for (const d of routeShopDecor) {
    d.mesh.material = d.mat;
    d.mesh.visible = d.isBlock ? true : detailShown; // 区画は詳細地図の一部で常時可視(detailGroup側で出し分ける)
    if (!d.isBlock) d.mesh.scale.set(1, 1, 1);
    d.mesh.remove(d.label);
    d.label.element.remove();
  }
  routeShopDecor = [];
}

// ゴール旗用のチェッカー柄テクスチャ
const checkerTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
    g.fillStyle = (cx + cy) % 2 ? '#101010' : '#ffffff';
    g.fillRect(cx * 4, cy * 4, 4, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  return t;
})();

// 出発地: 「現在地」マーカー（大きめの赤い人型＋パルスリング＋光のビーコン柱）
function makeStartPerson(pos) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xff4545, emissive: 0xaa1515, roughness: 0.3 });

  const person = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(3.2, 7.5, 4, 14), mat);
  body.position.y = 12;
  const head = new THREE.Mesh(new THREE.SphereGeometry(3.8, 16, 14), mat);
  head.position.y = 22;
  person.add(body, head);
  g.add(person);

  // 上空へ伸びる光のビーコン（ズームアウトしても位置が分かる）
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.6, 64, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff6060, transparent: true, opacity: 0.18, depthWrite: false })
  );
  beacon.position.y = 34;
  g.add(beacon);

  // 足元のパルスリング×2（現在地の波紋）
  const rings = [];
  for (let i = 0; i < 2; i++) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(5, 6.4, 36),
      new THREE.MeshBasicMaterial({ color: 0xff5555, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.6;
    g.add(ring);
    rings.push(ring);
  }
  g.userData.anim = { person, rings };
  g.position.copy(pos).add(new THREE.Vector3(0, 3.5, 0));
  return g;
}

// 目的地: チェッカーフラッグ
function makeGoalFlag(pos) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 20, 8),
    new THREE.MeshStandardMaterial({ color: 0xe8e8e8, emissive: 0x333333, roughness: 0.4 })
  );
  pole.position.y = 10;
  const flag = new THREE.Mesh(new THREE.BoxGeometry(8.5, 5.5, 0.4), new THREE.MeshBasicMaterial({ map: checkerTex }));
  flag.position.set(4.6, 17, 0);
  g.add(pole, flag);
  g.position.copy(pos).add(new THREE.Vector3(0, 3.5, 0));
  return g;
}

// 経路の途中で「前を通る店」を拾う（道が合っているかの確認用ランドマーク）
const shopNodesByFloor = { S1: [], B1: [], B2: [] };
for (const n of NODES) if (n.type === 'shop') shopNodesByFloor[n.floor].push(n);

// 「〜 ホワイティうめだ店」のような支店サフィックスだけを削る（「上島珈琲店」のような屋号の「店」は残す）
const shortShopName = name => name
  .replace(/（[^）]*）/g, '')
  .replace(/[ 　]+(ホワイティうめだ|阪急三番街|三番街|ディアモール大阪|ディアモール|ルクア大阪|梅田地下|FARURU|プチシャン|イーストモール|泉の広場)(ショップ|店)?$/, '')
  .trim();

function shopsAlongLeg(segs, excludeIds, usedIds) {
  const found = [];
  let base = 0;
  for (const [a, b] of segs) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    if (!len2) continue;
    const len = Math.sqrt(len2);
    for (const s of shopNodesByFloor[a.floor] || []) {
      if (excludeIds.has(s.id) || (usedIds && usedIds.has(s.id))) continue;
      const t = ((s.x - a.x) * dx + (s.z - a.z) * dz) / len2;
      if (t < 0 || t > 1) continue;
      const d = Math.hypot(s.x - (a.x + dx * t), s.z - (a.z + dz * t));
      if (d < 10) found.push({ s, along: base + t * len });
    }
    base += len;
  }
  found.sort((p, q) => p.along - q.along);
  const seen = new Set(), list = [];
  for (const f of found) {
    if (seen.has(f.s.id)) continue;
    seen.add(f.s.id);
    list.push(f.s);
  }
  // 多すぎる場合は序盤・中間・終盤の3店に間引く
  const picks = list.length > 3
    ? [list[0], list[Math.floor(list.length / 2)], list[list.length - 1]]
    : list;
  if (usedIds) for (const p of picks) usedIds.add(p.id);
  return picks.map(s => shortShopName(s.name));
}

function clearRoute() {
  scene.remove(routeGroup);
  routeGroup = new THREE.Group();
  scene.add(routeGroup);
  routeCurve = null;
  markers = [];
  startIcon = null;
  clearRouteShops();
  if (typeof resetZoneFocus === 'function') resetZoneFocus();
  for (const div of Object.values(labelDivs)) div.classList.remove('on-route');
  document.getElementById('route-info').innerHTML = '';
  document.body.classList.remove('route-active'); // スマホ: 入力シートに戻す
  applyViewOffset();
  routeStepUs = [];
  walkU = 0;
  walkAnim = null;
  clearDetailRoute();
  if (bldgAutoHidden) { bldgAutoHidden = false; setBldgShown(true); } // 案内で自動OFFにしたビルを戻す
}

function showRoute(startId, goalId) {
  clearRoute();
  const result = dijkstra(startId, goalId);
  if (!result) return;
  // 案内中は地上ビルを自動で消し、地下のルートに集中させる(解除時に復帰)
  if (bldgShown) { setBldgShown(false); bldgAutoHidden = true; }
  const { path, total } = result;

  // フロアが変わる箇所は実際のEV・ESC位置を経由させて縦移動を描く
  const pts = [];
  for (let i = 0; i < path.length; i++) {
    const n = nodeById[path[i]];
    if (i > 0) {
      const prevN = nodeById[path[i - 1]];
      if (prevN.floor !== n.floor) {
        const vp = vertPosByPair[pairKey(prevN.id, n.id)];
        if (vp) {
          pts.push(new THREE.Vector3(vp.x, FLOOR_Y[prevN.floor] + 7, vp.z));
          pts.push(new THREE.Vector3(vp.x, FLOOR_Y[n.floor] + 7, vp.z));
        }
      }
    }
    pts.push(posOf(n).clone().add(new THREE.Vector3(0, 7, 0)));
  }
  routeCurve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);

  // 太く明るいルート線（不透明・高発光で埋もれないように）
  // ルート線は白（施設色のどれとも被らない）
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(routeCurve, 160, 1.7, 10, false),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdddddd, emissiveIntensity: 1.3 })
  );
  routeGroup.add(tube);

  // 進行方向インジケータ: 小さな白球を等間隔に流し、どこから見ても向きが分かるように。
  // 個数はルート距離に連動(100mに1個・2〜12個)し、短いルートで密集しないようにする
  markers = [];
  const markerCount = Math.max(2, Math.min(12, Math.round(total / 100)));
  const markerGeo = new THREE.SphereGeometry(3, 14, 14);
  const markerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.6 });
  for (let i = 0; i < markerCount; i++) {
    const m = new THREE.Mesh(markerGeo, markerMat);
    routeGroup.add(m);
    markers.push(m);
  }

  startIcon = makeStartPerson(posOf(nodeById[startId]));
  routeGroup.add(startIcon);
  routeGroup.add(makeGoalFlag(posOf(nodeById[goalId])));

  // 案内テキスト: 「目の前に見える店」を主役に組み立てる
  // 迷子の人は自分がどの施設にいるか分からない。確実に見えているのは店だけ。
  const info = document.getElementById('route-info');
  const minutes = Math.max(1, Math.round(total / 80));
  const pathNodes = path.map(id => nodeById[id]);
  const passExclude = new Set([startId, goalId]);

  const nearestLandmarkTo = (x, z, floor, maxD = 12) => {
    let best = null, bd = maxD;
    for (const lm of LANDMARKS) {
      if (lm.floor !== floor) continue;
      const d = Math.hypot(lm.x - x, lm.z - z);
      if (d < bd) { bd = d; best = lm; }
    }
    return best;
  };
  const nearestShopTo = (x, z, floor, maxD = 22) => {
    let best = null, bd = maxD;
    for (const s of shopNodesByFloor[floor] || []) {
      if (passExclude.has(s.id)) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  };
  // 曲がり判定は「4m以内の横ずれ」を無視した折れ線で行う(OSM由来の微小な分岐ループで
  // 数m間隔に左→右→右→左と出るのを防ぐ)。同一フロアの連続区間ごとに Douglas-Peucker で頂点を残す
  const turnKeep = new Set();
  {
    const TOL = 2.0; // world unit(=4m)
    const dp = (lo, hi) => {
      if (hi - lo < 2) return;
      const ax = pathNodes[lo].x, az = pathNodes[lo].z, bx = pathNodes[hi].x, bz = pathNodes[hi].z;
      const L = Math.hypot(bx - ax, bz - az) || 1;
      let best = -1, bd = 0;
      for (let k = lo + 1; k < hi; k++) {
        const d = Math.abs((bx - ax) * (az - pathNodes[k].z) - (ax - pathNodes[k].x) * (bz - az)) / L;
        if (d > bd) { bd = d; best = k; }
      }
      if (best >= 0 && bd > TOL) { turnKeep.add(best); dp(lo, best); dp(best, hi); }
    };
    let runStart = 0;
    for (let i = 1; i <= pathNodes.length; i++) {
      if (i === pathNodes.length || pathNodes[i].floor !== pathNodes[runStart].floor) {
        turnKeep.add(runStart); turnKeep.add(i - 1); dp(runStart, i - 1); runStart = i;
      }
    }
  }
  // i番目のノードでの曲がり方向（±32°未満は直進扱い）。前後は残した頂点同士で見る
  const turnAt = i => {
    if (!turnKeep.has(i)) return null;
    let ia = i - 1; while (ia >= 0 && !turnKeep.has(ia)) ia--;
    let ic = i + 1; while (ic < pathNodes.length && !turnKeep.has(ic)) ic++;
    const a = pathNodes[ia], b = pathNodes[i], c = pathNodes[ic];
    if (!a || !c || a.floor !== b.floor || b.floor !== c.floor) return null;
    const v1x = b.x - a.x, v1z = b.z - a.z, v2x = c.x - b.x, v2z = c.z - b.z;
    if (Math.hypot(v1x, v1z) < 1 || Math.hypot(v2x, v2z) < 1) return null;
    const ang = Math.atan2(v1z * v2x - v1x * v2z, v1x * v2x + v1z * v2z) * 180 / Math.PI;
    if (Math.abs(ang) < 32) return null;
    return ang > 0 ? '左' : '右';
  };

  const steps = [];
  const stepNodes = []; // 各案内行が指す経路上のノード(タップで赤い人を移動させる先)
  const pushStep = (html, node) => { steps.push(html); stepNodes.push(node); };
  const usedShopIds = new Set(); // 一度案内に使った店は再登場させない
  let leg = 0, legSegs = [], curZone = nodeById[startId].zone || null, firstLandmark = null;
  let walked = 0, lastTurn = null; // 直前の曲がりからの距離が短ければ1行にまとめる(「左、すぐ右」)
  const flushLeg = () => {
    const legEnd = legSegs.length ? legSegs[legSegs.length - 1][1] : null;
    // 12m未満の短い区間は通過店を並べない（館内の格子移動などのノイズ防止）
    if (leg >= 12) {
      const passed = shopsAlongLeg(legSegs, passExclude, usedShopIds);
      if (passed.length) {
        if (!firstLandmark && steps.length === 0) firstLandmark = passed[0];
        pushStep(`<div class="step">🏪 ${passed.map(p => `「${p}」`).join(' → ')} の前を通過（約${Math.round(leg)}m）</div>`, legEnd);
      } else if (leg >= 30) {
        pushStep(`<div class="step">→ そのまま約${Math.round(leg)}m直進</div>`, legEnd);
      }
    }
    leg = 0;
    legSegs = [];
  };

  for (let i = 1; i < path.length; i++) {
    const n = pathNodes[i], prevN = pathNodes[i - 1];
    if (prevN.floor === n.floor) {
      // 階の移動区間は歩行距離に含めない（誇張した階差が距離に乗るのを防ぐ）
      const dm = posOf(prevN).distanceTo(posOf(n)) * UNIT_M;
      leg += dm; walked += dm;
      legSegs.push([prevN, n]);
    }
    if (labelDivs[n.id]) labelDivs[n.id].classList.add('on-route');

    // 施設の変わり目 = 「いま自分がどの施設にいるか」を伝える
    const ez = edgeZoneByPair[pairKey(prevN.id, n.id)];
    if (ez && ez !== curZone && !ZONES[ez]?.corridor) { // 通路扱いのゾーンは「ここから」を出さない
      flushLeg();
      pushStep(`<div class="step zone">📍 ここから ${ZONES[ez].name}</div>`, prevN);
      curZone = ez;
    }

    if (prevN.floor !== n.floor) {
      flushLeg();
      const key = pairKey(prevN.id, n.id);
      const type = vertTypeByPair[key] || 'stairs';
      const evNote = type !== 'ev' && pairHasEv.has(key) ? '（EVもあり）' : '';
      const vp = vertPosByPair[key];
      const anchor = vp ? nearestShopTo(vp.x, vp.z, prevN.floor) : null;
      const anchorTxt = anchor ? `「${shortShopName(anchor.name)}」の横の` : '';
      const dirWord = FLOOR_Y[n.floor] < FLOOR_Y[prevN.floor] ? '下りる' : '上がる';
      const vname = vertNameByPair[key];
      pushStep(`<div class="step stairs">${VERT_ICON[type]} ${anchorTxt}${VERT_LABEL[type]}で ${fl(n.floor)}へ${dirWord}${evNote}${photoTag(vname ? 'v:' + vname : (anchor ? anchor.id : ''))}</div>`, n);
      continue;
    }

    const turn = turnAt(i);
    if (turn && lastTurn && walked - lastTurn.at < 15) {
      // 15m以内に続く曲がりは直前の行に足す(「左へ曲がる、すぐ右」)。通路の微小な折れで行が増えるのを防ぐ
      steps[lastTurn.idx] = steps[lastTurn.idx].replace(/<\/div>$/, `、すぐ${turn}</div>`);
      lastTurn.at = walked;
    } else if (turn) {
      const shop = nearestShopTo(n.x, n.z, n.floor);
      if (shop) usedShopIds.add(shop.id); // 曲がり角に使った店は通過リストに再登場させない
      if (shop && !firstLandmark && steps.length === 0 && legSegs.length > 0) {
        firstLandmark = shortShopName(shop.name);
      }
      flushLeg();
      const lm = nearestLandmarkTo(n.x, n.z, n.floor);
      const anchor = lm ? `「${lm.name}」の所で` : shop ? `「${shortShopName(shop.name)}」の前で` :
        (n.type !== 'junction' ? `${n.name}で` : '突き当たり・分岐を');
      pushStep(`<div class="step turn">↪ ${anchor}${turn}へ曲がる${photoTag(lm ? lm.id : shop ? shop.id : n.id)}</div>`, n);
      lastTurn = { idx: steps.length - 1, at: walked };
    } else if (n.type === 'spot' || n.type === 'station') {
      // 曲がらないが、広場や駅など見て分かる目標物は確認情報として出す
      flushLeg();
      pushStep(`<div class="step">→ ${n.name} を通過</div>`, n);
    }
  }
  flushLeg();

  const startN = nodeById[startId];
  const goalN = nodeById[goalId];
  // サマリーの上に現在地・目的地を明示(スマホの案内表示では入力欄が隠れるため特に重要)
  let html = `<div class="od">
    <div class="od-row">🧍 現在地: ${startN.name}（${fl(startN.floor)}）</div>
    <div class="od-row goal">🏁 目的地: ${goalN.name}（${fl(goalN.floor)}）</div>
  </div>`;
  html += `<div class="summary">🚶 約${Math.round(total)}m ・ 徒歩約${minutes}分</div>`;
  // 広域案内: 通る施設の並びを文で提示(通路扱いゾーンは省く)。詳細ステップは「案内を開始」で表示
  {
    const seq = [];
    for (let i = 1; i < path.length; i++) {
      const z = edgeZoneByPair[pairKey(path[i - 1], path[i])];
      if (!z || !ZONES[z] || ZONES[z].corridor) continue;
      if (!seq.length || seq[seq.length - 1] !== z) seq.push(z);
    }
    if (seq[0] === startN.zone) seq.shift();
    if (seq.length && seq[seq.length - 1] === goalN.zone) seq.pop();
    const endpoint = n => {
      const nm = shortShopName(n.name);
      const fac = n.zone && ZONES[n.zone] && !ZONES[n.zone].corridor ? ZONES[n.zone].name : null;
      return fac && !nm.includes(fac) ? `${fac}の${nm}` : nm; // 施設名と同名のスポットは重ねない
    };
    const seqTxt = [endpoint(startN), ...seq.map(z => ZONES[z].name), endpoint(goalN)].join(' → ');
    html += `<div class="route-seq">🗺 ${seqTxt} のルートで向かいます</div>`;
  }
  // 両端がホワイティのガイド上の店なら、ガイド内経路(通路グリッド)を用意しておく
  const hasDetailRoute = drawDetailRoute(startId, goalId);
  routeGroup.visible = !detailMode; // 詳細モード中は広域のルート線を出さない
  html += `<button id="start-guide">案内を開始</button>`;
  const startZoneTxt = startN.zone && ZONES[startN.zone] ? `（いまいる場所: ${ZONES[startN.zone].name} ${fl(startN.floor)}）` : '';
  html += `<div id="route-steps" hidden>`;
  html += `<div class="step">🧍 「${startN.name}」を出発${startZoneTxt}${firstLandmark ? ` — 「${firstLandmark}」が見える方向へ` : ''}</div>`;
  html += steps.join('');
  html += `<div class="step" style="border-left-color:#ff5d8f">🏁 到着：${nodeById[goalId].name}${photoTag(goalId)}</div>`;
  html += `</div>`;
  info.innerHTML = html;
  // 「案内を開始」: ガイド内経路があれば詳細地図に切り替えて経路を見せる。なければ出発地点へ寄る
  info.querySelector('#start-guide').addEventListener('click', () => {
    info.querySelector('#route-steps').hidden = false;
    info.querySelector('#start-guide').style.display = 'none';
    if (hasDetailRoute) { enterDetail(hasDetailRoute); return; }
    const p = posOf(startN);
    camAnim = { fromPos: camera.position.clone(), toPos: new THREE.Vector3(p.x + 30, p.y + 80, p.z + 80),
                fromTgt: controls.target.clone(), toTgt: p.clone(), start: performance.now(), dur: 900 };
  });

  // 各案内行に経路上の位置(カーブ上のu)を割り当てる → タップで赤い人がそこまで歩く
  {
    const anchors = [startN, ...stepNodes, nodeById[goalId]];
    const samples = routeCurve.getPoints(400);
    const uOf = node => {
      if (!node) return null;
      const p = posOf(node).add(new THREE.Vector3(0, 7, 0)); // カーブ点は床+7
      let best = 0, bd = Infinity;
      for (let k = 0; k < samples.length; k++) {
        const d = samples[k].distanceToSquared(p);
        if (d < bd) { bd = d; best = k; }
      }
      return best / (samples.length - 1);
    };
    routeStepUs = anchors.map(uOf);
    walkU = 0;
    walkAnim = null;
    info.querySelectorAll('.step').forEach((el, i) => {
      if (routeStepUs[i] != null) el.dataset.stepI = i;
    });
  }

  // 案内文に登場した店をマップ上でもハイライト
  decorateRouteShops(usedShopIds);

  // スマホ: 入力欄を隠して案内表示に切り替え、シート高の変化を投影中心へ反映
  document.body.classList.add('route-active');
  applyViewOffset();

  // 経路が通る施設だけを強調し、出発地が手前になる視点へ移動。
  // 詳細モード中でガイド内経路があるときはカメラを動かさない(詳細地図で完結)。
  // ガイド外へ出るルートなら広域に戻して見せる
  if (detailMode && hasDetailRoute === detailMode) {
    // 何もしない(いま開いている施設の詳細地図に経路が見えている)
  } else {
    if (detailMode) exitDetail();
    focusZonesForRoute(path);
    flyCameraToRoute(startId, goalId, path);
  }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
// 検索ボックス型ピッカー（数百店舗に対応。店名・別名の部分一致で絞り込み）
const pickerSelection = { start: null, goal: null };
function updateShopLabels() {
  const sel = new Set([pickerSelection.start, pickerSelection.goal]);
  for (const [id, lab] of Object.entries(shopLabels)) lab.visible = sel.has(id);
}
// ピッカーの表示名: 店は「店名（施設名 フロア）」で施設が分かるように。施設名を含む店名には重ねない
function pickerDisp(n) {
  const z = n.zone && ZONES[n.zone];
  const zname = z && !z.corridor && n.type === 'shop' && !n.name.includes(z.name) ? z.name + ' ' : '';
  return `${n.name}（${zname}${fl(n.floor)}）`;
}
function makePicker(rootId) {
  const root = document.getElementById(rootId);
  const valueEl = root.querySelector('.picker-value'); // <input>
  const listEl = root.querySelector('.picker-list');
  let current = null;
  const opts = [];
  const disp = pickerDisp;

  function set(id) {
    current = id;
    pickerSelection[rootId] = id;
    valueEl.value = disp(nodeById[id]);
    for (const o of opts) o.el.classList.toggle('selected', o.id === id);
    updateShopLabels();
  }

  for (const n of NAMED) {
    const el = document.createElement('div');
    el.className = 'opt' + (n.type === 'shop' ? ' shop-opt' : '');
    el.dataset.id = n.id;
    el.textContent = disp(n);
    // 文字色は所属施設のカラーに連動(マップの色分けと同じ対応関係で覚えられる)
    if (n.zone && ZONES[n.zone]) {
      el.style.setProperty('--zone-c', '#' + ZONES[n.zone].color.toString(16).padStart(6, '0'));
    }
    // clickだとinputのblurと競合するためpointerdownで確定
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      set(n.id);
      root.classList.remove('open');
      valueEl.blur(); // スマホ: キーボードを閉じてシートを下段に戻す
      document.body.classList.remove('picker-editing');
    });
    listEl.appendChild(el);
    opts.push({ id: n.id, el, text: (n.name + ' ' + (n.aliases || []).join(' ') + ' ' + (n.zone && ZONES[n.zone] ? ZONES[n.zone].name : '')).toLowerCase() }); // 施設名でも絞り込める
  }

  function filter() {
    const q = valueEl.value.trim().toLowerCase();
    for (const o of opts) o.el.style.display = !q || o.text.includes(q) ? '' : 'none';
  }

  valueEl.addEventListener('focus', () => {
    valueEl.select();
    document.querySelectorAll('.picker.open').forEach(p => { if (p !== root) p.classList.remove('open'); });
    for (const o of opts) o.el.style.display = '';
    root.classList.add('open');
    document.body.classList.add('picker-editing'); // スマホ: 入力中はシートを上段へ
  });
  valueEl.addEventListener('input', () => {
    root.classList.add('open');
    filter();
  });
  valueEl.addEventListener('click', e => e.stopPropagation());
  // フォーカスが完全に外れたときだけ編集モードを解除する
  // (候補タップはpointerdownでpreventDefaultしているためblurは発生しない)
  valueEl.addEventListener('blur', () => {
    setTimeout(() => {
      const ae = document.activeElement;
      if (!(ae && ae.classList && ae.classList.contains('picker-value'))) {
        root.classList.remove('open');
        document.body.classList.remove('picker-editing');
      }
    }, 0);
  });

  return { get value() { return current; }, set value(id) { set(id); } };
}

const startSel = makePicker('start');
const goalSel = makePicker('goal');
// 初期状態は出発地・目的地とも未選択(プレースホルダーの検索例だけ見せる)
document.addEventListener('click', () => {
  // 入力欄にフォーカスが残っている間は閉じない。
  // シート移動(picker-editing)直後は、レイアウト変化で無関係な要素上のclickが発生するため、
  // 「クリック位置」ではなく「フォーカスの有無」で判定するのが安全
  const ae = document.activeElement;
  if (ae && ae.classList && ae.classList.contains('picker-value')) return;
  document.querySelectorAll('.picker.open').forEach(p => p.classList.remove('open'));
  document.body.classList.remove('picker-editing');
  // 手入力のまま確定しなかった場合は選択中の表示に戻す
  for (const [rootId, id] of Object.entries(pickerSelection)) {
    if (!id) continue;
    const input = document.querySelector(`#${rootId} .picker-value`);
    const n = nodeById[id];
    if (input && n) input.value = pickerDisp(n);
  }
});

document.getElementById('navigate').addEventListener('click', () => {
  // 未選択のまま押されたら、該当する入力欄を一瞬赤くして知らせる
  let missing = false;
  for (const [rootId, sel] of [['start', startSel], ['goal', goalSel]]) {
    if (!sel.value) {
      missing = true;
      const input = document.querySelector(`#${rootId} .picker-value`);
      input.classList.add('missing');
      setTimeout(() => input.classList.remove('missing'), 1600);
    }
  }
  if (missing) return;
  if (startSel.value !== goalSel.value) showRoute(startSel.value, goalSel.value);
});
document.getElementById('reset').addEventListener('click', clearRoute);

// 案内文の行をタップ → 赤い人(現在地マーカー)がその地点までルート沿いに歩く
document.getElementById('route-info').addEventListener('click', e => {
  const el = e.target.closest('.step');
  if (!el || el.dataset.stepI === undefined || !routeCurve || !startIcon) return;
  const u = routeStepUs[+el.dataset.stepI];
  if (u == null) return;
  document.querySelectorAll('#route-info .step.active').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
  // 距離に応じた歩行時間(近い行はサッと、遠い行はゆっくり長く)
  const dur = 500 + Math.abs(u - walkU) * 2500;
  walkAnim = { from: walkU, to: u, start: performance.now(), dur };
  // カメラも同じ時間をかけて、到着地点を見やすい距離・角度(斜め45°)でフレーミングする。
  // 水平方向は現在の向きを保つので視点がぐるっと回らない
  const dest = routeCurve.getPointAt(u);
  const dirH = new THREE.Vector3().subVectors(camera.position, controls.target);
  dirH.y = 0;
  if (dirH.lengthSq() < 1) dirH.set(0, 0, 1); else dirH.normalize();
  const D = 175; // 人がランドマークと一緒に見える近さ
  camAnim = {
    fromPos: camera.position.clone(),
    toPos: new THREE.Vector3(dest.x + dirH.x * D, dest.y + D, dest.z + dirH.z * D),
    fromTgt: controls.target.clone(),
    toTgt: dest.clone(),
    start: performance.now(),
    dur,
  };
});

// 施設レイヤー（強調表示フィルタ）
const activeZones = new Set();
function applyZoneFilter() {
  const filtering = activeZones.size > 0;
  // 半透明を使わず色を暗くして減光する（不透明のままなので描画順のチラつきが起きない）
  const setMat = (mat, on, boost) => {
    if (!mat.userData.baseColor) {
      mat.userData.baseColor = mat.color.clone();
      mat.userData.baseEmissive = mat.emissive.clone();
    }
    mat.color.copy(mat.userData.baseColor).multiplyScalar(on ? 1 : 0.1);
    mat.emissive.copy(mat.userData.baseEmissive).multiplyScalar(on ? 1 : 0.05);
    mat.emissiveIntensity = boost && filtering && on ? 2.2 : 1.0;
  };
  for (const [id, mat] of [...Object.entries(zoneMats), ...Object.entries(shopMats)]) {
    setMat(mat, !filtering || activeZones.has(id), true);
  }
  for (const mat of neutralMats) setMat(mat, !filtering);
  for (const e of spotZoneEntries) setMat(e.mat, !filtering || (e.zone && activeZones.has(e.zone)));
  for (const [id, div] of Object.entries(zoneLabelDivs)) {
    div.classList.toggle('dimmed', filtering && !activeZones.has(id));
  }
}
const zoneChipsEl = document.getElementById('zone-chips');
const zoneChipEls = {};
for (const [id, z] of Object.entries(ZONES)) {
  if (z.corridor) continue; // 通路扱いのゾーンは施設レイヤーに出さない
  const chip = document.createElement('div');
  chip.className = 'zchip';
  chip.innerHTML = `<span class="dot" style="background:#${z.color.toString(16).padStart(6, '0')}"></span>${z.name}`;
  chip.addEventListener('click', () => {
    if (activeZones.has(id)) activeZones.delete(id);
    else activeZones.add(id);
    chip.classList.toggle('active', activeZones.has(id));
    applyZoneFilter();
  });
  zoneChipsEl.appendChild(chip);
  zoneChipEls[id] = chip;
}
function syncZoneChips() {
  for (const [id, chip] of Object.entries(zoneChipEls)) {
    chip.classList.toggle('active', activeZones.has(id));
  }
}
// ルートが通る施設だけを強調表示（それ以外は減光）
function focusZonesForRoute(pathIds) {
  activeZones.clear();
  const addZ = z => { if (z && ZONES[z]) activeZones.add(z); };
  addZ(nodeById[pathIds[0]].zone);
  addZ(nodeById[pathIds[pathIds.length - 1]].zone);
  for (let i = 1; i < pathIds.length; i++) {
    addZ(edgeZoneByPair[pairKey(pathIds[i - 1], pathIds[i])]);
  }
  syncZoneChips();
  applyZoneFilter();
}
// ルート解除時に施設フィルタも戻す
function resetZoneFocus() {
  activeZones.clear();
  syncZoneChips();
  applyZoneFilter();
}
document.getElementById('zone-clear').addEventListener('click', () => {
  activeZones.clear();
  document.querySelectorAll('.zchip.active').forEach(c => c.classList.remove('active'));
  applyZoneFilter();
});

// 地図上の文字（施設名ラベル）の一括表示切替
const labelsContainer = document.getElementById('labels');
// 「詳細」= 文字(施設名などのラベル)+店舗ドットの一括切替
// 広域地図は店を描かない(二層構造: 店の実位置は詳細地図が持つ)。「詳細」チップは店舗ドットの表示切替
const detailChip = document.getElementById('chip-detail');
let detailShown = false;
for (const m of shopMeshes) m.visible = false;
detailChip.classList.add('off');
detailChip.addEventListener('click', () => {
  detailShown = !detailShown;
  for (const m of shopMeshes) m.visible = detailShown;
  detailChip.classList.toggle('off', !detailShown);
});

// 地上のビル・駅舎・高架の一括表示切替
const bldgChip = document.getElementById('chip-buildings');
let bldgShown = true;       // 起動時はビル表示ON
let bldgAutoHidden = false; // ルート案内で自動OFFにしたか(手動操作と区別し、解除時だけ復帰)
function setBldgShown(v) {
  bldgShown = v;
  groundGroup.visible = v;
  for (const lab of groundLabelObjs) lab.visible = v; // CSS2Dは親のvisibleに連動しない
  bldgChip.classList.toggle('off', !v);
}
bldgChip.addEventListener('click', () => {
  bldgAutoHidden = false; // 手動で触ったら自動復帰の対象から外す
  setBldgShown(!bldgShown);
});


for (const chip of document.querySelectorAll('#floor-toggle .chip')) {
  if (!chip.dataset.floor) continue;
  chip.addEventListener('click', () => {
    const floor = chip.dataset.floor;
    const g = floorGroups[floor];
    g.visible = !g.visible;
    chip.classList.toggle('off', !g.visible);
    for (const lab of floorLabelObjs[floor]) lab.visible = g.visible;
    updateZoneLabels(); // 施設名は跨るフロアの可視状況で出し分ける(複数フロア施設は他層に出す)
  });
}

// 現地調査モード(?survey=1): 店舗クリックの代わりに床タップで記録する。UIは survey.js / #survey
let survey = null;
if (new URLSearchParams(location.search).get('survey') === '1') {
  document.body.classList.add('survey');
  applyViewOffset();
  survey = initSurvey({
    camera, floorGroups, FLOOR_Y, ZONES,
    w2m: ([x, z]) => [x / 0.5 + 800, z / 0.5 + 1100], // M2W の逆
  });
}

// クリックで出発地・目的地を選択
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let clickPhase = 0;
let downAt = null;
// ピンチ(2本指)の指離しをタップ扱いにしない。pointerIdの集合で管理し、upを取りこぼしても次のdownで上書きされて復帰する
const activePtrs = new Set();
let multiTouch = false;
const releasePtr = e => { activePtrs.delete(e.pointerId); ptrPos.delete(e.pointerId); if (activePtrs.size === 0) multiTouch = false; };
const ptrPos = new Map(); // pointerId -> [x, y](ピンチ中心の計算用)
renderer.domElement.addEventListener('pointermove', e => { if (ptrPos.has(e.pointerId)) ptrPos.set(e.pointerId, [e.clientX, e.clientY]); });
// ピンチ中心へのズームは OrbitControls の zoomToCursor(r160はタッチ対応)に任せる。
// 自前で基準点を動かす方式は、基準点移動→角度再計算で視点がパタッと変わる原因だったので廃止
renderer.domElement.addEventListener('pointerdown', e => {
  downAt = [e.clientX, e.clientY];
  activePtrs.add(e.pointerId);
  ptrPos.set(e.pointerId, [e.clientX, e.clientY]);
  if (activePtrs.size > 1) multiTouch = true;
  // 手動操作が始まったら自動カメラ移動は中断。ただし広域⇔詳細の移動(hard)は
  // 座標系をまたいで遠くへ飛ぶので、途中で止めると何もない空間に取り残される(地図が真っ暗になる)。
  // その場合は中断せず行き先へ即着地させる
  if (camAnim) {
    if (camAnim.hard) finishCamAnim();
    else camAnim = null;
  }
  // 地図に触れたら入力モードを終了（キーボードも閉じる）
  if (document.body.classList.contains('picker-editing')) {
    document.activeElement?.blur?.();
  }
});
addEventListener('pointerup', releasePtr);
addEventListener('pointercancel', releasePtr);
renderer.domElement.addEventListener('pointerup', e => {
  const wasMulti = multiTouch;
  releasePtr(e);
  if (wasMulti || !e.isPrimary) return;
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  if (survey) { survey.onTap(e); return; } // 調査モード: 店舗選択の代わりに記録
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const lmHit = raycaster.intersectObjects(landmarkMeshes.filter(m => m.parent.visible))[0];
  if (lmHit) {
    const lm = landmarkById[lmHit.object.userData.landmarkId];
    showPhotos(lm.name, lm.photo ? [{ file: lm.photo, caption: lm.note }] : photosOf(lm.id), lm.note);
    return;
  }
  raycaster.setFromCamera(pointer, camera);
  // 非表示の店ドットはタップ対象にしない(広域では床タップ=詳細モードを優先)。駅・スポットの透明シリンダーは常に可
  const hit = raycaster.intersectObjects(nodeMeshes.filter(m =>
    m.parent.visible && (m.visible || nodeById[m.userData.nodeId]?.type !== 'shop')))[0];
  const spotDetail = hit && detailKeyForSpotHit(hit);
  if (spotDetail) { enterDetail(spotDetail); return; } // 詳細地図を持つ館の館ノード → 詳細地図へ
  if (!hit) {
    // 店・スポットに当たらなければ床を調べ、詳細データのある施設なら詳細モードへ
    // 表示中の全階の床を調べる(三番街B1Fは浅層にある)。詳細地図を持つ館×階ならそこへ
    const floorMeshes = ['S1', 'B1', 'B2'].flatMap(f => floorGroups[f].visible ? floorGroups[f].children.filter(o => o.isMesh && o.visible) : []);
    const fl = raycaster.intersectObjects(floorMeshes, false)[0];
    const dk = fl && (fl.object.userData.detailKey || detailKeyForFloorHit(fl));
    if (dk) enterDetail(dk);
    return;
  }
  const id = hit.object.userData.nodeId;
  if (clickPhase === 0) {
    startSel.value = id;
    clearRoute();
    clickPhase = 1;
  } else {
    goalSel.value = id;
    clickPhase = 0;
    if (startSel.value !== goalSel.value) showRoute(startSel.value, goalSel.value);
  }
});

// ---------------------------------------------------------------------------
// ループ
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  // ルート実行時のカメラ移動（ユーザーが操作したら中断）
  if (camAnim) {
    const p = Math.min(1, (performance.now() - camAnim.start) / (camAnim.dur || 900));
    const e = 1 - Math.pow(1 - p, 3);
    camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, e);
    controls.target.lerpVectors(camAnim.fromTgt, camAnim.toTgt, e);
    if (p >= 1) finishCamAnim();
  } else if (detailMode && DETAIL[detailMode].anchors.length) {
    const detailAnchors = DETAIL[detailMode].anchors;
    // 詳細地図は広域から離れた専用エリアにあり、周りには何も無い。パンで外へ出ると画面が真っ暗になるので、
    // 注視点を地図の実体(床・区画)の近くに留める。外接ボックスではだめ(V字のくぼみは地図が無い)
    // 引き代は「いま見えている範囲」の半分(寄っているときほど厳しく = 常に画面内に地図が残る)
    const dist = camera.position.distanceTo(controls.target);
    const halfH = dist * Math.tan(camera.fov * Math.PI / 360);
    const lim = Math.max(15, Math.min(halfH, halfH * camera.aspect) * 0.5);
    let bd = Infinity, bx = 0, bz = 0;
    for (let i = 0; i < detailAnchors.length; i += 2) {
      const dx = controls.target.x - detailAnchors[i], dz = controls.target.z - detailAnchors[i + 1];
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; bx = detailAnchors[i]; bz = detailAnchors[i + 1]; }
    }
    const near = Math.sqrt(bd);
    if (near > lim) { // 最寄りの地図要素から離れすぎ → 引き戻す(カメラも同量動かし視点の向きは変えない)
      const k = lim / near;
      const tx = bx + (controls.target.x - bx) * k, tz = bz + (controls.target.z - bz) * k;
      camera.position.x += tx - controls.target.x;
      camera.position.z += tz - controls.target.z;
      controls.target.set(tx, controls.target.y, tz);
    }
  }
  if (routeCurve && markers.length) {
    markers.forEach((m, i) => {
      const u = (t * 0.06 + i / markers.length) % 1;
      m.position.copy(routeCurve.getPointAt(u));
    });
  }
  // EVのかご: そのEVが実際につなぐ下階⇔上階をゆっくり往復(各階で一瞬停止。位相をずらして同期させない)
  for (const c of evCages) {
    const tt = ((t + c.phase) % 7) / 7;
    let u;
    if (tt < 0.4) u = tt / 0.4;             // 上昇
    else if (tt < 0.5) u = 1;               // 上階で停止
    else if (tt < 0.9) u = 1 - (tt - 0.5) / 0.4; // 下降
    else u = 0;                             // 下階で停止
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    c.mesh.position.y = c.low + (c.high - c.low) * e;
  }
  // 現在地マーカー: 人型の浮遊＋足元のパルスリング
  if (startIcon) {
    const a = startIcon.userData.anim;
    a.person.position.y = Math.sin(t * 2.5) * 1.2;
    a.rings.forEach((ring, i) => {
      const phase = (t / 1.6 + i * 0.5) % 1;
      const s = 1 + phase * 2.0;
      ring.scale.set(s, s, s);
      ring.material.opacity = 0.7 * (1 - phase);
    });
  }
  // 案内文タップによる赤い人の歩行(ルート沿い・階の上下も追従)
  if (walkAnim && startIcon && routeCurve) {
    const p = Math.min(1, (performance.now() - walkAnim.start) / walkAnim.dur);
    const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    walkU = walkAnim.from + (walkAnim.to - walkAnim.from) * ease;
    const pt = routeCurve.getPointAt(Math.max(0, Math.min(1, walkU)));
    startIcon.position.set(pt.x, pt.y - 3.5, pt.z); // カーブ点(床+7)→人の基準(床+3.5)
    // カメラ移動はcamAnim(タップ時に同じ時間で発火)が担当する
    if (p >= 1) walkAnim = null;
  }
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  applyViewOffset(); // setViewOffset内部でupdateProjectionMatrixされる
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
});

// 初期状態はルート未実行のフラットな全体表示(出発地・目的地は未選択)
