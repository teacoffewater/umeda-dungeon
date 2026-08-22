"""旧座標系(FC2案内図px)のアフィン。lat/lon → 旧px。metric-v1 移行前のデータを変換するときだけ使う"""
import math
LAT0 = 34.702
MX = [0.9016776456322585, 0.029513667767732826, 843.3902886095399]
MY = [0.03970669489516974, -1.1219829189908253, 944.3469058365063]
DET = MX[0] * MY[1] - MX[1] * MY[0]

def to_old_px(lat, lon):
    x = (lon - 135.497) * 111320 * math.cos(math.radians(LAT0))
    y = (lat - LAT0) * 110950
    return (MX[0] * x + MX[1] * y + MX[2], MY[0] * x + MY[1] * y + MY[2])

def old_px_to_metric(px, py, ox=843.39, oy=944.35):
    ux, uy = px - MX[2], py - MY[2]
    xm = (ux * MY[1] - MX[1] * uy) / DET
    ym = (MX[0] * uy - ux * MY[0]) / DET
    return (xm + ox, -ym + oy)
