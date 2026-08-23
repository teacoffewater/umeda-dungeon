#!/usr/bin/env python3
"""現地写真を縮小して photos/ に置き、調査記録(JSON)と撮影時刻で突き合わせる。

使い方: python3 tools/add_photos.py <写真フォルダ> [調査記録.json ...]
  - 写真(JPEG/HEIC→JPEG変換済み/PNG)を長辺800px・品質80で photos/<元ファイル名>.jpg に保存
  - EXIFの撮影時刻と記録の ts を比較し、±3分以内の記録候補を表示(landmarks.js への追記は手で行う)
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'photos')
JST = timezone(timedelta(hours=9))

src_dir = sys.argv[1]
records = []
for jp in sys.argv[2:]:
    for r in json.load(open(jp)).get('records', []):
        records.append(r)
os.makedirs(OUT, exist_ok=True)


def shot_time(im):
    try:
        exif = im.getexif()
        v = exif.get(36867) or exif.get(306)  # DateTimeOriginal / DateTime
        if v:
            return datetime.strptime(v, '%Y:%m:%d %H:%M:%S').replace(tzinfo=JST)
    except Exception:
        pass
    return None


for name in sorted(os.listdir(src_dir)):
    if not name.lower().endswith(('.jpg', '.jpeg', '.png')):
        continue
    path = os.path.join(src_dir, name)
    im = Image.open(path)
    t = shot_time(im)
    im = ImageOps.exif_transpose(im).convert('RGB')
    im.thumbnail((800, 800))
    out_name = os.path.splitext(name)[0].lower() + '.jpg'
    im.save(os.path.join(OUT, out_name), 'JPEG', quality=80, optimize=True)
    size = os.path.getsize(os.path.join(OUT, out_name)) // 1024
    near = []
    if t:
        for r in records:
            rt = datetime.fromisoformat(r['ts'].replace('Z', '+00:00'))
            dt = abs((rt - t).total_seconds())
            if dt <= 180:
                near.append((int(dt), r))
    near.sort(key=lambda x: x[0])
    print(f"photos/{out_name}  {size}KB  撮影 {t.strftime('%H:%M:%S') if t else '不明'}")
    for dt, r in near[:3]:
        print(f"    候補(±{dt}s): {r['type']} {r.get('zone')} {r.get('floorSign')} px={r.get('px')} note={r.get('note', '')[:30]}")
