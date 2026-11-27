"""Build the small-text reader glyph tables from upstream releases (run by hand).

Inputs (downloaded release archives, unpacked):
  --departure   DepartureMono-1.500/DepartureMono-Regular.otf   (OFL-1.1, Helena Zhang)
  --terminus    ter-u12n.bdf from terminus-font-4.49.1 (SourceForge)   (OFL-1.1, Dimitar Zhekov)
  --gohu        gohufont-uni-11.bdf, github.com/hchargois/gohufont   (WTFPL, Hugo Chargois)
  --scientifica scientifica-11.bdf, github.com/nerdypepper/scientifica v2.3   (OFL-1.1, Akshay Oppiliappan)
  --fixed       6x13.bdf, gitlab.freedesktop.org/xorg/font/misc-misc   (public domain)
  --shinonome   shinonome-0.9.11/bdf/ from openlab.jp/efont/dist/shinonome/shinonome-0.9.11p1.tar.bz2
                (public domain): shnmk12.bdf for the old JIS X 0208 coverage and fallback shapes.
  --fusion      fusion-pixel-12px-monospaced-zh_hk.bdf from Fusion Pixel Font v2026.11.10
                (SIL OFL-1.1), TakWolf/fusion-pixel-font releases.
Output: app/src/fonts/glyphs.ts with one table per font. Every table records its
ascent (baseline row) so wide glyphs can be aligned to any font. Use --wide-only
with --fusion and --shinonome to regenerate the shared table without the Latin sources.

The shared 12x12 table keeps Shinonome's JIS rows 0x21–0x4F, Big5 level 1,
common Cantonese characters and full-width punctuation. Fusion is already
Unicode-encoded. Only the legacy JIS source is decoded via EUC-JP.

Monospace only: every font must have one advance width for all of its glyphs.
Bitmap (BDF) fonts are read at their native cell. Departure Mono is an outline
pixel font rasterised at its own grid (11px, per its README "increments of 11px")
by FreeType in monochrome mode; its line is 14 rows with ascent/descent.
(2026-11-10: Spleen, Monogram, Cozette, Pixeloid Mono and JetBrains Mono removed
at the user's request. 2026-11-12: Departure 7x11, Misc Fixed 8x13, Terminus 8x14
and Terminus 8x16 removed.)
"""
from __future__ import annotations

import argparse
import hashlib
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MONO_RANGES = [range(0x20, 0x7F), range(0xA0, 0x180), range(0x2010, 0x2070), range(0x2190, 0x2200),
               range(0x2500, 0x2600), [0x2713, 0x2714, 0x2717, 0x2718, 0x276F, 0x23F5, 0x23FA]]
# Code points kept from large bitmap fonts: Latin, punctuation, arrows, maths and
# technical symbols, box drawing, blocks, shapes, dingbats and Braille.
TEXT_RANGES = [(0x20, 0x24F), (0x2000, 0x206F), (0x2190, 0x23FF), (0x2500, 0x27BF), (0x2800, 0x28FF)]
FUSION_SHA256 = "994fddade92110721113e56e23be2e01a356d8ed6f1b261f41ce3d8d7d2c255c"
CANTONESE = "嘅咗唔冇佢啲嚟喺噉乜嘢哋㗎啩嗰咁嘞唻咩囉冚揾搵睇攰餸嬲瞓啱㩒揼掟嚿嘥攞喐擘戇閂冧窿罅嚡嘈撳"
FUSION_CREDIT = "// Fusion Pixel Font 12px Mono zh_HK v2026.11.10 (c) 2022 TakWolf, OFL-1.1: fonts/FUSION-PIXEL-LICENSE.txt.\n"


def encode(code: int, rows: list[int], row_bits: int = 8) -> str:
    # One byte per row when the cell is at most 8px (bit 7 = left). Wider cells use
    # two bytes per row (bit 15 = left), the same packing as the Japanese wide table.
    digits = row_bits // 4
    return f"{code:x}:" + "".join(f"{r:0{digits}x}" for r in rows)


def bdf(path: Path, ranges=None, *, cell_width: int | None = None) -> tuple[int, int, list[str]]:
    """Any BDF bitmap font at its native cell: width = the (single) ASCII advance,
    height = FONT_ASCENT + FONT_DESCENT. Monospace is required for ASCII; glyphs
    of any other advance (double-width emoji etc.) are skipped, and pixels outside
    the cell are clipped. A fixed width allows the shared table to include
    narrower symbols from a mixed-width Unicode BDF."""
    lines = path.read_text(encoding="latin-1").splitlines()
    prop = lambda key: int(next(l for l in lines if l.startswith(key + " ")).split()[1])
    ascent, descent = prop("FONT_ASCENT"), prop("FONT_DESCENT")
    cell_h = ascent + descent
    advances: dict[int, int] = {}
    code = None
    for l in lines:
        if l.startswith("ENCODING"):
            code = int(l.split()[1])
        elif l.startswith("DWIDTH") and code is not None:
            advances[code] = int(l.split()[1])
    ascii_adv = {advances[c] for c in range(0x21, 0x7F) if c in advances}
    if len(ascii_adv) != 1:
        raise SystemExit(f"{path.name} is not monospaced: ASCII advances {sorted(ascii_adv)}")
    ascii_width = ascii_adv.pop()
    cell_w = ascii_width if cell_width is None else cell_width
    if cell_w > 16:
        raise SystemExit(f"{path.name}: cell {cell_w}px is wider than the 16-bit row format")
    row_bits = 16 if cell_w > 8 else 8
    row_mask = (1 << row_bits) - 1
    base_y = -descent
    out: list[str] = []
    i = 0
    while i < len(lines):
        if not lines[i].startswith("STARTCHAR"):
            i += 1
            continue
        code = w = h = xoff = yoff = None
        rows: list[int] = []
        i += 1
        while not lines[i].startswith("ENDCHAR"):
            parts = lines[i].split()
            if parts[0] == "ENCODING":
                code = int(parts[1])
            elif parts[0] == "BBX":
                w, h, xoff, yoff = (int(v) for v in parts[1:5])
            elif parts[0] == "BITMAP":
                i += 1
                while not lines[i].startswith("ENDCHAR"):
                    rows.append(int(lines[i], 16))
                    i += 1
                break
            i += 1
        advance = advances.get(code)
        if (code is None or code < 32 or code > 0xFFFF or w is None or advance is None
                or (cell_width is None and advance != cell_w) or advance > cell_w
                or (ranges and not any(lo <= code <= hi for lo, hi in ranges))):
            continue
        # Centre half-width characters within the two-cell table. Keep native
        # anchor positions for zero-advance marks.
        if cell_width is not None and advance:
            xoff += (cell_w - advance) // 2
        cell = [0] * cell_h
        top = (cell_h + base_y) - (yoff + h)  # cell row of the glyph's first bitmap row
        byte_bits = ((w + 7) // 8) * 8
        for r, value in enumerate(rows):
            y = top + r
            if 0 <= y < cell_h:
                bits = value >> (byte_bits - w)  # the glyph's own w pixels, left-aligned
                shift = row_bits - w - xoff  # into the row at xoff, high bit = left
                row = bits << shift if shift >= 0 else bits >> -shift
                cell[y] = row & (row_mask << (row_bits - cell_w)) & row_mask  # clip to the cell
        out.append(encode(code, cell, row_bits))
    return cell_w, cell_h, out


def require_monospace(path: Path) -> None:
    from fontTools.ttLib import TTFont
    font = TTFont(str(path))
    cmap = font.getBestCmap()
    advances = {font["hmtx"][g][0] for c, g in cmap.items() if 0x21 <= c < 0x7F}
    if len(advances) != 1:
        raise SystemExit(f"{path.name} is not monospaced: printable ASCII advances {sorted(advances)}")


def pixel_grid_size(path: Path) -> int:
    """The em size in pixels at which one outline grid step is one pixel."""
    from functools import reduce
    from math import gcd
    from fontTools.pens.recordingPen import RecordingPen
    from fontTools.ttLib import TTFont
    font = TTFont(str(path))
    cmap, glyphs = font.getBestCmap(), font.getGlyphSet()
    values = [font["hmtx"][cmap[0x41]][0]]
    for code in range(0x21, 0x7F):
        if code in cmap:
            pen = RecordingPen()
            glyphs[cmap[code]].draw(pen)
            values += [abs(round(v)) for _, pts in pen.value for pt in pts for v in pt]
    unit = reduce(gcd, [v for v in values if v])
    upm = font["head"].unitsPerEm
    if upm % unit:
        raise SystemExit(f"{path.name}: em {upm} is not a whole number of grid steps ({unit})")
    return upm // unit


def all_codes(path: Path) -> list[range]:
    from fontTools.ttLib import TTFont
    return [[c for c in sorted(TTFont(str(path)).getBestCmap()) if 0x20 <= c <= 0xFFFF and not 0xD800 <= c <= 0xDFFF]]


def outline(ttf: Path, size: int, ranges=MONO_RANGES) -> tuple[int, int, list[str]]:
    from PIL import Image, ImageDraw, ImageFont
    require_monospace(ttf)
    font = ImageFont.truetype(str(ttf), size)
    ascent, descent = font.getmetrics()
    advance = round(font.getlength("M"))
    if font.getlength("M") != advance or advance > 8:
        raise SystemExit(f"{ttf.name} {size}px advance {font.getlength('M')} is not a whole cell <= 8")
    cell_h = ascent + descent
    out: list[str] = []
    from fontTools.ttLib import TTFont
    covered = set(TTFont(str(ttf)).getBestCmap())
    for rng in ranges:
        for code in rng:
            if code not in covered:
                continue
            img = Image.new("1", (advance, cell_h), 0)
            draw = ImageDraw.Draw(img)
            draw.fontmode = "1"  # FreeType monochrome rendering: hinted, no anti-aliasing
            draw.text((0, 0), chr(code), font=font, fill=1)
            rows = []
            for y in range(cell_h):
                bits = 0
                for x in range(advance):
                    if img.getpixel((x, y)):
                        bits |= 0x80 >> x
                rows.append(bits)
            out.append(encode(code, rows))
    return advance, cell_h, out


def bdf_ascent(path: Path) -> int:
    lines = path.read_text(encoding="latin-1").splitlines()
    return int(next(l for l in lines if l.startswith("FONT_ASCENT ")).split()[1])


def jis_wide(path: Path, last_row: int = 0x4F) -> tuple[int, int, int, list[str]]:
    """A JIS X 0208 BDF as a wide table: two bytes (4 hex digits) per row, bit 15 = left.
    Rows above `last_row` (JIS level 2 kanji) are left out."""
    lines = path.read_text(encoding="latin-1").splitlines()
    box = next(l for l in lines if l.startswith("FONTBOUNDINGBOX")).split()
    cell_w, cell_h, base_y = int(box[1]), int(box[2]), int(box[4])
    if cell_w > 16:
        raise SystemExit(f"{path.name}: {cell_w}px is wider than the 16-bit row format")
    ascent = bdf_ascent(path)
    out: list[str] = []
    i = 0
    while i < len(lines):
        if not lines[i].startswith("STARTCHAR"):
            i += 1
            continue
        jis = w = h = xoff = yoff = None
        rows: list[int] = []
        i += 1
        while not lines[i].startswith("ENDCHAR"):
            parts = lines[i].split()
            if parts[0] == "ENCODING":
                jis = int(parts[1])
            elif parts[0] == "BBX":
                w, h, xoff, yoff = (int(v) for v in parts[1:5])
            elif parts[0] == "BITMAP":
                i += 1
                while not lines[i].startswith("ENDCHAR"):
                    rows.append(int(lines[i], 16))
                    i += 1
                break
            i += 1
        if jis is None or w is None or (jis >> 8) > last_row:
            continue
        try:
            char = bytes([(jis >> 8) | 0x80, (jis & 0xFF) | 0x80]).decode("euc_jp")
        except UnicodeDecodeError:
            continue
        if len(char) != 1:
            continue
        cell = [0] * cell_h
        top = (cell_h + base_y) - (yoff + h)
        byte_bits = ((w + 7) // 8) * 8
        for r, value in enumerate(rows):
            y = top + r
            if 0 <= y < cell_h:
                bits = value >> (byte_bits - w)
                cell[y] = (bits << (16 - w - xoff)) & 0xFFFF
        out.append(f"{ord(char):x}:" + "".join(f"{v:04x}" for v in cell))
    return cell_w, cell_h, ascent, out


def common_wide(fusion_path: Path, shinonome_path: Path) -> tuple[int, int, int, list[str]]:
    if hashlib.sha256(fusion_path.read_bytes()).hexdigest() != FUSION_SHA256:
        raise SystemExit("Fusion BDF must match the pinned v2026.11.10 zh_HK font")
    w, h, a, legacy = jis_wide(shinonome_path)
    width, height, shapes = bdf(fusion_path, cell_width=12)
    if (width, height, bdf_ascent(fusion_path)) != (w, h, a) or (w, h, a) != (12, 12, 10):
        raise SystemExit("Fusion and Shinonome must use a 12x12 cell with ascent 10")

    def glyph_map(entries: list[str]) -> dict[int, str]:
        return {int(code, 16): pixels for code, pixels in (entry.split(":", 1) for entry in entries)}

    fallback, fusion = glyph_map(legacy), glyph_map(shapes)
    big5 = set()
    for code in range(0xA440, 0xC67F):
        try:
            big5.add(ord(code.to_bytes(2, "big").decode("big5")))
        except UnicodeDecodeError:
            continue
    required = set(fallback) | big5 | set(map(ord, CANTONESE))
    required.update(code for code in fusion if 0x3000 <= code <= 0x303F or 0xFF00 <= code <= 0xFF60)

    # 㩒 is absent from this release. Preserve the input code point while
    # drawing its Cantonese variant 撳.
    alias_count = int(ord("㩒") not in fusion)
    if alias_count:
        fusion[ord("㩒")] = fusion[ord("撳")]
    missing = required - fusion.keys() - fallback.keys()
    if missing:
        raise SystemExit("Missing wide glyphs: " + ", ".join(f"U+{code:04X}" for code in sorted(missing)))
    used_fallback = required - fusion.keys()
    rows = [f"{code:x}:{fusion[code] if code in fusion else fallback[code]}" for code in sorted(required)]
    print(f"CJK_12: {len(rows)} glyphs, {len(rows) - len(used_fallback) - alias_count} Fusion, "
          f"{alias_count} Fusion alias, {len(used_fallback)} Shinonome fallback")
    return w, h, a, rows


def table(name: str, width: int, height: int, ascent: int, glyphs: list[str]) -> str:
    return f"export const {name} = {{ width: {width}, height: {height}, ascent: {ascent}, glyphs: '{';'.join(glyphs)}' }};\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    latin = ("departure", "terminus", "gohu", "scientifica", "fixed")
    for name in latin:
        ap.add_argument(f"--{name}", type=Path)
    for name in ("shinonome", "fusion"):
        ap.add_argument(f"--{name}", type=Path, required=True)
    ap.add_argument("--wide-only", action="store_true")
    args = ap.parse_args()
    if not args.wide_only and any(getattr(args, name) is None for name in latin):
        ap.error("provide all Latin sources, or use --wide-only")
    wide = table("CJK_12", *common_wide(args.fusion, args.shinonome / "shnmk12.bdf"))
    target = REPO / "app" / "src" / "fonts" / "glyphs.ts"
    if args.wide_only:
        existing = target.read_bytes()
        updated, count = re.subn(rb"(?m)^export const (?:SHINONOME_K12|CJK_12) = [^\r\n]*", wide.rstrip("\n").encode(), existing)
        if count != 1:
            raise SystemExit("Expected exactly one existing wide table")
        newline = b"\r\n" if b"\r\n" in existing else b"\n"
        credit = FUSION_CREDIT.rstrip("\n").encode()
        if credit not in updated:
            updated = updated.replace(b"// Shinonome", credit + newline + b"// Shinonome", 1)
        updated = updated.replace(b"the wide Japanese table", b"the shared CJK table")
        target.write_bytes(updated)
        return

    sources = {"terminus": args.terminus, "gohu": args.gohu, "scientifica": args.scientifica, "fixed": args.fixed}
    bitmaps = {name: (*bdf(path, TEXT_RANGES), bdf_ascent(path)) for name, path in sources.items()}
    dsize = pixel_grid_size(args.departure)
    dw, dh, departure = outline(args.departure, dsize, all_codes(args.departure))
    from PIL import ImageFont
    dascent = ImageFont.truetype(str(args.departure), dsize).getmetrics()[0]
    target.write_text(
        "// Generated by scripts/build-fine-fonts.py. Do not edit by hand.\n"
        "// Departure Mono 1.500 (c) 2022-2024 Helena Zhang, OFL-1.1: fonts/DEPARTURE-MONO-OFL.txt.\n"
        "// Terminus Font 4.49.1 (c) Dimitar Toshkov Zhekov, OFL-1.1: fonts/TERMINUS-OFL.txt. Size 6x12.\n"
        "// GohuFont (c) Hugo Chargois, WTFPL: fonts/GOHUFONT-LICENSE.txt. Size 6x11.\n"
        "// scientifica 2.3 (c) Akshay Oppiliappan, OFL-1.1: fonts/SCIENTIFICA-OFL.txt.\n"
        "// X11 misc-fixed 6x13: public domain, fonts/MISC-FIXED-COPYING.txt.\n"
        + FUSION_CREDIT
        + "// Shinonome 0.9.11 (The Electronic Font Open Laboratory): public domain, fonts/SHINONOME-LICENSE.txt.\n"
        "// Entry: hex code point ':' then one byte per row (bit 7 = leftmost pixel). Cells wider than\n"
        "// 8px, and the shared CJK table, use two bytes per row (bit 15 = leftmost).\n"
        "// ascent = rows above the baseline.\n"
        + table("DEPARTURE_MONO", dw, dh, dascent, departure)
        + "".join(table(name.upper(), w, h, a, g) for name, (w, h, g, a) in bitmaps.items())
        + wide,
        encoding="utf-8", newline="\n")
    print("ok", f"departure {dsize}px {dw}x{dh}/{len(departure)}",
          *[f"{n} {w}x{h}/{len(g)}" for n, (w, h, g, a) in bitmaps.items()],
          target.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
