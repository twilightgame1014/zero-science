"""Lite derivative of a staged town GLB for the game build.

Same treatment as scripts/prepare-construction.py (delivery
derivatives only): geometry, nodes and transforms are preserved
byte-for-byte; embedded images are converted to WebP (max 512)
so the single-file build does not carry the raw PNG textures.

Usage: python3 convert-staged-lite.py <src.glb> <dst.glb> [...]
(Pillow required.)
"""
from pathlib import Path
import struct, json, io, sys
from PIL import Image

def convert(src: Path, dst: Path) -> None:
    b = src.read_bytes()
    ln = struct.unpack_from('<I', b, 12)[0]
    j = json.loads(b[20:20 + ln])
    binary = b[28 + ln:]
    images = {im['bufferView']: im for im in j.get('images', [])}
    new = bytearray()
    for i, v in enumerate(j['bufferViews']):
        raw = binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
        if i in images:
            im = Image.open(io.BytesIO(raw))
            im.thumbnail((512, 512))
            buf = io.BytesIO()
            im.save(buf, format='WEBP', quality=88)
            raw = buf.getvalue()
            images[i]['mimeType'] = 'image/webp'
        new.extend(b'\0' * (-len(new) % 4))
        v['byteOffset'] = len(new)
        v['byteLength'] = len(raw)
        new.extend(raw)
    new.extend(b'\0' * (-len(new) % 4))
    j['buffers'] = [{'byteLength': len(new)}]
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    dst.write_bytes(struct.pack('<III', 0x46546c67, 2, 28 + len(js) + len(new))
                    + struct.pack('<II', len(js), 0x4e4f534a) + js
                    + struct.pack('<II', len(new), 0x004e4942) + new)
    print(dst, len(b), '->', 28 + len(js) + len(new))

if __name__ == '__main__':
    args = sys.argv[1:]
    for k in range(0, len(args) - 1, 2):
        convert(Path(args[k]), Path(args[k + 1]))
