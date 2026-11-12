# Crea web/img/manichino.jpg e web/img/manichino-zone.png (R=zona, G=ombre, B=trasparenza).
# Uso: python3 tools/manichino_zone_build.py manichino-originale.png
import sys
import numpy as np
from PIL import Image, ImageFilter
reg=np.load('/tmp/manichino-reg.npy'); H,W=reg.shape
base=Image.open(sys.argv[1]).convert('RGB')
w,h=512,768
B=base.resize((w,h),Image.LANCZOS)
Y=np.asarray(B.convert('L')).astype(float)/255
R=np.zeros((h,w),np.uint8); A=np.zeros((h,w))
for i in [1,2,3,4]:
  m=Image.fromarray(((reg==i)*255).astype(np.uint8))
  m=m.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7))  # chiude i buchi
  m=m.filter(ImageFilter.MinFilter(3))  # niente aloni ai bordi
  m=m.resize((w,h),Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.8))
  a=np.asarray(m).astype(float)/255
  sel=a>A
  R[sel]=i; A=np.maximum(A,a)
G=np.full((h,w),128.0)
for i in [1,2,3,4]:
  m=(R==i)&(A>0.5); y=Y[m]; med=np.median(y); sp=max(np.percentile(y,90)-np.percentile(y,10),0.02)
  t=np.clip((Y-med)/sp,-1.6,1.6); G[R==i]=128+t[R==i]*75
  print(i,round(med,3),round(sp,3))
mp=np.dstack([R*60,np.clip(G,0,255),A*255]).astype(np.uint8)
Image.fromarray(mp).save('web/img/manichino-zone.png',optimize=True)
B.save('web/img/manichino.jpg',quality=86,optimize=True,progressive=True)
