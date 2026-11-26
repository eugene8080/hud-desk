import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);
const ID = '[a-zA-Z0-9_-]+';
const GET_PATH = new RegExp(`^/(?:profile|labels(?:/${ID})?|threads(?:/${ID})?|messages/${ID})$`);
const MODIFY_PATH = new RegExp(`^/threads/${ID}/modify$`);

export class MailError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function permittedBody(method, path, body) {
  if (method === 'GET' && GET_PATH.test(path) && body === undefined) return undefined;
  if (method === 'POST' && MODIFY_PATH.test(path) &&
      body && Reflect.ownKeys(body).length === 1 && Object.hasOwn(body, 'removeLabelIds')) {
    const labels = body.removeLabelIds;
    if (Array.isArray(labels) && labels.length === 1 && labels[0] === 'UNREAD' &&
        Reflect.ownKeys(labels).length === 2) {
      // Serialize the exact allowed mutation independently of the caller's object.
      return '{"removeLabelIds":["UNREAD"]}';
    }
  }
  throw new MailError('disallowed', 400);
}

export async function readOAuthClient(file) {
  try {
    const { installed } = JSON.parse(await readFile(file, 'utf8'));
    if (typeof installed?.client_id !== 'string' || !installed.client_id ||
        typeof installed.client_secret !== 'string' || !installed.client_secret) throw new Error();
    return installed;
  } catch {
    throw new MailError('auth', 502);
  }
}

async function loadCredentials(clientFile, account) {
  try {
    const client = await readOAuthClient(clientFile);
    const token = JSON.parse(await readFile(account.tokenFile, 'utf8'));
    if (token.account?.toLowerCase() !== account.address.toLowerCase() ||
        !Array.isArray(token.scopes) || !token.scopes.includes(GMAIL_SCOPE) ||
        typeof token.refresh_token !== 'string' || !token.refresh_token) throw new Error();
    return { ...client, refresh_token: token.refresh_token };
  } catch {
    throw new MailError('auth', 502);
  }
}

export function createGmail(clientFile, account, {
  transport = fetch, credentials = () => loadCredentials(clientFile, account),
  now = Date.now, sleep = delay, jitter = () => Math.floor(Math.random() * 250),
} = {}) {
  let access;
  let refreshing;

  async function request(url, options) {
    try {
      return await transport(url, {
        ...options, redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new MailError('network', 502);
    }
  }

  async function refresh() {
    const { client_id, client_secret, refresh_token } = await credentials();
    const response = await request(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id, client_secret, refresh_token, grant_type: 'refresh_token' }),
    });
    const token = await response.json().catch(() => ({}));
    if (!response.ok || typeof token.access_token !== 'string' || !token.access_token) {
      throw new MailError(response.status >= 500 || response.status === 429 ? 'network' : 'auth', 502);
    }
    const expires = Number(token.expires_in) || 3600;
    access = { token: token.access_token, expiresAt: now() + expires * 1000 };
    return access.token;
  }

  function googleAccessToken() {
    if (access && now() < access.expiresAt) return access.token;
    refreshing ??= refresh().finally(() => { refreshing = undefined; });
    return refreshing;
  }

  async function gmail(method, path, { query, body } = {}) {
    if (typeof path !== 'string' || /\s/.test(path)) throw new MailError('disallowed', 400);
    const data = permittedBody(method, path, body);
    const url = new URL(GMAIL_URL + path);
    if (query) url.search = new URLSearchParams(query).toString();
    let retriedAuth = false;
    for (let attempt = 0; ; attempt++) {
      const token = await googleAccessToken();
      const headers = { Authorization: `Bearer ${token}` };
      if (data) headers['Content-Type'] = 'application/json';
      const response = await request(url, { method, headers, body: data });
      if (response.status === 401 && !retriedAuth) {
        if (access?.token === token) access = undefined;
        retriedAuth = true;
        attempt--;
        continue;
      }
      const result = await response.json().catch(() => null);
      if (response.ok && result !== null) return result;
      const reasons = result?.error?.errors;
      const limited = response.status === 429 || (response.status === 403 &&
        Array.isArray(reasons) && reasons.some(entry => RATE_REASONS.has(entry?.reason)));
      if (limited && attempt < 4) {
        await sleep(1000 * 2 ** attempt + jitter());
        continue;
      }
      if (limited) throw new MailError('rate-limit', 503);
      if (response.status === 404) throw new MailError('not found', 404);
      if (response.status === 401 || response.status === 403) throw new MailError('auth', 502);
      throw new MailError('network', 502);
    }
  }

  return gmail;
}
