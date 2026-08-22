"""調査記録JSON(?survey=1 の書き出し)の座標フレームを metric-v1 に揃える。

使い方: python3 tools/convert_survey.py 記録.json [出力.json]
  frame が legacy-px-v1(旧案内図px) の記録を metric-v1(メートル) に変換する。
  すでに metric-v1 ならそのまま出力する。
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '_archive'))
from old_affine import old_px_to_metric  # noqa: E402


def convert(doc):
    frame = doc.get('frame')
    if frame == 'metric-v1':
        return doc
    if frame != 'legacy-px-v1':
        raise SystemExit(f'未知の frame: {frame}')
    for r in doc.get('records', []):
        for key in ('px', 'px2', 'exitPx'):
            if r.get(key):
                x, y = old_px_to_metric(*r[key])
                r[key] = [round(x, 1), round(y, 1)]
    doc['frame'] = 'metric-v1'
    doc['converted_from'] = 'legacy-px-v1'
    return doc


if __name__ == '__main__':
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else src.replace('.json', '.metric.json')
    doc = convert(json.load(open(src)))
    json.dump(doc, open(out, 'w'), ensure_ascii=False, indent=1)
    print(f'{len(doc.get("records", []))} 件 → {out} (frame={doc["frame"]})')
