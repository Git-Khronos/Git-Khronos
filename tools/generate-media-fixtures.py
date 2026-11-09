#!/usr/bin/env python3
"""Generate original image fixtures; requires Pillow 12.1.1, not a runtime dependency."""
from pathlib import Path
import hashlib
import json
from PIL import Image, __version__

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / 'crates/git-core/tests/fixtures/media'


def main():
    if __version__ != '12.1.1':
        raise SystemExit(f'Fixture regeneration requires Pillow 12.1.1; found {__version__}')
    DESTINATION.mkdir(parents=True, exist_ok=True)
    image = Image.new('RGBA', (3, 2))
    image.putdata([
        (224, 48, 80, 255), (40, 176, 120, 255), (48, 96, 224, 255),
        (248, 208, 64, 128), (104, 64, 160, 0), (240, 240, 240, 255),
    ])
    image.save(DESTINATION / 'tiles.png')
    image.convert('RGB').save(DESTINATION / 'tiles.jpg', quality=90, subsampling=0)
    exif = Image.Exif()
    exif[274] = 6
    image.convert('RGB').save(DESTINATION / 'rotated.jpg', quality=90, subsampling=0, exif=exif)
    image.save(DESTINATION / 'tiles.webp', lossless=True)
    image.convert('RGB').save(DESTINATION / 'tiles.bmp')
    image.save(DESTINATION / 'tiles.gif', save_all=True,
               append_images=[image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)],
               duration=[100, 100], loop=0)
    icon = Image.new('RGBA', (16, 16), (48, 96, 224, 255))
    for x in range(4, 12):
        for y in range(4, 12):
            icon.putpixel((x, y), (224, 48, 80, 128))
    icon.save(DESTINATION / 'tiles.ico', sizes=[(16, 16)])
    records = []
    for path in sorted(DESTINATION.iterdir()):
        if path.suffix not in {'.png', '.jpg', '.webp', '.bmp', '.gif', '.ico'}:
            continue
        data = path.read_bytes()
        with Image.open(path) as loaded:
            records.append({'file': path.name, 'bytes': len(data),
                            'sha256': hashlib.sha256(data).hexdigest(),
                            'encodedWidth': loaded.width, 'encodedHeight': loaded.height,
                            'frames': getattr(loaded, 'n_frames', 1),
                            'exifOrientation': loaded.getexif().get(274, 1)})
    (DESTINATION / 'manifest.json').write_text(json.dumps({
        'provenance': 'Original project-created pixel values; no external images or assets.',
        'generator': 'tools/generate-media-fixtures.py', 'pillow': __version__,
        'images': records,
    }, indent=2) + '\n')


if __name__ == '__main__':
    main()
