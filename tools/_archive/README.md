# 旧座標系(FC2案内図px)時代のツール
metric-v1(メートル格子)への移行(2026-08-23)で使えなくなったもの。案内図の画像に重ねる前提だったため。
- make_edit_layers.py / gen_edit_svg.py / 編集シート_三番街_ホワイティ.svg: 編集シート(Illustrator/Photoshop)ワークフロー。現地調査モード(?survey=1)に置き換え
- old_affine.py: 旧アフィン(lat/lon→旧px)。調査記録(frame: legacy-px-v1)の変換に migrate_frame.py が使う
