"""Delivery derivatives only: preserve canonical GLBs, nodes, transforms and geometry.
Convert embedded images to WebP (max 512); keep each buffer view's non-image bytes.
Run with Pillow. Generated files are committed so build needs no Python.
"""
from pathlib import Path
import struct,json,io
from PIL import Image
root=Path(__file__).resolve().parents[1]
out=root/'assets/build/construction';out.mkdir(parents=True,exist_ok=True)
for src in (root/'assets/construction/models').glob('*.glb'):
 b=src.read_bytes();ln=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+ln]);binary=b[28+ln:];images={im['bufferView']:im for im in j.get('images',[])};new=bytearray()
 for i,v in enumerate(j['bufferViews']):
  raw=binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
  if i in images:
   im=Image.open(io.BytesIO(raw));im.thumbnail((512,512));buf=io.BytesIO();im.save(buf,format='WEBP',quality=88);raw=buf.getvalue();images[i]['mimeType']='image/webp'
  new.extend(b'\0'*(-len(new)%4));v['byteOffset']=len(new);v['byteLength']=len(raw);new.extend(raw)
 new.extend(b'\0'*(-len(new)%4));j['buffers']=[{'byteLength':len(new)}];js=json.dumps(j,separators=(',',':')).encode();js+=b' '*(-len(js)%4)
 (out/src.name).write_bytes(struct.pack('<III',0x46546c67,2,28+len(js)+len(new))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(new),0x004e4942)+new)
 print(src.name,len(b),'->',28+len(js)+len(new))
