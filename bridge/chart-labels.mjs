// AI Labels (Eugene, 2026-11-27): the local vision model's reading of a chart, put back on the chart.
// At 576x288 in 16 levels most chart text (title, ticks, legend, notes, source) is unreadable; the
// app redraws it in Scientifica 5x11 where it was printed.
//
// Words come only from the model (Ollama structured output: every printed line of text, its role
// and a box). Positions come from the picture itself. The model's boxes were measured against the
// exact boxes of three synthetic charts (2026-11-27, qwen3.8:27b): median centre error 1-14 screen
// pixels, up to 24, with month ticks drawn on the axis line instead of under it and drifting along
// it; one prompt wording returned [0, 0, 1000, 1000] for every line. So the bridge finds the printed
// words in the full-resolution source (connected components of ink, grouped into words and rows)
// and gives each model line the run of words that fits it best in position and shape; the matched
// words' positions were within 0.6 screen pixels of the truth (median 0.2). A model line with no
// such run is left out: nothing is drawn where the picture shows no text, and nothing is drawn that
// the model did not read.
//
// Output for the app: the same flat-tone rendering as Original Picture, with the pixels of every
// replaced word cleared to the background level, and labels in 576x288 screen coordinates.
// image.mjs imports this module too; the cycle is safe because both use the imports only inside functions.
import { IMAGE_HEIGHT, IMAGE_WIDTH, flatLevels, layout, packLevels, resample } from './image.mjs';

export const LABEL_ROLES = ['title', 'subtitle', 'legend', 'axis-title', 'x-tick', 'y-tick', 'annotation', 'data-label', 'source', 'other'];

const ASK = [
  'You read the text printed on a chart image for a person who cannot see it well.',
  'List every piece of text you can read, one entry per printed line: title, subtitle, legend entries,',
  'axis titles, every axis tick label, annotations and callouts, data labels on bars or points, source or credit lines.',
  'Copy each text exactly as printed, character for character. Never compute, round, translate or add a value.',
  'Leave out any text you cannot read with certainty.',
];
const BOX = 'For each entry give its role and its bounding box [x1, y1, x2, y2] around the printed letters, ' +
  'with coordinates normalised to 0-1000 (0,0 is the top-left corner of the image, 1000,1000 the bottom-right).';
const ROLES = 'Roles: x-tick = a label along the horizontal axis (a date, a category); y-tick = a value along a vertical axis; ' +
  'axis-title = the name or unit of an axis; annotation = a note or callout inside the chart; ' +
  'data-label = a value printed on a bar or point; source = a source or credit line.';
// The wording matters to the boxes (2026-11-27, five charts): the role definitions placed before
// the box request gave whole-image boxes on two charts; after it, tight boxes on all five, and the
// lowest error. The plain wording (no role definitions) is the retry when an answer's boxes are
// unusable.
export const LABELS_PROMPT = [...ASK, 'Leave out text that is not horizontal.', BOX, ROLES].join(' ');
export const LABELS_PROMPT_PLAIN = [...ASK, BOX].join(' ');

// Ollama `format`: the answer must be this JSON (llama.cpp turns the schema into a grammar).
export const LABELS_SCHEMA = {
  type: 'object',
  properties: {
    isChart: { type: 'boolean' },
    texts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          role: { type: 'string', enum: LABEL_ROLES },
          box: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
        },
        required: ['text', 'role', 'box'],
      },
    },
  },
  required: ['isChart', 'texts'],
};

const MAX_TEXTS = 80, MAX_TEXT = 80;
// Letters, digits, punctuation, symbols and spaces; no control or format characters.
const PRINTABLE = /^[\p{L}\p{M}\p{N}\p{P}\p{S} ]+$/u;
// A box for one printed line is never taller than 15 % of the picture or larger than a tenth of it.
const degenerate = ([x0, y0, x1, y1]) => y1 - y0 > 150 || (x1 - x0) * (y1 - y0) > 100000;

// The model's answer (parsed JSON) -> lines of text with boxes in source pixels, and how many boxes
// were unusable. Anything that is not a clean single line of printable text with a sensible box is
// dropped here.
export function modelTexts(answer, width, height) {
  const texts = [];
  let unusable = 0;
  if (!answer || typeof answer !== 'object' || !Array.isArray(answer.texts)) return Object.assign(texts, { unusable });
  for (const item of answer.texts.slice(0, MAX_TEXTS)) {
    if (!item || typeof item.text !== 'string' || !Array.isArray(item.box) || item.box.length !== 4) continue;
    const text = item.text.replace(/\s+/g, ' ').trim();
    if (!text || text.length > MAX_TEXT || !PRINTABLE.test(text)) continue;
    const box = item.box.map(Number);
    if (!box.every(Number.isFinite)) continue;
    const [a, b, c, d] = box.map(v => Math.max(0, Math.min(1000, v)));
    const norm = [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
    if (norm[2] - norm[0] < 1 || norm[3] - norm[1] < 1 || degenerate(norm)) { unusable++; continue; }
    texts.push({ text, role: LABEL_ROLES.includes(item.role) ? item.role : 'other',
      box: [norm[0] / 1000 * width, norm[1] / 1000 * height, norm[2] / 1000 * width, norm[3] / 1000 * height] });
  }
  return Object.assign(texts, { unusable });
}

// ---- Words in the picture ----------------------------------------------------------------------

// The most common grey (the chart's background), from a 64-bin histogram refined to its peak value.
export function backgroundGrey(pixels) {
  const counts = new Uint32Array(256);
  for (const v of pixels) counts[v]++;
  let best = 0, bestSum = -1;
  for (let bin = 0; bin < 64; bin++) {
    const sum = counts[bin * 4] + counts[bin * 4 + 1] + counts[bin * 4 + 2] + counts[bin * 4 + 3];
    if (sum > bestSum) { bestSum = sum; best = bin; }
  }
  let peak = best * 4;
  for (let v = best * 4; v < best * 4 + 4; v++) if (counts[v] > counts[peak]) peak = v;
  return peak;
}

// Connected components (8-neighbour) of ink: pixels that differ from the background by more than
// 35 % of the strongest contrast in the picture. Light gridlines (about 55 grey steps on white) stay
// below that, so a tick label next to a gridline is not joined to it.
export function inkComponents({ width, height, pixels }, background = backgroundGrey(pixels)) {
  const n = width * height;
  const contrast = new Uint8Array(n);
  const counts = new Uint32Array(256);
  for (let i = 0; i < n; i++) { const d = Math.abs(pixels[i] - background); contrast[i] = d; counts[d]++; }
  // 99.5th percentile of contrast: the text's ink, not a few stray pixels.
  let strongest = 255, seen = 0;
  while (strongest > 0 && (seen += counts[strongest]) < n * 0.005) strongest--;
  const threshold = Math.max(40, strongest * 0.35);
  const label = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const components = [];
  for (let start = 0; start < n; start++) {
    if (label[start] !== -1 || contrast[start] < threshold) continue;
    const id = components.length;
    let top = 0, x0 = width, y0 = height, x1 = 0, y1 = 0, count = 0;
    stack[top++] = start;
    label[start] = id;
    const members = [];
    while (top) {
      const i = stack[--top], x = i % width, y = (i - x) / width;
      members.push(i);
      count++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const j = ny * width + nx;
          if (label[j] === -1 && contrast[j] >= threshold) { label[j] = id; stack[top++] = j; }
        }
      }
    }
    components.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, count, members });
  }
  return { background, threshold, components, label };
}

// Glyph-like components grouped into words (letters closer than about a third of their height) and
// rows (words on one line, closer than about 1.2 times their height). Long lines, axes, bars and
// series lines are too large or too thin to be glyphs; dashes of a dashed line are too flat to start
// a word, and join one only as a hyphen in its middle band.
export function findWords(picture) {
  const { width, height } = picture;
  const { background, components, label } = inkComponents(picture);
  const maxGlyph = Math.max(24, Math.min(width, height) * 0.12);
  const glyphs = [], small = [];
  for (const c of components) {
    const w = c.x1 - c.x0, h = c.y1 - c.y0;
    // A solid block does not start a word: a legend swatch or a marker next to a label must not
    // join it. Letters fill well under 85 % of their box, except thin ones (l, I, 1), which are
    // under 0.4 as wide as tall. A small block (the dot of a bold i, a full stop) still joins the
    // word it sits in, as a mark, so it is cleared with it.
    const block = h >= 6 && w > 0.4 * h && c.count > 0.85 * w * h;
    const glyph = !block && h >= 6 && h <= maxGlyph && w <= Math.max(8 * h, 12) && c.count >= 6;
    const mark = !glyph && h < maxGlyph && w < maxGlyph;
    c.kind = glyph ? 'glyph' : mark ? 'mark' : 'line';
    if (glyph) glyphs.push(c); else if (mark) small.push(c);
    // Member pixels are kept only for what may be cleared later (glyphs and marks).
    else c.members = null;
  }
  glyphs.sort((a, b) => a.x0 - b.x0);
  // Union glyphs into words: vertical bands overlapping by half the smaller height, horizontal gap
  // under 0.35 of the taller one.
  const parent = glyphs.map((_, i) => i);
  const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (let i = 0; i < glyphs.length; i++) {
    const a = glyphs[i];
    for (let j = i + 1; j < glyphs.length; j++) {
      const b = glyphs[j];
      const h = Math.max(a.y1 - a.y0, b.y1 - b.y0);
      if (b.x0 - a.x1 > 0.6 * h) { if (b.x0 - a.x1 > 0.6 * maxGlyph) break; continue; }
      const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (overlap < 0.5 * Math.min(a.y1 - a.y0, b.y1 - b.y0)) continue;
      const gap = b.x0 - a.x1;
      // Same-height neighbours at most 0.35 h apart; an x-height letter beside a capital counts too.
      if (gap <= 0.35 * h) parent[find(j)] = find(i);
    }
  }
  const groups = new Map();
  glyphs.forEach((g, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(g); });
  const words = [...groups.values()].map(parts => {
    const box = parts.reduce((b, p) => [Math.min(b[0], p.x0), Math.min(b[1], p.y0), Math.max(b[2], p.x1), Math.max(b[3], p.y1)], [Infinity, Infinity, -Infinity, -Infinity]);
    return { box, parts };
  });
  // Dots of i and j, full stops, commas, colons and hyphens join the word they sit in.
  for (const m of small) {
    const w = m.x1 - m.x0, h = m.y1 - m.y0, cx = (m.x0 + m.x1) / 2, cy = (m.y0 + m.y1) / 2;
    let best = null;
    for (const word of words) {
      const [x0, y0, x1, y1] = word.box, wh = y1 - y0;
      if (h > 0.6 * wh || w > 1.2 * wh) continue;
      const flat = w >= 2 * h;
      // A hyphen sits in the middle of the line; a dash of a dashed line below it does not join.
      const inY = flat ? cy > y0 + 0.2 * wh && cy < y1 - 0.2 * wh : m.y0 >= y0 - 0.45 * wh && m.y1 <= y1 + 0.25 * wh;
      const inX = m.x0 >= x0 - 0.3 * wh && m.x1 <= x1 + 0.4 * wh;
      if (inX && inY && (!best || Math.abs(cx - (x0 + x1) / 2) < Math.abs(cx - (best.box[0] + best.box[2]) / 2))) best = word;
    }
    if (best) {
      best.parts.push(m);
      best.box = [Math.min(best.box[0], m.x0), Math.min(best.box[1], m.y0), Math.max(best.box[2], m.x1), Math.max(best.box[3], m.y1)];
    }
  }
  // Rows: words on one line (bands overlapping by half), left to right, gaps under 1.2 heights.
  words.sort((a, b) => a.box[0] - b.box[0]);
  const rowOf = words.map((_, i) => i);
  const findRow = i => { while (rowOf[i] !== i) i = rowOf[i] = rowOf[rowOf[i]]; return i; };
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      const a = words[i].box, b = words[j].box;
      const h = Math.max(a[3] - a[1], b[3] - b[1]);
      if (b[0] - a[2] > 1.2 * h) continue;
      const overlap = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
      if (overlap >= 0.5 * Math.min(a[3] - a[1], b[3] - b[1])) rowOf[findRow(j)] = findRow(i);
    }
  }
  const rows = new Map();
  words.forEach((word, i) => { const r = findRow(i); if (!rows.has(r)) rows.set(r, []); rows.get(r).push(i); });
  return { background, words, rows: [...rows.values()].map(row => row.sort((a, b) => words[a].box[0] - words[b].box[0])),
    width, label, components };
}

// ---- Matching the model's lines to words -------------------------------------------------------

const centre = box => [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
const union = boxes => boxes.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[2]), Math.max(b[3], p[3])], [Infinity, Infinity, -Infinity, -Infinity]);

// Every run of consecutive words in a row that could print `element`: up to two words more or one
// fewer than its spaces suggest (kerning splits a word, a tight space joins two).
function candidates(element, found) {
  const tokens = element.text.split(' ').length;
  const chars = element.text.replace(/ /g, '').length;
  const out = [];
  for (const row of found.rows) {
    for (let i = 0; i < row.length; i++) {
      for (let len = 1; len <= tokens + 2 && i + len <= row.length; len++) {
        const ids = row.slice(i, i + len);
        if (len < tokens - 1) continue;
        const box = union(ids.map(id => found.words[id].box));
        const w = box[2] - box[0], h = box[3] - box[1];
        // Width per character over height: about 0.3 for narrow fonts to 1.2 for wide digits.
        const perChar = w / (chars * h);
        if (perChar < 0.22 || perChar > 1.4) continue;
        // A word fewer than the spaces suggest is a strong sign of the wrong run; a word more is
        // often only kerning that split a word.
        out.push({ ids, box, extra: len < tokens ? 2.5 * (tokens - len) : len - tokens });
      }
    }
  }
  return out;
}

// Cost of printing `element` (with its model box moved by `shift`) at a candidate: distance in text
// heights, size disagreement (log ratio of widths and heights) and a cost per word more or fewer
// than the text's spaces suggest (1.0 per missing word, 0.4 per extra word).
function cost(element, cand, shift) {
  const b = shift(element.box);
  const [bx, by] = centre(b), [cx, cy] = centre(cand.box);
  const ch = cand.box[3] - cand.box[1], cw = cand.box[2] - cand.box[0];
  const em = Math.max(8, ch);
  const distance = Math.hypot(cx - bx, cy - by) / em;
  // The model's box widths are loose (a "0" tick as wide as "100" beside it); the run's own width is
  // already checked against the text's length, so width counts less than height here.
  const size = 0.6 * Math.abs(Math.log(cw / Math.max(1, b[2] - b[0]))) + Math.abs(Math.log(ch / Math.max(1, b[3] - b[1])));
  return { distance, size, total: distance + 1.5 * size + 0.4 * cand.extra };
}

// Greedy assignment, lowest cost first; each word serves one line. With `ratio`, a line is taken
// only when its best place is clearly better than its second best (unambiguous anchors).
function assign(elements, cands, shift, { reach, ratio = 0 }) {
  const options = [];
  elements.forEach((element, e) => {
    const scored = cands[e].map(cand => ({ e, cand, ...cost(element, cand, shift(e)) }))
      .filter(o => o.distance <= reach && o.size <= 1.4).sort((a, b) => a.total - b.total);
    if (!scored.length) return;
    if (ratio && scored.length > 1 && scored[1].total < scored[0].total * ratio) return;
    options.push(...(ratio ? scored.slice(0, 1) : scored));
  });
  options.sort((a, b) => a.total - b.total);
  const used = new Set(), done = new Map();
  for (const o of options) {
    if (done.has(o.e) || o.cand.ids.some(id => used.has(id))) continue;
    done.set(o.e, o);
    o.cand.ids.forEach(id => used.add(id));
  }
  return done;
}

// Least-squares line through (from, to) pairs, for the model's drift along a row or column of
// ticks (seen 2026-11-27: twelve month ticks spaced a few per cent too wide). Fewer than three
// pairs, too little spread, or a slope far from 1 (a wrong anchor, not a drift): the median offset.
function fit(pairs, line) {
  if (!pairs.length) return v => v;
  const offsets = pairs.map(([a, b]) => b - a).sort((x, y) => x - y);
  const median = offsets[offsets.length >> 1];
  const xs = pairs.map(p => p[0]);
  if (!line || pairs.length < 3 || Math.max(...xs) - Math.min(...xs) < 1) return v => v + median;
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  let sxy = 0, sxx = 0;
  for (const [a, b] of pairs) { sxy += (a - mx) * (b - my); sxx += (a - mx) ** 2; }
  const slope = sxy / sxx;
  if (!(slope > 0.8 && slope < 1.25)) return v => v + median;
  return v => my + slope * (v - mx);
}

// Model lines whose positions share one error: the ticks along each axis. Everything else is
// corrected by its own group's median offset only.
const group = element => element.role === 'x-tick' || element.role === 'y-tick' ? element.role : 'other';

// Short lines that line up with two or more like them are ticks: a row along the x axis, a column
// along a y axis. A real chart's ticks all came back from the model as axis titles (2026-11-27), and
// ticks need their own correction (below) and their own alignment and thinning (app).
export function tickRoles(items) {
  const roles = items.map(item => item.role);
  const pool = items.map((_, i) => i)
    .filter(i => items[i].text.length <= 12 && ['axis-title', 'other', 'x-tick', 'y-tick'].includes(items[i].role));
  for (const i of pool) {
    const b = items[i].box, h = b[3] - b[1], [cx, cy] = centre(b);
    const row = pool.filter(j => Math.abs(centre(items[j].box)[1] - cy) < 0.5 * h);
    const column = pool.filter(j => {
      const o = items[j].box;
      return j === i || (Math.abs(centre(o)[1] - cy) >= 0.5 * h &&
        (Math.abs(o[2] - b[2]) < h || Math.abs(o[0] - b[0]) < h || Math.abs(centre(o)[0] - cx) < h));
    });
    if (row.length >= 3 && row.length >= column.length) roles[i] = 'x-tick';
    else if (column.length >= 3) roles[i] = 'y-tick';
  }
  // A tick alone in its row (or column) while three or more ticks share another is the axis's
  // title or unit ("Mar. 2027" under the dates came back as an x tick).
  for (const [role, along] of [['x-tick', 1], ['y-tick', 0]]) {
    const ticks = roles.map((r, i) => r === role ? i : -1).filter(i => i >= 0);
    for (const i of ticks) {
      const b = items[i].box, h = b[3] - b[1];
      const line = j => along === 1 ? Math.abs(centre(items[j].box)[1] - centre(b)[1]) < 0.5 * h
        : Math.abs(items[j].box[2] - b[2]) < h || Math.abs(items[j].box[0] - b[0]) < h;
      const mine = ticks.filter(line).length;
      if (mine === 1 && ticks.length - 1 >= 3) roles[i] = 'axis-title';
    }
  }
  return roles;
}

// A first or last letter that touches a line (the series line through "Launch price" in the
// synthetic right-axis chart) belongs to the
// line's component, so the words found are short of the text. Such a match has at least two glyphs
// fewer than the text has letters, and line ink right beside the cut side. Returns that side.
function cutSide(text, box, parts, found) {
  const glyphs = parts.filter(p => p.kind === 'glyph').length;
  const letters = text.replace(/[\s.,:;'"`-]/g, '').length;
  if (letters - glyphs < 2) return undefined;
  const h = box[3] - box[1], strip = Math.max(4, Math.round(1.2 * h));
  const lineInk = (x0, x1) => {
    let n = 0;
    for (let y = Math.max(0, Math.floor(box[1])); y < box[3]; y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(found.width, x1); x++) {
      const id = found.label[y * found.width + x];
      if (id >= 0 && found.components[id].kind === 'line') n++;
    }
    return n;
  };
  const left = lineInk(box[0] - strip, box[0]), right = lineInk(box[2], box[2] + strip);
  const area = strip * h * 0.04;
  if (left > area && left > 2 * right) return 'left';
  if (right > area && right > 2 * left) return 'right';
  return undefined;
}

// Letters a printed word shows: its glyphs grouped by overlapping columns, so the dot of an i, an
// umlaut or the parts of a % count once; letters that touch count once too.
function letterCount(word) {
  const spans = word.parts.filter(p => p.kind === 'glyph').map(p => [p.x0, p.x1]).sort((a, b) => a[0] - b[0]);
  let count = 0, end = -Infinity;
  for (const [x0, x1] of spans) {
    if (x0 >= end - 1) count++;
    end = Math.max(end, x1);
  }
  return count;
}

// A misreading that drops a letter (a doubled letter of a real chart's title read once, qwen3.8:27b
// on a downscaled chart, 2026-11-27): a printed word shows more letters than the model's word has characters. Touching
// letters only lower the printed count, so a correct reading is never taken for a misreading.
// A changed letter ("86" for "96") cannot be seen this way.
export function misread(text, ids, found) {
  const tokens = text.split(' ');
  if (ids.length === tokens.length) return ids.some((id, i) => letterCount(found.words[id]) > [...tokens[i]].length);
  return ids.reduce((n, id) => n + letterCount(found.words[id]), 0) > [...text.replace(/ /g, '')].length;
}

// Model lines -> matches { element, role, box (source px), parts (glyph components), cut }.
// Pass 1 takes unambiguous anchors near the model's own boxes. From them, each group's correction:
// x ticks get a line for x (drift along the axis) and an offset for y; y ticks the other way round;
// the rest an offset. Pass 2 places every other line close to its corrected box; pass 3 tries the
// rest at their own boxes. Anchors stay.
export function matchTexts(elements, found) {
  const groups = tickRoles(elements).map(role => role === 'x-tick' || role === 'y-tick' ? role : 'other');
  const cands = elements.map(element => candidates(element, found));
  const identity = () => box => box;
  const anchors = assign(elements, cands, identity, { reach: 4, ratio: 1.6 });
  const corrections = new Map();
  for (const name of ['x-tick', 'y-tick', 'other']) {
    const pairs = [...anchors.values()].filter(o => groups[o.e] === name);
    if (!pairs.length) continue;
    const fx = fit(pairs.map(o => [centre(elements[o.e].box)[0], centre(o.cand.box)[0]]), name === 'x-tick');
    const fy = fit(pairs.map(o => [centre(elements[o.e].box)[1], centre(o.cand.box)[1]]), name === 'y-tick');
    corrections.set(name, box => {
      const [cx, cy] = centre(box), w = box[2] - box[0], h = box[3] - box[1];
      const nx = fx(cx), ny = fy(cy);
      return [nx - w / 2, ny - h / 2, nx + w / 2, ny + h / 2];
    });
  }
  const shift = e => corrections.get(groups[e]) ?? corrections.get('other') ?? (box => box);
  const taken = new Set([...anchors.values()].flatMap(o => o.cand.ids));
  const free = elements.map((_, e) => anchors.has(e) ? [] : cands[e].filter(cand => !cand.ids.some(id => taken.has(id))));
  const matched = new Map([...anchors, ...assign(elements, free, shift, { reach: 2.5 })]);
  // Pass 3: a line the group correction moved away (a y tick "0" the model put on the x-tick row)
  // gets one more try at its own box, with the words still free.
  const used = new Set([...matched.values()].flatMap(o => o.cand.ids));
  const left = elements.map((_, e) => matched.has(e) ? [] : cands[e].filter(cand => !cand.ids.some(id => used.has(id))));
  for (const [e, o] of assign(elements, left, identity, { reach: 2.5 })) matched.set(e, o);
  // A line whose printed words show more letters than it has is left out (its pixels stay).
  const matches = [...matched.values()].filter(o => !misread(elements[o.e].text, o.cand.ids, found)).sort((a, b) => a.e - b.e).map(o => {
    const element = elements[o.e], parts = o.cand.ids.flatMap(id => found.words[id].parts);
    return { element, box: o.cand.box, parts, cut: cutSide(element.text, o.cand.box, parts, found) };
  });
  // Punctuation that hangs below the line (the comma of a bold title) overlaps its letters too little
  // to join a word, so it would stay on screen beside the redrawn label. A matched line also clears
  // the small glyphs and dots within its width that start inside its band and end at most 0.45 of
  // its height below it. Dots of a dotted line under a label start below its box and are not taken;
  // flat dashes are taken only in the middle of the line (a hyphen).
  const cleared = new Set(matches.flatMap(m => m.parts));
  for (const m of matches) {
    const [x0, y0, x1, y1] = m.box, h = y1 - y0;
    for (const c of found.components) {
      if (!c.members || cleared.has(c) || c.x0 < x0 || c.x1 > x1) continue;
      const ch = c.y1 - c.y0, cw = c.x1 - c.x0;
      if (ch > 0.6 * h) continue;
      const inBand = cw >= 2 * ch ? (c.y0 + c.y1) / 2 > y0 + 0.2 * h && (c.y0 + c.y1) / 2 < y1 - 0.2 * h
        : c.y0 >= y0 - 0.45 * h && c.y0 < y1 && c.y1 <= y1 + 0.45 * h;
      if (inBand) { m.parts.push(c); cleared.add(c); }
    }
  }
  // Roles once more, from the printed positions.
  tickRoles(matches.map(m => ({ text: m.element.text, role: m.element.role, box: m.box }))).forEach((role, i) => { matches[i].role = role; });
  return matches;
}

// ---- Alignment ---------------------------------------------------------------------------------

// Which edge of the original a label keeps: a column of y ticks or a stack of note lines keeps the
// edge they share (smaller spread); x ticks and data labels stay centred; titles, legends and
// sources keep the left edge, or the right edge near the picture's right side. A line cut short by
// a touching line keeps its intact edge.
export function alignments(matches, width) {
  const spread = values => Math.max(...values) - Math.min(...values);
  for (const m of matches) {
    const [x0, , x1] = m.box, h = m.box[3] - m.box[1];
    if (m.cut) { m.align = m.cut === 'left' ? 'right' : 'left'; continue; }
    if (m.role === 'x-tick' || m.role === 'data-label') { m.align = 'center'; continue; }
    const together = matches.filter(o => o.role === m.role && !o.cut && Math.min(o.box[2], x1) - Math.max(o.box[0], x0) > -h &&
      (m.role === 'y-tick' || Math.abs(centre(o.box)[1] - centre(m.box)[1]) < 3 * h));
    if (together.length >= 2 && (m.role === 'y-tick' || m.role === 'annotation')) {
      const left = spread(together.map(o => o.box[0])), right = spread(together.map(o => o.box[2]));
      const mid = spread(together.map(o => centre(o.box)[0]));
      m.align = mid < Math.min(left, right) ? 'center' : left <= right ? 'left' : 'right';
      continue;
    }
    if (m.role === 'annotation' || m.role === 'y-tick') { m.align = 'center'; continue; }
    const leftGap = x0, rightGap = width - x1, middle = Math.abs((x0 + x1) / 2 - width / 2);
    m.align = middle < 0.02 * width && leftGap > 0.1 * width ? 'center' : rightGap < leftGap && rightGap < 0.05 * width ? 'right' : 'left';
  }
  return matches;
}

// ---- The screen --------------------------------------------------------------------------------

// The AI Labels screen for a decoded picture and the model's texts: the Original Picture rendering
// (flat tones), replaced words cleared to the background level, labels in screen coordinates.
// `negative` as in screenView (undefined = automatic for mostly white pictures).
export function labelsView(source, elements, negative) {
  const { w, h } = layout(source.width, source.height, 'fit');
  const scale = w / source.width;
  const resampled = resample(source, w, h);
  let sum = 0;
  for (const v of resampled.pixels) sum += v;
  const brightness = resampled.pixels.length ? sum / resampled.pixels.length / 255 : 0;
  const inverted = negative ?? brightness > 0.6;
  const pixels = inverted ? resampled.pixels.map(v => 255 - v) : resampled.pixels;
  const tone = flatLevels(pixels);
  const ox = (IMAGE_WIDTH - w) >> 1, oy = (IMAGE_HEIGHT - h) >> 1;
  // Background level: the most common level of the rendered picture.
  const levelCounts = new Uint32Array(16);
  for (const v of tone) levelCounts[v]++;
  const background = levelCounts.indexOf(Math.max(...levelCounts));
  const found = findWords(source);
  const matches = alignments(matchTexts(elements, found), source.width);
  // Clear each replaced word's glyph pixels, with a 2-pixel margin for anti-aliased edges, in the
  // scaled picture: lines and gridlines that pass by keep their pixels.
  const cleared = new Uint8Array(w * h);
  const pad = 2;
  for (const m of matches) for (const part of m.parts) for (const i of part.members ?? []) {
    const sx = i % source.width, sy = (i - sx) / source.width;
    const dx0 = Math.max(0, Math.floor((sx - pad) * scale)), dx1 = Math.min(w - 1, Math.floor((sx + pad) * scale));
    const dy0 = Math.max(0, Math.floor((sy - pad) * scale)), dy1 = Math.min(h - 1, Math.floor((sy + pad) * scale));
    for (let y = dy0; y <= dy1; y++) for (let x = dx0; x <= dx1; x++) cleared[y * w + x] = 1;
  }
  const screen = new Uint8Array(IMAGE_WIDTH * IMAGE_HEIGHT);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    screen[(y + oy) * IMAGE_WIDTH + x + ox] = cleared[i] ? background : tone[i];
  }
  const labels = matches.map(m => {
    const [x0, y0, x1, y1] = m.box;
    const sx = m.align === 'left' ? x0 : m.align === 'right' ? x1 : (x0 + x1) / 2;
    return {
      text: m.element.text, role: m.role, align: m.align,
      x: Math.round(sx * scale + ox), y: Math.round((y0 + y1) / 2 * scale + oy),
      // The original's size on screen, for the app's overlap checks.
      w: Math.round((x1 - x0) * scale), h: Math.round((y1 - y0) * scale),
    };
  });
  return {
    width: IMAGE_WIDTH, height: IMAGE_HEIGHT, data: packLevels(screen), mean: brightness, negative: inverted,
    style: 'graphic', view: 'labels', regions: 1, region: 0, labels, background, ink: background < 8 ? 15 : 0,
  };
}

