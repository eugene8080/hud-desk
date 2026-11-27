// MIME conversion adapted from messenger-glass/companion/mail-facade.mjs (MIT).
const ENTITIES = new Map(Object.entries({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–',
  hellip: '…', bull: '•', copy: '©', reg: '®', trade: '™', euro: '€',
  zwnj: '', zwj: '', shy: '',
}));

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] !== '#') return ENTITIES.get(entity.toLowerCase()) ?? match;
    const code = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code) : '';
  });
}

// The <img> tags of an HTML body in document order: src, alt, and the width and height the HTML
// gives (attribute or inline style), so 1x1 tracking pixels and small icons can be skipped unseen.
export function htmlImages(html) {
  const images = [];
  const body = String(html ?? '').replace(/<!--[^]*?-->/g, '').replace(/<(script|style|head|title)\b[^>]*>[^]*?<\/\1\s*>/gi, '');
  for (const [tag] of body.matchAll(/<img\b[^>]*>/gi)) {
    const attr = name => decodeEntities(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(1).find(v => v !== undefined) ?? '');
    const style = attr('style');
    const size = name => Number(attr(name)) || Number(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*(\\d+)px`, 'i').exec(style)?.[1]) || 0;
    images.push({ src: attr('src').trim(), alt: attr('alt').replace(/\s+/g, ' ').trim(), width: size('width'), height: size('height') });
  }
  return images;
}

// Each <img> becomes a [[img:K]] marker (K counts the <img> tags in order); the bridge maps K to
// the message's picture list or drops the marker (mail.mjs).
export function htmlToText(html) {
  let k = 0;
  return decodeEntities(html
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<(script|style|head|title)\b[^>]*>[^]*?<\/\1\s*>/gi, '')
    .replace(/<img\b[^>]*>/gi, () => `\n[[img:${k++}]]\n`)
    .replace(/<blockquote\b[^>]*>[^]*?<\/blockquote\s*>/gi, '\n>\n')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|tr|h[1-6]|li|table|section|article)\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ''));
}

// Build this class from code points because U+2028 and U+2029 can terminate a regex literal.
const ZERO_WIDTH = new RegExp(`[${[
  0x00ad, 0x034f, 0x061c, 0x180e, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f,
  0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2066,
  0x2067, 0x2068, 0x2069, 0xfeff,
].map(code => String.fromCodePoint(code)).join('')}]`, 'g');

function withoutQuotes(text) {
  const lines = text.split('\n');
  return lines.filter((line, i) => {
    if (/^\s*>/.test(line)) return false;
    if (!/^\s*On .+ wrote:\s*$/i.test(line)) return true;
    let next = i + 1;
    while (next < lines.length && !lines[next].trim()) next++;
    return !/^\s*>/.test(lines[next] ?? '');
  }).join('\n');
}

export function tidy(text) {
  return withoutQuotes(text.replace(/\r\n?/g, '\n').replace(ZERO_WIDTH, ''))
    .replace(/<?(?:https?:\/\/|www\.)[^\s<>\])]+>?/gi, '')
    .replace(/\( *\)|\[ *\]/g, ' ')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function findPart(part, mime) {
  if (!part || part.filename || part.mimeType === 'message/rfc822') return null;
  if (part.mimeType === mime && part.body?.data) return part;
  for (const child of part.parts || []) {
    const match = findPart(child, mime);
    if (match) return match;
  }
  return null;
}

const decodePart = part => Buffer.from(part.body.data, 'base64url').toString('utf8');

// Plain-text mail is often hard-wrapped by the sender near 72-78 columns (RFC 5322 suggests 78).
// The reader keeps every line break, so each wrapped line would end a glasses row early. Join the
// wrapped lines of a paragraph back together and let the reader wrap to the glasses' own width.
const WRAP_MIN = 60;    // a body whose longest line is shorter than this was not wrapped to a column
const WRAP_MAX = 80;    // lines longer than this are not part of a column-wrapped paragraph
const WRAP_SLACK = 15;  // a wrapped line ends within this many characters of the wrap column
const LIST_ITEM = /^\s*(?:[-*•+]|\d{1,3}[.)])\s/;
const QUOTED = /^\s*>/;

export function unwrapPlain(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  // Count code points, not UTF-16 units, so an emoji counts as one column.
  const length = line => [...line.trimEnd()].length;
  const width = Math.max(0, ...lines.map(length).filter(n => n <= WRAP_MAX));
  if (width < WRAP_MIN) return lines.join('\n');
  // Require two lines ending near the column: one long sentence is not evidence of wrapping.
  if (lines.filter(line => length(line) >= width - WRAP_SLACK && length(line) <= width).length < 2) {
    return lines.join('\n');
  }
  // format=flowed (RFC 3676) marks a soft break with one trailing space; honour it directly.
  const soft = line => / $/.test(line) && !/ {2}$/.test(line);
  const wrapped = line => length(line) >= width - WRAP_SLACK && length(line) <= width;
  const joins = (line, next) => next !== undefined && line.trim() !== '' && next.trim() !== '' &&
    !QUOTED.test(line) && !QUOTED.test(next) && !LIST_ITEM.test(next) &&
    (soft(line) || wrapped(line));
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let paragraph = lines[i];
    while (joins(lines[i], lines[i + 1])) {
      paragraph = `${paragraph.trimEnd()} ${lines[i + 1].trimStart()}`;
      i++;
    }
    out.push(paragraph);
  }
  return out.join('\n');
}

// Replies from Outlook and Gmail carry the earlier messages below the new text without `>` marks:
// an Outlook "From: ... / Sent: ..." block, "-----Original Message-----", or "On <date>, <name> wrote:".
// The reader already shows the earlier messages of the thread, so cut each message at that point.
const HISTORY_FROM = /^\s*\*?From:\*?\s+\S/i;
const HISTORY_NEXT = /^\s*\*?(?:Sent|Date):\*?\s+\S/i;
const ORIGINAL = /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i;
const RULE = /^\s*(?:_{5,}|-{5,})\s*$/;
const FORWARD_MARK = /forwarded message|begin forwarded message/i;
const FORWARD_SUBJECT = /^\s*(?:fwd?|fw)\s*:/i;

export function withoutHistory(text, { subject = '' } = {}) {
  // A forward's quoted block IS the content, so keep everything in a forwarded message.
  if (FORWARD_SUBJECT.test(subject)) return text;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const outlook = HISTORY_FROM.test(line) && lines.slice(i + 1, i + 5).some(l => HISTORY_NEXT.test(l));
    // "On Tue, 3 Nov 2026 at 10:00, Name <a@b> wrote:" can be wrapped onto two lines by HTML layout.
    const wroteStart = /wrote:\s*$/i.test(line)
      ? (/^\s*On\s/i.test(line) ? i : /^\s*On\s/i.test(lines[i - 1] ?? '') ? i - 1 : -1)
      : -1;
    let start = outlook || ORIGINAL.test(line) ? i : wroteStart;
    if (start < 0) continue;
    if (lines.slice(Math.max(0, start - 3), start).some(l => FORWARD_MARK.test(l))) continue;
    // Drop the rule and blank lines Outlook draws above the header.
    while (start > 0 && (RULE.test(lines[start - 1]) || !lines[start - 1].trim())) start--;
    const kept = lines.slice(0, start).join('\n').trim();
    // A message that is only history (nothing new above the marker) stays whole rather than empty.
    return kept || text;
  }
  return text;
}

// preferHtml: read the HTML part even when a plain part exists, so pictures can sit where the mail
// shows them (a newsletter with pictures, 2026-11-27).
export function bodyText(payload, { subject = '', preferHtml = false } = {}) {
  const plain = findPart(payload, 'text/plain');
  const html = findPart(payload, 'text/html');
  const text = plain ? unwrapPlain(decodeEntities(decodePart(plain))) : '';
  return withoutHistory(tidy(html && (preferHtml || text.trim().length < 200) ? htmlToText(decodePart(html)) : text), { subject });
}

// The decoded HTML body, if the message has one.
export function bodyHtml(payload) {
  const html = findPart(payload, 'text/html');
  return html ? decodePart(html) : '';
}

export function header(message, name) {
  return message.payload?.headers?.find(h => h.name.toLowerCase() === name)?.value ?? '';
}

export function parseFrom(value) {
  const match = value.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  if (!match) return value.trim();
  return match[1].replace(/^"(.*)"$/, '$1').trim() || match[2].trim();
}
