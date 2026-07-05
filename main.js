import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SHOP_AREAS, SHOPS_MANUAL, SHOPS_SCRAPED, ALIASES } from './shops.js';

// ---------------------------------------------------------------------------
// 梅田ダンジョン データ
// 参考: https://umedachikagai.web.fc2.com/ の案内地図をトレースした概略座標
// mx,my は地図画像(1350x1910px)上のピクセル座標。x:東+ / z:南+
// ---------------------------------------------------------------------------
const FLOOR_Y = { B1: 0, B2: -66 }; // 視認性のためフロア間隔は誇張している
const UNIT_M = 2.1;              // 1 world unit ≈ 2.1m（地図1px ≈ 1.05m）
const M2W = ([mx, my]) => [(mx - 800) * 0.5, (my - 1100) * 0.5];

const S = (id, name, floor, mx, my) => ({ id, name, floor, mx, my, type: 'station' });
const P = (id, name, floor, mx, my, zone) => ({ id, name, floor, mx, my, zone, type: 'spot' });
const J = (id, mx, my, floor = 'B1') => ({ id, name: '', floor, mx, my, type: 'junction' });
// 店舗。near: 最寄りの通路ノード。aliases: 検索用の別表記
const Sh = (id, name, floor, mx, my, zone, near, aliases) =>
  ({ id, name, floor, mx, my, zone, near, aliases, type: 'shop' });

// 施設レイヤー（エリアごとの色分け・強調表示用）。駅は常に表示するのでゾーンなし
const ZONES = {
  sanban:      { name: '阪急三番街',            color: 0xe0913f, label: [945, 588] },
  whity:       { name: 'ホワイティうめだ',      color: 0xd9c04b, label: [1140, 928] },
  umechika:    { name: '百貨店前 / 梅田地下街',  color: 0xd97f9f, label: [903, 988] },
  osaka_sta:   { name: 'JR大阪駅 / ルクア周辺',  color: 0x5f9fd9, label: [690, 850] },
  diamor:      { name: 'ディアモール大阪',      color: 0x45c8a8, label: [856, 1168] },
  nishi_umeda: { name: '西梅田 / ハービス',      color: 0xa07fd9, label: [470, 1245] },
  ekimae:      { name: '大阪駅前ビル',          color: 0xdb5a66, label: [890, 1258] },  // 鮮明な赤(そねちかとの分離)
  sonechika:   { name: 'そねちか',              color: 0x49b6c4, label: [995, 1372] },  // シアン(隣接する駅前ビルの赤と対比)
  dotica:      { name: 'ドージマ地下センター',  color: 0x5fae6e, label: [630, 1480] },
};

const NODES = [
  // --- 北エリア（阪急・茶屋町方面） ---
  S('hankyu',      '阪急 大阪梅田駅',            'B1',  930,  470),
  // 阪急三番街は北館/南館 × B1/B2 の4面構成（北館B2=UMEDA FOOD HALL、南館B2=川の流れる街）
  P('sanban_n_b1', '阪急三番街 北館B1',          'B1',  945,  545, 'sanban'),
  P('sanban_n_b2', '阪急三番街 北館B2 (UMEDA FOOD HALL)', 'B2', 945, 545, 'sanban'),
  P('sanban_s_b1', '阪急三番街 南館B1',          'B1',  945,  655, 'sanban'),
  P('sanban_s_b2', '阪急三番街 南館B2 (川の流れる街)',    'B2', 945, 655, 'sanban'),
  P('yodobashi',   'ヨドバシ / LINKS UMEDA',     'B1',  775,  645, 'osaka_sta'),
  P('opa',         '梅田OPA・HEP前',             'B1', 1040,  600, 'sanban'),
  P('hankyu_dept', '阪急百貨店',                 'B1',  965,  830, 'umechika'),
  // --- JR大阪駅・中央 ---
  S('jr_osaka',    'JR大阪駅(御堂筋口)',         'B1',  790,  870),
  P('lucua',       'ルクア / イノゲート大阪',    'B1',  640,  820, 'osaka_sta'),
  P('lucua_b2',    'ルクア バルチカ/FOOD HALL',  'B2',  640,  820, 'osaka_sta'),
  P('grandfront',  'グランフロント大阪',         'B1',  380,  800, 'osaka_sta'),
  S('midosuji',    '御堂筋線 梅田駅',            'B2',  900,  895),
  P('daimaru',     '大丸・グランヴィア前',       'B1',  755,  975, 'osaka_sta'),
  S('hanshin',     '阪神 大阪梅田駅(百貨店)',    'B1',  880, 1030),
  S('hanshin_home','阪神 大阪梅田駅(ホーム)',    'B2',  845, 1035),
  // --- ホワイティうめだ ---
  P('whity_w',     'ホワイティうめだ(西)',       'B1', 1000,  940, 'whity'),
  P('izumi',       '泉の広場',                   'B1', 1265,  935, 'whity'),
  S('higashi',     '谷町線 東梅田駅',            'B2', 1055, 1105),
  // --- ディアモール・駅前ビル ---
  P('enkei',       'ディアモール 円形広場',      'B1',  855, 1165, 'diamor'),
  P('ekimae1',     '大阪駅前第1ビル',            'B1',  720, 1300, 'ekimae'),
  P('ekimae2',     '大阪駅前第2ビル',            'B1',  880, 1310, 'ekimae'),
  P('ekimae3',     '大阪駅前第3ビル',            'B1', 1020, 1300, 'ekimae'),
  P('ekimae4',     '大阪駅前第4ビル',            'B1', 1005, 1200, 'ekimae'),
  // 駅前ビルはB2にも店舗フロアがあり、4棟はB2レベルで相互接続・北新地駅直結
  P('ekimae1_b2',  '大阪駅前第1ビル(B2)',        'B2',  720, 1300, 'ekimae'),
  P('ekimae2_b2',  '大阪駅前第2ビル(B2)',        'B2',  880, 1310, 'ekimae'),
  P('ekimae3_b2',  '大阪駅前第3ビル(B2)',        'B2', 1020, 1300, 'ekimae'),
  P('ekimae4_b2',  '大阪駅前第4ビル(B2)',        'B2', 1005, 1200, 'ekimae'),
  // --- 西梅田・北新地・堂島 ---
  S('nishi',       '四つ橋線 西梅田駅',          'B2',  650, 1195),
  P('hilton',      'ヒルトンプラザ EAST/WEST',   'B1',  690, 1130, 'nishi_umeda'),
  P('garden',      '大阪ガーデンシティ',         'B1',  560, 1140, 'nishi_umeda'),
  P('herbis',      'ハービスENT / OSAKA',        'B1',  470, 1250, 'nishi_umeda'),
  P('ritz',        'リッツ・カールトン前',       'B1',  300, 1385, 'nishi_umeda'),
  S('kitashinchi', 'JR東西線 北新地駅',          'B2',  880, 1425),
  P('dojima',      'ドージマ地下センター',       'B1',  635, 1500, 'dotica'),
  P('avanza',      '堂島アバンザ前',             'B1',  645, 1620, 'dotica'),
  P('sonechika',   'そねちか(お初天神方面)',     'B1', 1100, 1390, 'sonechika'),
  // --- 無名の分岐点（経路用ジャンクション） ---
  J('j_shibata',   940,  720),   // 三番街南端・芝田交差点
  J('j_sun',       935,  778),   // 阪急サン広場地下通り
  J('j_yodo_e',    862,  645),   // 三番街西口
  J('j_kita',      800,  768),   // JR大阪駅 御堂筋北口
  J('j_metro',     880,  940),   // 地下鉄梅田駅 改札前
  J('j_pchn',     1015,  505),   // プチシャン北端（Nu茶屋町・ホテル阪急方面）
  J('j_east1',    1070,  700),   // ノースモール1北端（サニーテラス・HEP方面）
  J('j_nm1s',     1076,  860),   // ノースモール2分岐
  J('j_nm2',      1118,  850),   // ノースモール2先端（阪急東通り入口）
  J('j_whity_x',  1080,  938),   // ポケットパーク（センター/イーストモール結節点）
  J('izumi_ne',   1320,  865),   // 泉の広場 北東出口方面
  J('j_hanshin_e', 940, 1000),   // 阪神百貨店 北東角
  J('j_higashi_n',1050, 1005),   // 東梅田 地下街北端
  J('j_f40',      1005, 1080),   // 谷町線沿い通路
  J('j_diamor_e',  990, 1152),   // ディアモール東アーム端
  J('j_diamor_n',  858, 1090),   // ディアモール北端
  J('j_diamor_s',  855, 1248),   // ディアモール南端（ファッショナブルST中央）
  J('j_fashion_w', 712, 1255),   // ファッショナブルST西端（第1ビル・北新地方面）
  J('j_fashion_e',1000, 1225),   // ファッショナブルST東端（第4ビル方面）
  J('j_market_ne', 930, 1082),   // マーケットST北東端（E-ma横・御堂筋線方面）
  J('j_nishi_x',   652, 1168),   // 西梅田駅前交差点
  J('j_c1',        655, 1025),   // 大阪駅前地下道 西端
  J('j_sone_w',    640, 1360),   // 曽根崎地下歩道 西端
  J('j_sone_c',    860, 1362),   // 曽根崎地下歩道 中央
  J('sw_end',      105, 1455),   // 西梅田 南西端(福島方面)
];

// [a, b, 幅(world unit), zone?]
const EDGES = [
  // 北エリア
  ['hankyu', 'sanban_n_b1', 18, 'sanban'],
  // 北館⇔南館の地下連絡はB2のみ（東西2本を1本に集約。B1に連絡通路はない）
  ['sanban_n_b2', 'sanban_s_b2', 10, 'sanban'],
  ['sanban_s_b1', 'j_shibata', 18, 'sanban'],
  ['j_shibata', 'j_sun', 13, 'umechika'],
  ['j_sun', 'hankyu_dept', 13, 'umechika'],
  ['sanban_s_b1', 'j_yodo_e', 10, 'sanban'],
  ['j_yodo_e', 'yodobashi', 10, 'osaka_sta'],
  ['yodobashi', 'j_kita', 9, 'osaka_sta'],
  ['j_kita', 'jr_osaka', 14, 'osaka_sta'],
  ['sanban_s_b1', 'opa', 9, 'sanban'],
  // プチシャン〜ノースモール1は南北方向の通路（阪急東側・実測）
  ['j_pchn', 'opa', 8, 'whity'],
  ['opa', 'j_east1', 8, 'whity'],
  ['j_east1', 'j_nm1s', 10, 'whity'],
  ['j_nm1s', 'j_whity_x', 10, 'whity'],
  ['j_nm1s', 'j_nm2', 7, 'whity'],  // ノースモール2（阪急東通りへの支通路）
  // 中央
  ['hankyu_dept', 'j_metro', 13, 'umechika'],
  ['jr_osaka', 'lucua', 13, 'osaka_sta'],
  ['lucua', 'grandfront', 10, 'osaka_sta'],
  ['jr_osaka', 'daimaru', 15, 'osaka_sta'],
  ['daimaru', 'j_c1', 13, 'osaka_sta'],
  ['daimaru', 'j_metro', 15, 'umechika'],
  ['j_metro', 'whity_w', 15, 'whity'],
  ['j_metro', 'hanshin', 16, 'umechika'],
  // ホワイティうめだ（実測: 東西軸はセンターモール→ポケットパーク→イーストモールの1本）
  ['whity_w', 'j_whity_x', 14, 'whity'],    // センターモール
  ['j_whity_x', 'izumi', 14, 'whity'],      // イーストモール（→泉の広場）
  ['whity_w', 'j_higashi_n', 10, 'whity'],  // サウスモール（→東梅田・第4ビル方面）
  ['izumi', 'izumi_ne', 8, 'whity'],        // NOMOKA（泉の広場→北）
  // 阪神・東梅田
  ['hanshin', 'j_hanshin_e', 10, 'umechika'],
  ['j_hanshin_e', 'j_higashi_n', 10, 'umechika'],
  ['j_higashi_n', 'j_f40', 9],
  ['j_f40', 'j_diamor_e', 9],
  // ディアモール（十字）
  ['hanshin', 'j_diamor_n', 16, 'diamor'],
  ['j_diamor_n', 'enkei', 14, 'diamor'],
  ['enkei', 'j_diamor_e', 14, 'diamor'],
  ['j_diamor_e', 'ekimae4', 9, 'diamor'],
  ['enkei', 'j_diamor_s', 14, 'diamor'],
  ['j_diamor_s', 'ekimae1', 9, 'diamor'],
  ['j_diamor_s', 'ekimae2', 9, 'diamor'],
  ['enkei', 'j_nishi_x', 14, 'diamor'],
  // ファッショナブルストリート（駅前ビル北側を東西に走る幹線・E字の横棒）
  ['j_fashion_w', 'j_diamor_s', 12, 'diamor'],
  ['j_diamor_s', 'j_fashion_e', 12, 'diamor'],
  ['j_fashion_w', 'ekimae1', 8, 'ekimae'],
  ['j_fashion_e', 'ekimae4', 8, 'ekimae'],
  // マーケットストリート（円形広場→北東へ斜行、E-ma横で御堂筋線方面に接続）
  ['enkei', 'j_market_ne', 12, 'diamor'],
  ['j_market_ne', 'j_hanshin_e', 9, 'umechika'],
  // 西梅田
  ['j_nishi_x', 'hilton', 9, 'nishi_umeda'],
  ['hilton', 'garden', 9, 'nishi_umeda'],
  ['j_c1', 'garden', 12, 'nishi_umeda'],
  ['garden', 'herbis', 12, 'nishi_umeda'],
  ['herbis', 'j_nishi_x', 10, 'nishi_umeda'],
  ['herbis', 'ritz', 12, 'nishi_umeda'],
  ['ritz', 'sw_end', 9, 'nishi_umeda'],
  // 北新地・堂島
  ['j_nishi_x', 'j_sone_w', 10, 'nishi_umeda'],
  ['j_sone_w', 'dojima', 9, 'dotica'],
  ['dojima', 'avanza', 9, 'dotica'],
  ['j_sone_w', 'j_sone_c', 9, 'sonechika'],
  ['j_sone_c', 'sonechika', 9, 'sonechika'],
  // 駅前ビル
  ['ekimae1', 'ekimae2', 8, 'ekimae'],
  ['ekimae2', 'ekimae3', 8, 'ekimae'],
  ['ekimae3', 'ekimae4', 8, 'ekimae'],
  ['ekimae1', 'j_sone_w', 8, 'ekimae'],
  ['ekimae1', 'j_sone_c', 8, 'ekimae'],
  ['ekimae3', 'sonechika', 8, 'ekimae'],
  // 駅前ビル B2レベルの相互連絡通路（北新地駅 東改札は第2ビルB2に直結）
  ['ekimae1_b2', 'ekimae2_b2', 8, 'ekimae'],
  ['ekimae2_b2', 'ekimae3_b2', 8, 'ekimae'],
  ['ekimae3_b2', 'ekimae4_b2', 8, 'ekimae'],
  ['kitashinchi', 'ekimae2_b2', 8, 'ekimae'],
  ['kitashinchi', 'ekimae1_b2', 7, 'ekimae'], // 第1ビルも北新地駅直結
];

// フロア間の縦移動設備。位置は各駅のバリアフリー情報を元に配置
// a: B1側ノード / b: B2側ノード / mx,my: 設備の位置（地図px）
const VERTICALS = [
  // 御堂筋線 梅田駅（EVは各ホーム1基: 中北東改札側・南改札側）
  { type: 'ev',     a: 'j_metro',     b: 'midosuji',    mx:  893, my:  928, name: '南改札EV' },
  { type: 'esc',    a: 'j_metro',     b: 'midosuji',    mx:  882, my:  910, name: '南改札ESC' },
  { type: 'ev',     a: 'hankyu_dept', b: 'midosuji',    mx:  920, my:  858, name: '中北東改札EV' },
  { type: 'esc',    a: 'hankyu_dept', b: 'midosuji',    mx:  940, my:  845, name: '北改札ESC' },
  // 谷町線 東梅田駅（EVは南改札側・中西改札側 / 北東改札はESC）
  { type: 'esc',    a: 'j_higashi_n', b: 'higashi',     mx: 1052, my: 1048, name: '北東改札ESC' },
  { type: 'ev',     a: 'j_f40',       b: 'higashi',     mx: 1024, my: 1092, name: '中西改札EV' },
  { type: 'ev',     a: 'ekimae4',     b: 'higashi',     mx: 1026, my: 1160, name: '南改札EV' },
  { type: 'esc',    a: 'ekimae4',     b: 'higashi',     mx: 1044, my: 1146, name: '南改札ESC' },
  // 四つ橋線 西梅田駅（EVは南改札側のみ / 北改札はESC）
  { type: 'esc',    a: 'j_nishi_x',   b: 'nishi',       mx:  652, my: 1180, name: '北改札ESC' },
  { type: 'ev',     a: 'herbis',      b: 'nishi',       mx:  622, my: 1228, name: '南改札EV' },
  { type: 'stairs', a: 'j_sone_w',    b: 'nishi',       mx:  645, my: 1268, name: '南改札階段' },
  // 阪神 大阪梅田駅（ホームはB2頭端式。西口EV / 百貨店口・東口はESC・階段でB1へ）
  { type: 'ev',     a: 'hanshin',     b: 'hanshin_home', mx:  805, my: 1042, name: '西口EV' },
  { type: 'esc',    a: 'hanshin',     b: 'hanshin_home', mx:  862, my: 1030, name: '百貨店口ESC' },
  // JR東西線 北新地駅（西改札・東改札の両方にEV）
  { type: 'ev',     a: 'j_sone_c',    b: 'kitashinchi', mx:  864, my: 1398, name: '西改札EV' },
  { type: 'esc',    a: 'j_sone_c',    b: 'kitashinchi', mx:  838, my: 1390, name: '西改札ESC' },
  { type: 'ev',     a: 'sonechika',   b: 'kitashinchi', mx: 1022, my: 1402, name: '東改札EV' },
  { type: 'esc',    a: 'sonechika',   b: 'kitashinchi', mx:  990, my: 1398, name: '東改札ESC' },
  // 商業施設のB1⇔B2フロア間（館内ESC・階段）
  { type: 'esc',    a: 'lucua',       b: 'lucua_b2',    mx:  655, my:  835, name: 'ルクア館内ESC' },
  { type: 'esc',    a: 'sanban_n_b1', b: 'sanban_n_b2', mx:  960, my:  540, name: '三番街北館ESC' },
  { type: 'esc',    a: 'sanban_s_b1', b: 'sanban_s_b2', mx:  960, my:  662, name: '三番街南館ESC' },
  { type: 'esc',    a: 'ekimae1',     b: 'ekimae1_b2',  mx:  733, my: 1288, name: '第1ビル館内ESC' },
  { type: 'esc',    a: 'ekimae2',     b: 'ekimae2_b2',  mx:  893, my: 1298, name: '第2ビル館内ESC' },
  { type: 'stairs', a: 'ekimae3',     b: 'ekimae3_b2',  mx: 1032, my: 1288, name: '第3ビル館内階段' },
  { type: 'stairs', a: 'ekimae4',     b: 'ekimae4_b2',  mx: 1018, my: 1188, name: '第4ビル館内階段' },
];
const VERT_LABEL = { ev: 'エレベーター', esc: 'エスカレーター', stairs: '階段' };
const VERT_ICON  = { ev: '🛗', esc: '↗', stairs: '🪜' };
const VERT_COST  = { ev: 90, esc: 40, stairs: 60 }; // 乗換の手間（待ち時間など）を距離換算で加算

// B2は駅のホーム階。路線・ホームを描いてB2にも「通り」があることを見せる（見た目用）
const RAIL_LINES = [
  { name: '御堂筋線',  color: 0xe5343c,
    ends: ['中津・新大阪方面', 'なんば・天王寺方面'],
    pts: [[912, 430], [905, 760], [900, 895], [895, 1150], [890, 1700]] },
  { name: '谷町線',    color: 0x9a6fd6,
    ends: ['中崎町・都島方面', '南森町・天王寺方面'],
    pts: [[1185, 640], [1095, 980], [1058, 1090], [1057, 1200], [1105, 1450], [1150, 1700]] },
  // 西梅田は改札がB2・ホームB3（実調査）のため線路・ホームをさらに下げて描く
  { name: '四つ橋線',  color: 0x2f9fe0, dy: -16,
    ends: [null, '肥後橋・なんば方面'],
    pts: [[650, 1165], [651, 1400], [655, 1700]] },
  { name: 'JR東西線',  color: 0xf06eaa,
    ends: ['新福島・尼崎方面', '大阪天満宮・京橋方面'],
    pts: [[100, 1485], [520, 1450], [880, 1425], [1150, 1400], [1330, 1378]] },
  // 阪神本線（頭端式ターミナル: 東端が車止め）
  { name: '阪神本線',  color: 0x3b82d0,
    ends: ['福島・神戸三宮方面', null],
    pts: [[100, 1100], [300, 1075], [600, 1048], [878, 1032]] },
];

// 駅ホーム（B2の見た目用スラブ）。dirは線路方向、dyは追加の深さ
const PLATFORMS = [
  { mx:  901, my:  890, len: 100, w: 18, dir: [-12, 420] },           // 御堂筋線 梅田（島式1面）
  { mx: 1068, my: 1111, len:  90, w:  8, dir: [-30, 250] },           // 谷町線 東梅田（相対式・東側）
  { mx: 1046, my: 1109, len:  90, w:  8, dir: [-30, 250] },           // 谷町線 東梅田（相対式・西側）
  { mx:  651, my: 1230, len:  85, w: 16, dir: [0, 1], dy: -16 },      // 四つ橋線 西梅田（島式・B3相当）
  { mx:  880, my: 1425, len:  95, w: 14, dir: [830, -75] },           // JR東西線 北新地（島式）
  { mx:  790, my: 1038, len:  95, w: 22, dir: [278, -16] },           // 阪神 大阪梅田（頭端式4面）
];

// 広場・モール（見た目用の面。経路には影響しない）
const PLAZAS = [
  { kind: 'disc', mx:  855, my: 1165, r: 16, floor: 'B1', zone: 'diamor' },      // 円形広場
  { kind: 'disc', mx: 1265, my:  935, r: 15, floor: 'B1', zone: 'whity' },       // 泉の広場
  { kind: 'box',  mx:  880, my:  985, w: 42, d: 34, floor: 'B1', zone: 'umechika' },    // 阪神百貨店前
  { kind: 'box',  mx:  790, my:  875, w: 55, d: 38, floor: 'B1', zone: 'osaka_sta' },   // JR大阪駅コンコース
  { kind: 'box',  mx:  470, my: 1250, w: 30, d: 30, floor: 'B1', zone: 'nishi_umeda' }, // ハービス
  { kind: 'box',  mx:  640, my:  820, w: 26, d: 20, floor: 'B2', zone: 'osaka_sta' },   // ルクア バルチカ/FOOD HALL
  { kind: 'box',  mx:  720, my: 1300, w: 22, d: 22, floor: 'B2', zone: 'ekimae' },      // 駅前第1ビルB2
  { kind: 'box',  mx:  880, my: 1310, w: 22, d: 22, floor: 'B2', zone: 'ekimae' },      // 駅前第2ビルB2
  { kind: 'box',  mx: 1020, my: 1300, w: 22, d: 22, floor: 'B2', zone: 'ekimae' },      // 駅前第3ビルB2
  { kind: 'box',  mx: 1005, my: 1200, w: 22, d: 22, floor: 'B2', zone: 'ekimae' },      // 駅前第4ビルB2
];

// 任意多角形のフロア面（地図pxの頂点列。coversに挙げた通路はこの面が置き換える）
const FLOOR_POLYS = [
  // 阪急三番街 北館（阪急駅の軸に合わせて僅かに傾いた四角形）
  { floor: 'B1', zone: 'sanban', pts: [[908, 496], [980, 487], [989, 572], [915, 582]] },
  { floor: 'B2', zone: 'sanban', pts: [[908, 496], [980, 487], [989, 572], [915, 582]] },
  // 阪急三番街 南館
  { floor: 'B1', zone: 'sanban', pts: [[906, 622], [984, 611], [994, 696], [916, 708]] },
  { floor: 'B2', zone: 'sanban', pts: [[906, 622], [984, 611], [994, 696], [916, 708]] },
  // ホワイティうめだ mikke（センターモール南側の面的ゾーン。path配置の店舗の床）
  { floor: 'B1', zone: 'whity', pts: [[952, 952], [1048, 952], [1048, 976], [952, 976]] },
  // ホワイティうめだ FARURU（センターモールとNM1南端に挟まれた斜行ゾーン）
  { floor: 'B1', zone: 'whity', pts: [[1001, 909], [1060, 890], [1068, 912], [1009, 931]] },
  // ディアモール大阪（円形広場＋6本のアームをE字一体でトレース）
  { floor: 'B1', zone: 'diamor',
    covers: [
      ['enkei', 'j_diamor_n'], ['enkei', 'j_market_ne'], ['enkei', 'j_diamor_e'],
      ['j_diamor_e', 'ekimae4'], ['enkei', 'j_diamor_s'], ['enkei', 'j_nishi_x'],
      ['j_fashion_w', 'j_diamor_s'], ['j_diamor_s', 'j_fashion_e'],
    ],
    pts: [
      [842, 1090], [868, 1090],                    // 北アーム（阪神方面）
      [866, 1142], [921, 1074], [939, 1090],       // マーケットST（北東へ）
      [874, 1153],
      [991, 1139], [1014, 1197], [996, 1203],      // バラエティST（南東・第4ビルへ）
      [989, 1165], [870, 1176],
      [868, 1182], [868, 1226],                    // カジュアルST南下
      [999, 1212], [1001, 1238],                   // ファッショナブルST東端
      [713, 1268], [711, 1242],                    // 同・西端
      [842, 1228], [842, 1182],                    // カジュアルST西縁を北上
      [840, 1178], [652, 1178], [652, 1152],       // 西アーム（西梅田方面）
      [838, 1152], [842, 1145],                    // 円形広場北西→北アームへ
    ] },
];

// ホール型フロア内部の見えない通路格子（経路探索・案内用。描画はしない）
const HALL_EDGES = [];

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
          NODES.push({ id: `shop_${areaId}_${seq2++}`, name: sh.name, floor: a.floor,
            mx: bx + (k % 3 - 1) * 6.5,
            my: by + (Math.floor(k / 3) - (rows - 1) / 2) * 6.5,
            zone: a.zone, near: [cellNode], aliases: aliasesFor(sh.name),
            small: true, type: 'shop' }); // ホール内は小径ドット
        });
      }
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
        // 通路の縁の内側に並べる（world単位: 半幅-2 → px換算×2）
        segs.push({ x1: na.mx, y1: na.my, x2: nb.mx, y2: nb.my, len, off: Math.max(3, (w / 2 - 2) * 2) });
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
        zone: a.zone, near, aliases: aliasesFor(s.name), category: s.category, type: 'shop' });
    });
  }
})();

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
    const panelH = document.getElementById('panel')?.offsetHeight ?? 0;
    camera.setViewOffset(innerWidth, innerHeight, 0, panelH / 2, innerWidth, innerHeight);
  } else {
    camera.clearViewOffset();
  }
}
applyViewOffset();

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-30, -10, -10);
controls.enableDamping = true;
controls.zoomSpeed = 3; // ホイールズームの感度
controls.zoomToCursor = true; // カーソル/ピンチ中心の地点に向かって拡大縮小(固定中心をやめる)
controls.maxPolarAngle = Math.PI * 0.49;

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
const floorGroups = { B1: new THREE.Group(), B2: new THREE.Group() };
const floorLabelObjs = { B1: [], B2: [] }; // CSS2Dラベルはグループ非表示に連動しないため個別管理
const vertGroup = new THREE.Group(); // EV・ESC・階段はフロア切替に関わらず常時表示
scene.add(floorGroups.B1, floorGroups.B2, vertGroup);

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
  const GROUND_Y = 46; // 地上レベル（B1の上空。地下街との間に「土被り」の余白を持たせる）
  // r: [x1, y1, x2, y2](地図px), h: 高さ(world), name: 屋上ラベル, lm: ランドマーク(輪郭強調)
  // 高さは実際の建物高(m)×0.75で統一(相対的な高さ関係を実物に合わせる)
  const GROUND_BUILDINGS = [
    { r: [880, 440, 1015, 660], h: 24, name: '阪急 大阪梅田駅', lm: true },   // 高架ホーム大屋根 ~30m
    { r: [900, 755, 1010, 875], h: 140, name: '阪急百貨店', lm: true },      // 梅田阪急ビル 187m
    { r: [1025, 775, 1090, 855], h: 95, name: '阪急グランドビル' },          // 127m
    { r: [1130, 640, 1205, 705], h: 47, name: 'HEP FIVE', lm: true },        // 建物63m(観覧車の方が大きい)
    { r: [830, 990, 935, 1080], h: 141, name: '阪神百貨店', lm: true },      // ツインタワーズ・サウス 188m
    { r: [590, 735, 760, 800], h: 48, name: 'ルクア / ノースゲート', lm: true }, // 低層大型 ~60m
    { r: [700, 905, 830, 990], h: 92, name: '大丸 / サウスゲート', lm: true },   // 122m
    { r: [715, 585, 830, 700], h: 85, name: 'ヨドバシ梅田 / LINKS', lm: true },  // タワー部 ~150m(街区平均で圧縮)
    { r: [840, 900, 905, 975], h: 75, name: 'イノゲート大阪' },              // ~100m
    { r: [330, 700, 480, 835], h: 135, name: 'グランフロント南館', lm: true }, // タワーA 180m
    { r: [370, 480, 520, 660], h: 131, name: 'グランフロント北館', lm: true }, // タワーB 175m
    { r: [230, 590, 335, 700], h: 32, name: 'グラングリーン大阪' },          // 低層 ~40m
    { r: [520, 975, 620, 1070], h: 130, name: 'KITTE大阪' },                 // JPタワー大阪 ~170m
    { r: [655, 1270, 770, 1345], h: 38, name: '駅前第1ビル' },               // ~50m
    { r: [820, 1275, 935, 1350], h: 53, name: '駅前第2ビル' },               // ~70m
    { r: [960, 1260, 1075, 1340], h: 107, name: '駅前第3ビル' },             // 142m(4棟で最も高い)
    { r: [950, 1160, 1060, 1235], h: 68, name: '駅前第4ビル' },              // ~90m
    { r: [590, 1095, 690, 1185], h: 110, name: 'ヒルトンプラザ', lm: true }, // WESTタワー 167m
    { r: [380, 1195, 530, 1340], h: 135, name: 'ハービスOSAKA / ENT', lm: true }, // ハービスOSAKA 190m
    { r: [445, 1085, 525, 1165], h: 131, name: 'ブリーゼタワー' },           // 175m
  ];
  // 街の地: 名もなきビル群（低層〜中層）で市街の質感を足す
  const FILLER_BUILDINGS = [
    [1060, 390, 1130, 460, 40], [1160, 400, 1250, 480, 30], [1270, 430, 1340, 520, 24], // 茶屋町
    [1240, 640, 1320, 730, 26], [1150, 760, 1230, 850, 22], [1250, 780, 1330, 880, 20], // 阪急東通り
    [1120, 1000, 1200, 1090, 28], [1230, 960, 1310, 1060, 22],                          // 曽根崎・お初天神
    [1100, 1180, 1180, 1270, 30], [1210, 1150, 1300, 1250, 24],                          // 曽根崎新地東
    [640, 1420, 730, 1500, 30], [760, 1430, 860, 1510, 26], [890, 1420, 990, 1500, 30],  // 北新地
    [490, 1400, 590, 1490, 34], [350, 1420, 460, 1510, 40],                              // 堂島
    [230, 900, 330, 1000, 36], [220, 1060, 320, 1160, 30],                               // 大阪駅西
  ];

  const faceMat = new THREE.MeshBasicMaterial({
    color: 0x9fb6d4, transparent: true, opacity: 0.055, depthWrite: false,
  });
  const faceMatLm = new THREE.MeshBasicMaterial({
    color: 0xaec8e8, transparent: true, opacity: 0.10, depthWrite: false,
  });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xcfe0f5, transparent: true, opacity: 0.30 });
  const edgeMatSoft = new THREE.LineBasicMaterial({ color: 0xaec4de, transparent: true, opacity: 0.16 });
  const edgeMatFill = new THREE.LineBasicMaterial({ color: 0x8fa6c2, transparent: true, opacity: 0.09 });

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

  for (const b of GROUND_BUILDINGS) {
    addBox(b.r, b.h, b.lm ? edgeMat : edgeMatSoft, b.lm);
    // 名前はランドマークのみ（全ビルに付けると引きの視点で文字が渋滞する）
    if (b.name && b.lm) addBldgLabel(b.name, (b.r[0] + b.r[2]) / 2, (b.r[1] + b.r[3]) / 2, GROUND_Y + b.h + 7);
  }
  for (const [x1, y1, x2, y2, h] of FILLER_BUILDINGS) addBox([x1, y1, x2, y2], h, edgeMatFill);

  // --- 梅田スカイビル: ツインタワー＋頂部の空中庭園リング（シルエットで一発で分かる） ---
  {
    const H = 130; // 173m ×0.75
    addBox([70, 485, 115, 595], H, edgeMat, true);
    addBox([125, 485, 170, 595], H, edgeMat, true);
    const [cx, cz] = M2W([120, 540]);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(14, 1.1, 6, 36),
      new THREE.MeshBasicMaterial({ color: 0xcfe0f5, transparent: true, opacity: 0.35, depthWrite: false })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(cx, GROUND_Y + H - 3, cz);
    groundGroup.add(ring);
    addBldgLabel('梅田スカイビル', 120, 540, GROUND_Y + H + 9);
  }

  // --- HEP FIVE: 赤い観覧車（梅田の目印） ---
  // 実物は直径75m・頂部106mで、ビル(63m)より観覧車の方が大きい。×0.75で統一
  {
    const [wx, wz] = M2W([1167, 672]);
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
    const roadMat = new THREE.MeshBasicMaterial({ color: 0xaac4e6, transparent: true, opacity: 0.06, depthWrite: false });
    const addRoad = (r, name, labelAt) => {
      const [x1, z1] = M2W([r[0], r[1]]);
      const [x2, z2] = M2W([r[2], r[3]]);
      const geo = new THREE.PlaneGeometry(Math.abs(x2 - x1), Math.abs(z2 - z1));
      const mesh = new THREE.Mesh(geo, roadMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((x1 + x2) / 2, GROUND_Y + 0.3, (z1 + z2) / 2);
      mesh.renderOrder = 2;
      groundGroup.add(mesh);
      if (name) addBldgLabel(name, labelAt[0], labelAt[1], GROUND_Y + 3);
    };
    addRoad([874, 380, 906, 1560], '御堂筋', [890, 1310]);
    addRoad([612, 1040, 642, 1560], '四つ橋筋', [627, 1500]);
    addRoad([560, 1358, 1340, 1388], '曽根崎通', [1180, 1373]);
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

  // --- JR大阪駅の駅舎: 南北ゲートビルの間に架かる「大屋根」アーチ＋ホームでトレース ---
  {
    const stMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.24 });
    const [xW] = M2W([640, 0]), [xE] = M2W([860, 0]);
    const [, zN] = M2W([0, 792]), [, zS] = M2W([0, 918]);
    // アーチ断面（北→南）: 中央が膨らみ、南へ緩く下がる大屋根
    const arch = t => [
      GROUND_Y + 36 + Math.sin(Math.PI * t) * 34 - 10 * t,  // y
      zN + (zS - zN) * t,                                    // z
    ];
    const P = [];
    const SEG = 12;
    const rails = [0, 0.25, 0.5, 0.75, 1].map(u => xW + (xE - xW) * u); // 屋根の稜線5本
    for (const x of rails) {
      for (let i = 0; i < SEG; i++) {
        const [y1, z1] = arch(i / SEG), [y2, z2] = arch((i + 1) / SEG);
        P.push(x, y1, z1, x, y2, z2);
      }
    }
    for (const t of [0, 0.25, 0.5, 0.75, 1]) { // 横つなぎ
      const [y, z] = arch(t);
      for (let r = 0; r < rails.length - 1; r++) {
        P.push(rails[r], y, z, rails[r + 1], y, z);
      }
    }
    const archGeo = new THREE.BufferGeometry();
    archGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    groundGroup.add(new THREE.LineSegments(archGeo, stMat));

    // 大屋根の面（ごく薄いシートを張って「駅の大屋根」に見せる）
    {
      const verts = [], idx = [];
      const COLS = rails.length;
      for (let i = 0; i <= SEG; i++) {
        const [y, z] = arch(i / SEG);
        for (const x of rails) verts.push(x, y, z);
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
      addBldgLabel('JR大阪駅', 750, 855, GROUND_Y + 78);
    }

    // JR線の高架橋: 航空写真に合わせて幅を変化させた帯で描く。
    // 駅部分(11面のホーム群)で大きく膨らみ、東は新大阪方面へ北東カーブしながら、
    // 西は塚本方面へ向かいながら細く収束する。地面の枠の端から端まで貫通させる
    const VIADUCT = [
      [30, 908, 16],    // 西端(マップ端)
      [400, 884, 24],
      [600, 862, 55],   // 駅の西端で急拡大
      [760, 855, 63],   // 駅中心
      [920, 850, 55],
      [1080, 826, 28],  // 駅の東で収束
      [1390, 770, 15],  // 東端(マップ端)
    ];
    const deckTop = GROUND_Y + 13;
    const interpV = mx => {
      for (let i = 0; i < VIADUCT.length - 1; i++) {
        const a = VIADUCT[i], b = VIADUCT[i + 1];
        if (mx >= a[0] && mx <= b[0]) {
          const t = (mx - a[0]) / (b[0] - a[0]);
          return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        }
      }
      const e = VIADUCT[VIADUCT.length - 1];
      return [e[1], e[2]];
    };
    {
      // デッキ面(可変幅ポリゴン)と外周ライン
      const upper = VIADUCT.map(([mx, my, hw]) => M2W([mx, my - hw]));
      const lower = VIADUCT.map(([mx, my, hw]) => M2W([mx, my + hw]));
      const shape = new THREE.Shape();
      shape.moveTo(upper[0][0], -upper[0][1]);
      for (let i = 1; i < upper.length; i++) shape.lineTo(upper[i][0], -upper[i][1]);
      for (let i = lower.length - 1; i >= 0; i--) shape.lineTo(lower[i][0], -lower[i][1]);
      const deckMesh = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({ color: 0xbcd4ee, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide })
      );
      deckMesh.rotation.x = -Math.PI / 2;
      deckMesh.position.y = deckTop - 3;
      deckMesh.renderOrder = 2;
      groundGroup.add(deckMesh);
      const ring = [...upper, ...lower.slice().reverse()];
      const outlineGeo = new THREE.BufferGeometry().setFromPoints(
        ring.map(([wx, wz]) => new THREE.Vector3(wx, deckTop - 3, wz))
      );
      groundGroup.add(new THREE.LineLoop(outlineGeo, stMat));
      // 橋脚(帯の両縁に沿って)
      const pierP = [];
      for (let px = 70; px <= 1370; px += 85) {
        const [my, hw] = interpV(px);
        for (const py of [my - hw + 3, my + hw - 3]) {
          const [wx, wz] = M2W([px, py]);
          pierP.push(wx, GROUND_Y, wz, wx, deckTop - 6, wz);
        }
      }
      const pierGeo = new THREE.BufferGeometry();
      pierGeo.setAttribute('position', new THREE.Float32BufferAttribute(pierP, 3));
      groundGroup.add(new THREE.LineSegments(pierGeo, stMat));
    }

    // ホーム（高架デッキの上・大屋根の下）
    for (const [py1, py2] of [[840, 852], [862, 874]]) {
      const [hx1, hz1] = M2W([640, py1]);
      const [hx2, hz2] = M2W([860, py2]);
      const g = new THREE.BoxGeometry(Math.abs(hx2 - hx1), 5, Math.abs(hz2 - hz1));
      const w = new THREE.LineSegments(new THREE.EdgesGeometry(g), stMat);
      w.position.set((hx1 + hx2) / 2, deckTop + 2.5, (hz1 + hz2) / 2);
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

// 地図上の文字は施設名9つだけ（施設色の素のテキスト、装飾なし）
const zoneLabelDivs = {};
for (const [id, z] of Object.entries(ZONES)) {
  if (!z.label) continue;
  const [lx, lz] = M2W(z.label);
  const div = document.createElement('div');
  div.className = 'zone-label';
  div.textContent = z.name;
  div.style.color = '#' + z.color.toString(16).padStart(6, '0');
  const lab = new CSS2DObject(div);
  lab.position.set(lx, FLOOR_Y.B1 + 14, lz);
  floorGroups.B1.add(lab);
  floorLabelObjs.B1.push(lab);
  zoneLabelDivs[id] = div;
}

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
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: false });
  const mesh = new THREE.Mesh(geo, zoneMats[fp.zone] || corridorMat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = FLOOR_Y[fp.floor] - 1.5 + jitterY();
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

// エレベーターのアイコン: B2からB1上空まで貫く1本のシンプルな直方体(シャフト)
const evShaftGeo = new THREE.BoxGeometry(3.6, (FLOOR_Y.B1 - FLOOR_Y.B2) + 8, 3.6);

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
for (const v of VERTICALS) {
  // 接続先が駅(ホーム=改札内・フロア未描画)の設備は、B2側のアイコンだけ省略する。
  // EVシャフトはフロアを貫く柱なので常に描画(以前は丸ごとスキップしていてEVが1本も出ていなかった)
  const bIsStation = nodeById[v.b].type === 'station';

  const [x, z] = M2W([v.mx, v.my]);
  const yB1 = FLOOR_Y.B1, yB2 = FLOOR_Y.B2;
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

  if (v.type === 'ev') {
    // EV: フロアを貫く1本のシンプルな直方体(ビーム・パッドなし)
    const m = new THREE.Mesh(evShaftGeo, padMats.ev);
    m.position.set(x, yB2 + ((yB1 - yB2) + 8) / 2, z);
    vertGroup.add(m);
  } else {
    const beam = new THREE.Mesh(beamGeo, beamMats[v.type]);
    beam.position.set(x, (yB1 + yB2) / 2, z);
    vertGroup.add(beam);
    // 実際の進行方向: 下フロアのノード(b)から上フロアのノード(a)へ向かう
    // 水平ベクトルを「上り」とみなす。同じ位置に重なる館内設備は設備→aノード方向で代用
    const pa = nodeById[v.a], pb = nodeById[v.b];
    let dx = pa.x - pb.x, dz = pa.z - pb.z;
    if (Math.hypot(dx, dz) < 3) { dx = pa.x - x; dz = pa.z - z; }
    if (Math.hypot(dx, dz) < 1) { dx = 1; dz = 0; }
    const rotY = Math.atan2(-dz, dx);
    // 床スラブ(厚み3・中心が階の高さ+ジッタ最大0.375)の上面に着地させる
    const FLOOR_TOP = 1.9;
    for (const y of [yB1, yB2]) {
      if (bIsStation && y === yB2) continue; // 駅構内(未描画)側は省略
      if (v.type === 'esc') {
        // 実際の勾配の向き(上り=aノード方向)+フロアごとの形(B1=下り/B2=上り)
        const m = makeEscalator(y === yB1 ? 'B1' : 'B2', padMats.esc);
        m.rotation.y = rotY;
        m.position.set(x, y + FLOOR_TOP, z);
        vertGroup.add(m);
      } else {
        // 階段: 3段ステップのソリッド。上り方向へ向けて置く
        const m = new THREE.Mesh(stairsGeo, padMats.stairs);
        m.rotation.y = rotY;
        m.position.set(x, y + FLOOR_TOP, z);
        vertGroup.add(m);
      }
    }
  }

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
  // 広場は通路の「下」に敷く床面として描く（スラブ同士の露骨な重なりを避ける）
  mesh.position.set(x, FLOOR_Y[pl.floor] - 1.6 + jitterY() * 0.5, z);
  floorGroups[pl.floor].add(mesh);
}

// スポット（クリック対象）・ジャンクション・店舗
const nodeMeshes = [];
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
let camAnim = null; // ルート実行時のカメラ移動アニメーション
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
    const mesh = shopMeshById[id];
    if (!mesh) continue;
    const orig = mesh.material;
    const zone = ZONES[nodeById[id].zone];
    mesh.material = routeShopMatFor(nodeById[id].zone);
    mesh.scale.set(1.7, 2.2, 1.7);
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
    label.position.set(0, 6, 0);
    mesh.add(label);
    routeShopDecor.push({ mesh, mat: orig, label });
  }
}
function clearRouteShops() {
  for (const d of routeShopDecor) {
    d.mesh.material = d.mat;
    d.mesh.scale.set(1, 1, 1);
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
const shopNodesByFloor = { B1: [], B2: [] };
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
}

function showRoute(startId, goalId) {
  clearRoute();
  const result = dijkstra(startId, goalId);
  if (!result) return;
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

  const nearestShopTo = (x, z, floor, maxD = 22) => {
    let best = null, bd = maxD;
    for (const s of shopNodesByFloor[floor] || []) {
      if (passExclude.has(s.id)) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  };
  // i番目のノードでの曲がり方向（±32°未満は直進扱い）
  const turnAt = i => {
    const a = pathNodes[i - 1], b = pathNodes[i], c = pathNodes[i + 1];
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
      leg += posOf(prevN).distanceTo(posOf(n)) * UNIT_M;
      legSegs.push([prevN, n]);
    }
    if (labelDivs[n.id]) labelDivs[n.id].classList.add('on-route');

    // 施設の変わり目 = 「いま自分がどの施設にいるか」を伝える
    const ez = edgeZoneByPair[pairKey(prevN.id, n.id)];
    if (ez && ez !== curZone) {
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
      pushStep(`<div class="step stairs">${VERT_ICON[type]} ${anchorTxt}${VERT_LABEL[type]}で ${n.floor}Fへ${dirWord}${evNote}</div>`, n);
      continue;
    }

    const turn = turnAt(i);
    if (turn) {
      const shop = nearestShopTo(n.x, n.z, n.floor);
      if (shop) usedShopIds.add(shop.id); // 曲がり角に使った店は通過リストに再登場させない
      if (shop && !firstLandmark && steps.length === 0 && legSegs.length > 0) {
        firstLandmark = shortShopName(shop.name);
      }
      flushLeg();
      const anchor = shop ? `「${shortShopName(shop.name)}」の前で` :
        (n.type !== 'junction' ? `${n.name}で` : '突き当たり・分岐を');
      pushStep(`<div class="step turn">↪ ${anchor}${turn}へ曲がる</div>`, n);
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
    <div class="od-row">🧍 現在地: ${startN.name}（${startN.floor}F）</div>
    <div class="od-row goal">🏁 目的地: ${goalN.name}（${goalN.floor}F）</div>
  </div>`;
  html += `<div class="summary">🚶 約${Math.round(total)}m ・ 徒歩約${minutes}分</div>`;
  const startZoneTxt = startN.zone && ZONES[startN.zone] ? `（いまいる場所: ${ZONES[startN.zone].name} ${startN.floor}F）` : '';
  html += `<div class="step">🧍 「${startN.name}」を出発${startZoneTxt}${firstLandmark ? ` — 「${firstLandmark}」が見える方向へ` : ''}</div>`;
  html += steps.join('');
  html += `<div class="step" style="border-left-color:#ff5d8f">🏁 到着：${nodeById[goalId].name}</div>`;
  info.innerHTML = html;

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

  // 経路が通る施設だけを強調し、出発地が手前になる視点へ移動
  focusZonesForRoute(path);
  flyCameraToRoute(startId, goalId, path);
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
function makePicker(rootId) {
  const root = document.getElementById(rootId);
  const valueEl = root.querySelector('.picker-value'); // <input>
  const listEl = root.querySelector('.picker-list');
  let current = null;
  const opts = [];

  function set(id) {
    current = id;
    pickerSelection[rootId] = id;
    const n = nodeById[id];
    valueEl.value = `${n.name}（${n.floor}F）`;
    for (const o of opts) o.el.classList.toggle('selected', o.id === id);
    updateShopLabels();
  }

  for (const n of NAMED) {
    const el = document.createElement('div');
    el.className = 'opt' + (n.type === 'shop' ? ' shop-opt' : '');
    el.dataset.id = n.id;
    el.textContent = `${n.name}（${n.floor}F）`;
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
    opts.push({ id: n.id, el, text: (n.name + ' ' + (n.aliases || []).join(' ')).toLowerCase() });
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
    if (input && n) input.value = `${n.name}（${n.floor}F）`;
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
const detailChip = document.getElementById('chip-detail');
let detailShown = true;
detailChip.addEventListener('click', () => {
  detailShown = !detailShown;
  labelsContainer.style.display = detailShown ? '' : 'none';
  for (const m of shopMeshes) m.visible = detailShown;
  detailChip.classList.toggle('off', !detailShown);
});

// 地上のビル・駅舎・高架の一括表示切替
const bldgChip = document.getElementById('chip-buildings');
let bldgShown = true;
bldgChip.addEventListener('click', () => {
  bldgShown = !bldgShown;
  groundGroup.visible = bldgShown;
  for (const lab of groundLabelObjs) lab.visible = bldgShown; // CSS2Dは親のvisibleに連動しない
  bldgChip.classList.toggle('off', !bldgShown);
});


for (const chip of document.querySelectorAll('#floor-toggle .chip')) {
  if (!chip.dataset.floor) continue;
  chip.addEventListener('click', () => {
    const floor = chip.dataset.floor;
    const g = floorGroups[floor];
    g.visible = !g.visible;
    chip.classList.toggle('off', !g.visible);
    for (const lab of floorLabelObjs[floor]) lab.visible = g.visible;
  });
}

// クリックで出発地・目的地を選択
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let clickPhase = 0;
let downAt = null;
renderer.domElement.addEventListener('pointerdown', e => {
  downAt = [e.clientX, e.clientY];
  camAnim = null; // 手動操作が始まったら自動カメラ移動は中断
  // 地図に触れたら入力モードを終了（キーボードも閉じる）
  if (document.body.classList.contains('picker-editing')) {
    document.activeElement?.blur?.();
  }
});
renderer.domElement.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(nodeMeshes.filter(m => m.parent.visible))[0];
  if (!hit) return;
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
    if (p >= 1) camAnim = null;
  }
  if (routeCurve && markers.length) {
    markers.forEach((m, i) => {
      const u = (t * 0.06 + i / markers.length) % 1;
      m.position.copy(routeCurve.getPointAt(u));
    });
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
