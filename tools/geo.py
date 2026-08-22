"""座標の土台(metric-v1)。geo.js と同じ変換。定数は tools/data/frame.json が正。

mx,my = 原点からの東向き・南向きのメートル(北が上)。数値1 = 1m。
"""
import json
import math
import os
import re

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
FRAME = json.load(open(os.path.join(_HERE, 'data', 'frame.json')))
LAT0, LON0, OX, OY = FRAME['lat0'], FRAME['lon0'], FRAME['ox'], FRAME['oy']
KX = 111320 * math.cos(math.radians(LAT0))
KY = 110950


def ll2m(lat, lon):
    """緯度経度 → (mx, my)"""
    return ((lon - LON0) * KX + OX, -(lat - LAT0) * KY + OY)


def m2ll(mx, my):
    """(mx, my) → (lat, lon)"""
    return (LAT0 - (my - OY) / KY, LON0 + (mx - OX) / KX)


def _check_js_matches():
    """geo.js の定数が frame.json と食い違っていたら落とす(二重管理の事故防止)"""
    src = open(os.path.join(_ROOT, 'geo.js')).read()
    for key in ('lat0', 'lon0', 'ox', 'oy'):
        m = re.search(rf"\b{key}:\s*(-?[\d.]+)", src)
        assert m and abs(float(m.group(1)) - FRAME[key]) < 1e-9, f'geo.js の {key} が frame.json と不一致'
    m = re.search(r"name:\s*'([^']+)'", src)
    assert m and m.group(1) == FRAME['name'], 'geo.js の name が frame.json と不一致'


_check_js_matches()
