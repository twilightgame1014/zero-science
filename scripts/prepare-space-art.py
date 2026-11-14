"""Build deployable icons/colour maps from generated masters; no normal-map fabrication."""
from PIL import Image
from pathlib import Path
import json,os
root=Path(__file__).resolve().parents[1];base=root/'assets/rocket';out=root/'assets/build/rocket';out.mkdir(parents=True,exist_ok=True)
source=Path(os.environ.get('SPACE_ART_SOURCE',str(base)))
icons=sorted((source/'icons').glob('*.png'));cols=8;rows=(len(icons)+cols-1)//cols
atlas=Image.new('RGBA',(cols*64,max(1,rows)*64));positions={}
for n,p in enumerate(icons):
 im=Image.open(p).convert('RGBA');a=im.getchannel('A');b=a.point(lambda v:255 if v>16 else 0).getbbox()
 if not b:raise ValueError('empty icon '+p.name)
 im=im.crop(b);im.thumbnail((52,52),Image.Resampling.LANCZOS);x=n%cols*64+(64-im.width)//2;y=n//cols*64+(64-im.height)//2;atlas.alpha_composite(im,(x,y));positions[p.stem]=[n%cols,n//cols]
 # Deliver uniform 256px transparent icons without modifying source masters.
 icon=Image.open(p).convert('RGBA').crop(b);icon.thumbnail((208,208),Image.Resampling.LANCZOS);canvas=Image.new('RGBA',(256,256));canvas.alpha_composite(icon,((256-icon.width)//2,(256-icon.height)//2));canvas.save(out/(p.stem+'.png'))
atlas.save(out/'icons.webp',quality=90,method=6);(out/'icons.json').write_text(json.dumps({'cols':cols,'rows':rows,'items':positions}))
spec={'tex-rocket-skin':(2048,1024,'x'),'tex-capsule-skin':(1024,512,'x'),'tex-metal-dull':(1024,1024,'xy'),'tex-insulation':(1024,512,'x'),'tex-heat-resistant':(1024,1024,'xy'),'tex-suit-cloth':(1024,1024,'xy'),'tex-suit-reinforce':(1024,1024,'xy'),'tex-rubber-seal':(512,512,'xy'),'tex-circuit-board':(1024,1024,''),'tex-terminal-screen':(1024,640,'')}
report=[]
for name,(w,h,tile) in spec.items():
 p=source/'textures'/(name+'.png')
 if not p.exists():continue
 im=Image.open(p).convert('RGB').resize((w,h),Image.Resampling.LANCZOS)
 # Symmetric edge blend makes opposite edge pixels identical. Seam appearance is also reviewed in 2x2 previews.
 for axis in (tile if source!=base else ''):
  if axis=='y':im=im.transpose(Image.Transpose.TRANSPOSE)
  px=im.load();width,height=im.size;band=16
  for y in range(height):
   edge=tuple(round((px[0,y][k]+px[width-1,y][k])/2) for k in range(3))
   for j in range(band):
    weight=(1-j/band)**2
    for x in (j,width-1-j):px[x,y]=tuple(round(px[x,y][k]*(1-weight)+edge[k]*weight) for k in range(3))
  if axis=='y':im=im.transpose(Image.Transpose.TRANSPOSE)
 im.save(out/(name+'.png'))
 small=im.copy();small.thumbnail((512,512));small.save(out/(name+'.webp'),quality=84,method=6)
 report.append({'id':name,'size':[w,h],'tile':tile,'alpha':False,'edgeProcessed':bool(tile),'runtimeSize':small.size})
for p in sorted((source/'textures').glob('fx-exhaust-*.png')):
 im=Image.open(p).convert('RGBA').resize((512,512),Image.Resampling.LANCZOS);im.save(out/p.name);im.resize((256,256),Image.Resampling.LANCZOS).save(out/(p.stem+'-mobile.png'));im.resize((256,256),Image.Resampling.LANCZOS).save(out/(p.stem+'.webp'),quality=86,method=6)
 report.append({'id':p.stem,'size':[512,512],'mobileSize':[256,256],'alpha':True,'animation':False})
(root/'docs/space/art-processing.json').write_text(json.dumps({'icons':len(icons),'textures':report},indent=2))
print('Prepared icons',len(icons),'textures',len(report))
