# Crea per ogni occasione web/img/manichini/<occasione>.jpg (base) e <occasione>-zone.png
# (R = zona: 60 capospalla, 120 maglia, 180 pantaloni, 240 scarpe; G = luce/ombra; B = bordo morbido).
# Le zone si trovano dentro poligoni a mano (config.json, coordinate su una vista alta 1000 px)
# scegliendo i pixel più vicini ai colori-campione del capo che a quelli di pelle e sfondo.
# Uso, dalla cartella del progetto: python3 tools/manichini/zone.py
import json, sys, numpy as np
from PIL import Image, ImageDraw, ImageFilter
# zone ids: 1 outer, 2 top, 3 bottom, 4 shoes
def segment(cfg):
    im = Image.open(cfg['src']).convert('RGB')
    W, H = im.size
    s = cfg.get('scale', 1000 / H)   # display coords -> pixel
    a0 = np.asarray(im).astype(float)
    Yc = 0.299*a0[...,0]+0.587*a0[...,1]+0.114*a0[...,2]
    a = np.dstack([Yc*cfg.get('ywt',0.5), (a0[...,2]-Yc)*0.564*1.6, (a0[...,0]-Yc)*0.713*1.6])
    def patch(x, y):
        x, y = int(x / s), int(y / s)
        return a[max(0,y-2):y+3, max(0,x-2):x+3].reshape(-1, 3).mean(0)
    others = [patch(*p) for p in cfg['other']]
    reg = np.zeros((H, W), np.uint8)
    for z in cfg['zones']:
        pm = Image.new('L', (W, H), 0)
        for poly in z['polys']:
            ImageDraw.Draw(pm).polygon([(x / s, y / s) for x, y in poly], fill=255)
        inside = np.asarray(pm) > 0
        seeds = [patch(*p) for p in z['seeds']]
        dg = np.min([np.linalg.norm(a - c, axis=-1) for c in seeds], axis=0)
        do = np.min([np.linalg.norm(a - c, axis=-1) for c in others + [patch(*p) for p in z.get('other', [])]], axis=0)
        m = inside & (dg * z.get('bias', cfg.get('bias', 0.6)) < do)
        if cfg.get('exclude'):
            em = Image.new('L', (W, H), 0)
            for poly in cfg['exclude']:
                ImageDraw.Draw(em).polygon([(x / s, y / s) for x, y in poly], fill=255)
            m &= ~(np.asarray(em) > 0)
        reg[m] = z['id']
    return im, reg

def build(cfg, out_base, out_zone, w=512, h=768):
    im, reg = segment(cfg)
    if 'patch' in cfg:   # copre icone dell'interfaccia
        s = cfg.get('scale', 1000 / im.size[1])
        for (x0, y0, x1, y1, dx) in cfg['patch']:
            box = tuple(int(v / s) for v in (x0, y0, x1, y1)); src = tuple(int(v / s) for v in (x0 - dx, y0, x1 - dx, y1))
            im.paste(im.crop(src).filter(ImageFilter.GaussianBlur(3)), box[:2])
    B = im.resize((w, h), Image.LANCZOS)
    Y = np.asarray(B.convert('L')).astype(float) / 255
    R = np.zeros((h, w), np.uint8); A = np.zeros((h, w))
    for i in [1, 2, 3, 4]:
        m = Image.fromarray(((reg == i) * 255).astype(np.uint8))
        k = cfg.get('close', 5); m = m.filter(ImageFilter.MaxFilter(k)).filter(ImageFilter.MinFilter(k)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
        m = m.resize((w, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.8))
        al = np.asarray(m).astype(float) / 255
        sel = al > A; R[sel] = i; A = np.maximum(A, al)
    G = np.full((h, w), 128.0)
    for i in [1, 2, 3, 4]:
        m = (R == i) & (A > 0.5)
        if m.sum() < 50: continue
        y = Y[m]; med = np.median(y); sp = max(np.percentile(y, 90) - np.percentile(y, 10), 0.05)
        t = np.clip((Y - med) / sp, -1.6, 1.6); G[R == i] = 128 + t[R == i] * 75
    Image.fromarray(np.dstack([R * 60, np.clip(G, 0, 255), A * 255]).astype(np.uint8)).save(out_zone, optimize=True)
    B.save(out_base, quality=86, optimize=True, progressive=True)

def overlay(cfg, out):
    im, reg = segment(cfg)
    col = np.array([[0,0,0],[255,0,0],[0,255,0],[0,0,255],[255,255,0]], np.uint8)
    o = np.asarray(im).copy(); m = reg > 0; o[m] = (o[m] * 0.35 + col[reg[m]] * 0.65).astype(np.uint8)
    Image.fromarray(o).resize((333, 500)).save(out)

if __name__ == '__main__':
    cfgs = json.load(open('tools/manichini/config.json'))
    for k, cfg in cfgs.items():
        build(cfg, f'web/img/manichini/{k}.jpg', f'web/img/manichini/{k}-zone.png')
        print('ok', k)
