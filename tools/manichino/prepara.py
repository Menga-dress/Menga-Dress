"""Prepara il manichino dell'anteprima da un'immagine "maschera" a colori pieni.

L'immagine (fatta con ChatGPT) ha i capi in colori puri: giacca rossa, maglia verde, pantaloni blu,
scarpe gialle; tutto il resto è scuro. Da qui si ricavano:
  - <nome>.jpg      la base: manichino e sfondo, con i capi resi grigi (solo luce e ombra)
  - <nome>-zone.png R = zona (60 giacca, 120 maglia, 180 pantaloni, 240 scarpe),
                    G = luce del tessuto (128 = colore pieno, sotto ombra, sopra luce),
                    B = copertura del capo (255 pieno, meno sui bordi)
Uso: python3 tools/manichino/prepara.py tools/manichino/casual-maschera.png web/img/manichino/casual [--cerchio]
Con --cerchio aggiunge il cerchio dorato dietro il manichino (per le immagini che non ce l'hanno).
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

W, H = 640, 960
src, out = sys.argv[1], sys.argv[2]
ring = '--cerchio' in sys.argv[3:]
im = Image.open(src).convert('RGB').resize((W, H), Image.LANCZOS)
a = np.asarray(im).astype(np.float32) / 255
mx, mn = a.max(2), a.min(2)
v = mx
s = np.where(mx > 1e-3, (mx - mn) / np.maximum(mx, 1e-3), 0)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
d = np.maximum(mx - mn, 1e-6)
h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60

zone = np.zeros((H, W), np.uint8)
garment = (s > 0.35) & (v > 0.1)
zone[garment & ((h < 25) | (h > 335))] = 1           # rosso: giacca
zone[garment & (h >= 75) & (h < 170)] = 2            # verde: maglia
zone[garment & (h >= 200) & (h < 265)] = 3           # blu: pantaloni
zone[garment & (h >= 40) & (h < 75)] = 4             # giallo: scarpe

# Il bordo dorato del cerchio e del piedistallo è giallo-arancio ma poco saturo o sottile:
# tieni solo le zone grandi (componenti connesse sopra una soglia).
def keep_big(mask, min_px):
    from collections import deque
    lab = np.zeros(mask.shape, np.int32); keep = np.zeros(mask.shape, bool); n = 0
    hh, ww = mask.shape
    for y0, x0 in zip(*np.nonzero(mask)):
        if lab[y0, x0]:
            continue
        n += 1; q = deque([(y0, x0)]); lab[y0, x0] = n; pix = []
        while q:
            y, x = q.popleft(); pix.append((y, x))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                yy, xx = y + dy, x + dx
                if 0 <= yy < hh and 0 <= xx < ww and mask[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = n; q.append((yy, xx))
        if len(pix) >= min_px:
            ys, xs = zip(*pix); keep[list(ys), list(xs)] = True
    return keep

# Pezzi piccoli: restano se sono vicini al capo principale (polsini, nappine, gamba dietro la borsa),
# altrimenti si scartano (fazzoletto nel taschino, riflessi del bordo dorato).
for z in (1, 2, 3, 4):
    m = zone == z
    big = keep_big(m, {3: 1500, 4: 300}.get(z, 60))
    near = np.asarray(Image.fromarray((big * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(51))) > 0
    small = m & ~big & keep_big(m & ~big, 20)
    zone[m & ~big] = 0
    zone[small & near] = z

# Buchi dentro un capo (riflessi chiari del jeans, cuciture): li chiude se il pixel non è scuro
# come il manichino.
HUES = {1: ((h < 25) | (h > 335)), 2: ((h >= 75) & (h < 170)), 3: ((h >= 190) & (h < 270)), 4: ((h >= 28) & (h < 75))}
for z in (1, 2, 3, 4):
    k = 9 if z == 4 else 21  # scarpe: solo buchi piccoli (nappine, lacci), per non prendere il piedistallo
    m = Image.fromarray(((zone == z) * 255).astype(np.uint8))
    closed = np.asarray(m.filter(ImageFilter.MaxFilter(k)).filter(ImageFilter.MinFilter(k))) > 0
    fill = closed & (zone == 0) & ((HUES[z] & (s > 0.2) & (v > 0.03)) | ((v > 0.18) & (s < 0.35)))
    zone[fill] = z

# Riflesso delle scarpe sul piedistallo: giallo meno saturo appena sotto le scarpe.
ys, xs = np.nonzero(zone == 4)
if len(ys):
    near = np.zeros((H, W), bool)
    near[ys.max() - 30:min(H, ys.max() + 28), max(0, xs.min() - 6):xs.max() + 6] = True
    refl = near & (zone == 0) & (s > 0.4) & (v > 0.08) & (h >= 36) & (h < 72)
    zone[refl] = 4

# Luce: luminosità rispetto al colore pieno della zona.
shade = np.zeros((H, W), np.float32)
for z in (1, 2, 3, 4):
    m = zone == z
    if m.any():
        ref = np.percentile(v[m], 80)
        shade[m] = v[m] / ref
G = np.clip(shade * 128, 0, 255)

# Copertura morbida sui bordi: più il pixel è saturo, più è capo.
cover = np.where(garment, np.clip((s - 0.2) / 0.3, 0, 1), 1.0) * (zone > 0)
# Allarga di un pixel la zona per coprire i bordi sfumati del disegno originale.
zimg = Image.fromarray(zone * 60).filter(ImageFilter.MaxFilter(3))
zone_d = np.asarray(zimg) // 60
edge = (zone == 0) & (zone_d > 0) & (s > 0.15)
cover = np.where(edge, np.clip((s - 0.12) / 0.4, 0, 1), cover)
zone = np.where(edge, zone_d, zone)
shade_e = np.where(edge, v / 0.8, 0)
G = np.where(edge, np.clip(shade_e * 128, 0, 255), G)

zpng = np.stack([zone * 60, G, cover * 255], 2).astype(np.uint8)
Image.fromarray(zpng).save(out + '-zone.png', optimize=True)

# Base: dove c'è un capo resta solo la luce in grigio scuro (il colore lo mette l'app).
gray = (v * 0.35)[..., None].repeat(3, 2)
base = np.where((zone > 0)[..., None], gray, a)
if ring:
    from PIL import ImageDraw
    # Sfondo = nero collegato ai bordi dell'immagine; tutto il resto (manichino, capi, piedistallo) sta davanti.
    solid = (v > 0.05) | (zone > 0)
    solid = np.asarray(Image.fromarray((solid * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))) > 0
    m = Image.fromarray(np.where(solid, 0, 255).astype(np.uint8)).copy()
    for seed in ((0, 0), (W - 1, 0), (0, H // 2), (W - 1, H // 2)):
        if m.getpixel(seed) == 255:
            ImageDraw.floodfill(m, seed, 128)
    bg = np.asarray(m) == 128
    bg = np.asarray(Image.fromarray((bg * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3))) > 0
    # Cerchio come nelle altre immagini: centro sopra il bacino, raggio fino ai fianchi del busto.
    cx, cy, r = W / 2, H * 0.377, W * 0.435
    layer = Image.new('L', (W, H), 0)
    ImageDraw.Draw(layer).ellipse([cx - r, cy - r, cx + r, cy + r], outline=255, width=2)
    core = np.asarray(layer).astype(np.float32) / 255
    glow = np.asarray(layer.filter(ImageFilter.GaussianBlur(6))).astype(np.float32) / 255
    gold = np.array([0.93, 0.70, 0.38])
    add = (core[..., None] * 0.8 + glow[..., None] * 0.6) * gold
    base = np.where(bg[..., None], np.clip(base + add, 0, 1), base)
Image.fromarray((base * 255).astype(np.uint8)).save(out + '.jpg', quality=88)
print('ok', {z: int((zone == z).sum()) for z in (1, 2, 3, 4)})
