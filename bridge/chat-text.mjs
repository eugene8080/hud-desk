// Beeper hands over message text with the formatting the chat app sent as HTML (Matrix
// formatted_body): <ul><li>, <ol>, <b>, <a>, <p>, <blockquote>, entities (Eugene on G2, 2026-11-27:
// "a lot of formatting still like <ul><li>"). This turns it into the plain text the glasses show:
// bulleted items as "• ", numbered items as "1. ", nested lists indented two spaces a level,
// blocks and <br> as line breaks, links as their text, quotes as "> " lines, every other tag
// dropped and entities decoded. Text without tags or entities is returned unchanged.
import { decodeEntities } from './mail-text.mjs';

const TAG = /<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi;
const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'pre', 'table', 'section', 'article', 'hr']);

export function chatHtmlToText(value) {
  const input = String(value ?? '');
  if (!/<\/?[a-z][a-z0-9-]*\b[^>]*>|&(?:#x?[0-9a-f]+|[a-z]+);/i.test(input)) return input;
  // Matrix reply fallback: the quoted original the client prepends, never part of the new message.
  const html = input.replace(/<mx-reply\b[^>]*>[^]*?<\/mx-reply\s*>/gi, '').replace(/<!--[^]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, '');
  const lists = [];
  let quote = 0;
  let out = '';
  // A new line; inside a quote every line starts with "> ".
  const newline = () => { out = out.replace(/[ \t]+$/, '') + '\n' + '> '.repeat(quote); };
  let last = 0;
  for (const match of html.matchAll(TAG)) {
    out += html.slice(last, match.index).replace(/\s*\n\s*/g, ' ');
    last = match.index + match[0].length;
    const name = match[1].toLowerCase();
    const closing = match[0][1] === '/';
    if (name === 'br') newline();
    else if (name === 'ul' || name === 'ol') {
      if (closing) { lists.pop(); if (!lists.length) newline(); }
      else {
        // No blank line before a list: each item starts its own line already.
        const start = Number(/\sstart\s*=\s*["']?(\d+)/i.exec(match[0])?.[1] ?? 1);
        lists.push({ ordered: name === 'ol', next: start });
      }
    } else if (name === 'li' && !closing) {
      newline();
      const list = lists.at(-1);
      out += '  '.repeat(Math.max(0, lists.length - 1)) + (list?.ordered ? `${list.next++}. ` : '• ');
    } else if (name === 'blockquote') {
      quote = Math.max(0, quote + (closing ? -1 : 1));
      newline();
    } else if (BLOCK.has(name)) newline();
  }
  out += html.slice(last).replace(/\s*\n\s*/g, ' ');
  return decodeEntities(out)
    .split('\n').map(line => line.replace(/[ \t]+$/, '').replace(/^(> )+$/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
