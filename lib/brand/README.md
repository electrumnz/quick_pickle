# The brand layer

Everything about how Quick Pickle looks, in one folder.

| File          | What it is                                                             |
| ------------- | ---------------------------------------------------------------------- |
| `tokens.css`  | Colours, type, shape and motion. The only file allowed a raw hex.      |
| `colours.ts`  | The same palette as data, plus the foreground/ground pairs in use.     |
| `contrast.ts` | WCAG contrast maths, used by the tests and the brand guide page.       |
| `fonts.ts`    | The four official faces, served through `next/font/local`.             |
| `fonts/`      | Subset WOFF2 files.                                                    |
| `art/`        | Generated: Lucky and the lockup as path data, and the raster manifest. |

The living brand guide is the page at `/backstage/brand`. It is rendered from
these files, so it cannot drift from the site.

## Rebuilding from a new asset pack

The pack (about 200 MB of print masters) is not in the repository. Unzip it
somewhere and point the scripts at it.

```bash
# Raster art, stickers, favicons, social card -> public/brand, app/
node scripts/build-art.mjs <pack>/Quick-Pickle-Asset-Pack

# Vector Lucky and the stacked lockup -> public/brand/*.svg, lib/brand/art/*.ts
python3 scripts/build-vectors.py <pack>/Quick-Pickle-Asset-Pack/02-source/extracted .
```

## Fonts

Subset to Latin plus the macron vowels and converted to WOFF2 with fontTools:

```bash
pyftsubset <font> \
  --unicodes="U+0020-007E,U+00A0-00FF,U+0100-0101,U+0112-0113,U+012A-012B,U+014C-014D,U+016A-016B,U+2013-2014,U+2018-201A,U+201C-201E,U+2022,U+2026,U+2122,U+2212,U+00D7" \
  --layout-features='kern,liga,clig,calt,ccmp,locl,mark,mkmk,case,tnum,lnum' \
  --flavor=woff2 --no-hinting --desubroutinize --output-file=lib/brand/fonts/<name>.woff2
```

Licences, from the font files' own name tables. Sam confirmed on 12 November
2026 that they cover web embedding.

- Varsity Senior: 7NTypes, 2025.
- Summer Varsity: Pian45 Studio, 2026.
- DIN Condensed Bold: Heidelberger Druckmaschinen AG.
- Poppins Medium and SemiBold: Indian Type Foundry, SIL Open Font Licence 1.1.
