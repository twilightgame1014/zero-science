"""Normalize AI sprite cells to the existing registration contract, preserving alpha."""
from PIL import Image
from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]
report=[]
for hero in ('boy','girl'):
 im=Image.open(root/f'assets/hero/source/{hero}-suit-generated.png').convert('RGBA')
 sheet=Image.new('RGBA',(1024,2048))
 for row in range(8):
  for col in range(4):
   cell=im.crop((round(col*im.width/4),round(row*im.height/8),round((col+1)*im.width/4),round((row+1)*im.height/8)))
   # RGB outside alpha is intentionally not used: generated transparent RGB can contain saturated values.
   alpha=cell.getchannel('A').point(lambda a: a if a>=16 else 0);cell.putalpha(alpha)
   bounds=alpha.getbbox()
   if not bounds: raise ValueError(f'Missing {hero} {row} {col}')
   cut=cell.crop(bounds);cut=cut.resize((round(cut.width*200/cut.height),200),Image.Resampling.LANCZOS)
   # Pixel-style outline and deterministic baseline: discard very faint resampling halo.
   cut.putalpha(cut.getchannel('A').point(lambda a:a if a>=16 else 0))
   bounds=cut.getchannel('A').getbbox();cut=cut.crop(bounds)
   if cut.height!=200:cut=cut.resize((cut.width,200),Image.Resampling.NEAREST)
   x=round(127.5-cut.width/2); y=228-cut.height
   sheet.alpha_composite(cut,(col*256+x,row*256+y))
   report.append({'hero':hero,'row':row,'column':col,'height':cut.height,'bottom':228,'width':cut.width})
 out=root/f'assets/hero/player-spritesheet-{hero}-suit-8dir.png';sheet.save(out)
 (root/'assets/build/hero').mkdir(exist_ok=True,parents=True)
 sheet.save(root/f'assets/build/hero/{hero}-suit-8dir.webp',quality=86,method=6)
(root/'docs/space/sprite-registration.json').write_text(json.dumps(report,indent=2))
