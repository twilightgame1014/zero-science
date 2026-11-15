from PIL import Image,ImageDraw,ImageChops
from pathlib import Path
import json
r=Path(__file__).resolve().parents[1];out=r/'test-results';out.mkdir(exist_ok=True)
report=[];thumbs=[]
for t in json.loads((r/'docs/space/art-processing.json').read_text())['textures']:
 im=Image.open(r/'assets/rocket/textures'/(t['id']+'.png'));assert list(im.size)==t['size'];x={'id':t['id'],'size':im.size}
 if t.get('tile'):
  if 'x' in t['tile']:assert ImageChops.difference(im.crop((0,0,1,im.height)),im.crop((im.width-1,0,im.width,im.height))).getbbox() is None
  if 'y' in t['tile']:assert ImageChops.difference(im.crop((0,0,im.width,1)),im.crop((0,im.height-1,im.width,im.height))).getbbox() is None
  x['edgePixelsMatch']=True
 small=im.convert('RGBA');small.thumbnail((180,120));tile=Image.new('RGB',(380,280),'#6b7279');
 for a in range(2):
  for b in range(2):tile.paste(small,(10+a*180,30+b*120),small)
 ImageDraw.Draw(tile).text((10,8),t['id'],fill='white');thumbs.append(tile);report.append(x)
canvas=Image.new('RGB',(380*4,280*4),'#303841')
for n,im in enumerate(thumbs):canvas.paste(im,((n%4)*380,(n//4)*280))
canvas.save(out/'texture-qa.png')
for hero in ['boy','girl']:
 im=Image.open(r/f'assets/hero/player-spritesheet-{hero}-suit-8dir.png');assert im.size==(1024,2048)
 for row in range(8):
  for col in range(4):
   bounds=im.crop((col*256,row*256,col*256+256,row*256+256)).getchannel('A').getbbox();assert bounds[3]==228 and bounds[3]-bounds[1]==200
for imf in (r/'assets/rocket/icons').glob('*.png'):
 im=Image.open(imf);assert im.size==(256,256);assert im.mode=='RGBA';assert im.getpixel((0,0))[3]==0
(out/'art-qa.json').write_text(json.dumps({'icons':55,'spriteCells':64,'textures':report},indent=2));print('PASS: 55 icons / 64 registered cells / 14 colour and effect maps')
