// デモモード: 中継サーバなしで全画面を試せる架空データ(審査・ストア画像用)。実在の名前や会話は入れない
import type { Lang } from './i18n';
import type { MailThread } from './api';

type Thread = { handle: string; title: string; agent: string; state: 'idle' | 'busy' | 'unknown' };

const demoLabels = ['Inbox', 'Bulletins', 'Events', 'Logistics', 'Planning', 'Projects', 'Reading', 'Reference', 'Travel', 'Updates'];
const demoSubjects = ['Field notes newsletter', 'Workshop schedule', 'Revised packing list', 'Trail opening', 'Reading list', 'A new meeting room', 'Map corrections', 'April notes', 'Survey draft', 'Volunteer schedule'];
const marked = new Set<string>();
const mailDate = (i: number) => Date.now() - (i === 0 ? 21 : i * 480) * 60_000;
const homeSubjects = ['Garden club picnic', 'Library card renewal', 'Weekend market list'];
const demoMail = () => [...demoSubjects.map((subject, i): MailThread & { labels: string[] } => ({
  account: 'work', id: `demo-mail-${i}`, from: ['Field Notes Desk', 'Workshop Desk', 'Trail Team'][i % 3], subject,
  date: mailDate(i), unread: i % 3 !== 2 && !marked.has(`demo-mail-${i}`), count: i === 0 ? 3 : 1,
  labels: [...(i !== 3 ? ['INBOX'] : []), `Label_${i % (demoLabels.length - 1) + 1}`],
})), ...homeSubjects.map((subject, i): MailThread & { labels: string[] } => ({
  account: 'home', id: `demo-home-${i}`, from: ['Garden Club', 'City Library', 'Market Stall'][i], subject,
  date: mailDate(i) - 90 * 60_000, unread: i !== 2 && !marked.has(`demo-home-${i}`), count: 1, labels: ['INBOX'],
}))];

function newsletterText(i: number): string {
  const history = i ? '\n\nOn Tuesday the Field Notes Desk wrote:\n> The early route plan is available.\n> Follow the signs to the footbridge.' : '';
  const paragraphs = [
    'Morning survey. The team checked the eastern loop after the first rain. The gravel approach held up well and the creek was still below the footbridge.',
    'Route notes. Take the branch at the white trail post. The side path closer to the water ends at the reed bed. Record observations from the marked lookout.',
    'Equipment. Bring a small notebook and a pencil. The survey cards have space for the time, cloud cover, and any changes you notice in the trail surface.',
    'Next meeting. We will compare the north and east loops at the field station. Leave the completed survey cards in the tray on the left by the door.',
  ];
  // The sample source carries quoted history. The fixture API serves the same
  // cleaned message shape as the bridge, which removes the old quoted lines.
  const edition = ['First field report.', 'Second field report.', 'Latest field report.'][i];
  return ([edition, ...paragraphs].join('\n\n') + history).replace(/\n\nOn Tuesday the Field Notes Desk wrote:\n(?:>[^\n]*(?:\n|$))+$/, '');
}

const content = {
  en: {
    threads: [
      ['demo-1', 'Refactor auth middleware', 'claude', 'idle'],
      ['demo-2', 'Fix flaky CI test', 'codex', 'busy'],
      ['demo-3', 'Draft release notes', 'claude', 'idle'],
    ],
    texts: {
      'demo-1':
        'Session validation now lives in one place.\n- Expired tokens return 401\n- Admin routes use the same check\n\nAll 42 tests pass. Shall I commit this?\n1. Yes\n2. No, show me the diff',
      'demo-2': 'Looking into the timeouts.\nParallel tests shared one port, so each test now picks a free port.',
      'demo-3': 'Drafted release notes for v2.3.0.\n- New: CSV export\n- Fixed: date display offset\n\nPlease review the wording before publishing.',
    },
    replies: ['1 (Yes)', "2 (Yes, don't ask again)", '3 (No)', 'Continue', 'OK, go ahead', 'Status in 3 lines'],
    prompts: ['Start without a prompt', 'Run tests and report', 'Summarize changes'],
    heard: 'Looks good, go ahead with that plan',
    week: 'week',
  },
} as const;

export function demoCall(lang: Lang, method: string, path: string, body: unknown): unknown {
  // Sample data is English only; another language falls back to it.
  const c = (content as Partial<Record<Lang, typeof content.en>>)[lang] ?? content.en;
  // APIパスとクエリだけが必要。ホスト名を持つ仮URLは作らない。
  const queryStart = path.indexOf('?');
  const pathname = queryStart === -1 ? path : path.slice(0, queryStart);
  const searchParams = new URLSearchParams(queryStart === -1 ? '' : path.slice(queryStart + 1));
  const b = (body ?? {}) as Record<string, unknown>;
  switch (`${method} ${pathname}`) {
    case 'GET /api/capabilities':
      return { voice: true, modules: ['coding', 'email'] };
    case 'GET /api/mail/accounts':
      return [{ id: 'work', short: 'W', address: 'work@example.com', ok: true },
        { id: 'home', short: 'H', address: 'home@example.com', ok: true }];
    case 'GET /api/mail/labels':
      if (searchParams.get('account') === 'home') {
        return [{ id: 'INBOX', name: 'Inbox', unread: demoMail().filter(row => row.account === 'home' && row.unread).length }];
      }
      return demoLabels.map((name, i) => {
        const id = i === 0 ? 'INBOX' : `Label_${i}`;
        return { id, name, unread: demoMail().filter(row => row.account === 'work' && row.unread && row.labels.includes(id)).length };
      });
    case 'GET /api/mail/threads': {
      const filter = new Set(searchParams.get('filter')?.split(','));
      const page = Number(searchParams.get('page'));
      const size = Number(searchParams.get('size')) || 8;
      const rows = demoMail().filter(row => row.labels.some(label => filter.has(`${row.account}:${label}`)));
      return { items: rows.slice(page * size, (page + 1) * size).map(({ labels, ...row }) => row), hasMore: rows.length > (page + 1) * size,
        unread: rows.filter(row => row.unread).length };
    }
    case 'GET /api/mail/thread': {
      const thread = demoMail().find(row => row.account === searchParams.get('account') && row.id === searchParams.get('id'));
      if (!thread) throw new Error('Unknown sample thread');
      return { subject: thread.subject, messages: Array.from({ length: thread.count }, (_, i) => ({
        id: `${thread.id}-${i}`, from: thread.from, to: 'Sample Reader', cc: '', date: thread.date - (thread.count - 1 - i) * 86400000,
        text: thread.count > 1 ? newsletterText(i) : 'The updated notes are ready for the next meeting.',
      })) };
    }
    case 'POST /api/mail/read':
      if (!demoMail().some(row => row.account === b.account && row.id === b.threadId)) throw new Error('Unknown sample thread');
      marked.add(String(b.threadId));
      return { ok: true };
    case 'GET /healthz':
      return { ok: true };
    case 'GET /api/threads':
      return c.threads.map(([handle, title, agent, state]) => ({ handle, title, agent, state, workspaceId: handle === 'demo-3' ? 'demo-ws-2' : 'demo-ws-1', workspaceName: handle === 'demo-3' ? 'website' : 'my-app', workspaceLabel: handle === 'demo-3' ? 'website' : 'my-app' }) as Thread);
    case 'GET /api/thread':
    case 'GET /api/history':
      return { text: '/ Please review this session.\n> ' + (c.texts[searchParams.get('handle') as keyof typeof c.texts] ?? '').replaceAll('\n', '\n  ') };
    case 'GET /api/activity':
      return { state: searchParams.get('handle') === 'demo-2' ? 'working' : 'waiting', elapsedSeconds: searchParams.get('handle') === 'demo-2' ? 812 : null };
    case 'GET /api/replies':
      return c.replies;
    case 'POST /api/reply':
      return { sent: c.replies[Number(b.index)] ?? '' };
    case 'POST /api/transcribe':
      return { text: c.heard };
    case 'POST /api/say':
      return { sent: String(b.text ?? '') };
    case 'GET /api/usage': {
      const limit = (usedPercent: number, minutes: number) => {
        const resetsAt = Date.now() + minutes * 60000;
        return { usedPercent, resetsAt, resetDescription: '', computerResetDescription: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(resetsAt).replace(',', '') };
      };
      return {
        claude: { provider: 'claude', status: 'ok', session: limit(12, 120), weekly: limit(30, 3192) },
        codex: { provider: 'codex', status: 'ok', session: null, weekly: limit(55, 3192) },
      };
    }
    case 'GET /api/providers':
      return [
        { id: 'claude', models: ['default', 'opus', 'sonnet', 'haiku'], ok: true, note: `5h 12% ${c.week} 30%` },
        { id: 'codex', models: ['default'], ok: true, note: `${c.week} 55%` },
      ];
    case 'GET /api/workspaces':
      return [
        { id: 'demo-ws-1', name: 'my-app' },
        { id: 'demo-ws-2', name: 'website' },
      ];
    case 'GET /api/prompts':
      return c.prompts;
    case 'POST /api/session':
      return { handle: 'demo-new', sent: true };
    default:
      throw new Error(`demo: ${method} ${pathname}`);
  }
}
