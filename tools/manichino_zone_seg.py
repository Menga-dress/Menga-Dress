# Ricava le zone dei capi (giacca, maglia, pantaloni, scarpe) dall'immagine del manichino.
# Uso: python3 tools/manichino_zone_seg.py manichino-originale.png  (poi manichino_zone_build.py)
import sys
import numpy as np
from PIL import Image, ImageFilter
im=np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(float)/255
H,W,_=im.shape
r,g,b=im[...,0],im[...,1],im[...,2]
mx=im.max(-1); mn=im.min(-1); v=mx; s=np.where(mx>0,(mx-mn)/np.maximum(mx,1e-6),0)
yy,xx=np.mgrid[0:H,0:W]
reg=np.zeros((H,W),np.uint8)
# 1 jacket, 2 tee, 3 trousers, 4 shoes
jbox=(xx>270)&(xx<705)&(yy>190)&(yy<660)
jacket=jbox&(((s>0.52)&(v<0.62))|((v<0.16)&(yy<640)))
tee=(xx>455)&(xx<605)&(yy>262)&(yy<655)&(s<0.46)&(v>0.33)
jacket=jacket&~tee
trous=(xx>330)&(xx<705)&(yy>630)&(yy<1360)&(v<0.33)&~jacket
shoeL=(xx>350)&(xx<450)&(yy>1335)&(yy<1435)
shoeR=(xx>512)&(xx<732)&(yy>1325)&(yy<1430)
from PIL import ImageDraw
pm=Image.new('L',(W,H),0); ImageDraw.Draw(pm).polygon([(531,1350),(545,1336),(575,1330),(610,1328),(645,1342),(690,1366),(722,1386),(731,1404),(727,1421),(700,1429),(560,1428),(533,1422),(529,1395)],fill=255)
shoeRpoly=np.asarray(pm)>0
shoes=(shoeL&(s<0.38)&(v>0.45))|(shoeRpoly&(v>0.3))
for i,m in [(1,jacket),(2,tee),(4,shoes),(3,trous)]: reg[m]=i
np.save('/tmp/manichino-reg.npy',reg)
