// A local transport double for the Beeper Desktop routes used by Chat.
// There is no fallback to fetch or to a local Beeper installation.
export const fixtureChatId = index => `!fixture-${index}:example.test`;

export function createBeeperFixture() {
  const networks = ['Signal', 'Telegram', 'WhatsApp'];
  const now = Date.now();
  const timestamp = offset => new Date(now - offset).toISOString();
  const rows = Array.from({ length: 10 }, (_, i) => ({
    id: fixtureChatId(i), title: `Sample group ${i + 1}`, network: networks[i % networks.length],
    accountID: `fixture-${i % networks.length}`, lastActivity: timestamp(i * 18_000_000),
    unreadCount: i % 3 === 0 ? 3 : 0, isReadOnly: i === 9,
  }));
  const sends = [];
  const calls = [];
  const transport = async (url, options) => {
    const { pathname, searchParams } = new URL(url);
    calls.push({ path: pathname, method: options.method, cursor: searchParams.get('cursor') });
    if (options.headers.authorization !== 'Bearer fixture-token') return Response.json({}, { status: 401 });
    if (options.method === 'GET' && pathname === '/v1/accounts') {
      return Response.json(networks.map((network, i) => ({ network, accountID: `fixture-${i}` })));
    }
    if (options.method === 'GET' && pathname === '/v1/chats') {
      return searchParams.get('cursor') === 'older'
        ? Response.json({ items: rows.slice(6), hasMore: false })
        : Response.json({ items: rows.slice(0, 6), hasMore: true, oldestCursor: 'older' });
    }
    const match = /^\/v1\/chats\/([^/]+)\/messages$/.exec(pathname);
    const id = match && decodeURIComponent(match[1]);
    if (rows.some(row => row.id === id)) {
      if (options.method === 'POST') {
        const { text } = JSON.parse(options.body);
        sends.push({ id, text });
        return Response.json({ chatID: id, pendingMessageID: `pending-${sends.length}` });
      }
      if (options.method === 'GET') {
        return Response.json({ items: [
          ...sends.filter(send => send.id === id).map(send => ({ text: send.text, isSender: true, timestamp: new Date().toISOString() })),
          { text: 'Synthetic newest message.\n' + Array.from({ length: 12 }, (_, i) => `Sample line ${i + 1}.`).join('\n'),
            senderName: 'Fixture sender', timestamp: timestamp(1000) },
          { text: 'Synthetic earlier message.', isSender: true, timestamp: timestamp(2000) },
        ], hasMore: false });
      }
    }
    return Response.json({}, { status: 404 });
  };
  return { transport, calls, sends };
}
