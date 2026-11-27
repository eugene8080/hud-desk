// Small-text reader pages. The Even SDK has no font or size control for native
// text, so in small-text mode the whole screen (frame, chat, divider and status
// row) is drawn on the phone and sent as four greyscale image tiles: the SDK
// maximum of four images, each 288x144, together exactly the 576x288 canvas.
//
// Every font is a fixed cell of whole pixels, copied pixel-exact from a glyph
// table (app/src/fonts/glyphs.ts): no canvas text and no anti-aliasing.
// All monospace, each at its own native pixel grid (the G2 shows the 576x288
// canvas 1:1, confirmed with the display test pattern on 2026-11-09):
// cell sizes below; a page is as many whole cells as fit inside the 1px frame.
// Bitmap fonts come from their BDF files, outline pixel fonts are rasterised at their own pixel grid,
// JetBrains Mono by FreeType in monochrome mode (see scripts/build-fine-fonts.py).
// Missing characters: box drawing as geometric lines and Braille as dots, both
// fitted to the cell; anything else via the WebView monospace font, thresholded
// to on/off pixels. East Asian wide characters take two cells.
import { getLang, t } from './i18n';
import { readerPages, type ReaderPage } from './text';
import { DEPARTURE_MONO, TERMINUS, GOHU, SCIENTIFICA, FIXED, CJK_12 } from './fonts/glyphs';

// Menu order: narrowest cell first, then by height. (2026-11-10: Spleen, Monogram,
// Cozette, Pixeloid Mono and JetBrains Mono removed at the user's request.)
const TABLES = {
  scientifica: SCIENTIFICA, gohu: GOHU, terminus: TERMINUS, fixed: FIXED, departure: DEPARTURE_MONO,
};
export type FineFont = keyof typeof TABLES;
export const FINE_FONTS = Object.keys(TABLES) as FineFont[];
const NAMES: Record<FineFont, string> = {
  scientifica: 'Scientifica', gohu: 'GohuFont', terminus: 'Terminus', fixed: 'Misc Fixed', departure: 'Departure',
};
// 'Cozette 6x13': short name and native cell. The glasses menu truncates labels
// beyond about 210px, so names are short (Pixeloid Mono -> Pixeloid).
export const fineLabel = (font: FineFont) => `${NAMES[font]} ${TABLES[font].width}x${TABLES[font].height}`;
// User-turn backgrounds. Ink 1 is the panel's lowest step, so every dimmer option lights only part
// of the band at Ink 1. Fill fractions come from one 4x4 ordered (Bayer) dither in absolute screen
// coordinates, so they read as an even, finer grey. Eugene, 2026-11-27 (second pass): Ink 5/8, Ink
// 1/2 and Ink 1/4 only (solid Ink 1, 7/8 and 3/4 removed). Ink 1/2 and 1/4 are pixel-for-pixel the
// former Dots 1/2 (1px checker) and Dots 1/4 (one pixel in each 2x2), so a saved 'dots2'/'dots4'
// carries over; Dots 1/3 (5/16 lit) stays. Lines light every 3rd, 4th or 8th pixel row (Lines 1/2
// removed). G2 note (2026-11-09): 1px line gratings looked even, a 1px checker blotchy.
// Tube (2026-11-27, "a tube TV look like my terminal watch face", claude-usage-widget
// garmin/faces/terminal): a CRT scanline on every third pixel row (rows y % 3 == 2, the face's
// SCAN_PITCH and phase), dark in the lit band and dimming any text it crosses by 38 % (the face's
// "on text" 38 %). Tube turns scans your turns only; Tube scans the whole screen, as the face does.
// Tube dim scans your turns only: every third row dark, a half-lit (checker) band. Tube turns and
// Tube wide were removed in the second pass (2026-11-27).
// Third pass (Eugene, 2026-11-27): Lines 1/8 removed; Dots 1/4, Dots 1/8, Tube x dim and Tube xx
// dim added. Ink 1/4 already lights one pixel in each 2x2 on a square grid, so Dots 1/4 staggers
// the same quarter: every second row, the dots of alternate rows offset by one pixel (diagonal
// rows of dots). Dots 1/8 is the Bayer 2/16, which staggers the same way. Tube x dim and xx dim
// are Tube dim with a quarter-lit and an eighth-lit band. Ids dots14/dots18 because 'dots4' is
// an older saved value that maps to Ink 1/4. Labels name the lit fraction of the band, Tube 1/2
// (was Tube dim), 1/4, 1/8: 'Background: Tube xx dim' is 218 px, past the menu's ~210 px.
// 1px frame: a thin outline at Ink 2 around your turns; consecutive messages of yours share one
// frame, including blank rows between them (Eugene, 2026-11-27).
// Terminal-style highlights (Eugene, 2026-11-27: "what did early terminals use? ... see the
// background highlight but aren't too bright and you can still see the text"). Nothing lights
// the band behind the letters:
// - Left bar: a bar (cell width - 2 px: 4px in a 6px font; "thicker", Eugene) in the first text
//   column of your turns, in place of the '/' marker, down
//   every row of the turn (the quote bar of mail clients). In the text column because Departure 7x14
//   fills the full width and the other fonts leave only 2px beside the frame.
// - Underline: a 1px line under the letters of each row of yours (the VT100 underline attribute).
// - Dim replies: no background; the other rows' letters at 55 % (the IBM 3270's normal versus
//   intensified fields). Email has no turns of yours, so its reader shows it as None.
// - Halo (a toggle, not an option): with Ink, Lines, Dots or Tube, the background pixels that touch a
//   letter (8 neighbours) stay dark, so each letter stands on black.
// Default Lines 1/3 (Eugene, 2026-11-27). Ink 2/3 were dropped; a saved one falls back to the default.
export const TURN_BACKGROUNDS = ['none', 'ink58', 'ink12', 'ink14', 'lines3', 'lines4', 'dots3', 'dots14',
  'dots18', 'tubedim', 'tubexdim', 'tube', 'frame', 'bar', 'underline', 'dimreplies'] as const;
// Options drawn as marks or text levels rather than a lit band (no TURN_PATTERNS entry).
type MarkBackground = 'none' | 'frame' | 'bar' | 'underline' | 'dimreplies';
const MARKS: readonly string[] = ['none', 'frame', 'bar', 'underline', 'dimreplies'];
const BAR_INK = 5, UNDERLINE_INK = 4, DIM_REPLIES = 0.55;
// Saved values from earlier betas that map onto an option that still exists.
// Tube 1/8 (tubexxdim) was removed on 2026-11-27; a saved one shows as Tube 1/4.
const RENAMED: Record<string, TurnBackground> = { dots2: 'ink12', dots4: 'ink14', tubexxdim: 'tubexdim' };
export type TurnBackground = typeof TURN_BACKGROUNDS[number];
export const DEFAULT_TURN_BACKGROUND: TurnBackground = 'lines3';
export const SCAN_PITCH = 3;
const SCAN_TEXT = 0.62;
const scanRow = (y: number, pitch = SCAN_PITCH) => y % pitch === pitch - 1;
const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
// k of 16 pixels lit in every 4x4 block, spread as evenly as the grid allows.
const dither = (k: number) => (x: number, y: number) => BAYER4[y & 3][x & 3] < k;
// Tube variants: scanline pitch and the lit fraction of the band's other rows (16 = solid).
const TUBES: Partial<Record<TurnBackground, { pitch: number; fill: number }>> = {
  tubedim: { pitch: 3, fill: 8 }, tubexdim: { pitch: 3, fill: 4 },
  tube: { pitch: 3, fill: 16 },
};
export function parseTurnBackground(value: string | null | undefined): TurnBackground {
  return TURN_BACKGROUNDS.find(option => option === value) ?? (value ? RENAMED[value] : undefined) ?? DEFAULT_TURN_BACKGROUND;
}
export function turnBackgroundLabel(option: TurnBackground): string {
  if (option === 'none') return t('backgroundNone');
  if (option === 'ink58') return t('backgroundInk', '5/8');
  if (option === 'ink12') return t('backgroundInk', '1/2');
  if (option === 'ink14') return t('backgroundInk', '1/4');
  if (option === 'lines3') return t('backgroundLines', '1/3');
  if (option === 'lines4') return t('backgroundLines', '1/4');
  if (option === 'dots3') return t('backgroundDots', '1/3');
  if (option === 'dots14') return t('backgroundDots', '1/4');
  if (option === 'dots18') return t('backgroundDots', '1/8');
  if (option === 'tubedim') return t('backgroundTubeBand', '1/2');
  if (option === 'tubexdim') return t('backgroundTubeBand', '1/4');
  if (option === 'tube') return t('backgroundTube');
  if (option === 'frame') return t('backgroundFrame');
  if (option === 'bar') return t('backgroundBar');
  if (option === 'underline') return t('backgroundUnderline');
  if (option === 'dimreplies') return t('backgroundDimReplies');
  return t('backgroundInk', option);
}
// A tube band: dark on its scanline rows, `fill` of 16 lit elsewhere.
const tubeLit = ({ pitch, fill }: { pitch: number; fill: number }) => (x: number, y: number) => !scanRow(y, pitch) && dither(fill)(x, y);
// Which pixels of a band a background lights, in absolute screen coordinates so the pattern
// stays continuous across rows and fonts with odd line heights.
const TURN_PATTERNS: Record<Exclude<TurnBackground, MarkBackground>, (x: number, y: number) => boolean> = {
  ink58: dither(10),
  ink12: dither(8),
  ink14: dither(4),
  lines3: (_x, y) => y % 3 === 0,
  lines4: (_x, y) => y % 4 === 0,
  dots3: dither(5),
  dots14: (x, y) => y % 2 === 0 && x % 2 === (y >> 1) % 2,
  dots18: dither(2),
  tubedim: tubeLit(TUBES.tubedim!),
  tubexdim: tubeLit(TUBES.tubexdim!),
  tube: tubeLit(TUBES.tube!),
};
// The panel is 4-bit: 16 steps, numbered 0 through 15. Full white is 15, which is
// what the app drew before this control. An 8-bit image byte of n*17 lands on step n
// whether the glasses keep the high nibble or scale 0..255 onto 0..15.
export const INK_MAX = 15;
export function inkByte(level = INK_MAX): number {
  const n = Math.max(0, Math.min(INK_MAX, Math.round(level)));
  return n * 17;
}
// Native text has five steps, 0..4 (SDK textColor). Any visible panel step stays visible.
export function nativeTextColor(level = INK_MAX): number {
  const n = Math.max(0, Math.min(INK_MAX, Math.round(level)));
  return n <= 0 ? 0 : Math.ceil(n * 4 / INK_MAX);
}
export function parseInk(value: unknown): number {
  if (value == null || value === '') return INK_MAX;
  const n = Number(value);
  // 0 would draw nothing. A blank or a saved 0 stays at full white.
  return Number.isInteger(n) && n >= 1 && n <= INK_MAX ? n : INK_MAX;
}
export const SCREEN = { width: 576, height: 288 };
export const FINE_TILES = [0, 1, 2, 3].map(i => ({ xPosition: (i % 2) * 288, yPosition: Math.floor(i / 2) * 144, width: 288, height: 144 }));

// Layout in whole cells: a 1px frame, chat rows from y4, a divider, then one
// status row at the bottom. Chat and status share every whole cell that fits
// inside the frame (574px). A 7px cell fills it exactly (82 columns); 5px and
// 6px cells leave less than one cell, centred.
const TOP = 4, FRAME = 1;
const INNER = SCREEN.width - 2 * FRAME;
export function fineLayout(font: FineFont) {
  const { width: cell, height: line } = TABLES[font];
  const statusY = SCREEN.height - FRAME - 2 - line;
  const dividerY = statusY - 3;
  const rows = Math.floor((dividerY - 2 - TOP) / line);
  const columns = Math.floor(INNER / cell);
  const textWidth = columns * cell;
  const textX = FRAME + Math.floor((INNER - textWidth) / 2);
  return { cell, line, rows, columns, textWidth, textX, statusY, dividerY };
}

const parsed = new Map<FineFont, Map<number, number[]>>();
function glyph(font: FineFont, code: number): number[] | undefined {
  let table = parsed.get(font);
  if (!table) {
    table = new Map();
    const digits = TABLES[font].width > 8 ? 4 : 2;
    for (const entry of TABLES[font].glyphs.split(';')) {
      const [hex, rows] = entry.split(':');
      table.set(parseInt(hex, 16), Array.from({ length: rows.length / digits }, (_, i) => parseInt(rows.slice(i * digits, i * digits + digits), 16)));
    }
    parsed.set(font, table);
  }
  return table.get(code);
}

// Every small font shares a 12x12 CJK table with Hong Kong glyph forms, Big5
// level 1, common Cantonese and the existing JIS level 1 and kana coverage.
// Most shapes use 11 ink columns. Rows are 16-bit, bit 15 = leftmost pixel.
const WIDE = CJK_12;
let wideParsed: Map<number, number[]> | null = null;
function wideGlyph(code: number): number[] | undefined {
  if (!wideParsed) {
    wideParsed = new Map();
    for (const entry of WIDE.glyphs.split(';')) {
      const [hex, rows] = entry.split(':');
      wideParsed.set(parseInt(hex, 16), Array.from({ length: rows.length / 4 }, (_, i) => parseInt(rows.slice(i * 4, i * 4 + 4), 16)));
    }
  }
  return wideParsed.get(code);
}

// Two cells for East Asian wide/fullwidth characters and emoji; zero for
// combining marks and joiners; one otherwise.
// Light, heavy, double and rounded box drawing share one single-pixel line style.
const BOX: Record<string, string> = {};
for (const [chars, arms] of [
  ['─━═╌╍┄┅┈┉', 'lr'], ['│┃║╎╏┆┇┊┋', 'ud'], ['┌┏╔╭┍┎╒╓', 'dr'], ['┐┓╗╮┑┒╕╖', 'dl'], ['└┗╚╰┕┖╘╙', 'ur'], ['┘┛╝╯┙┚╛╜', 'ul'],
  ['├┣╠┝┞┟┠┡┢╞╟', 'udr'], ['┤┫╣┥┦┧┨┩┪╡╢', 'udl'], ['┬┳╦┭┮┯┰┱┲╤╥', 'dlr'], ['┴┻╩┵┶┷┸┹┺╧╨', 'ulr'],
  ['┼╋╬┽┾┿╀╁╂╃╄╅╆╇╈╉╊╪╫', 'udlr'], ['╴', 'l'], ['╶', 'r'], ['╵', 'u'], ['╷', 'd'], ['▶►', 'lr>'],
] as const) for (const c of chars) BOX[c] = arms;

export function cellWidth(ch: string): number {
  const c = ch.codePointAt(0) || 0;
  if (/\p{Mn}|\p{Me}|‍|️/u.test(ch)) return 0;
  if ((c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd)) return 2;
  return 1;
}
export const fineCells = (text: string) => { let n = 0; for (const ch of text) n += cellWidth(ch); return n; };
// Width in pixels for the reader's word wrap (readerPages measures in pixels).
export const fineMeasure = (font: FineFont) => (text: string) => fineCells(text) * TABLES[font].width;

class Surface {
  readonly pixels = new Uint8ClampedArray(SCREEN.width * SCREEN.height);
  private canvas: CanvasRenderingContext2D | null = null;
  private canvasUsed = false;
  // font is switchable so one screen can compare several fonts.
  constructor(public font: FineFont, readonly ink = inkByte()) {}
  set(x: number, y: number, level?: number) {
    const v = level ?? this.ink;
    if (x >= 0 && y >= 0 && x < SCREEN.width && y < SCREEN.height) this.pixels[y * SCREEN.width + x] = v;
  }
  rect(x: number, y: number, w: number, h: number, level = this.ink) {
    const left = Math.max(0, x), right = Math.min(SCREEN.width, x + w);
    if (right <= left) return;
    const bottom = Math.min(SCREEN.height, y + h);
    for (let row = Math.max(0, y); row < bottom; row++) {
      const start = row * SCREEN.width;
      this.pixels.fill(level, start + left, start + right);
    }
  }
  // CRT scanlines: in every scanline row of the rectangle, lit pixels drop to 62 % of their level,
  // rounded to a panel step and never below Ink 1, so letters stay readable.
  scanlines(x: number, y: number, w: number, h: number, pitch = SCAN_PITCH) {
    const right = Math.min(SCREEN.width, x + w), bottom = Math.min(SCREEN.height, y + h);
    for (let row = Math.max(0, y); row < bottom; row++) {
      if (!scanRow(row, pitch)) continue;
      for (let col = Math.max(0, x); col < right; col++) {
        const i = row * SCREEN.width + col, v = this.pixels[i];
        if (v > 0) this.pixels[i] = Math.max(inkByte(1), Math.round(v * SCAN_TEXT / 17) * 17);
      }
    }
  }
  // A rectangle that lights only the pixels the pattern selects (absolute coordinates).
  pattern(x: number, y: number, w: number, h: number, level: number, lit: (x: number, y: number) => boolean) {
    const right = Math.min(SCREEN.width, x + w), bottom = Math.min(SCREEN.height, y + h);
    for (let row = Math.max(0, y); row < bottom; row++)
      for (let col = Math.max(0, x); col < right; col++) if (lit(col, row)) this.pixels[row * SCREEN.width + col] = level;
  }
  frame() {
    this.rect(0, 0, SCREEN.width, FRAME); this.rect(0, SCREEN.height - FRAME, SCREEN.width, FRAME);
    this.rect(0, 0, FRAME, SCREEN.height); this.rect(SCREEN.width - FRAME, 0, FRAME, SCREEN.height);
  }
  // Draw text from (x, y) in whole cells; stops at maxCells. Returns cells used. `level` lets one
  // row be dimmer than the rest (Dim replies); it defaults to the screen's ink.
  text(text: string, x: number, y: number, maxCells: number, level = this.ink): number {
    const { width: cw, height: ch } = TABLES[this.font];
    let col = 0;
    for (const c of text) {
      const cells = cellWidth(c);
      if (cells === 0) continue;
      if (col + cells > maxCells) break;
      const px = x + col * cw, code = c.codePointAt(0) || 0;
      const bitmap = glyph(this.font, code);
      const wide = !bitmap && cells === 2 ? wideGlyph(code) : undefined;
      if (bitmap) {
        const high = cw > 8 ? 0x8000 : 0x80;
        for (let gy = 0; gy < bitmap.length; gy++) for (let gx = 0; gx < cw; gx++) if (bitmap[gy] & (high >> gx)) this.set(px + gx, y + gy, level);
      } else if (wide) {
        // Baseline-aligned to this font; centred in the two-cell box (11 used columns).
        const dy = TABLES[this.font].ascent - WIDE.ascent, dx = Math.max(0, (2 * cw - 11) >> 1);
        for (let gy = 0; gy < wide.length; gy++) for (let gx = 0; gx < 16; gx++) if (wide[gy] & (0x8000 >> gx)) this.set(px + dx + gx, y + dy + gy);
      } else if (BOX[c]) {
        this.box(BOX[c], px, y, cw, ch);
      } else if (code >= 0x2800 && code <= 0x28ff) {
        this.braille(code - 0x2800, px, y, cw, ch);
      } else if (c.trim()) {
        const ctx = this.ctx();
        ctx.font = `${ch - 2}px monospace`;
        ctx.fillText(c, px, y + ch - Math.ceil(ch / 5), cells * cw);
        this.canvasUsed = true;
      }
      col += cells;
    }
    return col;
  }
  // Box drawing from the cell centre to its edges: 'udlr' = up, down, left, right.
  private box(arms: string, x: number, y: number, cw: number, ch: number) {
    const cx = x + Math.floor((cw - 1) / 2), cy = y + Math.floor((ch - 1) / 2);
    if (arms.includes('u')) this.rect(cx, y, 1, cy - y + 1);
    if (arms.includes('d')) this.rect(cx, cy, 1, y + ch - cy);
    if (arms.includes('l')) this.rect(x, cy, cx - x + 1, 1);
    if (arms.includes('r')) this.rect(cx, cy, x + cw - cx, 1);
    if (arms.includes('>')) for (let i = 0; i < 3; i++) this.rect(x + cw - 2 - i, cy - i, 1, 2 * i + 1);
  }
  // Braille cells as 2x4 single-pixel dots centred in the cell (dot numbering 1-8).
  private braille(bits: number, x: number, y: number, cw: number, ch: number) {
    const dx = [Math.floor(cw / 2) - 2, Math.floor(cw / 2) + 1];
    const step = Math.max(2, Math.floor((ch - 2) / 4));
    const top = y + Math.floor((ch - step * 3 - 1) / 2);
    [[0, 0, 0], [1, 0, 1], [2, 0, 2], [3, 1, 0], [4, 1, 1], [5, 1, 2], [6, 0, 3], [7, 1, 3]].forEach(([bit, col, row]) => {
      if (bits & (1 << bit)) this.set(x + dx[col], top + row * step);
    });
  }
  private ctx() {
    if (this.canvas) return this.canvas;
    const c = document.createElement('canvas');
    c.width = SCREEN.width; c.height = SCREEN.height;
    this.canvas = c.getContext('2d', { willReadFrequently: true })!;
    this.canvas.fillStyle = '#000'; this.canvas.fillRect(0, 0, SCREEN.width, SCREEN.height);
    this.canvas.fillStyle = '#fff'; this.canvas.textBaseline = 'alphabetic';
    return this.canvas;
  }
  tiles(): number[][] {
    if (this.canvasUsed) {
      // Fallback glyphs only: on/off at half coverage, like every other pixel here.
      const data = this.ctx().getImageData(0, 0, SCREEN.width, SCREEN.height).data;
      for (let i = 0; i < this.pixels.length; i++) if (data[i * 4] >= 128) this.pixels[i] = this.ink;
    }
    return FINE_TILES.map(tile => {
      const out = new Array<number>(tile.width * tile.height);
      for (let y = 0; y < tile.height; y++) for (let x = 0; x < tile.width; x++)
        out[y * tile.width + x] = this.pixels[(tile.yPosition + y) * SCREEN.width + tile.xPosition + x];
      return out;
    });
  }
}

// One full screen: frame, chat rows (already wrapped to fineLayout().columns),
// divider and the status row (left text, right text right-aligned).
// Thinking indicator for tile modes (native text keeps the Braille spinner): a
// scanner light sweeping across SCANNER_SEGMENTS segments and back, with a tail in
// three dimmer greys. One step per frame; a full sweep there and back is 14 frames.
export const SCANNER_SEGMENTS = 8;
const SCANNER_SEGMENT = 5, SCANNER_GAP = 1, SCANNER_LEVELS = [255, 176, 112, 64];
export const SCANNER_WIDTH = SCANNER_SEGMENTS * (SCANNER_SEGMENT + SCANNER_GAP) - SCANNER_GAP;
export function scannerLevels(frame: number): number[] {
  const period = 2 * (SCANNER_SEGMENTS - 1);
  const step = ((frame % period) + period) % period;
  const forward = step < SCANNER_SEGMENTS - 1 || step === period;
  const head = step < SCANNER_SEGMENTS ? step : period - step;
  // The tail trails behind the direction of travel.
  return Array.from({ length: SCANNER_SEGMENTS }, (_, i) => {
    const behind = forward ? head - i : i - head;
    return behind >= 0 && behind < SCANNER_LEVELS.length ? SCANNER_LEVELS[behind] : 0;
  });
}

export type FineStatus = { left: string; right: string; model?: string; scanner?: number };
// region: the text block the rows sit in (the comparison screen indents it past the labels).
function drawTurnRows(s: Surface, page: ReaderPage, top: number, background: TurnBackground,
  region: { textX: number; textWidth: number; columns: number } = fineLayout(s.font), halo = false) {
  const { line, rows } = fineLayout(s.font);
  const { textX, textWidth, columns } = region;
  const cell = TABLES[s.font].width;
  const lines = page.text.split('\n').slice(0, rows);
  // Keep at least one ink step between the letters and the background at low brightness.
  const want = background === 'frame' ? 2 : background === 'bar' ? BAR_INK : background === 'underline' ? UNDERLINE_INK : 1;
  const ink = Math.max(0, Math.min(inkByte(want), s.ink - inkByte(1)));
  // Left bar: the '/' that opens a turn of yours gives way to the bar.
  const shown = background === 'bar' && ink > 0
    ? lines.map((row, r) => page.userTurns[r] && row.startsWith('/') ? ' ' + row.slice(1) : row) : lines;
  if (background === 'frame' && ink > 0) {
    // One outline per run of your messages: a row is inside when it is yours, or blank between two
    // rows of yours. Sides on every inside row, top where the run starts, bottom where it ends.
    const user = (r: number) => !!page.userTurns[r];
    const blank = (r: number) => !lines[r]?.trim();
    const framed = lines.map((_, r) => {
      if (user(r)) return true;
      if (!blank(r)) return false;
      let above = r - 1, below = r + 1;
      while (above >= 0 && blank(above) && !user(above)) above--;
      while (below < lines.length && blank(below) && !user(below)) below++;
      return above >= 0 && below < lines.length && user(above) && user(below);
    });
    framed.forEach((inside, r) => {
      if (!inside) return;
      const y = top + r * line;
      s.rect(textX, y, 1, line, ink);
      s.rect(textX + textWidth - 1, y, 1, line, ink);
      if (!framed[r - 1]) s.rect(textX, y, textWidth, 1, ink);
      if (r === lines.length - 1 || !framed[r + 1]) s.rect(textX, y + line - 1, textWidth, 1, ink);
    });
  } else if (background === 'bar' && ink > 0) {
    const width = Math.max(2, cell - 2), x = textX + ((cell - width) >> 1);
    lines.forEach((_, r) => { if (page.userTurns[r]) s.rect(x, top + r * line, width, line, ink); });
  } else if (!MARKS.includes(background) && ink > 0) {
    lines.forEach((_, r) => {
      if (page.userTurns[r]) s.pattern(textX, top + r * line, textWidth, line, ink, TURN_PATTERNS[background as Exclude<TurnBackground, MarkBackground>]);
    });
  }
  // Dim replies: every row that is not yours at 55 %, rounded to a panel step, never below Ink 1.
  const dim = Math.max(inkByte(1), Math.round(s.ink * DIM_REPLIES / 17) * 17);
  shown.forEach((row, r) => {
    const cells = s.text(row, textX, top + r * line, columns, background === 'dimreplies' && !page.userTurns[r] ? dim : s.ink);
    if (background === 'underline' && ink > 0 && page.userTurns[r] && row.trim()) {
      // Under the letters only: from the first to the last non-space cell of the row.
      const start = row.length - row.trimStart().length;
      s.rect(textX + start * cell, top + r * line + line - 1, Math.max(0, cells - start - (row.length - row.trimEnd().length)) * cell, 1, ink);
    }
  });
  // Halo: background pixels next to a letter go dark. A letter pixel is brighter than the
  // background level, which is always at least one step below the text.
  if (halo && !MARKS.includes(background) && ink > 0) {
    const { pixels } = s, W = SCREEN.width;
    lines.forEach((_, r) => {
      if (!page.userTurns[r]) return;
      const y0 = top + r * line, y1 = Math.min(SCREEN.height, y0 + line);
      for (let y = y0; y < y1; y++) for (let x = textX; x < textX + textWidth; x++) {
        if (pixels[y * W + x] !== ink) continue;
        let touches = false;
        for (let dy = -1; dy <= 1 && !touches; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if ((dx || dy) && nx >= 0 && ny >= 0 && nx < W && ny < SCREEN.height && pixels[ny * W + nx] > ink) { touches = true; break; }
        }
        if (touches) pixels[y * W + x] = 0;
      }
    });
  }
  // Tube dim, x dim, xx dim: the scanlines cross the letters of your turns too. (Tube scans the whole screen
  // afterwards, in renderFineScreen and the comparison.)
  const tube = TUBES[background];
  if (tube && background !== 'tube') {
    lines.forEach((_, r) => { if (page.userTurns[r]) s.scanlines(textX, top + r * line, textWidth, line, tube.pitch); });
  }
}

export function renderFineScreen(page: ReaderPage, font: FineFont, status: FineStatus, level = INK_MAX, background = DEFAULT_TURN_BACKGROUND, halo = false): number[][] {
  const s = new Surface(font, inkByte(level));
  const { line, columns, textX, textWidth, statusY, dividerY } = fineLayout(font);
  s.frame();
  drawTurnRows(s, page, TOP, background, undefined, halo);
  s.rect(textX, dividerY, textWidth, 1);
  const rightCells = Math.min(fineCells(status.right), columns);
  s.text(status.right, textX + (columns - rightCells) * TABLES[font].width, statusY, rightCells);
  const leftCells = Math.max(0, columns - rightCells - 1);
  if (status.scanner === undefined) s.text(status.left, textX, statusY, leftCells);
  else {
    // 'Opus5.5 [scanner] Thinking...': the model stays put, the light sweeps.
    const cw = TABLES[font].width;
    const modelCells = status.model ? s.text(`${status.model} `, textX, statusY, leftCells) : 0;
    const x0 = textX + modelCells * cw, barCells = Math.ceil(SCANNER_WIDTH / cw) + 1;
    const h = Math.max(3, Math.floor(line / 3)), y0 = statusY + Math.floor((line - h) / 2);
    scannerLevels(status.scanner).forEach((step, i) => { if (step) s.rect(x0 + i * (SCANNER_SEGMENT + SCANNER_GAP), y0, SCANNER_SEGMENT, h, Math.round(step * s.ink / 255)); });
    s.text(status.left, x0 + barCells * cw, statusY, Math.max(0, leftCells - modelCells - barCells));
  }
  if (background === 'tube') s.scanlines(0, 0, SCREEN.width, SCREEN.height);
  return s.tiles();
}

// Font comparison: every small font on one screen, one line each, drawn in that font: its name and cell, a
// sample sentence, look-alike characters, brackets and operators, box drawing
// and a Braille spinner frame.
export const FONT_SAMPLE = 'Quick brown fox 0O1lI| {}[] -> != ─┼─ ⠋';
export const FONT_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789';
// Japanese mode shows kana, kanji and full-width punctuation on the second line instead.
export const FONT_SAMPLE_JA = 'あいうえお アイウエオ 日本語の表示、漢字。「東雲」 ABC abc 0123';
// selected: the row marked '>' (Eugene, 2026-11-27: choose directly on the comparison pages).
// nativeRow: leave the top NATIVE_COMPARE_ROW px free for Native text, which the glasses draw in
// their own font in a text container above these tiles (the tiles cannot draw that font).
export const NATIVE_COMPARE_ROW = 30;
// The sample sentence every row of Compare fonts shows.
export const fontSample = () => getLang() === 'ja' ? FONT_SAMPLE_JA : FONT_SAMPLE;
// Largest first, as Compare fonts lists them under Native text (Eugene, 2026-11-27).
export const FONTS_BY_SIZE: FineFont[] = [...FINE_FONTS].reverse();
export function renderFontComparison(level = INK_MAX, selected = -1, nativeRow = false): number[][] {
  const s = new Surface(FINE_FONTS[0], inkByte(level));
  s.frame();
  const nameCells = Math.max(...FINE_FONTS.map(font => fineLabel(font).length)) + 2;
  let y = TOP + (nativeRow ? NATIVE_COMPARE_ROW : 0);
  for (const [i, font] of FONTS_BY_SIZE.entries()) {
    s.font = font;
    const layout = fineLayout(font);
    const sample = getLang() === 'ja' ? FONT_SAMPLE_JA : FONT_SAMPLE;
    s.text(`${i === selected ? '>' : ' '}${fineLabel(font).padEnd(nameCells)}${sample}`, layout.textX, y, layout.columns);
    y += TABLES[font].height + 2;
  }
  s.font = FINE_FONTS[0];
  const back = fineLayout(s.font);
  s.rect(back.textX, y + 2, back.textWidth, 1);
  s.text(t('compareBack'), back.textX, y + 8, back.columns);
  return s.tiles();
}

// A caption in the bottom-right corner of a picture (2026-11-27: the viewer's view and position,
// "Zoom 2/4 · 1/3"), on a black box so it reads over any picture.
export function captionTiles(tiles: number[][], caption: string, font: FineFont, level = INK_MAX): number[][] {
  const s = new Surface(font, inkByte(level));
  FINE_TILES.forEach((tile, i) => {
    for (let y = 0; y < tile.height; y++) for (let x = 0; x < tile.width; x++)
      s.pixels[(tile.yPosition + y) * SCREEN.width + tile.xPosition + x] = tiles[i][y * tile.width + x];
  });
  const { width: cw, height: ch } = TABLES[font];
  const cells = Math.min(fineCells(caption), Math.floor((SCREEN.width - 8) / cw));
  const w = cells * cw + 6, h = ch + 3, x = SCREEN.width - w, y = SCREEN.height - h;
  s.rect(x, y, w, h, 0);
  s.text(caption, x + 3, y + 2, cells);
  return s.tiles();
}

// The keys page (Eugene, 2026-11-27: "can you fit everything there? If not make it rendered image
// page"): every key in two columns in the pixel font, a heading row per group ('# Group') with a
// thin rule under it, then 'action<TAB>keys' rows with the keys at the right of the column. A group
// heading never ends a column.
export function renderKeysPage(rows: string[], font: FineFont, level = INK_MAX): number[][] {
  const s = new Surface(font, inkByte(level));
  s.frame();
  const { width: cw, height: ch } = TABLES[font];
  const { columns, textX } = fineLayout(font);
  const colCells = Math.floor((columns - 2) / 2);
  const perColumn = Math.floor((SCREEN.height - TOP - 4) / ch);
  const rule = Math.max(inkByte(1), Math.round(s.ink * 0.3 / 17) * 17);
  let col = 0, row = 0;
  for (const [i, line] of rows.entries()) {
    const heading = line.startsWith('# ');
    if (heading && row === perColumn - 1) { col++; row = 0; }
    if (row >= perColumn) { col++; row = 0; }
    if (col > 1) break;
    if (heading && row > 0 && i > 0) row = Math.min(row, perColumn - 1);
    const x = textX + col * (colCells + 2) * cw, y = TOP + row * ch;
    if (heading) {
      s.text(line.slice(2), x, y, colCells);
      s.rect(x, y + ch - 1, colCells * cw, 1, rule);
    } else {
      const [action, keys = ''] = line.split('\t');
      const keyCells = Math.min(fineCells(keys), colCells);
      s.text(action, x, y, Math.max(0, colCells - keyCells - 1));
      s.text(keys, x + (colCells - keyCells) * cw, y, keyCells);
    }
    row++;
  }
  return s.tiles();
}

// One row per option: its label on the left and the sample turn to the right, so every option
// fits the screen in every font (Departure 7x14 included). The gap between rows is 2px when it
// fits and shrinks (to 0 at worst) as the list grows; the back row below needs line + 10px.
export const BACKGROUND_GAP = 2;
export function backgroundGap(font: FineFont): number {
  const { height: line } = TABLES[font];
  const count = TURN_BACKGROUNDS.length + 1; // the Halo row, then every option
  const room = SCREEN.height - 1 - TOP - count * line - 8 - line;
  return Math.max(0, Math.min(BACKGROUND_GAP, Math.floor(room / count)));
}
export function backgroundComparisonLayout(font: FineFont) {
  const { width: cell } = TABLES[font];
  const { columns, textX, textWidth } = fineLayout(font);
  // One cell for the '>' of the selected row, the label, one cell of space.
  const labelCells = Math.max(...TURN_BACKGROUNDS.map(option => fineCells(turnBackgroundLabel(option)))) + 2;
  // The Halo row's label runs across the sample column; only the option labels set the width.
  return { labelCells, sample: { textX: textX + labelCells * cell, textWidth: textWidth - labelCells * cell, columns: columns - labelCells } };
}
export function renderBackgroundComparison(font: FineFont, level = INK_MAX, halo = false, selected = -1): number[][] {
  const s = new Surface(font, inkByte(level));
  const { line, columns, textX, textWidth, rows } = fineLayout(font);
  const { labelCells, sample: region } = backgroundComparisonLayout(font);
  const [page] = readerPages(t('backgroundSample'), fineMeasure(font), region.textWidth, rows, Infinity);
  // The user's turn only: its first row. Dim replies shows the reply row, which it dims.
  const rowsOf = page.text.split('\n');
  const sample = { ...page, text: rowsOf[0], userTurns: page.userTurns.slice(0, 1) };
  const reply = { ...page, text: rowsOf.find((row, i) => i > 0 && row.trim()) ?? rowsOf[0], userTurns: [0] };
  const gap = backgroundGap(font);
  s.frame();
  let y = TOP;
  // Row 0: the Halo switch (a click toggles it on this page); rows 1.. the options.
  s.text(`${selected === 0 ? '>' : ' '}${t('backgroundHalo', t(halo ? 'backgroundHaloOn' : 'backgroundHaloOff'))}`, textX, y, columns);
  y += line + gap;
  for (const [i, option] of TURN_BACKGROUNDS.entries()) {
    s.text(`${i + 1 === selected ? '>' : ' '}${turnBackgroundLabel(option)}`, textX, y, labelCells);
    drawTurnRows(s, option === 'dimreplies' ? reply : sample, y, option, region, halo);
    if (option === 'tube') s.scanlines(region.textX, y, region.textWidth, line);
    y += line + gap;
  }
  s.rect(textX, y + 2, textWidth, 1);
  s.text(t('compareBack'), textX, y + 8, columns);
  return s.tiles();
}

// Markdown tables in replies are padded so their columns line up in the
// monospace small-text fonts (native text is proportional and cannot align).
// A table is a run of '| ... |' rows whose second row is the '|---|:--:|' rule;
// that rule's colons set each column's alignment. Role prefixes ('> ', '/ ',
// two-space continuation) are kept. Anything else passes through unchanged.
export function alignMarkdownTables(text: string): string {
  const lines = text.split('\n');
  const prefix = (line: string) => /^(?:[/>] | {2})/.exec(line)?.[0] ?? '';
  const body = (line: string) => line.slice(prefix(line).length).trim();
  const isRow = (line: string) => /^\|.*\|$/.test(body(line));
  const out: string[] = [];
  for (let i = 0; i < lines.length;) {
    if (!isRow(lines[i])) { out.push(lines[i++]); continue; }
    let j = i;
    while (j < lines.length && isRow(lines[j])) j++;
    const block = lines.slice(i, j);
    const cells = block.map(line => body(line).slice(1, -1).split('|').map(cell => cell.trim()));
    if (block.length < 2 || !cells[1].every(cell => /^:?-+:?$/.test(cell))) { out.push(...block); i = j; continue; }
    const count = Math.max(...cells.map(row => row.length));
    const align = Array.from({ length: count }, (_, c) => {
      const rule = cells[1][c] ?? '';
      return rule.endsWith(':') ? (rule.startsWith(':') ? 'center' : 'right') : 'left';
    });
    const widths = Array.from({ length: count }, (_, c) =>
      Math.max(3, ...cells.filter((_, r) => r !== 1).map(row => fineCells(row[c] ?? ''))));
    const pad = (cell: string, width: number, how: string) => {
      const gap = width - fineCells(cell);
      return how === 'right' ? ' '.repeat(gap) + cell : how === 'center'
        ? ' '.repeat(gap >> 1) + cell + ' '.repeat(gap - (gap >> 1)) : cell + ' '.repeat(gap);
    };
    block.forEach((line, r) => {
      const row = r === 1 ? widths.map(w => '-'.repeat(w)) : widths.map((w, c) => pad(cells[r][c] ?? '', w, align[c]));
      out.push(`${prefix(line)}| ${row.join(' | ')} |`);
    });
    i = j;
  }
  return out.join('\n');
}
