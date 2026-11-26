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

export function htmlToText(html) {
  return decodeEntities(html
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<(script|style|head|title)\b[^>]*>[^]*?<\/\1\s*>/gi, '')
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

export function bodyText(payload) {
  const plain = findPart(payload, 'text/plain');
  const html = findPart(payload, 'text/html');
  const text = plain ? decodeEntities(decodePart(plain)) : '';
  return tidy(html && text.trim().length < 200 ? htmlToText(decodePart(html)) : text);
}

export function header(message, name) {
  return message.payload?.headers?.find(h => h.name.toLowerCase() === name)?.value ?? '';
}

export function parseFrom(value) {
  const match = value.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  if (!match) return value.trim();
  return match[1].replace(/^"(.*)"$/, '$1').trim() || match[2].trim();
}
