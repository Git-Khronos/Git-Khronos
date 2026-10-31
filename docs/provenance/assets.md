# Third-party assets

## Lucide and Feather-derived icons

Source: <https://github.com/lucide-icons/lucide>

Licenses: ISC and MIT

Usage:

- Several code-native SVG paths in `apps/desktop/src/app/icon.component.ts` are
  adapted from the permissively licensed Lucide collection.
- Required license text is preserved in `THIRD_PARTY_NOTICES.md`.

## Git Khronos application artwork

The Git Khronos application mark and generated platform icon files are original
project assets. No proprietary application artwork is incorporated.


## Owned media comparison fixtures

`crates/git-core/tests/fixtures/media` contains original small raster images.
`tools/generate-media-fixtures.py` records all pixel values and creates them with
Pillow 12.1.1, a fixture-generation tool rather than an application dependency.
The adjacent manifest records byte hashes, encoded dimensions, frames and EXIF
orientation. No competitor or externally sourced artwork is included.
