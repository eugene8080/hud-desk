import test from 'node:test';
import assert from 'node:assert/strict';
import { chatHtmlToText } from '../bridge/chat-text.mjs';

test('chat HTML: lists become bullets and numbers, nested lists indent, blocks and <br> break lines', () => {
  const html = 'House B<ul><li>1 x 2/F 主人房1隻窗換鉸</li><li>1 x 1/F corridor window - cannot tilt</li></ul><br>' +
    'House C<ol start="3"><li>one<ul><li>sub &amp; more</li></ul></li><li><strong>two</strong> <a href="https://x.test">link</a></li></ol>' +
    '<p>Para <em>one</em></p><p>Para <del>two</del> <code>x</code> <span>y</span></p>';
  assert.equal(chatHtmlToText(html), [
    'House B', '• 1 x 2/F 主人房1隻窗換鉸', '• 1 x 1/F corridor window - cannot tilt', '', 'House C',
    '3. one', '  • sub & more', '4. two link', '', 'Para one', '', 'Para two x y',
  ].join('\n'));
});

test('chat HTML: quotes, reply fallbacks and entities; plain text is untouched', () => {
  assert.equal(chatHtmlToText('<mx-reply><blockquote>old message</blockquote></mx-reply>New reply'), 'New reply');
  assert.equal(chatHtmlToText('Before<blockquote>quoted<br>line</blockquote>After'), 'Before\n> quoted\n> line\nAfter');
  assert.equal(chatHtmlToText('a &lt;b&gt; &quot;c&quot; &nbsp;d &#39;e&#39;'), 'a <b> "c"  d \'e\'');
  const plain = 'Line one\nLine two  with  spaces <- arrow';
  assert.equal(chatHtmlToText(plain), plain);
});
